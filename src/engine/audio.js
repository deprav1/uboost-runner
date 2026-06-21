// Процедурный адаптивный synthwave soundtrack + SFX. Без аудиофайлов.
// Музыка отражает состояние забега: спокойный разгон → напряжение → полный
// драйв VPN-буста; captcha оставляет тревожный пульс, смерть завершает фразу.
import { CONFIG } from '../../config.js';

const M = CONFIG.MUSIC;
const NOTE = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

// Чистый профиль аранжировки — используется движком и headless-тестами.
export function musicProfile({ mode = 'play', speed = 0, combo = 0, boosting = false, zone = 0 } = {}) {
  const speedLevel = clamp01((speed - CONFIG.BASE_SPEED) / Math.max(1, CONFIG.MAX_SPEED - CONFIG.BASE_SPEED));
  const comboLevel = clamp01(combo / M.COMBO_FULL);
  let intensity = clamp01(M.BASE_INTENSITY + speedLevel * M.SPEED_WEIGHT + comboLevel * M.COMBO_WEIGHT);
  if (boosting) intensity = 1;
  if (mode === 'captcha') intensity = M.CAPTCHA_INTENSITY;
  if (mode === 'dying' || mode === 'over' || mode === 'menu' || mode === 'paused') intensity = 0;
  return {
    mode,
    intensity,
    speedLevel,
    comboLevel,
    boosting: !!boosting,
    zone: Math.max(0, zone | 0),
  };
}

