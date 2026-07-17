#!/usr/bin/env node
// ============================================================================
//  Рассылка победителям доски через Telegram-бота привязки.
//  Запуск на сервере (нужны BOT_TOKEN и доступ к БД):
//
//    BOT_TOKEN=... node notify-winners.mjs --top 3 --period week \
//      --message "Поздравляем, ты в топ-3 недели! Напиши нам для получения приза."
//
//    BOT_TOKEN=... node notify-winners.mjs --player <playerId> --message "..."
//    BOT_TOKEN=... node notify-winners.mjs --all --message "..." --button-url "https://..."
//
//    node notify-winners.mjs --top 10 --period week --dry   # без отправки
//    ... --board total   # победители по суммарному пробегу, а не по рекорду
//
//  Плейсхолдеры в message: {alias} {rank} {score} {distance}.
//  Для призов учитываются только verified-забеги (наблюдались heartbeat-сессией).
// ============================================================================

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'data', 'uboost.db'));
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const RULESET_VERSION = process.env.RULESET_VERSION || '2026-07-17-v2';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] ?? true) : fallback;
};
const top = Number(opt('top', 0));
const player = opt('player');
const all = args.includes('--all');
const period = opt('period', 'week') === 'all' ? 'all' : 'week';
const board = opt('board', 'best') === 'total' ? 'total' : 'best';
const campaignFile = opt('campaign-file');
let campaign = {};
if (campaignFile) {
  try { campaign = JSON.parse(readFileSync(path.resolve(campaignFile), 'utf8')); }
  catch (err) { console.error(`Не удалось прочитать campaign-file: ${err.message}`); process.exit(1); }
}
const message = campaign.message || opt('message');
const parseMode = campaign.parseMode || opt('parse-mode');
const buttonText = campaign.buttonText || opt('button-text');
const buttonUrl = campaign.buttonUrl || opt('button-url');
const dry = args.includes('--dry');

if ((!top && !player && !all) || !message) {
  console.error('usage: node notify-winners.mjs (--all | --top N [--period week|all] | --player <id>) (--campaign-file campaign.json | --message "...") [--parse-mode HTML] [--button-text "..."] [--button-url https://...] [--dry]');
  process.exit(1);
}
if (buttonText && !buttonUrl || !buttonText && buttonUrl) {
  console.error('--button-text и --button-url нужно указывать вместе');
  process.exit(1);
}
if (!BOT_TOKEN && !dry) { console.error('BOT_TOKEN не задан (или используй --dry)'); process.exit(1); }

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const since = period === 'all' ? 0 : Date.now() - 7 * 24 * 60 * 60 * 1000;

// Только verified-забеги: подделанный или ненаблюдавшийся результат приза не берёт.
const winners = all
  ? db.prepare(`
      SELECT l.player_id AS playerId, COALESCE(p.alias, '') AS alias,
             0 AS score, 0 AS distance, l.chat_id AS chatId, l.username
      FROM telegram_links l
      LEFT JOIN players p ON p.player_id = l.player_id
      WHERE l.chat_id IS NOT NULL
      GROUP BY l.chat_id
      ORDER BY l.linked_at ASC
    `).all()
  : player
  ? db.prepare(`
      SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias, MAX(r.score) AS score,
             l.chat_id AS chatId, l.username
      FROM runs r
      LEFT JOIN players p ON p.player_id = r.player_id
      LEFT JOIN telegram_links l ON l.player_id = r.player_id
      WHERE r.player_id = ? AND r.verified = 1 AND r.ruleset_version = ?
      GROUP BY r.player_id
    `).all(player, RULESET_VERSION)
  : board === 'total'
  ? db.prepare(`
      SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias,
             SUM(r.score) AS score, SUM(r.distance) AS distance,
             l.chat_id AS chatId, l.username
      FROM runs r
      LEFT JOIN players p ON p.player_id = r.player_id
      LEFT JOIN telegram_links l ON l.player_id = r.player_id
      WHERE r.created_at >= ? AND r.verified = 1 AND r.ruleset_version = ?
      GROUP BY r.player_id
      ORDER BY distance DESC, score DESC
      LIMIT ?
    `).all(since, RULESET_VERSION, top)
  : db.prepare(`
      SELECT r.player_id AS playerId, COALESCE(p.alias, '') AS alias, MAX(r.score) AS score, r.distance,
             l.chat_id AS chatId, l.username
      FROM runs r
      LEFT JOIN players p ON p.player_id = r.player_id
      LEFT JOIN telegram_links l ON l.player_id = r.player_id
      WHERE r.created_at >= ? AND r.verified = 1 AND r.ruleset_version = ?
      GROUP BY r.player_id
      ORDER BY score DESC, r.distance DESC, r.created_at ASC
      LIMIT ?
    `).all(since, RULESET_VERSION, top);

async function send(chatId, text) {
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  if (buttonText && buttonUrl) {
    body.reply_markup = { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] };
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

let rank = 0;
let sent = 0;
let skipped = 0;
let failed = 0;
for (const w of winners) {
  rank++;
  const text = String(message)
    .replaceAll('{alias}', w.alias || 'Игрок')
    .replaceAll('{rank}', String(rank))
    .replaceAll('{score}', String(w.score))
    .replaceAll('{distance}', String(w.distance ?? ''));
  const who = all
    ? `получатель #${rank}`
    : `#${rank} ${w.alias || w.playerId} (${w.score})` + (w.username ? ` @${w.username}` : '');
  if (!w.chatId) { skipped++; console.log(`✗ ${who} — Telegram НЕ привязан, написать нельзя`); continue; }
  if (dry) { console.log(`· ${who} → [dry] ${text}`); continue; }
  const result = await send(w.chatId, text);
  if (result?.ok) { sent++; console.log(`✓ ${who} — отправлено`); }
  else { failed++; console.log(`✗ ${who} — ошибка: ${JSON.stringify(result)}`); }
}
if (!winners.length) console.log('Победителей не найдено (нужны verified-забеги за период).');
else if (dry) console.log(`Dry-run: ${winners.length} получателей.`);
else console.log(`Итого: отправлено ${sent}, пропущено ${skipped}, ошибок ${failed}.`);
