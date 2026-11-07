# Private DLL upload

This is a separate Cloudflare Worker for the owner to replace `ZestHub.dll` in
the private R2 bucket used by the loader's download Worker. The public website
does not contain the DLL or an upload password. Nothing has been deployed yet.

The admin Worker requires a valid Cloudflare Access application JWT signed by
your Cloudflare team, with the configured audience and exact owner email. Missing
settings or an invalid token deny access. The upload accepts one file up to 64 MiB
and overwrites `ZestHub.dll`; only upload a DLL you trust. The Worker does not
inspect whether the uploaded file is a valid DLL.

## Setup

1. Your domain must be managed/proxied by the Cloudflare account used for the
   Workers. In R2, create the private `zesthub-private` bucket (or change the
   bucket name in both Workers' Wrangler configs). Keep public bucket access off.
2. In Cloudflare Zero Trust, create a self-hosted Access application for a
   dedicated hostname such as `admin.zesthub.win`, covering all paths. Add an
   allow policy for **only your own email address** and configure a suitable
   login method and MFA. Do not protect the separate KeyAuth download endpoint
   with this owner-only Access application.
3. Copy the Access team domain and the application's audience tag from Zero Trust.
   Configure Worker variables `ACCESS_TEAM_DOMAIN` (for example,
   `https://your-team.cloudflareaccess.com`), `ACCESS_AUD`, and `OWNER_EMAIL`.
   These are configuration values, not the Cloudflare API token. Never put API
   tokens or passwords in this repository.
4. Add the admin hostname as a Worker custom domain in Cloudflare, or configure
   an equivalent Worker route, after connecting the domain to Cloudflare. Keep
   `workers_dev = false` and configure Access before making the route reachable.
5. Run `npm install` and `npx wrangler deploy` from this directory using your own
   authenticated Wrangler session. Deployment needs your Cloudflare account and
   has not been performed from this workspace.
6. Visit the admin hostname, sign in through Cloudflare Access, and test an upload.
   In a private browser session verify that other identities cannot open the page
   or upload. Confirm that public R2 URLs and alternate Worker routes are disabled.
7. Deploy and test the separate KeyAuth download Worker in the loader project.
   Authorized users will receive the DLL through that Worker; your upload page
   is owner-only. Removing public GitHub assets cannot revoke copies already made.

Run `npm test` for local access-denial tests and `npx wrangler deploy --dry-run`
to check bundling. A dry run does not verify your Access policy, R2 privacy, or
the actual deployed route. Confirm those settings and a successful owner login
before relying on this setup.
