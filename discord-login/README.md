# Discord website login

This Worker implements Discord OAuth authorization-code login using the `identify`
scope, a state cookie, and server-side sessions. It does not link users to license
keys, establish buyer status, or assign Discord roles. Those need a separate
verified account-linking flow. Never treat a username or claimed Discord ID as
proof of a purchase.

Configure `https://login.zesthub.win/callback` as an OAuth redirect for the
Discord application. Store `DISCORD_CLIENT_SECRET` as a Cloudflare Worker secret;
do not put it in this repository or share it in chat. The Worker will return 503
until configured. The bot token is a different credential and must not be used as
the OAuth client secret.

Apply `schema.sql` to the D1 database, then deploy the Worker with `wrangler`.
The main site must also be published with its updated HTML and JavaScript. Test
login, cancellation, logout, invalid state and an unrelated origin. Sessions last
seven days; their opaque tokens are hashed at rest and Discord OAuth access tokens
are not stored. Expired session rows should be cleaned up periodically.

Run `node --test discord-login/worker.test.mjs` from the website root.
