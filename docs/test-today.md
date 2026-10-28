# Test today without a physical device

Start here for the front end. The reader uses the simulator only: no toy, Lovense developer token or invitation is needed. The separate connection screen can also exercise invitations and logout today. Live pairing and physical output belong to the [hardware check](hardware-check.md).

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

Record the build with `git rev-parse --short HEAD`, plus browser/version and screen size. A useful first target is: import text → adjust levels → Start → scroll → observe bounded simulator output → Stop.

## 2. Use a predictable sample

Import [test-sample.txt](test-sample.txt) from the repository's `docs` directory, or paste its contents and load them. It has six ordinary, non-sensitive paragraphs. All should receive a zero suggestion from the current experimental scorer.

The scorer uses local English word cues, not a model that understands a passage. It needs contact and contextual cues together; repeated words do not raise a score, and broad negation/metalinguistic filters return zero. It is not a language detector, consent check or safety classifier and can produce false positives and false negatives. Its five suggested levels are **0, 1, 2, 3 and 5 out of 20**. Zero also means insufficient evidence. A plausible suggestion is not evidence of useful synchronisation; review and correct it. No story is generated or sent to an AI service.

For predictable playback, uncheck **Follow scrolling**, then use **Previous/Next** and assign paragraph 1 a level of **2**, paragraph 2 **4**, paragraph 3 **0**, and paragraph 4 **5**. Leave paragraphs 5–6 at their zero suggestions. These assignments test the controller independently of scoring quality.

For an optional suggestion sanity check, load each of these short, non-graphic fixtures as a separate paragraph:

| Fixture | Expected suggested level |
| --- | --- |
| The timetable listed six trains. | 0 |
| A tender kiss. | 1 |
| A tender kiss expressed affection. | 2 |
| A romantic and tender kiss expressed affection. | 3 |
| A romantic embrace, a tender kiss and affection. | 5 |

Set the last paragraph's manual override to zero, navigate away and return: it must stay zero until **Use suggestion** restores 5. These constructed fixtures check the rule implementation; they do not establish accuracy on real stories. Reload the longer neutral sample for scrolling tests.

## 3. Front-end checklist

Start each row from a known paused state where necessary. Follow-scroll changes settle briefly before selecting a paragraph; output increases can wait for the next one-second dispatch tick. A reduction can first show zero because the controller stops the previous output immediately.

| Action | Expected result |
| --- | --- |
| Load the sample, connect the simulator, but do not Start | Text is readable, a current paragraph is identified, output remains zero. |
| Select paragraph 1, set its manual level to 2, then Start | Status shows simulation playing; output is 2 with the default ceiling of 5. |
| Move to paragraph 2 | Its manual level is retained; output becomes 4 without a new Start while already playing. |
| Move to paragraph 3, whose manual override is 0 | Output becomes zero. Zero must remain a real override, not fall back to a suggestion. |
| Click **Use suggestion** for a paragraph | The source switches back to the experimental suggestion; this neutral sample returns to zero. Other paragraph overrides remain unchanged. |
| Set paragraph 2 to 4 and lower the ceiling to 1 | Output never remains above 1. It may stop to zero before the next bounded update. A ceiling of zero produces zero. |
| Enable **Follow scrolling**, press Start, then slowly scroll the reader panel | The highlighted current paragraph follows the reading band after settling. Its effective level drives the simulator. |
| Scroll quickly across several paragraphs and stop | Selection settles on the final position; intermediate paragraphs are not replayed as a command backlog. |
| Disable **Follow scrolling** and use Previous/Next | Changing mode pauses playback. Manual navigation remains usable; press Start again when ready. Scrolling alone does not take over selection. |
| Press Stop, then scroll or change a level | Output stays zero until a new explicit Start. No delayed command may restart it. |
| Hide the tab, then return | Playback is paused and stays paused. Returning does not restart output. |
| Disconnect, reconnect and wait | Output stays zero until Start. |
| Load replacement text while playing | Playback pauses; the new story has fresh suggestions and no previous overrides. Invalid replacement text should show an error and leave playback paused. |
| Clear, including during a file import | Loaded text and overrides disappear; a delayed import must not restore them. Reload also clears story state. |
| Leave playback without interaction for a little over two minutes | It pauses for inactivity and does not resume on the next interaction alone. |
| Change **Reading size** or resize the window while playing | Playback pauses before layout-driven repositioning. The reading controls remain usable after reflow. |

Use the same browser profile and exact origin for a two-window ownership check. Put two windows side by side so both remain visible; load text and connect both simulators. Start window A, then attempt Start in B: B must not take over. Stop A, then explicitly Start B. Ordinary tab switching hides A and releases its playback, so that different result is expected. If Web Locks are unavailable, reading/manual editing remain available but simulator playback reports that limitation.

## 4. Input, privacy and usability checks

- Import a UTF-8 `.txt` file, try empty input, then try a file larger than **500,000 bytes**. Invalid/oversized input should show a useful error and keep playback paused. The byte limit also applies to pasted text; non-ASCII characters can occupy multiple bytes. A story is also limited to 2,000 paragraphs.
- Try a non-TXT file and a deliberately invalid UTF-8 TXT file. Automated import tests also cover these cases; do not alter a personal document to create a fixture.
- Paste `<b>Plain text only</b>` as a paragraph. It must display literally, never render a bold HTML element or execute markup.
- At roughly 390 px width, check that the page fits horizontally, controls are readable and Stop stays reachable. Check browser zoom and both small/large reader fonts.
- Use Tab/Shift+Tab and keyboard activation for buttons, sliders and reader navigation. Focus should be visible and labels should identify their controls.
- With only the neutral sample loaded, inspect browser Network and Application/Storage panels. Reading, scoring and corrections must not upload the story, place it in URLs or save it in local/session storage. Normal asset requests are expected. Do not export a HAR containing invitation cookies or hardware pairing payloads.

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

On Linux, system packages may require `npx playwright install --with-deps --only-shell chromium`. Installation needs internet access. If installation fails, the browser check is unexecuted—not passed. The smaller `py scripts/check.py` / `python3 scripts/check.py` command remains useful without Chromium. See [QA](qa.md) for release-level checks and the [roadmap evidence ledger](beta-roadmap.md#evidence-ledger) for recorded results.

## 7. Record issues and prepare the device session

For each issue, record build, browser/version, viewport, the neutral fixture used, exact actions, expected result and observed result. Include whether it reproduces after reload. A screenshot may show neutral test text but must exclude invitation tokens, cookies, QR codes and vendor responses. Mark checks as **pass**, **fail** or **not tested**; never infer a physical result from the output meter.

Before the device arrives, arrange developer access, note the exact Lovense Website Name, install Lovense Remote on your phone and read [hardware-check.md](hardware-check.md). Those account/phone steps must be completed on your own devices. Prepare a copy of [hardware-test-record.md](hardware-test-record.md) for observations. Pairing, selected-device response, actual expiry after connection loss and physical Stop must wait for the device. Story-to-real-device playback remains disabled even if today's simulator checks pass.
