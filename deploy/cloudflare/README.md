# Private reader and Lovense pairing on Cloudflare

For the public email sign-in rollout, use the [public reader activation checklist](public-reader.md). The private setup below remains the reference for the beta and founder routes.

This adapter hosts the browser reader at `https://app.satinlore.com`, protected by signed Cloudflare Access assertions and an explicit Worker email allowlist. Simulator rehearsals need no hardware or Lovense credentials. The guided real-toy path uses a separately sandboxed documented Standard Socket adapter with a Standard JS SDK fallback and requires the server settings below. Hardware behaviour remains unqualified until recorded on physical devices. This does not deploy FastAPI, move local SQLite or use the marketing website database, email credentials or routes. The separate local `/device-check` invitation flow remains on Python/loopback.

## Current account and beta-host refinement

For tomorrow's complete setup and testing, use [the 3 November runbook](../../docs/beta-session-2026-11-03.md). It supersedes the older account-backlog and blanket live-5/20 descriptions: durable account/preset storage and explicitly granted personal ranges are implemented in source, with current release results recorded separately.

The same Worker serves the exact app and beta origins. The tracked Custom Domain routes include `beta.satinlore.com`; Workers deployment provisions that route and the append-only v2 migration creates `ReaderAccount` (`READER_ACCOUNTS`) and `BetaRecordings` (`BETA_RECORDINGS`) alongside the existing feedback class. There is no new manual D1/R2 setup or storage secret. A successful source push is not proof that a custom domain, Access policy or migration has completed; check the deployment result.

The owner must extend the existing Access application to the whole beta hostname, including `/static`, `/api` and `/admin`, or create a separate whole-host beta application. With the same Access application, leave `BETA_ACCESS_AUD` absent and reuse `ACCESS_AUD`. With a separate application, save its exact audience as runtime text `BETA_ACCESS_AUD`; do not use an empty value. Keep the same team and preserve founder access. Testers need their email in both the relevant Access Allow policy and runtime `BETA_TESTER_EMAILS`. No Everyone/Bypass rule is needed.

Use one origin and controlling browser/tab at a time for a physical toy. Web Locks are origin- and browser-profile-specific: app and beta do not share a hardware-control lease. Stop, observe stopped output, disconnect and close the old reader before changing hosts/browsers; complete fresh checks after reconnecting. For the recorded tester session, stay on beta throughout. Account/preset sharing does not transfer an armed connection or personal-range permission.

Cloudflare email OTP authenticates the identity; an explicit 18+ choice creates the app account. Presets are durable and identity-isolated, use revision guards, and include account/story scope, per-action settings, selected active channels and a master maximum. Applying pauses and clamps to available capabilities/current range. Story text/title stay local. A story-specific preset references a local UUID and does not make imported text cloud-synced or automatically recognizable on another origin.

Only the exact beta host can start separately consented structured control recording. Founder-only `/admin` and `/api/admin/beta-recordings` provide review, while participants have only their own history/deletion. Normal app requests cannot enable beta capture. Limits are 60 minutes, 20,000 events and 4 MiB per recording, 30-day retention and a 128 MiB global budget. There is no DOM/screen video or story/preset-name/credential capture. Recording, account and browser-story data/deletion are separate.

The isolated documented Standard Socket adapter supports qualified Oscillate and action combinations; the Basic SDK fallback remains narrower. All nonzero commands stay finite at two seconds. Gentle/default range is at most 5/20, with explicit per-action personal permission up to 20/20 only after a checked test/Stop. Permission never raises a maximum, starts output or comes from a preset; it resets after interruption. Missing/invalid runtime Lovense settings are reported by value-free `/api/lovense/status` diagnostics. No extra Lovense enable flag is required. Retain the exact runtime names below and keep secret values private.

## What is published

