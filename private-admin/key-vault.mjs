const encoder = new TextEncoder();
function decodeHex(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('Key vault not configured');
  return Uint8Array.from(value.match(/../g), x => parseInt(x, 16));
}
async function importKey(secret) { return crypto.subtle.importKey('raw', decodeHex(secret), 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function sealKey(secret, id, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(id) }, await importKey(secret), encoder.encode(key)));
  return Array.from(new Uint8Array([...iv, ...encrypted]), b => b.toString(16).padStart(2, '0')).join('');
}
export async function openKey(secret, id, value) {
  if (typeof value !== 'string' || value.length < 58 || value.length % 2 || !/^[a-f0-9]+$/i.test(value)) throw new Error('Invalid ciphertext');
  const bytes = Uint8Array.from(value.match(/../g), x => parseInt(x, 16));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(id) }, await importKey(secret), bytes.slice(12)));
}
