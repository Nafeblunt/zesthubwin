-- Sandbox migration. Only verified event metadata is stored; no payer data.
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  order_id TEXT,
  capture_id TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0
);
