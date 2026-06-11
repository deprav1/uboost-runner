// Headless smoke-test: стабим DOM/Canvas/Audio/fetch, грузим игру, крутим кадры.
const gradient = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(_, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'canvas') return { width: 800, height: 600 };
      if (p === 'roundRect') return () => {};
      return () => {};
    },
    set() { return true; },
  });
}
function makeEl(tag = 'div') {
  const handlers = {};
  return {
    tag, _text: '', innerHTML: '', value: '',
    style: new Proxy({}, { get: () => '', set: () => true }),
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){f?this._s.add(c):this._s.delete(c);}, contains(c){return this._s.has(c);} },
    set textContent(v){this._text=v;}, get textContent(){return this._text;},
    addEventListener(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);}, _handlers: handlers,
    appendChild(){}, setAttribute(){}, getContext(){return makeCtx();},
    toBlob(cb){cb(new Blob());}, toDataURL(){return 'data:,';}, click(){},
    width:1080, height:1080,
  };
}

const els = {};
const docHandlers = {};
global.document = {
  getElementById: (id) => (els[id] = els[id] || makeEl('#'+id)),
  createElement: (t) => makeEl(t),
  addEventListener(ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
  _fire(ev) { docHandlers[ev]?.forEach((fn) => fn()); },
  hidden: false,
  documentElement: { style: { setProperty() {} } },
};
const rafCbs = [];
global.window = {
  innerWidth: 414, innerHeight: 896, devicePixelRatio: 2,
  addEventListener() {}, Telegram: undefined,
  AudioContext: undefined, webkitAudioContext: undefined,
};
global.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length; };
Object.defineProperty(global, 'navigator', { value: { share: undefined, canShare: undefined, clipboard: { writeText: async()=>{} } }, configurable: true });
global.localStorage = { _d:{}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=v;} };
global.Blob = class { constructor(){} };
global.File = class { constructor(){} };
// fetch стаб для assets.js
global.fetch = async () => ({ ok: false });
global.Image = class {
  set src(v) { setTimeout(() => this.onerror?.(), 0); }
};

// прогон
await import('../src/main.js');
console.log('✓ модули загрузились, обработчики навешаны');

// эмулируем старт
const start = els['btn-start'];
start._handlers.click?.forEach(fn => fn());
console.log('✓ startGame() без ошибок');

// крутим ~600 кадров
let tMs = 0;
function runFrames(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafCbs.shift();
    if (!cb) return i;
    tMs += 16;
    cb(tMs);
  }
  return n;
}
if (runFrames(600) < 600) console.log('кадры кончились раньше 600');
console.log('✓ 600 кадров отрисовано без исключений');

// --- тест паузы --------------------------------------------------------------
// рестартим игру (после 600 кадров могла закончиться), затем проверяем:
// сворачивание → мир заморожен; resume → отсчёт → мир снова движется.
els['btn-restart']._handlers.click?.forEach((fn) => fn());
runFrames(30);
const distA = els['dist-display']._text;
runFrames(60);
const distB = els['dist-display']._text;
if (distA === distB) { console.error('✗ дистанция не растёт в игре'); process.exit(1); }

global.document.hidden = true;
global.document._fire('visibilitychange');
runFrames(10);
const distC = els['dist-display']._text;
runFrames(120);
const distD = els['dist-display']._text;
if (distC !== distD) { console.error('✗ мир не заморожен в паузе:', distC, '→', distD); process.exit(1); }

global.document.hidden = false;
els['btn-resume']._handlers.click?.forEach((fn) => fn());
runFrames(260); // > 3с отсчёта при 16мс кадрах
const distE = els['dist-display']._text;
if (distE === distD) { console.error('✗ игра не возобновилась после отсчёта'); process.exit(1); }
console.log('✓ пауза: мир заморожен при сворачивании, возобновление через отсчёт');

// --- тест капча-мини-игры --------------------------------------------------
const { CaptchaGame } = await import('../src/game/captcha.js');
const { CONFIG } = await import('../config.js');

