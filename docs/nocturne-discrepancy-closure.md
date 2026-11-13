# Nocturne Luna discrepancy closure

13 November 2026

The v44 development inventory contains 181 frozen targets across 34 sampled works. Earlier runs completed 148 targets and withheld 33. The v44 live panel covered 17 distinct targets in 24 observations across 14 clip runs. It matched 9/24 profiles, 18/24 phases, 15/24 applied events, 14/24 model-reported events and 18/21 judged cues. Profile and applied event repeated exactly on 2/4 waveform pairs. Two frozen hard boundaries produced positive simulator output despite zero reported runtime violations at compiler-recognized hard boundaries. [Frozen scoring labels](nocturne-frozen-labels.md) · [V44 compiler](https://github.com/adharasi/SatinLore/commit/fb33de8b03157ab6871fcbbfaabe9859e8c786b0)

## Boundary repairs in v45 and v46

| Target | Cause | Implemented repair | Acceptance |
| --- | --- | --- | --- |
| `a20-03:12` | The short prefix starts after the earlier venue was established. A lexical Stop check also interprets the named transit stop as a restart barrier. | Exclude named destination stops from the lexical hint. Quiet paragraph-opening arrivals can request an old-place witness with the target withheld and a blind arrival witness. The two must ground the same earlier place. | On sufficient evidence, apply one cut at 12, start a new scene and emit zero in all nine conditions. Keep the exact short arm as a coverage control. A proposed destination, same-place movement, unavailable earlier evidence or protective Stop cannot establish a cut. |
| `a20-04:14` | Generic entry prompts treat headings as setup, including the wider prefix with the earlier day heading. | Compare increasing standalone numbered day headings with preceding activity anchored to the earlier paragraph. A lone quiet day heading clears carry and emits zero while leaving the event uncertain. | The wide arm applies one cut at 14. Both widths emit zero. Duplicate numbers, references inside prose, intervening protection and an earlier unavailable anchor cannot establish a cut. |
| `a20-17:12` | The typed time jump and independent entry agree on units 11 and 12. A generic neutral continuity answer supplies no competing earlier evidence but vetoes the cut. | Resolve the exact matching time judgments before the successor receives attestations. Allow an ordinary verified activity ending as evidence of the previous situation. | Apply once at 12 and keep the new scene through 13. Verify zero at 12 and retain the frozen Baseline discrepancy for adjudication. Genuine continuity, wrong earlier time, stale successor votes and protection retain their own outcomes. |

## V46 verification

The approved offline reference matched all 17,895 profiles and 17,895 causal traces across 41 stories. Replay reconstructed all 24 v44 live observations. Twenty retained the same provider requests. Two observations in the `a20-04` breadth clip shared a removed optional boundary question. Two in the `a20-03` breadth clip shared a newly requested old-place answer missing from the v44 receipt. The simulator uses 120, 240 and 420 WPM with ceilings 10, 1 and 0.

| Case | Positive target or output in v44 | Positive target or output in v46 | Event in v46 |
| --- | ---: | ---: | --- |
| `a20-04:14`, short prefix | 3/9 | 0/9 | `uncertain-continuity` |
| `a20-04:14`, wide prefix | 6/9 | 0/9 | `scene-cut` |
| `a20-04:14`, breadth prefix | 3/9 | 0/9 | `uncertain-continuity` |
| `a20-17:12`, breadth prefix | 6/9 | 0/9 | `scene-cut`, with new scene lineage retained at 13 |
| `a20-03:12`, short prefix | 6/9 | 6/9 with the exact earlier v42 old-place answer | Earlier place remains unproved. The wider arm needs new evidence. |

V46 also allows an independently quiet connector to inherit a verified release clock after a quiet repair of a rejected primary anchor. On the first `d2-02:1550` waveform receipt, `knownAt` moved from the beat root at 1548 to the verified release at 1549. The Taper, fade length, floor and all nine command and target traces matched the prior run. The repeat's isolated action did not corroborate the earlier release. That case remains open for fresh evidence.

The `a20-03` short-prefix comparison uses the v42 old-place abstention on unit 11 with the other answers from v44. The older and newer place requests have the same exact prefix. This cross-receipt comparison confirms that dispatching the new witness alone does not recover the earlier venue. The matched live rerun awaits explicit approval for the exact excerpts and spend. The 90% cue recall gate and the author-disjoint holdout remain open.

## Remaining issues and closure tests

| Priority and target | Next evidence or change | Closure and matched controls |
| --- | --- | --- |
| P1 `a20-01:13` | Independently verify the same active setting across the viewpoint change. | Preserve the bounded beat only on same-setting proof. Compare a distinct setting, expired beat, noncurrent frame and explicit Stop. Adjudicate the frozen Gradual build separately. |
| P1 `a20-09:16` | Repeat v44 split-place corroboration for conflicting predecessor citations. | Apply one cut with zero output when both witnesses ground the same earlier situation. Independently adjudicate the frozen Taper location. Compare wrong earlier scene, routine movement and viewpoint-only. |
| P2 `a20-09:17` | Compare the reported second entry with the grounded first arrival. | Keep applied none on a continuation and report raw duplicate error separately. Include a genuine second cut. |
| P1 `o11-04:224` | Blindly adjudicate the new objective and whether local enacted action belongs to it. | Score the exact cut, cue, phase and Taper independently. Compare same-episode action and a genuine hard cut. |
| P1 `o11-01:629` | Verify whether 626→627 attaches to the existing beat at 625. | Renew a bounded Undertone only on same-scope causal proof. Compare rejected, singleton, neutral, expired, wrong-scope and protective evidence. |
| P1 `a20-16:12` | Verify sustained action on the existing onset at 10 with a blind check of the preceding support pair. | Select Sustain wave on the original beat and clock without a fresh cue or event. Compare ordinary contact, missing anchor, expiry and cut. |
| P1 `a20-18:15` | Verify the exact earlier action across conflicting local and typed continuity readings. | Preserve the original beat and expiry with exact same-action evidence. Compare wrong action, wrong scope, unavailable proof, cut and Stop. |
| P1 `a20-18:16` | Verify whether an ordinary interruption actually releases the open beat. | Apply Taper and ease only on local release linked to that beat. Compare continuation, ordinary dialogue, no live beat, objective cut and Stop. |
| P1 `a20-03:14` | Independently verify reciprocal anticipation at 13–14 after the scene decision at 12. | Start the buildup in the new scene only on exact same-scope support. Compare missing scope, ordinary description and wrong prior unit. |
| P1 `d2-02:1540` and `1542` | Resolve local enactment and release at 1540 independently before testing support at 1542. | Score cue, release, phase and onset separately. Buildup at 1542 needs a verified opener and current link in the same scene. Compare noncurrent depiction, expired hold, wrong scope and missing opener. |
| P1 `d2-02:1550` | Repeat both live arms and isolate the earlier release where independent action evidence disagrees. | A quiet successor inherits the verified release clock. A fresh release uses new evidence. Verify clock, fade floor and commands against expiry, wrong-beat and Stop controls. |
| P1 `a20-05:7` and `8` | Adjudicate the first present action after the noncurrent frame and classify invalid replies as missing evidence. | Apply one return at 8. Compare a frame that remains imagined, a genuine second return and unavailable evidence. |

## Evaluation gates

1. Join every observation by edition, exact source span, target, packet and receipt. Retain all 181 rows in the denominator ledger. Track withheld, unconfirmed, refused, invalid, clipped and unscored separately. Keep changed-width and repeat observations linked to their original target.
2. Reproduce the 41-story approved compiler reference and then replay identical saved answers through both builds. Record the first divergence as request selection, evidence availability, validation, arbitration, beat timing or output. A newly requested answer needs a live or separately identified supplied-proof result.
3. Rerun the matched breadth, setting, waveform and repeated waveform panels. Pair the two day-heading widths and compare a reviewed wider setting prefix with its short arm. Report both measured call count and settled spend. Each control should change one condition at a time.
4. Grade raw and applied events, cue, phase and profile independently. Check exact scene and beat lineage, hold/fade/floor and evidence age. Require zero target and output at verified Stops and hard boundaries at 120, 240 and 420 WPM under standard, tight and zero ceilings. Compare commands at frozen hard targets even if the compiler missed their boundaries.
5. Freeze an author-disjoint holdout before tuning on it. Two reviewers label first-knowable boundaries, current cues, continuity and expected command behavior independently. Adjudicate disagreements and retain the frozen reference for historical comparisons. Test the 90% cue recall release gate alongside precision, transition F1, exact profile, per-story failures, availability and replicate agreement. Expand to the requested 1,000-story qualification after the repeated controls pass. Track natural stories and authored controls separately, and report physical device evidence separately from simulator evidence. [Release thresholds](release-acceptance.md) · [1,000-story protocol](nocturne-release-qualification.md)
