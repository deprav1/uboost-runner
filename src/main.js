// ЮБуст Раннер — бутстрап, игровой цикл, машина состояний, оркестрация.
import { CONFIG } from '../config.js';
import { setupCanvas, scanlines, clamp, drawRails } from './engine/render.js';
import { bloom, aberration, vignette, grain } from './engine/postfx.js';
import { Particles } from './engine/particles.js';
import { Quality } from './engine/quality.js';
import * as timescale from './engine/timescale.js';
import { initInput } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { loadAssets, getSprite } from './engine/assets.js';
import { World, geometry, zoneIndexAt } from './game/world.js';
import { Player } from './game/player.js';
import { Obstacle, nextSafeLane, pickObstacleType } from './game/obstacles.js';
import { DataBit, Heart } from './game/collectibles.js';
import { Boost, Magnet, X2 } from './game/boosts.js';
import { Billboards } from './game/billboards.js';
import { Stats } from './game/stats.js';
import { Progress, rollMissions, checkMissions } from './game/progress.js';
import { Settings, loadFlag, saveFlag } from './game/settings.js';
import { CaptchaGame } from './game/captcha.js';
import { Tutorial } from './game/tutorial.js';
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

// --- Системы ----------------------------------------------------------------
const world = new World();
const player = new Player();
const particles = new Particles();
// бюджет частиц следует за тиром качества (DPR уже подключён выше)
quality.onChange = (s) => { view.setDprCap(s.dpr); particles.setBudget(s); };
particles.setBudget(quality.s);
const stats = new Stats(tg);
stats.syncBestFromCloud();
const progress = new Progress(tg);
progress.syncFromCloud(() => UI.showRank(STR.ranks[progress.data.rankId]));
const audio = new Audio(loadFlag('muted', !CONFIG.AUDIO_DEFAULT_ON) ? false : CONFIG.AUDIO_DEFAULT_ON);
const events = new EventManager();
const billboards = new Billboards();
const tutorial = new Tutorial();
let lastTutorialStep = -1;

let obstacles = [];
let boosts = [];
let pickups = [];            // спец-пикапы (Magnet/X2)
let databits = [];
let hearts = [];
let captchaGame = null;      // активная капча-мини-игра
let x2Timer = 0;             // остаток действия удвоителя очков (с)
let magnetTimer = 0;         // остаток действия магнита (с)
let currentZone = 0;         // индекс текущей визуальной зоны (для popText/аналитики)

let state = 'menu';          // menu | play | captcha | paused | dying | over
let pausedFrom = 'play';     // откуда ушли в паузу (play | captcha)
let pauseCountdown = 0;      // >0 — идёт отсчёт возобновления
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
let sessionMissions = [];
let last = performance.now();
let lastHudAt = 0;
let lastHudScore = -1;
let lastHudDist = -1;
let lastHudLives = -1;
let lastHudCombo = -1;
let lastHudBoostBucket = -1;
let lastHudMult = -1;

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

// --- Голос маскота (харизма) -------------------------------------------------
// Ракета изредка комментирует происходящее короткими репликами (popText над собой).
// Кулдаун не даёт фразам наслаиваться; idle-таймер подкидывает реплику в простое.
let mascotCd = 0;            // кулдаун до следующей реплики (с)
let idleChatter = 0;        // накопитель «тишины» для idle-реплик (с)
let idleNext = 9;           // порог следующей idle-реплики (с, с джиттером)
let hackSpoke = false;      // уже отреагировал на текущий «взлом управления»

function mascotSay(key, force = false) {
  if (!force && (state !== 'play' || mascotCd > 0)) return;
  const line = pick(STR.mascot[key] || []);
  if (!line) return;
  particles.popText(player.x, player.y - player.size * 1.7, line, C.white);
  mascotCd = 1.7;
  idleChatter = 0;
  idleNext = 8 + Math.random() * 6;
}

