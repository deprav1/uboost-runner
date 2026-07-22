// ============================================================================
//  ЮБуст Раннер — Node-сервер для VPS: статика игры + API доски результатов.
//  Порт backend/worker.js (Cloudflare) на node:http + node:sqlite, без npm-
//  зависимостей. Запуск: node backend/server.js (Node >= 22.13, лучше 24).
//
//  API:
//    GET  /v1/token                 — анти-чит токен забега (HMAC + timestamp)
//    GET  /v1/leaderboard?period=week|all&me=<playerId> — топ + твой ранг/рефералы
//    GET  /v1/dashboard             — сводные метрики за 7 дней
//    GET  /v1/link/status?me=<id>   — включён ли бот и опознан ли игрок
//    POST /v1/run/start + /v1/run/beat — heartbeat-сессия забега (даёт verified=1)
//    POST /v1/scores                — результат забега (нужен токен или initData)
//    POST /v1/alias                 — смена имени на доске
//    POST /v1/events                — аналитика
//
//  Игра — Telegram Mini App: игрок опознаётся подписанным initData и сам
//  регистрируется для призов на /v1/scores. Кода привязки нет (был удалён —
//  он нужен был только браузерной версии, где initData взять неоткуда).
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
//    BOT_ADMIN_IDS   — Telegram chat_id администраторов через запятую;
//                      только им доступны /admin и контакты победителей.
//    RULESET_VERSION — версия баланса для новых забегов.
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
const BOT_ADMIN_IDS = new Set((process.env.BOT_ADMIN_IDS || '').split(',').map((v) => v.trim()).filter(Boolean));
const RULESET_VERSION = process.env.RULESET_VERSION || '2026-07-17-v2';
const ANALYTICS_RETENTION_DAYS = Math.max(7, Number(process.env.ANALYTICS_RETENTION_DAYS) || 90);

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
    run_id      TEXT,
    player_id   TEXT NOT NULL,
    score       INTEGER NOT NULL,
    distance    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    verified    INTEGER NOT NULL DEFAULT 0,
    verification_reason TEXT NOT NULL DEFAULT 'legacy',
    ruleset_version TEXT NOT NULL DEFAULT 'legacy'
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
    event_id    TEXT,
    session_id  TEXT,
    run_id      TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,
    event       TEXT NOT NULL,
    telegram_id TEXT,
    props_json  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_time ON analytics_events(created_at);
