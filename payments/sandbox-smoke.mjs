// Creates a sandbox PayPal order without approving or capturing a payment.
// It also creates, then deletes, a uniquely generated test session and purchase.
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const token = randomBytes(32).toString('hex');
const sessionHash = createHash('sha256').update(token).digest('hex');
const discordId = '100000000000000001';
const cli = 'private-admin/node_modules/wrangler/bin/wrangler.js';
function sql(db, command) {
  execFileSync(process.execPath, [cli, 'd1', 'execute', db, '--remote', '--command', command],
    { stdio: 'ignore', env: process.env });
}
let purchaseId;
try {
  sql('zesthub-licenses', `INSERT INTO website_sessions (session_hash,discord_id,username,expires_at) VALUES ('${sessionHash}','${discordId}','sandbox-smoke',unixepoch()+300)`);
  const headers = { Origin: 'https://zesthub.win', Cookie: `__Host-zest_session=${token}` };
  const config = await fetch('https://login.zesthub.win/sandbox/payments/config', { headers });
  if (config.status !== 200 || (await config.json()).environment !== 'sandbox') throw new Error(`Sandbox config returned HTTP ${config.status}`);
  const created = await fetch('https://login.zesthub.win/sandbox/payments/create', { method: 'POST', headers });
  if (created.status !== 200) throw new Error(`Sandbox order creation returned HTTP ${created.status}`);
  const result = await created.json();
  if (!/^[a-f0-9]{24}$/.test(result.purchaseId) || !/^[A-Z0-9]{8,40}$/.test(result.orderId))
    throw new Error('Sandbox order response is invalid');
  purchaseId = result.purchaseId;
  console.log('PASS: sandbox configuration and creation of an unapproved test order.');
} finally {
  if (purchaseId) sql('zesthub-payments-sandbox', `DELETE FROM paypal_purchases WHERE id='${purchaseId}' AND discord_id='${discordId}' AND status='created'`);
  sql('zesthub-licenses', `DELETE FROM website_sessions WHERE session_hash='${sessionHash}' AND discord_id='${discordId}'`);
}
