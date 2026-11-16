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
async function request(device, license = key, game, route='/download') {
  return fetch('https://download.zesthub.win'+route, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'smoke-test', key: license, hwid: device, ...(game===undefined?{}:{game}) }) });
}
try {
  sql(`INSERT INTO licenses (id,key_hash,created_at,duration_seconds) VALUES ('${id}','${digest}',unixepoch(),3600)`);
  const login=await request('test-device-one',key,undefined,'/authenticate');
  if(login.status!==200)throw new Error(`Sign-in returned HTTP ${login.status}`);
  const ok = await request('test-device-one');
  if (ok.status !== 200) throw new Error(`Valid test license returned HTTP ${ok.status}`);
  const image = new Uint8Array(await ok.arrayBuffer());
  if (image.length < 64 || image[0] !== 0x4d || image[1] !== 0x5a) throw new Error('Downloaded file is not a PE image');
  if(ok.headers.get('X-Zest-Game')!=='cs2')throw new Error('Legacy download did not identify CS2');
  const fallout=await request('test-device-one',key,'fallout76');
  if(fallout.status===200){
    if(fallout.headers.get('X-Zest-Game')!=='fallout76')throw new Error('Fallout response identified another game');
    const bytes=new Uint8Array(await fallout.arrayBuffer());
    if(bytes.length<64||bytes[0]!==0x4d||bytes[1]!==0x5a)throw new Error('Fallout download is not a PE image');
  }else if(fallout.status!==404)throw new Error(`Fallout returned HTTP ${fallout.status}`);
  if(process.env.LOADER_PROBE)execFileSync(process.env.LOADER_PROBE,[],{input:key+'\n',stdio:['pipe','inherit','inherit']});
  const wrongDevice = await request('test-device-two');
  if (wrongDevice.status !== 401) throw new Error(`Second device returned HTTP ${wrongDevice.status}`);
  console.log('PASS: sign-in, legacy CS2 download, Fallout routing, and second-device denial.');
} finally {
  sql(`DELETE FROM licenses WHERE id='${id}'`);
}
