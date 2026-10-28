# Development specification

Technical snapshot: 28 October 2026. Implemented code, verified evidence and planned features are distinct below.

## Goal and scope

Synchronise adults' English text with one physically tested Lush 3 or Lush 4, vibration only. Validate reliability, useful synchronisation and voluntary return.

Required beta: individual invitations, TXT/paste, paragraph scoring with corrections, mobile reader, position tracking, explicit device selection, Start/Pause/Stop, intensity ceiling, private feedback and deletion controls. EPUB is optional after core checks. Generation, billing, public publishing, native apps and other brands are deferred.

Implemented locally: reader simulator/manual paragraph levels, invitation sessions, server-side vendor-token issuance and a separate bounded device-check flow. Live SDK/hardware qualification is pending. Scoring, scroll tracking, real story playback, feedback, data-deletion operations and deployment remain unimplemented.

## Architecture

| Component | Responsibility | Current boundary |
| --- | --- | --- |
| Reader | Import and manual paragraph levels; future scoring/position | Story text stays in page memory; simulator output only |
| Device-check page | Invitation, connection and explicit test controls | No story content; authenticated same-origin API calls |
| Sandboxed bridge | Vendor SDK, discovery and bounded targeted commands | No same-origin permission; connection/control messages only |
| FastAPI | Invitation sessions and individual vendor-token issuance | Developer token stays server-side; UID comes from session |
| SQLite | Invites, temporary beta identities, sessions and rate limits | Hashed bearer tokens; no names or story storage |
| Future playback controller | Reading state, ceiling, smoothing and dispatch | Must preserve bridge isolation and interruption rules |

The integration uses the official [Lovense Standard JS SDK](https://developer.lovense.com/docs/standard-solutions/standard-js-sdk) with Lovense Remote as the phone/Bluetooth bridge. Its per-user authentication credential is obtained through the [server token exchange](https://developer.lovense.com/docs/standard-solutions/socket-api). Check current provider contracts and applicable access before live use.

## Implemented authentication contract

- Invitation redemption accepts one token, rejects extra fields and consumes it once within a transaction. Default invitation lifetime is 24 hours; the CLI permits 1–168 hours.
- A successful redemption creates a random temporary beta UID and a session. Session lifetime defaults to one hour; there is no durable-account login or recovery flow yet.
- Session cookies are HttpOnly, SameSite Strict and scoped to `/api`; `Secure` follows the configured HTTPS origin. HTTP is permitted only for local development.
- Authenticated writes require the exact configured Origin and the session's CSRF token. Limits cover invitation attempts and vendor-token issuance. Bodies and vendor responses are bounded.
- Vendor issuance accepts no client UID. It checks authentication again after the external request, so expiry or logout during that request cannot return a usable application response.
- Logout revokes the application session. Existing vendor credentials have no implemented remote revocation guarantee; frontend teardown and finite commands remain necessary.

The SDK is isolated in an opaque-origin iframe. Public module assets permit the cross-origin loading needed by that iframe; API responses do not enable CORS. The top-level reader keeps its vendor-free content policy. Browser tests and live network inspection must verify these boundaries rather than inferring privacy from architecture alone.

## Device-check contract

The current screen performs one explicitly requested test at a time, with one selected eligible Lush device, a maximum level of 5/20 and a two-second duration. Selection must not happen automatically. Stop targets the selected device; never omit the toy ID. Hide, disconnect, logout, selection changes and session expiry must stop or tear down the control path without automatic resumption.

The UI timer and an SDK return value do not prove physical output stopped. Hardware timing and provider behaviour remain release gates. No real-device reading heartbeat is implemented in this phase.

The page uses a Web Lock to prevent another same-origin tab from starting a competing hardware check. Browsers without that capability cannot connect. Continuous story playback will need its own interruption and multi-tab tests.

## Reading-loop contract — planned

Target states: `DISCONNECTED`, `CONNECTING`, `READY_PAUSED`, `PLAYING`, `ERROR_PAUSED`. Leaving `PLAYING` cancels dispatch before attempting targeted Stop. The proposed continuous policy is ceiling 5/20 with two-second nonzero commands refreshed at most once per second while explicitly active, pending provider/hardware validation.

Use stable local section IDs and a small experimental classifier with five ordinal levels including zero. Corrections override predictions; the user ceiling overrides both. Measure false activations and correction burden. Track a stable viewport reading band with hysteresis and retain manual navigation.

Coalesce rapid position changes; discard stale transitions. Story/device/session changes pause output. Tab return, reconnection and progress restoration never resume it. Add inactivity pause and competing-tab handling before real continuous playback. Optional local persistence requires deletion controls.

## API status

| Route | Status and purpose |
| --- | --- |
| `GET /api/health` | Implemented availability/mode status; beta readiness remains false |
| `POST /api/invites/redeem` | Implemented one-use invitation redemption and session cookie |
| `GET /api/me` | Implemented session identity, CSRF token and expiry |
| `POST /api/logout` | Implemented application-session revocation |
| `POST /api/lovense/session` | Implemented authenticated exchange; unavailable in simulator mode |
| `POST /api/feedback`, `POST /api/events` | Planned bounded feedback and allowlisted coarse events |
| `DELETE /api/me` | Planned data removal and access revocation |

Implemented tables: `beta_users`, `invites`, `sessions`, `rate_limits`. Planned feedback/entitlement tables must use bounded records and idempotency. Expired session/invite rows, old rate buckets and users without sessions are pruned opportunistically during writes; idle databases are not purged by a scheduled job. Finish explicit retention/deletion before external beta operations.

## Remaining release criteria

- Useful automatic synchronisation with an authoritative ceiling and predictable corrections.
- Measured physical stop/expiry, no wrong-device commands and no cross-user control.
- No story text in logs, requests, URLs, analytics, feedback defaults or vendor code.
- Feedback remains reachable after a failed session; duplicate submissions do not duplicate rewards.
- HTTPS deployment, production cookie/proxy settings, access limits, backup/restore and rollback.

Follow the [roadmap](beta-roadmap.md), [hardware setup](hardware-check.md) and [QA gates](qa.md). The local reload server is not a production configuration.
