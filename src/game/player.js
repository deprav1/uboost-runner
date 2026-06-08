// Ракета-маскот: снаппи-твин, стретч, выражения «глаза» по состоянию, idle-вигл.
import { CONFIG } from '../../config.js';
import { lerp, clamp, roundRectPath } from '../engine/render.js';

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

    // 1. Две реактивные дюзы сзади куба для испускания частиц
    ctx.fillStyle = '#222222';
    ctx.strokeStyle = boosting ? C.white : C.red;
    ctx.lineWidth = 2;
    
    // Верхняя дюза
    ctx.beginPath();
    ctx.arc(-s * 0.76, -s * 0.22, s * 0.14, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    
    // Нижняя дюза
    ctx.beginPath();
    ctx.arc(-s * 0.76, s * 0.22, s * 0.14, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // 2. Отрисовка 3D изометрического скруглённого куба (маскота)
    ctx.save();
    // Создаем маску скругленного шестиугольника (проекция скругленного куба)
    const radius = s * 0.18;
    const V = [
      { x: 0, y: -s },
      { x: s * 0.866, y: -s * 0.5 },
      { x: s * 0.866, y: s * 0.5 },
      { x: 0, y: s },
      { x: -s * 0.866, y: s * 0.5 },
      { x: -s * 0.866, y: -s * 0.5 }
    ];
    
    ctx.beginPath();
    ctx.moveTo((V[0].x + V[5].x) / 2, (V[0].y + V[5].y) / 2);
    for (let i = 0; i < 6; i++) {
      const next = (i + 1) % 6;
      ctx.arcTo(V[i].x, V[i].y, V[next].x, V[next].y, radius);
    }
    ctx.closePath();
    ctx.clip();

    // Отрисовка граней:
    // Верхняя грань (светлый красный)
    ctx.fillStyle = boosting ? C.white : '#ff4d5a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-s, -s * 0.5);
    ctx.lineTo(0, -s * 1.25);
    ctx.lineTo(s, -s * 0.5);
    ctx.closePath();
    ctx.fill();

    // Левая грань (основной красный)
    ctx.fillStyle = boosting ? C.hot : C.red;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-s * 1.2, -s * 0.6);
    ctx.lineTo(-s * 1.2, s * 0.6);
    ctx.lineTo(0, s * 1.2);
    ctx.closePath();
    ctx.fill();

    // Правая грань (темный красный)
    ctx.fillStyle = boosting ? C.redDeep : '#d61a27';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 1.2, -s * 0.6);
    ctx.lineTo(s * 1.2, s * 0.6);
    ctx.lineTo(0, s * 1.2);
    ctx.closePath();
    ctx.fill();

    // Тонкие линии стыков граней
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, s);
    ctx.moveTo(0, 0); ctx.lineTo(-s * 0.866, -s * 0.5);
    ctx.moveTo(0, 0); ctx.lineTo(s * 0.866, -s * 0.5);
    ctx.stroke();
    ctx.restore();

    // 3. Отрисовка белой скругленной карточки с логотипом "Ю" на правой грани
    ctx.save();
    // Сдвигаем в центр правой грани и применяем изометрический скос
    ctx.transform(0.866, -0.5, 0, 1, s * 0.433, s * 0.25);
    
    const cardW = s * 0.62;
    const cardH = s * 0.62;
    ctx.fillStyle = C.white;
    ctx.beginPath();
    roundRectPath(ctx, -cardW / 2, -cardH / 2, cardW, cardH, cardW * 0.25);
    ctx.fill();

    // Черный логотип "Ю"
    const w_logo = cardW * 0.68;
    const h_logo = cardH * 0.55;
    const x_start = -w_logo / 2;
    const y_start = -h_logo / 2;

    ctx.fillStyle = '#111111';

    // Левый вертикальный штрих
    const barW = w_logo * 0.18;
    ctx.fillRect(x_start, y_start, barW, h_logo);

    // Перемычка
    const connW = w_logo * 0.22;
    const connH = h_logo * 0.18;
    ctx.fillRect(x_start + barW - 1, -connH / 2, connW + 2, connH);

    // Правый овал
    const loopW = w_logo - barW - connW;
    const loopH = h_logo;
    const cx = x_start + barW + connW + loopW / 2;
    const cy = 0;
    ctx.beginPath();
    ctx.ellipse(cx, cy, loopW / 2, loopH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Белая кнопка PLAY (треугольник) внутри овала
    const triW = loopW * 0.35;
    const triH = loopH * 0.45;
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.moveTo(cx - triW * 0.38, -triH * 0.5);
    ctx.lineTo(cx - triW * 0.38, triH * 0.5);
    ctx.lineTo(cx + triW * 0.62, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 4. Отрисовка живого глаза на левой грани (смотрит по направлению движения)
    ctx.save();
    ctx.transform(-0.866, -0.5, 0, 1, -s * 0.433, s * 0.25);
    this._drawEye(ctx, s, t);
    ctx.restore();

    ctx.restore();
  }

  _drawEye(ctx, s, t) {
    const m = this.mood;
    ctx.shadowBlur = 10; ctx.shadowColor = C.red;

    // Белок глаза
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2);
    ctx.fill();

    if (m === 'boost') {
      // 😎 крутые очки в бусте
      ctx.fillStyle = '#111111';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.24, s * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.24, 0);
      ctx.lineTo(s * 0.24, 0);
      ctx.stroke();
    } else if (m === 'danger' || m === 'captcha') {
      // 😱 испуганный зрачок
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      // Блик
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-s * 0.05, -s * 0.05, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Обычный зрачок (слегка косит вперед)
      const pupilSize = m === 'normal' ? s * 0.11 : s * 0.07;
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.arc(s * 0.04, 0, pupilSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
