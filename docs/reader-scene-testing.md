# Test the reader and Alpha movement patterns

## Setup

Open [SatinLore](https://app.satinlore.com/) and sign in to the private reader. Use the simulator for the first pass. Scene analysis runs in the browser for pasted text, uploaded files, saved stories and supported link imports. It needs no API key or new Cloudflare setting.

## Reader layout and connection

1. On desktop, create or open a story. The right sidebar should open with the first story. Switch between **Settings** and **Advanced**, and close the sidebar when you want more reading room. On a narrow screen, open it from the drawer control.
2. Add enough library entries to scroll the list. **New Story**, **New Shelf** and **Import File** should remain reachable at the bottom of the library. Open and close both sidebars and check that the playback bar follows the reading column.
3. Choose the Flexer simulator and pick its device. On the calibration screen, check that both movements start selected, try their sliders and apply the settings. Uncheck a movement to test a one-movement setup. If testing hardware, begin with the gentle check and confirm the movement and that it stopped before continuing. Keep the separate physical qualification steps in [the hardware test record](hardware-test-record.md).

## Scene patterns and controls

Paste the paragraphs below with one blank line between them. You can also save them as a UTF-8 text file and import it.

> Their tender romantic kiss expressed affection. The low vibration stayed steady.
>
> Rain tapped softly on the window.
>
> They shared a slow, tender romantic embrace full of affection. The soft flexing continued.
>
> Later that evening, the room fell quiet.
>
> They made tea and read the paper.

1. Wait for **Scene patterns ready**, then open the section review in **Advanced**. The brief rain detail should retain the preceding level, rhythm and movement inside the scene. The later time transition should break it.
2. Select **Follow scene rhythm**, connect the simulator and explicitly confirm **Start**. Compare the result with **Steady**. Try **Gentle variation** and **More variation** to check that your selection takes precedence over the scene pattern. Step through the first three paragraphs. With both Flexer movements enabled, the simulator should vibrate through the rain paragraph, then switch to flexing.
3. Use **−** and **+** to move the section target down or up by one. Set a lower maximum and check that the target stays within it. Move to another section and check it opens at its own level. Set a section correction to zero and verify it stays quiet with continuous background enabled. Test **Hold**, **Ease off**, **Follow story**, **Pause** and **Stop**.
4. Open a different story during analysis or retry the analysis after changing a correction. Playback should stay paused until a new Start, and deliberate corrections should remain in place.

The classifier uses English-language cues for scene, rhythm and movement suggestions. You can review and correct the suggested levels. Local cues can miss context or classify a passage incorrectly. Advisory flags identify passages that warrant review. They do not certify content, consent or safety.

## Alpha

1. In [Alpha](https://app.satinlore.com/alpha), choose **Allow data collection** for a test session. Connect the simulator or a supported device and complete the movement checks. The minimum, ease-off and rhythm section should start open and close when clicked.
2. Try several levels and rhythms and watch the Flexer graphic, level bars and recent traces. Check the bars return to zero when you stop the simulator, then use **Finish & stop** and save any feedback.
3. Sign in as Dilan and open the session in [Alpha admin](https://app.satinlore.com/admin). Inspect the movement pattern for vibration and flexing and compare its active time and peaks with your test. Recorded commands describe the app’s requested or simulated movement. Physical movement still needs observation at the device.
