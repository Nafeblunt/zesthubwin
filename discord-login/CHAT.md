# Community shoutbox

The home page and Forum share a public shoutbox. Visitors can read; sending
requires the existing Discord session. Names and avatar URLs come from the server,
never from a submitted author field. Messages are limited to 280 characters and
use the existing community rate limiter (10 writes per minute, shared with posts).
The browser refreshes every five seconds while the page is visible.

Before publishing the updated website, apply the new table to the existing login
database, then deploy the updated login Worker:

```powershell
cd discord-login
npx wrangler d1 execute zesthub-licenses --remote --file=chat-schema.sql
npx wrangler deploy
```

Publish the website assets including `chat.js` and the updated `_headers` file.
The Forum CSP must allow `https://cdn.discordapp.com` for avatars.

Run the login and chat checks from the website root:

```powershell
node --test discord-login/*.test.mjs
```
