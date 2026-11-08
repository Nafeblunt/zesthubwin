import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { randomLoaderName } from './admin.mjs';

test('loader download names contain six or seven mixed-case letters', () => {
  for (let i = 0; i < 100; i++) {
    const name = randomLoaderName();
    assert.match(name, /^[A-Za-z]{6,7}\.exe$/);
    assert.match(name.slice(0, -4), /[a-z]/);
    assert.match(name.slice(0, -4), /[A-Z]/);
  }
});

test('unconfigured worker and missing identity fail closed', async () => {
  let writes = 0;
  const env = { DLL_BUCKET: { put: async () => writes++ } };
  assert.equal((await worker.fetch(new Request('https://admin.example/'), env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://admin.example/upload', { method: 'PUT', body: 'x' }), env)).status, 403);
  assert.equal(writes, 0);
});

test('forged identity does not authorize upload', async () => {
  let writes = 0;
  const env = { ACCESS_TEAM_DOMAIN: 'https://invalid.example', ACCESS_AUD: 'aud', OWNER_EMAIL: 'owner@example.com',
    DLL_BUCKET: { put: async () => writes++ } };
  const request = new Request('https://admin.example/upload', { method: 'PUT', body: 'x',
    headers: { 'Cf-Access-Jwt-Assertion': 'forged', Origin: 'https://admin.example' } });
  assert.equal((await worker.fetch(request, env)).status, 403);
  assert.equal(writes, 0);
});
