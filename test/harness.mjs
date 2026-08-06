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
    tag, _text: '', innerHTML: '', value: '', _attrs: {},
    style: new Proxy({}, { get: () => '', set: () => true }),
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){f?this._s.add(c):this._s.delete(c);}, contains(c){return this._s.has(c);} },
    set textContent(v){this._text=v;}, get textContent(){return this._text;},
    addEventListener(ev,fn){(handlers[ev]=handlers[ev]||[]).push(fn);}, _handlers: handlers,
    appendChild(){}, setAttribute(k,v){this._attrs[k]=String(v);}, getAttribute(k){return this._attrs[k] ?? null;}, getContext(){return makeCtx();},
    toBlob(cb){cb(new Blob());}, toDataURL(){return 'data:,';}, click(){}, remove(){},
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

if (!els['mission-preview'].classList.contains('hidden')
    || els.tagline._text !== 'Лети по сети: уворачивайся от блокировок, капч и рекламы.') {
  console.error('✗ стартовый экран не сокращён до согласованного текста');
  process.exit(1);
}
console.log('✓ стартовый экран использует короткий согласованный текст');

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

// --- щадящий режим первых капч: без инверсии + прощение одного промаха --------
for (let i = 0; i < 100; i++) {
  const g = new CaptchaGame(414, 896, CONFIG.CAPTCHA_NOVICE_TIME_MUL, true);
  if (g.invert) { console.error('✗ novice-капча не должна быть «наоборот»'); process.exit(1); }
  if (g.timeTotal <= CONFIG.CAPTCHA_TIME) { console.error('✗ novice-капча должна давать больше времени'); process.exit(1); }
  // промах по неверной плитке прощается один раз
  const wrongIdx = g.tiles.findIndex((t) => !t.correct);
  const geom = g._gridGeom();
  const col = wrongIdx % CONFIG.CAPTCHA_GRID, row = Math.floor(wrongIdx / CONFIG.CAPTCHA_GRID);
  const tx = geom.px + 12 + (col + 0.5) * geom.cellSize;
  const ty = geom.py + 88 + (row + 0.5) * geom.cellSize;
  g.onTap(tx, ty);
  if (g.done || g.result === 'failed') { console.error('✗ novice-капча: первый промах не должен проваливать'); process.exit(1); }
  g.onTap(tx, ty);
  if (!g.done || g.result !== 'failed') { console.error('✗ novice-капча: второй промах должен проваливать (строгий режим)'); process.exit(1); }
}
console.log('✓ капча: щадящий режим первых показов (без инверсии, один промах прощается)');

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

// «капча-наоборот» (invert): тапаемых плиток по-прежнему ровно TARGETS и она решаема
{
  let invertSeen = 0, normalSeen = 0;
  const tapAllCorrect = (g) => g.tiles.forEach((t, idx) => {
    if (!t.correct) return;
    const { cellSize, px, py } = g._gridGeom();
    const row = (idx / CONFIG.CAPTCHA_GRID) | 0, col = idx % CONFIG.CAPTCHA_GRID;
    g.onTap(px + 12 + col * cellSize + cellSize / 2, py + 88 + row * cellSize + cellSize / 2);
  });
  for (let i = 0; i < 400 && (invertSeen < 5 || normalSeen < 5); i++) {
    const g = new CaptchaGame(414, 896);
    g.invert ? invertSeen++ : normalSeen++;
    const correctCount = g.tiles.filter((t) => t.correct).length;
    if (correctCount !== CONFIG.CAPTCHA_TARGETS) { console.error('✗ invert: тапаемых плиток != TARGETS', correctCount); process.exit(1); }
    tapAllCorrect(g);
    if (g.result !== 'solved') { console.error('✗ invert: капча не решилась тапом всех correct (invert=' + g.invert + ')'); process.exit(1); }
  }
  if (invertSeen === 0 || normalSeen === 0) { console.error('✗ invert: не встретились оба режима капчи'); process.exit(1); }
}
console.log('✓ капча-наоборот: оба режима решаемы, тапаемых плиток ровно TARGETS');

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

// --- VPN-буст отделён от обычной защиты -------------------------------------
const { isBoosting, speedWithBoost, canSmash } = await import('../src/game/powerstate.js');
if (isBoosting(0) || canSmash(0) || speedWithBoost(500, 0) !== 500) {
  console.error('✗ обычное состояние ошибочно считается VPN-бустом'); process.exit(1);
}
if (!isBoosting(1) || !canSmash(1) || speedWithBoost(500, 1) !== CONFIG.BOOST_SPEED) {
  console.error('✗ настоящий VPN-буст не включает скорость/смэш'); process.exit(1);
}
console.log('✓ VPN-буст отделён от защитной неуязвимости');

// Частота усилений должна жить в секундах: колонны учащаются с ростом скорости,
// поэтому cadence «каждые N колонн» превращал пятисекундный boost в постоянный.
if (!(CONFIG.BOOST_INTERVAL_MIN > CONFIG.BOOST_DURATION)
    || !(CONFIG.BOOST_INTERVAL_MAX >= CONFIG.BOOST_INTERVAL_MIN)
    || !(CONFIG.PICKUP_INTERVAL_MIN > 0)) {
  console.error('✗ интервалы усилений не ограничивают late-game uptime'); process.exit(1);
}
console.log('✓ усиления используют временной cadence вместо частоты колонн');

// --- адаптивный synthwave: профиль отражает игровые состояния ----------------
const { musicProfile } = await import('../src/engine/audio.js');
{
  const calm = musicProfile({ mode: 'play', speed: CONFIG.BASE_SPEED, combo: 0 });
  const fast = musicProfile({ mode: 'play', speed: CONFIG.MAX_SPEED, combo: CONFIG.MUSIC.COMBO_FULL });
  const boost = musicProfile({ mode: 'play', speed: CONFIG.BASE_SPEED, combo: 0, boosting: true });
  const captcha = musicProfile({ mode: 'captcha', speed: CONFIG.MAX_SPEED, combo: 99 });
  const dying = musicProfile({ mode: 'dying', speed: CONFIG.MAX_SPEED, combo: 99, boosting: true });
  if (!(calm.intensity > 0 && calm.intensity < fast.intensity)) {
    console.error('✗ музыка: интенсивность не растёт со скоростью/combo', calm, fast); process.exit(1);
  }
  if (boost.intensity !== 1 || !boost.boosting) {
    console.error('✗ музыка: VPN-буст не раскрывает полную интенсивность', boost); process.exit(1);
  }
  if (captcha.intensity !== CONFIG.MUSIC.CAPTCHA_INTENSITY || dying.intensity !== 0) {
    console.error('✗ музыка: captcha/dying имеют неверный профиль', captcha, dying); process.exit(1);
  }
  if (CONFIG.MUSIC.PROGRESSION.length !== 8 || CONFIG.MUSIC.LEAD_MOTIF.length !== 8) {
    console.error('✗ музыка: драматическая 8-тактовая форма повреждена'); process.exit(1);
  }
  // гармония зон: транспонирование на каждую визуальную зону
  if (CONFIG.MUSIC.ZONE_TRANSPOSE.length !== CONFIG.ZONES.length) {
    console.error('✗ музыка: ZONE_TRANSPOSE не совпадает с числом зон',
      CONFIG.MUSIC.ZONE_TRANSPOSE.length, CONFIG.ZONES.length); process.exit(1);
  }
  // микс: пампинг в (0,1); ping-pong feedback < 1 (иначе самовозбуждение эха)
  const Mx = CONFIG.MUSIC;
  if (!(Mx.PUMP_DEPTH > 0 && Mx.PUMP_DEPTH < 1)) {
    console.error('✗ музыка: PUMP_DEPTH вне (0,1)', Mx.PUMP_DEPTH); process.exit(1);
  }
  if (!(Mx.PING_FEEDBACK >= 0 && Mx.PING_FEEDBACK < 1)) {
    console.error('✗ музыка: PING_FEEDBACK должен быть < 1 (стабильность эха)', Mx.PING_FEEDBACK); process.exit(1);
  }
}
console.log('✓ адаптивная музыка: профили + гармония зон, пампинг и ping-pong в норме');

// --- комбо near-miss: растёт, срезается (не обнуляется) на урон, смэш питает ---
{
  const sc = new Stats(); sc.reset();
  sc.nearMiss(); sc.nearMiss(); sc.nearMiss();
  if (sc.combo !== 3) { console.error('✗ combo: nearMiss не наращивает комбо', sc.combo); process.exit(1); }
  if (sc.bestCombo !== 3) { console.error('✗ combo: bestCombo не зафиксирован', sc.bestCombo); process.exit(1); }
  sc.resetCombo();
  const cut = Math.floor(3 / CONFIG.COMBO_HIT_PENALTY_DIV);
  if (sc.combo !== cut) { console.error('✗ combo: удар должен срезать делителем, а не обнулять', sc.combo, cut); process.exit(1); }
  if (sc.bestCombo !== 3) { console.error('✗ combo: resetCombo не должен трогать bestCombo', sc.bestCombo); process.exit(1); }
  sc.nearMiss();
  if (sc.combo !== cut + 1) { console.error('✗ combo: не растёт после среза', sc.combo); process.exit(1); }
  const before = sc.combo;
  sc.smash();
  if (sc.combo !== before + 1) { console.error('✗ combo: смэш должен питать комбо', sc.combo); process.exit(1); }
  if (!(CONFIG.COMBO_CAP > 8)) { console.error('✗ COMBO_CAP должен быть выше прежних 8'); process.exit(1); }
}
console.log('✓ комбо: растёт на near-miss и смэш, срезается делителем на урон, bestCombo сохраняется');

