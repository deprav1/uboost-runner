// Препятствия = мусор рунета. Спавн «коридором» живёт в main.js,
// тут — класс, типы и честная (заниженная) геометрия попадания.
import { CONFIG } from '../../config.js';
import { neonRect, neonText, roundRectPath, floorGlow } from '../engine/render.js';
import { STR, pick } from '../ui/strings.js';
import { getSprite } from '../engine/assets.js';

const C = CONFIG.COLORS;

// Опасность кодируется янтарным варнингом (C.warn) — отрывается от красного
// игрока и холодного фона. Капча — нейтральная циан-структура.
const TYPES = {
  captcha: { color: C.grid, stat: 'captchas' },
  geoblock: { color: C.warn, stat: 'geoblocks' },
  ad: { color: C.warn, stat: 'ads' },
  lag: { color: C.warnDeep, stat: 'lags' },
};
const TYPE_KEYS = Object.keys(TYPES);

export class Obstacle {
  constructor(lane, type) {
    this.lane = lane;
    this.type = type;
    this.color = TYPES[type].color;
    this.stat = TYPES[type].stat;
    this.label = pick(STR.obstacleLabels[type]);
    this.x = 0;
    this.w = 0; this.h = 0;
    this.passed = false;
    this.dead = false;
    this.triggered = false; // капча уже запустила мини-игру → не триггерим повторно
    this.phase = Math.random() * Math.PI * 2;
    this.isCaptcha = type === 'captcha';
  }

  size(geom) {
    this.h = geom.laneH * 0.78;
    this.w = this.type === 'geoblock' ? geom.laneH * 0.55 : geom.laneH * 0.82;
  }

  // честный хитбокс — заметно меньше визуала, чтобы краем не убивало
  hitbox(geom) {
    const y = geom.laneY[this.lane];
    const mx = this.w * 0.12, my = this.h * 0.14;
    return { x: this.x + mx, y: y - this.h / 2 + my, w: this.w - mx * 2, h: this.h - my * 2 };
  }

  update(dt, speed) { this.x -= speed * dt; if (this.x + this.w < -40) this.dead = true; }

