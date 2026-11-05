# SatinLore release acceptance

The first controlled release should let an adult reader open an English story, pair and check one qualified device or choose its simulator, confirm a ceiling and read without reviewing every paragraph. Clear narrative changes should register within the reader’s calibration, ordinary passages should follow the chosen background setting, and Stop and corrections should take priority at every point. Loom supplies a usable local experience. Contextual Nocturne earns its place by recovering context Loom misses within an explicit, bounded review session.

The figures below are proposed acceptance thresholds. Freeze them before running the release holdout. Apply the gates to the exact candidate build and to each configuration in the advertised release scope. A software result can clear the simulator gate. Hardware claims require observed device results, and claims about the reading experience require reader feedback. [Beta roadmap](beta-roadmap.md)

## Story range and reference labels

Start with **40 unseen works from at least 20 authors and 2,400 adjudicated paragraph anchors**, with at most four works per author. Keep whole stories, authors, series, translations and near duplicates in one partition. Keep calibration and development material separate from the release holdout. The eleven-story study, earlier excerpts used to adjust the rules and *Nightswimming* are development regressions. Freeze a fresh holdout whenever its failures inform tuning.

Use material cleared for the relevant evaluation and record scope, source edition, rights evidence, text digest, paragraph boundaries and rubric version in the private manifest. Check adult eligibility for intended scenes. Hosted probes also need permission for excerpt processing. Keep text, permissions and identifying reader records outside Git. Use neutral original fixtures to test protected or otherwise ineligible cases. [Existing corpus format and protocol](reader-corpus-evaluation.md)

| Dimension | Required coverage |
| --- | --- |
| Length and pacing | At least eight works in each of 500–2,000, over 2,000–8,000, over 8,000–20,000 and over 20,000 words within import bounds. Include short dialogue runs, long paragraphs, long quiet openings, quick changes and sustained scenes. Separately test one-section stories and inputs at and beyond 500,000 UTF-8 bytes and 2,000 paragraphs. |
| Narrative style | At least five works in each of contemporary, historical, speculative and suspense or mixed-genre slices. Include first and third person, subtle and direct cues, dialogue-led and descriptive writing, shifts in perspective and chapter or scene breaks. Slices may overlap. |
| Narrative evidence | Cover quiet, mild romance, flirting, tension, grounded intimacy, stronger textual scenes and aftermath. Include different relationship dynamics, pairings and points of view. Include current events, imagined events, reports, memories, ambiguous cases and passages that mix these modes. Include context carried across several short paragraphs. |
| Negative and boundary cases | At least 500 neutral or ambiguous anchors and 120 decisive quiet or stop boundaries. Include ordinary affection, non-romantic suspense, discussion of an event, quoted instructions, unrealised action, unrelated object motion, withdrawal and hard scene cuts. Include malformed imports and unsupported-language text as fallback checks. |
| Reading and entry points | Paste, TXT upload, supported link import and paused story restoration. Replay at 120, 240 and 420 words per minute, with long dwell, reverse scroll, fast seeks, reflow, hide and return. Include starts partway through long stories and measure where build, peak and recovery fall in actual reading time. |

Use model-assisted annotations for development and error triage. For release, two reviewers independently label consecutive passages with their surrounding story context before seeing model outputs. The unit is the app’s imported paragraph. Mark the span or transition within a mixed paragraph when it matters, and preserve both first-pass labels. A third reviewer adjudicates disagreement. Require at least **0.70 Cohen’s κ** for cue eligibility and event kind before adjudication, review disagreements by slice, and rerun the rubric pilot if agreement falls short.

| Field | What to record |
| --- | --- |
| Category | Neutral, romance, flirting, tension, intimacy, explicit, aftermath or abstain. Use fixed labels and evidence offsets. |
| Event kind | Current, imagined, reported, historical, uncertain or neutral. A present event is grounded in the scene as narrated, including ordinary past-tense storytelling. Flag conflicting evidence and retain uncertainty. |
| Phase and grouping | Quiet, build, sustain, peak or recover under the category’s allowed phases. Mark the scene group, context-dependent continuation and decisive boundary. Phase describes the text. |
| Cue eligibility and band | Record whether the reference supports an automatic cue. Use five ordinal bands for local score checks, from 0 for quiet to 4 for the strongest text evidence in the rubric. Record hard quiet and exclusions separately from a neutral passage that may use a reader-selected background. |
| Movement and shape | Optional grounded movement and rhythm labels when the text supports them. Record uncertain or competing cues and a named movement stop. Device selection and calibration are measured separately. |

Report counts, precision, recall and error examples by story and slice, with uncertainty intervals clustered by author. Each gated slice needs at least **five works and 30 relevant anchors**. Include the corresponding positive and negative denominators when reporting both recall and false cues. Fill sparse advertised slices before making a broad quality claim.

## Classification and coverage gates

Measure story predictions before the renderer adds the background. A positive cue is a supported automatic suggestion above zero. A missed, invalid or abstained result counts as a miss against a clear positive reference. Use the effective Loom fallback when scoring an end-to-end Nocturne trace. Keep classifier quality on covered paragraphs and service coverage as separate results.

