// Препятствия = мусор рунета. Спавн «коридором» живёт в main.js,
// тут — класс, типы и честная (заниженная) геометрия попадания.
import { CONFIG } from '../../config.js';
import { neonRect, neonText, roundRectPath, floorGlow } from '../engine/render.js';
import { STR, pick } from '../ui/strings.js';
import { getSprite } from '../engine/assets.js';
import { Settings } from './settings.js';

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
    this.z = 1.0;                 // глубина: 1 = горизонт, 0 = камера
    this.laneNorm = 0;            // выставляется в size(geom)
    this.baseW = 0; this.baseH = 0;
    this.passed = false;
    this.dead = false;
    this.triggered = false; // капча уже запустила мини-игру → не триггерим повторно
    this.phase = Math.random() * Math.PI * 2;
    this.isCaptcha = type === 'captcha';
    this.warned = false;     // часть «двойного блока» — телеграфируем заранее
    this.warnPlayed = false; // sfxWarn() уже сыгран при входе в зону телеграфа
  }

  // базовые габариты в «объектных» единицах (умножаются на scale при отрисовке)
  size(geom) {
    this.laneNorm = geom.laneNorm(this.lane);
    this.baseH = geom.unit * 0.95;
    this.baseW = this.type === 'geoblock' ? geom.unit * 0.66 : geom.unit * 0.98;
  }

  update(dt, speed) { this.z -= speed * dt * CONFIG.RUN.Z_RATE; if (this.z < -0.06) this.dead = true; }

  draw(ctx, geom, t) {
    const proj = geom.project(this.laneNorm, this.z);
    const w = this.baseW * proj.scale, h = this.baseH * proj.scale;
    const x = proj.x - w / 2, y = proj.y;
    const top = y - h / 2;

    // световая лужа на полу под блоком — сажает препятствие в сцену
    floorGlow(ctx, x + w / 2, y + h * 0.46, w * 0.62, this.color, 0.4);

    ctx.save();

    // статичная часть (рамка/штриховка/замок/лейблы) — из оффскрин-кэша:
    // дорогие neonRect/neonText с shadowBlur рисуются один раз на тип+лейбл.
    const variant = this.type === 'ad' ? (Math.sin(t * 12 + this.phase) > 0 ? 1 : 0) : 0;
    const cached = staticSprite(this.type, this.label, variant, Settings.get('colorAssist'));
    if (cached) ctx.drawImage(cached, x, top, w, h);

    // динамика поверх кэша
    if (this.type === 'lag') drawLagDynamics(ctx, x, top, w, h, y, t, this.phase);
    else if (this.type === 'captcha') drawCaptchaCells(ctx, x, top, w, h, t, this.phase);

    // спрайт-оверлей поверх процедурки (если есть ассет)
    const spr = getSprite(`obstacles/${this.type}`);
    if (spr) {
      ctx.globalAlpha = 1;
      ctx.drawImage(spr, x, top, w, h);
    }

    // телеграф «двойного блока»: пульсирующий «!» + янтарный шеврон над препятствием
    if (this.warned && this.z > CONFIG.JUICE.WARN_Z) {
      const pulse = 0.7 + Math.sin(t * 14 + this.phase) * 0.3;
      ctx.globalAlpha = pulse;
      neonText(ctx, '⚠', x + w / 2, top - h * 0.18, { color: C.warn, size: h * 0.26, weight: '900', glow: 14 });
      ctx.strokeStyle = C.warn;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.32, top - h * 0.02);
      ctx.lineTo(x + w * 0.5, top - h * 0.12);
      ctx.lineTo(x + w * 0.68, top - h * 0.02);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

// --- Оффскрин-кэш статичной отрисовки ----------------------------------------
// Ключ: type|label|variant. Кэш фиксированного разрешения, при отрисовке
// масштабируется под проекцию — разрешения хватает и для ближнего плана.
const CACHE_W = 280;
// отношение высоты к ширине = baseH/baseW из size() (фиксировано на тип)
const CACHE_RATIO = { captcha: 0.95 / 0.98, ad: 0.95 / 0.98, lag: 0.95 / 0.98, geoblock: 0.95 / 0.66 };
const staticCache = new Map();

function staticSprite(type, label, variant, assist = false) {
  const key = type + '|' + label + '|' + variant + '|' + (assist ? 1 : 0);
  let cv = staticCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    const w = CACHE_W, h = Math.round(CACHE_W * CACHE_RATIO[type]);
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    if (!c) return null;
    if (type === 'ad') drawStaticAd(c, w, h, label, variant === 1);
    else if (type === 'geoblock') drawStaticGeoblock(c, w, h, label);
    else if (type === 'lag') drawStaticLag(c, w, h, label);
    else drawStaticCaptcha(c, w, h, label);
    if (assist) drawAssistMarker(c, w, h, type);
    staticCache.set(key, cv);
  }
  return cv;
}

