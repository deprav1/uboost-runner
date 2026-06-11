// ЮБуст Раннер — бутстрап, игровой цикл, машина состояний, оркестрация.
import { CONFIG } from '../config.js';
import { setupCanvas, scanlines, clamp, drawRails } from './engine/render.js';
import { bloom, aberration, vignette, grain } from './engine/postfx.js';
import { Particles } from './engine/particles.js';
import { Quality } from './engine/quality.js';
import { initInput } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { loadAssets, getSprite } from './engine/assets.js';
import { World, geometry } from './game/world.js';
import { Player } from './game/player.js';
import { Obstacle, TYPE_KEYS, nextSafeLane } from './game/obstacles.js';
import { DataBit, Heart } from './game/collectibles.js';
import { Boost } from './game/boosts.js';
import { Billboards } from './game/billboards.js';
import { Stats } from './game/stats.js';
import { CaptchaGame } from './game/captcha.js';
import { EventManager } from './game/events.js';
import { renderShareCard, cardToBlob } from './game/sharecard.js';
import { Analytics } from './engine/analytics.js';
import { STR, pick } from './ui/strings.js';
import * as UI from './ui/screens.js';

const C = CONFIG.COLORS;
const FX = CONFIG.FX;
const canvas = document.getElementById('gameCanvas');
const mobileLike = window.matchMedia?.('(pointer: coarse), (max-width: 760px)')?.matches ?? false;
const startTier = mobileLike ? Math.min(CONFIG.QUALITY.START_TIER, 1) : CONFIG.QUALITY.START_TIER;
const quality = new Quality(startTier);
const { ctx, ...view } = setupCanvas(canvas, quality.s.dpr);
quality.onChange = (s) => view.setDprCap(s.dpr);

// Растровые ассеты необязательны: если манифест/PNG не загрузятся, объекты
// останутся на процедурном рендере через getSprite() -> null.
loadAssets();

// --- Telegram ---------------------------------------------------------------
const tg = window.Telegram?.WebApp;
if (tg) {
  try {
    tg.expand();
    tg.ready();
    // Свайп вниз по умолчанию сворачивает мини-апп — а игра управляется свайпами.
    tg.disableVerticalSwipes?.();
    tg.setHeaderColor?.('#000000');
    tg.setBackgroundColor?.('#000000');
    // Изменение вьюпорта (клавиатура, разворот) не всегда триггерит window resize.
    tg.onEvent?.('viewportChanged', () => window.dispatchEvent(new Event('resize')));
  } catch {}
}
function haptic(kind) { try { tg?.HapticFeedback?.impactOccurred?.(kind); } catch {} }

// --- Сохранёнки -------------------------------------------------------------
function loadFlag(key, def) { try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}')[key] ?? def; } catch { return def; } }
function saveFlag(key, val) { try { const d = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}'); d[key] = val; localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(d)); } catch {} }

// --- Системы ----------------------------------------------------------------
const world = new World();
const player = new Player();
const particles = new Particles();
// бюджет частиц следует за тиром качества (DPR уже подключён выше)
quality.onChange = (s) => { view.setDprCap(s.dpr); particles.setBudget(s); };
particles.setBudget(quality.s);
const stats = new Stats(tg);
stats.syncBestFromCloud();
const audio = new Audio(loadFlag('muted', !CONFIG.AUDIO_DEFAULT_ON) ? false : CONFIG.AUDIO_DEFAULT_ON);
const events = new EventManager();
const billboards = new Billboards();

let obstacles = [];
let boosts = [];
let databits = [];
let hearts = [];
let captchaGame = null;      // активная капча-мини-игра

let state = 'menu';          // menu | play | captcha | dying | over
let distSinceCol = 0;
let colCount = 0;
let heartColCount = 0;
const corridor = { safeLane: 1 };
let shake = 0;
let flash = 0;
let fxFrame = 0;             // счётчик кадров для дрожащего оффсета зерна
let dyingTimer = 0;
let lastCard = null;
let lastRecord = false;
let last = performance.now();
let lastHudAt = 0;
let lastHudScore = -1;
let lastHudDist = -1;
let lastHudLives = -1;
let lastHudCombo = -1;
let lastHudBoostBucket = -1;

// --- Вызов друга (виральная петля) -------------------------------------------
// Ссылка вида ?c=<очки> (или start_param "c<очки>" из Telegram-ссылки на бота).
function readChallengeScore() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('c');
    if (fromUrl) return parseInt(fromUrl, 10) || 0;
    const startParam = tg?.initDataUnsafe?.start_param;
    if (startParam && /^c\d+$/.test(startParam)) return parseInt(startParam.slice(1), 10) || 0;
  } catch {}
  return 0;
}
const challengeScore = readChallengeScore();

