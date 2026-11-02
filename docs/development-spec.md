# Development specification

Technical snapshot: 2 November 2026; workspace specification v1.2 with the authorised direct-editor, import, folder and setup refinement. Implemented code, verified evidence and planned features are distinct below.

## Goal and scope

Synchronise adults' English text with one physically tested Lush 3 or Lush 4, vibration only. Validate reliability, useful synchronisation and voluntary return.

Required beta: individual invitations, approved light/dark frontend, typed/pasted/uploaded stories and deliberate supported-site import, paragraph scoring with corrections, mobile reader, position tracking, explicit device selection, Start/Pause/Stop, intensity ceiling, opt-in local progress/folders, guided practice, private feedback and deletion controls. EPUB is optional after core checks. Generation, billing, public publishing, native apps and other brands are deferred.

Implemented locally: the Satin Editorial/Midnight Ink saved-story workspace with Light/Dark/System, direct continuous reading, background local scoring, optional corrections, collapsible library/settings, reading widths and focus mode. Explicit local saving retains opted-in stories, corrections and progress; restores are paused. Session strength, a direct maximum slider and confirmed Start sit above the existing bounded simulator. The 2 November user request replaces the reader's separate ceiling-raise popup; the async lab and local hardware-check contract remain separate. Invitation sessions, server-side vendor-token issuance and the separate device-check flow remain. Suggestion usefulness and live SDK/hardware qualification are unproven. Real story-to-device playback and algorithm qualification remain outstanding. Hosted private feedback, feedback export/deletion and help are implemented; these do not erase a Cloudflare identity or browser stories. A separate founder-only Cloudflare Worker hosts the simulator reader; signed-in Access and live control checks were recorded for release `376d3049c028` on 1 November. Each later release still needs its own deployment/acceptance evidence. Its Access team/audience and enable flag are configured at runtime in the Cloudflare dashboard and preserved across repository deployments; the Python backend remains local.

The 29 October workspace revision replaces compulsory Add → Review → Read and brings opt-in story persistence into the current frontend milestone. The software-first approach continues with simulation. Hardware availability is not a prerequisite for frontend, application or algorithm work. The [roadmap](beta-roadmap.md) separates software gates S1/S2 from later hardware and release gates H1/H2. F1/F2 do not constitute a complete software beta.

## Architecture

| Component | Responsibility | Current boundary |
| --- | --- | --- |
| Reader | Story library, continuous reading, background suggestions, optional corrections and settled position | Session-only by default; simulator output only |
| Local story store | Explicitly saved title/text, corrections, analysis version, progress and folder membership; folder catalogue/rename/delete | Browser-local, bounded/versioned, no cloud backup or armed playback state |
| Deliberate story import | Public AO3 work/chapter link fetch and text extraction; local text/AO3 HTML import | Authenticated hosted endpoint; strict source allowlist, bounded transient content, no credentials/server story retention; copy/upload fallback elsewhere |
| Setup and visualisation | Explicit simulator connect, neutral practice and actual-output graphic/trace | No real-device setup or automatic Start; reduced-motion alternative |
| Appearance | Shared semantic themes, pre-paint preference resolution and OS changes | `satinlore.appearance` with `system`, `light` or `dark`; separate from story storage |
| Device-check page | Invitation, connection and explicit test controls | No story content; authenticated same-origin API calls |
| Sandboxed bridge | Vendor SDK, discovery and bounded targeted commands | No same-origin permission; connection/control messages only |
| FastAPI | Invitation sessions and individual vendor-token issuance | Developer token stays server-side; UID comes from session |
| SQLite | Invites, temporary beta identities, sessions and rate limits | Hashed bearer tokens; no names or story storage |
| Hosted private services | Verified Access identity, private feedback, export and confirmed feedback deletion | SQLite Durable Object; no automatic story context, email or JWT storage |
| Async transport lab | Explicit fake-device selection and deterministic failure/recovery scenarios | Separate experimental controller, no real transport or reader story input |
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

