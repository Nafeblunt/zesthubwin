import { sealKey, openKey } from '../private-admin/key-vault.mjs';

async function ownedLicense(db, secret, discordId, licenseId = null) {
  const row = await db.prepare(`SELECT a.license_id,a.key_ciphertext,a.redeemed_at,l.duration_seconds,
    l.activated_at,l.expires_at,l.revoked,
    EXISTS(SELECT 1 FROM banned_devices b WHERE b.hwid_hash=l.hwid_hash) AS device_banned
    FROM website_account_licenses a JOIN licenses l ON l.id=a.license_id
    WHERE a.discord_id=? AND (? IS NULL OR a.license_id=?)
    ORDER BY a.redeemed_at DESC,a.license_id DESC LIMIT 1`).bind(discordId, licenseId, licenseId).first();
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  return {
    key: await openKey(secret, `${discordId}:${row.license_id}`, row.key_ciphertext),
    durationSeconds: row.duration_seconds,
    activatedAt: row.activated_at,
    expiresAt: row.duration_seconds === 253402300799 ? null : row.expires_at,
    redeemedAt: row.redeemed_at,
    status: row.revoked ? 'Revoked' : row.device_banned ? 'Device banned' : row.expires_at !== null && row.expires_at <= now ? 'Expired' : row.activated_at === null ? 'Not activated' : 'Active'
  };
}

export async function handleAccountLicense(request, discordId, { db, secret, limiter, readBody, reply, discordUsername, syncBuyer }) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) return reply({ error: 'Licence service is temporarily unavailable' }, 503);
  if (request.method === 'GET') return reply({ license: await ownedLicense(db, secret, discordId) });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!limiter || !(await limiter.limit({ key: `account-license:${discordId}` })).success)
    return reply({ error: 'Too many attempts Please wait a moment' }, 429);
  let data;
  try { data = await readBody(request); } catch { return reply({ error: 'Enter a valid ZEST licence key' }, 400); }
  const key = typeof data?.key === 'string' ? data.key.trim().toUpperCase() : '';
  if (!/^ZEST-[A-F0-9]{48}$/.test(key)) return reply({ error: 'Enter a valid ZEST licence key' }, 400);
  const keyHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), n => n.toString(16).padStart(2, '0')).join('');
  const now = Math.floor(Date.now() / 1000);
  const license = await db.prepare(`SELECT l.id FROM licenses l WHERE l.key_hash=? AND l.revoked=0
    AND (l.expires_at IS NULL OR l.expires_at>?)
    AND NOT EXISTS(SELECT 1 FROM banned_devices b WHERE b.hwid_hash=l.hwid_hash)`).bind(keyHash, now).first();
  if (!license) return reply({ error: 'That licence is invalid, expired, revoked, or unavailable' }, 400);
  const cipher = await sealKey(secret, `${discordId}:${license.id}`, key);
  // The primary key prevents two Discord accounts from redeeming the same key.
  // Linking and starting the timer commit together; repeat redemption keeps expiry.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO website_account_licenses(license_id,discord_id,discord_username,key_ciphertext,redeemed_at)
      SELECT id,?,?,?,? FROM licenses l WHERE id=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?)
      AND NOT EXISTS(SELECT 1 FROM banned_devices b WHERE b.hwid_hash=l.hwid_hash)`)
      .bind(discordId, discordUsername, cipher, now, license.id, now),
    db.prepare('UPDATE website_account_licenses SET discord_username=? WHERE license_id=? AND discord_id=?')
      .bind(discordUsername, license.id, discordId),
    db.prepare(`UPDATE licenses SET activated_at=COALESCE(activated_at,?),
      expires_at=COALESCE(expires_at,CASE WHEN duration_seconds=253402300799 THEN 253402300799 ELSE ?+duration_seconds END)
      WHERE id=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?)
      AND EXISTS(SELECT 1 FROM website_account_licenses a WHERE a.license_id=licenses.id AND a.discord_id=?)`)
      .bind(now, now, license.id, now, discordId),
    db.prepare(`INSERT OR IGNORE INTO website_buyer_role_queue(discord_id)
      SELECT a.discord_id FROM website_account_licenses a JOIN licenses l ON l.id=a.license_id
      WHERE a.license_id=? AND a.discord_id=? AND l.revoked=0 AND (l.expires_at IS NULL OR l.expires_at>?)
      AND NOT EXISTS(SELECT 1 FROM banned_devices b WHERE b.hwid_hash=l.hwid_hash)`)
      .bind(license.id, discordId, now)
  ]);
  const owned = await ownedLicense(db, secret, discordId, license.id);
  if (!owned) return reply({ error: 'That licence has already been redeemed or is unavailable' }, 409);
  const roleSync = (await syncBuyer()).status;
  return reply({ license: owned, roleSync });
}
