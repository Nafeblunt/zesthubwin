CREATE TABLE IF NOT EXISTS website_sessions (
  session_hash TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS website_sessions_expiry ON website_sessions(expires_at);