// инвариант решаемости: верных плиток не больше размера сетки
for (let i = 0; i < 200; i++) {
  const g = new CaptchaGame(414, 896);
  const correctCount = g.tiles.filter(t => t.correct).length;
  if (correctCount !== CONFIG.CAPTCHA_TARGETS) {
    console.error('✗ неверное число целевых плиток:', correctCount);
    process.exit(1);
  }
  if (correctCount >= CONFIG.CAPTCHA_GRID * CONFIG.CAPTCHA_GRID) {
    console.error('✗ все плитки верные — нерешаемо'); process.exit(1);
  }
}
console.log('✓ инвариант решаемости капчи (200 экземпляров)');

// проверяем solved → результат
const cg = new CaptchaGame(414, 896);
// тапаем все верные плитки
cg.tiles.forEach((t, i) => {
  if (t.correct) {
    const { cellSize, px, py } = cg._gridGeom();
    const row = (i / CONFIG.CAPTCHA_GRID) | 0, col = i % CONFIG.CAPTCHA_GRID;
    cg.onTap(px + 12 + col * cellSize + cellSize / 2, py + 88 + row * cellSize + cellSize / 2);
  }
});
if (cg.result !== 'solved') { console.error('✗ капча не решилась при правильных тапах'); process.exit(1); }
console.log('✓ капча: solved при верных тапах');

// провал по таймауту
const cg2 = new CaptchaGame(414, 896);
cg2.update(CONFIG.CAPTCHA_TIME + 0.01);
if (cg2.result !== 'failed') { console.error('✗ капча не провалилась по таймауту'); process.exit(1); }
console.log('✓ капча: failed по таймауту');

// --- тест жизней -----------------------------------------------------------
const { Stats } = await import('../src/game/stats.js');
const s = new Stats();
s.reset();
if (s.lives !== CONFIG.START_LIVES) { console.error('✗ неверное начальное число жизней'); process.exit(1); }
const alive1 = s.loseLife();
if (alive1 !== false) { console.error('✗ loseLife должен вернуть false при 0 жизнях'); process.exit(1); }
s.gainLife();
if (s.lives !== 1) { console.error('✗ gainLife не работает'); process.exit(1); }
for (let i = 0; i < 10; i++) s.gainLife();
if (s.lives > CONFIG.MAX_LIVES) { console.error('✗ жизни не ограничены MAX_LIVES'); process.exit(1); }
console.log('✓ система жизней: старт, loseLife, gainLife, cap');

// --- инвариант честности коридора ------------------------------------------
const { nextSafeLane } = await import('../src/game/obstacles.js');
const LANES = 3;
let prev = 1;
for (let i = 0; i < 20000; i++) {
  const next = nextSafeLane(prev, LANES);
  if (next < 0 || next >= LANES) { console.error('✗ полоса вне границ:', next); process.exit(1); }
  if (Math.abs(next - prev) > 1) { console.error('✗ недостижимый прыжок:', prev, '->', next); process.exit(1); }
  prev = next;
}
console.log('✓ инвариант честности: безопасная полоса всегда достижима (20k переходов)');

// --- тест бюджета частиц (пулинг, кап, отсутствие утечек) --------------------
const { Particles } = await import('../src/engine/particles.js');
const pp = new Particles();
pp.setBudget({ particleCap: 100, glow: false });
for (let i = 0; i < 200; i++) pp.burst(100, 100, '#fff', 14, 260);
if (pp.list.length > 100) { console.error('✗ частицы превысили бюджет:', pp.list.length); process.exit(1); }
// пул не течёт: после полного дожития активные → пул, новые спавны переиспользуют
for (let i = 0; i < 100; i++) pp.update(0.1); // 10 секунд — всё умерло
if (pp.list.length !== 0) { console.error('✗ частицы не умерли:', pp.list.length); process.exit(1); }
const poolAfterDeath = pp.pool.length;
if (poolAfterDeath === 0) { console.error('✗ пул пуст — объекты не возвращаются'); process.exit(1); }
pp.burst(0, 0, '#fff', 50, 100);
if (pp.pool.length >= poolAfterDeath) { console.error('✗ спавн не берёт из пула'); process.exit(1); }
pp.clear();
if (pp.list.length !== 0) { console.error('✗ clear не очистил список'); process.exit(1); }
console.log('✓ частицы: бюджет соблюдается, пул переиспользуется, clear работает');

// --- тест настроек/доступности (round-trip, дефолты, isSwipe, fx) ------------
const { isSwipe } = await import('../src/engine/input.js');
const { SettingsStore, saveFlag } = await import('../src/game/settings.js');

