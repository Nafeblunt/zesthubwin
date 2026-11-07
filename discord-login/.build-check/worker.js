var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../payments/verification.mjs
var LIFETIME_LICENSE = Object.freeze({ currency: "USD", amount: "15.00", durationSeconds: 253402300799 });
function verifyCompletedOrder(order, expected) {
  if (!expected || typeof expected.orderId !== "string" || typeof expected.merchantId !== "string" || !expected.merchantId || typeof expected.purchaseId !== "string" || !expected.purchaseId)
    throw new Error("Expected order, merchant and purchase are required");
  if (!order || order.id !== expected.orderId || order.status !== "COMPLETED" || order.intent !== "CAPTURE" || !Array.isArray(order.purchase_units) || order.purchase_units.length !== 1)
    throw new Error("Order is not a completed matching purchase");
  const unit = order.purchase_units[0];
  if (unit.custom_id !== expected.purchaseId || unit.payee?.merchant_id !== expected.merchantId || unit.amount?.currency_code !== LIFETIME_LICENSE.currency || unit.amount?.value !== LIFETIME_LICENSE.amount)
    throw new Error("Order details do not match the expected product");
  const captures = unit.payments?.captures;
  if (!Array.isArray(captures) || captures.length !== 1) throw new Error("Expected one capture");
  const capture = captures[0];
  if (capture.status !== "COMPLETED" || typeof capture.id !== "string" || !/^[A-Z0-9]{5,40}$/.test(capture.id) || capture.amount?.currency_code !== LIFETIME_LICENSE.currency || capture.amount?.value !== LIFETIME_LICENSE.amount)
    throw new Error("Capture is not a completed matching payment");
  return { orderId: order.id, captureId: capture.id, purchaseId: expected.purchaseId };
}
__name(verifyCompletedOrder, "verifyCompletedOrder");

// ../private-admin/key-vault.mjs
var encoder = new TextEncoder();
function decodeHex(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || "")) throw new Error("Key vault not configured");
  return Uint8Array.from(value.match(/../g), (x) => parseInt(x, 16));
}
__name(decodeHex, "decodeHex");
async function importKey(secret) {
  return crypto.subtle.importKey("raw", decodeHex(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(importKey, "importKey");
async function sealKey(secret, id, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(id) }, await importKey(secret), encoder.encode(key)));
  return Array.from(new Uint8Array([...iv, ...encrypted]), (b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sealKey, "sealKey");
async function openKey(secret, id, value) {
  if (typeof value !== "string" || value.length < 58 || value.length % 2 || !/^[a-f0-9]+$/i.test(value)) throw new Error("Invalid ciphertext");
  const bytes = Uint8Array.from(value.match(/../g), (x) => parseInt(x, 16));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(id) }, await importKey(secret), bytes.slice(12)));
}
__name(openKey, "openKey");

// ../payments/fulfillment.mjs
var hex = /* @__PURE__ */ __name((bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join(""), "hex");
var randomHex = /* @__PURE__ */ __name((n) => hex(crypto.getRandomValues(new Uint8Array(n))), "randomHex");
var digest = /* @__PURE__ */ __name(async (key) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))), "digest");
async function fulfillVerifiedPurchase(db, secret, { purchaseId, discordId, merchantId, order }) {
  if (!/^[a-f0-9]{24}$/.test(purchaseId || "") || !/^\d{15,22}$/.test(discordId || ""))
    throw new Error("Invalid purchase or Discord identity");
  const purchase = await db.prepare("SELECT * FROM paypal_purchases WHERE id=? AND discord_id=?").bind(purchaseId, discordId).first();
  if (!purchase || !purchase.paypal_order_id) throw new Error("Purchase not found");
  const verified = verifyCompletedOrder(order, { orderId: purchase.paypal_order_id, merchantId, purchaseId });
  if (purchase.status === "fulfilled" && purchase.capture_id !== verified.captureId)
    throw new Error("Capture mismatch");
  if (purchase.status !== "fulfilled") {
    const licenseId = randomHex(12), key = "ZEST-" + randomHex(24).toUpperCase();
    const cipher = await sealKey(secret, licenseId, key);
    const keyHash = await digest(key);
    await db.batch([
      db.prepare(`INSERT INTO licenses (id,key_hash,key_ciphertext,created_at,duration_seconds)
        SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM paypal_purchases WHERE id=? AND discord_id=? AND status='created' AND paypal_order_id=?)`).bind(
        licenseId,
        keyHash,
        cipher,
        Math.floor(Date.now() / 1e3),
        LIFETIME_LICENSE.durationSeconds,
        purchaseId,
        discordId,
        verified.orderId
      ),
      db.prepare(`UPDATE paypal_purchases SET status='fulfilled', capture_id=?, license_id=?
        WHERE id=? AND discord_id=? AND status='created' AND paypal_order_id=?`).bind(verified.captureId, licenseId, purchaseId, discordId, verified.orderId)
    ]);
  }
  const done = await db.prepare(`SELECT p.capture_id, l.id, l.key_ciphertext FROM paypal_purchases p
    JOIN licenses l ON l.id=p.license_id WHERE p.id=? AND p.discord_id=? AND p.status='fulfilled'`).bind(purchaseId, discordId).first();
  if (!done || done.capture_id !== verified.captureId) throw new Error("Fulfillment could not be confirmed");
  return { licenseId: done.id, key: await openKey(secret, done.id, done.key_ciphertext) };
}
__name(fulfillVerifiedPurchase, "fulfillVerifiedPurchase");