// --- гэги доступны в типичном забеге (150–400 м) --------------------------------
if (CONFIG.PROGRESSION.GAG_MIN_DIST > 400) {
  console.error('✗ GAG_MIN_DIST выше типичного забега — контент events.js снова заперт'); process.exit(1);
}
console.log('✓ гэги: минимальная дистанция в пределах типичного забега');

// --- веса препятствий по зонам: таблица согласована с ZONES и типами -----------
{
  const W = CONFIG.OBSTACLE_ZONE_WEIGHTS;
  if (!Array.isArray(W) || W.length !== CONFIG.ZONES.length) {
    console.error('✗ OBSTACLE_ZONE_WEIGHTS должен покрывать все зоны'); process.exit(1);
  }
  for (const zone of W) for (const [k, v] of Object.entries(zone)) {
    if (!(v > 0)) { console.error('✗ вес препятствия должен быть > 0:', k, v); process.exit(1); }
  }
}
console.log('✓ веса препятствий по зонам согласованы с ZONES');

// --- риск-биты: множитель работает в очках, конфиг в разумных границах ---------
{
  const sc = new Stats(); sc.reset();
  sc.collectBit(1);
  const base = sc.score;
  sc.reset();
  sc.collectBit(CONFIG.BITS_RISK_MULT);
  if (Math.abs(sc.score - base * CONFIG.BITS_RISK_MULT) > 1e-9) {
    console.error('✗ риск-бит должен умножать номинал', sc.score, base); process.exit(1);
  }
  if (!(CONFIG.BITS_RISK_EVERY >= 3)) { console.error('✗ риск-биты слишком часто'); process.exit(1); }
  if (!(CONFIG.MAGNET_COMBO_EVERY >= 3)) { console.error('✗ комбо от магнита слишком щедрое'); process.exit(1); }
}
console.log('✓ риск-биты: множитель и частота в границах');

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

// --- нулевой вьюпорт не должен ронять игровой цикл ---------------------------
// world.draw зовётся из rAF-кадра (main.js), поэтому ЛЮБОЕ исключение оттуда
// убивает цикл насовсем и игрок видит застывший экран. При W=0 в _drawRidge
// выходило sx / W = -0/0 = NaN → i0 = Math.floor(NaN) % n = NaN → pts[NaN].h
// бросал TypeError. Ловилось на проде в консоли (main.js:1005). Нулевой/ещё не
// согласованный вьюпорт реален на первом кадре в Telegram WebView.
{
  const { World } = await import('../src/game/world.js');
  const w = new World();
  for (const [W, H] of [[0, 0], [0, 800], [800, 0], [-5, 600], [400, 860]]) {
    try {
      w.draw(makeCtx(), W, H, 800, true);
      w.draw(makeCtx(), W, H, 0, false); // и без дорогой фоновой косметики
    } catch (error) {
      console.error(`✗ world.draw бросил при W=${W} H=${H} — исключение в rAF-кадре убивает игровой цикл: ${error.message}`);
      process.exit(1);
    }
  }
}
console.log('✓ нулевой вьюпорт: world.draw не бросает, игровой цикл выживает');

// --- адаптивное качество: сходимость вместо автоколебаний ---------------------
// Прод-телеметрия (2026-08, 7 дней) поймала 3155 смен тира на 656 забегов: вверх
// 1420 / вниз 1405, 2456 разворотов, медиана между разворотами 2.1 с. Каждая смена
// тира переаллоцирует буфер канваса (setDprCap → resize) и буфер bloom — это и был
// «тормозит» в жалобах. Тест держит два инварианта: менеджер СХОДИТСЯ (число
// разворотов ограничено) и DPR не пилит буфер туда-обратно.
{
  const { Quality } = await import('../src/engine/quality.js');

  // Прогон серии времён кадра через менеджер; возвращает историю тиров и DPR.
  function run(dtSeries, startTier = 1) {
    const q = new Quality(startTier);
    const tiers = [q.tier], dprs = [q.s.dpr];
    q.onChange = (s) => { tiers.push(q.tier); dprs.push(s.dpr); };
    for (const dt of dtSeries) q.sample(dt);
    return { q, tiers, dprs };
  }
  // Считает развороты направления в истории тиров.
  const flips = (tiers) => {
    let prev = 0, n = 0;
    for (let i = 1; i < tiers.length; i++) {
      const d = Math.sign(tiers[i] - tiers[i - 1]);
      if (d !== 0 && prev !== 0 && d !== prev) n++;
      if (d !== 0) prev = d;
    }
    return n;
  };

  // Сценарий-убийца: 120 Гц (8.3 мс) на низком тире, но старшие тиры не тянут.
  // Именно он давал бесконечный цикл — UP_MS 14.5 всегда проходим на 120 Гц,
  // DOWN_MS 23 всегда проходим на поднятом тире.
  const N = 4000;
  {
    const q = new Quality(1);
    const tiers = [q.tier], dprs = [q.s.dpr];
    q.onChange = (s) => { tiers.push(q.tier); dprs.push(s.dpr); };
    // «Честное» устройство: на тире ≤1 держит 120 Гц, на тире ≥2 проваливается.
    for (let i = 0; i < N; i++) q.sample(q.tier >= 2 ? 30 : 8.3);
    const f = flips(tiers);
    if (f > 6) {
      console.error(`✗ адаптивное качество: автоколебания на 120 Гц — ${f} разворотов за ${N} кадров (тиры: ${tiers.slice(0, 24).join('>')}…)`);
      process.exit(1);
    }
    // DPR не должен пилить буфер: допускаем немного смен, но не десятки.
    const dprChanges = dprs.filter((v, i) => i > 0 && v !== dprs[i - 1]).length;
    if (dprChanges > 2) {
      console.error(`✗ адаптивное качество: DPR переаллоцирует буфер ${dprChanges} раз (${dprs.join('→')})`);
      process.exit(1);
    }
  }

  // 60 Гц ровно на vsync — стабильное устройство не должно дёргаться вообще.
  {
    const { tiers } = run(Array(1200).fill(16.7));
    if (flips(tiers) > 1) {
      console.error(`✗ адаптивное качество: 60 Гц без джанка колеблется (${tiers.join('>')})`);
      process.exit(1);
    }
  }

  // Реально слабое устройство обязано доехать до тира 0 и там остаться.
  {
    const { q, tiers } = run(Array(1200).fill(60));
    if (q.tier !== 0) { console.error('✗ адаптивное качество: слабое устройство не опустилось до 0, тир', q.tier); process.exit(1); }
    if (flips(tiers) > 0) { console.error('✗ адаптивное качество: спад до 0 не монотонен', tiers.join('>')); process.exit(1); }
  }

  // Мощное устройство всё ещё должно уметь подняться — фикс не должен запирать тир.
  {
    const { q } = run(Array(2000).fill(6), 0);
    if (q.tier === 0) { console.error('✗ адаптивное качество: мощное устройство заперто на тире 0'); process.exit(1); }
  }

  // --- Лёгкая графика: ручной режим для слабых устройств ---------------------
  // Настройка «Графика: ЛЁГКАЯ». Инварианты: тир прибит к 0 с первого кадра,
  // адаптация молчит (ни одного дёрганья буфера), возврат в АВТО отдаёт
  // управление обратно, и режим НЕ выходит за пределы косметики.
  {
    const q = new Quality(2, 'lite');
    const L = CONFIG.QUALITY.LITE;
    if (q.tier !== 0) { console.error('✗ лёгкая графика: тир должен быть 0 с первого кадра, а не', q.tier); process.exit(1); }
    if (q.s.dpr !== L.DPR || q.s.particleCap !== L.PARTICLE_CAP) {
      console.error('✗ лёгкая графика: оверлей CONFIG.QUALITY.LITE не применился', q.s); process.exit(1);
    }
    if (q.s.bloom || q.s.aberration || q.s.grain || q.s.glow || q.s.bgFx || q.s.scanlines) {
      console.error('✗ лёгкая графика: дорогие эффекты остались включены', q.s); process.exit(1);
    }
    // Ни «слабые», ни «мощные» кадры не двигают тир: режим ручной.
    let changes = 0;
    q.onChange = () => changes++;
    for (let i = 0; i < 2000; i++) q.sample(i % 2 ? 6 : 60);
    if (changes !== 0 || q.tier !== 0) {
      console.error(`✗ лёгкая графика: адаптация вмешалась (${changes} смен, тир ${q.tier})`); process.exit(1);
    }
    // Возврат в АВТО: тир и DPR возвращаются, память о провалах обнулена,
    // мощное устройство снова умеет подниматься (иначе игрок навсегда остался
    // бы на DPR лёгкого режима, один раз заглянув в настройки).
    q.setMode('auto');
    if (q.tier !== 2 || q.s.dpr === L.DPR) { console.error('✗ лёгкая графика: выключение не вернуло авто-тир', q.tier, q.s.dpr); process.exit(1); }
    for (let i = 0; i < 2000; i++) q.sample(6);
    if (q.tier !== 3) { console.error('✗ лёгкая графика: после выключения адаптация не поднимает тир, тир', q.tier); process.exit(1); }
    // Включение на ходу (тумблер в паузе) прибивает тир к 0 сразу.
    q.setMode('lite');
    if (q.tier !== 0 || q.s.dpr !== L.DPR) { console.error('✗ лёгкая графика: включение на ходу не опустило тир', q.tier); process.exit(1); }

    // Главный контракт: графика не влияет на геймплей. Тир качества обязан
    // оставаться набором чисто косметических полей — если кто-то добавит сюда
    // «спавн реже» или «скорость ниже», лёгкий режим станет читом и тест упадёт.
    const COSMETIC = new Set(['dpr', 'bloom', 'aberration', 'grain', 'scanlines', 'bloomScale', 'particleCap', 'glow', 'bgFx']);
    for (const k of Object.keys(q.s)) {
      if (!COSMETIC.has(k)) { console.error('✗ лёгкая графика: тир качества протёк за пределы косметики —', k); process.exit(1); }
    }
  }

  // Геймплейные модули не должны знать о режиме графики вообще: скорость,
  // спавн, хитбоксы и очки одинаковы в АВТО и ЛЁГКОЙ.
  {
    const { readFile } = await import('node:fs/promises');
    const FILES = ['obstacles.js', 'collectibles.js', 'boosts.js', 'captcha.js', 'stats.js', 'player.js', 'world.js'];
    for (const f of FILES) {
      const src = await readFile(new URL(`../src/game/${f}`, import.meta.url), 'utf8');
      if (/graphics|liteGraphics/.test(src)) {
        console.error(`✗ лёгкая графика: ${f} читает режим графики — это влияние графики на геймплей`); process.exit(1);
      }
    }
  }

  // Новые тюнинги обязаны иметь дефолты в самом quality.js: во время деплоя
  // ES-модули кэшируются по отдельности (js — max-age 300), поэтому свежий
  // quality.js реально может встретить ещё закэшированный старый config.js.
  {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/engine/quality.js', import.meta.url), 'utf8');
    // Ловим все стили доступа: CONFIG.QUALITY(?.)X, хелпер Q().X и lite().X.
    const READ = /(?:CONFIG\.QUALITY\??\.|Q\(\)\.|lite\(\)\.)([A-Z_]+)/g;
    const GUARDED = /(?:CONFIG\.QUALITY\??\.|Q\(\)\.|lite\(\)\.)([A-Z_]+)\s*\?\?/g;
    const reads = [...src.matchAll(READ)].map((m) => m[1]);
    const guarded = [...src.matchAll(GUARDED)].map((m) => m[1]);
    if (!reads.length) {
      console.error('✗ адаптивное качество: тест дефолтов ничего не нашёл — регексп отстал от кода');
      process.exit(1);
    }
    const missing = reads.filter((k) => !guarded.includes(k));
    if (missing.length) {
      console.error('✗ адаптивное качество: тюнинги без ?? дефолта (сломаются на старом кэше config.js):', missing.join(', '));
      process.exit(1);
    }
  }
}
console.log('✓ адаптивное качество: сходится, DPR не пилит буфер, слабые/мощные устройства обслужены');

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
s1.set('graphics', 'lite');
const s2 = new SettingsStore();
if (s2.get('reducedMotion') !== 'on' || s2.get('colorAssist') !== true || s2.get('swipeSens') !== 2 || s2.get('uiScale') !== 0) {
  console.error('✗ настройки: round-trip не сохранился', s2.data); process.exit(1);
}
if (s2.get('graphics') !== 'lite' || s2.liteGraphics() !== true) {
  console.error('✗ настройки: режим графики не сохранился', s2.data); process.exit(1);
}
// Старый блоб без ключа graphics (прод-игроки до этого релиза) → АВТО, без потерь.
saveFlag('settings', { reducedMotion: 'on', colorAssist: true, swipeSens: 2, uiScale: 0, tutorialDone: true });
const sOld = new SettingsStore();
if (sOld.get('graphics') !== 'auto' || sOld.liteGraphics() || sOld.get('tutorialDone') !== true) {
  console.error('✗ настройки: старый блоб без graphics должен дать АВТО и сохранить остальное', sOld.data); process.exit(1);
}
// Битое значение (например, откат версии) → дефолт, а не «полурежим».
saveFlag('settings', { graphics: 'ultra' });
if (new SettingsStore().get('graphics') !== 'auto') {
  console.error('✗ настройки: битый graphics не сброшен в auto'); process.exit(1);
}

