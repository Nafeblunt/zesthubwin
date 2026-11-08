import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncBuyerRole } from './buyer-role.mjs';

const options = { purchaseId: 'aa'.repeat(12), guildId: '123456789012345678',
  buyerRoleId: '123456789012345679', botToken: 'test' };
const db = row => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });

test('buyer role is never assigned without a fulfilled, unrevoked license', async () => {
  let calls = 0;
  const result = await syncBuyerRole(db(null), { ...options, transport: async () => { calls++; } });
  assert.equal(result.status, 'not_entitled');
  assert.equal(calls, 0);
});
test('missing server member can be retried after they join', async () => {
  const result = await syncBuyerRole(db({ discord_id: '999999999999999999' }), {
    ...options, transport: async () => new Response('', { status: 404 }) });
  assert.equal(result.status, 'not_in_server');
});
test('grants only the configured buyer role to the Discord ID from the purchase', async () => {
  const calls = [];
  const result = await syncBuyerRole(db({ discord_id: '999999999999999999' }), { ...options,
    transport: async (url, config) => {
      calls.push({ url, method: config.method || 'GET' });
      return calls.length === 1 ? Response.json({ roles: [] }) : new Response(null, { status: 204 });
    } });
  assert.equal(result.status, 'granted');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /members\/999999999999999999\/roles\/123456789012345679$/);
  assert.equal(calls[1].method, 'PUT');
});
