# Beta roadmap — frontend, simulation, hardware

Approved workspace revision: 29 October 2026 (frontend specification v1.2). Build the software experience with simulated devices first; hardware availability does not block frontend, application or scoring work. The former device-first 48–72-hour release target is superseded. Completion requires evidence, not a date or screenshot.

There are separate gates: **S** for the software experience and **H** for physical device qualification and release. The reader remains simulator-only. Passing S does not pass H, and the full software beta still needs the remaining milestones below.

## Existing baseline

The local FastAPI/static ES-module application includes TXT/paste import, stable paragraphs, experimental local suggestions, manual corrections, scroll tracking, finite/coalesced simulator playback, a ceiling, explicit Start and interruption/tab-ownership rules. SQLite-backed one-use invitations and expiring sessions support a separate sandboxed device-check screen. New stories stay session-only until an explicit local-save choice. Live SDK compatibility, continuous real-device reading, production deployment and physical qualification remain outstanding.

## F1 — approved themes and reader foundation

Satin Editorial light, Midnight Ink dark and Light/Dark/System appearance are implemented using shared tokens and local fonts. The appearance preference is separate from story storage. The 28 October Add → Review → Read implementation is retained in the evidence ledger as historical work; it is superseded by the workspace below.

## Workspace v2 — direct reading and saved stories

**Implementation status:** the workspace is implemented and its local automated/browser acceptance slice passes; publication and CI evidence are pending. The evidence ledger distinguishes these checks from remaining manual usability and hardware qualification.

The 29 October decision moves the next frontend milestone ahead of the deeper F3 transport harness. Implement a collapsible library, continuous reading canvas and optional right settings panel, closed initially. Wide is the default; Comfortable/Full and Focus let the reader use the available window. Phone/tablet layouts use drawers/sheets while keeping controls reachable. Review is optional, shows current/already-read sections first and requires a deliberate reveal of future sections.

Added stories open directly for reading while local analysis runs in the background. Valid analysis gates device Start, not silent reading or review. Keep generation cancellation, invalid/uncertain zero, manual-zero overrides and correction-preserving reanalysis. Explicit **Save on this browser** retains text/title, corrections, analysis version and progress; **Session only** remains the default. Rename, delete one/all and truthful storage-failure states are part of this milestone. Restoration stays paused and never retains an armed session.

Persistent −/+ adjusts session strength from 0.0× to 2.0× in 0.1× steps, initially 1.0×. Apply it to the section base without rewriting corrections, round down to a whole level, then cap at the confirmed ceiling. Start explicitly confirms the selected simulator, strength and maximum. Lower ceilings apply immediately; increases require separate confirmation. Stop remains immediate and reachable in overlays.

This brings the local-persistence part of F4 into the current workspace implementation. Feedback, server account operations and the deeper failure harness remain separate work. Exact implementation, storage boundaries and controls are described in the [specification](development-spec.md) and [frontend design](frontend-design.md).

**Gate S1-v2:** use [test-today.md](test-today.md) for direct reading without compulsory review, cancelled/stale background work, two-story switching, opt-in save/paused restore, delete one/all and storage failures. Verify Start/raise confirmation cancellation, strength bounds/rounding, manual and automatic zero, lower/zero ceiling, Stop, hidden-tab return and no automatic resume. Inspect both themes at 390 × 844 and 1440 × 1000, 320 CSS px, landscape and 200% text. Record actual browser/build; an emulated mobile viewport is not a physical phone result. The evidence ledger owns pass/unverified status.

## F3 — deterministic device scenarios and transport contract

**Next after workspace acceptance.** Add a development-only scenario surface for connection failure, unsupported capabilities, multiple available devices with explicit single selection, delayed connection/timeout, disconnect during playback, delayed/out-of-order acknowledgement, failed Stop/unknown output and stale completion after story/device changes. Keep scenario controls out of ordinary reading navigation. Reset fixtures deterministically and label every device value as simulated.

