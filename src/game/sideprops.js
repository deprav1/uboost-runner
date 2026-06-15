// Боковые мем-детали: декоративные пропсы на обочинах дороги.
// Они не сталкиваются с игроком и не читаются как препятствия: ниже альфа,
// дальше от трассы, меньше контраст, медленный спавн.
import { CONFIG } from '../../config.js';
import { floorGlow, neonRect, neonText, roundRectPath, FONT } from '../engine/render.js';
import { bagPick } from '../ui/strings.js';

const C = CONFIG.COLORS;

const KINDS = [
  { id: 'bags', label: 'ПАКЕТЫ', w: 1.05, h: 0.92, color: C.redBright },
  { id: 'ticket', label: 'ТАЛОН\nА-404', w: 0.82, h: 1.08, color: C.warn },
  { id: 'delivery', label: '99\nМИН', w: 1.15, h: 0.7, color: C.red },
  { id: 'cookies', label: 'ПРИНЯТЬ\nВСЁ', w: 1.0, h: 0.8, color: C.white },
  { id: 'portal', label: '30\nДНЕЙ', w: 0.92, h: 0.92, color: C.warnDeep },
];

class SideProp {
  constructor(side, kind) {
    this.side = side;
    this.kind = kind;
    this.laneNorm = side * (CONFIG.RUN.SHOULDER + 0.16 + Math.random() * 0.24);
    this.z = 1.04 + Math.random() * 0.12;
    this.dead = false;
    this.phase = Math.random() * Math.PI * 2;
  }

  update(dt, speed) {
    this.z -= speed * dt * CONFIG.RUN.Z_RATE * 0.62;
    if (this.z < -0.08) this.dead = true;
  }

  draw(ctx, geom, t) {
    const { x, y, scale, p } = geom.project(this.laneNorm, this.z);
    if (scale <= 0.001) return;

    const w = geom.unit * this.kind.w * scale;
    const h = geom.unit * this.kind.h * scale;
    const bob = Math.sin(t * 2.2 + this.phase) * geom.unit * 0.012 * scale;
    const alpha = Math.min(0.72, 0.22 + p * 0.5);
    const spr = propSprite(this.kind.id, this.kind.label, this.kind.color);

    ctx.save();
    ctx.globalAlpha = alpha;
    floorGlow(ctx, x, y + h * 0.24, w * 0.5, this.kind.color, 0.12);
    if (spr) ctx.drawImage(spr, x - w / 2, y - h + bob, w, h);
    ctx.restore();
  }
}

const spriteCache = new Map();
const CACHE = 220;

function propSprite(id, label, color) {
  const key = id + '|' + label + '|' + color;
  let cv = spriteCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = CACHE; cv.height = CACHE;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, CACHE, CACHE);
    if (id === 'bags') drawBags(ctx, label, color);
    else if (id === 'ticket') drawTicket(ctx, label, color);
    else if (id === 'delivery') drawDelivery(ctx, label, color);
    else if (id === 'cookies') drawCookies(ctx, label, color);
    else drawPortal(ctx, label, color);
    spriteCache.set(key, cv);
  }
  return cv;
}

function drawBags(ctx, label, color) {
  ctx.save();
  ctx.translate(28, 38);
  for (let i = 0; i < 3; i++) {
    const x = i * 38 + (i === 1 ? 12 : 0);
    const y = i === 1 ? 8 : 34;
    neonRect(ctx, x, y + 38, 52, 72, color, { fill: 'rgba(12,2,4,0.86)', glow: 12, radius: 5, lw: 2 });
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + 26, y + 40, 15, Math.PI, 0);
    ctx.stroke();
  }
  neonText(ctx, label, 108, 150, { color: C.white, size: 24, weight: '900', glow: 6 });
  ctx.restore();
}

function drawTicket(ctx, label, color) {
  ctx.save();
  neonRect(ctx, 58, 20, 104, 160, color, { fill: 'rgba(18,12,2,0.88)', glow: 14, radius: 8, lw: 2 });
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 44; y < 160; y += 24) ctx.fillRect(70, y, 80, 3);
  neonText(ctx, label, 110, 106, { color: C.white, size: 26, weight: '900', glow: 6 });
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(74, 28); ctx.lineTo(146, 28);
  ctx.moveTo(74, 172); ctx.lineTo(146, 172);
  ctx.stroke();
  ctx.restore();
}

function drawDelivery(ctx, label, color) {
  ctx.save();
  neonRect(ctx, 24, 62, 172, 76, color, { fill: 'rgba(18,2,4,0.86)', glow: 14, radius: 8, lw: 2 });
  ctx.fillStyle = color;
  roundRectPath(ctx, 44, 44, 62, 34, 6);
  ctx.fill();
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(58, 78); ctx.lineTo(58, 62); ctx.lineTo(74, 62);
  ctx.moveTo(88, 78); ctx.lineTo(88, 62); ctx.lineTo(74, 62);
  ctx.stroke();
  neonText(ctx, label, 128, 103, { color: C.white, size: 32, weight: '900', glow: 7 });
  ctx.restore();
}

function drawCookies(ctx, label, color) {
  ctx.save();
  neonRect(ctx, 26, 52, 168, 104, color, { fill: 'rgba(8,6,14,0.88)', glow: 11, radius: 8, lw: 2 });
  ctx.strokeStyle = C.redBright;
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const x = 50 + i * 28;
    ctx.beginPath();
    ctx.moveTo(x, 72); ctx.lineTo(x + 16, 88); ctx.lineTo(x, 104);
    ctx.stroke();
  }
  neonText(ctx, label, 110, 122, { color: C.white, size: 22, weight: '900', glow: 6 });
  ctx.restore();
}

function drawPortal(ctx, label, color) {
  ctx.save();
  neonRect(ctx, 42, 36, 136, 128, color, { fill: 'rgba(14,8,2,0.86)', glow: 12, radius: 10, lw: 2 });
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(58, 58, 104, 22);
  ctx.fillRect(58, 90, 72, 12);
  ctx.fillRect(58, 112, 88, 12);
  ctx.font = `900 24px ${FONT}`;
  neonText(ctx, label, 110, 136, { color: C.white, size: 30, weight: '900', glow: 6 });
  ctx.restore();
}

export class SideProps {
  constructor() {
    this.items = [];
    this.cd = 0.8;
    this._pool = KINDS;
  }

  clear() {
    this.items = [];
    this.cd = 0.8;
  }

  update(dt, speed, canSpawn) {
    for (const item of this.items) item.update(dt, speed);
    // in-place компакция мёртвых (без аллокации массива на кадр)
    let w = 0;
    for (let r = 0; r < this.items.length; r++) { const it = this.items[r]; if (!it.dead) this.items[w++] = it; }
    this.items.length = w;
    if (!canSpawn) return;

    this.cd -= dt;
    if (this.cd <= 0 && this.items.length < CONFIG.SIDE_PROP_MAX) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const kind = bagPick(this._pool) || this._pool[0];
      this.items.push(new SideProp(side, kind));
      this.cd = CONFIG.SIDE_PROP_EVERY + Math.random() * CONFIG.SIDE_PROP_JITTER;
    }
  }
}
