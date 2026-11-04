# Beta roadmap — frontend, simulation, hardware

Approved workspace revision: 29 October 2026 (frontend specification v1.2), refined by the 2 November editor/import/folder/setup request. Build the software experience with simulated devices first; hardware availability does not block frontend, application or scoring work. The former device-first 48–72-hour release target is superseded. Completion requires evidence, not a date or screenshot.

There are separate gates: **S** for the software experience and **H** for physical device qualification and release. The 2 November eight-model request adds simulated rehearsal and a configured bounded live path; no physical model is qualified by implementation alone. Passing S does not pass H, and the full software beta still needs the remaining milestones below.

## Flexer Alpha on the app host — 3 November 2026

The first preference study has a separate manual-control route at `/alpha`, using Dilan and Sadie logins, and founder review at `/admin`. The study joins consented control events, optional marks, feedback and timestamped annotations by authenticated username. With consent, Alpha captures masked visual replays of each study screen for founder review. The reader and prior beta use their existing Access and storage rules.

Use the [Alpha setup and rehearsal runbook](alpha-setup.md) for the path-scoped Access settings, password provisioning and hardware checks. Acceptance requires a real simulator journey through both user roles and an independent physical Flexer qualification before interpreting live preferences. The study supplies candidate movement profiles for later reader experiments.

## Accounts calibration and recorded beta sessions on 2 November 2026

**Current requested scope:** verified-email hosted accounts, explicit 18+ registration, account/story presets, capability-led calibration, per-action and qualified combined controls, personal-range permission and a separate protected beta recording/admin host. This supersedes earlier account-backlog and blanket reader 5/20 statements; dated evidence below remains historical.

Implemented source includes:

- Durable per-identity profiles and up to 50 versioned account/story presets, including active channels and master maximum. Applying always pauses; story text remains local. Registration and preset saving are separate from research recording consent.
- Guided individual movement explanations/tests, personal levels and optional ratings, three original controlled reading fixtures, and re-exposable sidebar tuning/Explore controls. Hold, Ease off, Follow story, optional continuous minimum and per-channel gradual increases remain under Stop and manual-zero authority.
- Documented Standard Socket Oscillate and qualified combinations on one selected toy, with a narrower Basic SDK fallback. No heating, guessed separate motors or claim of complete Remote parity.
- Gentle initial/default tests at most 5/20, then an explicit per-action personal-range permission up to 20/20 after a checked response/Stop. Permission never comes from a preset or restores after interruption. Enabling never raises the chosen maximum or starts output.
- Exact beta-host, explicit-consent structured recordings with founder-only admin playback/graphs. The 60-minute/20,000-event/4 MiB session limits, 30-day retention and 128 MiB global budget exclude DOM/video, private text/title, preset names and credentials. Recording and device Stop are distinct controls.
- Automatic v2 Durable Object provisioning and beta custom-domain routing. Whole-host Access application coverage and both tester email allowlists remain owner-side configuration.

**Current release evidence:** implementation is ready for the current automated/browser/deployment checks; record their actual build and results in the release ledger after execution. No current-release CI, live vendor pairing or physical qualification is claimed by this paragraph. Use [the 3 November founder/tester runbook](beta-session-2026-11-03.md). The next milestone is observed physical targeting, finite expiry/Stop, permission reset, accessible control flow and useful reading behavior for each actual configuration.

## Private hosting decision — 1 November 2026

The product owner has requested `app.satinlore.com` behind founder-only Cloudflare Access. A separate static-reader Worker provides this simulator preview without enabling the local Python invitation/vendor backend or weakening its local-origin restrictions. The adapter validates a dedicated Access token before every asset; failed or expired hosted access stops simulated playback and blocks Start. This request supersedes the earlier workspace milestone's no-deployment scope for this private preview only. It does not pass hardware qualification or the full software-beta gates.

The one-time owner-side dashboard setup is complete and automatic Git deployment succeeded for release `376d3049c028`; the evidence ledger records its live checks. Access team/audience and the enable/pause flag remain dashboard-owned and survive later source deployments. Deployment configuration and operational verification are recorded in [the Cloudflare runbook](../deploy/cloudflare/README.md). A committed adapter is not evidence that DNS, Access or a live deployment has been provisioned.