The reader accepts typed/pasted/UTF-8 text content up to 500,000 bytes and 2,000 paragraphs. The blank page is a directly typable editor with a title field and an explicit action to open the draft for reading; upload and link import remain distinct right-sidebar actions. A new story opens directly into reading; it does not replace another library story or require review. Invalid input leaves existing stories intact. Stable local identities separate each story and its paragraphs. Background analysis is cancellable and cannot apply to a different story generation. Text stays session-only until explicit local-save consent. Story switching/deletion and interrupted imports invalidate stale work and leave playback paused.

The experimental English scorer requires a contact cue and a separate context cue, counting distinct concepts rather than repeated words. Broad negation/metalinguistic cues force zero. Five ordinal bands map to suggested levels **0, 1, 2, 3 and 5 out of 20**. This is a small keyword heuristic, not semantic understanding, language detection, consent classification or proof of synchronisation quality. False positives and false negatives need evaluation.

Each paragraph stores its prediction separately from a nullable manual override. Overrides accept integer levels 0–20; **zero is a real override**. Use suggestion clears only that override. Reanalysis preserves deliberate corrections. Pending/failed/invalid analysis leaves the affected automatic mapping at zero; Start requires a valid story mapping. Optional review initially exposes only current/already-read sections, with a deliberate action to reveal upcoming sections.

Session strength starts at **1.0×**, ranges from **0.0× to 2.0×** in **0.1×** steps, and does not rewrite section suggestions or corrections. Choose the manual override if present, otherwise the valid suggestion. The target is `min(confirmedCeiling, floor(baseLevel × strengthTenths / 10))`; integer tenths avoid floating-point drift and rounding down avoids silently increasing the requested scaled level. Manual and automatic zero remain zero. Display both strength and the resulting capped target. Strength persists across paragraph changes, Pause/Stop and reconnect, and resets on story switch or reload; it is never saved.

The reader uses continuous document scrolling, a 180 ms settling delay and 24 px boundary hysteresis. Reading-position measurement accounts for the visible reading area and the bottom dock. Large gaps without a nearby candidate produce no position selection. Follow-scroll can be disabled; Previous/Next remains the manual fallback. Font, appearance or window-size changes preserve the selected paragraph and pause playback before repositioning. No programmatic reflow resumes it.

The controller states are `DISCONNECTED`, `READY_PAUSED`, `PLAYING` and `ERROR_PAUSED`. Start requires a connected simulator, a current valid story mapping, a visible page and explicit confirmation showing the selected simulator, strength and ceiling. Review is not a gate. Nonzero commands have a two-second duration and are dispatched no faster than once per second. Intermediate desired levels are coalesced; they are not replayed later. A reduction below current output immediately sends Stop, then a later normal tick may apply the latest bounded level. The default ceiling is 5/20; the simulator ceiling control permits 0–20. Lowering it applies immediately, including zero. The user's direct slider input updates the ordinary reader simulator's maximum without an interrupting popup or automatic restart; increases remain bounded and use normal dispatch cadence. Programmatic/stale work must not raise the maximum. Strength + never changes the ceiling. Every Start/resume uses an explicit confirmation, and Stop cancels pending confirmation or ownership acquisition.

Stop, hide, disconnect, story switching/deletion and errors cancel scheduled dispatch. Two minutes without reading activity pauses output; a delayed playback timer also pauses instead of reviving an expired command. Returning, reconnecting, editing a level or restoring visibility never starts playback automatically. A Web Lock permits one playing simulator window per exact origin in the same browser profile. Browsers without that capability can still read/edit but cannot start playback. The reader's lock is separate from the hardware-check lock.

The controller explicitly supports the synchronous simulator contract only. Its tests and UI output are not a qualification of asynchronous real transport or physical stopping. Connecting it to the real bridge requires a separate adapter/controller integration and physical acceptance tests. Story-to-device control remains disabled. Local story persistence includes deletion controls; server account-data deletion is separate and remains planned.

## Workspace, appearance and storage contract

The workspace has a collapsible folder/story library on the left, a continuous document reader and optional Reading controls on the right, closed initially. Global Settings opens from a separate gear and contains appearance, account status, backup/restore, about, help and support. The current-reader sidebar contains import/upload, model choice, Reader/Story controls and optional corrections. Wide is the default maximum reading width, with Comfortable and Full alternatives; all shrink to the available phone viewport. Focus closes both panels while keeping the transport visible and restores the prior arrangement on exit. Below desktop width, panels become drawers/sheets rather than forcing a narrow three-column layout. Opening settings/review or reflow pauses output and preserves the selected section; manual Previous/Next remains available.

