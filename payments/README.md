# PayPal purchase integration (in development)

The intended product is a USD 15.00 lifetime license, delivered to the buyer's
signed-in Discord account on the website. Sandbox checkout is enabled in an
isolated database; live checkout and the main Buy button are not enabled.
The provided PayPal hosted-button snippet alone does not establish a verified
mapping between a PayPal payment and the website's Discord account.

`paypal-client.mjs` provides separate server-side sandbox and live PayPal
transports. Only the sandbox is connected to a public route; the live transport
must remain disconnected until the remaining production requirements are met.
`verification.mjs` is an isolated validation component, not a payment endpoint.
It accepts only an order fetched by the server from PayPal's authenticated API,
and checks the order ID, merchant, purchase reference, amount, currency and
completed capture. Never feed it a browser-provided order as proof of payment.
`checkout.mjs` and `fulfillment.mjs` provide server-side order and transactional,
idempotent license creation for a purchase tied to a verified Discord identity.
`routes.mjs` is wired to the Discord login Worker with a separate sandbox database;
test licenses cannot unlock the live loader. `sandbox.html` and `sandbox.js` are
the test page. A sandbox full-refund webhook was delivered and its matching
license was confirmed revoked. This is not a full audit of failure and recovery.

`webhook.mjs` and `webhook-processor.mjs` are connected to the sandbox webhook
and scheduled worker; they are not connected to live checkout. Verified events
are recorded without payer details, and completed-capture processing rechecks
the order directly with PayPal. `buyer-role.mjs` is not wired into checkout.
Reversals and Discord-role retry/removal are not yet tested end-to-end.

Still required before accepting payments:

- Obtain and verify live credentials from the intended PayPal Business account;
  keep them in Worker secrets. The sandbox and hosted-button credentials are not
  live REST credentials, and must not be placed in source control.
- Connect, secure and test verified webhooks and a durable retry processor;
  reconcile timeouts and duplicates, handle refunds/reversals, and avoid logging
  secrets, session credentials or license keys.
- Connect and test Buyer-role grants and retries. A paid buyer who is not in the
  Discord server must retain access to their key and be able to retry role sync.
- Verify the sandbox account ID matches PayPal's reported merchant ID and that
  account-owned purchase history works after a browser restart or lost response.
- Test sandbox success, cancel, pending, duplicate, mismatch, refund and service
  failure paths end to end, then complete PayPal account setup before enabling
  live checkout. Existing public DLL copies remain outside this protection.
- Resolve the production license-vault configuration without overwriting the
  current key-encryption secret; keep encrypted key recovery available to both
  the buyer and the private admin dashboard.

Run `node --test payments/*.test.mjs` from the website project root.
