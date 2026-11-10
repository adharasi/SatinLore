# Nocturne beat protocol shadow

The founder shadow runner indexes an exact edition locally, plans contiguous cleared ranges, requests Luna discovery labels, then asks for independent prefix evidence at playback-sensitive decisions. It passes the resulting evidence to the JavaScript port of the approved v6 continuity compiler. It produces qualitative profiles and traces for comparison. This milestone is a command-line research path. Browser projection, authenticated Worker delivery, simulator timing, and physical dispatch are later stages.

## Run the comparison

Use a private edition packet with a `works` array of `{id, sourceSha256, text}`. The text must be the exact canonical reader edition. When the workbook used a different raw packaging format, `sourceSha256` refers to the workbook's raw artifact and `editionDigest` identifies the canonical bytes. The comparator checks work identity, unit IDs and hashes. Keep source and results outside the repository.

```sh
node scripts/run-luna-protocol-shadow.mjs \
  --editions /private/d2-editions.json \
  --output /private/d2-shadow.json

node scripts/evaluate-beat-continuity-corpus.mjs \
  --source /private/corpus-index.json \
  --reference /private/approved-v6.json \
  --candidate shadow=/private/d2-shadow.json \
  --output /private/d2-comparison.json --discrepancies
```

With no grant, the runner reports withheld rows and computes a conservative trace locally. For live research, a trusted operator supplies a current grant separately for each edition. The grant packet has a `works` array of `{id, grant, blockedIds?}`. Each grant has `editionDigest`, `segmentationVersion`, purpose `nocturne-luna-editorial-shadow`, `expiresAt` in epoch milliseconds, and exact `spans` with `{id, byteStart, byteEnd, digest}`. Use the edition index to locate ranges, and a separate review to decide which to include. Editorial approval and historical admission fields do not create this record. Optional `blockedIds` supply independently assessed local playback restrictions. The CLI trusts the operator and local file. A hosted route must authenticate and verify its own grants.

For an approved live run, provide the project credential via the execution environment and add `--live --grants /private/clearance.json`. `--arm complete` is available for a fully cleared, structurally uninterrupted edition within the model request bounds. `--arm windowed` is the default. The default shared ledger allows up to 960 attempts, 5,000,000 payload bytes and one dollar of conservative spend reservations. `--max-micros` can set a cap up to 3,000,000. `--max-windows` bounds discovery to 96 windows per work. `--max-verification` defaults to 96 native checks per work and can be raised to 384. Unknown settlement retains its reservation and excess reported usage stops new dispatch. The study performs no automatic retries.

An approved run is serial within a cleared range and up to two independent ranges can run in parallel. A safety refusal closes that range and invalidates its earlier and queued results. The independent verifier receives one causal prefix at a time and no suggested answer from discovery. Only prefix-attested labels may increase density or establish a cue. Model and trace evidence are separate in the output. A stale or unavailable row remains an explicit outcome. The trace records the computed fallback separately.

### Recover distant context and missed native targets

`--verification-context attested` adds up to 16 typed earlier anchors from the same cleared run and currently known scope. The ledger builds them from independently verified facts and keeps them for at most 256 units. A gap, cutoff, scope change or protective event clears carried anchors. The verifier can cite an older anchor for a continuation or ending when it also cites the current target. An older anchor cannot supply a fresh rise or new cue. `--verification-context recent` disables the added labels for a matched comparison. Both use the same bounded recent prefix, with `--prefix-units` capped at 32.

`--target-roster /private/native-targets.json` takes `works` entries of `{id, editionDigest, targetIds}`. Freeze the roster before reading outputs and keep the scoring key separate. The planner checks all IDs against current grants. A native target can get an independent prefix check when its discovery window returned neutral, abstained or was incomplete. A safety refusal excludes dependent checks. Prioritized checks preserve scope and stop transitions, and the remaining allowance includes a control sample. Count native checks by their final disposition. The `cue` field measures a verified direct present action with an eligible phase. A low floor or connector can still affect the trace without counting as a direct cue.

