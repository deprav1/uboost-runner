// Очки, статистика забега, комбо near-miss, жизни, рекорд в localStorage.
import { CONFIG } from '../../config.js';

export class Stats {
  constructor() { this.reset(); this.best = this.loadBest(); }

  reset() {
    this.score = 0;
    this.distance = 0;     // «метры»
    this.combo = 0;
    this.bits = 0;
    this.captchas = 0; this.geoblocks = 0; this.ads = 0; this.lags = 0;
    this.lives = CONFIG.START_LIVES;
  }

  addDistance(speed, dt) {
    this.distance += speed * dt * 0.02;
    this.score += speed * dt * 0.02 * CONFIG.SCORE_PER_METER;
  }

  dodge(stat) { this[stat]++; this.score += CONFIG.SCORE_PER_DODGE; }
  nearMiss() { this.combo++; this.score += CONFIG.SCORE_NEAR_MISS * Math.min(this.combo, 8); }
  collectBit() { this.bits++; this.score += CONFIG.SCORE_BIT * Math.min(1 + this.combo * 0.04, 3); }
  resetCombo() { this.combo = 0; }
  smash() { this.score += CONFIG.SCORE_SMASH; }

  // Жизни: loseLife возвращает true если игрок ещё жив (жизни > 0 после потери)
  loseLife() {
    if (this.lives > 0) this.lives--;
    return this.lives > 0;
  }
  gainLife() { if (this.lives < CONFIG.MAX_LIVES) this.lives++; }

  get scoreInt() { return Math.floor(this.score); }
  get distInt() { return Math.floor(this.distance); }

  loadBest() {
    try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY))?.best || 0; }
    catch { return 0; }
  }

  commitBest() {
    const s = this.scoreInt;
    if (s > this.best) {
      this.best = s;
      try {
        const data = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}');
        data.best = s;
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
      } catch {}
      return true;
    }
    return false;
  }
}