// ../payments/checkout.mjs
var validDiscord = /* @__PURE__ */ __name((id) => typeof id === "string" && /^\d{15,22}$/.test(id), "validDiscord");
var validPurchase = /* @__PURE__ */ __name((id) => typeof id === "string" && /^[a-f0-9]{24}$/.test(id), "validPurchase");
var validOrder = /* @__PURE__ */ __name((id) => typeof id === "string" && /^[A-Z0-9]{8,40}$/.test(id), "validOrder");
async function createCheckout(db, paypal, { purchaseId, discordId }) {
  if (!validPurchase(purchaseId) || !validDiscord(discordId)) throw new Error("Invalid purchase");
  await db.prepare(`INSERT OR IGNORE INTO paypal_purchases (id,discord_id,status,created_at)
    VALUES (?,?,'created',?)`).bind(purchaseId, discordId, Math.floor(Date.now() / 1e3)).run();
  const row = await db.prepare("SELECT * FROM paypal_purchases WHERE id=? AND discord_id=?").bind(purchaseId, discordId).first();
  if (!row || row.status !== "created") throw new Error("Purchase not available");
  if (row.paypal_order_id) return { purchaseId, orderId: row.paypal_order_id };
  const created = await paypal.createOrder(purchaseId);
  if (!validOrder(created?.id)) throw new Error("Invalid PayPal order response");
  const linked = await db.prepare(`UPDATE paypal_purchases SET paypal_order_id=?
    WHERE id=? AND discord_id=? AND status='created' AND paypal_order_id IS NULL RETURNING paypal_order_id`).bind(created.id, purchaseId, discordId).first();
  if (!linked) {
    const existing = await db.prepare("SELECT paypal_order_id FROM paypal_purchases WHERE id=? AND discord_id=?").bind(purchaseId, discordId).first();
    if (existing?.paypal_order_id !== created.id) throw new Error("Order link conflict");
  }
  return { purchaseId, orderId: created.id };
}
__name(createCheckout, "createCheckout");
async function completeCheckout(db, paypal, secret, merchantId, { purchaseId, discordId }) {
  if (!validPurchase(purchaseId) || !validDiscord(discordId)) throw new Error("Invalid purchase");
  const row = await db.prepare("SELECT * FROM paypal_purchases WHERE id=? AND discord_id=?").bind(purchaseId, discordId).first();
  if (!row || !validOrder(row.paypal_order_id)) throw new Error("Purchase not found");
  if (row.status !== "fulfilled") {
    try {
      await paypal.captureOrder(row.paypal_order_id, purchaseId);
    } catch {
    }
  }
  const order = await paypal.getOrder(row.paypal_order_id);
  return fulfillVerifiedPurchase(db, secret, { purchaseId, discordId, merchantId, order });
}
__name(completeCheckout, "completeCheckout");

