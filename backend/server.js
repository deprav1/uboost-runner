// ============================================================================
//  ЮБуст Раннер — Node-сервер для VPS: статика игры + API доски результатов.
//  Порт backend/worker.js (Cloudflare) на node:http + node:sqlite, без npm-
//  зависимостей. Запуск: node backend/server.js (Node >= 22.13, лучше 24).
//
//  API:
//    GET  /v1/token                 — анти-чит токен забега (HMAC + timestamp)
//    GET  /v1/leaderboard?period=week|all&me=<playerId> — топ + твой ранг/рефералы
//    GET  /v1/dashboard             — сводные метрики за 7 дней
//    POST /v1/scores                — результат забега (нужен токен или initData)
//    POST /v1/alias                 — смена имени на доске
//    POST /v1/events                — аналитика
//
//  Переменные окружения:
//    PORT            — порт HTTP (по умолчанию 80)
//    STATIC_ROOT     — корень статики игры (по умолчанию ../ от этого файла)
//    DB_PATH         — путь к SQLite-файлу (по умолчанию ./data/uboost.db)
//    BOT_TOKEN       — токен Telegram-бота; если задан и клиент прислал
//                      initData — подпись проверяется и токен забега не нужен.
//                      Без токена доска «лёгкая вирусная»: принимает клиентский
//                      playerId + анти-чит токен (очки на клиенте не защищены).
//    ALLOWED_ORIGIN  — CORS-origin'ы через запятую (пусто = same-origin only)
// ============================================================================

import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 80;
const STATIC_ROOT = path.resolve(process.env.STATIC_ROOT || path.join(__dirname, '..'));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'data', 'uboost.db'));
const BOT_TOKEN = process.env.BOT_TOKEN || '';

// --- Секрет для анти-чит токенов: генерируется один раз и переживает рестарты,
// чтобы забеги, начатые до рестарта сервиса, не теряли результат. -------------
mkdirSync(path.dirname(DB_PATH), { recursive: true });
const SECRET_PATH = path.join(path.dirname(DB_PATH), 'token-secret');
let TOKEN_SECRET;
try { TOKEN_SECRET = readFileSync(SECRET_PATH); if (TOKEN_SECRET.length < 16) throw new Error('short'); }
catch { TOKEN_SECRET = randomBytes(32); writeFileSync(SECRET_PATH, TOKEN_SECRET, { mode: 0o600 }); }

