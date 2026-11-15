# Account licence redemption

The account dialog has Account and Licence tabs. A signed-in user can redeem a
production key from `licenses`; the field shows `ZEST-XXXXXXXXXXXXXX` until a key
is entered. After redemption, it shows the key, status, original duration,
activation date and expiry. Lifetime licences show Lifetime / Never.

`GET /account/license` returns only the current Discord account's most recently
redeemed licence. `POST /account/license` accepts `{ "key": "ZEST-..." }` and
requires the existing session, website Origin and rate limiter. Keys use the
existing format: `ZEST-` plus 48 hexadecimal characters. Browser-supplied account
IDs are ignored. A licence can belong to only one Discord account.

Redemption also saves the name from the authenticated Discord session as
`website_account_licenses.discord_username`. The admin lists this name, the
stable `discord_id`, and `redeemed_at` separately from the loader `username`.
Names remain available after logout; the Discord ID is the ownership identifier.
Repeat redemption by the same account refreshes its saved name without changing
ownership or extending the licence. No key or encrypted key is included in the
admin listing API.

For installations with the original account table, apply
`migration-license-discord.sql` once before deploying either Worker. It adds the
name column and backfills existing redemptions from the latest stored session
for the same Discord ID. Records without a session still display their linked
Discord ID. Fresh installations use `account-license-schema.sql` instead.

Redeeming an unused key starts its timer. Already-activated keys keep their
activation and expiry. Redemption does not bind or reset the loader username or
device, grant Discord roles, or alter existing payment processing. Invalid,
expired, revoked and device-banned keys cannot be redeemed. Status is read from
the licence record each time the tab opens. Keys redeemed earlier remain owned
if another licence is subsequently redeemed.

`website_account_licenses` stores the ownership link and a separately encrypted
copy of the submitted key. AES-GCM associated data binds that copy to the
Discord account and licence ID. The new `ACCOUNT_VAULT_SECRET` must be a random
32-byte hexadecimal Worker secret. Keep it stable after the first redemption;
replacing it makes stored account copies unreadable. It is separate from the
admin `KEY_VAULT_SECRET` and sandbox `SANDBOX_VAULT_SECRET`; do not replace either
existing secret. No keys or vault secrets are stored in browser local storage.

Before publishing:

```powershell
npx wrangler d1 execute zesthub-licenses --remote --config discord-login/wrangler.toml --file discord-login/account-license-schema.sql
npx wrangler secret put ACCOUNT_VAULT_SECRET --config discord-login/wrangler.toml
npx wrangler deploy --config discord-login/wrangler.toml --keep-vars
```

Supply a newly generated secret through stdin or the secret prompt only when
initially configuring the feature. Then publish `index.html`, `script.js` and
`style.css`. Existing unlinked keys must be entered once; ownership is never
inferred from matching Discord and loader usernames.

Run `node --test` from the repository root. Browser verification uses synthetic
licences in an in-memory database so it does not consume customers' live keys.
