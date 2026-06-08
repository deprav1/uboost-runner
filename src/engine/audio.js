// Процедурный звук на WebAudio: синтвейв-луп + sfx. Без файлов-ассетов.

export class Audio {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.loopTimer = null;
    this.step = 0;
    this.started = false;
  }

  // вызывать из обработчика первого пользовательского действия
  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.master);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.9 : 0;
  }

  _tone(freq, dur, type = 'square', gain = 0.3, dest = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  sfxLane() { this._tone(520, 0.08, 'triangle', 0.25); }
  sfxBit() { this._tone(880, 0.05, 'triangle', 0.12); }
  sfxCaptcha() { this._tone(220, 0.12, 'sawtooth', 0.28); this._tone(330, 0.10, 'square', 0.2); }
  sfxPickup() { this._tone(660, 0.12, 'sawtooth', 0.3); setTimeout(() => this._tone(990, 0.18, 'sawtooth', 0.3), 60); }
  sfxBoost() { this._tone(220, 0.5, 'sawtooth', 0.35); this._tone(440, 0.5, 'square', 0.2); }
  sfxSmash() { this._tone(140, 0.1, 'square', 0.3); }
  sfxHit() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.5);
  }

  _kick(t) {
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(1, t + 0.5);
    g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.5);
  }

  _snare(t) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(200, t);
    const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(0.4, t); g2.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    src.connect(f); f.connect(g); g.connect(this.musicGain); o.connect(g2); g2.connect(this.musicGain);
    src.start(t); o.start(t); o.stop(t+0.2);
  }

  _hat(t) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
    src.connect(f); f.connect(g); g.connect(this.musicGain); src.start(t);
  }

  _bass(t, freq) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(100, t + 0.2);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    o.connect(f); f.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.2);
  }

  _synth(t, freq) {
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.05); g.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    o.connect(f); f.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.3);
  }

  // Полноценный процедурный синтвейв-саундтрек
  startMusic() {
    if (!this.ctx || this.loopTimer) return;
    this.musicGain.gain.value = 0.4;
    
    const stepTime = 0.125; // 120 BPM, 1/16 нота
    let nextStepTime = this.ctx.currentTime + 0.1;
    this.step = 0;

    this.loopTimer = setInterval(() => {
      // Предпланирование аудио на 150мс вперед (lookahead scheduler)
      while (nextStepTime < this.ctx.currentTime + 0.15) {
        const i = this.step % 16;
        const b = this.step % 64;

        // Драм-машина
        if (i % 4 === 0) this._kick(nextStepTime);
        if (i % 8 === 4) this._snare(nextStepTime);
        if (i % 2 === 0) this._hat(nextStepTime);

        // Аккордовая прогрессия (Em, C, D, Bm)
        const bassNotes = [41.20, 32.70, 36.71, 30.87];
        const arpNotes = [
          [164.8, 196.0, 246.9, 329.6], // Em
          [130.8, 164.8, 196.0, 261.6], // C
          [146.8, 185.0, 220.0, 293.7], // D
          [123.5, 146.8, 185.0, 246.9]  // Bm
        ];
        
        const chordIdx = Math.floor(b / 16);
        
        // Ролл-бас
        let bassFreq = bassNotes[chordIdx];
        if (i % 8 === 7) bassFreq *= 2; // Октавный скачок
        this._bass(nextStepTime, bassFreq);

        // Синкопированное арпеджио
        if (i % 2 !== 0 || i === 0 || i === 6) {
           this._synth(nextStepTime, arpNotes[chordIdx][i % 4] * 2);
        }

        this.step++;
        nextStepTime += stepTime;
      }
    }, 50);
  }

  stopMusic() {
    if (this.loopTimer) { clearInterval(this.loopTimer); this.loopTimer = null; }
  }
}
