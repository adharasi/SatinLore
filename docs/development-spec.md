# Development specification

Technical snapshot: 29 October 2026; approved frontend specification v1.2. Implemented code, verified evidence and planned features are distinct below.

## Goal and scope

Synchronise adults' English text with one physically tested Lush 3 or Lush 4, vibration only. Validate reliability, useful synchronisation and voluntary return.

Required beta: individual invitations, approved light/dark frontend, TXT/paste, paragraph scoring with corrections, mobile reader, position tracking, explicit device selection, Start/Pause/Stop, intensity ceiling, opt-in local progress, private feedback and deletion controls. EPUB is optional after core checks. Generation, billing, public publishing, native apps and other brands are deferred.

Implemented locally: the Satin Editorial/Midnight Ink saved-story workspace with Light/Dark/System, direct continuous reading, background local scoring, optional corrections, collapsible library/settings, reading widths and focus mode. Explicit local saving retains opted-in stories, corrections and progress; restores are paused. Session strength and Start/ceiling confirmations sit above the existing bounded simulator. Invitation sessions, server-side vendor-token issuance and the separate device-check flow remain. Suggestion usefulness and live SDK/hardware qualification are unproven. Real story playback, feedback, server account-data deletion and deployment remain unimplemented.

The 29 October workspace revision replaces compulsory Add → Review → Read and brings opt-in story persistence into the current frontend milestone. The software-first approach continues with simulation. Hardware availability is not a prerequisite for frontend, application or algorithm work. The [roadmap](beta-roadmap.md) separates software gates S1/S2 from later hardware and release gates H1/H2. F1/F2 do not constitute a complete software beta.

## Architecture

| Component | Responsibility | Current boundary |
| --- | --- | --- |
| Reader | Story library, continuous reading, background suggestions, optional corrections and settled position | Session-only by default; simulator output only |
| Local story store | Explicitly saved title/text, corrections, analysis version and progress; rename/delete | Browser-local, bounded/versioned, no cloud backup or armed playback state |
| Appearance | Shared semantic themes, pre-paint preference resolution and OS changes | `satinlore.appearance` with `system`, `light` or `dark`; separate from story storage |
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

The reader accepts pasted/UTF-8 TXT content up to 500,000 bytes and 2,000 paragraphs. A new story opens directly into reading; it does not replace another library story or require review. Invalid input leaves existing stories intact. Stable local identities separate each story and its paragraphs. Background analysis is cancellable and cannot apply to a different story generation. Text stays session-only until explicit local-save consent. Story switching/deletion and interrupted imports invalidate stale work and leave playback paused.

The experimental English scorer requires a contact cue and a separate context cue, counting distinct concepts rather than repeated words. Broad negation/metalinguistic cues force zero. Five ordinal bands map to suggested levels **0, 1, 2, 3 and 5 out of 20**. This is a small keyword heuristic, not semantic understanding, language detection, consent classification or proof of synchronisation quality. False positives and false negatives need evaluation.

Each paragraph stores its prediction separately from a nullable manual override. Overrides accept integer levels 0–20; **zero is a real override**. Use suggestion clears only that override. Reanalysis preserves deliberate corrections. Pending/failed/invalid analysis leaves the affected automatic mapping at zero; Start requires a valid story mapping. Optional review initially exposes only current/already-read sections, with a deliberate action to reveal upcoming sections.

Session strength starts at **1.0×**, ranges from **0.0× to 2.0×** in **0.1×** steps, and does not rewrite section suggestions or corrections. Choose the manual override if present, otherwise the valid suggestion. The target is `min(confirmedCeiling, floor(baseLevel × strengthTenths / 10))`; integer tenths avoid floating-point drift and rounding down avoids silently increasing the requested scaled level. Manual and automatic zero remain zero. Display both strength and the resulting capped target. Strength persists across paragraph changes, Pause/Stop and reconnect, and resets on story switch or reload; it is never saved.

The reader uses continuous document scrolling, a 180 ms settling delay and 24 px boundary hysteresis. Reading-position measurement accounts for the visible reading area and the bottom dock. Large gaps without a nearby candidate produce no position selection. Follow-scroll can be disabled; Previous/Next remains the manual fallback. Font, appearance or window-size changes preserve the selected paragraph and pause playback before repositioning. No programmatic reflow resumes it.

