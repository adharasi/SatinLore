# Lovense setup and eight-model beta rehearsal

Use this guide to rehearse without hardware on 2 November 2026, then record the first physical observations with the tester on 3 November. The eight profiles are **Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce and Hush**. A simulated pass is a software result; it does not qualify a physical toy, firmware, phone or browser.

## What the integration does

The guided setup separates **Try a simulator** from **Connect my toy**. Both journeys require an explicit device selection, a short test and a separate confirmed Start for the practice read. Selecting a model helps organise setup; a live connection's actual discovered device ID and capabilities determine what may be commanded. One toy and one available action are selected at a time. It does not start every toy paired to Lovense Remote.

The real connection uses Lovense Remote as the Bluetooth bridge and the official Standard JS SDK in an isolated frame. SatinLore does not ask the browser to pair directly over Bluetooth. Local story text, titles and corrections stay in the reader; only connection/control information crosses into the vendor bridge. The hosted endpoint obtains a per-user authentication token using a server-held developer token.

Physical beta commands are limited to **two seconds and at most 5/20**. The lower user-selected maximum still applies, including zero. The simulator permits the existing 0–20 software range. The meter and graphical movement represent simulation or requested/transport-reported output, as labelled; they are not a physical sensor measurement. Stop is best effort after connection loss, so record actual physical expiry separately.

## Owner setup before the tester signs in

1. Follow the [Cloudflare runbook](../deploy/cloudflare/README.md) for the Lovense runtime settings. Do not paste any secret into chat, source files, screenshots or a test report.
2. In the Lovense developer dashboard, obtain the application Developer Token and note its exact **Website Name**. A Developer Token and a per-user `authToken` are different credentials.
3. Save `LOVENSE_DEVELOPER_TOKEN` as a Cloudflare runtime **Secret**, and `LOVENSE_PLATFORM` as the exact Website Name. The platform value is a normal runtime variable.
4. Generate a new, independent 64-character hexadecimal random value in Bitwarden and save it as runtime **Secret** `LOVENSE_UID_SECRET`. It must not reuse the questionnaire webhook secret or another application's secret. Keep the same value across ordinary deployments; changing it changes the pseudonymous Lovense user IDs.
5. Ask the tester which email they will use to sign in. Add that email to the existing app's Cloudflare Access allow policy and to the Worker's `BETA_TESTER_EMAILS` comma-separated runtime variable. Both gates must allow the person. Keep the founder policy and all existing Access audience/team settings. No tester address is pre-populated in source.
6. Deploy the updated runtime settings using the runbook, open the app, and choose the real connection route. Its configuration status must report availability before a real pairing code can be requested. A missing configuration is an expected blocked state, not a successful connection. Do not repeatedly request new codes: token issuance is limited to three per minute and twenty per hour per signed-in subject.
7. Verify the tester can sign in before the scheduled call. Cloudflare Access is currently the sign-in gate; it does not provide cloud story storage or a durable SatinLore reader account.

The Python invitation/device-check service remains separate from the hosted app. Local invitation tokens do not grant hosted Access permission, and hosted secrets do not automatically configure the local Python server.

## Rehearse every model without a toy

Keep physical devices disconnected. No Lovense credentials or vendor script is needed for simulation.

1. Open the reader and its setup/test-read guide.
2. Choose the required toy profile, then **Try a simulator**. Read the simulated status before proceeding; a rehearsal pairing illustration is not a real QR code.
3. Connect the simulated session. Select the discovered synthetic device explicitly. An available device must never be silently selected or started for you.
4. Choose an available action under **Test one movement**, leave **Test level** at 1 and choose **Test for 2 seconds**. Observe the model's graphic and output readout, wait for it to return to zero, then select **I checked the response and the output is stopped.** A test request does not start reading playback.
5. Choose **Continue to test read**, then **Open practice story**. Confirm Start with the shown toy, action, strength and maximum. The practice sections have deliberate levels `0, 2, 4, 1, 3, 0`; they test the controls independently of the experimental story scorer.
6. Move through the practice sections with scrolling and Previous/Next. Try strength minus/plus, a lower maximum and a zero maximum. Zero must remain zero. Pause/Stop and changes made while paused must never restart output.
7. Stop, then explicitly Start again. Hide and return to the tab, disconnect and reconnect, switch stories and close/reopen setup. Each return must be paused and require a fresh Start.
8. Under **Rehearsal tools**, use **Simulate disconnect**, **Simulate connection error** and **Reconnect**. A lost connection or command error must stop dispatch, show an accurate error/disconnected state and require explicit reconnection; reconnecting alone must not restart output. Use the separate `/simulator-lab` for delayed/wrong/missing acknowledgements and failed-Stop fixtures.
9. Repeat for all eight profiles and each action offered by that simulated profile. Repeat the key selection/test/Stop/reconnect actions in Midnight Ink and Satin Editorial and at a phone-width viewport. A viewport simulation does not establish real-phone compatibility.

