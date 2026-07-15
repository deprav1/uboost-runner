// Локальный срез прогресса. Не содержит Telegram initData, IP, имени или
// иных персональных данных; нужен и как офлайн-фолбэк для общего дашборда.
import { CONFIG } from '../../config.js';

const KEY = 'uboost_runner_dashboard_v1';
const EVENT_LIMIT = 80;

function blank() {
  return { version: 1, sessions: 0, runs: 0, totalScore: 0, totalDistance: 0, shares: 0, cta: 0, events: [] };
}

function read() {
  try { return { ...blank(), ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; }
  catch { return blank(); }
}

export class DashboardStore {
  constructor() { this.data = read(); }

  track(event, props = {}) {
    if (event === 'game_start') this.data.sessions++;
    if (event === 'game_over') {
      this.data.runs++;
      this.data.totalScore += Math.max(0, Number(props.score) || 0);
      this.data.totalDistance += Math.max(0, Number(props.distance) || 0);
    }
    if (event === 'share') this.data.shares++;
    if (event === 'cta_click') this.data.cta++;
    this.data.events.push({ event, ts: Date.now() });
    if (this.data.events.length > EVENT_LIMIT) this.data.events.splice(0, this.data.events.length - EVENT_LIMIT);
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {}
  }

  overview(best = 0) {
    const runs = this.data.runs;
    return {
      best: Math.max(0, Number(best) || 0),
      runs,
      avgDistance: runs ? Math.round(this.data.totalDistance / runs) : 0,
      shares: this.data.shares,
      cta: this.data.cta,
      conversion: runs ? Math.round((this.data.cta / runs) * 100) : 0,
    };
  }
}

// Общий срез — необязательный. Если endpoint не настроен или временно недоступен,
// интерфейс продолжает показывать локальные числа без ложной маркировки «глобально».
export async function loadGlobalDashboard(endpoint) {
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('dashboard endpoint');
    const value = (await res.json()).overview || {};
    return {
      best: Math.max(0, Number(value.best) || 0),
      runs: Math.max(0, Number(value.runs) || 0),
      avgDistance: Math.max(0, Math.round(Number(value.avgDistance) || 0)),
      shares: Math.max(0, Number(value.shares) || 0),
      cta: Math.max(0, Number(value.cta) || 0),
      conversion: Math.max(0, Math.round(Number(value.conversion) || 0)),
    };
  } catch { return null; }
}

// Один адаптер доставляет событие в локальный дашборд и, когда настроен URL,
// на сервер. Ошибка сети никогда не влияет на игру.
export function dashboardAnalytics(store, endpoint = CONFIG.ANALYTICS_ENDPOINT, identity = null) {
  return {
    track(event, props) {
      store.track(event, props);
      if (!endpoint) return;
      try {
        // ID отправляется только в подписанном initData. Сам raw payload не
        // сохраняется клиентом, а Worker оставляет лишь проверенный telegram_id.
        const body = JSON.stringify({ event, props, initData: identity?.initData || undefined });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        } else {
          fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        }
      } catch {}
    },
  };
}
