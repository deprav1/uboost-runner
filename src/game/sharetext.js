// Единый payload для шеринга. URL хранится отдельно от текста, чтобы Telegram
// и Web Share API не показывали одну и ту же ссылку дважды.
import { CONFIG } from '../../config.js';
import { STR } from '../ui/strings.js';

export function buildChallengeShare(distance, score, refId = '') {
  let url;
  try {
    const target = new URL(CONFIG.GAME_URL);
    target.searchParams.set('c', score);
    // ref = кто позвал: атрибуция виральной петли (счётчик «друзей привёл»).
    if (refId) target.searchParams.set('ref', refId);
    if (CONFIG.STRINGS_SAFE) target.searchParams.set('safe', '1');
    url = target.toString();
  } catch {
    url = CONFIG.GAME_URL + '?c=' + score;
  }
  const text = STR.challengeShareText(distance, score);
  return { url, text, fallbackText: text + url };
}
