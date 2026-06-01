// VPN-буст пикап: неон-щит «VPN», подбор → ускорение + неуязвимость.
import { CONFIG } from '../../config.js';
import { neonText } from '../engine/render.js';

const C = CONFIG.COLORS;

export class Boost {
  constructor(lane, geom) {
    this.lane = lane;
    this.x = geom.W + 40;
    this.r = geom.laneH * 0.26;
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
    const pulse = 1 + Math.sin(t * 6 + this.phase) * 0.12;
    ctx.save();
    ctx.translate(this.x, y);
    ctx.scale(pulse, pulse);

    // ореол
    ctx.shadowColor = C.cyan; ctx.shadowBlur = 36;
    // щит
    ctx.fillStyle = 'rgba(8,40,50,0.85)';
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 3;
    const r = this.r;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.85, -r * 0.4);
    ctx.lineTo(r * 0.85, r * 0.3);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.85, r * 0.3);
    ctx.lineTo(-r * 0.85, -r * 0.4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // молния внутри
    ctx.shadowBlur = 14; ctx.fillStyle = C.yellow;
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.55); ctx.lineTo(-r * 0.3, r * 0.05);
    ctx.lineTo(0, r * 0.05); ctx.lineTo(-r * 0.1, r * 0.55);
    ctx.lineTo(r * 0.35, -r * 0.1); ctx.lineTo(0, -r * 0.1);
    ctx.closePath(); ctx.fill();

    ctx.restore();
    neonText(ctx, 'VPN', this.x, y + r * 1.5, { color: C.cyan, size: r * 0.7, glow: 12 });
  }
}
