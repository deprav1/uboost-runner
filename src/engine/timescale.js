// Тайм-скейл: hit-stop (почти полная заморозка симуляции) и slow-mo (замедление).
// Чистый модуль без сторонних зависимостей — рендер продолжается на полной
// скорости (frame() умножает только simDt), визуальный «джус» по Vlambeer.
//
// Несколько одновременных эффектов берут минимум множителя (самый сильный
// побеждает); при равной силе остаток времени продлевается до большего.

const EPS = 0.0001; // hitStop — почти ноль, а не ровно 0 (инвариант "mul() всегда > 0")

let timer = 0;   // секунд осталось у текущего эффекта
let scale = 1;   // множитель simDt на время timer

function applyEffect(newScale, sec) {
  if (sec <= 0) return;
  if (timer <= 0 || newScale < scale) {
    scale = newScale; timer = sec;
  } else if (newScale === scale) {
    timer = Math.max(timer, sec);
  }
  // newScale > scale при активном эффекте — текущий сильнее, игнорируем
}

// Почти полная заморозка симуляции на `sec` секунд.
export function hitStop(sec) { applyEffect(EPS, sec); }

// Замедление симуляции до `factor` (0..1] на `sec` секунд.
export function slowMo(factor, sec) { applyEffect(Math.max(EPS, clamp01(factor)), sec); }

// Текущий множитель dt: всегда в (0, 1]. Вызывать ровно раз за кадр и
// передавать ему «настенный» dt, чтобы таймер истекал в реальном времени.
export function mul(realDt = 0) {
  if (timer <= 0) return 1;
  timer -= realDt;
  if (timer <= 0) { timer = 0; scale = 1; return 1; }
  return scale;
}

// Сброс (рестарт игры) — без остаточных эффектов на новом забеге.
export function reset() {
  timer = 0; scale = 1;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