Do not mark a hardware setup complete from a simulated checklist. The guide can be skipped or repeated and does not save an armed connection or calibration to an account. Unsaved stories clear on reload; save any text you need before refreshing.

## Model and action boundaries

| Profile | Baseline live action | Additional action when exposed by this connection | Limits of this beta |
| --- | --- | --- | --- |
| Lush | Vibration | None | Discover the actual generation; record it in the test report. |
| Flexer | Vibration | Fingering | Only offered where supported by the discovered device/SDK contract. |
| Nora | Vibration | Rotation | Test the selected action separately; no automatic multi-action routine. |
| Domi | Vibration | None | Record the actual generation and Remote version. |
| Velvo | Vibration | Rotation, only with an explicit compatible capability report | Native model support is not proof that every Standard JS SDK/Remote combination exposes the motion. |
| Spinel | Vibration | Thrusting, only with an explicit compatible capability report | No heating, depth, stroke-length or undocumented command is implemented. |
| Dolce | General vibration | None | Independent internal/external motor control is not claimed through this Standard JS SDK integration. |
| Hush | Vibration | None | Record the actual generation and Remote version. |

If a motion is absent in the live action list, use the available vibration route and record the missing capability. Do not substitute an unknown action or assume that a simulator's action list proves vendor availability. A model's physical functions and the actions exposed by a particular SDK are separate facts.

## First physical connection with the tester

1. Use neutral practice material and begin with the device out of use where its response can be observed. Keep the device's own power/Stop control available.
2. Have the tester install/update **Lovense Remote**, charge the toy, turn it on and pair it inside Remote. Confirm it responds in Remote first. SatinLore does not replace this Bluetooth-pairing step.
3. Open SatinLore on a computer or second screen and sign in with the approved email. Choose the matching model and **Connect my toy**.
4. Follow the displayed pairing instructions and scan the private QR code using Lovense Remote. Keep the code private. For the first test, use a second screen; a same-phone handoff/deep-link flow is not promised by this build.
5. Wait for a connected device to appear. Choose that exact device explicitly. If multiple toys are connected, check the model and identifying suffix before selecting; selection must not broadcast to the others.
6. Start with vibration at level 1 and request one two-second test. The tester should report whether the intended device responded, whether another toy remained still, and whether the selected toy physically stopped. Check the actual result rather than relying on the timer or a successful SDK return.
7. Only after observing the result and stopped output, confirm that check and continue to the neutral practice read. Select an additional action only if the live connection actually offers it. Repeat the isolated level-1 test before using a different action.
8. Confirm Start with a low maximum. Read through the deliberate quiet/nonzero practice sections, then test Pause, Stop, a zero maximum, strength reductions and Stop → Start. Keep each action controlled and stop the session if output is unexpected.
9. After the basic test, check tab hide/return and a deliberate connection interruption while observing physical expiry. Returning or reconnecting must stay paused. If Stop cannot be confirmed, use the toy's own control, record the failure and do not continue that configuration.
10. Finish with Stop and Disconnect. Personal story import is optional after the practice checks; neither the owner nor a test report needs the tester's story, account credentials, pairing code or private control link.

## Record evidence without private material

Record build/commit, toy model/generation and firmware when available, Lovense Remote version, phone OS, browser/version and the tested action. For each check write **pass**, **fail** or **not tested**, with a short neutral reproduction. The [hardware record](hardware-test-record.md) can hold the detailed physical observations.

| Check | Software rehearsal | Physical observation |
| --- | --- | --- |
| Model choice, explicit device selection and test flow | Record after running | Record separately for each actual toy |
| Requested action and selected toy only | A fake transport can verify message targeting | Tester observes intended and unselected toys |
| Two-second expiry and Stop | Test finite payload/timer/error behaviour | Tester measures actual end of output |
| Hide, disconnect, failed command and explicit restart | Deterministic fixtures plus reader checks | Tester observes transport-loss behaviour |
| Story-to-output usefulness | Practice checks mapping/plumbing | Needs separate reading/scoring evaluation |

No physical model is marked qualified by this document. Local tests, signed-in browser acceptance, deployment status, live vendor pairing and physical results belong in separate evidence entries. Do not include email addresses, QR/auth payloads, device IDs, stories, exported cookies or private HAR files in public issues or repository screenshots.

## Official contracts reviewed

Reviewed 2 November 2026:

- [Lovense Standard JS SDK](https://developer.lovense.com/docs/standard-solutions/standard-js-sdk): per-user SDK authentication, QR/discovery, action names and targeted finite commands.
- [Lovense Standard Socket API](https://developer.lovense.com/docs/standard-solutions/socket-api): server-side developer-token exchange and Website Name.
- [Lovense Standard API](https://developer.lovense.com/docs/standard-solutions/standard-api): capability names and command semantics.
- [Lovense Android SDK](https://developer.lovense.com/docs/native-sdks/android-native-sdk): current model/action matrix; native support alone does not establish browser-SDK compatibility.
