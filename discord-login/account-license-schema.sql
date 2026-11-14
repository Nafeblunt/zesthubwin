CREATE TABLE IF NOT EXISTS website_account_licenses (
  license_id TEXT PRIMARY KEY REFERENCES licenses(id),
  discord_id TEXT NOT NULL,
  key_ciphertext TEXT NOT NULL,
  redeemed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS website_account_licenses_owner
  ON website_account_licenses(discord_id, redeemed_at DESC, license_id DESC);
