# Beta roadmap — frontend, simulation, hardware

Approved sequence: 28 October 2026. Build the software experience with simulated devices first; hardware availability does not block frontend, application or scoring work. The former device-first 48–72-hour release target is superseded. Completion requires evidence, not a date or screenshot.

There are separate gates: **S** for the software experience and **H** for physical device qualification and release. The reader remains simulator-only. Passing S does not pass H, and the full software beta still needs the remaining milestones below.

## Existing baseline

The local FastAPI/static ES-module application includes TXT/paste import, stable paragraphs, experimental local suggestions, manual corrections, scroll tracking, finite/coalesced simulator playback, a ceiling, explicit Start and interruption/tab-ownership rules. SQLite-backed one-use invitations and expiring sessions support a separate sandboxed device-check screen. Story text stays in page memory. Live SDK compatibility, continuous real-device reading, production deployment and physical qualification remain outstanding.

## F1 — approved themes and reader foundation

Implement Satin Editorial light mode and Midnight Ink dark mode using shared semantic tokens, components and typography. Offer Light, Dark and System; use the OS preference initially and retain an explicit choice. Store only the allowlisted appearance preference, not story content. Keep the existing stack and controller/scoring limits.

This phase adds the theme foundation, editorial reading surface, desktop control rail and compact phone/tablet dock. See [frontend design](frontend-design.md) for the decision record and visual acceptance checks. Theme and layout work is separate from hardware compatibility and external-release readiness.

## F2 — complete preparation and reading

This phase separates **Add story → Review → Read**, using real local import, scoring, per-paragraph overrides and reset. Reading uses document scrolling with a manual Previous/Next fallback. Valid replacement asks before discarding the current story/corrections; cancellation or invalid input keeps the current story and stays paused. Clear invalidates pending imports. Start is available only in Read; Pause and Stop remain explicit.

**Gate S1:** use [test-today.md](test-today.md) to verify the complete flow without hardware credentials or vendor traffic. Cover manual zero, ceiling zero, Stop, hidden-tab return, delayed imports, replacing/cancelling and no automatic resume. Review both themes at 390 × 844 and 1440 × 1000, 320 CSS px reflow, landscape and 200% text. Record the exact build and actual browser; emulated mobile size is not a real-phone test. The evidence ledger below owns passed/unverified status.

## F3 — deterministic device scenarios and transport contract

**Next implementation milestone.** Add a development-only scenario surface for connection failure, unsupported capabilities, multiple available devices with explicit single selection, delayed connection/timeout, disconnect during playback, delayed/out-of-order acknowledgement, failed Stop/unknown output and stale completion after story/device changes. Keep scenario controls out of ordinary reading navigation. Reset fixtures deterministically and label every device value as simulated.

Existing synchronous simulator/controller tests cover bounded playback, interruption, stale local work and ownership; they do not implement an asynchronous device harness. Add async support deliberately with cancellation, generation invalidation, bounded requests and stale-result regression tests. Reconnect remains ready-paused and requires a new Start. Never substitute a reassuring local zero for unknown physical output.

## F4 — remaining software journeys and local services

Implement opt-in local story/progress persistence with restore-paused, storage-unavailable/full/corrupt states, Delete Story and Delete All. Memory-only remains the default. Keep theme preference separate from story storage.

Finish invitation/onboarding/session-expiry flow, help and build information, bounded private feedback with retry/idempotency, allowlisted coarse events and account-data deletion/revocation where a real backend exists. Distinguish local deletion from server deletion. Do not display successful saving, sending or deletion for an unimplemented operation. Minimum operational controls include a new-session kill switch, redacted logs, support details and a tested restore procedure.

The authenticated device-check session exists today; the simulator reader is not an authenticated account experience. Do not infer reader-wide session/revocation handling from the separate check screen.

## F5 — measurable scoring evaluation

Keep the local rules as the baseline and retain suggestions **0, 1, 2, 3 and 5 out of 20**. Visual labels never authorise stronger output. Prepare a versioned, rights-cleared evaluation set and rubric, split by story/source, with held-out material and independent labels on a subset. A proposed pilot is 200–500 paragraphs; that size is a starting hypothesis, not coverage evidence.

