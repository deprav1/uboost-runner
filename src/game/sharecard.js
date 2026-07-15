// Рендер шеринг-карточки в офскрин-canvas → PNG (dataURL / Blob). Чёрно-красный бренд.
import { CONFIG } from '../../config.js';
import { FONT } from '../engine/render.js';
import { STR } from '../ui/strings.js';
import { paletteAt, zoneIndexAt } from './world.js';

const C = CONFIG.COLORS;

export function renderShareCard(stats, isRecord, profile = null, boardRank = 0) {
  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // фон — палитра достигнутой зоны: карточка «Рассвета» отличается от «Даркнета»,
  // и у друга появляется визуальный повод спросить «а как ты туда долетел?»
  const pal = paletteAt(stats.distInt);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.skyTop); g.addColorStop(0.35, pal.skyMid); g.addColorStop(0.62, pal.skyBottom); g.addColorStop(1, pal.bgBottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Солнце подняли и ужали (было: центр 360, r=200 — диск накрывал зону очков,
  // и тёмные полосы разрезали цифры счёта пополам). Теперь это фон-атмосфера
  // над контентом, а не подложка под ним.
  // Солнце живёт строго в окне между строкой звания (низ ~217) и плашкой счёта
  // (верх 400): диск частично уходит за плашку — «садится за горизонт», а
  // фирменные полосы остаются видны над ней.
  const SUN_Y = 355, SUN_R = 130;
  ctx.save();
  const halo = ctx.createRadialGradient(W / 2, SUN_Y, 50, W / 2, SUN_Y, 440);
  halo.addColorStop(0, 'rgba(255,46,151,0.4)'); halo.addColorStop(1, 'rgba(255,46,151,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, 700);
  ctx.beginPath(); ctx.arc(W / 2, SUN_Y, SUN_R, 0, Math.PI * 2); ctx.clip();
  const sg = ctx.createLinearGradient(0, SUN_Y - SUN_R, 0, SUN_Y + SUN_R);
  sg.addColorStop(0, C.coreTop); sg.addColorStop(1, C.coreBottom);
  ctx.fillStyle = sg; ctx.fillRect(W / 2 - SUN_R, SUN_Y - SUN_R, SUN_R * 2, SUN_R * 2);
  ctx.fillStyle = C.bgBottom;
  for (let i = 0; i < 9; i++) ctx.fillRect(W / 2 - SUN_R, SUN_Y + i * 12, SUN_R * 2, 5 + i);
  ctx.restore();

  // сетка пола — тоже в цвете зоны; горизонт поднят к солнцу, чтобы плашки
  // контента стояли «на земле», а не висели поверх пустого градиента
  const HORIZON = 470;
  ctx.strokeStyle = pal.grid; ctx.lineWidth = 2; ctx.globalAlpha = 0.45;
  for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 16, HORIZON); ctx.lineTo(W / 2 + i * 150, H); ctx.stroke(); }
  for (let i = 0; i < 12; i++) { const y = HORIZON + (H - HORIZON) * Math.pow(i / 12, 2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.globalAlpha = 1;

  const text = (t, x, y, size, color, weight = '800', align = 'center') => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  };

  text(STR.title, W / 2, 92, 66, C.red, '900');
  if (isRecord) text('★ ' + STR.newRecord + ' ★', W / 2, 158, 34, C.white);
  const rankName = STR.ranks[profile?.rankId ?? 0];
  if (rankName) text(`${STR.rankLabel}: ${rankName}`, W / 2, isRecord ? 202 : 170, 30, C.grid, '700');

  // --- Плашка героя: счёт обязан читаться поверх любой сцены -------------------
  // Карточку скриншотят и репостят в чаты, где она сжимается до превью, —
  // цифра на градиенте солнца там разваливалась. Тёмная подложка + красная
  // рамка держат контраст в любой зоне и на любом мессенджерном ресайзе.
  plate(ctx, 90, 400, W - 180, 205, 'rgba(5,1,10,0.82)', C.red);
  text(String(stats.scoreInt), W / 2, 478, 132, C.white, '900');
  text('ОЧКОВ · ' + stats.distInt + ' М', W / 2, 566, 36, C.red, '800');

  // достигнутая зона + место в общем рейтинге (когда сервер его уже сообщил)
  const zoneName = STR.zones[zoneIndexAt(stats.distInt)];
  const zoneParts = [];
  if (zoneName) zoneParts.push('ЗОНА: ' + zoneName.toUpperCase());
  if (boardRank > 0 && boardRank <= 100) zoneParts.push(STR.cardRank(boardRank));
  if (zoneParts.length) text(zoneParts.join('  ·  '), W / 2, 640, 28, C.grid, '700');

  // --- Плашка «ты пережил» ----------------------------------------------------
  // Раньше линии сетки-пола шли прямо сквозь эти строки и рвали их.
  const badgeIds = (profile?.badges || []).slice(-3);
  const twoCol = badgeIds.length > 0;
  plate(ctx, 90, 678, W - 180, 232, 'rgba(5,1,10,0.72)', 'rgba(255,47,61,0.35)');
  ctx.textAlign = 'left';
  text(STR.survived, 130, 718, 34, C.red, '900', 'left');
  const lines = [
    [stats.captchas, STR.stat.captchas],
    [stats.geoblocks, STR.stat.geoblocks],
    [stats.ads, STR.stat.ads],
    [stats.lags, STR.stat.lags],
  ];
  lines.forEach((l, i) => {
    const y = 772 + i * 42;
    text(String(l[0]), 150, y, 34, C.white, '900', 'left');
    // Во второй колонке живут бейджи — подписи ужимаем, чтобы не залезть на них.
    text(l[1], 210, y, twoCol ? 26 : 32, '#d9dde3', '600', 'left');
  });

  // бейджи профиля (до 3, самые свежие) — процедурные жетоны справа
  if (twoCol) {
    text(STR.badgeUnlocked.toUpperCase(), 600, 718, 30, C.red, '900', 'left');
    badgeIds.forEach((id, i) => {
      const b = STR.badges[id];
      if (!b) return;
      const cy = 778 + i * 44;
      ctx.save();
      ctx.shadowColor = C.grid; ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(22,224,255,0.14)';
      ctx.strokeStyle = C.grid; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(622, cy, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = C.grid;
      drawStar(ctx, 622, cy, 5, 10, 4.5);
      ctx.restore();
      text(b.name, 652, cy, 26, '#fff', '800', 'left');
    });
  }

  // подвал-CTA
  const fb = 150;
  const fg = ctx.createLinearGradient(0, H - fb, 0, H);
  fg.addColorStop(0, 'rgba(255,41,55,0.04)');
  fg.addColorStop(1, 'rgba(255,41,55,0.34)');
  ctx.fillStyle = fg; ctx.fillRect(0, H - fb, W, fb);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,41,55,0.65)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, H - fb); ctx.lineTo(W, H - fb); ctx.stroke();
  // Промокод на карточке — оффер путешествует вместе с картинкой по чатам.
  const promoLine = CONFIG.PROMO?.code
    ? STR.promoCard(CONFIG.PROMO.code, CONFIG.PROMO.percent)
    : 'Хватит уворачиваться — включи ЮБуст';
  text(promoLine, W / 2, H - 96, 31, '#ffffff', '700');
  text('▶  ' + CONFIG.STORE_URL.replace('https://', '').replace(/\/$/, ''), W / 2, H - 44, 52, C.red, '900');

  return cv;
}

// Плашка-подложка под текст. Скругление рисуем руками, а не через ctx.roundRect:
// карточка рендерится и в браузере, и офлайн через @napi-rs/canvas (render-shot),
// и полагаться на поддержку roundRect в обоих сразу не стоит.
function plate(ctx, x, y, w, h, fill, stroke, r = 18) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.restore();
}

// Процедурная звезда-глиф для жетонов бейджей.
function drawStar(ctx, cx, cy, points, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export function cardToBlob(cv) {
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}
