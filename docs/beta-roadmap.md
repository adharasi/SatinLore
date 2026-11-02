# Beta roadmap — frontend, simulation, hardware

Approved workspace revision: 29 October 2026 (frontend specification v1.2), refined by the 2 November editor/import/folder/setup request. Build the software experience with simulated devices first; hardware availability does not block frontend, application or scoring work. The former device-first 48–72-hour release target is superseded. Completion requires evidence, not a date or screenshot.

There are separate gates: **S** for the software experience and **H** for physical device qualification and release. The reader remains simulator-only. Passing S does not pass H, and the full software beta still needs the remaining milestones below.

## Private hosting decision — 1 November 2026

The product owner has requested `app.satinlore.com` behind founder-only Cloudflare Access. A separate static-reader Worker provides this simulator preview without enabling the local Python invitation/vendor backend or weakening its local-origin restrictions. The adapter validates a dedicated Access token before every asset; failed or expired hosted access stops simulated playback and blocks Start. This request supersedes the earlier workspace milestone's no-deployment scope for this private preview only. It does not pass hardware qualification or the full software-beta gates.

The one-time owner-side dashboard setup is complete and automatic Git deployment succeeded for release `376d3049c028`; the evidence ledger records its live checks. Access team/audience and the enable/pause flag remain dashboard-owned and survive later source deployments. Deployment configuration and operational verification are recorded in [the Cloudflare runbook](../deploy/cloudflare/README.md). A committed adapter is not evidence that DNS, Access or a live deployment has been provisioned.

## Existing baseline

The local FastAPI/static ES-module application includes TXT/paste import, stable paragraphs, experimental local suggestions, manual corrections, scroll tracking, finite/coalesced simulator playback, a ceiling, explicit Start and interruption/tab-ownership rules. SQLite-backed one-use invitations and expiring sessions support a separate sandboxed device-check screen. New stories stay session-only until an explicit local-save choice. Live SDK compatibility, continuous real-device reading, broader beta release and physical qualification remain outstanding; the founder-only simulator deployment is live.

## F1 — approved themes and reader foundation

Satin Editorial light, Midnight Ink dark and Light/Dark/System appearance are implemented using shared tokens and local fonts. The appearance preference is separate from story storage. The 28 October Add → Review → Read implementation is retained in the evidence ledger as historical work; it is superseded by the workspace below.

## Workspace v2 — direct reading and saved stories

**Implementation status:** the workspace is implemented; the evidence ledger distinguishes each revision's source publication, automated checks, browser review and hosting state. The evidence ledger distinguishes these checks from remaining manual usability and hardware qualification.

The 29 October decision moves the next frontend milestone ahead of the deeper F3 transport harness. Implement a collapsible library, continuous reading canvas and optional right settings panel, closed initially. Wide is the default; Comfortable/Full and Focus let the reader use the available window. Phone/tablet layouts use drawers/sheets while keeping controls reachable. Review is optional, shows current/already-read sections first and requires a deliberate reveal of future sections.

Added stories open directly for reading while local analysis runs in the background. Valid analysis gates device Start, not silent reading or review. Keep generation cancellation, invalid/uncertain zero, manual-zero overrides and correction-preserving reanalysis. Explicit **Save on this browser** retains text/title, corrections, analysis version and progress; **Session only** remains the default. Rename, delete one/all and truthful storage-failure states are part of this milestone. Restoration stays paused and never retains an armed session.

Persistent −/+ adjusts session strength from 0.0× to 2.0× in 0.1× steps, initially 1.0×. Apply it to the section base without rewriting corrections, round down to a whole level, then cap at the confirmed ceiling. Start explicitly confirms the selected simulator, strength and maximum. Lower/zero ceilings apply immediately. Under the 2 November user request, a direct maximum-slider gesture updates the ordinary reader simulator without a separate popup or automatic restart; Start still confirms the current maximum. The async lab/hardware-check contracts remain separate. Stop remains immediate and reachable in overlays.

This brought the local-persistence part of F4 into the workspace implementation. The deeper F3 failure harness and private hosted feedback/support/data journeys were subsequently implemented on 1 November; durable reader accounts/cloud story storage remain future work. Exact implementation, storage boundaries and controls are described in the [specification](development-spec.md) and [frontend design](frontend-design.md).

