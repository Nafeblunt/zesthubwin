import { createRemoteJWKSet, jwtVerify } from 'jose';
import dashboard from './dashboard.mjs';

const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zest Hub private upload</title>
<link rel="stylesheet" href="https://zesthub.win/style.css">
<style>body{max-width:35rem;margin:0 auto}main{background:#202020;border:1px solid #363636;border-radius:14px;padding:2rem}
h1{margin-top:0}input,button{display:block;margin:1rem auto}p{line-height:1.5}</style>
<main><h1>Private DLL upload</h1><p>Upload the latest ZestHub.dll. This replaces the current private download.</p>
<form id="upload"><input type="file" id="file" accept=".dll" required><button>Upload DLL</button></form>
<p id="status" role="status"></p><hr><h2>Licenses</h2>
<form id="create"><label>Duration in days <input id="days" type="number" min="1" max="3650" value="30" required></label><button>Generate key</button></form>
<p id="newkey" role="status"></p><p>Copy the key now; it is only shown once.</p><div id="licenses"></div></main><script>
document.getElementById('upload').addEventListener('submit',async event=>{event.preventDefault();
const file=document.getElementById('file').files[0], status=document.getElementById('status');
if(!file)return; status.textContent='Uploading…';
try{const response=await fetch('/upload',{method:'PUT',body:file,headers:{'Content-Type':'application/octet-stream'}});
status.textContent=response.ok?'Upload complete.':'Upload failed ('+response.status+').';}
catch{status.textContent='Upload failed. Check your connection.';}});
async function refresh(){const box=document.getElementById('licenses');box.replaceChildren();const r=await fetch('/api/licenses');
if(!r.ok){box.textContent='Unable to load licenses.';return} const data=await r.json();
for(const l of data.licenses){const card=document.createElement('div');card.style.cssText='border-top:1px solid #444;padding:1em 0';
const info=document.createElement('p');info.textContent=l.id+' | '+(l.username||'Unclaimed')+' | '+(l.revoked?'Revoked':l.expires_at?'Expires '+new Date(l.expires_at*1000).toLocaleString():'Not activated')+(l.device_banned?' | Device banned':'');card.append(info);
for(const [action,label] of [['reset','Reset device'],['ban','Ban device'],['unban','Unban device'],['revoke','Revoke license']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{if(!confirm(label+' for this license?'))return;const res=await fetch('/api/licenses/'+l.id+'/'+action,{method:'POST'});if(!res.ok)alert('Action failed ('+res.status+').');refresh()};card.append(b)}box.append(card)}}
document.getElementById('create').onsubmit=async event=>{event.preventDefault();const output=document.getElementById('newkey');
const r=await fetch('/api/licenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days:Number(document.getElementById('days').value)})});
if(!r.ok){output.textContent='Could not generate key.';return}const data=await r.json();output.textContent=data.key;refresh()};refresh();</script></html>`;

function randomHex(size) { return Array.from(crypto.getRandomValues(new Uint8Array(size)), x => x.toString(16).padStart(2, '0')).join(''); }
async function hash(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), x => x.toString(16).padStart(2, '0')).join(''); }

async function authorize(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL) return false;
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(env.ACCESS_TEAM_DOMAIN)) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    const keys = createRemoteJWKSet(new URL(env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs'));
    const { payload } = await jwtVerify(token, keys, { issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD,
      algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email'] });
    return typeof payload.email === 'string' && payload.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    if (!env.DLL_BUCKET || !await authorize(request, env)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://zesthub.win; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'" };
    if (url.pathname === '/' && request.method === 'GET')
      return new Response(dashboard, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname.startsWith('/api/licenses')) {
      if (!env.LICENSE_DB) return new Response('Not configured', { status: 503, headers });
      if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin)
        return new Response('Forbidden', { status: 403, headers });
      try {
        if (url.pathname === '/api/licenses' && request.method === 'GET') {
          const offset = Number(url.searchParams.get('offset') || '0');
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return new Response('Invalid offset', { status: 400, headers });
          const rows = await env.LICENSE_DB.prepare('SELECT l.id,l.username,l.created_at,l.activated_at,l.expires_at,l.duration_seconds,l.revoked,l.hwid_hash IS NOT NULL AS device_bound,CASE WHEN b.hwid_hash IS NULL THEN 0 ELSE 1 END AS device_banned FROM licenses l LEFT JOIN banned_devices b ON l.hwid_hash=b.hwid_hash ORDER BY l.created_at DESC,l.id DESC LIMIT 501 OFFSET ?').bind(offset).all();
          return Response.json({ licenses: rows.results.slice(0, 500), nextOffset: rows.results.length > 500 ? offset + 500 : null }, { headers });
        }
        if (url.pathname === '/api/licenses' && request.method === 'POST') {
          const length = Number(request.headers.get('Content-Length'));
          if (!length || length > 1024) return new Response('Invalid request', { status: 400, headers });
          const { unit, quantity, count } = await request.json();
          const seconds = { hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000, lifetime: 253402300799 };
          if (!Object.hasOwn(seconds, unit) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 ||
              !Number.isInteger(count) || count < 1 || count > 100) return new Response('Invalid duration or quantity', { status: 400, headers });
          const duration = unit === 'lifetime' ? seconds.lifetime : quantity * seconds[unit];
          const keys = Array.from({ length: count }, () => 'ZEST-' + randomHex(24).toUpperCase());
          const statements = await Promise.all(keys.map(async key => env.LICENSE_DB.prepare('INSERT INTO licenses (id,key_hash,created_at,duration_seconds) VALUES (?,?,?,?)')
            .bind(randomHex(12), await hash(key), Math.floor(Date.now()/1000), duration)));
          await env.LICENSE_DB.batch(statements);
          return Response.json({ keys }, { status: 201, headers });
        }
        const match = /^\/api\/licenses\/([a-f0-9]{24})\/(reset|ban|unban|revoke)$/.exec(url.pathname);
        if (match && request.method === 'POST') {
          const [, id, action] = match;
          const license = await env.LICENSE_DB.prepare('SELECT l.hwid_hash, CASE WHEN b.hwid_hash IS NULL THEN 0 ELSE 1 END AS device_banned FROM licenses l LEFT JOIN banned_devices b ON l.hwid_hash=b.hwid_hash WHERE l.id=?').bind(id).first();
          if (!license) return new Response('Not found', { status: 404, headers });
          if (action === 'reset' && license.device_banned) return new Response('Unban the device before resetting it', { status: 409, headers });
          if (action === 'reset') await env.LICENSE_DB.prepare('UPDATE licenses SET hwid_hash=NULL WHERE id=?').bind(id).run();
          if (action === 'revoke') await env.LICENSE_DB.prepare('UPDATE licenses SET revoked=1 WHERE id=?').bind(id).run();
          if (action === 'ban' || action === 'unban') {
            if (!license.hwid_hash) return new Response('No device bound', { status: 409, headers });
            if (action === 'ban') await env.LICENSE_DB.prepare('INSERT OR IGNORE INTO banned_devices (hwid_hash,banned_at) VALUES (?,?)').bind(license.hwid_hash, Math.floor(Date.now()/1000)).run();
            else await env.LICENSE_DB.prepare('DELETE FROM banned_devices WHERE hwid_hash=?').bind(license.hwid_hash).run();
          }
          return Response.json({ ok: true }, { headers });
        }
      } catch { return new Response('Database error', { status: 503, headers }); }
      return new Response('Not found', { status: 404, headers });
    }
    if (url.pathname === '/upload' && request.method === 'PUT') {
      if (request.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403, headers });
      const length = Number(request.headers.get('Content-Length'));
      if (!Number.isSafeInteger(length) || length < 64 || length > 64 * 1024 * 1024 || !request.body)
        return new Response('Invalid file size', { status: 400, headers });
      try {
        await env.DLL_BUCKET.put('ZestHub.dll', request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
        return new Response('Uploaded', { headers });
      } catch { return new Response('Upload failed', { status: 503, headers }); }
    }
    return new Response('Not found', { status: 404, headers });
  }
};
