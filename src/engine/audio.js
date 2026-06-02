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
  sfxBit() { this._tone(880, 0.05, 'triangle', 0.12); }      // короткий блип для потока данных
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

  // простой синтвейв-арпеджио луп
  startMusic() {
    if (!this.ctx || this.loopTimer) return;
    const scale = [220, 277, 330, 440, 330, 277]; // Am-ish
    const bass = [110, 110, 146.83, 130.81];
    const tick = () => {
      const i = this.step % scale.length;
      this._tone(scale[i], 0.22, 'triangle', 0.12, this.musicGain);
      if (this.step % 2 === 0) this._tone(bass[(this.step / 2) % bass.length | 0], 0.4, 'sawtooth', 0.1, this.musicGain);
      this.step++;
    };
    this.loopTimer = setInterval(tick, 200);
  }

  stopMusic() {
    if (this.loopTimer) { clearInterval(this.loopTimer); this.loopTimer = null; }
  }
}
