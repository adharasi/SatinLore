# Test today without a physical device

## Main hosted reader quick start

1. In the main reader, open **Settings → Device preferences → Edit device preferences**. Try gentle quiet movement, a maximum of 8, and a rhythm. The protected preview keeps these choices for the current visit. A verified public account can save them across sign-ins.
2. Open **Toy setup** and choose the Flexer simulator. Connect and select it, run the quick check, confirm the displayed movements stopped, and open **Advanced controls**. Check that vibration and flexing are selected and playback is paused.
3. Open a story with a detected movement. For a neutral test, use `Their tender romantic kiss expressed affection. The toy vibrated and flexed together.` Check that the scan lists Flexer above the story.
4. Open an analysed practice story with a peak, choose **Nocturne**, and change the peak pattern in Reading controls. Compare the simulator at the same maximum. Verify that Stop still stops it and a manual zero still produces zero.

## Existing beta and local checks

For the current hosted account, presets, guided calibration, personal range and beta-recording journey, use [the 3 November session runbook](beta-session-2026-11-03.md). The steps below retain the local hardware-free and invitation checks; the local invitation screen is separate from hosted email login.

Start here for hardware-free checks: choose **Try a simulator**, so no toy, Lovense developer token or invitation is needed. The reader now has nine model profiles and a separate configured live route. Use [the nine-model rehearsal and beta guide](lovense-beta-test.md) for the complete model/device/action/test workflow and tomorrow's physical session. The separate local connection screen can still exercise invitations and logout today.

## 1. Start the current build

In the VS Code terminal at the repository root, on Windows:

```powershell
git pull --ff-only
py bootstrap.py
$env:SATINLORE_DEVICE_MODE = "simulator"
$env:SATINLORE_APP_ORIGIN = "http://127.0.0.1:8000"
py scripts/check.py
py run.py
```

On macOS/Linux:

```sh
git pull --ff-only
python3 bootstrap.py
export SATINLORE_DEVICE_MODE=simulator
export SATINLORE_APP_ORIGIN=http://127.0.0.1:8000
python3 scripts/check.py
python3 run.py
```

Open <http://127.0.0.1:8000>. Leave the terminal running; Ctrl+C stops it. Use that exact address throughout these checks. Keep local changes before pulling; do not discard your work to make a pull succeed. Bootstrap needs internet access; the ordinary checks run locally after installation.

Record the build with `git rev-parse --short HEAD`, plus browser/version and screen size. A useful first target is: guided simulator setup → neutral practice → adjust strength/maximum/scrolling → Stop/restart → type/paste or import a story → read → optionally save and reopen paused. Setup can be skipped or repeated; it is not a compulsory preview/review of personal text. The separately managed marketing waitlist is not served by this local app.

## 2. Open a story and read immediately

On the blank story page, type a neutral title such as `Test A`, then type or paste the contents of [test-sample.txt](test-sample.txt) directly into the story area and open it for reading. Alternatively use **New story** or the right-sidebar upload action. You should see the full continuous story without a compulsory Review step. The six sample paragraphs are ordinary, non-sensitive text; the current scorer should give all of them zero. Analysis is local and may show a brief pending state. You can read while it runs; Start waits for a valid mapping.

The scorer uses English word cues, not semantic understanding, consent classification or a safety model. Its suggestion map remains **0, 1, 2, 3 and 5 out of 20**. False positives/negatives and correction burden require separate evaluation. No story is generated or sent to an AI service.

For visible simulator output, open **Reading controls**, choose **Story**, and open the optional intensity review for the current first paragraph. Set its manual level to **4**. Close settings. Your correction is independent of the story's automatic suggestion. Connect the simulator, choose **Start**, inspect the selected simulator, strength **1.0×** and maximum **5/20**, then confirm the labelled Start action. Output should become 4. Minus changes strength to 0.9× and the floored target to 3; Plus returns it to 1.0× and target 4. Stop must act immediately and need no confirmation.

For optional scorer checks, create a separate story with these as individual paragraphs:

