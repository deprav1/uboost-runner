// Фон: чёрно-красный градиент, пульсирующее красное ядро, перспективная сетка,
// параллакс «дата-вышки», звёзды и спид-лайны. Скорость читается глазами.
import { CONFIG } from '../../config.js';
import { speedlines } from '../engine/render.js';
import { getSprite } from '../engine/assets.js';

const C = CONFIG.COLORS;

export class World {
  constructor() {
    this.scroll = 0;       // фаза бегущей сетки
    this.railOff = 0;      // смещение пунктира рельсов (px)
    this.lineOff = 0;      // смещение спид-лайнов (px)
    this.starOff = 0;
    this.towers = [];
    this.seedTowers();
  }

  seedTowers() {
    this.towers = [];
    for (let i = 0; i < 14; i++) {
      this.towers.push({
        x: Math.random(), w: 0.04 + Math.random() * 0.06,
        h: 0.05 + Math.random() * 0.16,
        a: 0.35 + Math.random() * 0.4,
      });
    }
  }

  update(dt, speed) {
    this.scroll = (this.scroll + speed * dt * 0.0024) % 1;
    this.railOff = (this.railOff + speed * dt) % 100000;
    this.lineOff = (this.lineOff + speed * dt * 1.4) % 1000000;
    this.starOff = (this.starOff + speed * dt * 0.04) % 2000;
    for (const t of this.towers) {
      t.x -= speed * dt * 0.00003;
      if (t.x < -0.15) { t.x = 1.1 + Math.random() * 0.2; t.h = 0.05 + Math.random() * 0.16; t.a = 0.35 + Math.random() * 0.4; }
    }
  }

  draw(ctx, W, H, speed = 0) {
    // небо
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bgTop);
    g.addColorStop(0.55, '#0a0204');
    g.addColorStop(1, C.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const horizon = H * 0.42;

    // красное ядро (радиальное свечение + полосы)
    ctx.save();
    const coreR = Math.min(W, H) * 0.24;
    const halo = ctx.createRadialGradient(W / 2, horizon, coreR * 0.2, W / 2, horizon, coreR * 2.4);
    halo.addColorStop(0, 'rgba(255,41,55,0.45)');
    halo.addColorStop(0.5, 'rgba(255,41,55,0.10)');
    halo.addColorStop(1, 'rgba(255,41,55,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, horizon + coreR);

    ctx.beginPath();
    ctx.arc(W / 2, horizon, coreR, 0, Math.PI * 2);
    ctx.clip();
    const sg = ctx.createLinearGradient(0, horizon - coreR, 0, horizon + coreR);
    sg.addColorStop(0, C.coreTop);
    sg.addColorStop(1, C.coreBottom);
    ctx.fillStyle = sg;
    ctx.fillRect(W / 2 - coreR, horizon - coreR, coreR * 2, coreR * 2);
    // тёмные полосы поперёк ядра
    ctx.fillStyle = C.bgBottom;
    for (let i = 0; i < 8; i++) ctx.fillRect(W / 2 - coreR, horizon - 14 + i * 13, coreR * 2, 4 + i);
    ctx.restore();

    // звёзды
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 44; i++) {
      const x = (i * 137.5 + this.starOff * 0.2) % W;
      const y = (i * 53.7) % horizon;
      ctx.globalAlpha = 0.25 + 0.45 * Math.abs(Math.sin(i + this.starOff * 0.002));
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // дата-вышки на горизонте
    ctx.save();
    for (const t of this.towers) {
      const tx = t.x * W, tw = t.w * W, th = t.h * H;
      ctx.shadowColor = C.red; ctx.shadowBlur = 12;
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.5;
      ctx.globalAlpha = t.a;
      ctx.strokeRect(tx, horizon - th, tw, th);
    }
    ctx.restore();

    // линия горизонта
    ctx.save();
    ctx.shadowColor = C.red; ctx.shadowBlur = 20;
    ctx.strokeStyle = C.red; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(W, horizon); ctx.stroke();
    ctx.restore();

    // перспективная сетка-пол
    ctx.save();
    ctx.strokeStyle = C.grid; ctx.shadowColor = C.grid; ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    const vpx = W / 2;
    ctx.globalAlpha = 0.55;
    for (let i = -10; i <= 10; i++) {
      const fx = vpx + i * (W / 10);
      ctx.beginPath();
      ctx.moveTo(vpx + i * 12, horizon);
      ctx.lineTo(fx, H);
      ctx.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const p = ((i + this.scroll) / 16);
      const y = horizon + (H - horizon) * (p * p);
      ctx.globalAlpha = 0.18 + 0.6 * p;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    // спид-лайны поверх фона
    if (speed > 0) speedlines(ctx, W, H, speed, this.lineOff, C.red, C.white, CONFIG.SPEEDLINES);

    // спрайт-оверлей горизонта (skyline)
    const skyline = getSprite('world/skyline');
    if (skyline) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(skyline, 0, horizon - skyline.height * (W / skyline.width) * 0.5, W, skyline.height * (W / skyline.width));
      ctx.restore();
    }
  }
}

// Геометрия полос — единая точка истины
export function geometry(W, H) {
  const top = H * CONFIG.LANE_BAND_TOP;
  const bottom = H * CONFIG.LANE_BAND_BOTTOM;
  const band = bottom - top;
  const laneH = band / CONFIG.LANES;
  const laneY = [];
  for (let i = 0; i < CONFIG.LANES; i++) laneY.push(top + laneH * (i + 0.5));
  return { W, H, laneY, laneH, playerX: W * CONFIG.PLAYER_X };
}