`);

// Колонка verified: 1 = забег наблюдался сервером через heartbeat-сессию.
try { db.exec('ALTER TABLE runs ADD COLUMN verified INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE runs ADD COLUMN run_id TEXT'); } catch {}
try { db.exec("ALTER TABLE runs ADD COLUMN verification_reason TEXT NOT NULL DEFAULT 'legacy'"); } catch {}
try { db.exec("ALTER TABLE runs ADD COLUMN ruleset_version TEXT NOT NULL DEFAULT 'legacy'"); } catch {}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id) WHERE run_id IS NOT NULL');
try { db.exec('ALTER TABLE analytics_events ADD COLUMN event_id TEXT'); } catch {}
try { db.exec('ALTER TABLE analytics_events ADD COLUMN session_id TEXT'); } catch {}
try { db.exec('ALTER TABLE analytics_events ADD COLUMN run_id TEXT'); } catch {}
try { db.exec('ALTER TABLE analytics_events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1'); } catch {}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON analytics_events(event_id) WHERE event_id IS NOT NULL');

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
  'gag_shown', 'quality_tier', 'promo_copy', 'run_summary', 'client_error',
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
// Очки набегают с КОЛОНН, а колонны приходят по времени (colSpacing / speed),
// поэтому потолок очков — временной, а не «за метр». Физический максимум:
// одна колонна при X2 и комбо 8 даёт 800 очков (near-miss 25*8*2 + биты
// 4*15*3*2 + dodge 10*2*2), а колонны идут не чаще REACT_TIME=0.42с =>
// ~1905 очк/с. Берём 2000 с запасом. Это и есть честный анти-чит: больше
// физически возможного не начислить, а время подделать нельзя — его
// наблюдает heartbeat-сессия.
const MAX_SCORE_PER_SEC = 2000;
// Только для сквозного потолка (не для дельт): 121 очк/м — физический максимум
// при X2+комбо на минимальном интервале колонн. Было 40 — реальный забег на
// 35 очк/м подходил к порогу на 79%, и сильный игрок ловил бы 422 на ровном месте.
const MAX_SCORE_PER_METER = 130;
const SCORE_BASE_ALLOWANCE = 1200;
// Разовые бонусы, которые начисляются УЖЕ ПОСЛЕ последней heartbeat-отметки и
// не сопровождаются пробегом: бонус миссий (3 лучшие из CONFIG.MISSIONS =
// 200+150+150 = 500) + CONFIG.SCORE_CAPTCHA_SOLVE (350). Дистанция при этом не
// растёт (в капче она вообще заморожена), поэтому обычный лимит
// dDist*40 + 600 честный забег не проходил. Допуск дают ТОЛЬКО финальной
// сверке и ровно один раз за забег; сквозной потолок
// score <= SCORE_BASE_ALLOWANCE + distance*40 продолжает действовать.
const END_BONUS_ALLOWANCE = 900;

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
    if (!/^\d{3,20}$/.test(id)) return null;
    // username/first_name отдаём наружу для авто-регистрации призёров: initData
    // подписан, значит эти поля так же достоверны, как и сам id.
    return { id, username: String(user?.username || ''), firstName: String(user?.first_name || '') };
  } catch { return null; }
}

// --- Telegram-бот (long polling — работает без вебхука) -----------------------
// Игра живёт как Mini App внутри Telegram, поэтому игрок опознаётся подписанным
// initData прямо на /v1/scores и регистрируется для призов сам. Кода привязки
// больше нет: он существовал только ради браузерной версии, где initData
// взять неоткуда.
let botUsername = '';
let botLastPollAt = 0;
let botLastErrorLogAt = 0;

async function tgApi(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}),
  });
  return res.json();
}

// Ссылка на игру и промокод для ответов бота. Промо парсится из config.js —
// единый источник (CONFIG.PROMO) не дублируется руками в двух местах.
const GAME_URL_BOT = process.env.GAME_URL || 'https://uboost.31-130-148-55.sslip.io/';
function readPromo() {
  try {
    const cfg = readFileSync(path.join(STATIC_ROOT, 'config.js'), 'utf8');
    const m = cfg.match(/PROMO:\s*\{\s*code:\s*'([^']*)'\s*,\s*percent:\s*(\d+)/);
    return m?.[1] ? { code: m[1], percent: Number(m[2]) || 0 } : null;
  } catch { return null; }
}
const BOT_PROMO = readPromo();

function botBoardLines(board, count = 5) {
  const medals = ['🥇', '🥈', '🥉'];
  return boardEntries('week', count, board).map((e, i) =>
    `${medals[i] || (i + 1) + '.'} ${e.alias} — ${board === 'total' ? `${e.distance} м (${e.runs} заб.)` : `${e.score} очков`}`
  ).join('\n');
}

function adminContactLines(count = 5) {
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT r.player_id, r.score, r.distance, r.created_at,
             ROW_NUMBER() OVER (
               PARTITION BY r.player_id
               ORDER BY r.score DESC, r.distance DESC, r.created_at ASC
             ) AS place_for_player
      FROM runs r
      WHERE r.created_at >= ? AND r.verified = 1 AND r.ruleset_version = ?
    )
    SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias,
           r.score, l.username, l.chat_id AS chatId
    FROM ranked r
    LEFT JOIN players p ON p.player_id = r.player_id
    LEFT JOIN telegram_links l ON l.player_id = r.player_id
    WHERE r.place_for_player = 1
    ORDER BY r.score DESC, r.distance DESC, r.created_at ASC
    LIMIT ?
  `).all(Date.now() - WEEK_MS, RULESET_VERSION, count);
  return rows.map((row, i) => {
    const contact = row.username ? `@${row.username}` : row.chatId ? `Telegram ID: ${row.chatId}` : 'контакт не зарегистрирован';
    return `${i + 1}. ${row.alias || fallbackAlias(row.playerId)} — ${row.score} очков — ${contact}`;
  }).join('\n');
}

