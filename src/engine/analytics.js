// Provider-agnostic analytics. Replace the default stub via Analytics.use(adapter).
// Adapter contract: { track(event: string, props: object): void }
import { CONFIG } from '../../config.js';

let _adapter = {
  track(event, props) {
    if (typeof console !== 'undefined') console.debug('[analytics]', event, props);
  },
};
let _context = {};
const randomId = () => {
  try { return globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36); }
  catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
};
const _sessionId = randomId();
function track(event, props = {}) {
  _adapter.track(event, {
    schemaVersion: 2,
    eventId: randomId(),
    sessionId: _sessionId,
    ..._context,
    ...props,
    occurredAt: Date.now(),
  });
}

// Готовый адаптер: шлёт события на свой эндпоинт через sendBeacon (или fetch).
// Пример: Analytics.use(httpBeacon('https://api.example.com/track'));
export function httpBeacon(endpoint) {
  return {
    track(event, props) {
      const payload = JSON.stringify({ event, props });
      try {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
          return;
        }
        if (typeof fetch !== 'undefined') {
          fetch(endpoint, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true });
        }
      } catch {}
    },
  };
}

// События в Метрике отправляем только для измеримых шагов воронки. Это не
// замена внутренней аналитике: подробные run_summary остаются в нашем endpoint,
// а в рекламном кабинете видны компактные цели, пригодные для оптимизации.
const METRIKA_GOALS = {
  landing: 'ad_landing',
  game_start: 'game_start',
  game_over: 'game_complete',
  share: 'share',
  cta_click: 'store_click',
  telegram_click: 'telegram_open',
};

export function yandexMetrika(counterId) {
  return {
    track(event, props = {}) {
      const goal = METRIKA_GOALS[event];
      if (!goal || !Number(counterId)) return;
      try {
        // Не передаём в Метрику initData, user-agent или другие идентификаторы.
        // Числа результата помогают сегментировать качество трафика, а UTM
        // счётчик получает автоматически из URL первого визита.
        const params = {};
        for (const key of ['score', 'distance', 'lives', 'variant', 'durationMs']) {
          if (props[key] !== undefined) params[key] = props[key];
        }
        globalThis.ym?.(counterId, 'reachGoal', goal, params);
      } catch {}
    },
  };
}

export function combineAnalytics(...adapters) {
  return {
    track(event, props) {
      for (const adapter of adapters) {
        try { adapter?.track?.(event, props); } catch {}
      }
    },
  };
}

export const Analytics = {
  use(adapter) { _adapter = adapter; },
  setContext(context) { _context = { ..._context, ...context }; },

  gameStart() {
    track('game_start');
  },

  promoCopy({ code, ok }) {
    // Скопированный промокод — измеримое звено между игрой и активацией скидки.
    track('promo_copy', { code, ok });
  },

  landing({ variant, ref }) {
    // ref = playerId пригласившего из ссылки-вызова — атрибуция виральной петли.
    track('landing', ref ? { variant, ref } : { variant });
  },

  gameOver({ score, distance, lives, captchas, geoblocks, ads, lags }) {
    track('game_over', { score, distance, lives, captchas, geoblocks, ads, lags });
  },

  // Один агрегат на забег: никаких покадровых сетевых событий.
  runSummary(props) {
    track('run_summary', props);
  },

  share({ score, distance }) {
    track('share', { score, distance });
  },

  shareResult({ method, ok }) {
    track('share_result', { method, ok });
  },

  ctaClick({ score, distance }) {
    track('cta_click', { score, distance });
  },

  telegramClick({ placement = 'start_web' } = {}) {
    track('telegram_click', { placement });
  },

  // Мета-прогрессия (progress.js): миссии, бейджи, повышение звания.
  missionDone({ id }) {
    track('mission_done', { id });
  },

  badgeUnlock({ id }) {
    track('badge_unlock', { id });
  },

  rankUp({ rankId }) {
    track('rank_up', { rankId });
  },

  // Визуальные зоны (world.js): вход в новую зону по дистанции.
  zoneReached({ zone }) {
    track('zone_reached', { zone });
  },

  // FTUE: показан очередной шаг туториала.
  tutorialStep({ step }) {
    track('tutorial_step', { step });
  },

  // Пауза: action = 'enter' (сворачивание/кнопка) | 'resume' (запрошено возобновление).
  pause({ action }) {
    track('pause', { action });
  },

  // Изменение настройки доступности/звука: ключ + новое значение.
  settingsChange({ key, value }) {
    track('settings_change', { key, value });
  },

  // Авто-подсказка лёгкого режима: action = 'shown' | 'accepted' | 'declined'.
  // Нужна, чтобы измерить принятие — иначе непонятно, помогает предложение или
  // только мешает. Отдельное событие, а не settings_change: показ подсказки —
  // не изменение настройки.
  liteHint({ action, frameAvgMs }) {
    track('lite_hint', { action, frameAvgMs });
  },

  // Капча-мини-игра: result = 'solved' | 'failed'.
  captchaResult({ result }) {
    track('captcha_result', { result });
  },

  // Порядковый номер забега в профиле (n = gamesPlayed + 1 на старте).
  session({ n }) {
    track('session_n', { n });
  },

  challengeOpened({ score }) {
    track('challenge_opened', { score });
  },

  gagShown({ type }) {
    track('gag_shown', { type });
  },

  qualityChanged({ tier, reason = 'adaptive' }) {
    track('quality_tier', { tier, reason });
  },

  // Сохраняет атрибуцию рекламного визита: нельзя подменять utm_source=adfox
  // на game, иначе покупка на платёжном сайте потеряет исходный источник.
  storeUrl(source = 'game', medium = 'cta', campaign = 'runner') {
    try {
      const u = new URL(CONFIG.STORE_URL);
      const inbound = new URLSearchParams(globalThis.location?.search || '');
      const defaults = { utm_source: source, utm_medium: medium, utm_campaign: campaign };
      for (const [key, fallback] of Object.entries(defaults)) {
        u.searchParams.set(key, inbound.get(key) || fallback);
      }
      // Склейка визита продолжается и на другом домене магазина.
      for (const key of ['utm_content', 'utm_term', 'yclid', 'gclid']) {
        const value = inbound.get(key);
        if (value) u.searchParams.set(key, value);
      }
      return u.toString();
    } catch {
      return CONFIG.STORE_URL;
    }
  },
};
