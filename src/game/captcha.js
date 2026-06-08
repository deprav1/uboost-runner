// Капча-мини-игра «найди плитки» на время.
// Рендерится поверх canvas; управляется тапами через onTap(x,y) из input.js.
import { CONFIG } from '../../config.js';
import { neonRect, neonText, roundRectPath, FONT } from '../engine/render.js';
import { getSprite } from '../engine/assets.js';
import { STR, pick } from '../ui/strings.js';

const C = CONFIG.COLORS;
const GRID = CONFIG.CAPTCHA_GRID;
const TARGETS = CONFIG.CAPTCHA_TARGETS;

// Иконки-«эмодзи» для категорий плиток (fallback-рисовка)
const EMOJI = {
  traffic_light: '🚦', bus: '🚌', hydrant: '🚒',
  storefront: '🏪', motorcycle: '🏍', taxi: '🚕',
};
const DECOY_EMOJI = ['🐦', '🌳', '⭐', '🪨', '🐟', '🌙', '☁️', '🍄'];

export class CaptchaGame {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.task = pick(STR.captchaTask);
    this.timer = CONFIG.CAPTCHA_TIME;
    this.done = false;
    this.result = null; // 'solved' | 'failed'
    this._buildGrid();
    this.phase = 0; // для анимации входа
    this.entranceT = 0;
  }

  _buildGrid() {
    const n = GRID * GRID;
    const indices = Array.from({ length: n }, (_, i) => i);
    // перемешиваем
    for (let i = indices.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    this.correctSet = new Set(indices.slice(0, TARGETS));
    // Децой — случайные иконки из пула, не совпадающие с целью
    const decoys = DECOY_EMOJI.filter((e) => e !== EMOJI[this.task.key]);
    this.tiles = Array.from({ length: n }, (_, i) => ({
      correct: this.correctSet.has(i),
      selected: false,
      emoji: this.correctSet.has(i)
        ? (EMOJI[this.task.key] || '🚦')
        : decoys[i % decoys.length],
      shake: 0,
    }));
  }

  // Вычислить геометрию сетки относительно центра экрана
  _gridGeom() {
    const panelW = Math.min(this.W * 0.88, 360);
    const cellSize = (panelW - 24) / GRID;
    const panelH = cellSize * GRID + 110;
    const px = (this.W - panelW) / 2;
    const py = (this.H - panelH) / 2;
    return { panelW, panelH, cellSize, px, py };
  }

  onTap(tx, ty) {
    if (this.done) return;
    const { panelW, panelH, cellSize, px, py } = this._gridGeom();
    const gridTop = py + 88;
    const gridLeft = px + 12;
    const col = Math.floor((tx - gridLeft) / cellSize);
    const row = Math.floor((ty - gridTop) / cellSize);
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return;
    const idx = row * GRID + col;
    const tile = this.tiles[idx];
    if (tile.selected) return; // уже выбрана
    tile.selected = true;

    if (!tile.correct && CONFIG.CAPTCHA_STRICT) {
      // неверный тап при строгом режиме → сразу провал
      this.result = 'failed'; this.done = true;
      tile.shake = 0.4;
      return;
    }
    if (this._checkSolved()) { this.result = 'solved'; this.done = true; }
  }

  _checkSolved() {
    return this.tiles.every((t) => !t.correct || t.selected);
  }

  update(dt) {
    if (this.done) return;
    this.entranceT += dt;
    this.timer -= dt;
    for (const t of this.tiles) if (t.shake > 0) t.shake -= dt * 4;
    if (this.timer <= 0) { this.timer = 0; this.result = 'failed'; this.done = true; }
  }

  draw(ctx, t) {
    const { W, H } = this;
    const { panelW, panelH, cellSize, px, py } = this._gridGeom();

    // вход — лёгкий scale от 0.88
    const entryScale = Math.min(1, 0.88 + this.entranceT / 0.18 * 0.12);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(entryScale, entryScale);
    ctx.translate(-W / 2, -H / 2);

    // полупрозрачный overlay
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, H);

    // панель
    roundRectPath(ctx, px, py, panelW, panelH, 18);
    ctx.fillStyle = 'rgba(12,2,4,0.94)';
    ctx.fill();
    ctx.strokeStyle = C.red; ctx.shadowColor = C.red; ctx.shadowBlur = 22;
    ctx.lineWidth = 2; ctx.stroke();

    // скан-глитч заголовка
    const glitch = Math.random() < 0.04;
    ctx.shadowColor = C.red; ctx.shadowBlur = 14;
    if (glitch) ctx.translate((Math.random() - 0.5) * 3, 0);
    neonText(ctx, STR.captchaInstruction(this.task.label),
      px + panelW / 2, py + 34, { color: '#fff', size: 16, glow: 10 });
    if (glitch) ctx.translate(0, 0);

    // таймер-бар
    const barW = panelW - 24;
    const barFrac = Math.max(0, this.timer / CONFIG.CAPTCHA_TIME);
    const barColor = barFrac > 0.4 ? C.red : C.white;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRectPath(ctx, px + 12, py + 58, barW, 8, 4); ctx.fill();
    ctx.fillStyle = barColor;
    ctx.shadowColor = barColor; ctx.shadowBlur = 8;
    roundRectPath(ctx, px + 12, py + 58, barW * barFrac, 8, 4); ctx.fill();
    ctx.shadowBlur = 0;

    // сетка плиток
    const gridTop = py + 88;
    const gridLeft = px + 12;
    const pad = 4;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const tile = this.tiles[r * GRID + c];
        const tx2 = gridLeft + c * cellSize;
        const ty2 = gridTop + r * cellSize;
        const cs = cellSize - pad;
        const shake = tile.shake > 0 ? (Math.random() - 0.5) * 5 : 0;

        ctx.save();
        ctx.translate(shake, 0);

        // фон плитки
        const bg = tile.selected
          ? (tile.correct ? 'rgba(255,41,55,0.45)' : 'rgba(255,255,255,0.12)')
          : 'rgba(20,4,8,0.8)';
        roundRectPath(ctx, tx2 + pad / 2, ty2 + pad / 2, cs, cs, 8);
        ctx.fillStyle = bg; ctx.fill();

        // обводка
        const borderCol = tile.selected
          ? (tile.correct ? C.white : 'rgba(255,255,255,0.4)')
          : 'rgba(255,41,55,0.38)';
        ctx.strokeStyle = borderCol; ctx.lineWidth = tile.selected ? 2.5 : 1.5;
        ctx.shadowColor = tile.selected ? C.red : 'transparent'; ctx.shadowBlur = tile.selected ? 10 : 0;
        ctx.stroke();

        // иконка / спрайт
        const spriteKey = `minigame/${tile.correct ? this.task.key : 'decoy_frame'}`;
        const img = getSprite(spriteKey);
        if (img && tile.correct) {
          const is = cs * 0.58;
          ctx.drawImage(img, tx2 + pad / 2 + (cs - is) / 2, ty2 + pad / 2 + (cs - is) / 2, is, is);
        } else if (img) {
          ctx.drawImage(img, tx2 + pad / 2, ty2 + pad / 2, cs, cs);
        } else {
          neonText(ctx, tile.emoji,
            tx2 + pad / 2 + cs / 2, ty2 + pad / 2 + cs / 2,
            { color: tile.selected ? '#fff' : '#ddd', size: cs * 0.48, glow: 0, font: 'system-ui' });
        }
        ctx.restore();
      }
    }

    // результат
    if (this.done) {
      const msg = this.result === 'solved' ? pick(STR.captchaSolve) : pick(STR.captchaFail);
      const col = this.result === 'solved' ? C.white : C.red;
      neonText(ctx, msg, px + panelW / 2, py + panelH - 20, { color: col, size: 20, glow: 18 });
    }

    ctx.restore();
  }
}
