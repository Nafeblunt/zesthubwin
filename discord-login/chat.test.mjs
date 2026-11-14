import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './worker.mjs';

const token = 'a'.repeat(64);
async function setup(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec('CREATE TABLE website_sessions(session_hash TEXT PRIMARY KEY,discord_id TEXT,username TEXT,expires_at INTEGER)');
  sql.exec(readFileSync(new URL('./chat-schema.sql', import.meta.url), 'utf8'));
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  sql.prepare('INSERT INTO website_sessions VALUES (?,?,?,?)').run(hash, '111111111111111111', 'Test user', Math.floor(Date.now() / 1000) + 3600);
  const DB = { prepare: query => {
    const statement = (...args) => ({
      first: async () => sql.prepare(query).get(...args),
      all: async () => ({ results: sql.prepare(query).all(...args) }),
      run: async () => sql.prepare(query).run(...args)
    });
    return { ...statement(), bind: (...args) => statement(...args) };
  } };
  return { sql, env: { DB, DISCORD_CLIENT_ID: 'test', DISCORD_CLIENT_SECRET: 'test', DISCORD_BOT_TOKEN: 'test',
    DISCORD_GUILD_ID: '123456789012345678', DISCORD_BUYER_ROLE_ID: '123456789012345680',
    DISCORD_OWNER_ROLE_ID: '123456789012345679', DISCORD_DEV_ROLE_ID: '123456789012345681',
    COMMUNITY_LIMIT: { limit: async () => ({ success: true }) } } };
}
function request({ method = 'GET', signedIn = false, body, origin = 'https://zesthub.win', room = 'chat', sessionToken = token } = {}) {
  return new Request('https://login.zesthub.win/' + room, { method,
    headers: { Origin: origin, ...(signedIn ? { Cookie: '__Host-zest_session=' + sessionToken } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('chat is readable by visitors, but only valid sessions can send', async t => {
  const { env, sql } = await setup(t);
  assert.deepEqual(await (await worker.fetch(request(), env)).json(), { messages: [] });
  assert.equal((await worker.fetch(request({ method: 'POST', body: { body: 'Hi' } }), env)).status, 401);
  sql.exec('UPDATE website_sessions SET expires_at=0');
  assert.equal((await worker.fetch(request({ method: 'POST', signedIn: true, body: { body: 'Hi' } }), env)).status, 401);
});

test('chat saves the session identity and Discord avatar, ignoring claimed authors', async t => {
  const { env } = await setup(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ avatar: 'abc123', discriminator: '0' }));
  const response = await worker.fetch(request({ method: 'POST', signedIn: true,
    body: { body: '  Hello <script>  ', author_name: 'Fake', author_avatar: 'https://evil.example/a.png' } }), env);
  assert.equal(response.status, 201);
  const { messages } = await (await worker.fetch(request(), env)).json();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, 'Hello <script>');
  assert.equal(messages[0].author_name, 'Test user');
  assert.equal(messages[0].author_id, '111111111111111111');
  assert.equal(messages[0].author_avatar, 'https://cdn.discordapp.com/avatars/111111111111111111/abc123.png?size=80');
});

test('chat rejects other origins, invalid text, and rate-limited sends', async t => {
  const { env, sql } = await setup(t);
  assert.equal((await worker.fetch(request({ origin: 'https://evil.example' }), env)).status, 403);
  const preflight = await worker.fetch(request({ method: 'OPTIONS' }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://zesthub.win');
  for (const body of [{ body: ' ' }, { body: 'x'.repeat(281) }, { body: 42 }, null, { body: 'x'.repeat(9000) }]) {
    assert.equal((await worker.fetch(request({ method: 'POST', signedIn: true, body }), env)).status, 400);
  }
  env.COMMUNITY_LIMIT.limit = async () => ({ success: false });
  assert.equal((await worker.fetch(request({ method: 'POST', signedIn: true, body: { body: 'Hi' } }), env)).status, 429);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM public_chat_messages').get().n, 0);
});

test('chat returns the latest 100 messages in chronological order', async t => {
  const { env, sql } = await setup(t);
  const insert = sql.prepare('INSERT INTO public_chat_messages(id,body,author_id,author_name,author_avatar,created_at) VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < 105; i++) insert.run(String(i).padStart(24, '0'), `Message ${i}`, '111111111111111111', 'Test user', '', i);
  const { messages } = await (await worker.fetch(request(), env)).json();
  assert.equal(messages.length, 100);
  assert.equal(messages[0].body, 'Message 5');
  assert.equal(messages[99].body, 'Message 104');
});

test('shoutbox rejects regular members, accepts Dev and Owner, and keeps public chat separate', async t => {
  const { env } = await setup(t);
  let roles = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/roles')) return Response.json([
      { id: env.DISCORD_BUYER_ROLE_ID, name: 'Buyer', position: 1 },
      { id: env.DISCORD_DEV_ROLE_ID, name: 'Dev', position: 3 },
      { id: env.DISCORD_OWNER_ROLE_ID, name: 'Zest Owner', position: 5 }
    ]);
    if (String(url).includes('/members/')) return Response.json({ roles });
    return Response.json({ owner_id: '999999999999999999', avatar: 'abc123' });
  });
  const post = () => worker.fetch(request({ room: 'shoutbox', method: 'POST', signedIn: true, body: { body: 'Team update', shoutboxWriter: true } }), env);
  assert.equal((await post()).status, 403);
  for (const role of [env.DISCORD_DEV_ROLE_ID, env.DISCORD_OWNER_ROLE_ID]) {
    roles = [role];
    assert.equal((await post()).status, 201);
    const me = await (await worker.fetch(new Request('https://login.zesthub.win/me', { headers: {
      Origin: 'https://zesthub.win', Cookie: '__Host-zest_session=' + token
    } }), env)).json();
    assert.equal(me.shoutboxWriter, true);
  }
  assert.equal((await (await worker.fetch(request({ room: 'shoutbox' }), env)).json()).messages.length, 2);
  assert.equal((await (await worker.fetch(request(), env)).json()).messages.length, 0);
  roles = [];
  assert.equal((await worker.fetch(request({ method: 'POST', signedIn: true, body: { body: 'Everyone can chat' } }), env)).status, 201);
});

test('chat filters profanity, obfuscation, invite ads and unsafe links on the server', async t => {
  const { env } = await setup(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ avatar: 'abc123' }));
  for (const body of ['fuck you', 'fuck!', 'sh!t!', 'f.u.c.k you', 'sh1t', 'f\u200buck', 'join discord.gg/example', 'https://discord.com/invite/abc',
    'javascript:alert(1)', 'https://bit.ly/free-gift', 'https://example.com/payload.exe']) {
    const response = await worker.fetch(request({ method: 'POST', signedIn: true, body: { body } }), env);
    assert.equal(response.status, 400, body);
  }
  for (const body of ['Hello community', 'A classic example from Scunthorpe', 'Docs: https://example.com/help']) {
    assert.equal((await worker.fetch(request({ method: 'POST', signedIn: true, body: { body } }), env)).status, 201, body);
  }
});

