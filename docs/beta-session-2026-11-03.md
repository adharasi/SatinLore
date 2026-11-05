# SatinLore beta session on 3 November 2026

This runbook prepares the founder and invited tester for account setup, toy calibration, controlled reading and private session review. Rehearse the complete journey with a simulator first. A simulator pass verifies software behavior; the physical device checks below remain separate.

The feature list describes the release build. Live availability still requires a successful production deployment, active custom domains and the Access/runtime configuration below; it does not establish that those external steps or physical qualification have already passed.

## What this release provides

- The same reader on `https://app.satinlore.com` and `https://beta.satinlore.com`, behind Cloudflare email one-time PIN sign-in and the Worker's explicit tester allowlist.
- An explicit 18+ account-registration choice, durable account-wide and story-specific toy presets, export and deletion. Presets can contain per-action levels, active channels and a master maximum. Applying stays paused.
- Progressive explanations of the selected toy's actual available movements, individually checked short tests, personal levels, optional ratings and supported combined controls.
- Reopenable right-sidebar controls, continuous background, per-action tuning, Hold, Ease off, Follow story and gradual increases. User reductions and Stop take priority.
- Three original controlled fixtures before optional personal-story testing: **Find your rhythm**, **The evening train** and **Rain at the window**. Their known levels test the controls independently of the experimental text scorer. An authored quiet zero is distinct from a manual zero override.
- An explicitly consented beta-only structured timeline and founder-only `https://beta.satinlore.com/admin` review. The normal app host does not collect this beta timeline.

Story text is not cloud-synced. New stories remain Session only until Save on this browser is chosen. App and beta browser storage are separate origins. A story-specific account preset uses an opaque local story ID, not a title or content fingerprint; reimporting identical text on another browser does not automatically attach its old story preset. Use an account-wide preset for the cross-host test.

## Use one physical control host at a time

The reader's Web Locks coordinate tabs only within the same origin and browser profile. `app.satinlore.com` and `beta.satinlore.com` have separate locks; another browser/profile also has separate locks. They do not provide a shared cross-host or cross-browser physical-device lease.

Use one origin and one controlling browser/tab for a physical session. Choose the beta hostname for the complete recorded tester session. Before switching hosts or browsers, press **Stop**, observe that the toy has stopped, choose **Disconnect**, and close the previous reader tab. Then connect and complete fresh checks on the new host. Shared account presets do not share connection ownership or personal-range permissions.

## Founder setup in Cloudflare

These are configuration actions in the owner's normal browser. Do not send secrets, PINs or assertions to a coding assistant.

1. Confirm the production GitHub integration is **`adharasi/SatinLore` → `satinlore-private-app`**, branch `main`, with `npm run build:worker` followed by `npx wrangler deploy`, using Node 24. Do not change the separate `satinlore-website` deployment.
2. Let the release build finish. The tracked Wrangler routes request both app and beta Custom Domains. Migration **v2** automatically provisions the `READER_ACCOUNTS` / `ReaderAccount` and `BETA_RECORDINGS` / `BetaRecordings` Durable Objects. Keep the existing v1 feedback migration and binding. No manual D1 database, R2 bucket or new storage credential is required.
3. In **Zero Trust → Access → Applications**, edit the existing private-reader application and add **`beta.satinlore.com` with an empty path**, alongside the existing whole `app.satinlore.com` hostname. This covers `/`, `/static/*`, `/api/*` and `/admin`. Keep the founder allow rule and the existing One-time PIN login method. Do not add Everyone, Bypass or a public-assets exception.
4. If using the same Access application for both hostnames, keep the existing `ACCESS_AUD` and leave **`BETA_ACCESS_AUD` absent**. Do not create that variable with an empty value.
5. Alternatively, create a separate Access application covering the **whole beta hostname**, with the same team and the intended founder/tester allow rules. Save its exact AUD as runtime text **`BETA_ACCESS_AUD`**. Each host validates its configured audience; the beta audience is not accepted on the normal app host.
6. Ask the tester which email they will use. Add that exact email to the applicable Access Allow policy, and to the Worker's runtime text **`BETA_TESTER_EMAILS`** as a comma-separated list. Both gates must allow the person. If the Access applications are separate, configure the relevant policy on each host they will use. Do not paste their email into a public issue or this repository.
7. Under **Workers & Pages → satinlore-private-app → Settings → Variables & Secrets**, retain the following exact runtime names. Build-only variables do not configure the running Worker.

   | Name | Type and purpose |
   | --- | --- |
   | `PRIVATE_APP_ENABLED` | Runtime text, exact value `true` |
   | `ACCESS_TEAM_DOMAIN` | Runtime text, the existing team hostname ending in `.cloudflareaccess.com` |
   | `ACCESS_AUD` | Runtime text, the existing whole-app Access audience |
   | `BETA_ACCESS_AUD` | Optional runtime text only for a separate beta Access application |
   | `BETA_TESTER_EMAILS` | Runtime text, the explicitly invited tester email list |
   | `LOVENSE_DEVELOPER_TOKEN` | Runtime Secret, Lovense's application Developer Token |
   | `LOVENSE_UID_SECRET` | Runtime Secret, the independently generated 64 hexadecimal characters; not the tester's UID or the questionnaire secret |
   | `LOVENSE_PLATFORM` | Runtime text or Secret containing the exact Lovense Website Name |

