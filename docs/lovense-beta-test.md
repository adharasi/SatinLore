# Lovense setup and nine-model beta rehearsal

Use [the 3 November founder and tester runbook](beta-session-2026-11-03.md) for the complete account → connection → calibration → controlled-story → optional personal-story journey, including recording and founder review. This guide summarizes device boundaries and replaces the older simulator-only Osci 3 and blanket 5/20 reader descriptions.

## Current connection contract

The nine profiles are **Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce, Hush and Osci 3**. Hardware-free simulation and physical connection remain separate. Choosing a model does not select a device or start output; choose the actual discovered toy explicitly.

Lovense Remote is the phone/Bluetooth bridge. The isolated vendor frame uses a documented Standard Socket Function adapter, with a narrower Standard JS SDK fallback. It receives only connection/control information, never local story text/title or private preset names. Developer credentials remain server-side; the browser receives a short-lived per-user authToken for the authenticated session only.

Initial gentle tests use one movement, two seconds, and a level no higher than 5/20 or the user's lower maximum. The tester checks the actual response and targeted Stop before confirming. After that check, **Enable personal range** may permit levels up to 20/20 for that movement in this connection. Enabling does not raise the chosen maximum, apply a preset or start output. Hide, expiry, logout, disconnect and device changes reset permission. A stored preset never grants it.

All nonzero live requests remain finite at two seconds, including personal-range and combined requests. The master maximum and each action's limits still apply; zero is authoritative. Stop after transport loss is best effort, so physical expiry and Stop must be observed independently of the timer or SDK acknowledgement.

## Model and movement boundaries

| Profile | Available baseline | Additional action when this connection qualifies it | Boundary |
| --- | --- | --- | --- |
| Lush | Vibration | None | Record the actual generation. |
| Flexer | Vibration | Fingering / flexing | Test each separately; combine only through a qualified connection. |
| Nora | Vibration | Rotation | Each chosen action needs its own check. |
| Domi | Vibration | None | Record the actual generation. |
| Velvo | Vibration | Rotation with an explicit compatible capability report | Native support alone does not establish every web transport's support. |
| Spinel | Vibration | Thrusting with an explicit compatible capability report | No heating, guessed depth or stroke command. |
| Dolce | General vibration | None | Independent internal/external vibration motors are not exposed here. |
| Hush | Vibration | None | Record the actual generation. |
| Osci 3 | Vibration | Oscillation through the qualified Standard Socket adapter | The Basic SDK fallback remains vibration-only; no heating or guessed separate motors. |

The extended adapter can combine qualified actions on **one** selected toy. Each active action has independent levels and must be individually checked before Start; each also needs its own range grant before higher output. Missing, malformed or unsupported capabilities stay unavailable. This is not full Lovense Remote parity or multiple-toy control.

Osci 3 matching accepts its explicit name/type or the Osci family with hardware version 3. It must not promote older Osci/Osci 2 devices. A capability string alone cannot authorize an undocumented Basic SDK parameter.

## Guided preferences and controlled reading

The guide explains actual movements, then offers minimum, background, preferred, upper-limit and Ease off levels for each. Short tests and stopped checks are deliberate; optional ratings can be skipped. Visuals reflect actual simulated output or labelled requested physical output. Unknown output must remain unknown.

**Use these levels** and **Use these movements together** apply settings while paused. The right sidebar re-exposes movement controls and Explore after setup, plus Continuous background, Hold, Ease off and Follow story. Hold retains known chosen output; Ease off uses each action's recovery level; Follow story returns gradually. None starts a paused reader. Manual zero and maximum zero override any background minimum. The three authored test stories use known levels and quiet passages; they are not a scorer-quality result.

Readers can explicitly save account-wide or story-specific presets after verified-email sign-in and 18+ account registration. Presets include active actions and master maximum but never credentials, arming or personal-range permission. Story text remains local, and account registration/preset saving does not consent to research recording.

## Founder readiness before the session

1. Confirm the Worker deployment and v2 account/recording bindings succeeded.
2. Configure whole-host Access for app and beta, plus the invited email in both the relevant Access Allow policy and runtime `BETA_TESTER_EMAILS`.
3. Retain runtime Secrets `LOVENSE_DEVELOPER_TOKEN` and `LOVENSE_UID_SECRET` (independent 64 hex), plus exact Website Name in `LOVENSE_PLATFORM`. Do not paste values into a report or chat.
4. After deploying settings, sign in and check `/api/lovense/status`. Its token/platform/UID/storage checks must be ready. This is configuration readiness, not vendor acceptance or physical qualification.
5. Rehearse all nine profiles with simulation, including calibration, qualified combinations, presets, Stop/restart, maximum zero, hide/return and failure/reconnect. Keep physical devices disconnected during this rehearsal.
6. On beta only, explicitly start a synthetic recording and confirm its control timeline/graphs are visible in founder `/admin`. The normal app host must not record the beta timeline.

The full [session runbook](beta-session-2026-11-03.md) includes exact dashboard steps, expected results and the physical-session sequence. The local Python invitation/device-check service remains separate and keeps its discrete level-5 test ceiling; a local invitation is not a hosted account or Access permission.

## Physical qualification evidence

For each actual configuration record build, model/generation, firmware when available, Remote version, phone OS, browser and action. Use **pass**, **fail** or **not tested** in [the hardware record](hardware-test-record.md). Begin with the device where its response can be observed and keep its own controls available. Confirm selected-device-only output, finite expiry, Stop, permission reset and explicit restart after interruption before optional personal exploration.

A simulator pass, a submitted command or a successful deployment is not a physical pass. Do not collect pairing QR/auth values, device IDs, email addresses or private stories in public evidence. The optional beta recorder keeps a bounded structured control timeline and selected ratings; it does not capture DOM/screen video or private story text.

## Official contracts

Reviewed 2 November 2026:

- [Lovense Standard Socket API](https://developer.lovense.com/docs/standard-solutions/socket-api): authenticated socket discovery and Standard command relay.
- [Lovense Standard API](https://developer.lovense.com/docs/standard-solutions/standard-api): Function actions, targeting, duration, replacement and Stop semantics.
- [Lovense Standard JS SDK](https://developer.lovense.com/docs/standard-solutions/standard-js-sdk): fallback discovery, documented browser command keys and targeted Stop.
- [Lovense Android SDK](https://developer.lovense.com/docs/native-sdks/android-native-sdk): native capability matrix, not proof of browser support.
