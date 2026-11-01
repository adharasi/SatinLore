# Private simulator on Cloudflare

This adapter hosts the existing browser reader at `https://app.satinlore.com` for the founder only. It does not deploy FastAPI, move SQLite, connect real devices, or use the marketing website's database, email credentials or routes. Hardware qualification is not required for this private simulator. The separate local `/device-check` and its invitation flow continue to run through Python on loopback.

## What is published

`npm run build:worker` copies only the reader files listed in `assets.mjs` to the ignored `dist/private-app` directory. It adds a hosted-access marker to the copied HTML and removes the local device-check link. The source HTML remains unchanged. Neither device-check/bridge files nor Lovense modules, source instructions, databases, environment files or story content are bundled. The Worker refuses unknown paths and exposes no story-upload or feedback endpoint.

The existing reader still processes text locally. New stories remain session-only until the explicit **Save on this browser** choice. Saved stories belong to this browser and this origin; localhost stories are not transferred to the hosted app. No story cloud backup is introduced.

Every request, including HTML, JavaScript, CSS, health and access probes, passes through the Worker before assets are served. It validates an RS256 Cloudflare Access application assertion against the configured team signing keys, dedicated application audience, expiry and exact founder email. Missing/invalid configuration fails closed. Plain email headers are not authentication. The Worker accepts only the canonical HTTPS origin, rejects device/invitation/vendor routes, and marks all responses `no-store` with the reader's restrictive content policy.

## One-time setup in your own browser

Use your normal Windows browser and the Cloudflare account that already owns `satinlore.com`. This is a separate Worker connected to **`adharasi/SatinLore`**, not the marketing website project. Once connected, future pushes to `main` build and deploy automatically. No local terminal or Cloudflare credentials shared with a coding assistant are needed for this dashboard workflow.

### 1. Protect the app hostname first

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/) and select the account containing `satinlore.com`.
2. Open **Zero Trust → Access controls → Applications**. Some dashboard versions label this **Access → Applications**.
3. Choose **Create new application** / **Add an application**, then **Self-hosted and private** / **Self-hosted**. Name it **SatinLore private reader** and set the session duration to **1 hour**.
4. Add a public hostname: subdomain **`app`**, domain **`satinlore.com`**, with the path **empty**. This must cover the entire `app.satinlore.com` hostname, including the reader, `/static/*` and `/api/*`.
5. Create a new Allow policy named **SatinLore app founder**. Under **Include**, choose **Emails** and enter only **`team@satinlore.com`**. Keep this separate from editing the existing admin application/policies. Do not add an Everyone, Bypass or public-path rule.
6. Under login methods, enable the existing **One-time PIN** method used for admin. Save/create the application.
7. Open the new application's **Configure → Additional settings** and copy its **Application Audience (AUD) Tag** into a temporary private note. This is an application identifier, not a password. Use this new app's AUD, not the marketing admin AUD.
8. In Zero Trust **Settings → Team name and domain**, copy the actual team domain. Dashboard versions may place this under **Custom pages → Team name and domain**. It ends in `.cloudflareaccess.com`. Copy only the hostname, without `https://`, paths or a trailing slash. Do not change the team name.

### 2. Connect the app repository to a new Worker

9. Return to **Workers & Pages → Create application → Import a repository** and select GitHub. Choose **`adharasi/SatinLore`**.
10. If the repository is missing, open the Cloudflare GitHub App's repository-access settings and include **SatinLore**. Keep the existing **satinlore-website** access selected so its deployment connection continues working.
11. Use these exact build settings:

    | Setting | Value |
    | --- | --- |
    | Worker/project name | `satinlore-private-app` |
    | Repository | `adharasi/SatinLore` |
    | Production branch | `main` |
    | Root directory | Repository root; leave the default/blank value, or `/` |
    | Build command | `npm run build:worker` |
    | Deploy command | `npx wrangler deploy` |
    | Node.js | 24, selected by the repository's `.node-version` |

    Use Cloudflare's normal dependency installation from the committed package lock. The tracked Wrangler configuration already defines the Worker, static assets and custom domain.
12. Select **Save and Deploy**. Allow the build to finish. An initial **503 / “The private preview is not available”** after logging in is expected until the runtime settings below are saved: the Worker deliberately serves no reader assets without them.
13. Open **satinlore-private-app → Settings → Build → Branch control** (some versions use **Builds**). Confirm `main` is the production branch and turn **Enable Preview Builds OFF**. This is separate from disabling version preview URLs in source.

### 3. Save the app's runtime settings

14. Open **satinlore-private-app → Settings → Variables & Secrets → Add**. These are **runtime** variables, not Build variables. Add all three as **Text / Plaintext**:

    | Variable | Value |
    | --- | --- |
    | `ACCESS_TEAM_DOMAIN` | The actual `<team-name>.cloudflareaccess.com` hostname copied in step 8 |
    | `ACCESS_AUD` | The new private-reader application's complete AUD tag from step 7 |
    | `PRIVATE_APP_ENABLED` | `true` |