`npm run build:worker` copies only the reader files listed in `assets.mjs` to the ignored `dist/private-app` directory. It adds a hosted-access marker to the copied HTML and removes the local device-check link. The source HTML remains unchanged. The hosted bridge is compiled into its own authenticated HTML document: opaque-origin iframes cannot authenticate module subrequests with Access cookies. Its inline bundle is authorized by a SHA-256 CSP hash, not a public asset exception or `unsafe-inline`. It includes only connection/control code, with the SDK fetched exclusively inside the opaque sandbox. Local invitation/device-check files, server source, databases, environment files, developer credentials and story data are excluded. The Worker refuses unknown paths and exposes no story-upload endpoint. The private `/support` page uses a separate SQLite Durable Object for feedback deliberately submitted by the signed-in user; feedback never includes automatic reader text or context.

The existing reader still processes text locally. New stories remain session-only until the explicit **Save on this browser** choice. Saved stories belong to this browser and this origin; localhost stories are not transferred to the hosted app. No story cloud backup is introduced.

Every request, including HTML, JavaScript, CSS, health and access probes, passes through the Worker before assets are served. It validates an RS256 Cloudflare Access application assertion against the configured team signing keys, dedicated application audience, expiry and the founder email or an explicitly configured tester email. Missing/invalid configuration fails closed. Plain email headers are not authentication. The Worker accepts only the canonical HTTPS origin, rejects local invitation/private-file routes, and marks all responses `no-store`. The reader permits only its own isolated connection frame and approved QR image hosts; third-party scripts/network calls remain confined to the bridge.

## One-time setup in your own browser

Use your normal Windows browser and the Cloudflare account that already owns `satinlore.com`. This is a separate Worker connected to **`adharasi/SatinLore`**, not the marketing website project. Once connected, future pushes to `main` build and deploy automatically. No local terminal or Cloudflare credentials shared with a coding assistant are needed for this dashboard workflow. The app provisions its feedback and v2 account/recording Durable Object bindings through tracked migrations; it does not use marketing D1 or SES resources.

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

The ordinary reader hostname is **`app.satinlore.com`** and the separately recorded beta hostname is **`beta.satinlore.com`**. A `www.app.satinlore.com` alias is not configured.

### 4. Verify login and the reader

17. Close existing incognito windows, then in a fresh private/incognito session, open `https://app.satinlore.com`. It should ask you to sign in through Cloudflare Access. Do the next check before entering the PIN.
18. While still logged out, visit `https://app.satinlore.com/static/app.mjs` and `https://app.satinlore.com/api/access`. Both must require Access login or deny access; neither should reveal reader code or access data before login.
19. Return to `https://app.satinlore.com`, sign in with `team@satinlore.com` and the emailed PIN, then paste neutral sample text. Connect the simulator, confirm Start, try strength −/+, Pause and Stop. Choose **Save on this browser**, reload and confirm the story returns **paused**. Check Light/Dark and phone layout. The simulator remains available without credentials; use the dedicated Lovense setup section below for physical pairing.
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

## Hosted services and migration

The `PRIVATE_FEEDBACK` binding points to the exported `PrivateFeedback` class. Its first append-only `v1` migration uses `new_sqlite_classes`; Wrangler provisions the namespace during deployment, with no hand-entered database ID or new runtime secret. The Worker verifies the existing Access assertion before routing every API call. Each store name is a one-way hash derived only from verified application audience and subject; identity is never selected from a request body or query.

Feedback has a 4 KB request bound, a 2 KB/2,000-character note limit, exact allowlisted fields, same-origin JSON writes and per-person limits of two new notes/minute, ten/hour, twenty/day and 100 retained notes. Repeating a request with the same idempotency key/payload returns the original saved record; a changed payload with the same key is rejected. Delete removes live feedback while preserving message-free short-lived request counts. Feedback expires after 30 days; security counts expire within 24 hours, with request/alarm cleanup. Provider recovery history may retain earlier copies for up to 30 further days after live deletion.

The support UI waits for actual server acknowledgements. Failed or ambiguous sends keep the draft/key for retry; fields are locked during a request. Export contains only that sign-in's feedback. Deletion has a native dialog and explicit confirmation; cancelling while authentication is pending cannot cause a delayed deletion. Neither action deletes browser stories, the marketing waitlist or a Cloudflare identity.

SQLite Durable Objects are supported on Workers Free. A Free-plan resource/quota error is reported as unavailable rather than as a successful send. Do not enable a paid subscription merely to complete this setup. If migration/deployment fails, inspect the Cloudflare build output before retrying; the prior production version remains the operational baseline.

