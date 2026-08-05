// ЮБуст Раннер — бутстрап, игровой цикл, машина состояний, оркестрация.
import { CONFIG } from '../config.js';
import { setupCanvas, scanlines, clamp, drawRails, FONT } from './engine/render.js';
import { bloom, aberration, vignette, grain } from './engine/postfx.js';
import { Particles } from './engine/particles.js';
import { Quality } from './engine/quality.js';
import * as timescale from './engine/timescale.js';
import { initInput } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { loadAssets } from './engine/assets.js';
import { World, geometry, zoneIndexAt } from './game/world.js';
import { Player } from './game/player.js';
import { Obstacle, nextSafeLane, pickObstacleType } from './game/obstacles.js';
import { DataBit, Heart } from './game/collectibles.js';
import { Boost, Magnet, X2 } from './game/boosts.js';
import { isBoosting, speedWithBoost, canSmash } from './game/powerstate.js';
import { Billboards } from './game/billboards.js';
import { SideProps } from './game/sideprops.js';
import { Stats } from './game/stats.js';
import { Progress, rollMissions, checkMissions } from './game/progress.js';
import { Settings, loadFlag, saveFlag } from './game/settings.js';
import { CaptchaGame } from './game/captcha.js';
import { Tutorial } from './game/tutorial.js';
import { EventManager } from './game/events.js';
import { renderShareCard, cardToBlob } from './game/sharecard.js';
import { buildChallengeShare } from './game/sharetext.js';
import { Analytics } from './engine/analytics.js';
import { DashboardStore, dashboardAnalytics, loadGlobalDashboard } from './game/dashboard.js';
import { Leaderboard } from './game/leaderboard.js';
import { startCopyVariant } from './game/experiments.js';
import { telegramIdentity } from './game/telegram-identity.js';
import { STR, pick } from './ui/strings.js';
import * as UI from './ui/screens.js';

// Telegram SDK грузится независимо от HTML-парсера. Если telegram.org
// недоступен, через короткий таймаут продолжаем как обычная браузерная игра.
if (window.__uboostTelegramReady) {
  try { await window.__uboostTelegramReady; } catch {}
}

const C = CONFIG.COLORS;
const FX = CONFIG.FX;
const canvas = document.getElementById('gameCanvas');
const startVideo = document.querySelector?.('.start-bg-video');

// --- Графика: лёгкий режим ---------------------------------------------------
// Включается тумблером «Графика» в настройках или deep-link'ом из бота
// (?lite=1 / start_param "lite" у кнопки «Играть в лёгком режиме»). Deep-link —
// такое же явное действие игрока, как тумблер, поэтому запоминаем его в
// настройках: иначе после /lite режим терялся бы на следующем заходе.
// Режим влияет ТОЛЬКО на косметику (DPR, частицы, пост-эффекты, видео меню) —
// скорость, спавн, хитбоксы и очки не зависят от него ни в одном месте.
function readLiteDeepLink() {
  try {
    if (new URLSearchParams(window.location.search).get('lite') === '1') return true;
    return window.Telegram?.WebApp?.initDataUnsafe?.start_param === 'lite';
  } catch { return false; }
}
if (readLiteDeepLink() && !Settings.liteGraphics()) Settings.set('graphics', 'lite');
const liteGraphics = Settings.liteGraphics();

// Фоновое видео — украшение, а не цена входа. В data saver/2G остаётся лёгкий
// poster, чтобы не тратить мобильный трафик и не задерживать первый запуск;
// в лёгком режиме — чтобы не декодировать видео на слабом GPU.
const net = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
if (!liteGraphics && !net?.saveData && !/^(slow-)?2g$/.test(net?.effectiveType || '')) {
  const playStartVideo = () => { if (state === 'menu') startVideo?.play?.().catch(() => {}); };
  if (globalThis.requestIdleCallback) globalThis.requestIdleCallback(playStartVideo, { timeout: 800 });
  else setTimeout(playStartVideo, 250);
}
const mobileLike = window.matchMedia?.('(pointer: coarse), (max-width: 760px)')?.matches ?? false;
const startTier = mobileLike ? Math.min(CONFIG.QUALITY.START_TIER, 1) : CONFIG.QUALITY.START_TIER;
// startTier остаётся «авто»-тиром даже в lite: он же служит точкой возврата,
// когда игрок выключает лёгкий режим (Quality.setMode('auto')).
const quality = new Quality(startTier, liteGraphics ? 'lite' : 'auto');
const { ctx, ...view } = setupCanvas(canvas, quality.s.dpr);

// Растровые ассеты необязательны: если манифест/PNG не загрузятся, объекты
// останутся на процедурном рендере через getSprite() -> null.
loadAssets();

// Прогрев фирменного шрифта для canvas: ctx.font не триггерит загрузку шрифта сам,
// поэтому первые кадры рисовались бы фоллбэком. Грузим ходовые веса заранее
// (не блокируя старт — fire-and-forget). Кириллический фоллбэк страхует до загрузки.
try {
  document.fonts?.load('700 16px "Open Runde"');
  document.fonts?.load('500 16px "Open Runde"');
} catch {}