test('Dev role name fallback uses server roles, and role lookup failure denies shoutbox writes', async t => {
  const { env } = await setup(t);
  delete env.DISCORD_DEV_ROLE_ID;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/roles')) return Response.json([
      { id: env.DISCORD_BUYER_ROLE_ID, name: 'Buyer', position: 1 },
      { id: '123456789012345681', name: 'Dev', position: 3 }
    ]);
    if (String(url).includes('/members/')) return Response.json({ roles: ['123456789012345681'] });
    return Response.json({ owner_id: '999999999999999999' });
  });
  assert.equal((await worker.fetch(request({ room: 'shoutbox', method: 'POST', signedIn: true, body: { body: 'Update' } }), env)).status, 201);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert.equal((await worker.fetch(request({ room: 'shoutbox', method: 'POST', signedIn: true, body: { body: 'Update' } }), env)).status, 503);
});

function mockRoles(t, env, roles) {
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/roles')) return Response.json([
      { id: env.DISCORD_BUYER_ROLE_ID, name: 'Buyer', position: 1 },
      { id: env.DISCORD_DEV_ROLE_ID, name: 'Dev', position: 3 },
      { id: env.DISCORD_OWNER_ROLE_ID, name: 'Zest Owner', position: 5 }
    ]);
    if (String(url).includes('/members/')) return Response.json({ roles: roles() });
    return Response.json({ owner_id: '999999999999999999', avatar: 'abc123' });
  });
}