  draw(ctx, geom, t) {
    const y = geom.laneY[this.lane];
    const x = this.x, w = this.w, h = this.h;
    const top = y - h / 2;

    // световая лужа на полу под блоком — сажает препятствие в сцену
    floorGlow(ctx, x + w / 2, y + h * 0.46, w * 0.62, this.color, 0.4);

    ctx.save();

    // если есть спрайт — рисуем его поверх базовой рамки
    const spr = getSprite(`obstacles/${this.type}`);

    if (this.type === 'ad') {
      // мигающее окно казино / маркетплейса
      const blink = Math.sin(t * 12 + this.phase) > 0;
      neonRect(ctx, x, top, w, h, blink ? C.warn : C.white, { fill: 'rgba(20,12,2,0.92)', glow: 22, radius: 6 });
      ctx.fillStyle = blink ? C.white : C.warn;
      roundRectPath(ctx, x, top, w, h * 0.22, 6); ctx.fill();
      
      // три точки (macOS style) слева в заголовке
      const dotsY = top + h * 0.11;
      const dotR = h * 0.035;
      const colors = ['#ff5f56', '#ffbd2e', '#27c93f'];
      colors.forEach((cColor, i) => {
        ctx.fillStyle = cColor;
        ctx.beginPath();
        ctx.arc(x + 10 + i * 8, dotsY, dotR, 0, Math.PI * 2);
        ctx.fill();
      });

      neonText(ctx, '✕', x + w - 12, dotsY, { color: '#000', size: h * 0.13, glow: 0, weight: '900' });
      neonText(ctx, this.label, x + w / 2, top + h * 0.44, { color: '#fff', size: h * 0.14, weight: '800' });

      // кнопка призыва к действию (ЖМИ) в окне рекламы
      const btnW = w * 0.65;
      const btnH = h * 0.2;
      const btnX = x + (w - btnW) / 2;
      const btnY = top + h * 0.68;
      neonRect(ctx, btnX, btnY, btnW, btnH, blink ? C.warn : C.white, { fill: 'rgba(255, 178, 46, 0.18)', glow: 8, radius: 4, lw: 1.5 });
      neonText(ctx, 'ЖМИ!', btnX + btnW / 2, btnY + btnH / 2 + 1, { color: blink ? '#fff' : C.warn, size: h * 0.1, weight: '900' });
    } else if (this.type === 'geoblock') {
      // янтарная стена-варнинг РКН с замком
      neonRect(ctx, x, top, w, h, C.warn, { fill: 'rgba(28,18,2,0.88)', glow: 20, radius: 4 });

      // диагональные предупреждающие линии (классический «опасно»)
      ctx.save();
      ctx.strokeStyle = 'rgba(255,178,46,0.30)';
      ctx.lineWidth = 3;
      for (let offset = -h; offset < w; offset += 14) {
        ctx.beginPath();
        ctx.moveTo(x + Math.max(0, offset), top + Math.max(0, -offset));
        ctx.lineTo(x + Math.min(w, w + offset), top + Math.min(h, h - (w + offset)));
        ctx.stroke();
      }
      ctx.restore();

      for (let i = 1; i < 4; i++) { ctx.strokeStyle = 'rgba(255,178,46,0.4)'; ctx.beginPath(); ctx.moveTo(x, top + h * i / 4); ctx.lineTo(x + w, top + h * i / 4); ctx.stroke(); }
      
      // векторный замок вместо эмодзи
      const lockW = w * 0.32;
      const lockH = h * 0.25;
      const lockX = x + (w - lockW) / 2;
      const lockY = top + h * 0.22;
      
      ctx.strokeStyle = C.white;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(lockX + lockW / 2, lockY, lockW * 0.32, Math.PI, 0);
      ctx.stroke();
      
      neonRect(ctx, lockX, lockY, lockW, lockH, C.warn, { fill: '#1a1200', glow: 10, radius: 3, lw: 1.5 });
      
      ctx.fillStyle = C.white;
      ctx.beginPath();
      ctx.arc(lockX + lockW / 2, lockY + lockH * 0.4, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(lockX + lockW / 2 - 2, lockY + lockH * 0.4);
      ctx.lineTo(lockX + lockW / 2 + 2, lockY + lockH * 0.4);
      ctx.lineTo(lockX + lockW / 2 + 3.5, lockY + lockH * 0.75);
      ctx.lineTo(lockX + lockW / 2 - 3.5, lockY + lockH * 0.75);
      ctx.closePath();
      ctx.fill();

      neonText(ctx, this.label, x + w / 2, top + h * 0.72, { color: '#fff', size: h * 0.12, weight: '800' });
    } else if (this.type === 'lag') {
      // глитч-блок «всё легло» + буфер-спиннер
      ctx.globalAlpha = 0.78;
      neonRect(ctx, x, top, w, h, C.warnDeep, { fill: 'rgba(16,10,0,0.74)', glow: 16, radius: 6 });

      for (let i = 0; i < 4; i++) {
        if (Math.sin(t * 24 + i + this.phase) > 0.4) {
          ctx.fillStyle = i % 2 ? C.warn : C.white;
          ctx.globalAlpha = 0.55; 
          ctx.fillRect(x - 3 + Math.sin(t * 40) * 3, top + Math.random() * h, w + 6, 2); 
        }
      }
      ctx.globalAlpha = 1;
      
      // хроматический сдвиг для слова ERROR
      const glX = x + w / 2;
      const glY = top + h * 0.32;
      const glOffset = Math.sin(t * 30) * 1.5;
      
      neonText(ctx, 'ERROR', glX - glOffset, glY, { color: '#00f0ff', size: h * 0.13, weight: '900', glow: 2 });
      neonText(ctx, 'ERROR', glX + glOffset, glY, { color: '#ff0055', size: h * 0.13, weight: '900', glow: 2 });
      neonText(ctx, 'ERROR', glX, glY, { color: '#fff', size: h * 0.13, weight: '900', glow: 0 });

      const spinnerCx = x + w / 2;
      const spinnerCy = y + h * 0.08;
      const spinnerR = h * 0.15;
      ctx.save();
      ctx.translate(spinnerCx, spinnerCy);
      ctx.rotate(t * 6);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = C.warn;
        ctx.globalAlpha = 0.15 + (i / 8) * 0.85;
        ctx.beginPath();
        ctx.arc(spinnerR * Math.cos(i * Math.PI / 4), spinnerR * Math.sin(i * Math.PI / 4), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      
      neonText(ctx, this.label, x + w / 2, top + h * 0.82, { color: C.white, size: h * 0.12, weight: '800' });
    } else {
      // капча — белая рамка, красная сетка 3×3
      neonRect(ctx, x, top, w, h, C.white, { fill: 'rgba(12,2,4,0.9)', glow: 16, radius: 6 });
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      roundRectPath(ctx, x, top, w, h * 0.28, 6);
      ctx.fill();
      
      neonText(ctx, this.label, x + w / 2, top + h * 0.14, { color: '#fff', size: h * 0.12, weight: '900' });
      
      const gy = top + h * 0.32, gh = h * 0.62, cell = Math.min(w * 0.9, gh) / 3;
      const gx = x + (w - cell * 3) / 2;

      // угловыеbrackets/рамка прицела
      const pad = 2;
      const gridX = gx - pad, gridY = gy - pad;
      const gridW = cell * 3 + pad * 2, gridH = cell * 3 + pad * 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      
      ctx.beginPath(); ctx.moveTo(gridX + 8, gridY); ctx.lineTo(gridX, gridY); ctx.lineTo(gridX, gridY + 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gridX + gridW - 8, gridY); ctx.lineTo(gridX + gridW, gridY); ctx.lineTo(gridX + gridW, gridY + 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gridX, gridY + gridH - 8); ctx.lineTo(gridX, gridY + gridH); ctx.lineTo(gridX + 8, gridY + gridH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gridX + gridW - 8, gridY + gridH); ctx.lineTo(gridX + gridW, gridY + gridH); ctx.lineTo(gridX + gridW, gridY + gridH - 8); ctx.stroke();

      for (let r = 0; r < 3; r++) for (let cN = 0; cN < 3; cN++) {
        const on = Math.sin(t * 4 + r + cN + this.phase) > 0.6;
        ctx.strokeStyle = C.grid; ctx.globalAlpha = on ? 1 : 0.35; ctx.lineWidth = 1.2;
        ctx.strokeRect(gx + cN * cell + 1.5, gy + r * cell + 1.5, cell - 3, cell - 3);
        if (on) {
          ctx.fillStyle = 'rgba(22, 224, 255, 0.12)';
          ctx.fillRect(gx + cN * cell + 2.5, gy + r * cell + 2.5, cell - 5, cell - 5);
        }
      }
      ctx.globalAlpha = 1;

      // кнопка VERIFY (Подтвердить)
      const btnW = w * 0.38;
      const btnH = h * 0.16;
      const btnX = x + w - btnW - 6;
      const btnY = top + h - btnH - 6;
      neonRect(ctx, btnX, btnY, btnW, btnH, C.grid, { fill: 'rgba(22, 224, 255, 0.15)', glow: 6, radius: 3, lw: 1.2 });
      neonText(ctx, 'VERIFY', btnX + btnW / 2, btnY + btnH / 2 + 1, { color: '#fff', size: h * 0.08, weight: '900' });

      // круговая стрелочка обновления
      const refreshX = x + 12;
      const refreshY = top + h - 14;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(refreshX, refreshY, 5, 0, Math.PI * 1.6);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.moveTo(refreshX + 3.5, refreshY - 3.5);
      ctx.lineTo(refreshX + 6.5, refreshY - 2);
      ctx.lineTo(refreshX + 5, refreshY + 1);
      ctx.closePath();
      ctx.fill();
    }

    // спрайт-оверлей поверх процедурки (если есть ассет)
    if (spr) {
      ctx.globalAlpha = 1;
      ctx.drawImage(spr, x, top, w, h);
    }
    ctx.restore();
  }
}

// Следующая безопасная полоса — всегда в пределах ±1 (гарантия достижимости).
// Биас «остаться» делает траекторию читаемой. Единый источник истины для main + тестов.
export function nextSafeLane(prev, lanes = CONFIG.LANES) {
  const opts = [prev, prev];
  if (prev > 0) opts.push(prev - 1);
  if (prev < lanes - 1) opts.push(prev + 1);
  return opts[(Math.random() * opts.length) | 0];
}

export { TYPES, TYPE_KEYS };
