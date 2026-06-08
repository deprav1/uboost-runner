// Кинематографичная пост-обработка поверх готового кадра: настоящий неон-bloom,
// виньетка, хроматическая аберрация на ярких краях и плёночное зерно.
//
// Всё работает в «device-пикселях» (transform сбрасывается в единичный), потому
// что оперируем содержимым самого canvas. Каждый эффект обёрнут в try/catch и
// при первой же ошибке отключается флагом — это держит headless-стаб из
// test/harness.mjs живым (там canvas-методы no-op и getImageData недоступен).

let _bloomBuf, _bloomCtx;          // буфер для размытого яркого кадра
let _caR, _caRctx, _caB, _caBctx;  // тонированные буферы для аберрации
let _grainTile, _grainW = 256;     // предрендеренный тайл шума
const off = { bloom: false, grain: false, ca: false };

function mkBuf(w, h) {
  const c = (typeof document !== 'undefined' && document.createElement)
    ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = w; c.height = h;
  return c;
}

// Настоящий bloom: размываем уменьшенную копию кадра и подмешиваем поверх в
// additive-режиме. Яркие неон-области доминируют в сложении → честное свечение.
export function bloom(ctx, src, { strength = 0.6, blur = 14, scale = 0.5 } = {}) {
  if (off.bloom || strength <= 0) return;
  try {
    const dw = Math.max(1, Math.round(src.width * scale));
    const dh = Math.max(1, Math.round(src.height * scale));
    if (!_bloomBuf) { _bloomBuf = mkBuf(dw, dh); _bloomCtx = _bloomBuf.getContext('2d'); }
    if (_bloomBuf.width !== dw || _bloomBuf.height !== dh) { _bloomBuf.width = dw; _bloomBuf.height = dh; }
    _bloomCtx.clearRect(0, 0, dw, dh);
    // brightness>1 + contrast подавляют тёмные зоны → bloom тянется от ярких неонов
    _bloomCtx.filter = `blur(${(blur * scale).toFixed(2)}px) brightness(1.3) contrast(1.45)`;
    _bloomCtx.drawImage(src, 0, 0, dw, dh);
    _bloomCtx.filter = 'none';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(_bloomBuf, 0, 0, dw, dh, 0, 0, src.width, src.height);
    ctx.restore();
  } catch { off.bloom = true; }
}

// Хроматическая аберрация: красный и голубой «призраки» ярких областей,
// сдвинутые в противоположные стороны (классический CRT/линза-эффект).
export function aberration(ctx, src, strength = 0.4) {
  if (off.ca || strength <= 0) return;
  try {
    const scale = 0.5;
    const dw = Math.max(1, Math.round(src.width * scale));
    const dh = Math.max(1, Math.round(src.height * scale));
    if (!_caR) {
      _caR = mkBuf(dw, dh); _caRctx = _caR.getContext('2d');
      _caB = mkBuf(dw, dh); _caBctx = _caB.getContext('2d');
    }
    if (_caR.width !== dw) { _caR.width = dw; _caR.height = dh; _caB.width = dw; _caB.height = dh; }

    // красный канал
    _caRctx.globalCompositeOperation = 'source-over';
    _caRctx.clearRect(0, 0, dw, dh);
    _caRctx.filter = 'brightness(1.4) contrast(1.4)';
    _caRctx.drawImage(src, 0, 0, dw, dh);
    _caRctx.filter = 'none';
    _caRctx.globalCompositeOperation = 'multiply';
    _caRctx.fillStyle = '#ff0000'; _caRctx.fillRect(0, 0, dw, dh);

    // голубой канал
    _caBctx.globalCompositeOperation = 'source-over';
    _caBctx.clearRect(0, 0, dw, dh);
    _caBctx.filter = 'brightness(1.4) contrast(1.4)';
    _caBctx.drawImage(src, 0, 0, dw, dh);
    _caBctx.filter = 'none';
    _caBctx.globalCompositeOperation = 'multiply';
    _caBctx.fillStyle = '#00ffff'; _caBctx.fillRect(0, 0, dw, dh);

    const sh = Math.max(1, strength * 3.5); // сдвиг в device-px
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 * strength;
    ctx.drawImage(_caR, 0, 0, dw, dh, -sh, 0, src.width, src.height);
    ctx.drawImage(_caB, 0, 0, dw, dh, sh, 0, src.width, src.height);
    ctx.restore();
  } catch { off.ca = true; }
}

// Виньетка: мягкое затемнение углов (фокус в центр кадра).
export function vignette(ctx, W, H, strength = 0.4) {
  if (strength <= 0) return;
  const cx = W / 2, cy = H * 0.5;
  const r = Math.hypot(W, H) * 0.62;
  const vg = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.7, `rgba(0,0,0,${(strength * 0.45).toFixed(3)})`);
  vg.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`);
  ctx.save();
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Плёночное зерно: предрендеренный тайл шума, тайлится с дрожащим оффсетом.
export function grain(ctx, W, H, strength = 0.05, seed = 0) {
  if (off.grain || strength <= 0) return;
  try {
    if (!_grainTile) {
      _grainTile = mkBuf(_grainW, _grainW);
      const gctx = _grainTile.getContext('2d');
      const img = gctx.createImageData(_grainW, _grainW);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      gctx.putImageData(img, 0, 0);
    }
    const ox = (seed * 53) % _grainW;
    const oy = (seed * 97) % _grainW;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = strength;
    for (let y = -oy; y < H; y += _grainW) {
      for (let x = -ox; x < W; x += _grainW) {
        ctx.drawImage(_grainTile, x, y);
      }
    }
    ctx.restore();
  } catch { off.grain = true; }
}
