// FTUE: 3-шаговая подсказка поверх первого забега. Чистая модель состояния —
// main.js синхронизирует с ней DOM-оверлей (UI.showTutorialStep/hideTutorial)
// и дёргает onSwipe()/onCollect() из обработчиков ввода/коллизий.
//
// Шаг 0 «свайпай» держит мир в slow-mo (через timescale) — время разглядеть
// управление без риска влететь в препятствие. Завершается флагом
// settings.tutorialDone — повторно не активируется.
import { Settings } from './settings.js';
import * as timescale from '../engine/timescale.js';

const STEP0_SLOWMO = 0.3;   // множитель скорости на шаге «свайпай»
const STEP2_DURATION = 4.0; // сек — последний шаг закрывается по таймеру

export class Tutorial {
  constructor() {
    this.step = -1; // -1 = неактивен/завершён, 0..2 — текущий шаг
    this.timer = 0;
  }

  get active() { return this.step >= 0; }

  // Запускать только при старте забега. Не реактивируется, если уже пройден.
  start() {
    if (Settings.get('tutorialDone')) { this.step = -1; return; }
    this.step = 0;
    this.timer = 0;
  }

  update(realDt) {
    if (this.step === 0) {
      // продлеваем slow-mo, пока игрок не сделал первый свайп
      timescale.slowMo(STEP0_SLOWMO, 0.25);
    } else if (this.step === 2) {
      this.timer += realDt;
      if (this.timer >= STEP2_DURATION) this.finish();
    }
  }

  onSwipe() {
    if (this.step === 0) { this.step = 1; timescale.reset(); }
  }

  onCollect() {
    if (this.step === 1) { this.step = 2; this.timer = 0; }
  }

  finish() {
    if (this.step < 0) return;
    this.step = -1;
    Settings.set('tutorialDone', true);
  }
}