// --- Telegram ---------------------------------------------------------------
const tg = window.Telegram?.WebApp;
const isTelegramWebApp = Boolean(tg?.initData || tg?.initDataUnsafe?.user);
const prizeIdentity = telegramIdentity(tg);
if (tg && isTelegramWebApp) {
  try {
    tg.expand();
    tg.ready();
    // Свайп вниз по умолчанию сворачивает мини-апп — а игра управляется свайпами.
    if (tg.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes?.();
    if (tg.isVersionAtLeast?.('6.1')) {
      tg.setHeaderColor?.('#000000');
      tg.setBackgroundColor?.('#000000');
    }
    // Изменение вьюпорта (клавиатура, разворот) не всегда триггерит window resize.
    tg.onEvent?.('viewportChanged', () => window.dispatchEvent(new Event('resize')));
  } catch {}
}
function haptic(kind) { try { tg?.HapticFeedback?.impactOccurred?.(kind); } catch {} }

const dashboard = new DashboardStore();
const leaderboard = new Leaderboard(CONFIG.LEADERBOARD_ENDPOINT, CONFIG.LEADERBOARD_LIMIT, prizeIdentity);
window.addEventListener('uboost:ruleset-mismatch', (event) => {
  const version = String(event?.detail || 'current');
  const key = `uboost_ruleset_reload_${version}`;
  try {
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      location.reload();
      return;
    }
  } catch {}
  if (UI.dom?.leaderboardStatus) {
    UI.dom.leaderboardStatus.textContent = 'Игра обновилась. Перезагрузи страницу перед новым забегом.';
    UI.dom.leaderboardStatus.classList.remove('hidden');
  }
});
Analytics.use(dashboardAnalytics(dashboard, CONFIG.ANALYTICS_ENDPOINT, prizeIdentity));
Analytics.setContext({
  platform: tg?.platform || 'web',
  tgVersion: tg?.version || '',
  viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
  qualityTier: quality.tier,
  graphics: Settings.get('graphics'),
  rulesetVersion: CONFIG.RULESET_VERSION,
});
window.addEventListener?.('resize', () => {
  Analytics.setContext({ viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}` });
});

// --- Системы ----------------------------------------------------------------
const world = new World();
const player = new Player();
const particles = new Particles();
// бюджет частиц следует за тиром качества (DPR уже подключён выше)
quality.onChange = (s) => {
  view.setDprCap(s.dpr);
  particles.setBudget(s);
  Analytics.setContext({ qualityTier: quality.tier });
  Analytics.qualityChanged({ tier: quality.tier });
};
particles.setBudget(quality.s);
// CloudStorage появился в Telegram WebApp 6.9. В обычном браузере объект SDK
// тоже существует, но вызов заглушек пишет ошибки в консоль и не хранит данные.
const cloudTg = isTelegramWebApp && tg?.isVersionAtLeast?.('6.9') ? tg : null;
const stats = new Stats(cloudTg);
stats.syncBestFromCloud((best) => UI.showBestOnStart(best));
const progress = new Progress(cloudTg);
progress.syncFromCloud(() => UI.showRank(STR.ranks[progress.data.rankId]));
const audio = new Audio(loadFlag('muted', !CONFIG.AUDIO_DEFAULT_ON) ? false : CONFIG.AUDIO_DEFAULT_ON);
const events = new EventManager();
const billboards = new Billboards();
const sideProps = new SideProps();
const tutorial = new Tutorial();
let lastTutorialStep = -1;
let globalDashboardOverview = null;

function boardState() {
  return {
    entries: leaderboard.entries.map((entry) => ({
      ...entry,
      you: entry.you || (!!entry.publicId && entry.publicId === leaderboard.publicId),
    })),
    mode: leaderboard.mode,
    period: leaderboard.period,
    board: leaderboard.board,
    me: leaderboard.me,
    name: leaderboard.name(),
    global: !!globalDashboardOverview,
  };
}

function renderDashboard() {
  UI.showDashboard(globalDashboardOverview || dashboard.overview(stats.best), boardState());
}

async function openDashboard(period = leaderboard.period, board = leaderboard.board) {
  renderDashboard();
  const [, overview] = await Promise.all([leaderboard.refresh(period, board), loadGlobalDashboard(CONFIG.DASHBOARD_ENDPOINT)]);
  globalDashboardOverview = overview;
  renderDashboard();
  refreshTgLink();
}

// --- Статус Telegram: игрок Mini App опознаётся сам, привязывать нечего --------
// Кода привязки и опроса «не привязался ли» больше нет: подписанный initData
// регистрирует игрока прямо на сдаче забега (/v1/scores).
let tgLinkShown = { enabled: false };
async function refreshTgLink() {
  const status = await leaderboard.linkStatus();
  tgLinkShown = {
    enabled: !!status?.enabled, linked: !!status?.linked,
    username: status?.username || '', bot: status?.bot || '',
  };
  UI.showTgLink(tgLinkShown);
}

// --- Тост обгона: пересёк чужой счёт с общей доски — празднуем ----------------
// Цели берутся из последнего снапшота общей доски на старте забега, чтобы
// сравнение шло с живыми соперниками, а не с абстрактным числом.
let overtakeTargets = [];
function armOvertakes() {
  // Только разовая доска: на суммарной entry.score — сумма за неделю, с ней
  // сравнивать счёт текущего забега бессмысленно.
  overtakeTargets = (leaderboard.mode === 'global' && leaderboard.board === 'best' ? leaderboard.entries : [])
    .filter((e) => !e.you && (!e.publicId || e.publicId !== leaderboard.publicId) && e.score > 0)
    .map((e) => ({ score: e.score, alias: e.alias }))
    .sort((a, b) => a.score - b.score);
}
function checkOvertakes() {
  while (overtakeTargets.length && stats.scoreInt > overtakeTargets[0].score) {
    const target = overtakeTargets.shift();
    particles.popText(player.x, player.y - player.size * 2.1, STR.overtake(target.alias), C.grid);
    haptic('light');
  }
}

let obstacles = [];
let boosts = [];
let pickups = [];            // спец-пикапы (Magnet/X2)
let databits = [];
let hearts = [];

// Горячий путь без мусора для GC: переиспользуемый буфер painter's-сортировки и
// общий in-place компактор «мёртвых». Раньше каждый кадр аллоцировались новый
// массив drawables и 5–8 массивов из .filter() — постоянный мусор → фризы при GC.
const drawables = [];
const byDepth = (a, b) => b.z - a.z;       // дальние (z→1) первыми
function compact(arr) {                     // swap-remove мёртвых, порядок сохранён
  let w = 0;
  for (let r = 0; r < arr.length; r++) { const o = arr[r]; if (!o.dead) arr[w++] = o; }
  arr.length = w;
}

let captchaGame = null;      // активная капча-мини-игра
let boostTimer = 0;          // только настоящий VPN pickup даёт гиперскорость/смэш
let x2Timer = 0;             // остаток действия удвоителя очков (с)
let magnetTimer = 0;         // остаток действия магнита (с)
let magnetPulled = 0;        // битов собрано под магнитом (каждые N — +1 комбо)
let currentZone = 0;         // индекс текущей визуальной зоны (для popText/аналитики)

let state = 'menu';          // menu | play | captcha | paused | dying | over
let pausedFrom = 'play';     // откуда ушли в паузу (play | captcha)
let pauseCountdown = 0;      // >0 — идёт отсчёт возобновления
let distSinceCol = 0;
let colCount = 0;
let heartColCount = 0;
const between = (min, max) => min + Math.random() * Math.max(0, max - min);
let boostSpawnCooldown = 0;
let pickupSpawnCooldown = 0;
let lastLaneChangeAt = -Infinity;
let nearMissColumns = new Set();
const corridor = { safeLane: 1 };
let shake = 0;
let flash = 0;
let fxFrame = 0;             // счётчик кадров для дрожащего оффсета зерна
let dyingTimer = 0;
let lastCard = null;
let lastRecord = false;
let sessionMissions = rollMissions();
let lastKiller = 'generic';
let runMetrics = null;
let last = performance.now();
let lastIdleRenderAt = -Infinity;
let lastHudAt = 0;
let lastBeatAt = 0;          // heartbeat-сессия: последняя живая отметка на сервер
let lastHudScore = -1;
let lastHudDist = -1;
let lastHudLives = -1;
let lastHudCombo = -1;
let lastHudBoostBucket = -1;
let lastHudMult = -1;
let lastMusicAt = 0;
let lastMusicMode = '';
let lastMusicSpeedBucket = -1;
let lastMusicCombo = -1;
let lastMusicBoosting = false;
let lastMusicZone = -1;

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
if (challengeScore > 0) Analytics.challengeOpened({ score: challengeScore });

// Новые ссылки несут анонимный publicId. Старый playerId временно принимаем
// для уже разосланных ссылок; сервер перед записью заменяет его на publicId.
function readChallengeRef() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref') || '';
    const valid = /^p_[a-zA-Z0-9_-]{20}$/.test(ref) || /^[a-zA-Z0-9:_-]{8,80}$/.test(ref);
    return valid && ref !== leaderboard.id && ref !== leaderboard.publicId ? ref : '';
  } catch { return ''; }
}
const challengeRef = readChallengeRef();

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
// Одна растущая кривая: линейный разгон до плато MAX_SPEED (≈1810 м ≈ 2.5 мин),
// после плато скорость продолжает медленно «доползать» (SPEED_CREEP).
// Честность коридора сохраняется: интервал колонн привязан к текущей скорости
// через REACT_TIME.
// Дистанция плато выводится из констант, а не задана отдельным числом: иначе
// при правке SPEED_GROWTH порог молча разъезжается с реальной кривой.
const SPEED_PLATEAU_DIST = ((CONFIG.MAX_SPEED - CONFIG.BASE_SPEED) / CONFIG.SPEED_GROWTH) * 100;
function baseSpeed() {
  let base = Math.min(CONFIG.MAX_SPEED, CONFIG.BASE_SPEED + (stats.distance / 100) * CONFIG.SPEED_GROWTH);
  // Creep отсчитывается от плато, а не от DIFF_DIST: на DIFF_DIST база ещё
  // растёт, и множитель разгонял бы её вторым слагаемым поверх первого.
  const over = stats.distance - SPEED_PLATEAU_DIST;
  if (over > 0) base *= 1 + Math.min(CONFIG.SPEED_CREEP_MAX, (over / CONFIG.SPEED_CREEP_STEP) * 0.01);
  const P = CONFIG.PROGRESSION;
  // первый (непройденный туториал) забег — чуть медленнее, пока игрок осваивается
  if (!Settings.get('tutorialDone') && stats.distance < P.FIRST_RUN_DIST) return base * P.FIRST_RUN_SPEED_MUL;
  return base;
}
function currentSpeed() { return speedWithBoost(baseSpeed(), boostTimer); }
function speedFrac(s) { return clamp((s - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED), 0, 1.4); }
function diffNow() {
  const base = clamp(stats.distance / CONFIG.DIFF_DIST, 0, 1);
  const wave = Math.sin((stats.distance / CONFIG.WAVE_PERIOD) * Math.PI * 2);
  return clamp(base * (1 + wave * CONFIG.WAVE_AMPLITUDE), 0, 1);
}

// --- Старт/рестарт ----------------------------------------------------------
function startGame() {
  // Стартовое видео скрывается вместе с меню, но браузер может продолжать его
  // декодировать. Явно останавливаем, чтобы не отнимать CPU/GPU у Canvas.
  startVideo?.pause?.();
  audio.ensure(); audio.startMusic();
  stats.reset(); player.reset();
  obstacles = []; boosts = []; pickups = []; databits = []; hearts = []; particles.clear();
  billboards.clear();
  sideProps.clear();
  captchaGame = null;
  boostTimer = 0; x2Timer = 0; magnetTimer = 0; currentZone = 0;
  distSinceCol = 0; colCount = 0; heartColCount = 0;
  boostSpawnCooldown = between(CONFIG.BOOST_FIRST_MIN, CONFIG.BOOST_FIRST_MAX);
  pickupSpawnCooldown = between(CONFIG.PICKUP_FIRST_MIN, CONFIG.PICKUP_FIRST_MAX);
  lastLaneChangeAt = -Infinity;
  nearMissColumns = new Set();
  corridor.safeLane = 1;
  shake = 0; flash = 0;
  timescale.reset();
  lastComboCelebrated = 0;
  comboBurst = null;
  mascotCd = 0; idleChatter = 0; idleNext = 9; hackSpoke = false;
  player.mood = 'normal';
  lastKiller = 'generic';
  leaderboard.armToken();   // анти-чит токен (фолбэк, если сессия не завелась)
  leaderboard.startRun();   // heartbeat-сессия: сервер наблюдает забег вживую
  Analytics.setContext({ runId: leaderboard.runId, rulesetVersion: CONFIG.RULESET_VERSION });
  runMetrics = {
    startedAt: performance.now(), frames: 0, frameMs: 0, maxFrameMs: 0, spikes: 0,
    qualityStart: quality.tier, boostMs: 0, x2Ms: 0, magnetMs: 0,
    boosts: 0, x2: 0, magnets: 0,
  };
  lastBeatAt = performance.now();
  armOvertakes();
  state = 'play';
  audio.setMusicState({ mode: 'play', speed: CONFIG.BASE_SPEED, combo: 0, boosting: false, zone: 0 });
  tutorial.start();
  lastTutorialStep = -1;
  UI.showMissionPreview(sessionMissions[0]);
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
function die(killerColor = C.danger, killer = 'generic') {
  state = 'dying'; dyingTimer = 0.7;
  lastKiller = killer;
  UI.hideTutorial();
  shake = 22; flash = 1;
  audio.setMusicState({ mode: 'dying' });
  audio.sfxDeath(); haptic('heavy');
  player.mood = 'danger';
  particles.burst(player.x, player.y, killerColor, 26, 360);
  particles.burst(player.x, player.y, C.danger, 14, 280);
  // 3-4 тлеющих обломка — «остаточная» деталь после смэша
  for (let i = 0; i < 4; i++) particles.ember(player.x, player.y, killerColor);
  player.invuln = 0;
  boostTimer = 0;
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
  // Вызов принят, но не побит — отдельный текст вместо обычного death-текста,
  // иначе игрок теряет контекст, что он вообще отвечал на конкретный вызов.
  const challengeMissed = challengeScore > 0 && !challengeBeat;
  // near-miss рычаг: «до следующего звания осталось N очков» мотивирует
  // переиграть сильнее, чем абстрактное звание без числа.
  const nextRankIdx = meta.rankId + 1;
  const nextRankName = nextRankIdx < CONFIG.RANKS.length ? STR.ranks[nextRankIdx] : null;
  const nextRankGap = nextRankName ? Math.max(0, CONFIG.RANKS[nextRankIdx] - stats.scoreInt) : 0;
  UI.showGameOver(stats, lastRecord, lastCard, challengeBeat, {
    missions: sessionMissions, missionsDone, bonus,
    rankId: meta.rankId, rankUp: meta.rankUp, newBadges: meta.newBadges, killer: lastKiller,
    challengeMissed, challengeScore, nextRankName, nextRankGap,
  });
  Analytics.gameOver({
    score: stats.scoreInt, distance: stats.distInt, lives: stats.lives,
    captchas: stats.captchas, geoblocks: stats.geoblocks, ads: stats.ads, lags: stats.lags,
  });
  if (runMetrics) {
    const durationMs = Math.max(1, performance.now() - runMetrics.startedAt);
    Analytics.runSummary({
      durationMs: Math.round(durationMs), score: stats.scoreInt, distance: stats.distInt,
      killer: lastKiller, bestCombo: stats.bestCombo, nearMisses: stats.nearMisses,
      smashes: stats.smashes, bits: stats.bits, captchas: stats.captchas,
      boosts: runMetrics.boosts, x2: runMetrics.x2, magnets: runMetrics.magnets,
      boostUptime: Math.round((runMetrics.boostMs / durationMs) * 100),
      x2Uptime: Math.round((runMetrics.x2Ms / durationMs) * 100),
      magnetUptime: Math.round((runMetrics.magnetMs / durationMs) * 100),
      frameAvgMs: runMetrics.frames ? Math.round((runMetrics.frameMs / runMetrics.frames) * 10) / 10 : 0,
      frameMaxMs: Math.round(runMetrics.maxFrameMs), frameSpikes: runMetrics.spikes,
      qualityStart: runMetrics.qualityStart, qualityEnd: quality.tier,
      graphics: Settings.get('graphics'),
    });
    runMetrics = null;
  }
  // Сохранение локального результата мгновенно; сеть работает в фоне и никак
  // не задерживает game-over или следующий забег.
  leaderboard.submit({ score: stats.scoreInt, distance: stats.distInt }).then((result) => {
    if (state !== 'over') return;
    // Серверный результат должен быть виден сразу после забега: раньше блок
    // существовал в DOM, но showOverBoard() нигде не вызывался.
    UI.showOverBoard(result);
    // Место в рейтинге приходит с сервера — перерисовываем шер-карточку с ним.
    if (result?.me?.rank) {
      lastCard = renderShareCard(stats, lastRecord, progress.data, result.me.rank);
      lastCard.style.width = '100%';
      lastCard.style.borderRadius = '12px';
      UI.dom.cardPreview.innerHTML = '';
      UI.dom.cardPreview.appendChild(lastCard);
    }
    if (!UI.dom.dashboardScreen.classList.contains('hidden')) renderDashboard();
  });
  for (const id of missionsDone) Analytics.missionDone({ id });
  for (const id of meta.newBadges) Analytics.badgeUnlock({ id });
  if (meta.rankUp) Analytics.rankUp({ rankId: meta.rankId });
  sessionMissions = rollMissions();
  UI.showMissionPreview(sessionMissions[0]);
}

// --- Спавн «коридора» -------------------------------------------------------
function spawnColumn(geom, colSpacing) {
  const nextSafe = nextSafeLane(corridor.safeLane);

  const others = [];
  for (let l = 0; l < CONFIG.LANES; l++) if (l !== nextSafe) others.push(l);
  const diff = diffNow();
  const block2Prob = clamp(CONFIG.BLOCK2_BASE + (CONFIG.BLOCK2_MAX - CONFIG.BLOCK2_BASE) * diff, 0, 0.92);
  const block2 = stats.distance >= CONFIG.PROGRESSION.BLOCK2_MIN_DIST && Math.random() < block2Prob;
  const blockLanes = block2 ? others : [pick(others)];

  // препятствия рождаются у горизонта (z=1) и налетают на игрока
  for (const lane of blockLanes) {
    const o = new Obstacle(lane, pickObstacleType(stats.distance));
    o.size(geom); o.z = 1.0;
    o.columnId = colCount;
    o.warned = block2; // двойной блок — телеграфируем заранее (визуал + sfxWarn)
    obstacles.push(o);
  }

  // поток данных по безопасной полосе — цепочкой из глубины (z ≥ 1)
  for (let i = 0; i < CONFIG.BITS_PER_COL; i++) {
    const bz = 1.0 + (i + 0.5) * 0.055;
    databits.push(new DataBit(nextSafe, bz, geom));
  }

  // Риск-биты: изредка цепочка удвоенных (золотых) битов на ОПАСНОЙ полосе,
  // глубже препятствия — собрать можно только нырнув с безопасного коридора
  // МЕЖДУ колоннами. Честность не трогаем: биты опциональны.
  if (CONFIG.BITS_RISK_EVERY > 0 && colCount > 0 && colCount % CONFIG.BITS_RISK_EVERY === 0 && blockLanes.length) {
    const riskLane = pick(blockLanes);
    for (let i = 0; i < 3; i++) {
      databits.push(new DataBit(riskLane, 1.35 + (i + 0.5) * 0.05, geom, CONFIG.BITS_RISK_MULT));
    }
  }

  colCount++;
  heartColCount++;

  // VPN-буст (чуть глубже колонны — прилетает следом)
  let spawnedSpecial = false;
  if (boostSpawnCooldown <= 0) {
    boostSpawnCooldown = between(CONFIG.BOOST_INTERVAL_MIN, CONFIG.BOOST_INTERVAL_MAX);
    if (Math.random() < CONFIG.BOOST_CHANCE) {
      boosts.push(new Boost(nextSafe, 1.16, geom));
      pickupSpawnCooldown = Math.max(pickupSpawnCooldown, CONFIG.PICKUP_AFTER_BOOST_DELAY);
      spawnedSpecial = true;
    }
  }
  // спец-пикап (Magnet/X2) — взаимоисключающе с бустом, тоже на безопасной
  // полосе. Выбор контекстный: магнит ценен при обилии битов, иначе чаще X2.
  if (!spawnedSpecial && pickupSpawnCooldown <= 0) {
    pickupSpawnCooldown = between(CONFIG.PICKUP_INTERVAL_MIN, CONFIG.PICKUP_INTERVAL_MAX);
    if (Math.random() < CONFIG.PICKUP_CHANCE) {
      const magnetProb = databits.length >= CONFIG.MAGNET_BIAS_BITS ? CONFIG.MAGNET_PROB_RICH : CONFIG.MAGNET_PROB_POOR;
      pickups.push(Math.random() < magnetProb ? new Magnet(nextSafe, 1.16, geom) : new X2(nextSafe, 1.16, geom));
    }
  }
  // пикап-сердце (только если жизней меньше максимума) — в раннем окне (мало
  // жизней, малая дистанция) сердца выпадают чаще, чтобы новичок стартующий
  // с 1 жизнью не гиб нечестно быстро до первого шер-момента.
  const P = CONFIG.PROGRESSION;
  let heartEvery = CONFIG.HEART_EVERY;
  if (stats.distance < P.EARLY_HEART_DIST && stats.lives < 2) heartEvery *= P.EARLY_HEART_MUL;
  heartEvery = Math.max(4, Math.round(heartEvery));
  if (heartColCount >= heartEvery && Math.random() < CONFIG.HEART_CHANCE && stats.lives < CONFIG.MAX_LIVES) {
    hearts.push(new Heart(nextSafe, 1.1, geom));
    heartColCount = 0;
  }

  corridor.safeLane = nextSafe;
}

// --- Коллизии (в пространстве полоса/глубина) -------------------------------
function enterCaptcha(geom) {
  state = 'captcha';
  audio.ensure();
  audio.setMusicState({ mode: 'captcha', speed: currentSpeed(), combo: stats.combo, zone: currentZone });
  audio.sfxCaptcha();
  // Щадящий режим первых капч профиля: больше времени, без «наоборот»,
  // с прощением одного неверного тапа — первая капча не должна быть рулеткой.
  const novice = progress.data.captchaSeen < CONFIG.CAPTCHA_NOVICE_COUNT;
  progress.data.captchaSeen++;
  progress.save();
  captchaGame = new CaptchaGame(geom.W, geom.H, novice ? CONFIG.CAPTCHA_NOVICE_TIME_MUL : 1, novice);
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
      const recentMove = performance.now() - lastLaneChangeAt <= CONFIG.NEARMISS_WINDOW_MS;
      if (recentMove && laneClose(o.laneNorm, 1.1) && !nearMissColumns.has(o.columnId)) {
        nearMissColumns.add(o.columnId);
        stats.nearMiss();
        player.mood = 'danger';
        particles.popText(player.x + 40, player.y - 30, pick(STR.hype), C.white);
        mascotSay('nearMiss');
        juiceSlowMo(CONFIG.JUICE.NEARMISS_SLOWMO, CONFIG.JUICE.NEARMISS_DURATION);
      }
    }
    if (zHit(o.z) && laneClose(o.laneNorm)) {
      const p = geom.project(o.laneNorm, o.z);
      if (canSmash(boostTimer)) {
        o.dead = true; stats.smash();
        particles.burst(p.x, p.y, o.color, 18, 320);
        particles.ring(p.x, p.y, o.color, 8, 80, 0.5);
        particles.flashGlow(p.x, p.y, o.color, 70, 0.35);
        audio.sfxSmash(); shake = Math.max(shake, 8);
        juiceHitStop(CONFIG.JUICE.SMASH_FREEZE);
      } else if (player.invuln > 0) {
        // Защита после удара/капчи не является атакой: препятствие просто
        // проходит сквозь мигающего игрока без очков, смэша и ускорения.
        o.dead = true;
      } else if (o.isCaptcha && !o.triggered) {
        o.triggered = true;
        enterCaptcha(geom);
        return;
      } else if (CONFIG.LIVES_ABSORB_ALL && stats.lives > 0) {
        o.dead = true;
        stats.loseLife();
        stats.resetCombo();   // удар обрывает near-miss комбо
        player.invuln = CONFIG.CAPTCHA_FAIL_INVULN;
        player.mood = 'danger';
        flash = 0.5; shake = 10;
        audio.sfxHit(); haptic('heavy');
        particles.popText(player.x, player.y - 40, '−♥', C.red);
        mascotSay('loseLife');
        juiceHitStop(CONFIG.JUICE.LOSELIFE_FREEZE);
      } else {
        die(o.color, o.type); return;
      }
    }
  }

  // биты данных
  for (const d of databits) {
    if (d.dead) continue;
    if (zHit(d.z) && laneClose(d.laneNorm)) {
      d.dead = true; stats.collectBit(d.mult);
      tutorial.onCollect();
      audio.sfxBit();
      const p = geom.project(d.laneNorm, d.z);
      const col = d.mult > 1 ? C.gold : C.data;
      particles.burst(p.x, p.y, col, d.mult > 1 ? 9 : 5, 130);
      particles.flashGlow(p.x, p.y, col, 34, 0.25);
      if (d.mult > 1) particles.popText(p.x, p.y - 26, '×' + d.mult, C.gold);
      // Магнит питает комбо: каждые N подтянутых битов — +1 (ограничено темпом
      // спавна битов, а popText показывает, что магнит «работает на серию»).
      if (magnetTimer > 0) {
        magnetPulled++;
        if (magnetPulled % CONFIG.MAGNET_COMBO_EVERY === 0) {
          stats._bumpCombo();
          particles.popText(p.x, p.y - 46, '+КОМБО', C.grid);
        }
      }
    }
  }

  // бусты
  for (const b of boosts) {
    if (b.dead) continue;
    if (zHit(b.z) && laneClose(b.laneNorm)) {
      b.dead = true;
      boostTimer = CONFIG.BOOST_DURATION;
      if (runMetrics) runMetrics.boosts++;
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
        if (runMetrics) runMetrics.x2++;
        stats.scoreMult = CONFIG.X2_MULT;
        particles.burst(p.x, p.y, C.gold, 18, 300);
        particles.ring(p.x, p.y, C.gold, 8, 100, 0.5);
        particles.flashGlow(p.x, p.y, C.gold, 80, 0.45);
        particles.popText(player.x + 40, player.y - 40, STR.pickupX2, C.gold);
      } else {
        magnetTimer = CONFIG.MAGNET_DURATION;
        if (runMetrics) runMetrics.magnets++;
        magnetPulled = 0;
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

  compact(obstacles); compact(boosts); compact(pickups); compact(databits); compact(hearts);
}

// --- Проверка комбо-вех ------------------------------------------------------
function checkComboCelebration() {
  const c = stats.combo;
  const milestone = COMBO_MILESTONES.find((m) => c >= m && m > lastComboCelebrated);
  if (milestone) {
    lastComboCelebrated = milestone;
    comboBurst = { milestone, age: 0, duration: 0.75 };
    flash = Math.max(flash, 0.4);
    particles.burst(view.W / 2, view.H / 2, C.red, 18, 320);
    particles.burst(view.W / 2, view.H / 2, C.gold, 10, 260);
    audio.sfxCombo(milestone);
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

  // Процедурная вспышка вехи: расходящиеся неон-кольца в фирменных красном/белом.
  // (Раньше тут был getSprite('gags/combo_burst'), но растровые ассеты отключены —
  // путь всегда возвращал null, и веха жила только строкой popText.)
  const cx = W / 2, cy = H / 2;
  const ease = Math.sin(p * Math.PI);            // 0→1→0 — пульс вспышки
  const baseR = Math.min(W, H) * (0.08 + p * 0.34);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = ease;
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i % 2 ? C.white : C.red;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3 * (1 - p);
    ctx.beginPath();
    ctx.arc(cx, cy, baseR + i * Math.min(W, H) * 0.05, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Число вехи — крупно, с пружинным «выстрелом» масштаба в первой трети.
  const pop = p < 0.3 ? p / 0.3 : 1 - ((p - 0.3) / 0.7) * 0.25;
  ctx.globalAlpha = Math.min(1, ease * 1.3);
  ctx.font = `900 ${Math.max(12, Math.round(Math.min(W, H) * 0.15 * pop))}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = C.red; ctx.shadowBlur = 26;
  ctx.fillStyle = C.white;
  ctx.fillText('×' + comboBurst.milestone, cx, cy);
  ctx.restore();
}

// --- Кадр -------------------------------------------------------------------
function frame(now) {
  const dtMs = now - last;
  let dt = Math.min(dtMs / 1000, 0.05);
  last = now;
  // Меню и финальный экран не требуют 60 полных Canvas-кадров: 30 fps сохраняют
  // живой фон и вдвое снижают нагрузку/расход батареи под UI-панелью.
  if ((state === 'menu' || state === 'over') && now - lastIdleRenderAt < 33) {
    requestAnimationFrame(frame);
    return;
  }
  if (state === 'menu' || state === 'over') lastIdleRenderAt = now;
  quality.sample(dtMs);           // адаптация качества по реальному времени кадра
  if (runMetrics && state !== 'menu' && state !== 'over') {
    runMetrics.frames++;
    runMetrics.frameMs += Math.min(dtMs, 1000);
    runMetrics.maxFrameMs = Math.max(runMetrics.maxFrameMs, dtMs);
    if (dtMs > CONFIG.QUALITY.SPIKE_MS) runMetrics.spikes++;
  }
  const geom = geometry(view.W, view.H);

  const rawSpeed = currentSpeed();
  const gagMul = events.speedMul();
  const speed = rawSpeed * gagMul;
  const musicSpeedBucket = Math.round(speed / 40);
  const musicBoosting = isBoosting(boostTimer);
  if (now - lastMusicAt >= 100 ||
      state !== lastMusicMode ||
      musicSpeedBucket !== lastMusicSpeedBucket ||
      stats.combo !== lastMusicCombo ||
      musicBoosting !== lastMusicBoosting ||
      currentZone !== lastMusicZone) {
    audio.setMusicState({ mode: state, speed, combo: stats.combo, boosting: musicBoosting, zone: currentZone });
    lastMusicAt = now;
    lastMusicMode = state;
    lastMusicSpeedBucket = musicSpeedBucket;
    lastMusicCombo = stats.combo;
    lastMusicBoosting = musicBoosting;
    lastMusicZone = currentZone;
  }

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
        player.mood = 'normal';
        audio.sfxCaptchaSolve();
        flash = 0.6;
        particles.burst(player.x, player.y, C.white, 16, 260);
        particles.popText(player.x, player.y - 50, pick(STR.captchaSolve), C.white);
        mascotSay('captchaSolve', true);
        haptic('medium');
      } else {
        // провал: теряем жизнь
        const alive = stats.loseLife();
        stats.resetCombo();   // провал капчи обрывает near-miss комбо
        player.mood = 'danger';
        flash = 0.5; shake = 14;
        audio.sfxHit(); haptic('heavy');
        particles.popText(player.x, player.y - 50, pick(STR.captchaFail), C.red);
        if (!alive) { captchaGame = null; die(C.danger, 'captcha'); return requestAnimationFrame(frame); }
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
    sideProps.update(simDt, speed, state === 'play');
    stats.addDistance(speed, simDt);
    player.update(simDt, geom, particles, isBoosting(boostTimer), speedFrac(speed));

    // плавное возвращение настроения к normal
    if (player.mood !== 'boost' && player.mood !== 'captcha') {
      if (player.invuln <= 0) player.mood = 'normal';
    }
    if (player.invuln <= 0 && player.mood === 'boost') player.mood = 'normal';

    if (state === 'play') {
      // таймеры VPN-буста и спец-пикапов
      boostSpawnCooldown -= simDt;
      pickupSpawnCooldown -= simDt;
      if (boostTimer > 0) {
        if (runMetrics) runMetrics.boostMs += simDt * 1000;
        boostTimer -= simDt;
        if (boostTimer <= 0) { boostTimer = 0; if (player.mood === 'boost') player.mood = 'normal'; }
      }
      if (x2Timer > 0) {
        if (runMetrics) runMetrics.x2Ms += simDt * 1000;
        x2Timer -= simDt; if (x2Timer <= 0) { x2Timer = 0; stats.scoreMult = 1; }
      }
      if (magnetTimer > 0) {
        if (runMetrics) runMetrics.magnetMs += simDt * 1000;
        magnetTimer -= simDt; if (magnetTimer <= 0) magnetTimer = 0;
      }

      // Вход в новую зону — событие, а не смена обоев: ударная волна цветом
      // новой палитры + короткий flash. Главный крючок «долети до следующей
      // зоны» должен ощущаться как достижение.
      const zone = zoneIndexAt(stats.distance);
      if (zone > currentZone) {
        currentZone = zone;
        particles.popText(view.W / 2, view.H * 0.3, STR.zoneEnter(STR.zones[zone]), world.pal.grid);
        particles.ring(view.W / 2, view.H * 0.42, world.pal.grid, 24, Math.max(view.W, view.H) * 0.55, 0.7);
        particles.ring(view.W / 2, view.H * 0.42, C.white, 12, Math.max(view.W, view.H) * 0.35, 0.5);
        flash = Math.max(flash, 0.3);
        shake = Math.max(shake, 5);
        mascotSay('zone');
        audio.sfxZone(zone);
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
      const spawnedGag = events.trySpawn(stats.distance);
      if (spawnedGag) Analytics.gagShown(spawnedGag);
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
      compact(databits); compact(hearts); compact(pickups);
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
  world.draw(ctx, geom.W, geom.H, speed, quality.s.bgFx);
  drawRails(ctx, geom, world.railOff, world.pal.grid);

  // всё, что живёт в глубине, рисуем far→near (painter's), игрок — на своей глубине
  // (переиспользуем буфер drawables и общий компаратор — без аллокаций на кадр)
  drawables.length = 0;
  for (const d of databits) drawables.push(d);
  for (const h of hearts) drawables.push(h);
  for (const b of boosts) drawables.push(b);
  for (const pk of pickups) drawables.push(pk);
  for (const o of obstacles) drawables.push(o);
  for (const p of sideProps.items) drawables.push(p);
  for (const s of billboards.signs) drawables.push(s);
  drawables.sort(byDepth);

  let playerDrawn = state === 'menu';
  for (const it of drawables) {
    if (!playerDrawn && it.z < geom.playerZ) { player.draw(ctx, geom, isBoosting(boostTimer), t); playerDrawn = true; }
    it.draw(ctx, geom, t);
  }
  if (!playerDrawn) player.draw(ctx, geom, isBoosting(boostTimer), t);

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
  const gameplayPostFx = state === 'play' || state === 'dying' || state === 'captcha';
  if (gameplayPostFx && FX.BLOOM && q.bloom) bloom(ctx, canvas, { strength: FX.BLOOM_STRENGTH, blur: FX.BLOOM_BLUR, scale: q.bloomScale });
  if (gameplayPostFx && FX.ABERRATION && q.aberration && fx.grainOn) aberration(ctx, canvas, FX.ABERRATION);

  // пост-эффекты
  const frac = clamp((speed - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED), 0, 1);
  const boosting = isBoosting(boostTimer) && state !== 'captcha';
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
  if (state === 'play') checkOvertakes();
  // Живая отметка забега (~каждые 5с) — верификация результата сервером.
  // В паузе отметки продолжаются (счёт стоит — дельта нулевая, это валидно),
  // иначе долгая пауза уронила бы ожидаемое число отметок и verified-статус.
  if ((state === 'play' || state === 'captcha' || state === 'paused') && now - lastBeatAt > 5000) {
    leaderboard.beat(stats.scoreInt, stats.distInt);
    lastBeatAt = now;
  }
  if (state === 'play' || state === 'dying' || state === 'captcha') {
    const boostFrac = boosting ? boostTimer / CONFIG.BOOST_DURATION : 0;
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
function moveLane(direction) {
  const before = player.lane;
  if (direction < 0) player.left(); else player.right();
  if (player.lane !== before) lastLaneChangeAt = performance.now();
}

initInput(canvas, {
  onLeft: () => {
    if (state !== 'play') return;
    moveLane(events.controlsInverted() ? 1 : -1);
    tutorial.onSwipe();
    audio.sfxLane(); haptic('light');
  },
  onRight: () => {
    if (state !== 'play') return;
    moveLane(events.controlsInverted() ? -1 : 1);
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
      moveLane(left ? -1 : 1);
      tutorial.onSwipe();
      audio.sfxLane(); haptic('light');
    }
  },
  // первичное действие с клавиатуры (Space/Enter): закрыть рекламный гэг
  onAction: () => { if (state === 'play' && events.needsTap()) events.onTap(); },
  onAny: () => audio.ensure(),
}, () => Settings.swipePx());

// --- Шеринг -----------------------------------------------------------------
async function shareRun() {
  audio.ensure();
  Analytics.share({ score: stats.scoreInt, distance: stats.distInt });
  const payload = buildChallengeShare(stats.distInt, stats.scoreInt, leaderboard.publicId);
  try {
    const blob = lastCard ? await cardToBlob(lastCard) : null;
    if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], 'uboost.png', { type: 'image/png' })] })) {
      await navigator.share({ files: [new File([blob], 'uboost.png', { type: 'image/png' })], text: payload.text, url: payload.url });
      Analytics.shareResult({ method: 'web_share', ok: true });
      return;
    }
  } catch { Analytics.shareResult({ method: 'web_share', ok: false }); }
  if (tg?.openTelegramLink) {
    tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(payload.url) + '&text=' + encodeURIComponent(payload.text));
    Analytics.shareResult({ method: 'telegram_link', ok: true });
    return;
  }
  if (tg?.switchInlineQuery) {
    try {
      tg.switchInlineQuery(payload.fallbackText, ['users', 'groups']);
      Analytics.shareResult({ method: 'inline_query', ok: true });
      return;
    } catch {}
  }
  if (lastCard) { const a = document.createElement('a'); a.href = lastCard.toDataURL('image/png'); a.download = 'uboost-runner.png'; a.click(); }
  const ok = await copyText(payload.fallbackText);
  // Молчаливый фолбэк читается как «кнопка не работает»: картинка уезжает в
  // загрузки, и на экране не меняется ничего. Подтверждаем как остальные кнопки.
  if (ok) {
    UI.dom.btnShare.textContent = STR.copied;
    setTimeout(() => { UI.dom.btnShare.textContent = STR.share; }, 1600);
  }
  Analytics.shareResult({ method: 'download_clipboard', ok });
}