// Ответ бота на входящее сообщение. Возвращает текст (или null — молчим).
function botReply(msg) {
  const text = (msg.text || '').trim();
  const chatId = String(msg.chat.id);
  const admin = BOT_ADMIN_IDS.has(chatId);

  if (/^\/start/.test(text)) {
    return 'Привет! Я бот ЮБуст Раннера 🚀\n\n'
      + 'Жми кнопку «Играть» внизу — забег сразу считается в призах, ничего привязывать не надо.\n\n'
      + 'Команды:\n/top — топ недели\n/me — моё место\n/promo — промокод на ЮБуст'
      + (admin ? '\n/admin — контакты лидеров недели' : '');
  }

  if (/^\/id(?:@\w+)?(?:\s|$)/i.test(text)) {
    return `Твой Telegram ID: ${chatId}`;
  }

  if (/^\/(admin|contacts|winners)(?:@\w+)?(?:\s|$)/i.test(text)) {
    if (!admin) return 'Команда доступна только администратору.';
    const contacts = adminContactLines(5);
    return '🔐 Топ-5 подтверждённых лидеров недели:\n'
      + (contacts || 'Подтверждённых результатов пока нет.');
  }

  if (/^\/top/.test(text)) {
    const best = botBoardLines('best');
    const total = botBoardLines('total', 3);
    return '🏆 Рекорды недели:\n' + (best || 'пока пусто')
      + '\n\n🛣 Суммарный пробег недели:\n' + (total || 'пока пусто')
      + `\n\nОбойди их: ${GAME_URL_BOT}`;
  }

  if (/^\/me/.test(text)) {
    const link = qLinkByChat.get(chatId);
    // Профиль появляется сам после первого забега из Mini App — привязывать нечего.
    if (!link) return 'Пока не вижу твоих забегов. Жми кнопку «Играть» внизу и сыграй — профиль заведётся сам.';
    const best = boardMe('week', link.player_id);
    const total = boardMe('week', link.player_id, 'total');
    if (!best?.rank && !total?.rank) return `Пока нет забегов на этой неделе. Исправь это: ${GAME_URL_BOT}`;
    return '📊 Твоя неделя:\n'
      + (best?.rank ? `Рекорд: #${best.rank} из ${best.total} (${best.score} очков)\n` : '')
      + (total?.rank ? `Пробег: #${total.rank} из ${total.total} (${total.distance} м)\n` : '')
      + (best?.referrals ? `Друзей привёл: ${best.referrals}\n` : '')
      + `\nУлучшить: ${GAME_URL_BOT}`;
  }

  if (/^\/promo/.test(text)) {
    return BOT_PROMO?.code
      ? `🎁 Промокод на ЮБуст: ${BOT_PROMO.code} (−${BOT_PROMO.percent}%)`
      : 'Промокод сейчас не активен.';
  }

  return 'Не понял 🤖 Доступные команды: /top /me /promo /id';
}

