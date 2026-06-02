// Биты данных — светящаяся дорожка по безопасной полосе. Ведут игрока и дают очки.
import { CONFIG } from '../../config.js';

const C = CONFIG.COLORS;

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
    // щедрый радиус подбора
    const r = this.r * 2.0;
    return { x: this.x - r, y: y - r, w: r * 2, h: r * 2 };
  }

  update(dt, speed) { this.x -= speed * dt; if (this.x + this.r < -40) this.dead = true; }

  draw(ctx, geom, t) {
    const y = geom.laneY[this.lane];
    const pulse = 0.82 + Math.sin(t * 8 + this.phase) * 0.18;
    ctx.save();
    ctx.translate(this.x, y);
    // внешнее красное кольцо
    ctx.shadowColor = C.red; ctx.shadowBlur = 16;
    ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(0, 0, this.r * 1.7 * pulse, 0, 6.2832); ctx.stroke();
    // белое ядро
    ctx.globalAlpha = 1; ctx.shadowColor = C.white; ctx.shadowBlur = 12;
    ctx.fillStyle = C.white;
    ctx.beginPath(); ctx.arc(0, 0, this.r * pulse, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
}