| Fixture | Expected suggested level |
| --- | --- |
| The timetable listed six trains. | 0 |
| A tender kiss. | 1 |
| A tender kiss expressed affection. | 2 |
| A romantic and tender kiss expressed affection. | 3 |
| A romantic embrace, a tender kiss and affection. | 5 |

These constructed fixtures test rule behaviour, not accuracy on real stories. Use manual Previous/Next to visit a paragraph before opening its review. Set a nonzero suggested paragraph's manual correction to zero; it must remain zero at every strength until **Use suggestion** resets the correction. Reanalysis must preserve deliberate corrections. Optional review must not reveal future passages until you explicitly choose to show them.

## 3. Workspace and playback checklist

Start each row from a paused state when needed. Panel/theme/width/font changes preserve your place and pause playback. Close adjustments before testing scroll-follow and explicitly Start again. Nonzero output changes can wait for the next one-second tick; a reduction first stops the prior output before the next bounded update.

| Action | Expected result |
| --- | --- |
| Open New story and cancel, or import empty/invalid/oversized input | Existing stories remain intact; no stale import replaces one later. |
| Open a valid story in a freshly loaded workspace | Continuous text is readable immediately, Wide is selected, settings are closed and playback is paused. No mandatory review. |
| Begin reading while analysis is pending or fails | Text remains readable; invalid mapping stays zero and Start is unavailable until analysis succeeds. |
| Connect the simulator | Ready/paused, output zero. Connection never starts output. |
| Choose Start, then cancel the confirmation | No output; the shown ceiling remains authoritative. |
| Confirm Start with the current maximum | Only the current story/selection may start. The confirmation shows simulator, strength and maximum. |
| Press Stop while a confirmation or delayed Start is pending | Dialog/pending work is cancelled; no late callback starts output. Stop is available in the dialog too. |
| Use −/+ across paragraphs | Strength stays within 0.0×–2.0× in 0.1× steps, retains across paragraphs and does not rewrite their corrections. The capped target is shown. |
| Use −/+ on an automatic or manual zero | Output remains zero. Plus cannot raise the ceiling or start paused playback. |
| Press Reset beside Strength | Returns to 1.0×; other controls/corrections are unchanged. |
| Lower the ceiling, including to zero, while playing | Reduction takes priority immediately; zero blocks every nonzero command. |
| Raise the maximum with its slider | No popup or forced pause. The direct gesture changes the maximum within 0–20; output still follows the bounded target/cadence. If already paused, it stays paused. Start next confirms the current maximum. |
| Pause or Stop, then edit strength or a correction | Output remains zero until a newly confirmed Start. Strength is retained across Pause/Stop. |
| Scroll slowly, then rapidly across several paragraphs | The active cue settles on the current position; intermediate output is not replayed as a backlog. |
| Disable Follow my reading position and use Previous/Next section | Manual navigation remains available; arbitrary scrolling does not change selection. |
| Switch from Test A to another story while playing | Output stops, old pending analysis/control work is invalidated, and the new story opens paused with strength 1.0×. |
| Reopen Test A in the same session | Its text/corrections/position remain available, but no playback resumes. |
| Hide the tab or disconnect/reconnect | Output pauses and stays paused after return/reconnect; fresh Start confirmation is required. |
| Leave playback inactive for over two minutes | It pauses; the next interaction alone cannot resume it. |
| Toggle library/settings, choose Comfortable/Wide/Full or change font/theme | The active paragraph remains selected; reflow never starts playback. |
| Enter and leave Focus | Both sidebars close while the dock stays reachable; leaving restores the prior panel arrangement. |
| Open optional review | Current/already-read sections only; future sections appear only after deliberate reveal. |

For ownership, use two visible windows with the same browser profile and exact origin. Load stories/connect both. Start A, then confirm Start in B: B must not take over A. Stop A and explicitly start B. Ordinary tab switching hides A and releases playback, which is a separate expected result. Without Web Locks, reading remains available but simulator playback cannot start.

## 4. Local saving, privacy and usability