export class Audio {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicFilter = null;
    this.pumpGain = null;       // sidechain-узел (кик придушивает мелодику)
    this.delaySend = null;      // посыл в ping-pong delay
    this.noiseBuffer = null;
    this.loopTimer = null;
    this.step = 0;
    this.nextStepTime = 0;
    this.started = false;
    this.profile = musicProfile();
    this.smoothedIntensity = 0;
  }

  // Вызывать из первого пользовательского действия.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.24;
    compressor.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? M.MASTER_GAIN : 0;
    this.master.connect(compressor);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0001;
    this.musicFilter = this.ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = M.FILTER_MIN;
    this.musicFilter.Q.value = 0.7;
    this.musicGain.connect(this.musicFilter);
    this.musicFilter.connect(this.master);

    // Sidechain-«пампинг»: всё мелодичное/перкуссия идёт через pumpGain, который
    // кик придушивает на каждый удар (кик включён в musicGain в обход — он триггер).
    this.pumpGain = this.ctx.createGain();
    this.pumpGain.gain.value = 1;
    this.pumpGain.connect(this.musicGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = M.SFX_GAIN;
    this.sfxGain.connect(this.master);

    // Ping-pong delay: посыл → delayL; L уходит в левый канал и кросс-фидбэком в R,
    // R — в правый и обратно в L. Эхо «скачет» по стерео. Без Convolver/ассетов.
    this.delaySend = this.ctx.createGain();
    this.delaySend.gain.value = M.PING_WET;
    const delayL = this.ctx.createDelay(0.8);
    const delayR = this.ctx.createDelay(0.8);
    delayL.delayTime.value = M.PING_TIME_L;
    delayR.delayTime.value = M.PING_TIME_R;
    const fbL = this.ctx.createGain(); fbL.gain.value = M.PING_FEEDBACK;
    const fbR = this.ctx.createGain(); fbR.gain.value = M.PING_FEEDBACK;
    this.delaySend.connect(delayL);
    delayL.connect(fbR); fbR.connect(delayR);
    delayR.connect(fbL); fbL.connect(delayL);
    // развод по каналам через панораму (StereoPanner есть во всех актуальных webview)
    const panL = this._maybePanner(-1), panR = this._maybePanner(1);
    delayL.connect(panL); panL.connect(this.pumpGain);
    delayR.connect(panR); panR.connect(this.pumpGain);

    this.noiseBuffer = this._makeNoise(0.45);
  }

  // StereoPannerNode с фолбэком: если узел недоступен, вернём прозрачный gain (моно).
  _maybePanner(pan) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      return p;
    }
    return this.ctx.createGain();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.master || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? M.MASTER_GAIN : 0.0001, t, 0.025);
    if (on && this.ctx.state === 'suspended') this.ctx.resume?.();
  }

  setMusicState(state) {
    this.profile = musicProfile(state);
  }

  _makeNoise(seconds) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _pitch(freq) { return freq * (1 + (Math.random() * 2 - 1) * 0.045); }

  _tone(freq, dur, type = 'square', gain = 0.3, dest = null, slideTo = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfxGain || this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  sfxLane() { this._tone(this._pitch(520), 0.075, 'triangle', 0.18, null, 680); }
  sfxBit() { this._tone(this._pitch(880), 0.055, 'sine', 0.11, null, 1180); }
  sfxCaptcha() {
    this._tone(196, 0.18, 'sawtooth', 0.18, null, 147);
    this._tone(293.7, 0.13, 'square', 0.1, null, 220);
  }
  sfxCaptchaSolve() {
    [0, 4, 7, 12].forEach((semi, i) => setTimeout(() => this._tone(NOTE(64 + semi), 0.22, 'triangle', 0.14), i * 45));
  }
  sfxPickup() {
    this._tone(this._pitch(659.3), 0.12, 'sawtooth', 0.19);
    setTimeout(() => this._tone(this._pitch(987.8), 0.2, 'triangle', 0.2), 55);
  }
  sfxBoost() {
    this._tone(82.4, 0.7, 'sawtooth', 0.28, null, 164.8);
    this._tone(329.6, 0.65, 'square', 0.14, null, 659.3);
    [76, 83, 88].forEach((midi, i) => setTimeout(() => this._tone(NOTE(midi), 0.35, 'sawtooth', 0.11), i * 70));
  }
  sfxSmash() { this._tone(this._pitch(135), 0.13, 'square', 0.24, null, 48); }
  sfxWarn() {
    this._tone(740, 0.07, 'square', 0.13);
    setTimeout(() => this._tone(554.4, 0.06, 'square', 0.1), 65);
  }
  sfxCombo(combo = 10) {
    const root = combo >= 50 ? 76 : combo >= 25 ? 71 : 67;
    [0, 7, 12].forEach((semi, i) => setTimeout(() => this._tone(NOTE(root + semi), 0.28, 'triangle', 0.14), i * 48));
  }
  sfxZone(zone = 1) {
    const root = 52 + (zone % 4) * 2;
    [0, 7, 12].forEach((semi, i) => setTimeout(() => this._tone(NOTE(root + semi), 0.55, 'sine', 0.08), i * 80));
  }
  sfxHit() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._sweep(t, 310, 42, 0.48, 'sawtooth', 0.28, this.sfxGain);
    this._noise(t, 0.22, 0.18, 480, this.sfxGain);
  }
  sfxDeath() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [64, 59, 55, 52, 47].forEach((midi, i) => {
      this._voice(t + i * 0.105, NOTE(midi), 0.42, 'sawtooth', 0.12, 900, this.sfxGain);
    });
    this._sweep(t, 180, 32, 0.9, 'sawtooth', 0.25, this.sfxGain);
  }

  _voice(t, freq, dur, type, gain, cutoff, dest = this.pumpGain, attack = 0.008, pan = 0) {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const pn = this._maybePanner(pan); g.connect(pn); pn.connect(dest);
    } else g.connect(dest);
    o.start(t); o.stop(t + dur + 0.03);
    return g;
  }

  _sweep(t, from, to, dur, type, gain, dest) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.03);
  }

  _noise(t, dur, gain, highpass = 1000, dest = this.pumpGain, pan = 0) {
    if (!this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    src.buffer = this.noiseBuffer;
    f.type = 'highpass'; f.frequency.value = highpass;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const pn = this._maybePanner(pan); g.connect(pn); pn.connect(dest);
    } else g.connect(dest);
    src.start(t, 0, Math.min(dur, this.noiseBuffer.duration));
  }

  // Кик в обход pumpGain (он — триггер сайдчейна) и придушивает остальной микс.
  _kick(t, gain = 1) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(145, t);
    o.frequency.exponentialRampToValueAtTime(43, t + 0.16);
    g.gain.setValueAtTime(0.62 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.44);
    this._noise(t, 0.025, 0.055 * gain, 3500, this.musicGain);
    this._pump(t);
  }

  // Сайдчейн-провал громкости pumpGain на удар кика с плавным восстановлением.
  _pump(t) {
    if (!this.pumpGain) return;
    const g = this.pumpGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1 - M.PUMP_DEPTH, t);
    g.setTargetAtTime(1, t + 0.004, M.PUMP_RELEASE);
  }

  _snare(t, gain = 1) {
    this._noise(t, 0.18, 0.26 * gain, 1100);
    this._voice(t, 185, 0.16, 'triangle', 0.13 * gain, 800);
  }

  _hat(t, open = false, gain = 1) {
    this._noise(t, open ? 0.15 : 0.045, (open ? 0.085 : 0.055) * gain, 6200);
  }

  _tom(t, midi, gain = 1) {
    const freq = NOTE(midi);
    this._sweep(t, freq * 1.25, freq, 0.24, 'sine', 0.16 * gain, this.pumpGain);
  }

  _bass(t, midi, accent = 1, gate = 0.22) {
    const freq = NOTE(midi);
    // бас держим по центру (моно-низ читается чище на телефонных динамиках)
    this._voice(t, freq, gate, 'sawtooth', 0.22 * accent, 520 + 480 * this.smoothedIntensity);
    this._voice(t, freq / 2, gate * 1.2, 'square', 0.055 * accent, 250);
  }

  // Арп слева, с эхом в ping-pong (отскакивает вправо).
  _arp(t, midi, accent = 1) {
    const g = this._voice(t, NOTE(midi), 0.25, 'square', 0.045 * accent, 1600 + 2300 * this.smoothedIntensity, this.pumpGain, 0.008, M.PAN_ARP);
    g.connect(this.delaySend);
  }

  // Пэд разводится по нотам в стерео (раскрывает сцену под лид/арп).
  _pad(t, notes, gain = 1) {
    const n = notes.length;
    notes.forEach((midi, i) => {
      const pan = n > 1 ? ((i / (n - 1)) * 2 - 1) * M.PAN_PAD : 0;
      const g = this._voice(t, NOTE(midi), M.BAR_SECONDS * 1.45, 'sawtooth', 0.018 * gain, 1050, this.pumpGain, 0.24, pan);
      g.connect(this.delaySend);
    });
  }

  // Лид справа (детюн-дубль для ширины), с эхом в ping-pong (отскакивает влево).
  _lead(t, midi, dur = 0.32, gain = 1) {
    const freq = NOTE(midi);
    const g1 = this._voice(t, freq, dur, 'sawtooth', 0.055 * gain, 2800 + 1800 * this.smoothedIntensity, this.pumpGain, 0.008, M.PAN_LEAD);
    const g2 = this._voice(t, freq * 1.006, dur, 'square', 0.025 * gain, 3400, this.pumpGain, 0.008, M.PAN_LEAD * 0.4);
    g1.connect(this.delaySend); g2.connect(this.delaySend);
  }

  _scheduleStep(t) {
    const p = this.profile;
    this.smoothedIntensity += (p.intensity - this.smoothedIntensity) * 0.16;
    const intensity = this.smoothedIntensity;
    const step16 = this.step % 16;
    const step32 = this.step % 32;
    const bar = Math.floor(this.step / 16);
    const phraseBar = bar % 8;
    const chord = M.PROGRESSION[phraseBar];
    // Гармония зоны: транспонируем всю прогрессию (Даркнет ниже/темнее, Рассвет выше).
    const tz = M.ZONE_TRANSPOSE[p.zone % M.ZONE_TRANSPOSE.length] | 0;
    const root = chord.root + tz;

    // Плавная «крышка фильтра»: captcha становится далёким тревожным пульсом.
    const cutoffTarget = p.mode === 'captcha'
      ? M.CAPTCHA_FILTER
      : M.FILTER_MIN + (M.FILTER_MAX - M.FILTER_MIN) * intensity;
    this.musicFilter.frequency.setTargetAtTime(cutoffTarget, t, 0.08);

    if (step16 === 0) this._pad(t, chord.pad.map((n) => n + tz), 0.5 + intensity * 0.8);

    if (p.mode === 'captcha') {
      if (step16 === 0 || step16 === 8) this._kick(t, 0.48);
      if (step16 % 4 === 0) this._bass(t, root - 12, 0.48, 0.3);
      if (step16 === 7 || step16 === 15) this._lead(t, root + 19, 0.13, 0.28);
      return;
    }

    // Драматургия фразы: первые 2 такта сдержаннее, 7–8 — пик/разрешение.
    const phraseLift = phraseBar >= 6 ? 0.16 : phraseBar >= 4 ? 0.08 : 0;
    const drive = clamp01(intensity + phraseLift);

    // Kick: half-time на старте, four-on-the-floor по мере разгона.
    if (step16 === 0 || step16 === 8 || (drive > 0.43 && step16 % 4 === 0)) this._kick(t, 0.72 + drive * 0.35);
    if (step16 === 4 || step16 === 12) this._snare(t, 0.68 + drive * 0.42);
    if (drive > 0.2 && step16 % 2 === 0) this._hat(t, drive > 0.72 && step16 === 14, 0.6 + drive * 0.55);
    if (drive > 0.7 && phraseBar === 7 && step16 >= 12 && step16 % 2 === 0) {
      this._tom(t, 43 + (step16 - 12) * 2, drive);
    }

    const bassPattern = [0, 0, 12, 0, 0, 7, 12, 7, 0, 0, 12, 7, 0, 7, 10, 12];
    if (step16 % 2 === 0 || drive > 0.62) {
      const semitone = drive > 0.62 ? bassPattern[step16] : bassPattern[step16 & 14];
      this._bass(t, root - 12 + semitone, step16 % 4 === 0 ? 1.12 : 0.78, drive > 0.7 ? 0.15 : 0.22);
    }

    const arpIndex = M.ARP_ORDER[step16];
    if (drive > 0.16 && (step16 % 2 === 1 || drive > 0.58)) {
      this._arp(t, chord.arp[arpIndex] + tz + (p.boosting ? 12 : 0), 0.55 + drive * 0.75);
    }

    // Лид появляется как награда, а не болтает без остановки.
    const motif = M.LEAD_MOTIF[phraseBar];
    if ((p.boosting || p.comboLevel > 0.45 || intensity > 0.76) && motif[step16] != null) {
      const octave = p.boosting ? 12 : 0;
      this._lead(t, root + motif[step16] + octave, p.boosting ? 0.34 : 0.27, p.boosting ? 1.25 : 0.78);
    }

    // Последний offbeat фразы тянет в следующую гармонию.
    if (step32 === 31 && drive > 0.42) this._lead(t, root + 19, 0.42, 0.5 + drive * 0.35);
  }

  startMusic() {
    if (!this.ctx || this.loopTimer) return;
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), t);
    this.musicGain.gain.setTargetAtTime(M.MUSIC_GAIN, t, M.FADE_IN);
    this.nextStepTime = t + 0.08;
    this.started = true;

    this.loopTimer = setInterval(() => {
      if (!this.ctx) return;
      if (!this.enabled) {
        this.nextStepTime = this.ctx.currentTime + 0.08;
        return;
      }
      while (this.nextStepTime < this.ctx.currentTime + M.LOOKAHEAD) {
        this._scheduleStep(this.nextStepTime);
        this.step++;
        this.nextStepTime += M.STEP_SECONDS;
      }
    }, M.SCHEDULER_MS);
  }

  stopMusic() {
    if (this.loopTimer) { clearInterval(this.loopTimer); this.loopTimer = null; }
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(0.0001, t, M.FADE_OUT);
  }
}
