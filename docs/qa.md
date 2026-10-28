# QA and release checklist

For a practical front-end session without a device, start with **[test-today.md](test-today.md)** and its neutral sample. Use this document for the wider release checklist.

Track automated, browser and hardware evidence separately. Record each supported device, firmware, Remote version, phone, browser and build. A passing mock does not certify hardware.

## Automated checks

Run `py scripts/check.py` on Windows or `python3 scripts/check.py` elsewhere after bootstrap. This covers Python/JavaScript tests, syntax and configuration without network or hardware access.

Browser integration checks are separate and use a fake SDK and mocked vendor response:

```sh
npm ci --ignore-scripts
npx playwright install --only-shell chromium
npm run test:browser
```

Linux may need `npx playwright install --with-deps --only-shell chromium`. Browser installation requires internet access. These checks establish application/browser behaviour against the fixture, not live SDK compatibility. Record an installation failure as unexecuted browser evidence, not a passing test.

## Reader and simulator checks

Use the action/expected-result table in [test-today.md](test-today.md). Cover:

- Import bounds (500,000 UTF-8 bytes; 2,000 paragraphs), empty/malformed input, literal HTML-looking strings and delayed-import cancellation.
- Five-band local predictions, distinct manual overrides, zero overrides, reset and new-document/clear lifecycle. Record scoring errors separately from control failures.
- Scroll settling and boundary hysteresis, rapid jumps, long paragraphs/gaps, manual navigation, font/window reflow and keyboard/mobile usability.
- Explicit Start, authoritative ceiling, immediate Stop on reductions, finite dispatch cadence and coalescing of the latest desired level.
- Stop while a selection is pending, hide/return, disconnect/reconnect, replaced stories, inactivity, delayed timers and adapter errors. None may automatically resume output.
- Two visible same-origin windows in one browser profile: the second cannot take over active simulator playback. Ordinary hidden-tab interruption is a separate case.
- No story text in network requests, URLs or browser storage. Use neutral fixtures and do not export sensitive request data.

Current continuous playback supports the synchronous simulator only. Passing these checks does not qualify a real asynchronous adapter or continuous physical output.

## Authentication and bridge checks

- Redeem a fresh invitation once. Reuse, expiry, malformed fields and concurrent redemption must not produce extra sessions.
- Verify exact-origin and CSRF rejection, rate limits, expired sessions and logout. Do not include actual cookies or tokens in reports.
- Verify two test identities receive their own server-derived UID; caller-supplied identities are rejected. Logout during vendor issuance must prevent its response from establishing a session.
- Check generic vendor failures, timeouts, oversized responses and missing credentials without credential leakage.
- Verify no vendor script runs in the reader or device-check parent DOM. The bridge has no same-origin permission and only the intended parent can establish its message channel.
- Exercise malformed messages, missing selection, unsupported devices, disconnect/reconnect, expiry and delayed SDK callbacks. No broadcast or automatic nonzero output may occur.
- Delay session verification, then press Stop or change selection/output. The pending test must not start after the interruption. A second same-origin tab must not acquire the active device-check lock.
- In a live browser, inspect requests with neutral text only. Do not save QR/auth payloads in screenshots, HAR files or issue attachments.

## Hardware qualification

Follow [local setup](hardware-check.md) and record each configuration/trial using [hardware-test-record.md](hardware-test-record.md). Start with a paired device on a desk and one control tab. The current check page sends discrete commands; continuous reading playback remains separate work.

| Check | Required result |
| --- | --- |
| Selection and identity | Only the explicitly selected device responds; another identity cannot obtain its control path |
| Bounds | Requested output stays at or below 5/20 for the two-second test |
| Stop | Targeted Stop is issued promptly and observed output stops |
| Interrupted transport | Measure expiry after Bluetooth, internet, app or browser loss |
| Interruption | Hide, disconnect, selection change, expiry and logout cancel control without automatic resume |
| Same-phone flow | Qualify QR/app switching and screen lock separately on each claimed platform |
| Privacy | No story text or developer token in client/vendor payloads, logs or analytics |

Repeat physical expiry tests and record requested duration versus observed stop time. A UI timer, API response or one passing model is not evidence of broader support. Repeat tab competition and inactivity checks when the real reading controller is introduced; simulator evidence does not transfer to physical control.

## Operational release checks

Before external invitations, verify HTTPS, production cookie/origin/proxy controls, access limits, explicit retention/deletion, restart, backup/restore and rollback. Current opportunistic SQLite cleanup is not a complete operational retention policy.

Critical failures include wrong-device control, output continuing outside the verified bound, cross-user access or exposed credentials/story data. Stop expansion and disable the affected path until fixed and re-tested. Backend revocation cannot guarantee stopping disconnected hardware or revoking vendor-issued credentials.

## Feedback and reporting

Capture build, configuration, expected/actual behaviour, reproduction steps and an optional redacted screenshot. Ask about connection difficulty, synchronisation mismatch, correction burden and return use without requesting story excerpts. Failed attempts count for private feedback eligibility.

Activation is eligible users completing the agreed core session divided by eligible users starting onboarding. Report per-attempt connection results separately. Return-use metrics need a complete observation window and must distinguish participation rewards from later voluntary use.
