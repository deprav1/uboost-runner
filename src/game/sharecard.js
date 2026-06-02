// Рендер шеринг-карточки в офскрин-canvas → PNG (dataURL / Blob). Чёрно-красный бренд.
import { CONFIG } from '../../config.js';
import { FONT } from '../engine/render.js';
import { STR } from '../ui/strings.js';

const C = CONFIG.COLORS;

export function renderShareCard(stats, isRecord) {
  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // фон
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.bgTop); g.addColorStop(0.55, '#0a0204'); g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // красное ядро
  ctx.save();
  const halo = ctx.createRadialGradient(W / 2, 360, 60, W / 2, 360, 520);
  halo.addColorStop(0, 'rgba(255,41,55,0.4)'); halo.addColorStop(1, 'rgba(255,41,55,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, 760);
  ctx.beginPath(); ctx.arc(W / 2, 360, 200, 0, Math.PI * 2); ctx.clip();
  const sg = ctx.createLinearGradient(0, 160, 0, 560);
  sg.addColorStop(0, C.coreTop); sg.addColorStop(1, C.coreBottom);
  ctx.fillStyle = sg; ctx.fillRect(W / 2 - 220, 160, 440, 400);
  ctx.fillStyle = C.bgBottom;
  for (let i = 0; i < 9; i++) ctx.fillRect(W / 2 - 220, 360 + i * 14, 440, 6 + i);
  ctx.restore();

  // сетка пола
  ctx.strokeStyle = C.grid; ctx.lineWidth = 2; ctx.globalAlpha = 0.45;
  for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 16, 560); ctx.lineTo(W / 2 + i * 150, H); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { const y = 560 + (H - 560) * Math.pow(i / 12, 2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.globalAlpha = 1;

  const text = (t, x, y, size, color, weight = '800', align = 'center') => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  };

  text(STR.title, W / 2, 110, 70, C.red, '900');
  if (isRecord) text('★ ' + STR.newRecord + ' ★', W / 2, 190, 38, C.white);

  text(String(stats.scoreInt), W / 2, 400, 138, C.white, '900');
  text('ОЧКОВ · ' + stats.distInt + ' М', W / 2, 532, 40, C.red, '800');

  // блок «ты пережил»
  ctx.textAlign = 'left';
  text(STR.survived, 150, 640, 40, C.red, '900', 'left');
  const lines = [
    [stats.captchas, STR.stat.captchas],
    [stats.geoblocks, STR.stat.geoblocks],
    [stats.ads, STR.stat.ads],
    [stats.lags, STR.stat.lags],
  ];
  lines.forEach((l, i) => {
    const y = 702 + i * 66;
    text(String(l[0]), 175, y, 50, C.white, '900', 'left');
    text(l[1], 285, y, 36, '#d9dde3', '600', 'left');
  });

  // подвал-CTA
  const fb = 150;
  const fg = ctx.createLinearGradient(0, H - fb, 0, H);
  fg.addColorStop(0, 'rgba(255,41,55,0.04)');
  fg.addColorStop(1, 'rgba(255,41,55,0.34)');
  ctx.fillStyle = fg; ctx.fillRect(0, H - fb, W, fb);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,41,55,0.65)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, H - fb); ctx.lineTo(W, H - fb); ctx.stroke();
  text('Хватит уворачиваться — включи настоящий ВПН', W / 2, H - 96, 31, '#ffffff', '700');
  text('▶  ' + CONFIG.STORE_URL.replace('https://', '').replace(/\/$/, ''), W / 2, H - 44, 52, C.red, '900');

  return cv;
}

export function cardToBlob(cv) {
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}
