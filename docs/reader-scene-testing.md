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

## Alpha

1. In [Alpha](https://app.satinlore.com/alpha), choose **Allow data collection** for a test session. Connect the simulator or a supported device and complete the movement checks. The minimum, ease-off and rhythm section should start open and close when clicked.
2. Try several levels and rhythms and watch the Flexer graphic, level bars and recent traces. Check the bars return to zero when you stop the simulator, then use **Finish & stop** and save any feedback.
3. Sign in as Dilan and open the session in [Alpha admin](https://app.satinlore.com/admin). Inspect the movement pattern for vibration and flexing and compare its active time and peaks with your test. Recorded commands describe the app’s requested or simulated movement. Physical movement still needs observation at the device.
