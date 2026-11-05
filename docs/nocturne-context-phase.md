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

The reader separately enables contextual analysis for the current loaded story after a disclosure. An initial bounded window can be reviewed while paused. During visible active reading, after a fast seek has settled, subsequent uncached nearby windows may be requested within the session limit. Disabling contextual analysis, changing model/story, local reanalysis, hiding the page or losing the signed-in session cancels pending work and clears contextual state. Pause and Stop cancel pending requests and stop scheduling while paused. No library backfill, whole-corpus upload, story generation or automatic device Start is introduced.

The versioned request contains only `version: context-v1`, `consent: true` and ordered request-local paragraph ordinals with their text. Titles, source URLs, account-library identifiers, settings, corrections and device credentials are excluded. Each request has at most eight paragraphs, 3,000 UTF-8 bytes per paragraph and 12,000 bytes of source text in total. Oversized paragraphs are excluded rather than silently truncated and treated as complete.

GPT-6 Luna returns exactly one annotation per requested ordinal. Categories are neutral, romance, flirting, tension, intimacy, explicit, aftermath and abstain. Phase and shape describe the source narrative; confidence is a model-reported ordinal estimate, with a conservative application threshold. Confidence is not a calibrated probability or verification of age/consent. The model cannot return a device movement, intensity, maximum, command or session outcome. Embedded source instructions are treated as data.

Only validated, applicable annotations influence Nocturne's effective mapping. Manual corrections, hard quiet, excluded content and missing/uncertain results retain precedence. Switching back to Loom uses its independent local predictions. Contextual annotations and consent stay out of local/account story serialization and beta telemetry. Errors/refusals use fixed messages and local fallback; provider prose and source excerpts never become diagnostics.

## Privacy and cost

The optional contextual route deliberately changes the cue-only privacy contract. Selected excerpts pass through SatinLore to OpenAI. SatinLore does not persist them in the analysis service or send them to Lovense. Requests use `store: false`, no conversations, no tools and no explicit prompt-cache writes. This does not promise zero provider retention. OpenAI documents separate abuse-monitoring retention, normally up to 30 days, with different controls for eligible configured organisations. The product notice links to those controls.

[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

Token efficiency comes from bounded cursor-near windows, compact structured labels, no generated explanations, no reasoning tokens requested, memory-only reuse and no automatic retries. The provider's validated actual input/output/total token counts are returned separately from labels; missing counts are unknown, not zero. The current beta retains durable attempted-request quotas of 12 per reader per UTC day, 100 across the deployment per UTC day and 1,000 per UTC month. The browser also bounds automatic requests per loaded-story session. Quota exhaustion leaves local analysis available. Long-story semantic coverage is partial under these beta limits and is displayed honestly.

Official GPT-6 Luna pricing on 5 November is $0.10 per million input tokens and $0.50 per million output tokens. For illustration, 10,000 uncached input tokens plus 1,000 output tokens cost $0.0015 at those rates, excluding other charges. Actual paragraph tokenization, repeated context, refusals and provider usage must be measured. A ChatGPT subscription and an app's API usage are separate account/billing concerns.

[GPT-6 Luna model, capabilities and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna) · [Structured output and refusal handling](https://developers.openai.com/api/docs/guides/structured-outputs)

The tokenized commercial release still needs server-owned entitlements and a usage ledger. Reserve a bounded allowance under an idempotency key before a provider call, then settle the validated actual usage, including billed failures. Never trust a client balance, charge the reader again on a cache hit or promise a free retry for an already billed attempt. Payment integration and commercial quotas are not part of this beta slice.

## Evaluation and next gates

Unit and browser fixtures establish schema, cancellation, privacy and integration behavior. Fake annotations cannot establish Luna accuracy. Use fresh, permitted material as a held-out evaluation, alongside the eleven-story development corpus kept private. Measure missed romantic context, neutral suspense false positives, category/phase disagreement, abstention, coverage, latency and input/output tokens. Split by story/author rather than adjacent paragraph and audit disagreements before using labels as ground truth. The existing eleven stories have already informed development and are not a fresh holdout.

Physical rendering still needs observed per-device checks of targeting, finite expiry, interruptions, lower limits and actual response. Within-reader preference comparisons still need counterbalanced order, similar commanded means and voluntary timing-fit/distraction/strength-fit ratings. These are separate gates from software tests. Outcome targeting, physiological state inference and automatically escalating toward a deadline are not implemented.

## Software evidence

The common check command passed 22 Python and 592 JavaScript tests, including actual startup defaults, saved legacy preferences, neutral dispatched traces, context consent and overlapping windows, strict Worker validation, durable concurrent quotas, private/public session loss, excluded serialization and late provider completion after Disable. Worker packaging passed with 84 allowlisted files and the isolated bridge; deployment dry-run passed. The packaged Nocturne browser script adds fresh defaults, consented local-zero recovery, paused navigation and Disable fallback. Chromium execution is recorded in the [implementation review](https://github.com/adharasi/SatinLore/pull/16), separately from this local evidence. No live model call or physical-device qualification was performed for this phase.