New stories are **Session only**. Reload before saving: their text, title, corrections and progress must disappear, while appearance may remain. To retain `Test A`, choose **Save on this browser** explicitly and read the shared-browser/no-cloud-backup explanation. Confirm a successful saved state before relying on persistence. This is browser-local storage, visible to other users of that profile and removable by clearing browser data.

After saving, change a correction (including zero), move to a later paragraph and rename the story. Reload and reopen it from the library: retained content/corrections/title/position should match, playback must be paused, strength must be 1.0× and no connection or armed session may return. Add a second unsaved story and reload; only opted-in stories should remain.

Choose **Session only** for a previously saved story to remove its retained copy while continuing to read in memory. Delete one story and verify it is absent after reload. Save two neutral stories, choose **Delete all**, then reload: no story should reappear. Delete all also clears the local folder catalogue. These operations do not erase appearance or delete server account data. A failed deletion must say it failed, not claim the data is gone.

The store is bounded to 20 saved stories and 2,000,000 UTF-8 JSON bytes, with per-story limits of 500,000 bytes / 2,000 paragraphs and 120-character titles; at most 20 stories can be open in the workspace. Storage may fail earlier due to browser quota or privacy settings. Saving/deletion also requires Web Locks; without support, the operation must report failure while session-only reading remains usable. Automated checks use isolated fixtures for quota, denial, corruption and stale/deleted revisions; do not corrupt a browser profile that holds your own saved stories. On failure, the in-memory story stays readable and the UI must not claim a successful save. Corrupt storage needs an explicit Delete all recovery rather than silent deletion.

With two tabs on the same origin, update or delete a saved story in one. The other tab must pause and explain that the library changed. A stale autosave must not overwrite the newer copy or recreate the deleted one. Reload only after retaining any unsaved session-only text you still need.

- Try UTF-8 text, supported AO3-downloaded HTML, empty input, too-large files, more than 2,000 paragraphs, unsupported files and invalid encoding. Errors must not destroy existing library stories. HTML extraction must never run scripts or load remote resources.
- Paste `<b>Plain text only</b>`. It must render literally, never as HTML.
- Inspect Network using neutral fixtures. Local drafts/uploads, text, titles and corrections must never enter requests, URLs, analytics or routine logs. On the exact beta host only, a separately consented structured timeline may include allowed control changes and coarse public-fixture positions without private text or IDs. A deliberate AO3 link import sends only its source URL to the authenticated import endpoint; that service temporarily fetches/extracts the public source and returns text. Normal same-origin asset requests are expected. Do not export sensitive HAR data or private source URLs.
- Before Save, storage may contain allowlisted appearance/reading preferences and an explicitly created folder catalogue, but no unsaved story text or assignment. After explicit Save, `satinlore.library.v1` may contain allowlisted local story fields and folder membership; it must contain no strength, ceiling, credentials or armed-playback state.
- Test Light/Dark/System: System follows OS changes; an explicit choice wins. Blocked preference storage must leave the page usable.
- Check 390 × 844, 1440 × 1000, 320 CSS px, landscape and 200% text/zoom. Both sidebars, optional review, confirmation dialogs and the dock must fit without hidden Stop or unreachable final text. Inspect keyboard, visible focus, slider labels, Escape and focus restoration. Use [frontend-design.md](frontend-design.md) for the complete matrix.
- Real-phone keyboard/browser bars, rotation and backgrounding still need their own checks; emulated screenshots are not phone or physical-device qualification.

## Reader refinement checks: setup, imports, folders and settings

Use neutral text or material you are entitled to import. Keep physical devices disconnected.