function openStore() {
  Analytics.ctaClick({ score: stats.scoreInt, distance: stats.distInt });
  // раньше всегда одна и та же UTM независимо от контекста клика — нельзя было
  // сравнить конверсию challenge-трафика (самого ценного) с обычным забегом
  const campaign = challengeScore > 0 ? 'challenge' : 'runner';
  const url = Analytics.storeUrl('game', 'cta', campaign);
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
const copyVariant = startCopyVariant();
UI.fillStaticCopy(copyVariant);
UI.showChallenge(challengeScore);
UI.showPrizeNotice(!!prizeIdentity);
UI.showRank(STR.ranks[progress.data.rankId]);
UI.showBestOnStart(stats.best);
UI.showMissionPreview(sessionMissions[0]);
UI.showStart();
// Стартовый экран отрисован — снимаем тёмный splash и сторожа белого экрана.
const bootSplash = document.getElementById('boot-splash');
if (bootSplash) bootSplash.remove();
window.__uboostBooted = true;
Analytics.landing(challengeRef ? { variant: copyVariant, ref: challengeRef } : { variant: copyVariant });
// Снапшот общей доски сразу: нужен целям обгона в первом же забеге.
leaderboard.refresh().catch(() => {});
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
UI.dom.btnDashboard.addEventListener('click', () => openDashboard());
UI.dom.btnStartBoard?.addEventListener('click', () => openDashboard());
UI.dom.btnDashboardClose.addEventListener('click', () => { UI.hideDashboard(); if (state === 'over') UI.dom.over.classList.remove('hidden'); });
UI.dom.btnLeaderboardRefresh.addEventListener('click', () => openDashboard());
UI.dom.btnLeaderboardMore?.addEventListener('click', UI.toggleLeaderboardExpanded);
UI.dom.boardTabWeek?.addEventListener('click', () => openDashboard('week', 'best'));
UI.dom.boardTabAll?.addEventListener('click', () => openDashboard('all', 'best'));
UI.dom.boardTabTotal?.addEventListener('click', () => openDashboard('week', 'total'));
UI.dom.btnOverBoard?.addEventListener('click', () => openDashboard());
UI.dom.btnRunDetails?.addEventListener('click', UI.toggleRunDetails);

// --- Имя на доске: сохраняется на blur/Enter, сервер узнаёт через /v1/alias ---
UI.dom.playerName?.addEventListener('keydown', (e) => { if (e.key === 'Enter') UI.dom.playerName.blur(); });
UI.dom.playerName?.addEventListener('change', async () => {
  await leaderboard.setName(UI.dom.playerName.value);
  UI.dom.playerName.value = leaderboard.name();
  UI.setNameStatus(STR.nameSaved);
  setTimeout(() => UI.setNameStatus(''), 1800);
  leaderboard.refresh().then(renderDashboard).catch(() => {});
});

// --- Копирование: надёжный путь на десктопе и без HTTPS ------------------------
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}
// Единая точка копирования для ВСЕХ кнопок. navigator.clipboard существует
// только в secure context, а прод пока на голом HTTP (isSecureContext=false),
// поэтому там navigator.clipboard === undefined и обращение к нему бросает.
// Без execCommand-фолбэка «скопировать» молча не срабатывает — а на этом
// держится вся виральная петля. Раньше фолбэк был у промокода и «вызова», но
// НЕ у главной кнопки шеринга: она скачивала картинку и теряла ссылку.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return legacyCopy(text); }
}
// --- Промокод: тап по коду = копирование + событие promo_copy -----------------
UI.setupPromo(CONFIG.PROMO);
UI.dom.promoCode?.addEventListener('click', async () => {
  const code = CONFIG.PROMO?.code || '';
  if (!code) return;
  const ok = await copyText(code);
  if (ok) {
    UI.dom.promoCode.textContent = STR.promoCopied;
    setTimeout(() => { UI.dom.promoCode.textContent = code; }, 1400);
  }
  Analytics.promoCopy({ code, ok });
});

UI.dom.btnPauseSettings.addEventListener('click', () => openSettings('pause'));
UI.dom.btnSettingsClose.addEventListener('click', closeSettings);
UI.dom.setSound.addEventListener('click', () => {
  toggleMute();
  Analytics.settingsChange({ key: 'sound', value: audio.enabled });
  UI.refreshSettingsUI(Settings, audio.enabled);
});
// Графика: АВТО ⇄ ЛЁГКАЯ. Тумблер рядом со звуком — самая частая жалоба
// «тормозит» лечится тут, не дожидаясь реакции адаптивного менеджера.
UI.dom.setGraphics?.addEventListener('click', () => {
  const next = Settings.get('graphics') === 'lite' ? 'auto' : 'lite';
  Settings.set('graphics', next);
  quality.setMode(next);          // onChange сам обновит DPR и бюджет частиц
  // Фоновое видео меню — самый дорогой кадр на слабом устройстве.
  if (next === 'lite') startVideo?.pause?.();
  else if (state === 'menu') startVideo?.play?.().catch(() => {});
  Analytics.setContext({ graphics: next });
  Analytics.settingsChange({ key: 'graphics', value: next });
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
