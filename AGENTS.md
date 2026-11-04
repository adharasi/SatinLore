# SatinLore project instructions

## Start here

- Read `README.md`, `docs/development-spec.md` and the relevant milestone in `docs/beta-roadmap.md`.
- Inspect current code and applicable nested instructions. Implementation status requires code and evidence, not plans.
- This local FastAPI/static-JavaScript build has a themed saved-story reader and a separate local device-check flow. The private Cloudflare reader now includes verified-email accounts, explicitly saved toy/story presets, progressive calibration, combined controls where qualified, and a separately consented beta control-recording host. Follow the software-first F1–F6 roadmap; hardware is not a prerequisite for software work. Live vendor/hardware qualification and wider beta release remain outstanding. The current founder/tester runbook is `docs/beta-session-2026-11-03.md`.
- Complete the requested milestone without unrelated frameworks or placeholders.

## Setup and checks

- Python 3.12+; Node.js 24 for JavaScript tests. The reader uses browser ES modules; the private Worker build bundles the isolated device bridge.
- Windows: `py bootstrap.py`, then `py run.py`.
- macOS/Linux: `python3 bootstrap.py`, then `python3 run.py`.
- Full local checks: `py scripts/check.py` on Windows, `python3 scripts/check.py` elsewhere.
- Start manual hardware-free checks with `docs/test-today.md`; hardware evidence belongs in `docs/hardware-test-record.md`.
- Browser checks are separate: see `docs/qa.md` for Playwright setup and the distinction between fake SDK and real-device evidence.
- Run relevant tests and the common checks before handoff; report failures and unverified browser/hardware behaviour.
- Keep documentation and tests consistent with actual paths, commands and behaviour. Frontend changes must follow `docs/frontend-design.md`; record browser/build evidence separately from physical qualification.

## Product and architecture

- Browser-first, users' own typed/pasted/uploaded stories and deliberately requested imports from supported story URLs. The product owner's 2 November request expands the connection scope to Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce, Hush and Osci 3. Preserve independent simulator and physical modes, explicit device/action selection and current capability checks. Qualify each actual model/firmware/Remote/browser combination separately; no simulated result qualifies hardware.
- Defer generation, payments, public publishing, marketplaces, native apps and additional brands.
- Use FastAPI, browser ES modules and the existing SQLite invitation/session store. Expand persistence only when a requested feature needs it.
- Follow the 2 November reader refinement over workspace v1.2: a collapsible story library, continuous reader, Wide default, optional settings/review and focus mode. Preserve Satin Editorial/Midnight Ink, System/Light/Dark and document scrolling. Do not reintroduce a compulsory review step.
- Story text storage requires an explicit Save on this browser choice. Keep Session only as the default and preserve truthful save/delete failures. Account presets are a separate, explicitly saved settings record and may retain per-action levels, active channels and a master maximum. Reopening a story or applying a preset must remain paused; neither can restore credentials, playback arming or personal-range permission.
- Keep text parsing and scoring in the browser. A deliberate supported-URL import may send that URL to the authenticated import endpoint to fetch its public story without retaining it there. Only the reader's explicit Save to my account choice can send a story to their authenticated library. Existing local stories and drafts are never migrated automatically.
- Treat the keyword scorer as experimental, not a semantic, consent or safety classifier. Keep manual zero overrides distinct from unset overrides; do not silently rescore corrections.
- Preserve finite dispatch, coalescing and inactivity/tab ownership. Start explicitly confirms the current ceiling. In the ordinary synchronous reader simulator, the user's direct maximum-slider gesture updates the ceiling without a popup or automatic restart; lower/zero values take immediate priority. Preserve separate confirmation/acknowledgement contracts in the async transport lab and hardware-check flow. Session strength is bounded, does not rewrite corrections, and cannot bypass zero or the confirmed ceiling.
- Check current official Lovense documentation before implementing its API. Developer credentials remain server-side; user identities derive from authenticated sessions.
- Preserve simulator mode; never use a mode flag to imply an unimplemented integration works. Model selection does not imply billing or multi-toy control. Public readers verify their email and sign in with a password. Cloudflare Access accounts remain distinct. A verified public reader can explicitly save stories, reading preferences and toy presets to their account. Claim saved results only after durable acknowledgement.

