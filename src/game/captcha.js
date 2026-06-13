// Капча-мини-игра «найди плитки» на время.
// Рендерится поверх canvas; управляется тапами через onTap(x,y) из input.js.
import { CONFIG } from '../../config.js';
import { neonRect, neonText, roundRectPath } from '../engine/render.js';
import { STR, pick } from '../ui/strings.js';

const C = CONFIG.COLORS;
const GRID = CONFIG.CAPTCHA_GRID;
const TARGETS = CONFIG.CAPTCHA_TARGETS;

// Векторные иконки плиток. Раньше тут были эмодзи через font:'system-ui' — но в
// Telegram WebView и в офлайн-рендере (@napi-rs/canvas) эмодзи-шрифта нет, поэтому
// плитки превращались в пустые квадраты (тофу □). Рисуем примитивами Canvas —
// работает везде и детерминированно в shots. Каждая функция рисует иконку в
// квадрате [-0.5..0.5] (умножается на размер ячейки), цвет передаётся аргументом.
const ICONS = {
  traffic_light(ctx, s, col) {
    ctx.strokeStyle = col; ctx.lineWidth = s * 0.04;
    ctx.strokeRect(-s * 0.16, -s * 0.34, s * 0.32, s * 0.6);
    const ys = [-0.18, 0, 0.18];
    ys.forEach((yy, i) => {
      ctx.fillStyle = i === 0 ? '#ff4d4d' : i === 1 ? '#ffd23f' : '#4dff88';
      ctx.beginPath(); ctx.arc(0, yy * s, s * 0.08, 0, Math.PI * 2); ctx.fill();
    });
  },
  bus(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); roundedRect(ctx, -s * 0.32, -s * 0.22, s * 0.64, s * 0.42, s * 0.07); ctx.fill();
    ctx.fillStyle = '#0a0418';
    for (let i = 0; i < 3; i++) ctx.fillRect(-s * 0.24 + i * s * 0.18, -s * 0.14, s * 0.12, s * 0.12);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(-s * 0.16, s * 0.22, s * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.16, s * 0.22, s * 0.06, 0, Math.PI * 2); ctx.fill();
  },
  hydrant(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); roundedRect(ctx, -s * 0.12, -s * 0.2, s * 0.24, s * 0.44, s * 0.08); ctx.fill();
    ctx.fillRect(-s * 0.22, -s * 0.04, s * 0.44, s * 0.1);            // боковые штуцеры
    ctx.beginPath(); ctx.arc(0, -s * 0.24, s * 0.1, Math.PI, 0); ctx.fill(); // купол
    ctx.fillRect(-s * 0.2, s * 0.24, s * 0.4, s * 0.06);             // основание
  },
  storefront(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.fillRect(-s * 0.3, -s * 0.06, s * 0.6, s * 0.32);            // корпус
    ctx.beginPath();                                                 // навес
    ctx.moveTo(-s * 0.34, -s * 0.06); ctx.lineTo(s * 0.34, -s * 0.06);
    ctx.lineTo(s * 0.26, -s * 0.24); ctx.lineTo(-s * 0.26, -s * 0.24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0a0418';
    ctx.fillRect(-s * 0.08, s * 0.04, s * 0.16, s * 0.22);           // дверь
  },
  motorcycle(ctx, s, col) {
    ctx.strokeStyle = col; ctx.lineWidth = s * 0.05; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(-s * 0.2, s * 0.12, s * 0.13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(s * 0.2, s * 0.12, s * 0.13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, s * 0.12); ctx.lineTo(-s * 0.04, -s * 0.12);
    ctx.lineTo(s * 0.2, -s * 0.12); ctx.lineTo(s * 0.2, s * 0.12); ctx.stroke();
    ctx.fillRect(-s * 0.12, -s * 0.16, s * 0.18, s * 0.06);          // руль
  },
  taxi(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); roundedRect(ctx, -s * 0.34, -s * 0.06, s * 0.68, s * 0.26, s * 0.06); ctx.fill();
    ctx.beginPath();                                                 // крыша
    ctx.moveTo(-s * 0.2, -s * 0.06); ctx.lineTo(-s * 0.12, -s * 0.22);
    ctx.lineTo(s * 0.12, -s * 0.22); ctx.lineTo(s * 0.2, -s * 0.06); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0a0418';
    ctx.fillRect(-s * 0.06, -s * 0.2, s * 0.12, s * 0.06);           // шашечка-табличка
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(-s * 0.18, s * 0.2, s * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.18, s * 0.2, s * 0.07, 0, Math.PI * 2); ctx.fill();
  },
  // --- децой-иконки (нецелевые) ---
  tree(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, -s * 0.08, s * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-s * 0.05, s * 0.05, s * 0.1, s * 0.22);
  },
  star(ctx, s, col) {
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? s * 0.12 : s * 0.28;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  },
  moon(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a0418';
    ctx.beginPath(); ctx.arc(s * 0.1, -s * 0.04, s * 0.24, 0, Math.PI * 2); ctx.fill();
  },
  cloud(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(-s * 0.14, s * 0.02, s * 0.13, 0, Math.PI * 2);
    ctx.arc(s * 0.02, -s * 0.06, s * 0.16, 0, Math.PI * 2);
    ctx.arc(s * 0.18, s * 0.02, s * 0.12, 0, Math.PI * 2);
    ctx.rect(-s * 0.26, s * 0.0, s * 0.5, s * 0.14); ctx.fill();
  },
  fish(ctx, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(-s * 0.04, 0, s * 0.24, s * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.18, 0); ctx.lineTo(s * 0.32, -s * 0.12);
    ctx.lineTo(s * 0.32, s * 0.12); ctx.closePath(); ctx.fill();
  },
  drop(ctx, s, col) {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(0, -s * 0.28);
    ctx.bezierCurveTo(s * 0.24, s * 0.0, s * 0.16, s * 0.26, 0, s * 0.26);
    ctx.bezierCurveTo(-s * 0.16, s * 0.26, -s * 0.24, s * 0.0, 0, -s * 0.28);
    ctx.fill();
  },
};
const DECOY_KEYS = ['tree', 'star', 'moon', 'cloud', 'fish', 'drop'];

