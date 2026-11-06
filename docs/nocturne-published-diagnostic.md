# Published fiction diagnostic for Loom and Nocturne

This 6 November 2026 diagnostic adds 20 published work selections to the development evidence. Each selection is one contiguous window from a different story or independently catalogued work. The Teleny entry is a window from a novel chapter. The selections cover ten author groups, with no author group across calibration and holdout. The IDs represent new works relative to the earlier diagnostics. Some authors recur across studies.

## Source selection and labels

Selection was purposive and fixed before scoring. It includes subtle courtship, innuendo, quiet prose, frame changes, withdrawal, ambiguous consent, direct adult activity and graphic adult detail. Twain’s *1601* is a deliberate hard negative for vulgar language. All selections come from historical editions. Fourteen works come from four collection authors, so pooled scores can be sensitive to those editions. The graphic sample is concentrated in an adult-verified portion of one work. Contemporary online erotica, a broad range of adult dynamics, sustained graphic scenes and full reading sessions require permissioned sampling in a later round.

For each selection, source text was segmented with the reader’s own sentence-unit function. Model-assisted reviewers labeled each sentence before seeing any prediction. They used the surrounding story to establish narrative frame and whether a cue was eligible. Each row carries exact offsets, frame, category, phase, cue band, depiction and exclusion. The dataset did not use two independent human reviewers or adjudication.

- Cue strength uses bands 0–3. A positive cue requires evidence of a current consensual adult beat, from flirting and romantic tension through intimacy and recovery. A report or fantasy can have depiction at band 0.
- Depiction uses a separate 0–4 scale covering ordinary context, non-graphic sensuality, implied activity, directly described limited detail and graphic concrete adult detail.
- Age ambiguity, unclear consent, coercion and nonconsensual activity use band 0. The selected graphic window was screened for adult characters. These exclusions express the diagnostic rubric. Automated local cue detection has no verified ability to enforce them.
- A boundary is the earliest sentence with a definite stop, interruption, material change of scene or return from an enacted embedded frame. Its cue band is 0. Routine closure or later confirmation is insufficient.
- The paragraph-only simulator projection treats a paragraph with a protected sentence or an exact boundary as quiet. This can conservatively suppress a positive sentence in the same paragraph. Exact labels preserve both.

