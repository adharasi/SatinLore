# QA and release checklist


Current hosted account/calibration/recording acceptance is specified in [the 3 November runbook](beta-session-2026-11-03.md). Record current-release automated/browser and deployment evidence separately from physical results; older check counts below are historical.

For a practical front-end session without a device, start with **[test-today.md](test-today.md)** and its neutral sample. Use **[the nine-model beta guide](lovense-beta-test.md)** for simulator rehearsal and the controlled tester session. Use this document for the wider release checklist.

Use software gates S1/S2 and separate hardware/release gates H1/H2 from the [roadmap](beta-roadmap.md). Hardware does not block the current software milestones. Track automated, browser and hardware evidence separately. Record each supported device, firmware, Remote version, phone, browser and build. A passing mock does not certify hardware.

## Automated checks

Run `py scripts/check.py` on Windows or `python3 scripts/check.py` elsewhere after bootstrap. This covers Python/JavaScript tests, syntax and configuration without network or hardware access.

Browser integration checks are separate and use a fake SDK and mocked vendor response:

```sh
npm ci --ignore-scripts
npx playwright install --only-shell chromium
npm run test:browser
```

Linux may need `npx playwright install --with-deps --only-shell chromium`. Browser installation requires internet access. These checks establish application/browser behaviour against the fixture, not live SDK compatibility. Record an installation failure as unexecuted browser evidence, not a passing test.

The browser run writes neutral screenshots to ignored `artifacts/frontend/`. CI uploads the **frontend-evidence** artifact with desktop/phone Light and Dark workspace captures plus relevant settings/confirmation views. Screenshots support visual inspection; assertions provide functional evidence. Mobile emulation does not prove real phone or physical device behaviour.

## Frontend appearance and journey checks

Use [frontend-design.md](frontend-design.md) for the full matrix. Verify System follows the OS, explicit Light/Dark overrides it, preference resolves before paint, and storage failure leaves the page usable. Inspect both themes at 390 × 844 and 1440 × 1000, 320 CSS px, landscape and 200% text/zoom. Check essential contrast, 44 px targets, visible focus, readable labels and dock clearance.

Verify a new or saved story opens directly into continuous reading. A fresh workspace defaults to Wide with settings closed. The library and settings independently collapse; Focus hides both and restores their prior arrangement. Review is optional and initially limited to current/already-read sections. Future reveal is deliberate. Background local analysis may finish later; silent reading remains available, while Start requires a valid current mapping. Failed/cancelled/stale work must not apply to another story or restart playback.

Verify explicit local-save consent, title/correction/progress round trips, rename, Session only, delete one/all and paused restoration. The default stores no story. Appearance is separate from the versioned story store. Exercise unavailable, quota, corrupt and concurrent/stale storage states; failed writes/deletes must not report success. Do not persist strength, ceiling, tokens, connection or playback arming. The reader remains independent of the separate device-check session.

## Reader and simulator checks

Use the action/expected-result table in [test-today.md](test-today.md). Cover:

- Import bounds (500,000 UTF-8 bytes; 2,000 paragraphs), empty/malformed input, literal HTML-looking strings and delayed-import cancellation.
- Five-band local predictions, delayed analysis, distinct manual zero overrides, correction-preserving reanalysis and story/delete lifecycle. Record scoring quality separately from control failures. Never inspect future passages merely to begin reading.
- Scroll settling and boundary hysteresis, rapid jumps, long paragraphs/gaps, manual navigation, font/window reflow and keyboard/mobile usability.
- Start confirmation on every start/resume; direct maximum-slider changes without a separate popup in the ordinary reader simulator; immediate lower/zero ceiling; bounded 0.0×–2.0× strength in 0.1× steps, floor rounding and unchanged stored corrections. Manual/automatic zero stays zero. Strength changes never Start or raise a ceiling.
- Immediate Stop remains accessible in settings, review and confirmation dialogs. Reductions keep priority over the finite dispatch cadence and latest-value coalescing.
- Stop while a selection is pending, hide/return, disconnect/reconnect, story switches/deletion, restoration, inactivity, delayed timers and adapter errors. None may automatically resume output.
- Two visible same-origin windows in one browser profile: the second cannot take over active simulator playback. Ordinary hidden-tab interruption is a separate case.
- No local story text/titles in network requests, URLs or logs; deliberate supported-URL import is the documented transient source-fetch exception, with no automatic local-text upload or retention. Session-only content stays out of persistence. After explicit consent, allow only the documented versioned local story fields, with appearance separate. Use neutral fixtures and do not export sensitive request data.

The reader facade separates synchronous profile simulation from the optional configured asynchronous Lovense bridge. Repeat relevant reading/interruption checks against both software paths, with fake transport fixtures for deterministic failures. Passing them does not qualify physical output, actual expiry or any model/firmware/Remote/browser combination.

