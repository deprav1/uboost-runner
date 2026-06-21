// Мем-биллборды на обочинах дороги. Рождаются у горизонта и с ускорением
// проносятся мимо камеры (масштабируются по перспективе). Чистая атмосфера —
// не сталкиваются, ни на что не влияют. Контент — мемы рунета из strings.js.
import { CONFIG } from '../../config.js';
import { neonRect, neonText, roundRectPath } from '../engine/render.js';
import { STR, pick, bagPick } from '../ui/strings.js';

const C = CONFIG.COLORS;

// Один щит на обочине.
class Sign {
  constructor(side, text, color) {
    this.side = side;                              // −1 слева, +1 справа
    this.laneNorm = side * (CONFIG.RUN.SHOULDER + 0.22); // дальше от gameplay-коридора
    this.z = 1.0;
    this.text = text;
    this.color = color;
    this.dead = false;
    this.phase = Math.random() * 6.28;
  }

  update(dt, speed) {
    this.z -= speed * dt * CONFIG.RUN.Z_RATE;
    if (this.z < -0.06) this.dead = true;
  }

  draw(ctx, geom, t) {
    const { x, y, scale } = geom.project(this.laneNorm, this.z);
    if (scale <= 0.001) return;
    const w = geom.unit * 1.28 * scale;
    const h = geom.unit * 0.78 * scale;
    const poleH = geom.unit * 0.7 * scale;
    const panelY = y - poleH - h;                  // щит стоит над «землёй»

    ctx.save();
    // опора-столб к дороге
    ctx.strokeStyle = 'rgba(120,140,200,0.35)';
    ctx.lineWidth = Math.max(1, geom.unit * 0.05 * scale);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, panelY + h); ctx.stroke();

    // панель щита — из оффскрин-кэша (дорогие neon-вызовы один раз на текст+цвет),
    // мерцание неона — альфой поверх готового спрайта
    const flick = 0.48 + Math.sin(t * 5 + this.phase) * 0.08;
    ctx.globalAlpha = flick;
    const spr = signSprite(this.text, this.color);
    if (spr) ctx.drawImage(spr, x - w / 2, panelY, w, h);
    ctx.restore();
  }
}

// --- Оффскрин-кэш панелей (ключ: текст|цвет) ----------------------------------
const SIGN_CACHE_W = 240;
const SIGN_RATIO = 0.92 / 1.5; // h/w из габаритов щита
const signCache = new Map();

function signSprite(text, color) {
  const key = text + '|' + color;
  let cv = signCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = SIGN_CACHE_W; cv.height = Math.round(SIGN_CACHE_W * SIGN_RATIO);
    const c = cv.getContext('2d');
    if (!c) return null;
    const w = cv.width, h = cv.height;
    neonRect(c, 2, 2, w - 4, h - 4, color, { fill: 'rgba(8,6,22,0.72)', glow: 7, radius: 9, lw: 1.5 });
    c.fillStyle = color;
    roundRectPath(c, 2, 2, w - 4, (h - 4) * 0.2, 7);
    c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    neonText(c, text, w / 2, h * 0.58, { color: '#d9dde3', size: h * 0.18, glow: 3, weight: '800' });
    signCache.set(key, cv);
  }
  return cv;
}

export class Billboards {
  constructor() {
    this.signs = [];
    this.cd = 0.6;
    this._spawnCount = 0;
    this._quiet = 0;
    // пул мемов: гэг-фразы + ярлыки препятствий
    this._pool = [
      ...STR.gagSber, ...STR.gagRkn, ...STR.gagAd,
      ...Object.values(STR.obstacleLabels).flat(),
    ].filter(Boolean);
    this._colors = [C.warn, C.red, C.redBright, C.data];
  }

  clear() { this.signs = []; this.cd = 0.6; this._spawnCount = 0; this._quiet = 0; }

  update(dt, speed, canSpawn) {
    for (const s of this.signs) s.update(dt, speed);
    // in-place компакция мёртвых (без аллокации массива на кадр)
    let w = 0;
    for (let r = 0; r < this.signs.length; r++) { const s = this.signs[r]; if (!s.dead) this.signs[w++] = s; }
    this.signs.length = w;

    if (!canSpawn) return;
    if (this._quiet > 0) {
      this._quiet -= dt;
      return;
    }
    this.cd -= dt;
    if (this.cd <= 0 && this.signs.length === 0) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const text = (bagPick(this._pool) || 'ВПН').toUpperCase();
      const color = pick(this._colors);
      this.signs.push(new Sign(side, text, color));
      this._spawnCount++;
      this.cd = CONFIG.BILLBOARD_EVERY + Math.random() * CONFIG.BILLBOARD_JITTER;
      if (this._spawnCount % CONFIG.DECOR_QUIET_EVERY === 0) {
        this._quiet = CONFIG.DECOR_QUIET_DURATION;
      }
    }
  }
}