The private pack records edition, source locator, extracted paragraph range, per-file digest, sentence alignment digest and scope for every work. The selected historical editions were obtained from Project Gutenberg, its mirrors or Wikisource. Exact editions are scoped to this offline diagnostic based on their United States catalog status. Confirm local rights and any use-specific restrictions before redistributing or submitting material to a service. GitHub contains provenance and aggregate evidence. [Project Gutenberg terms of use](https://www.gutenberg.org/policy/terms_of_use.html) · [Teleny edition](https://en.wikisource.org/wiki/Teleny,_or_The_Reverse_of_the_Medal)

Source paragraph numbers are relative to the extraction of each work.

| ID | Published source | Split | Source paragraphs | Sentences | Positive cues | Boundaries | Max depiction |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| web01 | [Decameron VII.2 · Peronella](https://www.gutenberg.org/ebooks/23700) | Calibration | 5–7 | 26 | 0 | 1 | 2 |
| web02 | [Decameron VII.3 · Frate Rinaldo](https://www.gutenberg.org/ebooks/23700) | Calibration | 5–7 | 27 | 0 | 1 | 2 |
| web03 | [Decameron VII.5 · The jealous husband](https://www.gutenberg.org/ebooks/23700) | Calibration | 8–10 | 22 | 3 | 2 | 2 |
| web04 | [Decameron VII.10 · Tingoccio and Meuccio](https://www.gutenberg.org/ebooks/23700) | Calibration | 3–5 | 27 | 0 | 2 | 2 |
| web05 | [Decameron VIII.1 · Gulfardo](https://www.gutenberg.org/ebooks/23700) | Calibration | 3–6 | 16 | 0 | 1 | 2 |
| web06 | [Heptameron III](https://www.gutenberg.org/ebooks/28858) | Calibration | 15–22 | 29 | 3 | 1 | 2 |
| web07 | [Heptameron VI](https://www.gutenberg.org/ebooks/28858) | Calibration | 1–13 | 31 | 0 | 2 | 2 |
| web08 | [Heptameron XXXVII](https://www.gutenberg.org/ebooks/28858) | Calibration | 1–11 | 25 | 0 | 2 | 2 |
| web09 | [Venus in Furs](https://www.gutenberg.org/ebooks/6852) | Calibration | 6–16 | 25 | 5 | 2 | 1 |
| web10 | [The New Pleasure](https://www.gutenberg.org/ebooks/51107) | Calibration | 2–9 | 31 | 0 | 1 | 1 |
| web11 | [The Fair Imperia](https://www.gutenberg.org/ebooks/13260) | Holdout | 32–49 | 31 | 15 | 1 | 2 |
| web12 | [The High Constable’s Wife](https://www.gutenberg.org/ebooks/13260) | Holdout | 74–83 | 30 | 7 | 1 | 1 |
| web13 | [The Dear Night of Love](https://www.gutenberg.org/ebooks/13260) | Holdout | 4–11 | 19 | 1 | 3 | 2 |
| web14 | [Clarimonde](https://www.gutenberg.org/ebooks/39397) | Holdout | 18–25 | 30 | 4 | 1 | 1 |
| web15 | [1601](https://www.gutenberg.org/ebooks/3190) | Holdout | 11–19 | 18 | 0 | 0 | 0 |
| web16 | [The Log](https://www.gutenberg.org/ebooks/3090) | Holdout | 28–45 | 39 | 0 | 1 | 2 |
| web17 | [The Mustache](https://www.gutenberg.org/ebooks/3090) | Holdout | 3–9 | 29 | 0 | 0 | 1 |
| web18 | [The Test](https://www.gutenberg.org/ebooks/3090) | Holdout | 82–93 | 26 | 2 | 2 | 1 |
| web19 | [Sun](https://www.gutenberg.org/ebooks/67915) | Holdout | 193–204 | 40 | 1 | 2 | 2 |
| web20 | [Teleny · Chapter VI](https://en.wikisource.org/wiki/Teleny,_or_The_Reverse_of_the_Medal/Chapter_VI) | Holdout | 124–151 | 44 | 29 | 2 | 4 |

## Transition experiment

The local candidate is a narrow evidence check for explicit pauses and withdrawals. A possible anchor needs immediate narrated release or a release adjacent to previously narrated contact. The check excludes common report, conditional and negation frames and avoids crossing structural cuts. A pause and its immediate corroborating release contribute a single anchor. The permissive lexical baseline uses the same vocabulary without these corroboration requirements. Both ran on the same fixed references.

On the previous eight-story regression set, the archived Luna transition pass found eight of nine exact boundaries and emitted three false boundaries. An offline union with this candidate found the ninth, retaining the same three false boundaries. Precision moved from 72.7% to 75.0%, with recall from 88.9% to 100%. On the previous 12-story calibration set, the union left the archived result at eight of ten exact boundaries and two false boundaries. These are archived-response replays. They contain no new provider inference.

## Results on the new published selections

The 197 paragraphs yielded 565 sentence units, 70 eligible sentence cues, 47 eligible projected cue paragraphs and 28 reference boundaries. Depiction counts from grade 0 to 4 were 356, 160, 42, 3 and 4. Exclusions covered 31 units across 22 paragraphs. The seven directly depicted units were all in the selected *Teleny* window. Chapter I gives René’s age and a published study identifies Camille’s age. [Primary chapter](https://en.wikisource.org/wiki/Teleny,_or_The_Reverse_of_the_Medal/Chapter_I) · [Michael Boucai, *The Topology of the Closet*](https://doi.org/10.1080/00918369.2020.1851957)

| Split | Paragraphs / sentence units | Eligible cues, sentences / paragraphs | Reference boundaries | Corroborated found / false |
| --- | ---: | ---: | ---: | ---: |
| Calibration | 67 / 259 | 11 / 5 | 15 | 0 / 0 |
| Holdout | 130 / 306 | 59 / 42 | 13 | 0 / 0 |
| Combined | 197 / 565 | 70 / 47 | 28 | 0 / 0 |

The lexical baseline matched 3/15 exact calibration boundaries and 1/13 exact holdout boundaries, with nine and three false anchors. Allowing one paragraph of tolerance changed these to 9/15 and 1/13, with three false anchors in each split. The corroborated detector abstained throughout. Its precision is undefined and recall is 0% on both splits. The prior replay supports a narrow recovery example. The fresh result provides no evidence that this detector can handle the range of transitions on its own.

| Lush simulator, section-local run | Calibration | Holdout |
| --- | ---: | ---: |
| Loom active recall | 0/5 | 0/42 |
| Nocturne local-pattern active recall | 0/5 | 0/42 |
| False active sections, both local paths | 0/62 | 0/88 |
| Annotated protected paragraphs with output, both local paths | 0/16 | 0/6 |
| Nocturne cue-only candidates | 0 | 0 |

The reader completed local analysis. Its own scorer assigned zero to every paragraph in this sample, so the cue-only Nocturne path had no inputs and neither simulator run produced nonzero samples. The same evaluator detects cues on the existing fixture. Silence here accounts for the zero false positives and leaves precision undefined. No fresh provider predictions were generated for these excerpts. Contextual coverage and rendering are reported separately below.

### Contextual Nocturne request planning

The offline replay uses the reader’s actual window planner, a per-story budget of 12 requests and 60,000 source bytes, and immediate replies constructed from the reference after a window is selected. It runs the real annotation validator and effective-level mapping without a provider or a device. The counts establish what the system can carry under ideal replies.

| Paragraph result | Calibration | Holdout |
| --- | ---: | ---: |
| Contextual planner scheduled | 55/67 | 114/130 |
| Reference cues reached | 5/5 | 37/42 |
| Positive suggestions with perfect valid replies | 5/5 | 37/42 |
| Current cue profiles with perfect valid replies | 5/5 | 36/42 |
| Reference cue paragraphs blocked by local quiet | 0 | 5 |
| Protected reference paragraphs selected by the planner | 12/16 | 5/6 |
| Planned requests / source bytes, across all ten selections | 9 / 25,383 | 10 / 23,974 |

The five missed holdout cues were blocked locally before planning. The difference between 37 positive holdout suggestions and 36 current cue profiles is a recovery section. The 17 protected planned paragraphs expose a gap between the local planner and the reference screen. The replay substitutes abstention for protected content and sends no excerpts. This is a selection diagnostic. It cannot establish on-time coverage, semantic accuracy, resulting commands or provider eligibility.

## Reproduce

From a current checkout, with the unpacked diagnostic pack available locally:

```sh
node scripts/evaluate-nocturne-corpus.mjs /path/to/pack/published-exact.json --validate-only
node scripts/evaluate-explicit-transitions.mjs /path/to/pack/published-exact.json
node scripts/evaluate-reader-corpus.mjs /path/to/pack/published-reader.json
node scripts/evaluate-context-planning.mjs /path/to/pack/published-exact.json
```

The first command checks exact alignment. The second uses explicit stop and release evidence and scores exact and one-paragraph-tolerant anchors with one-to-one matching. The third runs Loom’s current rules and the Nocturne local pattern renderer in the actual Lush simulator, with a ceiling of 10 and samples from 0 to 8 seconds. It resets per paragraph. The fourth uses the real contextual planner and ideal reference answers. The combined reader’s default background, contextual provider decisions, continuous traversal, latency and physical feel require separate verification.

## Decision

Keep the pause detector in the offline evaluator. The published result points to cue recognition as a prerequisite for better timing. Loom’s lexical rules and the cue-only Nocturne mode had no signal on these examples. A calibration-only review found two local misses from a single reciprocal-dialogue exchange and three that required plot context or euphemism. That is too little evidence to change the local rules.

The next Nocturne experiment is a sentence-level eligibility screen ahead of request planning. Evaluate both false exclusions and protected selections. Then compare Luna’s contextual predictions and the existing typed-state candidate on hosted-approved material with clear before and after evidence. Break out explicit stops, changes of activity, scene cuts and returns from an embedded frame. Verify the live reader at its ordinary request limits. The founder story-study allowance was exhausted for 6 November, and these published excerpts were scoped to offline evaluation.

Use the [1,000-story qualification protocol](nocturne-release-qualification.md) for release evidence. It requires a new permissioned and sealed population, full stories, independent annotation, content and length coverage, a live reading trace, protected controls and a counterbalanced reader pilot.
