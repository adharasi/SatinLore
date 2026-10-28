# Initial beta roadmap

Target: 48–72 hours once hardware and developer access are available. Unresolved failures block release.

## 0. Scaffold — current milestone

- Local FastAPI/static reader, manual paragraph levels and simulator.
- Shared checks, editor setup, project instructions and technical documentation.
- Local verification on 28 October 2026: 6 backend and 9 JavaScript tests passed; dependency consistency and syntax/configuration checks passed.
- Still outstanding: browser interaction verification and physical testing.

## 1. Authenticated real connection — next

1. Pair one device in Lovense Remote and reproduce the official vendor demo.
2. Implement individual invite sessions and server-derived user identity.
3. Add per-user vendor-token issuance with server-only credentials.
4. Add explicit toy selection, a short low-intensity command and targeted Stop.
5. Retain simulator mode and verify two sessions cannot cross-control.

Gate: observed physical stop/expiry, no wrong-device commands and no automatic resume. If hardware or permissions are delayed, continue local work without claiming a device beta.

## 2. Reading loop

Add experimental paragraph scoring, manual corrections, a stable reading anchor, coalesced output and an always-enforced ceiling. Add optional local progress only with deletion controls. Validate neutral text, rapid scrolling and orientation/font changes.

Gate: predictable controls and useful scoring. If corrections are frequent, report that automatic synchronisation remains unproven.

## 3. Private beta operations

Add bounded private feedback, coarse event counters, minimal SQLite records, support information, HTTPS, rollback and restore checks. Audit network behaviour, including vendor code, for unintended story transmission.

Gate: every advertised device/browser combination passes the [release checklist](qa.md). No unresolved cross-user, persistent-output or privacy failure.

## 4. Small-cohort learning

Invite 5–10 matching device owners; ask for two attempted sessions and honest private feedback. Failed attempts count. Expand toward 25–50 only after at least 8 of the first 10 eligible testers complete the core flow unaided and serious issues are resolved. This is a proposed operating threshold, not a reliability guarantee.

Measure repeat use after a meaningful observation window, separating reward-qualifying attempts from voluntary return. Keep rewards independent of public reviews or ratings.

Record build/commit, behaviour, checks, tested configurations, issues and next task. Files alone do not establish completion.
