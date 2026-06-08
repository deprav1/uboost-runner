// Фон: многослойная синтвейв-сцена с глубиной — раскалённое солнце-корона,
// горные гряды-параллакс, атмосферная дымка горизонта, перспективная сетка-пол
// с отражением солнца, многослойные мерцающие звёзды и спид-лайны.
// Скорость читается глазами; вся «художественная» глубина настраивается в CONFIG.FX.
import { CONFIG } from '../../config.js';
import { speedlines, lerp } from '../engine/render.js';
import { getSprite } from '../engine/assets.js';

const C = CONFIG.COLORS;
const FX = CONFIG.FX;

export class World {
  constructor() {
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
    this.seedTowers();
    this.seedStars();
    this.seedRidges();
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

  update(dt, speed) {
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
    const horizon = H * 0.42;
    const t = this.t;

    // --- небо: глубокий вертикальный градиент с тёплым подсветом у горизонта ---
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bgTop);
    g.addColorStop(0.32, '#0c0205');
    g.addColorStop(0.55, '#0a0204');
    g.addColorStop(1, C.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // --- звёзды (под солнцем, за горами) ---
    this._drawStars(ctx, W, horizon);

    // --- солнце-корона ---
    this._drawSun(ctx, W, H, horizon, t);

    // --- дальние дата-вышки (между грядами и солнцем) ---
    ctx.save();
    for (const tw of this.towers) {
      const tx = tw.x * W, twd = tw.w * W, th = tw.h * H;
      ctx.shadowColor = C.red; ctx.shadowBlur = 12;
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.5;
      ctx.globalAlpha = tw.a * 0.7;
      ctx.strokeRect(tx, horizon - th, twd, th);
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
      haze.addColorStop(0, 'rgba(255,41,55,0)');
      haze.addColorStop(0.7, 'rgba(255,41,55,0.10)');
      haze.addColorStop(1, 'rgba(255,90,70,0.20)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizon - H * 0.12, W, H * 0.17);
      ctx.restore();
    }

    // --- линия горизонта (яркая, свечение) ---
    ctx.save();
    ctx.shadowColor = C.red; ctx.shadowBlur = 22;
    ctx.strokeStyle = C.redBright; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(W, horizon); ctx.stroke();
    ctx.restore();

    // --- перспективная сетка-пол + отражение солнца ---
    this._drawFloor(ctx, W, H, horizon);

    // спид-лайны поверх фона
    if (speed > 0) speedlines(ctx, W, H, speed, this.lineOff, C.red, C.white, CONFIG.SPEEDLINES);

    // спрайт-оверлей горизонта (skyline) — если когда-нибудь вернут ассеты
    const skyline = getSprite('world/skyline');
    if (skyline) {
      ctx.save();
      ctx.globalAlpha = 0.85;
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
    // внешняя корона — широкое мягкое свечение
    const halo = ctx.createRadialGradient(cx, horizon, R * 0.2, cx, horizon, R * 2.8);
    halo.addColorStop(0, 'rgba(255,90,70,0.55)');
    halo.addColorStop(0.35, 'rgba(255,41,55,0.22)');
    halo.addColorStop(0.7, 'rgba(255,41,55,0.06)');
    halo.addColorStop(1, 'rgba(255,41,55,0)');
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
    // рим-лайт: тонкая красная кромка сверху
    ctx.shadowColor = C.red; ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(255,41,55,0.45)'; ctx.lineWidth = 1.2;
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

    // отражение солнца — вертикальная мерцающая колонна под солнцем
    if (FX.SUN_REFLECTION) {
      ctx.save();
      const refW = Math.min(W, H) * 0.22 * 1.4;
      const rg = ctx.createLinearGradient(0, horizon, 0, H);
      rg.addColorStop(0, 'rgba(255,90,70,0.30)');
      rg.addColorStop(0.4, 'rgba(255,41,55,0.12)');
      rg.addColorStop(1, 'rgba(255,41,55,0)');
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

    // сетка
    ctx.save();
    ctx.strokeStyle = C.grid; ctx.shadowColor = C.grid; ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55;
    // вертикали (сходятся к точке схода)
    for (let i = -10; i <= 10; i++) {
      const fx = vpx + i * (W / 10);
      ctx.beginPath();
      ctx.moveTo(vpx + i * 12, horizon);
      ctx.lineTo(fx, H);
      ctx.stroke();
    }
    // горизонтали (бегут на игрока, плотнее у горизонта)
    for (let i = 0; i < 16; i++) {
      const p = ((i + this.scroll) / 16);
      const y = horizon + (H - horizon) * (p * p);
      ctx.globalAlpha = 0.14 + 0.6 * p;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }
}

// Геометрия полос — единая точка истины
export function geometry(W, H) {
  const top = H * CONFIG.LANE_BAND_TOP;
  const bottom = H * CONFIG.LANE_BAND_BOTTOM;
  const band = bottom - top;
  const laneH = band / CONFIG.LANES;
  const laneY = [];
  for (let i = 0; i < CONFIG.LANES; i++) laneY.push(top + laneH * (i + 0.5));
  return { W, H, laneY, laneH, playerX: W * CONFIG.PLAYER_X };
}
