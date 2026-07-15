-- Cloudflare D1: минимальная схема для ЮБуст Раннер.
-- Не хранит Telegram initData, IP, имя, User-Agent или тексты сообщений.

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  telegram_id TEXT,
  props_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_events_event_time
  ON analytics_events(event, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_telegram_time
  ON analytics_events(telegram_id, created_at);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  player_id TEXT PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  alias TEXT NOT NULL,
  score INTEGER NOT NULL,
  distance INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS leaderboard_score
  ON leaderboard_entries(score DESC, distance DESC, created_at ASC);
