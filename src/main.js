// uBoost Runner — бутстрап, игровой цикл, машина состояний, оркестрация.
import { CONFIG } from '../config.js';
import { setupCanvas, scanlines, clamp } from './engine/render.js';
import { Particles } from './engine/particles.js';
import { initInput } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { World, geometry } from './game/world.js';
import { Player } from './game/player.js';
import { Obstacle, spawnWave } from './game/obstacles.js';
import { Boost } from './game/boosts.js';
import { Stats } from './game/stats.js';
import { renderShareCard, cardToBlob } from './game/sharecard.js';
import { STR, pick } from './ui/strings.js';
import * as UI from './ui/screens.js';

const C = CONFIG.COLORS;
const canvas = document.getElementById('gameCanvas');
const { ctx, ...view } = setupCanvas(canvas);

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

let obstacles = [];
let boosts = [];

let state = 'menu';        // menu | play | dying | over
let spawnTimer = 0;
let wavesSinceBoost = 0;
let shake = 0;
let flash = 0;
let dyingTimer = 0;
let lastCard = null;
let lastRecord = false;
let last = performance.now();

// --- Скорость / прогрессия --------------------------------------------------
function baseSpeed() {
  return Math.min(CONFIG.MAX_SPEED, CONFIG.BASE_SPEED + (stats.distance / 100) * CONFIG.SPEED_GROWTH);
}
function currentSpeed() { return player.invuln > 0 ? CONFIG.BOOST_SPEED : baseSpeed(); }

// --- Старт/рестарт ----------------------------------------------------------
function startGame() {
  audio.ensure(); audio.startMusic();
  stats.reset(); player.reset();
  obstacles = []; boosts = []; particles.clear();
  spawnTimer = 0.6; wavesSinceBoost = 0; shake = 0; flash = 0;
  state = 'play';
  UI.showGame();
}

// --- Game over --------------------------------------------------------------
function die() {
  state = 'dying'; dyingTimer = 0.7;
  shake = 22; flash = 1;
  audio.sfxHit(); haptic('heavy');
  particles.burst(view.playerX || view.W * CONFIG.PLAYER_X, player.y, C.danger, 26, 360);
  player.invuln = 0;
}

function finishGameOver() {
  state = 'over';
  audio.stopMusic();
  lastRecord = stats.commitBest();
  lastCard = renderShareCard(stats, lastRecord);
  UI.showGameOver(stats, lastRecord, lastCard);
}

// --- Спавн ------------------------------------------------------------------
function doSpawn(geom) {
  const wave = spawnWave(geom, stats.distance);
  obstacles.push(...wave);
  wavesSinceBoost++;
  // шанс на VPN-буст в свободной полосе
  if (wavesSinceBoost >= CONFIG.BOOST_EVERY && Math.random() < CONFIG.BOOST_CHANCE) {
    const blocked = new Set(wave.map((o) => o.lane));
    const free = [0, 1, 2].filter((l) => !blocked.has(l));
    if (free.length) { boosts.push(new Boost(pick(free), geom)); wavesSinceBoost = 0; }
  }
}

// --- Коллизии ---------------------------------------------------------------
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function handleCollisions(geom) {
  const ph = player.hitbox(geom);
  // препятствия
  for (const o of obstacles) {
    if (o.dead) continue;
    // прошли мимо игрока
    if (!o.passed && o.x + o.w < geom.playerX) {
      o.passed = true;
      stats.dodge(o.stat);
      const d = Math.abs(player.y - geom.laneY[o.lane]);
      if (d < geom.laneH * 1.1) { stats.nearMiss(); particles.popText(geom.playerX + 40, player.y - 30, pick(STR.hype), C.yellow); }
    }
    if (overlap(ph, o.hitbox(geom))) {
      if (player.invuln > 0) {
        o.dead = true; stats.smash();
        particles.burst(o.x, geom.laneY[o.lane], o.color, 18, 320);
        audio.sfxSmash(); shake = Math.max(shake, 8);
      } else { die(); return; }
    }
  }
  // бусты
  for (const b of boosts) {
    if (b.dead) continue;
    if (overlap(ph, b.hitbox(geom))) {
      b.dead = true;
      player.invuln = CONFIG.BOOST_DURATION;
      flash = Math.max(flash, 0.7);
      audio.sfxBoost(); haptic('medium');
      particles.burst(b.x, geom.laneY[b.lane], C.cyan, 24, 380);
      particles.popText(geom.playerX + 40, player.y - 40, 'VPN BOOST!', C.cyan);
    }
  }
  obstacles = obstacles.filter((o) => !o.dead);
  boosts = boosts.filter((b) => !b.dead);
}

