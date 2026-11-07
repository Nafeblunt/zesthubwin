import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

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
  assert.deepEqual(await r.json(), { user: null });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://zesthub.win');
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
