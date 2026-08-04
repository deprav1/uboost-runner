// Доска результатов: работает локально без сервера и автоматически переходит
// на общую доску, когда в config.js задан LEADERBOARD_ENDPOINT.
// Общая доска двухпериодная (неделя / всё время), знает твой ранг и рефералов,
// а результат забега защищён анти-чит токеном (GET /v1/token на старте забега).
import { CONFIG } from '../../config.js';

const KEY = 'uboost_runner_leaderboard_v1';
const ID_KEY = 'uboost_runner_player_id_v1';
const SECRET_KEY = 'uboost_runner_player_secret_v1';
const NAME_KEY = 'uboost_runner_player_name_v1';
const MAX_LOCAL = 20;
const MAX_NAME = 16;

function safeRead() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function playerId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch { return 'offline'; }
}
function playerSecret() {
  try {
    let secret = localStorage.getItem(SECRET_KEY);
    if (!/^[0-9a-f]{64}$/.test(secret || '')) {
      const bytes = new Uint8Array(32);
      if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
        secret = [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
      } else {
        secret = Array.from({ length: 8 }, () => Math.random().toString(16).slice(2).padEnd(8, '0').slice(0, 8)).join('');
      }
      localStorage.setItem(SECRET_KEY, secret);
    }
    return secret;
  } catch { return ''; }
}
function autoAlias(id) { return `Игрок-${id.slice(-4).toUpperCase()}`; }
function newRunId() {
  try {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch {
    return Array.from({ length: 4 }, () => Math.random().toString(16).slice(2).padEnd(8, '0').slice(0, 8)).join('');
  }
}
export function sanitizeName(value) { return String(value || '').replace(/[<>]/g, '').trim().slice(0, MAX_NAME); }
function normalize(entry) {
  return {
    playerId: String(entry.playerId || ''), publicId: String(entry.publicId || ''),
    alias: String(entry.alias || 'Игрок').slice(0, 24),
    score: Math.max(0, Math.floor(Number(entry.score) || 0)),
    distance: Math.max(0, Math.floor(Number(entry.distance) || 0)),
    createdAt: Number(entry.createdAt) || Date.now(),
    runs: Math.max(0, Math.floor(Number(entry.runs) || 0)), // забегов (суммарная доска)
    tg: !!entry.tg,             // Telegram привязан (значок доверия на доске)
    verified: !!entry.verified, // забег наблюдался сервером (heartbeat-сессия)
    you: !!entry.you,
  };
}
function sort(entries) { return entries.slice().sort((a, b) => b.score - a.score || b.distance - a.distance || a.createdAt - b.createdAt); }

export class Leaderboard {
  constructor(endpoint = CONFIG.LEADERBOARD_ENDPOINT, limit = CONFIG.LEADERBOARD_LIMIT, identity = null) {
    this.endpoint = endpoint;
    this.limit = limit;
    this.identity = identity;
    this.id = identity?.userId ? `tg:${identity.userId}` : playerId();
    this.playerSecret = identity?.initData ? '' : playerSecret();
    this.publicId = '';
    this.identityPromise = null;
    this.local = sort(safeRead().map(normalize));
    this.entries = this.local.slice(0, limit);
    this.mode = endpoint ? 'loading' : 'local';
    this.period = 'week';      // week | all — активный период общей доски
    this.board = CONFIG.LEADERBOARD_BOARD === 'total' ? 'total' : 'best'; // best = разовые рекорды | total = суммарный пробег
    this.me = null;            // {rank, score, total, referrals} с сервера
    this.token = null;         // анти-чит токен текущего забега (фолбэк)
    this.runId = null;         // heartbeat-сессия текущего забега (verified-путь)
    this.beatSeq = 0;          // монотонная последовательность исключает reorder/replay
    this.beatInFlight = false;
  }

  credentials() {
    return {
      playerId: this.id,
      playerSecret: this.playerSecret || undefined,
      initData: this.identity?.initData || undefined,
    };
  }

  async ensureIdentity() {
    if (!this.endpoint || this.publicId) return this.publicId;
    if (this.identityPromise) return this.identityPromise;
    this.identityPromise = (async () => {
      try {
        const res = await fetch(this.endpoint.replace(/\/$/, '') + '/v1/player/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.credentials()),
        });
        const body = res.ok ? await res.json() : null;
        if (body?.publicId) this.publicId = String(body.publicId);
      } catch {}
      return this.publicId;
    })().finally(() => { this.identityPromise = null; });
    return this.identityPromise;
  }

  // --- Имя игрока (вводит сам, живёт в localStorage) -------------------------
  name() {
    try { return sanitizeName(localStorage.getItem(NAME_KEY)); } catch { return ''; }
  }
  alias() { return this.name() || autoAlias(this.id); }
  async setName(value) {
    const name = sanitizeName(value);
    try { name ? localStorage.setItem(NAME_KEY, name) : localStorage.removeItem(NAME_KEY); } catch {}
    // Локальная доска: переименовать свои записи сразу.
    this.local = this.local.map((e) => e.playerId === this.id ? { ...e, alias: this.alias() } : e);
    try { localStorage.setItem(KEY, JSON.stringify(this.local)); } catch {}
    if (!this.endpoint || !name) return;
    try {
      await this.ensureIdentity();
      await fetch(this.endpoint.replace(/\/$/, '') + '/v1/alias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...this.credentials(), alias: name }),
      });
    } catch {}
  }

  // --- Анти-чит токен: берётся на старте забега, тратится на сабмите ----------
  armToken() {
    if (!this.endpoint) return;
    this.token = null;
    fetch(this.endpoint.replace(/\/$/, '') + '/v1/token', { headers: { Accept: 'application/json' } })
      .then((res) => res.ok ? res.json() : null)
      .then((body) => { if (body?.token) this.token = body.token; })
      .catch(() => {});
  }

  // --- Heartbeat-сессия: сервер наблюдает забег вживую → результат verified ----
  startRun() {
    // ID создаётся до сети: даже если /run/start запоздает, повторный submit
    // останется идемпотентным и не раздует суммарную доску.
    this.runId = newRunId();
    this.beatSeq = 0;
    this.beatInFlight = false;
    if (!this.endpoint) return;
    fetch(this.endpoint.replace(/\/$/, '') + '/v1/run/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...this.credentials(), runId: this.runId, rulesetVersion: CONFIG.RULESET_VERSION }),
    })
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (!ok && body?.error === 'ruleset_mismatch') {
          this.runId = null;
          try { window.dispatchEvent(new CustomEvent('uboost:ruleset-mismatch', { detail: body.rulesetVersion })); } catch {}
          return;
        }
        if (body?.runId) this.runId = body.runId;
        if (body?.publicId) this.publicId = String(body.publicId);
      })
      .catch(() => {});
  }

  async beat(score, distance) {
    if (!this.endpoint || !this.runId || this.beatInFlight) return;
    this.beatInFlight = true;
    const seq = this.beatSeq + 1;
    try {
      const res = await fetch(this.endpoint.replace(/\/$/, '') + '/v1/run/beat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...this.credentials(), runId: this.runId, seq, score, distance }), keepalive: true,
      });
      const body = await res.json().catch(() => null);
      if (Number.isInteger(body?.lastSeq)) this.beatSeq = Math.max(this.beatSeq, body.lastSeq);
      else if (Number.isInteger(body?.expectedSeq)) this.beatSeq = Math.max(0, body.expectedSeq - 1);
    } catch {}
    finally { this.beatInFlight = false; }
  }

  // --- Привязка Telegram (идентификация победителей) --------------------------
  async linkStatus() {
    if (!this.endpoint) return null;
    try {
      const res = await fetch(this.endpoint.replace(/\/$/, '') + '/v1/link/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.credentials()),
      });
      const body = res.ok ? await res.json() : null;
      if (body?.publicId) this.publicId = String(body.publicId);
      return body;
    } catch { return null; }
  }

  localEntry(run) {
    return normalize({ ...run, playerId: this.id, alias: this.alias(), createdAt: Date.now() });
  }

  saveLocal(entry) {
    // Одна лучшая попытка игрока на локальной доске, чтобы она оставалась честной
    // и читаемой, а не состояла из десяти одинаковых строк.
    const other = this.local.filter((e) => e.playerId !== entry.playerId);
    const old = this.local.find((e) => e.playerId === entry.playerId);
    this.local = sort([...other, !old || entry.score >= old.score ? entry : old]).slice(0, MAX_LOCAL);
    try { localStorage.setItem(KEY, JSON.stringify(this.local)); } catch {}
    this.entries = this.local.slice(0, this.limit);
  }

  applyServer(body) {
    if (body.board) this.board = body.board;
    if (body?.me?.publicId) this.publicId = String(body.me.publicId);
    if (body?.publicId) this.publicId = String(body.publicId);
    const normalized = (body.entries || []).map((entry) => {
      const value = normalize(entry);
      return { ...value, you: !!value.publicId && value.publicId === this.publicId };
    });
    // Суммарная доска ранжируется по пробегу, разовая — по очкам.
    this.entries = (this.board === 'total'
      ? normalized.slice().sort((a, b) => b.distance - a.distance || b.score - a.score)
      : sort(normalized)
    ).slice(0, this.limit);
    this.me = body.me || null;
    if (body.period) this.period = body.period;
    this.mode = 'global';
  }

  async submit(run) {
    const entry = this.localEntry(run);
    this.saveLocal(entry);
    if (!this.endpoint) return { entries: this.entries, mode: 'local' };
    try {
      const res = await fetch(this.endpoint.replace(/\/$/, '') + '/v1/scores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // initData не попадает в аналитику, localStorage или DOM. Он передаётся
        // только на призовой endpoint и сервер сразу преобразует его в ID.
        body: JSON.stringify({
          ...entry, ...this.credentials(), token: this.token || '', runId: this.runId || '',
          rulesetVersion: CONFIG.RULESET_VERSION,
        }), keepalive: true,
      });
      if (!res.ok) throw new Error('score endpoint');
      this.applyServer(await res.json());
    } catch { this.mode = 'offline'; }
    return { entries: this.entries, mode: this.mode, me: this.me };
  }

  async refresh(period = this.period, board = this.board) {
    this.period = period === 'all' ? 'all' : 'week';
    this.board = board === 'total' ? 'total' : 'best';
    if (!this.endpoint) { this.mode = 'local'; this.entries = this.local.slice(0, this.limit); return { entries: this.entries, mode: this.mode }; }
    try {
      await this.ensureIdentity();
      const url = this.endpoint.replace(/\/$/, '') + '/v1/leaderboard'
        + '?limit=' + encodeURIComponent(this.limit)
        + '&period=' + encodeURIComponent(this.period)
        + '&board=' + encodeURIComponent(this.board)
        + (this.publicId ? '&me=' + encodeURIComponent(this.publicId) : '');
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('leaderboard endpoint');
      this.applyServer(await res.json());
    } catch { this.mode = 'offline'; this.me = null; this.entries = this.local.slice(0, this.limit); }
    return { entries: this.entries, mode: this.mode, me: this.me };
  }
}
