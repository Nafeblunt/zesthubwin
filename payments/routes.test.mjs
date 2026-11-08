import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSandboxPayment } from './routes.mjs';

test('sandbox payment routes require the site origin and an authenticated Discord session', async () => {
  const fake = { db: {}, paypal: {}, vaultSecret: 'x', merchantId: 'x', limiter: { limit: async () => ({ success: true }) } };
  const external = new Request('https://login.zesthub.win/sandbox/payments/create', {
    method: 'POST', headers: { Origin: 'https://other.example' }
  });
  assert.equal((await handleSandboxPayment(external, '123456789012345678', fake)).status, 403);
  const anonymous = new Request('https://login.zesthub.win/sandbox/payments/create', {
    method: 'POST', headers: { Origin: 'https://zesthub.win' }
  });
  assert.equal((await handleSandboxPayment(anonymous, null, fake)).status, 401);
  assert.equal((await handleSandboxPayment(anonymous, '123456789012345678', {})).status, 503);
});

test('pending test orders are queried only for the authenticated Discord identity', async () => {
  let bound;
  const db = { prepare: () => ({ bind: value => { bound = value; return { all: async () => ({ results: [
    { id: 'a'.repeat(24), created_at: 123 }
  ] }) }; } }) };
  const env = { db, paypal: {}, vaultSecret: 'x', merchantId: 'x', limiter: { limit: async () => ({ success: true }) } };
  const request = new Request('https://login.zesthub.win/sandbox/payments/pending', { headers: { Origin: 'https://zesthub.win' } });
  const response = await handleSandboxPayment(request, '123456789012345678', env);
  assert.equal(response.status, 200);
  assert.equal(bound, '123456789012345678');
  assert.deepEqual((await response.json()).purchases, [{ purchaseId: 'a'.repeat(24), createdAt: 123 }]);
});