**Gate S1-v2:** use [test-today.md](test-today.md) for direct reading without compulsory review, cancelled/stale background work, two-story switching, opt-in save/paused restore, delete one/all and storage failures. Verify Start confirmation cancellation, direct nonblocking maximum changes, strength bounds/rounding, manual and automatic zero, lower/zero ceiling, Stop, hidden-tab return and no automatic resume. Inspect both themes at 390 × 844 and 1440 × 1000, 320 CSS px, landscape and 200% text. Record actual browser/build; an emulated mobile viewport is not a physical phone result. The evidence ledger owns pass/unverified status.

## Reader refinement — 2 November 2026

The requested implementation adds a directly typable blank page, natural story/import copy, right-sidebar upload and deliberate AO3 link import, local folders, a separate global gear menu, favicon, an actual-output simulator graphic and a guided practice journey. The baseline model remains the current local scorer; the stronger custom/multi-toy/dual-area tier is shown as unavailable future development. No new inference model, hardware integration, billing or account cloud sync is implied by the selector.

Folder names/catalogue persist only through explicit folder actions; moving an unsaved story does not save its text. Saved folder membership shares the existing revision-checked local store and Web Lock. Delete folder moves its stories to Unfiled. Portable backups deliberately restore to Unfiled, with fresh session-only identities and no playback arming.

AO3 public work/chapter URLs use a bounded, authenticated hosted import service; local AO3 HTML is extracted inertly in the browser. Literotica and other platforms use open-source-page/copy/upload fallback rather than unqualified automatic scraping. Blocked/restricted sites must stay blocked. URL import is explicit, transient and separate from browser-local drafts or saved text.

**Acceptance work:** test direct typing/paste, supported-link success/error/cancellation, inert HTML upload, folder creation/rename/delete and paused reload, gear-menu discoverability, both themes, strength interaction and popup-free maximum changes. The guided simulator journey must explicitly connect, open neutral practice, expose actual changing output while reading, track the practice actions honestly, and stay paused on exit/skip/story change. Reduced motion must retain clear feedback without vibration movement. Add actual browser/build results to the evidence ledger after execution; this scope description is not a release pass.

**Backlog requested for later testing:** durable account login/recovery, per-account cloud story storage/sync, invitation roles, custom-model inference and paid entitlements. Implement account isolation, retention/deletion and migration before relying on account storage. Implement/evaluate the stronger model before advertising multi-toy or dual-area control as available. The current founder-only Access gate remains in place.

## F3 — deterministic device scenarios and transport contract

**Implemented, 1 November 2026.** `/simulator-lab` exercises 11 named scenarios with a manually advanced virtual clock and explicitly selected fake devices. The separate `playback/async-controller.mjs` contract covers empty/unsupported/multiple devices, failed/delayed/timed-out connection, cancellation, disconnect, delayed/wrong/missing acknowledgements, failed Stop, stale work, bounded coalescing and recovery. Native dialog cancellation invalidates a pending Start, including while hosted authorisation is being checked.

A command-settlement fence prevents an older pending command from being mistaken as stopped when its completion and a prior Stop acknowledgement arrive together. A fresh targeted Stop after settlement is required before reporting known zero. Unknown output and an error latch remain until explicit recovery; fixture output is labelled as simulation, not a physical measurement.

The ordinary reader intentionally retains its synchronous simulator adapter. The async lab is a testable contract for later integration, not permission to connect an unqualified real adapter. It has no story input, SDK, network transport or saved playback state. See [the simulator lab guide](../app/static/simulation/README.md). Fake-clock and actual UI-binding tests are separate from browser and physical-device evidence.

## F4 — supporting software journeys

**Implemented for the private hosted preview, 1 November 2026.** The reader has explicit local persistence, search/sort and open-story tabs, private download/restore backups, independently remembered presentation settings, keyboard access, nearby playback-readiness explanations and a recoverable access-check flow. Backups restore fresh session-only copies without strength, ceiling or arming. Imports and restores are cancelled by Stop, story deletion or tab hiding.

`/help` explains controls, privacy, recovery and the deployed source build. `/support` uses a real SQLite-backed `PrivateFeedback` Durable Object selected only from the Worker's verified Access subject/audience. Feedback has bounded exact fields, same-origin writes, per-user limits, payload-aware idempotency, 30-day expiry and cleanup alarms. Server feedback export and confirmed live deletion report actual results. Message-free security counters expire within 24 hours and survive feedback deletion; provider recovery history may retain older records for up to 30 more days. Stories never enter this service automatically.

