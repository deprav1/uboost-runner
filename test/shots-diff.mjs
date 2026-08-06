// Страховка для правок рендера: сравнивает свежие preview/*.png с версией из git
// (по умолчанию HEAD) попиксельно. Нужна там, где оптимизация обязана быть
// визуально нейтральной — например кэш свечения в оффскрин вместо shadowBlur
// на каждом кадре: результат должен совпадать, иначе это не оптимизация, а
// изменение картинки.
//
//   node test/render-shot.mjs && node test/shots-diff.mjs [ref]
//
// Порог: средняя разница по каналу <= MEAN_LIMIT и доля заметно изменившихся
// пикселей <= PIXEL_LIMIT. Полное совпадение (0/0) — идеальный случай.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MEAN_LIMIT = 0.6;    // средняя абсолютная разница канала (0..255)
const PIXEL_LIMIT = 1.5;   // % пикселей с разницей канала > 4

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const previewDir = path.join(root, 'preview');
const ref = process.argv[2] || 'HEAD';

let loadImage, createCanvas;
try {
  ({ loadImage, createCanvas } = await import('@napi-rs/canvas'));
} catch {
  console.error('✗ нужен @napi-rs/canvas (npm i), тем же пакетом рендерятся превью');
  process.exit(1);
}

const decode = async (file) => {
  const img = await loadImage(file);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
};

const tmp = mkdtempSync(path.join(tmpdir(), 'uboost-shots-'));
let failed = false;
try {
  const files = readdirSync(previewDir).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) { console.error('✗ preview/*.png не найдены — сначала npm run shots'); process.exit(1); }
  for (const file of files) {
    let refBuf;
    try {
      refBuf = execFileSync('git', ['show', `${ref}:preview/${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    } catch {
      console.log(`… ${file}: в ${ref} нет — новый файл, сравнивать не с чем`);
      continue;
    }
    const refFile = path.join(tmp, file);
    writeFileSync(refFile, refBuf);
    const [a, b] = await Promise.all([decode(refFile), decode(path.join(previewDir, file))]);
    if (a.w !== b.w || a.h !== b.h) {
      console.error(`✗ ${file}: размер изменился ${a.w}x${a.h} → ${b.w}x${b.h}`);
      failed = true;
      continue;
    }
    let sum = 0, max = 0, loud = 0;
    const px = a.w * a.h;
    for (let i = 0; i < a.data.length; i += 4) {
      let worst = 0;
      for (let c = 0; c < 3; c++) {           // альфа в превью всегда 255
        const d = Math.abs(a.data[i + c] - b.data[i + c]);
        sum += d;
        if (d > worst) worst = d;
      }
      if (worst > max) max = worst;
      if (worst > 4) loud++;
    }
    const mean = sum / (px * 3);
    const loudPct = (loud / px) * 100;
    const ok = mean <= MEAN_LIMIT && loudPct <= PIXEL_LIMIT;
    const verdict = mean === 0 && max === 0 ? 'идентично' : ok ? 'в допуске' : 'СЛИШКОМ СИЛЬНО';
    console.log(`${ok ? '✓' : '✗'} ${file}: средняя ${mean.toFixed(3)}, максимум канала ${max}, заметно изменилось ${loudPct.toFixed(2)}% пикселей — ${verdict}`);
    if (!ok) failed = true;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n✗ визуальный регресс: допуск — средняя ≤ ${MEAN_LIMIT}, заметных пикселей ≤ ${PIXEL_LIMIT}%.`);
  console.error('  Если картинка изменилась осознанно — посмотри preview/*.png глазами и обнови их в коммите.');
  process.exit(1);
}
console.log('\n✓ превью в пределах допуска: правки рендера визуально нейтральны');
