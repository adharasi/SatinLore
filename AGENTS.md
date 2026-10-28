# SatinLore project instructions

## Start here

- Read `README.md`, `docs/development-spec.md` and the relevant milestone in `docs/beta-roadmap.md`.
- Inspect current code and applicable nested instructions. Implementation status requires code and evidence, not plans.
- This is a local FastAPI/static-JavaScript simulator scaffold. Real Lovense control and production authentication are not implemented.
- Complete the requested milestone without unrelated frameworks or placeholders.

## Setup and checks

- Python 3.12+; Node.js 24 for JavaScript tests. No browser bundler is required.
- Windows: `py bootstrap.py`, then `py run.py`.
- macOS/Linux: `python3 bootstrap.py`, then `python3 run.py`.
- Full local checks: `py scripts/check.py` on Windows, `python3 scripts/check.py` elsewhere.
- Run relevant tests and the common checks before handoff; report failures and unverified browser/hardware behaviour.
- Keep documentation and tests consistent with actual paths, commands and behaviour.

## Product and architecture

- Browser-first, users' own private TXT/pasted text, one qualified Lovense model, vibration only.
- Defer generation, payments, public publishing, marketplaces, native apps and additional brands.
- Use FastAPI and browser ES modules. Add SQLite when sessions/feedback need persistence.
- Keep text parsing, scoring and reading position in the browser. Backend data should be minimal session, feedback and entitlement records.
- Check current official Lovense documentation before implementing its API. Developer credentials remain server-side; user identities derive from authenticated sessions.
- Preserve simulator mode; never use a mode flag to imply an unimplemented integration works.

## Privacy and device behaviour

- Never commit credentials, `.env`, databases, private stories, identifying feedback or private account links. Use neutral fixtures.
- Do not put story text in logs, requests, analytics, URLs or error reports. Render imports as text, not HTML.
- Validate third-party SDK isolation before making local-text privacy claims.
- Require explicit device selection and Start. Always target a single toy ID; never broadcast by omission.
- Use short finite nonzero commands; initially two seconds, pending provider and physical verification.
- Stop dispatch on pause, hide, disconnect, logout or story change. Reconnection and tab return remain paused until explicit restart.
- Timers and Stop packets cannot guarantee stopping after transport loss; record physical evidence separately.

## Code review rules

- Flag client-controlled identity used to issue another user's vendor token.
- Flag developer credentials, raw story content or QR/auth payloads exposed to clients or logs.
- Flag omitted `toyId`, indefinite nonzero commands, stale command queues, ceiling bypasses or automatic resume after interruption.
- Flag unsupported hardware/browser claims based only on mock tests.
- Flag new scope that adds generation, billing or public sharing without a task requesting it.

## Handoff

- Summarise changed behaviour, checks run, remaining limitations and the next concrete milestone.
- Update the roadmap with verified milestones and outstanding checks.
- Proceed with authorised reversible implementation work. Do not introduce routine approval gates for edits or tests.
