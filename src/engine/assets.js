// Опциональный загрузчик спрайтов. Не блокирует старт — игра рисует процедурно,
// пока ассеты грузятся; если файла нет — фолбэк на процедурку навсегда.

const sprites = new Map(); // key → HTMLImageElement | null
let _manifest = null;

// Таймауты: на GitHub Pages/медленном CDN fetch манифеста или картинки может
// висеть секундами. Старт игры от ассетов не зависит (процедурный фолбэк), поэтому
// жёстко ограничиваем ожидание — иначе подвисает фоновая загрузка и дёргает GC.
const MANIFEST_TIMEOUT = 4000;
const IMAGE_TIMEOUT = 6000;

export async function loadAssets(manifestUrl = 'assets/manifest.json') {
  let manifest;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), MANIFEST_TIMEOUT);
    const r = await fetch(manifestUrl, { signal: ac.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return; // нет манифеста — нет ассетов, всё ок
    manifest = await r.json();
    _manifest = manifest;
  } catch { return; } // включая abort по таймауту — тихо уходим в процедурку

  await Promise.allSettled(manifest.map(({ key, path }) =>
    new Promise((res) => {
      const img = new Image();
      let done = false;
      const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); sprites.set(key, ok ? img : null); res(); };
      const timer = setTimeout(() => finish(false), IMAGE_TIMEOUT); // медленная картинка → фолбэк
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = path;
    })
  ));
}

// Вернуть спрайт или null (→ рисуй процедурно)
export function getSprite(key) {
  return sprites.get(key) ?? null;
}


