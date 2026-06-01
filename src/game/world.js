// Фон синтвейв: градиент, неоновое солнце, сетка-перспектива + параллакс «дата-башни».
import { CONFIG } from '../../config.js';

const C = CONFIG.COLORS;

export class World {
  constructor() {
    this.scroll = 0;      // фаза бегущей сетки
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
        c: Math.random() > 0.5 ? C.cyan : C.magenta,
      });
    }
  }

  update(dt, speed) {
    this.scroll = (this.scroll + speed * dt * 0.0016) % 1;
    this.starOff = (this.starOff + speed * dt * 0.02) % 2000;
    for (const t of this.towers) {
      t.x -= speed * dt * 0.00002;
      if (t.x < -0.15) { t.x = 1.1 + Math.random() * 0.2; t.h = 0.05 + Math.random() * 0.16; t.c = Math.random() > 0.5 ? C.cyan : C.magenta; }
    }
  }

  draw(ctx, W, H, hueShift = 0) {
    // вертикальный градиент неба
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bgTop);
    g.addColorStop(1, C.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const horizon = H * 0.42;

    // солнце
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, horizon, Math.min(W, H) * 0.22, 0, Math.PI * 2);
    ctx.clip();
    const sg = ctx.createLinearGradient(0, horizon - 160, 0, horizon + 60);
    sg.addColorStop(0, C.sunTop);
    sg.addColorStop(1, C.sunBottom);
    ctx.fillStyle = sg;
    ctx.fillRect(W / 2 - 300, horizon - 200, 600, 400);
    // полосы на солнце
    ctx.fillStyle = C.bgBottom;
    for (let i = 0; i < 8; i++) ctx.fillRect(W / 2 - 300, horizon - 20 + i * 12, 600, 5 + i);
    ctx.restore();

    // звёзды
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 40; i++) {
      const x = (i * 137.5 + this.starOff * 0.2) % W;
      const y = (i * 53.7) % horizon;
      ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(i + this.starOff * 0.002));
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // дата-башни на горизонте
    ctx.save();
    for (const t of this.towers) {
      const tx = t.x * W, tw = t.w * W, th = t.h * H;
      ctx.shadowColor = t.c; ctx.shadowBlur = 14;
      ctx.strokeStyle = t.c; ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.strokeRect(tx, horizon - th, tw, th);
    }
    ctx.restore();

    // линия горизонта
    ctx.save();
    ctx.shadowColor = C.cyan; ctx.shadowBlur = 18;
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(W, horizon); ctx.stroke();
    ctx.restore();

    // сетка-перспектива (пол)
    ctx.save();
    ctx.strokeStyle = C.grid; ctx.shadowColor = C.grid; ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
    const vpx = W / 2;
    // вертикальные линии, сходящиеся к точке схода
    for (let i = -10; i <= 10; i++) {
      const fx = vpx + i * (W / 10);
      ctx.beginPath();
      ctx.moveTo(vpx + i * 12, horizon);
      ctx.lineTo(fx, H);
      ctx.stroke();
    }
    // горизонтальные линии, бегущие вниз
    for (let i = 0; i < 16; i++) {
      const p = ((i + this.scroll) / 16);
      const y = horizon + (H - horizon) * (p * p); // нелинейно = перспектива
      ctx.globalAlpha = 0.2 + 0.6 * p;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
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
