import { createCheckout, completeCheckout } from './checkout.mjs';
import { openKey } from '../private-admin/key-vault.mjs';

const SITE = 'https://zesthub.win';
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
const reply = (data, status = 200) => Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Credentials': 'true', Vary: 'Origin'
} });
async function readSmallBody(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Request too large'); }
      chunks.push(value);
    }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } finally { reader.releaseLock(); }
}

// Only call with discordId obtained from a verified server-side session.
// Kept unconnected to production until the entire sandbox flow has been tested.
export async function handleSandboxPayment(request, discordId, { db, paypal, vaultSecret, merchantId, limiter }) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== SITE || !['GET', 'POST'].includes(request.method)) return reply({ error: 'Forbidden' }, 403);
  if (!/^\d{15,22}$/.test(discordId || '')) return reply({ error: 'Sign in with Discord first.' }, 401);
  if (!db || !paypal || !vaultSecret || !merchantId || !limiter) return reply({ error: 'Sandbox checkout is not configured.' }, 503);
  try {
    if (!(await limiter.limit({ key: discordId })).success) return reply({ error: 'Too many requests. Try again later.' }, 429);
    if (url.pathname === '/sandbox/payments/config' && request.method === 'GET') {
      return reply({ clientId: paypal.clientId, environment: 'sandbox' });
    }
    if (url.pathname === '/sandbox/payments/history' && request.method === 'GET') {
      const result = await db.prepare(`SELECT p.id,p.created_at,l.id AS license_id,l.key_ciphertext FROM paypal_purchases p
        JOIN licenses l ON l.id=p.license_id WHERE p.discord_id=? AND p.status='fulfilled' ORDER BY p.created_at DESC LIMIT 100`).bind(discordId).all();
      const purchases = await Promise.all(result.results.map(async row => ({ purchaseId: row.id, createdAt: row.created_at,
        licenseId: row.license_id, key: await openKey(vaultSecret, row.license_id, row.key_ciphertext) })));
      return reply({ purchases });
    }
    if (url.pathname === '/sandbox/payments/create' && request.method === 'POST') {
      const purchaseId = randomId();
      const purchase = await createCheckout(db, paypal, { purchaseId, discordId });
      return reply(purchase);
    }
    if (url.pathname === '/sandbox/payments/capture' && request.method === 'POST') {
      const body = await readSmallBody(request, 1024);
      const { purchaseId } = JSON.parse(body);
      if (!/^[a-f0-9]{24}$/.test(purchaseId || '')) return reply({ error: 'Invalid purchase.' }, 400);
      const result = await completeCheckout(db, paypal, vaultSecret, merchantId, { purchaseId, discordId });
      return reply({ key: result.key, licenseId: result.licenseId });
    }
    return reply({ error: 'Not found.' }, 404);
  } catch {
    // Do not expose PayPal responses, secrets, purchase IDs, or license keys in logs.
    return reply({ error: 'Sandbox payment could not be completed. Please contact the owner.' }, 503);
  }
}