The controller states are `DISCONNECTED`, `READY_PAUSED`, `PLAYING` and `ERROR_PAUSED`. Start requires a connected simulator, a current valid story mapping, a visible page and explicit confirmation showing the selected simulator, strength and ceiling. Review is not a gate. Nonzero commands have a two-second duration and are dispatched no faster than once per second. Intermediate desired levels are coalesced; they are not replayed later. A reduction below current output immediately sends Stop, then a later normal tick may apply the latest bounded level. The default ceiling is 5/20; the simulator ceiling control permits 0–20. Lowering it applies immediately, including zero. Raising it pauses output and requires a separate confirmation against the previously shown ceiling; a stale confirmation cannot silently raise the limit. Strength + never changes the ceiling. Every Start/resume uses an explicit confirmation, and Stop cancels pending confirmation or ownership acquisition.

Stop, hide, disconnect, story switching/deletion and errors cancel scheduled dispatch. Two minutes without reading activity pauses output; a delayed playback timer also pauses instead of reviving an expired command. Returning, reconnecting, editing a level or restoring visibility never starts playback automatically. A Web Lock permits one playing simulator window per exact origin in the same browser profile. Browsers without that capability can still read/edit but cannot start playback. The reader's lock is separate from the hardware-check lock.

The controller explicitly supports the synchronous simulator contract only. Its tests and UI output are not a qualification of asynchronous real transport or physical stopping. Connecting it to the real bridge requires a separate adapter/controller integration and physical acceptance tests. Story-to-device control remains disabled. Local story persistence includes deletion controls; server account-data deletion is separate and remains planned.

## Workspace, appearance and storage contract

The workspace has a collapsible library on the left, a continuous document reader and optional settings on the right, closed initially. Wide is the default maximum reading width, with Comfortable and Full alternatives; all shrink to the available phone viewport. Focus closes both panels while keeping the transport visible and restores the prior arrangement on exit. Below desktop width, panels become drawers/sheets rather than forcing a narrow three-column layout. Opening settings/review or reflow pauses output and preserves the selected section; manual Previous/Next remains available.

Start/Pause/Stop, session strength, confirmed maximum, simulator status and capped output remain reachable outside optional settings. Confirmation dialogs expose Stop. Theme, width, font, panel and focus changes cannot start playback or alter the stored correction. See [frontend-design.md](frontend-design.md) for the shared palette and acceptance matrix.

Appearance defaults to System. The blocking same-origin script resolves the theme before styles paint and sets native `color-scheme`. Explicit Light/Dark overrides OS changes; System follows them. Only the allowlisted appearance string is stored in `satinlore.appearance`, separate from stories. Storage failure leaves appearance and reading usable.

New stories are **Session only**. **Save on this browser** explicitly opts the selected story into local persistence, including text, title, paragraph corrections, analysis version and position. Saving does not retain strength, ceiling, connection, pending confirmations or playback arming. Reload/reopen is always paused; local data is not encrypted account storage, cloud sync or backup and is visible to other users of the same browser profile. Browser clearing can remove it.

Save/rename/progress updates report actual outcomes. Storage unavailable, full, malformed or stale data must never fabricate success or make the in-memory story unreadable. Delete story removes its persisted text/corrections/progress; Delete all removes retained stories while appearance remains separate. Session-only data must not be silently saved by renaming, navigating or closing a tab. No private text/title is sent to backend, vendor, analytics, URLs or routine logs. The test guide records exact user-facing controls and failure checks.

The current store uses local-storage key `satinlore.library.v1`, schema version 1, and serialises writes/deletes with the `satinlore-local-library` Web Lock. It permits at most 20 saved stories and 2,000,000 UTF-8 bytes for the complete JSON envelope, in addition to the per-story import limits; the workspace also limits open stories to 20 and titles to 120 characters. The record allowlist is `id`, `title`, `text`, nullable/integer `corrections`, `position`, `analysisVersion`, `updatedAt` and `revision`. Predictions are recomputed locally after restoration rather than trusted from storage. Extra fields, including strength, ceiling, credentials and playback state, are ignored on reading and never retained in a new write.

Expected revisions prevent stale autosaves from recreating deleted or overwriting changed stories. A library change in another tab pauses playback and requests reload; an outdated tab cannot silently overwrite a newer saved revision. Corrupt entries remain stored for explicit recovery; valid entries can remain readable, but writes and individual deletion are blocked until the user chooses Delete all to clear the corrupt store. Delete all can remove even an unreadable envelope. Do not silently discard unreadable data. Browser quota can be lower than the application cap, and private-browser settings can deny access. Saving/deleting and simulator ownership require Web Locks; without them, session-only reading remains available and persistence reports the unsupported operation.

Existing authentication remains on the separate device-check page; the normal reader is not an authenticated account experience. This phase does not add hosted AI, feedback APIs, account deletion or a deeper asynchronous device simulator. Screenshots and responsive emulation establish layout evidence only for the tested browser/build.

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