Use `node scripts/run-luna-protocol-neutral.mjs --mock --arm windowed` and `--arm complete` to check both paths on the four pinned original fixtures. Windows contain up to four targets in this diagnostic. This mock verifies label and coverage contracts using the fixture reference. Add `--live` in place of `--mock` with the configured project credential to measure model recognition on the same neutral fixtures. Keep scores from the legacy founder comparison in a separate lane.

### Check transitions independently

The transition pass receives the same causal prefix as the cue pass and answers a separate typed question. An event needs a citation at its exact target. Earlier verified evidence can support scope or a closing link. A stop, interruption, declined restart, reported entry, present return and ordinary activity ending have different effects. The planner retains a protective stop when the two passes disagree and records the conflict. The cue and transition results remain separate in the report.

`--max-transition-verification` sets the independent check allowance per work. Use `--no-transition-verification` for the cue-only comparison. When discovery is incomplete or invalid, the planner can recover bounded native targets from the same cleared run. It records the original failure, the later disposition and any validated evidence IDs. A refusal closes the dependent run across both passes.

The founder-only study page offers fixed complete-context and windowed diagnostics on the four original neutral fixtures. Each arm has two complementary parts. Part A has 19 units and part B has 14. Both check every cue and transition in their part, and combining the reports restores the original 33-unit denominator. Complete context plans 40 and 30 calls before cue rechecks. Windowed plans 43 and 33. Each part can add up to four rechecks. The score-only reference stays outside the prompt.

Save the four source-free responses and compare them locally. The comparator validates fixture and unit hashes, rubric, model and arm. It reports the fixed denominator and the intersection of rows with usable results in both arms. An unsent row stays visible in the fixed denominator. Unit-level differences keep separate reasons for changes in discovery, primary cue recognition and applied playback.

```sh
node scripts/compare-luna-protocol-neutral.mjs \
  --complete /private/complete-a.json --complete /private/complete-b.json \
  --windowed /private/windowed-a.json --windowed /private/windowed-b.json \
  > /private/paired-neutral.json
```

Each diagnostic row contains its sentence ID, provisional discovery result, causal cue result, independent transition result and the compiled decision. Attempts report submitted and cited IDs, typed failure codes, timing and measured usage. The hosted response omits source text, provider response bodies and credentials. If quota closes the route after provider dispatch has begun, the report preserves completed results and marks unsent work as deferred. Use exact typed accuracy and protective-stop results alongside overall coverage when comparing runs.

### Improve coverage and precision in order

1. Preserve valid discovery rows from a completed response. Report invalid, duplicated or missing requested rows separately. Prioritize their native prefix checks within the run allowance. A provider refusal still closes its dependent run.
2. Require the cue's own evidence at the exact current target before applying a new cue. The transition verdict can close a beat and veto fresh activation. Its citation cannot supply missing cue evidence. Record when a cue was suppressed by a boundary, an ineligible frame or a missing target citation.
3. Compare raw model judgments, applied playback decisions and boundary-only transitions independently. Cue-phase events such as onset and restart are tracked in the full typed score. Boundary scoring measures scene or beat state changes separately. Compare the two parts only when their fixture pins, arm and rubric match.
4. Re-run the four original fixtures before extending coverage to a separately cleared corpus. Check the explicit stop, false cue count, exact boundaries and unavailable rows against the frozen reference. A live fixture result does not establish story-corpus accuracy.

The hosted study can ask for a second causal judgment when discovery supports a current cue and the first causal check returns neutral or uncertain. It can also recheck a rejected semantic tuple, such as an active phase with an incompatible action. It sends the approved prefix without either earlier verdict. An exact current cue can recover a missed cue. An independently returned neutral row can resolve a contract rejection. A checked boundary or blocked target prevents the recheck. The report retains the original failure and separates scheduled checks, eligible checks and provider dispatches.