// --- Скорость / прогрессия --------------------------------------------------
function baseSpeed() {
  const base = Math.min(CONFIG.MAX_SPEED, CONFIG.BASE_SPEED + (stats.distance / 100) * CONFIG.SPEED_GROWTH);
  const P = CONFIG.PROGRESSION;
  // первый (непройденный туториал) забег — чуть медленнее, пока игрок осваивается
  if (!Settings.get('tutorialDone') && stats.distance < P.FIRST_RUN_DIST) return base * P.FIRST_RUN_SPEED_MUL;
  return base;
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
  obstacles = []; boosts = []; pickups = []; databits = []; hearts = []; particles.clear();
  billboards.clear();
  captchaGame = null;
  x2Timer = 0; magnetTimer = 0; currentZone = 0;
  distSinceCol = 0; colCount = 0; heartColCount = 0;
  corridor.safeLane = 1;
  shake = 0; flash = 0;
  timescale.reset();
  lastComboCelebrated = 0;
  comboBurst = null;
  mascotCd = 0; idleChatter = 0; idleNext = 9; hackSpoke = false;
  player.mood = 'normal';
  state = 'play';
  tutorial.start();
  lastTutorialStep = -1;
  sessionMissions = rollMissions();
  UI.showGame();
  Analytics.gameStart();
  Analytics.session({ n: progress.data.gamesPlayed + 1 });
}

// --- Пауза --------------------------------------------------------------------
// Сворачивание мини-аппа/вкладки или кнопка ⏸. Возврат — через отсчёт 3-2-1,
// чтобы игрок успел положить палец, а не погиб мгновенно.
function enterPause() {
  if (state !== 'play' && state !== 'captcha') return;
  pausedFrom = state;
  state = 'paused';
  pauseCountdown = 0;
  audio.stopMusic();
  UI.hideTutorial();
  UI.showPause();
  Analytics.pause({ action: 'enter' });
}

function requestResume() {
  if (state !== 'paused' || pauseCountdown > 0) return;
  pauseCountdown = CONFIG.PAUSE_COUNTDOWN;
  UI.setPauseCountdown(Math.ceil(pauseCountdown));
  Analytics.pause({ action: 'resume' });
}

// --- Game feel / juice --------------------------------------------------------
// Гейт через Settings.fx(): при reduced motion фризы/замедления отключены
// (резкий «скачок» времени плохо переносится при вестибулярной чувствительности).
function juiceHitStop(sec) { if (Settings.fx().shakeMul > 0) timescale.hitStop(sec); }
function juiceSlowMo(factor, sec) { if (Settings.fx().shakeMul > 0) timescale.slowMo(factor, sec); }

// --- Game over --------------------------------------------------------------
function die(killerColor = C.danger) {
  state = 'dying'; dyingTimer = 0.7;
  UI.hideTutorial();
  shake = 22; flash = 1;
  audio.sfxHit(); haptic('heavy');
  player.mood = 'danger';
  particles.burst(player.x, player.y, killerColor, 26, 360);
  particles.burst(player.x, player.y, C.danger, 14, 280);
  // 3-4 тлеющих обломка — «остаточная» деталь после смэша
  for (let i = 0; i < 4; i++) particles.ember(player.x, player.y, killerColor);
  player.invuln = 0;
  mascotSay('death', true);   // последние слова — даже в состоянии dying
  juiceHitStop(CONFIG.JUICE.DEATH_FREEZE);
}

function finishGameOver() {
  state = 'over';
  audio.stopMusic();

  // миссии забега: бонус-очки добавляются ДО подсчёта звания и рекорда
  const { done: missionsDone, bonus } = checkMissions(stats, sessionMissions);
  if (bonus > 0) stats.score += bonus;

  const meta = progress.finishRun(stats);

  lastRecord = stats.commitBest();
  lastCard = renderShareCard(stats, lastRecord, progress.data);
  const challengeBeat = challengeScore > 0 && stats.scoreInt > challengeScore;
  UI.showGameOver(stats, lastRecord, lastCard, challengeBeat, {
    missions: sessionMissions, missionsDone, bonus,
    rankId: meta.rankId, rankUp: meta.rankUp, newBadges: meta.newBadges,
  });
  Analytics.gameOver({
    score: stats.scoreInt, distance: stats.distInt, lives: stats.lives,
    captchas: stats.captchas, geoblocks: stats.geoblocks, ads: stats.ads, lags: stats.lags,
  });
  for (const id of missionsDone) Analytics.missionDone({ id });
  for (const id of meta.newBadges) Analytics.badgeUnlock({ id });
  if (meta.rankUp) Analytics.rankUp({ rankId: meta.rankId });
}