// битый JSON в сторадже → дефолты, без исключений
global.localStorage.setItem('uboost_runner_v1', '{not valid json');
const s3 = new SettingsStore();
if (s3.get('reducedMotion') !== 'auto' || s3.get('swipeSens') !== 1 || s3.get('uiScale') !== 1 || s3.get('graphics') !== 'auto') {
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

// --- тест shuffle-bag (PR8: равномерность, нет стыковых повторов) -------------
const { makeBag, STR, SAFE_STRINGS } = await import('../src/ui/strings.js');

// полнота цикла: каждые N выдач — полная перестановка (все элементы уникальны)
{
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const next = makeBag(arr, Math.random);
  for (let cycle = 0; cycle < 100; cycle++) {
    const seen = [];
    for (let i = 0; i < arr.length; i++) seen.push(next());
    if (new Set(seen).size !== arr.length) { console.error('✗ shuffle-bag: цикл не полон', seen); process.exit(1); }
  }
}
// нет повторов подряд (в т.ч. на стыке циклов)
{
  const arr = ['x', 'y', 'z'];
  const next = makeBag(arr, Math.random);
  let prev = next();
  for (let i = 0; i < 5000; i++) {
    const cur = next();
    if (cur === prev) { console.error('✗ shuffle-bag: повтор подряд', cur); process.exit(1); }
    prev = cur;
  }
}
// край-кейсы: одиночный массив не падает; пустой → undefined
{
  const solo = makeBag(['solo'], Math.random);
  if (solo() !== 'solo' || solo() !== 'solo') { console.error('✗ shuffle-bag: одиночный массив'); process.exit(1); }
  const empty = makeBag([], Math.random);
  if (empty() !== undefined) { console.error('✗ shuffle-bag: пустой массив должен дать undefined'); process.exit(1); }
}
console.log('✓ shuffle-bag: полнота цикла, нет стыковых повторов, край-кейсы');

// --- редактура/безопасный копирайт -------------------------------------------
if (!STR.howto.includes('←/→') || /↑\/↓/.test(STR.howto)) {
  console.error('✗ подсказка управления не соответствует горизонтальной оси', STR.howto); process.exit(1);
}
if (/НЕ УБИВАЕТ/i.test(STR.tutorial.join(' '))) {
  console.error('✗ tutorial всё ещё обещает, что капча не убивает'); process.exit(1);
}
const captchaDeath = STR.deathFor({}, 'captcha');
if (!STR.deathByKiller.captcha.includes(captchaDeath)) {
  console.error('✗ причина смерти не соответствует killer=captcha', captchaDeath); process.exit(1);
}
const safeDump = JSON.stringify(SAFE_STRINGS).toUpperCase();
for (const forbidden of ['СБЕР', 'ОЗОН', 'VAVADA', '1ХСТАВ', 'РОСКОМНАДЗОР', 'ГОСУСЛУГ', 'ЯНДЕКС', 'АЛИСА', 'ВАЗ 2112']) {
  if (safeDump.includes(forbidden)) {
    console.error('✗ safe-копирайт содержит raw-бренд:', forbidden); process.exit(1);
  }
}
global.location = { search: '?safe=1' };
const { CONFIG: safeConfig } = await import('../config.js?safe-query-test');
delete global.location;
if (!safeConfig.STRINGS_SAFE) {
  console.error('✗ ?safe=1 не включает безопасный копирайт'); process.exit(1);
}
console.log('✓ управление, killer-тексты и safe-копирайт согласованы');

// --- share payload: URL не дублируется ---------------------------------------
const { buildChallengeShare } = await import('../src/game/sharetext.js');
{
  const payload = buildChallengeShare(321, 987);
  if (payload.text.includes(payload.url)) {
    console.error('✗ share text уже содержит URL и задублирует параметр url'); process.exit(1);
  }
  const count = payload.fallbackText.split(payload.url).length - 1;
  if (count !== 1) { console.error('✗ fallback share должен содержать URL ровно один раз', payload); process.exit(1); }
}
console.log('✓ share payload не дублирует challenge URL');

// --- mobile game-over: действия раньше подробностей, верх достижим -----------
{
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles/style.css', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  if (html.indexOf('gameover-actions') > html.indexOf('card-preview')) {
    console.error('✗ действия game-over должны идти до карточки/подробностей'); process.exit(1);
  }
  if (!/#game-over-screen\s*\{[^}]*align-items:\s*flex-start/s.test(css)) {
    console.error('✗ game-over не выровнен от верхнего края на мобильном'); process.exit(1);
  }
  if (/btn-copy-challenge|СКОПИРОВАТЬ ВЫЗОВ/.test(html)) {
    console.error('✗ лишняя кнопка «Скопировать вызов» осталась на game-over'); process.exit(1);
  }
  if (!/id="btn-start-board"[^>]*>[^<]*ДОСКА ПОЧЁТА/.test(html)) {
    console.error('✗ на стартовом экране нет заметной кнопки «Доска почёта»'); process.exit(1);
  }
  if (!/id="btn-run-details"/.test(html) || !/id="run-details"[^>]*hidden/.test(html)) {
    console.error('✗ подробности забега должны раскрываться из компактного game-over'); process.exit(1);
  }
  if (/leaderboard-rule|Глобальная доска результатов|сервер видел/.test(html)) {
    console.error('✗ в разметке остался удалённый служебный текст рейтинга'); process.exit(1);
  }
  if (!/UI\.showOverBoard\(result\)/.test(main)) {
    console.error('✗ серверный результат сохранён, но не показан после забега'); process.exit(1);
  }
  if (!/\.leaderboard-head\s*\{[^}]*display:\s*grid/s.test(css)
      || !/\.board-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3/s.test(css)) {
    console.error('✗ шапка рейтинга должна быть двухрядной адаптивной сеткой'); process.exit(1);
  }
  if (!/#dashboard-screen\s*\{[^}]*align-items:\s*flex-start/s.test(css)
      || !/\.icon-action\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s.test(css)) {
    console.error('✗ длинная доска или кнопка обновления нарушают мобильный UX'); process.exit(1);
  }
  if (!/const isTelegramWebApp = Boolean/.test(main)
      || !/isVersionAtLeast\?\.\('7\.7'\)/.test(main)
      || !/isVersionAtLeast\?\.\('6\.9'\) \? tg : null/.test(main)) {
    console.error('✗ Telegram SDK вызывается вне мини-приложения или без проверки версии'); process.exit(1);
  }
  if (!/id="boot-splash"/.test(html)
      || !/html, body \{[^}]*background:\s*#05010a/s.test(html)
      || !/style\.css\?v=[\w.-]+/.test(html)
      || !/main\.js\?v=[\w.-]+/.test(html)
      || !/__uboostTelegramReady/.test(html)
      || /<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/.test(html)
      || !/bootSplash\.remove\(\)/.test(main)) {
    console.error('✗ первый кадр Telegram Desktop должен быть тёмным и не зависеть от CSS/ES-модулей'); process.exit(1);
  }
  // Версия у CSS и модуля обязана совпадать: половинчатый бамп даёт игроку
  // свежий js со старым css (или наоборот) — ровно та рассинхронизация кэша,
  // из-за которой на проде уже ловили белый экран.
  const cssV = html.match(/style\.css\?v=([\w.-]+)/)?.[1];
  const jsV = html.match(/main\.js\?v=([\w.-]+)/)?.[1];
  if (!cssV || cssV !== jsV) {
    console.error(`✗ версии статики рассинхронизированы: css=${cssV}, js=${jsV}`); process.exit(1);
  }
}
console.log('✓ mobile UX компактен, Telegram SDK ограничен, белый первый кадр исключён');