| Gate | Proposed pass condition |
| --- | --- |
| Loom default | At least 90% cue precision and 75% cue recall. Neutral false-cue rate at most 5%. Precision at least 85% and recall at least 65% in every supported story slice. At least 85% of clear local bands within one ordinal band, with overestimates of two or more bands at most 1%. |
| Contextual Nocturne | At least 92% effective cue precision and 85% recall on the same traversed text. Event-kind macro-F1 at least 0.85 and phase macro-F1 at least 0.80 on covered, adjudicated anchors, with abstention counted against clear labels. Recover at least half of Loom’s eligible misses among covered anchors, with at least 40 such misses in the evaluation. Neutral false-cue rate at most 5%. |
| Narrative boundaries | At least 85% precision and recall for phase transitions, matching each prediction to at most one reference transition within one paragraph. Preserve explicit stops and hard quiet. An excluded or invalid provider result cannot increase the local suggestion. Report imagined, reported and historical confusion separately. |
| Usable contextual coverage | In each supported story slice, at least 80% of reference-eligible words in the first 3,600 traversed words have a valid, usable annotation by the time their paragraph is left at 240 words per minute. Require at least 70% at 120 and 420 words per minute. Use the remaining length when shorter, and repeat at middle-story starts. Count eligible material missed through false exclusion, skipping, refusal, timeout or budget exhaustion in the denominator. Show whole-story and prefix coverage separately. |
| Hosted service and spend | On the authenticated candidate against the configured provider, at least 95% of ordinary eligible requests return usable labels within 8 seconds, including provider failures in the denominator. For the same 3,600-word comparison, p95 attempted usage stays within 25,000 input and 12,000 output tokens per session, and total submitted source bytes stay within 1.25 times unique submitted bytes on the sequential trace. Include repeat, failed and partial attempts in costs where billed usage is available. Record missing usage as unknown and leave the spend gate open if it cannot be reconciled. |
| Consent and fallback | Zero unconsented excerpt requests, text leakage, out-of-bounds requests, persisted contextual consent or late application after cancellation. Exercise unsupported categories or combinations, missing and duplicate IDs, refusal, timeout, rate limit, authentication loss, story switch, seek, hide and quota exhaustion. The interface must report partial coverage and retain the applicable local fallback. |

The cue-only path has a separate contract check. It should accept only eligible local cues and preserve its text-free payload. Use its results separately from contextual Nocturne when comparing accuracy or costs. [Nocturne evaluation protocol](reader-model-evaluation.md)

## Output and user control gates

Run identical cursor traces and calibration through the current baseline and candidate. Save numeric story scores, effective targets and dispatched command timelines separately. For contrast, compare matched quiet and cue intervals in the same profile. Include a default calibration with room above background and a tight calibration where no extra output is available. At fast pace, short adjacent cues can form one continuous reference episode.

| Gate | Proposed pass condition |
| --- | --- |
| Simulator contrast | Replay adjudicated cues through the renderer in isolation. At least 90% of clear cue episodes with calibrated headroom and three seconds of dwell emit at least one level above matched background for at least one dispatch interval. Then replay the full pipeline. Require contrast on at least 65% of those reference episodes for Loom and 75% for contextual Nocturne, counting both missed cues and quantization loss. Compare neutral intervals with the chosen background policy. |
| Timing and continuity | p95 stable-cursor to expected dispatch at most 2 seconds. Positive-target zero gaps at most 2% of time with a positive target on the sequential replay, excluding explicit pauses and unsettled seeks. Count policy-directed zeros separately. Preserve phase across compatible continuation and settle safely after a true boundary. |
| Authoritative controls | Zero command violations across all scripted cases. Enforce explicit Start, manual zero, hard quiet, zero and lowered limits, disabled or ended actions, Stop, pause, hide, inactivity and latest-state dispatch. Preserve corrections on reanalysis and restore paused. A response to an earlier story or earlier connection cannot resume output. |
| Hardware | Qualify each advertised model, firmware, Remote version, browser and action combination with observed results. Require three successful repeats of finite expiry, Stop and each interruption case, with zero wrong-device or wrong-action responses. Nonzero requests carry a two-second duration and target the selected device. After transport loss, observed output ends by the last accepted command’s two-second lifetime within the predeclared measurement tolerance of at most 250 ms. With a healthy connection, measure Stop within one second. Record any failure as a blocked configuration. |
| Reader pilot | Of the first ten eligible adult testers on qualified configurations, at least eight complete import, setup, read, adjustment and Stop unaided. Use paired reads with counterbalanced order and the same calibration. Collect at least eight completed pairs. Require at least 75% of paired readers to rate timing fit and control comfort at least 4/5 for the candidate and a median correction burden of at most one deliberate correction per ten minutes. Report distraction and background-versus-pattern preference, commanded means, failed attempts and early exits. Resolve and retest every serious control or privacy issue. |