// Комбо-вехи для праздника
const COMBO_MILESTONES = [10, 25, 50, 100];
let lastComboCelebrated = 0;
let comboBurst = null;

// --- Скорость / прогрессия --------------------------------------------------
function baseSpeed() {
  return Math.min(CONFIG.MAX_SPEED, CONFIG.BASE_SPEED + (stats.distance / 100) * CONFIG.SPEED_GROWTH);
}
function currentSpeed() { return player.invuln > 0 ? CONFIG.BOOST_SPEED : baseSpeed(); }
function speedFrac(s) { return clamp((s - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED), 0, 1.4); }
function diffNow() {
  const base = clamp(stats.distance / CONFIG.DIFF_DIST, 0, 1);
  const wave = Math.sin((stats.distance / CONFIG.WAVE_PERIOD) * Math.PI * 2);
  return clamp(base * (1 + wave * CONFIG.WAVE_AMPLITUDE), 0, 1);
}

// --- Старт/рестарт ----------------------------------------------------------
function startGame() {
  audio.ensure(); audio.startMusic();
  stats.reset(); player.reset();
  obstacles = []; boosts = []; databits = []; hearts = []; particles.clear();
  billboards.clear();
  captchaGame = null;
  distSinceCol = 0; colCount = 0; heartColCount = 0;
  corridor.safeLane = 1;
  shake = 0; flash = 0;
  lastComboCelebrated = 0;
  comboBurst = null;
  player.mood = 'normal';
  state = 'play';
  UI.showGame();
  Analytics.gameStart();
}

// --- Game over --------------------------------------------------------------
function die(killerColor = C.danger) {
  state = 'dying'; dyingTimer = 0.7;
  shake = 22; flash = 1;
  audio.sfxHit(); haptic('heavy');
  player.mood = 'danger';
  particles.burst(player.x, player.y, killerColor, 26, 360);
  particles.burst(player.x, player.y, C.danger, 14, 280);
  player.invuln = 0;
}

function finishGameOver() {
  state = 'over';
  audio.stopMusic();
  lastRecord = stats.commitBest();
  lastCard = renderShareCard(stats, lastRecord);
  const challengeBeat = challengeScore > 0 && stats.scoreInt > challengeScore;
  UI.showGameOver(stats, lastRecord, lastCard, challengeBeat);
  Analytics.gameOver({
    score: stats.scoreInt, distance: stats.distInt, lives: stats.lives,
    captchas: stats.captchas, geoblocks: stats.geoblocks, ads: stats.ads, lags: stats.lags,
  });
}

// --- Спавн «коридора» -------------------------------------------------------
function spawnColumn(geom, colSpacing) {
  const nextSafe = nextSafeLane(corridor.safeLane);

  const others = [];
  for (let l = 0; l < CONFIG.LANES; l++) if (l !== nextSafe) others.push(l);
  const diff = diffNow();
  const block2 = Math.random() < CONFIG.BLOCK2_BASE + (CONFIG.BLOCK2_MAX - CONFIG.BLOCK2_BASE) * diff;
  const blockLanes = block2 ? others : [pick(others)];

  // препятствия рождаются у горизонта (z=1) и налетают на игрока
  for (const lane of blockLanes) {
    const o = new Obstacle(lane, pick(TYPE_KEYS));
    o.size(geom); o.z = 1.0;
    obstacles.push(o);
  }

  // поток данных по безопасной полосе — цепочкой из глубины (z ≥ 1)
  for (let i = 0; i < CONFIG.BITS_PER_COL; i++) {
    const bz = 1.0 + (i + 0.5) * 0.055;
    databits.push(new DataBit(nextSafe, bz, geom));
  }

  colCount++;
  heartColCount++;

  // VPN-буст (чуть глубже колонны — прилетает следом)
  if (colCount % CONFIG.BOOST_EVERY === 0 && Math.random() < CONFIG.BOOST_CHANCE) {
    boosts.push(new Boost(nextSafe, 1.16, geom));
  }
  // пикап-сердце (только если жизней меньше максимума)
  if (heartColCount >= CONFIG.HEART_EVERY && Math.random() < CONFIG.HEART_CHANCE && stats.lives < CONFIG.MAX_LIVES) {
    hearts.push(new Heart(nextSafe, 1.1, geom));
    heartColCount = 0;
  }

  corridor.safeLane = nextSafe;
}

