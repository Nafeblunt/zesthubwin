import { createRemoteJWKSet, jwtVerify } from 'jose';

const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zest Hub private upload</title>
<style>body{font:16px system-ui;background:#101118;color:#fff;max-width:35rem;margin:4rem auto;padding:1rem}
main{background:#1b1c27;border:1px solid #35364a;border-radius:14px;padding:2rem}h1{margin-top:0}
input,button{display:block;margin:1rem 0}button{background:#8b73ff;color:white;border:0;border-radius:8px;padding:.8rem 1.2rem;cursor:pointer}p{line-height:1.5}</style>
<main><h1>Private DLL upload</h1><p>Upload the latest ZestHub.dll. This replaces the current private download.</p>
<form id="upload"><input type="file" id="file" accept=".dll" required><button>Upload DLL</button></form>
<p id="status" role="status"></p></main><script>
document.getElementById('upload').addEventListener('submit',async event=>{event.preventDefault();
const file=document.getElementById('file').files[0], status=document.getElementById('status');
if(!file)return; status.textContent='Uploading…';
try{const response=await fetch('/upload',{method:'PUT',body:file,headers:{'Content-Type':'application/octet-stream'}});
status.textContent=response.ok?'Upload complete.':'Upload failed ('+response.status+').';}
catch{status.textContent='Upload failed. Check your connection.';}});</script></html>`;

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
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'" };
    if (url.pathname === '/' && request.method === 'GET')
      return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
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
