// Чистые правила состояния силы: временная защита после удара не равна
// настоящему VPN-бусту. Вынесено отдельно, чтобы инвариант тестировался без DOM.
import { CONFIG } from '../../config.js';

export function isBoosting(boostTimer) {
  return Number.isFinite(boostTimer) && boostTimer > 0;
}

export function speedWithBoost(baseSpeed, boostTimer) {
  return isBoosting(boostTimer) ? CONFIG.BOOST_SPEED : baseSpeed;
}

export function canSmash(boostTimer) {
  return isBoosting(boostTimer);
}
