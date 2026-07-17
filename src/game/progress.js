// Мета-прогрессия: профиль игрока {gamesPlayed, totalDist, bestCombo, badges,
// rankId} в STORAGE_KEY-блобе + CloudStorage-merge по образцу
// Stats.pushBestToCloud/syncBestFromCloud (merge по максимуму).
// Чистые функции rankFor/rollMissions/checkMissions/checkBadges тестируются
// headless из test/harness.mjs.
import { CONFIG } from '../../config.js';
import { loadFlag, saveFlag } from './settings.js';

const DEFAULT_PROFILE = {
  gamesPlayed: 0,
  totalDist: 0,
  bestCombo: 0,
  badges: [],
  rankId: 0,
  captchaSeen: 0, // сколько капч видел за всё время (щадящий режим первых N)
};

// Звание по итоговым очкам забега (после бонуса миссий). Монотонна по score.
export function rankFor(score) {
  const ranks = CONFIG.RANKS;
  let id = 0;
  for (let i = 0; i < ranks.length; i++) if (score >= ranks[i]) id = i;
  return id;
}

// 3 случайные уникальные миссии на забег. rng — для детерминизма render-shot.mjs.
export function rollMissions(rng = Math.random, count = 3) {
  const pool = [...CONFIG.MISSIONS];
  const picked = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = (rng() * pool.length) | 0;
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

// Проверка миссий по итогам забега. Чистая — не мутирует stats/missions.
export function checkMissions(stats, missions) {
  const done = [];
  let bonus = 0;
  for (const m of missions) {
    if ((stats[m.stat] ?? 0) >= m.target) { done.push(m.id); bonus += m.reward; }
  }
  return { done, bonus };
}

// Идемпотентная проверка бейджей: возвращает только новые id (не в profile.badges).
export function checkBadges(profile) {
  const unlocked = [];
  for (const b of CONFIG.BADGES) {
    if (profile.badges.includes(b.id)) continue;
    if ((profile[b.check] ?? 0) >= b.target) unlocked.push(b.id);
  }
  return unlocked;
}

export class Progress {
  constructor(tg = null) {
    this.tg = tg;
    const saved = loadFlag('profile', null);
    this.data = { ...DEFAULT_PROFILE, ...(saved && typeof saved === 'object' ? saved : {}) };
    if (!Array.isArray(this.data.badges)) this.data.badges = [];
    if (!Number.isFinite(this.data.gamesPlayed)) this.data.gamesPlayed = 0;
    if (!Number.isFinite(this.data.totalDist)) this.data.totalDist = 0;
    if (!Number.isFinite(this.data.bestCombo)) this.data.bestCombo = 0;
    if (!Number.isFinite(this.data.rankId)) this.data.rankId = 0;
    if (!Number.isFinite(this.data.captchaSeen)) this.data.captchaSeen = 0;
  }

  save() { saveFlag('profile', this.data); }

  // Завершение забега: stats.score уже включает бонус миссий (вызывающий код
  // прибавляет его до вызова). Обновляет профиль, считает звание и бейджи.
  finishRun(stats) {
    this.data.gamesPlayed++;
    this.data.totalDist += stats.distInt;
    if (stats.bestCombo > this.data.bestCombo) this.data.bestCombo = stats.bestCombo;

    const newRank = rankFor(stats.scoreInt);
    const rankUp = newRank > this.data.rankId;
    if (newRank > this.data.rankId) this.data.rankId = newRank;

    const newBadges = checkBadges(this.data);
    this.data.badges.push(...newBadges);

    this.save();
    this.pushToCloud();

    return { rankUp, rankId: this.data.rankId, newBadges };
  }

  pushToCloud() {
    try { this.tg?.CloudStorage?.setItem?.('profile', JSON.stringify(this.data), () => {}); } catch {}
  }

  // Подтягивает профиль из CloudStorage и сливает по максимуму (как best в Stats).
  syncFromCloud(onUpdate) {
    if (!this.tg?.CloudStorage?.getItem) return;
    try {
      this.tg.CloudStorage.getItem('profile', (err, value) => {
        if (err || !value) return;
        let cloud;
        try { cloud = JSON.parse(value); } catch { return; }
        if (!cloud || typeof cloud !== 'object') return;
        let changed = false;
        if ((cloud.gamesPlayed | 0) > this.data.gamesPlayed) { this.data.gamesPlayed = cloud.gamesPlayed | 0; changed = true; }
        if ((cloud.totalDist | 0) > this.data.totalDist) { this.data.totalDist = cloud.totalDist | 0; changed = true; }
        if ((cloud.bestCombo | 0) > this.data.bestCombo) { this.data.bestCombo = cloud.bestCombo | 0; changed = true; }
        if ((cloud.rankId | 0) > this.data.rankId) { this.data.rankId = cloud.rankId | 0; changed = true; }
        if (Array.isArray(cloud.badges)) {
          for (const b of cloud.badges) if (!this.data.badges.includes(b)) { this.data.badges.push(b); changed = true; }
        }
        if (changed) { this.save(); onUpdate?.(this.data); }
        else this.pushToCloud();
      });
    } catch {}
  }
}