// --- Коллизии (в пространстве полоса/глубина) -------------------------------
function enterCaptcha(geom) {
  state = 'captcha';
  audio.ensure();
  // лёгкий slow-mo ощущается за счёт заморозки мира
  captchaGame = new CaptchaGame(geom.W, geom.H);
  player.mood = 'captcha';
  haptic('medium');
}

function handleCollisions(geom) {
  const R = CONFIG.RUN;
  const pLane = player.laneNormF;
  const pz = geom.playerZ;
  const laneClose = (ln, tol = R.LANE_HIT) => Math.abs(ln - pLane) < tol;
  const zHit = (z) => Math.abs(z - pz) < R.Z_HIT;

  for (const o of obstacles) {
    if (o.dead || o.triggered) continue;
    // пролетел мимо камеры (z ушёл за игрока) — засчитываем уклонение
    if (!o.passed && o.z < pz - R.Z_HIT) {
      o.passed = true;
      stats.dodge(o.stat);
      if (laneClose(o.laneNorm, 1.1)) {   // прошло впритык по соседней полосе
        stats.nearMiss();
        player.mood = 'danger';
        particles.popText(player.x + 40, player.y - 30, pick(STR.hype), C.white);
      }
    }
    if (zHit(o.z) && laneClose(o.laneNorm)) {
      const p = geom.project(o.laneNorm, o.z);
      if (player.invuln > 0) {
        o.dead = true; stats.smash();
        particles.burst(p.x, p.y, o.color, 18, 320);
        particles.ring(p.x, p.y, o.color, 8, 80, 0.5);
        particles.flashGlow(p.x, p.y, o.color, 70, 0.35);
        audio.sfxSmash(); shake = Math.max(shake, 8);
      } else if (o.isCaptcha && !o.triggered) {
        o.triggered = true;
        enterCaptcha(geom);
        return;
      } else if (CONFIG.LIVES_ABSORB_ALL && stats.lives > 0) {
        o.dead = true;
        stats.loseLife();
        player.invuln = CONFIG.CAPTCHA_FAIL_INVULN;
        player.mood = 'danger';
        flash = 0.5; shake = 10;
        audio.sfxHit(); haptic('heavy');
        particles.popText(player.x, player.y - 40, '−♥', C.red);
      } else {
        die(o.color); return;
      }
    }
  }

  // биты данных
  for (const d of databits) {
    if (d.dead) continue;
    if (zHit(d.z) && laneClose(d.laneNorm)) {
      d.dead = true; stats.collectBit();
      audio.sfxBit();
      const p = geom.project(d.laneNorm, d.z);
      particles.burst(p.x, p.y, C.data, 5, 130);
      particles.flashGlow(p.x, p.y, C.data, 34, 0.25);
    }
  }

  // бусты
  for (const b of boosts) {
    if (b.dead) continue;
    if (zHit(b.z) && laneClose(b.laneNorm)) {
      b.dead = true;
      player.invuln = CONFIG.BOOST_DURATION;
      player.mood = 'boost';
      flash = Math.max(flash, 0.7);
      audio.sfxBoost(); haptic('medium');
      const p = geom.project(b.laneNorm, b.z);
      particles.burst(p.x, p.y, C.red, 24, 380);
      particles.ring(p.x, p.y, C.white, 10, 120, 0.6);
      particles.ring(p.x, p.y, C.red, 6, 80, 0.45);
      particles.flashGlow(p.x, p.y, C.white, 90, 0.5);
      particles.popText(player.x + 40, player.y - 40, 'ВПН БУСТ!', C.white);
    }
  }

  // сердца
  for (const h of hearts) {
    if (h.dead) continue;
    if (zHit(h.z) && laneClose(h.laneNorm)) {
      h.dead = true;
      stats.gainLife();
      audio.sfxPickup();
      flash = Math.max(flash, 0.35);
      haptic('medium');
      const p = geom.project(h.laneNorm, h.z);
      particles.burst(p.x, p.y, C.heart, 14, 200);
      particles.ring(p.x, p.y, C.heart, 8, 90, 0.5);
      particles.flashGlow(p.x, p.y, C.heart, 70, 0.45);
      particles.popText(player.x + 40, player.y - 40, STR.heartPickup, C.heart);
    }
  }

  obstacles = obstacles.filter((o) => !o.dead);
  boosts = boosts.filter((b) => !b.dead);
  databits = databits.filter((d) => !d.dead);
  hearts = hearts.filter((h) => !h.dead);
}