## HTTP contract and session behaviour

- Authenticated `GET /api/access` returns only `{ "authenticated": true, "expiresAt": 1234567890000 }`; `expiresAt` is the verified JWT expiry in Unix **milliseconds**. No email, user ID, token or cookie is returned.
- Missing, malformed, expired or disallowed assertions return 403 with a generic error. Missing/invalid/paused configuration returns 503. The reader must pause and block Start on a probe failure or expiry, and never resume automatically after reauthentication.
- Authenticated `GET /api/health` returns `{ "status": "ok", "device_mode": "simulator", "beta_ready": false }`. Availability does not mean a hardware beta is ready.
- Reader assets and health/access probes accept `GET`/`HEAD`. The deliberate feedback routes below accept their specified methods. Unknown routes and local invitation routes remain unavailable. The deliberate Lovense endpoints below are the only hosted vendor credential path.
- Authenticated `GET /api/feedback` lists that sign-in's live notes. `POST /api/feedback` accepts only `{idempotencyKey,category,message,rating?}` and returns a real saved acknowledgement. No automatic story context or client identity field is accepted.
- Authenticated `GET /api/my-data` exports only app feedback. `POST /api/my-data/delete` requires exact JSON `{ "confirm": true }` and deletes the live feedback records. Writes require the exact app Origin and JSON content type; cookies, assertions, query values and identity are not forwarded into the store.
- `/help`, `/support` and `/simulator-lab` plus their assets are covered by the same signed Access and explicit email allowlist gate. The beta admin is additionally founder-only. Help shows the public source revision inserted by the Cloudflare build; the lab contains simulated devices and no private story input.
- Reauthenticating uses Cloudflare Access. Access revocation prevents subsequent requests; it does not remotely erase a document already loaded in the browser or saved locally. The reader's periodic, visibility and expiry checks pause its simulator. Local story deletion remains a separate explicit browser operation.

## Enable Nocturne for the private beta

