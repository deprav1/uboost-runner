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
  const runId = '0123456789abcdef0123456789abcdef';
  await post('/v1/run/start', { playerId, runId, rulesetVersion: '2026-07-17-v2' });

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
    playerId, runId, rulesetVersion: '2026-07-17-v2', alias: 'Тестер', score: 150, distance: 20,
  };
  const first = await post('/v1/scores', payload);
  if (!first.verified || first.entries.length !== 1) throw new Error('verified run did not enter prize board');
  const duplicate = await post('/v1/scores', payload);
  if (!duplicate.duplicate) throw new Error('repeat submit was not idempotent');

  const casualRunId = 'fedcba9876543210fedcba9876543210';
  await post('/v1/run/start', { playerId, runId: casualRunId, rulesetVersion: '2026-07-17-v2' });
  const casual = await post('/v1/scores', { ...payload, runId: casualRunId, score: 80, distance: 8 });
  if (casual.verified || casual.entries.length !== 1) throw new Error('casual run leaked into prize board');

  const check = new DatabaseSync(dbPath, { readOnly: true });
  const rows = check.prepare('SELECT run_id, verified, verification_reason, ruleset_version FROM runs ORDER BY id').all();
  check.close();
  if (rows.length !== 2 || rows[0].verified !== 1 || rows[1].verified !== 0) throw new Error('run persistence mismatch');
  if (rows[0].ruleset_version !== '2026-07-17-v2') throw new Error('ruleset version not persisted');

  const staticResponse = await fetch(base + '/config.js');
  const etag = staticResponse.headers.get('etag');
  if (!etag) throw new Error('static response has no ETag');
  const cached = await fetch(base + '/config.js', { headers: { 'If-None-Match': etag } });
  if (cached.status !== 304) throw new Error(`conditional static request returned ${cached.status}`);

  const source = await readFile(path.join(root, 'backend', 'server.js'), 'utf8');
  if (!/BOT_ADMIN_IDS/.test(source) || !/\/\(admin\|contacts\|winners\)/.test(source)) {
    throw new Error('admin-only contacts command is missing');
  }
  console.log('✓ backend: verified-board, idempotency, ruleset, admin guard и ETag работают');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(temp, { recursive: true, force: true });
}