Existing synchronous simulator/controller tests cover bounded playback, interruption, stale local work and ownership; they do not implement an asynchronous device harness. Add async support deliberately with cancellation, generation invalidation, bounded requests and stale-result regression tests. Reconnect remains ready-paused and requires a new Start. Never substitute a reassuring local zero for unknown physical output.

## F4 — remaining software journeys and local services

Opt-in local story/progress persistence, paused restoration and delete one/all are now part of Workspace v2. Maintain their storage failure and privacy checks; do not treat local deletion as server account deletion. Session-only remains the default and appearance remains separate.

Finish invitation/onboarding/session-expiry flow, help and build information, bounded private feedback with retry/idempotency, allowlisted coarse events and account-data deletion/revocation where a real backend exists. Distinguish local deletion from server deletion. Do not display successful saving, sending or deletion for an unimplemented operation. Minimum operational controls include a new-session kill switch, redacted logs, support details and a tested restore procedure.

The authenticated device-check session exists today; the simulator reader is not an authenticated account experience. Do not infer reader-wide session/revocation handling from the separate check screen.

## F5 — measurable scoring evaluation

Keep the local rules as the baseline and retain suggestions **0, 1, 2, 3 and 5 out of 20**. Visual labels never authorise stronger output. Prepare a versioned, rights-cleared evaluation set and rubric, split by story/source, with held-out material and independent labels on a subset. A proposed pilot is 200–500 paragraphs; that size is a starting hypothesis, not coverage evidence.

Compare the existing rules, contextual improvements, a simple linear baseline and only then a licensed local classifier if useful. Measure neutral false activations, severe overestimates, ordinal error, correction burden, abstention, load size/memory and cold/warm latency. Choose promotion thresholds before inspecting held-out results. Neutral plumbing fixtures alone cannot establish usefulness on intended reading material.

Preserve deliberate corrections during future reanalysis or obtain an explicit choice before replacing them. Invalid, uncertain or refused results must not raise output. A model cannot choose a device, start playback, raise a ceiling or extend a command. Local processing is the default direction; hosted experiments need a separate product/privacy decision and current provider review, with no silent upload of private stories. AI work does not block F1–F4.

## F6 — software-beta verification

**Gate S2:** the agreed beta journey works against local services and deterministic simulation. Verify empty/loading/success/error/recovery states, text privacy, storage deletion, account isolation, bounded retries and actual feedback outcomes. Report unimplemented or simulated backend operations explicitly. Ask 3–5 representative readers to open/add text, read without review, choose Wide/Full, save by choice, identify state, lower strength/limit, stop and recover; record friction before explaining the interface.

Real-phone browser usability can be checked without a Lovense device, but the current server remains local-development-only. Do not bypass origin/security restrictions to call this phase a deployment.

## H — later physical qualification and controlled release

**H1:** when hardware and developer access are available, follow [hardware setup](hardware-check.md) and the [test record](hardware-test-record.md). Qualify one model/configuration with model/firmware, phone OS, Remote version and browser recorded. Prove live connect/select/test, selected-device targeting, finite command expiry, Stop and interruption behaviour; successful API calls and UI timers do not establish physical results. Qualify the isolated real adapter before connecting story playback to it.

**H2:** after security and operational work, deploy versioned HTTPS staging with separate secrets/users, bounded requests, tested database restore and rollback. Verify isolation, text/network boundaries and actual phones for each advertised combination. Production mode remains disabled until the release checks pass.

Only then invite 5–10 matching hardware-beta users; ask for two attempted sessions and honest private feedback. Failed attempts count. The proposed expansion threshold remains at least 8 of the first 10 eligible users completing the core flow unaided, with serious issues resolved, before expanding toward 25–50. This is an operating hypothesis, not a reliability guarantee. Rewards remain independent of public reviews or ratings.

## Scope boundaries

Defer generated stories, subscriptions/checkout, token wallets, native apps, public publishing, marketplaces, creator payouts, multiple device brands and affiliate dashboards. EPUB is optional after the core gates and must preserve TXT support. The separately managed marketing waitlist is not this local reader application. No hosting purchase or public deployment is part of the workspace milestone.

## Evidence ledger

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
