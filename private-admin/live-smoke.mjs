// Creates and deletes a uniquely named temporary license in the configured database.
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const key = 'ZEST-' + randomBytes(24).toString('hex').toUpperCase();
const id = randomBytes(12).toString('hex');
const digest = createHash('sha256').update(key).digest('hex');
const cli = 'node_modules/wrangler/bin/wrangler.js';
function sql(command) {
  execFileSync(process.execPath, [cli, 'd1', 'execute', 'zesthub-licenses', '--remote', '--command', command],
    { stdio: 'ignore', env: process.env });
}
async function request(device, license = key) {
  return fetch('https://download.zesthub.win/download', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'smoke-test', key: license, hwid: device }) });
}
try {
  sql(`INSERT INTO licenses (id,key_hash,created_at,duration_seconds) VALUES ('${id}','${digest}',unixepoch(),3600)`);
  const ok = await request('test-device-one');
  if (ok.status !== 200) throw new Error(`Valid test license returned HTTP ${ok.status}`);
  const image = new Uint8Array(await ok.arrayBuffer());
  if (image.length < 64 || image[0] !== 0x4d || image[1] !== 0x5a) throw new Error('Downloaded file is not a PE image');
  const wrongDevice = await request('test-device-two');
  if (wrongDevice.status !== 401) throw new Error(`Second device returned HTTP ${wrongDevice.status}`);
  console.log('PASS: valid test license downloaded an image; a second device was denied.');
} finally {
  sql(`DELETE FROM licenses WHERE id='${id}'`);
}
