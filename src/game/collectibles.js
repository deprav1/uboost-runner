// Биты данных и сердца-жизни.
import { CONFIG } from '../../config.js';
import { neonText, floorGlow } from '../engine/render.js';
import { getSprite } from '../engine/assets.js';
import { STR } from '../ui/strings.js';

const C = CONFIG.COLORS;

// Бит данных — светящийся ромб, летящий по безопасной полосе из глубины.
export class DataBit {
  // mult > 1 — «риск-бит» на опасной полосе: дороже и рисуется золотым.
  constructor(lane, z, geom, mult = 1) {
    this.lane = lane;
    this.laneNorm = geom.laneNorm(lane);
    this.z = z;
    this.dead = false;
    this.mult = mult;
    this.phase = Math.random() * 6.2832;
    this.val = Math.random() > 0.5 ? '0' : '1';
    this.rotSpeed = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 2.5);
  }

  update(dt, speed) { this.z -= speed * dt * CONFIG.RUN.Z_RATE; if (this.z < -0.06) this.dead = true; }

  draw(ctx, geom, t) {
    const { x, y, scale } = geom.project(this.laneNorm, this.z);
    const pulse = 0.88 + Math.sin(t * 8 + this.phase) * 0.12;
    const r = geom.unit * 0.16 * scale;
    // риск-бит — золотой: цвет = ценность (по конвенции gold = «дорогой» пикап)
    const main = this.mult > 1 ? C.gold : C.data;

    floorGlow(ctx, x, y + r * 1.4, r * 1.6, main, 0.30);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);

    // внешний вращающийся ромб (циан — «поток данных»; золото — риск-бит)
    ctx.save();
    ctx.rotate(t * this.rotSpeed);
    ctx.strokeStyle = main;
    ctx.shadowColor = main;
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
    ctx.strokeStyle = C.dataHot;
    ctx.shadowColor = C.dataHot;
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
    const r = geom.unit * 0.30 * scale;

    floorGlow(ctx, x, y + r * 1.15, r * 1.3, C.heart, 0.5);

    // Эффект биения сердца (кардио-импульс)
    const beat = (t * 2.5 + this.phase) % Math.PI;
    const pulse = 1 + (Math.sin(beat * 2) > 0.85 ? Math.sin(beat * 2) * 0.16 : 0);

    ctx.save();
    ctx.translate(x, y);

    // внешний круговой защитный контур
    ctx.strokeStyle = 'rgba(255, 90, 120, 0.35)';
    ctx.shadowColor = C.heart;
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
      ctx.shadowColor = C.heart; ctx.shadowBlur = 24;
      ctx.fillStyle = C.heart;
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

    neonText(ctx, STR.heartLabel, x, y + r * 1.52, { color: C.heart, size: r * 0.55, glow: 12, weight: '900' });
  }
}
