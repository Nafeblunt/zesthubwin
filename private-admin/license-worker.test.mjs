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
  let downloads = 0;
  const env = { LICENSE_DB: { prepare: sql => ({ bind: (...args) => ({ first: async () => db.prepare(sql).get(...args) }) }) },
    LOGIN_LIMIT: { limit: async () => ({ success: true }) }, DLL_BUCKET: { get: async () => {
      downloads++; return { size: 64, body: new Uint8Array(64) };
    } } };
  async function attempt(user, device) {
    const body = JSON.stringify({ username: user, key, hwid: device });
    const request = new Request('https://example.com/download', { method: 'POST', body,
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
});
