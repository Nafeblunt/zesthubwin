import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCompletedOrder } from './verification.mjs';

const expected = { orderId: 'ORDER12345', merchantId: 'MERCHANT123', purchaseId: 'purchase-random-id' };
function completed() { return { id: expected.orderId, status: 'COMPLETED', intent: 'CAPTURE', purchase_units: [{
  custom_id: expected.purchaseId, payee: { merchant_id: expected.merchantId }, amount: { currency_code: 'USD', value: '15.00' },
  payments: { captures: [{ id: 'CAPTURE12345', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' } }] }
}] }; }

test('accepts a matching completed capture', () => {
  assert.equal(verifyCompletedOrder(completed(), expected).captureId, 'CAPTURE12345');
});
for (const [name, change] of [
  ['wrong order', x => x.id = 'OTHER'], ['approval without capture', x => x.status = 'APPROVED'],
  ['wrong merchant', x => x.purchase_units[0].payee.merchant_id = 'OTHER'],
  ['wrong purchase', x => x.purchase_units[0].custom_id = 'OTHER'],
  ['wrong price', x => x.purchase_units[0].amount.value = '1.00'],
  ['wrong currency', x => x.purchase_units[0].payments.captures[0].amount.currency_code = 'EUR'],
  ['pending capture', x => x.purchase_units[0].payments.captures[0].status = 'PENDING'],
  ['duplicate captures', x => x.purchase_units[0].payments.captures.push(x.purchase_units[0].payments.captures[0])]
]) test(`rejects ${name}`, () => { const order = completed(); change(order); assert.throws(() => verifyCompletedOrder(order, expected)); });
