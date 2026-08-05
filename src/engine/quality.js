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

// Все тюнинги читаются с `??`-дефолтом намеренно: во время деплоя ES-модули
// кэшируются по отдельности (js — max-age 300 в backend/server.js), поэтому свежий
// quality.js реально может встретиться с ещё закэшированным старым config.js.
// Без дефолтов такая пара дала бы undefined-пороги и мёртвый менеджер качества.
// Инвариант закреплён тестом в test/harness.mjs.
const Q = () => CONFIG.QUALITY || {};

// Оверлей «лёгкой графики»: накладывается поверх тира 0 (см. CONFIG.QUALITY.LITE).
// Отдельным тиром это делать нельзя — сдвинулась бы нумерация в телеметрии.
const lite = () => Q().LITE ?? {};

export class Quality {
  constructor(startTier = CONFIG.QUALITY?.START_TIER ?? 1, mode = 'auto') {
    this.startTier = clamp(startTier | 0, 0, TIERS.length - 1);
    // Лёгкий режим — выбор игрока в настройках. Тир прибит к 0, подъёмы закрыты.
    this.lite = mode === 'lite';
    this.tier = this.lite ? 0 : this.startTier;
    this.ema = 16.7;               // экспоненциальное среднее времени кадра (мс)
    this.cooldown = Q().WARMUP ?? 90;
    this.spikes = 0;               // накопитель «фризов» (см. спайк-детектор ниже)
    this.onChange = null;          // колбэк при смене тира (например, сменить DPR)

    // --- Сходимость вместо автоколебаний ------------------------------------
    // Прод-телеметрия (2026-08) показала 3155 смен тира на 656 забегов: вверх 1420 /
    // вниз 1405, медиана между разворотами 2.1 с. Причина — пороги в абсолютных мс:
    // UP_MS 14.5 недостижим на 60 Гц (кадр всегда ~16.7 мс) и ВСЕГДА достижим на
    // 120 Гц (~8.3 мс), а DOWN_MS 23 всегда достижим на поднятом тире. Цикл замкнут.
    // Лечим не порогом, а памятью: тир, с которого мы уже сваливались, получает
    // растущий cooldown, а после UP_RETRIES провалов закрывается насовсем.
    this.ceiling = this.lite ? 0 : TIERS.length - 1; // потолок тира на эту загрузку
    this.upFails = new Array(TIERS.length).fill(0); // провалившиеся подъёмы по тирам
    this.lastUpTier = -1;          // тир, в который поднялись последним подъёмом

    // DPR морозим на первом же спаде: смена DPR — это переаллокация буфера канваса
    // (setDprCap → resize) плюс буфера bloom, то есть видимый рывок. Устройство,
    // которое ровно доехало до верхнего тира, резкость получает; «пилящее» —
    // фиксирует DPR и дальше меняет только эффекты, они бесплатны в переключении.
    this.dprLocked = false;
    this.lockedDpr = TIERS[this.tier].dpr;
    this._recalc();
  }

  // Набор настроек текущего тира. DPR подменяется замороженным значением, поэтому
  // остальной код (main.js, particles) продолжает читать ровно тот же контракт.
  // Результат кэшируется: main.js читает `.s` дважды за кадр, аллокация на кадр
  // в менеджере производительности — ровно то, с чем мы боремся.
  get s() { return this._eff; }

  _recalc() {
    const t = TIERS[this.tier];
    if (this.lite) {
      // Лёгкий режим сильнее любой заморозки DPR: игрок попросил fps явно.
      this._eff = { ...TIERS[0], dpr: lite().DPR ?? 1, particleCap: lite().PARTICLE_CAP ?? TIERS[0].particleCap };
      return;
    }
    this._eff = this.dprLocked && t.dpr !== this.lockedDpr ? { ...t, dpr: this.lockedDpr } : t;
  }

  // Переключение режима графики из настроек ('auto' | 'lite'). Возврат в auto
  // обнуляет память о провалившихся подъёмах и заморозку DPR — иначе игрок,
  // сходивший в лёгкий режим, навсегда остался бы на DPR лёгкого тира.
  setMode(mode) {
    const next = mode === 'lite';
    if (next === this.lite) return;
    this.lite = next;
    if (next) {
      this.tier = 0;
      this.ceiling = 0;
    } else {
      this.tier = this.startTier;
      this.ceiling = TIERS.length - 1;
      this.upFails.fill(0);
      this.lastUpTier = -1;
      this.dprLocked = false;
      this.lockedDpr = TIERS[this.tier].dpr;
      this.ema = 16.7;
      this.spikes = 0;
      this.cooldown = Q().WARMUP ?? 90;
    }
    this._recalc();
    this.onChange?.(this.s);
  }

  // Понижение тира: общий путь для спайк-детектора и для EMA.
  _down(cooldown) {
    const from = this.tier;
    this.tier--;
    // Свалились ровно с того тира, в который только что поднялись → подъём был
    // ошибкой. Копим счётчик и после UP_RETRIES закрываем этот тир окончательно.
    if (from === this.lastUpTier) {
      this.upFails[from]++;
      if (this.upFails[from] >= (Q().UP_RETRIES ?? 2)) this.ceiling = from - 1;
    }
    this.lastUpTier = -1;
    if (!this.dprLocked) { this.dprLocked = true; this.lockedDpr = TIERS[this.tier].dpr; }
    this.cooldown = cooldown;
    this._recalc();
    this.onChange?.(this.s);
  }

  // dtMs — реальное (несглаженное) время последнего кадра в миллисекундах
  sample(dtMs) {
    if (dtMs > 0 && dtMs < 1000) this.ema = this.ema * 0.9 + dtMs * 0.1;
    // Лёгкий режим — ручной: адаптация молчит, тир не двигается ни вверх, ни вниз.
    if (this.lite) return;

    // Спайк-детектор: реагируем на пачку фризов мгновенно, мимо EMA и прогрева.
    // Один тяжёлый кадр копит счётчик, хороший — гасит; перебор → роняем тир сразу.
    if (dtMs > (Q().SPIKE_MS ?? 50)) this.spikes++;
    else if (this.spikes > 0) this.spikes--;
    if (this.spikes >= (Q().SPIKE_TRIP ?? 4) && this.tier > 0) {
      this.spikes = 0;
      this._down(180);
      return;
    }

    if (this.cooldown > 0) { this.cooldown--; return; }

    if (this.ema > (Q().DOWN_MS ?? 23) && this.tier > 0) {
      this._down(120);
    } else if (this.ema < (Q().UP_MS ?? 14.5) && this.tier < this.ceiling) {
      const target = this.tier + 1;
      this.tier = target;
      this.lastUpTier = target;
      // Каждый провалившийся подъём в этот тир удорожает следующую попытку —
      // так «почти тянет» устройство пробует ещё раз, а не пилит каждые 2 секунды.
      this.cooldown = (Q().UP_COOLDOWN ?? 200) * (1 + this.upFails[target]);
      this._recalc();
      this.onChange?.(this.s);
    }
  }
}