8. Save and deploy changed runtime settings. `keep_vars: true` preserves dashboard-managed values across ordinary code deployments. Do not rotate the UID secret as a troubleshooting step: it changes vendor identities.
9. In **Domains & Routes**, confirm both custom domains and active certificates. Retain disabled workers.dev and preview URLs. If Cloudflare reports a conflicting beta DNS record, resolve only that beta record; leave apex/www, mail, SES and marketing records alone.
10. Sign in as the founder and open `/api/lovense/status` on the intended testing host. Expect `available: true` and `ready` checks for `developerToken`, `platform`, `uidSecret` and `storage`. This reports presence/format and storage readiness without exposing values. It does not prove Lovense accepts the token or that a toy connects. If a check is missing/invalid, correct the named runtime setting, deploy and refresh the app. There is no additional hidden Lovense enable flag.

If beta has no matching Access application yet, its Worker still denies unsigned requests; it is not a public fallback. Complete the hostname configuration before inviting a tester. A 403 after sign-in means check the audience, team and both email gates; do not bypass authentication.

## Rehearse tonight without hardware

1. Sign in to the hosted app using your existing founder email and Cloudflare PIN. Confirm 18+ and choose **Set up saved presets** if you have yet to add a profile. This step leaves recording and toy connection off.
2. Open **Toy setup**, choose **Flexer → Try a simulator**, connect and explicitly select the synthetic device. Nothing should move before a requested test.
3. Request a level-1, two-second vibration test. Watch the simulator's numeric output return to zero, then check **I checked the response and the output is stopped**. Continue to movement setup.
4. Check that Flexer explains both **Vibration** and **Fingering / flexing**. Walk through minimum, background, preferred level, upper limit and Ease off level for each movement. Sliders change drafts; they do not automatically send output. Tests require their own button, and ratings remain optional.
5. Try a short nonzero test on each movement and confirm the stopped response. If supported, select both movements on the final combined card and choose **Use these movements together**. It must remain paused. Missing/unsupported combinations must not appear as working hardware features.
6. Choose **Find your rhythm**, open it and confirm Start. Move between its sections. Compare Story dynamics and Continuous background with a nonzero background level and a lower minimum. An authored quiet passage can retain that background (at least the minimum) in Continuous background; a manual zero or master maximum zero must still produce zero.
7. Open **Reading controls → Explore the controls**. Try one action at a time, and supported combined actions with separate channel levels. Adjust a level while Hold is active, choose Ease off, then Follow story. These controls must never start a paused session. Check the labels distinguish simulator output from requested physical output.
8. Stop, then deliberately Start again. Lower the maximum to zero, hide/return, disconnect/reconnect and change the selected toy. Output must not resume from any of those actions alone. The new connection must require fresh checks before physical permission could be granted.
9. Save an **Any story** preset with a neutral name. Change settings, then Apply preset. Confirm the saved active channels and master maximum return within the current transport's permitted range, while playback stays paused. Reload and confirm the account/preset remains and no armed connection returns.
10. For a **This story** preset test, first choose **Save on this browser** for the neutral fixture. Save a story-specific preset, reload/reopen that saved story and check the preset is offered there. A different story must not silently receive it. Export presets and use explicit Remove/Delete controls only on your own disposable test data.
11. Repeat the setup/test/Stop path for the other eight profiles: Lush, Nora, Domi, Velvo, Spinel, Dolce, Hush and Osci 3. In Osci 3 simulation, check the oscillator explanation and action. Repeat core controls in Midnight Ink and at phone width. Actual-phone and physical-toy checks remain separate.

## Verify beta recording and founder review