1. Open the guided setup from the reader. Choose a toy profile and **Try a simulator**, explicitly connect and select the discovered synthetic device, then run the short action test. Check the response and stopped output before opening the practice story. Repeat this for Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce, Hush and Osci 3 using [the nine-model guide](lovense-beta-test.md). The real-toy route is separate and must accurately show missing server configuration; there must be no automatic device selection or output.
2. Follow the practice coach: confirm Start, move through sections by scrolling or Previous/Next, use both strength buttons, change the maximum, Stop/Pause and restart. The six neutral practice sections have deliberate levels `0, 2, 4, 1, 3, 0`; these are test mappings, not claims about the scorer. The graphic/trace must follow actual output; Pause/Stop/disconnect returns it to zero. If the display stays at zero, check the current section, target, maximum, strength and playback state before assuming failure.
3. Open the practice sidebar, try different scroll speeds, then skip/finish setup. Exit must cancel pending Start and leave playback paused. An incomplete checklist must not be presented as a completed hardware setup. No completion state or chosen strength/maximum is saved to an account.
4. On a blank story page, type and paste directly. Open Reading controls and find separate upload and link-import actions. Upload a supported AO3 HTML download; source scripts/links/images must not execute or fetch resources. Plain text that looks like HTML remains literal when entered as plain text.
5. On the hosted app, deliberately request a public AO3 work/chapter link you are entitled to use. A work link requests its full work; a chapter link imports that chapter. Successful imports open paused and session-only. Try malformed/unsupported/restricted links and cancel a delayed import with Stop: existing stories must remain unchanged. Availability depends on the source allowing the request; a neutral parser fixture is not a live-site success. A local server/preview may offer upload/paste fallback when the hosted import service is unavailable.
6. For Literotica or another platform, verify the open-source-page/copy/upload fallback is clear. The UI must not claim an automatic import succeeded or bypass login, adult confirmation, terms restrictions or bot screening.
7. Create two local folders, move an unsaved story, rename a folder and filter/sort/search the library. The unsaved text must not become persisted. Save a neutral story explicitly, assign its folder, reload and check membership returns paused. Delete the folder: the story stays available in Unfiled. Backups intentionally restore to Unfiled. Duplicate/invalid folder names and denied storage must report an error without losing existing data.
8. Use the top-right Dark mode switch to change between Satin Editorial and Midnight Ink, then check the gear appearance select shows the same choice. Under System, the switch reflects the OS theme; using it makes an explicit choice. The gear also holds backup, about, Help and Support. Check both its bottom Close button and top-right × return to the reader without restarting playback. The gear's account section must show the hosted account/preset status and export/deletion controls. Local story text remains separate from account settings and is not cloud-backed.
9. Find the model choice in Reading controls. The baseline is usable; the custom/paid multi-toy tier is labelled unavailable. Selecting or viewing it must not grant unsupported control or start output.
10. At 320, 390 and desktop widths, operate both strength buttons and the maximum slider with pointer and keyboard. The gear and reading sidebar must fit, the simulator view must not cover the story, and Stop must stay accessible. Repeat with reduced motion: readable state and level feedback remain without vibration movement.

## 5. Test invitations without Lovense credentials

Keep the server in simulator mode. In a second terminal at the repository root, create one invitation:

```powershell
# Windows
.venv\Scripts\python.exe scripts/create_invite.py --hours 24
```

```sh
# macOS/Linux
.venv/bin/python scripts/create_invite.py --hours 24
```

Open <http://127.0.0.1:8000/device-check>, redeem the printed token and confirm that Sign out becomes available. The invitation field should clear. Click Connect Lovense: **unavailable/not configured is the expected result in simulator mode**, and no real pairing code should be issued. Sign out, then try the same invitation again; it must fail because invitations are one-use. Create a fresh token for another session. Repeated failures are rate-limited; wait before retrying.

For a short expiry check, stop the server and set `SATINLORE_SESSION_TTL_SECONDS=60` in its terminal (`$env:SATINLORE_SESSION_TTL_SECONDS = "60"` in PowerShell, or `export SATINLORE_SESSION_TTL_SECONDS=60` in Bash). Restart, redeem a fresh invitation and wait a little over a minute. The session should expire without automatic reconnection. Restore `3600` and restart when finished. Do not attach actual tokens, cookies or the SQLite database to reports.

## 6. Run the automated browser check

This uses an ephemeral database, a fake vendor SDK and mocked vendor HTTP. It does not contact the real vendor or control hardware:

