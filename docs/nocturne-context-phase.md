# First-use defaults and contextual Nocturne

5 November 2026

This phase turns the existing continuity choices into fresh-reader defaults and adds optional contextual annotation to Nocturne. These are conservative product hypotheses. The eleven-story annotations and public pattern evidence establish neither a universally preferred setting nor a reliable time to a physiological outcome.

## First use

Fresh experience preferences use Continuous background, Follow scene rhythm and Steady hold for Nocturne peaks. Existing explicitly saved preferences, including Off, Follow scene rhythm and Automatic peaks, remain valid and are preserved. The selected maximum is unchanged. Setup still uses the current movement calibration and physical permission; choosing defaults does not connect, select a toy, grant a personal range or start playback.

Continuous background supplies the existing calibrated background only during valid, permitted reading. It does not override manual zero, hard quiet, stopped movements, invalid analysis, zero gain/strength, a zero maximum, seeking or interruption. Steady refers to the temporal shape at a given section target; story-driven amplitude changes remain possible.

The neutral trace harness runs the real synchronous PlaybackController with a fake finite transport. Run `node scripts/playback-continuity-trace.mjs` to inspect requested and emitted levels for the same trace under the previous story-following settings and the new defaults. Its long dwell, connective passage, hard quiet, seek, manual zero, pause/restart and lower/zero maximum make gaps visible. It does not run a physical toy or collect reader activity.

The existing Stop-before-reduction contract remains in place. A lower positive target can therefore insert an output gap even when the requested signal stays nonzero. Report positive-target gaps separately from deliberately quiet time, and compare mean commanded level before interpreting a preference result. Default changes are not evidence that this transport issue has been solved.

The 170-second neutral fixture produced these results. Each condition spent 155.1 seconds playing, retained every deliberate zero and had no cap violation. The longest positive-target output gap was one second in each condition. These are deterministic software observations, with no measured physical response.

| Condition | Zero output while playing | Positive target with zero output | Mean output while playing |
| --- | ---: | ---: | ---: |
| Previous story-following defaults | 44.6 s | 2.8 s | 1.7795 |
| Continuous background, scene rhythm, automatic peaks | 33.7 s | 2.8 s | 1.8627 |
| Fresh defaults, continuous background and steady Nocturne peaks | 33.7 s | 2.8 s | 2.0329 |
| Continuous background and globally steady rhythm | 34.6 s | 3.7 s | 2.4810 |

The fresh defaults preserve scene-led variation and reduce unintended quiet in this fixture. The different means prevent treating the comparison as a matched-strength preference experiment.

## Contextual annotation

Loom remains local and is the default model. The existing Nocturne cue-only action remains available. Its derived cues cannot recover a paragraph that Loom missed. The additional contextual action addresses that limitation by asking GPT-6 Luna to classify existing nearby paragraphs, including eligible local-zero paragraphs, into fixed, non-graphic categories.

The reader separately enables contextual analysis for the current loaded story after a disclosure. An initial bounded window can be reviewed while paused. During visible active reading, subsequent nearby windows may be requested within the session limit. Pause, Stop and an unsettled seek cancel pending contextual requests. Disabling contextual analysis, changing model or story, local reanalysis, hiding the page or losing the signed-in session cancels pending work and clears contextual state.

The current request uses `context-v2`, explicit consent and ordered paragraph ordinals with their text. Each window takes up to 64 complete paragraphs, with at most 3,000 UTF-8 bytes per paragraph, 12,000 source bytes and a 16,384-byte JSON body. The browser schedules the next window near the edge of covered text. A small overlap provides context while the rest of the window advances coverage. The browser counts attempted source bytes, including overlap, towards a 60,000-byte and 12-attempt allowance per loaded story. Oversized paragraphs stay with Loom. The Worker still accepts v1 and cue-only requests from older readers.

GPT-6 Luna returns exactly one annotation per requested ordinal. The schema couples each category with its allowed phase and records whether the event is current, imagined, reported, historical, uncertain or neutral. Categories are neutral, romance, flirting, tension, intimacy, explicit, aftermath and abstain. Phase and shape describe the source narrative. Confidence is a model-reported estimate, and the application abstains below its threshold. Local policy uses the validated label to choose a suggestion. Calibration and playback then set the target within the user's limits. The classifier treats embedded source instructions as data.

