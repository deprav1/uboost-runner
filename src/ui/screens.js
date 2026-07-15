// Управление DOM-экранами: старт / game over / HUD.
import { STR } from './strings.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  missionPreview: $('mission-preview'),
  pauseMissionPreview: $('pause-mission-preview'),
  btnSettings: $('btn-settings'),
  btnPauseSettings: $('btn-pause-settings'),
  btnSettingsClose: $('btn-settings-close'),
  btnDashboard: $('btn-dashboard'),
  dashboardScreen: $('dashboard-screen'),
  dashboardTitle: $('dashboard-title'),
  dashboardSubtitle: $('dashboard-subtitle'),
  dashboardMetrics: $('dashboard-metrics'),
  leaderboardTitle: $('leaderboard-title'),
  leaderboardList: $('leaderboard-list'),
  leaderboardMe: $('leaderboard-me'),
  leaderboardRule: $('leaderboard-rule'),
  leaderboardStatus: $('leaderboard-status'),
  btnLeaderboardRefresh: $('btn-leaderboard-refresh'),
  btnDashboardClose: $('btn-dashboard-close'),
  boardTabWeek: $('board-tab-week'),
  boardTabAll: $('board-tab-all'),
  boardTabTotal: $('board-tab-total'),
  playerName: $('player-name'),
  playerNameStatus: $('player-name-status'),
  tgLink: $('tg-link'),
  tgLinkStatus: $('tg-link-status'),
  btnTgLink: $('btn-tg-link'),
  tgLinkCodeRow: $('tg-link-code-row'),
  tgLinkCode: $('tg-link-code'),
  tgLinkOpen: $('tg-link-open'),
  btnCopyChallenge: $('btn-copy-challenge'),
  promoBlock: $('promo-block'),
  promoLabel: $('promo-label'),
  promoCode: $('promo-code'),
  overBoard: $('over-board'),
  overBoardTitle: $('over-board-title'),
  overBoardList: $('over-board-list'),
  overBoardPlace: $('over-board-place'),
  btnOverBoard: $('btn-over-board'),
  settingsScreen: $('settings-screen'),
  setSound: $('set-sound'),
  setMotion: $('set-motion'),
  setColorAssist: $('set-colorassist'),
  setSwipe: $('set-swipe'),
  setScale: $('set-scale'),
  tutorialOverlay: $('tutorial-overlay'),
  rankDisplay: $('rank-display'),
  rankDisplayOver: $('rank-display-over'),
  bestDisplay: $('best-display'),
  privacyNote: $('privacy-note'),
  missionsList: $('missions-list'),
  missionsBonus: $('missions-bonus'),
  badgesToast: $('badges-toast'),
  statsBlock: $('stats'),
};

export function fillStaticCopy(copyVariant = 'control') {
  $('title').textContent = STR.title;
  $('tagline').textContent = STR.taglineVariants?.[copyVariant] || STR.tagline;
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
  if (dom.boardTabWeek) dom.boardTabWeek.textContent = STR.boardTabWeek;
  if (dom.boardTabAll) dom.boardTabAll.textContent = STR.boardTabAll;
  if (dom.boardTabTotal) dom.boardTabTotal.textContent = STR.boardTabTotal;
  if (dom.playerName) dom.playerName.placeholder = STR.namePlaceholder;
  if (dom.btnCopyChallenge) dom.btnCopyChallenge.textContent = STR.copyChallenge;
  if (dom.overBoardTitle) dom.overBoardTitle.textContent = STR.overBoardTitle;
  if (dom.btnOverBoard) dom.btnOverBoard.textContent = STR.fullBoard;
}

// Промокод на game over: блок виден, только если код задан в CONFIG.PROMO.
export function setupPromo(promo) {
  if (!dom.promoBlock) return;
  const enabled = !!promo?.code;
  dom.promoBlock.classList.toggle('hidden', !enabled);
  if (!enabled) return;
  dom.promoLabel.textContent = STR.promoLabel(promo.percent);
  dom.promoCode.textContent = promo.code;
}