// isSwipe: горизонтальный жест за порогом и доминирующий по оси
if (!isSwipe(-30, 5, 24)) { console.error('✗ isSwipe: должен быть свайп влево'); process.exit(1); }
if (isSwipe(10, 5, 24)) { console.error('✗ isSwipe: меньше порога — не свайп'); process.exit(1); }
if (isSwipe(20, 25, 24)) { console.error('✗ isSwipe: вертикаль доминирует — не свайп'); process.exit(1); }

// round-trip: запись через .set() переживает пересоздание стора
const s1 = new SettingsStore();
s1.set('reducedMotion', 'on');
s1.set('colorAssist', true);
s1.set('swipeSens', 2);
s1.set('uiScale', 0);
const s2 = new SettingsStore();
if (s2.get('reducedMotion') !== 'on' || s2.get('colorAssist') !== true || s2.get('swipeSens') !== 2 || s2.get('uiScale') !== 0) {
  console.error('✗ настройки: round-trip не сохранился', s2.data); process.exit(1);
}

// битый JSON в сторадже → дефолты, без исключений
global.localStorage.setItem('uboost_runner_v1', '{not valid json');
const s3 = new SettingsStore();
if (s3.get('reducedMotion') !== 'auto' || s3.get('swipeSens') !== 1 || s3.get('uiScale') !== 1) {
  console.error('✗ настройки: битый JSON не дал дефолты', s3.data); process.exit(1);
}

// fx(): форма результата для reduced motion on/off
s3.set('reducedMotion', 'on');
const fxOn = s3.fx();
if (fxOn.shakeMul !== 0 || fxOn.glitchOn !== false || fxOn.grainOn !== false || fxOn.flashMax >= 1) {
  console.error('✗ fx(): reduced motion on — неверный результат', fxOn); process.exit(1);
}
s3.set('reducedMotion', 'off');
const fxOff = s3.fx();
if (fxOff.shakeMul !== 1 || fxOff.glitchOn !== true || fxOff.grainOn !== true || fxOff.flashMax !== 1) {
  console.error('✗ fx(): reduced motion off — неверный результат', fxOff); process.exit(1);
}
console.log('✓ настройки: round-trip, дефолты при битом JSON, isSwipe, fx()');

// --- тест timescale (hit-stop/slow-mo) ---------------------------------------
const ts = await import('../src/engine/timescale.js');
ts.reset();
if (ts.mul(0) !== 1) { console.error('✗ timescale: без эффекта mul() должен быть 1'); process.exit(1); }

ts.hitStop(0.1);
let m = ts.mul(0.05);
if (!(m > 0 && m <= 1)) { console.error('✗ timescale: hitStop mul() вне (0,1]:', m); process.exit(1); }
if (m >= 0.5) { console.error('✗ timescale: hitStop должен почти останавливать время:', m); process.exit(1); }

// вложенный slowMo слабее активного hitStop — не должен его перебить
ts.slowMo(0.5, 0.2);
m = ts.mul(0.001);
if (!(m > 0 && m < 0.01)) { console.error('✗ timescale: более сильный hitStop должен победить slowMo:', m); process.exit(1); }

// после истечения — строго 1
m = ts.mul(1.0); // дольше остатка таймера
if (m !== 1) { console.error('✗ timescale: после истечения mul() должен быть строго 1:', m); process.exit(1); }

// slowMo сам по себе — корректный диапазон
ts.reset();
ts.slowMo(0.4, 0.1);
m = ts.mul(0.05);
if (!(m > 0 && m <= 1) || m !== 0.4) { console.error('✗ timescale: slowMo должен дать заданный множитель:', m); process.exit(1); }
ts.reset();
console.log('✓ timescale: hit-stop/slow-mo — диапазон (0,1], минимум при наложении, сброс к 1');

// --- тест прогрессии (FTUE: pickObstacleType, tutorial) ----------------------
const { pickObstacleType, TYPE_KEYS } = await import('../src/game/obstacles.js');
const P = CONFIG.PROGRESSION;

