import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { processCompletedEvent, processReversalEvent } from './webhook-processor.mjs';

test('verified completed webhook fulfills once, and unmatched events stay pending', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['../private-admin/schema.sql', './schema.sql', './webhook-schema.sql'])
    sql.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  const db = { prepare: q => ({ bind: (...args) => ({ first: async () => sql.prepare(q).get(...args),
    run: async () => sql.prepare(q).run(...args) }) }), batch: async statements => {
    sql.exec('BEGIN'); try { for (const s of statements) await s.run(); sql.exec('COMMIT'); }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  const purchaseId = 'aa'.repeat(12), discordId = '123456789012345678';
  sql.prepare('INSERT INTO paypal_purchases (id,discord_id,paypal_order_id,status,created_at) VALUES (?,?,?,?,?)')
    .run(purchaseId, discordId, 'ORDER12345', 'created', 1);
  sql.prepare('INSERT INTO paypal_webhook_events (event_id,event_type,resource_id,order_id,capture_id,received_at) VALUES (?,?,?,?,?,?)')
    .run('EVENT12345', 'PAYMENT.CAPTURE.COMPLETED', 'CAPTURE12345', 'ORDER12345', 'CAPTURE12345', 1);
  const order = { id: 'ORDER12345', status: 'COMPLETED', intent: 'CAPTURE', purchase_units: [{ custom_id: purchaseId,
    payee: { merchant_id: 'MERCHANT123' }, amount: { currency_code: 'USD', value: '15.00' },
    payments: { captures: [{ id: 'CAPTURE12345', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' } }] } }] };
  const paypal = { getOrder: async () => order };
  assert.deepEqual(await processCompletedEvent(db, paypal, 'ab'.repeat(32), 'MERCHANT123', 'EVENT12345'), { alreadyProcessed: false });
  assert.deepEqual(await processCompletedEvent(db, paypal, 'ab'.repeat(32), 'MERCHANT123', 'EVENT12345'), { alreadyProcessed: true });
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM licenses').get().n, 1);
  sql.prepare('INSERT INTO paypal_webhook_events (event_id,event_type,resource_id,order_id,capture_id,received_at) VALUES (?,?,?,?,?,?)')
    .run('EVENT99999', 'PAYMENT.CAPTURE.COMPLETED', 'CAPTURE99999', 'UNKNOWN999', 'CAPTURE99999', 1);
  await assert.rejects(processCompletedEvent(db, paypal, 'ab'.repeat(32), 'MERCHANT123', 'EVENT99999'));
  assert.equal(sql.prepare('SELECT processed_at FROM paypal_webhook_events WHERE event_id=?').get('EVENT99999').processed_at, null);
});

test('only a confirmed full refund revokes the matching license', async () => {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['../private-admin/schema.sql', './schema.sql', './webhook-schema.sql'])
    sql.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  const db = { prepare: q => ({ bind: (...args) => ({ first: async () => sql.prepare(q).get(...args),
    run: async () => sql.prepare(q).run(...args) }) }), batch: async statements => {
    sql.exec('BEGIN'); try { for (const s of statements) await s.run(); sql.exec('COMMIT'); }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  sql.prepare('INSERT INTO licenses (id,key_hash,created_at,duration_seconds) VALUES (?,?,?,?)').run('license1','hash1',1,3600);
  sql.prepare('INSERT INTO paypal_purchases (id,discord_id,paypal_order_id,capture_id,status,license_id,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('aa'.repeat(12),'123456789012345678','ORDER12345','CAPTURE12345','fulfilled','license1',1);
  const insert = sql.prepare('INSERT INTO paypal_webhook_events (event_id,event_type,resource_id,received_at) VALUES (?,?,?,?)');
  insert.run('PARTIAL123','PAYMENT.CAPTURE.REFUNDED','REFUND12345',1);
  insert.run('FULLREFUND123','PAYMENT.CAPTURE.REFUNDED','REFUND12345',1);
  let status = 'PARTIALLY_REFUNDED';
  const paypal = { getRefund: async () => ({ id:'REFUND12345',status:'COMPLETED',links:[{ rel:'up',method:'GET',href:'https://api.sandbox.paypal.com/v2/payments/captures/CAPTURE12345' }] }),
    getCapture: async () => ({ id:'CAPTURE12345',status,amount:{ currency_code:'USD',value:'15.00' } }) };
  assert.deepEqual(await processReversalEvent(db,paypal,'PARTIAL123'), { partialRefund: true });
  assert.equal(sql.prepare('SELECT revoked FROM licenses').get().revoked, 0);
  status = 'REFUNDED';
  assert.deepEqual(await processReversalEvent(db,paypal,'FULLREFUND123'), { revoked: true });
  assert.equal(sql.prepare('SELECT revoked FROM licenses').get().revoked, 1);
});
