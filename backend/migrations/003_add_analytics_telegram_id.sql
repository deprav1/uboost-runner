-- Выполнить для базы, созданной до призовой механики.
ALTER TABLE analytics_events ADD COLUMN telegram_id TEXT;
CREATE INDEX IF NOT EXISTS analytics_events_telegram_time
  ON analytics_events(telegram_id, created_at);