// малая дистанция: капча и lag никогда не выпадают
for (let i = 0; i < 500; i++) {
  const type = pickObstacleType(P.CAPTCHA_MIN_DIST - 1, Math.random);
  if (type === 'captcha') { console.error('✗ pickObstacleType: капча на малой дистанции'); process.exit(1); }
  const type2 = pickObstacleType(P.LAG_MIN_DIST - 1, Math.random);
  if (type2 === 'lag') { console.error('✗ pickObstacleType: lag на малой дистанции'); process.exit(1); }
}

// большая дистанция: за достаточное число прогонов встречаются все типы
const seen = new Set();
for (let i = 0; i < 1000; i++) seen.add(pickObstacleType(P.LAG_MIN_DIST + 1000, Math.random));
for (const k of TYPE_KEYS) {
  if (!seen.has(k)) { console.error('✗ pickObstacleType: тип не встречается на большой дистанции:', k); process.exit(1); }
}
console.log('✓ pickObstacleType: прогрессивное введение типов препятствий');

// туториал: активен на свежих настройках, не реактивируется после finish()
const { Tutorial } = await import('../src/game/tutorial.js');
const tut = new Tutorial();
tut.start();
if (!tut.active || tut.step !== 0) { console.error('✗ туториал: должен стартовать с шага 0'); process.exit(1); }
tut.onSwipe();
if (tut.step !== 1) { console.error('✗ туториал: свайп должен переводить на шаг 1'); process.exit(1); }
tut.onCollect();
if (tut.step !== 2) { console.error('✗ туториал: сбор бита должен переводить на шаг 2'); process.exit(1); }
tut.finish();
if (tut.active) { console.error('✗ туториал: finish() должен деактивировать'); process.exit(1); }
if (!new SettingsStore().get('tutorialDone')) { console.error('✗ туториал: finish() должен сохранить tutorialDone'); process.exit(1); }

// повторный запуск — не реактивируется
const tut2 = new Tutorial();
tut2.start();
if (tut2.active) { console.error('✗ туториал: не должен реактивироваться после tutorialDone'); process.exit(1); }
console.log('✓ туториал: 3 шага, finish() сохраняет tutorialDone, не реактивируется');

// --- тест мета-прогрессии (PR6: ранги, миссии, бейджи) ------------------------
const { Progress, rankFor, rollMissions, checkMissions, checkBadges } = await import('../src/game/progress.js');

// rankFor монотонна по очкам
{
  let prevRank = -1;
  for (let score = 0; score <= 20000; score += 137) {
    const r = rankFor(score);
    if (r < prevRank) { console.error('✗ rankFor: не монотонна на score=', score); process.exit(1); }
    prevRank = r;
  }
  if (rankFor(0) !== 0) { console.error('✗ rankFor(0) должен быть 0'); process.exit(1); }
  if (rankFor(1e9) !== CONFIG.RANKS.length - 1) { console.error('✗ rankFor: максимальный ранг не достигается'); process.exit(1); }
}
console.log('✓ rankFor: монотонна, границы 0 и максимум');

// rollMissions: 3 уникальные миссии без дублей
for (let i = 0; i < 200; i++) {
  const missions = rollMissions(Math.random);
  if (missions.length !== 3) { console.error('✗ rollMissions: должно быть 3 миссии, получено', missions.length); process.exit(1); }
  const ids = new Set(missions.map((m) => m.id));
  if (ids.size !== missions.length) { console.error('✗ rollMissions: дубликаты в выборке'); process.exit(1); }
}
console.log('✓ rollMissions: 3 уникальные миссии без дублей (200 прогонов)');

// checkMissions: бонус и список выполненных по счётчикам Stats
{
  const missions = [
    { id: 'collect_bits', stat: 'bits', target: 20, reward: 120 },
    { id: 'distance', stat: 'distInt', target: 500, reward: 150 },
  ];
  const result = checkMissions({ bits: 25, distInt: 100 }, missions);
  if (!result.done.includes('collect_bits') || result.done.includes('distance')) {
    console.error('✗ checkMissions: неверный список выполненных', result); process.exit(1);
  }
  if (result.bonus !== 120) { console.error('✗ checkMissions: неверный бонус', result.bonus); process.exit(1); }
}
console.log('✓ checkMissions: бонус и выполнение по счётчикам Stats');