// --- Кадр -------------------------------------------------------------------
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  const geom = geometry(view.W, view.H);

  let simDt = dt;
  if (state === 'dying') { simDt = dt * 0.25; dyingTimer -= dt; if (dyingTimer <= 0) finishGameOver(); }

  // --- update ---
  const speed = currentSpeed();
  if (state === 'play' || state === 'dying') {
    world.update(simDt, speed);
    stats.addDistance(speed, simDt);
    player.update(simDt, geom, particles, player.invuln > 0);

    if (state === 'play') {
      spawnTimer -= simDt;
      if (spawnTimer <= 0) {
        doSpawn(geom);
        spawnTimer = Math.max(CONFIG.SPAWN_GAP_MIN, CONFIG.SPAWN_GAP_START - stats.distance * CONFIG.SPAWN_GAP_DECAY);
      }
    }
    for (const o of obstacles) o.update(simDt, speed);
    for (const b of boosts) b.update(simDt, speed);
    if (state === 'play') handleCollisions(geom);
  } else {
    world.update(dt * 0.3, 120); // лёгкое движение фона в меню
  }
  particles.update(dt);
  shake = Math.max(0, shake - dt * 40);
  flash = Math.max(0, flash - dt * 2.2);

  // --- draw ---
  ctx.save();
  if (shake > 0.2) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  world.draw(ctx, geom.W, geom.H);
  const t = now / 1000;
  for (const b of boosts) b.draw(ctx, geom, t);
  for (const o of obstacles) o.draw(ctx, geom, t);
  if (state !== 'menu') player.draw(ctx, geom, player.invuln > 0, t);
  particles.draw(ctx);
  ctx.restore();

  // пост-эффекты
  if (player.invuln > 0) { // туннель-винетка буста
    ctx.save(); ctx.globalAlpha = 0.12 + Math.sin(t * 20) * 0.05;
    ctx.fillStyle = C.cyan; ctx.fillRect(0, 0, geom.W, geom.H); ctx.restore();
  }
  if (flash > 0) { ctx.save(); ctx.globalAlpha = clamp(flash, 0, 1) * 0.6; ctx.fillStyle = state === 'dying' ? C.danger : C.cyan; ctx.fillRect(0, 0, geom.W, geom.H); ctx.restore(); }
  scanlines(ctx, geom.W, geom.H);

  // HUD
  if (state === 'play' || state === 'dying') UI.updateHud(stats, player.invuln > 0 ? player.invuln / CONFIG.BOOST_DURATION : 0);

  requestAnimationFrame(frame);
}

// --- Ввод -------------------------------------------------------------------
initInput(canvas, {
  onUp: () => { if (state === 'play') { player.up(); audio.sfxLane(); haptic('light'); } },
  onDown: () => { if (state === 'play') { player.down(); audio.sfxLane(); haptic('light'); } },
  onAny: () => audio.ensure(),
});

// --- Шеринг -----------------------------------------------------------------
async function shareRun() {
  audio.ensure();
  const text = STR.shareText(stats.distInt, stats.scoreInt) + CONFIG.GAME_URL;
  try {
    const blob = lastCard ? await cardToBlob(lastCard) : null;
    if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], 'uboost.png', { type: 'image/png' })] })) {
      await navigator.share({ files: [new File([blob], 'uboost.png', { type: 'image/png' })], text });
      return;
    }
  } catch {}
  // Telegram
  if (tg?.openTelegramLink) {
    tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(CONFIG.GAME_URL) + '&text=' + encodeURIComponent(text));
    return;
  }
  if (tg?.switchInlineQuery) { try { tg.switchInlineQuery(text, ['users', 'groups']); return; } catch {} }
  // веб-фолбэк: скачать карточку + скопировать ссылку
  if (lastCard) { const a = document.createElement('a'); a.href = lastCard.toDataURL('image/png'); a.download = 'uboost-runner.png'; a.click(); }
  try { await navigator.clipboard.writeText(text); } catch {}
}

function openStore() {
  if (tg?.openLink) tg.openLink(CONFIG.STORE_URL); else window.open(CONFIG.STORE_URL, '_blank');
}

// --- Mute -------------------------------------------------------------------
function refreshMute() { UI.dom.btnMute.textContent = audio.enabled ? STR.muteOn : STR.muteOff; }
function toggleMute() { audio.ensure(); audio.setEnabled(!audio.enabled); saveFlag('muted', !audio.enabled); refreshMute(); }

// --- Пауза на blur ----------------------------------------------------------
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
