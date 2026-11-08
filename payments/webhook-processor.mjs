import { verifyCompletedOrder } from './verification.mjs';
import { fulfillVerifiedPurchase } from './fulfillment.mjs';

// Process only metadata previously verified by PayPal and stored durably.
// This function is not wired to a production webhook or scheduler yet.
export async function processCompletedEvent(db, paypal, vaultSecret, merchantId, eventId) {
  const event = await db.prepare('SELECT * FROM paypal_webhook_events WHERE event_id=?').bind(eventId).first();
  if (!event) throw new Error('Webhook event not found');
  if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') throw new Error('Unsupported event type');
  if (event.processed_at) return { alreadyProcessed: true };
  if (!event.order_id || !event.capture_id) throw new Error('Event requires reconciliation');
  const purchase = await db.prepare('SELECT id,discord_id,paypal_order_id FROM paypal_purchases WHERE paypal_order_id=?')
    .bind(event.order_id).first();
  if (!purchase) throw new Error('Purchase requires reconciliation');
  const order = await paypal.getOrder(purchase.paypal_order_id);
  const verified = verifyCompletedOrder(order, { orderId: purchase.paypal_order_id, purchaseId: purchase.id, merchantId });
  if (verified.captureId !== event.capture_id) throw new Error('Webhook capture mismatch');
  await fulfillVerifiedPurchase(db, vaultSecret, { purchaseId: purchase.id, discordId: purchase.discord_id, merchantId, order });
  await db.prepare('UPDATE paypal_webhook_events SET processed_at=? WHERE event_id=? AND processed_at IS NULL')
    .bind(Math.floor(Date.now()/1000), eventId).run();
  return { alreadyProcessed: false };
}

function refundCaptureId(refund) {
  const link = refund.links?.find(item => item.rel === 'up' && item.method === 'GET');
  if (!link) throw new Error('Refund requires reconciliation');
  const url = new URL(link.href);
  if (url.protocol !== 'https:' || !['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash) throw new Error('Invalid refund link');
  const match = /^\/v2\/payments\/captures\/([A-Z0-9]{8,40})$/.exec(url.pathname);
  if (!match) throw new Error('Invalid refund link');
  return match[1];
}

// Sandbox-only until verified with actual PayPal refund and reversal events.
// Only full refunds or verified reversal events revoke the linked license.
export async function processReversalEvent(db, paypal, eventId) {
  const event = await db.prepare('SELECT * FROM paypal_webhook_events WHERE event_id=?').bind(eventId).first();
  if (!event || !['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED'].includes(event.event_type))
    throw new Error('Unsupported event');
  if (event.processed_at) return { alreadyProcessed: true };
  let captureId = event.capture_id;
  if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    const refund = await paypal.getRefund(event.resource_id);
    if (refund.id !== event.resource_id || refund.status !== 'COMPLETED') throw new Error('Refund not confirmed');
    captureId = refundCaptureId(refund);
    if (event.capture_id && event.capture_id !== captureId) throw new Error('Refund capture mismatch');
    const capture = await paypal.getCapture(captureId);
    if (capture.id !== captureId || capture.amount?.currency_code !== 'USD' || capture.amount?.value !== '15.00')
      throw new Error('Capture requires reconciliation');
    if (capture.status === 'PARTIALLY_REFUNDED') {
      await db.prepare('UPDATE paypal_webhook_events SET processed_at=? WHERE event_id=? AND processed_at IS NULL')
        .bind(Math.floor(Date.now()/1000), eventId).run();
      return { partialRefund: true };
    }
    if (capture.status !== 'REFUNDED') throw new Error('Full refund not confirmed');
  }
  if (!captureId || !/^[A-Z0-9]{8,40}$/.test(captureId)) throw new Error('Capture requires reconciliation');
  const purchase = await db.prepare(`SELECT license_id FROM paypal_purchases WHERE capture_id=? AND status='fulfilled'`)
    .bind(captureId).first();
  if (!purchase?.license_id) throw new Error('Purchase requires reconciliation');
  await db.batch([
    db.prepare('UPDATE licenses SET revoked=1 WHERE id=?').bind(purchase.license_id),
    db.prepare('UPDATE paypal_webhook_events SET processed_at=? WHERE event_id=? AND processed_at IS NULL')
      .bind(Math.floor(Date.now()/1000), eventId)
  ]);
  return { revoked: true };
}
