// Ракета-маскот: снаппи-твин, стретч, выражения «глаза» по состоянию, idle-вигл.
import { CONFIG } from '../../config.js';
import { lerp, clamp } from '../engine/render.js';

const C = CONFIG.COLORS;

// mood: 'normal' | 'boost' | 'danger' | 'captcha' | 'idle'
export class Player {
  constructor() { this.reset(); }

  reset() {
    this.lane = 1;
    this.y = 0;
    this.tilt = 0;
    this.stretch = 0;
    this.size = 30;
    this.inited = false;
    this.invuln = 0;
    this.mood = 'normal';
    this._idleTimer = 0;
    this._idleOff = 0;
  }

  setLane(l) { this.lane = clamp(l, 0, CONFIG.LANES - 1); }
  up() { this.setLane(this.lane - 1); }
  down() { this.setLane(this.lane + 1); }

  update(dt, geom, particles, boosting, speedFrac = 0) {
    const targetY = geom.laneY[this.lane];
    if (!this.inited) { this.y = targetY; this.inited = true; }
    const k = 1 - Math.exp(-dt / CONFIG.LANE_TAU);
    const prevY = this.y;
    this.y = lerp(this.y, targetY, k);
    const dy = this.y - prevY;
    this.tilt = clamp(dy * 0.035, -0.45, 0.45);
    this.stretch = lerp(this.stretch, clamp(Math.abs(dy) * 0.05, 0, 0.4), 0.5);
    this.size = geom.laneH * 0.34;
    if (this.invuln > 0) this.invuln -= dt;

    this._idleTimer += dt;
    this._idleOff = Math.sin(this._idleTimer * 1.8) * 2.5;

    const puffs = boosting ? 3 : (speedFrac > 0.5 ? 2 : 1);
    for (let i = 0; i < puffs; i++) {
      const col = boosting ? (Math.random() > 0.5 ? C.white : C.hot) : (Math.random() > 0.4 ? C.red : C.white);
      particles.thruster(geom.playerX - this.size * 0.7, this.y, col);
    }
  }

  hitbox(geom) {
    const s = this.size;
    return { x: geom.playerX - s * 0.45, y: this.y - s * 0.42, w: s * 1.05, h: s * 0.84 };
  }

  draw(ctx, geom, boosting, t) {
    const x = geom.playerX, y = this.y + this._idleOff, s = this.size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.tilt);
    ctx.scale(1 - this.stretch * 0.45, 1 + this.stretch * 0.5);

    if (this.invuln > 0 && Math.floor(t * 20) % 2 === 0) ctx.globalAlpha = 0.6;

    const glow = boosting ? C.hot : C.rocketGlow;
    ctx.shadowColor = glow;
    ctx.shadowBlur = boosting ? 36 : 20;

    const body = ctx.createLinearGradient(-s, 0, s, 0);
    body.addColorStop(0, boosting ? C.hot : C.redDeep);
    body.addColorStop(1, C.white);
    ctx.fillStyle = body;
    ctx.strokeStyle = boosting ? C.white : C.red;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(s * 1.2, 0);
    ctx.lineTo(-s * 0.6, -s * 0.7);
    ctx.lineTo(-s * 0.2, 0);
    ctx.lineTo(-s * 0.6, s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = C.red;
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

    // Глаза маскота — выражение по состоянию
    this._drawEye(ctx, s, t);

    ctx.restore();
  }

  _drawEye(ctx, s, t) {
    const m = this.mood;
    ctx.shadowBlur = 10; ctx.shadowColor = C.red;

    // белки
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s * 0.35, 0, s * 0.26, 0, Math.PI * 2);
    ctx.fill();

    if (m === 'boost') {
      // 😎 — солнечные очки (тёмный эллипс)
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(s * 0.35, 0, s * 0.26, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(s * 0.35 - s * 0.26, 0);
      ctx.lineTo(s * 0.35 + s * 0.26, 0);
      ctx.stroke();
    } else if (m === 'danger' || m === 'captcha') {
      // 😱 — большие глаза
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(s * 0.35, 0, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s * 0.30, -s * 0.05, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // обычный / near-miss
      const pupilSize = m === 'normal' ? s * 0.12 : s * 0.08;
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.arc(s * 0.42, 0, pupilSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
