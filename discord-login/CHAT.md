# Chat and Shoutbox

The home page and Forum share the Shoutbox (`/shoutbox`). Visitors can read, but
only members with Dev or the configured Zest Owner role can post. Its composer is
hidden until the server confirms that permission. Role checks use all assigned
roles, not just the highest displayed role. Set `DISCORD_DEV_ROLE_ID` to pin the
Dev role to an ID; when unset, the server checks the guild's exact `Dev` role name
(case insensitive). Zest Owner uses `DISCORD_OWNER_ROLE_ID`.

The separate `/Chat` page uses `/chat`. Every signed-in Discord account can post
there, and visitors can read. The two rooms have separate histories; existing
`chat_messages` rows remain in the Shoutbox. New community messages are stored in
`public_chat_messages`. There are no file uploads.

Names and avatar URLs come from the server, never from a submitted author field.
Messages are limited to 280 characters and
use the existing community rate limiter (10 writes per minute, shared with posts).
The browser refreshes every five seconds while the page is visible.

Dev and Zest Owner can click a message author's name for moderation actions.
The menu opens by the name and supports 10-minute, 1-hour and 24-hour mutes,
unmuting, and removing that single message. Staff rights are rechecked against
Discord for every action. Ordinary members cannot use these endpoints:

- `DELETE /chat/:messageId` (or `/shoutbox/:messageId`) removes one message.
- `POST /chat/:messageId/mute` with `{ "duration": 3600 }` mutes that author.
- `DELETE /chat/:messageId/mute` unmutes that author.

Mutes apply to posting in both Chat and Shoutbox and expire automatically. They
do not delete existing messages or affect forum posts. Self-muting is blocked.
Apply the updated `chat-schema.sql` before deployment; it adds `chat_mutes`
without removing messages. Responses include current mute times so the client
can disable posting and show an Unmute action when appropriate.

Both endpoints reject blocked language (including common separator/leet/Unicode
variants), Discord invite ads, non-HTTPS links, common URL shorteners, IP/local
links, embedded URL credentials and executable/script download links. The rules
live in `chat-filter.mjs`. Rejected messages stay in the composer for editing.
This is a basic text filter: it does not understand all abusive context or check
HTTPS websites against a malware reputation service. Update the rules as needed.

Before publishing the updated website, apply the idempotent schema to the existing login
database, then deploy the updated login Worker:

```powershell
cd discord-login
npx wrangler d1 execute zesthub-licenses --remote --file=chat-schema.sql
npx wrangler deploy
```

Publish the website assets including `Chat/index.html`, `chat.js`, `.assetsignore`
and the updated `_headers` file. All four pages load `shell.js` for the same
navigation, avatar button and account dialog. `script.js` fetches the session
once per page and shares it with Chat and Forum through `zest:session`.
All page CSPs allow Discord avatars.

Run the login and chat checks from the website root:

```powershell
node --test discord-login/*.test.mjs
```

## Deployment troubleshooting

If `/chat` or `/shoutbox` returns `404 {"error":"Not found"}`, the login Worker
is older than the website. Apply the schema and deploy the Worker as shown above;
publishing only the website does not update that service.

The website sends `Cache-Control: no-transform` so Cloudflare does not inject its
inline JavaScript Detections snippet, which conflicts with `script-src 'self'`.
This leaves JavaScript Detection results missing for these pages; it does not
change zone-wide WAF settings. If you later require JavaScript Detections, use
fresh per-response CSP nonces as described in the
[Cloudflare documentation](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/).
Do not add `unsafe-inline` or hardcode a shared nonce to silence the warning.