The physical protocol uses an observed device on a desk before the reading pilot. Start with the gentle check, cover each supported action and any advertised combination, verify expiry under Bluetooth and network loss, and keep personal range scoped to checked actions with explicit permission. Include simulator rehearsals for Lush, Flexer, Nora, Domi, Velvo, Spinel, Dolce, Hush and Osci 3 when offering those profiles. [Hardware test record](hardware-test-record.md) · [QA checklist](qa.md)

## Tests and decision record

1. Run `python3 scripts/check.py`, `npm run build:worker`, `npm run test:browser` and `node scripts/nocturne-browser-check.mjs` with the required local setup. Verify import, mobile and desktop controls, consent, fallback and Stop. Use `node scripts/playback-continuity-trace.mjs` for bounded simulator dispatch. [QA setup](qa.md)
2. Run `node scripts/evaluate-reader-corpus.mjs /path/to/private/manifest.json` for the existing corpus benchmark. Run the frozen sequential cursor, annotation and coverage comparisons for the thresholds above. Keep evidence from targeted fixtures, story holdout and live service runs separate. [Corpus benchmark](reader-corpus-evaluation.md)
3. Exercise the signed-in HTTPS candidate through actual Start, contextual opt-in, receipt, cancellation and fallback. Verify the deployed revision, account and story privacy, and documented recovery and rollback. Complete the physical and paired-reader records before expanding beyond the qualified configurations. [Hosted deployment runbook](../deploy/cloudflare/README.md)

## Candidate evidence

The private *Nightswimming* regression uses the same 7,326 words and 307 paragraphs as the previous build, a frozen model-assisted reference and a simulated 240-word-per-minute trace. Default simulator calibration was background 1, preferred 3 and ceiling 10. The contextual output probe reuses the prior fixture with event-kind labels from the frozen reference. This isolates renderer behavior. Coverage is what the planner would send with immediate responses, measured before provider latency, rejection and abstention.

| Check | Previous `10873ea` | Context v2 candidate |
| --- | --- |
| Whole-story planned contextual coverage | 537 words (7.3%) in six attempts. | 6,686 words (91.3%) in five windows. 38,029 UTF-8 bytes in the plan, including 735 repeated bytes. |
| Loom recognition of provisional current cues | 0 of 114. | 1 of 114. Zero positive suggestions in 158 provisional neutral paragraphs. Loom recall remains well below the release goal. |
| Output samples changed by the contextual fixture | 0 of 9,158. | 157 of 9,158, sampled every 200 ms. Six current paragraphs emitted a level above background versus one with candidate Loom alone. No hard-quiet or ceiling violations, and Stop cleared output. |
| Historical public-domain seed corpus | 9 of 10 intended active sections in calibration and 1 of 23 in the former holdout. No false activations in 80 quiet sections. | Same results and all 11 quiet boundaries preserved. This corpus is development evidence. |

The frozen author-separated release holdout, successful authenticated provider replay, hosted spend, physical qualification and reader pilot remain open. Some established Loom cues can still equal the continuous background. The simulator contrast check only applies to validated current annotations and vetted local cues in this candidate.

Record the build SHA, dataset and rubric versions, settings, cohort counts, thresholds, actual results and pass/fail/not-run status in the release review. Approve the controlled release only after all applicable gates pass and the advertised scope matches the tested scope.

## Narrative scope follow-up

The guarded v6.7 candidate preserves Loom's existing cue classes and blocks clear figurative and modal contact cues. A local retrospective marker can suppress fresh relationship cues for up to two subsequent paragraphs. A scene break or explicit return ends that scope. Independently grounded existing cues can register above the default simulator background within the reader's calibration. The renderer still follows explicit corrections, movement stops and hard quiet. [Contextual review and fallback](nocturne-context-phase.md)

| Evidence | Merged v6.3 | Expanded v6.6 trial | Guarded v6.7 candidate |
| --- | ---: | ---: | ---: |
| Eligible cues detected on the 10-work evaluation | 2/72 | 2/72 | 2/72 |
| False cues on the 10-work evaluation | 0 | 1 | 0 |
| Simulator contrast on the 10-work evaluation | 0/34 | 1/34 | 1/34 |
| Eligible cues detected on the prior 40-work diagnostic | 5/498 | 8/498 | 5/498 |
| False cues on the prior 40-work diagnostic | 2 | 0 | 0 |

The 10-work set has 460 privately labelled anchors from 10 previously unseen authors. Its reference labels were frozen before opening the v6.6 comparison. The narrower v6.7 rerun is diagnostic. None of the Loom results meet the release recall gate. With valid fixed labels supplied directly to the v6.6 simulator, 30/34 eligible episodes registered above background. That replay isolates the renderer from provider accuracy and timing. No reference quiet boundary, hard-quiet, ceiling or Stop violation appeared in the v6.7 simulator diagnostic.

On the hosted `71c3d1f47344` build, the Lush simulator reached 5/20 on the bundled practice peak and returned to zero at Stop. One contextual request on an original six-paragraph rehearsal reviewed four eligible sections and reported 746 tokens. It marked the recalled dialogue as reported, suggested two current romance cues where Loom scored zero, and produced 2/20 on the simulator. Stop returned to zero. The hosted check covered one example on the merged build. Provider generalisation, the candidate's hosted behavior and physical hardware remain open.
