// ЮБуст Раннер — бутстрап, игровой цикл, машина состояний, оркестрация.
import { CONFIG } from '../config.js';
import { setupCanvas, scanlines, clamp, drawRails } from './engine/render.js';
import { bloom, aberration, vignette, grain } from './engine/postfx.js';
import { Particles } from './engine/particles.js';
import { initInput } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { loadAssets, getSprite } from './engine/assets.js';
import { World, geometry } from './game/world.js';
import { Player } from './game/player.js';
import { Obstacle, TYPE_KEYS, nextSafeLane } from './game/obstacles.js';
import { DataBit, Heart } from './game/collectibles.js';
import { Boost } from './game/boosts.js';
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
const { ctx, ...view } = setupCanvas(canvas);

// Растровые ассеты необязательны: если манифест/PNG не загрузятся, объекты
// останутся на процедурном рендере через getSprite() -> null.
loadAssets();

// --- Telegram ---------------------------------------------------------------
const tg = window.Telegram?.WebApp;
if (tg) { try { tg.expand(); tg.ready(); } catch {} }
function haptic(kind) { try { tg?.HapticFeedback?.impactOccurred?.(kind); } catch {} }

// --- Сохранёнки -------------------------------------------------------------
function loadFlag(key, def) { try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}')[key] ?? def; } catch { return def; } }
function saveFlag(key, val) { try { const d = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || '{}'); d[key] = val; localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(d)); } catch {} }

// --- Системы ----------------------------------------------------------------
const world = new World();
const player = new Player();
const particles = new Particles();
const stats = new Stats();
const audio = new Audio(loadFlag('muted', !CONFIG.AUDIO_DEFAULT_ON) ? false : CONFIG.AUDIO_DEFAULT_ON);
const events = new EventManager();

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
function diffNow() { return clamp(stats.distance / CONFIG.DIFF_DIST, 0, 1); }

