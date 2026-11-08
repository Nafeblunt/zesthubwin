const allowed = new Set(['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED']);
const identifier = value => typeof value === 'string' && /^[A-Z0-9-]{5,100}$/i.test(value);

// Verification is delegated to PayPal. A 2xx response is returned only after
// verified metadata is durably stored for later processing; no purchase is
// fulfilled from the webhook's untrusted body itself.
export async function receiveWebhook(request, { db, paypal, webhookId }) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!db || !paypal || !webhookId) return new Response('Unavailable', { status: 503 });
  const lengthHeader = request.headers.get('Content-Length');
  const stated = lengthHeader === null ? null : Number(lengthHeader);
  if ((stated !== null && (!Number.isSafeInteger(stated) || stated < 1 || stated > 262144)) || !request.body)
    return new Response('Invalid request', { status: 400 });
  try {
    const reader = request.body.getReader(); let size = 0; const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 262144) { await reader.cancel(); return new Response('Too large', { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!identifier(event?.id) || typeof event.event_type !== 'string') return new Response('Invalid event', { status: 400 });
    if (!await paypal.verifyWebhook(request.headers, event, webhookId)) return new Response('Forbidden', { status: 403 });
    if (!allowed.has(event.event_type)) return new Response(null, { status: 204 });
    const resourceId = event.resource?.id;
    if (!identifier(resourceId)) return new Response('Invalid event', { status: 400 });
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id || null;
    const captureId = event.event_type === 'PAYMENT.CAPTURE.REFUNDED'
      ? event.resource?.supplementary_data?.related_ids?.capture_id || null : event.resource?.id || null;
    if ((orderId && !identifier(orderId)) || (captureId && !identifier(captureId))) return new Response('Invalid event', { status: 400 });
    await db.prepare(`INSERT OR IGNORE INTO paypal_webhook_events (event_id,event_type,resource_id,order_id,capture_id,received_at)
      VALUES (?,?,?,?,?,?)`).bind(event.id, event.event_type, resourceId, orderId, captureId, Math.floor(Date.now()/1000)).run();
    const stored = await db.prepare('SELECT event_type,resource_id,order_id,capture_id FROM paypal_webhook_events WHERE event_id=?').bind(event.id).first();
    if (!stored || stored.event_type !== event.event_type || stored.resource_id !== resourceId || stored.order_id !== orderId || stored.capture_id !== captureId)
      return new Response('Event conflict', { status: 409 });
    return new Response(null, { status: 204 });
  } catch { return new Response('Unavailable', { status: 503 }); }
}