1. Sign in to the [OpenAI API platform](https://platform.openai.com/). If you plan to use a subscription promotion, link the eligible subscription to the API organisation and verify the balance there. Create a dedicated SatinLore beta project under that organisation. Set an enforced project spend limit appropriate to your beta before using a key. [OpenAI credit eligibility and linking](https://developers.openai.com/api/docs/guides/chatgpt-api-credits) · [API spend limits](https://developers.openai.com/api/docs/guides/spend-limits)
2. In that project's **API keys**, create a project key with write access to **Responses**. Keep the key private. Cloudflare is the only place the deployed app needs it.
3. Go to **Cloudflare → Workers & Pages → satinlore-private-app → Settings → Variables & Secrets → Add**. Select **Secret**. Enter `OPENAI_API_KEY` as the name and paste your project key as the value. Select **Deploy** or **Save and Deploy**, depending on the dashboard. This is a runtime secret. The GitHub deploy creates `SCENE_ANALYSIS_BUDGET` through migration `v4`. [Cloudflare secret configuration](https://developers.cloudflare.com/workers/configuration/secrets/)
4. While signed in to the [private reader](https://app.satinlore.com/), open an original rehearsal story, then choose **Settings → Story model → Nocturne · Advanced beta**. For cue-only review choose **Analyse with Nocturne**. For contextual review, read the excerpt-processing notice, explicitly allow nearby excerpts for this story and choose **Enable nearby context review**. Check for reviewed-section coverage or a Loom fallback. The optional **Advanced → Adjust story sections** review shows any new rhythm label. Select **Loom** and compare the same section with the same simulator settings. This clears contextual consent and labels.
5. Check the test usage in the API project and note the number of applied sections, refusals or fallback messages. While signed in, `https://app.satinlore.com/api/scene-analysis` returns only `{"available":true}` or `{"available":false}`. This confirms Worker configuration. Use a rehearsal run to check API authorisation, billing and model access.

The Worker accepts signed, exact-origin requests from the admitted private reader audience. Its quota allows 12 attempts per reader per UTC day, 100 per deployment per UTC day and 1,000 per UTC month. Cue-only calls contain up to 16 derived records and allow 600 model output tokens. Separately enabled `context-v2` calls contain at most 64 complete nearby paragraphs, with 3,000 UTF-8 bytes each, 12,000 source bytes total and a 16,384-byte request body. V2 allows up to 4,096 model output tokens and returns validated labels and token usage when available. Older v1 clients retain the eight-paragraph and 1,000-output-token limits. After initial enablement, the browser requests new windows during visible active reading and shows partial coverage. Each loaded story has a browser allowance of 12 attempts and 60,000 attempted source bytes. The Worker stores expiring quota counters and sets `store: false` on provider requests. OpenAI abuse-monitoring retention follows its separate policy. Contextual consent and labels remain in memory for the visit. [Contextual implementation and verification](../../docs/nocturne-context-phase.md)

## Enable real Lovense pairing for the beta

The simulator path is usable immediately. The real path deliberately reports unavailable until all three runtime settings below are valid. Never put these values into GitHub, build variables, browser code, feedback or chat.

1. In your own browser, open the [Lovense developer dashboard](https://www.lovense.com/user/developer/info). Create or open the application for the **Standard JS SDK / Standard Socket API** solution using **Lovense Remote**, not a cam-model account or a developer token in browser JavaScript. Record the exact **Website Name** shown there and obtain its Developer Token. Complete any account/application review that Lovense requires in that dashboard yourself.
2. Generate a new independent 64-character hexadecimal secret for pseudonymous vendor identities. Store it privately in Bitwarden. It must not reuse the questionnaire webhook secret or developer token. For Windows PowerShell, this creates 32 cryptographic random bytes and copies their 64 hex characters to your clipboard without printing them:

   ```powershell
   $satinLoreBytes = New-Object byte[] 32
   $satinLoreRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $satinLoreRng.GetBytes($satinLoreBytes)
   ([BitConverter]::ToString($satinLoreBytes).Replace('-', '').ToLowerInvariant()) | Set-Clipboard
   $satinLoreRng.Dispose()
   ```

3. Open **Cloudflare → Workers & Pages → satinlore-private-app → Settings → Variables & Secrets**. Add these as **runtime** settings, keeping the existing Access settings:

   | Name | Type | Value |
   | --- | --- | --- |
   | `LOVENSE_DEVELOPER_TOKEN` | Secret | Developer Token from your Lovense application |
   | `LOVENSE_UID_SECRET` | Secret | The newly generated independent 64 hex characters |
   | `LOVENSE_PLATFORM` | Text | Exact Lovense **Website Name**, including its case/spaces |

4. **Save and Deploy** those settings. The source sets `keep_vars: true` so dashboard-owned runtime values survive later GitHub deployments. Do not add a callback pointing at the reader or a public bypass route: this integration uses the SDK/socket solution, not an HTTP callback database.
5. While signed in, open the reader setup and choose **Connect a real toy**. The availability check must now report ready. Pair the toy in **Lovense Remote** first, then scan the displayed QR code from Remote on the phone. Use a desktop/laptop for the web reader and the phone for Remote for this initial test; same-phone app launching from the opaque sandbox is not qualified.
6. Select exactly one discovered toy. Merely choosing a model in the guide must not connect, select hardware automatically or start output. Begin with the explicitly requested two-second test, maximum **5/20**; verify its actual behaviour and stop/expiry before reading. Every nonzero packet remains targeted and finite. SDK submission is not proof of physical output or physical stopping. Record results in `docs/hardware-test-record.md` and follow `docs/lovense-beta-test.md`.

The hosted API contract is:

- Authenticated `GET /api/lovense/status` returns only `{available,message}`. It reveals no secret, UID or identity. Status is not a vendor contact or hardware test.
- Authenticated exact-origin JSON `POST /api/lovense/session` accepts exactly `{}`. Client user IDs, story data, extra fields and query strings are rejected. The Worker derives a stable HMAC UID from the verified Access audience/subject and independent UID secret, then calls Lovense's fixed server token endpoint. Only `{uid,platform,authToken,expires_at}` returns to that sign-in. `authToken` is a per-user credential, never the Developer Token; it stays in memory and is sent only to the bridge.
- Session responses expire at the earlier of the signed Access expiry or 15 minutes. The Worker verifies Access again after the vendor request; failure discards the credential response. Lovense does not provide a remote-token revocation guarantee here. Disconnect/expiry/hide teardown and finite commands remain essential.
- Issuance is limited to three/minute and twenty/hour per derived identity using durable, message-free counters in a separate object namespace. No identity, QR or token is retained. This reuses the existing binding/migration without touching feedback records or marketing data.

### Permit the named tester only

A tester must be admitted by **both** Cloudflare Access and the Worker. Do not share the founder inbox/PIN or broaden to Everyone.

1. Obtain the tester's intended sign-in email privately.
2. In the **SatinLore private reader** Access application's Allow policy, add that exact email to **Include → Emails**, retaining `team@satinlore.com`. Keep the policy scoped to the entire `app.satinlore.com` hostname; do not change marketing admin policies.
3. In the **satinlore-private-app** runtime variables, set `BETA_TESTER_EMAILS` to that email. Additional explicitly approved testers use a comma-separated list (maximum twenty; no wildcards). Save and deploy. This list is dashboard-owned, not committed to source.
4. Test that account in a fresh browser session. Another email must still be denied. No policy or allowlist change is made automatically by this code release.

Official Lovense contracts reviewed 2 November 2026: [Standard JS SDK](https://developer.lovense.com/docs/standard-solutions/standard-js-sdk) and [Standard Socket API token exchange](https://developer.lovense.com/docs/standard-solutions/socket-api).

## Verify the deployed boundary

Use neutral fixture text and an inbox you control. Check these separately from mocked tests:

1. A logged-out visit to `/`, `/static/app.mjs` and `/api/access` reaches the Access login or denial, with no reader/asset data.
2. The approved founder can sign in and load the reader, both themes, imports, corrections and paused restoration. TXT import must not create a story-text network request.
3. An account absent from either the relevant Access Allow policy or Worker allowlist is denied. A forged email header or missing assertion cannot obtain assets. Confirm there is no reachable `workers.dev`, version URL or other hostname bypass.
4. `/device-check`, local invitation endpoints, `/static/device-bridge.mjs` and `/static/devices/lovense.mjs` remain unavailable. `/device-bridge` requires the same signed Access gate and is sandboxed without `allow-same-origin`; its vendor code must never execute in the reader document. No vendor request is made during simulator-only rehearsals.
5. Expiry, sign-out/revocation, failed probes, hidden-page return and offline errors block Start and leave output paused. Logging in again must not automatically start playback. Check that unsaved text is not silently persisted or uploaded.
6. Inspect network requests while reading a neutral story. No text, title, excerpts, private tokens, third-party analytics or vendor scripts may leave the reader.

`PRIVATE_APP_ENABLED=false` is an operational pause: save and deploy that runtime setting to deny new requests and fail subsequent reader probes. It is not a remote browser-storage deletion mechanism. To revoke an existing Access session, use the dedicated Access application's controls. For a code rollback after introducing feedback, preserve the `PrivateFeedback` class export, binding and migration history. A version predating the class may not be a valid direct rollback target. Use a corrective release retaining the storage contract; do not delete the namespace or migration history to make a rollback succeed. Browser story data is independent.

## Why this adapter rather than a Python port

Cloudflare currently supports FastAPI through its Python ASGI entrypoint and supports D1 from Python. That could host a future minimal session/feedback service, but the current SQLite store, local-origin restrictions, invitation transactions and device integration would need a separate, tested port. The reader uses a small separate hosted token exchange for deliberately requested Lovense pairing; it does not port the Python invitation database. The Python local boundary remains intact. Private feedback and independent message-free connection quotas use distinct object namespaces on the existing Durable Object binding.

Official references:

- [SQLite Durable Object storage and recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object availability and Free-plan limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Workers static assets and binding](https://developers.cloudflare.com/workers/static-assets/)
- [Run a Worker before every asset request](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Keep dashboard runtime variables across deployment](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)
- [Workers Git builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Configure build commands](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Disable Preview builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Validate Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [FastAPI on Python Workers](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/)
- [Query D1 from Python Workers](https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers/)
