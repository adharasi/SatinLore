# Beta development roadmap

Updated 28 October 2026. The next phase is a complete frontend and beta software flow using simulated devices. Hardware and vendor credentials are **not prerequisites for this phase**. The previous 48–72-hour hardware-dependent target is superseded as the immediate work order; this is not a promise that the full phase can be completed in one day.

Approved design: **Satin Editorial** is the main light identity; **Midnight Ink** is the dark theme. Provide Light, Dark and System. The [frontend specification](frontend-design.md) owns the visual and responsive requirements.

Track four states separately: planned work, implemented software, verified simulator/browser behavior and qualified physical-device behavior. A completed simulated flow does not certify a device beta.

## Baseline — implemented software

- FastAPI/static ES-module app with a local reader simulator; no frontend bundler is required.
- TXT/paste, stable paragraph IDs, experimental local suggestions and separate manual corrections, including zero and reset.
- Settled scroll-following/manual navigation, an authoritative ceiling, finite cadence, latest-value coalescing, explicit Start, priority Stop, inactivity pause and same-origin playback ownership.
- One-use invitations, expiring SQLite-backed sessions, logout, exact-origin/CSRF protection and request limits.
- Server-derived vendor identities, a separate device-check screen and sandboxed SDK bridge, explicit device selection and a bounded targeted test.

Text remains in reader-page memory. Continuous reader playback supports the synchronous simulator only. The accepted design/themes, broad scenario harness, feedback/events/deletion, optional local progress, production deployment and real reader integration are not implemented by this documentation change.

## F1. Theme system and focused reader — next

Implement the approved light/dark semantic tokens and Light/Dark/System preference. Make reading the dominant surface, with an optional laptop control rail and a compact phone dock. Keep Stop, state, output and ceiling reachable. Reuse the existing reader model and playback controller rather than duplicating them in a new UI.

Done when both themes work at 390 × 844 and 1440 × 1000, narrower 320 px layouts and enlarged browser text; keyboard focus and labels remain usable; layout changes never start playback; existing controller behavior still passes. Only the allowlisted appearance preference may persist at this milestone. Update storage assertions to allow that preference while still rejecting story/token persistence.

## F2. Complete the normal frontend journey

Implement Add story and validation, preparation/review, reading paused/playing, corrections, appearance, connection/select/test screens, clear story, help and feedback entry points. Include empty, loading, unavailable and error states. Keep simulator identity explicit and connection separate from playback. The local reader requires no invitation or vendor token; authentication can be exercised against local test invitations.