test('only Dev and Owner can remove the selected message in its own room', async t => {
  const { env, sql } = await setup(t);
  let roles = [];
  mockRoles(t, env, () => roles);
  const id = 'a'.repeat(24), otherId = 'b'.repeat(24);
  for (const table of ['chat_messages', 'public_chat_messages']) {
    for (const key of [id, otherId]) sql.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?)`).run(key, 'Hi', '222222222222222222', 'Member', '', 1);
  }
  const remove = room => worker.fetch(request({ method: 'DELETE', signedIn: true, room: room + '/' + id }), env);
  assert.equal((await remove('chat')).status, 403);
  assert.equal((await worker.fetch(request({ method: 'DELETE', room: 'chat/' + id }), env)).status, 401);
  roles = [env.DISCORD_DEV_ROLE_ID];
  assert.equal((await remove('chat')).status, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM public_chat_messages').get().n, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n, 2);
  roles = [env.DISCORD_OWNER_ROLE_ID];
  assert.equal((await remove('shoutbox')).status, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n, 1);
  assert.equal((await remove('chat')).status, 404);
});

test('staff mutes block direct message sends, can be removed, and expire', async t => {
  const { env, sql } = await setup(t);
  mockRoles(t, env, () => [env.DISCORD_DEV_ROLE_ID]);
  const id = 'c'.repeat(24), memberToken = 'b'.repeat(64);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(memberToken))).toString('hex');
  sql.prepare('INSERT INTO website_sessions VALUES (?,?,?,?)').run(hash, '222222222222222222', 'Member', Math.floor(Date.now()/1000)+3600);
  sql.prepare('INSERT INTO public_chat_messages VALUES (?,?,?,?,?,?)').run(id, 'Hi', '222222222222222222', 'Member', '', 1);
  const muted = await worker.fetch(request({ method: 'POST', signedIn: true, room: 'chat/' + id + '/mute', body: { duration: 3600 } }), env);
  assert.equal(muted.status, 200);
  assert.ok((await muted.json()).mutedUntil > Math.floor(Date.now()/1000));
  const send = () => worker.fetch(request({ method: 'POST', signedIn: true, sessionToken: memberToken, body: { body: 'Still here', mutedUntil: 0 } }), env);
  const blocked = await send();
  assert.equal(blocked.status, 403);
  assert.ok((await blocked.json()).mutedUntil > 0);
  const read = await (await worker.fetch(request({ signedIn: true, sessionToken: memberToken }), env)).json();
  assert.ok(read.mutedUntil > 0);
  assert.ok(read.messages[0].author_muted_until > 0);
  assert.equal((await worker.fetch(request({ method: 'DELETE', signedIn: true, room: 'chat/' + id + '/mute' }), env)).status, 200);
  assert.equal((await send()).status, 201);
  sql.exec("INSERT OR REPLACE INTO chat_mutes VALUES ('222222222222222222',1,'111111111111111111')");
  assert.equal((await send()).status, 201);
});

test('mute actions reject members, spoofed origins, invalid durations and self-muting', async t => {
  const { env, sql } = await setup(t);
  let roles = [];
  mockRoles(t, env, () => roles);
  const id = 'd'.repeat(24);
  sql.prepare('INSERT INTO public_chat_messages VALUES (?,?,?,?,?,?)').run(id, 'Hi', '111111111111111111', 'Me', '', 1);
  const mute = extra => worker.fetch(request({ method: 'POST', signedIn: true, room: 'chat/' + id + '/mute', body: { duration: 3600 }, ...extra }), env);
  assert.equal((await mute()).status, 403);
  roles = [env.DISCORD_OWNER_ROLE_ID];
  assert.equal((await mute({ origin: 'https://evil.example' })).status, 403);
  assert.equal((await mute()).status, 400);
  sql.exec("UPDATE public_chat_messages SET author_id='222222222222222222'");
  assert.equal((await mute({ body: { duration: -1 } })).status, 400);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert.equal((await mute()).status, 503);
});