// --- Спавн «коридора» -------------------------------------------------------
function spawnColumn(geom, colSpacing) {
  const nextSafe = nextSafeLane(corridor.safeLane);

  const others = [];
  for (let l = 0; l < CONFIG.LANES; l++) if (l !== nextSafe) others.push(l);
  const diff = diffNow();
  const block2 = stats.distance >= CONFIG.PROGRESSION.BLOCK2_MIN_DIST &&
    Math.random() < CONFIG.BLOCK2_BASE + (CONFIG.BLOCK2_MAX - CONFIG.BLOCK2_BASE) * diff;
  const blockLanes = block2 ? others : [pick(others)];

  // препятствия рождаются у горизонта (z=1) и налетают на игрока
  for (const lane of blockLanes) {
    const o = new Obstacle(lane, pickObstacleType(stats.distance));
    o.size(geom); o.z = 1.0;
    o.warned = block2; // двойной блок — телеграфируем заранее (визуал + sfxWarn)
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
  let spawnedSpecial = false;
  if (colCount % CONFIG.BOOST_EVERY === 0 && Math.random() < CONFIG.BOOST_CHANCE) {
    boosts.push(new Boost(nextSafe, 1.16, geom));
    spawnedSpecial = true;
  }
  // спец-пикап (Magnet/X2) — взаимоисключающе с бустом, тоже на безопасной полосе
  if (!spawnedSpecial && colCount % CONFIG.PICKUP_EVERY === 0 && Math.random() < CONFIG.PICKUP_CHANCE) {
    pickups.push(Math.random() < 0.5 ? new Magnet(nextSafe, 1.16, geom) : new X2(nextSafe, 1.16, geom));
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
  UI.hideTutorial();
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
        mascotSay('nearMiss');
        juiceSlowMo(CONFIG.JUICE.NEARMISS_SLOWMO, CONFIG.JUICE.NEARMISS_DURATION);
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
        juiceHitStop(CONFIG.JUICE.SMASH_FREEZE);
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
        mascotSay('loseLife');
        juiceHitStop(CONFIG.JUICE.LOSELIFE_FREEZE);
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
      tutorial.onCollect();
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
      particles.popText(player.x + 40, player.y - 40, STR.boostPop, C.white);
      mascotSay('boost');
    }
  }

  // спец-пикапы (Magnet / X2)
  for (const pk of pickups) {
    if (pk.dead) continue;
    if (zHit(pk.z) && laneClose(pk.laneNorm)) {
      pk.dead = true;
      const p = geom.project(pk.laneNorm, pk.z);
      audio.sfxPickup(); haptic('medium');
      flash = Math.max(flash, 0.4);
      if (pk instanceof X2) {
        x2Timer = CONFIG.X2_DURATION;
        stats.scoreMult = CONFIG.X2_MULT;
        particles.burst(p.x, p.y, C.gold, 18, 300);
        particles.ring(p.x, p.y, C.gold, 8, 100, 0.5);
        particles.flashGlow(p.x, p.y, C.gold, 80, 0.45);
        particles.popText(player.x + 40, player.y - 40, STR.pickupX2, C.gold);
      } else {
        magnetTimer = CONFIG.MAGNET_DURATION;
        particles.burst(p.x, p.y, C.data, 18, 300);
        particles.ring(p.x, p.y, C.data, 8, 100, 0.5);
        particles.flashGlow(p.x, p.y, C.data, 80, 0.45);
        particles.popText(player.x + 40, player.y - 40, STR.pickupMagnet, C.data);
      }
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
  pickups = pickups.filter((pk) => !pk.dead);
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
    mascotSay('combo');
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
  simDt *= timescale.mul(dt); // hit-stop/slow-mo (game feel) — рендер на полной скорости

  if (state === 'paused') {
    // мир заморожен; идёт только отсчёт возобновления (если запрошен)
    if (pauseCountdown > 0) {
      pauseCountdown -= dt;
      if (pauseCountdown <= 0) {
        state = pausedFrom;
        UI.hidePause();
        if (!document.hidden && state === 'play') audio.startMusic();
      } else {
        UI.setPauseCountdown(Math.ceil(pauseCountdown));
      }
    }
  } else if (state === 'captcha') {
    captchaGame.update(dt);
    if (captchaGame.done) {
      Analytics.captchaResult({ result: captchaGame.result });
      if (captchaGame.result === 'solved') {
        // победа: бонус + неуязвимость
        stats.score += CONFIG.SCORE_CAPTCHA_SOLVE;
        player.invuln = CONFIG.CAPTCHA_SOLVE_INVULN;
        player.mood = 'boost';
        flash = 0.6;
        particles.burst(player.x, player.y, C.white, 16, 260);
        particles.popText(player.x, player.y - 50, pick(STR.captchaSolve), C.white);
        mascotSay('captchaSolve', true);
        haptic('medium');
      } else {
        // провал: теряем жизнь
        const alive = stats.loseLife();
        player.mood = 'danger';
        flash = 0.5; shake = 14;
        audio.sfxHit(); haptic('heavy');
        particles.popText(player.x, player.y - 50, pick(STR.captchaFail), C.red);
        if (!alive) { captchaGame = null; die(); return requestAnimationFrame(frame); }
        mascotSay('captchaFail', true);
        player.invuln = CONFIG.CAPTCHA_FAIL_INVULN;
        juiceHitStop(CONFIG.JUICE.LOSELIFE_FREEZE);
      }
      captchaGame = null;
      state = 'play';
    }
    // фон слегка анимируем в captcha-паузе
    world.update(dt * 0.12, 80, stats.distance);
    particles.update(dt);
    shake = Math.max(0, shake - dt * 40);
    flash = Math.max(0, flash - dt * 2.2);
  } else if (state === 'play' || state === 'dying') {
    world.update(simDt, speed, stats.distance);
    billboards.update(simDt, speed, state === 'play');
    stats.addDistance(speed, simDt);
    player.update(simDt, geom, particles, player.invuln > 0, speedFrac(speed));

    // плавное возвращение настроения к normal
    if (player.mood !== 'boost' && player.mood !== 'captcha') {
      if (player.invuln <= 0) player.mood = 'normal';
    }
    if (player.invuln <= 0 && player.mood === 'boost') player.mood = 'normal';

    if (state === 'play') {
      // таймеры спец-пикапов (X2/магнит)
      if (x2Timer > 0) { x2Timer -= simDt; if (x2Timer <= 0) { x2Timer = 0; stats.scoreMult = 1; } }
      if (magnetTimer > 0) { magnetTimer -= simDt; if (magnetTimer <= 0) magnetTimer = 0; }

      // вход в новую визуальную зону → popText + аналитика
      const zone = zoneIndexAt(stats.distance);
      if (zone > currentZone) {
        currentZone = zone;
        particles.popText(view.W / 2, view.H * 0.3, STR.zoneEnter(STR.zones[zone]), world.pal.grid);
        mascotSay('zone');
        Analytics.zoneReached({ zone });
      }

      tutorial.update(dt);
      if (tutorial.step !== lastTutorialStep) {
        lastTutorialStep = tutorial.step;
        if (tutorial.active) { UI.showTutorialStep(STR.tutorial[tutorial.step]); Analytics.tutorialStep({ step: tutorial.step }); }
        else UI.hideTutorial();
      }
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

      // маскот реагирует на «взлом управления» (инверсию) — один раз за гэг
      if (events.controlsInverted()) {
        if (!hackSpoke) { mascotSay('inverted'); hackSpoke = true; }
      } else hackSpoke = false;

      // idle-болтовня в спокойные моменты (когда давно молчал)
      idleChatter += dt;
      if (idleChatter >= idleNext && mascotCd <= 0) mascotSay('idle');
    }

    for (const o of obstacles) {
      o.update(simDt, speed);
      if (o.warned && !o.warnPlayed && o.z <= CONFIG.JUICE.WARN_Z) {
        o.warnPlayed = true;
        audio.sfxWarn();
      }
    }
    for (const b of boosts) b.update(simDt, speed);
    for (const pk of pickups) pk.update(simDt, speed);
    // магнит: близкие биты подтягиваются к полосе игрока
    const pull = magnetTimer > 0 ? 1 - Math.exp(-CONFIG.MAGNET_PULL * simDt) : 0;
    for (const d of databits) {
      d.update(simDt, speed);
      if (pull > 0 && d.z < CONFIG.MAGNET_RANGE_Z) d.laneNorm += (player.laneNormF - d.laneNorm) * pull;
    }
    for (const h of hearts) h.update(simDt, speed);
    if (state === 'play') {
      handleCollisions(geom);
      checkComboCelebration();
    } else {
      databits = databits.filter((d) => !d.dead);
      hearts = hearts.filter((h) => !h.dead);
      pickups = pickups.filter((pk) => !pk.dead);
    }
  } else {
    world.update(dt * 0.3, 120, stats.distance);
    events.update(dt); // обновляем cooldown
  }

  particles.update(dt);
  mascotCd = Math.max(0, mascotCd - dt);
  shake = Math.max(0, shake - dt * 40);
  flash = Math.max(0, flash - dt * 2.2);

  // --- draw ---
  const t = now / 1000;
  const fx = Settings.fx();
  ctx.save();
  if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake * fx.shakeMul, (Math.random() - 0.5) * shake * fx.shakeMul);
  world.draw(ctx, geom.W, geom.H, speed);
  drawRails(ctx, geom, world.railOff, world.pal.grid);

  // всё, что живёт в глубине, рисуем far→near (painter's), игрок — на своей глубине
  const drawables = [];
  for (const d of databits) drawables.push(d);
  for (const h of hearts) drawables.push(h);
  for (const b of boosts) drawables.push(b);
  for (const pk of pickups) drawables.push(pk);
  for (const o of obstacles) drawables.push(o);
  for (const s of billboards.signs) drawables.push(s);
  drawables.sort((a, b) => b.z - a.z); // дальние (z→1) первыми

  let playerDrawn = state === 'menu';
  for (const it of drawables) {
    if (!playerDrawn && it.z < geom.playerZ) { player.draw(ctx, geom, player.invuln > 0, t); playerDrawn = true; }
    it.draw(ctx, geom, t);
  }
  if (!playerDrawn) player.draw(ctx, geom, player.invuln > 0, t);

  // аура магнита у ракеты (пульсирующее циан-кольцо, пока активен)
  if (magnetTimer > 0 && state !== 'menu') {
    const ar = player.size * (1.7 + Math.sin(t * 8) * 0.18);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + Math.sin(t * 8) * 0.12;
    ctx.strokeStyle = C.data; ctx.lineWidth = 2.5;
    ctx.shadowColor = C.data; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(player.x, player.y, ar, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  particles.draw(ctx);
  drawComboBurst(ctx, geom.W, geom.H, dt);
  ctx.restore();

  // гэги рисуются поверх игры, под UI
  if (state === 'play') events.draw(ctx, geom.W, geom.H, t, fx.glitchOn);

  // капча-оверлей
  if (state === 'captcha' && captchaGame) {
    // рисуем базовые слои игры снова под капчей — нет, капча рисует свой overlay
    captchaGame.draw(ctx, t);
  }

  // --- кинематографичная пост-обработка (тир качества рулит включением) ---
  const q = quality.s;
  if (FX.BLOOM && q.bloom) bloom(ctx, canvas, { strength: FX.BLOOM_STRENGTH, blur: FX.BLOOM_BLUR, scale: q.bloomScale });
  if (FX.ABERRATION && q.aberration && fx.grainOn) aberration(ctx, canvas, FX.ABERRATION);

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
  if (flash > 0) { ctx.save(); ctx.globalAlpha = clamp(flash, 0, fx.flashMax) * 0.6; ctx.fillStyle = state === 'dying' ? C.danger : C.white; ctx.fillRect(0, 0, geom.W, geom.H); ctx.restore(); }
  if (FX.VIGNETTE) vignette(ctx, geom.W, geom.H, FX.VIGNETTE);       // дёшево — всегда
  if (FX.GRAIN && q.grain && fx.grainOn) grain(ctx, geom.W, geom.H, FX.GRAIN, fxFrame++);
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
      stats.scoreMult !== lastHudMult ||
      boostBucket !== lastHudBoostBucket;
    if (hudChanged && (now - lastHudAt > 80 || boostBucket !== lastHudBoostBucket || stats.scoreMult !== lastHudMult)) {
      UI.updateHud(stats, boostFrac);
      lastHudAt = now;
      lastHudScore = stats.scoreInt;
      lastHudDist = stats.distInt;
      lastHudLives = stats.lives;
      lastHudCombo = stats.combo;
      lastHudBoostBucket = boostBucket;
      lastHudMult = stats.scoreMult;
    }
  }

  requestAnimationFrame(frame);
}

// --- Ввод -------------------------------------------------------------------
initInput(canvas, {
  onLeft: () => {
    if (state !== 'play') return;
    (events.controlsInverted() ? player.right() : player.left());
    tutorial.onSwipe();
    audio.sfxLane(); haptic('light');
  },
  onRight: () => {
    if (state !== 'play') return;
    (events.controlsInverted() ? player.left() : player.right());
    tutorial.onSwipe();
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
      tutorial.onSwipe();
      audio.sfxLane(); haptic('light');
    }
  },
  onAny: () => audio.ensure(),
}, () => Settings.swipePx());

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

// --- Настройки / доступность -------------------------------------------------
function applyUiScale() {
  const scale = CONFIG.UI_SCALES[Settings.get('uiScale')] ?? 1;
  document.documentElement.style.setProperty('--ui-scale', scale);
}

let settingsFrom = 'menu'; // куда вернуться после закрытия настроек
function openSettings(from) {
  settingsFrom = from;
  audio.ensure();
  if (from === 'pause') UI.hidePause();
  UI.refreshSettingsUI(Settings, audio.enabled);
  UI.showSettings();
}
function closeSettings() {
  UI.hideSettings();
  if (settingsFrom === 'pause') UI.showPause();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { audio.stopMusic(); enterPause(); }
  else if (state === 'play') audio.startMusic();
});

