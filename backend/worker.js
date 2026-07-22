// Cloudflare Worker + D1 для общей аналитики и доски результатов.
// Клиентские очки нельзя считать защищённым соревновательным результатом: это
// лёгкая вирусная доска. Для призов нужно серверно верифицировать весь забег.

const EVENTS = new Set([
  'landing', 'game_start', 'game_over', 'share', 'share_result', 'cta_click',
  'mission_done', 'badge_unlock', 'rank_up', 'zone_reached', 'tutorial_step',
  'pause', 'settings_change', 'captcha_result', 'session_n', 'challenge_opened',
  'gag_shown', 'quality_tier', 'promo_copy', 'client_error',
]);
const MAX_SCORE = 1_000_000;
const MAX_DISTANCE = 1_000_000;

function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((v) => v.trim()).filter(Boolean);
  const value = allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    ...(value ? { 'Access-Control-Allow-Origin': value, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
function json(value, status, headers) { return new Response(JSON.stringify(value), { status, headers }); }
function limit(value, max, fallback = 0) { return Math.max(0, Math.min(max, Math.floor(Number(value) || fallback))); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value); }
function safeAlias(value) { return String(value || '').replace(/[<>]/g, '').trim().slice(0, 24) || 'Игрок'; }

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmac(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}
function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''); }

// Алгоритм Telegram Mini Apps: HMAC(WebAppData, BOT_TOKEN), затем HMAC от
// отсортированного data-check-string. initData никогда не записывается в D1.
async function verifyTelegramInitData(raw, botToken) {
  if (!raw || !botToken) return null;
  try {
    const params = new URLSearchParams(raw);
    const receivedHash = params.get('hash') || '';
    const authDate = Number(params.get('auth_date') || 0);
    if (!receivedHash || !authDate || Math.abs(Date.now() / 1000 - authDate) > 86_400) return null;
    params.delete('hash');
    const dataCheck = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
    if (!sameHex(hex(await hmac(secret, dataCheck)), receivedHash)) return null;
    const user = JSON.parse(params.get('user') || '{}');
    const id = String(user?.id || '');
    return /^\d{3,20}$/.test(id) ? { id } : null;
  } catch { return null; }
}

export { verifyTelegramInitData };

async function rateLimit(request, env) {
  if (!env.SCORE_RATE) return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `score:${bucket}:${ip}`;
  const count = Number(await env.SCORE_RATE.get(key) || 0);
  if (count >= 6) return false;
  await env.SCORE_RATE.put(key, String(count + 1), { expirationTtl: 90 });
  return true;
}

async function leaderboard(env, limit = 10) {
  const rows = await env.DB.prepare(
    'SELECT player_id AS playerId, alias, score, distance, created_at AS createdAt FROM leaderboard_entries ORDER BY score DESC, distance DESC, created_at ASC LIMIT ?'
  ).bind(limit).all();
  return rows.results || [];
}

export default {
  async fetch(request, env) {
    const headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/v1/leaderboard') {
      return json({ entries: await leaderboard(env, limit(url.searchParams.get('limit'), 25, 10) || 10) }, 200, headers);
    }

    if (request.method === 'GET' && url.pathname === '/v1/dashboard') {
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const result = await env.DB.prepare(`
        SELECT
          SUM(CASE WHEN event = 'game_over' THEN 1 ELSE 0 END) AS runs,
          SUM(CASE WHEN event = 'share' THEN 1 ELSE 0 END) AS shares,
          SUM(CASE WHEN event = 'cta_click' THEN 1 ELSE 0 END) AS cta,
          AVG(CASE WHEN event = 'game_over' THEN json_extract(props_json, '$.distance') END) AS avgDistance
        FROM analytics_events WHERE created_at >= ?
      `).bind(since).first();
      const top = await env.DB.prepare('SELECT MAX(score) AS best FROM leaderboard_entries').first();
      const runs = Number(result?.runs) || 0;
      const cta = Number(result?.cta) || 0;
      return json({ overview: {
        best: Number(top?.best) || 0, runs, shares: Number(result?.shares) || 0,
        cta, avgDistance: Math.round(Number(result?.avgDistance) || 0),
        conversion: runs ? Math.round((cta / runs) * 100) : 0,
      } }, 200, headers);
    }

    if (request.method === 'POST' && url.pathname === '/v1/events') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400, headers); }
      if (!EVENTS.has(body?.event)) return json({ error: 'invalid_event' }, 400, headers);
      // Ограничиваем объём props и не принимаем initData/идентификаторы пользователя.
      const props = body?.props && typeof body.props === 'object' ? body.props : {};
      const serialized = JSON.stringify(props);
      if (serialized.length > 1200 || /initData|telegram|userId|phone|email/i.test(serialized)) return json({ error: 'invalid_props' }, 400, headers);
      let telegramId = null;
      if (body?.initData) {
        const telegram = await verifyTelegramInitData(body.initData, env.BOT_TOKEN);
        if (!telegram) return json({ error: 'invalid_telegram_auth' }, 401, headers);
        telegramId = telegram.id;
      }
      await env.DB.prepare('INSERT INTO analytics_events(event, telegram_id, props_json, created_at) VALUES (?, ?, ?, ?)')
        .bind(body.event, telegramId, serialized, Date.now()).run();
      return json({ ok: true }, 202, headers);
    }

    if (request.method === 'POST' && url.pathname === '/v1/scores') {
      if (!(await rateLimit(request, env))) return json({ error: 'rate_limited' }, 429, headers);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400, headers); }
      const telegram = await verifyTelegramInitData(body?.initData, env.BOT_TOKEN);
      if (!telegram) return json({ error: 'telegram_auth_required' }, 401, headers);
      const score = limit(body.score, MAX_SCORE);
      const distance = limit(body.distance, MAX_DISTANCE);
      if (score < 1 || distance < 1) return json({ error: 'invalid_score' }, 400, headers);
      const now = Date.now();
      await env.DB.prepare(`
        INSERT INTO leaderboard_entries(player_id, telegram_id, alias, score, distance, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
          telegram_id = excluded.telegram_id, alias = excluded.alias, score = excluded.score, distance = excluded.distance, created_at = excluded.created_at
        WHERE excluded.score > leaderboard_entries.score
           OR (excluded.score = leaderboard_entries.score AND excluded.distance > leaderboard_entries.distance)
      `).bind(`tg:${telegram.id}`, telegram.id, safeAlias(body.alias) || `Игрок-${telegram.id.slice(-4)}`, score, distance, now).run();
      return json({ entries: await leaderboard(env, 10) }, 200, headers);
    }

    return json({ error: 'not_found' }, 404, headers);
  },
};