## Privacy and device behaviour

- Never commit credentials, `.env`, databases, private stories, identifying feedback or private account links. Use neutral fixtures.
- Do not put story text in logs, analytics, URLs, vendor traffic, analysis requests or error reports. Account story writes are limited to authenticated, explicitly saved library records. The URL-import service must validate hosts, paths and redirects, omit credentials, reject restricted pages and return plain text. Render every import as text.
- Keep vendor code inside the sandboxed device bridge, never in the reader DOM. Preserve exact-source/origin message checks and bounded command validation; validate isolation before making privacy claims.
- Require explicit device selection and Start. Always target a single toy ID; never broadcast by omission.
- Use short finite nonzero physical commands of two seconds. Initial gentle tests and unqualified movements remain at most 5/20. The user's new request permits an explicit session-only personal-range grant up to 20/20 only after that action's gentle response and targeted Stop were checked. Enabling a range must not raise a maximum or start output; account presets cannot grant it. Reset permission on interruption, hide, expiry, disconnect or device change. The selected lower/zero maximum remains authoritative. Never infer undocumented motors or heating from a product name. Provider and physical verification remain separate.
- Only the exact `beta.satinlore.com` host may record the beta's structured control timeline, after its explicit recording choice. Keep this separate from account registration, functional preset saving and marketing cookies. No DOM/screen video, story text/title, typed preset name, private URL, pairing material or credential may enter beta telemetry. The founder-only beta admin is not available to testers or on the normal app host.
- The owner's 3 November Alpha request authorises a separate `/alpha` study on the app host. Its own Dilan/Sadie credentials and role checks protect the study and `/admin`; its session cannot grant reader or beta access. Alpha controls can be recorded automatically after an explicit study choice. Optional tab video requires separate consent, exact capture-surface verification, a local preview and an explicit Share action. Keep Alpha study data, credentials and media separate from reader/beta data and marketing. Admin review must never operate a toy.
- Stop dispatch on pause, hide, disconnect, logout or story change. Reconnection and tab return remain paused until explicit restart.
- Timers and Stop packets cannot guarantee stopping after transport loss; record physical evidence separately.

## Code review rules

- Flag client-controlled identity used to issue another user's vendor token.
- Flag developer credentials or raw story content reaching vendor/client payloads, and QR/auth payloads reaching logs or unintended users. A per-user vendor authToken may be issued only to that authenticated session. Hosted UID derivation must use the verified Access subject and server-held independent secret; client-supplied identity is forbidden. Optional beta-email configuration must not broaden access until the owner explicitly configures both the Worker allowlist and Cloudflare Access policy.
- Preserve invitation replay prevention, hashed bearer-token storage, exact-origin/CSRF checks, bounded requests and session revalidation after vendor requests.
- Flag omitted `toyId`, indefinite nonzero commands, stale queues, ceiling changes without a deliberate user action, zero/ceiling bypasses, or automatic resume after interruption, restoration or story switching. Combined actions still target one toy and require each action's qualification and range permission. Direct reader slider gestures are authorised ceiling actions within the current transport permission; the local discrete device-check flow remains separately bounded.
- Flag silent story persistence, saved playback arming, success before storage completes, and stale writes that restore deleted stories.
- Flag unsupported hardware/browser claims based only on mock tests.
- Flag new scope that adds generation, billing or public sharing without a task requesting it.

## Handoff

- Summarise changed behaviour, checks run, remaining limitations and the next concrete milestone.
- Update the roadmap with verified milestones and outstanding checks.
- Proceed with authorised reversible implementation work. Do not introduce routine approval gates for edits or tests.