// --- тест аналитики (PR9: новые события проходят через адаптер) ---------------
const { Analytics } = await import('../src/engine/analytics.js');
{
  const captured = [];
  Analytics.use({ track: (event, props) => captured.push({ event, props }) });
  Analytics.landing({ variant: 'control' });
  Analytics.tutorialStep({ step: 1 });
  Analytics.pause({ action: 'enter' });
  Analytics.settingsChange({ key: 'colorAssist', value: true });
  Analytics.captchaResult({ result: 'solved' });
  Analytics.zoneReached({ zone: 2 });
  Analytics.session({ n: 3 });
  Analytics.challengeOpened({ score: 500 });
  Analytics.gagShown({ type: 'dns' });
  Analytics.shareResult({ method: 'web_share', ok: true });
  const events = captured.map((c) => c.event);
  for (const e of ['landing', 'tutorial_step', 'pause', 'settings_change', 'captcha_result', 'zone_reached', 'session_n', 'challenge_opened', 'gag_shown', 'share_result']) {
    if (!events.includes(e)) { console.error('✗ аналитика: событие не отправлено', e); process.exit(1); }
  }
  const ss = captured.find((c) => c.event === 'settings_change');
  if (ss.props.key !== 'colorAssist' || ss.props.value !== true || !ss.props.occurredAt || ss.props.schemaVersion !== 2 || !ss.props.eventId) {
    console.error('✗ аналитика: props settings_change неверны', ss.props); process.exit(1);
  }
}
console.log('✓ аналитика: новые события проходят через адаптер с props');

// --- дашборд: локальные агрегаты не требуют сети и не содержат PII ----------
const { DashboardStore } = await import('../src/game/dashboard.js');
{
  delete localStorage._d.uboost_runner_dashboard_v1;
  const dashboard = new DashboardStore();
  dashboard.track('game_start');
  dashboard.track('game_over', { score: 400, distance: 250 });
  dashboard.track('game_over', { score: 600, distance: 550 });
  dashboard.track('share');
  dashboard.track('cta_click');
  const data = dashboard.overview(600);
  if (data.best !== 600 || data.runs !== 2 || data.avgDistance !== 400 || data.shares !== 1 || data.cta !== 1 || data.conversion !== 50) {
    console.error('✗ dashboard: неверные локальные агрегаты', data); process.exit(1);
  }
}
console.log('✓ дашборд: локальные метрики корректно агрегируются');

// --- доска результатов: без endpoint честно остаётся локальной -------------
const { Leaderboard } = await import('../src/game/leaderboard.js');
{
  delete localStorage._d.uboost_runner_leaderboard_v1;
  const board = new Leaderboard('', 10);
  await board.submit({ score: 450, distance: 300 });
  await board.submit({ score: 700, distance: 480 });
  if (board.mode !== 'local' || board.entries.length !== 1 || board.entries[0].score !== 700) {
    console.error('✗ leaderboard: локальный фолбэк или best-score неверны', board); process.exit(1);
  }
}
console.log('✓ доска результатов: локальный фолбэк и лучший счёт работают');

// --- доска: verified-маркер без служебного текста ----------------------------
{
  const UI = await import('../src/ui/screens.js');
  const overview = { best: 100, runs: 1, avgDistance: 50, shares: 0, cta: 0, conversion: 0 };
  const entries = [
    { playerId: 'a', alias: 'Подтверждён', score: 900, distance: 120, verified: true, tg: true },
    { playerId: 'b', alias: 'Без сессии', score: 800, distance: 110, verified: false, tg: false },
    { playerId: 'c', alias: 'Третий', score: 700, distance: 100, verified: true, tg: true },
    { playerId: 'd', alias: 'Четвёртый', score: 600, distance: 90, verified: true, tg: true },
    { playerId: 'e', alias: 'Пятый', score: 500, distance: 80, verified: true, tg: true },
    { playerId: 'f', alias: 'Шестой', score: 400, distance: 70, verified: true, tg: true },
  ];
  UI.showDashboard(overview, { mode: 'global', board: 'best', period: 'week', entries, me: null, name: '' });
  if (UI.dom.dashboardTitle.textContent !== 'ДОСКА ПОЧЁТА') {
    console.error('✗ экран рейтинга не назван «Доска почёта»', UI.dom.dashboardTitle.textContent); process.exit(1);
  }
  const html = UI.dom.leaderboardList.innerHTML;
  const rows = html.split('<li');
  if (!/leader-verified/.test(rows[1] || '')) {
    console.error('✗ доска: verified-забег остался без значка ✓', html); process.exit(1);
  }
  if (/leader-verified/.test(rows[2] || '')) {
    console.error('✗ доска: неподтверждённый забег получил значок ✓', html); process.exit(1);
  }
  if (/сервер/i.test(rows[1] || '') || STR.boardPrizeRule || STR.leaderboardGlobal) {
    console.error('✗ доска содержит удалённый служебный текст про сервер/глобальность'); process.exit(1);
  }
  if ((html.match(/<li/g) || []).length !== 5 || UI.dom.btnLeaderboardMore.classList.contains('hidden')) {
    console.error('✗ доска должна показывать топ-5 и кнопку раскрытия', html); process.exit(1);
  }
  UI.toggleLeaderboardExpanded();
  if ((UI.dom.leaderboardList.innerHTML.match(/<li/g) || []).length !== entries.length) {
    console.error('✗ кнопка раскрытия не показала весь загруженный рейтинг'); process.exit(1);
  }
  if (!UI.dom.leaderboardStatus.classList.contains('hidden') || UI.dom.leaderboardStatus.textContent) {
    console.error('✗ глобальная доска показывает лишнюю служебную подпись'); process.exit(1);
  }
  if (!UI.dom.btnMute.classList.contains('hidden') || !UI.dom.btnSettings.classList.contains('hidden')) {
    console.error('✗ верхние контролы перекрывают заголовок доски'); process.exit(1);
  }
  UI.showDashboard(overview, { mode: 'local', board: 'best', period: 'week', entries, me: null, name: '' });
  if (UI.dom.leaderboardStatus.classList.contains('hidden') || !UI.dom.leaderboardStatus.textContent) {
    console.error('✗ локальная доска не объясняет режим без сервера'); process.exit(1);
  }
  UI.hideDashboard();
  if (UI.dom.btnMute.classList.contains('hidden') || UI.dom.btnSettings.classList.contains('hidden')) {
    console.error('✗ верхние контролы не восстановились после закрытия доски'); process.exit(1);
  }

  UI.showOverBoard({ mode: 'global', board: 'best', entries, me: { rank: 6, score: 400, total: 6 } });
  if (UI.dom.overBoard.classList.contains('hidden') || !UI.dom.overBoardPlace.textContent.includes('#6')) {
    console.error('✗ game-over не показывает серверное место игрока'); process.exit(1);
  }
  UI.dom.runDetails.classList.add('hidden');
  UI.toggleRunDetails();
  if (UI.dom.runDetails.classList.contains('hidden') || UI.dom.btnRunDetails.getAttribute('aria-expanded') !== 'true') {
    console.error('✗ подробности забега не раскрываются'); process.exit(1);
  }
  UI.toggleRunDetails();
  if (!UI.dom.runDetails.classList.contains('hidden')) {
    console.error('✗ подробности забега не сворачиваются'); process.exit(1);
  }
}
console.log('✓ доска: топ-5, место, verified-маркер и чистый пользовательский копирайт работают');