// ../payments/routes.mjs
var SITE = "https://zesthub.win";
var randomId = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""), "randomId");
var reply = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": SITE,
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin"
} }), "reply");
async function readSmallBody(request, limit) {
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } finally {
    reader.releaseLock();
  }
}
__name(readSmallBody, "readSmallBody");
async function handleSandboxPayment(request, discordId, { db, paypal, vaultSecret, merchantId, limiter }) {
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== SITE || !["GET", "POST"].includes(request.method)) return reply({ error: "Forbidden" }, 403);
  if (!/^\d{15,22}$/.test(discordId || "")) return reply({ error: "Sign in with Discord first." }, 401);
  if (!db || !paypal || !vaultSecret || !merchantId || !limiter) return reply({ error: "Sandbox checkout is not configured." }, 503);
  try {
    if (!(await limiter.limit({ key: discordId })).success) return reply({ error: "Too many requests. Try again later." }, 429);
    if (url.pathname === "/sandbox/payments/config" && request.method === "GET") {
      return reply({ clientId: paypal.clientId, environment: "sandbox" });
    }
    if (url.pathname === "/sandbox/payments/history" && request.method === "GET") {
      const result = await db.prepare(`SELECT p.id,p.created_at,l.id AS license_id,l.key_ciphertext FROM paypal_purchases p
        JOIN licenses l ON l.id=p.license_id WHERE p.discord_id=? AND p.status='fulfilled' ORDER BY p.created_at DESC LIMIT 100`).bind(discordId).all();
      const purchases = await Promise.all(result.results.map(async (row) => ({
        purchaseId: row.id,
        createdAt: row.created_at,
        licenseId: row.license_id,
        key: await openKey(vaultSecret, row.license_id, row.key_ciphertext)
      })));
      return reply({ purchases });
    }
    if (url.pathname === "/sandbox/payments/create" && request.method === "POST") {
      const purchaseId = randomId();
      const purchase = await createCheckout(db, paypal, { purchaseId, discordId });
      return reply(purchase);
    }
    if (url.pathname === "/sandbox/payments/capture" && request.method === "POST") {
      const body = await readSmallBody(request, 1024);
      const { purchaseId } = JSON.parse(body);
      if (!/^[a-f0-9]{24}$/.test(purchaseId || "")) return reply({ error: "Invalid purchase." }, 400);
      const result = await completeCheckout(db, paypal, vaultSecret, merchantId, { purchaseId, discordId });
      return reply({ key: result.key, licenseId: result.licenseId });
    }
    return reply({ error: "Not found." }, 404);
  } catch {
    return reply({ error: "Sandbox payment could not be completed. Please contact the owner." }, 503);
  }
}
__name(handleSandboxPayment, "handleSandboxPayment");

// ../payments/paypal-client.mjs
var ORIGIN = "https://api-m.sandbox.paypal.com";
var CALLBACK = "https://zesthub.win/";
var safeId = /* @__PURE__ */ __name((value) => typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value), "safeId");
async function requestKey(prefix, purchaseId) {
  const digest2 = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(purchaseId)));
  return prefix + Array.from(digest2.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
}
__name(requestKey, "requestKey");
var PayPalSandbox = class {
  static {
    __name(this, "PayPalSandbox");
  }
  constructor({ clientId, clientSecret, merchantId, transport = fetch }) {
    if (!clientId || !clientSecret || !merchantId) throw new Error("PayPal sandbox credentials are required");
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.merchantId = merchantId;
    this.transport = transport;
  }
  async accessToken() {
    const credentials = btoa(`${this.clientId}:${this.clientSecret}`);
    const response = await this.transport(`${ORIGIN}/v1/oauth2/token`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    if (!response.ok) throw new Error("PayPal sandbox authentication failed");
    const result = await response.json();
    if (typeof result.access_token !== "string" || !result.access_token) throw new Error("Invalid PayPal token response");
    return result.access_token;
  }
  async request(path, { method = "GET", requestId, body } = {}) {
    const token = await this.accessToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== void 0) headers["Content-Type"] = "application/json";
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    const response = await this.transport(`${ORIGIN}${path}`, {
      method,
      headers,
      redirect: "manual",
      ...body === void 0 ? {} : { body: JSON.stringify(body) }
    });
    if (!response.ok) {
      const error = new Error("PayPal sandbox request failed");
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  async createOrder(purchaseId) {
    if (!safeId(purchaseId)) throw new Error("Invalid purchase ID");
    return this.request("/v2/checkout/orders", { method: "POST", requestId: await requestKey("o-", purchaseId), body: {
      intent: "CAPTURE",
      purchase_units: [{
        custom_id: purchaseId,
        payee: { merchant_id: this.merchantId },
        amount: { currency_code: LIFETIME_LICENSE.currency, value: LIFETIME_LICENSE.amount }
      }],
      payment_source: { paypal: { experience_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: CALLBACK,
        cancel_url: CALLBACK
      } } }
    } });
  }
  async captureOrder(orderId, purchaseId) {
    if (!safeId(orderId) || !safeId(purchaseId)) throw new Error("Invalid order or purchase ID");
    return this.request(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: "POST", requestId: await requestKey("c-", purchaseId), body: {} }
    );
  }
  async getOrder(orderId) {
    if (!safeId(orderId)) throw new Error("Invalid order ID");
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }
};

