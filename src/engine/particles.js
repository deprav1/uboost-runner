// Система частиц: additive-искры с ярким ядром, стрик-шлейф, ударные кольца,
// парящие угли и плавающие мем-надписи. Всё рисуется в режиме 'lighter' (свет
// складывается) — поэтому особенно красиво играет вместе с bloom-пост-обработкой.
//
// Перф: объекты переиспользуются через free-list (без аллокаций в горячем цикле),
// активный список ограничен бюджетом тира (setBudget). На слабых тирах частицы
// рисуются без shadowBlur — главного убийцы fps на мобильном Canvas; additive-ядро
// и так светится под bloom.
import { CONFIG } from '../../config.js';
import { FONT } from './render.js';

export class Particles {
  constructor() {
    this.list = [];
    this.pool = [];
    this.max = CONFIG.PERF.MAX_PARTICLES[CONFIG.PERF.MAX_PARTICLES.length - 1];
    this.glowEnabled = true;
  }

  // Бюджет от тира качества: { particleCap, glow }
  setBudget(s) {
    if (s?.particleCap) this.max = s.particleCap;
    if (s?.glow !== undefined) this.glowEnabled = s.glow;
    // при понижении бюджета лишние активные частицы доживут сами — не обрезаем резко
  }

  // Достаёт объект из пула со сброшенными полями (повторное использование).
  _get() {
    if (this.list.length >= this.max) return null;
    const p = this.pool.pop() || {};
    p.x = 0; p.y = 0; p.px = undefined; p.py = undefined; p.vx = 0; p.vy = 0;
    p.life = 1; p.age = 0; p.size = 0; p.color = ''; p.kind = '';
    p.gravity = 0; p.streak = 0; p.text = ''; p.r = 0; p.r0 = 0; p.r1 = 0; p.lw = 0;
    return p;
  }

  _release(p) {
    if (this.pool.length < this.max) this.pool.push(p);
  }

  // взрыв осколков-искр
  burst(x, y, color, n = 14, speed = 260) {
    for (let i = 0; i < n; i++) {
      const p = this._get(); if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      p.x = x; p.y = y; p.px = x; p.py = y;
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.life = 0.5 + Math.random() * 0.4;
      p.size = 2 + Math.random() * 4; p.color = color;
      p.kind = 'spark'; p.gravity = 120; p.streak = 1;
      this.list.push(p);
    }
  }

  // искра шлейфа (вытянутая по движению)
  // Выхлоп. dirx/diry — направление струи (по умолчанию влево, как было).
  // В псевдо-3D режиме игрок летит «в город» → выхлоп вниз, на камеру (diry=1).
  thruster(x, y, color, dirx = -1, diry = 0) {
    const p = this._get(); if (!p) return;
    const spd = 120 + Math.random() * 160;
    const perp = (Math.random() - 0.5) * 70;
    p.x = x; p.y = y; p.px = x; p.py = y;
    p.vx = dirx * spd - diry * perp;
    p.vy = diry * spd + dirx * perp;
    p.life = 0.35 + Math.random() * 0.25;
    p.size = 3 + Math.random() * 4; p.color = color;
    p.kind = 'spark'; p.gravity = 0; p.streak = 1.6;
    this.list.push(p);
  }

  // парящие угли (медленные, мерцают, тянутся вверх) — для «атмосферы»
  ember(x, y, color) {
    const p = this._get(); if (!p) return;
    p.x = x; p.y = y; p.px = x; p.py = y;
    p.vx = (Math.random() - 0.3) * 40; p.vy = -20 - Math.random() * 40;
    p.life = 0.9 + Math.random() * 0.8;
    p.size = 1.5 + Math.random() * 2.5; p.color = color;
    p.kind = 'ember'; p.gravity = -10;
    this.list.push(p);
  }

  // ударное кольцо (шок-волна) — для смэша/подбора
  ring(x, y, color, r0 = 6, r1 = 60, life = 0.45) {
    const p = this._get(); if (!p) return;
    p.x = x; p.y = y; p.life = life; p.color = color;
    p.kind = 'ring'; p.r0 = r0; p.r1 = r1; p.lw = 3;
    this.list.push(p);
  }

  // вспышка-нимб (мягкая additive-лужа света)
  flashGlow(x, y, color, r = 60, life = 0.4) {
    const p = this._get(); if (!p) return;
    p.x = x; p.y = y; p.life = life; p.color = color;
    p.kind = 'glow'; p.r = r;
    this.list.push(p);
  }

  // всплывающая мем-надпись
  popText(x, y, text, color) {
    const p = this._get(); if (!p) return;
    p.x = x; p.y = y; p.vy = -55; p.life = 1.1;
    p.text = text; p.color = color; p.kind = 'text'; p.size = 22;
    this.list.push(p);
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) {
        // swap-remove: последний на место i, без сдвига хвоста
        L[i] = L[L.length - 1];
        L.pop();
        this._release(p);
        continue;
      }
      if (p.px !== undefined) { p.px = p.x; p.py = p.y; }
      p.x += (p.vx || 0) * dt;
      p.y += (p.vy || 0) * dt;
      if (p.gravity) p.vy += p.gravity * dt;
    }
  }

  draw(ctx) {
    const glow = this.glowEnabled;
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
        ctx.shadowColor = p.color; ctx.shadowBlur = glow ? 18 : 0;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
        continue;
      }

      ctx.globalCompositeOperation = 'lighter';

      if (p.kind === 'ring') {
        const r = p.r0 + (p.r1 - p.r0) * (1 - t);
        ctx.strokeStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = glow ? 16 : 0;
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
          ctx.strokeStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = glow ? 10 : 0;
          ctx.lineCap = 'round'; ctx.lineWidth = r * 1.3;
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        ctx.shadowColor = p.color; ctx.shadowBlur = glow ? 12 : 0;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        // белое ядро
        ctx.shadowBlur = glow ? 6 : 0; ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  clear() {
    for (const p of this.list) this._release(p);
    this.list.length = 0;
  }
}