### Discrepancy map and verification plan

The v6 baseline used four pinned original fixtures with 33 targets. Discovery returned 30 usable rows and primary verification returned 29. Applied reader-cue recall was 5 of 10 and the typed boundary pass found 6 of 7 reference boundaries with two extras. Use the same fixtures and arm to check the v7 changes. These fixtures are available during development and can reveal a regression or reproduce a cause.

| Stage | Observed discrepancy | Fix or next verification |
| --- | --- | --- |
| Discovery and verification contract | Discovery lost three rows to scope, phase/action and boundary/effect mismatches. Primary verification lost four to phase/action or status/effect mismatches. | Use one semantic contract for the adapter and shadow runner. Teach the rubric the allowable combinations and keep per-target rejection codes. Recheck bounded semantic failures with a blinded causal request. Test malformed rows beside valid neighbors and compare raw and recovered coverage separately. |
| Applied restart | `first-dance` 10 cited the earlier stop while establishing a fresh restart. `reading-room` 7 cited the preceding decline. The compiler treated earlier context as stale positive proof and suppressed activation. | Require independently verified present action on the exact restart target. Allow earlier context to establish that a break occurred. Clear the old beat and allow the new target to anchor later continuation. Test with and without a historical citation and with a disagreeing neutral verdict. |
| Protective gating | A stale sustain could bypass a stop by naming a new numeric scope. A confirmed decline could leave the gate open when no prior hard stop existed. | Keep the restart latch through inferred scope changes. Require an evidenced context cut or a fresh enacted start. Check both old and new scope IDs, and verify the stop or decline in the resulting playback trace. |
| Neutral arbitration and continuation | A neutral independent verdict erased a supported onset or uncertainty verdict. A typed onset could also replace a verified continuation and interfere with its anchor. | Preserve exact cue evidence and scope for an already grounded ongoing beat. Give verified closing boundaries precedence over new activation. Compare raw cue and typed labels with the applied event, reader cue and trace. |
| Elapsed-time ambiguity | At `reading-room` 2 both passes returned neutral, and the compiler carried the prior beat through an unspecified interval. | Teach the transition pass to separate an evidenced time jump from routine dialogue. The compiler separately clears carry for a narrow elapsed-time form after a recently anchored cue when the current target is verified quiet. Log that origin separately. Test ordinary dialogue, quoted background duration and verified continuation as controls. |
| Model recognition | An exact target can still be classified incorrectly after both responses validate. Onset versus sustain, current versus reported, and supported buildup versus routine exchange need independent adjudication. | Attribute each remaining false positive or miss to the first stage that diverges. Collect paired hard positives and negatives for each error family. Tune on development data and freeze the rubric before scoring unseen works. |
| Reference and playback scoring | The ten smoke cue references mix buildup and present action. Reader-cue recall and enacted activation use different semantics. A reference cue-negative can still receive unwanted carry. | Adjudicate narrative buildup, enacted action, continuation and expected playback independently. Include a separate stop-to-restart gate and carry test on the holdout. Score exact boundary types, false carry, unwanted dips, easing, and peak timing separately from sentence cues. |
| Hosted and rendered output | A valid label and qualitative profile can still fail to produce the intended simulator output. Request deferral can leave a planned row unobserved. | Separate quota deferral, refusals, transport failures, invalid rows and grounded neutral outcomes. Replay identical cursor traces through the simulator and check contrast, timing, continuity and user controls before release. |

For the next corpus comparison, freeze edition hashes, references, eligibility decisions, sampling slices and both arms before dispatch. Include slow buildup, reported-to-current frame changes, soft interruptions, explicit stops, declined restarts and long continuation spans. Record every miss or false positive by unit, stage and reason. Check complete-context and windowed arms on matched eligible editions. Review unresolved reference disagreements blind to the candidate and keep those revisions versioned. The [release qualification](nocturne-release-qualification.md) defines the independent 1,000-story holdout and gates of 92% cue precision, 90% cue recall, 85% transition precision and recall, at most 5% neutral false cues and preservation of every explicit stop and hard quiet.

