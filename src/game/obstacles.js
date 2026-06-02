// Препятствия = мусор рунета. Спавн «коридором» живёт в main.js,
// тут — класс, типы и честная (заниженная) геометрия попадания.
import { CONFIG } from '../../config.js';
import { neonRect, neonText, roundRectPath } from '../engine/render.js';
import { STR, pick } from '../ui/strings.js';

const C = CONFIG.COLORS;

const TYPES = {
  captcha: { color: C.white, stat: 'captchas' },
  geoblock: { color: C.danger, stat: 'geoblocks' },
  ad: { color: C.redBright, stat: 'ads' },
  lag: { color: C.redDeep, stat: 'lags' },
};
const TYPE_KEYS = Object.keys(TYPES);

export class Obstacle {
  constructor(lane, type) {
    this.lane = lane;
    this.type = type;
    this.color = TYPES[type].color;
    this.stat = TYPES[type].stat;
    this.label = pick(STR.obstacleLabels[type]);
    this.x = 0;
    this.w = 0; this.h = 0;
    this.passed = false;
    this.dead = false;
    this.phase = Math.random() * Math.PI * 2;
  }

  size(geom) {
    this.h = geom.laneH * 0.78;
    this.w = this.type === 'geoblock' ? geom.laneH * 0.55 : geom.laneH * 0.82;
  }

  // честный хитбокс — заметно меньше визуала, чтобы краем не убивало
  hitbox(geom) {
    const y = geom.laneY[this.lane];
    const mx = this.w * 0.12, my = this.h * 0.14;
    return { x: this.x + mx, y: y - this.h / 2 + my, w: this.w - mx * 2, h: this.h - my * 2 };
  }

  update(dt, speed) { this.x -= speed * dt; if (this.x + this.w < -40) this.dead = true; }

  draw(ctx, geom, t) {
    const y = geom.laneY[this.lane];
    const x = this.x, w = this.w, h = this.h;
    const top = y - h / 2;
    ctx.save();

    if (this.type === 'ad') {
      // мигающее окно казино / маркетплейса
      const blink = Math.sin(t * 12 + this.phase) > 0;
      neonRect(ctx, x, top, w, h, blink ? C.redBright : C.white, { fill: 'rgba(22,4,8,0.85)', glow: 22, radius: 6 });
      ctx.fillStyle = blink ? C.white : C.redBright;
      roundRectPath(ctx, x, top, w, h * 0.22, 6); ctx.fill();
      neonText(ctx, '✕', x + w - 12, top + h * 0.11, { color: '#000', size: h * 0.14, glow: 0 });
      neonText(ctx, this.label, x + w / 2, y + h * 0.05, { color: '#fff', size: h * 0.16 });
    } else if (this.type === 'geoblock') {
      // красная стена РКН с замком
      neonRect(ctx, x, top, w, h, C.danger, { fill: 'rgba(42,0,2,0.74)', glow: 20, radius: 4 });
      for (let i = 1; i < 4; i++) { ctx.strokeStyle = 'rgba(255,41,55,0.5)'; ctx.beginPath(); ctx.moveTo(x, top + h * i / 4); ctx.lineTo(x + w, top + h * i / 4); ctx.stroke(); }
      neonText(ctx, '🔒', x + w / 2, top + h * 0.28, { color: C.white, size: h * 0.22, glow: 8 });
      neonText(ctx, this.label, x + w / 2, top + h * 0.66, { color: '#fff', size: h * 0.13 });
    } else if (this.type === 'lag') {
      // глитч-блок «всё легло» + буфер-спиннер
      ctx.globalAlpha = 0.78;
      neonRect(ctx, x, top, w, h, C.redDeep, { fill: 'rgba(20,0,4,0.62)', glow: 16, radius: 6 });
      for (let i = 0; i < 4; i++) { const gy = top + Math.random() * h; ctx.fillStyle = i % 2 ? C.red : C.white; ctx.globalAlpha = 0.4; ctx.fillRect(x, gy, w, 2); }
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(x + w / 2, y - h * 0.08); ctx.rotate(t * 6);
      ctx.strokeStyle = C.red; ctx.lineWidth = 3; ctx.shadowColor = C.red; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, 0, h * 0.16, 0, Math.PI * 1.5); ctx.stroke();
      ctx.restore();
      neonText(ctx, this.label, x + w / 2, top + h * 0.78, { color: C.white, size: h * 0.13 });
    } else {
      // капча — белая рамка, красная сетка 3×3
      neonRect(ctx, x, top, w, h, C.white, { fill: 'rgba(12,2,4,0.82)', glow: 16, radius: 6 });
      const gy = top + h * 0.34, gh = h * 0.6, cell = Math.min(w, gh) / 3;
      const gx = x + (w - cell * 3) / 2;
      for (let r = 0; r < 3; r++) for (let cN = 0; cN < 3; cN++) {
        const on = Math.sin(t * 4 + r + cN + this.phase) > 0.6;
        ctx.strokeStyle = C.red; ctx.globalAlpha = on ? 1 : 0.4; ctx.lineWidth = 1.5;
        ctx.strokeRect(gx + cN * cell + 1, gy + r * cell + 1, cell - 2, cell - 2);
      }
      ctx.globalAlpha = 1;
      neonText(ctx, this.label, x + w / 2, top + h * 0.16, { color: '#fff', size: h * 0.11 });
    }
    ctx.restore();
  }
}

// Следующая безопасная полоса — всегда в пределах ±1 (гарантия достижимости).
// Биас «остаться» делает траекторию читаемой. Единый источник истины для main + тестов.
export function nextSafeLane(prev, lanes = CONFIG.LANES) {
  const opts = [prev, prev];
  if (prev > 0) opts.push(prev - 1);
  if (prev < lanes - 1) opts.push(prev + 1);
  return opts[(Math.random() * opts.length) | 0];
}

export { TYPES, TYPE_KEYS };
