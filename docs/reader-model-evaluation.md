# Loom and Nocturne evaluation

Run `node scripts/evaluate-reader-models.mjs` from the repository root. The JSON includes the expected and observed phase, movement cue, cue eligibility, rhythm label and simulator trace for every section. It prints the names of the original fixture sections and their numeric results. The [fixture annotations](../tests/reader-model-evaluation-fixtures.mjs) cover 25 sections across the Conservatory, Lantern room, Workshop notes and At the station stories. This is a small neutral corpus with targeted edge cases.

The evaluator runs the actual browser `ReaderModel`, Nocturne client and Worker scene handler. A deterministic mock chooses labels from the same enums and section ordinals that a live provider would receive, independently of the annotations. The two runs then start the actual simulator controller from each section at a 10/20 maximum, strength 1.0, with Follow scene rhythm and automatic movement selection enabled where supported. Each run samples the movement vector at 0, 2, 4, 6 and 8 seconds. The start and Stop checks are separate from scene classification. The browser and Worker suites exercise UI opt-in, response validation, authorization and fallback independently.

## Results

| Metric | Loom v6 | Loom v6.1 |
| --- | ---: | ---: |
| Local phase matched the annotation | 22/25 | 24/25 |
| Simulator on/off matched, with Loom and with Nocturne mock | 22/25 each | 24/25 each |
| False activations | 2 | 0 |
| Missed activations | 1 | 1 |
| Local movement cues matched the annotation | 24/25 | 25/25 |
| Simulator movement set matched expected enabled output | 22/25 each | 24/25 each |
| Annotated rhythm shapes matched locally | 12/12 | 12/12 |
| Sections passed or skipped as expected at the Nocturne eligibility boundary | 25/25 | 25/25 |
| Annotated blocked sections stayed off the provider path | 7/7 | 7/7 |
| Mock labels matched the annotated selections or abstention | 9/9 | 9/9 |
| Sections with a different simulated rhythm under Nocturne mock | 3/25 | 3/25 |

Loom v6.1 recognized 8/8 quiet sections, 3/4 builds, 10/10 sustained beats, 2/2 peaks and 1/1 recovery. It turned off at scene breaks, respected a manual zero and kept a nearby fan's rotation from taking over. A rotation cue on the vibration-only Lush simulator fell back to vibration. The v6 false activations came from an indirect report with an intervening recipient and an unrealised “were going to” action. The new rules keep both quiet, and a regression test covers a real action in the sentence after a planned action. The existing 119-section targeted regression still matches 119/119. The French contact cue was missed in both revisions of the English scorer. Nocturne mock reproduced the activation outcomes because the Worker can only return timing patterns for existing eligible sections.

| Changed beat | Loom vibration at 0, 2, 4, 6 and 8 seconds | Nocturne mock |
| --- | --- | --- |
| Steady movement | 2, 2, 1, 1, 2 | 2, 2, 2, 2, 2 |
| Variable movement | 2, 2, 2, 2, 2 | 1, 2, 1, 1, 1 |
| Sustained peak | 5, 7, 4, 6, 3 | 5, 6, 7, 7, 3 |

The two v6.1 variants completed 50 explicit simulator starts and stops. All 270 nonzero commands stayed at or below the selected maximum and used two-second packets at least one second apart. Stop cleared the simulator immediately and prevented renewal. Nocturne changed the curve on three sections while preserving phase, base level and active movements. The mock agreement measures the integration. A live provider result and physical output require separate evidence.

## Live comparison

For a deployed test, an admitted reader can follow [Nocturne setup](../deploy/cloudflare/README.md#enable-nocturne-for-the-private-beta), select the same eligible practice story, run Nocturne once and record the returned pattern alongside Loom's simulator trace at the same settings. To replay the full original corpus against Luna through the local Worker handler, run `node scripts/evaluate-reader-models.mjs --live-provider` with an authorized API project key supplied privately as `OPENAI_API_KEY` in the process environment. This opt-in mode makes up to four billable provider requests with abstract cues only, using the Worker's model, prompt and response validation. It uses a local test session and quota stub, so production access and deployment are still verified through the hosted app. Each story's result records the provider status or fallback code and omits failed labels from label accuracy.

On the hosted PR #6 build `95ab8af`, a signed-in run on a three-paragraph original rehearsal observed Loom levels of 1, 5 and 1 at a maximum of 10, with 0 immediately after Stop. Nocturne reported available before the run. The single eligible long-wave cue produced a service error and the reader showed its Loom fallback. This verifies the hosted failure path. The live classifier returned no labels to compare on that run.