### Live v7 results on the fixed complete-context arm

| Measure | v6 | v7 |
| --- | ---: | ---: |
| Usable discovery rows | 30/33 | 33/33 |
| Usable primary cue rows | 29/33 | 29/33 |
| Exact primary cue matches and extras | 8/10, 1 extra | 9/10, 1 extra |
| Applied reader cue matches and extras | 5/10, 0 extras | 7/10, 0 extras |
| Exact typed boundaries and extras | 6/7, 2 extras | 5/7, 0 extras |
| Applied exact boundaries and extras | 6/7, 2 extras | 6/7, 1 extra |

The live run dispatched 61 requests at an estimated $0.017568. Shard B finished and the founder request ledger cut off shard A. The cutoff deferred four primary checks and five typed checks on `old-letter`, including the reference return at unit 4 and positive cue at unit 7. The sixth unobserved typed row was a contract rejection at `practice-drill` 2. The fixed 33-unit denominator keeps all of these rows visible. Request quota ended the run independently of the spend cap. The two runs contain separate live model calls, so changes across aggregate model scores include run-to-run variation.

The two confirmed restarts at `first-dance` 10 and `reading-room` 8 activated. `first-dance` 5 kept its continuation despite a competing onset verdict. `reading-room` 2 cleared carry through the compiler guard after both model passes said neutral. The hard stop at `first-dance` 7 still produced Stop. Two of the three unplayed reference cues were grounded anticipation at `first-dance` 9 and `reading-room` 7. Each was classified as build, and the stop or decline still required enacted evidence before automatic restart. The remaining cue was deferred. The extra applied boundary came from a premature ordinary-activity stop at `practice-drill` 2 and produced no new activation.

The follow-up compiler change keeps the restart profile when an exact enacted restart also carries a low-cue effect, and keeps a typed-only onset out of applied events. Targeted regression tests cover those combinations. The next live comparison should finish the deferred rows and distinguish onset and restart labels from boundary annotations. Verify explicit frame returns and ordinary activity endings on matched positive and negative examples. Before running multiple large shards, check founder quota headroom and reserve room for the whole comparison. A resumable evaluation ledger should reuse completed requests and submit only unresolved targets.

### Request quotas and spend

The old research routes and normal reader share a deployment-wide 100-attempt UTC day and 1,000-attempt UTC month. The reader also has a per-reader allowance. Research routes have their own suite allowances. Each reservation checks both the applicable suite or reader allowance and the shared deployment allowance. One benchmark can exhaust those counters even when it costs very little. The counters reserve requests before sending them, and a reserved request can later fail.

The fixed founder neutral diagnostic uses its own atomic allowance of 512 attempts per UTC day and 4,096 per UTC month. Reader and older study limits are separate. The founder form shows remaining headroom. Each shard checks its capacity before the first dispatch, and individual requests still reserve their quota atomically. Concurrent submissions can change capacity after preflight. The four-part matched comparison needs up to 162 requests for the fixed fixtures. Each protected submission is capped at 48 provider attempts and a conservative $0.15 reservation. This leaves room below the 50 external subrequests per invocation on Cloudflare Workers Free. A partial report identifies the limiting day or month and includes the time until the window resets. Estimated charges and outstanding reservations are reported separately. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

The exact compiler regression uses `scripts/replay-approved-beat-protocol.py`. Supply the frozen prior v9 labels and review inputs separately from the approved v6 output. Run the CLI with `--help` for the input and output flags. It hydrates the approved input shape with the historical replay adapter, then compares complete JavaScript profile and trace objects against the expected outputs.