async function pollBot() {
  // getMe с повторами: без username бота ссылки t.me/... в игре были бы битые.
  while (!botUsername) {
    try {
      const me = await tgApi('getMe');
      botUsername = me?.result?.username || '';
      if (botUsername) botLastPollAt = Date.now();
    } catch {}
    if (!botUsername) await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log(`telegram bot: @${botUsername} (long polling)`);
  let offset = 0;
  while (true) {
    try {
      const updates = await tgApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      botLastPollAt = Date.now();
      for (const update of updates?.result || []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || !msg.chat?.id) continue;
        const reply = botReply(msg);
        if (reply) await tgApi('sendMessage', { chat_id: msg.chat.id, text: reply });
      }
    } catch (error) {
      if (Date.now() - botLastErrorLogAt > 60_000) {
        console.warn('telegram polling failed:', error?.message || error);
        botLastErrorLogAt = Date.now();
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
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
  WHERE r.created_at >= ? AND r.verified = 1 AND r.ruleset_version = ?
  GROUP BY r.player_id
  ORDER BY score DESC, r.distance DESC, createdAt ASC
  LIMIT ?
`);
// Суммарная доска: весь пробег игрока за период (много коротких забегов ==
// честная заявка). Ранжируется по сумме дистанции («пробег»), затем по очкам.
// verified здесь = «ВЕСЬ пробег наблюдался сервером» (MIN по забегам), потому
// что призы по этой доске (notify-winners --board total) суммируют только
// verified=1: один ненаблюдавшийся забег в сумме уже делает заявку неполной.
const qTopTotal = db.prepare(`
  SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias,
         SUM(r.score) AS score, SUM(r.distance) AS distance, COUNT(*) AS runs,
         MIN(r.verified) AS verified,
         MAX(r.created_at) AS createdAt,
         EXISTS(SELECT 1 FROM telegram_links t WHERE t.player_id = r.player_id) AS tg
  FROM runs r LEFT JOIN players p ON p.player_id = r.player_id
  WHERE r.created_at >= ? AND r.verified = 1 AND r.ruleset_version = ?
  GROUP BY r.player_id
  ORDER BY distance DESC, score DESC, createdAt ASC
  LIMIT ?
`);
const qRankTotal = db.prepare(`
  WITH sums AS (SELECT player_id, SUM(distance) AS dist, SUM(score) AS score FROM runs WHERE created_at >= ? AND verified = 1 AND ruleset_version = ? GROUP BY player_id)
  SELECT
    (SELECT COUNT(*) + 1 FROM sums WHERE dist > (SELECT dist FROM sums WHERE player_id = ?)) AS rank,
    (SELECT dist FROM sums WHERE player_id = ?) AS distance,
    (SELECT score FROM sums WHERE player_id = ?) AS score,
    (SELECT COUNT(*) FROM sums) AS total
`);
const qRank = db.prepare(`
  WITH best AS (SELECT player_id, MAX(score) AS score FROM runs WHERE created_at >= ? AND verified = 1 AND ruleset_version = ? GROUP BY player_id)
  SELECT
    (SELECT COUNT(*) + 1 FROM best WHERE score > (SELECT score FROM best WHERE player_id = ?)) AS rank,
    (SELECT score FROM best WHERE player_id = ?) AS score,
    (SELECT COUNT(*) FROM best) AS total
`);
const qReferrals = db.prepare(
  "SELECT COUNT(*) AS n FROM analytics_events WHERE event = 'landing' AND json_extract(props_json, '$.ref') = ?"
);
const qBest = db.prepare('SELECT MAX(score) AS best FROM runs WHERE verified = 1 AND ruleset_version = ?');
const qOverview = db.prepare(`
  SELECT
    SUM(CASE WHEN event = 'game_over' THEN 1 ELSE 0 END) AS runs,
    SUM(CASE WHEN event = 'share' THEN 1 ELSE 0 END) AS shares,
    SUM(CASE WHEN event = 'cta_click' THEN 1 ELSE 0 END) AS cta,
    AVG(CASE WHEN event = 'game_over' THEN json_extract(props_json, '$.distance') END) AS avgDistance
  FROM analytics_events WHERE created_at >= ?
`);
const qInsertEvent = db.prepare(`
  INSERT OR IGNORE INTO analytics_events(event_id, session_id, run_id, schema_version, event, telegram_id, props_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const qPruneEvents = db.prepare('DELETE FROM analytics_events WHERE created_at < ?');
const qInsertRun = db.prepare(`
  INSERT INTO runs(run_id, player_id, score, distance, created_at, verified, verification_reason, ruleset_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const qRunById = db.prepare('SELECT player_id AS playerId FROM runs WHERE run_id = ?');
const qSessionStart = db.prepare('INSERT INTO run_sessions(run_id, player_id, started_at, last_beat_at) VALUES (?, ?, ?, ?)');
const qSessionGet = db.prepare('SELECT * FROM run_sessions WHERE run_id = ?');
const qSessionBeat = db.prepare('UPDATE run_sessions SET last_beat_at = ?, beats = beats + 1, last_score = ?, last_distance = ? WHERE run_id = ?');
const qSessionUse = db.prepare('UPDATE run_sessions SET used = 1 WHERE run_id = ?');
const qSessionPrune = db.prepare('DELETE FROM run_sessions WHERE started_at < ?');

// Правдоподобие приращения между отметками: и дистанция, и очки ограничены
// ВРЕМЕНЕМ. Раньше очки ограничивались дистанцией (dDist*40+600) — это была
// неверная модель: очки идут с колонн, а не с метров, и всплеск X2+комбо
// законно даёт до 121 очк/м. Живой забег tg:41515897 (+5021 очка за 68 м в
// хвосте, вдвое НИЖЕ физического потолка) из-за этого терял verified и приз.
// extra — допуск для финальной сверки (END_BONUS_ALLOWANCE); на обычных
// отметках он 0.
function plausibleDelta(dScore, dDist, dtSec, extra = 0) {
  if (dScore < 0 || dDist < 0) return false;
  if (dDist > (dtSec + 2) * MAX_METERS_PER_SEC) return false;
  return dScore <= (dtSec + 2) * MAX_SCORE_PER_SEC + extra;
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
const qLinkByChat = db.prepare('SELECT player_id FROM telegram_links WHERE chat_id = ? ORDER BY linked_at DESC LIMIT 1');

function periodSince(period) { return period === 'all' ? 0 : Date.now() - WEEK_MS; }
function fallbackAlias(playerId) { return 'Игрок-' + String(playerId).slice(-4).toUpperCase(); }
function boardEntries(period, count = 10, board = 'best') {
  const q = board === 'total' ? qTopTotal : qTop;
  return q.all(periodSince(period), RULESET_VERSION, count).map((e) => ({ ...e, alias: e.alias || fallbackAlias(e.playerId) }));
}
function boardMe(period, playerId, board = 'best') {
  if (!validId(playerId)) return null;
  const referrals = Number(qReferrals.get(playerId)?.n) || 0;
  if (board === 'total') {
    const since = periodSince(period);
    const row = qRankTotal.get(since, RULESET_VERSION, playerId, playerId, playerId);
    if (row?.distance == null) return { rank: null, score: null, distance: null, total: Number(row?.total) || 0, referrals };
    return { rank: Number(row.rank), score: Number(row.score), distance: Number(row.distance), total: Number(row.total) || 0, referrals };
  }
  const row = qRank.get(periodSince(period), RULESET_VERSION, playerId, playerId);
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
    const etag = `W/"${stats.size}-${Math.floor(stats.mtimeMs)}"`;
    // Бинарные ассеты (спрайты/шрифты/видео) меняются редко — кэш на неделю;
    // js/css — 5 минут (обновляются деплоем); html — всегда свежий.
    const longCache = ['.png', '.jpg', '.webp', '.woff2', '.mp4', '.webm', '.svg', '.ico'].includes(ext);
    const staticHeaders = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : longCache ? 'public, max-age=604800' : 'public, max-age=300',
      ETag: etag,
      'Last-Modified': stats.mtime.toUTCString(),
    };
    if (req.headers['if-none-match'] === etag) {
      delete staticHeaders['Content-Length'];
      res.writeHead(304, staticHeaders); res.end(); return;
    }
    res.writeHead(200, staticHeaders);
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

  if (req.method === 'GET' && url.pathname === '/v1/health') {
    let database = true;
    try { db.prepare('SELECT 1').get(); } catch { database = false; }
    const botHealthy = !BOT_TOKEN || (botLastPollAt > 0 && Date.now() - botLastPollAt < 120_000);
    json(res, {
      ok: database && botHealthy,
      rulesetVersion: RULESET_VERSION,
      uptimeSec: Math.floor(process.uptime()),
      database,
      bot: { enabled: !!BOT_TOKEN, username: botUsername, polling: botHealthy },
    }, database && botHealthy ? 200 : 503, headers);
    return;
  }

  // /v1/link/code удалён: игрок опознаётся подписанным initData из Mini App и
  // регистрируется на /v1/scores сам. Кода привязки больше не существует.
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
    const requestedRunId = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? body.runId : '';
    const runId = requestedRunId || randomBytes(16).toString('hex');
    const now = Date.now();
    try { qSessionStart.run(runId, body.playerId, now, now); }
    catch { json(res, { error: 'run_exists' }, 409, headers); return; }
    if (Math.random() < 0.05) qSessionPrune.run(now - 24 * 60 * 60 * 1000);
    json(res, { runId }, 200, headers);
    return;
  }

  // Живая отметка забега (клиент шлёт каждые ~5с): монотонность + темп.
  if (req.method === 'POST' && url.pathname === '/v1/run/beat') {
    if (!rateLimit('rb:' + clientIp(req), 60)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    const runId = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? body.runId : '';
    const session = runId ? qSessionGet.get(runId) : null;
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
    const top = qBest.get(RULESET_VERSION) || {};
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
    const eventId = validId(props.eventId) ? String(props.eventId) : null;
    const sessionId = validId(props.sessionId) ? String(props.sessionId) : null;
    const runId = typeof props.runId === 'string' && /^[0-9a-f]{32}$/.test(props.runId) ? props.runId : null;
    const schemaVersion = limit(props.schemaVersion, 10, 1) || 1;
    let telegramId = null;
    if (body?.initData && BOT_TOKEN) {
      const telegram = verifyTelegramInitData(body.initData, BOT_TOKEN);
      if (!telegram) { json(res, { error: 'invalid_telegram_auth' }, 401, headers); return; }
      telegramId = telegram.id;
    }
    qInsertEvent.run(eventId, sessionId, runId, schemaVersion, body.event, telegramId, serialized, Date.now());
    json(res, { ok: true }, 202, headers);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/scores') {
    if (!rateLimit('sc:' + clientIp(req), 6)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    // Аутентификация (по убыванию доверия): Telegram initData → heartbeat-сессия
    // забега (привязана к playerId и наблюдалась вживую) → анти-чит токен.
    const runId = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? body.runId : '';
    const savedRun = runId ? qRunById.get(runId) : null;
    if (savedRun) {
      if (!validId(body?.playerId) || savedRun.playerId !== body.playerId) {
        json(res, { error: 'run_owner_mismatch' }, 409, headers); return;
      }
      json(res, {
        period: 'week', board: 'best', duplicate: true,
        entries: boardEntries('week', 25), me: boardMe('week', savedRun.playerId),
      }, 200, headers);
      return;
    }
    const session = runId ? qSessionGet.get(runId) : null;
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
    let verificationReason = session ? 'heartbeat_incomplete' : 'no_session';
    if (session && !session.used && session.player_id === playerId) {
      const runAge = (now - session.started_at) / 1000;
      const expectedBeats = Math.max(1, Math.floor(runAge / 10) - 1); // клиент бьётся каждые ~5с, терпим потери
      const finalOk = plausibleDelta(score - session.last_score, distance - session.last_distance, (now - session.last_beat_at) / 1000 + 6, END_BONUS_ALLOWANCE);
      if (runAge < TOKEN_MIN_AGE_S) verificationReason = 'run_too_short';
      else if (session.beats < expectedBeats) verificationReason = 'heartbeat_missing';
      else if (!finalOk) verificationReason = 'final_delta';
      else { verified = 1; verificationReason = 'verified'; }
      qSessionUse.run(runId);
    } else if (session?.used) {
      verificationReason = 'session_used';
    } else if (session && session.player_id !== playerId) {
      verificationReason = 'session_owner_mismatch';
    }
    const alias = safeAlias(body.alias) || (telegramId ? `Игрок-${telegramId.slice(-4)}` : '');
    const rulesetVersion = typeof body?.rulesetVersion === 'string' && /^[a-zA-Z0-9._:-]{1,40}$/.test(body.rulesetVersion)
      ? body.rulesetVersion : RULESET_VERSION;
    qUpsertPlayer.run(playerId, telegramId, alias, now);
    qInsertRun.run(runId || null, playerId, score, distance, now, verified, verificationReason, rulesetVersion);
    // Авто-регистрация призёра: игра открыта как Mini App, initData подписан —
    // значит игрок уже опознан, и код привязки ему не нужен. В личке с ботом
    // chat_id == user id, поэтому notify-winners сможет написать ему сразу.
    // ВАЖНО: сама запись НЕ гарантирует доставку — бот не может написать первым
    // тому, кто не нажимал /start (Telegram вернёт 403). Открывшие игру через
    // кнопку бота /start уже нажали; пришедшие по прямой ссылке на Mini App —
    // нет. Поэтому цепочка не рвётся молча: notify-winners печатает ошибку по
    // каждому недоставленному призу.
    if (telegram) qLinkUpsert.run(playerId, telegram.id, telegram.username, telegram.firstName, now);
    json(res, {
      period: 'week', board: 'best', verified: !!verified, verificationReason,
      entries: boardEntries('week', 25), me: boardMe('week', playerId),
    }, 200, headers);
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

// WAL-checkpoint раз в час: иначе -wal файл растёт бесконтрольно (авто-чекпоинт
// SQLite не срезает файл, TRUNCATE — срезает).
setInterval(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {} }, 60 * 60 * 1000).unref();
setInterval(() => {
  try { qPruneEvents.run(Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000); } catch {}
}, 24 * 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`uboost-runner: http://0.0.0.0:${PORT} (static: ${STATIC_ROOT}, db: ${DB_PATH})`);
});