15. Choose **Save and Deploy** / **Deploy** for these settings. If the interface saves variables first and offers a separate deployment action, complete that action. The repository already supplies `PUBLIC_APP_ORIGIN=https://app.satinlore.com` and `FOUNDER_EMAIL=team@satinlore.com`.
16. In **Settings → Domains & Routes**, confirm **`app.satinlore.com`** is attached as a **Custom Domain** and its certificate is active. The repository's custom-domain route asks Wrangler to create this automatically. If the build succeeded but the domain is missing, select **Add → Custom Domain**, enter `app.satinlore.com`, and complete the displayed DNS/certificate confirmation. Review only a conflicting `app` record if one is reported; do not change apex, `www`, Google mail, SES or marketing routes. Confirm **workers.dev** and **Preview URLs** are disabled.

The canonical hostname is **`app.satinlore.com`**. A `www.app.satinlore.com` alias is not configured by this release.

### 4. Verify login and the reader

17. In a new private/incognito session, open `https://app.satinlore.com`. It should ask you to sign in through Cloudflare Access. Do the next check before entering the PIN.
18. While still logged out, visit `https://app.satinlore.com/static/app.mjs` and `https://app.satinlore.com/api/access`. Both must require Access login or deny access; neither should reveal reader code or access data before login.
19. Return to `https://app.satinlore.com`, sign in with `team@satinlore.com` and the emailed PIN, then paste neutral sample text. Connect the simulator, confirm Start, try strength −/+, Pause and Stop. Choose **Save on this browser**, reload and confirm the story returns **paused**. Check Light/Dark and phone layout. The hosted app remains simulator-only.
20. Open `https://app.satinlore.com/api/health` while signed in. Expect `status: "ok"`, `device_mode: "simulator"`, `beta_ready: false`. This endpoint reports availability, not physical-device qualification.
21. Report whether the Worker build, Access login and reader checks passed, plus the exact error text if anything failed. Do not share PINs, cookies, assertion tokens or private story text.

### What later GitHub changes do

The connected production branch automatically runs the build and deploy commands after a push. `keep_vars: true` preserves dashboard-managed plaintext variables. The three Access/enable keys are deliberately absent from tracked `vars`, so a code update cannot overwrite them with empty/default values. The founder email, canonical origin, disabled public preview URLs and authenticate-before-assets routing stay controlled by source.

To pause access, change the runtime **`PRIVATE_APP_ENABLED`** to **`false`** and deploy that settings change. Later code pushes preserve this pause until you explicitly set it back to `true`.

This workflow does not require SES, the questionnaire webhook secret, D1, Google Apps Script or the marketing CRM credentials. Those belong to the separate website Worker.

### If something fails

| Symptom | Check |
| --- | --- |
| Build says the Worker name differs | Use `satinlore-private-app` exactly in the new Worker project |
| Build or deploy command not found | Confirm repository root, committed package installation and Node 24 |
| 503 after Access login | All three runtime variables must exist on the deployed production Worker, including the exact string `true` |
| 403 after Access login | Check the new app's AUD, actual team hostname without `https://`, and founder email; do not disable Access or JWT validation |
| Login works but static files are blocked | Access must cover the whole hostname; use the same dedicated application for `/`, `/static/*` and `/api/*` |
| DNS/certificate still pending | Check this Worker's Custom Domain status and the displayed `app` record conflict; retain unrelated DNS records |
| Cloudflare build succeeded but the app still differs | Check the production deployment's commit matches the latest `main`, rather than a Preview/version URL |

### Optional local-terminal deployment

For a developer deploying from a local checkout, set up Python with `bootstrap.py`, install Node.js 24, then run `npm ci --ignore-scripts`, `python3 scripts/check.py`, `npm run build:worker` and `npm exec wrangler deploy -- --dry-run`. Windows uses `py scripts/check.py`. Authenticate privately with `npm exec wrangler login`, then `npm run deploy:worker`. The same three runtime settings must still be saved on the Worker; dry-run is not remote provisioning.

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

`PRIVATE_APP_ENABLED=false` is an operational pause: save and deploy that runtime setting to deny new requests and fail subsequent reader probes. It is not a remote browser-storage deletion mechanism. To revoke an existing Access session, use the dedicated Access application's controls. To roll back, deploy a known previous Worker version; no database migration or story-data restore is involved.

## Why this adapter rather than a Python port

Cloudflare currently supports FastAPI through its Python ASGI entrypoint and supports D1 from Python. That could host a future minimal session/feedback service, but the current SQLite store, local-origin restrictions, invitation transactions and device integration would need a separate, tested port. The existing simulator reader needs none of those services, so this release keeps the Python local boundary intact and adds only the authenticated static host.

Official references:

- [Workers static assets and binding](https://developers.cloudflare.com/workers/static-assets/)
- [Run a Worker before every asset request](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Keep dashboard runtime variables across deployment](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)
- [Workers Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Configure build commands](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Disable Preview builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Validate Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [FastAPI on Python Workers](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/)
- [Query D1 from Python Workers](https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers/)
