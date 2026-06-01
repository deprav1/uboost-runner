// Ввод: свайп ↑/↓, тап в верх/низ экрана, клавиши. Выдаёт намерения -1 / +1.

export function initInput(target, { onUp, onDown, onAny }) {
  let startY = null, startX = null, startT = 0;
  const SWIPE = 24; // порог свайпа в px

  function down(x, y) { startX = x; startY = y; startT = performance.now(); }
  function up(x, y) {
    if (startY == null) return;
    const dy = y - startY, dx = x - startX, dt = performance.now() - startT;
    onAny && onAny();
    if (Math.abs(dy) > SWIPE && Math.abs(dy) > Math.abs(dx)) {
      dy < 0 ? onUp() : onDown();
    } else if (dt < 250 && Math.abs(dy) < SWIPE && Math.abs(dx) < SWIPE) {
      // короткий тап — делим экран пополам
      (y < window.innerHeight / 2) ? onUp() : onDown();
    }
    startY = startX = null;
  }

  target.addEventListener('touchstart', (e) => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
  target.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; up(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  target.addEventListener('mousedown', (e) => down(e.clientX, e.clientY));
  target.addEventListener('mouseup', (e) => up(e.clientX, e.clientY));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === 'ц' || e.key === 'Ц') { onAny && onAny(); onUp(); }
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') { onAny && onAny(); onDown(); }
  });
}