// --- БД ---------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  -- Имена игроков: одна строка на игрока, алиас можно менять отдельно от забегов.
  CREATE TABLE IF NOT EXISTS players (
    player_id   TEXT PRIMARY KEY,
    telegram_id TEXT,
    alias       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  -- Забеги (append-only): доски «за неделю» и «за всё время» считаются отсюда.
  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   TEXT NOT NULL,
    score       INTEGER NOT NULL,
    distance    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_player ON runs(player_id, score DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_time ON runs(created_at);
  -- Heartbeat-сессии забегов: сервер наблюдает забег в реальном времени,
  -- финальный результат сверяется с последней живой отметкой.
  CREATE TABLE IF NOT EXISTS run_sessions (
    run_id        TEXT PRIMARY KEY,
    player_id     TEXT NOT NULL,
    started_at    INTEGER NOT NULL,
    last_beat_at  INTEGER NOT NULL,
    beats         INTEGER NOT NULL DEFAULT 0,
    last_score    INTEGER NOT NULL DEFAULT 0,
    last_distance INTEGER NOT NULL DEFAULT 0,
    used          INTEGER NOT NULL DEFAULT 0
  );
  -- Привязка Telegram: игрок отправляет боту код из игры → знаем chat_id,
  -- можем идентифицировать победителя и написать ему напрямую.
  CREATE TABLE IF NOT EXISTS telegram_links (
    player_id  TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL,
    username   TEXT,
    first_name TEXT,
    linked_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analytics_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event       TEXT NOT NULL,
    telegram_id TEXT,
    props_json  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_time ON analytics_events(created_at);
`);

// Колонка verified: 1 = забег наблюдался сервером через heartbeat-сессию.
try { db.exec('ALTER TABLE runs ADD COLUMN verified INTEGER NOT NULL DEFAULT 0'); } catch {}

// Миграция со старой схемы (leaderboard_entries: одна лучшая запись на игрока).
try {
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leaderboard_entries'").get();
  if (legacy && !db.prepare('SELECT 1 FROM runs LIMIT 1').get()) {
    db.exec(`
      INSERT INTO players(player_id, telegram_id, alias, updated_at)
        SELECT player_id, telegram_id, alias, created_at FROM leaderboard_entries
        WHERE player_id NOT IN (SELECT player_id FROM players);
      INSERT INTO runs(player_id, score, distance, created_at)
        SELECT player_id, score, distance, created_at FROM leaderboard_entries;
    `);
    console.log('migrated leaderboard_entries -> players/runs');
  }
} catch (error) { console.error('migration failed:', error); }

// --- Валидация (контракт совпадает с backend/worker.js) ----------------------
const EVENTS = new Set([
  'landing', 'game_start', 'game_over', 'share', 'share_result', 'cta_click',
  'mission_done', 'badge_unlock', 'rank_up', 'zone_reached', 'tutorial_step',
  'pause', 'settings_change', 'captcha_result', 'session_n', 'challenge_opened',
  'gag_shown', 'quality_tier', 'promo_copy',
]);
const MAX_SCORE = 1_000_000;
const MAX_DISTANCE = 1_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Анти-чит: границы правдоподобия. Скорость игры ≤ BOOST_SPEED 1750 px/с =
// 35 «м»/с (дистанция = px * 0.02) — с запасом 45. Очки/метр: метраж + биты +
// комбо + x2 + бонусы миссий; щедрый потолок, ловит только наглый curl.
const TOKEN_MIN_AGE_S = 8;
const TOKEN_MAX_AGE_S = 6 * 60 * 60;
const MAX_METERS_PER_SEC = 45;
const MAX_SCORE_PER_METER = 40;
const SCORE_BASE_ALLOWANCE = 1200;

function limit(value, max, fallback = 0) { return Math.max(0, Math.min(max, Math.floor(Number(value) || fallback))); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9:_-]{8,80}$/.test(value); }
function safeAlias(value) { return String(value || '').replace(/[<>]/g, '').trim().slice(0, 24); }

// --- Анти-чит токен: "ts.hmac(ts)" -------------------------------------------
function issueToken() {
  const ts = String(Date.now());
  return ts + '.' + createHmac('sha256', TOKEN_SECRET).update(ts).digest('hex');
}
// Возвращает возраст токена в секундах или null, если токен невалиден.
function tokenAge(token) {
  if (typeof token !== 'string') return null;
  const [ts, mac] = token.split('.');
  if (!/^\d{10,16}$/.test(ts || '') || !/^[0-9a-f]{64}$/.test(mac || '')) return null;
  const expected = createHmac('sha256', TOKEN_SECRET).update(ts).digest('hex');
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  const age = (Date.now() - Number(ts)) / 1000;
  return age >= TOKEN_MIN_AGE_S && age <= TOKEN_MAX_AGE_S ? age : null;
}

// --- Telegram initData (HMAC WebAppData → data-check-string) -----------------
function verifyTelegramInitData(raw, botToken) {
  if (!raw || !botToken) return null;
  try {
    const params = new URLSearchParams(raw);
    const receivedHash = params.get('hash') || '';
    const authDate = Number(params.get('auth_date') || 0);
    if (!receivedHash || !authDate || Math.abs(Date.now() / 1000 - authDate) > 86_400) return null;
    params.delete('hash');
    const dataCheck = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = createHmac('sha256', secret).update(dataCheck).digest('hex');
    const a = Buffer.from(computed); const b = Buffer.from(receivedHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const user = JSON.parse(params.get('user') || '{}');
    const id = String(user?.id || '');
    return /^\d{3,20}$/.test(id) ? { id } : null;
  } catch { return null; }
}

// --- Telegram-бот привязки (long polling — работает без HTTPS и вебхука) ------
// Игрок берёт код в игре, отправляет боту → сохраняем chat_id. Победителю потом
// можно написать напрямую (backend/notify-winners.mjs) и однозначно его опознать.
const linkCodes = new Map(); // code → { playerId, expires }
let botUsername = '';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих I/O/0/1
function makeLinkCode(playerId) {
  for (const [c, v] of linkCodes) if (v.expires < Date.now() || v.playerId === playerId) linkCodes.delete(c);
  const code = Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  linkCodes.set(code, { playerId, expires: Date.now() + 15 * 60 * 1000 });
  return code;
}

async function tgApi(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}),
  });
  return res.json();
}

async function pollBot() {
  try {
    const me = await tgApi('getMe');
    botUsername = me?.result?.username || '';
    console.log(`telegram bot: @${botUsername || '?'} (long polling)`);
  } catch (error) { console.error('bot getMe failed:', error); }
  let offset = 0;
  while (true) {
    try {
      const updates = await tgApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      for (const update of updates?.result || []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || !msg.chat?.id) continue;
        const match = msg.text.trim().match(/^\/start\s+([A-Za-z0-9]{6})$/) || msg.text.trim().match(/^([A-Za-z0-9]{6})$/);
        const code = match?.[1]?.toUpperCase();
        const entry = code ? linkCodes.get(code) : null;
        if (entry && entry.expires > Date.now()) {
          linkCodes.delete(code);
          qLinkUpsert.run(entry.playerId, String(msg.chat.id), msg.from?.username || '', msg.from?.first_name || '', Date.now());
          await tgApi('sendMessage', { chat_id: msg.chat.id, text: 'Готово! Telegram привязан к твоему профилю в ЮБуст Раннере ✈\nЕсли займёшь призовое место — напишем сюда.' });
        } else {
          await tgApi('sendMessage', { chat_id: msg.chat.id, text: 'Пришли 6-значный код из игры: экран «Прогресс» → «Telegram для призов».' });
        }
      }
    } catch { await new Promise((r) => setTimeout(r, 5000)); }
  }
}
if (BOT_TOKEN) pollBot();

// --- Rate limit по IP (в памяти, окно 60с) ------------------------------------
const rateBuckets = new Map();
function rateLimit(ip, max = 6) {
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `${bucket}:${ip}`;
  const count = (rateBuckets.get(key) || 0) + 1;
  rateBuckets.set(key, count);
  if (rateBuckets.size > 10_000) {
    for (const k of rateBuckets.keys()) if (!k.startsWith(`${bucket}:`)) rateBuckets.delete(k);
  }
  return count <= max;
}

// --- SQL ----------------------------------------------------------------------
// Доска = лучший забег каждого игрока за период; алиас — актуальный из players.
const qTop = db.prepare(`
  SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias,
         MAX(r.score) AS score, r.distance, r.verified, r.created_at AS createdAt,
         EXISTS(SELECT 1 FROM telegram_links t WHERE t.player_id = r.player_id) AS tg
  FROM runs r LEFT JOIN players p ON p.player_id = r.player_id
  WHERE r.created_at >= ?
  GROUP BY r.player_id
  ORDER BY score DESC, r.distance DESC, createdAt ASC
  LIMIT ?
`);
// Суммарная доска: весь пробег игрока за период (много коротких забегов ==
// честная заявка). Ранжируется по сумме дистанции («пробег»), затем по очкам.
const qTopTotal = db.prepare(`
  SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias,
         SUM(r.score) AS score, SUM(r.distance) AS distance, COUNT(*) AS runs,
         MAX(r.created_at) AS createdAt,
         EXISTS(SELECT 1 FROM telegram_links t WHERE t.player_id = r.player_id) AS tg
  FROM runs r LEFT JOIN players p ON p.player_id = r.player_id
  WHERE r.created_at >= ?
  GROUP BY r.player_id
  ORDER BY distance DESC, score DESC, createdAt ASC
  LIMIT ?
`);
const qRankTotal = db.prepare(`
  WITH sums AS (SELECT player_id, SUM(distance) AS dist, SUM(score) AS score FROM runs WHERE created_at >= ? GROUP BY player_id)
  SELECT
    (SELECT COUNT(*) + 1 FROM sums WHERE dist > (SELECT dist FROM sums WHERE player_id = ?)) AS rank,
    (SELECT dist FROM sums WHERE player_id = ?) AS distance,
    (SELECT score FROM sums WHERE player_id = ?) AS score,
    (SELECT COUNT(*) FROM sums) AS total
`);
const qRank = db.prepare(`
  WITH best AS (SELECT player_id, MAX(score) AS score FROM runs WHERE created_at >= ? GROUP BY player_id)
  SELECT
    (SELECT COUNT(*) + 1 FROM best WHERE score > (SELECT score FROM best WHERE player_id = ?)) AS rank,
    (SELECT score FROM best WHERE player_id = ?) AS score,
    (SELECT COUNT(*) FROM best) AS total
`);
const qReferrals = db.prepare(
  "SELECT COUNT(*) AS n FROM analytics_events WHERE event = 'landing' AND json_extract(props_json, '$.ref') = ?"
);
const qBest = db.prepare('SELECT MAX(score) AS best FROM runs');
const qOverview = db.prepare(`
  SELECT
    SUM(CASE WHEN event = 'game_over' THEN 1 ELSE 0 END) AS runs,
    SUM(CASE WHEN event = 'share' THEN 1 ELSE 0 END) AS shares,
    SUM(CASE WHEN event = 'cta_click' THEN 1 ELSE 0 END) AS cta,
    AVG(CASE WHEN event = 'game_over' THEN json_extract(props_json, '$.distance') END) AS avgDistance
  FROM analytics_events WHERE created_at >= ?
`);
const qInsertEvent = db.prepare('INSERT INTO analytics_events(event, telegram_id, props_json, created_at) VALUES (?, ?, ?, ?)');
const qInsertRun = db.prepare('INSERT INTO runs(player_id, score, distance, created_at, verified) VALUES (?, ?, ?, ?, ?)');
const qSessionStart = db.prepare('INSERT INTO run_sessions(run_id, player_id, started_at, last_beat_at) VALUES (?, ?, ?, ?)');
const qSessionGet = db.prepare('SELECT * FROM run_sessions WHERE run_id = ?');
const qSessionBeat = db.prepare('UPDATE run_sessions SET last_beat_at = ?, beats = beats + 1, last_score = ?, last_distance = ? WHERE run_id = ?');
const qSessionUse = db.prepare('UPDATE run_sessions SET used = 1 WHERE run_id = ?');
const qSessionPrune = db.prepare('DELETE FROM run_sessions WHERE started_at < ?');

// Правдоподобие приращения между отметками: дистанция ограничена временем,
// очки — дистанцией (+ разовые бонусы вроде капчи/near-miss).
function plausibleDelta(dScore, dDist, dtSec) {
  if (dScore < 0 || dDist < 0) return false;
  if (dDist > (dtSec + 2) * MAX_METERS_PER_SEC) return false;
  return dScore <= dDist * MAX_SCORE_PER_METER + 600;
}
const qUpsertPlayer = db.prepare(`
  INSERT INTO players(player_id, telegram_id, alias, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(player_id) DO UPDATE SET
    telegram_id = COALESCE(excluded.telegram_id, players.telegram_id),
    alias = CASE WHEN excluded.alias != '' THEN excluded.alias ELSE players.alias END,
    updated_at = excluded.updated_at
`);

const qLinkUpsert = db.prepare(`
  INSERT INTO telegram_links(player_id, chat_id, username, first_name, linked_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(player_id) DO UPDATE SET chat_id = excluded.chat_id, username = excluded.username, first_name = excluded.first_name, linked_at = excluded.linked_at
`);
const qLinkGet = db.prepare('SELECT chat_id, username, first_name FROM telegram_links WHERE player_id = ?');

function periodSince(period) { return period === 'all' ? 0 : Date.now() - WEEK_MS; }
function fallbackAlias(playerId) { return 'Игрок-' + String(playerId).slice(-4).toUpperCase(); }
function boardEntries(period, count = 10, board = 'best') {
  const q = board === 'total' ? qTopTotal : qTop;
  return q.all(periodSince(period), count).map((e) => ({ ...e, alias: e.alias || fallbackAlias(e.playerId) }));
}
function boardMe(period, playerId, board = 'best') {
  if (!validId(playerId)) return null;
  const referrals = Number(qReferrals.get(playerId)?.n) || 0;
  if (board === 'total') {
    const since = periodSince(period);
    const row = qRankTotal.get(since, playerId, playerId, playerId);
    if (row?.distance == null) return { rank: null, score: null, distance: null, total: Number(row?.total) || 0, referrals };
    return { rank: Number(row.rank), score: Number(row.score), distance: Number(row.distance), total: Number(row.total) || 0, referrals };
  }
  const row = qRank.get(periodSince(period), playerId, playerId);
  if (row?.score == null) return { rank: null, score: null, total: Number(row?.total) || 0, referrals };
  return { rank: Number(row.rank), score: Number(row.score), total: Number(row.total) || 0, referrals };
}

// --- HTTP-помощники ------------------------------------------------------------
function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((v) => v.trim()).filter(Boolean);
  const value = allowed.includes(origin) ? origin : '';
  return {
    ...(value ? { 'Access-Control-Allow-Origin': value, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
function json(res, value, status, headers) { res.writeHead(status, headers); res.end(JSON.stringify(value)); }
function readBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// --- Статика игры ---------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(STATIC_ROOT, rel);
  // Защита от выхода за корень и от раздачи бэкенда/служебных директорий.
  if (!filePath.startsWith(STATIC_ROOT + path.sep) && filePath !== STATIC_ROOT) { json(res, { error: 'not_found' }, 404, { 'Content-Type': 'application/json' }); return; }
  const relNorm = path.relative(STATIC_ROOT, filePath).split(path.sep)[0];
  if (['backend', 'node_modules', '.git', 'test', 'docs'].includes(relNorm)) { json(res, { error: 'not_found' }, 404, { 'Content-Type': 'application/json' }); return; }
  let target = filePath;
  try {
    if (statSync(target).isDirectory()) target = path.join(target, 'index.html');
    const stats = statSync(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(target).pipe(res);
  } catch {
    json(res, { error: 'not_found' }, 404, { 'Content-Type': 'application/json' });
  }
}

// --- Роутер ----------------------------------------------------------------------
async function handleApi(req, res, url) {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }

  if (req.method === 'GET' && url.pathname === '/v1/token') {
    json(res, { token: issueToken() }, 200, headers);
    return;
  }

  // Код привязки Telegram: игрок отправит его боту → узнаем chat_id.
  if (req.method === 'GET' && url.pathname === '/v1/link/code') {
    if (!BOT_TOKEN) { json(res, { error: 'bot_disabled' }, 503, headers); return; }
    if (!rateLimit('lc:' + clientIp(req), 10)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    const me = url.searchParams.get('me');
    if (!validId(me)) { json(res, { error: 'invalid_player' }, 400, headers); return; }
    json(res, { code: makeLinkCode(me), bot: botUsername }, 200, headers);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/link/status') {
    const me = url.searchParams.get('me');
    if (!validId(me)) { json(res, { error: 'invalid_player' }, 400, headers); return; }
    const row = qLinkGet.get(me);
    json(res, {
      enabled: !!BOT_TOKEN, bot: botUsername,
      linked: !!row,
      username: row?.username || '', firstName: row?.first_name || '',
    }, 200, headers);
    return;
  }

  // Старт heartbeat-сессии забега. Сервер наблюдает забег в реальном времени —
  // это делает подделку результата дорогой: нужно скриптовать всю сессию.
  if (req.method === 'POST' && url.pathname === '/v1/run/start') {
    if (!rateLimit('rs:' + clientIp(req), 12)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    if (!validId(body?.playerId)) { json(res, { error: 'invalid_player' }, 400, headers); return; }
    const runId = randomBytes(16).toString('hex');
    const now = Date.now();
    qSessionStart.run(runId, body.playerId, now, now);
    if (Math.random() < 0.05) qSessionPrune.run(now - 24 * 60 * 60 * 1000);
    json(res, { runId }, 200, headers);
    return;
  }

  // Живая отметка забега (клиент шлёт каждые ~5с): монотонность + темп.
  if (req.method === 'POST' && url.pathname === '/v1/run/beat') {
    if (!rateLimit('rb:' + clientIp(req), 60)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    const session = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? qSessionGet.get(body.runId) : null;
    if (!session || session.used) { json(res, { error: 'invalid_run' }, 404, headers); return; }
    const score = limit(body.score, MAX_SCORE);
    const distance = limit(body.distance, MAX_DISTANCE);
    const now = Date.now();
    const dt = (now - session.last_beat_at) / 1000;
    if (!plausibleDelta(score - session.last_score, distance - session.last_distance, dt)) {
      json(res, { error: 'implausible' }, 422, headers);
      return;
    }
    qSessionBeat.run(now, score, distance, body.runId);
    json(res, { ok: true }, 202, headers);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/leaderboard') {
    const period = url.searchParams.get('period') === 'all' ? 'all' : 'week';
    const board = url.searchParams.get('board') === 'total' ? 'total' : 'best';
    const count = limit(url.searchParams.get('limit'), 25, 10) || 10;
    const me = url.searchParams.get('me');
    json(res, { period, board, entries: boardEntries(period, count, board), me: me ? boardMe(period, me, board) : null }, 200, headers);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/dashboard') {
    const result = qOverview.get(Date.now() - WEEK_MS) || {};
    const top = qBest.get() || {};
    const runs = Number(result.runs) || 0;
    const cta = Number(result.cta) || 0;
    json(res, { overview: {
      best: Number(top.best) || 0, runs, shares: Number(result.shares) || 0,
      cta, avgDistance: Math.round(Number(result.avgDistance) || 0),
      conversion: runs ? Math.round((cta / runs) * 100) : 0,
    } }, 200, headers);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/events') {
    if (!rateLimit('ev:' + clientIp(req), 60)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    if (!EVENTS.has(body?.event)) { json(res, { error: 'invalid_event' }, 400, headers); return; }
    const props = body?.props && typeof body.props === 'object' ? body.props : {};
    const serialized = JSON.stringify(props);
    if (serialized.length > 1200 || /initData|telegram|userId|phone|email/i.test(serialized)) { json(res, { error: 'invalid_props' }, 400, headers); return; }
    let telegramId = null;
    if (body?.initData && BOT_TOKEN) {
      const telegram = verifyTelegramInitData(body.initData, BOT_TOKEN);
      if (!telegram) { json(res, { error: 'invalid_telegram_auth' }, 401, headers); return; }
      telegramId = telegram.id;
    }
    qInsertEvent.run(body.event, telegramId, serialized, Date.now());
    json(res, { ok: true }, 202, headers);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/scores') {
    if (!rateLimit('sc:' + clientIp(req), 6)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    // Аутентификация (по убыванию доверия): Telegram initData → heartbeat-сессия
    // забега (привязана к playerId и наблюдалась вживую) → анти-чит токен.
    const session = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? qSessionGet.get(body.runId) : null;
    let playerId = null; let telegramId = null; let age = null;
    const telegram = BOT_TOKEN ? verifyTelegramInitData(body?.initData, BOT_TOKEN) : null;
    if (telegram) { playerId = `tg:${telegram.id}`; telegramId = telegram.id; }
    else if (validId(body?.playerId)) {
      if (session && !session.used && session.player_id === body.playerId) playerId = body.playerId;
      else {
        age = tokenAge(body?.token);
        if (age == null) { json(res, { error: 'token_required' }, 401, headers); return; }
        playerId = body.playerId;
      }
    }
    if (!playerId) { json(res, { error: 'auth_required' }, 401, headers); return; }
    const score = limit(body.score, MAX_SCORE);
    const distance = limit(body.distance, MAX_DISTANCE);
    if (score < 1 || distance < 1) { json(res, { error: 'invalid_score' }, 400, headers); return; }
    // Правдоподобие: дистанция ограничена временем забега, очки — дистанцией.
    if (age != null && distance > age * MAX_METERS_PER_SEC) { json(res, { error: 'implausible' }, 422, headers); return; }
    if (score > SCORE_BASE_ALLOWANCE + distance * MAX_SCORE_PER_METER) { json(res, { error: 'implausible' }, 422, headers); return; }
    const now = Date.now();
    // Верификация: финал сверяется с последней живой отметкой heartbeat-сессии.
    // Забег без сессии принимается (казуальная доска), но verified=0 — для
    // призов считаются только наблюдавшиеся сервером результаты.
    let verified = 0;
    if (session && !session.used && session.player_id === playerId) {
      const runAge = (now - session.started_at) / 1000;
      const expectedBeats = Math.max(1, Math.floor(runAge / 10) - 1); // клиент бьётся каждые ~5с, терпим потери
      const finalOk = plausibleDelta(score - session.last_score, distance - session.last_distance, (now - session.last_beat_at) / 1000 + 6);
      if (runAge >= TOKEN_MIN_AGE_S && session.beats >= expectedBeats && finalOk) verified = 1;
      qSessionUse.run(body.runId);
    }
    const alias = safeAlias(body.alias) || (telegramId ? `Игрок-${telegramId.slice(-4)}` : '');
    qUpsertPlayer.run(playerId, telegramId, alias, now);
    qInsertRun.run(playerId, score, distance, now, verified);
    json(res, { period: 'week', board: 'best', entries: boardEntries('week', 10), me: boardMe('week', playerId) }, 200, headers);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/alias') {
    if (!rateLimit('al:' + clientIp(req), 10)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    let playerId = null; let telegramId = null;
    const telegram = BOT_TOKEN ? verifyTelegramInitData(body?.initData, BOT_TOKEN) : null;
    if (telegram) { playerId = `tg:${telegram.id}`; telegramId = telegram.id; }
    else if (validId(body?.playerId)) playerId = body.playerId;
    if (!playerId) { json(res, { error: 'auth_required' }, 401, headers); return; }
    const alias = safeAlias(body.alias);
    if (!alias) { json(res, { error: 'invalid_alias' }, 400, headers); return; }
    qUpsertPlayer.run(playerId, telegramId, alias, Date.now());
    json(res, { ok: true, alias }, 200, headers);
    return;
  }

  json(res, { error: 'not_found' }, 404, headers);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/v1/')) { await handleApi(req, res, url); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, { error: 'method_not_allowed' }, 405, { 'Content-Type': 'application/json' }); return; }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('request failed:', error);
    if (!res.headersSent) json(res, { error: 'internal' }, 500, { 'Content-Type': 'application/json' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`uboost-runner: http://0.0.0.0:${PORT} (static: ${STATIC_ROOT}, db: ${DB_PATH})`);
});
