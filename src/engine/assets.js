// Опциональный загрузчик спрайтов. Не блокирует старт — игра рисует процедурно,
// пока ассеты грузятся; если файла нет — фолбэк на процедурку навсегда.

const sprites = new Map(); // key → HTMLImageElement | null
let _manifest = null;

export async function loadAssets(manifestUrl = 'assets/manifest.json') {
  let manifest;
  try {
    const r = await fetch(manifestUrl);
    if (!r.ok) return; // нет манифеста — нет ассетов, всё ок
    manifest = await r.json();
    _manifest = manifest;
  } catch { return; }

  await Promise.allSettled(manifest.map(({ key, path }) =>
    new Promise((res) => {
      const img = new Image();
      img.onload = () => { sprites.set(key, img); res(); };
      img.onerror = () => { sprites.set(key, null); res(); };
      img.src = path;
    })
  ));
}

// Вернуть спрайт или null (→ рисуй процедурно)
export function getSprite(key) {
  return sprites.get(key) ?? null;
}