// --- Рекорд на старт-экране: конкретное число мотивирует «побить себя»
// сильнее, чем абстрактное звание. ---------------------------------------
export function showBestOnStart(best) {
  if (!dom.bestDisplay) return;
  dom.bestDisplay.textContent = best > 0 ? `${STR.best}: ${best}` : '';
  dom.bestDisplay.classList.toggle('hidden', !(best > 0));
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

export function showMissionPreview(mission) {
  const text = mission ? `Цель забега: ${STR.missions[mission.id]?.(mission.target) ?? mission.id}` : '';
  for (const el of [dom.missionPreview, dom.pauseMissionPreview]) {
    if (!el) continue;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
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
  dom.btnDashboard?.classList.remove('hidden');
}

export function showPrizeNotice(enabled) {
  if (!dom.privacyNote) return;
  dom.privacyNote.textContent = enabled ? STR.prizeNotice : '';
  dom.privacyNote.classList.toggle('hidden', !enabled);
}

export function showGame() {
  dom.start.classList.add('hidden');
  dom.over.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.btnPause?.classList.remove('hidden');
  dom.btnSettings?.classList.add('hidden');
  dom.btnDashboard?.classList.add('hidden');
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
  dom.btnDashboard?.classList.add('hidden');
  dom.settingsScreen.classList.remove('hidden');
}

export function hideSettings() {
  dom.settingsScreen.classList.add('hidden');
  dom.btnDashboard?.classList.remove('hidden');
}

// --- Дашборд / рейтинг -------------------------------------------------------
const MEDALS = ['🥇', '🥈', '🥉'];

// Разовая доска: главная цифра — очки, вторая — дистанция рекорда.
// Суммарная («пробег недели»): главная — метры за неделю, вторая — число забегов.
function boardRows(entries, max = entries.length, board = 'best') {
  const total = board === 'total';
  return entries.slice(0, max).map((entry, i) => {
    const place = MEDALS[i] || String(i + 1);
    const dist = Math.max(0, Number(entry.distance) || 0);
    const secondary = total ? STR.boardRuns(entry.runs || 0) : `${dist} м`;
    const primary = total ? `${dist} м` : String(Math.max(0, Number(entry.score) || 0));
    // ✓ = забег засчитан для приза, ✈ = есть Telegram, куда приз доставить.
    // Значки идут парой: вместе они отвечают на вопрос «я вообще участвую?».
    const verified = entry.verified
      ? ` <span class="leader-verified" title="${total ? STR.verifiedTitleTotal : STR.verifiedTitle}">${STR.verifiedBadge}</span>`
      : '';
    return `<li class="${entry.you ? 'you' : ''}">`
      + `<span class="leader-place">${place}</span>`
      + `<span class="leader-name">${escapeHtml(entry.alias)}${verified}${entry.tg ? ' <span class="leader-tg">✈</span>' : ''}</span>`
      + `<span class="leader-dist">${secondary}</span>`
      + `<span class="leader-score">${primary}</span></li>`;
  }).join('');
}

// «Твоя строка»: место + near-miss до топ-10, если ты за пределами списка.
function meLine(board) {
  const me = board.me;
  if (!me || board.mode !== 'global') return '';
  if (!me.rank) return STR.notOnBoard;
  const total = board.board === 'total';
  const metric = (e) => total ? (e?.distance || 0) : (e?.score || 0);
  if (me.rank > 10 && board.entries?.length) {
    const gap = Math.max(0, metric(board.entries[board.entries.length - 1]) - metric(me) + 1);
    return gap > 0 ? STR.yourPlaceGap(me.rank, total ? `${gap} м` : gap) : STR.yourPlace(me.rank);
  }
  return STR.yourPlace(me.rank);
}

export function showDashboard(overview, board) {
  dom.dashboardTitle.textContent = STR.dashboard;
  dom.dashboardSubtitle.textContent = board.global ? STR.dashboardGlobal : STR.dashboardLocal;
  const metrics = [
    [overview.best, STR.metricBest],
    [overview.runs, STR.metricRuns],
    [`${overview.avgDistance} м`, STR.metricDistance],
    [overview.shares, STR.metricShares],
    [overview.cta, STR.metricCta],
    [`${overview.conversion}%`, STR.metricConversion],
  ];
  if (board.me && board.me.referrals > 0) metrics.push([board.me.referrals, STR.metricFriends]);
  dom.dashboardMetrics.innerHTML = metrics.map(([value, label]) =>
    `<div class="metric-card"><b>${value}</b><span>${label}</span></div>`).join('');
  const total = board.board === 'total';
  // Заголовок называет, ЧТО ранжируется; статус ниже — откуда данные. Раньше
  // оба выводили STR.leaderboardGlobal, и строка дублировалась на экране.
  dom.leaderboardTitle.textContent = board.mode !== 'global' ? STR.leaderboard
    : total ? STR.leaderboardTotal : STR.leaderboardBest;
  // Табы видны только на общей доске (у локальной нет ни периодов, ни сумм).
  const global = board.mode === 'global';
  for (const el of [dom.boardTabWeek, dom.boardTabAll, dom.boardTabTotal]) el?.classList.toggle('hidden', !global);
  dom.boardTabWeek?.classList.toggle('active', !total && board.period !== 'all');
  dom.boardTabAll?.classList.toggle('active', !total && board.period === 'all');
  dom.boardTabTotal?.classList.toggle('active', total);
  const entries = board.entries || [];
  dom.leaderboardList.innerHTML = entries.length
    ? boardRows(entries, entries.length, board.board)
    : `<li><span class="leader-place">—</span><span class="leader-name">${STR.leaderboardEmpty}</span><span class="leader-dist"></span><span class="leader-score">—</span></li>`;
  if (dom.leaderboardMe) {
    const line = meLine(board);
    dom.leaderboardMe.textContent = line;
    dom.leaderboardMe.classList.toggle('hidden', !line);
  }
  // Правило призов имеет смысл только на общей доске: локальная ничего не разыгрывает.
  if (dom.leaderboardRule) {
    dom.leaderboardRule.textContent = STR.boardPrizeRule;
    dom.leaderboardRule.classList.toggle('hidden', !global || !entries.length);
  }
  // Имя игрока: не перетираем то, что человек печатает прямо сейчас.
  if (dom.playerName && document.activeElement !== dom.playerName) dom.playerName.value = board.name || '';
  dom.leaderboardStatus.textContent = board.mode === 'global'
    ? STR.leaderboardGlobal
    : board.mode === 'offline' ? STR.leaderboardOffline : STR.leaderboardLocal;
  dom.leaderboardStatus.classList.toggle('online', board.mode === 'global');
  dom.btnDashboard?.classList.add('hidden');
  dom.settingsScreen.classList.add('hidden');
  dom.dashboardScreen.classList.remove('hidden');
}

// --- Привязка Telegram (идентификация победителей) -----------------------------
// state: { enabled, linked, username, code?, bot? } — код показывается после
// нажатия кнопки; когда привязан — только статус.
export function showTgLink(state) {
  if (!dom.tgLink) return;
  dom.tgLink.classList.toggle('hidden', !state?.enabled);
  if (!state?.enabled) return;
  if (state.linked) {
    dom.tgLinkStatus.textContent = STR.tgLinked(state.username);
    dom.tgLinkStatus.classList.add('online');
    dom.btnTgLink.classList.add('hidden');
    dom.tgLinkCodeRow.classList.add('hidden');
    return;
  }
  dom.tgLinkStatus.classList.remove('online');
  if (state.code) {
    dom.tgLinkStatus.textContent = STR.tgLinkHint(state.code);
    dom.tgLinkCode.textContent = state.code;
    dom.tgLinkOpen.textContent = STR.tgOpenBot;
    dom.tgLinkOpen.href = state.bot ? `https://t.me/${state.bot}?start=${state.code}` : '#';
    dom.btnTgLink.classList.add('hidden');
    dom.tgLinkCodeRow.classList.remove('hidden');
  } else {
    dom.tgLinkStatus.textContent = STR.tgLinkWhy;
    dom.btnTgLink.textContent = STR.tgLinkBtn;
    dom.btnTgLink.classList.remove('hidden');
    dom.tgLinkCodeRow.classList.add('hidden');
  }
}

export function setNameStatus(text) {
  if (!dom.playerNameStatus) return;
  dom.playerNameStatus.textContent = text || '';
}

// --- Мини-доска на game over: топ-3 + твоё место -------------------------------
export function showOverBoard(board) {
  if (!dom.overBoard) return;
  const entries = board.entries || [];
  const show = board.mode === 'global' && entries.length > 0;
  dom.overBoard.classList.toggle('hidden', !show);
  if (!show) return;
  dom.overBoardTitle.textContent = STR.overBoardTitle;
  dom.overBoardList.innerHTML = boardRows(entries, 3);
  const line = meLine(board);
  dom.overBoardPlace.textContent = line;
  dom.overBoardPlace.classList.toggle('hidden', !line);
}

export function hideDashboard() {
  dom.dashboardScreen.classList.add('hidden');
  dom.btnDashboard?.classList.remove('hidden');
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
  // Вызов принят, но не побит — отдельный текст, чтобы не терять контекст
  // «отвечал на конкретный вызов» под общим killer-текстом.
  dom.deathLine.textContent = challengeBeat
    ? STR.challengeBeat
    : meta.challengeMissed ? STR.challengeMissed(meta.challengeScore, stats.scoreInt)
    : STR.deathFor(stats, meta.killer);
  dom.finalScore.innerHTML = `<b>${stats.scoreInt}</b> очков · ${stats.distInt} м · ${STR.best}: ${stats.best}`;
  dom.recordBadge.classList.toggle('hidden', !isRecord);
  // Персонализация подписи CTA под причину смерти — самый эмоционально
  // заряженный момент раньше вёл на generic-подпись независимо от killer.
  if (meta.ctaSubText) {
    const sub = dom.btnUboost?.querySelector('.cta-sub');
    if (sub) sub.textContent = meta.ctaSubText;
  }
  const statRows = [
    [stats.captchas, STR.stat.captchas],
    [stats.geoblocks, STR.stat.geoblocks],
    [stats.ads, STR.stat.ads],
    [stats.lags, STR.stat.lags],
  ].filter(([n]) => n > 0);
  dom.statsList.innerHTML = statRows.map(([n, label]) => `<li><span>${n}</span> ${label}</li>`).join('');
  dom.statsBlock?.classList.toggle('hidden', statRows.length === 0);
  // превью карточки
  dom.cardPreview.innerHTML = '';
  cardCanvas.style.width = '100%';
  cardCanvas.style.borderRadius = '12px';
  dom.cardPreview.appendChild(cardCanvas);

  // звание (+ повышение). Если до следующего звания недалеко — показываем gap
  // числом (near-miss рычаг «ещё чуть-чуть» сильнее абстрактного звания).
  if (dom.rankDisplayOver) {
    const rankName = STR.ranks[meta.rankId ?? 0];
    let html = meta.rankUp ? STR.rankUp(rankName) : `${STR.rankLabel}: ${rankName}`;
    if (!meta.rankUp && meta.nextRankName && meta.nextRankGap > 0) {
      html += `<br><span class="rank-gap">${STR.rankNext(meta.nextRankName, meta.nextRankGap)}</span>`;
    }
    dom.rankDisplayOver.innerHTML = html;
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
