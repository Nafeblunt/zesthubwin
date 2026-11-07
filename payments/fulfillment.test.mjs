import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fulfillVerifiedPurchase } from './fulfillment.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../private-admin/schema.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const db = { prepare: query => ({ bind: (...params) => ({
    first: async () => sql.prepare(query).get(...params), run: () => sql.prepare(query).run(...params)
  }) }), batch: async statements => {
    sql.exec('BEGIN');
    try { for (const statement of statements) statement.run(); sql.exec('COMMIT'); }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, db };
}

test('a verified purchase creates exactly one recoverable key for its owner', async () => {
  const { sql, db } = database(), purchaseId = 'aa'.repeat(12), discordId = '123456789012345678';
  sql.prepare('INSERT INTO paypal_purchases (id,discord_id,paypal_order_id,status,created_at) VALUES (?,?,?,?,?)')
    .run(purchaseId, discordId, 'ORDER12345', 'created', 1);
  const order = { id: 'ORDER12345', status: 'COMPLETED', intent: 'CAPTURE', purchase_units: [{ custom_id: purchaseId,
    payee: { merchant_id: 'MERCHANT123' }, amount: { currency_code: 'USD', value: '15.00' },
    payments: { captures: [{ id: 'CAPTURE12345', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' } }] } }] };
  const input = { purchaseId, discordId, merchantId: 'MERCHANT123', order }, secret = 'ab'.repeat(32);
  await assert.rejects(fulfillVerifiedPurchase(db, secret, { ...input, discordId: '999999999999999999' }));
  const first = await fulfillVerifiedPurchase(db, secret, input);
  const second = await fulfillVerifiedPurchase(db, secret, input);
  assert.deepEqual(second, first);
  assert.match(first.key, /^ZEST-[A-F0-9]{48}$/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM licenses').get().total, 1);
  const changed = structuredClone(order); changed.purchase_units[0].payments.captures[0].id = 'DIFFERENT123';
  await assert.rejects(fulfillVerifiedPurchase(db, secret, { ...input, order: changed }));
});
