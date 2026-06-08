// Ввод: свайп ←/→, тап в левую/правую половину, клавиши. Игрок движется «в город»,
// поэтому ось управления — горизонтальная (смена колонны).
// onTap(x,y) — сырые CSS-координаты тапа (для капча-мини-игры).

export function initInput(target, { onLeft, onRight, onTap, onAny }) {
  let startY = null, startX = null, startT = 0;
  const SWIPE = 24;

  function down(x, y) { startX = x; startY = y; startT = performance.now(); }
  function up(x, y) {
    if (startX == null) return;
    const dy = y - startY, dx = x - startX, dt = performance.now() - startT;
    onAny && onAny();
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? onLeft() : onRight();
    } else if (dt < 250 && Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) {
      // передаём координаты тапа обработчику (напр. капча)
      if (onTap) { onTap(x, y); }
      else { (x < window.innerWidth / 2) ? onLeft() : onRight(); }
    }
    startY = startX = null;
  }

  target.addEventListener('touchstart', (e) => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
  target.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; up(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  target.addEventListener('mousedown', (e) => down(e.clientX, e.clientY));
  target.addEventListener('mouseup', (e) => up(e.clientX, e.clientY));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') { onAny && onAny(); onLeft(); }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') { onAny && onAny(); onRight(); }
  });
}