Start/Pause/Stop, session strength, the chosen maximum, simulator status and capped output remain reachable outside optional settings. Confirmation dialogs expose Stop. Theme, width, font, panel and focus changes cannot start playback or alter the stored correction. See [frontend-design.md](frontend-design.md) for the shared palette and acceptance matrix.

Appearance defaults to System. The blocking same-origin script resolves the theme before styles paint and sets native `color-scheme`. Explicit Light/Dark overrides OS changes; System follows them. Only the allowlisted appearance string is stored in `satinlore.appearance`, separate from stories. Storage failure leaves appearance and reading usable.

New stories are **Session only**. **Save on this browser** explicitly opts the selected story into local persistence, including text, title, paragraph corrections, analysis version and position. Saving does not retain strength, ceiling, connection, pending confirmations or playback arming. Reload/reopen is always paused; local data is not encrypted account storage, cloud sync or backup and is visible to other users of the same browser profile. Browser clearing can remove it.

Save/rename/progress updates report actual outcomes. Storage unavailable, full, malformed or stale data must never fabricate success or make the in-memory story unreadable. Delete story removes its persisted text/corrections/progress; Delete all removes retained stories while appearance remains separate. Session-only data must not be silently saved by renaming, navigating or closing a tab. No local draft, uploaded text or saved story is sent to backend, vendor, analytics, URLs or routine logs. Deliberate AO3 link import is the narrow exception described below: the authenticated service fetches/extracts a requested public source transiently and returns text without retaining it. The test guide records exact user-facing controls and failure checks.

The current store uses local-storage key `satinlore.library.v1`, schema version 1, and serialises writes/deletes with the `satinlore-local-library` Web Lock. It permits at most 20 saved stories and 2,000,000 UTF-8 bytes for the complete JSON envelope, in addition to the per-story import limits; the workspace also limits open stories to 20 and titles to 120 characters. The record allowlist includes `id`, `title`, `text`, nullable/integer `corrections`, `position`, `analysisVersion`, `updatedAt`, `revision` and optional folder membership. The envelope may contain a bounded folder catalogue. Legacy stories remain readable; unknown fields never become playback state. Predictions are recomputed locally after restoration rather than trusted from storage. Extra fields, including strength, ceiling, credentials and playback state, are ignored on reading and never retained in a new write.

Folders share the same envelope and Web Lock as stories. At most 30 folders with names of up to 60 characters are allowed; trimmed/normalised duplicate names are rejected. Create/rename/delete explicitly persists the catalogue. An unsaved story's assignment stays in memory until Save on this browser; a saved story's assignment follows normal revision-checked saving. Deleting a folder moves its saved stories to Unfiled atomically rather than deleting them. Delete all clears both stories and the catalogue. Portable backups deliberately omit local folder IDs and restore stories to Unfiled.

Expected revisions prevent stale autosaves from recreating deleted or overwriting changed stories. A library change in another tab pauses playback and requests reload; an outdated tab cannot silently overwrite a newer saved revision. Corrupt entries remain stored for explicit recovery; valid entries can remain readable, but writes and individual deletion are blocked until the user chooses Delete all to clear the corrupt store. Delete all can remove even an unreadable envelope. Do not silently discard unreadable data. Browser quota can be lower than the application cap, and private-browser settings can deny access. Saving/deleting and simulator ownership require Web Locks; without them, session-only reading remains available and persistence reports the unsupported operation.

The hosted reader is protected by Cloudflare Access, while the separate local device-check page uses invitation sessions. Neither is a durable reader-account/cloud-story-sync experience. This phase does not add hosted AI, local Python feedback/account endpoints. The separate hosted Worker implements private feedback/data operations, and the founder lab implements deterministic asynchronous scenarios. Screenshots and responsive emulation establish layout evidence only for the tested browser/build.

## Deliberate source import contract

