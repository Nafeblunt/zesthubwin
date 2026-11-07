const SITE = 'https://zesthub.win';
const REDIRECT = 'https://login.zesthub.win/callback';
const SESSION = '__Host-zest_session';
const STATE = '__Host-zest_oauth_state';
const TIMEOUT = 7 * 86400;
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
const cookie = (name, value, age) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
function cookies(request) { return Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(x => x.trim().split(/=(.*)/s).slice(0, 2)).filter(x => x.length === 2)); }
function redirect(url, values = []) {
  const headers = new Headers({ Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  for (const value of values) headers.append('Set-Cookie', value);
  return new Response(null, { status: 302, headers });
}
function json(request, value, status = 200, values = []) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
  if (request.headers.get('Origin') === SITE) { headers.set('Access-Control-Allow-Origin', SITE); headers.set('Access-Control-Allow-Credentials', 'true'); }
  for (const value of values) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify(value), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.DB || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json(request, { error: 'Login is not configured.' }, 503);
    let stage = 'request';
    try {
      if (url.pathname === '/start' && request.method === 'GET') {
        const state = random();
        const authorization = new URL('https://discord.com/oauth2/authorize');
        authorization.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'identify', state });
        return redirect(authorization.toString(), [cookie(STATE, state, 600)]);
      }
      if (url.pathname === '/callback' && request.method === 'GET') {
        const state = url.searchParams.get('state'), expected = cookies(request)[STATE];
        const clear = cookie(STATE, '', 0);
        if (!state || !expected || !/^[a-f0-9]{64}$/.test(state) || state !== expected || !url.searchParams.get('code')) {
          console.log('Discord login rejected: invalid state or code');
          return redirect(`${SITE}/?login=failed`, [clear]);
        }
        stage = 'discord-token';
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT }) });
        if (!tokenResponse.ok) {
          console.log('Discord login rejected at token exchange; HTTP status', tokenResponse.status);
          return redirect(`${SITE}/?login=failed`, [clear]);
        }
        const token = await tokenResponse.json();
        if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') {
          console.log('Discord login rejected: invalid token response');
          return redirect(`${SITE}/?login=failed`, [clear]);
        }
        stage = 'discord-identity';
        const identity = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` }, redirect: 'manual' });
        if (!identity.ok) {
          console.log('Discord login rejected at identity lookup; HTTP status', identity.status);
          return redirect(`${SITE}/?login=failed`, [clear]);
        }
        const user = await identity.json();
        if (!/^\d{15,22}$/.test(user.id) || typeof user.username !== 'string' || user.username.length > 100) {
          console.log('Discord login rejected: invalid identity response');
          return redirect(`${SITE}/?login=failed`, [clear]);
        }
        const session = random(), now = Math.floor(Date.now() / 1000);
        stage = 'session-store';
        await env.DB.prepare('INSERT INTO website_sessions (session_hash,discord_id,username,expires_at) VALUES (?,?,?,?)')
          .bind(await sha(session), user.id, user.global_name || user.username, now + TIMEOUT).run();
        return redirect(SITE + '/', [clear, cookie(SESSION, session, TIMEOUT)]);
      }
      if (url.pathname === '/me' && request.method === 'GET') {
        if (request.headers.get('Origin') !== SITE) return json(request, { error: 'Forbidden' }, 403);
        const token = cookies(request)[SESSION];
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return json(request, { user: null });
        const row = await env.DB.prepare('SELECT discord_id,username FROM website_sessions WHERE session_hash=? AND expires_at>?')
          .bind(await sha(token), Math.floor(Date.now() / 1000)).first();
        return json(request, { user: row ? { id: row.discord_id, name: row.username } : null });
      }
      if (url.pathname === '/logout' && request.method === 'POST') {
        if (request.headers.get('Origin') !== SITE) return json(request, { error: 'Forbidden' }, 403);
        const token = cookies(request)[SESSION];
        if (token && /^[a-f0-9]{64}$/.test(token)) await env.DB.prepare('DELETE FROM website_sessions WHERE session_hash=?').bind(await sha(token)).run();
        return json(request, { ok: true }, 200, [cookie(SESSION, '', 0)]);
      }
      return json(request, { error: 'Not found' }, 404);
    } catch (error) {
      console.error('Discord login failed at', stage, 'error type:', error?.name || 'Error');
      if (url.pathname === '/callback') return redirect(`${SITE}/?login=failed`, [cookie(STATE, '', 0)]);
      return json(request, { error: 'Login temporarily unavailable.' }, 503);
    }
  }
};
