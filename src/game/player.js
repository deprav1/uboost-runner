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

    // 1. Детализированные дюзы (экструзия)
    ctx.shadowColor = 'transparent'; // Отключаем тень для задников дюз
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-s * 0.82, -s * 0.24, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-s * 0.82, s * 0.24, s * 0.16, 0, Math.PI * 2); ctx.fill();

    ctx.shadowColor = glow; // Возвращаем свечение
    ctx.fillStyle = '#333';
    ctx.strokeStyle = boosting ? C.white : C.red;
    ctx.lineWidth = 2.5;
    
    // Верхняя дюза
    ctx.beginPath(); ctx.arc(-s * 0.72, -s * 0.24, s * 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = boosting ? '#fff' : C.hot;
    ctx.beginPath(); ctx.arc(-s * 0.72, -s * 0.24, s * 0.07, 0, Math.PI * 2); ctx.fill();
    
    // Нижняя дюза
    ctx.beginPath(); ctx.arc(-s * 0.72, s * 0.24, s * 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = boosting ? '#fff' : C.hot;
    ctx.beginPath(); ctx.arc(-s * 0.72, s * 0.24, s * 0.07, 0, Math.PI * 2); ctx.fill();

    // 2. Отрисовка 3D изометрического скруглённого куба с градиентами
    ctx.save();
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

    // Градиенты для граней
    const topGrad = ctx.createLinearGradient(0, -s * 1.2, 0, -s * 0.2);
    topGrad.addColorStop(0, boosting ? '#ffffff' : '#ff7a85');
    topGrad.addColorStop(1, boosting ? '#cccccc' : '#ff4d5a');

    const leftGrad = ctx.createLinearGradient(-s * 1.2, -s * 0.6, 0, s * 1.2);
    leftGrad.addColorStop(0, boosting ? C.hot : C.red);
    leftGrad.addColorStop(1, boosting ? C.redDeep : '#99000d');

    const rightGrad = ctx.createLinearGradient(0, 0, s * 1.2, s * 0.6);
    rightGrad.addColorStop(0, boosting ? C.redDeep : '#d61a27');
    rightGrad.addColorStop(1, boosting ? '#660009' : '#850712');

    // Верхняя грань
    ctx.fillStyle = topGrad;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-s, -s * 0.5); ctx.lineTo(0, -s * 1.25); ctx.lineTo(s, -s * 0.5); ctx.fill();

    // Левая грань
    ctx.fillStyle = leftGrad;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-s * 1.2, -s * 0.6); ctx.lineTo(-s * 1.2, s * 0.6); ctx.lineTo(0, s * 1.2); ctx.fill();

    // Правая грань
    ctx.fillStyle = rightGrad;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 1.2, -s * 0.6); ctx.lineTo(s * 1.2, s * 0.6); ctx.lineTo(0, s * 1.2); ctx.fill();

    // Стеклянный блик на верхней грани
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.15);
    ctx.lineTo(-s * 0.8, -s * 0.55);
    ctx.lineTo(-s * 0.6, -s * 0.85);
    ctx.lineTo(0, -s * 0.55);
    ctx.fill();

    // Линии стыков
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, s);
    ctx.moveTo(0, 0); ctx.lineTo(-s * 0.866, -s * 0.5);
    ctx.moveTo(0, 0); ctx.lineTo(s * 0.866, -s * 0.5);
    ctx.stroke();
    
    // Внутреннее свечение (rim light)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, -s * 0.4); ctx.lineTo(0, -s * 0.8); ctx.lineTo(s * 0.8, -s * 0.4);
    ctx.stroke();

    ctx.restore();

    // 3. Выпуклая карточка лого "Ю"
    ctx.save();
    ctx.transform(0.866, -0.5, 0, 1, s * 0.433, s * 0.25);
    
    const cardW = s * 0.62;
    const cardH = s * 0.62;
    
    // Тень под карточкой (парит над гранью)
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.shadowOffsetX = -2;
    
    ctx.fillStyle = '#f8f9fa';
    ctx.beginPath();
    roundRectPath(ctx, -cardW / 2, -cardH / 2, cardW, cardH, cardW * 0.25);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Внутренний объем карточки
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRectPath(ctx, -cardW / 2, -cardH / 2, cardW, cardH, cardW * 0.25);
    ctx.stroke();

    // Логотип
    const w_logo = cardW * 0.68;
    const h_logo = cardH * 0.55;
    const x_start = -w_logo / 2;
    const y_start = -h_logo / 2;

    ctx.fillStyle = '#111111';

    const barW = w_logo * 0.18;
    ctx.fillRect(x_start, y_start, barW, h_logo);

    const connW = w_logo * 0.22;
    const connH = h_logo * 0.18;
    ctx.fillRect(x_start + barW - 1, -connH / 2, connW + 2, connH);

    const loopW = w_logo - barW - connW;
    const loopH = h_logo;
    const cx = x_start + barW + connW + loopW / 2;
    ctx.beginPath();
    ctx.ellipse(cx, 0, loopW / 2, loopH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    const triW = loopW * 0.35;
    const triH = loopH * 0.45;
    ctx.fillStyle = '#f8f9fa';
    ctx.beginPath();
    ctx.moveTo(cx - triW * 0.38, -triH * 0.5);
    ctx.lineTo(cx - triW * 0.38, triH * 0.5);
    ctx.lineTo(cx + triW * 0.62, 0);
    ctx.fill();
    ctx.restore();

    // 4. Глаз (анимированный)
    ctx.save();
    ctx.transform(-0.866, -0.5, 0, 1, -s * 0.433, s * 0.25);
    this._drawEye(ctx, s, t);
    ctx.restore();

    ctx.restore();
  }

  _drawEye(ctx, s, t) {
    const m = this.mood;
    ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(0,0,0,0.5)';

    const blink = (m === 'normal' || m === 'idle') && (t % 4 < 0.15 || (t % 6 > 3 && t % 6 < 3.1));

    if (blink) {
      // Закрытый глаз (веко)
      ctx.fillStyle = C.redDeep;
      ctx.beginPath();
      roundRectPath(ctx, -s * 0.24, -s * 0.05, s * 0.48, s * 0.1, s * 0.05);
      ctx.fill();
      return;
    }

    // Белок глаза
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
    
    // Внутренняя тень глаза для объема
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowColor = 'transparent';

    if (m === 'boost') {
      // Крутые очки в бусте с неоновым отблеском
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.26, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Блик на очках
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.08, -s * 0.05, s * 0.1, s * 0.04, Math.PI / 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = C.white;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-s * 0.26, 0);
      ctx.lineTo(s * 0.26, 0);
      ctx.stroke();
    } else if (m === 'danger' || m === 'captcha') {
      // Испуганный зрачок
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      // Дрожащий блик
      ctx.fillStyle = '#fff';
      const tremble = Math.sin(t * 50) * s * 0.02;
      ctx.beginPath();
      ctx.arc(-s * 0.05 + tremble, -s * 0.05 + tremble, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Обычный зрачок с бликами
      const isIdle = m === 'idle';
      const pupilX = isIdle ? Math.sin(t * 2) * s * 0.08 : s * 0.06;
      const pupilY = isIdle ? Math.cos(t * 3) * s * 0.04 : 0;
      
      ctx.fillStyle = C.redDeep;
      ctx.beginPath();
      ctx.arc(pupilX, pupilY, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      
      // Два блика (аниме стиль)
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(pupilX - s * 0.04, pupilY - s * 0.04, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pupilX + s * 0.03, pupilY + s * 0.03, s * 0.015, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