1. Open `https://beta.satinlore.com` and sign in with the same permitted Cloudflare identity. Confirm the private account is available. Local stories remain separate from the app origin.
2. Before agreeing to recording, open/close setup and adjust a disposable draft. No beta session should be created yet. Read the recording choice; it is independent of account registration and preset saving.
3. Explicitly accept and choose **Start recording**. Wait for the recording state, then repeat a short simulator setup, calibration test, optional rating, control changes, preset action and controlled-story read.
4. Use **Pause recording** and verify the badge changes. Device control is independent: pausing/stopping a recording does not stop the toy. Use the reader's **Stop** for output.
5. Resume recording if wanted, perform another known change and choose **Stop recording**. Wait for saved/stopped acknowledgement. On a failure, use the displayed retry instead of assuming the visit was stored.
6. As founder, open `https://beta.satinlore.com/admin`, refresh and select your synthetic session. Check the toy/mode, steps, per-channel requested/simulated output graphs, control changes, optional ratings and timeline playback/seek/speed. No story title/text, typed preset name, QR, device ID, secret or credential should appear.
7. In a separate tester sign-in, verify `/admin` and admin APIs are denied while their own reader works. A tester must not see another participant's recordings.
8. Use **Change recording choice** and the withdrawal/delete controls on your own synthetic recording if testing deletion. Earlier retained sessions can be viewed/deleted from the participant's recording controls. Account deletion and browser-story deletion are separate actions.

The beta stores a structured control timeline, not DOM replay or screen video. Each recording has a 60-minute, 20,000-event and 4 MiB limit, with 30-day retention and a 128 MiB global budget. Missing/failed batches can leave an incomplete session. The normal app host must not activate beta capture, and beta controls must remain available during the guided modal. Keep respondent details and private exports out of public bug reports.

## The tester's first physical session

1. Use the approved email to sign in to the agreed testing host. Complete the explicit 18+ account registration if new. Discuss the optional recording choice before starting the test. They can skip any task or stop without needing to achieve an outcome; compensation is for the agreed testing work and honest feedback.
2. Have the tester charge the toy, install/update **Lovense Remote**, turn on Bluetooth and pair inside Remote. Confirm the toy responds there first. For this first pairing, use a computer/second screen to display SatinLore's private QR code.
3. Choose the matching model and **Connect my toy**. Follow the guided QR/Remote steps, wait for discovery and select the actual device. If several toys are paired, verify the intended one is selected and the others remain still.
4. Begin with an observable level-1, two-second test while the device is out of use. Check actual response, physical expiry and targeted Stop. Do not use an on-screen timer or SDK acknowledgement as physical proof. Keep Remote and the toy's own controls reachable.
5. Check the response/stopped confirmation only after observing it. Repeat the gentle check for every additional action the connected route exposes. Flexer may offer fingering plus vibration; Nora rotation; Osci 3 oscillation through the documented extended Socket route when offered by the connection. Physical response still needs observation. Missing actions are a capability result, not permission to improvise a command.
6. If the tester chooses to explore their personal range, use **Enable personal range** only after that movement's gentle response and Stop check. This session-only permission can allow up to 20/20; it does not raise their chosen maximum. Begin low, change the upper limit deliberately and Apply it while paused. Do not jump to 20 simply because the range is available. A saved preset alone cannot grant permission.
7. Let the tester find background, preferred, minimum, maximum and recovery levels, with optional ratings and separate settings for the exposed movements. Use the sidebar's Explore, Hold, Ease off and Follow story controls to compare adjustments. Combined controls offered by the live connection require individual checks of every selected action first. Unsupported independent motors, heating, depth/stroke controls or full Lovense Remote parity are not promised.
8. Open the controlled fixtures before bringing personal text. Compare quiet passages versus an optional background minimum, one movement versus a supported combination, and Ease off/explicit return. Start, Pause, Stop and master maximum zero must remain reliable throughout. Personal reading/import is optional after these checks; its text stays private.
9. Observe tab hide/return and a deliberate interruption. Output must remain paused on return/reconnection, and personal-range permission must reset. If a Stop cannot be confirmed, use the toy's own control and stop testing that configuration.
10. Finish with device Stop and Disconnect, then stop the recording separately. Save a preset only if the tester chooses. Do not collect their password, PIN, pairing QR, device identifier or private story in a report.

## Evidence and release status

Record model/generation, firmware when available, Remote version, phone OS, browser, build and action. Mark each connection, target, finite expiry, Stop, permission reset and reading check **pass**, **fail** or **not tested** in [the hardware record](hardware-test-record.md). Nine toys with one tester are within-person observations, not nine independent participants.

This runbook documents the implementation and required checks. Current-release automated/browser/deployment outcomes belong in the roadmap's evidence ledger after they run. No physical toy has been qualified by this coding session. Do not convert an unrun checklist, simulator pass or successful deployment into a hardware pass.