// --- Telegram ID: берём только вместе с подписанным initData -----------------
const { telegramIdentity } = await import('../src/game/telegram-identity.js');
{
  const identity = telegramIdentity({ initData: 'user=%7B%22id%22%3A123456789%7D&hash=signed', initDataUnsafe: { user: { id: 123456789 } } });
  if (identity?.userId !== '123456789' || !identity.initData.includes('hash=')) {
    console.error('✗ Telegram identity: корректный initData не прочитан', identity); process.exit(1);
  }
  if (telegramIdentity({ initData: '', initDataUnsafe: { user: { id: 123456789 } } }) !== null) {
    console.error('✗ Telegram identity: ID без initData нельзя принимать'); process.exit(1);
  }
}
console.log('✓ Telegram ID: клиент требует initData для серверной проверки');

// --- Анти-чит: потолок очков временной, а не «за метр» ----------------------
// Очки набегают с колонн (они приходят по времени), а не с метров. Всплеск
// X2+комбо законно даёт до ~121 очк/м, поэтому лимит «очки <= метры*N» резал
// честных игроков: живой забег tg:41515897 (+5021 за 68 м = 74 очк/м, вдвое
// НИЖЕ физического потолка) терял verified и приз. Тест считает физический
// максимум из config.js и следит, чтобы серверные константы его покрывали.
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
  const perSec = Number(/const MAX_SCORE_PER_SEC = (\d+)/.exec(src)?.[1]);
  const perMeter = Number(/const MAX_SCORE_PER_METER = (\d+)/.exec(src)?.[1]);
  // Потолок одной колонны: near-miss (комбо капается на 8) + биты (множитель
  // капается на 3) + dodge двух препятствий — всё под X2.
  const perCol = CONFIG.SCORE_NEAR_MISS * 8 * CONFIG.X2_MULT
    + CONFIG.BITS_PER_COL * CONFIG.SCORE_BIT * 3 * CONFIG.X2_MULT
    + CONFIG.SCORE_PER_DODGE * 2 * CONFIG.X2_MULT;
  let maxPerSec = 0, maxPerMeter = 0;
  for (let speed = CONFIG.BASE_SPEED; speed <= CONFIG.MAX_SPEED; speed += 10) {
    const spacingPx = Math.max(CONFIG.COL_SPACING_MIN, speed * CONFIG.REACT_TIME);
    maxPerSec = Math.max(maxPerSec, perCol / (spacingPx / speed));
    maxPerMeter = Math.max(maxPerMeter, perCol / (spacingPx * 0.02));
  }
  if (!Number.isFinite(perSec) || perSec < maxPerSec) {
    console.error(`✗ MAX_SCORE_PER_SEC=${perSec} ниже физического потолка ${Math.ceil(maxPerSec)} — честный всплеск X2+комбо потеряет verified`); process.exit(1);
  }
  if (!Number.isFinite(perMeter) || perMeter < maxPerMeter) {
    console.error(`✗ MAX_SCORE_PER_METER=${perMeter} ниже физического потолка ${Math.ceil(maxPerMeter)} — сильный игрок словит 422 на честном забеге`); process.exit(1);
  }
  // Дельты обязаны меряться временем: привязка к дистанции — та самая ошибка.
  if (!/dScore <= \(dtSec \+ 2\) \* MAX_SCORE_PER_SEC \+ extra/.test(src)) {
    console.error('✗ plausibleDelta должен ограничивать очки временем, а не дистанцией'); process.exit(1);
  }
}
console.log('✓ анти-чит: потолок очков временной и покрывает всплеск X2+комбо');

// --- Mini App: призёр регистрируется сам, без кода привязки ------------------
// initData подписан токеном бота, значит id/username достоверны — игроку не
// нужно слать код, чтобы получить приз. Без записи в telegram_links
// notify-winners не найдёт chat_id и приз молча не уедет.
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
  if (!/return \{ id, username: String\(user\?\.username/.test(src)) {
    console.error('✗ verifyTelegramInitData должен отдавать username/firstName для авто-регистрации'); process.exit(1);
  }
  if (!/if \(registerTelegram\)[\s\S]*qLinkUpsert\.run\(playerId, telegram\.id/.test(src)) {
    console.error('✗ защищённая Mini App-сессия должна авто-регистрировать игрока в telegram_links'); process.exit(1);
  }
  // Рассылка призов обязана оставаться привязанной к verified — иначе накрутчик
  // получит приз наравне с честным игроком.
  const notify = await readFile(new URL('../backend/notify-winners.mjs', import.meta.url), 'utf8');
  const verifiedGuards = (notify.match(/r\.verified = 1/g) || []).length;
  if (verifiedGuards < 2) {
    console.error(`✗ notify-winners: фильтр verified=1 найден ${verifiedGuards} раз — призы должны идти только по подтверждённым забегам`); process.exit(1);
  }
}
console.log('✓ Mini App: подписанный initData авто-регистрирует призёра (без кода привязки)');

// --- Бот ведёт в Mini App, а не во внешний браузер ---------------------------
// Играть нужно ВНУТРИ Telegram: игрок опознаётся подписанным initData, а во внешнем
// браузере его нет — забег не зарегистрируется и приз не начислится. Голая ссылка
// на игру в тексте ответа бота уводит тапом в системный браузер; так и было в /top
// («Обойди их: https://31.130.148.55/»). Ответы обязаны звать кнопкой.
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
  if (/\$\{GAME_URL_BOT\}/.test(src)) {
    console.error('✗ бот: голая ссылка на игру подставлена в текст ответа — тап уводит из Telegram, initData теряется'); process.exit(1);
  }
  if (!/web_app:\s*\{\s*url\s*\}/.test(src) || !/let url = GAME_URL_BOT;/.test(src)) {
    console.error('✗ бот: потерялась web_app-кнопка на GAME_URL_BOT, открывающая Mini App внутри Telegram'); process.exit(1);
  }
  // web_app вне приватного чата Telegram отвергает целиком — в группе нужен t.me-путь.
  if (!/chatType === 'private'/.test(src) || !/t\.me\/\$\{botUsername\}\?startapp/.test(src)) {
    console.error('✗ бот: web_app недопустим вне приватного чата — для групп нужен t.me/<бот>?startapp'); process.exit(1);
  }
  // /lite: кнопка «в лёгком режиме» и контракт с игрой (?lite=1 / startapp=lite).
  // Если один конец переименуют, второй перестанет включать режим молча.
  if (!/\/\^\\\/lite\//.test(src) || !/searchParams\.set\('lite', '1'\)/.test(src)) {
    console.error('✗ бот: команда /lite должна открывать игру с ?lite=1'); process.exit(1);
  }
  if (!/startapp=\$\{lite \? 'lite' : 'play'\}/.test(src)) {
    console.error('✗ бот: вне привата лёгкий режим должен идти через startapp=lite'); process.exit(1);
  }
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  if (!/get\('lite'\) === '1'/.test(main) || !/start_param === 'lite'/.test(main)) {
    console.error('✗ игра: deep-link лёгкого режима (?lite=1 / start_param "lite") не читается — кнопка бота молча не работает'); process.exit(1);
  }
}
console.log('✓ бот: зовёт кнопкой в Mini App, голых ссылок на игру в тексте нет');

// --- Копирование: ни один путь не должен зависеть только от clipboard --------
// Прод раздаётся по голому HTTP → isSecureContext=false → navigator.clipboard
// undefined (проверено на 31.130.148.55). Любое «скопировать» без
// execCommand-фолбэка там молча не срабатывает и рвёт виральную петлю.
// Так уже было: у промокода и «вызова» фолбэк был, у кнопки шеринга — нет.
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const direct = src.match(/navigator\.clipboard\.writeText/g) || [];
  if (direct.length !== 1) {
    console.error(`✗ navigator.clipboard.writeText встречается ${direct.length} раз — копирование должно идти через copyText() с фолбэком`); process.exit(1);
  }
  if (!/async function copyText[\s\S]*?legacyCopy\(text\)/.test(src)) {
    console.error('✗ copyText() должен падать в legacyCopy(), когда clipboard недоступен'); process.exit(1);
  }
  if (!/document\.execCommand\('copy'\)/.test(src)) {
    console.error('✗ legacyCopy потерял execCommand-фолбэк'); process.exit(1);
  }
}
console.log('✓ копирование: единый copyText с execCommand-фолбэком (работает без HTTPS)');

