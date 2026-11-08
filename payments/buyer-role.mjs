// Only call after an authenticated PayPal purchase has been fulfilled in the
// same database. The Discord ID is read from the purchase, not from a browser.
// This helper is not wired to the production checkout yet.
export async function syncBuyerRole(db, { purchaseId, guildId, buyerRoleId, botToken, transport = (...args) => fetch(...args) }) {
  if (!/^[a-f0-9]{24}$/.test(purchaseId || '') || !/^\d{15,22}$/.test(guildId || '') ||
      !/^\d{15,22}$/.test(buyerRoleId || '') || !botToken) throw new Error('Role sync is not configured');
  const purchase = await db.prepare(`SELECT p.discord_id FROM paypal_purchases p JOIN licenses l ON l.id=p.license_id
    WHERE p.id=? AND p.status='fulfilled' AND l.revoked=0 AND (l.expires_at IS NULL OR l.expires_at>?)`)
    .bind(purchaseId, Math.floor(Date.now()/1000)).first();
  if (!purchase || !/^\d{15,22}$/.test(purchase.discord_id || '')) return { status: 'not_entitled' };
  const base = `https://discord.com/api/v10/guilds/${guildId}/members/${purchase.discord_id}`;
  const headers = { Authorization: `Bot ${botToken}` };
  const member = await transport(base, { headers, redirect: 'manual' });
  if (member.status === 404) return { status: 'not_in_server' };
  if (!member.ok) throw new Error('Discord membership lookup failed');
  const data = await member.json();
  if (!Array.isArray(data.roles)) throw new Error('Invalid Discord membership response');
  if (data.roles.includes(buyerRoleId)) return { status: 'already_has_role' };
  const result = await transport(`${base}/roles/${buyerRoleId}`, { method: 'PUT', headers, redirect: 'manual' });
  if (!result.ok) throw new Error('Discord role update failed');
  return { status: 'granted' };
}
