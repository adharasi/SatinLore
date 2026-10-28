# Development specification

Technical snapshot: 28 October 2026. Features are proposed unless explicitly marked implemented.

## Goal and scope

Synchronise adults' English text with one physically tested Lush 3 or Lush 4, vibration only. Validate reliability, useful synchronisation and voluntary return.

Required beta: individual invitations, TXT/paste, paragraph scoring with corrections, mobile reader, position tracking, explicit device selection, Start/Pause/Stop, intensity ceiling, private feedback and deletion controls. EPUB is optional after core checks. Generation, billing, public publishing, native apps and other brands are deferred.

Existing code provides the simulator and manual paragraph levels. Real pairing, authentication, scoring, scroll tracking and persistence remain unimplemented.

## Architecture

| Component | Responsibility | Data boundary |
| --- | --- | --- |
| Reader | Import, scoring, corrections and reading position | Story text remains local |
| Playback controller | State, ceiling, smoothing and dispatch | Receives level/control state |
| Device adapter | Connection, selected device, finite commands and Stop | No story text |
| FastAPI | Authentication, individual vendor token issuance and feedback | No story storage |
| SQLite, when added | Invitations, sessions, feedback and reward entitlements | Minimal records outside static files |

Use the official [Lovense Standard JS SDK](https://developer.lovense.com/docs/standard-solutions/standard-js-sdk) with Lovense Remote as the phone/Bluetooth bridge. The backend exchanges its developer token for an individual `authToken`, deriving `uid` from the authenticated session. See the [token contract](https://developer.lovense.com/docs/standard-solutions/socket-api). Confirm applicable integration permissions before external hardware use.

## Core acceptance criteria

- Expired or reused invitations fail; one user cannot request another user's token or control path.
- Empty, oversized and malformed input receives useful errors. HTML-looking text never executes.
- Manual corrections override predicted levels; the user ceiling overrides both.
- Rapid scrolling discards stale transitions. Changing story, device or session pauses output.
- Returning to a tab, reconnecting or restoring progress never resumes physical output automatically.
- Failed test sessions still reach feedback. Duplicate submissions cannot duplicate reward entitlements.

## Playback contract

Target states: `DISCONNECTED`, `CONNECTING`, `READY_PAUSED`, `PLAYING`, `ERROR_PAUSED`. Leaving `PLAYING` cancels dispatch before attempting targeted Stop. Initial proposed policy: ceiling 5/20, two-second nonzero commands, refreshed at most once per second while explicitly active. Validate provider limits and physical behaviour before release.

Always specify `toyId`. Omitted toy targeting may affect all connected devices; zero/omitted duration is indefinite in the documented SDK. Reject invalid numeric inputs and prioritise Stop/lower ceilings. Add inactivity pause and competing-tab handling when the real controller is implemented. A timer or successful API response does not prove physical expiry.

## Reader and privacy

Use stable local section IDs. Start with a small experimental classifier producing five ordinal levels including zero; preserve corrections separately. Measure false activations and correction burden before claiming automatic synchronisation works. Track a stable viewport reading band with hysteresis and retain manual navigation as a fallback.

Keep memory-only storage until opt-in persistence and deletion controls exist. Never put passages in logs, analytics, crash reports or feedback defaults. A vendor SDK in the reader DOM could access text: validate an isolated connection origin and message boundaries before claiming isolation.

## Backend plan

| Route | Planned purpose |
| --- | --- |
| `GET /api/health` | Implemented scaffold health/status |
| `POST /api/lovense/session` | Currently disabled with 501; future authenticated token exchange |
| `POST /api/invites/redeem` | Redeem individual invitation and create session |
| `GET /api/me`, `POST /api/logout` | Session identity and revocation |
| `POST /api/feedback`, `POST /api/events` | Bounded feedback and allowlisted coarse events |
| `DELETE /api/me` | Remove applicable server data and revoke access |

Future tables: `beta_users`, `invites`, `sessions`, `feedback`, `events`, `reward_entitlements`. Require hashed tokens, expiry, secure cookies, CSRF/origin protection, request limits, parameterised queries, one-time redemption and idempotency. Define retention explicitly.

Deploy only after the [QA gates](qa.md): HTTPS, non-root service, server-only secrets, SQLite outside served paths, database-consistent backup/restore and rollback. The local reload server is not a production launch configuration.