// --- Кривая скорости: забег обязан упираться в стену за разумное время -------
// Дистанция = px * 0.02 (stats.addDistance), поэтому «метры» жёстко связаны с
// секундами: интегрируем dd/dt = baseSpeed(d) * 0.02 и проверяем, что плато
// MAX_SPEED достижимо внутри забега, а не на 15-й минуте (так было при
// SPEED_GROWTH=5: плато на 11 600 м, и скорость росла на 5% за весь реальный забег).
{
  const plateauDist = ((CONFIG.MAX_SPEED - CONFIG.BASE_SPEED) / CONFIG.SPEED_GROWTH) * 100;
  const speedAt = (d) => {
    let base = Math.min(CONFIG.MAX_SPEED, CONFIG.BASE_SPEED + (d / 100) * CONFIG.SPEED_GROWTH);
    const over = d - plateauDist;
    if (over > 0) base *= 1 + Math.min(CONFIG.SPEED_CREEP_MAX, (over / CONFIG.SPEED_CREEP_STEP) * 0.01);
    return base;
  };
  let d = 0, t = 0;
  while (d < plateauDist && t < 3600) { d += speedAt(d) * 0.02 * 0.01; t += 0.01; }
  if (t > 240) {
    console.error(`✗ плато скорости достигается за ${Math.round(t)}с (${Math.round(plateauDist)} м) — забег не заканчивается стеной`); process.exit(1);
  }
  if (t < 60) {
    console.error(`✗ плато скорости достигается за ${Math.round(t)}с — слишком резко для новичка`); process.exit(1);
  }
  // Пик плотности должен приходить раньше плато скорости: два пика не
  // складываются в один момент, сначала плотность, потом скорость.
  if (CONFIG.DIFF_DIST >= plateauDist) {
    console.error(`✗ DIFF_DIST=${CONFIG.DIFF_DIST} не раньше плато скорости (${Math.round(plateauDist)} м)`); process.exit(1);
  }
  // Волна ритма должна укладываться в забег, иначе игрок видит лишь её половину.
  if (CONFIG.WAVE_PERIOD > CONFIG.DIFF_DIST) {
    console.error(`✗ WAVE_PERIOD=${CONFIG.WAVE_PERIOD} длиннее DIFF_DIST — ритм не успевает проявиться`); process.exit(1);
  }
}
console.log('✓ кривая скорости: плато достижимо за забег, плотность пикует раньше скорости');

// --- Верификация: допуск финальной сверки покрывает разовые бонусы -----------
// Бонус миссий и бонус капчи начисляются УЖЕ ПОСЛЕ последней heartbeat-отметки
// и без пробега, поэтому у сервера должен быть допуск не меньше их суммы —
// иначе честный забег (умер в концовке капчи) молча теряет verified и приз.
// Тест связывает config.js с константой сервера: добавишь жирную миссию — упадёт тут.
{
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
  const allowance = Number(/const END_BONUS_ALLOWANCE = (\d+)/.exec(src)?.[1]);
  const top3 = CONFIG.MISSIONS.map((m) => m.reward).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const maxEndBonus = top3 + CONFIG.SCORE_CAPTCHA_SOLVE;
  if (!Number.isFinite(allowance)) {
    console.error('✗ END_BONUS_ALLOWANCE не найден в backend/server.js'); process.exit(1);
  }
  if (allowance < maxEndBonus) {
    console.error(`✗ END_BONUS_ALLOWANCE=${allowance} меньше максимума разовых бонусов (${maxEndBonus}) — честные забеги потеряют verified`); process.exit(1);
  }
  // Допуск даётся ТОЛЬКО финальной сверке: на обычных отметках лимит тугой,
  // иначе читер накручивал бы по +900 на каждой отметке забега.
  if (!/plausibleDelta\(dScore, dDistance, dt\)/.test(src)) {
    console.error('✗ /v1/run/beat должен звать plausibleDelta без допуска END_BONUS_ALLOWANCE'); process.exit(1);
  }
  if (!/plausibleRunTotals\(score, distance, \(now - session\.started_at\) \/ 1000\)/.test(src)) {
    console.error('✗ /v1/run/beat должен проверять суммарную дистанцию по envelope скорости/бустов'); process.exit(1);
  }
  // [\s\S]*? — в вызове есть вложенные скобки ((now - last_beat_at) / 1000 + 6),
  // поэтому [^)]* обрывается на первой из них.
  if (!/finalOk = plausibleDelta\([\s\S]*?END_BONUS_ALLOWANCE\)/.test(src)) {
    console.error('✗ финальная сверка /v1/scores должна применять END_BONUS_ALLOWANCE'); process.exit(1);
  }
}
console.log('✓ верификация: допуск финальной сверки покрывает бонусы миссий/капчи');

// --- Worker: Telegram HMAC проверяется независимо от клиентского ID ----------
{
  const { createHmac } = await import('node:crypto');
  const { verifyTelegramInitData } = await import('../backend/worker.js');
  const token = '123456:TEST_BOT_TOKEN';
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'test-query',
    user: JSON.stringify({ id: 123456789 }),
  });
  const check = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  const signed = params.toString();
  const verified = await verifyTelegramInitData(signed, token);
  const tampered = new URLSearchParams(signed);
  tampered.set('user', JSON.stringify({ id: 999999999 }));
  if (verified?.id !== '123456789' || await verifyTelegramInitData(tampered.toString(), token) !== null) {
    console.error('✗ Worker: Telegram HMAC validation неверна'); process.exit(1);
  }
}
console.log('✓ Worker: Telegram initData проверяется криптографически');

// --- Тумблер «Графика» рядом со звуком ---------------------------------------
// Тест идёт последним: клик пишет настройки живого стора игры и перетирает блоб.
{
  const g = els['set-graphics'];
  if (!g._handlers.click?.length) { console.error('✗ графика: тумблер без обработчика клика'); process.exit(1); }
  const click = () => g._handlers.click.forEach((fn) => fn());
  click();
  if (g._text !== 'ЛЁГКАЯ' || new SettingsStore().get('graphics') !== 'lite') {
    console.error('✗ графика: клик не включил лёгкий режим', g._text); process.exit(1);
  }
  // Реальный игровой цикл в лёгком режиме: рендер-путь тира 0 с DPR 1 не должен
  // ни бросать, ни останавливать мир (иначе «оптимизация» убьёт забег).
  els['btn-restart']._handlers.click?.forEach((fn) => fn());
  runFrames(30);
  const liteDistA = els['dist-display']._text;
  runFrames(120);
  if (els['dist-display']._text === liteDistA) {
    console.error('✗ графика: в лёгком режиме мир не движется', liteDistA); process.exit(1);
  }
  click();
  if (g._text !== 'АВТО' || new SettingsStore().get('graphics') !== 'auto') {
    console.error('✗ графика: повторный клик не вернул АВТО', g._text); process.exit(1);
  }
  // И обратно: выключение лёгкого режима не ломает уже идущий забег.
  runFrames(120);
  if (!els['dist-display']._text) { console.error('✗ графика: HUD пропал после возврата в АВТО'); process.exit(1); }
  // Проводка кнопок подсказки: «ВКЛЮЧИТЬ ЛЁГКУЮ» реально переключает режим и
  // закрывает будущие подсказки, «НЕ НАДО» — скрывает блок, не меняя режим.
  const hint = els['lite-hint'];
  hint.classList.remove('hidden');
  els['btn-lite-hint-on']._handlers.click?.forEach((fn) => fn());
  if (!hint.classList.contains('hidden')) { console.error('✗ подсказка: блок не скрылся после согласия'); process.exit(1); }
  {
    const s = new SettingsStore();
    if (s.get('graphics') !== 'lite' || s.get('graphicsTouched') !== true) {
      console.error('✗ подсказка: согласие не включило лёгкий режим', s.data); process.exit(1);
    }
    if (g._text !== 'ЛЁГКАЯ') { console.error('✗ подсказка: тумблер в настройках не отразил согласие', g._text); process.exit(1); }
  }
  hint.classList.remove('hidden');
  els['btn-lite-hint-off']._handlers.click?.forEach((fn) => fn());
  if (!hint.classList.contains('hidden')) { console.error('✗ подсказка: блок не скрылся после отказа'); process.exit(1); }
  {
    // «Не надо» значит «оставь как есть»: режим не меняется (он остался lite от
    // предыдущего согласия), но подсказки закрываются.
    const s = new SettingsStore();
    if (s.get('graphics') !== 'lite' || s.get('graphicsTouched') !== true) {
      console.error('✗ подсказка: отказ не должен менять режим графики', s.data); process.exit(1);
    }
  }
  // Новый забег не должен «донашивать» показанную подсказку.
  hint.classList.remove('hidden');
  els['btn-restart']._handlers.click?.forEach((fn) => fn());
  if (!hint.classList.contains('hidden')) { console.error('✗ подсказка: висит в новом забеге'); process.exit(1); }

  // Строка настройки подписана и стоит рядом со звуком (порядок — в index.html).
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  if (!/set-sound"[\s\S]{0,200}id="set-graphics"/.test(html)) {
    console.error('✗ графика: тумблер должен стоять сразу после звука в настройках'); process.exit(1);
  }
  if (els['set-graphics-label']._text !== 'Графика') {
    console.error('✗ графика: подпись настройки не заполнена из strings.js'); process.exit(1);
  }
}
console.log('✓ графика: тумблер АВТО ⇄ ЛЁГКАЯ рядом со звуком, состояние переживает перезапуск');