// Дальтоник-режим: летальность дублируется формой/маркером, не только цветом.
// Летальные препятствия (geoblock/ad/lag) — толстый сплошной контур + «⚠».
// Капча (нелетальна, мини-игра) — пунктирный контур + «?».
function drawAssistMarker(ctx, w, h, type) {
  ctx.save();
  if (type === 'captcha') {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.setLineDash([]);
    neonText(ctx, '?', w * 0.12, h * 0.12, { color: '#fff', size: h * 0.13, weight: '900', glow: 6 });
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    neonText(ctx, '⚠', w * 0.12, h * 0.12, { color: C.white, size: h * 0.16, weight: '900', glow: 8 });
  }
  ctx.restore();
}

function drawStaticAd(ctx, w, h, label, blink) {
  // мигающее окно казино / маркетплейса (два варианта по фазе мигания)
  neonRect(ctx, 0, 0, w, h, blink ? C.warn : C.white, { fill: 'rgba(20,12,2,0.92)', glow: 22, radius: 6 });
  ctx.fillStyle = blink ? C.white : C.warn;
  roundRectPath(ctx, 0, 0, w, h * 0.22, 6); ctx.fill();

  // три точки (macOS style) слева в заголовке
  const dotsY = h * 0.11;
  const dotR = h * 0.035;
  const colors = ['#ff5f56', '#ffbd2e', '#27c93f'];
  colors.forEach((cColor, i) => {
    ctx.fillStyle = cColor;
    ctx.beginPath();
    ctx.arc(10 + i * 8, dotsY, dotR, 0, Math.PI * 2);
    ctx.fill();
  });

  neonText(ctx, '✕', w - 12, dotsY, { color: '#000', size: h * 0.13, glow: 0, weight: '900' });
  neonText(ctx, label, w / 2, h * 0.44, { color: '#fff', size: h * 0.14, weight: '800' });

  // кнопка призыва к действию (ЖМИ) в окне рекламы
  const btnW = w * 0.65;
  const btnH = h * 0.2;
  const btnX = (w - btnW) / 2;
  const btnY = h * 0.68;
  neonRect(ctx, btnX, btnY, btnW, btnH, blink ? C.warn : C.white, { fill: 'rgba(255, 178, 46, 0.18)', glow: 8, radius: 4, lw: 1.5 });
  neonText(ctx, 'ЖМИ!', btnX + btnW / 2, btnY + btnH / 2 + 1, { color: blink ? '#fff' : C.warn, size: h * 0.1, weight: '900' });
}

function drawStaticGeoblock(ctx, w, h, label) {
  // янтарная стена-варнинг РКН с замком
  neonRect(ctx, 0, 0, w, h, C.warn, { fill: 'rgba(28,18,2,0.88)', glow: 20, radius: 4 });

  // диагональные предупреждающие линии (классический «опасно»)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,178,46,0.30)';
  ctx.lineWidth = 3;
  for (let offset = -h; offset < w; offset += 14) {
    ctx.beginPath();
    ctx.moveTo(Math.max(0, offset), Math.max(0, -offset));
    ctx.lineTo(Math.min(w, w + offset), Math.min(h, h - (w + offset)));
    ctx.stroke();
  }
  ctx.restore();

  for (let i = 1; i < 4; i++) { ctx.strokeStyle = 'rgba(255,178,46,0.4)'; ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke(); }

  // векторный замок вместо эмодзи
  const lockW = w * 0.32;
  const lockH = h * 0.25;
  const lockX = (w - lockW) / 2;
  const lockY = h * 0.22;

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

  neonText(ctx, label, w / 2, h * 0.72, { color: '#fff', size: h * 0.12, weight: '800' });
}

function drawStaticLag(ctx, w, h, label) {
  // рамка и лейбл «всё легло» (глитч-полосы/ERROR/спиннер — динамика поверх)
  ctx.globalAlpha = 0.78;
  neonRect(ctx, 0, 0, w, h, C.warnDeep, { fill: 'rgba(16,10,0,0.74)', glow: 16, radius: 6 });
  ctx.globalAlpha = 1;
  neonText(ctx, label, w / 2, h * 0.82, { color: C.white, size: h * 0.12, weight: '800' });
}