Compare the existing rules, contextual improvements, a simple linear baseline and only then a licensed local classifier if useful. Measure neutral false activations, severe overestimates, ordinal error, correction burden, abstention, load size/memory and cold/warm latency. Choose promotion thresholds before inspecting held-out results. Neutral plumbing fixtures alone cannot establish usefulness on intended reading material.

Preserve deliberate corrections during future reanalysis or obtain an explicit choice before replacing them. Invalid, uncertain or refused results must not raise output. A model cannot choose a device, start playback, raise a ceiling or extend a command. Local processing is the default direction; hosted experiments need a separate product/privacy decision and current provider review, with no silent upload of private stories. AI work does not block F1–F4.

## F6 — software-beta verification

**Gate S2:** the agreed beta journey works against local services and deterministic simulation. Verify empty/loading/success/error/recovery states, text privacy, storage deletion, account isolation, bounded retries and actual feedback outcomes. Report unimplemented or simulated backend operations explicitly. Ask 3–5 representative readers to import text, identify state, correct a section, lower the limit, stop and recover; record friction before explaining the interface.

Real-phone browser usability can be checked without a Lovense device, but the current server remains local-development-only. Do not bypass origin/security restrictions to call this phase a deployment.

## H — later physical qualification and controlled release

**H1:** when hardware and developer access are available, follow [hardware setup](hardware-check.md) and the [test record](hardware-test-record.md). Qualify one model/configuration with model/firmware, phone OS, Remote version and browser recorded. Prove live connect/select/test, selected-device targeting, finite command expiry, Stop and interruption behaviour; successful API calls and UI timers do not establish physical results. Qualify the isolated real adapter before connecting story playback to it.

**H2:** after security and operational work, deploy versioned HTTPS staging with separate secrets/users, bounded requests, tested database restore and rollback. Verify isolation, text/network boundaries and actual phones for each advertised combination. Production mode remains disabled until the release checks pass.

Only then invite 5–10 matching hardware-beta users; ask for two attempted sessions and honest private feedback. Failed attempts count. The proposed expansion threshold remains at least 8 of the first 10 eligible users completing the core flow unaided, with serious issues resolved, before expanding toward 25–50. This is an operating hypothesis, not a reliability guarantee. Rewards remain independent of public reviews or ratings.

## Scope boundaries

Defer generated stories, subscriptions/checkout, token wallets, native apps, public publishing, marketplaces, creator payouts, multiple device brands and affiliate dashboards. EPUB is optional after the core gates and must preserve TXT support. The separately managed marketing waitlist is not this local reader application. No hosting purchase or public deployment is part of F1/F2.

## Evidence ledger

28 October 2026, authenticated connection implementation:

- Local checks: 22 Python tests and 19 JavaScript tests passed, with syntax/configuration and whitespace checks.
- Chromium browser smoke: [passed in GitHub Actions](https://github.com/adharasi/SatinLore/actions/runs/40617085053) for code commit `7041372`, with an ephemeral database, fake SDK and mocked vendor HTTP. Verified local reader behaviour, invitation sessions, sandbox DOM isolation, targeted finite dispatch, pending-test cancellation after Stop, reconnect, logout and mobile width. This is mocked browser evidence; the live SDK was not exercised.
- Live vendor pairing, physical stop/expiry and supported-device/browser qualification: not performed.

28 October 2026, hardware-free reading-loop implementation:

- Local checks: 22 Python and 45 JavaScript tests passed (67 total), with syntax/configuration and whitespace checks.
- Expanded Chromium integration: [passed in GitHub Actions](https://github.com/adharasi/SatinLore/actions/runs/40620105720) for code commit `57304af`. Verified suggestions/manual zero and reset, settled scrolling, ceilings/Stop, reflow/mobile layout, inactivity, lock contention and pending-Start cancellation, delayed imports, literal text and memory-only storage. Reader timing uses a controlled clock; the existing mocked vendor flow runs separately with native browser timers. No physical hardware or live vendor service was used.
- Live SDK, physical stop/expiry and real story-to-device playback: not qualified or enabled.

Record build/commit, checks, tested configurations, observed behaviour, issues and next task. Automated evidence, browser evidence and live hardware evidence must have separate statuses. Do not mark physical qualification complete from a mock SDK or simulator result.