## Editor, import, folder and setup acceptance

- Blank-page typing/paste and separate upload/link actions are usable without a compulsory modal or intensity review. Current-reader controls live on the right; global appearance/account/backup/about/help/support live in the gear menu.
- The hosted AO3 import endpoint is Access-protected and accepts exact-origin bounded JSON. Validate canonical allowed source hosts/paths, HTTPS, no credentials/ports, redirect restrictions, timeout/size limits, plain-text extraction and generic failures. Restricted/bot pages stay blocked; no local draft or saved story is attached. Literotica and unsupported sites must offer copy/upload fallback rather than fabricate automatic support.
- Local AO3 HTML extraction is inert: scripts, event handlers, images, styles and remote resource loads do not execute. Import cancellation, malformed data and stale responses preserve the current library and cannot start output. Use neutral fixtures; do not log private source URLs or story bodies.
- Folder operations share local-library locking/revisions. Test the 30-folder/60-character-name limits, normalised duplicates, denied/corrupt storage, stale revisions, saved membership round trips and session-only moves. Deleting a folder moves stories to Unfiled; Delete all clears the catalogue. Backups restore Unfiled with fresh session identities.
- Guided setup offers Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce, Hush and Osci 3 with separate Try a simulator and Connect my toy routes. Require explicit discovered-device/action selection, a short test, checked stopped output and a neutral practice story. Every reading Start uses the ordinary confirmation. Coach checks must reflect actual interactions rather than a fake completion; skip/close/finish stops and cancels pending work. No account calibration or armed connection is saved. Missing live runtime configuration must show unavailable with a usable simulator route; never fabricate a QR or connection success.
- The model graphic/trace follows simulated output or labels requested live output, with an honest unknown state for unconfirmed transport results, bounded history and a reduced-motion alternative. It is not physical measurement. Check strength/maximum/section changes while running and the no-popup simulator maximum flow. Physical commands must stay within 5/20 and two seconds regardless of profile or story mapping.
- Dark/Midnight Ink applies to the editor, both sidebars, global settings and setup. Repeat keyboard/touch targets and Stop access at 320/390 CSS px, landscape and large text. Account sync, custom-model inference, paid entitlements and multi-toy/dual-area capabilities remain labelled future work.

## Hosted authentication and bridge checks

The hosted Worker and local Python invitation service are independent authentication boundaries. Do not treat a passing local invitation test as evidence that hosted Access or vendor credentials are configured.

- Every hosted reader/document/asset/API route requires a verified current Access token for the configured audience/team and an explicitly allowed identity. Missing configuration and alternate hostnames fail closed. The founder remains the default; optional `BETA_TESTER_EMAILS` must be bounded/validated and cannot replace the external Cloudflare Access policy.
- `GET /api/lovense/status` returns availability/message only. `POST /api/lovense/session` requires exact-origin JSON `{}`, rejects unknown fields or client identity, bounds request/response/timeouts and derives a pseudonymous UID from the verified subject plus independent server secret. The developer token never reaches the client; the per-user SDK token may reach only that authenticated session's isolated bridge.
- Revalidate Access after vendor issuance. Expiry or identity changes while the request is pending must discard its result. Check absent/malformed credentials, generic upstream failures, fixed upstream URLs, bounded expiry and persistent three/minute, twenty/hour issuance limits without exposing tokens or vendor response bodies.
- The hosted build embeds bridge code in protected HTML with a hash-authorised policy. The sandbox has `allow-scripts` without `allow-same-origin`, and vendor permissions apply only there. No unauthenticated module/CORS exception may make protected reader content public. Check exact parent/source/origin/port handshake and strict command/reply shapes.
- All nonzero live requests target one explicitly selected ID, an allowed discovered action, at most 5/20 and two seconds. No omitted target, broadcast, indefinite output, undocumented action, saved credential or stale completion may create/resume output. Missing/failed acknowledgements must not become a claimed physical Stop or a known zero.
- Exercise model/mode/action/selection changes, Stop while connect/test/Start is pending, hide/return, expiry, disconnect/reconnect, competing tabs and a stale SDK callback. Reconnection remains paused. Device-specific runtime capability reports must restrict offered motions; a model illustration or a simulator's actions cannot authorise unsupported real commands.
- Simulation must exercise the same explicit selection/test/practice progression with no vendor script or credential request. Test all nine profiles and rehearsal disconnect/error/reconnect controls. A failure must require explicit recovery without auto-selection or auto-Start.
- Use neutral content for network inspection; local stories, titles and corrections must not cross the bridge or appear in backend/vendor payloads. Never save QR/auth payloads, cookies, private device IDs or story excerpts in screenshots, HAR files or issues.

## Separate local invitation/device-check tests