// --- Старт/рестарт ----------------------------------------------------------
function startGame() {
  audio.ensure(); audio.startMusic();
  stats.reset(); player.reset();
  obstacles = []; boosts = []; databits = []; hearts = []; particles.clear();
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
function die() {
  state = 'dying'; dyingTimer = 0.7;
  shake = 22; flash = 1;
  audio.sfxHit(); haptic('heavy');
  player.mood = 'danger';
  particles.burst(view.W * CONFIG.PLAYER_X, player.y, C.danger, 26, 360);
  player.invuln = 0;
}

function finishGameOver() {
  state = 'over';
  audio.stopMusic();
  lastRecord = stats.commitBest();
  lastCard = renderShareCard(stats, lastRecord);
  UI.showGameOver(stats, lastRecord, lastCard);
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

  const spawnX = geom.W + 60;
  for (const lane of blockLanes) {
    const o = new Obstacle(lane, pick(TYPE_KEYS));
    o.size(geom); o.x = spawnX;
    obstacles.push(o);
  }

  // поток данных
  const lead = colSpacing * 0.5;
  for (let i = 0; i < CONFIG.BITS_PER_COL; i++) {
    const bx = spawnX - lead * ((i + 0.5) / CONFIG.BITS_PER_COL);
    databits.push(new DataBit(nextSafe, bx, geom));
  }

  colCount++;
  heartColCount++;

  // VPN-буст
  if (colCount % CONFIG.BOOST_EVERY === 0 && Math.random() < CONFIG.BOOST_CHANCE) {
    const b = new Boost(nextSafe, geom);
    b.x = spawnX + colSpacing * 0.5;
    boosts.push(b);
  }
  // пикап-сердце (только если жизней меньше максимума)
  if (heartColCount >= CONFIG.HEART_EVERY && Math.random() < CONFIG.HEART_CHANCE && stats.lives < CONFIG.MAX_LIVES) {
    const h = new Heart(nextSafe, geom);
    h.x = spawnX + colSpacing * 0.3;
    hearts.push(h);
    heartColCount = 0;
  }

  corridor.safeLane = nextSafe;
}

// --- Коллизии ---------------------------------------------------------------
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function enterCaptcha(geom) {
  state = 'captcha';
  audio.ensure();
  // лёгкий slow-mo ощущается за счёт заморозки мира
  captchaGame = new CaptchaGame(geom.W, geom.H);
  player.mood = 'captcha';
  haptic('medium');
}

function handleCollisions(geom) {
  const ph = player.hitbox(geom);

  for (const o of obstacles) {
    if (o.dead || o.triggered) continue;
    if (!o.passed && o.x + o.w < geom.playerX) {
      o.passed = true;
      stats.dodge(o.stat);
      const d = Math.abs(player.y - geom.laneY[o.lane]);
      if (d < geom.laneH * 1.1) {
        stats.nearMiss();
        player.mood = 'danger';
        particles.popText(geom.playerX + 40, player.y - 30, pick(STR.hype), C.white);
      }
    }
    if (overlap(ph, o.hitbox(geom))) {
      if (player.invuln > 0) {
        o.dead = true; stats.smash();
        particles.burst(o.x, geom.laneY[o.lane], o.color, 18, 320);
        particles.ring(o.x, geom.laneY[o.lane], o.color, 8, 80, 0.5);
        particles.flashGlow(o.x, geom.laneY[o.lane], o.color, 70, 0.35);
        audio.sfxSmash(); shake = Math.max(shake, 8);
      } else if (o.isCaptcha && !o.triggered) {
        // капча запускает мини-игру вместо смерти
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
        particles.popText(geom.playerX, player.y - 40, '−♥', C.red);
      } else {
        die(); return;
      }
    }
  }

  // биты данных
  for (const d of databits) {
    if (d.dead) continue;
    if (overlap(ph, d.hitbox(geom))) {
      d.dead = true; stats.collectBit();
      audio.sfxBit();
      particles.burst(d.x, geom.laneY[d.lane], C.white, 5, 130);
      particles.flashGlow(d.x, geom.laneY[d.lane], C.red, 34, 0.25);
    }
  }

  // бусты
  for (const b of boosts) {
    if (b.dead) continue;
    if (overlap(ph, b.hitbox(geom))) {
      b.dead = true;
      player.invuln = CONFIG.BOOST_DURATION;
      player.mood = 'boost';
      flash = Math.max(flash, 0.7);
      audio.sfxBoost(); haptic('medium');
      particles.burst(b.x, geom.laneY[b.lane], C.red, 24, 380);
      particles.ring(b.x, geom.laneY[b.lane], C.white, 10, 120, 0.6);
      particles.ring(b.x, geom.laneY[b.lane], C.red, 6, 80, 0.45);
      particles.flashGlow(b.x, geom.laneY[b.lane], C.white, 90, 0.5);
      particles.popText(geom.playerX + 40, player.y - 40, 'ВПН БУСТ!', C.white);
    }
  }

  // сердца
  for (const h of hearts) {
    if (h.dead) continue;
    if (overlap(ph, h.hitbox(geom))) {
      h.dead = true;
      stats.gainLife();
      audio.sfxPickup();
      flash = Math.max(flash, 0.35);
      haptic('medium');
      particles.burst(h.x, geom.laneY[h.lane], '#ff2937', 14, 200);
      particles.ring(h.x, geom.laneY[h.lane], '#ff2937', 8, 90, 0.5);
      particles.flashGlow(h.x, geom.laneY[h.lane], '#ff2937', 70, 0.45);
      particles.popText(geom.playerX + 40, player.y - 40, STR.heartPickup, '#ff2937');
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
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
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
        particles.burst(geom.playerX, player.y, C.white, 16, 260);
        particles.popText(geom.playerX, player.y - 50, pick(STR.captchaSolve), C.white);
        haptic('medium');
      } else {
        // провал: теряем жизнь
        const alive = stats.loseLife();
        player.mood = 'danger';
        flash = 0.5; shake = 14;
        audio.sfxHit(); haptic('heavy');
        particles.popText(geom.playerX, player.y - 50, pick(STR.captchaFail), C.red);
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
  for (const d of databits) d.draw(ctx, geom, t);
  for (const h of hearts) h.draw(ctx, geom, t);
  for (const b of boosts) b.draw(ctx, geom, t);
  for (const o of obstacles) o.draw(ctx, geom, t);
  if (state !== 'menu') player.draw(ctx, geom, player.invuln > 0, t);
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

  // --- кинематографичная пост-обработка (см. CONFIG.FX) ---
  if (FX.BLOOM) bloom(ctx, canvas, { strength: FX.BLOOM_STRENGTH, blur: FX.BLOOM_BLUR, scale: FX.BLOOM_SCALE });
  if (FX.ABERRATION) aberration(ctx, canvas, FX.ABERRATION);

  // пост-эффекты
  const frac = clamp((speed - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED), 0, 1);
  const boosting = player.invuln > 0 && state !== 'captcha';
  if (frac > 0.01 || boosting) {
    const cx = geom.W * CONFIG.PLAYER_X, cy = geom.H / 2;
    const vg = ctx.createRadialGradient(cx, cy, geom.H * 0.2, cx, cy, geom.H * 0.8);
    const a = boosting ? 0.22 + Math.sin(t * 18) * 0.06 : 0.04 + frac * 0.18;
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(255,41,55,${Math.max(0, a).toFixed(3)})`);
    ctx.save(); ctx.fillStyle = vg; ctx.fillRect(0, 0, geom.W, geom.H); ctx.restore();
  }
  if (flash > 0) { ctx.save(); ctx.globalAlpha = clamp(flash, 0, 1) * 0.6; ctx.fillStyle = state === 'dying' ? C.danger : C.white; ctx.fillRect(0, 0, geom.W, geom.H); ctx.restore(); }
  if (FX.VIGNETTE) vignette(ctx, geom.W, geom.H, FX.VIGNETTE);
  if (FX.GRAIN) grain(ctx, geom.W, geom.H, FX.GRAIN, fxFrame++);
  scanlines(ctx, geom.W, geom.H);

  // HUD
  if (state === 'play' || state === 'dying' || state === 'captcha') {
    UI.updateHud(stats, boosting ? player.invuln / CONFIG.BOOST_DURATION : 0);
  }

  requestAnimationFrame(frame);
}

// --- Ввод -------------------------------------------------------------------
initInput(canvas, {
  onUp: () => {
    if (state === 'play') { player.up(); audio.sfxLane(); haptic('light'); }
  },
  onDown: () => {
    if (state === 'play') { player.down(); audio.sfxLane(); haptic('light'); }
  },
  onTap: (x, y) => {
    if (state === 'captcha' && captchaGame) {
      captchaGame.onTap(x, y);
    } else if (state === 'play' && events.needsTap()) {
      events.onTap();
    } else if (state === 'play') {
      // обычный тап — смена полосы по половине экрана
      const geom = geometry(view.W, view.H);
      (y < view.H / 2) ? (player.up(), audio.sfxLane(), haptic('light'))
                       : (player.down(), audio.sfxLane(), haptic('light'));
    }
  },
  onAny: () => audio.ensure(),
});

// --- Шеринг -----------------------------------------------------------------
async function shareRun() {
  audio.ensure();
  Analytics.share({ score: stats.scoreInt, distance: stats.distInt });
  const text = STR.shareText(stats.distInt, stats.scoreInt) + CONFIG.GAME_URL;
  try {
    const blob = lastCard ? await cardToBlob(lastCard) : null;
    if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], 'uboost.png', { type: 'image/png' })] })) {
      await navigator.share({ files: [new File([blob], 'uboost.png', { type: 'image/png' })], text });
      return;
    }
  } catch {}
  if (tg?.openTelegramLink) {
    tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(CONFIG.GAME_URL) + '&text=' + encodeURIComponent(text));
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
UI.showStart();
refreshMute();
UI.dom.btnStart.addEventListener('click', () => { audio.ensure(); startGame(); });
UI.dom.btnRestart.addEventListener('click', startGame);
UI.dom.btnShare.addEventListener('click', shareRun);
UI.dom.btnUboost.addEventListener('click', openStore);
UI.dom.btnMute.addEventListener('click', toggleMute);

requestAnimationFrame(frame);