// checkBadges: идемпотентность — повторный чек не дублирует уже выданные
{
  const profile = { gamesPlayed: 1, totalDist: 0, bestCombo: 0, rankId: 0, badges: [] };
  const first = checkBadges(profile);
  if (!first.includes('first_run')) { console.error('✗ checkBadges: бейдж first_run не выдан', first); process.exit(1); }
  profile.badges.push(...first);
  const second = checkBadges(profile);
  if (second.length !== 0) { console.error('✗ checkBadges: повторный чек выдал дубликаты', second); process.exit(1); }
}
console.log('✓ checkBadges: идемпотентная выдача (без дублей при повторном чеке)');

// миграция старого JSON {best, muted} → Progress без исключений, дефолтный профиль
{
  global.localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({ best: 1234, muted: true }));
  const prog = new Progress();
  if (prog.data.gamesPlayed !== 0 || prog.data.rankId !== 0 || !Array.isArray(prog.data.badges)) {
    console.error('✗ Progress: миграция старого JSON дала неверные дефолты', prog.data); process.exit(1);
  }
  prog.finishRun({ distInt: 100, scoreInt: 50, bestCombo: 2 });
  if (prog.data.gamesPlayed !== 1) { console.error('✗ Progress: finishRun не обновил gamesPlayed'); process.exit(1); }
}
console.log('✓ Progress: миграция старого JSON {best,muted} без исключений');

// --- тест визуала (PR7: зоны-палитры, X2-множитель) --------------------------
const { paletteAt, zoneIndexAt } = await import('../src/game/world.js');

// zoneIndexAt монотонна, в границах массива зон
{
  let prevZone = -1;
  for (let d = 0; d <= 5000; d += 13) {
    const z = zoneIndexAt(d);
    if (z < prevZone) { console.error('✗ zoneIndexAt: не монотонна на d=', d); process.exit(1); }
    if (z < 0 || z >= CONFIG.ZONES.length) { console.error('✗ zoneIndexAt: вне границ', z); process.exit(1); }
    prevZone = z;
  }
  if (zoneIndexAt(0) !== 0) { console.error('✗ zoneIndexAt(0) должен быть 0'); process.exit(1); }
}
console.log('✓ zoneIndexAt: монотонна и в границах');

// paletteAt: валидный RGB + непрерывность (нет скачков на переходах зон)
{
  const parse = (s) => {
    const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(s);
    if (!m) { console.error('✗ paletteAt: невалидный RGB:', s); process.exit(1); }
    return [+m[1], +m[2], +m[3]];
  };
  const keys = ['skyTop', 'skyMid', 'skyBottom', 'bgBottom', 'grid', 'gridFar'];
  let prev = null;
  for (let d = 0; d <= 3400; d += 1) {
    const pal = paletteAt(d);
    const cur = {};
    for (const k of keys) {
      const c = parse(pal[k]);
      for (const ch of c) if (ch < 0 || ch > 255) { console.error('✗ paletteAt: канал вне 0..255', k, ch); process.exit(1); }
      cur[k] = c;
    }
    if (prev) for (const k of keys) for (let i = 0; i < 3; i++) {
      if (Math.abs(cur[k][i] - prev[k][i]) > 6) {
        console.error('✗ paletteAt: скачок цвета на d=', d, k); process.exit(1);
      }
    }
    prev = cur;
  }
}
console.log('✓ paletteAt: валидный RGB, непрерывность на переходах зон');

// X2: множитель удваивает игровые очки ровно в X2_MULT раз
{
  const sx1 = new Stats(); sx1.reset();
  sx1.scoreMult = 1; sx1.addDistance(500, 0.1); sx1.collectBit(); sx1.dodge('ads'); sx1.smash();
  const single = sx1.score;
  const sx2 = new Stats(); sx2.reset();
  sx2.scoreMult = CONFIG.X2_MULT; sx2.addDistance(500, 0.1); sx2.collectBit(); sx2.dodge('ads'); sx2.smash();
  const doubled = sx2.score;
  if (Math.abs(doubled - single * CONFIG.X2_MULT) > 1e-9) {
    console.error('✗ X2: множитель не даёт ровно ×' + CONFIG.X2_MULT, single, doubled); process.exit(1);
  }
}
console.log('✓ X2: scoreMult удваивает игровые очки ровно в X2_MULT раз');

console.log('✓ все тесты пройдены');
