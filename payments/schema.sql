-- Apply only in a sandbox or test database until the checkout is ready.
CREATE TABLE IF NOT EXISTS paypal_purchases (
  id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  paypal_order_id TEXT UNIQUE,
  capture_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('created', 'fulfilled')),
  license_id TEXT UNIQUE REFERENCES licenses(id),
  created_at INTEGER NOT NULL
);