```sh
npm ci --ignore-scripts
npx playwright install --only-shell chromium
npm run test:browser
```

On Linux, system packages may require `npx playwright install --with-deps --only-shell chromium`. Installation needs internet access. If installation fails, the browser check is unexecuted—not passed. The smaller `py scripts/check.py` / `python3 scripts/check.py` command remains useful without Chromium. The run writes neutral screenshots to ignored `artifacts/frontend/`; GitHub Actions publishes them as the **frontend-evidence** artifact. View these alongside the assertions rather than treating screenshots alone as functional evidence. See [QA](qa.md) for release-level checks and the [roadmap evidence ledger](beta-roadmap.md#evidence-ledger) for recorded results.

## 7. Record issues and continue without hardware

For each issue, record build, browser/version, viewport, the neutral fixture used, exact actions, expected result and observed result. Include whether it reproduces after reload. A screenshot may show neutral test text but must exclude invitation tokens, cookies, QR codes and vendor responses. Mark checks as **pass**, **fail** or **not tested**; never infer a physical result from the output meter.

Continue with F3 simulation scenarios and F4 software journeys in the [roadmap](beta-roadmap.md) while hardware is unavailable. Scoring evaluation can run in parallel. There is no device deadline attached to frontend progress.

For later hardware qualification, arrange developer access, note the exact Lovense Website Name, install Lovense Remote on your phone and read [hardware-check.md](hardware-check.md). Those account/phone steps must be completed on your own devices. Prepare a copy of [hardware-test-record.md](hardware-test-record.md). Pairing, selected-device response, actual expiry after connection loss and physical Stop require physical observations. The optional configured real-device route must use its own bounded asynchronous transport. Passing the simulator checks does not qualify live SDK compatibility, physical output or any model; record those separately.


## Software iteration: library, controls and private services

On the private hosted app, first check the Help build identifier against the production commit. Use neutral sample text and keep physical devices disconnected for these checks.

1. Open two stories; switch through tabs and the library. Search by title and try all sort choices. Current progress should return without starting playback.
2. Connect the simulator, confirm Start, Stop, then Start again three times. For a short two-paragraph story at the page top, set only the first section's correction to 3: Start and restart should keep the first section selected and show 3, without an unrequested jump to the second section. Try cancelling a Start confirmation, stopping while a check is pending, disconnect/reconnect and returning after hiding the tab. Read the readiness message if Start is unavailable; do not disable the authentication or lock checks.
3. In Reading controls, compare Reader and Story tabs. Save a story by explicit choice, reload and confirm a paused restore at strength 1.0×. Change width/type/spacing/follow preferences; they should survive reload independently of whether a story was saved.
4. Open the top-right gear, then Import & backup. Download one story and a whole-library backup. Import it and confirm fresh session-only copies in Unfiled, preserved corrections/position and no playback arming. A malformed/oversized backup must leave the existing workspace intact. Keep downloaded text private.
5. Open Help and Support from the gear menu; these open separately so the original session-only reader remains in its tab. Review the shortcuts and local-versus-feedback deletion scope.
6. For hosted feedback, submit one clearly labelled synthetic note, refresh and export your own notes. A failure must preserve the draft and should not claim success. If you want to remove your test note, use the explicit deletion flow yourself; it removes all feedback for that sign-in and preserves short-lived security counters. No test data should be sent to the separate marketing contact form.
7. Open `/simulator-lab`. Choose a scenario and eligible fake device, Connect, then advance virtual time until connection and initial Stop are acknowledged. Confirm Start, advance time, Stop and wait for acknowledgement. Try late-command, wrong-ack, missing-ack and failed-Stop scenarios; unknown must not become a reassuring zero without a valid later acknowledgement. Escape cancels a confirmation. No reconnect or reset automatically starts output.

`python3 scripts/check.py` (Windows: `py scripts/check.py`) runs the local automated suite after setup. The real local feedback test uses Miniflare SQLite. CI browser tests exercise actual reader interactions on localhost, while the managed HTTP preview cannot use Web Locks. Physical output and live vendor compatibility are separate qualification work.
