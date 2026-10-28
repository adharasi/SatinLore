# Hardware qualification record

Copy this template for each device/browser configuration. All entries start **not tested**. Keep completed records private when they contain identifying details; use a device alias instead of a device ID. Never include developer tokens, invitation/session tokens, QR payloads, vendor responses or story excerpts.

## Configuration

| Field | Observation |
| --- | --- |
| Test date/time and timezone | Not recorded |
| Build / full commit SHA | Not recorded |
| Tester alias | Not recorded |
| Device model and alias | Not recorded |
| Device firmware / hardware version | Not recorded |
| Phone model and OS version | Not recorded |
| Lovense Remote version | Not recorded |
| Browser/version and computer/phone OS | Not recorded |
| Desktop + phone or same-phone flow | Not recorded |
| Network arrangement | Not recorded |
| Developer demo outcome | Not tested |
| Application origin / mode | Not recorded |

## Observed results

Use a low output with the device on a desk. The application requests a two-second command; record the **observed physical duration**, not the UI timer. Use a separate row for every trial and repeat interrupted-transport tests. Do not mark an untested device or browser supported by association.

| Trial | Action / interruption | Requested level and duration | Observed response / stop time | Pass, fail or not tested | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Pair and discover one eligible device | No output requested | Not observed | Not tested | |
| 2 | Select one device explicitly | No output requested | Not observed | Not tested | |
| 3 | Issue one finite pulse | Level 1; 2 seconds | Not observed | Not tested | |
| 4 | Press Stop during a pulse | Record actual request | Not observed | Not tested | |
| 5 | Lower ceiling / set zero | Record actual request | Not observed | Not tested | |
| 6 | Change selected device | Record actual request | Not observed | Not tested | Test only with devices you control |
| 7 | Disconnect Bluetooth during a pulse | Record actual request | Not observed | Not tested | |
| 8 | Interrupt internet during a pulse | Record actual request | Not observed | Not tested | |
| 9 | Close or background Remote | Record actual request | Not observed | Not tested | |
| 10 | Hide or close the browser tab | Record actual request | Not observed | Not tested | |
| 11 | Reconnect / return to tab | No new output without explicit test | Not observed | Not tested | |
| 12 | Expire or sign out of the session | No new output; verify stop/expiry | Not observed | Not tested | |
| 13 | Competing same-origin windows | No takeover of active control | Not observed | Not tested | |
| 14 | Same-phone QR/app switching and screen lock | Record exact sequence | Not observed | Not tested | Separate from desktop qualification |
| 15 | Two test identities | No unintended shared control | Not observed | Not tested | No tokens/IDs in notes |
| 16 | Neutral-text network inspection | No story or developer-token transmission | Not observed | Not tested | Do not save sensitive payloads |

## Decision and follow-up

- Qualified configuration: **none yet**.
- Unresolved failures: not recorded.
- Unsupported/untested configurations: all other combinations unless separately evidenced.
- Required fix and retest: not recorded.
- Reviewer/date: not recorded.

If output continues unexpectedly, the wrong device responds, another identity gains control or private data is exposed, stop the qualification session and record the failure. A local timer or server switch cannot guarantee an immediate stop after transport loss. Use [hardware-check.md](hardware-check.md) for setup and [qa.md](qa.md) for release gates. The current connection screen is a discrete test; it does not qualify continuous story playback.