The approved 41-story local replay reproduced all 17,895 profiles and traces exactly, including all ten D2 stories. It supplied reviewed facts to the compiler. Live labeling on those editions requires a separate current exact-range grant and an authorized credential in the execution environment. Three of the ten D2 editions fit the current whole-story discovery bounds before checking clearance. The other seven need windowed discovery or a separately qualified whole-story strategy.

## Matched v8 live results

All four shards completed with the same fixture and behavior reference pins. The founder lane had 256 daily requests of headroom before dispatch. The comparison used 150 requests at an estimated $0.049311 with all usage settled. Both arms submitted every planned cue and transition target, including the return and enactment deferred in the previous `old-letter` run. The pinned behavior reference separately scores four buildup units, five enacted cues, one sustained continuation and 33 playback gates. It allows quiet on two recognized buildup units after a stop or decline.

| Measure | Complete context | Windowed context |
| --- | ---: | ---: |
| Requests | 72 | 78 |
| Usable primary cue rows | 32/33 | 33/33 |
| Primary buildup matches and extras | 2/4, 0 extras | 3/4, 1 extra |
| Primary enacted cue matches and extras | 4/5, 0 extras | 4/5, 0 extras |
| Primary sustained continuation matches and extras | 0/1, 1 extra | 1/1, 0 extras |
| Applied reader cue matches and extras, legacy reference | 4/10, 0 extras | 7/10, 1 extra |
| Expected playback gates | 28/33 | 29/33 |
| Exact typed boundaries and extras | 6/7, 1 extra | 7/7, 1 extra |
| Applied exact boundaries and extras | 7/7, 1 extra | 7/7, 1 extra |

Both arms correctly kept ordinary gym activity quiet and found its actual stop. The complete-context pass mislabeled enacted resumption at `reading-room` 8 as an already sustained interaction. The restart gate rejected that claim because the preceding offer supplied buildup without enacted action. The windowed pass found the restart there, while its recovery pass overcalled a cue at `old-letter` 6 and its primary pass described the actual enactment one sentence later as anticipation. Both arms missed the early buildup at `first-dance` 2. Typed rows with contradictory status and effect fields remain a separate coverage loss. The two arms use separate live calls, so the measured differences include model variation.

Both arms repeated a report entry and then inferred another reset from a disagreement between two noncurrent frame labels. The follow-up compiler keeps an already open frame and suppresses the duplicate boundary while retaining the raw verdict. It still resets on a verified entry into a distinct scope and on the return to the present. The live table precedes that follow-up. Exact regressions cover the repeated entry, interior frame disagreement and new-scope control.

### Simulator replay

Run `node scripts/replay-luna-protocol-simulator.mjs` for the pinned reference and mock. Pass each saved source-free arm with `--report` to replay live results through the actual Lush simulator and controller. This uses a research mapping from shadow profiles to simulator inputs, with the same 120, 240 and 420 WPM cursors and default, tight and zero ceilings.

The simulator follow-up keeps an automatic rising cue one step above the continuous background when a build step would round to background. An adjacent verified cue in the same simulator scene can lower an existing software pulse immediately within its original expiry. The reduction cannot start, increase or extend that pulse. With those changes the isolated reference reached contrast on all seven eligible pace-episode pairs, up from five. The windowed live-label projection reached all seven and complete context reached four. All 36 configurations preserved the tested stop, reset, ceiling, finite-command and pause requirements. The windowed projection still spent 4.03% of positive-target time at zero at 420 WPM, split between an optional carry and a quiet interval. This leaves the 2% timing gate open. Browser traversal and physical devices require their own checks.

### Private corpus readiness

The 41 source-pinned editions contain 17,827 text targets and 68 structural dividers. Twenty-five editions fit complete discovery by size and structure. The reviewed reference has 1,250 eligible direct-cue positives, 11,438 negatives and 5,139 unresolved text targets. Review those unresolved labels before using this development corpus to compare direct-cue recall. A current exact-range clearance manifest for these editions is still required before dispatch. The complete-context and windowed live results above cover the four original cleared fixtures.