// worker.mjs
var SITE2 = "https://zesthub.win";
var REDIRECT = "https://login.zesthub.win/callback";
var SESSION = "__Host-zest_session";
var STATE = "__Host-zest_oauth_state";
var TIMEOUT = 7 * 86400;
var random = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join(""), "random");
var sha = /* @__PURE__ */ __name(async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (n) => n.toString(16).padStart(2, "0")).join(""), "sha");
var cookie = /* @__PURE__ */ __name((name, value, age) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`, "cookie");
function cookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "").split(";").map((x) => x.trim().split(/=(.*)/s).slice(0, 2)).filter((x) => x.length === 2));
}
__name(cookies, "cookies");
function redirect(url, values = []) {
  const headers = new Headers({ Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  for (const value of values) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}
__name(redirect, "redirect");
function json(request, value, status = 200, values = []) {
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json", "Vary": "Origin", "X-Content-Type-Options": "nosniff" });
  if (request.headers.get("Origin") === SITE2) {
    headers.set("Access-Control-Allow-Origin", SITE2);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  for (const value2 of values) headers.append("Set-Cookie", value2);
  return new Response(JSON.stringify(value), { status, headers });
}
__name(json, "json");
async function hasBuyerAccess(discordId, env) {
  if (!env.DISCORD_BOT_TOKEN || !/^\d{15,22}$/.test(env.DISCORD_GUILD_ID || "") || !/^\d{15,22}$/.test(env.DISCORD_BUYER_ROLE_ID || "")) throw new Error("Role check is not configured");
  const base = `https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}`;
  const options = { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, redirect: "manual" };
  const [member, roles, guild] = await Promise.all([
    fetch(`${base}/members/${discordId}`, options),
    fetch(`${base}/roles`, options),
    fetch(base, options)
  ]);
  if (member.status === 404) return false;
  if (!member.ok || !roles.ok || !guild.ok) throw new Error("Discord role lookup failed");
  const [memberData, roleData, guildData] = await Promise.all([member.json(), roles.json(), guild.json()]);
  if (guildData.owner_id === discordId) return true;
  if (!Array.isArray(roleData) || !Array.isArray(memberData.roles)) throw new Error("Invalid Discord role data");
  const buyer = roleData.find((role) => role.id === env.DISCORD_BUYER_ROLE_ID);
  if (!buyer || !Number.isInteger(buyer.position) || !/^\d+$/.test(buyer.id)) throw new Error("Buyer role not found");
  return roleData.some((role) => memberData.roles.includes(role.id) && Number.isInteger(role.position) && /^\d+$/.test(role.id) && (role.position > buyer.position || role.position === buyer.position && BigInt(role.id) <= BigInt(buyer.id)));
}
__name(hasBuyerAccess, "hasBuyerAccess");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.DB || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json(request, { error: "Login is not configured." }, 503);
    let stage = "request";
    try {
      if (url.pathname.startsWith("/sandbox/payments/")) {
        if (env.PAYMENTS_SANDBOX_ENABLED !== "true" || !env.SANDBOX_DB || !env.PAYPAL_SANDBOX_CLIENT_ID || !env.PAYPAL_SANDBOX_CLIENT_SECRET || !env.PAYPAL_SANDBOX_MERCHANT_ID || !env.SANDBOX_VAULT_SECRET || !env.SANDBOX_LIMIT)
          return json(request, { error: "Sandbox checkout is not configured." }, 503);
        if (request.headers.get("Origin") !== SITE2) return json(request, { error: "Forbidden" }, 403);
        const token = cookies(request)[SESSION];
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return json(request, { error: "Sign in with Discord first." }, 401);
        const session = await env.DB.prepare("SELECT discord_id FROM website_sessions WHERE session_hash=? AND expires_at>?").bind(await sha(token), Math.floor(Date.now() / 1e3)).first();
        if (!session) return json(request, { error: "Sign in with Discord first." }, 401);
        const paypal = new PayPalSandbox({
          clientId: env.PAYPAL_SANDBOX_CLIENT_ID,
          clientSecret: env.PAYPAL_SANDBOX_CLIENT_SECRET,
          merchantId: env.PAYPAL_SANDBOX_MERCHANT_ID
        });
        return handleSandboxPayment(request, session.discord_id, {
          db: env.SANDBOX_DB,
          paypal,
          vaultSecret: env.SANDBOX_VAULT_SECRET,
          merchantId: env.PAYPAL_SANDBOX_MERCHANT_ID,
          limiter: env.SANDBOX_LIMIT
        });
      }
      if (url.pathname === "/start" && request.method === "GET") {
        const state = random();
        const authorization = new URL("https://discord.com/oauth2/authorize");
        authorization.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: "identify", state });
        return redirect(authorization.toString(), [cookie(STATE, state, 600)]);
      }
      if (url.pathname === "/callback" && request.method === "GET") {
        const state = url.searchParams.get("state"), expected = cookies(request)[STATE];
        const clear = cookie(STATE, "", 0);
        if (!state || !expected || !/^[a-f0-9]{64}$/.test(state) || state !== expected || !url.searchParams.get("code")) {
          console.log("Discord login rejected: invalid state or code");
          return redirect(`${SITE2}/?login=failed`, [clear]);
        }
        stage = "discord-token";
        const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code: url.searchParams.get("code"),
            redirect_uri: REDIRECT
          })
        });
        if (!tokenResponse.ok) {
          console.log("Discord login rejected at token exchange; HTTP status", tokenResponse.status);
          return redirect(`${SITE2}/?login=failed`, [clear]);
        }
        const token = await tokenResponse.json();
        if (typeof token.access_token !== "string" || token.token_type?.toLowerCase() !== "bearer") {
          console.log("Discord login rejected: invalid token response");
          return redirect(`${SITE2}/?login=failed`, [clear]);
        }
        stage = "discord-identity";
        const identity = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` }, redirect: "manual" });
        if (!identity.ok) {
          console.log("Discord login rejected at identity lookup; HTTP status", identity.status);
          return redirect(`${SITE2}/?login=failed`, [clear]);
        }
        const user = await identity.json();
        if (!/^\d{15,22}$/.test(user.id) || typeof user.username !== "string" || user.username.length > 100) {
          console.log("Discord login rejected: invalid identity response");
          return redirect(`${SITE2}/?login=failed`, [clear]);
        }
        const session = random(), now = Math.floor(Date.now() / 1e3);
        stage = "session-store";
        await env.DB.prepare("INSERT INTO website_sessions (session_hash,discord_id,username,expires_at) VALUES (?,?,?,?)").bind(await sha(session), user.id, user.global_name || user.username, now + TIMEOUT).run();
        return redirect(SITE2 + "/", [clear, cookie(SESSION, session, TIMEOUT)]);
      }
      if (url.pathname === "/me" && request.method === "GET") {
        if (request.headers.get("Origin") !== SITE2) return json(request, { error: "Forbidden" }, 403);
        const token = cookies(request)[SESSION];
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return json(request, { user: null, buyer: false });
        const row = await env.DB.prepare("SELECT discord_id,username FROM website_sessions WHERE session_hash=? AND expires_at>?").bind(await sha(token), Math.floor(Date.now() / 1e3)).first();
        if (!row) return json(request, { user: null, buyer: false });
        const buyer = await hasBuyerAccess(row.discord_id, env);
        return json(request, { user: { id: row.discord_id, name: row.username }, buyer });
      }
      if (url.pathname === "/logout" && request.method === "POST") {
        if (request.headers.get("Origin") !== SITE2) return json(request, { error: "Forbidden" }, 403);
        const token = cookies(request)[SESSION];
        if (token && /^[a-f0-9]{64}$/.test(token)) await env.DB.prepare("DELETE FROM website_sessions WHERE session_hash=?").bind(await sha(token)).run();
        return json(request, { ok: true }, 200, [cookie(SESSION, "", 0)]);
      }
      return json(request, { error: "Not found" }, 404);
    } catch (error) {
      console.error("Discord login failed at", stage, "error type:", error?.name || "Error");
      if (url.pathname === "/callback") return redirect(`${SITE2}/?login=failed`, [cookie(STATE, "", 0)]);
      return json(request, { error: "Login temporarily unavailable." }, 503);
    }
  }
};
export {
  worker_default as default,
  hasBuyerAccess
};
//# sourceMappingURL=worker.js.map
