// Рандом-события рунета: редкие телеграфируемые гэги, которые не убивают.
// Каждое событие длится фиксированное время и запускает визуальный эффект.
import { CONFIG } from '../../config.js';
import { neonText, FONT } from '../engine/render.js';
import { STR, pick } from '../ui/strings.js';

const C = CONFIG.COLORS;

const GAG_TYPES = ['sber', 'rkn', 'ad'];

export class EventManager {
  constructor() {
    this.active = null;  // { type, timer, label }
    this.cooldown = 0;
  }

  trySpawn(distance) {
    if (this.active || this.cooldown > 0 || distance < CONFIG.GAG_MIN_DIST) return;
    if (Math.random() > CONFIG.GAG_CHANCE * 16) return; // вызов ~раз в кадр при 60fps
    const type = pick(GAG_TYPES);
    const label = type === 'sber' ? pick(STR.gagSber)
      : type === 'rkn' ? pick(STR.gagRkn)
      : pick(STR.gagAd);
    this.active = { type, timer: type === 'ad' ? 3.5 : 1.8, label, age: 0 };
    this.cooldown = CONFIG.GAG_COOLDOWN;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (!this.active) return null;
    this.active.age += dt;
    this.active.timer -= dt;
    if (this.active.timer <= 0) {
      const finished = this.active;
      this.active = null;
      return { type: finished.type, done: true };
    }
    return { type: this.active.type, timer: this.active.timer, age: this.active.age };
  }

  // speedMultiplier — замедление/заморозка фона при гэге
  speedMul() {
    if (!this.active) return 1;
    const t = this.active.type;
    if (t === 'sber') return 0.0;   // «лёг»: глитч-фриз
    if (t === 'rkn') return 0.35;   // slow-mo РКН
    return 1;                        // реклама не замедляет
  }

  // нужно ли тапнуть чтобы закрыть (тип 'ad')
  needsTap() { return this.active?.type === 'ad'; }

  onTap() {
    if (this.active?.type === 'ad') {
      this.active.timer = 0; // закрываем
    }
  }

  draw(ctx, W, H, t) {
    if (!this.active) return;
    const { type, label, age } = this.active;
    const alpha = Math.min(1, age / 0.2) * Math.min(1, this.active.timer / 0.3);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (type === 'sber') {
      // глитч-полосы по всему экрану
      for (let i = 0; i < 7; i++) {
        const gy = (i * H / 6 + t * 40) % H;
        ctx.fillStyle = i % 2 ? 'rgba(255,41,55,0.25)' : 'rgba(255,255,255,0.10)';
        ctx.fillRect(0, gy, W, 4 + i);
      }
      neonText(ctx, label, W / 2, H / 2, { color: C.white, size: 42, glow: 24 });
    } else if (type === 'rkn') {
      // затемнение краёв + метка
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(255,41,55,0.35)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      neonText(ctx, label, W / 2, H * 0.2, { color: C.red, size: 26, glow: 20 });
    } else {
      // поп-ап «реклама» с крестиком
      const pw = 220, ph = 90;
      const bx = (W - pw) / 2, by = H * 0.25;
      ctx.fillStyle = 'rgba(12,2,4,0.92)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, pw, ph, 10) : ctx.rect(bx, by, pw, ph);
      ctx.fill();
      ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.shadowColor = C.red; ctx.shadowBlur = 16;
      ctx.stroke();
      neonText(ctx, label, bx + pw / 2, by + ph / 2 - 8, { color: '#fff', size: 18, glow: 8 });
      neonText(ctx, '[ ТАП ЧТОБЫ ЗАКРЫТЬ ]', bx + pw / 2, by + ph - 14, { color: C.red, size: 11, glow: 6 });
    }
    ctx.restore();
  }
}
