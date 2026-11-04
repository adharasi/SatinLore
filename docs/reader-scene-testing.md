# Test the reader and Alpha movement patterns

## Setup

Open [SatinLore](https://app.satinlore.com/) and sign in to the private reader. Use the simulator for the first pass. Scene analysis runs in the browser for pasted text, uploaded files, saved stories and supported link imports. It needs no API key or new Cloudflare setting.

## Reader layout and connection

1. On desktop, create or open a story. The right sidebar should open with the first story. Switch between **Settings** and **Advanced**, and close the sidebar when you want more reading room. On a narrow screen, open it from the drawer control.
2. Add enough library entries to scroll the list. **New Story**, **New Shelf** and **Import File** should remain reachable at the bottom of the library. Open and close both sidebars and check that the playback bar follows the reading column.
3. Choose the Flexer simulator and pick its device. On the calibration screen, check that both movements start selected, try their sliders and apply the settings. Uncheck a movement to test a one-movement setup. If testing hardware, begin with the gentle check and confirm the movement and that it stopped before continuing. Keep the separate physical qualification steps in [the hardware test record](hardware-test-record.md).

## Scene patterns and controls

Paste this original test story with a blank line between paragraphs. For the comparison with the previous version, use the Nora simulator with both movements active, a maximum of 5, the same preferred levels and **Follow scene rhythm**.

> They drew closer. She held her breath.
>
> He didn’t want to leave. They shared a tender kiss.
>
> Rain tapped on the glass.
>
> A clock ticked in the hall.
>
> The fan rotated as they shared a tender romantic kiss. Their affectionate embrace grew quicker.
>
> They slowed and relaxed.
>
> Later that evening, she imagined a tender kiss.
>
> They washed the dishes and closed the curtains.

1. Wait for **Scene patterns ready**, then open **Advanced → Adjust story sections**. Read a paragraph before checking its suggestion. The early anticipation can build gently because the next beat confirms a scene. The separate thought about leaving should not cancel the kiss. The two short room details should keep the scene connected. The closer moment can feel stronger without interpreting the fan as an instruction to rotate. Expect a softer recovery and quiet at the time jump.
2. Enable **Let the story switch movements** in movement tuning to exercise the movement classifier. Explicitly confirm **Start**, then move through the paragraphs. Compare the active marker, the suggested level and the actual simulator meters. The suggestion is the story score. The requested level can vary with the rhythm, the selected movement and its calibrated range. The Nora rotation channel should stay quiet in this fixture.
3. In a longer story, scroll a few lines and wait while reading. The marker should follow the active paragraph without repeatedly switching at its boundary. Make a large scroll jump and let the viewport settle. Watch for the brief reduction while finding the new place and a gradual return on an active section. Use **Sync here** to align playback with the paragraph in view. Check that using it while paused leaves playback paused.
4. Use **−** and **+** to adjust the current section one step at a time. Lower the maximum, and try a manual section correction of zero with continuous background enabled. Both limits should take effect immediately. Reanalyse and verify the saved correction is retained. Test **Hold**, **Ease off**, **Follow story**, **Pause** and **Stop**.
5. After playback, open **Advanced → Reading feedback**. Pick a section you have read and a reason such as **Too strong**, **Wrong moment** or **Wrong movement**. Check that a marker never changes the suggestion or starts playback. A local export contains the section number and reason. Consented beta recordings can receive the same structured marker.

The rules still work from English cues and can miss an implied event, mistake a quoted action for a current one, or infer an incorrect reading position. Section review is optional and lets you correct the suggested level. The separate device controls still determine what can play.

## Rehearse build, peak and recovery patterns

In simulator mode, **Follow scene rhythm** uses a different shape for each of these stages. A peak describes the writing. Each stage step lasts about two seconds and the final level holds until the next beat. The current movement maximum, minimum, enabled movements and Stop continue to apply. **Steady**, **Gentle variation** and **More variation** give you a fixed alternative for the selected movement.

1. Choose **Set up a toy → Lush → Simulate**, select the Lush simulator in the device list, then choose **Use these settings**. Close setup, open a new story and paste the five paragraphs below, keeping the blank lines.
2. Open **Advanced → Movement tuning → Tune this movement** and set **Variation** to **Follow scene rhythm**. For this simulator rehearsal, set the playback **Maximum** and the **Preferred level** to 18. Leave **Minimum** at 0 and the section adjustment unchanged. The wide simulator range makes each step visible on the meter.
3. For each row below, pause on its paragraph, press **Start**, confirm, then watch the meter at the indicated times. Press **Stop** and check the meter returns to zero before advancing. Use **Advanced → Adjust story sections** to inspect the suggested stage.

```text
They drew closer. She held her breath.

Their slow tender kiss expressed affection.

Their passionate, tender kiss and romantic embrace expressed affection.

They slowed and relaxed.

***
```

| Paragraph | Stage | Approximate meter levels after Start, sampled every two seconds |
| --- | --- | --- |
| 1 | Slow build | 3 → 5 → 6, then steady at 6 |
| 2 | Sustaining | The passage’s gentle rhythm applies |
| 3 | Peak accents | 13 → 18 → 11 → 16 → 9, then steady at 9 |
| 4 | Gradual taper | 6 → 4 → 3 → 2, then steady at 2 |
| 5 | Quiet boundary | 0 |

The Chromium 153 simulator rehearsal matched the three stage sequences, the final held steps and zero on Stop.

Repeat the peak with a lower **Maximum** to check that it bounds every accent. For a preference comparison, replay the same passage and settings with **Steady** and record which rhythm fits better, any uncomfortable change and whether you wanted to reduce the level. Compare preferred timing and rhythm separately from the accuracy of the detected stage.

## Compare with the previous analyser

- Use version `caadcd1` as the baseline. Run the same passages, viewport, movement setup, rhythm setting and ceiling in both versions. The baseline switches automatically on a movement cue, so enable switching in the revised version for that comparison and separately test the revised default.
- For a tester pilot, prepare 20–30 short passages you have permission to use. Include ordinary paragraphs, slow build-up, obvious action, dialogue and remembered action, unrelated objects moving, interruptions and endings. Give readers both versions and alternate which version comes first. Keep the hardware qualification check separate.
- Ask readers to mark unexpected activations, missed moments, timing mistakes, unwanted movement switches and corrections. Compare corrections per ten minutes and ask which version they could keep reading with. Record device model, settings, build and paragraph number or a fixture ID. Collect feedback only with the reader's knowledge and use no private excerpts in telemetry.
- Run the neutral regression with `node --test tests/scene-evaluation.test.mjs`. It covers isolated cue traps and the progression in the test story. It gives reproducible software evidence and is separate from a reader preference study.

## Simulator read-through evidence

The same eight paragraphs were read in order in localhost Chromium 153, with the Nora simulator, both movements active, **Follow scene rhythm** and maximum 5. The revised run enabled movement switching so both versions had the opportunity to react to the turning fan. The values below are the simulator readings sampled about 1.2 seconds after moving to each paragraph. Rhythm can change the value later in a paragraph.

| Paragraph | Expected while reading | Baseline `caadcd1` | Revised |
| --- | --- | --- | --- |
| 1. Anticipation | Gentle build leading into the next beat | Still | Vibration 1 |
| 2. Kiss after a separate thought about leaving | Continue gently | Still | Vibration 1 |
| 3. Rain | Keep the same scene through the brief detail | Still | Vibration 1 |
| 4. Clock | Keep the scene connected through a second brief detail | Still | Vibration 1 |
| 5. Stronger moment with a fan turning | Increase without switching to the fan’s motion | Rotation 1 | Vibration 3 |
| 6. Relaxing | Ease down | Still | Vibration 1 |
| 7. Time jump and imagined kiss | Go quiet | Still | Still |
| 8. Ordinary ending | Stay quiet | Still | Still |

Both runs returned to zero on **Stop** and reported no browser errors. A second, longer fixture held a steady level 3 during an ordinary pause in scrolling. A jump to section 14 showed **Finding your place** at zero, then the simulator rose from zero to 2 to 3 after the view settled. **Sync here** while paused kept output at zero. An action cue left rotation at zero under the default movement setting and produced rotation after enabling switching and pressing **Start**. A post-session feedback download contained the format version, the selected section and the issue code.

These checks cover simulator behaviour in this browser and build. Preference on representative stories and physical device behaviour still need their own checks.

## Compare overlapping movements and broader scene cues

The original corpus in [scene-evaluation-fixtures.mjs](../tests/scene-evaluation-fixtures.mjs) adds four simulator stories and three context stories. The annotations distinguish a missed beat, an unexpected beat, and the wrong set of movements during a beat. They also check when dialogue, a stop, a time jump, or a descriptive gap should stay quiet.

From the repository root, run the current regression and compare against the deployed fourth revision.

```sh
node --test tests/scene-evaluation.test.mjs
git worktree add --detach ../satinlore-v4 1afa415
node scripts/compare-scene-analysis.mjs ../satinlore-v4
```

The report gives separate counts for the original and contextual suites. It checks whether the beat should be active, which movements it should request, and whether a marked boundary stays quiet. The browser read-through checks what actually reaches the simulator.

The original suite recorded these results when comparing the third and fourth revisions.

| Result | Previous `fbba0cd` | Revision 4 |
| --- | ---: | ---: |
| Paragraphs matching their annotations | 32 / 43 | 43 / 43 |
| Missed activations | 2 | 0 |
| Unexpected activations | 2 | 0 |
| Wrong movement set during a matched activation | 7 | 0 |

The previous analyser missed a gentle kiss and its lead-in, activated for a line read from a script, and carried activity across “He pulled away from her.” Those were distinct from the movement errors. The test set was developed for this revision, so these counts describe coverage of the chosen cases. They do not estimate accuracy on arbitrary stories.

| Simulator | Text cue | Expected when switching is enabled |
| --- | --- | --- |
| Flexer | The device vibrated and flexed | Both movements together |
| Flexer | The device vibrated, then flexed | Flexing only for the final beat of that paragraph |
| Nora | A fan rotated while the device vibrated | Vibration only |
| Nora | The device vibrated and rotated | Vibration and rotation together |
| Spinel | The device vibrated and began thrusting | Vibration and thrusting together |
| Osci 3 | The device vibrated and oscillated | Vibration and oscillation together |

Use the same default movement, preferred levels, maximum, and rhythm in both versions. Turn on **Let the story switch movements** and enable both simulator movements. Read each paragraph before advancing and watch both meters. Repeat with switching off, then with one movement disabled. Check a clear stop and a time jump with **Keep a background level** enabled. Each movement remains subject to its own limit and the reader’s maximum. With the default calibration, a gentle active cue should still play at 1 when the reader lowers the maximum to 1. Set the maximum to zero and both meters should go quiet.

### Flexer read-through

Paste this original text with a blank line between paragraphs.

> They drew closer. She held her breath.
>
> They kissed gently.
>
> They shared a tender kiss. The device vibrated and flexed.
>
> They shared a tender kiss. The device vibrated, then flexed.
>
> She told him to stop.
>
> “The device vibrated and flexed,” she said, recalling the demonstration.
>
> Their affectionate embrace continued. The vibration continued as her fingers flexed.
>
> Later that evening, they made tea.

In the Chromium simulator, with both movements enabled, switching on and a maximum of 5, these were the observed vibration and flexing levels after each paragraph settled.

| Beat | Previous vibration / flexing | Revised vibration / flexing |
| --- | --- | --- |
| Anticipation | 0 / 0 | 1 / 0 |
| Gentle contact | 0 / 0 | 1 / 0 |
| Explicit overlap | 1 / 0 | 1 / 1 |
| Sequential movements | 1 / 0 | 0 / 1 |
| Spoken stop | 0 / 0 | 0 / 0 |
| Quoted demonstration | 0 / 0 | 0 / 0 |
| One movement continues through another | 1 / 1 | 1 / 1 |
| Time jump | 0 / 0 | 0 / 0 |

Across all four simulator stories, the active movements matched the annotations for 10 of 18 beats in the previous release and 18 of 18 in the revision. With the same maximum of 5 in localhost Chromium 153, Nora went from vibration alone to vibration with rotation on its overlap beat. Spinel added thrusting alongside vibration, and Osci 3 added oscillation alongside vibration. After the Nora sequential cue, only rotation remained active. **Stop** brought both meters to zero on all four simulators. A Flexer maximum of zero also brought both to zero. These checks exercised the browser and simulator. Physical device behaviour is a separate check.

## Context and implied movements

The added contextual suite uses original prose in five short stories. The annotations cover grounded pulses and buzzing, one short continuation with a clear device reference, movement before and after a stop, overlapping movements, and confounders such as a heart, a phone, a lamp and quoted descriptions. Where two actions happen in sequence within one paragraph, the annotation describes its final beat. The simulator still follows the paragraph the reader is on.

| Result | Deployed fourth revision `1afa415` | Fifth revision |
| --- | ---: | ---: |
| Original paragraph annotations matched | 43 / 43 | 43 / 43 |
| New contextual paragraph annotations matched | 33 / 47 | 47 / 47 |
| Missed activations | 2 | 0 |
| Unexpected activations | 2 | 0 |
| Wrong movement sets during active beats | 8 | 0 |
| Missed quiet boundary flags | 2 | 0 |

The earlier rules activated on a journal entry and a future plan. They also lost vibration when a device pulsed while flexing and missed the one-paragraph continuation in “It pulsed twice and flexed.” These are targeted regression fixtures. A representative story set is still needed to measure accuracy beyond these passages.

For a quick Flexer replay, paste the guest room fixture from [the test corpus](../tests/scene-evaluation-fixtures.mjs). Keep both movements enabled and use **Let the story switch movements**. Pause over the quiet paragraphs as well as the active ones.

| Text cue | Expected simulator movement |
| --- | --- |
| She adjusted the toy. It pulsed in short bursts while her fingers flexed. | Vibration and flexing |
| The vibration stopped while the device kept flexing. | Flexing |
| The toy stopped vibrating while it kept flexing. | Flexing |
| The device stopped flexing. | Quiet |
| The pipes ticked in the guest-room wall. | Quiet |
| The device pulsed and flexed again. | Vibration and flexing |
| The device went still. | Quiet |

Repeat the partial-stop beat with vibration as the only selected movement and **Keep a background level** enabled. Compare the meters with both movements enabled before judging the story's movement choice. Record unexpected activation and the text beat separately from preference for any rhythm.

### Contextual simulator evidence

A separate set of 28 paragraphs was read by scrolling in localhost Chromium 153. Both movements were enabled, story switching was on, the rhythm was steady and the maximum was 5. Three settled samples were taken per paragraph. The fourth revision matched 19 movement sets and the fifth matched all 28 across the Flexer, Nora, Osci 3 and Spinel simulators. Values below are vibration and the simulator’s second movement.

| Beat | Fourth revision | Fifth revision |
| --- | --- | --- |
| Flexer pulses while flexing | 0 / 1 | 1 / 1 |
| Flexer pulses after a clear reference in the previous paragraph | 0 / 0 | 1 / 0 |
| Nora’s rotation is described in a memory | 0 / 1 | 0 / 0 |
| Osci 3 movement appears in a quotation | 1 / 0 | 0 / 0 |
| Osci 3 oscillates without pulsing | 1 / 0 | 0 / 1 |
| Spinel pulses while thrusting | 1 / 0 | 1 / 1 |

Stop cleared both meters on every simulator. No browser errors or external requests were observed in either run.

A second Flexer scroll read-through matched all 10 movement annotations. These consecutive paragraphs check that a named stop persists through a short descriptive detail and releases when the text explicitly restarts that movement. The same maximum of 5 was used.

| Paragraph | Vibration / flexing |
| --- | --- |
| They shared a tender kiss. The toy buzzed while it flexed. | 1 / 1 |
| The toy stopped buzzing while it kept flexing. | 0 / 1 |
| Somewhere down the hall the floorboard creaked. | 0 / 1 |
| They kissed gently. The toy buzzed as its arm flexed. | 1 / 1 |

A whole-device stop, remembered movement and an unrelated display pulse were quiet in that read-through. Both browser checks used simulators.

## Expectations, reported actions and competing movement

The sixth local revision was compared with the deployed fifth revision in commit e0483c3. The original and contextual suites matched all 90 previous annotations in both versions. Four new original stories add 29 paragraph annotations for unrealised actions, quoted boundaries, reported movement, competing sources and time jumps.

| Targeted regression check | Fifth revision | Sixth revision |
| --- | ---: | ---: |
| All annotations matched | 103 / 119 | 119 / 119 |
| New annotations matched | 13 / 29 | 29 / 29 |
| New missed activations | 2 | 0 |
| New unexpected activations | 6 | 0 |
| New wrong movement sets | 5 | 0 |
| New missed quiet boundaries | 3 | 0 |

The new examples cover a kiss someone expected but never shared, real contact after someone reads a time jump aloud, and a continuing vibration attributed to a phone. The new cases were chosen to exercise these changes. This comparison measures local rules against the fixture annotations. Broader accuracy and live model performance require separate tests.

~~~sh
git worktree add --detach ../satinlore-scenes-v5 e0483c3
node scripts/compare-scene-analysis.mjs ../satinlore-scenes-v5
~~~

The same suite tests the categorical rhythm hints used by Advanced analysis. A current, grounded movement can suggest accents, a sustained shape or alternation. If several different shapes match, the rules leave the shape unspecified. Ambiguous references and relevant sensitive, negated, quoted or speculative cues can exclude a paragraph from the remote analysis step. Explicit sensitive cue matches also stay quiet locally. These are conservative English cue checks with limited coverage, so the result cannot establish whether a passage is suitable.

## Alpha

1. In [Alpha](https://app.satinlore.com/alpha), choose **Allow data collection** for a test session. Connect the simulator or a supported device and complete the movement checks. The minimum, ease-off and rhythm section should start open and close when clicked.
2. Try several levels and rhythms and watch the Flexer graphic, level bars and recent traces. Check the bars return to zero when you stop the simulator, then use **Finish & stop** and save any feedback.
3. Sign in as Dilan and open the session in [Alpha admin](https://app.satinlore.com/admin). Inspect the movement pattern for vibration and flexing and compare its active time and peaks with your test. Recorded commands describe the app’s requested or simulated movement. Physical movement still needs observation at the device.