## v9 discrepancy closure plan

| Failure | Correction | Verification |
| --- | --- | --- |
| Discovery and primary verification both missed a reciprocal response at `first-dance` 2. | Teach reciprocal response and established romantic context separately from generic enthusiasm. Allow a bounded blinded check on a quiet romantic target with independently read recent current context. | Require target evidence and an earlier current romantic citation to promote a weak buildup recovery. Include mutual response, a one-sided request and logistical controls. |
| A cue recheck overcalled a unilateral request at `old-letter` 6. | Discovery can nominate a target. Weak romantic buildup needs its own causal support before it can change playback. | Record the recheck and the reason the compiler rejected it. Check the request and the enacted response on separate targets. |
| `old-letter` 7 was sometimes labeled anticipation although the typed pass identified an onset. | Let a typed onset request a blinded cue review of exact anticipation in an open scope. Use an independently verified enacted result as activation proof. | Contrast a request with a present affirmative response plus action. Keep already verified continuations intact when a typed onset disagrees. |
| After a confirmed decline, `reading-room` 8 was labeled sustain with an unattested anchor. | Keep the restart gate closed. Recheck the exact continuation claim after a verified stop or decline. Require fresh contact or change at the target before reopening. | Exercise stale sustain, renewed buildup, a verified restart and a protected scope. Compare primary recognition and applied gate outcomes separately. |
| A valid low-fact onset lost its rising pattern. | Preserve the mapped onset or rebuild pattern when the cue supplies exact enacted start evidence. | Check onset with a low fact, romantic anticipation, fresh restart and soft carry independently. |
| Typed responses sometimes attached extra scope or evidence to a no-event verdict. | Canonicalize benign metadata only after validating the requested IDs. Retain uncertainty and reject contradictory effects and out-of-prefix evidence. | Count each normalized row separately from primary contract failures. Keep exact boundary and refusal checks. |
| An optional carry and the move to quiet background each lost 700 ms of output at 420 WPM. | Allow an adjacent automatic software move to lower an unexpired pulse within the same verified scene or to the configured positive background. | Reuse the saved v8 live projections. The two gaps fell to zero in both arms and all 36 conditions preserved hard quiet, ceilings, cadence and pause. Positive dispatch retains its existing cadence. |

Each mismatch now has one primary cause per target, stage and measurement dimension. The report distinguishes a model negative, wrong action, invalid output, unavailable request, restart or scope gate, false recovery and compiler carry. `replayNeutralDiscrepancies(report)` can classify saved source-free results without another provider call. A sentence can appear under separate dimensions. A corrected playback output still leaves a raw transition error visible.

Use the fixed windowed v8 arm as the live baseline for v9. Freeze separate holdout examples before the next tuning pass, including weak mutual buildup, unilateral requests, a present action after narrative return, stale continuations after a stop, true restarts, explicit stops and nonromantic controls. Keep missing and rejected rows in their denominator. Judge profile timing on the same cursor traces and require physical controls to pass before making device claims. Corpus-wide release scoring still needs current clearance and independently adjudicated references. [Release qualification](nocturne-release-qualification.md)

## Qualification

Compare exact reviewed compiler output separately from semantic recognition. The shadow study reports usable model coverage, cue and typed-transition precision and recall, profile agreement, continuity links and causal trace violations. Compare current reader and archival provider outputs in separate lanes. For a paid paired run, hold the target roster and recent prefix fixed, use a shared run budget and stop the comparison for a refused run. Report both effective scores on every planned target and accuracy among targets both arms resolved. Compare recovered and lost matches and added false positives. Earlier eligibility evidence and earlier continuity anchors are separate strata. Verify timing and simulator behavior after model qualification.
