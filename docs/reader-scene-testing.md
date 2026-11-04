# Test the reader and Alpha movement patterns

## Setup

Open [SatinLore](https://app.satinlore.com/) and sign in to the private reader. Use the simulator for the first pass. Scene analysis runs in the browser for pasted text, uploaded files, saved stories and supported link imports. It needs no API key or new Cloudflare setting.

## Reader layout and connection

1. On desktop, create or open a story. The right sidebar should open with the first story. Switch between **Settings** and **Advanced**, and close the sidebar when you want more reading room. On a narrow screen, open it from the drawer control.
2. Add enough library entries to scroll the list. **New Story**, **New Shelf** and **Import File** should remain reachable at the bottom of the library. Open and close both sidebars and check that the playback bar follows the reading column.
3. Choose the simulator, pick a device and work through the guided movement check. If testing hardware, begin with the gentle check and confirm the movement and that it stopped before continuing. Keep the separate physical qualification steps in [the hardware test record](hardware-test-record.md).

## Scene patterns and controls

Paste the paragraphs below with one blank line between them. You can also save them as a UTF-8 text file and import it.

> Their tender romantic kiss expressed affection.
>
> Rain tapped softly on the window.
>
> They shared a tender romantic embrace full of affection.
>
> Later that evening, the room fell quiet.
>
> They made tea and read the paper.

1. Wait for **Scene patterns ready**, then open the section review in **Advanced**. The brief rain detail should retain the preceding level and rhythm inside the scene. The later time transition should break it.
2. Select **Follow scene rhythm**, connect the simulator and explicitly confirm **Start**. Compare the result with **Steady**. Try **Gentle variation** and **More variation** to check that your selection takes precedence over the scene pattern. Move to the rain paragraph and stay there briefly.
3. Set a lower personal maximum and change strength or movement gain. Check the result stays within your limits. Set a section correction to zero and verify it stays quiet with continuous background enabled. Test **Hold**, **Ease off**, **Follow story**, **Pause** and **Stop**.
4. Open a different story during analysis or retry the analysis after changing a correction. Playback should stay paused until a new Start, and deliberate corrections should remain in place.

The classifier is a first English-language rule set. Its scene and rhythm suggestions are intended for comparison and correction. Local cues can miss context or classify a passage incorrectly. Advisory flags identify passages that warrant review. They do not certify content, consent or safety. A future optional GPT-6 Luna experiment would need a separate privacy and evaluation design. This version uses the local rule set.

## Alpha

1. In [Alpha](https://app.satinlore.com/alpha), choose **Allow data collection** for a test session. Connect the simulator or a supported device and complete the movement checks. The minimum, ease-off and rhythm section should start open and close when clicked.
2. Try several levels and rhythms, pause for a moment, then use **Finish & stop** and save any feedback.
3. Sign in as Dilan and open the session in [Alpha admin](https://app.satinlore.com/admin). Inspect the movement pattern for vibration and flexing and compare its active time and peaks with your test. Recorded commands describe the app’s requested or simulated movement. Physical movement still needs observation at the device.
