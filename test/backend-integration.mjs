import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = path.join(root, 'tmp', `backend-test-${process.pid}`);
const dbPath = path.join(temp, 'uboost.db');
const port = 20_000 + Math.floor(Math.random() * 20_000);
const base = `http://127.0.0.1:${port}`;
await mkdir(temp, { recursive: true });

// Прод-совместимая старая схема: проверяем, что publicId/ref мигрируются без
// удаления событий и потери счётчика приглашений.
{
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE players (
      player_id TEXT PRIMARY KEY, telegram_id TEXT, alias TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, telegram_id TEXT,
      props_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  legacy.prepare('INSERT INTO players(player_id, telegram_id, alias, updated_at) VALUES (?, NULL, ?, ?)').run(
    'legacy-player-ref', 'Старый игрок', Date.now() - 1000,
  );
  legacy.prepare("INSERT INTO analytics_events(event, telegram_id, props_json, created_at) VALUES ('landing', NULL, ?, ?)").run(
    JSON.stringify({ ref: 'legacy-player-ref' }), Date.now(),
  );
  legacy.close();
}

const child = spawn(process.execPath, ['backend/server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port), DB_PATH: dbPath, STATIC_ROOT: root,
    BOT_TOKEN: '', RULESET_VERSION: '2026-07-17-v2',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (b) => { logs += b; });
child.stderr.on('data', (b) => { logs += b; });

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/v1/health'); if (r.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start\n${logs}`);
}
async function post(url, body) {
  const response = await fetch(base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}

try {
  await waitForServer();
  const playerId = 'test-player-123';
  const playerSecret = 'a'.repeat(64);
  const runId = '0123456789abcdef0123456789abcdef';
  const identity = await post('/v1/player/session', { playerId, playerSecret });
  if (!/^p_[a-zA-Z0-9_-]{20}$/.test(identity.publicId)) throw new Error('public identity not issued');
  const legacyIdentity = await post('/v1/player/session', {
    playerId: 'legacy-player-ref', playerSecret: 'c'.repeat(64),
  });
  const legacyBoard = await (await fetch(base + '/v1/leaderboard?me=' + encodeURIComponent(legacyIdentity.publicId))).json();
  if (legacyBoard.me?.referrals !== 1) throw new Error('historical referral analytics was lost');
  await post('/v1/run/start', { playerId, playerSecret, runId, rulesetVersion: '2026-07-17-v2' });

  // Делаем heartbeat-сессию достаточно длинной и полной без реального ожидания.
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  db.prepare(`
    UPDATE run_sessions
    SET started_at = ?, last_beat_at = ?, beats = 2, last_score = 100, last_distance = 10
    WHERE run_id = ?
  `).run(now - 12_000, now - 1_000, runId);
  db.close();

  const payload = {
    playerId, playerSecret, runId, rulesetVersion: '2026-07-17-v2', alias: 'Тестер', score: 150, distance: 20,
  };
  const first = await post('/v1/scores', payload);
  if (!first.verified || first.entries.length !== 1) throw new Error('verified run did not enter prize board');
  const duplicate = await post('/v1/scores', payload);
  if (!duplicate.duplicate) throw new Error('repeat submit was not idempotent');

  const casualRunId = 'fedcba9876543210fedcba9876543210';
  await post('/v1/run/start', { playerId, playerSecret, runId: casualRunId, rulesetVersion: '2026-07-17-v2' });
  const casual = await post('/v1/scores', { ...payload, runId: casualRunId, score: 80, distance: 8 });
  if (casual.verified || casual.entries.length !== 1) throw new Error('casual run leaked into prize board');

  const check = new DatabaseSync(dbPath, { readOnly: true });
  const rows = check.prepare('SELECT run_id, verified, verification_reason, ruleset_version FROM runs ORDER BY id').all();
  check.close();
  if (rows.length !== 2 || rows[0].verified !== 1 || rows[1].verified !== 0) throw new Error('run persistence mismatch');
  if (rows[0].ruleset_version !== '2026-07-17-v2') throw new Error('ruleset version not persisted');

  const publicBoard = await (await fetch(base + '/v1/leaderboard?period=week&board=total&limit=25&me=' + encodeURIComponent(identity.publicId))).json();
  if (publicBoard.entries.some((entry) => 'playerId' in entry || String(entry.publicId).startsWith('tg:'))) {
    throw new Error('private player ID leaked through leaderboard');
  }
  if (publicBoard.me?.publicId !== identity.publicId) throw new Error('public self lookup lost rank/referrals');

  const unauthAlias = await fetch(base + '/v1/alias', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, alias: 'Украдено' }),
  });
  if (unauthAlias.status !== 401) throw new Error('alias can be changed without owner secret');
  const impersonatedStart = await fetch(base + '/v1/run/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerSecret: 'b'.repeat(64), runId: '1'.repeat(32) }),
  });
  if (impersonatedStart.status !== 401) throw new Error('run can be started under another player');
  const publicLinkStatus = await fetch(base + '/v1/link/status?me=' + encodeURIComponent(playerId));
  if (publicLinkStatus.status !== 404) throw new Error('legacy public link status still exposes contacts');

  const staticResponse = await fetch(base + '/config.js');
  const etag = staticResponse.headers.get('etag');
  if (!etag) throw new Error('static response has no ETag');
  const cached = await fetch(base + '/config.js', { headers: { 'If-None-Match': etag } });
  if (cached.status !== 304) throw new Error(`conditional static request returned ${cached.status}`);

  const source = await readFile(path.join(root, 'backend', 'server.js'), 'utf8');
  if (!/BOT_ADMIN_IDS/.test(source) || !/\/\(admin\|contacts\|winners\)/.test(source)) {
    throw new Error('admin-only contacts command is missing');
  }
  const participantQuery = source.match(/const qCycleParticipants = db\.prepare\(`([\s\S]*?)`\);/)?.[1] || '';
  const top10Query = source.match(/const qCycleTop10 = db\.prepare\(`([\s\S]*?)`\);/)?.[1] || '';
  if (!/AUTO_NOTIFY_CYCLE_MS\s*=\s*3\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(source)
      || !/cycleRecipients\(qCycleParticipants, cycle\)/.test(source)
      || !/cycleRecipients\(qCycleTop10, prizeCycle, 10\)/.test(source)
      || !/firstCompletedCycle/.test(source)
      || !/idx_notify_campaign_player/.test(source)
      || /verified\s*=\s*1/.test(participantQuery)
      || !/r\.verified\s*=\s*1/.test(top10Query)) {
    throw new Error('automatic three-day participant/top-10 broadcasts are missing or unverified');
  }
  const config = await readFile(path.join(root, 'config.js'), 'utf8');
  if (!/STORE_URL:\s*'https:\/\/uboost\.site\/'/.test(config)
      || !/PROMO:\s*\{\s*code:\s*'URUNNER'/.test(config)) {
    throw new Error('payment URL or URUNNER promo is not configured');
  }
  const lifeCampaign = JSON.parse(await readFile(path.join(root, 'backend', 'campaigns', 'life-winner.json'), 'utf8'));
  const top10Campaign = JSON.parse(await readFile(path.join(root, 'backend', 'campaigns', 'top10-3d.json'), 'utf8'));
  if (!lifeCampaign.message.includes('<code>URUNNER</code>') || !lifeCampaign.buttonUrl.startsWith('https://uboost.site/')) {
    throw new Error('life-winner campaign has stale promo or URL');
  }
  if (top10Campaign.message !== 'Поздравляем с победой в ЮБуст Раннере! Приставка твоя. Свяжемся с тобой в ближайшее время') {
    throw new Error('top-10 winner message does not match product copy');
  }
  console.log('✓ backend: auth, private IDs, verified-board, idempotency, авторассылки, промо, admin guard и ETag работают');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(temp, { recursive: true, force: true });
}
