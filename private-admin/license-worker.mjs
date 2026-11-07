const fail = (status, message) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join(''); }

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/download' || request.method !== 'POST') return fail(404, 'Not found');
    if (!env.LICENSE_DB || !env.DLL_BUCKET || !env.LOGIN_LIMIT) return fail(503, 'Unavailable');
    try {
      const ip = request.headers.get('cf-connecting-ip');
      if (!ip) return fail(403, 'Forbidden');
      if (!(await env.LOGIN_LIMIT.limit({ key: ip })).success) return fail(429, 'Too many attempts');
      const length = Number(request.headers.get('content-length'));
      if (!Number.isSafeInteger(length) || length < 1 || length > 8192) return fail(400, 'Invalid request');
      const body = await request.text();
      if (new TextEncoder().encode(body).length > 8192) return fail(400, 'Invalid request');
      const input = JSON.parse(body);
      if (typeof input.username !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(input.username) ||
          typeof input.key !== 'string' || !/^ZEST-[A-F0-9]{48}$/.test(input.key) ||
          typeof input.hwid !== 'string' || input.hwid.length < 4 || input.hwid.length > 512)
        return fail(401, 'Invalid credentials or license');
      const keyHash = await hash(input.key);
      const deviceHash = await hash(input.hwid);
      const now = Math.floor(Date.now() / 1000);
      // A single conditional update claims and binds the license atomically.
      const row = await env.LICENSE_DB.prepare(`UPDATE licenses SET
        username=COALESCE(username,?), hwid_hash=COALESCE(hwid_hash,?),
        activated_at=COALESCE(activated_at,?), expires_at=COALESCE(expires_at,CASE WHEN duration_seconds=253402300799 THEN 253402300799 ELSE ?+duration_seconds END)
        WHERE key_hash=? AND revoked=0 AND (username IS NULL OR username=?)
        AND (hwid_hash IS NULL OR hwid_hash=?) AND (expires_at IS NULL OR expires_at>?)
        AND NOT EXISTS (SELECT 1 FROM banned_devices WHERE hwid_hash=?) RETURNING id`)
        .bind(input.username, deviceHash, now, now, keyHash, input.username, deviceHash, now, deviceHash).first();
      if (!row) return fail(401, 'Invalid credentials or license');
      const object = await env.DLL_BUCKET.get('ZestHub.dll');
      if (!object || object.size < 64 || object.size > 256 * 1024 * 1024) return fail(503, 'Download unavailable');
      return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch { return fail(503, 'Unavailable'); }
  }
};