The first `v1` SQLite class migration provisions the feedback namespace through the app's Git deployment, without marketing D1/SES resources or new runtime secrets. The existing dashboard-owned enable flag remains a kill switch. Errors are generic, logs contain no stories, and unavailable storage/authentication never fabricates a successful send or deletion. A real local Miniflare SQLite test exercises write, deduplication, export, deletion, rate preservation and separate object isolation.

Access remains founder-only. Invited-reader access/roles and broader beta onboarding require an explicit release change; a Cloudflare identity is not an application account we can erase. The local Python invitation/device-check backend remains local and does not gain hosted vendor routes. Optional coarse telemetry is not implemented or silently enabled. Recovery exports and browser story backups are tested; a production Cloudflare PITR restoration has not been performed.

## F5 — measurable scoring evaluation

Keep the local rules as the baseline and retain suggestions **0, 1, 2, 3 and 5 out of 20**. Visual labels never authorise stronger output. Prepare a versioned, rights-cleared evaluation set and rubric, split by story/source, with held-out material and independent labels on a subset. A proposed pilot is 200–500 paragraphs; that size is a starting hypothesis, not coverage evidence.

Compare the existing rules, contextual improvements, a simple linear baseline and only then a licensed local classifier if useful. Measure neutral false activations, severe overestimates, ordinal error, correction burden, abstention, load size/memory and cold/warm latency. Choose promotion thresholds before inspecting held-out results. Neutral plumbing fixtures alone cannot establish usefulness on intended reading material.

Preserve deliberate corrections during future reanalysis or obtain an explicit choice before replacing them. Invalid, uncertain or refused results must not raise output. A model cannot choose a device, start playback, raise a ceiling or extend a command. Local processing is the default direction; hosted experiments need a separate product/privacy decision and current provider review, with no silent upload of private stories. AI work does not block F1–F4.

## F6 — software-beta verification

**Gate S2:** the agreed beta journey works against local services and deterministic simulation. Verify empty/loading/success/error/recovery states, text privacy, storage deletion, account isolation, bounded retries and actual feedback outcomes. Report unimplemented or simulated backend operations explicitly. Ask 3–5 representative readers to open/add text, read without review, choose Wide/Full, save by choice, identify state, lower strength/limit, stop and recover; record friction before explaining the interface.

Real-phone browser usability and the guided setup/practice flow can be checked without a Lovense device using the private hosted simulator. The Python vendor/device-check server remains local. Signed-in hosted acceptance, representative-reader usability and physical-device qualification remain separate evidence.

## H — later physical qualification and controlled release

**H1:** when hardware and developer access are available, follow [hardware setup](hardware-check.md) and the [test record](hardware-test-record.md). Qualify one model/configuration with model/firmware, phone OS, Remote version and browser recorded. Prove live connect/select/test, selected-device targeting, finite command expiry, Stop and interruption behaviour; successful API calls and UI timers do not establish physical results. Qualify the isolated real adapter before connecting story playback to it.

**H2:** after security and operational work, deploy versioned HTTPS staging with separate secrets/users, bounded requests, tested database restore and rollback. Verify isolation, text/network boundaries and actual phones for each advertised combination. Production mode remains disabled until the release checks pass.

Only then invite 5–10 matching hardware-beta users; ask for two attempted sessions and honest private feedback. Failed attempts count. The proposed expansion threshold remains at least 8 of the first 10 eligible users completing the core flow unaided, with serious issues resolved, before expanding toward 25–50. This is an operating hypothesis, not a reliability guarantee. Rewards remain independent of public reviews or ratings.

## Scope boundaries

Defer generated stories, subscriptions/checkout, token wallets, native apps, public publishing, marketplaces, creator payouts, multiple device brands and affiliate dashboards. EPUB is optional after the core gates and must preserve TXT support. The separately managed marketing waitlist is not this local reader application. The private simulator deployment is authorised; paid hosting purchases, public beta access, generation and billing are not added by this software milestone.

## Evidence ledger

2 November 2026, editor/import/folder/setup refinement:

