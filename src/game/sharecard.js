// Рендер шеринг-карточки в офскрин-canvas → PNG (dataURL / Blob).
import { CONFIG } from '../../config.js';
import { STR } from '../ui/strings.js';

const C = CONFIG.COLORS;

export function renderShareCard(stats, isRecord) {
  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // фон-градиент
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.bgTop); g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // солнце
  ctx.save();
  ctx.beginPath(); ctx.arc(W / 2, 360, 200, 0, Math.PI * 2); ctx.clip();
  const sg = ctx.createLinearGradient(0, 180, 0, 420);
  sg.addColorStop(0, C.sunTop); sg.addColorStop(1, C.sunBottom);
  ctx.fillStyle = sg; ctx.fillRect(W / 2 - 220, 160, 440, 320);
  ctx.fillStyle = C.bgBottom;
  for (let i = 0; i < 9; i++) ctx.fillRect(W / 2 - 220, 360 + i * 14, 440, 6 + i);
  ctx.restore();

  // сетка пола
  ctx.strokeStyle = C.grid; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
  for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 16, 560); ctx.lineTo(W / 2 + i * 150, H); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { const y = 560 + (H - 560) * Math.pow(i / 12, 2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.globalAlpha = 1;

  const text = (t, x, y, size, color, weight = '800', align = 'center') => {
    ctx.font = `${weight} ${size}px Orbitron, system-ui, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  };

  text('UBOOST RUNNER', W / 2, 110, 64, C.cyan);
  if (isRecord) text('★ ' + STR.newRecord + ' ★', W / 2, 185, 38, C.yellow);

  text(String(stats.scoreInt), W / 2, 400, 134, C.yellow, '900');
  text('ОЧКОВ · ' + stats.distInt + ' М', W / 2, 530, 40, '#fff');

  // блок «ты пережил»
  ctx.textAlign = 'left';
  text(STR.survived, 150, 640, 40, C.magenta, '800', 'left');
  const lines = [
    [stats.captchas, STR.stat.captchas],
    [stats.geoblocks, STR.stat.geoblocks],
    [stats.ads, STR.stat.ads],
    [stats.lags, STR.stat.lags],
  ];
  lines.forEach((l, i) => {
    const y = 702 + i * 66;
    text(String(l[0]), 175, y, 50, C.cyan, '900', 'left');
    text(l[1], 280, y, 36, '#eafcff', '600', 'left');
  });

  // подвал-CTA
  const fb = 150;
  const fg = ctx.createLinearGradient(0, H - fb, 0, H);
  fg.addColorStop(0, 'rgba(255,45,149,0.05)');
  fg.addColorStop(1, 'rgba(255,45,149,0.32)');
  ctx.fillStyle = fg; ctx.fillRect(0, H - fb, W, fb);
  ctx.shadowColor = C.magenta; ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,45,149,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, H - fb); ctx.lineTo(W, H - fb); ctx.stroke();
  text('Хватит уворачиваться — включи настоящий VPN', W / 2, H - 96, 31, '#ffffff', '700');
  text('▶  ' + CONFIG.STORE_URL.replace('https://', '').replace(/\/$/, ''), W / 2, H - 44, 52, C.yellow, '900');

  return cv;
}

export function cardToBlob(cv) {
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}
