// Биты данных и сердца-жизни.
import { CONFIG } from '../../config.js';
import { neonText } from '../engine/render.js';
import { getSprite } from '../engine/assets.js';

const C = CONFIG.COLORS;

// Бит данных — светящаяся дорожка по безопасной полосе
export class DataBit {
  constructor(lane, x, geom) {
    this.lane = lane;
    this.x = x;
    this.r = geom.laneH * 0.11;
    this.dead = false;
    this.phase = Math.random() * 6.2832;
  }

  get w() { return this.r * 2; }

  hitbox(geom) {
    const y = geom.laneY[this.lane];
    const r = this.r * 2.0;
    return { x: this.x - r, y: y - r, w: r * 2, h: r * 2 };
  }

  update(dt, speed) { this.x -= speed * dt; if (this.x + this.r < -40) this.dead = true; }

  draw(ctx, geom, t) {
    const y = geom.laneY[this.lane];
    const pulse = 0.82 + Math.sin(t * 8 + this.phase) * 0.18;
    ctx.save();
    ctx.translate(this.x, y);
    ctx.strokeStyle = C.red; ctx.shadowColor = C.red; ctx.shadowBlur = 16;
    ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(0, 0, this.r * 1.7 * pulse, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1; ctx.shadowColor = C.white; ctx.shadowBlur = 12;
    ctx.fillStyle = C.white;
    ctx.beginPath(); ctx.arc(0, 0, this.r * pulse, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
}

// Пикап-сердце ♥ — +1 жизнь (ограничено MAX_LIVES)
export class Heart {
  constructor(lane, geom) {
    this.lane = lane;
    this.x = geom.W + 40;
    this.r = geom.laneH * 0.22;
    this.dead = false;
    this.phase = Math.random() * 6.28;
  }

  hitbox(geom) {
    const y = geom.laneY[this.lane];
    return { x: this.x - this.r, y: y - this.r, w: this.r * 2, h: this.r * 2 };
  }

  update(dt, speed) { this.x -= speed * dt; if (this.x + this.r < -40) this.dead = true; }

  draw(ctx, geom, t) {
    const y = geom.laneY[this.lane];
    const r = this.r;
    const pulse = 1 + Math.sin(t * 5 + this.phase) * 0.1;

    ctx.save();
    ctx.translate(this.x, y);
    ctx.scale(pulse, pulse);

    const img = getSprite('gags/heart');
    if (img) {
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
    } else {
      // процедурное сердце
      ctx.shadowColor = '#ff2937'; ctx.shadowBlur = 22;
      ctx.fillStyle = '#ff2937';
      ctx.beginPath();
      const s = r * 0.7;
      ctx.moveTo(0, s * 0.4);
      ctx.bezierCurveTo(s, -s * 0.3, s * 1.5, s * 0.8, 0, s * 1.5);
      ctx.bezierCurveTo(-s * 1.5, s * 0.8, -s, -s * 0.3, 0, s * 0.4);
      ctx.fill();
    }
    ctx.restore();

    neonText(ctx, '♥', this.x, y + r * 1.6, { color: '#ff2937', size: r * 0.65, glow: 14 });
  }
}
