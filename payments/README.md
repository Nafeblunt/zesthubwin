# PayPal purchase integration (in development)

The intended product is a USD 15.00 lifetime license, delivered to the buyer's
signed-in Discord account on the website. Checkout is deliberately not enabled.
The provided PayPal hosted-button snippet alone does not establish a verified
mapping between a PayPal payment and the website's Discord account.

`paypal-client.mjs` prepares server-side Orders API calls against PayPal's
sandbox only. `verification.mjs` is an isolated validation component, not a payment endpoint.
It accepts only an order fetched by the server from PayPal's authenticated API,
and checks the order ID, merchant, purchase reference, amount, currency and
completed capture. Never feed it a browser-provided order as proof of payment.
`checkout.mjs` and `fulfillment.mjs` provide server-side order and transactional,
idempotent license creation primitives for a purchase already tied to a verified
Discord identity. `routes.mjs` is wired to the Discord login Worker behind the
disabled `PAYMENTS_SANDBOX_ENABLED` flag. It uses a separate sandbox database;
test licenses cannot unlock the live loader. `sandbox.html` and `sandbox.js` are
a local-only test page. The entire flow has only been tested with local databases
and mocked PayPal responses; it is not yet validated with PayPal sandbox.

Still required before accepting payments:

- Configure the sandbox REST application secret privately as the Worker secret
  `PAYPAL_SANDBOX_CLIENT_SECRET`, then enable and test the sandbox flow. The
  hosted button's public identifier is not an API client secret.
- Implement capture confirmation and recovery through server-side PayPal APIs
  and verified webhooks; make capture and fulfillment idempotent. Reconcile
  timeouts and duplicates, handle refunds/reversals, and log no secrets or keys.
- Verify the sandbox account ID matches PayPal's reported merchant ID and that
  account-owned purchase history works after a browser restart or lost response.
- Test sandbox success, cancel, pending, duplicate, mismatch, refund and service
  failure paths end to end, then complete PayPal account setup before enabling
  live checkout. Existing public DLL copies remain outside this protection.

Run `node --test payments/*.test.mjs` from the website project root.
