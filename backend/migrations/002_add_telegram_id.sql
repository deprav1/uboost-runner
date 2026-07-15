-- Выполнить только для уже созданной по старой schema.sql базы D1.
ALTER TABLE leaderboard_entries ADD COLUMN telegram_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_telegram_id
  ON leaderboard_entries(telegram_id);