- Redeem a fresh invitation once. Reuse, expiry, malformed fields and concurrent redemption must not produce extra sessions.
- Verify exact-origin and CSRF rejection, rate limits, expired sessions and logout. Do not include actual cookies or tokens in reports.
- Verify two test identities receive their own server-derived UID; caller-supplied identities are rejected. Logout during vendor issuance must prevent its response from establishing a session.
- Check generic vendor failures, timeouts, oversized responses and missing credentials without credential leakage.
- Verify no vendor script runs in the reader or device-check parent DOM. The bridge has no same-origin permission and only the intended parent can establish its message channel.
- Exercise malformed messages, missing selection, unsupported devices, disconnect/reconnect, expiry and delayed SDK callbacks. No broadcast or automatic nonzero output may occur.
- Delay session verification, then press Stop or change selection/output. The pending test must not start after the interruption. A second same-origin tab must not acquire the active device-check lock.
- In a live browser, inspect requests with neutral text only. Do not save QR/auth payloads in screenshots, HAR files or issue attachments.

## Hardware qualification

Follow [the hosted beta setup](lovense-beta-test.md), or [the separate local screen](hardware-check.md), and record each configuration/trial using [hardware-test-record.md](hardware-test-record.md). A controlled private alpha session may perform the short pulse and neutral practice to gather these observations; qualification is the outcome being measured, not a prerequisite inferred from software tests. Start with a paired device out of use and one control tab. The local screen is a discrete vibration check; the hosted reader has a separately bounded async practice path.

| Check | Required result |
| --- | --- |
| Selection and identity | Only the explicitly selected device responds; another identity cannot obtain its control path |
| Bounds | Each requested action stays at or below 5/20 for a two-second nonzero command, including during the controlled practice read |
| Stop | Targeted Stop is issued promptly and observed output stops |
| Interrupted transport | Measure expiry after Bluetooth, internet, app or browser loss |
| Interruption | Hide, disconnect, selection change, expiry and logout cancel control without automatic resume |
| Extra actions | Test each offered action separately; record absent live motions and never infer them from simulation |
| Same-phone flow | Qualify QR/app switching and screen lock separately on each claimed platform; initial guide uses a second screen |
| Privacy | No story text or developer token in client/vendor payloads, logs or analytics |

Repeat physical expiry tests and record requested duration versus observed stop time. A UI timer, API response or one passing model is not evidence of broader support. Repeat tab competition and inactivity checks with the real reading transport; simulator evidence does not transfer to physical control. Qualify Lush, Flexer, Nora and Domi first for the tester's common use, then Velvo, Spinel, Dolce, Hush and Osci 3. One passing action or model does not qualify the others.

## Operational release checks

Before a controlled private tester session, verify the deployed build, HTTPS, both configured Access allowlists and private Lovense runtime status. Do not request or transmit vendor credentials in a report. Before a wider hardware beta, also complete production cookie/origin/proxy controls, retention/deletion, restart, backup/restore and rollback. The local Python service's opportunistic SQLite cleanup is not the hosted app's operational retention policy.

Critical failures include wrong-device control, output continuing outside the verified bound, cross-user access or exposed credentials/story data. Stop expansion and disable the affected path until fixed and re-tested. Backend revocation cannot guarantee stopping disconnected hardware or revoking vendor-issued credentials.

## Feedback and reporting

Capture build, configuration, expected/actual behaviour, reproduction steps and an optional redacted screenshot. Ask about connection difficulty, synchronisation mismatch, correction burden and return use without requesting story excerpts. Failed attempts count for private feedback eligibility.

Activation is eligible users completing the agreed core session divided by eligible users starting onboarding. Report per-attempt connection results separately. Return-use metrics need a complete observation window and must distinguish participation rewards from later voluntary use.


## Current software iteration evidence

The prior expanded browser suite includes real UI Reader/Story tabs, repeated Start→Stop→Start, title search/sort/open tabs, JSON backup downloads and fresh session-only restores, rejected backups, and presentation preferences across reload. The 2 November editor/import/folder/setup revision requires additional browser/build evidence recorded with its release; its design checklist is not itself a pass. Existing ceilings/zero, interruptions, stale work, storage failures, literal text and responsive checks remain.

Separate deterministic suites exercise the async lab contract (including same-turn late-command/Stop ordering and native dialog cancellation during delayed authorisation), actual app-module bindings, and private feedback. Feedback tests include a real local SQLite Durable Object and client/page acknowledgement, retry, cancellation and deletion behavior. These are software evidence, not physical hardware evidence.

Live release checks must verify Access on the root/assets/probes, the deployed source revision in Help, private feedback service availability and actual signed-in browser behavior. A successful source push or Worker dry run alone does not establish those checks. The app defaults to the founder; an invited tester needs an explicit email in both the Cloudflare Access policy and Worker allowlist. Source publication alone adds no identity.
