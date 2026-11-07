# Nocturne evidence recovery

The next development phase tests whether earlier evidence changes cue recognition before any result reaches reader playback. The founder diagnostic separates missing context, interpretation, transport, and application. It uses the existing neutral research labels and records depiction, eligibility, cues, and typed transitions separately.

## Paired founder diagnostic

Freeze one source edition, exact target and context coordinates, the admission overlay, the reference rubric, and both planned batches before dispatch. Each pair has the same single target, detector prompt, model, and request settings. The baseline reserves five preceding units for cited shared evidence and fills any spare slots with recent units. The augmented arm adds one to three exact earlier anchors from the same approved run, within the detector’s eight-context-unit limit. Both arms use text through the target only. Keep the reference decisions out of the provider payload. Since the extra anchors come from a reference review, this arm measures the value of supplying that evidence. Use a count-matched ordinary context arm to test whether the relevance of the evidence explains a gain. A separate, source-selected arm must test whether a candidate can find useful evidence without reference decisions.

Use the missing-anchor cases to measure recovery. Keep cases with all cited anchors present as a separate interpretation cohort. Use clear negatives as live controls and neutral fixtures to exercise protective decisions. Exclude known protected units from both live targets and context. Compare cases at the same target and eligibility scope. Report recoveries, regressions, ties, unresolved pairs, and unavailable outcomes by cohort and work. Report cue precision and recall, typed transitions, coverage, latency, and measured usage. Keep all planned targets in the effective denominator. Treat a result calculated only on paired usable returns as conditional. The prior multi-target benchmark is historical context because it exposes a different source window.

Keep source preparation, the source-free pair manifest, provider checkpoints, and score reports separate. Verify edition, index, unit digests, and the ordered target and context IDs against the same immutable plan. The founder explicitly approves source transfer through the existing bounded research route. Use only admitted units. Break continuity at structural gaps, unavailable units, prior transport holds and known protected spans. The second arm shares source with the first, so wait for the first arm’s overlap to settle. Record refusal, unresolved settlement, missing result, and intentional hold separately. Never replay an ambiguous billed attempt or send an overlapping batch while the shared source remains held. Keep source prose, corpus coordinates, and private reports out of Git.

Prepare the pair file and a separate score-only cohort from a completed detector checkpoint. All inputs and outputs below are private.

```sh
node scripts/prepare-evidence-pairs.mjs \
  --source /private/approved-source.json --reference /private/reference.json \
  --checkpoint /private/detector-checkpoint.json --plan /private/paired-plan.json \
  --cohort /private/score-only-cohort.json --limit 24
```

On the founder corpus study page, choose the same approved source and the paired plan. Select the detector alone. Review the batch count, approve source processing and start. To resume, load the same source, plan and exported paired checkpoint. Keep the score-only cohort offline. Score the downloaded checkpoint against the frozen plan digest.

```sh
node scripts/evaluate-evidence-pairs.mjs \
  --cohort /private/score-only-cohort.json --checkpoint /private/paired-checkpoint.json \
  --output /private/pair-results.json
```

## Staged release decisions

| Stage | Required evidence | Owner |
| --- | --- | --- |
| Evidence recovery | Run the paired diagnostic on frozen development cases. Use gains and regressions to choose retrieval or interpretation changes. | Evaluation owner |
| Causal candidate | Select earlier evidence from admitted source alone. Track supported participants, interaction scope and narrative frame. Clear carried state on a stop, withdrawal, scope or frame change, or unknown gap. Require fresh evidence to restart. Test identical prefixes with different suffixes and test typed stops independently of cue labels. | Reader engineering |
| Independent qualification | Seal fresh permission-cleared works grouped by author or linked series. Use independent human first passes and adjudication before scoring. Apply the existing coverage and confidence-bound rules. | Independent evaluation reviewer |
| Reader and release | Exercise the actual reader and simulator, then each advertised physical configuration and the consenting reader comparison. Record the build, signed gate decisions, and rollback rehearsal before promotion. | QA and release owner |

The [release qualification protocol](nocturne-release-qualification.md) requires at least 92% effective cue precision and 90% recall, at most 5% neutral false cues, and at least 85% precision and recall for typed transitions matched within one paragraph. On-time annotation coverage must reach 80% at 240 words per minute and 70% at 120 and 420 for opening and middle starts. The simulator gate includes dispatch within two seconds at p95 after a stable cursor and zero scripted control violations. The protocol also sets slice, contrast, participant and hardware requirements. Use its full gates when signing the [release decision](release-acceptance.md).
