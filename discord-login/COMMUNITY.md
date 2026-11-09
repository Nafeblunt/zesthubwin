# Community pages

The forum accepts text posts from Discord-signed-in users. The market accepts
text listings only from members who currently have the configured
`DISCORD_OWNER_ROLE_ID`; the check is repeated against Discord for every write.
Authors and the owner role can delete posts. The community API uses the same
origin check and hashed website sessions as Discord login, and a separate
rate-limit binding for writes. Bodies are rendered as text, not HTML.

Apply `community-schema.sql` to the intended D1 database before deploying the
worker. Deploy the website assets as well as the worker. The market does not
currently accept payments or host config uploads/downloads.

Run `node --test discord-login/*.test.mjs payments/*.test.mjs` from the website
root. Do not treat the local PayPal live transport as a working live checkout.