## Existing baseline

The local FastAPI/static ES-module application includes TXT/paste import, stable paragraphs, experimental local suggestions, manual corrections, scroll tracking, finite/coalesced simulator playback, a ceiling, explicit Start and interruption/tab-ownership rules. SQLite-backed one-use invitations and expiring sessions support a separate sandboxed device-check screen. New stories stay session-only until an explicit local-save choice. The eight-model revision adds a separate async reader bridge rather than attaching hardware to the synchronous simulator. Live SDK compatibility, physical behaviour, broader beta release and useful scoring remain outstanding until recorded; existing deployment evidence remains version-specific.

## F1 — approved themes and reader foundation

Satin Editorial light, Midnight Ink dark and Light/Dark/System appearance are implemented using shared tokens and local fonts. The appearance preference is separate from story storage. The 28 October Add → Review → Read implementation is retained in the evidence ledger as historical work; it is superseded by the workspace below.

## Workspace v2 — direct reading and saved stories

**Implementation status:** the workspace is implemented; the evidence ledger distinguishes each revision's source publication, automated checks, browser review and hosting state. The evidence ledger distinguishes these checks from remaining manual usability and hardware qualification.

The 29 October decision moves the next frontend milestone ahead of the deeper F3 transport harness. Implement a collapsible library, continuous reading canvas and optional right settings panel, closed initially. Wide is the default; Comfortable/Full and Focus let the reader use the available window. Phone/tablet layouts use drawers/sheets while keeping controls reachable. Review is optional, shows current/already-read sections first and requires a deliberate reveal of future sections.

Added stories open directly for reading while local analysis runs in the background. Valid analysis gates device Start, not silent reading or review. Keep generation cancellation, invalid/uncertain zero, manual-zero overrides and correction-preserving reanalysis. Explicit **Save on this browser** retains text/title, corrections, analysis version and progress; **Session only** remains the default. Rename, delete one/all and truthful storage-failure states are part of this milestone. Restoration stays paused and never retains an armed session.

Persistent −/+ adjusts session strength from 0.0× to 2.0× in 0.1× steps, initially 1.0×. Apply it to the section base without rewriting corrections, round down to a whole level, then cap at the confirmed ceiling. Start explicitly confirms the selected simulator, strength and maximum. Lower/zero ceilings apply immediately. Under the 2 November user request, a direct maximum-slider gesture updates the ordinary reader simulator without a separate popup or automatic restart; Start still confirms the current maximum. The async lab/hardware-check contracts remain separate. Stop remains immediate and reachable in overlays.

This brought the local-persistence part of F4 into the workspace implementation. The deeper F3 failure harness and private hosted feedback/support/data journeys were subsequently implemented on 1 November; durable reader accounts and settings presets are implemented by the newer refinement above; cloud story text storage remains future work. Exact implementation, storage boundaries and controls are described in the [specification](development-spec.md) and [frontend design](frontend-design.md).

**Gate S1-v2:** use [test-today.md](test-today.md) for direct reading without compulsory review, cancelled/stale background work, two-story switching, opt-in save/paused restore, delete one/all and storage failures. Verify Start confirmation cancellation, direct nonblocking maximum changes, strength bounds/rounding, manual and automatic zero, lower/zero ceiling, Stop, hidden-tab return and no automatic resume. Inspect both themes at 390 × 844 and 1440 × 1000, 320 CSS px, landscape and 200% text. Record actual browser/build; an emulated mobile viewport is not a physical phone result. The evidence ledger owns pass/unverified status.

## Reader refinement — 2 November 2026

The requested implementation adds a directly typable blank page, natural story/import copy, right-sidebar upload and deliberate AO3 link import, local folders, a separate global gear menu, favicon, an actual-output simulator graphic and a guided practice journey. The baseline model remains the current local scorer; the stronger custom/multi-toy/dual-area tier is shown as unavailable future development. No new inference model, hardware integration, billing or account cloud sync is implied by the selector.

