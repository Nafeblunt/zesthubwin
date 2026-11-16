import { gameFor } from './games.mjs';

export function randomLoaderName() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const name = Array.from(bytes.slice(1, 7 + (bytes[0] & 1)), n => letters[n % letters.length]).join('');
    if (/[A-Z]/.test(name) && /[a-z]/.test(name)) return name + '.exe';
  }
}

// Called only after admin.mjs verifies the owner's Cloudflare Access identity.
export async function upload(request, env, headers = {}) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403, headers });
  const isLoader = url.pathname === '/upload-loader';
  const game = gameFor(url.searchParams.has('game') ? url.searchParams.get('game') : undefined);
  if (!isLoader && !game) return new Response('Unknown game', { status: 400, headers });
  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isSafeInteger(length) || length < 64 || length > 64 * 1024 * 1024 || !request.body)
    return new Response('Invalid file size', { status: 400, headers });
  try {
    let downloadName;
    if (isLoader) {
      const previous = await env.DLL_BUCKET.head('ZestHub-Loader.exe');
      do { downloadName = randomLoaderName(); } while (downloadName === previous?.customMetadata?.downloadName);
    }
    await env.DLL_BUCKET.put(isLoader ? 'ZestHub-Loader.exe' : game.objectKey, request.body, {
      httpMetadata: { contentType: 'application/octet-stream' },
      ...(isLoader ? { customMetadata: { downloadName } } : {})
    });
    return new Response('Uploaded', { headers });
  } catch { return new Response('Upload failed', { status: 503, headers }); }
}
