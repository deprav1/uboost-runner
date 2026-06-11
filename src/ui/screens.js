// Управление DOM-экранами: старт / game over / HUD.
import { STR, pick } from './strings.js';

const $ = (id) => document.getElementById(id);

export const dom = {
  start: $('start-screen'),
  over: $('game-over-screen'),
  hud: $('hud'),
  score: $('score-display'),
  dist: $('dist-display'),
  lives: $('lives-display'),
  combo: $('combo-display'),
  boostBar: $('boost-bar'),
  boostWrap: $('boost-indicator'),
  statsList: $('stats-list'),
  finalScore: $('final-score'),
  deathLine: $('death-line'),
  recordBadge: $('record-badge'),
  cardPreview: $('card-preview'),
  btnStart: $('btn-start'),
  btnRestart: $('btn-restart'),
  btnShare: $('btn-share'),
  btnUboost: $('btn-uboost'),
  btnMute: $('btn-mute'),
  btnPause: $('btn-pause'),
  btnResume: $('btn-resume'),
  pauseScreen: $('pause-screen'),
  pauseCountdown: $('pause-countdown'),
  challengeBanner: $('challenge-banner'),
};

export function fillStaticCopy() {
  $('title').textContent = STR.title;
  $('tagline').textContent = STR.tagline;
  $('howto').textContent = STR.howto;
  dom.btnStart.textContent = STR.start;
  dom.btnRestart.textContent = STR.restart;
  dom.btnShare.textContent = STR.share;
  dom.btnUboost.innerHTML = `${STR.cta}<span class="cta-sub">${STR.ctaSub}</span>`;
}

export function showChallenge(score) {
  if (!dom.challengeBanner) return;
  if (score > 0) {
    dom.challengeBanner.textContent = STR.challengeBanner(score);
    dom.challengeBanner.classList.remove('hidden');
  } else {
    dom.challengeBanner.classList.add('hidden');
  }
}

export function showStart() {
  dom.start.classList.remove('hidden');
  dom.over.classList.add('hidden');
  dom.hud.classList.add('hidden');
  dom.btnPause?.classList.add('hidden');
}

export function showGame() {
  dom.start.classList.add('hidden');
  dom.over.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.btnPause?.classList.remove('hidden');
}

// --- Пауза --------------------------------------------------------------------
export function showPause() {
  $('pause-title').textContent = STR.pause;
  dom.btnResume.textContent = STR.resume;
  dom.pauseCountdown.classList.add('hidden');
  dom.btnResume.classList.remove('hidden');
  dom.pauseScreen.classList.remove('hidden');
}

export function hidePause() {
  dom.pauseScreen.classList.add('hidden');
}

export function setPauseCountdown(n) {
  dom.btnResume.classList.add('hidden');
  dom.pauseCountdown.classList.remove('hidden');
  dom.pauseCountdown.textContent = n;
}

export function updateHud(stats, boostFrac) {
  dom.score.textContent = stats.scoreInt;
  dom.dist.textContent = stats.distInt + ' м';
  // сердца
  if (dom.lives) dom.lives.textContent = '♥'.repeat(Math.max(0, stats.lives));
  if (stats.combo > 1) {
    if (dom.combo.textContent !== '×' + stats.combo + ' КОМБО') {
      dom.combo.textContent = '×' + stats.combo + ' КОМБО';
      dom.combo.classList.remove('bump');
      void dom.combo.offsetWidth; // restart animation
      dom.combo.classList.add('bump');
    }
    dom.combo.classList.add('show');
  } else dom.combo.classList.remove('show');
  if (boostFrac > 0) { dom.boostWrap.classList.remove('hidden'); dom.boostBar.style.width = (boostFrac * 100) + '%'; }
  else dom.boostWrap.classList.add('hidden');
}

export function showGameOver(stats, isRecord, cardCanvas, challengeBeat = false) {
  dom.hud.classList.add('hidden');
  dom.btnPause?.classList.add('hidden');
  dom.over.classList.remove('hidden');
  $('gameover-title').textContent = STR.gameOver;
  dom.deathLine.textContent = challengeBeat ? STR.challengeBeat : pick(STR.death);
  dom.finalScore.innerHTML = `<b>${stats.scoreInt}</b> очков · ${stats.distInt} м · ${STR.best}: ${stats.best}`;
  dom.recordBadge.classList.toggle('hidden', !isRecord);
  dom.statsList.innerHTML = `
    <li><span>${stats.captchas}</span> ${STR.stat.captchas}</li>
    <li><span>${stats.geoblocks}</span> ${STR.stat.geoblocks}</li>
    <li><span>${stats.ads}</span> ${STR.stat.ads}</li>
    <li><span>${stats.lags}</span> ${STR.stat.lags}</li>`;
  // превью карточки
  dom.cardPreview.innerHTML = '';
  cardCanvas.style.width = '100%';
  cardCanvas.style.borderRadius = '12px';
  dom.cardPreview.appendChild(cardCanvas);
}
