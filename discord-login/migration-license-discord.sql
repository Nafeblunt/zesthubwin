-- Existing installations only; fresh installations use account-license-schema.sql
ALTER TABLE website_account_licenses ADD COLUMN discord_username TEXT;
UPDATE website_account_licenses SET discord_username=(
  SELECT s.username FROM website_sessions s
  WHERE s.discord_id=website_account_licenses.discord_id
  ORDER BY s.expires_at DESC,s.session_hash DESC LIMIT 1
) WHERE discord_username IS NULL;
