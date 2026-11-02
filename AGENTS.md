# SatinLore project instructions

## Start here

- Read `README.md`, `docs/development-spec.md` and the relevant milestone in `docs/beta-roadmap.md`.
- Inspect current code and applicable nested instructions. Implementation status requires code and evidence, not plans.
- This local FastAPI/static-JavaScript build has a themed saved-story workspace with optional review and simulator playback and a separate authenticated device-check flow. Follow the software-first F1–F6 roadmap; hardware is not a prerequisite for frontend/application work. The founder-only Cloudflare simulator is deployed; live vendor/hardware qualification and wider beta release remain outstanding.
- Complete the requested milestone without unrelated frameworks or placeholders.

## Setup and checks

- Python 3.12+; Node.js 24 for JavaScript tests. No browser bundler is required.
- Windows: `py bootstrap.py`, then `py run.py`.
- macOS/Linux: `python3 bootstrap.py`, then `python3 run.py`.
- Full local checks: `py scripts/check.py` on Windows, `python3 scripts/check.py` elsewhere.
- Start manual hardware-free checks with `docs/test-today.md`; hardware evidence belongs in `docs/hardware-test-record.md`.
- Browser checks are separate: see `docs/qa.md` for Playwright setup and the distinction between fake SDK and real-device evidence.
- Run relevant tests and the common checks before handoff; report failures and unverified browser/hardware behaviour.
- Keep documentation and tests consistent with actual paths, commands and behaviour. Frontend changes must follow `docs/frontend-design.md`; record browser/build evidence separately from physical qualification.

## Product and architecture

- Browser-first, users' own typed/pasted/uploaded stories and deliberately requested imports from supported story URLs. The current reader controls only a simulator; one qualified Lovense model, vibration only, remains the first hardware target.
- Defer generation, payments, public publishing, marketplaces, native apps and additional brands.
- Use FastAPI, browser ES modules and the existing SQLite invitation/session store. Expand persistence only when a requested feature needs it.
- Follow the 2 November reader refinement over workspace v1.2: a collapsible story library, continuous reader, Wide default, optional settings/review and focus mode. Preserve Satin Editorial/Midnight Ink, System/Light/Dark and document scrolling. Do not reintroduce a compulsory review step.
- Story storage requires an explicit Save on this browser choice. Keep Session only as the default, preserve truthful save/delete failure states, and restore every story paused without saved strength, ceiling or playback arming.
- Keep local text parsing, scoring and reading position in the browser. A deliberate supported-URL import may send that URL to the authenticated import endpoint and fetch/extract its public story; never upload local drafts or saved text automatically. Do not retain imported story content server-side. Other backend data should be minimal session, feedback and entitlement records.
- Treat the keyword scorer as experimental, not a semantic, consent or safety classifier. Keep manual zero overrides distinct from unset overrides; do not silently rescore corrections.
- Preserve finite dispatch, coalescing and inactivity/tab ownership. Start explicitly confirms the current ceiling. In the ordinary synchronous reader simulator, the user's direct maximum-slider gesture updates the ceiling without a popup or automatic restart; lower/zero values take immediate priority. Preserve separate confirmation/acknowledgement contracts in the async transport lab and hardware-check flow. Session strength is bounded, does not rewrite corrections, and cannot bypass zero or the confirmed ceiling.
- Check current official Lovense documentation before implementing its API. Developer credentials remain server-side; user identities derive from authenticated sessions.
- Preserve simulator mode; never use a mode flag to imply an unimplemented integration works. The custom-model selector is a labelled future tier, not a working payment, multi-toy or dual-area implementation. Account login/cloud story sync is backlogged; do not fabricate a login or save result.

## Privacy and device behaviour

- Never commit credentials, `.env`, databases, private stories, identifying feedback or private account links. Use neutral fixtures.
- Do not put story text in logs, analytics, URLs or error reports, or upload local story text in requests. The explicit URL-import service is the bounded exception for fetching/extracting a user-requested public source; it must validate hosts/paths/redirects, omit credentials, reject restricted pages and return plain text. Render every import as text, not HTML.
- Keep vendor code inside the sandboxed device bridge, never in the reader DOM. Preserve exact-source/origin message checks and bounded command validation; validate isolation before making privacy claims.
- Require explicit device selection and Start. Always target a single toy ID; never broadcast by omission.
- Use short finite nonzero commands; initially two seconds, pending provider and physical verification.
- Stop dispatch on pause, hide, disconnect, logout or story change. Reconnection and tab return remain paused until explicit restart.
- Timers and Stop packets cannot guarantee stopping after transport loss; record physical evidence separately.

## Code review rules

- Flag client-controlled identity used to issue another user's vendor token.
- Flag developer credentials or raw story content reaching vendor/client payloads, and QR/auth payloads reaching logs or unintended users. A per-user vendor authToken may be issued only to that authenticated session.
- Preserve invitation replay prevention, hashed bearer-token storage, exact-origin/CSRF checks, bounded requests and session revalidation after vendor requests.
- Flag omitted `toyId`, indefinite nonzero commands, stale queues, ceiling changes without a current deliberate user action, zero/ceiling bypasses, or automatic resume after interruption, restoration or story switching. Direct reader-simulator slider changes are authorised ceiling actions; they do not change the async-lab or hardware contracts.
- Flag silent story persistence, saved playback arming, success before storage completes, and stale writes that restore deleted stories.
- Flag unsupported hardware/browser claims based only on mock tests.
- Flag new scope that adds generation, billing or public sharing without a task requesting it.

## Handoff

- Summarise changed behaviour, checks run, remaining limitations and the next concrete milestone.
- Update the roadmap with verified milestones and outstanding checks.
- Proceed with authorised reversible implementation work. Do not introduce routine approval gates for edits or tests.
