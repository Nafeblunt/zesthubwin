// Call only with order details obtained directly from PayPal's authenticated API.
// This module does not accept a browser's claim that payment succeeded.
export const LIFETIME_LICENSE = Object.freeze({ currency: 'USD', amount: '15.00', durationSeconds: 253402300799 });

export function verifyCompletedOrder(order, expected) {
  if (!expected || typeof expected.orderId !== 'string' || typeof expected.merchantId !== 'string' ||
      !expected.merchantId || typeof expected.purchaseId !== 'string' || !expected.purchaseId)
    throw new Error('Expected order, merchant and purchase are required');
  if (!order || order.id !== expected.orderId || order.status !== 'COMPLETED' || order.intent !== 'CAPTURE' ||
      !Array.isArray(order.purchase_units) || order.purchase_units.length !== 1)
    throw new Error('Order is not a completed matching purchase');
  const unit = order.purchase_units[0];
  if (unit.custom_id !== expected.purchaseId || unit.payee?.merchant_id !== expected.merchantId ||
      unit.amount?.currency_code !== LIFETIME_LICENSE.currency || unit.amount?.value !== LIFETIME_LICENSE.amount)
    throw new Error('Order details do not match the expected product');
  const captures = unit.payments?.captures;
  if (!Array.isArray(captures) || captures.length !== 1) throw new Error('Expected one capture');
  const capture = captures[0];
  if (capture.status !== 'COMPLETED' || typeof capture.id !== 'string' || !/^[A-Z0-9]{5,40}$/.test(capture.id) ||
      capture.amount?.currency_code !== LIFETIME_LICENSE.currency || capture.amount?.value !== LIFETIME_LICENSE.amount)
    throw new Error('Capture is not a completed matching payment');
  return { orderId: order.id, captureId: capture.id, purchaseId: expected.purchaseId };
}
