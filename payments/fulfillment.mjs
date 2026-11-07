import { verifyCompletedOrder, LIFETIME_LICENSE } from './verification.mjs';
import { sealKey, openKey } from '../private-admin/key-vault.mjs';

const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const digest = async key => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))));

// `order` must be fetched by the server directly from PayPal after capture.
// Never call this with an order object supplied by a browser or unverified webhook.
export async function fulfillVerifiedPurchase(db, secret, { purchaseId, discordId, merchantId, order }) {
  if (!/^[a-f0-9]{24}$/.test(purchaseId || '') || !/^\d{15,22}$/.test(discordId || ''))
    throw new Error('Invalid purchase or Discord identity');
  const purchase = await db.prepare('SELECT * FROM paypal_purchases WHERE id=? AND discord_id=?')
    .bind(purchaseId, discordId).first();
  if (!purchase || !purchase.paypal_order_id) throw new Error('Purchase not found');
  const verified = verifyCompletedOrder(order, { orderId: purchase.paypal_order_id, merchantId, purchaseId });
  if (purchase.status === 'fulfilled' && purchase.capture_id !== verified.captureId)
    throw new Error('Capture mismatch');
  if (purchase.status !== 'fulfilled') {
    const licenseId = randomHex(12), key = 'ZEST-' + randomHex(24).toUpperCase();
    const cipher = await sealKey(secret, licenseId, key);
    const keyHash = await digest(key);
    // D1 executes a batch transactionally. If another request fulfilled this
    // purchase first, both guarded statements do nothing; the existing key is read below.
    await db.batch([
      db.prepare(`INSERT INTO licenses (id,key_hash,key_ciphertext,created_at,duration_seconds)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM paypal_purchases WHERE id=? AND discord_id=? AND status='created' AND paypal_order_id=?)`)
        .bind(licenseId, keyHash, cipher, Math.floor(Date.now()/1000), LIFETIME_LICENSE.durationSeconds,
          purchaseId, discordId, verified.orderId),
      db.prepare(`UPDATE paypal_purchases SET status='fulfilled', capture_id=?, license_id=?
        WHERE id=? AND discord_id=? AND status='created' AND paypal_order_id=?`)
        .bind(verified.captureId, licenseId, purchaseId, discordId, verified.orderId)
    ]);
  }
  const done = await db.prepare(`SELECT p.capture_id, l.id, l.key_ciphertext FROM paypal_purchases p
    JOIN licenses l ON l.id=p.license_id WHERE p.id=? AND p.discord_id=? AND p.status='fulfilled'`)
    .bind(purchaseId, discordId).first();
  if (!done || done.capture_id !== verified.captureId) throw new Error('Fulfillment could not be confirmed');
  return { licenseId: done.id, key: await openKey(secret, done.id, done.key_ciphertext) };
}