- Common checks pass: 22 Python and 206 JavaScript tests, including actual app bindings, folder consent and deletion/autosave revision handling, direct maximum gestures, pending link cancellation, real Worker HTMLRewriter extraction and setup/visual factories. Worker packaging and deployment dry run pass; these do not establish a remote deployment.
- Managed-browser checks inspected Midnight Ink, the global gear menu, connect → practice flow, live preview placement, strength/maximum controls and a 320 px frame without horizontal overflow; Stop remains reachable. The HTTP preview has no Web Locks, so actual playback and persistent-save journeys are reserved for localhost CI/live HTTPS checks. [Neutral paused-workspace evidence](images/reader-midnight-setup-20261102.jpg).
- Release `ff9ba79fc19d` passed expanded Chromium 151 browser CI (runs `41366571346` and `41366748678`) and Cloudflare deployment. Authenticated live acceptance verified the source build/favicon, Midnight Ink, guided connection/practice, nonzero output matching the side preview, popup-free maximum changes, strength, Stop/restart and all guide checks, desktop scroll-follow with the sidebar open, and a paused return to the editor. Live AO3 upstream availability remains unverified without an eligible source work. No physical-device, cloud-account, paid-model or algorithm-quality qualification is inferred.

1 November 2026, workspace/control and F3/F4 software iteration:

- Local common checks passed: 22 Python and 160 JavaScript tests, plus syntax/configuration and Worker bundle/dry-run checks. This includes actual app-binding tests, 14 asynchronous controller tests, three lab UI-binding tests and 20 feedback tests including real local SQLite Durable Object execution. No credentials or physical device were used.
- Normal Stop → Start worked in baseline reproduction. A concrete synchronous-access-request failure could leave the guard's completed failed promise cached; the retry path is fixed and tested. Readiness text now names connection, analysis, access, lock or error recovery requirements beside Start. Repeated start/stop, pending confirmation/lock/auth cancellation and periodic access loss have regression coverage.
- Logged-out live checks reached Cloudflare Access on the app root, `/static/app.mjs` and `/api/access`. This establishes the visible boundary, not a readback of dashboard settings or signed-in end-to-end acceptance. Git deployment and final browser CI results are reported with the release commit.
- Managed-browser checks use neutral text and an HTTP preview; Web Locks are unavailable there. CI's localhost browser suite checks actual simulator dispatch and browser saving. A real-phone/hardware run remains outstanding.
- Release `376d3049c028` passed GitHub browser CI (run `41360836488`) and Cloudflare's Worker build. Subsequent authenticated live checks passed three Start → Stop → Start cycles, reconnect, nonzero manual output, Help build identification, and the real feedback service's empty-history GET. No production feedback was submitted or deleted and no real device was connected.
- That live check found a separate short-story issue: Start could infer the second section from the viewport anchor at the document top without a scroll. The follow-up preserves the first selection at the true document top, including visual-viewport offset handling. Both new actual-app regressions fail on the old code and pass after the fix; common checks now pass 22 Python and 162 JavaScript tests. An isolated real-browser Start → Stop → Start regression is included for CI; its final result is recorded with the follow-up release rather than inferred from the local suite.


1 November 2026, private reader preparation:

- Common checks: 22 Python and 90 JavaScript tests passed. The new checks include signed Access-token enforcement, fail-closed asset routing, session expiry/refresh races, fresh authorization before Start and the cryptographic story-ID fallback. Worker bundle and Wrangler deployment dry run passed; these are local packaging checks, not remote provisioning.
- Cloud Browser review: Satin Editorial/Midnight Ink, direct paste import, active-story focus, strength adjustments, explicit Start confirmation, Stop, settings and Full reading width inspected. Phone frames at 390 and 320 CSS pixels fit without horizontal overflow; the settings drawer leaves Stop reachable. [Neutral desktop evidence](images/private-reader-desktop.jpg).
- The managed preview uses HTTP, so browser Web Locks are unavailable there. Actual simulated dispatch and saved-story persistence are covered by unit tests and the repository's separate CI browser suite, rather than claimed from that preview. No physical hardware, vendor credentials or live SDK were used.
- Cloudflare Access application, dedicated audience, DNS, authenticated live-app checks and remote deployment require account provisioning. No live-hosting success is inferred from source publication.

28 October 2026, authenticated connection implementation:

