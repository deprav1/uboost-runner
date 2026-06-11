// Фон: многослойная синтвейв-сцена с глубиной — раскалённое солнце-корона,
// горные гряды-параллакс, атмосферная дымка горизонта, перспективная сетка-пол
// с отражением солнца, многослойные мерцающие звёзды и спид-лайны.
// Скорость читается глазами; вся «художественная» глубина настраивается в CONFIG.FX.
import { CONFIG } from '../../config.js';
import { zoomlines, lerp } from '../engine/render.js';
import { getSprite } from '../engine/assets.js';

const C = CONFIG.COLORS;
const FX = CONFIG.FX;

// --- Зоны-палитры: лерп холодных цветов сцены по дистанции --------------------
// Зоны меняют небо и сетку-пол (фирменный красный игрока/бустов НЕ трогаем).
// paletteAt лерпит RGB между соседними зонами за CONFIG.ZONE_TRANSITION метров.
// Чистая (кроме кэша на последнюю целую дистанцию) — экспорт + headless-тесты.
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbStr(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// Индекс текущей зоны по дистанции (последняя зона с dist <= distance).
export function zoneIndexAt(distance) {
  const Z = CONFIG.ZONES;
  let id = 0;
  for (let i = 0; i < Z.length; i++) if (distance >= Z[i].dist) id = i;
  return id;
}

let _palCache = { d: -1, pal: null };
export function paletteAt(distance) {
  const key = distance | 0;
  if (_palCache.d === key && _palCache.pal) return _palCache.pal;
  const Z = CONFIG.ZONES;
  const cur = Z[zoneIndexAt(distance)];
  const next = Z[zoneIndexAt(distance) + 1];
  // доля перехода к следующей зоне — только на последних ZONE_TRANSITION метрах
  let t = 0;
  if (next) {
    const start = next.dist - CONFIG.ZONE_TRANSITION;
    if (distance > start) t = Math.min(1, (distance - start) / CONFIG.ZONE_TRANSITION);
  }
  const blend = (a, b) => (!next || t <= 0) ? rgbStr(hexToRgb(a)) : rgbStr(mixRgb(hexToRgb(a), hexToRgb(b), t));
  const pal = {
    skyTop: blend(cur.sky[0], next && next.sky[0]),
    skyMid: blend(cur.sky[1], next && next.sky[1]),
    skyBottom: blend(cur.sky[2], next && next.sky[2]),
    bgBottom: blend(cur.sky[3], next && next.sky[3]),
    grid: blend(cur.grid, next && next.grid),
    gridFar: blend(cur.gridFar, next && next.gridFar),
  };
  _palCache = { d: key, pal };
  return pal;
}

export class World {
  constructor() {
    this.pal = paletteAt(0);  // текущая палитра зоны (обновляется в update)
    this.scroll = 0;       // фаза бегущей сетки
    this.railOff = 0;      // смещение пунктира рельсов (px)
    this.lineOff = 0;      // смещение спид-лайнов (px)
    this.starOff = 0;
    this.t = 0;            // общее время для пульсаций/мерцания
    this.towers = [];
    this.stars = [];
    this.ridgeNear = [];
    this.ridgeFar = [];
    this.shoot = null;     // активная падающая звезда
    this.shootCd = 4 + Math.random() * 6;
    this.nebula = [];
    this.seedTowers();
    this.seedStars();
    this.seedRidges();
    this.seedNebula();
  }

  // Туманности: несколько крупных мягких маджента/фиолет пятен в небе.
  seedNebula() {
    this.nebula = [];
    for (let i = 0; i < 4; i++) {
      this.nebula.push({
        x: 0.12 + Math.random() * 0.76,
        y: 0.12 + Math.random() * 0.55,   // доля высоты неба (до горизонта)
        r: 0.18 + Math.random() * 0.22,   // радиус (доля ширины)
        a: 0.10 + Math.random() * 0.12,   // непрозрачность
        hue: Math.random() > 0.5 ? C.nebula : C.skyMid,
        sp: 0.10 + Math.random() * 0.25,  // скорость параллакса
        ph: Math.random() * Math.PI * 2,
      });
    }
  }

  seedTowers() {
    this.towers = [];
    for (let i = 0; i < 14; i++) {
      this.towers.push({
        x: Math.random(), w: 0.04 + Math.random() * 0.06,
        h: 0.05 + Math.random() * 0.16,
        a: 0.35 + Math.random() * 0.4,
      });
    }
  }

  // Звёзды трёх слоёв глубины: дальние тусклые/медленные, ближние ярче/быстрее.
  seedStars() {
    this.stars = [];
    for (let i = 0; i < 90; i++) {
      const depth = i / 90;
      this.stars.push({
        x: Math.random(),
        y: Math.random(),                 // доля высоты неба (0..1 до горизонта)
        r: 0.6 + depth * 1.4,             // радиус
        tw: Math.random() * Math.PI * 2,  // фаза мерцания
        sp: 0.04 + depth * 0.10,          // скорость параллакса
        base: 0.18 + depth * 0.35,        // базовая яркость
      });
    }
  }

  // Силуэты гряд — ломаная линия из случайных пиков, два слоя для параллакса.
  seedRidges() {
    const mk = (n, amp) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        pts.push({ x: i / n, h: (0.3 + Math.random() * 0.7) * amp });
      }
      return pts;
    };
    this.ridgeFar = mk(9, 0.10);
    this.ridgeNear = mk(13, 0.16);
    this.ridgeFarOff = 0;
    this.ridgeNearOff = 0;
  }

  update(dt, speed, distance = 0) {
    this.pal = paletteAt(distance);
    this.t += dt;
    this.scroll = (this.scroll + speed * dt * 0.0024) % 1;
    this.railOff = (this.railOff + speed * dt) % 100000;
    this.lineOff = (this.lineOff + speed * dt * 1.4) % 1000000;
    this.starOff = (this.starOff + speed * dt * 0.04) % 2000;
    this.ridgeFarOff = (this.ridgeFarOff + speed * dt * 0.000012) % 1;
    this.ridgeNearOff = (this.ridgeNearOff + speed * dt * 0.00003) % 1;
    for (const t of this.towers) {
      t.x -= speed * dt * 0.00003;
      if (t.x < -0.15) { t.x = 1.1 + Math.random() * 0.2; t.h = 0.05 + Math.random() * 0.16; t.a = 0.35 + Math.random() * 0.4; }
    }
    // редкая падающая звезда
    this.shootCd -= dt;
    if (!this.shoot && this.shootCd <= 0) {
      this.shoot = { x: 0.4 + Math.random() * 0.5, y: 0.05 + Math.random() * 0.2, life: 0, dur: 0.5 + Math.random() * 0.3, len: 0.12 + Math.random() * 0.1 };
      this.shootCd = 7 + Math.random() * 10;
    }
    if (this.shoot) { this.shoot.life += dt; if (this.shoot.life > this.shoot.dur) this.shoot = null; }
  }

  draw(ctx, W, H, speed = 0) {
    const horizon = H * CONFIG.RUN.HORIZON_FRAC;
    const t = this.t;
    const core = getSprite('world/core');
    const towerA = getSprite('world/tower_a');
    const towerB = getSprite('world/tower_b');
    const skyline = getSprite('world/skyline');
    const pal = this.pal;

    // --- небо: холодный закатный градиент (палитра зоны, лерп по дистанции) ---
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(0.30, pal.skyMid);
    g.addColorStop(0.52, pal.skyBottom);
    g.addColorStop(1, pal.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // --- туманности: мягкие маджента/фиолет пятна глубины в небе ---
    if (FX.NEBULA) this._drawNebula(ctx, W, horizon);

    // --- звёзды (под солнцем, за горами) ---
    this._drawStars(ctx, W, horizon);

    // --- солнце-корона ---
    if (core) {
      ctx.save();
      const coreSize = Math.min(W, H) * 0.48;
      ctx.globalAlpha = 0.88 + Math.sin(t * 1.4) * 0.04;
      ctx.drawImage(core, W / 2 - coreSize / 2, horizon - coreSize / 2, coreSize, coreSize);
      ctx.restore();
    } else {
      this._drawSun(ctx, W, H, horizon, t);
    }

    // --- дальние дата-вышки (между грядами и солнцем) ---
    ctx.save();
    for (const tw of this.towers) {
      const tx = tw.x * W, twd = tw.w * W, th = tw.h * H;
      ctx.globalAlpha = tw.a * 0.7;
      const img = (towerA && towerB) ? (tw.w > 0.07 ? towerB : towerA) : null;
      if (img) {
        const drawW = Math.max(twd * 1.35, img.width * 0.65);
        const drawH = th * 1.75;
        ctx.drawImage(img, tx - drawW * 0.18, horizon - drawH, drawW, drawH);
      } else {
        ctx.shadowColor = C.haze; ctx.shadowBlur = 12;
        ctx.strokeStyle = C.haze; ctx.lineWidth = 1.5;
        ctx.strokeRect(tx, horizon - th, twd, th);
      }
    }
    ctx.restore();

    // --- горные гряды-силуэты (две, параллакс) ---
    if (FX.MOUNTAINS) {
      this._drawRidge(ctx, W, horizon, this.ridgeFar, this.ridgeFarOff, C.ridgeFar, 0.55);
      this._drawRidge(ctx, W, horizon, this.ridgeNear, this.ridgeNearOff, C.ridgeNear, 0.85);
    }

    // --- атмосферная дымка горизонта (глубина) ---
    if (FX.HORIZON_HAZE) {
      ctx.save();
      const haze = ctx.createLinearGradient(0, horizon - H * 0.12, 0, horizon + H * 0.05);
      haze.addColorStop(0, 'rgba(255,46,151,0)');
      haze.addColorStop(0.7, 'rgba(255,46,151,0.12)');
      haze.addColorStop(1, 'rgba(255,126,95,0.20)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizon - H * 0.12, W, H * 0.17);
      ctx.restore();
    }

    // --- линия горизонта (яркая кромка зоны, свечение) ---
    ctx.save();
    ctx.shadowColor = pal.grid; ctx.shadowBlur = 22;
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(W, horizon); ctx.stroke();
    ctx.restore();

    // --- перспективная сетка-пол + отражение солнца ---
    this._drawFloor(ctx, W, H, horizon);

    // zoom-линии «в экран» поверх фона (разгон к точке схода)
    if (speed > 0) zoomlines(ctx, W, H, W / 2, horizon, speed, this.lineOff, pal.grid, C.white, CONFIG.SPEEDLINES);

    if (skyline) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.drawImage(skyline, 0, horizon - skyline.height * (W / skyline.width) * 0.5, W, skyline.height * (W / skyline.width));
      ctx.restore();
    }
  }

  // ---- солнце: внешняя корона + раскалённый диск с ретро-прорезями ----------
  _drawSun(ctx, W, H, horizon, t) {
    const cx = W / 2;
    const coreR = Math.min(W, H) * 0.22;
    const pulse = 1 + Math.sin(t * 1.4) * 0.03;
    const R = coreR * pulse;

    ctx.save();
    // внешняя корона — широкое мягкое маджента-свечение
    const halo = ctx.createRadialGradient(cx, horizon, R * 0.2, cx, horizon, R * 2.8);
    halo.addColorStop(0, 'rgba(255,126,95,0.50)');
    halo.addColorStop(0.35, 'rgba(255,46,151,0.22)');
    halo.addColorStop(0.7, 'rgba(176,38,255,0.07)');
    halo.addColorStop(1, 'rgba(176,38,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, horizon + R * 1.2);
    ctx.restore();

    // диск (клип по кругу), градиент раскалённый верх → тёмно-красный низ
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, horizon, R, 0, Math.PI * 2);
    ctx.clip();
    const sg = ctx.createLinearGradient(0, horizon - R, 0, horizon + R);
    sg.addColorStop(0, C.coreTop);
    sg.addColorStop(0.18, C.coreMid);
    sg.addColorStop(0.55, C.corona);
    sg.addColorStop(1, C.coreBottom);
    ctx.fillStyle = sg;
    ctx.fillRect(cx - R, horizon - R, R * 2, R * 2);

    // ретро-прорези: тонкие сверху, шире и чаще книзу (классический synthwave)
    ctx.fillStyle = C.bgBottom;
    ctx.globalAlpha = 0.9;
    let y = horizon - R * 0.05;
    let gap = 3, slit = 2;
    while (y < horizon + R) {
      ctx.fillRect(cx - R, y, R * 2, slit);
      y += slit + gap;
      slit += 0.9; gap += 0.5;   // книзу прорези толще
    }
    ctx.restore();

    // тонкий яркий ободок диска
    ctx.save();
    ctx.shadowColor = C.corona; ctx.shadowBlur = 26;
    ctx.strokeStyle = 'rgba(255,160,120,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, horizon, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ---- туманности: мягкие радиальные пятна с лёгким параллаксом -------------
  _drawNebula(ctx, W, horizon) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const n of this.nebula) {
      const drift = Math.sin(this.t * 0.15 + n.ph) * 0.02;
      const cx = ((n.x + this.starOff * n.sp * 0.0006) % 1.2 - 0.1) * W;
      const cy = (n.y + drift) * horizon;
      const r = n.r * W;
      const breathe = 0.85 + Math.sin(this.t * 0.4 + n.ph) * 0.15;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, this._rgba(n.hue, n.a * breathe));
      g.addColorStop(0.5, this._rgba(n.hue, n.a * 0.35 * breathe));
      g.addColorStop(1, this._rgba(n.hue, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  // hex (#rrggbb) → rgba-строка с заданной альфой
  _rgba(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }

  // ---- звёзды трёх слоёв + редкая падающая ----------------------------------
  _drawStars(ctx, W, horizon) {
    ctx.save();
    for (const s of this.stars) {
      const x = (s.x * W + this.starOff * s.sp * 4) % W;
      const y = s.y * horizon;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(s.tw + this.t * (0.8 + s.sp * 6)));
      ctx.globalAlpha = s.base * tw;
      ctx.fillStyle = tw > 0.92 ? '#ffd0d0' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x < 0 ? x + W : x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.shoot) {
      const sh = this.shoot;
      const p = sh.life / sh.dur;
      const x = sh.x * W + p * sh.len * W * 1.5;
      const y = sh.y * horizon + p * sh.len * horizon * 0.6;
      const tx = x - sh.len * W, ty = y - sh.len * horizon * 0.4;
      const a = Math.sin(p * Math.PI);
      ctx.save();
      const tg = ctx.createLinearGradient(tx, ty, x, y);
      tg.addColorStop(0, 'rgba(255,255,255,0)');
      tg.addColorStop(1, `rgba(255,220,220,${(0.9 * a).toFixed(3)})`);
      ctx.strokeStyle = tg; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.shadowColor = C.white; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.restore();
    }
  }

  // ---- горная гряда: заливка-силуэт + рим-лайт по верхней кромке ------------
  _drawRidge(ctx, W, horizon, pts, off, color, alpha) {
    const n = pts.length - 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    // развёртка: проходим экранную ширину с шагом и интерполируем высоту пиков
    const step = W / (n * 2);
    ctx.beginPath();
    ctx.moveTo(-step, horizon);
    for (let sx = -step; sx <= W + step; sx += step) {
      const u = (((sx / W) + off) % 1 + 1) % 1;
      const fi = u * n;
      const i0 = Math.floor(fi) % n;
      const i1 = (i0 + 1) % n;
      const h = lerp(pts[i0].h, pts[i1].h, fi - Math.floor(fi));
      ctx.lineTo(sx, horizon - h * (horizon * 0.9));
    }
    ctx.lineTo(W + step, horizon);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    // рим-лайт: тонкая циан-кромка сверху (структура мира)
    ctx.shadowColor = C.grid; ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(22,224,255,0.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    let first = true;
    for (let sx = -step; sx <= W + step; sx += step) {
      const u = (((sx / W) + off) % 1 + 1) % 1;
      const fi = u * n;
      const i0 = Math.floor(fi) % n;
      const i1 = (i0 + 1) % n;
      const h = lerp(pts[i0].h, pts[i1].h, fi - Math.floor(fi));
      const yy = horizon - h * (horizon * 0.9);
      if (first) { ctx.moveTo(sx, yy); first = false; } else ctx.lineTo(sx, yy);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---- пол: перспективная сетка + мерцающее отражение солнца ----------------
  _drawFloor(ctx, W, H, horizon) {
    const vpx = W / 2;
    const pal = this.pal;

    // отражение солнца — вертикальная мерцающая колонна под солнцем
    if (FX.SUN_REFLECTION) {
      ctx.save();
      const refW = Math.min(W, H) * 0.22 * 1.4;
      const rg = ctx.createLinearGradient(0, horizon, 0, H);
      rg.addColorStop(0, 'rgba(255,126,95,0.28)');
      rg.addColorStop(0.4, 'rgba(255,46,151,0.12)');
      rg.addColorStop(1, 'rgba(255,46,151,0)');
      ctx.fillStyle = rg;
      // трапеция, расширяющаяся книзу (перспектива)
      ctx.beginPath();
      ctx.moveTo(vpx - refW * 0.3, horizon);
      ctx.lineTo(vpx + refW * 0.3, horizon);
      ctx.lineTo(vpx + refW, H);
      ctx.lineTo(vpx - refW, H);
      ctx.closePath();
      ctx.fill();
      // горизонтальные «волны» отражения (мерцание)
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 22; i++) {
        const p = i / 22;
        const y = horizon + (H - horizon) * (p * p);
        const wob = Math.sin(this.t * 3 + i * 0.7) * 2;
        ctx.globalAlpha = 0.35 + 0.3 * Math.abs(Math.sin(i + this.t * 2));
        ctx.fillRect(0, y + wob, W, 1.5 + p * 2);
      }
      ctx.restore();
    }

    // сетка: циан, с перспективным затуханием (дальние линии тусклее/тоньше).
    // shadowBlur НЕ используем — это ~37 размытых штрихов/кадр (дорого на мобиле);
    // свечение даёт пост-bloom. На потато-тире (bloom off) сетка просто плоская.
    ctx.save();
    ctx.shadowBlur = 0;
    // вертикали (сходятся к точке схода) — затухают к горизонту
    for (let i = -10; i <= 10; i++) {
      const fx = vpx + i * (W / 10);
      // ближе к краю/низу — ярче циан, у центра-горизонта — тусклый индиго
      const edge = Math.min(1, Math.abs(i) / 10);
      ctx.strokeStyle = pal.grid;
      ctx.globalAlpha = 0.10 + 0.22 * edge;
      ctx.lineWidth = 1 + edge * 0.6;
      ctx.beginPath();
      ctx.moveTo(vpx + i * 12, horizon);
      ctx.lineTo(fx, H);
      ctx.stroke();
    }
    // горизонтали (бегут на игрока): далеко — тусклый индиго, близко — яркий циан
    for (let i = 0; i < 16; i++) {
      const p = ((i + this.scroll) / 16);
      const y = horizon + (H - horizon) * (p * p);
      ctx.strokeStyle = p < 0.45 ? pal.gridFar : pal.grid;
      ctx.globalAlpha = 0.10 + 0.5 * p;
      ctx.lineWidth = 1 + p * 1.2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }
}

// Геометрия — единая точка истины. Псевдо-3D: камера смотрит «в город», объекты
// живут в (lane, z), проецируются на экран через project(). Старые поля
// laneY/laneH/playerX сохранены для обратной совместимости.
export function geometry(W, H) {
  const R = CONFIG.RUN;
  const horizon = H * R.HORIZON_FRAC;
  const vpx = W / 2;
  const unit = Math.min(W, H) * R.UNIT;

  // Проекция точки дороги: laneNorm ∈ [−1..1] (центр полос), z ∈ [0..1] (глубина).
  // p = 1−z: 0 у горизонта, 1 у камеры. y по кривой p² (как горизонтали пола).
  const project = (laneNorm, z) => {
    const p = z < 0 ? 0 : z > 1 ? 1 : 1 - z;
    const y = horizon + (H - horizon) * (p * p);
    const spread = R.LANE_CONVERGE + (1 - R.LANE_CONVERGE) * p;
    const x = vpx + laneNorm * (W * R.LANE_SPREAD) * spread;
    const scale = R.SCALE_FAR + (R.SCALE_NEAR - R.SCALE_FAR) * p;
    return { x, y, scale, p };
  };

  // back-compat: горизонтальные полосы (используются капчей-превью/частицами)
  const top = H * CONFIG.LANE_BAND_TOP;
  const bottom = H * CONFIG.LANE_BAND_BOTTOM;
  const band = bottom - top;
  const laneH = band / CONFIG.LANES;
  const laneY = [];
  for (let i = 0; i < CONFIG.LANES; i++) laneY.push(top + laneH * (i + 0.5));

  return {
    W, H, horizon, vpx, unit,
    project,
    laneNorm: (lane) => lane - (CONFIG.LANES - 1) / 2, // 0..2 → −1..+1
    playerZ: R.PLAYER_Z,
    laneY, laneH, playerX: W * CONFIG.PLAYER_X,
  };
}
