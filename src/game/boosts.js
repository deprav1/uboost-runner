// VPN-буст: красно-белый щит «VPN». Подбор → ускорение + неуязвимость.
import { CONFIG } from '../../config.js';
import { neonText, floorGlow } from '../engine/render.js';

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
    floorGlow(ctx, this.x, y + this.r * 0.95, this.r * 1.1, C.white, 0.5);
    ctx.save();
    ctx.translate(this.x, y);
    ctx.scale(pulse, pulse);

    const r = this.r;

    // 1. Внешний неоновый щит (белый с размытием)
    ctx.shadowColor = C.white; ctx.shadowBlur = 24;
    ctx.fillStyle = 'rgba(20,2,4,0.9)';
    ctx.strokeStyle = C.white; ctx.lineWidth = 2.5;
    
    const drawShieldPath = (cCtx, sz) => {
      cCtx.beginPath();
      cCtx.moveTo(0, -sz);
      cCtx.lineTo(sz * 0.85, -sz * 0.45);
      cCtx.lineTo(sz * 0.85, sz * 0.25);
      cCtx.lineTo(0, sz * 0.95);
      cCtx.lineTo(-sz * 0.85, sz * 0.25);
      cCtx.lineTo(-sz * 0.85, -sz * 0.45);
      cCtx.closePath();
    };
    
    drawShieldPath(ctx, r);
    ctx.fill(); ctx.stroke();
    
    // 2. Внутренний красный светящийся щит
    ctx.strokeStyle = C.red; ctx.lineWidth = 1.5;
    ctx.shadowColor = C.red; ctx.shadowBlur = 12;
    drawShieldPath(ctx, r * 0.75);
    ctx.stroke();

    // 3. Молния с внутренним свечением и сдвигом во времени
    ctx.shadowBlur = 16; ctx.shadowColor = C.white; 
    ctx.fillStyle = Math.sin(t * 20) > 0.8 ? C.white : C.red;
    ctx.beginPath();
    ctx.moveTo(r * 0.12, -r * 0.5); 
    ctx.lineTo(-r * 0.25, r * 0.05);
    ctx.lineTo(r * 0.05, r * 0.05); 
    ctx.lineTo(-r * 0.12, r * 0.55);
    ctx.lineTo(r * 0.3, -r * 0.05); 
    ctx.lineTo(0, -r * 0.05);
    ctx.closePath(); 
    ctx.fill();

    ctx.restore();
    neonText(ctx, 'VPN BOOST', this.x, y + r * 1.5, { color: C.white, size: r * 0.55, glow: 12, weight: '900' });
  }
}
