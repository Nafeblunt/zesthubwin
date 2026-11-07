const API = 'https://login.zesthub.win/sandbox/payments';
const pendingKey = 'zesthub-sandbox-pending';
const status = document.getElementById('status');
const retry = document.getElementById('retry');
const history = document.getElementById('history');
let purchaseId = sessionStorage.getItem(pendingKey);
retry.hidden = !purchaseId;

async function call(path, options = {}) {
  const response = await fetch(API + path, { credentials: 'include', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Sandbox request failed');
  return result;
}
async function loadHistory() {
  const data = await call('/history');
  history.replaceChildren();
  for (const purchase of data.purchases) {
    const item = document.createElement('li');
    item.textContent = purchase.key;
    history.append(item);
  }
}
async function deliver() {
  if (!purchaseId) return;
  status.textContent = 'Checking the test payment and creating your test key…';
  try {
    const result = await call('/capture', { method: 'POST', body: JSON.stringify({ purchaseId }) });
    status.textContent = `Sandbox key: ${result.key}`;
    sessionStorage.removeItem(pendingKey);
    purchaseId = null;
    retry.hidden = true;
    await loadHistory();
  } catch (error) {
    status.textContent = `${error.message} If you approved payment, use Retry test delivery.`;
    retry.hidden = false;
  }
}
retry.addEventListener('click', deliver);

async function start() {
  try {
    const config = await call('/config');
    if (config.environment !== 'sandbox') throw new Error('Unexpected payment environment');
    await loadHistory();
    const script = document.createElement('script');
    const url = new URL('https://www.paypal.com/sdk/js');
    url.search = new URLSearchParams({ 'client-id': config.clientId, currency: 'USD', intent: 'capture' });
    script.src = url.toString();
    await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.append(script); });
    await paypal.Buttons({
      createOrder: async () => {
        if (purchaseId) throw new Error('Resolve the previous test purchase before starting another.');
        const result = await call('/create', { method: 'POST' });
        purchaseId = result.purchaseId;
        sessionStorage.setItem(pendingKey, purchaseId);
        retry.hidden = false;
        return result.orderId;
      },
      onApprove: deliver,
      onCancel: () => { sessionStorage.removeItem(pendingKey); purchaseId = null; retry.hidden = true; status.textContent = 'Test payment cancelled.'; },
      onError: () => { status.textContent = 'Test checkout failed. If you approved payment, use Retry test delivery.'; }
    }).render('#paypal-button');
    status.textContent = purchaseId ? 'A previous test purchase is pending. Retry delivery before starting another.' : 'Ready for a $15 sandbox test.';
  } catch (error) { status.textContent = error.message || 'Sandbox checkout unavailable.'; }
}
start();
