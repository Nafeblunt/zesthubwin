const snowflake = value => /^\d{15,22}$/.test(value || '');
function configured(env) {
  return env.DB && env.DISCORD_BOT_TOKEN && snowflake(env.DISCORD_GUILD_ID) &&
    snowflake(env.DISCORD_BUYER_ROLE_ID) && snowflake(env.DISCORD_MEMBER_ROLE_ID) &&
    env.DISCORD_BUYER_ROLE_ID !== env.DISCORD_MEMBER_ROLE_ID;
}

// Only persisted, active website redemptions authorize this role transition
export async function syncRedeemedBuyerRole(env, discordId) {
  if (!configured(env) || !snowflake(discordId)) return { status: 'pending' };
  const db = env.DB, now = Math.floor(Date.now() / 1000);
  const entitled = await db.prepare(`SELECT a.license_id FROM website_account_licenses a JOIN licenses l ON l.id=a.license_id
    WHERE a.discord_id=? AND l.revoked=0 AND l.activated_at IS NOT NULL AND (l.expires_at IS NULL OR l.expires_at>?)
    AND NOT EXISTS(SELECT 1 FROM banned_devices b WHERE b.hwid_hash=l.hwid_hash) LIMIT 1`).bind(discordId, now).first();
  if (!entitled) {
    await db.prepare('DELETE FROM website_buyer_role_queue WHERE discord_id=?').bind(discordId).run();
    return { status: 'not_entitled' };
  }
  let retryAfter = 300, rateLimited = false;
  const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'X-Audit-Log-Reason': 'Website%20licence%20redemption' };
  const base = `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/members/${discordId}`;
  async function discord(url, method = 'GET') {
    const response = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      rateLimited = response.status === 429;
      const delay = Number(response.headers.get('Retry-After'));
      retryAfter = rateLimited && Number.isFinite(delay) && delay > 0 ? Math.max(300, Math.ceil(delay))
        : response.status === 404 || response.status === 403 ? 3600 : 300;
      throw new Error('Discord role update pending');
    }
    return response;
  }
  try {
    const member = await (await discord(base)).json();
    if (!Array.isArray(member.roles) || member.user?.bot) throw new Error('Invalid Discord member');
    if (!member.roles.includes(env.DISCORD_BUYER_ROLE_ID)) await discord(`${base}/roles/${env.DISCORD_BUYER_ROLE_ID}`, 'PUT');
    // Never remove Member unless Buyer was already present or successfully added
    if (member.roles.includes(env.DISCORD_MEMBER_ROLE_ID)) await discord(`${base}/roles/${env.DISCORD_MEMBER_ROLE_ID}`, 'DELETE');
  } catch {
    await db.prepare(`UPDATE website_buyer_role_queue SET attempts=attempts+1,next_attempt_at=? WHERE discord_id=?`)
      .bind(now + Math.min(86400, retryAfter), discordId).run();
    return { status: 'pending', rateLimited };
  }
  await db.prepare('DELETE FROM website_buyer_role_queue WHERE discord_id=?').bind(discordId).run();
  return { status: 'synced' };
}

export async function retryRedeemedBuyerRoles(env) {
  if (!configured(env)) return;
  const due = await env.DB.prepare(`SELECT discord_id FROM website_buyer_role_queue
    WHERE next_attempt_at<=? ORDER BY next_attempt_at,discord_id LIMIT 20`).bind(Math.floor(Date.now() / 1000)).all();
  for (const row of due.results) {
    const result = await syncRedeemedBuyerRole(env, row.discord_id);
    if (result.rateLimited) break;
  }
}
