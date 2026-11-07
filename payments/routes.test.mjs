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
