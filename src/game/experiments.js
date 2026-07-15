// Небольшой стабильный A/B-распределитель без cookies и персональных данных.
import { CONFIG } from '../../config.js';

const KEY = 'uboost_runner_start_copy_v1';

export function startCopyVariant() {
  if (!CONFIG.EXPERIMENTS?.START_COPY) return 'control';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'control' || saved === 'clarity') return saved;
    const value = Math.random() < 0.5 ? 'control' : 'clarity';
    localStorage.setItem(KEY, value);
    return value;
  } catch { return 'control'; }
}
