// Рендер реальных кадров игры в PNG через @napi-rs/canvas (без браузера).
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'fs';

global.document = { createElement: () => createCanvas(1080, 1080) };
global.fetch = async () => ({ ok: false });
global.Image = class { set src(v) { setTimeout(() => this.onerror?.(), 0); } };

const { World, geometry } = await import('../src/game/world.js');
const { Player } = await import('../src/game/player.js');
const { Obstacle } = await import('../src/game/obstacles.js');
const { DataBit, Heart } = await import('../src/game/collectibles.js');
const { Boost } = await import('../src/game/boosts.js');
const { Particles } = await import('../src/engine/particles.js');
const { scanlines, drawRails } = await import('../src/engine/render.js');
const { CaptchaGame } = await import('../src/game/captcha.js');
const { renderShareCard } = await import('../src/game/sharecard.js');
const { EventManager } = await import('../src/game/events.js');

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

const SPEED = 820;
for (let i = 0; i < 30; i++) { world.update(0.016, SPEED); player.update(0.016, geom, particles, false, 0.6); particles.update(0.016); }

const demo = [new Obstacle(0, 'geoblock'), new Obstacle(2, 'ad')];
demo.forEach((o) => { o.size(geom); o.x = W * 0.66; });
const demo2 = [new Obstacle(1, 'captcha'), new Obstacle(2, 'lag')];
demo2.forEach((o) => { o.size(geom); o.x = W * 1.02; });

const bits = [];
for (let i = 0; i < 5; i++) bits.push(new DataBit(1, W * (0.30 + i * 0.07), geom));
const boost = new Boost(1, geom); boost.x = W * 0.86;
const heart = new Heart(0, geom); heart.x = W * 0.55;

const t = 1.2;
world.draw(ctx, W, H, SPEED);
drawRails(ctx, geom, world.railOff, '#ff2937');
bits.forEach((b) => b.draw(ctx, geom, t));
heart.draw(ctx, geom, t);
boost.draw(ctx, geom, t);
[...demo, ...demo2].forEach((o) => o.draw(ctx, geom, t));
player.draw(ctx, geom, false, t);
particles.draw(ctx);
scanlines(ctx, W, H);

writeFileSync('preview/gameplay.png', cv.toBuffer('image/png'));
console.log('✓ preview/gameplay.png');

// ---- captcha minigame frame -----------------------------------------------
const cv2 = createCanvas(W * dpr, H * dpr);
const ctx2 = cv2.getContext('2d');
ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

// тёмный фон как в игре
world.draw(ctx2, W, H, 80);

const cg = new CaptchaGame(W, H);
// пре-update для анимации входа
for (let i = 0; i < 20; i++) cg.update(0.016);

cg.draw(ctx2, 1.2);
scanlines(ctx2, W, H);
writeFileSync('preview/captcha.png', cv2.toBuffer('image/png'));
console.log('✓ preview/captcha.png');

// ---- gag frame (СБЕР ЛЁГ) ------------------------------------------------
const cv3 = createCanvas(W * dpr, H * dpr);
const ctx3 = cv3.getContext('2d');
ctx3.setTransform(dpr, 0, 0, dpr, 0, 0);

world.draw(ctx3, W, H, 820);
drawRails(ctx3, geom, world.railOff, '#ff2937');
player.draw(ctx3, geom, false, t);

const em = new EventManager();
em.active = { type: 'sber', timer: 1.5, label: 'СБЕР\nЛЁГ', age: 1.0 };
em.draw(ctx3, W, H, t);
scanlines(ctx3, W, H);
writeFileSync('preview/gag-sber.png', cv3.toBuffer('image/png'));
console.log('✓ preview/gag-sber.png');

// ---- share card -----------------------------------------------------------
const stats = { scoreInt: 6140, distInt: 2310, captchas: 9, geoblocks: 14, ads: 27, lags: 6 };
const card = renderShareCard(stats, true);
writeFileSync('preview/share-card.png', card.toBuffer('image/png'));
console.log('✓ preview/share-card.png');
