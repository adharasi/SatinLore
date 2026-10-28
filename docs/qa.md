# QA and release checklist

Automated checks cannot certify hardware behaviour. Record evidence for each supported device/firmware/Remote/phone/browser/build combination.

## Local checks

Run `py scripts/check.py` on Windows or `python3 scripts/check.py` on macOS/Linux after bootstrap. For browser smoke testing:

1. Connect the simulator and load two paragraphs.
2. Set the first level to 10 and ceiling to 3; Start must show 3.
3. Move to an unassigned paragraph; output must become zero.
4. Stop, switch tabs, disconnect and reconnect. Each path must remain paused until Start.
5. Reload; memory-only story text must be gone. Test mobile width and keyboard access.

Mark unexecuted browser tests pending. Synthetic fixtures must be neutral and credential-free.

## Physical release evidence

| Check | Required result |
| --- | --- |
| Selection and identity | Only the selected device responds; another user cannot obtain its control path |
| Ceiling and Stop | Lower ceilings apply promptly; Stop cancels future commands |
| Interrupted transport | Measure expiry after Bluetooth, internet, app or browser loss |
| Resume | Reconnect, refresh, tab return and story changes remain paused |
| Same-phone flow | Verify app switching and screen lock on each claimed platform |
| Privacy | No story text or secret payloads in requests, logs or analytics |
| Operations | HTTPS, access limits, restart, restore and rollback verified |

Repeat physical expiry tests; record requested duration and observed stop time. Use low output on a desk. One passing model does not establish general support.

Critical failures include unintended/wrong-device control, output continuing outside the verified bound, or exposed credentials/story data. Stop expansion and disable the affected path until fixed and re-tested. A server switch cannot guarantee stopping disconnected hardware.

## Feedback

Capture build, configuration, expected/actual behaviour, reproduction steps and an optional redacted screenshot. Ask about connection difficulty, synchronisation mismatch, correction burden and return use without requiring story excerpts. Keep failed users in denominators and private feedback eligibility.

Report activation as eligible users completing the agreed core session divided by eligible users starting onboarding. Report per-attempt connection results separately. Return-use metrics require a complete observation window and should distinguish participation rewards from subsequent voluntary use.
