import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './worker.mjs';
import admin from '../private-admin/admin.mjs';
import { generateKeyPair, exportJWK, SignJWT } from '../private-admin/node_modules/jose/dist/webapi/index.js';

const token = 'a'.repeat(64), otherToken = 'b'.repeat(64);
const key = 'ZEST-' + 'AB'.repeat(24);
const hash = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
async function setup(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(readFileSync(new URL('../private-admin/schema.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./account-license-schema.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./buyer-role-schema.sql', import.meta.url), 'utf8'));
  for (const [sessionToken, id] of [[token, '111111111111111111'], [otherToken, '222222222222222222']]) {
    sql.prepare('INSERT INTO website_sessions VALUES (?,?,?,?)').run(await hash(sessionToken), id, 'Member', Math.floor(Date.now()/1000)+3600);
  }
  sql.prepare('INSERT INTO licenses(id,key_hash,created_at,duration_seconds) VALUES (?,?,?,?)').run('licence-one', await hash(key), 1, 86400);
  const prepare = (query, args = []) => ({
    bind: (...values) => prepare(query, values),
    first: async () => sql.prepare(query).get(...args),
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => ({ results: [], meta: sql.prepare(query).run(...args) })
  });
  const DB = { prepare, batch: async statements => {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, env: { DB, DISCORD_CLIENT_ID: 'test', DISCORD_CLIENT_SECRET: 'test', ACCOUNT_VAULT_SECRET: '12'.repeat(32),
    COMMUNITY_LIMIT: { limit: async () => ({ success: true }) } } };
}
function request({ method = 'GET', session = token, body, origin = 'https://zesthub.win' } = {}) {
  return new Request('https://login.zesthub.win/account/license', { method, headers: {
    Origin: origin, ...(session ? { Cookie: '__Host-zest_session=' + session } : {}), 'Content-Type': 'application/json'
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('account licence requires a valid session and site origin', async t => {
  const { env } = await setup(t);
  assert.equal((await worker.fetch(request({ session: null }), env)).status, 401);
  assert.equal((await worker.fetch(request({ origin: 'https://evil.example' }), env)).status, 403);
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { license: null });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('redeeming a key starts its duration and returns it only to its Discord owner', async t => {
  const { env, sql } = await setup(t);
  const now = Math.floor(Date.now()/1000);
  const response = await worker.fetch(request({ method: 'POST', body: { key, discord_id: '222222222222222222' } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.license.key, key);
  assert.equal(data.license.durationSeconds, 86400);
  assert.equal(data.license.status, 'Active');
  assert.ok(data.license.activatedAt >= now);
  assert.equal(data.license.expiresAt, data.license.activatedAt + 86400);
  const stored = sql.prepare('SELECT * FROM website_account_licenses').get();
  assert.equal(stored.discord_id, '111111111111111111');
  assert.ok(!stored.key_ciphertext.includes(key));
  assert.equal((await (await worker.fetch(request(), env)).json()).license.key, key);
  assert.deepEqual(await (await worker.fetch(request({ session: otherToken }), env)).json(), { license: null });
  assert.equal((await worker.fetch(request({ method: 'POST', session: otherToken, body: { key } }), env)).status, 409);
});

test('redeeming again preserves expiry and lifetime keys stay lifetime', async t => {
  const { env, sql } = await setup(t);
  const activeAt = Math.floor(Date.now()/1000) - 100;
  sql.prepare('UPDATE licenses SET activated_at=?,expires_at=?').run(activeAt, activeAt + 86400);
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(request({ method: 'POST', body: { key } }), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).license.expiresAt, activeAt + 86400);
  }
  const lifetimeKey = 'ZEST-' + 'CD'.repeat(24);
  sql.prepare('INSERT INTO licenses(id,key_hash,created_at,duration_seconds) VALUES (?,?,?,?)').run('lifetime', await hash(lifetimeKey), 2, 253402300799);
  const response = await worker.fetch(request({ method: 'POST', body: { key: lifetimeKey } }), env);
  const data = await response.json();
  assert.equal(data.license.durationSeconds, 253402300799);
  assert.equal(data.license.expiresAt, null);
});

test('redeeming rejects invalid, expired, revoked, banned and rate-limited keys', async t => {
  const { env, sql } = await setup(t);
  assert.equal((await worker.fetch(request({ method: 'POST', body: { key: 'ZEST-XXXXXXXXXXXXXX' } }), env)).status, 400);
  assert.equal((await worker.fetch(request({ method: 'POST', body: { key: 'x'.repeat(9000) } }), env)).status, 400);
  for (const update of ['revoked=1', 'revoked=0,expires_at=1', "expires_at=NULL,hwid_hash='banned'"]) {
    sql.exec('UPDATE licenses SET ' + update);
    sql.exec("INSERT OR IGNORE INTO banned_devices VALUES ('banned',1)");
    assert.equal((await worker.fetch(request({ method: 'POST', body: { key } }), env)).status, 400);
  }
  sql.exec('UPDATE licenses SET hwid_hash=NULL');
  env.COMMUNITY_LIMIT.limit = async () => ({ success: false });
  assert.equal((await worker.fetch(request({ method: 'POST', body: { key } }), env)).status, 429);
});

test('missing vault configuration fails without exposing a key', async t => {
  const { env } = await setup(t);
  delete env.ACCOUNT_VAULT_SECRET;
  const response = await worker.fetch(request({ method: 'POST', body: { key } }), env);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(key));
});

test('admin sees the redeemed Discord owner before loader login and keeps the identity after logout', async t => {
  const { env, sql } = await setup(t);
  assert.equal((await worker.fetch(request({ method: 'POST', body: { key, discord_username: 'forged' } }), env)).status, 200);
  sql.exec('DELETE FROM website_sessions');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'admin-test', alg: 'RS256' };
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), 'https://test.cloudflareaccess.com/cdn-cgi/access/certs');
    return Response.json({ keys: [jwk] });
  });
  const jwt = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'admin-test' })
    .setIssuer('https://test.cloudflareaccess.com').setAudience('test').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const adminEnv = { DLL_BUCKET: {}, LICENSE_DB: env.DB, ACCESS_TEAM_DOMAIN: 'https://test.cloudflareaccess.com', ACCESS_AUD: 'test', OWNER_EMAIL: 'owner@example.com' };
  const response = await admin.fetch(new Request('https://admin.example/api/licenses', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), adminEnv);
  assert.equal(response.status, 200);
  const [license] = (await response.json()).licenses;
  assert.equal(license.discord_id, '111111111111111111');
  assert.equal(license.discord_username, 'Member');
  assert.ok(license.redeemed_at > 0);
  assert.equal(license.username, null);
  assert.equal(license.key_ciphertext, undefined);
});