Folder names/catalogue persist only through explicit folder actions; moving an unsaved story does not save its text. Saved folder membership shares the existing revision-checked local store and Web Lock. Delete folder moves its stories to Unfiled. Portable backups deliberately restore to Unfiled, with fresh session-only identities and no playback arming.

AO3 public work/chapter URLs use a bounded, authenticated hosted import service; local AO3 HTML is extracted inertly in the browser. Literotica and other platforms use open-source-page/copy/upload fallback rather than unqualified automatic scraping. Blocked/restricted sites must stay blocked. URL import is explicit, transient and separate from browser-local drafts or saved text.

**Acceptance work:** test direct typing/paste, supported-link success/error/cancellation, inert HTML upload, folder creation/rename/delete and paused reload, gear-menu discoverability, both themes, strength interaction and popup-free maximum changes. The guided simulator journey must explicitly connect, open neutral practice, expose actual changing output while reading, track the practice actions honestly, and stay paused on exit/skip/story change. Reduced motion must retain clear feedback without vibration movement. Add actual browser/build results to the evidence ledger after execution; this scope description is not a release pass.

**Remaining backlog:** per-account cloud story text storage/sync, custom-model inference, paid entitlements, additional brands and multi-toy control. Hosted verified-email accounts/preset isolation, export/deletion and v2 migration are implemented by the newer refinement above. Qualified combined actions on one toy are separate from the future model tier. Invited testers still require explicit permission in both Cloudflare Access and the Worker.

## F3 — deterministic device scenarios and transport contract

**Implemented, 1 November 2026.** `/simulator-lab` exercises 11 named scenarios with a manually advanced virtual clock and explicitly selected fake devices. The separate `playback/async-controller.mjs` contract covers empty/unsupported/multiple devices, failed/delayed/timed-out connection, cancellation, disconnect, delayed/wrong/missing acknowledgements, failed Stop, stale work, bounded coalescing and recovery. Native dialog cancellation invalidates a pending Start, including while hosted authorisation is being checked.

A command-settlement fence prevents an older pending command from being mistaken as stopped when its completion and a prior Stop acknowledgement arrive together. A fresh targeted Stop after settlement is required before reporting known zero. Unknown output and an error latch remain until explicit recovery; fixture output is labelled as simulation, not a physical measurement.

The ordinary reader retains its synchronous adapter for simulation. The eight-model revision reuses the bounded async contract through a separate targeted bridge transport for configured live connections; the deterministic lab remains isolated from that transport. The lab has no story input, SDK, network transport or saved playback state and does not qualify physical behaviour. See [the simulator lab guide](../app/static/simulation/README.md). Fake-clock and actual UI-binding tests are separate from browser and physical-device evidence.

## F4 — supporting software journeys

**Implemented for the private hosted preview, 1 November 2026.** The reader has explicit local persistence, search/sort and open-story tabs, private download/restore backups, independently remembered presentation settings, keyboard access, nearby playback-readiness explanations and a recoverable access-check flow. Backups restore fresh session-only copies without strength, ceiling or arming. Imports and restores are cancelled by Stop, story deletion or tab hiding.

`/help` explains controls, privacy, recovery and the deployed source build. `/support` uses a real SQLite-backed `PrivateFeedback` Durable Object selected only from the Worker's verified Access subject/audience. Feedback has bounded exact fields, same-origin writes, per-user limits, payload-aware idempotency, 30-day expiry and cleanup alarms. Server feedback export and confirmed live deletion report actual results. Message-free security counters expire within 24 hours and survive feedback deletion; provider recovery history may retain older records for up to 30 more days. Stories never enter this service automatically.

The first `v1` SQLite class migration provisions the feedback namespace through the app's Git deployment, without marketing D1/SES resources or new runtime secrets. The existing dashboard-owned enable flag remains a kill switch. Errors are generic, logs contain no stories, and unavailable storage/authentication never fabricates a successful send or deletion. A real local Miniflare SQLite test exercises write, deduplication, export, deletion, rate preservation and separate object isolation.

