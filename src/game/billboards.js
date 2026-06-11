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
    this.laneNorm = side * CONFIG.RUN.SHOULDER;    // позиция за краем дороги
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
    const w = geom.unit * 1.5 * scale;
    const h = geom.unit * 0.92 * scale;
    const poleH = geom.unit * 0.7 * scale;
    const panelY = y - poleH - h;                  // щит стоит над «землёй»

    ctx.save();
    // опора-столб к дороге
    ctx.strokeStyle = 'rgba(120,140,200,0.35)';
    ctx.lineWidth = Math.max(1, geom.unit * 0.05 * scale);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, panelY + h); ctx.stroke();

    // панель щита — из оффскрин-кэша (дорогие neon-вызовы один раз на текст+цвет),
    // мерцание неона — альфой поверх готового спрайта
    const flick = 0.82 + Math.sin(t * 9 + this.phase) * 0.18;
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
    neonRect(c, 2, 2, w - 4, h - 4, color, { fill: 'rgba(8,6,22,0.9)', glow: 18, radius: 9, lw: 2 });
    c.fillStyle = color;
    roundRectPath(c, 2, 2, w - 4, (h - 4) * 0.2, 7);
    c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    neonText(c, text, w / 2, h * 0.58, { color: '#fff', size: h * 0.2, glow: 8, weight: '900' });
    signCache.set(key, cv);
  }
  return cv;
}

export class Billboards {
  constructor() {
    this.signs = [];
    this.cd = 0.6;
    // пул мемов: гэг-фразы + ярлыки препятствий
    this._pool = [
      ...STR.gagSber, ...STR.gagRkn, ...STR.gagAd,
      ...Object.values(STR.obstacleLabels).flat(),
    ].filter(Boolean);
    this._colors = [C.warn, C.red, C.redBright, C.data];
  }

  clear() { this.signs = []; this.cd = 0.6; }

  update(dt, speed, canSpawn) {
    for (const s of this.signs) s.update(dt, speed);
    this.signs = this.signs.filter((s) => !s.dead);

    if (!canSpawn) return;
    this.cd -= dt;
    if (this.cd <= 0) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const text = (bagPick(this._pool) || 'ВПН').toUpperCase();
      const color = pick(this._colors);
      this.signs.push(new Sign(side, text, color));
      this.cd = CONFIG.BILLBOARD_EVERY + Math.random() * CONFIG.BILLBOARD_JITTER;
    }
  }
}