Done when a user can complete add → review → read → adjust → stop → reconnect → clear using neutral fixtures without hardware or a developer panel. Preserve manual zero and reset, literal text rendering, import cancellation and the current conservative scoring mapping. See the [frontend state inventory](frontend-design.md#screen-and-state-inventory).

## F3. Deterministic simulation and failure states

Add development-only reproducible scenarios for discovery/selection, unsupported capability, connection delay/failure/timeout, disconnect while playing, reconnect paused, command failure, uncertain Stop/output, session expiry/logout, competing tabs, inactivity and stale callbacks. Scenario controls must not clutter the consumer reader.

The current reader controller rejects Promise-returning adapters. Before adding asynchronous transport latency, design and test an explicit async contract with cancellation/generation handling as a separate milestone; do not remove the synchronous fail-closed guard to make a fixture work. Keep the existing simulator and fake-SDK bridge checks available.

Done when every fixture has asserted state/output expectations, Stop/logout/selection changes invalidate pending completions, reconnect cannot replay a backlog or restart automatically, and simulator mode makes no real vendor request. Unknown transport outcome must display as unknown, not as proof of physical Stop.

## F4. Hardware-independent beta features

Implement bounded private feedback, allowlisted coarse events, account/session deletion and explicit retention in the local backend. Failed sessions must still reach feedback. Do not request story excerpts by default. Add idempotency where retries could duplicate feedback or entitlements.

If return-to-story is included, implement explicit opt-in browser persistence with memory-only default, a shared-device explanation, Delete Story/Delete All and storage unavailable/full handling. Restore position and corrections but always paused. Appearance persistence is separate from story persistence. Current one-use invitations create temporary identities; document durable return access/recovery before promising an account history.

Done when these are working local features, not permanent mock buttons: ownership, retry, deletion and retention tests pass; network/storage checks show no unintended story transmission; the UI accurately describes what survives reload.

## F5. Scoring evaluation — parallel, non-blocking

Freeze the current heuristic as a versioned baseline. Build a rights-cleared, locally held labelled benchmark, split by story/author, with neutral negatives, benign romantic content, negation, quotations, metaphor, context changes and ambiguous passages. Keep sensitive corpora out of this public repository. Measure false activations, ordinal error, correction burden, abstention/coverage and phone latency/memory before deciding whether AI improves the result.

The current bands 0–4 map to suggested output `[0, 1, 2, 3, 5]` out of 20. Do not change that to `[0, 5, 10, 15, 20]` to match an exploratory mockup. Keep an intentional manual zero distinct from an unset override; reanalysis must not silently replace corrections.

Default to local processing. Any hosted classification path needs a separate decision on provider permission, refusal/filter behavior, privacy and data transfer before implementation. No story is sent to an AI API in this phase by default. A moderation score is not a narrative-intensity score. Missing, uncertain or malformed analysis abstains to zero/review and never bypasses the ceiling or starts playback. The frontend remains usable without AI credentials.

Done when a candidate meets agreed held-out quality and device-performance thresholds; until the benchmark exists, thresholds and model choices are proposals. AI evaluation must not block F1–F4.

## F6. Frontend and simulator readiness review

Run the common checks and affected mocked browser integration. Review laptop and phone layouts in both themes, narrow/zoom layouts, keyboard/focus behavior, safe-area/control reach, interrupted imports, all simulator scenarios, storage and network boundaries. Record build, browser/version, viewport, theme and fixture with pass/fail/not-tested status.

The phase is complete when the intended beta software journey is usable and verified with simulation, not merely when mockups look complete. Continue to label health/readiness accurately; do not enable production or real continuous output as a side effect.

## Suggested work today

1. Baseline the existing simulator and implement F1's theme system plus reader shell.
2. Finish one usable F2 add/review/read/adjust flow in both themes.
3. Add the first F3 scenarios: lost connection, expired session and invalid/empty import; verify the affected flow.
4. In parallel, define F5's labels and benchmark. Choose an AI approach only after measuring a benefit.

A focused first slice is preferable to promising all beta features today. End with checks, screenshots using neutral text, known gaps and one concrete next task. Use [the first coding handoff](frontend-design.md#first-coding-handoff).

## H1. Real-device integration and qualification — later gate

When hardware/access is available, qualify the separate [device-check flow](hardware-check.md) first. Record live SDK compatibility, same-phone app handoff, exact device/firmware/browser, selection, identity isolation, physical Stop/expiry, interrupted transport and network/privacy evidence. Then integrate continuous reader control through a separately qualified async adapter/controller and repeat latency, stale-callback, tab ownership, inactivity and session-revocation checks.

The reader's simulator evidence does not transfer to physical output. Keep story-to-real-device playback disabled until its own gate passes. Use the [hardware record](hardware-test-record.md) and [QA checklist](qa.md).

## H2. Operational release and small cohort

Complete HTTPS, production origin/cookie/proxy settings, access limits, backups/restore, rollback and support. Production mode remains disabled until operational and advertised hardware/browser gates pass. A server kill switch cannot promise immediate physical Stop on disconnected hardware.

Then invite 5–10 matching device owners; ask for two attempted sessions and honest private feedback. Failed attempts count. Expand toward 25–50 only after at least 8 of the first 10 eligible testers complete the core flow unaided and serious issues are resolved. This is a proposed operating threshold, not a reliability guarantee. Separate reward-qualifying attempts from voluntary return and keep rewards independent of public reviews or ratings.

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


28 October 2026, approved frontend direction and roadmap update:

- Satin Editorial selected as the main identity, with Midnight Ink/dark mode.
- Hardware-free frontend/software work is now the immediate track; physical qualification remains a later release gate.
- This entry records a documentation decision, not completed runtime implementation or newly executed tests.
