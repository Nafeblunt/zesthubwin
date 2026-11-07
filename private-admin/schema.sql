CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  username TEXT,
  hwid_hash TEXT,
  activated_at INTEGER,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1))
);
CREATE TABLE IF NOT EXISTS banned_devices (
  hwid_hash TEXT PRIMARY KEY,
  banned_at INTEGER NOT NULL
);
