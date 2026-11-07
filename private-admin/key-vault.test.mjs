import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealKey, openKey } from './key-vault.mjs';

test('encrypted keys require the right secret and license ID', async () => {
  const secret = 'ab'.repeat(32), key = 'ZEST-' + 'A'.repeat(48);
  const encrypted = await sealKey(secret, 'license-one', key);
  assert.notEqual(encrypted, key);
  assert.equal(await openKey(secret, 'license-one', encrypted), key);
  await assert.rejects(openKey(secret, 'license-two', encrypted));
  await assert.rejects(openKey('cd'.repeat(32), 'license-one', encrypted));
});
