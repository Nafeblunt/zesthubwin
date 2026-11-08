import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { receiveWebhook } from './webhook.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./webhook-schema.sql', import.meta.url), 'utf8'));
  const db = { prepare: query => ({ bind: (...args) => ({
    first: async () => sql.prepare(query).get(...args), run: async () => sql.prepare(query).run(...args)
  }) }) };
  return { db, sql };
}
const event = { id: 'WH-123456', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {
  id: 'CAPTURE123', supplementary_data: { related_ids: { order_id: 'ORDER12345' } }
} };
const request = body => new Request('https://example.test/webhook', { method: 'POST', body: JSON.stringify(body) });

test('unverified events cannot enter the durable queue', async () => {
  const { db, sql } = fixture();
  const response = await receiveWebhook(request(event), { db, webhookId: 'WH-123', paypal: { verifyWebhook: async () => false } });
  assert.equal(response.status, 403);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM paypal_webhook_events').get().n, 0);
});
test('verified duplicate events are stored once and conflicting replays are rejected', async () => {
  const { db, sql } = fixture(), config = { db, webhookId: 'WH-123', paypal: { verifyWebhook: async () => true } };
  assert.equal((await receiveWebhook(request(event), config)).status, 204);
  assert.equal((await receiveWebhook(request(event), config)).status, 204);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM paypal_webhook_events').get().n, 1);
  const conflict = structuredClone(event); conflict.resource.id = 'OTHER12345';
  assert.equal((await receiveWebhook(request(conflict), config)).status, 409);
});
test('PayPal verification failure leaves events unacknowledged for retry', async () => {
  const { db, sql } = fixture();
  const config = { db, webhookId: 'WH-123', paypal: { verifyWebhook: async () => { throw Error('offline'); } } };
  assert.equal((await receiveWebhook(request(event), config)).status, 503);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM paypal_webhook_events').get().n, 0);
});
