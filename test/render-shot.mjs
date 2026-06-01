// Рендер реальных кадров игры в PNG через @napi-rs/canvas (без браузера).
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'fs';

// минимальные стабы для модулей, дёргающих document (sharecard)
global.document = { createElement: () => createCanvas(1080, 1080) };

const { World, geometry } = await import('../src/game/world.js');
const { Player } = await import('../src/game/player.js');
const { Obstacle } = await import('../src/game/obstacles.js');
const { Boost } = await import('../src/game/boosts.js');
const { Particles } = await import('../src/engine/particles.js');
const { scanlines } = await import('../src/engine/render.js');
const { renderShareCard } = await import('../src/game/sharecard.js');

// ---- gameplay frame -------------------------------------------------------
const W = 440, H = 900, dpr = 2;
const cv = createCanvas(W * dpr, H * dpr);
const ctx = cv.getContext('2d');
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

const geom = geometry(W, H);
const world = new World();
const particles = new Particles();
const player = new Player();
player.lane = 1;

// прогреем мир и шлейф ракеты
for (let i = 0; i < 30; i++) { world.update(0.016, 520); player.update(0.016, geom, particles, false); particles.update(0.016); }

// разложим препятствия по полосам/типам для демонстрации
const demo = [
  new Obstacle(0, 'captcha'),
  new Obstacle(2, 'geoblock'),
  new Obstacle(1, 'ad'),
  new Obstacle(0, 'lag'),
];
demo.forEach((o, i) => { o.size(geom); o.x = W * (0.42 + i * 0.16); });
const boost = new Boost(2, geom); boost.x = W * 0.74;

const t = 1.2;
world.draw(ctx, W, H);
boost.draw(ctx, geom, t);
demo.forEach((o) => o.draw(ctx, geom, t));
player.draw(ctx, geom, false, t);
particles.draw(ctx);
scanlines(ctx, W, H);

writeFileSync('preview/gameplay.png', cv.toBuffer('image/png'));
console.log('✓ preview/gameplay.png');

// ---- share card -----------------------------------------------------------
const stats = { scoreInt: 4820, distInt: 1730, captchas: 17, geoblocks: 8, ads: 31, lags: 5 };
const card = renderShareCard(stats, true);
writeFileSync('preview/share-card.png', card.toBuffer('image/png'));
console.log('✓ preview/share-card.png');