test('a second Discord account cannot replace the saved redemption identity', async t => {
  const { env, sql } = await setup(t);
  await worker.fetch(request({ method: 'POST', body: { key } }), env);
  sql.prepare('UPDATE website_sessions SET username=? WHERE discord_id=?').run('Attacker', '222222222222222222');
  assert.equal((await worker.fetch(request({ method: 'POST', session: otherToken, body: { key } }), env)).status, 409);
  const owner = sql.prepare('SELECT * FROM website_account_licenses').get();
  assert.equal(owner.discord_username, 'Member');
  assert.equal(owner.discord_id, '111111111111111111');
});

test('existing redemptions recover names by Discord ID, without guessing from loader usernames', t => {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  sql.exec(readFileSync(new URL('../private-admin/schema.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  sql.exec(`CREATE TABLE website_account_licenses(license_id TEXT PRIMARY KEY,discord_id TEXT NOT NULL,key_ciphertext TEXT NOT NULL,redeemed_at INTEGER NOT NULL);
    INSERT INTO website_account_licenses VALUES('old','111111111111111111','encrypted',10),('unknown','222222222222222222','encrypted',11);
    INSERT INTO website_sessions VALUES('old-session','111111111111111111','Old name',10),('new-session','111111111111111111','Current name',20);
    INSERT INTO licenses(id,key_hash,created_at,duration_seconds,username) VALUES('unknown','hash',1,3600,'Current name');`);
  sql.exec(readFileSync(new URL('./migration-license-discord.sql', import.meta.url), 'utf8'));
  assert.equal(sql.prepare("SELECT discord_username FROM website_account_licenses WHERE license_id='old'").get().discord_username, 'Current name');
  const unknown = sql.prepare("SELECT * FROM website_account_licenses WHERE license_id='unknown'").get();
  assert.equal(unknown.discord_id, '222222222222222222');
  assert.equal(unknown.discord_username, null);
});

function discordRoles(t, env, { roles = ['333333333333333333', '555555555555555555'], fail = () => null } = {}) {
  Object.assign(env, { DISCORD_GUILD_ID: '666666666666666666', DISCORD_BUYER_ROLE_ID: '444444444444444444',
    DISCORD_MEMBER_ROLE_ID: '333333333333333333', DISCORD_BOT_TOKEN: 'test-bot-token' });
  const assigned = new Set(roles), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, config) => {
    const method = config.method || 'GET';
    assert.equal(config.headers.Authorization, 'Bot test-bot-token');
    assert.ok(String(url).startsWith('https://discord.com/api/v10/guilds/666666666666666666/members/111111111111111111'));
    calls.push({ url: String(url), method });
    const failure = fail(method, String(url));
    if (failure) return failure;
    if (method === 'GET') return Response.json({ user: { id: '111111111111111111', bot: false }, roles: [...assigned] });
    const role = String(url).split('/').at(-1);
    if (method === 'PUT') { assert.equal(role, '444444444444444444'); assigned.add(role); }
    else { assert.equal(method, 'DELETE'); assert.equal(role, '333333333333333333'); assigned.delete(role); }
    return new Response(null, { status: 204 });
  });
  return { assigned, calls };
}

test('redemption adds Buyer then removes Member using the signed-in Discord identity', async t => {
  const { env, sql } = await setup(t);
  const { assigned, calls } = discordRoles(t, env);
  const response = await worker.fetch(request({ method: 'POST', body: { key, discord_id: '222222222222222222', buyerRoleId: '555555555555555555' } }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'PUT', 'DELETE']);
  assert.deepEqual([...assigned].sort(), ['444444444444444444', '555555555555555555']);
  assert.equal((await response.json()).roleSync, 'synced');
  assert.equal(sql.prepare('SELECT count(*) AS count FROM website_buyer_role_queue').get().count, 0);
});

test('failed Buyer grant keeps Member and the saved licence, then cron retries even with payments disabled', async t => {
  const { env, sql } = await setup(t);
  let unavailable = true;
  const { assigned, calls } = discordRoles(t, env, { fail: method => unavailable && method === 'PUT' ? new Response(null, { status: 503 }) : null });
  const response = await worker.fetch(request({ method: 'POST', body: { key } }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).roleSync, 'pending');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'PUT']);
  assert.ok(assigned.has('333333333333333333'));
  assert.equal(sql.prepare('SELECT count(*) AS count FROM website_account_licenses').get().count, 1);
  assert.equal(sql.prepare('SELECT attempts FROM website_buyer_role_queue').get().attempts, 1);
  unavailable = false;
  sql.exec('UPDATE website_buyer_role_queue SET next_attempt_at=0');
  await worker.scheduled({}, env);
  assert.ok(assigned.has('444444444444444444'));
  assert.ok(!assigned.has('333333333333333333'));
  assert.equal(sql.prepare('SELECT count(*) AS count FROM website_buyer_role_queue').get().count, 0);
});

test('existing Buyer still loses Member and unrelated roles remain untouched', async t => {
  const { env } = await setup(t);
  const { assigned, calls } = discordRoles(t, env, { roles: ['333333333333333333', '444444444444444444', '555555555555555555'] });
  await worker.fetch(request({ method: 'POST', body: { key } }), env);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'DELETE']);
  assert.deepEqual([...assigned].sort(), ['444444444444444444', '555555555555555555']);
});

test('invalid keys and another account cannot trigger role changes', async t => {
  const { env } = await setup(t);
  const { calls } = discordRoles(t, env);
  assert.equal((await worker.fetch(request({ method: 'POST', body: { key: 'invalid' } }), env)).status, 400);
  assert.equal(calls.length, 0);
  await worker.fetch(request({ method: 'POST', body: { key } }), env);
  calls.length = 0;
  assert.equal((await worker.fetch(request({ method: 'POST', session: otherToken, body: { key } }), env)).status, 409);
  assert.equal(calls.length, 0);
});

test('pending grants recheck entitlement after revocation before making any Discord requests', async t => {
  const { env, sql } = await setup(t);
  const { calls } = discordRoles(t, env, { fail: () => new Response(null, { status: 503 }) });
  await worker.fetch(request({ method: 'POST', body: { key } }), env);
  sql.exec('UPDATE licenses SET revoked=1; UPDATE website_buyer_role_queue SET next_attempt_at=0');
  calls.length = 0;
  await worker.scheduled({}, env);
  assert.equal(calls.length, 0);
  assert.equal(sql.prepare('SELECT count(*) AS count FROM website_buyer_role_queue').get().count, 0);
});

for (const failure of [404, 403, 429]) test(`Discord HTTP ${failure} leaves a durable retry without losing the redeemed key`, async t => {
  const { env, sql } = await setup(t);
  const { calls } = discordRoles(t, env, { fail: () => new Response(null, { status: failure, headers: { 'Retry-After': '900' } }) });
  const response = await worker.fetch(request({ method: 'POST', body: { key } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.license.key, key);
  assert.equal(data.roleSync, 'pending');
  assert.deepEqual(calls.map(call => call.method), ['GET']);
  const queued = sql.prepare('SELECT * FROM website_buyer_role_queue').get();
  assert.equal(queued.discord_id, '111111111111111111');
  assert.ok(queued.next_attempt_at > Math.floor(Date.now()/1000));
  if (failure === 429) assert.ok(queued.next_attempt_at >= Math.floor(Date.now()/1000)+899);
});

test('Member removal failures retry without granting Buyer again or removing other roles', async t => {
  const { env, sql } = await setup(t);
  let unavailable = true;
  const { calls, assigned } = discordRoles(t, env, { fail: method => unavailable && method === 'DELETE' ? new Response(null, { status: 503 }) : null });
  const response = await worker.fetch(request({ method: 'POST', body: { key } }), env);
  assert.equal((await response.json()).roleSync, 'pending');
  assert.ok(assigned.has('444444444444444444'));
  assert.ok(assigned.has('333333333333333333'));
  unavailable = false; calls.length = 0;
  sql.exec('UPDATE website_buyer_role_queue SET next_attempt_at=0');
  await worker.scheduled({}, env);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'DELETE']);
  assert.deepEqual([...assigned].sort(), ['444444444444444444', '555555555555555555']);
});
