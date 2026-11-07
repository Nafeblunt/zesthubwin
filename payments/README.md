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
Discord identity. They are not connected to a public endpoint or PayPal and have
only been tested with a local database and mocked PayPal responses.

Still required before accepting payments:

- Associate an authenticated Discord session with a server-created purchase and
  PayPal order, using PayPal's supported Orders API or a verified hosted-button
  integration. A regular PayPal REST app and sandbox credentials may be needed;
  the hosted button's public identifier is not an API client secret.
- Implement capture confirmation and recovery through server-side PayPal APIs
  and verified webhooks; make capture and fulfillment idempotent. Reconcile
  timeouts and duplicates, handle refunds/reversals, and log no secrets or keys.
- Connect the transactional license creation primitive to authenticated routes
  and make the key available only to the Discord account that initiated the order.
- Test sandbox success, cancel, pending, duplicate, mismatch, refund and service
  failure paths end to end, then complete PayPal account setup before enabling
  live checkout. Existing public DLL copies remain outside this protection.

Run `node --test payments/*.test.mjs` from the website project root.
