// Canvas-хелперы: DPR-скейл, неон-glow, текст, скан-линии, рельсы, спид-лайны.

// единый шрифт бренда (UI + canvas)
// В canvas добавлены системные fallback'и с кириллицей, чтобы preview/shots
// и CI-артефакты не превращали русские подписи в квадраты.
export const FONT = '"Manrope","Inter","Segoe UI",Arial,"DejaVu Sans","Liberation Sans",system-ui,sans-serif';

export function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
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
  return { ctx, get W() { return window.innerWidth; }, get H() { return window.innerHeight; } };
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

// «рельсы данных» — светящиеся пунктирные дорожки по центру полос + границы коридора
export function drawRails(ctx, geom, scroll, color) {
  const { W, laneY, laneH } = geom;
  const top = laneY[0] - laneH / 2;
  ctx.save();
  ctx.lineCap = 'round';
  // границы коридора (тонкие, тусклые)
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.14; ctx.shadowBlur = 0; ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let i = 0; i <= laneY.length; i++) {
    const yy = top + laneH * i;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
  }
  // бегущая пунктирная линия по центру каждой полосы
  ctx.setLineDash([24, 26]);
  ctx.lineDashOffset = -scroll;
  ctx.shadowColor = color; ctx.shadowBlur = 9; ctx.strokeStyle = color; ctx.lineWidth = 2;
  for (let i = 0; i < laneY.length; i++) {
    ctx.globalAlpha = 0.42;
    ctx.beginPath(); ctx.moveTo(0, laneY[i]); ctx.lineTo(W, laneY[i]); ctx.stroke();
  }
  ctx.restore();
}

// горизонтальные спид-лайны: плотнее и длиннее с ростом скорости
export function speedlines(ctx, W, H, speed, off, color, white, intensity = 1) {
  const frac = clamp((speed - 360) / 1100, 0, 1);
  const n = Math.floor(intensity * (6 + frac * 26));
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const seed = i * 97.13;
    const y = (seed * 1.7) % H;
    const len = 30 + frac * 200 * (0.4 + ((i % 5) / 5));
    const span = W + 280;
    const x = W - (((off * (0.7 + (i % 3) * 0.25)) + seed * 41) % span);
    ctx.strokeStyle = (i % 4 === 0) ? white : color;
    ctx.globalAlpha = 0.04 + 0.16 * frac;
    ctx.lineWidth = 1 + (i % 6 === 0 ? 1.5 : 0);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  ctx.restore();
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
