#!/usr/bin/env node
// ============================================================================
//  Рассылка победителям доски через Telegram-бота привязки.
//  Запуск на сервере (нужны BOT_TOKEN и доступ к БД):
//
//    BOT_TOKEN=... node notify-winners.mjs --top 3 --period week \
//      --message "Поздравляем, ты в топ-3 недели! Напиши нам для получения приза."
//
//    BOT_TOKEN=... node notify-winners.mjs --player <playerId> --message "..."
//
//    node notify-winners.mjs --top 10 --period week --dry   # без отправки
//    ... --board total   # победители по суммарному пробегу, а не по рекорду
//
//  Плейсхолдеры в message: {alias} {rank} {score} {distance}.
//  Для призов учитываются только verified-забеги (наблюдались heartbeat-сессией).
// ============================================================================

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'data', 'uboost.db'));
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] ?? true) : fallback;
};
const top = Number(opt('top', 0));
const player = opt('player');
const period = opt('period', 'week') === 'all' ? 'all' : 'week';
const board = opt('board', 'best') === 'total' ? 'total' : 'best';
const message = opt('message');
const dry = args.includes('--dry');

if ((!top && !player) || !message) {
  console.error('usage: node notify-winners.mjs (--top N [--period week|all] | --player <id>) --message "..." [--dry]');
  process.exit(1);
}
if (!BOT_TOKEN && !dry) { console.error('BOT_TOKEN не задан (или используй --dry)'); process.exit(1); }

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const since = period === 'all' ? 0 : Date.now() - 7 * 24 * 60 * 60 * 1000;

// Только verified-забеги: подделанный или ненаблюдавшийся результат приза не берёт.
const winners = player
  ? db.prepare(`
      SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias, MAX(r.score) AS score,
             l.chat_id AS chatId, l.username
      FROM runs r
      LEFT JOIN players p ON p.player_id = r.player_id
      LEFT JOIN telegram_links l ON l.player_id = r.player_id
      WHERE r.player_id = ? GROUP BY r.player_id
    `).all(player)
  : board === 'total'
  ? db.prepare(`
      SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias,
             SUM(r.score) AS score, SUM(r.distance) AS distance,
             l.chat_id AS chatId, l.username
      FROM runs r
      LEFT JOIN players p ON p.player_id = r.player_id
      LEFT JOIN telegram_links l ON l.player_id = r.player_id
      WHERE r.created_at >= ? AND r.verified = 1
      GROUP BY r.player_id
      ORDER BY distance DESC, score DESC
      LIMIT ?
    `).all(since, top)
  : db.prepare(`
      SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias, MAX(r.score) AS score, r.distance,
             l.chat_id AS chatId, l.username
      FROM runs r
      LEFT JOIN players p ON p.player_id = r.player_id
      LEFT JOIN telegram_links l ON l.player_id = r.player_id
      WHERE r.created_at >= ? AND r.verified = 1
      GROUP BY r.player_id
      ORDER BY score DESC, r.distance DESC, r.created_at ASC
      LIMIT ?
    `).all(since, top);

async function send(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.json();
}

let rank = 0;
for (const w of winners) {
  rank++;
  const text = String(message)
    .replaceAll('{alias}', w.alias || 'Игрок')
    .replaceAll('{rank}', String(rank))
    .replaceAll('{score}', String(w.score))
    .replaceAll('{distance}', String(w.distance ?? ''));
  const who = `#${rank} ${w.alias || w.playerId} (${w.score})` + (w.username ? ` @${w.username}` : '');
  if (!w.chatId) { console.log(`✗ ${who} — Telegram НЕ привязан, написать нельзя`); continue; }
  if (dry) { console.log(`· ${who} → [dry] ${text}`); continue; }
  const result = await send(w.chatId, text);
  console.log(result?.ok ? `✓ ${who} — отправлено` : `✗ ${who} — ошибка: ${JSON.stringify(result)}`);
}
if (!winners.length) console.log('Победителей не найдено (нужны verified-забеги за период).');
