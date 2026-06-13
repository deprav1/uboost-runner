// VPN-буст: красно-белый щит «VPN». Подбор → ускорение + неуязвимость.
import { CONFIG } from '../../config.js';
import { neonText, floorGlow } from '../engine/render.js';
import { STR } from '../ui/strings.js';

const C = CONFIG.COLORS;

export class Boost {
  constructor(lane, z, geom) {
    this.lane = lane;
    this.laneNorm = geom.laneNorm(lane);
    this.z = z;
    this.dead = false;
    this.phase = Math.random() * 6.28;
  }

  update(dt, speed) { this.z -= speed * dt * CONFIG.RUN.Z_RATE; if (this.z < -0.06) this.dead = true; }

  draw(ctx, geom, t) {
    const { x, y, scale } = geom.project(this.laneNorm, this.z);
    const r = geom.unit * 0.36 * scale;
    const pulse = 1 + Math.sin(t * 6 + this.phase) * 0.12;
    floorGlow(ctx, x, y + r * 0.95, r * 1.1, C.white, 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);

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
    neonText(ctx, STR.boostLabel, x, y + r * 1.5, { color: C.white, size: r * 0.55, glow: 12, weight: '900' });
  }
}

// Магнит: циановая подкова. Подбор → биты притягиваются к полосе игрока на время.
export class Magnet {
  constructor(lane, z, geom) {
    this.lane = lane;
    this.laneNorm = geom.laneNorm(lane);
    this.z = z;
    this.dead = false;
    this.phase = Math.random() * 6.28;
  }

  update(dt, speed) { this.z -= speed * dt * CONFIG.RUN.Z_RATE; if (this.z < -0.06) this.dead = true; }

  draw(ctx, geom, t) {
    const { x, y, scale } = geom.project(this.laneNorm, this.z);
    const r = geom.unit * 0.34 * scale;
    const pulse = 1 + Math.sin(t * 6 + this.phase) * 0.12;
    floorGlow(ctx, x, y + r * 0.95, r * 1.1, C.data, 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);

    // подкова: толстая C-дуга с двумя «полюсами»
    ctx.shadowColor = C.data; ctx.shadowBlur = 22;
    ctx.strokeStyle = C.data; ctx.lineWidth = r * 0.42; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, Math.PI * 0.18, Math.PI * 0.82, false);
    ctx.stroke();
    // полюса (белые наконечники снизу)
    ctx.shadowBlur = 10; ctx.lineWidth = r * 0.42; ctx.strokeStyle = C.white;
    const py = Math.sin(Math.PI * 0.82) * r * 0.62;
    const px = Math.cos(Math.PI * 0.82) * r * 0.62;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + r * 0.34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-px, py); ctx.lineTo(-px, py + r * 0.34); ctx.stroke();

    // искра притяжения по центру
    ctx.shadowColor = C.dataHot; ctx.shadowBlur = 14;
    ctx.fillStyle = Math.sin(t * 16) > 0 ? C.dataHot : C.white;
    ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.14, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
    neonText(ctx, STR.pickupMagnet, x, y + r * 1.5, { color: C.data, size: r * 0.5, glow: 12, weight: '900' });
  }
}

// Удвоитель очков: золотая бирка «×2». Подбор → stats.scoreMult = X2_MULT на время.
export class X2 {
  constructor(lane, z, geom) {
    this.lane = lane;
    this.laneNorm = geom.laneNorm(lane);
    this.z = z;
    this.dead = false;
    this.phase = Math.random() * 6.28;
  }

  update(dt, speed) { this.z -= speed * dt * CONFIG.RUN.Z_RATE; if (this.z < -0.06) this.dead = true; }

  draw(ctx, geom, t) {
    const { x, y, scale } = geom.project(this.laneNorm, this.z);
    const r = geom.unit * 0.34 * scale;
    const pulse = 1 + Math.sin(t * 6 + this.phase) * 0.12;
    floorGlow(ctx, x, y + r * 0.95, r * 1.1, C.gold, 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);

    // золотой шестиугольный жетон
    ctx.shadowColor = C.gold; ctx.shadowBlur = 24;
    ctx.fillStyle = 'rgba(28,20,2,0.9)';
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      const vx = Math.cos(a) * r, vy = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // «×2» по центру
    ctx.shadowBlur = 10;
    neonText(ctx, '×2', 0, 0, { color: Math.sin(t * 14) > 0 ? C.white : C.gold, size: r * 0.95, glow: 8, weight: '900' });

    ctx.restore();
    neonText(ctx, STR.pickupX2, x, y + r * 1.5, { color: C.gold, size: r * 0.5, glow: 12, weight: '900' });
  }
}
