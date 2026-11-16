(() => {
  const dialog = document.getElementById('buy-dialog');
  const buyButton = document.getElementById('buy-btn');
  if (!dialog || !buyButton) return;
  const api = 'https://login.zesthub.win/payments';
  const pendingKey = 'zest:purchase-pending';
  const loginButton = document.getElementById('buy-login');
  const retryButton = document.getElementById('buy-retry');
  const container = document.getElementById('paypal-button');
  const status = document.getElementById('buy-status');
  let user = null;
  let purchaseId = null;
  let busy = false;
  let rendered = false;
  let keyNode = null;
  try { purchaseId = sessionStorage.getItem(pendingKey); } catch { /* storage unavailable */ }

  function remember(id) {
    purchaseId = id;
    try { if (id) sessionStorage.setItem(pendingKey, id); else sessionStorage.removeItem(pendingKey); } catch { /* storage unavailable */ }
    retryButton.hidden = !id;
  }
  function say(text) { status.textContent = text; }
  async function call(path, options = {}) {
    const response = await fetch(api + path, { credentials: 'include', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Checkout request failed');
    return data;
  }
  function showKey(key) {
    keyNode?.remove();
    keyNode = document.createElement('p');
    keyNode.className = 'buy-key';
    keyNode.textContent = key;
    status.after(keyNode);
  }

  async function deliver() {
    if (!purchaseId || busy) return;
    busy = true;
    retryButton.disabled = true;
    say('Confirming your payment and creating your key');
    try {
      const result = await call('/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchaseId }) });
      remember(null);
      say('Paid. Your key is saved to your account under Licence.');
      showKey(result.key);
      window.dispatchEvent(new CustomEvent('zest:purchased'));
    } catch (error) {
      say(`${error.message} If you approved the payment, use Retry delivery.`);
    } finally { busy = false; retryButton.disabled = false; }
  }

  async function loadPayPal(clientId) {
    if (window.paypal) return;
    const script = document.createElement('script');
    const url = new URL('https://www.paypal.com/sdk/js');
    url.search = new URLSearchParams({ 'client-id': clientId, currency: 'USD', intent: 'capture', 'disable-funding': 'credit' });
    script.src = url.toString();
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load PayPal'));
      document.head.append(script);
    });
  }

  async function open() {
    keyNode?.remove();
    loginButton.hidden = Boolean(user);
    container.hidden = true;
    retryButton.hidden = !purchaseId;
    if (!user) { say('Log in with Discord so the key can be delivered to your account.'); return; }
    if (rendered) {
      container.hidden = false;
      say(purchaseId ? 'A previous payment is pending. Retry delivery before paying again.' : '');
      return;
    }
    say('Loading checkout');
    try {
      const config = await call('/config');
      await loadPayPal(config.clientId);
      await window.paypal.Buttons({
        style: { layout: 'vertical', color: 'black', shape: 'rect', label: 'pay', height: 45 },
        createOrder: async () => {
          if (purchaseId) throw new Error('Retry delivery for your pending payment first.');
          const result = await call('/create', { method: 'POST' });
          remember(result.purchaseId);
          return result.orderId;
        },
        onApprove: deliver,
        onCancel: () => { remember(null); say('Payment cancelled.'); },
        onError: () => { say(purchaseId ? 'Checkout failed. If you approved the payment, use Retry delivery.' : 'Checkout failed. Please try again.'); }
      }).render(container);
      rendered = true;
      container.hidden = false;
      say(purchaseId ? 'A previous payment is pending. Retry delivery before paying again.' : '');
    } catch (error) { say(error.message || 'Checkout is unavailable right now.'); }
  }

  buyButton.addEventListener('click', () => { dialog.showModal(); open(); });
  document.getElementById('buy-close').addEventListener('click', () => dialog.close());
  retryButton.addEventListener('click', deliver);
  loginButton.addEventListener('click', () => document.getElementById('login-btn')?.click());
  window.addEventListener('zest:session', event => {
    user = event.detail?.user || null;
    if (dialog.open) open();
  });
})();
