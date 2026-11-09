import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';

const SITE = 'https://zesthub.win';
const token = 'a'.repeat(64), guild = '123456789012345678', ownerRole = '123456789012345679';
async function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE website_sessions(session_hash TEXT PRIMARY KEY,discord_id TEXT,username TEXT,expires_at INTEGER);
    CREATE TABLE community_posts(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,author_id TEXT NOT NULL,author_name TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  sql.prepare('INSERT INTO website_sessions VALUES (?,?,?,?)').run(hash, '111111111111111111', 'Test user', Math.floor(Date.now()/1000)+3600);
  const db = { prepare: query => ({ bind: (...args) => ({
    first: async () => sql.prepare(query).get(...args), all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => sql.prepare(query).run(...args)
  }) }) };
  return { sql, env: { DB: db, DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test', DISCORD_BOT_TOKEN: 'test',
    DISCORD_GUILD_ID: guild, DISCORD_OWNER_ROLE_ID: ownerRole, COMMUNITY_LIMIT: { limit: async () => ({ success: true }) } } };
}
function request(path, { signedIn = false, method = 'GET', body, origin = SITE } = {}) {
  return new Request('https://login.zesthub.win' + path, { method, headers: { Origin: origin,
    ...(signedIn ? { Cookie: '__Host-zest_session=' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('anonymous visitors can read posts but cannot create them', async () => {
  const { env } = await setup();
  assert.equal((await worker.fetch(request('/community/forum'), env)).status, 200);
  assert.equal((await worker.fetch(request('/community/forum', { method: 'POST', body: { title: 'Hello', body: 'World' } }), env)).status, 401);
});
test('forum posts belong to the signed-in account and reject other origins', async () => {
  const { env } = await setup();
  const body = { title: 'Hello', body: 'World', author: 'Impersonator' };
  assert.equal((await worker.fetch(request('/community/forum', { signedIn: true, method: 'POST', body, origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await worker.fetch(request('/community/forum', { signedIn: true, method: 'POST', body }), env)).status, 201);
  const data = await (await worker.fetch(request('/community/forum'), env)).json();
  assert.equal(data.posts[0].author_name, 'Test user');
});
test('market posting requires the actual Zest Owner role', async () => {
  const { env } = await setup(), original = globalThis.fetch;
  let roles = [];
  try {
    globalThis.fetch = async () => Response.json({ roles });
    const body = { title: 'Config', body: 'Description' };
    assert.equal((await worker.fetch(request('/community/market', { signedIn: true, method: 'POST', body }), env)).status, 403);
    roles = [ownerRole];
    assert.equal((await worker.fetch(request('/community/market', { signedIn: true, method: 'POST', body }), env)).status, 201);
    assert.equal((await (await worker.fetch(request('/community/market'), env)).json()).posts.length, 1);
  } finally { globalThis.fetch = original; }
});
test('the session reports market posting access only for the exact owner role', async () => {
  const { env } = await setup(), original = globalThis.fetch;
  let roles = [];
  try {
    globalThis.fetch = async url => String(url).endsWith('/roles') ? Response.json([
      { id: ownerRole, name: 'Zest Owner', position: 8 }, { id: '123456789012345680', name: 'Buyer', position: 3 }
    ]) : String(url).includes('/members/') ? Response.json({ roles }) : Response.json({ owner_id: '999999999999999999' });
    env.DISCORD_BUYER_ROLE_ID = '123456789012345680';
    let data = await (await worker.fetch(request('/me', { signedIn: true }), env)).json();
    assert.equal(data.marketOwner, false);
    roles = [ownerRole];
    data = await (await worker.fetch(request('/me', { signedIn: true }), env)).json();
    assert.equal(data.marketOwner, true);
  } finally { globalThis.fetch = original; }
});
test('authors and the Zest Owner can remove posts; other users cannot', async () => {
  const { env, sql } = await setup(), original = globalThis.fetch;
  const id = 'a'.repeat(24);
  sql.prepare('INSERT INTO community_posts VALUES (?,?,?,?,?,?,?)').run(id, 'forum', 'Title', 'Body', '222222222222222222', 'Other user', 1);
  try {
    globalThis.fetch = async () => Response.json({ roles: [] });
    assert.equal((await worker.fetch(request('/community/forum/' + id, { signedIn: true, method: 'DELETE' }), env)).status, 403);
    globalThis.fetch = async () => Response.json({ roles: [ownerRole] });
    assert.equal((await worker.fetch(request('/community/forum/' + id, { signedIn: true, method: 'DELETE' }), env)).status, 200);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM community_posts').get().n, 0);
    sql.prepare('INSERT INTO community_posts VALUES (?,?,?,?,?,?,?)').run(id, 'forum', 'Title', 'Body', '111111111111111111', 'Test user', 2);
    globalThis.fetch = async () => { throw new Error('Author deletion should not depend on Discord'); };
    assert.equal((await worker.fetch(request('/community/forum/' + id, { signedIn: true, method: 'DELETE' }), env)).status, 200);
  } finally { globalThis.fetch = original; }
});
test('market posting fails closed when Discord role lookup fails', async () => {
  const { env, sql } = await setup(), original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const response = await worker.fetch(request('/community/market', { signedIn: true, method: 'POST', body: { title: 'Config', body: 'Details' } }), env);
    assert.equal(response.status, 503);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM community_posts').get().n, 0);
  } finally { globalThis.fetch = original; }
});
test('forum rejects empty and oversized posts', async () => {
  const { env, sql } = await setup();
  for (const body of [{ title: ' ', body: 'Hi' }, { title: 'x', body: 'x'.repeat(4001) }, { title: 'x', body: 'x'.repeat(9000) }]) {
    assert.equal((await worker.fetch(request('/community/forum', { signedIn: true, method: 'POST', body }), env)).status, 400);
  }
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM community_posts').get().n, 0);
});
