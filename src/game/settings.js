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
  reducedMotion: 'auto', // auto = по prefers-reduced-motion ОС | on | off
  colorAssist: false,    // дублировать «летальность» формой, не только цветом
  swipeSens: 1,          // индекс в CONFIG.INPUT.SWIPE_LEVELS
  uiScale: 1,            // 0 мелкий | 1 обычный | 2 крупный
  tutorialDone: false,   // FTUE показан и завершён — больше не показываем
  difficulty: CONFIG.DIFFICULTY.DEFAULT, // 'easy' | 'normal' | 'hard' — CONFIG.DIFFICULTY.PRESETS
};

export class SettingsStore {
  constructor() {
    const saved = loadFlag('settings', null);
    this.data = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    // битые значения → дефолты (storage мог писаться старой версией)
    if (!['auto', 'on', 'off'].includes(this.data.reducedMotion)) this.data.reducedMotion = DEFAULTS.reducedMotion;
    if (![0, 1, 2].includes(this.data.swipeSens)) this.data.swipeSens = DEFAULTS.swipeSens;
    if (![0, 1, 2].includes(this.data.uiScale)) this.data.uiScale = DEFAULTS.uiScale;
    if (!CONFIG.DIFFICULTY.LEVELS.includes(this.data.difficulty)) this.data.difficulty = DEFAULTS.difficulty;
    this.data.colorAssist = !!this.data.colorAssist;
    this.data.tutorialDone = !!this.data.tutorialDone;
  }

  get(key) { return this.data[key]; }

  set(key, val) {
    this.data[key] = val;
    saveFlag('settings', this.data);
  }

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

  difficultyPreset() {
    return CONFIG.DIFFICULTY.PRESETS[this.data.difficulty] ?? CONFIG.DIFFICULTY.PRESETS[CONFIG.DIFFICULTY.DEFAULT];
  }
}

export const Settings = new SettingsStore();
