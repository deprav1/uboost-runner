// ============================================================================
//  ЮБуст Раннер — Node-сервер для VPS: статика игры + API доски результатов.
//  Порт backend/worker.js (Cloudflare) на node:http + node:sqlite, без npm-
//  зависимостей. Запуск: node backend/server.js (Node >= 22.13, лучше 24).
//
//  API:
//    GET  /v1/token                 — анти-чит токен забега (HMAC + timestamp)
//    GET  /v1/leaderboard?period=week|all&me=<publicId> — топ + твой ранг/рефералы
//    GET  /v1/dashboard             — сводные метрики за 7 дней
//    POST /v1/player/session        — защищённая сессия игрока + анонимный publicId
//    POST /v1/link/status           — включён ли бот и опознан ли текущий игрок
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
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 80;
const HOST = process.env.HOST || '127.0.0.1';
const STATIC_ROOT = path.resolve(process.env.STATIC_ROOT || path.join(__dirname, '..'));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'data', 'uboost.db'));
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const TELEGRAM_IP_FAMILY = [4, 6].includes(Number(process.env.TELEGRAM_IP_FAMILY))
  ? Number(process.env.TELEGRAM_IP_FAMILY) : 0;
const BOT_ADMIN_IDS = new Set((process.env.BOT_ADMIN_IDS || '').split(',').map((v) => v.trim()).filter(Boolean));
const RULESET_VERSION = process.env.RULESET_VERSION || '2026-08-04-v1';
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
    updated_at  INTEGER NOT NULL,
    public_id   TEXT,
    auth_hash   TEXT
  );
  -- Забеги (append-only): доски «за неделю» и «за всё время» считаются отсюда.
  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT,
    player_id   TEXT NOT NULL,
    score       INTEGER NOT NULL,
    distance    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    started_at  INTEGER,
    ended_at    INTEGER,
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
    ruleset_version TEXT NOT NULL DEFAULT 'legacy',
    started_at    INTEGER NOT NULL,
    last_beat_at  INTEGER NOT NULL,
    beats         INTEGER NOT NULL DEFAULT 0,
    last_score    INTEGER NOT NULL DEFAULT 0,
    last_distance INTEGER NOT NULL DEFAULT 0,
    last_seq      INTEGER NOT NULL DEFAULT 0,
    covered_ms    INTEGER NOT NULL DEFAULT 0,
    used          INTEGER NOT NULL DEFAULT 0,
    invalid_reason TEXT NOT NULL DEFAULT ''
  );
  -- Неизменяемый журнал heartbeat-попыток нужен для проверки лидеров после
  -- выбора произвольного конкурсного периода. accepted=0 сохраняет и отказы.
  CREATE TABLE IF NOT EXISTS run_beats (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id         TEXT NOT NULL,
    beat_seq       INTEGER NOT NULL DEFAULT 0,
    observed_at    INTEGER NOT NULL,
    score          INTEGER NOT NULL,
    distance       INTEGER NOT NULL,
    delta_ms       INTEGER NOT NULL,
    delta_score    INTEGER NOT NULL,
    delta_distance INTEGER NOT NULL,
    accepted       INTEGER NOT NULL,
    reason         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_run_beats_run ON run_beats(run_id, observed_at);
  -- Привязка Telegram: игрок отправляет боту код из игры → знаем chat_id,
  -- можем идентифицировать победителя и написать ему напрямую.
  CREATE TABLE IF NOT EXISTS telegram_links (
    player_id  TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL,
    username   TEXT,
    first_name TEXT,
    linked_at  INTEGER NOT NULL
  );
  -- Журнал админских рассылок: не поздравить одного человека дважды в рамках
  -- одной кампании (идемпотентность) + аудит, кому и когда ушло сообщение.
  CREATE TABLE IF NOT EXISTS notifications_sent (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  TEXT NOT NULL,
    chat_id    TEXT NOT NULL,
    campaign   TEXT NOT NULL,
    sent_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notify_campaign ON notifications_sent(campaign, player_id);
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
try { db.exec('ALTER TABLE runs ADD COLUMN started_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE runs ADD COLUMN ended_at INTEGER'); } catch {}
// Старые версии не сохраняли границы забега. Для исторического пересчёта
// используем created_at как безопасную оценку обеих границ, не теряя verified
// результаты из новых датированных выборок.
db.exec('UPDATE runs SET started_at = COALESCE(started_at, created_at), ended_at = COALESCE(ended_at, created_at) WHERE started_at IS NULL OR ended_at IS NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id) WHERE run_id IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_runs_contest_period ON runs(ruleset_version, verified, started_at, ended_at, player_id)');
try { db.exec("ALTER TABLE run_sessions ADD COLUMN ruleset_version TEXT NOT NULL DEFAULT 'legacy'"); } catch {}
try { db.exec("ALTER TABLE run_sessions ADD COLUMN invalid_reason TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec('ALTER TABLE run_sessions ADD COLUMN covered_ms INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE run_sessions ADD COLUMN last_seq INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE run_beats ADD COLUMN beat_seq INTEGER NOT NULL DEFAULT 0'); } catch {}
// Старые версии допускали несколько активных сессий. Перед уникальным индексом
// оставляем только самую новую, не удаляя историю.
db.exec(`
  UPDATE run_sessions AS older
  SET used = 1, invalid_reason = 'migration_superseded'
  WHERE used = 0 AND EXISTS (
    SELECT 1 FROM run_sessions AS newer
    WHERE newer.player_id = older.player_id AND newer.used = 0
      AND (newer.started_at > older.started_at
        OR (newer.started_at = older.started_at AND newer.run_id > older.run_id))
  )
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_run_sessions_one_active ON run_sessions(player_id) WHERE used = 0');
try { db.exec('ALTER TABLE analytics_events ADD COLUMN event_id TEXT'); } catch {}
try { db.exec('ALTER TABLE analytics_events ADD COLUMN session_id TEXT'); } catch {}
try { db.exec('ALTER TABLE analytics_events ADD COLUMN run_id TEXT'); } catch {}
try { db.exec('ALTER TABLE analytics_events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1'); } catch {}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_id ON analytics_events(event_id) WHERE event_id IS NOT NULL');
try { db.exec('ALTER TABLE players ADD COLUMN public_id TEXT'); } catch {}
try { db.exec('ALTER TABLE players ADD COLUMN auth_hash TEXT'); } catch {}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_public_id ON players(public_id) WHERE public_id IS NOT NULL');

function publicIdFor(playerId) {
  return 'p_' + createHmac('sha256', TOKEN_SECRET).update('public:' + playerId).digest('base64url').slice(0, 20);
}
function browserAuthHash(secret) {
  return createHmac('sha256', TOKEN_SECRET).update('browser:' + secret).digest('hex');
}
function sameSecretHash(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(String(actual)); const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Публичная доска и ref-ссылки больше не используют внутренний player_id
// (для Mini App он содержит Telegram ID). Миграция идемпотентна и сохраняет
// историческую атрибуцию: старые ref в landing-событиях заменяются на public_id.
const qBackfillPublicId = db.prepare('UPDATE players SET public_id = ? WHERE player_id = ? AND public_id IS NULL');
for (const row of db.prepare('SELECT player_id AS playerId FROM players WHERE public_id IS NULL').all()) {
  qBackfillPublicId.run(publicIdFor(row.playerId), row.playerId);
}
try {
  db.exec(`
    UPDATE analytics_events
    SET props_json = json_set(
      props_json, '$.ref',
      (SELECT p.public_id FROM players p
       WHERE p.player_id = json_extract(analytics_events.props_json, '$.ref'))
    )
    WHERE event = 'landing'
      AND EXISTS (
        SELECT 1 FROM players p
        WHERE p.player_id = json_extract(analytics_events.props_json, '$.ref')
      )
  `);
} catch (error) {
  console.warn('ref analytics migration skipped:', error?.message || error);
}

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
// 35 «м»/с (дистанция = px * 0.02). Помимо проверки каждой дельты ниже есть
// суммарный envelope: базовая скорость + физически возможные окна VPN-бустов.
const TOKEN_MIN_AGE_S = 8;
const TOKEN_MAX_AGE_S = 6 * 60 * 60;
const MAX_METERS_PER_SEC = 36;
const BASE_MAX_METERS_PER_SEC = 1052 * 0.02; // MAX_SPEED * (1 + creep 12%)
const BOOST_MAX_METERS_PER_SEC = 1750 * 0.02;
const BOOST_FIRST_MIN_S = 7;
const BOOST_INTERVAL_MIN_S = 12;
const BOOST_DURATION_S = 5;
const DISTANCE_TOTAL_ALLOWANCE = 35;
const MIN_BEAT_INTERVAL_MS = 2500;
const MAX_BEAT_COVERAGE_MS = 12_000;
const MIN_COVERAGE_RATIO = 0.65;
const MAX_VERIFIED_RUN_S = 30 * 60;
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
function validPublicId(value) { return typeof value === 'string' && /^p_[a-zA-Z0-9_-]{20}$/.test(value); }
function validPlayerSecret(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function safeAlias(value) { return String(value || '').replace(/[<>]/g, '').trim().slice(0, 24); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

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
const telegramAgent = new https.Agent({
  keepAlive: true,
  ...(TELEGRAM_IP_FAMILY ? { family: TELEGRAM_IP_FAMILY } : {}),
});

async function tgApi(method, params) {
  const timeoutMs = method === 'getUpdates' ? 35_000 : 15_000;
  const payload = JSON.stringify(params || {});
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      agent: telegramAgent,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1_000_000) request.destroy(new Error(`Telegram ${method}: response too large`));
      });
      response.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch {}
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300 || !body?.ok) {
          reject(new Error(`Telegram ${method}: HTTP ${response.statusCode || 0}, ${String(body?.description || 'invalid response').slice(0, 160)}`));
          return;
        }
        resolve(body);
      });
    });
    request.on('timeout', () => request.destroy(new Error(`Telegram ${method}: timeout after ${timeoutMs}ms`)));
    request.on('error', reject);
    request.end(payload);
  });
}

// Ссылка на игру и промокод для ответов бота. Промо парсится из config.js —
// единый источник (CONFIG.PROMO) не дублируется руками в двух местах.
const GAME_URL_BOT = process.env.GAME_URL || 'https://31.130.148.55/';

// Играть нужно ВНУТРИ Telegram: игрок опознаётся подписанным initData, а во внешнем
// браузере его нет — забег не зарегистрируется и приз не начислится. Поэтому голая
// ссылка на игру в тексте ответа бота — это ловушка: тап уводит в системный браузер.
// Вместо неё вешаем кнопку.
//   • приватный чат  → web_app: Mini App открывается прямо в Telegram;
//   • группа/канал   → web_app там запрещён и sendMessage упал бы с ошибкой, поэтому
//                      ведём на t.me/<бот>?startapp — это тоже остаётся в Telegram.
// botUsername заполняется getMe до старта поллинга, так что к моменту ответа он есть.
// lite=true открывает игру сразу с лёгкой графикой (?lite=1 / startapp=lite):
// то же самое, что тумблер «Графика: ЛЁГКАЯ» в настройках, но одним тапом.
function playButton(chatType, lite = false) {
  const text = lite ? '🪶 Играть в лёгком режиме' : '🚀 Играть';
  if (chatType === 'private') {
    // URL собираем через URL API: GAME_URL может уже содержать путь/квери.
    let url = GAME_URL_BOT;
    if (lite) {
      try { const u = new URL(GAME_URL_BOT); u.searchParams.set('lite', '1'); url = u.toString(); }
      catch { url = GAME_URL_BOT + (GAME_URL_BOT.includes('?') ? '&' : '?') + 'lite=1'; }
    }
    return { inline_keyboard: [[{ text, web_app: { url } }]] };
  }
  // Вне приватного чата web_app недопустим — Telegram отверг бы весь sendMessage.
  if (botUsername) {
    return { inline_keyboard: [[{ text, url: `https://t.me/${botUsername}?startapp=${lite ? 'lite' : 'play'}` }]] };
  }
  return null; // без username кнопки нет, но текст ответа всё равно уходит
}
// Ответ бота с кнопкой «Играть» вместо голой ссылки в тексте.
function withPlay(text, msg, lite = false) {
  const reply_markup = playButton(msg.chat?.type, lite);
  return reply_markup ? { text, reply_markup } : { text };
}
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

const DAY_MS = 24 * 60 * 60 * 1000;
function parseUtcDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const ms = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}
function periodOptions(arg = '') {
  const source = String(arg);
  for (const flag of ['from', 'to', 'ruleset']) {
    if ((source.match(new RegExp(`(?:^|\\s)--${flag}\\b`, 'gi')) || []).length > 1) {
      return { error: `Параметр --${flag} указан несколько раз.` };
    }
  }
  let fromText = null; let toText = null; let ruleset = RULESET_VERSION;
  let rest = source.replace(/(?:^|\s)--from\s+(\d{4}-\d{2}-\d{2})(?=\s|$)/i, (_, value) => {
    fromText = value; return ' ';
  }).replace(/(?:^|\s)--to\s+(\d{4}-\d{2}-\d{2})(?=\s|$)/i, (_, value) => {
    toText = value; return ' ';
  }).replace(/(?:^|\s)--ruleset\s+(\S+)(?=\s|$)/i, (_, value) => {
    ruleset = value; return ' ';
  }).replace(/\s+/g, ' ').trim();
  if (/(?:^|\s)--(?:from|to|ruleset)\b/i.test(rest)) {
    return { error: 'Некорректные параметры. Используй --from YYYY-MM-DD --to YYYY-MM-DD [--ruleset VERSION].' };
  }
  if (!/^[a-zA-Z0-9._:-]{1,40}$/.test(ruleset)) return { error: 'Некорректная версия ruleset.' };
  if (!!fromText !== !!toText) return { error: 'Укажи обе границы: --from YYYY-MM-DD --to YYYY-MM-DD (даты UTC).' };
  if (!fromText) {
    const now = Date.now();
    const utcDay = new Date(now).toISOString().slice(0, 10);
    const to = now + 1;
    return {
      from: now - WEEK_MS, to, label: 'последние 7 дней', ruleset, rest,
      campaignPeriod: `rolling-week:${utcDay}`,
    };
  }
  const from = parseUtcDay(fromText); const toDay = parseUtcDay(toText);
  if (from == null || toDay == null || from > toDay) return { error: 'Некорректный период. Формат: --from 2026-08-01 --to 2026-08-07 (UTC).' };
  return {
    from, to: toDay + DAY_MS, label: `${fromText} — ${toText} UTC`, ruleset, rest,
    campaignPeriod: `${fromText}:${toText}`,
  };
}
function winnerRows(range, count) {
  return qWinnersContacts.all(range.from, range.to, range.ruleset, count);
}

function adminContactLines(count = 5, range = periodOptions()) {
  const rows = winnerRows(range, count);
  return rows.map((row, i) => {
    const contact = row.username ? `@${row.username}` : row.chatId ? `Telegram ID: ${row.chatId}` : 'контакт не зарегистрирован';
    return `${i + 1}. ${row.alias || fallbackAlias(row.playerId)} — ${row.distance} м (${row.score} очков) — ${contact}`;
  }).join('\n');
}

// ============================================================================
//  Админ-инструменты бота: аналитика, рассылки (с подтверждением), модерация.
//  Гейт — только BOT_ADMIN_IDS. Поллинг слушает лишь message-апдейты, поэтому
//  подтверждение рассылки текстовое: /notify ... → превью + токен → /confirm.
// ============================================================================

// --- Аналитика ---------------------------------------------------------------
function statsText() {
  const f = qFunnel.get(Date.now() - WEEK_MS) || {};
  const active = qActivePlayers.get(Date.now() - WEEK_MS, RULESET_VERSION) || {};
  const runs = Number(f.runs) || 0;
  const starts = Number(f.starts) || 0;
  const cta = Number(f.cta) || 0;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return '📈 <b>Статистика за 7 дней</b>\n\n'
    + `Заходы: ${Number(f.landings) || 0}\n`
    + `Старты: ${starts}\n`
    + `Забеги: ${runs}\n`
    + `Игроков (уник.): ${Number(active.players) || 0}\n`
    + `Ср. дистанция: ${Math.round(Number(f.avgDistance) || 0)} м\n\n`
    + `Шеры: ${Number(f.shares) || 0}\n`
    + `Клики CTA: ${cta} (${pct(cta, runs)}% от забегов)\n`
    + `Промокод скопирован: ${Number(f.promo) || 0} раз`;
}

// --- Сезон -------------------------------------------------------------------
function seasonText() {
  const s = qSeasonStats.get(Date.now() - WEEK_MS, RULESET_VERSION) || {};
  return '🗓 <b>Текущий сезон</b>\n\n'
    + `Правила (ruleset): <code>${RULESET_VERSION}</code>\n`
    + `Окно доски: ${Math.round(WEEK_MS / 3600000)} ч\n`
    + `Забегов: ${Number(s.runs) || 0} (verified: ${Number(s.verified) || 0})\n`
    + `Игроков: ${Number(s.players) || 0}\n\n`
    + 'Новый сезон = смена RULESET_VERSION в env сервиса + рестарт (обнуляет доску).';
}

// --- Модерация ---------------------------------------------------------------
function voidCommand(arg) {
  const parts = arg.trim().split(/\s+/);
  if (parts[0] === 'player' && validId(parts[1])) {
    const info = qVoidPlayer.run(parts[1], RULESET_VERSION);
    return `🚫 Снято verified с ${info.changes} забег(ов) игрока ${parts[1]}. Доска пересчитается автоматически.`;
  }
  if (/^[0-9a-f]{32}$/.test(parts[0])) {
    const info = qVoidRun.run(parts[0]);
    return info.changes ? `🚫 Забег ${parts[0]} помечен невалидным.` : 'Забег с таким run_id не найден.';
  }
  return 'Формат: /void <run_id> — снять один забег, или /void player <playerId> — все забеги игрока.';
}

// --- Экспорт контактов победителей (CSV в текстовом виде) --------------------
function exportText(arg = '') {
  const topMatch = String(arg).match(/(?:^|\s)--top\s+(\d+)(?=\s|$)/i);
  const count = Math.min(100, Math.max(1, Number(topMatch?.[1]) || 25));
  const range = periodOptions(String(arg).replace(/(?:^|\s)--top\s+\d+(?=\s|$)/i, ' '));
  if (range.error) return range.error;
  const rows = winnerRows(range, count);
  if (!rows.length) return `Подтверждённых результатов за период ${range.label} нет.`;
  const csv = ['rank,alias,score,distance,contact'];
  rows.forEach((r, i) => {
    const contact = r.username ? '@' + r.username : r.chatId ? 'id:' + r.chatId : 'нет';
    const alias = String(r.alias || fallbackAlias(r.playerId)).replace(/,/g, ' ');
    csv.push(`${i + 1},${alias},${r.score},${r.distance},${contact}`);
  });
  return `📋 <b>Победители за ${escapeHtml(range.label)} (ruleset: ${escapeHtml(range.ruleset)}) (CSV):</b>\n<pre>${csv.join('\n')}</pre>`;
}

// --- Рассылки: разбор цели, предпросмотр, подтверждение, отправка -------------
// Ожидающие подтверждения рассылки: chatId админа → {token, recipients, ...}.
const pendingNotify = new Map();
const NOTIFY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WIN_MESSAGE = 'Поздравляем с победой в ЮБуст Раннере! Приставка твоя. Свяжемся с тобой в ближайшее время';

function loadCampaign(name) {
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(name)) return null;
  try { return JSON.parse(readFileSync(path.join(__dirname, 'campaigns', name + '.json'), 'utf8')); }
  catch { return null; }
}

// Один получатель для точечной отправки: принимает @username или числовой id.
function resolveOne(target) {
  if (/^@?\w{3,}$/.test(target) && !/^\d+$/.test(target.replace(/^@/, ''))) {
    const row = qLinkByUsername.get(target.replace(/^@/, ''));
    if (!row?.chat_id) return null;
    const alias = qLinkGet.get(row.player_id)?.first_name || row.username || fallbackAlias(row.player_id);
    return { playerId: row.player_id, chatId: String(row.chat_id), alias };
  }
  if (/^\d{4,}$/.test(target)) {
    const playerId = 'tg:' + target;
    const link = qLinkGet.get(playerId);
    return { playerId, chatId: String(link?.chat_id || target), alias: link?.first_name || fallbackAlias(playerId) };
  }
  return null;
}

function winnerRecipients(count, range = periodOptions()) {
  return winnerRows(range, count)
    .map((r, i) => ({ playerId: r.playerId, chatId: r.chatId ? String(r.chatId) : null, username: r.username,
                      alias: r.alias || fallbackAlias(r.playerId), rank: i + 1, score: r.score, distance: r.distance }));
}

function fmtMessage(tpl, r) {
  return String(tpl)
    .replaceAll('{alias}', escapeHtml(r.alias || 'Игрок'))
    .replaceAll('{rank}', escapeHtml(r.rank ?? ''))
    .replaceAll('{score}', escapeHtml(r.score ?? ''))
    .replaceAll('{distance}', escapeHtml(r.distance ?? ''));
}

// Разбирает /notify ... → объект рассылки {recipients, message, campaign, ...}
// или строку-ошибку. Не отправляет — только готовит превью.
function buildNotify(arg) {
  const m = arg.trim().match(/^(winners|user|campaign)\s+([\s\S]*)$/i);
  if (!m) return 'Формат: /notify winners <N> [--from YYYY-MM-DD --to YYYY-MM-DD] [--ruleset VERSION] [текст] · /notify user <@ник|id> <текст> · /notify campaign <имя> [N] [--from ... --to ...] [--ruleset VERSION]';
  const [, kind, rest] = m;
  if (kind.toLowerCase() === 'winners') {
    const wm = rest.match(/^(\d+)\s*([\s\S]*)$/);
    const n = Math.min(25, Math.max(1, Number(wm?.[1]) || 3));
    const range = periodOptions(wm?.[2] || '');
    if (range.error) return range.error;
    const recipients = winnerRecipients(n, range);
    if (!recipients.length) return `Победителей за период ${range.label} нет (нужны verified-забеги).`;
    return { recipients, message: range.rest || DEFAULT_WIN_MESSAGE, parseMode: 'HTML',
             campaign: `winners:${range.ruleset}:${range.campaignPeriod}`,
             periodLabel: range.label, ruleset: range.ruleset };
  }
  if (kind.toLowerCase() === 'user') {
    const um = rest.match(/^(\S+)\s+([\s\S]+)$/);
    if (!um) return 'Формат: /notify user <@ник|id> <текст>';
    const one = resolveOne(um[1]);
    if (!one) return `Не нашёл получателя «${um[1]}» (нет привязки chat_id — не нажимал /start?).`;
    return { recipients: [{ ...one, rank: '' }], message: um[2].trim(), parseMode: 'HTML', campaign: '' };
  }
  // campaign
  const range = periodOptions(rest);
  if (range.error) return range.error;
  const cm = range.rest.match(/^(\S+)\s*(\d*)$/);
  const camp = cm && loadCampaign(cm[1]);
  if (!camp?.message) return `Кампания «${cm?.[1]}» не найдена в backend/campaigns/.`;
  const n = Math.min(25, Math.max(1, Number(cm[2]) || 3));
  const recipients = winnerRecipients(n, range);
  if (!recipients.length) return `Победителей за период ${range.label} нет (нужны verified-забеги).`;
  return { recipients, message: camp.message, parseMode: camp.parseMode || 'HTML',
           buttonText: camp.buttonText, buttonUrl: camp.buttonUrl,
           campaign: `campaign:${cm[1]}:${range.ruleset}:${range.campaignPeriod}`,
           periodLabel: range.label, ruleset: range.ruleset };
}

function notifyPreview(plan, token) {
  const lines = plan.recipients.map((r) => {
    const contact = r.chatId ? (r.username ? '@' + escapeHtml(r.username) : 'id:' + escapeHtml(r.chatId)) : '⚠ нет chat_id';
    return `• ${escapeHtml(r.alias)}${r.rank ? ' (#' + escapeHtml(r.rank) + ')' : ''} — ${contact}`;
  });
  const noChat = plan.recipients.filter((r) => !r.chatId).length;
  return '📨 <b>Предпросмотр рассылки</b>\n\n'
    + `Получателей: ${plan.recipients.length}${noChat ? ` (⚠ ${noChat} без chat_id — не дойдёт)` : ''}\n`
    + (plan.periodLabel ? `Период: ${escapeHtml(plan.periodLabel)}\n` : '')
    + (plan.ruleset ? `Ruleset: <code>${escapeHtml(plan.ruleset)}</code>\n` : '')
    + lines.join('\n') + '\n\n'
    + '<b>Текст:</b>\n' + fmtMessage(plan.message, plan.recipients[0]) + '\n\n'
    + `Отправить: <code>/confirm ${token}</code> (5 минут).`;
}

// Фактическая отправка: очередь с паузой (щадим лимиты Telegram), идемпотентность
// по campaign, честный лог 403 (получатель не нажимал /start).
async function runBroadcast(plan) {
  let sent = 0, skipped = 0, failed = 0;
  const now = Date.now();
  for (const r of plan.recipients) {
    if (!r.chatId) { skipped++; continue; }
    if (plan.campaign && qNotifySeen.get(plan.campaign, r.playerId)) { skipped++; continue; }
    const body = { chat_id: r.chatId, text: fmtMessage(plan.message, r) };
    if (plan.parseMode) body.parse_mode = plan.parseMode;
    if (plan.buttonText && plan.buttonUrl) body.reply_markup = { inline_keyboard: [[{ text: plan.buttonText, url: plan.buttonUrl }]] };
    try {
      await tgApi('sendMessage', body);
      sent++;
      if (plan.campaign) qNotifyMark.run(r.playerId, r.chatId, plan.campaign, now);
    } catch (error) {
      failed++;
      console.warn(`notification failed [${plan.campaign || 'manual'}]:`, error?.message || error);
    }
    await new Promise((res) => setTimeout(res, 120)); // ~8 msg/с, под лимитом Telegram
  }
  return `✅ Готово. Отправлено: ${sent}, пропущено: ${skipped}, ошибок: ${failed}.`
    + (skipped ? '\n(пропущены без chat_id или уже получавшие эту кампанию)' : '');
}

// Ответ бота на входящее сообщение. Возвращает текст (или null — молчим).
async function botReply(msg) {
  const text = (msg.text || '').trim();
  const chatId = String(msg.chat.id);
  const admin = BOT_ADMIN_IDS.has(chatId);

  // --- Админ-команды (только BOT_ADMIN_IDS) ---------------------------------
  // Ответы форматированы HTML, поэтому возвращаются как {text, parse_mode}.
  if (/^\/(stats|notify|confirm|void|season|export)(?:@\w+)?(?:\s|$)/i.test(text)) {
    const html = (t) => ({ text: t, parse_mode: 'HTML' });
    if (!admin) return 'Команда доступна только администратору.';
    const [, cmd, rest = ''] = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/) || [];
    if (cmd === 'stats') return html(statsText());
    if (cmd === 'season') return html(seasonText());
    if (cmd === 'export') return html(exportText(rest));
    if (cmd === 'void') return html(voidCommand(rest));
    if (cmd === 'notify') {
      const plan = buildNotify(rest);
      if (typeof plan === 'string') return html(plan);
      const token = randomBytes(4).toString('hex');
      pendingNotify.set(chatId, { ...plan, token, expires: Date.now() + NOTIFY_TTL_MS });
      return html(notifyPreview(plan, token));
    }
    if (cmd === 'confirm') {
      const pending = pendingNotify.get(chatId);
      if (!pending || pending.expires < Date.now()) { pendingNotify.delete(chatId); return 'Нет активной рассылки для подтверждения (или истекли 5 минут). Собери заново через /notify.'; }
      if (rest.trim() !== pending.token) return 'Токен не совпадает. Скопируй его из предпросмотра: /confirm <токен>.';
      pendingNotify.delete(chatId);
      return html(await runBroadcast(pending));
    }
  }

  if (/^\/start/.test(text)) {
    return 'Привет! Я бот ЮБуст Раннера 🚀\n\n'
      + 'Жми кнопку «Играть» внизу — забег сразу считается в призах, ничего привязывать не надо.\n\n'
      + 'Команды:\n/top — топ недели\n/me — моё место\n/promo — промокод на ЮБуст\n/lite — лёгкий режим, если телефон тормозит'
      + (admin ? '\n\n🔐 Админ:\n/winners [--from дата --to дата] — лидеры по дистанции\n/stats — статистика за неделю\n/season — статус сезона\n/notify — разослать поздравления\n/void — снять verified с забега\n/export [--from дата --to дата] — CSV победителей' : '');
  }

  if (/^\/id(?:@\w+)?(?:\s|$)/i.test(text)) {
    return `Твой Telegram ID: ${chatId}`;
  }

  if (/^\/(admin|contacts|winners)(?:@\w+)?(?:\s|$)/i.test(text)) {
    if (!admin) return 'Команда доступна только администратору.';
    const [, , rangeArgs = ''] = text.match(/^\/(admin|contacts|winners)(?:@\w+)?\s*([\s\S]*)$/i) || [];
    const range = periodOptions(rangeArgs);
    if (range.error) return range.error;
    const contacts = adminContactLines(5, range);
    return `🔐 Топ-5 по суммарной дистанции за ${range.label} (ruleset: ${range.ruleset}):\n`
      + (contacts || 'Подтверждённых результатов пока нет.');
  }

  if (/^\/top/.test(text)) {
    const best = botBoardLines('best');
    const total = botBoardLines('total', 3);
    return withPlay('🏆 Рекорды недели:\n' + (best || 'пока пусто')
      + '\n\n🛣 Суммарный пробег недели:\n' + (total || 'пока пусто')
      + '\n\nОбойди их 👇', msg);
  }

  if (/^\/me/.test(text)) {
    const link = qLinkByChat.get(chatId);
    // Профиль появляется сам после первого забега из Mini App — привязывать нечего.
    if (!link) return 'Пока не вижу твоих забегов. Жми кнопку «Играть» внизу и сыграй — профиль заведётся сам.';
    const best = boardMe('week', link.player_id);
    const total = boardMe('week', link.player_id, 'total');
    if (!best?.rank && !total?.rank) return withPlay('Пока нет забегов на этой неделе. Исправь это 👇', msg);
    return withPlay('📊 Твоя неделя:\n'
      + (best?.rank ? `Рекорд: #${best.rank} из ${best.total} (${best.score} очков)\n` : '')
      + (total?.rank ? `Пробег: #${total.rank} из ${total.total} (${total.distance} м)\n` : '')
      + (best?.referrals ? `Друзей привёл: ${best.referrals}\n` : '')
      + '\nУлучшить 👇', msg);
  }

  // Лёгкий режим: та же игра, только графика попроще (сложность и очки те же).
  if (/^\/lite/.test(text)) {
    return withPlay('🪶 Лёгкий режим — для слабых телефонов: меньше эффектов и частиц, '
      + 'зато ровные 60 fps.\n\nСложность, скорость и очки те же — на призы и рейтинг это не влияет.\n\n'
      + 'Кнопка ниже откроет игру сразу в лёгком режиме. Переключить в любой момент можно '
      + 'в игре: ⚙ Настройки → Графика.', msg, true);
  }

  if (/^\/promo/.test(text)) {
    return BOT_PROMO?.code
      ? `🎁 Промокод на ЮБуст: ${BOT_PROMO.code} (−${BOT_PROMO.percent}%)`
      : 'Промокод сейчас не активен.';
  }

  return 'Не понял 🤖 Доступные команды: /top /me /promo /lite /id';
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
  let retryMs = 5000;
  while (true) {
    try {
      const updates = await tgApi('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      botLastPollAt = Date.now();
      retryMs = 5000;
      for (const update of updates?.result || []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || !msg.chat?.id) continue;
        const reply = await botReply(msg);
        // botReply отдаёт строку (обычный текст) или {text, parse_mode} для
        // форматированных админ-ответов — не навязываем HTML пользовательским
        // алиасам, где мог бы затесаться < > &.
        if (reply) {
          const out = typeof reply === 'string' ? { text: reply } : reply;
          await tgApi('sendMessage', { chat_id: msg.chat.id, ...out });
        }
      }
    } catch (error) {
      if (Date.now() - botLastErrorLogAt > 60_000) {
        console.warn('telegram polling failed:', error?.message || error);
        botLastErrorLogAt = Date.now();
      }
      await new Promise((r) => setTimeout(r, retryMs));
      retryMs = Math.min(60_000, retryMs * 2);
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
  SELECT r.player_id AS playerId, p.public_id AS publicId, COALESCE(p.alias, '') AS alias,
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
  SELECT r.player_id AS playerId, p.public_id AS publicId, COALESCE(p.alias, '') AS alias,
         SUM(r.score) AS score, SUM(r.distance) AS distance, COUNT(*) AS runs,
         MIN(r.verified) AS verified,
         MAX(r.created_at) AS createdAt,
         EXISTS(SELECT 1 FROM telegram_links t WHERE t.player_id = r.player_id) AS tg
  FROM runs r LEFT JOIN players p ON p.player_id = r.player_id
  WHERE r.created_at >= ? AND r.verified = 1 AND r.ruleset_version = ?
  GROUP BY r.player_id
  ORDER BY distance DESC, score DESC, createdAt ASC, r.player_id ASC
  LIMIT ?
`);
const qRankTotal = db.prepare(`
  WITH sums AS (
    SELECT player_id, SUM(distance) AS distance, SUM(score) AS score, MAX(created_at) AS last_at
    FROM runs WHERE created_at >= ? AND verified = 1 AND ruleset_version = ? GROUP BY player_id
  ), ranked AS (
    SELECT player_id, distance, score,
           ROW_NUMBER() OVER (ORDER BY distance DESC, score DESC, last_at ASC, player_id ASC) AS rank,
           COUNT(*) OVER () AS total
    FROM sums
  )
  SELECT rank, distance, score, total FROM ranked WHERE player_id = ?
`);
const qRank = db.prepare(`
  WITH best AS (SELECT player_id, MAX(score) AS score FROM runs WHERE created_at >= ? AND verified = 1 AND ruleset_version = ? GROUP BY player_id)
  SELECT
    (SELECT COUNT(*) + 1 FROM best WHERE score > (SELECT score FROM best WHERE player_id = ?)) AS rank,
    (SELECT score FROM best WHERE player_id = ?) AS score,
    (SELECT COUNT(*) FROM best) AS total
`);
const qReferrals = db.prepare(
  "SELECT COUNT(*) AS n FROM analytics_events WHERE event = 'landing' AND json_extract(props_json, '$.ref') IN (?, ?)"
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
  INSERT INTO runs(run_id, player_id, score, distance, created_at, started_at, ended_at, verified, verification_reason, ruleset_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const qRunById = db.prepare('SELECT player_id AS playerId FROM runs WHERE run_id = ?');
const qSessionSupersede = db.prepare("UPDATE run_sessions SET used = 1, invalid_reason = 'superseded' WHERE player_id = ? AND used = 0");
const qSessionStart = db.prepare('INSERT INTO run_sessions(run_id, player_id, ruleset_version, started_at, last_beat_at) VALUES (?, ?, ?, ?, ?)');
const qSessionGet = db.prepare('SELECT * FROM run_sessions WHERE run_id = ?');
const qSessionBeat = db.prepare(`
  UPDATE run_sessions
  SET last_beat_at = ?, beats = beats + 1, last_score = ?, last_distance = ?, last_seq = ?,
      covered_ms = covered_ms + ?
  WHERE run_id = ?
`);
const qSessionUse = db.prepare('UPDATE run_sessions SET used = 1 WHERE run_id = ?');
const qSessionInvalidate = db.prepare('UPDATE run_sessions SET invalid_reason = ? WHERE run_id = ?');
const qInsertBeat = db.prepare(`
  INSERT INTO run_beats(run_id, beat_seq, observed_at, score, distance, delta_ms, delta_score, delta_distance, accepted, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const qPlayerIdentity = db.prepare(`
  SELECT player_id AS playerId, public_id AS publicId, auth_hash AS authHash
  FROM players WHERE player_id = ?
`);
const qPlayerByPublicId = db.prepare('SELECT player_id AS playerId, public_id AS publicId FROM players WHERE public_id = ?');
const qIdentityUpsert = db.prepare(`
  INSERT INTO players(player_id, telegram_id, alias, updated_at, public_id, auth_hash)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(player_id) DO UPDATE SET
    telegram_id = COALESCE(excluded.telegram_id, players.telegram_id),
    public_id = COALESCE(players.public_id, excluded.public_id),
    auth_hash = COALESCE(players.auth_hash, excluded.auth_hash),
    updated_at = excluded.updated_at
`);

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

// Даже идеальный игрок не может держать BOOST_SPEED постоянно: первый буст
// появляется не раньше BOOST_FIRST_MIN, следующие — не чаще минимального
// cooldown. Используем наиболее выгодный физически возможный сценарий, чтобы
// не отбрасывать честные забеги, но закрыть скрипт с постоянными 35–45 м/с.
function maxBoostSeconds(runAgeSec) {
  const afterFirst = Math.max(0, runAgeSec - BOOST_FIRST_MIN_S);
  const fullWindows = Math.floor(afterFirst / BOOST_INTERVAL_MIN_S);
  const remainder = afterFirst - fullWindows * BOOST_INTERVAL_MIN_S;
  return fullWindows * BOOST_DURATION_S + Math.min(BOOST_DURATION_S, remainder);
}
function plausibleRunTotals(score, distance, runAgeSec, extraScore = 0) {
  if (!Number.isFinite(runAgeSec) || runAgeSec < 0) return false;
  const boostSec = maxBoostSeconds(runAgeSec);
  const maxDistance = BASE_MAX_METERS_PER_SEC * runAgeSec
    + (BOOST_MAX_METERS_PER_SEC - BASE_MAX_METERS_PER_SEC) * boostSec
    + DISTANCE_TOTAL_ALLOWANCE;
  if (distance > maxDistance) return false;
  return score <= (runAgeSec + 2) * MAX_SCORE_PER_SEC + extraScore;
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
const qLinkByUsername = db.prepare("SELECT player_id, chat_id, username FROM telegram_links WHERE username = ? COLLATE NOCASE ORDER BY linked_at DESC LIMIT 1");

// Telegram доказывает владельца подписанным initData. Обычный браузер получает
// отдельный 256-битный секрет в localStorage; в БД хранится только HMAC. Для
// старых браузерных игроков auth_hash заполняется при первом запросе после
// миграции, поэтому их история и локальная идентичность не пропадают.
function authenticatePlayer(body, { registerTelegram = true } = {}) {
  const now = Date.now();
  const telegram = BOT_TOKEN ? verifyTelegramInitData(body?.initData, BOT_TOKEN) : null;
  if (telegram) {
    const playerId = `tg:${telegram.id}`;
    const publicId = publicIdFor(playerId);
    qIdentityUpsert.run(playerId, telegram.id, '', now, publicId, null);
    if (registerTelegram) {
      qLinkUpsert.run(playerId, telegram.id, telegram.username, telegram.firstName, now);
    }
    return { playerId, publicId, telegramId: telegram.id, telegram };
  }

  const playerId = body?.playerId;
  const playerSecret = body?.playerSecret;
  if (!validId(playerId) || String(playerId).startsWith('tg:') || !validPlayerSecret(playerSecret)) return null;
  const expected = browserAuthHash(playerSecret);
  const current = qPlayerIdentity.get(playerId);
  if (current?.authHash && !sameSecretHash(current.authHash, expected)) return null;
  const publicId = current?.publicId || publicIdFor(playerId);
  qIdentityUpsert.run(playerId, null, '', now, publicId, expected);
  return { playerId, publicId, telegramId: null, telegram: null };
}

function normalizeReferral(ref) {
  if (validPublicId(ref) && qPlayerByPublicId.get(ref)) return ref;
  // Старые ссылки могли содержать внутренний playerId. Принимаем их как вход,
  // но перед сохранением аналитики сразу заменяем на анонимный publicId.
  if (validId(ref)) return qPlayerIdentity.get(ref)?.publicId || '';
  return '';
}

// --- SQL админ-команд (аналитика / рассылки / модерация) ----------------------
// Воронка за окно: считаем каждое ключевое событие одним проходом.
const qFunnel = db.prepare(`
  SELECT
    SUM(CASE WHEN event = 'landing'     THEN 1 ELSE 0 END) AS landings,
    SUM(CASE WHEN event = 'game_start'  THEN 1 ELSE 0 END) AS starts,
    SUM(CASE WHEN event = 'game_over'   THEN 1 ELSE 0 END) AS runs,
    SUM(CASE WHEN event = 'share'       THEN 1 ELSE 0 END) AS shares,
    SUM(CASE WHEN event = 'cta_click'   THEN 1 ELSE 0 END) AS cta,
    SUM(CASE WHEN event = 'promo_copy'  THEN 1 ELSE 0 END) AS promo,
    AVG(CASE WHEN event = 'game_over'   THEN json_extract(props_json, '$.distance') END) AS avgDistance
  FROM analytics_events WHERE created_at >= ?
`);
// Уникальные игроки за окно (по verified-забегам — реальные люди, не заходы).
const qActivePlayers = db.prepare('SELECT COUNT(DISTINCT player_id) AS players FROM runs WHERE created_at >= ? AND ruleset_version = ?');
// Победители с контактами по суммарному пробегу — база для рассылки поздравлений.
const qWinnersContacts = db.prepare(`
  SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias,
         SUM(r.score) AS score, SUM(r.distance) AS distance,
         l.chat_id AS chatId, l.username
  FROM runs r
  LEFT JOIN players p ON p.player_id = r.player_id
  LEFT JOIN telegram_links l ON l.player_id = r.player_id
  WHERE r.started_at >= ? AND r.ended_at < ?
    AND r.verified = 1 AND r.ruleset_version = ?
  GROUP BY r.player_id
  ORDER BY distance DESC, score DESC, MAX(r.ended_at) ASC, r.player_id ASC
  LIMIT ?
`);
// Сезон: сводка по текущему ruleset за окно.
const qSeasonStats = db.prepare(`
  SELECT COUNT(*) AS runs, SUM(verified) AS verified, COUNT(DISTINCT player_id) AS players
  FROM runs WHERE created_at >= ? AND ruleset_version = ?
`);
// Модерация: снять verified с конкретного забега или со всех забегов игрока.
const qVoidRun = db.prepare("UPDATE runs SET verified = 0, verification_reason = 'admin_void' WHERE run_id = ?");
const qVoidPlayer = db.prepare("UPDATE runs SET verified = 0, verification_reason = 'admin_void' WHERE player_id = ? AND ruleset_version = ? AND verified = 1");
// Идемпотентность/аудит рассылок.
const qNotifySeen = db.prepare('SELECT 1 FROM notifications_sent WHERE campaign = ? AND player_id = ? LIMIT 1');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_notify_campaign_player ON notifications_sent(campaign, player_id)');
const qNotifyMark = db.prepare('INSERT OR IGNORE INTO notifications_sent(player_id, chat_id, campaign, sent_at) VALUES (?, ?, ?, ?)');

function periodSince(period) { return period === 'all' ? 0 : Date.now() - WEEK_MS; }
function fallbackAlias(playerId) { return 'Игрок-' + String(playerId).slice(-4).toUpperCase(); }
function boardEntries(period, count = 10, board = 'best') {
  const q = board === 'total' ? qTopTotal : qTop;
  return q.all(periodSince(period), RULESET_VERSION, count).map((e) => ({
    publicId: e.publicId || publicIdFor(e.playerId),
    alias: e.alias || fallbackAlias(e.playerId),
    score: Number(e.score) || 0,
    distance: Number(e.distance) || 0,
    runs: Number(e.runs) || 0,
    verified: !!e.verified,
    createdAt: Number(e.createdAt) || 0,
    tg: !!e.tg,
  }));
}
function boardMe(period, playerId, board = 'best') {
  if (!validId(playerId)) return null;
  const publicId = qPlayerIdentity.get(playerId)?.publicId || publicIdFor(playerId);
  // Второй аргумент сохраняет совместимость на случай, если старый ref ещё
  // успел прийти между миграцией и обновлением клиентского кэша.
  const referrals = Number(qReferrals.get(publicId, playerId)?.n) || 0;
  if (board === 'total') {
    const since = periodSince(period);
    const row = qRankTotal.get(since, RULESET_VERSION, playerId);
    if (row?.distance == null) return { rank: null, score: null, distance: null, total: Number(row?.total) || 0, referrals, publicId };
    return { rank: Number(row.rank), score: Number(row.score), distance: Number(row.distance), total: Number(row.total) || 0, referrals, publicId };
  }
  const row = qRank.get(periodSince(period), RULESET_VERSION, playerId, playerId);
  if (row?.score == null) return { rank: null, score: null, total: Number(row?.total) || 0, referrals, publicId };
  return { rank: Number(row.rank), score: Number(row.score), total: Number(row.total) || 0, referrals, publicId };
}
function boardMeByPublicId(period, publicId, board = 'best') {
  if (!validPublicId(publicId)) return null;
  const row = qPlayerByPublicId.get(publicId);
  return row ? boardMe(period, row.playerId, board) : null;
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
  const remote = String(req.socket.remoteAddress || '');
  const fromLocalProxy = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (fromLocalProxy && /^[0-9a-fA-F:.]{3,45}$/.test(real)) return real;
  return remote || 'unknown';
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

  if (req.method === 'POST' && url.pathname === '/v1/player/session') {
    if (!rateLimit('pi:' + clientIp(req), 30)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    const auth = authenticatePlayer(body);
    if (!auth) { json(res, { error: 'auth_required' }, 401, headers); return; }
    json(res, { ok: true, publicId: auth.publicId }, 200, headers);
    return;
  }

  // Статус контакта — только для самого игрока. Раньше GET с произвольным
  // playerId раскрывал username/firstName любого участника.
  if (req.method === 'POST' && url.pathname === '/v1/link/status') {
    if (!rateLimit('ls:' + clientIp(req), 30)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    const auth = authenticatePlayer(body);
    if (!auth) { json(res, { error: 'auth_required' }, 401, headers); return; }
    const row = qLinkGet.get(auth.playerId);
    json(res, {
      enabled: !!BOT_TOKEN, bot: botUsername,
      linked: !!row,
      username: auth.telegram ? (row?.username || '') : '',
      firstName: auth.telegram ? (row?.first_name || '') : '',
      publicId: auth.publicId,
    }, 200, headers);
    return;
  }

  // Старт heartbeat-сессии забега. Сервер наблюдает забег в реальном времени —
  // это делает подделку результата дорогой: нужно скриптовать всю сессию.
  if (req.method === 'POST' && url.pathname === '/v1/run/start') {
    if (!rateLimit('rs:' + clientIp(req), 120)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    if (body?.rulesetVersion !== RULESET_VERSION) {
      json(res, { error: 'ruleset_mismatch', rulesetVersion: RULESET_VERSION }, 409, headers);
      return;
    }
    const auth = authenticatePlayer(body);
    if (!auth) { json(res, { error: 'auth_required' }, 401, headers); return; }
    if (!rateLimit('rsa:' + auth.playerId, 8)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    const requestedRunId = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? body.runId : '';
    const runId = requestedRunId || randomBytes(16).toString('hex');
    const now = Date.now();
    if (qSessionGet.get(runId)) { json(res, { error: 'run_exists' }, 409, headers); return; }
    try {
      db.exec('BEGIN IMMEDIATE');
      qSessionSupersede.run(auth.playerId);
      qSessionStart.run(runId, auth.playerId, RULESET_VERSION, now, now);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      if (String(error?.message || '').includes('UNIQUE')) { json(res, { error: 'run_conflict' }, 409, headers); return; }
      throw error;
    }
    json(res, { runId, publicId: auth.publicId, rulesetVersion: RULESET_VERSION }, 200, headers);
    return;
  }

  // Живая отметка забега (клиент шлёт каждые ~5с): монотонность + темп.
  if (req.method === 'POST' && url.pathname === '/v1/run/beat') {
    if (!rateLimit('rb:' + clientIp(req), 600)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    const runId = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? body.runId : '';
    const session = runId ? qSessionGet.get(runId) : null;
    if (!session || session.used) { json(res, { error: 'invalid_run' }, 404, headers); return; }
    const auth = authenticatePlayer(body, { registerTelegram: false });
    if (!auth || auth.playerId !== session.player_id) { json(res, { error: 'run_owner_mismatch' }, 401, headers); return; }
    if (!rateLimit('rba:' + auth.playerId, 30)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    const score = limit(body.score, MAX_SCORE);
    const distance = limit(body.distance, MAX_DISTANCE);
    const seq = Number.isInteger(body?.seq) && body.seq > 0 && body.seq <= 100_000 ? body.seq : 0;
    if (!seq) { json(res, { error: 'invalid_sequence' }, 400, headers); return; }
    const now = Date.now();
    const dtMs = now - session.last_beat_at;
    const dt = dtMs / 1000;
    const dScore = score - session.last_score;
    const dDistance = distance - session.last_distance;
    if (seq <= session.last_seq) {
      qInsertBeat.run(runId, seq, now, score, distance, dtMs, dScore, dDistance, 0, 'stale_sequence');
      json(res, { ok: true, stale: true, lastSeq: session.last_seq }, 202, headers);
      return;
    }
    if (seq !== session.last_seq + 1) {
      qInsertBeat.run(runId, seq, now, score, distance, dtMs, dScore, dDistance, 0, 'sequence_gap');
      json(res, { error: 'sequence_gap', expectedSeq: session.last_seq + 1 }, 409, headers);
      return;
    }
    if (session.invalid_reason) { json(res, { error: 'run_invalidated', reason: session.invalid_reason }, 422, headers); return; }
    if ((now - session.started_at) / 1000 > MAX_VERIFIED_RUN_S) {
      qInsertBeat.run(runId, seq, now, score, distance, dtMs, dScore, dDistance, 0, 'run_too_long');
      qSessionInvalidate.run('run_too_long', runId);
      json(res, { error: 'run_too_long' }, 422, headers);
      return;
    }
    if (dtMs < MIN_BEAT_INTERVAL_MS) {
      qInsertBeat.run(runId, seq, now, score, distance, dtMs, dScore, dDistance, 0, 'too_frequent');
      json(res, { error: 'too_frequent' }, 429, headers);
      return;
    }
    const deltaOk = plausibleDelta(dScore, dDistance, dt);
    const totalsOk = plausibleRunTotals(score, distance, (now - session.started_at) / 1000);
    if (!deltaOk || !totalsOk) {
      const reason = deltaOk ? 'implausible_total' : 'implausible_delta';
      qInsertBeat.run(runId, seq, now, score, distance, dtMs, dScore, dDistance, 0, reason);
      qSessionInvalidate.run(reason, runId);
      json(res, { error: 'implausible' }, 422, headers);
      return;
    }
    qInsertBeat.run(runId, seq, now, score, distance, dtMs, dScore, dDistance, 1, 'accepted');
    qSessionBeat.run(now, score, distance, seq, Math.min(dtMs, MAX_BEAT_COVERAGE_MS), runId);
    json(res, { ok: true, lastSeq: seq }, 202, headers);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/leaderboard') {
    const period = url.searchParams.get('period') === 'all' ? 'all' : 'week';
    // Дефолт доски — суммарный пробег (результат копится из сессии в сессию);
    // должен совпадать с CONFIG.LEADERBOARD_BOARD на клиенте.
    const board = url.searchParams.get('board') === 'best' ? 'best' : 'total';
    const count = limit(url.searchParams.get('limit'), 25, 10) || 10;
    const me = url.searchParams.get('me');
    json(res, {
      period, board,
      entries: boardEntries(period, count, board),
      me: me ? boardMeByPublicId(period, me, board) : null,
    }, 200, headers);
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
    const props = body?.props && typeof body.props === 'object' ? { ...body.props } : {};
    if (body?.event === 'landing' && props.ref) {
      const normalizedRef = normalizeReferral(String(props.ref));
      if (normalizedRef) props.ref = normalizedRef;
      else delete props.ref;
    }
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
    if (!rateLimit('sc:' + clientIp(req), 120)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    // Владелец всегда доказывается Telegram initData или браузерным секретом.
    // Heartbeat и токен отвечают только за честность забега, а не за личность.
    const auth = authenticatePlayer(body);
    if (!auth) { json(res, { error: 'auth_required' }, 401, headers); return; }
    const playerId = auth.playerId;
    if (!rateLimit('sca:' + playerId, 10)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    const telegramId = auth.telegramId;
    const runId = typeof body?.runId === 'string' && /^[0-9a-f]{32}$/.test(body.runId) ? body.runId : '';
    const savedRun = runId ? qRunById.get(runId) : null;
    if (savedRun) {
      if (savedRun.playerId !== playerId) {
        json(res, { error: 'run_owner_mismatch' }, 409, headers); return;
      }
      json(res, {
        period: 'week', board: 'total', duplicate: true,
        entries: boardEntries('week', 25, 'total'), me: boardMe('week', playerId, 'total'),
      }, 200, headers);
      return;
    }
    const session = runId ? qSessionGet.get(runId) : null;
    if (session && session.player_id !== playerId) {
      json(res, { error: 'run_owner_mismatch' }, 409, headers); return;
    }
    let age = null;
    if (!session && !auth.telegram) {
      age = tokenAge(body?.token);
      if (age == null) { json(res, { error: 'token_required' }, 401, headers); return; }
    }
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
      const finalGapMs = Math.max(0, now - session.last_beat_at);
      const coveredMs = session.covered_ms
        + (session.beats > 0 ? Math.min(finalGapMs, MAX_BEAT_COVERAGE_MS) : 0);
      const coverage = coveredMs / Math.max(1, now - session.started_at);
      const finalOk = plausibleDelta(score - session.last_score, distance - session.last_distance, finalGapMs / 1000 + 6, END_BONUS_ALLOWANCE);
      const totalsOk = plausibleRunTotals(score, distance, runAge, END_BONUS_ALLOWANCE);
      if (session.invalid_reason) verificationReason = session.invalid_reason;
      else if (runAge < TOKEN_MIN_AGE_S) verificationReason = 'run_too_short';
      else if (runAge > MAX_VERIFIED_RUN_S) verificationReason = 'run_too_long';
      else if (session.beats < 1) verificationReason = 'heartbeat_missing';
      else if (coverage < MIN_COVERAGE_RATIO) verificationReason = 'heartbeat_coverage';
      else if (!totalsOk) verificationReason = 'run_total';
      else if (!finalOk) verificationReason = 'final_delta';
      else { verified = 1; verificationReason = 'verified'; }
    } else if (session?.used) {
      verificationReason = session.invalid_reason || 'session_used';
    } else if (session && session.player_id !== playerId) {
      verificationReason = 'session_owner_mismatch';
    }
    const alias = safeAlias(body.alias) || (telegramId ? `Игрок-${telegramId.slice(-4)}` : '');
    const rulesetVersion = session?.ruleset_version || RULESET_VERSION;
    try {
      db.exec('BEGIN IMMEDIATE');
      if (session && !session.used) qSessionUse.run(runId);
      qUpsertPlayer.run(playerId, telegramId, alias, now);
      qInsertRun.run(runId || null, playerId, score, distance, now, session?.started_at || null, now,
        verified, verificationReason, rulesetVersion);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    // Авто-регистрация призёра: игра открыта как Mini App, initData подписан —
    // значит игрок уже опознан, и код привязки ему не нужен. В личке с ботом
    // chat_id == user id, поэтому notify-winners сможет написать ему сразу.
    // ВАЖНО: сама запись НЕ гарантирует доставку — бот не может написать первым
    // тому, кто не нажимал /start (Telegram вернёт 403). Открывшие игру через
    // кнопку бота /start уже нажали; пришедшие по прямой ссылке на Mini App —
    // нет. Поэтому цепочка не рвётся молча: notify-winners печатает ошибку по
    // каждому недоставленному призу.
    json(res, {
      period: 'week', board: 'total', verified: !!verified, verificationReason,
      entries: boardEntries('week', 25, 'total'), me: boardMe('week', playerId, 'total'),
    }, 200, headers);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/alias') {
    if (!rateLimit('al:' + clientIp(req), 10)) { json(res, { error: 'rate_limited' }, 429, headers); return; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { json(res, { error: 'invalid_json' }, 400, headers); return; }
    const auth = authenticatePlayer(body);
    if (!auth) { json(res, { error: 'auth_required' }, 401, headers); return; }
    const alias = safeAlias(body.alias);
    if (!alias) { json(res, { error: 'invalid_alias' }, 400, headers); return; }
    qUpsertPlayer.run(auth.playerId, auth.telegramId, alias, Date.now());
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
server.listen(PORT, HOST, () => {
  console.log(`uboost-runner: http://${HOST}:${PORT} (static: ${STATIC_ROOT}, db: ${DB_PATH})`);
});