function drawStaticCaptcha(ctx, w, h, label) {
  // капча — белая рамка, заголовок, прицел-брекеты, VERIFY (сетка — динамика)
  neonRect(ctx, 0, 0, w, h, C.white, { fill: 'rgba(12,2,4,0.9)', glow: 16, radius: 6 });

  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  roundRectPath(ctx, 0, 0, w, h * 0.28, 6);
  ctx.fill();

  neonText(ctx, label, w / 2, h * 0.14, { color: '#fff', size: h * 0.12, weight: '900' });

  const gy = h * 0.32, gh = h * 0.62, cell = Math.min(w * 0.9, gh) / 3;
  const gx = (w - cell * 3) / 2;

  // угловые brackets/рамка прицела
  const pad = 2;
  const gridX = gx - pad, gridY = gy - pad;
  const gridW = cell * 3 + pad * 2, gridH = cell * 3 + pad * 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;

  ctx.beginPath(); ctx.moveTo(gridX + 8, gridY); ctx.lineTo(gridX, gridY); ctx.lineTo(gridX, gridY + 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gridX + gridW - 8, gridY); ctx.lineTo(gridX + gridW, gridY); ctx.lineTo(gridX + gridW, gridY + 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gridX, gridY + gridH - 8); ctx.lineTo(gridX, gridY + gridH); ctx.lineTo(gridX + 8, gridY + gridH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gridX + gridW - 8, gridY + gridH); ctx.lineTo(gridX + gridW, gridY + gridH); ctx.lineTo(gridX + gridW, gridY + gridH - 8); ctx.stroke();

  // кнопка VERIFY (Подтвердить)
  const btnW = w * 0.38;
  const btnH = h * 0.16;
  const btnX = w - btnW - 6;
  const btnY = h - btnH - 6;
  neonRect(ctx, btnX, btnY, btnW, btnH, C.grid, { fill: 'rgba(22, 224, 255, 0.15)', glow: 6, radius: 3, lw: 1.2 });
  neonText(ctx, 'VERIFY', btnX + btnW / 2, btnY + btnH / 2 + 1, { color: '#fff', size: h * 0.08, weight: '900' });

  // круговая стрелочка обновления
  const refreshX = 12;
  const refreshY = h - 14;
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

// --- Динамические слои (рисуются поверх кэша каждый кадр) ---------------------
function drawLagDynamics(ctx, x, top, w, h, y, t, phase) {
  ctx.save();
  // глитч-полосы
  for (let i = 0; i < 4; i++) {
    if (Math.sin(t * 24 + i + phase) > 0.4) {
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

  // буфер-спиннер
  const spinnerCx = x + w / 2;
  const spinnerCy = y + h * 0.08;
  const spinnerR = h * 0.15;
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
}

function drawCaptchaCells(ctx, x, top, w, h, t, phase) {
  const gy = top + h * 0.32, gh = h * 0.62, cell = Math.min(w * 0.9, gh) / 3;
  const gx = x + (w - cell * 3) / 2;
  ctx.save();
  for (let r = 0; r < 3; r++) for (let cN = 0; cN < 3; cN++) {
    const on = Math.sin(t * 4 + r + cN + phase) > 0.6;
    ctx.strokeStyle = C.grid; ctx.globalAlpha = on ? 1 : 0.35; ctx.lineWidth = 1.2;
    ctx.strokeRect(gx + cN * cell + 1.5, gy + r * cell + 1.5, cell - 3, cell - 3);
    if (on) {
      ctx.fillStyle = 'rgba(22, 224, 255, 0.12)';
      ctx.fillRect(gx + cN * cell + 2.5, gy + r * cell + 2.5, cell - 5, cell - 5);
    }
  }
  ctx.restore();
}

// Следующая безопасная полоса — всегда в пределах ±1 (гарантия достижимости).
// Биас «остаться» делает траекторию читаемой. Единый источник истины для main + тестов.
export function nextSafeLane(prev, lanes = CONFIG.LANES) {
  const opts = [prev, prev];
  if (prev > 0) opts.push(prev - 1);
  if (prev < lanes - 1) opts.push(prev + 1);
  return opts[(Math.random() * opts.length) | 0];
}

// Прогрессивное введение типов препятствий: на малых дистанциях прячем
// «несправедливые» сюрпризы (капчу, лаги) — выдаём только когда игрок
// достаточно освоился. rng — для детерминизма (render-shot.mjs).
export function pickObstacleType(distance, rng = Math.random) {
  const P = CONFIG.PROGRESSION;
  const allowed = TYPE_KEYS.filter((k) => {
    if (k === 'captcha' && distance < P.CAPTCHA_MIN_DIST) return false;
    if (k === 'lag' && distance < P.LAG_MIN_DIST) return false;
    return true;
  });
  return allowed[(rng() * allowed.length) | 0];
}

export { TYPES, TYPE_KEYS };