- Local checks: 22 Python tests and 19 JavaScript tests passed, with syntax/configuration and whitespace checks.
- Chromium browser smoke: [passed in GitHub Actions](https://github.com/adharasi/SatinLore/actions/runs/40617085053) for code commit `7041372`, with an ephemeral database, fake SDK and mocked vendor HTTP. Verified local reader behaviour, invitation sessions, sandbox DOM isolation, targeted finite dispatch, pending-test cancellation after Stop, reconnect, logout and mobile width. This is mocked browser evidence; the live SDK was not exercised.
- Live vendor pairing, physical stop/expiry and supported-device/browser qualification: not performed.

28 October 2026, hardware-free reading-loop implementation:

- Local checks: 22 Python and 45 JavaScript tests passed (67 total), with syntax/configuration and whitespace checks.
- Expanded Chromium integration: [passed in GitHub Actions](https://github.com/adharasi/SatinLore/actions/runs/40620105720) for code commit `57304af`. Verified suggestions/manual zero and reset, settled scrolling, ceilings/Stop, reflow/mobile layout, inactivity, lock contention and pending-Start cancellation, delayed imports, literal text and memory-only storage. Reader timing uses a controlled clock; the existing mocked vendor flow runs separately with native browser timers. No physical hardware or live vendor service was used.
- Live SDK, physical stop/expiry and real story-to-device playback: not qualified or enabled.

28 October 2026, approved frontend F1/F2 implementation:

- Source commit `ca597e99a74af40b9dac92d367a9ac0b1513c95e`: 22 Python and 49 JavaScript tests passed (71 total). Syntax/configuration and whitespace checks passed.
- Full local browser suite passed on Chromium 134.0.6998.35. [GitHub Actions also passed](https://github.com/adharasi/SatinLore/actions/runs/40746279856) on Chromium 151.0.7922.34, including the existing mocked vendor flow on native timers. Reader tests use a controlled clock.
- Verified Light/Dark/System and blocked-storage behaviour; Add/Review/Read, cancelled replacement, manual zero/reset, persistent settings/navigation, reading-position preservation, document scrolling, lower/zero ceiling, Pause/Stop, synthetic hidden-tab return, inactivity, competing ownership, stale imports and text privacy. Responsive checks cover 1440 × 1000, 390 × 844, 320 CSS px, landscape and 200% CSS text enlargement.
- Six neutral screenshots are in that run's **frontend-evidence** artifact (14-day retention). These cover desktop/phone in both themes plus Add and Review. Screenshots were visually inspected alongside the functional assertions.
- F1/F2 implementation and automated acceptance slice pass. Native browser zoom, real-phone keyboard/browser-bar/background behaviour and representative-reader usability still need manual checks. Synthetic visibility and emulated viewports are not physical-phone evidence.
- F3 deterministic failure scenarios are next. F4–F6 services/evaluation and H1/H2 hardware/release gates remain pending; the reader still drives only the simulator.

29 October 2026, Workspace v2 implementation (source commit `368791c1ef3a7bd0f33bb1a72b6fbc243f02bb74`):

- `python3 scripts/check.py` passed: 22 Python and 70 JavaScript tests (92 total), plus syntax/configuration checks. `git diff --check` passed.
- The full local browser suite passed on Chromium 134.0.6998.35 using the available headless-shell executable and Node.js 24.22.1. This includes the final font-sizing revision. The unchanged authentication/CSP/mock-SDK checks passed with native browser timers; reader timing uses a controlled clock. [GitHub Actions verification passed](https://github.com/adharasi/SatinLore/actions/runs/40807235103), including the full browser suite and screenshot upload.
- Verified direct reading; pending, failed, retried and stale background analysis; current-story reselection during analysis; optional review/future reveal; manual zero; confirmed Start and ceiling raises; Stop while ownership is pending; bounded strength, floor rounding and ceiling/zero invariants. Story switches/restoration stay paused and reset strength. Sidebar, width and Focus changes preserve the selected position.
- Verified explicit local save, rename, corrections/progress round trips, reload, Session only, deletion of one/all stories, unavailable/quota/corrupt storage and delayed Delete all blocking conflicting imports/selections. Literal text, invalid UTF-8/stale imports and absence of private text in requests were checked with neutral fixtures.
- Both themes were checked at desktop/phone sizes, 320 CSS px, landscape and 200% CSS text enlargement, including final-paragraph clearance above the dock. Six visually inspected captures are in the run’s **frontend-evidence** artifact (14-day retention) and locally in ignored `artifacts/frontend/`: `desktop-light.png`, `desktop-dark.png`, `phone-light.png`, `phone-dark.png`, `settings-dark.png` and `start-confirmation.png`.
- Native browser zoom, real-phone keyboard/browser-bar/background behaviour and representative-reader usability remain manual checks. No physical device or live vendor service was used. F3 failure scenarios, remaining F4 services, F5/F6 evaluation/full-beta acceptance and H1/H2 qualification/release remain pending.

Record build/commit, checks, tested configurations, observed behaviour, issues and next task. Automated evidence, browser evidence and live hardware evidence must have separate statuses. Do not mark physical qualification complete from a mock SDK or simulator result.