// маленький локальный roundRect (canvas.roundRect нет в части движков/стабе)
function roundedRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class CaptchaGame {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.task = pick(STR.captchaTask);
    this.timer = CONFIG.CAPTCHA_TIME;
    this.done = false;
    this.result = null; // 'solved' | 'failed'
    // «капча-наоборот»: тапнуть нужно всё, КРОМЕ целевой категории. Инвариант
    // решаемости сохраняется — тапаемых (correct) плиток по-прежнему ровно TARGETS,
    // просто целевая иконка рисуется на НЕтапаемых, а на тапаемых — децои.
    this.invert = Math.random() < CONFIG.CAPTCHA_INVERT_CHANCE;
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
    // Целевая иконка — категория задания; децой — из пула не-целевых форм.
    // В invert-режиме раскладка иконок зеркальна: целевая категория на НЕтапаемых
    // плитках, а тапнуть надо «всё остальное» (децои на correct-плитках).
    const target = ICONS[this.task.key] ? this.task.key : 'traffic_light';
    this.tiles = Array.from({ length: n }, (_, i) => {
      const mustTap = this.correctSet.has(i);
      const showsTarget = this.invert ? !mustTap : mustTap;
      return {
        correct: mustTap,
        selected: false,
        icon: showsTarget ? target : DECOY_KEYS[i % DECOY_KEYS.length],
        shake: 0,
      };
    });
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
    ctx.strokeStyle = C.grid; ctx.shadowColor = C.grid; ctx.shadowBlur = 22;
    ctx.lineWidth = 2; ctx.stroke();

    // скан-глитч заголовка
    const glitch = Math.random() < 0.04;
    ctx.shadowColor = C.grid; ctx.shadowBlur = 14;
    if (glitch) ctx.translate((Math.random() - 0.5) * 3, 0);
    const instruction = this.invert
      ? STR.captchaInstructionInvert(this.task.label)
      : STR.captchaInstruction(this.task.label);
    neonText(ctx, instruction,
      px + panelW / 2, py + 34, { color: '#fff', size: 16, glow: 10 });
    if (glitch) ctx.translate(0, 0);

    // таймер-бар
    const barW = panelW - 24;
    const barFrac = Math.max(0, this.timer / CONFIG.CAPTCHA_TIME);
    const barColor = barFrac > 0.4 ? C.grid : C.warn;
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
          ? (tile.correct ? 'rgba(255,47,61,0.42)' : 'rgba(255,255,255,0.12)')
          : 'rgba(10,8,26,0.82)';
        roundRectPath(ctx, tx2 + pad / 2, ty2 + pad / 2, cs, cs, 8);
        ctx.fillStyle = bg; ctx.fill();

        // обводка (выбор = красный-бренд, нейтраль = циан-структура)
        const borderCol = tile.selected
          ? (tile.correct ? C.red : 'rgba(255,255,255,0.4)')
          : 'rgba(22,224,255,0.32)';
        ctx.strokeStyle = borderCol; ctx.lineWidth = tile.selected ? 2.5 : 1.5;
        ctx.shadowColor = tile.selected ? C.red : 'transparent'; ctx.shadowBlur = tile.selected ? 10 : 0;
        ctx.stroke();

        // векторная иконка по центру плитки (без зависимости от эмодзи-шрифта).
        // Невыбранные плитки — единый нейтральный цвет: подсказка не «палит»
        // верные плитки, игрок реально распознаёт иконки (а не подсветку).
        const drawIcon = ICONS[tile.icon] || ICONS.traffic_light;
        const iconCol = tile.selected ? '#fff' : '#9fb4d8';
        ctx.save();
        ctx.translate(tx2 + pad / 2 + cs / 2, ty2 + pad / 2 + cs / 2);
        ctx.shadowColor = tile.selected ? C.grid : 'transparent';
        ctx.shadowBlur = tile.selected ? 8 : 0;
        ctx.lineJoin = 'round';
        drawIcon(ctx, cs * 0.74, iconCol);
        ctx.restore();
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
