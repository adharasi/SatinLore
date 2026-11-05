# Pattern continuity and preference phase

5 November 2026

The next pattern phase treats the reader's preferred rhythm as a continuing signal, with narrative cues supplying bounded changes in its envelope. The present source change adds an explicit steady peak choice and fixes existing sustained patterns that previously played one cycle before holding their final sample. It is a simulator-stage integration for evaluation.

Lovense documents shared-pattern discovery, preview, download, playlists and looping. Its Standard API names pulse, wave, fireworks and earthquake presets. These establish available functions. The reviewed public documentation supplies no verified outcome-specific ranking for background use, climax or edging, and the media SDK's getPatternList is scoped to a platform media ID. Current research therefore supports a comparison of pattern families and personal choices, with popularity and outcome claims kept qualified.

[Remote guide](https://www.lovense.com/guide/remote) · [Standard API](https://developer.lovense.com/docs/standard-solutions/standard-api) · [Media SDK](https://developer.lovense.com/docs/media-sync)

The offline eleven-story study describes narrative scores. Its earlier chart plots the average of each beat's endpoint labels. Across 356 valid adjacent boundaries, those plotted means change 268 times while the actual endpoint labels mismatch 85 times. These are text annotations, and a software comparison must also inspect the current renderer and dispatched timeline. Private stories and their annotations belong outside this repository.

The current reader already provides Continuous background, minimum/background/preferred settings, steady/gentle/dynamic rhythm, Hold, Ease off and Follow story. Manual zero, authored hard quiet, ended movements, missing analysis, zero gain and a zero ceiling retain explicit priority. The synchronous controller performs a targeted Stop before applying a reduction on a later normal tick. That reduction behavior can create an output gap even when a requested envelope is smooth. Observe it in traces before deciding how a later renderer should change it.

The implemented slice is small and uses original local templates.

| Change | Entry point | Evidence |
|---|---|---|
| Explicit Steady hold at a model-labelled peak | Reading controls → Advanced → Nocturne patterns | Shared preference validation, real account save/readback, selector binding and model-to-controller tests |
| Repeating rolling wave, short pulses and alternating rhythm during sustain | Existing selected or source-described simulator pattern | Long-dwell, preview and bounds regressions |
| Cycle continuity across compatible sustain paragraphs | Normal synchronous reader position path | A model-derived connective passage changes amplitude while preserving phase; the output still follows reduction and return rules |

Build, peak and recovery stages keep their documented finite stage progression. Browser behavior requires the packaged browser check, and physical pattern behavior requires its own qualification. The stage path is enabled through simulatorStagePatterns in the synchronous controller. The live asynchronous path has its existing bounded variation and is a separate implementation gate.

Haptics evidence motivates preference testing. Hasegawa et al. found that amplitude increased general arousal ratings while reducing comfort and preference in a display-feedback experiment. Aker et al. found preference penalties for time/intensity mismatch in a music task. These support separating strength, continuity and congruence as design dimensions. Their transfer to intimate reading remains unmeasured.

[Hasegawa et al., 2019](https://www.jstage.jst.go.jp/article/ijae/18/4/18_IJAE-D-18-00008/_article/-char/en) · [Aker et al., 2022](https://orbit.dtu.dk/en/publications/effect-of-audio-tactile-congruence-on-vibrotactile-music-enhancem/)

The following phase is proposed.

1. Record actual simulator targets and output for steady, repeating and story-led conditions on matched neutral traces. Measure interruption duration, phase resets, boundary step size, time at the cap, distinct quantized levels and floor behavior. Keep the original corpus and private text offline.
2. Prototype a calibrated lower band and variation range, with the carrier clock independent of paragraph changes. Story influence can adjust that band gradually. A lower setting should be evaluated for loss of contrast after integer quantization, and for preserving or deliberately allowing rests according to the reader's choice. The initial parameters are experimental choices requiring calibration.
3. Compare a familiar or tester-selected pattern, story-following output and a hybrid on the same reading material. Match caps and control average commanded level where feasible. Counterbalance order, permit immediate Stop and collect timing fit, distraction and preference. Background, climax and edging are self-selected contexts rather than outcomes inferred from a waveform. Preference collection can use a deliberately chosen study with its own recorded scope.
4. For physical integration, retain selected-toy targeting, per-action qualification, bounded command lifetime, cancellation and authoritative zero/ceiling. The documented Preset request exposes a name and duration, with no documented amplitude-cap parameter. A future range-scaled pattern transport should explicitly encode bounded levels and validate provider behavior. The current two-second command and coalescing contract requires dedicated tests before any finer pattern dispatch.
5. Add user-supplied or licensed pattern import only after establishing provider access, format validation and reuse permissions. Media SDK support for pattern data is a technical interface, while community-library access is a separate question. The published terms contain authorization and content-use restrictions relevant to that work.

[Standard API](https://developer.lovense.com/docs/standard-solutions/standard-api) · [Lovense terms](https://www.lovense.com/terms-and-conditions)

Local evidence for this slice is 22 Python tests and 573 JavaScript tests through the common check command, plus Worker packaging of 84 assets and diff checks. The focused packaged Nocturne browser command could not launch because the expected Chromium executable was unavailable. Its new steady-selection regression passed syntax checking. Physical preference, provider execution and device qualification remain open.

## Implemented follow-up

The [defaults and contextual Nocturne phase](nocturne-context-phase.md) implements fresh continuous-background and steady-peak defaults, preserves saved explicit choices, adds the neutral dispatched-trace comparison and introduces optional bounded contextual annotation. The trace confirms that Stop-before-reduction gaps remain measurable; it does not qualify physical output or preference. The calibrated-band transport prototype, matched-strength reader comparisons, wider semantic evaluation and physical qualification remain subsequent gates.
