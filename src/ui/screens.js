// Управление DOM-экранами: старт / game over / HUD.
import { STR } from './strings.js';

const $ = (id) => document.getElementById(id);

export const dom = {
  start: $('start-screen'),
  over: $('game-over-screen'),
  hud: $('hud'),
  score: $('score-display'),
  dist: $('dist-display'),
  lives: $('lives-display'),
  combo: $('combo-display'),
  mult: $('mult-display'),
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
  btnSettings: $('btn-settings'),
  btnPauseSettings: $('btn-pause-settings'),
  btnSettingsClose: $('btn-settings-close'),
  settingsScreen: $('settings-screen'),
  setSound: $('set-sound'),
  setMotion: $('set-motion'),
  setColorAssist: $('set-colorassist'),
  setSwipe: $('set-swipe'),
  setScale: $('set-scale'),
  tutorialOverlay: $('tutorial-overlay'),
  rankDisplay: $('rank-display'),
  rankDisplayOver: $('rank-display-over'),
  missionsList: $('missions-list'),
  missionsBonus: $('missions-bonus'),
  badgesToast: $('badges-toast'),
};

export function fillStaticCopy() {
  $('title').textContent = STR.title;
  $('tagline').textContent = STR.tagline;
  $('howto').textContent = STR.howto;
  dom.btnStart.textContent = STR.start;
  dom.btnRestart.textContent = STR.restart;
  dom.btnShare.textContent = STR.share;
  dom.btnUboost.innerHTML = `${STR.cta}<span class="cta-sub">${STR.ctaSub}</span>`;
  $('settings-title').textContent = STR.settingsTitle;
  $('set-sound-label').textContent = STR.settingsSound;
  $('set-motion-label').textContent = STR.settingsMotion;
  $('set-colorassist-label').textContent = STR.settingsColorAssist;
  $('set-swipe-label').textContent = STR.settingsSwipe;
  $('set-scale-label').textContent = STR.settingsScale;
  dom.btnSettingsClose.textContent = STR.settingsBack;
  dom.btnPauseSettings.textContent = '⚙ ' + STR.settingsTitle;
  $('missions-title').textContent = STR.missionsTitle;
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

// --- Мета-прогрессия: звание (старт + game over) -----------------------------
export function showRank(name) {
  if (dom.rankDisplay) dom.rankDisplay.textContent = `${STR.rankLabel}: ${name}`;
}

export function showStart() {
  dom.start.classList.remove('hidden');
  dom.over.classList.add('hidden');
  dom.hud.classList.add('hidden');
  dom.btnPause?.classList.add('hidden');
  dom.btnSettings?.classList.remove('hidden');
}

export function showGame() {
  dom.start.classList.add('hidden');
  dom.over.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.btnPause?.classList.remove('hidden');
  dom.btnSettings?.classList.add('hidden');
}

// --- Пауза --------------------------------------------------------------------
export function showPause() {
  $('pause-title').textContent = STR.pause;
  dom.btnResume.textContent = STR.resume;
  dom.pauseCountdown.classList.add('hidden');
  dom.btnResume.classList.remove('hidden');
  dom.btnPauseSettings.classList.remove('hidden');
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

// --- Настройки ------------------------------------------------------------
export function showSettings() {
  dom.settingsScreen.classList.remove('hidden');
}

export function hideSettings() {
  dom.settingsScreen.classList.add('hidden');
}

// Подписи переключателей настроек по текущему состоянию.
export function refreshSettingsUI(settings, audioEnabled) {
  dom.setSound.textContent = audioEnabled ? STR.on : STR.off;
  const motion = settings.get('reducedMotion');
  dom.setMotion.textContent = motion === 'auto' ? STR.auto : (motion === 'on' ? STR.off : STR.on);
  dom.setColorAssist.textContent = settings.get('colorAssist') ? STR.on : STR.off;
  const swipe = settings.get('swipeSens');
  dom.setSwipe.textContent = swipe === 0 ? STR.swipeSensitive : (swipe === 2 ? STR.swipeStiff : STR.swipeNormal);
  const scale = settings.get('uiScale');
  dom.setScale.textContent = scale === 0 ? STR.scaleSmall : (scale === 2 ? STR.scaleLarge : STR.scaleNormal);
}

// --- FTUE-туториал ----------------------------------------------------------
export function showTutorialStep(text) {
  if (!dom.tutorialOverlay) return;
  dom.tutorialOverlay.textContent = text;
  dom.tutorialOverlay.classList.remove('hidden');
}

export function hideTutorial() {
  dom.tutorialOverlay?.classList.add('hidden');
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
  // бейдж удвоителя очков (×2)
  if (dom.mult) dom.mult.classList.toggle('hidden', (stats.scoreMult ?? 1) <= 1);
  if (boostFrac > 0) { dom.boostWrap.classList.remove('hidden'); dom.boostBar.style.width = (boostFrac * 100) + '%'; }
  else dom.boostWrap.classList.add('hidden');
}

export function showGameOver(stats, isRecord, cardCanvas, challengeBeat = false, meta = {}) {
  dom.hud.classList.add('hidden');
  dom.btnPause?.classList.add('hidden');
  dom.btnSettings?.classList.remove('hidden');
  dom.over.classList.remove('hidden');
  $('gameover-title').textContent = STR.gameOver;
  dom.deathLine.textContent = challengeBeat ? STR.challengeBeat : STR.deathFor(stats);
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

  // звание (+ повышение)
  if (dom.rankDisplayOver) {
    const rankName = STR.ranks[meta.rankId ?? 0];
    dom.rankDisplayOver.textContent = meta.rankUp ? STR.rankUp(rankName) : `${STR.rankLabel}: ${rankName}`;
    dom.rankDisplayOver.classList.toggle('rank-up', !!meta.rankUp);
  }
  showRank(STR.ranks[meta.rankId ?? 0]);

  // миссии забега
  if (dom.missionsList) {
    const missions = meta.missions || [];
    const done = new Set(meta.missionsDone || []);
    dom.missionsList.innerHTML = missions.map((m) => {
      const ok = done.has(m.id);
      const label = STR.missions[m.id]?.(m.target) ?? m.id;
      return `<li class="${ok ? 'done' : ''}">${ok ? '✓' : '–'} ${label}</li>`;
    }).join('');
  }
  if (dom.missionsBonus) {
    const bonus = meta.bonus || 0;
    dom.missionsBonus.textContent = bonus > 0 ? STR.missionBonus(bonus) : '';
    dom.missionsBonus.classList.toggle('hidden', bonus <= 0);
  }

  // новые бейджи — тост
  if (dom.badgesToast) {
    const badges = meta.newBadges || [];
    dom.badgesToast.innerHTML = badges.map((id) => {
      const b = STR.badges[id];
      if (!b) return '';
      return `<div class="badge-toast"><b>${STR.badgeUnlocked}:</b> ${b.name}<br><span>${b.desc}</span></div>`;
    }).join('');
  }
}