Only validated, applicable annotations influence Nocturne's effective mapping. Imagined, reported and historical labels keep the local suggestion. Manual corrections, hard quiet and excluded content take priority. Missing, uncertain, invalid or refused results use Loom. Contextual annotations and consent stay in memory for the current story visit. Fixed error messages keep source excerpts and provider prose out of diagnostics.

At fresh calibration, a low-strength cue can quantize to the same level as the selected background. For validated current annotations and vetted new local cues, the simulator preserves one available step of contrast when preferred level, ceiling and reader adjustments permit it. Ordinary quiet sections continue to use the selected background policy. Compatible adjacent contextual annotations preserve the simulator's scene identity. [Release acceptance and measured output gates](release-acceptance.md)

## Privacy and cost

The optional contextual route deliberately changes the cue-only privacy contract. Selected excerpts pass through SatinLore to OpenAI. SatinLore does not persist them in the analysis service or send them to Lovense. Requests use `store: false`, no conversations, no tools and no explicit prompt-cache writes. This does not promise zero provider retention. OpenAI documents separate abuse-monitoring retention, normally up to 30 days, with different controls for eligible configured organisations. The product notice links to those controls.

[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

The browser budgets transmitted UTF-8 bytes and the Worker limits output to 4,096 tokens per v2 request. The provider's validated input, output and total token counts accompany successful labels when available. Missing counts are unknown. The beta retains durable attempted-request quotas of 12 per reader per UTC day, 100 across the deployment per UTC day and 1,000 per UTC month. The reader displays partial coverage and uses Loom when review reaches its allowance or the service is unavailable.

Official GPT-6 Luna pricing on 5 November is $0.10 per million input tokens and $0.50 per million output tokens. For illustration, 10,000 uncached input tokens plus 1,000 output tokens cost $0.0015 at those rates, excluding other charges. Actual paragraph tokenization, repeated context, refusals and provider usage must be measured. A ChatGPT subscription and an app's API usage are separate account/billing concerns.

[GPT-6 Luna model, capabilities and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Structured output and refusal handling](https://developers.openai.com/api/docs/guides/structured-outputs)

The tokenized commercial release still needs server-owned entitlements and a usage ledger. Reserve a bounded allowance under an idempotency key before a provider call, then settle the validated actual usage, including billed failures. Never trust a client balance, charge the reader again on a cache hit or promise a free retry for an already billed attempt. Payment integration and commercial quotas are not part of this beta slice.

## Evaluation and next gates

Unit and browser fixtures establish schema, cancellation, privacy and integration behavior. Fake annotations cannot establish Luna accuracy. Use fresh, permitted material as a held-out evaluation, alongside the eleven-story development corpus kept private. Measure missed romantic context, neutral suspense false positives, category/phase disagreement, abstention, coverage, latency and input/output tokens. Split by story/author rather than adjacent paragraph and audit disagreements before using labels as ground truth. The existing eleven stories have already informed development and are not a fresh holdout.

Physical rendering still needs observed per-device checks of targeting, finite expiry, interruptions, lower limits and actual response. Within-reader preference comparisons still need counterbalanced order, similar commanded means and voluntary timing-fit/distraction/strength-fit ratings. These are separate gates from software tests. Outcome targeting, physiological state inference and automatically escalating toward a deadline are not implemented.

## Software evidence

The v2 candidate passed 22 Python and 603 JavaScript tests, Worker packaging with 85 allowlisted files and the deployment dry run. The earlier v1 build at `10873ea` passed its packaged browser suite before the fresh-story regression exposed poor narrative recall, narrow coverage and no output contrast after injecting valid low-strength labels. The [release acceptance record](release-acceptance.md) contains the v2 replay results and remaining live provider, physical device and reader gates. Packaged browser results are recorded by commit in the [implementation review](https://github.com/adharasi/SatinLore/pull/16).
