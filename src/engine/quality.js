// Адаптивное качество рендера. Следит за сглаженным временем кадра и переключает
// «тир»: на слабом железе/мобильном WebView понижает DPR и отключает тяжёлые
// полнокадровые пост-эффекты; на мощном — включает по максимуму. Цель — стабильные
// 60 fps без потери синтвейв-стиля (он деградирует мягко).
import { CONFIG } from '../../config.js';
import { clamp } from './render.js';

// 0 = потато … 3 = ультра. dpr — потолок плотности; bloomScale — даунскейл буфера
// bloom (меньше = дешевле и мягче). Самый дорогой эффект — aberration (2 фильтр-
// прохода полного кадра), он включается только на ультре.
// particleCap/glow — бюджет системы частиц: на тирах 0–1 частицы без shadowBlur
// (additive-ядро светится под bloom и так), кап — из CONFIG.PERF.MAX_PARTICLES.
const PCAP = CONFIG.PERF.MAX_PARTICLES;
// bgFx — дорогая фоновая косметика (отражение солнца ~22 destination-out полосы
// за кадр + туманности): на тирах 0–1 выключаем, бюджет уходит частицам геймплея.
const TIERS = [
  { dpr: 1.25, bloom: false, aberration: false, grain: false, scanlines: false, bloomScale: 0.30, particleCap: PCAP[0], glow: false, bgFx: false },
  { dpr: 1.5,  bloom: true,  aberration: false, grain: false, scanlines: true,  bloomScale: 0.34, particleCap: PCAP[1], glow: false, bgFx: false },
  { dpr: 2.0,  bloom: true,  aberration: false, grain: true,  scanlines: true,  bloomScale: 0.40, particleCap: PCAP[2], glow: true,  bgFx: true },
  { dpr: 2.0,  bloom: true,  aberration: true,  grain: true,  scanlines: true,  bloomScale: 0.50, particleCap: PCAP[3], glow: true,  bgFx: true },
];

export class Quality {
  constructor(startTier = CONFIG.QUALITY.START_TIER) {
    this.tier = clamp(startTier | 0, 0, TIERS.length - 1);
    this.ema = 16.7;               // экспоненциальное среднее времени кадра (мс)
    this.cooldown = CONFIG.QUALITY.WARMUP;
    this.spikes = 0;               // накопитель «фризов» (см. спайк-детектор ниже)
    this.onChange = null;          // колбэк при смене тира (например, сменить DPR)
  }

  get s() { return TIERS[this.tier]; }

  // dtMs — реальное (несглаженное) время последнего кадра в миллисекундах
  sample(dtMs) {
    if (dtMs > 0 && dtMs < 1000) this.ema = this.ema * 0.9 + dtMs * 0.1;

    // Спайк-детектор: реагируем на пачку фризов мгновенно, мимо EMA и прогрева.
    // Один тяжёлый кадр копит счётчик, хороший — гасит; перебор → роняем тир сразу.
    if (dtMs > CONFIG.QUALITY.SPIKE_MS) this.spikes++;
    else if (this.spikes > 0) this.spikes--;
    if (this.spikes >= CONFIG.QUALITY.SPIKE_TRIP && this.tier > 0) {
      this.tier--; this.spikes = 0; this.cooldown = 180; this.onChange?.(this.s);
      return;
    }

    if (this.cooldown > 0) { this.cooldown--; return; }

    if (this.ema > CONFIG.QUALITY.DOWN_MS && this.tier > 0) {
      this.tier--; this.cooldown = 120; this.onChange?.(this.s);
    } else if (this.ema < CONFIG.QUALITY.UP_MS && this.tier < TIERS.length - 1) {
      this.tier++; this.cooldown = 200; this.onChange?.(this.s);
    }
  }
}
