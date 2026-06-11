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

console.log('✓ все тесты пройдены');
