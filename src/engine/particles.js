// Система частиц: additive-искры с ярким ядром, стрик-шлейф, ударные кольца,
// парящие угли и плавающие мем-надписи. Всё рисуется в режиме 'lighter' (свет
// складывается) — поэтому особенно красиво играет вместе с bloom-пост-обработкой.
import { FONT } from './render.js';

export class Particles {
  constructor() { this.list = []; }

  spawn(p) { this.list.push(p); }

  // взрыв осколков-искр
  burst(x, y, color, n = 14, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.list.push({
        x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4, age: 0,
        size: 2 + Math.random() * 4, color, kind: 'spark', gravity: 120, streak: 1,
      });
    }
  }

  // искра шлейфа (вытянутая по движению)
  // Выхлоп. dirx/diry — направление струи (по умолчанию влево, как было).
  // В псевдо-3D режиме игрок летит «в город» → выхлоп вниз, на камеру (diry=1).
  thruster(x, y, color, dirx = -1, diry = 0) {
    const spd = 120 + Math.random() * 160;
    const perp = (Math.random() - 0.5) * 70;
    this.list.push({
      x, y, px: x, py: y,
      vx: dirx * spd - diry * perp,
      vy: diry * spd + dirx * perp,
      life: 0.35 + Math.random() * 0.25, age: 0,
      size: 3 + Math.random() * 4, color, kind: 'spark', gravity: 0, streak: 1.6,
    });
  }

  // парящие угли (медленные, мерцают, тянутся вверх) — для «атмосферы»
  ember(x, y, color) {
    this.list.push({
      x, y, px: x, py: y, vx: (Math.random() - 0.3) * 40, vy: -20 - Math.random() * 40,
      life: 0.9 + Math.random() * 0.8, age: 0,
      size: 1.5 + Math.random() * 2.5, color, kind: 'ember', gravity: -10,
    });
  }

  // ударное кольцо (шок-волна) — для смэша/подбора
  ring(x, y, color, r0 = 6, r1 = 60, life = 0.45) {
    this.list.push({ x, y, life, age: 0, color, kind: 'ring', r0, r1, lw: 3 });
  }

  // вспышка-нимб (мягкая additive-лужа света)
  flashGlow(x, y, color, r = 60, life = 0.4) {
    this.list.push({ x, y, life, age: 0, color, kind: 'glow', r });
  }

  // всплывающая мем-надпись
  popText(x, y, text, color) {
    this.list.push({ x, y, vy: -55, life: 1.1, age: 0, text, color, kind: 'text', size: 22 });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      if (p.px !== undefined) { p.px = p.x; p.py = p.y; }
      p.x += (p.vx || 0) * dt;
      p.y += (p.vy || 0) * dt;
      if (p.gravity) p.vy += p.gravity * dt;
    }
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.list) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, t);

      if (p.kind === 'text') {
        ctx.globalCompositeOperation = 'source-over';
        const sc = 0.7 + Math.min(1, p.age * 6) * 0.3; // лёгкий scale-in
        ctx.save();
        ctx.translate(p.x, p.y); ctx.scale(sc, sc);
        ctx.font = `900 ${p.size}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.shadowColor = p.color; ctx.shadowBlur = 18;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        continue;
      }

      ctx.globalCompositeOperation = 'lighter';

      if (p.kind === 'ring') {
        const r = p.r0 + (p.r1 - p.r0) * (1 - t);
        ctx.strokeStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 16;
        ctx.lineWidth = p.lw * t;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.kind === 'glow') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = Math.max(0, t) * 0.6;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else {
        // spark / ember — цветной ореол + яркое белое ядро
        const r = p.size * (p.kind === 'ember' ? (0.6 + 0.4 * Math.abs(Math.sin(p.age * 18))) : t);
        // вытянутый стрик по направлению движения
        if (p.streak && p.px !== undefined) {
          ctx.strokeStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 10;
          ctx.lineCap = 'round'; ctx.lineWidth = r * 1.3;
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        // белое ядро
        ctx.shadowBlur = 6; ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  clear() { this.list.length = 0; }
}
