import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './license-worker.mjs';

test('license claim, device reset, ban, expiry and revocation gate storage', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const key = 'ZEST-' + 'A'.repeat(48), username = 'testuser';
  const digest = async text => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
  const keyHash = await digest(key);
  db.prepare('INSERT INTO licenses (id,key_hash,created_at,duration_seconds) VALUES (?,?,?,?)').run('id', keyHash, 1, 86400);
  let downloads = 0;const objects=[];
  const env = { LICENSE_DB: { prepare: sql => ({ bind: (...args) => ({ first: async () => db.prepare(sql).get(...args) }) }) },
    LOGIN_LIMIT: { limit: async () => ({ success: true }) }, DLL_BUCKET: { get: async name => {
      objects.push(name);
      downloads++; return { size: 64, body: new Uint8Array(64) };
    } } };
  async function attempt(user, device, game, route='/download') {
    const body = JSON.stringify({ username: user, key, hwid: device, ...(game===undefined?{}:{game}) });
    const request = new Request('https://example.com'+route, { method: 'POST', body,
      headers: { 'content-length': String(Buffer.byteLength(body)), 'cf-connecting-ip': '127.0.0.1' } });
    return (await worker.fetch(request, env)).status;
  }
  assert.equal(await attempt(username, 'device-one'), 200);
  assert.equal(await attempt(username, 'device-two'), 401);
  assert.equal(await attempt('someoneelse', 'device-one'), 401);
  db.prepare('UPDATE licenses SET hwid_hash=NULL WHERE id=?').run('id');
  assert.equal(await attempt(username, 'device-two'), 200);
  db.prepare('INSERT INTO banned_devices VALUES (?,?)').run(await digest('device-two'), 1);
  assert.equal(await attempt(username, 'device-two'), 401);
  db.prepare('DELETE FROM banned_devices').run();
  db.prepare('UPDATE licenses SET expires_at=1 WHERE id=?').run('id');
  assert.equal(await attempt(username, 'device-two'), 401);
  db.prepare('UPDATE licenses SET expires_at=9999999999,revoked=1 WHERE id=?').run('id');
  assert.equal(await attempt(username, 'device-two'), 401);
  assert.equal(downloads, 2);
  db.prepare('UPDATE licenses SET revoked=0, username=NULL, hwid_hash=NULL, activated_at=NULL, expires_at=NULL, duration_seconds=253402300799 WHERE id=?').run('id');
  assert.equal(await attempt(username, 'device-three'), 200);
  assert.equal(db.prepare('SELECT expires_at FROM licenses WHERE id=?').get('id').expires_at, 253402300799);
  const previous=downloads;
  assert.equal(await attempt(username,'device-three',undefined,'/authenticate'),200);
  assert.equal(downloads,previous,'authentication must not require a DLL upload');
  assert.equal(await attempt(username,'device-three','fallout76'),200);
  assert.equal(objects.at(-1),'Fallout76ESP.dll');
  assert.equal(await attempt(username,'device-three','cs2'),200);
  assert.equal(objects.at(-1),'ZestHub.dll');
  for(const game of ['unknown','constructor','__proto__','../ZestHub.dll','']){
    const before=downloads;assert.equal(await attempt(username,'device-three',game),400);assert.equal(downloads,before);
  }
  db.prepare('UPDATE licenses SET revoked=1 WHERE id=?').run('id');
  const before=downloads;assert.equal(await attempt(username,'device-three','fallout76'),401);assert.equal(downloads,before);
});

test('duration edits use activation time and preserve unused and lifetime behavior', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO licenses (id,key_hash,created_at,duration_seconds,activated_at) VALUES (?,?,?,?,?)').run('id', 'hash', 1, 3600, 1000);
  const update = db.prepare('UPDATE licenses SET duration_seconds=?, expires_at=CASE WHEN activated_at IS NULL THEN NULL WHEN ?=253402300799 THEN 253402300799 ELSE activated_at+? END WHERE id=? RETURNING id');
  update.get(86400,86400,86400,'id');
  assert.equal(db.prepare('SELECT expires_at FROM licenses').get().expires_at, 87400);
  update.get(253402300799,253402300799,253402300799,'id');
  assert.equal(db.prepare('SELECT expires_at FROM licenses').get().expires_at, 253402300799);
  db.exec('UPDATE licenses SET activated_at=NULL');
  update.get(3600,3600,3600,'id');
  assert.equal(db.prepare('SELECT expires_at FROM licenses').get().expires_at, null);
});


test('authenticated profile uses the license-linked Discord name, never a caller-supplied name', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../discord-login/account-license-schema.sql', import.meta.url), 'utf8'));
  const key='ZEST-'+'B'.repeat(48);
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))).toString('hex');
  db.prepare('INSERT INTO licenses (id,key_hash,created_at,duration_seconds) VALUES (?,?,?,?)').run('profile',digest,1,86400);
  const env={LICENSE_DB:{prepare:sql=>({bind:(...args)=>({first:async()=>db.prepare(sql).get(...args)})})},
    LOGIN_LIMIT:{limit:async()=>({success:true})},DLL_BUCKET:{get:()=>{throw Error('Auth must not read storage');}}};
  async function auth(overrides={}) {
    const body=JSON.stringify({username:'loader-name',key,hwid:'device',discordName:'Forged',...overrides});
    return worker.fetch(new Request('https://example.com/authenticate',{method:'POST',body,
      headers:{'content-length':String(Buffer.byteLength(body)),'cf-connecting-ip':'127.0.0.1'}}),env);
  }
  let response=await auth();
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,profile:{discordName:null}});
  db.prepare('INSERT INTO website_account_licenses VALUES (?,?,?,?,?)').run('profile','123','Discord member','cipher',1);
  response=await auth();
  assert.deepEqual(await response.json(),{ok:true,profile:{discordName:'Discord member'}});
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await auth({key:'ZEST-'+'C'.repeat(48)})).status,401);
  db.exec("UPDATE website_account_licenses SET discord_username='bad'||char(10)||'name'");
  assert.deepEqual(await (await auth()).json(),{ok:true,profile:{discordName:null}});
  db.exec('DROP TABLE website_account_licenses');
  assert.equal((await auth()).status,200,'optional profile lookup must not break older installations');
});
