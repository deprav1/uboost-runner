// Ракета-маскот: смена полосы с твином + банкинг, неон-отрисовка, шлейф.
import { CONFIG } from '../../config.js';
import { lerp, clamp } from '../engine/render.js';

const C = CONFIG.COLORS;

export class Player {
  constructor() { this.reset(); }

  reset() {
    this.lane = 1;          // целевая полоса (центр)
    this.y = 0;             // текущий Y (px), задаётся в первом кадре
    this.tilt = 0;          // наклон
    this.size = 30;
    this.inited = false;
    this.invuln = 0;        // секунд неуязвимости (буст)
  }

  setLane(l) { this.lane = clamp(l, 0, CONFIG.LANES - 1); }
  up() { this.setLane(this.lane - 1); }
  down() { this.setLane(this.lane + 1); }

  update(dt, geom, particles, boosting) {
    const targetY = geom.laneY[this.lane];
    if (!this.inited) { this.y = targetY; this.inited = true; }
    const k = 1 - Math.pow(1 - CONFIG.LANE_TWEEN, dt * 1000 / 16);
    const prevY = this.y;
    this.y = lerp(this.y, targetY, k);
    const dy = this.y - prevY;
    this.tilt = clamp(dy * 0.05, -0.5, 0.5);
    this.size = geom.laneH * 0.34;
    if (this.invuln > 0) this.invuln -= dt;

    // шлейф
    const col = boosting ? C.yellow : (Math.random() > 0.5 ? C.cyan : C.magenta);
    particles.thruster(geom.playerX - this.size * 0.7, this.y, col);
  }

  hitbox(geom) {
    const s = this.size;
    return { x: geom.playerX - s * 0.7, y: this.y - s * 0.6, w: s * 1.5, h: s * 1.2 };
  }

  draw(ctx, geom, boosting, t) {
    const x = geom.playerX, y = this.y, s = this.size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.tilt);

    // мерцание при неуязвимости
    if (this.invuln > 0 && Math.floor(t * 20) % 2 === 0) ctx.globalAlpha = 0.55;

    const glow = boosting ? C.yellow : C.rocketGlow;
    ctx.shadowColor = glow;
    ctx.shadowBlur = boosting ? 34 : 20;

    // корпус — шеврон/ракета
    const body = ctx.createLinearGradient(-s, 0, s, 0);
    body.addColorStop(0, C.purple);
    body.addColorStop(1, boosting ? C.yellow : C.cyan);
    ctx.fillStyle = body;
    ctx.strokeStyle = boosting ? C.yellow : C.cyan;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s * 1.2, 0);          // нос
    ctx.lineTo(-s * 0.6, -s * 0.7);  // верх
    ctx.lineTo(-s * 0.2, 0);         // выемка хвоста
    ctx.lineTo(-s * 0.6, s * 0.7);   // низ
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // крылья
    ctx.fillStyle = C.magenta;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.4);
    ctx.lineTo(-s * 0.9, -s * 1.0);
    ctx.lineTo(-s * 0.5, -s * 0.2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, s * 0.4);
    ctx.lineTo(-s * 0.9, s * 1.0);
    ctx.lineTo(-s * 0.5, s * 0.2);
    ctx.closePath(); ctx.fill();

    // окно-глаз
    ctx.shadowBlur = 10; ctx.shadowColor = '#fff';
    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.arc(s * 0.35, 0, s * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.purple;
    ctx.beginPath();
    ctx.arc(s * 0.42, 0, s * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
