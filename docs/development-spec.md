# Development specification

Technical snapshot: 28 October 2026. Implemented code, verified evidence and planned features are distinct below.

## Goal and scope

Synchronise adults' English text with one physically tested Lush 3 or Lush 4, vibration only. Validate reliability, useful synchronisation and voluntary return.

Required beta: individual invitations, TXT/paste, paragraph scoring with corrections, mobile reader, position tracking, explicit device selection, Start/Pause/Stop, intensity ceiling, private feedback and deletion controls. EPUB is optional after core checks. Generation, billing, public publishing, native apps and other brands are deferred.

Implemented locally: experimental paragraph suggestions, separate manual overrides, settled scroll-following/manual navigation, a bounded simulator playback controller, invitation sessions, server-side vendor-token issuance and a separate device-check flow. Suggestion usefulness and live SDK/hardware qualification remain unproven. Real story playback, feedback, data-deletion operations and deployment remain unimplemented.

## Approved frontend direction and next phase

On 28 October 2026, Satin Editorial was selected as the main light identity, with Midnight Ink as the dark theme and a Light/Dark/System preference. The [frontend implementation specification](frontend-design.md) defines semantic tokens, screen/state coverage, responsive control placement and acceptance criteria. These requirements are approved design work, not a claim that the current UI implements them.

Complete the beta software journey against simulated devices before hardware is available. No physical device or vendor credential is required for themes, import/review/reading, connection-state simulation, corrections, local feedback/deletion, or scoring evaluation. Use the [F1–F6 roadmap](beta-roadmap.md) as the immediate work order. Real-device integration and operational release remain separately gated.

Keep the current `[0, 1, 2, 3, 5]` suggestion mapping. A proposed 0–4 display scale must not silently increase output or discard arbitrary manual corrections. Earlier exploratory mockups that imply `[0, 5, 10, 15, 20]` are superseded by this conservative mapping requirement.

The current continuous controller is synchronous. Rich asynchronous simulation and eventual real transport require explicit cancellation/epoch, timeout, stale-response and output-certainty contracts; they cannot be added by simply supplying a Promise-returning adapter. UI output may be unknown after an uncertain command/Stop outcome.

Algorithm work starts with a local, versioned benchmark and measured errors. Local processing remains the default; hosted classification needs a separate provider-permission and data-handling decision before any text transfer. Analysis never starts output, overrides a manual correction or bypasses the independent ceiling. See [scoring requirements](frontend-design.md#scoring-and-output-semantics).

## Architecture

| Component | Responsibility | Current boundary |
| --- | --- | --- |
| Reader | Import, suggestions, overrides and settled reading position | Story text stays in page memory; simulator output only |
| Device-check page | Invitation, connection and explicit test controls | No story content; authenticated same-origin API calls |
| Sandboxed bridge | Vendor SDK, discovery and bounded targeted commands | No same-origin permission; connection/control messages only |
| FastAPI | Invitation sessions and individual vendor-token issuance | Developer token stays server-side; UID comes from session |
| SQLite | Invites, temporary beta identities, sessions and rate limits | Hashed bearer tokens; no names or story storage |
| Simulator playback controller | State, ceiling, cadence, inactivity and interruption rules | Synchronous mock adapter only; real transport is not wired |

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

## Reading-loop contract — simulator implemented

The reader accepts pasted/UTF-8 TXT content up to 500,000 bytes and 2,000 paragraphs. Each load creates a new local document identity and paragraph IDs; IDs remain stable within that load. Text, predictions and corrections are memory-only. Invalid input does not partially replace the existing model, but attempting a replacement pauses playback.

The experimental English scorer requires a contact cue and a separate context cue, counting distinct concepts rather than repeated words. Broad negation/metalinguistic cues force zero. Five ordinal bands map to suggested levels **0, 1, 2, 3 and 5 out of 20**. This is a small keyword heuristic, not semantic understanding, language detection, consent classification or proof of synchronisation quality. False positives and false negatives need evaluation.

Each paragraph stores its prediction separately from a nullable manual override. Overrides accept integer levels 0–20; **zero is a real override**. Use suggestion clears only that override. Loading a replacement or clearing removes all previous predictions/corrections. The user ceiling overrides the effective paragraph level.

The scrollable reader uses a band at 35% of its viewport, a 180 ms settling delay and 24 px boundary hysteresis. Large gaps without a nearby candidate produce no position selection. Follow-scroll can be disabled; Previous/Next remains the manual fallback. Font or window-size changes pause playback before position is recalculated. No programmatic reflow resumes it.

The controller states are `DISCONNECTED`, `READY_PAUSED`, `PLAYING` and `ERROR_PAUSED`. Start requires a connected simulator, text and a visible page. Nonzero commands have a two-second duration and are dispatched no faster than once per second. Intermediate desired levels are coalesced; they are not replayed later. A reduction below current output immediately sends Stop, then a later normal tick may apply the latest bounded level. The default ceiling is 5/20; the simulator ceiling control permits 0–20.

Stop, hide, disconnect, story replacement and errors cancel scheduled dispatch. Two minutes without reading activity pauses output; a delayed playback timer also pauses instead of reviving an expired command. Returning, reconnecting, editing a level or restoring visibility never starts playback automatically. A Web Lock permits one playing simulator window per exact origin in the same browser profile. Browsers without that capability can still read/edit but cannot start playback. The reader's lock is separate from the hardware-check lock.

The controller explicitly supports the synchronous simulator contract only. Its tests and UI output are not a qualification of asynchronous real transport or physical stopping. Connecting it to the real bridge requires a separate adapter/controller integration and physical acceptance tests. Story-to-device control remains disabled. Optional local persistence still requires deletion controls.

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

Start with [today's hardware-free checks](test-today.md), then follow the [roadmap](beta-roadmap.md), [hardware setup](hardware-check.md) and [QA gates](qa.md). The local reload server is not a production configuration.
