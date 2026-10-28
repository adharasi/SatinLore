# SatinLore project instructions

## Start here

- Read `README.md`, `docs/development-spec.md` and the relevant milestone in `docs/beta-roadmap.md`.
- Inspect current code and applicable nested instructions. Implementation status requires code and evidence, not plans.
- This local FastAPI/static-JavaScript build has a scored, scroll-following simulator reader and an authenticated device-check flow. Live vendor/hardware qualification and production deployment remain outstanding.
- Complete the requested milestone without unrelated frameworks or placeholders.

## Setup and checks

- Python 3.12+; Node.js 24 for JavaScript tests. No browser bundler is required.
- Windows: `py bootstrap.py`, then `py run.py`.
- macOS/Linux: `python3 bootstrap.py`, then `python3 run.py`.
- Full local checks: `py scripts/check.py` on Windows, `python3 scripts/check.py` elsewhere.
- Start manual hardware-free checks with `docs/test-today.md`; hardware evidence belongs in `docs/hardware-test-record.md`.
- Browser checks are separate: see `docs/qa.md` for Playwright setup and the distinction between fake SDK and real-device evidence.
- Run relevant tests and the common checks before handoff; report failures and unverified browser/hardware behaviour.
- Keep documentation and tests consistent with actual paths, commands and behaviour.

## Product and architecture

- Browser-first, users' own private TXT/pasted text, one qualified Lovense model, vibration only.
- Defer generation, payments, public publishing, marketplaces, native apps and additional brands.
- Use FastAPI, browser ES modules and the existing SQLite invitation/session store. Expand persistence only when a requested feature needs it.
- Keep text parsing, scoring and reading position in the browser. Backend data should be minimal session, feedback and entitlement records.
- Treat the keyword scorer as experimental, not a semantic, consent or safety classifier. Keep manual zero overrides distinct from unset overrides; do not silently rescore corrections.
- Preserve the simulator controller's finite dispatch, latest-value coalescing, explicit Start, immediate reduction-to-Stop and inactivity/tab-ownership rules.
- Check current official Lovense documentation before implementing its API. Developer credentials remain server-side; user identities derive from authenticated sessions.
- Preserve simulator mode; never use a mode flag to imply an unimplemented integration works.

## Privacy and device behaviour

- Never commit credentials, `.env`, databases, private stories, identifying feedback or private account links. Use neutral fixtures.
- Do not put story text in logs, requests, analytics, URLs or error reports. Render imports as text, not HTML.
- Keep vendor code inside the sandboxed device bridge, never in the reader DOM. Preserve exact-source/origin message checks and bounded command validation; validate isolation before making privacy claims.
- Require explicit device selection and Start. Always target a single toy ID; never broadcast by omission.
- Use short finite nonzero commands; initially two seconds, pending provider and physical verification.
- Stop dispatch on pause, hide, disconnect, logout or story change. Reconnection and tab return remain paused until explicit restart.
- Timers and Stop packets cannot guarantee stopping after transport loss; record physical evidence separately.

## Code review rules

- Flag client-controlled identity used to issue another user's vendor token.
- Flag developer credentials or raw story content reaching vendor/client payloads, and QR/auth payloads reaching logs or unintended users. A per-user vendor authToken may be issued only to that authenticated session.
- Preserve invitation replay prevention, hashed bearer-token storage, exact-origin/CSRF checks, bounded requests and session revalidation after vendor requests.
- Flag omitted `toyId`, indefinite nonzero commands, stale command queues, ceiling bypasses or automatic resume after interruption.
- Flag unsupported hardware/browser claims based only on mock tests.
- Flag new scope that adds generation, billing or public sharing without a task requesting it.

## Handoff

- Summarise changed behaviour, checks run, remaining limitations and the next concrete milestone.
- Update the roadmap with verified milestones and outstanding checks.
- Proceed with authorised reversible implementation work. Do not introduce routine approval gates for edits or tests.
