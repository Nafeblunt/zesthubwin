CREATE TABLE IF NOT EXISTS website_buyer_role_queue (
  discord_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS website_buyer_role_due ON website_buyer_role_queue(next_attempt_at);
-- Bring existing active redemptions into sync as well
INSERT OR IGNORE INTO website_buyer_role_queue(discord_id)
  SELECT DISTINCT a.discord_id FROM website_account_licenses a JOIN licenses l ON l.id=a.license_id
  WHERE l.revoked=0 AND l.activated_at IS NOT NULL AND (l.expires_at IS NULL OR l.expires_at>unixepoch())
  AND NOT EXISTS(SELECT 1 FROM banned_devices b WHERE b.hwid_hash=l.hwid_hash);
