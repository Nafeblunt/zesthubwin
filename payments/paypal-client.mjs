import { LIFETIME_LICENSE } from './verification.mjs';

// Sandbox only. Live credentials and endpoints must not be used until the whole
// checkout, reconciliation and fulfillment flow has been tested end to end.
const ORIGIN = 'https://api-m.sandbox.paypal.com';
const CALLBACK = 'https://zesthub.win/';
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
async function requestKey(prefix, purchaseId) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(purchaseId)));
  return prefix + Array.from(digest.slice(0, 16), x => x.toString(16).padStart(2, '0')).join('');
}

export class PayPalSandbox {
  constructor({ clientId, clientSecret, merchantId, transport = (...args) => fetch(...args) }) {
    if (!clientId || !clientSecret || !merchantId) throw new Error('PayPal sandbox credentials are required');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.merchantId = merchantId;
    this.transport = transport;
  }

  async accessToken() {
    const credentials = btoa(`${this.clientId}:${this.clientSecret}`);
    const response = await this.transport(`${ORIGIN}/v1/oauth2/token`, {
      method: 'POST', redirect: 'manual', headers: { Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials'
    });
    if (!response.ok) {
      const error = new Error('PayPal sandbox authentication failed');
      error.kind = 'paypal_auth'; error.status = response.status;
      throw error;
    }
    const result = await response.json();
    if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('Invalid PayPal token response');
    return result.access_token;
  }

  async request(path, { method = 'GET', requestId, body } = {}) {
    const token = await this.accessToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const response = await this.transport(`${ORIGIN}${path}`, { method, headers, redirect: 'manual',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) {
      const error = new Error('PayPal sandbox request failed');
      error.kind = 'paypal_request'; error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async createOrder(purchaseId) {
    if (!safeId(purchaseId)) throw new Error('Invalid purchase ID');
    return this.request('/v2/checkout/orders', { method: 'POST', requestId: await requestKey('o-', purchaseId), body: {
      intent: 'CAPTURE', purchase_units: [{ custom_id: purchaseId,
        payee: { merchant_id: this.merchantId },
        amount: { currency_code: LIFETIME_LICENSE.currency, value: LIFETIME_LICENSE.amount } }],
      payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW', return_url: CALLBACK, cancel_url: CALLBACK } } }
    } });
  }

  async captureOrder(orderId, purchaseId) {
    if (!safeId(orderId) || !safeId(purchaseId)) throw new Error('Invalid order or purchase ID');
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: 'POST', requestId: await requestKey('c-', purchaseId), body: {} });
  }

  async getOrder(orderId) {
    if (!safeId(orderId)) throw new Error('Invalid order ID');
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }
}
