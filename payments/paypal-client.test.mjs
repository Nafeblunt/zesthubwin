import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalSandbox } from './paypal-client.mjs';

test('creates a fixed-price sandbox order with server-owned identifiers', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('/token') ? { access_token: 'token' } : { id: 'ORDER123456' });
  };
  const client = new PayPalSandbox({ clientId: 'id', clientSecret: 'secret', merchantId: 'merchant', transport });
  await client.createOrder('purchase123456');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url.startsWith('https://api-m.sandbox.paypal.com/')));
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.purchase_units[0].custom_id, 'purchase123456');
  assert.equal(body.purchase_units[0].payee.merchant_id, 'merchant');
  assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'USD', value: '15.00' });
  assert.match(calls[1].options.headers['PayPal-Request-Id'], /^o-[a-f0-9]{32}$/);
});

test('rejects invalid identifiers before contacting PayPal', async () => {
  let calls = 0;
  const client = new PayPalSandbox({ clientId: 'id', clientSecret: 'secret', merchantId: 'merchant',
    transport: async () => { calls++; } });
  await assert.rejects(client.captureOrder('../other', 'purchase123456'));
  assert.equal(calls, 0);
});

test('capture retries use a stable PayPal idempotency key', async () => {
  const ids = [];
  const transport = async (url, options) => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'token' });
    ids.push(options.headers['PayPal-Request-Id']);
    return Response.json({ id: 'ORDER123456' });
  };
  const client = new PayPalSandbox({ clientId: 'id', clientSecret: 'secret', merchantId: 'merchant', transport });
  await client.captureOrder('ORDER123456', 'purchase123456');
  await client.captureOrder('ORDER123456', 'purchase123456');
  assert.equal(ids[0], ids[1]);
  assert.match(ids[0], /^c-[a-f0-9]{32}$/);
});

test('default transport calls the global fetch without a custom receiver', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async function (url) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Response.json(String(url).endsWith('/token') ? { access_token: 'token' } : { id: 'ORDER123456' });
    };
    const client = new PayPalSandbox({ clientId: 'id', clientSecret: 'secret', merchantId: 'merchant' });
    assert.equal((await client.createOrder('purchase123456')).id, 'ORDER123456');
  } finally { globalThis.fetch = original; }
});

test('webhook verification requires every PayPal signature header and a SUCCESS result', async () => {
  let requests = 0;
  const transport = async url => { requests++; return Response.json(url.endsWith('/token')
    ? { access_token: 'token' } : { verification_status: 'SUCCESS' }); };
  const client = new PayPalSandbox({ clientId: 'id', clientSecret: 'secret', merchantId: 'merchant', transport });
  assert.equal(await client.verifyWebhook(new Headers(), {}, 'WH-123456'), false);
  assert.equal(requests, 0);
  const headers = new Headers({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://example.test/cert',
    'paypal-transmission-id': 'transmission', 'paypal-transmission-sig': 'signature', 'paypal-transmission-time': '2026-01-01T00:00:00Z' });
  assert.equal(await client.verifyWebhook(headers, { id: 'WH-123' }, 'WH-123456'), true);
  assert.equal(requests, 2);
});
