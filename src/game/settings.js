// Настройки игрока и доступность. Хранится в том же localStorage-блобе
// (CONFIG.STORAGE_KEY), что и рекорд/мьют — без новых ключей.
// fx() — единая точка гейтинга визуальных эффектов (reduced motion).
import { CONFIG } from '../../config.js';

function loadBlob() {
  try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}') || {}; }
  catch { return {}; }
}

export function loadFlag(key, def) {
  const d = loadBlob();
  return d[key] ?? def;
}

export function saveFlag(key, val) {
  try {
    const d = loadBlob();
    d[key] = val;
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(d));
  } catch {}
}

const DEFAULTS = {
  graphics: 'auto',      // auto = адаптивное качество | lite = лёгкая графика
                         // (тир 0 + DPR 1) для слабых устройств. Только косметика.
  reducedMotion: 'auto', // auto = по prefers-reduced-motion ОС | on | off
  colorAssist: false,    // дублировать «летальность» формой, не только цветом
  swipeSens: 1,          // индекс в CONFIG.INPUT.SWIPE_LEVELS
  uiScale: 1,            // 0 мелкий | 1 обычный | 2 крупный
  tutorialDone: false,   // FTUE показан и завершён — больше не показываем
};

export class SettingsStore {
  constructor() {
    const saved = loadFlag('settings', null);
    this.data = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    // битые значения → дефолты (storage мог писаться старой версией)
    if (!['auto', 'lite'].includes(this.data.graphics)) this.data.graphics = DEFAULTS.graphics;
    if (!['auto', 'on', 'off'].includes(this.data.reducedMotion)) this.data.reducedMotion = DEFAULTS.reducedMotion;
    if (![0, 1, 2].includes(this.data.swipeSens)) this.data.swipeSens = DEFAULTS.swipeSens;
    if (![0, 1, 2].includes(this.data.uiScale)) this.data.uiScale = DEFAULTS.uiScale;
    this.data.colorAssist = !!this.data.colorAssist;
    this.data.tutorialDone = !!this.data.tutorialDone;
  }

  get(key) { return this.data[key]; }

  set(key, val) {
    this.data[key] = val;
    saveFlag('settings', this.data);
  }

  // Лёгкая графика: игрок явно выбрал fps вместо красоты (слабое устройство).
  liteGraphics() { return this.data.graphics === 'lite'; }

  reducedMotionActive() {
    const m = this.data.reducedMotion;
    if (m === 'on') return true;
    if (m === 'off') return false;
    try { return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false; }
    catch { return false; }
  }

  // Гейтинг эффектов: при reduced motion — без шейка/строба, приглушённые вспышки.
  fx() {
    return this.reducedMotionActive()
      ? { shakeMul: 0, flashMax: 0.25, glitchOn: false, grainOn: false }
      : { shakeMul: 1, flashMax: 1, glitchOn: true, grainOn: true };
  }

  swipePx() {
    return CONFIG.INPUT.SWIPE_LEVELS[this.data.swipeSens] ?? CONFIG.INPUT.SWIPE_LEVELS[1];
  }

}

export const Settings = new SettingsStore();