// --- Проверка комбо-вех ------------------------------------------------------
function checkComboCelebration() {
  const c = stats.combo;
  const milestone = COMBO_MILESTONES.find((m) => c >= m && m > lastComboCelebrated);
  if (milestone) {
    lastComboCelebrated = milestone;
    comboBurst = { milestone, age: 0, duration: 0.75 };
    flash = Math.max(flash, 0.4);
    particles.popText(view.W / 2, view.H / 2 - 40, STR.comboMilestone(milestone), C.white);
    haptic('medium');
  }
}

function drawComboBurst(ctx, W, H, dt) {
  if (!comboBurst) return;
  comboBurst.age += dt;
  const p = comboBurst.age / comboBurst.duration;
  if (p >= 1) { comboBurst = null; return; }

  const img = getSprite('gags/combo_burst');
  if (!img) return;

  const frame = Math.min(3, COMBO_MILESTONES.indexOf(comboBurst.milestone));
  const sx = (frame % 2) * 128;
  const sy = ((frame / 2) | 0) * 128;
  const scale = 0.85 + Math.sin(p * Math.PI) * 0.42;
  const size = Math.min(W, H) * 0.24 * scale;

  ctx.save();
  ctx.globalAlpha = Math.sin(p * Math.PI);
  ctx.drawImage(img, sx, sy, 128, 128, W / 2 - size / 2, H / 2 - size / 2, size, size);
  ctx.restore();
}