Access defaults to the founder. The eight-model revision permits explicit tester emails only when configured in both the Worker allowlist and Cloudflare Access policy; no tester has been enrolled by source alone. A Cloudflare identity is not an application account we can erase. The local Python invitation/device-check backend remains local; the hosted Worker has its own bounded, authenticated Lovense token exchange. The ordinary app does not enable the beta timeline. The newer exact-beta-host recording milestone above adds separately consented structured controls without private text. Recovery exports and browser story backups are tested; a production Cloudflare PITR restoration has not been performed.

## Eight-model connection revision — 2 November 2026

The product owner requested rehearsal and a guided connection route for Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce and Hush before the first tester session on 3 November. This explicitly expands the former Lush-only hardware scope; it does not remove per-model physical qualification.

The software path includes model/mode selection, a synthetic discovered device for simulator rehearsal, an explicit device/action choice, a short test with user-observed stopped output, and a neutral practice read with a fresh Start. The optional live path uses Lovense Remote, a private pairing code and a protected opaque vendor frame. The Worker's token route derives user identity from Access, retains the developer token server-side and fails closed until its three runtime values are valid. That earlier connection release restricted physical commands to two seconds and at most 5/20 on one selected device. The current explicit personal-range refinement above supersedes its blanket level cap. Only validated model/connection actions are offered; heating, arbitrary commands, simultaneous toys and independent Dolce motors are not implemented.

**Acceptance:** run all eight simulated profiles, available actions, test expiry, Stop/restart, zero/lower maximum, hide/return, story/mode/action change, command errors and disconnect/reconnect. A resumed connection must stay paused. Verify protected endpoints, exact-origin writes, isolated vendor code, bounded per-user credential issuance, no client-controlled UID and no story/credential persistence or diagnostic leakage. Record local, browser and deployment evidence separately below; implementation text is not a check result.

**Before tomorrow's physical session:** complete [Lovense beta setup](lovense-beta-test.md), configure private runtime credentials, and explicitly allow the tester's actual sign-in email in both Access layers. Begin with the tester's frequently used Lush, Flexer, Nora and Domi, then the remaining models. For each actual model/generation/firmware/Remote/browser configuration, observe selected-toy targeting, each offered action, finite expiry and interruption/Stop behaviour before personal story testing. Simulated extra motions are not proof of live capability. Record any absent live action as a missing capability rather than inventing a command.

## Osci 3 extension — 2 November 2026

The beta tester added Osci 3 after the initial eight-model request. The current catalogue and guided setup now contain nine profiles. Osci 3 has a distinct simulator illustration, finite vibration/oscillation rehearsal, the ordinary selected-movement Start confirmation and the existing Stop/zero/reconnect rules. Exact Osci 3 identities and Osci family hardware version 3 are recognised; older Osci models are not silently promoted.

In the earlier nine-profile extension, live Osci 3 testing used documented general vibration only, and oscillation was simulator-only because the Standard JS SDK does not document that parameter. The newer qualified Standard Socket Function adapter above supersedes that transport limit without inventing a Basic SDK argument; heating and guessed independent motors remain unavailable. The former eight-model release evidence below remains historical, not proof of this extension. Local checks for this extension passed: 22 Python tests, 278 JavaScript tests, syntax/config checks, protected Worker build and diff checks. New regressions cover exact model identity, rejected older Osci aliases, bounded selected-device vibration, simulation-only oscillator rejection on the live path, distinct preview motion, reduced motion and Stop. The browser suite now includes all nine model journeys; its execution/deployment result must be recorded separately. No physical device or live vendor service was used.

## F5 — measurable scoring evaluation

Keep the local rules as the baseline and retain suggestions **0, 1, 2, 3 and 5 out of 20**. Visual labels never authorise stronger output. Prepare a versioned, rights-cleared evaluation set and rubric, split by story/source, with held-out material and independent labels on a subset. A proposed pilot is 200–500 paragraphs; that size is a starting hypothesis, not coverage evidence.

Compare the existing rules, contextual improvements, a simple linear baseline and only then a licensed local classifier if useful. Measure neutral false activations, severe overestimates, ordinal error, correction burden, abstention, load size/memory and cold/warm latency. Choose promotion thresholds before inspecting held-out results. Neutral plumbing fixtures alone cannot establish usefulness on intended reading material.