// --- Технический забег: порог один на клиенте и сервере ----------------------
// Клиент и метрики считают забег «настоящим» по CONFIG.MIN_MEANINGFUL_RUN_SEC,
// сервер по нему же отказывает в верификации (TOKEN_MIN_AGE_S) и режет спам
// рестартом. Разъедутся значения — метрики начнут врать в обе стороны молча.
{
  const { readFile } = await import('node:fs/promises');
  const srv = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
  const serverSec = Number(srv.match(/const TOKEN_MIN_AGE_S\s*=\s*(\d+)/)?.[1]);
  if (!Number.isFinite(serverSec)) { console.error('✗ технический забег: не нашёл TOKEN_MIN_AGE_S в server.js'); process.exit(1); }
  if (CONFIG.MIN_MEANINGFUL_RUN_SEC !== serverSec) {
    console.error(`✗ технический забег: порог клиента ${CONFIG.MIN_MEANINGFUL_RUN_SEC} с ≠ серверного ${serverSec} с`); process.exit(1);
  }
  // Воронка обязана считать забеги по run_summary (там есть длительность) и
  // отделять технические, иначе спам рестартом завышает забеги и занижает
  // среднюю дистанцию — ровно то, что поймали на проде 2026-08-06.
  if (!/event = 'run_summary' AND json_extract\(props_json, '\$\.durationMs'\) >= \?/.test(srv)
      || !/AS shortRuns/.test(srv)) {
    console.error('✗ воронка: забеги должны считаться по run_summary с порогом длительности и отдельной строкой технических'); process.exit(1);
  }
  if (/SUM\(CASE WHEN event = 'game_over'\s+THEN 1 ELSE 0 END\) AS runs/.test(srv)) {
    console.error('✗ воронка: забеги всё ещё считаются по game_over без длительности'); process.exit(1);
  }
  // Лимит спама: только для коротких забегов и только сверх честного максимума.
  // Значение берётся из env с дефолтом — проверяем именно дефолт: в проде env
  // не задан, и порог по умолчанию обязан оставаться выше честного максимума.
  const limit = Number(srv.match(/const SHORT_RUN_FLOOD_PER_HOUR\s*=[^;]*\|\|\s*(\d+)/)?.[1]);
  if (!(limit >= 10 && limit <= 30)) {
    console.error(`✗ лимит спама: SHORT_RUN_FLOOD_PER_HOUR = ${limit} вне разумных границ (честный максимум на проде — 8 в час)`); process.exit(1);
  }
  if (!/shortRun && shortRunFlood\(playerId\)/.test(srv)) {
    console.error('✗ лимит спама: должен срабатывать только на технических забегах, а не на любых'); process.exit(1);
  }
}
console.log('✓ технический забег: порог согласован клиент↔сервер, воронка их отделяет, лимит спама только для них');

// --- Профиль ввода: анти-чит по стабильности, а не по скорости ----------------
// Скрипт от человека отличает не скорость, а разброс: у автоматизации интервалы
// между сменами полосы почти одинаковые. Копим суммы, а не историю событий —
// иначе длинный забег начал бы аллоцировать память на каждый свайп.
{
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const field of ['inN', 'inMeanMs', 'inSdMs', 'inMinMs', 'inFast', 'inQN', 'inQuant', 'rtN', 'rtMeanMs', 'rtSdMs']) {
    if (!new RegExp(`\\b${field}:`).test(main)) { console.error(`✗ профиль ввода: нет поля ${field}`); process.exit(1); }
  }
  if (!/inputProfile\(runMetrics\)/.test(main)) { console.error('✗ профиль ввода: агрегаты не уходят в run_summary'); process.exit(1); }
  // Гистограмма выделяется один раз на забег, а не на каждый ввод.
  const inMove = main.match(/function moveLane\([\s\S]*?\n}/)?.[0] || '';
  if (/new Array|\.push\(|new Set|new Map/.test(inMove)) {
    console.error('✗ профиль ввода: moveLane аллоцирует на каждый ввод — так нельзя'); process.exit(1);
  }
  if (!/inBuckets: new Array\(24\)/.test(main)) { console.error('✗ профиль ввода: гистограмма должна создаваться один раз в runMetrics'); process.exit(1); }
  // Корзина обязана быть шире человеческого ритма. Прод показал: живой игрок
  // меняет полосу раз в ~1.1 с, при шаге 25 мс всё падало в последнюю корзину и
  // «квантование» врало единицей. Диапазон гистограммы должен покрывать ≥ 2 с,
  // а интервалы вне диапазона в неё не идут (иначе медленная игра = «ровный ритм»).
  const step = Number(main.match(/\(gap \/ (\d+)\) \| 0/)?.[1]);
  const span = Number(main.match(/gap < (\d+)\) \{ runMetrics\.inBuckets/)?.[1]);
  if (!(step >= 50 && span >= 2000 && span / step <= 24)) {
    console.error(`✗ профиль ввода: корзина ${step} мс на диапазон ${span} мс не покрывает человеческий ритм`); process.exit(1);
  }
  if (!/inQuant: m\.inQN \?/.test(main)) {
    console.error('✗ профиль ввода: квантование должно считаться от попавших в гистограмму (inQN), а не от всех вводов'); process.exit(1);
  }
  // Проверка самой арифметики разброса на синтетических данных.
  const sd = (n, sum, sumSq) => (n > 1 ? Math.sqrt(Math.max(0, (sumSq - (sum * sum) / n) / (n - 1))) : 0);
  const human = [180, 420, 260, 900, 340, 210, 1500, 380];
  const bot = [250, 250, 251, 249, 250, 250, 250, 251];
  const stat = (arr) => { const n = arr.length, s = arr.reduce((a, b) => a + b, 0), q = arr.reduce((a, b) => a + b * b, 0); return sd(n, s, q) / (s / n); };
  if (!(stat(human) > 0.5)) { console.error('✗ профиль ввода: человеческий ритм должен давать большой разброс, получили', stat(human)); process.exit(1); }
  if (!(stat(bot) < 0.05)) { console.error('✗ профиль ввода: ровный машинный ритм должен давать разброс близкий к нулю, получили', stat(bot)); process.exit(1); }
}
console.log('✓ профиль ввода: поля на месте, без аллокаций на ввод, разброс различает ритм человека и скрипта');

// --- Кэш свечения и градиентов: инварианты -----------------------------------
// shadowBlur и создание градиентов на каждом кадре — главные статьи расхода
// Canvas 2D (docs/solutions/2026-06-08-canvas-shadow-performance.md), поэтому
// статичные части сцены кэшируются. Два инварианта, которые легко нарушить:
// слой обязан быть в пикселях устройства (иначе блит растянет неон в мыло), а
// градиент нельзя переиспользовать в другом контексте (CanvasGradient привязан
// к своему канвасу — шеринг-карточка рисуется на отдельном).
{
  const { layerScale, makeLayer } = await import('../src/engine/render.js');
  const fake = { getTransform: () => ({ a: 2.5 }) };
  if (layerScale(fake) !== 2.5) { console.error('✗ кэш слоёв: layerScale не читает масштаб контекста'); process.exit(1); }
  if (layerScale({}) !== 1) { console.error('✗ кэш слоёв: без getTransform масштаб должен быть 1'); process.exit(1); }

  const layer = makeLayer(100, 40, 2);
  if (!layer || layer.cv.width !== 200 || layer.cv.height !== 80) {
    console.error('✗ кэш слоёв: буфер должен быть в пикселях устройства (100x40 @2 → 200x80)', layer?.cv?.width, layer?.cv?.height);
    process.exit(1);
  }

  const { readFile } = await import('node:fs/promises');
  for (const [file, what] of [['../src/game/world.js', 'небо'], ['../src/engine/postfx.js', 'виньетка'], ['../src/main.js', 'оверлей скорости']]) {
    const src = await readFile(new URL(file, import.meta.url), 'utf8');
    const caches = src.match(/create(?:Linear|Radial)Gradient/g) || [];
    if (caches.length && !/ctx !== ctx|\.ctx !== ctx/.test(src)) {
      console.error(`✗ кэш градиентов (${what}): ключ кэша обязан включать контекст — иначе градиент утечёт на другой канвас`); process.exit(1);
    }
  }

  // Мир рисуется в два разных контекста подряд (игровой кадр и шеринг-карточка):
  // кэши не должны ни падать, ни рисовать мимо.
  const { World } = await import('../src/game/world.js');
  const w = new World();
  const ctxA = global.document.createElement('canvas').getContext('2d');
  const ctxB = global.document.createElement('canvas').getContext('2d');
  try {
    for (const c of [ctxA, ctxB, ctxA]) { w.update(1 / 60, 900, 500); w.draw(c, 414, 896, 900, false); }
  } catch (error) {
    console.error('✗ кэш слоёв: отрисовка мира в другой контекст падает:', error.message); process.exit(1);
  }
}
console.log('✓ кэш свечения/градиентов: слой в пикселях устройства, градиент не утекает между канвасами');

