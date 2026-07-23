// Consistent SQLite backup for the production timer.
// VACUUM INTO takes a point-in-time snapshot while the game keeps accepting runs.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(process.env.DB_PATH || path.join(here, 'data', 'uboost.db'));
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(here, '..', 'backups', 'db'));
const keep = Math.max(7, Number(process.env.BACKUP_KEEP) || 30);
mkdirSync(backupDir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `uboost-${stamp}.sqlite`);
const quotedTarget = target.replaceAll("'", "''");

const source = new DatabaseSync(dbPath);
try {
  source.exec(`VACUUM INTO '${quotedTarget}'`);
} finally {
  source.close();
}
chmodSync(target, 0o600);

const snapshot = new DatabaseSync(target, { readOnly: true });
try {
  const check = snapshot.prepare('PRAGMA quick_check').get();
  if (String(Object.values(check || {})[0] || '') !== 'ok') throw new Error('backup quick_check failed');
} finally {
  snapshot.close();
}

const backups = readdirSync(backupDir)
  .filter((name) => /^uboost-.+\.sqlite$/.test(name))
  .map((name) => ({ name, mtime: statSync(path.join(backupDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
for (const old of backups.slice(keep)) unlinkSync(path.join(backupDir, old.name));

console.log(`database backup ok: ${target}`);
