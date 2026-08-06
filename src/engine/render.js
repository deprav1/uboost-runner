// Canvas-хелперы: DPR-скейл, неон-glow, текст, скан-линии, рельсы, спид-лайны.

// единый шрифт бренда (UI + canvas) — Open Runde (скруглённый Inter), self-hosted.
// В canvas добавлены системные fallback'и с кириллицей, чтобы preview/shots
// и CI-артефакты не превращали русские подписи в квадраты, пока шрифт грузится.
export const FONT = '"Open Runde","Segoe UI",Arial,"DejaVu Sans","Liberation Sans",system-ui,sans-serif';

export function setupCanvas(canvas, dprCap = 2) {
  const ctx = canvas.getContext('2d');
  let cap = dprCap;
  function resize() {
    // DPR ограничен сверху (телефоны дают 2.5–3 → ×6–9 пикселей и просадки).
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
  return {
    ctx,
    get W() { return window.innerWidth; },
    get H() { return window.innerHeight; },
    // адаптивное качество меняет потолок DPR на лету (с переаллокацией буфера)
    setDprCap(c) { if (c !== cap) { cap = c; resize(); } },
  };
}

// --- Оффскрин-слои для кэша свечения ----------------------------------------
// `ctx.shadowBlur` — главный убийца fps на Canvas 2D (см.
// docs/solutions/2026-06-08-canvas-shadow-performance.md), а статичные части
// сцены пересчитывают его 60 раз в секунду впустую. Приём: нарисовать один раз
// в оффскрин и блитить. Приём уже применён в obstacles.js (staticSprite).
//
// ВАЖНО: слой рисуется в РАЗРЕШЕНИИ УСТРОЙСТВА. Игровой контекст отмасштабирован
// на DPR (setupCanvas), поэтому буфер в CSS-пикселях при блите растянулся бы и
// неон стал бы мылом — это была бы не оптимизация, а ухудшение картинки.
export function layerScale(ctx) {
  try { return ctx.getTransform?.().a || 1; } catch { return 1; }
}

export function makeLayer(wCss, hCss, scale) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(wCss * scale));
  cv.height = Math.max(1, Math.round(hCss * scale));
  const c = cv.getContext('2d');
  if (!c) return null;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  return { cv, c };
}

// неоновый прямоугольник со свечением и обводкой
export function neonRect(ctx, x, y, w, h, color, { fill = null, glow = 18, radius = 8, lw = 2.5 } = {}) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.restore();
}

export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function neonText(ctx, text, x, y, { color = '#fff', size = 16, glow = 10, align = 'center', weight = '800', font = FONT } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  // поддержка переносов \n
  const lines = String(text).split('\n');
  const lh = size * 1.05;
  const startY = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, x, startY + i * lh));
  ctx.restore();
}

// скан-линии поверх всего кадра
export function scanlines(ctx, W, H, alpha = 0.06) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

// «Треки» полос: светящиеся колонны от камеры к точке схода (сходятся «в город»).
// Рисуем границы коридора + бегущий пунктир по центру каждой полосы вдоль project().
export function drawRails(ctx, geom, scroll, color) {
  const lanes = geom.laneY.length;
  const half = (lanes - 1) / 2;
  ctx.save();
  ctx.lineCap = 'round';

  const colPath = (laneNorm) => {
    ctx.beginPath();
    let first = true;
    for (let s = 0; s <= 24; s++) {
      const z = s / 24;                 // 0 у камеры → 1 у горизонта
      const { x, y } = geom.project(laneNorm, z);
      first ? (ctx.moveTo(x, y), first = false) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  // границы коридора (тонкие, тусклые) — между полосами и по краям
  ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.strokeStyle = color;
  ctx.globalAlpha = 0.13; ctx.lineWidth = 1;
  for (let i = 0; i <= lanes; i++) colPath(i - half - 0.5);

  // центр полос — бегущий пунктир (ощущение движения вглубь)
  ctx.setLineDash([20, 26]); ctx.lineDashOffset = scroll * 0.4;
  ctx.shadowColor = color; ctx.shadowBlur = 9; ctx.strokeStyle = color;
  ctx.globalAlpha = 0.4; ctx.lineWidth = 2;
  for (let i = 0; i < lanes; i++) colPath(i - half);

  ctx.restore();
}

// Радиальные zoom-линии: лучи из точки схода наружу — ощущение разгона «в экран».
// off — растущий оффсет (фаза бегущих лучей); плотнее/длиннее с ростом скорости.
export function zoomlines(ctx, W, H, vpx, vpy, speed, off, color, white, intensity = 1) {
  const frac = clamp((speed - 360) / 1100, 0, 1);
  const n = Math.floor(intensity * (10 + frac * 30));
  const maxR = Math.hypot(W, H);
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (i % 3) * 0.21;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // фаза: луч «вылетает» из центра к краю, зациклено
    const phase = ((off * (0.6 + (i % 4) * 0.2) + i * 137.5) % maxR) / maxR;
    const r0 = phase * maxR;
    const len = (40 + frac * 220) * (0.5 + ((i % 5) / 5));
    const r1 = Math.min(maxR, r0 + len);
    ctx.strokeStyle = (i % 5 === 0) ? white : color;
    ctx.globalAlpha = (0.05 + 0.2 * frac) * Math.min(1, phase * 2.5); // тусклее у центра
    ctx.lineWidth = 1 + (i % 6 === 0 ? 1.4 : 0);
    ctx.beginPath();
    ctx.moveTo(vpx + ca * r0, vpy + sa * r0);
    ctx.lineTo(vpx + ca * r1, vpy + sa * r1);
    ctx.stroke();
  }
  ctx.restore();
}

// «Световая лужа» под объектом: мягкий additive-эллипс света на полу. В неон-мире
// объекты не отбрасывают тень, а подсвечивают пол под собой — это сажает их в сцену.
export function floorGlow(ctx, x, y, w, color, alpha = 0.5) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(1, 0.32);                 // сплющиваем в эллипс (перспектива пола)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, w, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