Preserve deliberate corrections during future reanalysis or obtain an explicit choice before replacing them. Invalid, uncertain or refused results must not raise output. A model cannot choose a device, start playback, raise a ceiling or extend a command. Local processing is the default direction; hosted experiments need a separate product/privacy decision and current provider review, with no silent upload of private stories. AI work does not block F1–F4.

The local revision has a repeatable neutral regression and a matched browser comparison with the previous analyser. In the eight-paragraph Nora simulator fixture, the revised build followed a gentle build, held across two room details, rose at the stronger beat, eased off and went quiet at the time jump. The old build was quiet apart from a rotation triggered by the room fan. The next F5 check is a same-settings, counterbalanced pilot with representative readers and permission-cleared stories. [Fixture, protocol and simulator observations](reader-scene-testing.md)

The fourth rules revision adds a 43-paragraph corpus across seven original stories. The previous release matched 32 annotations. The fourth revision matched 43, including distinctions between simultaneous and sequential movement, quotes, withdrawal and quiet boundaries. Matched browser read-throughs across four simulators went from 10 to 18 matching movement sets out of 18. These results describe the chosen fixtures. Continue to iterate on missed cues and false activations in broader text, with physical sessions reserved for validating how the patterns feel. [Comparison script and read-through](reader-scene-testing.md)

## F6 — software-beta verification

**Gate S2:** the agreed beta journey works against local services and deterministic simulation. Verify empty/loading/success/error/recovery states, text privacy, storage deletion, account isolation, bounded retries and actual feedback outcomes. Report unimplemented or simulated backend operations explicitly. Ask 3–5 representative readers to open/add text, read without review, choose Wide/Full, save by choice, identify state, lower strength/limit, stop and recover; record friction before explaining the interface.

Real-phone browser usability and the guided setup/practice flow can be checked without a Lovense device using the private hosted simulator. The Python vendor/device-check server remains local. Signed-in hosted acceptance, representative-reader usability and physical-device qualification remain separate evidence.

## H — later physical qualification and controlled release

**H1:** when hardware and developer access are available, follow [hardware setup](hardware-check.md) and the [test record](hardware-test-record.md). Qualify each requested model/configuration separately with model/firmware, phone OS, Remote version and browser recorded. Prove live connect/select/test, selected-device targeting, finite command expiry, Stop and interruption behaviour; successful API calls and UI timers do not establish physical results. Use the guided isolated low-level test before the controlled neutral practice read. Do not mark a model qualified or widen hardware beta access until its physical results are recorded.

**H2:** after security and operational work, deploy versioned HTTPS staging with separate secrets/users, bounded requests, tested database restore and rollback. Verify isolation, text/network boundaries and actual phones for each advertised combination. Production mode remains disabled until the release checks pass.

Only then invite 5–10 matching hardware-beta users; ask for two attempted sessions and honest private feedback. Failed attempts count. The proposed expansion threshold remains at least 8 of the first 10 eligible users completing the core flow unaided, with serious issues resolved, before expanding toward 25–50. This is an operating hypothesis, not a reliability guarantee. Rewards remain independent of public reviews or ratings.

## Scope boundaries

Defer generated stories, subscriptions/checkout, token wallets, native apps, public publishing, marketplaces, creator payouts, multiple device brands and affiliate dashboards. EPUB is optional after the core gates and must preserve TXT support. The separately managed marketing waitlist is not this local reader application. The private reader deployment and eight-model integration are authorised; paid hosting purchases, unrestricted public beta access, generation and billing are not added by this milestone.

## Evidence ledger

3 November 2026, accounts, calibration and recorded beta release:

