import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { hasBuyerAccess } from './worker.mjs';

const db = { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ success: true }) }) }) };
const env = { DB: db, DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test' };

test('missing configuration fails closed', async () => {
  assert.equal((await worker.fetch(new Request('https://login.zesthub.win/start'), {})).status, 503);
});
test('login begins with random state in an HttpOnly cookie', async () => {
  const r = await worker.fetch(new Request('https://login.zesthub.win/start'), env);
  assert.equal(r.status, 302);
  const target = new URL(r.headers.get('location'));
  assert.equal(target.origin, 'https://discord.com');
  assert.equal(target.searchParams.get('scope'), 'identify');
  assert.match(target.searchParams.get('state'), /^[a-f0-9]{64}$/);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
});
test('callback rejects missing or mismatched state', async () => {
  const r = await worker.fetch(new Request('https://login.zesthub.win/callback?state=bad&code=fake'), env);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://zesthub.win/?login=failed');
});
test('session endpoints reject other origins', async () => {
  const get = new Request('https://login.zesthub.win/me', { headers: { Origin: 'https://evil.example' } });
  const post = new Request('https://login.zesthub.win/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal((await worker.fetch(get, env)).status, 403);
  assert.equal((await worker.fetch(post, env)).status, 403);
});
test('an anonymous session is returned as signed out', async () => {
  const request = new Request('https://login.zesthub.win/me', { headers: { Origin: 'https://zesthub.win' } });
  const r = await worker.fetch(request, env);
  assert.deepEqual(await r.json(), { user: null, buyer: false });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://zesthub.win');
});
test('role check allows Buyer and higher roles, denies lower and non-members', async () => {
  const original = globalThis.fetch;
  const config = { DISCORD_BOT_TOKEN: 'test', DISCORD_GUILD_ID: '123456789012345678', DISCORD_BUYER_ROLE_ID: '123456789012345680' };
  let memberRoles = ['123456789012345679'];
  try {
    globalThis.fetch = async url => {
      if (String(url).endsWith('/roles')) return Response.json([
        { id: '123456789012345679', position: 1 }, { id: config.DISCORD_BUYER_ROLE_ID, position: 2 },
        { id: '123456789012345681', position: 3 }
      ]);
      if (String(url).includes('/members/')) return memberRoles ? Response.json({ roles: memberRoles }) : new Response('', { status: 404 });
      return Response.json({ owner_id: '999999999999999999' });
    };
    assert.equal(await hasBuyerAccess('111111111111111111', config), false);
    memberRoles = [config.DISCORD_BUYER_ROLE_ID];
    assert.equal(await hasBuyerAccess('111111111111111111', config), true);
    memberRoles = ['123456789012345681'];
    assert.equal(await hasBuyerAccess('111111111111111111', config), true);
    assert.equal(await hasBuyerAccess('999999999999999999', config), true);
    memberRoles = null;
    assert.equal(await hasBuyerAccess('111111111111111111', config), false);
  } finally { globalThis.fetch = original; }
});
test('successful Discord callback creates a session without storing Discord tokens', async () => {
  const original = globalThis.fetch, writes = [];
  const fakeDB = { prepare: sql => ({ bind: (...params) => ({ run: async () => { writes.push({ sql, params }); } }) }) };
  try {
    globalThis.fetch = async url => String(url).includes('/oauth2/token')
      ? Response.json({ access_token: 'private-test-token', token_type: 'Bearer' })
      : Response.json({ id: '123456789012345678', username: 'test-user' });
    const state = 'a'.repeat(64);
    const request = new Request(`https://login.zesthub.win/callback?state=${state}&code=test`, {
      headers: { Cookie: `__Host-zest_oauth_state=${state}` }
    });
    const r = await worker.fetch(request, { ...env, DB: fakeDB });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://zesthub.win/');
    assert.match(r.headers.get('set-cookie'), /__Host-zest_session=[a-f0-9]{64}/);
    assert.equal(writes.length, 1);
    assert.equal(JSON.stringify(writes).includes('private-test-token'), false);
  } finally { globalThis.fetch = original; }
});
