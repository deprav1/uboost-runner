// Простая система частиц для шлейфа, взрывов, искр и плавающих мем-надписей.

export class Particles {
  constructor() { this.list = []; }

  spawn(p) { this.list.push(p); }

  // взрыв осколков
  burst(x, y, color, n = 14, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.list.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4, age: 0,
        size: 2 + Math.random() * 4, color, kind: 'spark', gravity: 120,
      });
    }
  }

  // искра шлейфа
  thruster(x, y, color) {
    this.list.push({
      x, y, vx: -120 - Math.random() * 160, vy: (Math.random() - 0.5) * 70,
      life: 0.35 + Math.random() * 0.25, age: 0,
      size: 3 + Math.random() * 4, color, kind: 'spark', gravity: 0,
    });
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
      p.x += (p.vx || 0) * dt;
      p.y += (p.vy || 0) * dt;
      if (p.gravity) p.vy += p.gravity * dt;
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      const t = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, t);
      if (p.kind === 'text') {
        ctx.font = `900 ${p.size}px Orbitron, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = p.color; ctx.shadowBlur = 16;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  clear() { this.list.length = 0; }
}