- Local common checks passed: **22 Python and 382 JavaScript tests**, including real SQLite account/recording storage, account-registration acknowledgement, browser fetch receiver binding, per-action calibration/vector controls, full-range permissions, recovery/zero handling, actual workspace bindings, recording privacy and founder authorization. Worker packaging passed with 52 allowlisted assets and the isolated vendor bridge.
- Final review corrected a displayed-versus-active movement maximum mismatch and a delayed-analysis manual-zero mapping issue. New regressions cover both; requested reductions and explicit zero remain authoritative.
- Browser acceptance caught an unbound default `fetch` invocation in account registration. The account and Socket clients now preserve the browser receiver, with default-path regression tests; no injected transport can mask this failure.
- The CI browser suite now exercises the real hosted account API/SQLite storage with synthetic signed identities, presets across reload, guided Flexer setup, beta consent/output/ratings, founder timeline review and deletion. It preserves the browser's real Origin/Fetch Metadata headers. Its result and production deployment must be checked in the release run; local unit success alone does not establish either.
- Live vendor QR issuance, physical response/expiry/Stop and real-phone qualification remain untested. Complete the [3 November runbook](beta-session-2026-11-03.md), including whole-host beta Access coverage and both tester allowlists, before the physical session. One host/browser controls a physical toy at a time.

2 November 2026, eight-model connection revision:

- Scope: eight profile simulators, explicit model/mode/device/action selection, short test and neutral practice; optional server-configured Lovense Remote bridge with targeted finite physical beta requests. Source implementation and the actual checks must be reported independently.
- Local automated checks: `python3 scripts/check.py` passed on 2 November with 22 Python and 275 JavaScript tests, syntax/config checks; the protected Worker build and Wrangler deployment dry run passed. New tests exercise all model profiles, the actual parent bridge, setup, server token exchange, rate persistence, cancellation/Stop races, chosen maximum zero, physical confirmation and browser timer binding. These are software checks with neutral fixtures, no vendor/hardware calls.
- Managed browser preview: Nora model selection, explicit synthetic-device selection, Rotation test at 1/20, finite return to zero, checked-response continuation and paused neutral practice passed. The preview's HTTP origin does not provide Web Locks, so reading playback requires the HTTPS deployment or the isolated localhost CI browser suite. Signed-in HTTPS acceptance, GitHub browser CI and Cloudflare deployment are recorded separately in the release report.
- Browser CI passed for `7ce6ab51377ea97962f853517a531c4925c620ee` on Chromium 151.0.7922.34: all eight complete simulator setup/practice journeys, channel-specific output, disconnect/error recovery, unavailable-live-mode isolation, local-only story privacy and the existing responsive/reader/legacy-bridge checks. Both branch run `41523450871` and main run `41523712394` passed. SDK/HTTP were mocked in CI; this is not hardware evidence.
- Cloudflare Workers build/deployment succeeded for `7ce6ab51377ea97962f853517a531c4925c620ee`. Signed-in HTTPS acceptance passed for Nora simulator explicit selection, rotation test 1→0, observed-response checkpoint, paused practice, confirmed Start, section 2 at output/graphic 2, strength 1.1×, direct maximum reduction to 4 without a popup, and Stop returning to zero with Start available. The hosted real-connection route accurately reported missing private runtime configuration; no vendor pairing or physical command was attempted. A follow-up removes a stale initial sign-in-expired message after successful authentication, with a regression that recovery remains paused. Start also names the selected movement and rejects a confirmation if the mode, toy ID or movement changes during preparation; an actual app-binding regression covers a Nora confirmation followed by a Domi selection.
- Live vendor pairing and all physical model/action/expiry/Stop observations: not tested in a hardware-free session. Use [the beta guide](lovense-beta-test.md) and [hardware record](hardware-test-record.md) on 3 November; no physical qualification is inferred from simulation.


2 November 2026, appearance and settings dismissal polish:

- Added a header Dark mode switch synchronised with the resolved System/Light/Dark preference. Appearance changes still preserve the selected section and pause playback. The global settings popup uses Close and a top-right ×; playback/setup Stop controls are unchanged.
- Local common checks passed: 22 Python and 209 JavaScript tests, including new switch/System/storage-denial and actual reader pause/Close regressions. Worker packaging and deployment dry run passed. Browser CI includes header-switch, both dismissal controls and 320 px target checks; its execution and deployment results belong to the release report.

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
