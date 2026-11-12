import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { getDiscordAccess, hasBuyerAccess } from './worker.mjs';

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
test('login only remembers allowed community return paths', async () => {
  const forum = await worker.fetch(new Request('https://login.zesthub.win/start?next=%2FForum'), env);
  assert.match(forum.headers.get('set-cookie'), /__Host-zest_return=forum/);
  const external = await worker.fetch(new Request('https://login.zesthub.win/start?next=https%3A%2F%2Fevil.example'), env);
  assert.doesNotMatch(external.headers.get('set-cookie'), /__Host-zest_return=forum|__Host-zest_return=market/);
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

test('signed-in sessions include the Discord profile avatar with default fallback', async () => {
  const original = globalThis.fetch;
  const id = '123456789012345678';
  const config = { ...env, DISCORD_BOT_TOKEN: 'test', DISCORD_GUILD_ID: id,
    DISCORD_BUYER_ROLE_ID: '123456789012345680',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ discord_id: id, username: 'Test' }) }) }) } };
  try {
    for (const [profile, expected] of [
      [{ avatar: 'abc123', discriminator: '0' }, `https://cdn.discordapp.com/avatars/${id}/abc123.png?size=80`],
      [{ avatar: 'a_abc123', discriminator: '0' }, `https://cdn.discordapp.com/avatars/${id}/a_abc123.gif?size=80`],
      [{ avatar: null, discriminator: '0' }, 'https://cdn.discordapp.com/embed/avatars/0.png'],
      [{ avatar: null, discriminator: '1234' }, 'https://cdn.discordapp.com/embed/avatars/4.png'],
      [null, 'https://cdn.discordapp.com/embed/avatars/0.png']
    ]) {
      globalThis.fetch = async url => {
        if (String(url) === `https://discord.com/api/v10/users/${id}`)
          return profile ? Response.json({ id, username: 'Test', ...profile }) : new Response(null, { status: 503 });
        if (String(url).endsWith('/roles')) return Response.json([{ id: config.DISCORD_BUYER_ROLE_ID, position: 2 }]);
        if (String(url).includes('/members/')) return Response.json({ roles: [] });
        return Response.json({ owner_id: '999999999999999999' });
      };
      const response = await worker.fetch(new Request('https://login.zesthub.win/me', { headers: {
        Origin: 'https://zesthub.win', Cookie: '__Host-zest_session=' + 'a'.repeat(64)
      } }), config);
      assert.equal(response.status, 200);
      const session = await response.json();
      assert.equal(session.user.avatarUrl, expected);
      assert.equal(session.user.name, 'Test');
      assert.equal(session.buyer, false);
    }
  } finally { globalThis.fetch = original; }
});
test('loader download checks the session and Discord role before reading the private object', async () => {
  const original = globalThis.fetch;
  let reads = 0, authorized = false;
  const config = { ...env, DISCORD_BOT_TOKEN: 'test', DISCORD_GUILD_ID: '123456789012345678',
    DISCORD_BUYER_ROLE_ID: '123456789012345680',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ discord_id: '111111111111111111' }) }) }) },
    LOADER_BUCKET: { get: async key => { reads++; assert.equal(key, 'ZestHub-Loader.exe'); return { body: 'test loader', customMetadata: { downloadName: 'aBcDeF.exe' } }; } } };
  try {
    globalThis.fetch = async url => String(url).endsWith('/roles')
      ? Response.json([{ id: config.DISCORD_BUYER_ROLE_ID, position: 2 }])
      : String(url).includes('/members/') ? Response.json({ roles: authorized ? [config.DISCORD_BUYER_ROLE_ID] : [] })
      : Response.json({ owner_id: '999999999999999999' });
    const request = cookie => new Request('https://login.zesthub.win/download-loader', { headers: cookie ? { Cookie: cookie } : {} });
    assert.equal((await worker.fetch(request(), config)).status, 401);
    const cookie = '__Host-zest_session=' + 'a'.repeat(64);
    assert.equal((await worker.fetch(request(cookie), config)).status, 403);
    assert.equal(reads, 0);
    authorized = true;
    const response = await worker.fetch(request(cookie), config);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /aBcDeF\.exe/);
    assert.equal(await response.text(), 'test loader');
    assert.equal(reads, 1);
  } finally { globalThis.fetch = original; }
});
test('expired sessions and Discord failures cannot download the loader', async () => {
  const original = globalThis.fetch;
  let reads = 0, session = null;
  const config = { ...env, DISCORD_BOT_TOKEN: 'test', DISCORD_GUILD_ID: '123456789012345678',
    DISCORD_BUYER_ROLE_ID: '123456789012345680',
    DB: { prepare: () => ({ bind: () => ({ first: async () => session }) }) },
    LOADER_BUCKET: { get: async () => { reads++; return { body: 'private' }; } } };
  const request = () => new Request('https://login.zesthub.win/download-loader', { headers: {
    Cookie: '__Host-zest_session=' + 'a'.repeat(64), 'X-Buyer': 'true'
  } });
  try {
    assert.equal((await worker.fetch(request(), config)).status, 401);
    session = { discord_id: '111111111111111111' };
    globalThis.fetch = async () => new Response(null, { status: 503 });
    assert.equal((await worker.fetch(request(), config)).status, 503);
    assert.equal(reads, 0);
  } finally { globalThis.fetch = original; }
});
test('sandbox checkout stays disabled unless explicitly configured', async () => {
  const request = new Request('https://login.zesthub.win/sandbox/payments/config', { headers: { Origin: 'https://zesthub.win' } });
  const r = await worker.fetch(request, env);
  assert.equal(r.status, 503);
});
test('sandbox webhooks and scheduler fail closed when missing configuration', async () => {
  const request = new Request('https://login.zesthub.win/sandbox/payments/webhook', { method: 'POST', body: '{}' });
  const r = await worker.fetch(request, env);
  assert.equal(r.status, 503);
  await worker.scheduled({}, env);
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
test('Discord access displays the highest assigned role while keeping buyer checks', async () => {
  const original = globalThis.fetch;
  const config = { DISCORD_BOT_TOKEN: 'test', DISCORD_GUILD_ID: '123456789012345678', DISCORD_BUYER_ROLE_ID: '123456789012345680' };
  let memberRoles = ['123456789012345679', '123456789012345681'];
  try {
    globalThis.fetch = async url => String(url).endsWith('/roles') ? Response.json([
      { id: '123456789012345679', name: 'Member', position: 1 },
      { id: config.DISCORD_BUYER_ROLE_ID, name: 'Buyer', position: 2 },
      { id: '123456789012345681', name: 'Mod', position: 3 }
    ]) : String(url).includes('/members/') ? Response.json({ roles: memberRoles })
      : Response.json({ owner_id: '999999999999999999' });
    assert.deepEqual(await getDiscordAccess('111111111111111111', config), { role: 'Mod', buyer: true, marketOwner: false });
    memberRoles = ['123456789012345679'];
    assert.deepEqual(await getDiscordAccess('111111111111111111', config), { role: 'Member', buyer: false, marketOwner: false });
    memberRoles = [];
    assert.deepEqual(await getDiscordAccess('111111111111111111', config), { role: 'Member', buyer: false, marketOwner: false });
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
test('successful login returns community visitors to the requested page', async () => {
  const original = globalThis.fetch;
  const fakeDB = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) };
  try {
    globalThis.fetch = async url => String(url).includes('/oauth2/token')
      ? Response.json({ access_token: 'test-token', token_type: 'bearer' })
      : Response.json({ id: '123456789012345678', username: 'test-user' });
    const state = 'a'.repeat(64);
    const r = await worker.fetch(new Request(`https://login.zesthub.win/callback?state=${state}&code=test`, {
      headers: { Cookie: `__Host-zest_oauth_state=${state}; __Host-zest_return=market` }
    }), { ...env, DB: fakeDB });
    assert.equal(r.headers.get('location'), 'https://zesthub.win/Market');
    assert.match(r.headers.get('set-cookie'), /__Host-zest_return=;.*Max-Age=0/);
  } finally { globalThis.fetch = original; }
});
