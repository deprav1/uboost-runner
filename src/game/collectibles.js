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
    this.val = Math.random() > 0.5 ? '0' : '1';
    this.rotSpeed = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 2.5);
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
    const pulse = 0.88 + Math.sin(t * 8 + this.phase) * 0.12;
    const r = this.r;
    
    ctx.save();
    ctx.translate(this.x, y);
    ctx.scale(pulse, pulse);
    
    // внешний вращающийся ромб
    ctx.save();
    ctx.rotate(t * this.rotSpeed);
    ctx.strokeStyle = C.red;
    ctx.shadowColor = C.red;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.8);
    ctx.lineTo(r * 1.8, 0);
    ctx.lineTo(0, r * 1.8);
    ctx.lineTo(-r * 1.8, 0);
    ctx.closePath();
    ctx.stroke();

    // внутренний ромб противоположного вращения
    ctx.rotate(-t * this.rotSpeed * 2);
    ctx.strokeStyle = C.white;
    ctx.shadowColor = C.white;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.25);
    ctx.lineTo(r * 1.25, 0);
    ctx.lineTo(0, r * 1.25);
    ctx.lineTo(-r * 1.25, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    
    // бинарная цифра по центру (не вращается для читаемости)
    neonText(ctx, this.val, 0, 0, { color: C.white, size: r * 1.9, weight: '900', glow: 8 });
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
    
    // Эффект биения сердца (кардио-импульс)
    const beat = (t * 2.5 + this.phase) % Math.PI;
    const pulse = 1 + (Math.sin(beat * 2) > 0.85 ? Math.sin(beat * 2) * 0.16 : 0);

    ctx.save();
    ctx.translate(this.x, y);

    // внешний круговой защитный контур
    ctx.strokeStyle = 'rgba(255, 41, 55, 0.35)';
    ctx.shadowColor = '#ff2937';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.stroke();

    // вращающиеся плюсики здоровья по орбите
    const numPluses = 3;
    for (let i = 0; i < numPluses; i++) {
      const angle = t * 2.8 + i * (Math.PI * 2 / numPluses) + this.phase;
      const px = Math.cos(angle) * r * 1.35;
      const py = Math.sin(angle) * r * 1.35;
      neonText(ctx, '+', px, py, { color: C.white, size: r * 0.35, glow: 5, weight: '800' });
    }

    ctx.scale(pulse, pulse);

    const img = getSprite('gags/heart');
    if (img) {
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
    } else {
      // процедурное сердце с бликом
      ctx.shadowColor = '#ff2937'; ctx.shadowBlur = 24;
      ctx.fillStyle = '#ff2937';
      ctx.beginPath();
      const s = r * 0.85;
      ctx.moveTo(0, -s * 0.3);
      ctx.bezierCurveTo(s * 0.7, -s * 1.0, s * 1.4, -s * 0.2, 0, s * 0.85);
      ctx.bezierCurveTo(-s * 1.4, -s * 0.2, -s * 0.7, -s * 1.0, 0, -s * 0.3);
      ctx.closePath();
      ctx.fill();

      // белый блик
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.25, -s * 0.35, s * 0.16, s * 0.08, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    neonText(ctx, '+1 HP', this.x, y + r * 1.52, { color: '#ff2937', size: r * 0.55, glow: 12, weight: '900' });
  }
}
