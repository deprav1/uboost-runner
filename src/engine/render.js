// Canvas-хелперы: DPR-скейл, неон-glow, текст, скан-линии.

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

export function neonText(ctx, text, x, y, { color = '#fff', size = 16, glow = 10, align = 'center', weight = '800', font = 'Orbitron, system-ui, sans-serif' } = {}) {
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

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