The hosted `POST /api/story-import` route accepts a deliberately submitted public AO3 work/chapter URL. It requires the same verified Access identity and exact-origin JSON request boundary as the private app. The service validates HTTPS, canonical allowed hosts/paths, at most two redirects and a 10-second server deadline. The JSON request is capped at 4,096 bytes and its URL at 2,048 characters; upstream HTML is capped at 2,000,000 bytes and extracted text at 500,000 bytes / 2,000 paragraphs. The client also cancels after 15 seconds, and session expiry is checked again before returning story text. It forwards no browser cookies, login credentials or reader text, stores no story, executes no source scripts and reports restricted/blocked/unsupported pages as errors. Work URLs request the full work; chapter URLs import that chapter. It must not click an adult-content confirmation, bypass login or evade a site's bot controls.

AO3's downloaded UTF-8 HTML (up to 2,000,000 source bytes) can also be opened locally without executing scripts or loading page resources, subject to the same extracted-text limits; text upload and direct paste remain available. Literotica and other sites have a source-page/copy/upload fallback, not a claim of automatic scraping. Users should import only material they are entitled to use. [OTW explains AO3's built-in download formats](https://www.transformativeworks.org/why-ao3-doesnt-have-an-official-app/); [Literotica's current content-use terms](https://www.literotica.com/resources/tos) are why the current implementation provides a manual fallback there. The supported-site UI and API must tell the same story. Successful neutral parser fixtures do not establish current live-site availability.

## Setup, simulator view and future models

The guided setup journey explicitly selects/connects the simulator, opens a neutral practice story and lets the reader try Start/Stop, strength, maximum and scroll following before opening personal material. It can be skipped or repeated; no completion flag or calibration settings are persisted. Every Start still uses the ordinary confirmation; changing a setup step, closing/cancelling it or switching story leaves playback paused. A visible simulator graphic and bounded recent trace follow actual output snapshots, not predictions or target values. Reduced motion removes vibration movement while retaining a readable level/state.

The active baseline model is the existing experimental local scorer. The stronger custom model and intended multi-toy/dual-area capabilities are labelled unavailable future development, with a future paid tier as product direction only. There is no payment flow, entitlement enforcement, new inference model or additional hardware integration in this revision. Durable login, recovery and account-linked cloud story storage are explicitly backlogged for the testing phase; do not imply that browser saving is tied to the Access sign-in.

## API status

| Route | Status and purpose |
| --- | --- |
| `GET /api/health` | Implemented availability/mode status; beta readiness remains false |
| `POST /api/invites/redeem` | Implemented one-use invitation redemption and session cookie |
| `GET /api/me` | Implemented session identity, CSRF token and expiry |
| `POST /api/logout` | Implemented application-session revocation |
| `POST /api/lovense/session` | Implemented authenticated exchange; unavailable in simulator mode |
| Hosted `POST /api/story-import` | Deliberate public AO3 source fetch/extraction; authenticated, same-origin and bounded; no story retention |
| Hosted `GET/POST /api/feedback` | Implemented bounded, authenticated private feedback with idempotency; coarse events are not enabled |
| Hosted `GET /api/my-data`, `POST /api/my-data/delete` | Own feedback export and confirmed live deletion; separate from identity/browser/waitlist data |
| `DELETE /api/me` | Not a hosted account-deletion endpoint; Access identity and local invitation sessions remain separate |

Implemented tables: `beta_users`, `invites`, `sessions`, `rate_limits`. Planned feedback/entitlement tables must use bounded records and idempotency. Expired session/invite rows, old rate buckets and users without sessions are pruned opportunistically during writes; idle databases are not purged by a scheduled job. Finish explicit retention/deletion before external beta operations.

## Remaining release criteria

- Useful automatic synchronisation with an authoritative ceiling and predictable corrections.
- Measured physical stop/expiry, no wrong-device commands and no cross-user control.
- No story text in logs, URLs, analytics, feedback defaults or vendor code; no automatic upload of local drafts/saved stories. The deliberate supported-source import service remains bounded and transient.
- Feedback remains reachable after a failed session; duplicate submissions do not duplicate rewards.
- HTTPS deployment, production cookie/proxy settings, access limits, backup/restore and rollback.

Start with [today's hardware-free checks](test-today.md), then follow the [roadmap](beta-roadmap.md), [hardware setup](hardware-check.md) and [QA gates](qa.md). The local reload server is not a production configuration.
