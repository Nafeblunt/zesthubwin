# Private DLL upload

## License dashboard

The owner dashboard can create up to 100 high-entropy license keys at a time, display them once,
and list licenses. A key becomes active on its first successful sign-in; its
duration starts then. Hour, day, week, 30-day month, 365-day year, and lifetime
durations are supported. Lifetime uses an expiry of 9999-12-31 and can still be
revoked. First use binds the license to the entered username and
device ID. The owner can reset that binding, ban or unban the bound device, or
revoke a license. Unban a banned device before resetting it so it remains
manageable from the dashboard. License keys are stored as SHA-256 hashes.

The download Worker validates license, username, device, expiry, revocation,
and device bans using D1 before returning the private R2 object. The loader uses
username and license key, and stores them in Windows Credential Manager for
automatic sign-in. Existing KeyAuth accounts and licenses do not migrate.
The current device identifier is the Windows account SID: it is not a hardware
fingerprint, can change, and can be spoofed by a user controlling the client.
Authorized users can capture and redistribute the DLL they receive. Rate limits
are approximate, per Cloudflare location, and are not an account lockout.

The admin Worker and download Worker are deployed. `npm test` exercises the
license decisions locally. `node live-smoke.mjs` creates a temporary license,
tests a download and second-device rejection, then deletes that test license.
The owner's real admin login, generation and management controls still need
to be checked through the browser. The old public GitHub release remains a
separate public distribution path until the owner removes it.

This is a separate Cloudflare Worker for the owner to replace `ZestHub.dll` in
the private R2 bucket used by the loader's download Worker. The public website
does not contain the DLL or an upload password.

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
   authenticated Wrangler session. Deployments use your Cloudflare account.
6. Visit the admin hostname, sign in through Cloudflare Access, and test an upload.
   In a private browser session verify that other identities cannot open the page
   or upload. Confirm that public R2 URLs and alternate Worker routes are disabled.
7. Deploy and test the separate license download Worker using `license-wrangler.toml`.
   Authorized users will receive the DLL through that Worker; your upload page
   is owner-only. Removing public GitHub assets cannot revoke copies already made.

Run `npm test` for local access-denial tests and `npx wrangler deploy --dry-run`
to check bundling. A dry run does not verify your Access policy, R2 privacy, or
the actual deployed route. Confirm those settings and a successful owner login
before relying on this setup.
