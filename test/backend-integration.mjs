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
const RULESET_VERSION = '2026-08-04-v1';
await mkdir(temp, { recursive: true });
const legacyRunCreatedAt = Date.now() - 1000;

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
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, player_id TEXT NOT NULL,
      score INTEGER NOT NULL, distance INTEGER NOT NULL, created_at INTEGER NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0, verification_reason TEXT NOT NULL DEFAULT 'legacy',
      ruleset_version TEXT NOT NULL DEFAULT 'legacy'
    );
    CREATE TABLE run_sessions (
      run_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, started_at INTEGER NOT NULL,
      last_beat_at INTEGER NOT NULL, beats INTEGER NOT NULL DEFAULT 0,
      last_score INTEGER NOT NULL DEFAULT 0, last_distance INTEGER NOT NULL DEFAULT 0,
      used INTEGER NOT NULL DEFAULT 0
    );
  `);
  legacy.prepare('INSERT INTO players(player_id, telegram_id, alias, updated_at) VALUES (?, NULL, ?, ?)').run(
    'legacy-player-ref', 'Старый игрок', Date.now() - 1000,
  );
  legacy.prepare(`
    INSERT INTO runs(run_id, player_id, score, distance, created_at, verified, verification_reason, ruleset_version)
    VALUES (?, ?, 120, 80, ?, 1, 'verified', 'legacy')
  `).run('9'.repeat(32), 'legacy-player-ref', legacyRunCreatedAt);
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
    BOT_TOKEN: '', RULESET_VERSION,
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
async function runNode(args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', (b) => { output += b; });
    proc.stderr.on('data', (b) => { output += b; });
    proc.on('error', reject);
    proc.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`command failed (${code}): ${output}`)));
  });
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
  await post('/v1/run/start', { playerId, playerSecret, runId, rulesetVersion: RULESET_VERSION });

  // Делаем heartbeat-сессию достаточно длинной и полной без реального ожидания.
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  db.prepare(`
    UPDATE run_sessions
    SET started_at = ?, last_beat_at = ?, beats = 2, last_score = 100, last_distance = 10, covered_ms = 10000
    WHERE run_id = ?
  `).run(now - 12_000, now - 1_000, runId);
  db.close();

  const payload = {
    playerId, playerSecret, runId, rulesetVersion: RULESET_VERSION, alias: 'Тестер', score: 150, distance: 20,
  };
  const first = await post('/v1/scores', payload);
  if (!first.verified || first.entries.length !== 1) throw new Error('verified run did not enter prize board');
  const duplicate = await post('/v1/scores', payload);
  if (!duplicate.duplicate) throw new Error('repeat submit was not idempotent');

  const casualRunId = 'fedcba9876543210fedcba9876543210';
  await post('/v1/run/start', { playerId, playerSecret, runId: casualRunId, rulesetVersion: RULESET_VERSION });
  const casual = await post('/v1/scores', { ...payload, runId: casualRunId, score: 80, distance: 8 });
  if (casual.verified || casual.entries.length !== 1) throw new Error('casual run leaked into prize board');

  const check = new DatabaseSync(dbPath, { readOnly: true });
  const rows = check.prepare('SELECT run_id, verified, verification_reason, ruleset_version FROM runs ORDER BY id').all();
  check.close();
  const firstRow = rows.find((row) => row.run_id === runId);
  const casualRow = rows.find((row) => row.run_id === casualRunId);
  if (!firstRow || !casualRow || firstRow.verified !== 1 || casualRow.verified !== 0) throw new Error('run persistence mismatch');
  if (firstRow.ruleset_version !== RULESET_VERSION) throw new Error('server ruleset version not persisted');

  const publicBoard = await (await fetch(base + '/v1/leaderboard?period=week&board=total&limit=25&me=' + encodeURIComponent(identity.publicId))).json();
  if (publicBoard.entries.some((entry) => 'playerId' in entry || String(entry.publicId).startsWith('tg:'))) {
    throw new Error('private player ID leaked through leaderboard');
  }
  if (publicBoard.me?.publicId !== identity.publicId) throw new Error('public self lookup lost rank/referrals');

  const staleRuleset = await fetch(base + '/v1/run/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerSecret, runId: '3'.repeat(32), rulesetVersion: 'stale-client' }),
  });
  if (staleRuleset.status !== 409) throw new Error('client can start a run under a stale/injected ruleset');

  // Heartbeats дают покрытие только по реальному серверному времени. Быстрый
  // burst не увеличивает покрытие, а невозможная дельта навсегда портит сессию.
  const auditRunId = '4'.repeat(32);
  await post('/v1/run/start', { playerId, playerSecret, runId: auditRunId, rulesetVersion: RULESET_VERSION });
  {
    const auditDb = new DatabaseSync(dbPath);
    const beatNow = Date.now();
    auditDb.prepare('UPDATE run_sessions SET started_at = ?, last_beat_at = ? WHERE run_id = ?')
      .run(beatNow - 6000, beatNow - 3000, auditRunId);
    auditDb.close();
  }
  await post('/v1/run/beat', { playerId, playerSecret, runId: auditRunId, seq: 1, score: 10, distance: 3 });
  const staleBeat = await post('/v1/run/beat', { playerId, playerSecret, runId: auditRunId, seq: 1, score: 0, distance: 0 });
  if (!staleBeat.stale || staleBeat.lastSeq !== 1) throw new Error('reordered heartbeat invalidated the run');
  const burst = await fetch(base + '/v1/run/beat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerSecret, runId: auditRunId, seq: 2, score: 10, distance: 3 }),
  });
  if (burst.status !== 429) throw new Error('rapid heartbeat burst was counted');
  {
    const auditDb = new DatabaseSync(dbPath);
    auditDb.prepare('UPDATE run_sessions SET last_beat_at = ? WHERE run_id = ?').run(Date.now() - 3000, auditRunId);
    auditDb.close();
  }
  const impossible = await fetch(base + '/v1/run/beat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerSecret, runId: auditRunId, seq: 2, score: 20, distance: 900 }),
  });
  if (impossible.status !== 422) throw new Error('impossible heartbeat was accepted');
  {
    const auditDb = new DatabaseSync(dbPath, { readOnly: true });
    const sessionAudit = auditDb.prepare('SELECT covered_ms, invalid_reason FROM run_sessions WHERE run_id = ?').get(auditRunId);
    const beatAudit = auditDb.prepare('SELECT accepted, reason FROM run_beats WHERE run_id = ? ORDER BY id').all(auditRunId);
    auditDb.close();
    if (sessionAudit.covered_ms < 2500 || sessionAudit.invalid_reason !== 'implausible_delta') throw new Error('heartbeat coverage/invalidation was not persisted');
    if (!beatAudit.some((b) => b.accepted === 1) || !beatAudit.some((b) => b.accepted === 0)) throw new Error('immutable heartbeat audit is incomplete');
  }

  const parallelA = '5'.repeat(32); const parallelB = '6'.repeat(32);
  await post('/v1/run/start', { playerId, playerSecret, runId: parallelA, rulesetVersion: RULESET_VERSION });
  await post('/v1/run/start', { playerId, playerSecret, runId: parallelB, rulesetVersion: RULESET_VERSION });
  {
    const auditDb = new DatabaseSync(dbPath, { readOnly: true });
    const superseded = auditDb.prepare('SELECT used, invalid_reason FROM run_sessions WHERE run_id = ?').get(parallelA);
    auditDb.close();
    if (superseded.used !== 1 || superseded.invalid_reason !== 'superseded') throw new Error('parallel player sessions remain prize-eligible');
  }

  const noBeatRun = '7'.repeat(32);
  await post('/v1/run/start', { playerId, playerSecret, runId: noBeatRun, rulesetVersion: RULESET_VERSION });
  {
    const auditDb = new DatabaseSync(dbPath);
    auditDb.prepare('UPDATE run_sessions SET started_at = ?, last_beat_at = ? WHERE run_id = ?')
      .run(Date.now() - 12_000, Date.now() - 12_000, noBeatRun);
    auditDb.close();
  }
  const noBeatResult = await post('/v1/scores', {
    playerId, playerSecret, runId: noBeatRun, rulesetVersion: RULESET_VERSION, score: 50, distance: 10,
  });
  if (noBeatResult.verified || noBeatResult.verificationReason !== 'heartbeat_missing') {
    throw new Error('run without a heartbeat became verified');
  }

  const today = new Date().toISOString().slice(0, 10);
  const legacyDay = new Date(legacyRunCreatedAt).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cliArgs = ['backend/notify-winners.mjs', '--top', '10', '--board', 'total', '--dry', '--message', 'test'];
  const legacyWinners = await runNode([...cliArgs, '--from', legacyDay, '--to', legacyDay, '--ruleset', 'legacy'], { DB_PATH: dbPath, RULESET_VERSION });
  if (!legacyWinners.includes('Старый игрок')) throw new Error('legacy verified run was lost from historical period selection');
  const inRange = await runNode([...cliArgs, '--from', today, '--to', today], { DB_PATH: dbPath, RULESET_VERSION });
  const outOfRange = await runNode([...cliArgs, '--from', yesterday, '--to', yesterday], { DB_PATH: dbPath, RULESET_VERSION });
  if (!inRange.includes('Тестер') || !outOfRange.includes('Победителей не найдено')) {
    throw new Error('arbitrary inclusive UTC period does not select the expected winners');
  }
  {
    const archiveDb = new DatabaseSync(dbPath);
    archiveDb.prepare('INSERT INTO players(player_id, telegram_id, alias, updated_at) VALUES (?, NULL, ?, ?)')
      .run('archive-player-1', 'Архив', Date.now());
    archiveDb.prepare(`
      INSERT INTO runs(run_id, player_id, score, distance, created_at, started_at, ended_at, verified, verification_reason, ruleset_version)
      VALUES (?, ?, 100, 100, ?, ?, ?, 1, 'verified', 'archive-v1')
    `).run('8'.repeat(32), 'archive-player-1', Date.now(), Date.now() - 2000, Date.now() - 1000);
    archiveDb.close();
  }
  const archived = await runNode([...cliArgs, '--from', today, '--to', today, '--ruleset', 'archive-v1'], { DB_PATH: dbPath, RULESET_VERSION });
  if (!archived.includes('Архив')) throw new Error('historical ruleset cannot be recalculated after reset');

  const unauthAlias = await fetch(base + '/v1/alias', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, alias: 'Украдено' }),
  });
  if (unauthAlias.status !== 401) throw new Error('alias can be changed without owner secret');
  const impersonatedStart = await fetch(base + '/v1/run/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, playerSecret: 'b'.repeat(64), runId: '1'.repeat(32), rulesetVersion: RULESET_VERSION }),
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
  const winnersQuery = source.match(/const qWinnersContacts = db\.prepare\(`([\s\S]*?)`\);/)?.[1] || '';
  if (/AUTO_NOTIFY_CYCLE_MS|runAutomaticCycleBroadcasts|qCycleTop10/.test(source)
      || !/r\.started_at\s*>=\s*\?/.test(winnersQuery)
      || !/r\.ended_at\s*<\s*\?/.test(winnersQuery)
      || !/r\.verified\s*=\s*1/.test(winnersQuery)
      || !/campaignPeriod:\s*`rolling-week:\$\{utcDay\}`/.test(source)
      || !/campaign:\s*`winners:\$\{range\.ruleset\}:\$\{range\.campaignPeriod\}`/.test(source)) {
    throw new Error('manual arbitrary-period winner selection is not bounded or automatic prize cycle remains enabled');
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
  console.log('✓ backend: auth, private IDs, verified-board, arbitrary periods, heartbeat audit, anti-parallel, idempotency, admin guard и ETag работают');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(temp, { recursive: true, force: true });
}
