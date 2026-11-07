import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createCheckout, completeCheckout } from './checkout.mjs';

test('checkout belongs to the signed-in buyer and recovers a completed capture', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../private-admin/schema.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const db = { prepare: query => ({ bind: (...args) => ({
    first: async () => sql.prepare(query).get(...args), run: async () => sql.prepare(query).run(...args)
  }) }), batch: async statements => { sql.exec('BEGIN'); try {
    for (const s of statements) await s.run(); sql.exec('COMMIT');
  } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  const purchaseId = 'aa'.repeat(12), discordId = '123456789012345678', merchantId = 'MERCHANT123';
  let creations = 0, captures = 0;
  const order = { id: 'ORDER12345', status: 'COMPLETED', intent: 'CAPTURE', purchase_units: [{
    custom_id: purchaseId, payee: { merchant_id: merchantId }, amount: { currency_code: 'USD', value: '15.00' },
    payments: { captures: [{ id: 'CAPTURE12345', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' } }] }
  }] };
  const paypal = { createOrder: async () => { creations++; return { id: order.id }; },
    captureOrder: async () => { captures++; throw new Error('simulated timeout'); }, getOrder: async () => order };
  assert.equal((await createCheckout(db, paypal, { purchaseId, discordId })).orderId, order.id);
  await createCheckout(db, paypal, { purchaseId, discordId });
  assert.equal(creations, 1);
  await assert.rejects(completeCheckout(db, paypal, 'ab'.repeat(32), merchantId,
    { purchaseId, discordId: '999999999999999999' }));
  const result = await completeCheckout(db, paypal, 'ab'.repeat(32), merchantId, { purchaseId, discordId });
  const retry = await completeCheckout(db, paypal, 'ab'.repeat(32), merchantId, { purchaseId, discordId });
  assert.equal(result.key, retry.key);
  assert.equal(captures, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM licenses').get().n, 1);
});
