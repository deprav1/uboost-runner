// Рендер реальных кадров игры в PNG через @napi-rs/canvas (без браузера).
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'fs';

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Стабильный seed нужен, чтобы preview-кадры и CI-артефакты не плясали от рандома.
globalThis.Math.random = mulberry32(0x5EEDC0DE);

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
const { bloom, aberration, vignette, grain } = await import('../src/engine/postfx.js');
const { CONFIG } = await import('../config.js');
const FX = CONFIG.FX;
const { CaptchaGame } = await import('../src/game/captcha.js');
const { renderShareCard } = await import('../src/game/sharecard.js');
const { EventManager } = await import('../src/game/events.js');

// финальный кинематографичный грейдинг (как в игровом цикле main.js)
function postFX(ctx, cv, W, H) {
  if (FX.BLOOM) bloom(ctx, cv, { strength: FX.BLOOM_STRENGTH, blur: FX.BLOOM_BLUR, scale: FX.BLOOM_SCALE });
  if (FX.ABERRATION) aberration(ctx, cv, FX.ABERRATION);
  if (FX.VIGNETTE) vignette(ctx, W, H, FX.VIGNETTE);
  if (FX.GRAIN) grain(ctx, W, H, FX.GRAIN, 7);
}

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

// показываем новые эффекты частиц (смэш-кольцо + вспышка + искры)
particles.burst(W * 0.66, geom.laneY[0], '#ff2937', 16, 320);
particles.ring(W * 0.66, geom.laneY[0], '#ff5a64', 8, 70, 0.5);
particles.flashGlow(W * 0.66, geom.laneY[0], '#ff2937', 80, 0.4);
for (let i = 0; i < 6; i++) particles.update(0.016);

const t = 1.2;
world.draw(ctx, W, H, SPEED);
drawRails(ctx, geom, world.railOff, '#ff2937');
bits.forEach((b) => b.draw(ctx, geom, t));
heart.draw(ctx, geom, t);
boost.draw(ctx, geom, t);
[...demo, ...demo2].forEach((o) => o.draw(ctx, geom, t));
player.draw(ctx, geom, false, t);
particles.draw(ctx);
postFX(ctx, cv, W, H);
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
postFX(ctx3, cv3, W, H);
scanlines(ctx3, W, H);
writeFileSync('preview/gag-sber.png', cv3.toBuffer('image/png'));
console.log('✓ preview/gag-sber.png');

// ---- share card -----------------------------------------------------------
const stats = { scoreInt: 6140, distInt: 2310, captchas: 9, geoblocks: 14, ads: 27, lags: 6 };
const card = renderShareCard(stats, true);
writeFileSync('preview/share-card.png', card.toBuffer('image/png'));
console.log('✓ preview/share-card.png');