// --- Авто-подсказка лёгкого режима -------------------------------------------
// Помощь нужна ~46% забегов, а настройку находят 4.6% сессий (прод, 2026-08-05),
// поэтому игру просят предложить режим сама. Условия бережности под тестом:
// не чаще HINT_MAX раз, только при реальной просадке, только на дне адаптации,
// и никогда — если игрок уже сам выбирал режим.
{
  const { SettingsStore: SS } = await import('../src/game/settings.js');
  const MAX = CONFIG.QUALITY.HINT_MAX;
  if (!(MAX >= 1 && MAX <= 3)) { console.error('✗ подсказка: HINT_MAX вне разумных границ', MAX); process.exit(1); }

  // Лимит: после MAX показов больше не предлагаем.
  saveFlag('settings', { graphics: 'auto' });
  const s = new SS();
  for (let i = 0; i < MAX; i++) {
    if (!s.mayHintLite(MAX)) { console.error(`✗ подсказка: отказалась показываться на попытке ${i + 1} из ${MAX}`); process.exit(1); }
    s.noteLiteHint();
  }
  if (s.mayHintLite(MAX)) { console.error('✗ подсказка: лимит HINT_MAX не соблюдается'); process.exit(1); }
  if (new SS().mayHintLite(MAX)) { console.error('✗ подсказка: счётчик показов не переживает перезапуск'); process.exit(1); }

  // Осознанный выбор игрока (тумблер или ответ на подсказку) закрывает подсказки.
  saveFlag('settings', { graphics: 'auto' });
  const s2 = new SS();
  s2.noteGraphicsDecline();                // игрок нажал «НЕ НАДО»
  if (s2.mayHintLite(MAX)) { console.error('✗ подсказка: после выбора игрока предложения должны прекратиться'); process.exit(1); }
  const s3 = new SS();
  if (s3.mayHintLite(MAX)) { console.error('✗ подсказка: выбор игрока не переживает перезапуск'); process.exit(1); }
  if (s3.get('graphics') !== 'auto') { console.error('✗ подсказка: отказ не должен менять режим графики'); process.exit(1); }

  // Уже в лёгком режиме — предлагать нечего.
  saveFlag('settings', { graphics: 'lite' });
  if (new SS().mayHintLite(MAX)) { console.error('✗ подсказка: в лёгком режиме предложение бессмысленно'); process.exit(1); }

  // Битый счётчик (правка руками, откат версии) не должен ни ломать, ни
  // открывать бесконечные показы.
  saveFlag('settings', { graphics: 'auto', liteHints: 'много' });
  const s4 = new SS();
  if (s4.get('liteHints') !== 0 || !s4.mayHintLite(MAX)) { console.error('✗ подсказка: битый счётчик обработан неверно', s4.data); process.exit(1); }

  // Событие подсказки обязано быть разрешено на сервере и в worker: иначе
  // /v1/events ответит invalid_event и мы не измерим принятие.
  const { readFile } = await import('node:fs/promises');
  for (const f of ['../backend/server.js', '../backend/worker.js']) {
    const src = await readFile(new URL(f, import.meta.url), 'utf8');
    if (!/'lite_hint'/.test(src)) { console.error(`✗ подсказка: событие lite_hint не разрешено в ${f}`); process.exit(1); }
  }
  // Условие показа — таблицей случаев (чистая функция shouldOfferLite).
  const { shouldOfferLite } = await import('../src/engine/quality.js');
  const BAD = CONFIG.QUALITY.HINT_FRAME_MS + 5;
  const LONG = (CONFIG.QUALITY.HINT_MIN_SEC + 5) * 1000;
  const cases = [
    ['тормозящий длинный забег на дне тира', { frameAvgMs: BAD, durationMs: LONG, tier: 0 }, true],
    ['ровные кадры', { frameAvgMs: CONFIG.QUALITY.HINT_FRAME_MS - 5, durationMs: LONG, tier: 0 }, false],
    ['ровно на пороге кадра', { frameAvgMs: CONFIG.QUALITY.HINT_FRAME_MS, durationMs: LONG, tier: 0 }, false],
    ['короткий забег (шумная выборка)', { frameAvgMs: BAD, durationMs: 3000, tier: 0 }, false],
    ['адаптация ещё не на дне', { frameAvgMs: BAD, durationMs: LONG, tier: 1 }, false],
    ['мощное устройство на верхнем тире', { frameAvgMs: BAD, durationMs: LONG, tier: 3 }, false],
  ];
  for (const [label, input, want] of cases) {
    if (shouldOfferLite(input) !== want) {
      console.error(`✗ подсказка: «${label}» → ожидалось ${want}`, input); process.exit(1);
    }
  }
  // Пороги — из конфига, не зашиты числами по месту.
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  if (!/HINT_MAX/.test(main) || !/shouldOfferLite/.test(main)) {
    console.error('✗ подсказка: main.js должен читать лимит из CONFIG и звать shouldOfferLite'); process.exit(1);
  }
  // Подсказка обязана жить на game over, а не в забеге: тап мимо кнопки в
  // забеге стоит игроку полосы движения.
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  if (!/id="game-over-screen"[\s\S]*id="lite-hint"[\s\S]*<\/div>\s*<\/div>\s*<\/div>/.test(html)) {
    console.error('✗ подсказка: блок lite-hint должен находиться внутри экрана game over'); process.exit(1);
  }
  if (!/id="lite-hint" class="lite-hint hidden"/.test(html)) {
    console.error('✗ подсказка: блок должен быть скрыт по умолчанию'); process.exit(1);
  }
}
console.log('✓ подсказка лёгкого режима: лимит, уважение выбора игрока, конфигурируемые пороги, событие разрешено');

// --- Профиль устройства в телеметрии -----------------------------------------
// Разбор просадок без DPR невозможен: viewport в CSS-пикселях не даёт площади
// кадра, а именно она определяет цену заливки. cores/mem отделяют слабый SoC от
// большого экрана. Персональных данных быть не должно — сервер режет props
// с initData/telegram/userId, и UA мы здесь не отправляем.
{
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const ctx = main.match(/Analytics\.setContext\(\{[\s\S]*?\}\);/)?.[0] || '';
  for (const field of ['dpr', 'cores', 'mem']) {
    if (!new RegExp(`\\b${field}:`).test(ctx)) {
      console.error(`✗ телеметрия: в контексте нет поля ${field} — просадки будет нечем объяснять`); process.exit(1);
    }
  }
  if (/\bua:/.test(ctx) || /userAgent/.test(ctx)) {
    console.error('✗ телеметрия: UA в контексте каждого события — лишний отпечаток, не надо'); process.exit(1);
  }
}
console.log('✓ телеметрия: профиль устройства (dpr/cores/mem) есть, лишнего отпечатка нет');

// --- Закэшированный старый index.html + свежий main.js -----------------------
// Реальный случай с прода (2026-08-05): у игрока в кэше осталась ПРЕЖНЯЯ
// разметка, а js уже обновился (html кэшируется дольше). Прямое обращение к
// новому элементу (`$('set-graphics-label').textContent`) бросало TypeError в
// fillStaticCopy и убивало весь bootstrap — белый экран вместо игры. Новые
// элементы разметки обязаны читаться безопасно.
{
  const origGet = global.document.getElementById;
  global.document.getElementById = (id) => (/^set-graphics|^lite-hint|^btn-lite-hint/.test(id) ? null : origGet(id));
  try {
    // ?stale — обход кэша ESM, чтобы модуль собрал `dom` на «старой» разметке.
    const stale = await import('../src/ui/screens.js?stale-html=1');
    stale.fillStaticCopy('control');
    stale.refreshSettingsUI(new SettingsStore(), true);
    stale.showLiteHint();   // подсказка на старой разметке — просто нет блока
    stale.hideLiteHint();
  } catch (error) {
    console.error('✗ старый закэшированный index.html убивает bootstrap:', error.message); process.exit(1);
  } finally {
    global.document.getElementById = origGet;
  }
}
console.log('✓ кэш: старая разметка без новых элементов не роняет bootstrap');

console.log('✓ все тесты пройдены');