// --- Старт ------------------------------------------------------------------
UI.fillStaticCopy();
UI.showChallenge(challengeScore);
UI.showRank(STR.ranks[progress.data.rankId]);
UI.showStart();
refreshMute();
UI.dom.btnStart.addEventListener('click', () => { audio.ensure(); startGame(); });
UI.dom.btnRestart.addEventListener('click', startGame);
UI.dom.btnShare.addEventListener('click', shareRun);
UI.dom.btnUboost.addEventListener('click', openStore);
UI.dom.btnMute.addEventListener('click', toggleMute);
UI.dom.btnPause.addEventListener('click', () => { audio.ensure(); enterPause(); });
UI.dom.btnResume.addEventListener('click', () => { audio.ensure(); requestResume(); });

applyUiScale();
UI.dom.btnSettings.addEventListener('click', () => openSettings(state === 'paused' ? 'pause' : 'menu'));
UI.dom.btnPauseSettings.addEventListener('click', () => openSettings('pause'));
UI.dom.btnSettingsClose.addEventListener('click', closeSettings);
UI.dom.setSound.addEventListener('click', () => {
  toggleMute();
  Analytics.settingsChange({ key: 'sound', value: audio.enabled });
  UI.refreshSettingsUI(Settings, audio.enabled);
});
UI.dom.setMotion.addEventListener('click', () => {
  const order = ['auto', 'off', 'on'];
  const next = order[(order.indexOf(Settings.get('reducedMotion')) + 1) % order.length];
  Settings.set('reducedMotion', next);
  Analytics.settingsChange({ key: 'reducedMotion', value: next });
  UI.refreshSettingsUI(Settings, audio.enabled);
});
UI.dom.setColorAssist.addEventListener('click', () => {
  const next = !Settings.get('colorAssist');
  Settings.set('colorAssist', next);
  Analytics.settingsChange({ key: 'colorAssist', value: next });
  UI.refreshSettingsUI(Settings, audio.enabled);
});
UI.dom.setSwipe.addEventListener('click', () => {
  const next = (Settings.get('swipeSens') + 1) % CONFIG.INPUT.SWIPE_LEVELS.length;
  Settings.set('swipeSens', next);
  Analytics.settingsChange({ key: 'swipeSens', value: next });
  UI.refreshSettingsUI(Settings, audio.enabled);
});
UI.dom.setScale.addEventListener('click', () => {
  const next = (Settings.get('uiScale') + 1) % CONFIG.UI_SCALES.length;
  Settings.set('uiScale', next);
  applyUiScale();
  Analytics.settingsChange({ key: 'uiScale', value: next });
  UI.refreshSettingsUI(Settings, audio.enabled);
});

requestAnimationFrame(frame);
