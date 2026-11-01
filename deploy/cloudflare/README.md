# Private simulator on Cloudflare

This adapter hosts the existing browser reader at `https://app.satinlore.com` for the founder only. It does not deploy FastAPI, move SQLite, connect real devices, or use the marketing website's database, email credentials or routes. Hardware qualification is not required for this private simulator. The separate local `/device-check` and its invitation flow continue to run through Python on loopback.

## What is published

`npm run build:worker` copies only the reader files listed in `assets.mjs` to the ignored `dist/private-app` directory. It adds a hosted-access marker to the copied HTML and removes the local device-check link. The source HTML remains unchanged. Neither device-check/bridge files nor Lovense modules, source instructions, databases, environment files or story content are bundled. The Worker refuses unknown paths and exposes no story-upload or feedback endpoint.

The existing reader still processes text locally. New stories remain session-only until the explicit **Save on this browser** choice. Saved stories belong to this browser and this origin; localhost stories are not transferred to the hosted app. No story cloud backup is introduced.

Every request, including HTML, JavaScript, CSS, health and access probes, passes through the Worker before assets are served. It validates an RS256 Cloudflare Access application assertion against the configured team signing keys, dedicated application audience, expiry and exact founder email. Missing/invalid configuration fails closed. Plain email headers are not authentication. The Worker accepts only the canonical HTTPS origin, rejects device/invitation/vendor routes, and marks all responses `no-store` with the reader's restrictive content policy.

## Provision in this order

1. Sign in to the Cloudflare account that owns `satinlore.com`. The deployment requires that account's Worker deployment and custom-domain permissions. Do not paste passwords, API tokens, login codes or private links into source or chat.
2. In **Zero Trust → Access → Applications**, create a separate **Self-hosted** application, such as **SatinLore private reader**, covering the entire `app.satinlore.com` hostname. Protect the hostname root and every path, including `/static/*` and `/api/*`. Do not limit it to an admin path.
3. Add an **Allow** policy for the single approved founder email (`team@satinlore.com`), using the existing One-time PIN login method if appropriate. Do not add Everyone, Bypass or a public path exception. Set a deliberate session duration, for example one hour for this founder preview.
4. Copy this new application's **Application Audience (AUD)** into `wrangler.jsonc` at `vars.ACCESS_AUD`. Keep it separate from the marketing CRM's Access audience. The committed empty value deliberately makes an unconfigured Worker return 503. AUD is configuration, not an API secret.
5. Confirm the following source settings before publication. Read the team hostname from the current account rather than assuming the marketing configuration default is correct:

   | Setting | Required value |
   | --- | --- |
   | Worker name | `satinlore-private-app` |
   | Custom domain | `app.satinlore.com` only |
   | `PUBLIC_APP_ORIGIN` | `https://app.satinlore.com` exactly, no trailing slash |
   | `ACCESS_TEAM_DOMAIN` | The actual team hostname shown by this account's Access application; verify and replace the source default if it differs |
   | `ACCESS_AUD` | The dedicated private-reader application's AUD |
   | `FOUNDER_EMAIL` | The exact approved founder email |
   | `PRIVATE_APP_ENABLED` | `true` for the private preview; `false` to pause access |
   | `workers_dev` / `preview_urls` | Both `false` |
   | `assets.run_worker_first` | `true`, covering every asset |

6. Run the repository's common checks and build the isolated bundle:

   ```sh
   npm ci
   python3 scripts/check.py
   npm run build:worker
   npm exec wrangler deploy -- --dry-run
   ```

   On Windows, use `py scripts/check.py`. These checks need the existing Python setup from `bootstrap.py`. Dry-run output confirms a bundle can be built; it is not a remote deployment or proof that Access is configured.
7. Authenticate Wrangler privately in your own terminal (`npm exec wrangler login`), then run `npm run deploy:worker`. The custom-domain entry attaches `app.satinlore.com`; review any existing record conflict deliberately. Do not change apex, `www`, `launch`, Google mail, SES, waitlist or CRM settings. If browser-only account access is available, prepare the same source and use Cloudflare's Git integration rather than inventing a credential or deploying through the unrelated marketing Worker.
8. If enabling Git builds, connect **`adharasi/SatinLore`**, production branch `main`, repository root, Node.js 24. Build with `npm run build:worker`; deploy with `npm exec wrangler deploy`. The dedicated AUD and non-secret settings stay in this repository's `wrangler.jsonc`. Leave non-production branch builds and version previews disabled; this preview has no alternate public address. The marketing `satinlore-website` build is a separate project.

The publisher must verify the Access application and returned deployment state before claiming the preview is live. No Cloudflare account change or deployment is performed merely by this adapter or a local build.

## HTTP contract and session behaviour

- Authenticated `GET /api/access` returns only `{ "authenticated": true, "expiresAt": 1234567890000 }`; `expiresAt` is the verified JWT expiry in Unix **milliseconds**. No email, user ID, token or cookie is returned.
- Missing, malformed, expired or disallowed assertions return 403 with a generic error. Missing/invalid/paused configuration returns 503. The reader must pause and block Start on a probe failure or expiry, and never resume automatically after reauthentication.
- Authenticated `GET /api/health` returns `{ "status": "ok", "device_mode": "simulator", "beta_ready": false }`. Availability does not mean a hardware beta is ready.
- Only `GET` and `HEAD` are accepted. Unknown and real-device routes return 404 after authentication. There is no invitation, vendor-token, account-data or feedback API in this adapter.
- Reauthenticating uses Cloudflare Access. Access revocation prevents subsequent requests; it does not remotely erase a document already loaded in the browser or saved locally. The reader's periodic, visibility and expiry checks pause its simulator. Local story deletion remains a separate explicit browser operation.

## Verify the deployed boundary

Use neutral fixture text and an inbox you control. Check these separately from mocked tests:

1. A logged-out visit to `/`, `/static/app.mjs` and `/api/access` reaches the Access login or denial, with no reader/asset data.
2. The approved founder can sign in and load the reader, both themes, imports, corrections and paused restoration. TXT import must not create a story-text network request.
3. Another account is denied. A forged email header or missing assertion cannot obtain assets. Confirm there is no reachable `workers.dev`, version URL or other hostname bypass.
4. `/device-check`, its `/static/` aliases, the bridge, Lovense module and `/api/lovense/session` are unavailable. No vendor request or real-device connection is made from the hosted reader.
5. Expiry, sign-out/revocation, failed probes, hidden-page return and offline errors block Start and leave output paused. Logging in again must not automatically start playback. Check that unsaved text is not silently persisted or uploaded.
6. Inspect network requests while reading a neutral story. No text, title, excerpts, private tokens, third-party analytics or vendor scripts may leave the reader.

`PRIVATE_APP_ENABLED=false` is an operational pause: deploy that configuration to deny new requests and fail subsequent reader probes. It is not a remote browser-storage deletion mechanism. To revoke an existing Access session, use the dedicated Access application's controls. To roll back, deploy a known previous Worker version; no database migration or story-data restore is involved.

## Why this adapter rather than a Python port

Cloudflare currently supports FastAPI through its Python ASGI entrypoint and supports D1 from Python. That could host a future minimal session/feedback service, but the current SQLite store, local-origin restrictions, invitation transactions and device integration would need a separate, tested port. The existing simulator reader needs none of those services, so this release keeps the Python local boundary intact and adds only the authenticated static host.

Official references:

- [Workers static assets and binding](https://developers.cloudflare.com/workers/static-assets/)
- [Run a Worker before every asset request](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Validate Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [FastAPI on Python Workers](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/)
- [Query D1 from Python Workers](https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers/)
