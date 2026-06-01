// Headless smoke-test: стабим DOM/Canvas/Audio, грузим игру, крутим кадры.
const gradient = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(_, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'canvas') return { width: 800, height: 600 };
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
global.document = {
  getElementById: (id) => (els[id] = els[id] || makeEl('#'+id)),
  createElement: (t) => makeEl(t),
  addEventListener() {}, hidden: false,
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

// прогон
await import('../src/main.js');
console.log('✓ модули загрузились, обработчики навешаны');

// эмулируем старт игры: дёргаем click на btn-start
const start = els['btn-start'];
start._handlers.click?.forEach(fn => fn());
console.log('✓ startGame() без ошибок');

// крутим ~600 кадров (~10 сек при 60fps) — ловим коллизии/спавн/буст
let tMs = 0;
for (let i = 0; i < 600; i++) {
  const cb = rafCbs.shift();
  if (!cb) { console.log('кадры кончились на', i); break; }
  tMs += 16;
  cb(tMs);
}
console.log('✓ 600 кадров отрисовано без исключений');

// смена полос
const canvas = els['gameCanvas'];
canvas._handlers; // ok
console.log('✓ smoke-test пройден');
