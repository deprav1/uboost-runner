// Очки, статистика забега, комбо near-miss, жизни, рекорд в localStorage.
import { CONFIG } from '../../config.js';

// Анти-дребезг near-miss: игрок «дёргает» полосы, если за последнюю секунду
// сменил их больше лимита. Такой дребезг раньше засчитывал near-miss почти на
// каждой колонне (см. CONFIG.NEARMISS_MAX_MOVES_SEC), а честная игра — это
// 0.8 смены в секунду, поэтому лимит её не касается.
// Функция чистая и без аллокаций: moveTimes — кольцевой буфер фиксированной
// длины из main.js, нули означают «ещё не было манёвра».
export function laneThrash(moveTimes, now, limit = CONFIG.NEARMISS_MAX_MOVES_SEC ?? 3, windowMs = 1000) {
  let n = 0;
  for (let i = 0; i < moveTimes.length; i++) {
    const t = moveTimes[i];
    if (t > 0 && now - t <= windowMs) n++;
  }
  return n > limit;
}

export class Stats {
  constructor(tg = null) { this.tg = tg; this.reset(); this.best = this.loadBest(); }

  reset() {
    this.score = 0;
    this.distance = 0;     // «метры»
    this.combo = 0;
    this.bestCombo = 0;    // макс. комбо за забег (для миссий/бейджей)
    this.nearMisses = 0;
    this.smashes = 0;
    this.bits = 0;
    this.captchas = 0; this.geoblocks = 0; this.ads = 0; this.lags = 0;
    this.lives = CONFIG.START_LIVES;
    this.scoreMult = 1;    // множитель игровых очков (пикап X2 ставит X2_MULT)
  }

  addDistance(speed, dt) {
    this.distance += speed * dt * 0.02;
    this.score += speed * dt * 0.02 * CONFIG.SCORE_PER_METER * this.scoreMult;
  }

  dodge(stat) { this[stat]++; this.score += CONFIG.SCORE_PER_DODGE * this.scoreMult; }
  _bumpCombo() {
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
  }
  nearMiss() {
    this.nearMisses++;
    this._bumpCombo();
    this.score += CONFIG.SCORE_NEAR_MISS * Math.min(this.combo, CONFIG.COMBO_CAP) * this.scoreMult;
  }
  collectBit(mult = 1) { this.bits++; this.score += CONFIG.SCORE_BIT * mult * Math.min(1 + this.combo * 0.04, 3) * this.scoreMult; }
  // Удар не сжигает комбо в ноль, а срезает делителем — одна ошибка не
  // обесценивает серию, и вехи ×25/×50 остаются в пределах досягаемости.
  resetCombo() { this.combo = Math.floor(this.combo / CONFIG.COMBO_HIT_PENALTY_DIV); }
  // Смэш на бусте питает комбо — вехи достижимы не только чистым near-miss.
  smash() { this.smashes++; this._bumpCombo(); this.score += CONFIG.SCORE_SMASH * this.scoreMult; }

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
      this.pushBestToCloud(s);
      return true;
    }
    return false;
  }

  // Telegram CloudStorage переживает чистку WebView-хранилища (localStorage может
  // быть стёрт) — синхронизируем рекорд в обе стороны. Не критично: если
  // CloudStorage недоступен, всё работает только на localStorage как раньше.
  pushBestToCloud(value) {
    try { this.tg?.CloudStorage?.setItem?.('best', String(value), () => {}); } catch {}
  }

  // Подтягивает рекорд из CloudStorage и берёт максимум с локальным.
  // onUpdate(best) вызывается, если облачное значение оказалось больше.
  syncBestFromCloud(onUpdate) {
    if (!this.tg?.CloudStorage?.getItem) return;
    try {
      this.tg.CloudStorage.getItem('best', (err, value) => {
        if (err || !value) return;
        const cloudBest = parseInt(value, 10);
        if (!Number.isFinite(cloudBest)) return;
        if (cloudBest > this.best) {
          this.best = cloudBest;
          try {
            const data = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}');
            data.best = cloudBest;
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
          } catch {}
          onUpdate?.(cloudBest);
        } else if (cloudBest < this.best) {
          this.pushBestToCloud(this.best);
        }
      });
    } catch {}
  }
}