// --- Кадр -------------------------------------------------------------------
function frame(now) {
  const dtMs = now - last;
  let dt = Math.min(dtMs / 1000, 0.05);
  last = now;
  quality.sample(dtMs);           // адаптация качества по реальному времени кадра
  const geom = geometry(view.W, view.H);

  const rawSpeed = currentSpeed();
  const gagMul = events.speedMul();
  const speed = rawSpeed * gagMul;

  let simDt = dt;
  if (state === 'dying') {
    simDt = dt * 0.25; dyingTimer -= dt;
    if (dyingTimer <= 0) finishGameOver();
  }

  if (state === 'captcha') {
    captchaGame.update(dt);
    if (captchaGame.done) {
      if (captchaGame.result === 'solved') {
        // победа: бонус + неуязвимость
        stats.score += CONFIG.SCORE_CAPTCHA_SOLVE;
        player.invuln = CONFIG.CAPTCHA_SOLVE_INVULN;
        player.mood = 'boost';
        flash = 0.6;
        particles.burst(player.x, player.y, C.white, 16, 260);
        particles.popText(player.x, player.y - 50, pick(STR.captchaSolve), C.white);
        haptic('medium');
      } else {
        // провал: теряем жизнь
        const alive = stats.loseLife();
        player.mood = 'danger';
        flash = 0.5; shake = 14;
        audio.sfxHit(); haptic('heavy');
        particles.popText(player.x, player.y - 50, pick(STR.captchaFail), C.red);
        if (!alive) { captchaGame = null; die(); return requestAnimationFrame(frame); }
        player.invuln = CONFIG.CAPTCHA_FAIL_INVULN;
      }
      captchaGame = null;
      state = 'play';
    }
    // фон слегка анимируем в captcha-паузе
    world.update(dt * 0.12, 80);
    particles.update(dt);
    shake = Math.max(0, shake - dt * 40);
    flash = Math.max(0, flash - dt * 2.2);
  } else if (state === 'play' || state === 'dying') {
    world.update(simDt, speed);
    billboards.update(simDt, speed, state === 'play');
    stats.addDistance(speed, simDt);
    player.update(simDt, geom, particles, player.invuln > 0, speedFrac(speed));

    // плавное возвращение настроения к normal
    if (player.mood !== 'boost' && player.mood !== 'captcha') {
      if (player.invuln <= 0) player.mood = 'normal';
    }
    if (player.invuln <= 0 && player.mood === 'boost') player.mood = 'normal';

    if (state === 'play') {
      distSinceCol += speed * simDt;
      const colSpacing = Math.max(CONFIG.COL_SPACING_MIN, rawSpeed * CONFIG.REACT_TIME);
      if (distSinceCol >= colSpacing) { distSinceCol -= colSpacing; spawnColumn(geom, colSpacing); }

      // гэги
      events.trySpawn(stats.distance);
      const gagResult = events.update(dt);
      if (gagResult?.done && gagResult.type === 'sber') {
        // сбер «лёг» — глитч-шейк
        shake = Math.max(shake, 6);
      }
    }

    for (const o of obstacles) o.update(simDt, speed);
    for (const b of boosts) b.update(simDt, speed);
    for (const d of databits) d.update(simDt, speed);
    for (const h of hearts) h.update(simDt, speed);
    if (state === 'play') {
      handleCollisions(geom);
      checkComboCelebration();
    } else {
      databits = databits.filter((d) => !d.dead);
      hearts = hearts.filter((h) => !h.dead);
    }
  } else {
    world.update(dt * 0.3, 120);
    events.update(dt); // обновляем cooldown
  }

  particles.update(dt);
  shake = Math.max(0, shake - dt * 40);
  flash = Math.max(0, flash - dt * 2.2);

  // --- draw ---
  const t = now / 1000;
  ctx.save();
  if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  world.draw(ctx, geom.W, geom.H, speed);
  drawRails(ctx, geom, world.railOff, C.grid);

  // всё, что живёт в глубине, рисуем far→near (painter's), игрок — на своей глубине
  const drawables = [];
  for (const d of databits) drawables.push(d);
  for (const h of hearts) drawables.push(h);
  for (const b of boosts) drawables.push(b);
  for (const o of obstacles) drawables.push(o);
  for (const s of billboards.signs) drawables.push(s);
  drawables.sort((a, b) => b.z - a.z); // дальние (z→1) первыми

  let playerDrawn = state === 'menu';
  for (const it of drawables) {
    if (!playerDrawn && it.z < geom.playerZ) { player.draw(ctx, geom, player.invuln > 0, t); playerDrawn = true; }
    it.draw(ctx, geom, t);
  }
  if (!playerDrawn) player.draw(ctx, geom, player.invuln > 0, t);

  particles.draw(ctx);
  drawComboBurst(ctx, geom.W, geom.H, dt);
  ctx.restore();

  // гэги рисуются поверх игры, под UI
  if (state === 'play') events.draw(ctx, geom.W, geom.H, t);

  // капча-оверлей
  if (state === 'captcha' && captchaGame) {
    // рисуем базовые слои игры снова под капчей — нет, капча рисует свой overlay
    captchaGame.draw(ctx, t);
  }

  // --- кинематографичная пост-обработка (тир качества рулит включением) ---
  const q = quality.s;
  if (FX.BLOOM && q.bloom) bloom(ctx, canvas, { strength: FX.BLOOM_STRENGTH, blur: FX.BLOOM_BLUR, scale: q.bloomScale });
  if (FX.ABERRATION && q.aberration) aberration(ctx, canvas, FX.ABERRATION);

  // пост-эффекты
  const frac = clamp((speed - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED), 0, 1);
  const boosting = player.invuln > 0 && state !== 'captcha';
  if (frac > 0.01 || boosting) {
    const cx = player.x || geom.W / 2, cy = player.y || geom.H * 0.7;
    const vg = ctx.createRadialGradient(cx, cy, geom.H * 0.2, cx, cy, geom.H * 0.8);
    const a = boosting ? 0.22 + Math.sin(t * 18) * 0.06 : 0.04 + frac * 0.18;
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(255,41,55,${Math.max(0, a).toFixed(3)})`);
    ctx.save(); ctx.fillStyle = vg; ctx.fillRect(0, 0, geom.W, geom.H); ctx.restore();
  }
  if (flash > 0) { ctx.save(); ctx.globalAlpha = clamp(flash, 0, 1) * 0.6; ctx.fillStyle = state === 'dying' ? C.danger : C.white; ctx.fillRect(0, 0, geom.W, geom.H); ctx.restore(); }
  if (FX.VIGNETTE) vignette(ctx, geom.W, geom.H, FX.VIGNETTE);       // дёшево — всегда
  if (FX.GRAIN && q.grain) grain(ctx, geom.W, geom.H, FX.GRAIN, fxFrame++);
  if (q.scanlines) scanlines(ctx, geom.W, geom.H);

  // HUD
  if (state === 'play' || state === 'dying' || state === 'captcha') {
    const boostFrac = boosting ? player.invuln / CONFIG.BOOST_DURATION : 0;
    const boostBucket = boostFrac > 0 ? Math.ceil(boostFrac * 20) : 0;
    const hudChanged =
      stats.scoreInt !== lastHudScore ||
      stats.distInt !== lastHudDist ||
      stats.lives !== lastHudLives ||
      stats.combo !== lastHudCombo ||
      boostBucket !== lastHudBoostBucket;
    if (hudChanged && (now - lastHudAt > 80 || boostBucket !== lastHudBoostBucket)) {
      UI.updateHud(stats, boostFrac);
      lastHudAt = now;
      lastHudScore = stats.scoreInt;
      lastHudDist = stats.distInt;
      lastHudLives = stats.lives;
      lastHudCombo = stats.combo;
      lastHudBoostBucket = boostBucket;
    }
  }

  requestAnimationFrame(frame);
}

// --- Ввод -------------------------------------------------------------------
initInput(canvas, {
  onLeft: () => {
    if (state !== 'play') return;
    (events.controlsInverted() ? player.right() : player.left());
    audio.sfxLane(); haptic('light');
  },
  onRight: () => {
    if (state !== 'play') return;
    (events.controlsInverted() ? player.left() : player.right());
    audio.sfxLane(); haptic('light');
  },
  onTap: (x, y) => {
    if (state === 'captcha' && captchaGame) {
      captchaGame.onTap(x, y);
    } else if (state === 'play' && events.needsTap()) {
      events.onTap();
    } else if (state === 'play') {
      // обычный тап — смена колонны по половине экрана (лево/право), с учётом инверсии гэга
      const left = (x < view.W / 2) !== events.controlsInverted();
      (left ? player.left() : player.right());
      audio.sfxLane(); haptic('light');
    }
  },
  onAny: () => audio.ensure(),
});

// --- Шеринг -----------------------------------------------------------------
async function shareRun() {
  audio.ensure();
  Analytics.share({ score: stats.scoreInt, distance: stats.distInt });
  const challengeUrl = CONFIG.GAME_URL + '?c=' + stats.scoreInt;
  const text = STR.challengeShareText(stats.distInt, stats.scoreInt) + challengeUrl;
  try {
    const blob = lastCard ? await cardToBlob(lastCard) : null;
    if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], 'uboost.png', { type: 'image/png' })] })) {
      await navigator.share({ files: [new File([blob], 'uboost.png', { type: 'image/png' })], text });
      return;
    }
  } catch {}
  if (tg?.openTelegramLink) {
    tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(challengeUrl) + '&text=' + encodeURIComponent(text));
    return;
  }
  if (tg?.switchInlineQuery) { try { tg.switchInlineQuery(text, ['users', 'groups']); return; } catch {} }
  if (lastCard) { const a = document.createElement('a'); a.href = lastCard.toDataURL('image/png'); a.download = 'uboost-runner.png'; a.click(); }
  try { await navigator.clipboard.writeText(text); } catch {}
}

function openStore() {
  Analytics.ctaClick({ score: stats.scoreInt, distance: stats.distInt });
  const url = Analytics.storeUrl();
  if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank');
}

// --- Mute -------------------------------------------------------------------
function refreshMute() { UI.dom.btnMute.textContent = audio.enabled ? STR.muteOn : STR.muteOff; }
function toggleMute() { audio.ensure(); audio.setEnabled(!audio.enabled); saveFlag('muted', !audio.enabled); refreshMute(); }

document.addEventListener('visibilitychange', () => { if (document.hidden) audio.stopMusic(); else if (state === 'play') audio.startMusic(); });

// --- Старт ------------------------------------------------------------------
UI.fillStaticCopy();
UI.showChallenge(challengeScore);
UI.showStart();
refreshMute();
UI.dom.btnStart.addEventListener('click', () => { audio.ensure(); startGame(); });
UI.dom.btnRestart.addEventListener('click', startGame);
UI.dom.btnShare.addEventListener('click', shareRun);
UI.dom.btnUboost.addEventListener('click', openStore);
UI.dom.btnMute.addEventListener('click', toggleMute);

requestAnimationFrame(frame);
