# Initial beta roadmap

Target: 48–72 hours once hardware and developer access are available. Completion is evidence-based; unresolved release failures block external testing.

## 0. Scaffold — implemented

Local FastAPI/static reader, manual paragraph levels, simulator, checks, editor setup and Codex instructions are present. Text import stays in page memory. Browser coverage and physical-device evidence are tracked separately from unit tests.

## 1. Authenticated connection — code implemented; live qualification pending

Implemented:

- One-use invitations, expiring SQLite-backed sessions, logout, exact-origin/CSRF protection and request limits.
- Server-derived identities for the server-only vendor-token exchange; client-supplied identities are rejected.
- A separate device-check screen with the SDK isolated in a sandboxed bridge.
- Explicit selection of one eligible device, a two-second low-output test and targeted Stop.
- The original simulator remains available; story reading does not yet control real hardware.

Remaining gate:

1. Confirm developer access and pair one physical device in Lovense Remote.
2. Run the official vendor demo, then SatinLore's [hardware-check flow](hardware-check.md).
3. Record live SDK compatibility, browser isolation/network results, selected-device behaviour, stop/expiry timing and no automatic resume.
4. Verify separate users and interrupted sessions cannot cause unintended control; retain test configuration and build evidence.

No hardware support or device beta is certified by the automated suite. If hardware/access is delayed, continue local reading-loop work while keeping real playback unqualified.

## 2. Reading loop — next implementation phase

Add experimental paragraph scoring, manual corrections, a stable reading anchor and coalesced output. Keep the user ceiling authoritative and require explicit Start. Connect the reader to a qualified isolated device bridge only after its acceptance checks.

Add controller tests for rapid scrolling, stale messages, session/device/story changes, tab competition, inactivity, Stop and reconnection. Optional local progress requires deletion controls. Validate orientation/font changes and retain manual navigation.

Gate: predictable controls and useful scoring with neutral fixtures, plus physical verification of real playback. If corrections are frequent, automatic synchronisation remains unproven.

## 3. Private beta operations

Add bounded private feedback, coarse event counters, data deletion/retention, support information, HTTPS, rollback and database restore. Expand the existing session store only for necessary records. Audit network behaviour, including vendor code, for unintended text transmission.

Gate: every advertised device/browser combination passes the [release checklist](qa.md). Resolve cross-user control, persistent output and privacy failures before release. Production mode remains disabled until this work is complete.

## 4. Small-cohort learning

Invite 5–10 matching device owners; ask for two attempted sessions and honest private feedback. Failed attempts count. Expand toward 25–50 only after at least 8 of the first 10 eligible testers complete the core flow unaided and serious issues are resolved. This is a proposed operating threshold, not a reliability guarantee.

Measure repeat use after a meaningful observation window, separating reward-qualifying attempts from voluntary return. Keep rewards independent of public reviews or ratings.

## Evidence ledger

28 October 2026, authenticated connection implementation:

- Local checks: 22 Python tests and 19 JavaScript tests passed, with syntax/configuration and whitespace checks.
- Chromium browser smoke: added for CI with an ephemeral database, fake SDK and mocked vendor HTTP. Local browser installation failed; CI result pending.
- Live vendor pairing, physical stop/expiry and supported-device/browser qualification: not performed.

Record build/commit, checks, tested configurations, observed behaviour, issues and next task. Automated evidence, browser evidence and live hardware evidence must have separate statuses. Do not mark physical qualification complete from a mock SDK or simulator result.
