// Препятствия = мусор интернета. Спавн волнами, всегда есть проходимая полоса.
import { CONFIG } from '../../config.js';
import { neonRect, neonText, roundRectPath } from '../engine/render.js';
import { STR, pick } from '../ui/strings.js';

const C = CONFIG.COLORS;

const TYPES = {
  captcha: { color: C.cyan, stat: 'captchas' },
  geoblock: { color: C.danger, stat: 'geoblocks' },
  ad: { color: C.yellow, stat: 'ads' },
  lag: { color: C.purple, stat: 'lags' },
};
const TYPE_KEYS = Object.keys(TYPES);

export class Obstacle {
  constructor(lane, type) {
    this.lane = lane;
    this.type = type;
    this.color = TYPES[type].color;
    this.stat = TYPES[type].stat;
    this.label = pick(STR.obstacleLabels[type]);
    this.x = 0;             // ставится при спавне
    this.w = 0; this.h = 0;
    this.passed = false;
    this.dead = false;
    this.phase = Math.random() * Math.PI * 2;
  }

  size(geom) {
    this.h = geom.laneH * 0.78;
    this.w = this.type === 'geoblock' ? geom.laneH * 0.55 : geom.laneH * 0.82;
  }

  hitbox(geom) {
    const y = geom.laneY[this.lane];
    return { x: this.x, y: y - this.h / 2, w: this.w, h: this.h };
  }

  update(dt, speed) { this.x -= speed * dt; if (this.x + this.w < -40) this.dead = true; }

  draw(ctx, geom, t) {
    const y = geom.laneY[this.lane];
    const x = this.x, w = this.w, h = this.h;
    const top = y - h / 2;
    ctx.save();

    if (this.type === 'ad') {
      // мигающее окно казино
      const blink = Math.sin(t * 12 + this.phase) > 0;
      neonRect(ctx, x, top, w, h, blink ? C.yellow : C.magenta, { fill: 'rgba(40,10,30,0.85)', glow: 22, radius: 6 });
      // «титульная» полоса окна с крестиком
      ctx.fillStyle = blink ? C.magenta : C.yellow;
      roundRectPath(ctx, x, top, w, h * 0.22, 6); ctx.fill();
      neonText(ctx, '✕', x + w - 12, top + h * 0.11, { color: '#000', size: h * 0.14, glow: 0 });
      neonText(ctx, this.label, x + w / 2, y + h * 0.05, { color: blink ? C.yellow : '#fff', size: h * 0.16 });
    } else if (this.type === 'geoblock') {
      // красная стена с замком
      neonRect(ctx, x, top, w, h, C.danger, { fill: 'rgba(50,0,0,0.7)', glow: 20, radius: 4 });
      for (let i = 1; i < 4; i++) { ctx.strokeStyle = 'rgba(255,59,59,0.5)'; ctx.beginPath(); ctx.moveTo(x, top + h * i / 4); ctx.lineTo(x + w, top + h * i / 4); ctx.stroke(); }
      neonText(ctx, '🔒', x + w / 2, top + h * 0.28, { color: C.danger, size: h * 0.22, glow: 8 });
      neonText(ctx, this.label, x + w / 2, top + h * 0.66, { color: '#fff', size: h * 0.13 });
    } else if (this.type === 'lag') {
      // глитч-блок с буфер-спиннером
      ctx.globalAlpha = 0.75;
      neonRect(ctx, x, top, w, h, C.purple, { fill: 'rgba(30,0,50,0.6)', glow: 16, radius: 6 });
      // глитч-полосы
      for (let i = 0; i < 4; i++) { const gy = top + Math.random() * h; ctx.fillStyle = i % 2 ? C.cyan : C.magenta; ctx.globalAlpha = 0.4; ctx.fillRect(x, gy, w, 2); }
      ctx.globalAlpha = 1;
      // спиннер
      ctx.save();
      ctx.translate(x + w / 2, y - h * 0.08); ctx.rotate(t * 6);
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; ctx.shadowColor = C.cyan; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, 0, h * 0.16, 0, Math.PI * 1.5); ctx.stroke();
      ctx.restore();
      neonText(ctx, this.label, x + w / 2, top + h * 0.78, { color: C.cyan, size: h * 0.13 });
    } else {
      // капча — сетка 3x3 с подсветкой
      neonRect(ctx, x, top, w, h, C.cyan, { fill: 'rgba(0,30,40,0.8)', glow: 18, radius: 6 });
      const gy = top + h * 0.34, gh = h * 0.6, cell = Math.min(w, gh) / 3;
      const gx = x + (w - cell * 3) / 2;
      for (let r = 0; r < 3; r++) for (let cN = 0; cN < 3; cN++) {
        const on = Math.sin(t * 4 + r + cN + this.phase) > 0.6;
        ctx.strokeStyle = C.cyan; ctx.globalAlpha = on ? 1 : 0.4; ctx.lineWidth = 1.5;
        ctx.strokeRect(gx + cN * cell + 1, gy + r * cell + 1, cell - 2, cell - 2);
      }
      ctx.globalAlpha = 1;
      neonText(ctx, this.label, x + w / 2, top + h * 0.16, { color: '#fff', size: h * 0.11 });
    }
    ctx.restore();
  }
}

// Волна: 1–2 занятых полосы, всегда минимум одна свободна.
export function spawnWave(geom, distance) {
  const lanes = [0, 1, 2];
  const hard = Math.min(1, distance / 1800);
  const blockCount = Math.random() < 0.35 + hard * 0.4 ? 2 : 1; // чаще 2 с прогрессом
  // перемешиваем и берём blockCount полос
  for (let i = lanes.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [lanes[i], lanes[j]] = [lanes[j], lanes[i]]; }
  const chosen = lanes.slice(0, blockCount);
  const list = [];
  for (const lane of chosen) {
    const type = TYPE_KEYS[(Math.random() * TYPE_KEYS.length) | 0];
    const o = new Obstacle(lane, type);
    o.size(geom);
    o.x = geom.W + 40 + Math.random() * 30;
    list.push(o);
  }
  return list;
}

export { TYPES };
