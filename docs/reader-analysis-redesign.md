# Scene and beat analysis redesign

## What failed

The sealed seven-author diagnostic has 450 paragraphs, 82 positive cues and 28 simulator episodes with calibrated headroom. It covers historical romantic writing and only two peaks. It contains no explicit scenes. The labels were frozen before scoring and produced in one model-assisted editorial pass. [Candidate evidence](release-acceptance.md#grounded-narrative-review-candidate)

| Stage | Observed failure |
| --- | --- |
| Loom cue extraction | The lexical pass and the final scene pass each found 2/82. Both hits were intimacy. Loom missed all 36 romance, 26 flirting and 8 tension cues. In the v6.8 contextual feature pass, 71/82 positive paragraphs produced an empty record and 7/82 produced no record. Four had any feature and none qualified for the new cue. Only three positive paragraphs were blocked by a hard-quiet or cloud-exclusion flag. |
| Nocturne local eligibility | The same Loom flags gate excerpt selection and contextual annotation application. The offline audit found that 23/28 reference-protected passages could enter a request, while 3/82 eligible cues were blocked. A provider response cannot repair a pre-upload exclusion error. |
| Nocturne delivery | The browser marks target IDs attempted before a response. Failure or cancellation can leave a hole for the rest of the enabled review. The reviewed counter includes abstentions. The current limits are 64 paragraphs and 12,000 source bytes per request, with 3,000 bytes per paragraph and 12 requests or 60,000 source bytes per visit. Each of the sealed excerpts fit in one request. |
| Nocturne interpretation | A mock provider labeled three neutral paragraphs as direct current romance. The v3 Worker accepted all three self-citations. Changing one support ID to an invalid ID caused the Worker to reject the entire response. The two existing comparison fixtures show that link validation can catch unsupported continuations. They do not measure live Luna accuracy. |
| Playback mapping | Nocturne maps romance, flirting and tension to the same base level. The model returns paragraph labels without source spans or stable model scene IDs. At default calibration the non-simulator policy computed level 1 for background and level 1 for a recognized romance cue. The simulator computed 1 and 2. Supplying reference annotations directly gave simulator contrast in 28/28 episodes, versus 2/28 with Loom. |

The aggregate within-one-band score was 97.8% even though Loom missed 80/82 cues. Report detection and timing by beat and episode before reporting ordinal averages. The reference-label replay bypassed provider, scheduling and verification errors. It does not qualify physical output or reader preference.

## Shared analysis contract

Use stable sentence or clause IDs within numbered paragraphs. Retain the original paragraph mapping and hard structural boundaries. Both models should return the same semantic representation so model quality can be compared with identical playback policy.

| Field | Meaning |
| --- | --- |
| Scene | Stable ID, source range, and frame such as enacted, imagined, reported or mixed. Keep narrative time separate from whether the action is enacted in the scene. Record where the frame changes. |
| Beat | Start and end source IDs, cue category, build/sustain/peak/recover phase, relative emphasis, and continuity or boundary. A single paragraph can have several beats. |
| Evidence | One or more in-range source IDs and a relation such as direct, conversational response or continuation. IDs locate evidence for review. They do not establish semantic correctness by themselves. |
| Eligibility | Separate local upload permission and playback authority from model predictions. Represent unknown, excluded, neutral and approved source independently. Reader controls and hard quiet stay authoritative. |

The playback compiler reads this map with cursor position, estimated dwell, background preferences and per-device calibration. Preserve the rhythm across compatible beats and use the existing interruption rules. Compare a continuous background plus scene accents, a direct story-following policy and a background-only control at matched mean commanded output. Reading time helps plan lookahead and fit a build or recovery within a scene. Timing or physiology inferred from story length cannot serve as a command target.

## Nocturne experiment

1. **Start with approved text.** Use original or separately approved excerpts in the hosted benchmark. Keep protected fixtures offline. For any product review, separate the local allowlist and explicit story/range consent from the semantic model. Require the eligibility gate before any provider call. Only expand coverage after the exclusion tests pass.
2. **Compare a stronger single pass first.** Run current v3 and Luna at medium effort on the same permitted text. Ask the candidate for scenes and sparse beat spans from coherent scene or chapter blocks. Test roughly 1,500–3,000 words per block with bounded lead-in and overlap as a starting point. Spend tokens on context and source anchors. Test a longer chapter pass as a quality reference. Long context capacity alone does not demonstrate reliable use of distant evidence. [Long-context retrieval study](https://transacl.org/index.php/tacl/article/view/5757)
3. **Add a targeted second pass.** Give the verifier original source units and surrounding context for weak or disputed links, implied but missed turns, peaks and scene boundaries. Include sampled neutral spans to discover omissions and measure false cues. Compare the verifier with the stronger single pass before making it universal. Model confidence is one signal. Use held-out results to calibrate acceptance by cue and boundary type.
4. **Schedule against time to need.** Prepare an approved opening range before it is needed. Schedule subsequent blocks with headroom based on measured provider latency and reading pace. Separate queued, attempted, usable, abstained and excluded states. Retry transient failures once within the existing consent and budget. Independently validate small scene blocks so a single broken record can be isolated. Give seeks an explicit local fallback and never apply stale results to the wrong story or cursor state.

Luna supports medium reasoning and structured outputs. Its listed standard text prices are $0.10 per million input tokens and $0.50 per million output tokens. An illustrative 75,000 input and 15,000 output tokens cost $0.015 before retries and infrastructure. The app's current 4,096 output-token limit includes non-visible tokens. Measure truncation and charge actual usage, including reasoning, before setting a product allowance. [Luna model and prices](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Output token accounting](https://developers.openai.com/api/docs/guides/token-counting)

Run `node scripts/evaluate-nocturne-scene-map.mjs` for the evaluation-only implementation. The same two original fixtures go through the v3 Worker and the scene-map extraction and verification passes. Scripted results represent four correct paragraph cues in each arm. V3 leaves an interruption inside one active paragraph. The scene map represents both exact sentence boundaries and six correct sentence cues. Its scripted verifier removes one scripted false cue. These figures demonstrate the representation and comparison mechanics. The shared compiler emits a text-free sentence timeline and keeps supplied local quiet boundaries authoritative. The provider experiment sends only explicitly approved units. It checks up to 24 prioritized beats and counts unchecked beats separately. Omission recovery, real-time scheduling and playback integration remain future experiments. `--live-provider` runs the same original fixtures with an authorized `OPENAI_API_KEY` set privately. Live comparison on representative approved text remains open.

## Loom experiment

Keep current rules as a baseline and conservative fallback. Replace the recognition layer with a small local contextual encoder trained on contiguous source windows. Predict cue and frame, then use a lightweight sequence head for scene boundaries and phase continuity. Compare it with a contextual encoder without the sequence head and with the existing rules. Use an independently measured teacher to create weak training labels, then audit its misses and disagreements before training. Include hard negatives such as ordinary affection, nonromantic suspense, reported action, interrupted interaction and unrelated movement. Split by work, author, series and near duplicates before labeling or training. Evaluate browser load, cold and warm latency, memory and quantization after it clears the quality gate. The teacher and local model can both improve while remaining separately releasable.

### Budget and coverage assumptions

Start with a frozen pretrained encoder and a small supervised head. The training loop can run privately on CPU or GPU. Train on progressively larger, provenance-tracked sets of 1,000, 3,000, 10,000 and 30,000 labels and measure the learning curve by story type. A single global recall score cannot establish coverage on rare categories. Freeze measurable English-language scope and minimum episode counts per slice before any release claim. Keep public-domain edition provenance and permitted uses separate from permission to send text to a hosted provider.

| Cost item | Planning assumption | Estimated USD |
| --- | --- | ---: |
| Initial GPU experiments | 10–50 GPU hours at $0.89/hour for a 24 GB RTX 4090 | $9–$45 |
| Larger training and export sweeps | 50–150 GPU hours at the same rate | $45–$134 |
| Two Luna annotation passes | 30,000 units per pass, assumed aggregate 400–1,000 input and 80–200 output tokens per unit including context and reasoning | $4.80–$12 in text tokens |
| First paid review slice, if used | 500 anchors, two readers, 45–90 seconds per anchor each, $25–$40/hour | $313–$1,000 before context reading and adjudication |
| Full independent release review, if paid | 2,400 anchors under the same assumptions | $1,500–$4,800 before context reading and adjudication |

These are scenario calculations, with GPU hours and review rates as assumptions. They exclude engineering time, storage, tax, retries, rights clearance and longer context review. The CPU baseline can run without a GPU rental. The browser Loom target has no per-read model API call once the model is available locally. Measure actual runtime and artifact size before estimating distribution cost. [Runpod GPU rates](https://www.runpod.io/pricing) · [Luna token rates](https://developers.openai.com/api/docs/models/gpt-6-luna)

The existing calibration set has 13 author groups and 367 positive paragraph cues. It has 24 flirting labels across five authors and no explicit labels. It is useful for developing the pipeline and comparing approaches. Build the next training set around missing categories and new authors. Keep the opened holdouts as named diagnostics and keep the new promotion set separate from training and threshold selection.

The first CPU training run took about four seconds on 1,366 calibration paragraphs. Leave-one-author-out average precision was 0.289 for the rules, 0.375 for a learned paragraph baseline and 0.397 when it included neighbors. On the opened seven-author diagnostic those values were 0.202, 0.262 and 0.234. Neither learned arm qualified at the development operating point. At the exploratory 0.5 threshold, the paragraph and neighbor models found 11/82 and 13/82 cues with 22 and 44 false cues. Retain these as comparison baselines. The frozen encoder adapter is implemented, with actual pretrained encoding and held-out scores still pending. [Training and cache commands](../scripts/loom-training/README.md)

## Promotion sequence

Freeze 12–16 previously unseen author/work groups, 800–1,200 independently annotated paragraphs and at least 100 eligible episodes for the first decision. Include continuous reading paths and a separate challenge slice for dialogue, subtle build, prolonged scenes, multiple peaks, reported/imagined material, long paragraphs and decisive boundaries. Use model-assisted annotation for development and independent disagreement review for release evidence. Keep the existing 40-unseen-work, 20-author, 2,400-anchor release gate. [Full release criteria](release-acceptance.md)

| Comparison | Decision it supports |
| --- | --- |
| Reference beats through identical renderer | How much of the failure is timing, calibration or transport, with semantic errors removed. |
| Live v3 versus stronger single pass versus targeted verifier on identical eligible source | Which model configuration improves beat/episode recall, precision and boundary handling, at measured tokens and latency. |
| Candidate with a reference scene outline | Whether scene segmentation or detailed interpretation causes remaining misses. |
| Real planner, Worker and renderer at 120, 240 and 420 words per minute | Whether useful labels arrive before the relevant beat and produce timely contrast, including middle starts, pauses and seeks. |
| Paired reader comparison at matched mean output | Whether following the map improves timing fit, continuity and correction burden compared with background alone. |

Count positive anchors and episodes lost at each stage, from local exclusion and lateness through provider refusal, abstention, validation, merge and dispatch. Report phase and frame macro-F1, boundary matches, false cues and p95 timing by author and style. With nearly silent fallback, 90% on-time positive coverage and 95% conditional recall yield about 85.5% effective recall. Eligible-word coverage alone cannot establish that. Compare actual cost and latency on the same source. Advance the new model if it reaches the applicable release target or improves matched episode recall by at least 20 percentage points at 90% or better precision, with zero protection and control violations. Advancement permits a larger benchmark. Release still requires the full gates and reader evidence.

## Labelled corpus and first comparison — 6 November 2026

The private annotation bundle extends the 1,366-label calibration set with 254 literary paragraphs and 106 paragraphs from six original challenge stories. All 1,726 calibration paragraphs are labelled, with 469 positive cues and 53 positive flirting cues. The original stories share one synthetic author group. The frozen diagnostic has 250 fully labelled paragraphs, 24 positive cues and 28 boundaries across six separate literary authors. It was selected and annotated before any new model scores. Ten passages have exact sentence maps. The six-author diagnostic lacks positive flirting and explicit scenes and remains smaller than the promotion corpus.

A second blind model pass agreed on cue eligibility for 15/20 selected old literary rows, 13/16 new literary rows and 23/23 original rows. The corresponding all-field agreements were 4, 4 and 14. Treat these as targeted disagreement checks. The reference labels have no human adjudication. One exact literary map and its paragraph annotations differ on one boundary. Keep both frozen for diagnosis.

**Loom** uses the labels as supervised targets. The offline trainer optionally fits category, event-frame and phase heads in addition to the cue comparator. On the fresh set, the rules found 0/24 cues. At the exploratory threshold, the expanded paragraph model found 3/24 with six false cues and two boundary false cues. Neither lexical model passed the training precision and boundary gate. Holdout ranking average precision for the paragraph model was 0.256 with the old data and 0.248 with the expansion. The neighbor model changed from 0.138 to 0.152. A separate frozen static GloVe baseline with 87.2% holdout token coverage scored 0.111 and did not qualify. The expansion improves labelled coverage. This experiment does not show a recognition gain at the required operating point. [Training commands](../scripts/loom-training/README.md)

**Nocturne** uses the labels as a reference for testing Luna scene extraction and verification. `node scripts/evaluate-nocturne-corpus.mjs /private/holdout.json` validates and replays pinned excerpts locally. It reports exact sentence references and projected paragraph references separately. The two exact literary maps replayed all 13 reference cue units and three annotated boundaries. The eight exact calibration maps replayed all 102 reference cue units and eight annotated boundaries. These are reference-answer pipeline results. Protected spans excluded before review remain in the denominators. Printed line wrapping no longer creates sentence breaks in the experimental mapper, with the original UTF-16 source offsets preserved.

`--validate-only` audits pins, references and coverage locally. `--live-provider` preflights the entire manifest against hosted scope, explicit unit approvals, source digests and exclusion flags before the first call. Run live only on the separately scoped original benchmark. That subset has three works, with 109 approved units out of 116. Live inference accuracy and latency are open. Experimental results remain separate from active reader playback and production release.

## Integrated recognition, timing and simulator replay

The next draft trains a local sequence head on out-of-fold cue probabilities and runs a real frozen MiniLM comparison. The pinned encoder produced 384-dimensional features on CPU in 47.5 seconds for the 1,726 calibration paragraphs and 12.0 seconds for the 250 diagnostic paragraphs. These are offline batch-encoding times. The sequence head fits on nested author folds and stops context at excerpt and structural boundaries. The encoder revision and checkpoint digest were verified locally. [Pinned MiniLM checkpoint](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/46605decb5369335a3847c9f41bb0b896c07dd1a) · [Training commands](../scripts/loom-training/README.md)

| Loom arm | Calibration average precision | Opened diagnostic average precision | Correct cues at exploratory 0.5 | False cues | False boundary cues |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lexical paragraph | 0.408 | 0.248 | 3/24 | 6 | 2 |
| Lexical sequence | 0.368 | 0.208 | 2/24 | 3 | 0 |
| Frozen MiniLM with neighboring features | 0.509 | 0.147 | 1/24 | 16 | 3 |
| Frozen MiniLM sequence | 0.442 | 0.150 | 0/24 | 12 | 2 |

Average precision summarizes cue ranking across thresholds. Precision is the share of flagged cues that match the reference. Recall is the share of reference cues found. All four arms missed the calibration requirement of at least 90% precision, zero false boundary cues and sufficient support. Their gated policy abstains. On the opened diagnostic, the direct MiniLM semantic heads reached 0.271 category, 0.250 frame and 0.227 phase macro-F1. The cue prevalence was 27.2% in calibration and 9.6% in the diagnostic, so compare models on the same split. The pretrained ranking gain on calibration did not transfer to the diagnostic.

The Nocturne timing evaluator runs approved reference windows through the existing validator and measures whether their accepted cues arrive before the reader enters or leaves each source unit. It models one in-flight window, at most one transient retry, a request/source/token budget and invalidation after seek or cancel. The offline cases assume an 8- or 24-second window completion time. Token reservations are synthetic. A cue available at entry can drive the software simulator through its actual controller. An unavailable cue falls back to Loom, and the candidate cannot inherit a boundary from the reference. The simulator uses an injected cursor, measured at paragraph or ideal sentence positions.

| Two exact literary excerpts, 240 words/minute | Cues available by entry | Episodes with at least one dispatch interval above background |
| --- | ---: | ---: |
| Reactive requests, 24-unit stress windows, assumed 8-second completion | 8/13 | 4/6 |
| 30-second lookahead, same stress windows | 12/13 | 4/6 |
| Lookahead and simulated 8-second opening preparation | 13/13 | 5/6 |
| Same preparation, assumed 24-second completion | 12/13 | 4/6 |

The 24-unit setting forces multiple windows for the scheduling stress test. In the ordinary single-window case, the reactive result is 12/13 cues at entry and preparation increases that to 13/13. At 240 words per minute with ready reference labels, Loom produced contrast on 0/6 episodes. Paragraph and sentence mapping each produced contrast on 5/6. Sentence mapping reduced above-background time outside reference cues from 33.25 seconds to zero. One eligible episode coincides with local hard quiet and remains in the denominator. The conditional p95 dispatch delay was 1.0 second among the five successful sentence-level episodes. Positive-target zero gaps were 0.83% of positive-target time in this literary replay. They reached 3.88% at 420 words per minute in the three original fixtures with hosted approval, above the 2% limit. These software traces had zero hard-quiet, ceiling, command cadence, duration or Stop faults. Physical qualification and browser sentence tracking remain separate.

```sh
node scripts/evaluate-scene-map-playback.mjs /private/holdout.json
node scripts/evaluate-nocturne-timing.mjs /private/holdout.json --window-units 24
node scripts/evaluate-nocturne-timing.mjs /private/original-hosted.json --hosted-scope
```

The hosted-scope offline run applied the real benchmark preflight and planned 109/116 source units. Luna accuracy, latency and usage still require the configured provider. The latest release gate remains open for both models.

## Luna Decisions comparison

The evaluation candidate asks Decisions to classify frame, phase and category for each approved sentence. Each call labels up to 48 targets against a bounded window of approved context. The adapter validates the named answers and builds the shared scene map. Refusals, missing answers, contradictions and uncertainty cannot add a cue. Structural breaks are retained locally. Both requests disable implicit prompt caching. The Responses comparator uses the V4 single-pass extractor. Reader playback continues to use the existing analysis route.

The fixed smoke test covers 13 sentences, six cue anchors and two boundary anchors across two original fixtures. In scripted checks, both adapters recovered all six cues and both boundaries. Refusing one cue per fixture reduced Decisions recall to 4/6 and mapped coverage to 11/13. These are scoring checks with supplied answers. Real measurements start with the following commands after a project key authorised for both endpoints is configured privately.

```sh
node scripts/evaluate-luna-decisions.mjs --live-provider
node scripts/evaluate-nocturne-corpus.mjs /private/original-hosted.json --compare-decisions
```

The first command uses up to four calls. The second compares exact cue, boundary, phase, frame and category labels with the same approved context for each endpoint and scores against the full reference. Excluded, refused and unfilled anchors remain visible in the denominators. The original hosted corpus passed preflight for three works, 109 of 116 source units and six calls total. Compare valid coverage, raw usage and p50/p95 wall time, including the full window when Decisions needs multiple calls. Two timings per endpoint describe a smoke run. Before promoting a candidate, apply the [release gates](release-acceptance.md) to a broader eligible sample and replay measured window timings against the simulator.

The local suite passed 22 Python and 660 JavaScript tests. Eight additional training-protocol tests, the Worker asset build and Wrangler dry run also passed. Live requests, quality, latency and usage remain pending. The deployed Worker currently uses Responses, and its secret is unavailable in the local test process.
