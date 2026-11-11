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

For an approved live run, provide the project credential via the execution environment and add `--live --grants /private/clearance.json`. `--arm complete` is available for a fully cleared, structurally uninterrupted edition within the model request bounds. `--arm windowed` is the default. The default shared ledger allows up to 960 attempts, 5,000,000 payload bytes and one dollar of conservative spend reservations. `--max-micros` can set a cap up to 3,000,000. `--max-windows` bounds discovery to 96 windows per work. `--max-verification` defaults to 96 native checks per work and can be raised to 384. `--max-cue-checks` defaults to six focused checks per work and accepts values from zero to eight. Unknown settlement retains its reservation and excess reported usage stops new dispatch. The study performs no automatic retries.

An approved run is serial within a cleared range and up to two independent ranges can run in parallel. A safety refusal closes that range and invalidates its earlier and queued results. The independent verifier receives one causal prefix at a time and no suggested answer from discovery. Only prefix-attested labels may increase density or establish a cue. Model and trace evidence are separate in the output. A stale or unavailable row remains an explicit outcome. The trace records the computed fallback separately.

### Recover distant context and missed native targets

`--verification-context attested` adds up to 16 typed earlier anchors from the same cleared run and currently known scope. The ledger builds them from independently verified facts and keeps them for at most 256 units. A gap, cutoff, scope change or protective event clears carried anchors. The verifier can cite an older anchor for a continuation or ending when it also cites the current target. An older anchor cannot supply a fresh rise or new cue. `--verification-context recent` disables the added labels for a matched comparison. Both use the same bounded recent prefix, with `--prefix-units` capped at 32.

`--target-roster /private/native-targets.json` takes `works` entries of `{id, editionDigest, targetIds, transitionTargetIds?}`. The optional transition list pins independent typed checks and can differ from the cue list. Freeze both lists before reading outputs and keep the scoring key separate. The planner checks all IDs against current grants and the corresponding per-work allowances. A native target can get an independent prefix check when its discovery window returned neutral, abstained or was incomplete. A safety refusal excludes dependent checks. Prioritized checks preserve scope and stop transitions, and the remaining allowance includes a control sample. Count native checks by their final disposition. The `cue` field measures a verified direct present action with an eligible phase. A low floor or connector can still affect the trace without counting as a direct cue.

Use `node scripts/run-luna-protocol-neutral.mjs --mock --arm windowed` and `--arm complete` to check both paths on the four pinned original fixtures. Windows contain up to four targets in this diagnostic. This mock verifies label and coverage contracts using the fixture reference. Add `--live` in place of `--mock` with the configured project credential to measure model recognition on the same neutral fixtures. Keep scores from the legacy founder comparison in a separate lane.

### Check transitions independently

The transition pass receives the same causal prefix as the cue pass and answers a separate typed question. An event needs a citation at its exact target. Earlier verified evidence can support scope or a closing link. A stop, interruption, declined restart, reported entry, present return and ordinary activity ending have different effects. The planner retains a protective stop when the two passes disagree and records the conflict. The cue and transition results remain separate in the report.

`--max-transition-verification` sets the independent check allowance per work. Use `--no-transition-verification` for the cue-only comparison. When discovery is incomplete or invalid, the planner can recover bounded native targets from the same cleared run. It records the original failure, the later disposition and any validated evidence IDs. A refusal closes the dependent run across both passes.

The founder-only study page offers fixed complete-context and windowed diagnostics on the four original neutral fixtures. Each arm has two complementary parts. Part A has 19 units and part B has 14. Both check every cue and transition in their part, and combining the reports restores the original 33-unit denominator. Complete context plans 40 and 30 calls before cue rechecks. Windowed plans 43 and 33. Each part can add up to four rechecks. The four individual windowed fixture forms allow six rechecks per fixture. The score-only reference stays outside the prompt.

Save the four source-free responses and compare them locally. The comparator validates fixture and unit hashes, rubric, model and arm. It reports the fixed denominator and the intersection of rows with usable results in both arms. An unsent row stays visible in the fixed denominator. Unit-level differences keep separate reasons for changes in discovery, primary cue recognition and applied playback.

```sh
node scripts/compare-luna-protocol-neutral.mjs \
  --complete /private/complete-a.json --complete /private/complete-b.json \
  --windowed /private/windowed-a.json --windowed /private/windowed-b.json \
  > /private/paired-neutral.json
```

Each diagnostic row contains its sentence ID, provisional discovery result, causal cue result, independent transition result and the compiled decision. Attempts report submitted and cited IDs, typed failure codes, timing and measured usage. The hosted response omits source text, provider response bodies and credentials. If the spend cap closes a shard after provider dispatch has begun, the report preserves completed results and marks unsent work as deferred. Use exact typed accuracy and protective-stop results alongside overall coverage when comparing runs.

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

The founder neutral diagnostic uses spend limits. Enter the same new lowercase UUID v4 in **Shared run ID (optional)** for each submission that belongs to a single run. One owner-bound, atomic $3 ledger covers the group for 24 hours. Before dispatch, the ledger reserves up to $0.15 per shard. Each shard prices its provider calls using an upper input allowance derived from the active prompt and schema plus the output limit. Settlement releases unused money and retains the cost of unresolved requests. A lost shard response leaves its hold in the ledger. A shard without a group ID uses its own $0.15 cap.

The founder run can use more than 1,000 requests in aggregate when it fits the spend cap. Each Worker invocation retains a transport limit of at most 48 provider calls. Submit further shards with the same run ID and let earlier holds settle when capacity is temporarily reserved. Record a fresh run ID for a separate study. Reader allowances and older research routes have their own controls. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

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

### Live windowed result

Both v9 shards completed on the same 33 targets as the v8 windowed arm. They used 79 requests at an estimated $0.026847, with all reported usage settled. Independent model calls can vary between runs.

| Measure | v8 windowed | v9 windowed |
| --- | ---: | ---: |
| Usable primary cue rows | 33/33 | 33/33 |
| Usable typed transition rows | 27/33 | 32/33 |
| Primary buildup matches and extras | 3/4, 1 extra | 4/4, 2 extras |
| Primary enacted cue matches and extras | 4/5, 0 extras | 4/5, 1 extra |
| Primary sustained continuation matches and extras | 1/1, 0 extras | 0/1, 0 extras |
| Applied reader cue matches and extras, legacy reference | 7/10, 1 extra | 8/10, 1 extra |
| Expected playback gates | 29/33 | 32/33 |
| Exact typed boundaries and extras | 7/7, 1 extra | 7/7, 0 extras |
| Applied exact boundaries and extras | 7/7, 1 extra | 7/7, 0 extras |

`first-dance` 2 and 3 were both recognized as buildup in the primary pass. `old-letter` 6 stayed quiet through the recheck, and 7 became enacted onset with Onset rise. Inside the report, both previously redundant resets disappeared. `reading-room` 8 became a verified rebuild, and the offer at 7 stayed quiet despite an extra raw restart prediction. The single typed rejection was a frame mismatch inside `old-letter`. No benign metadata normalization was needed in this live run. The simulator replay of these v9 outputs produced contrast in all seven eligible pace-episode pairs, zero positive-target time at zero, and zero hard-quiet, ceiling, cadence or pause violations across 18 configurations. One fast sentence ended before a new positive command was due. The tested software path remains separate from physical dispatch.

| Remaining discrepancy | Next experiment and required evidence |
| --- | --- |
| `first-dance` 1 was promoted as buildup before the reciprocal response. | Distinguish unilateral scene setup from evidenced standalone charged appraisal and mutual response. Freeze paired examples of each. Track buildup precision and recall together so removing early false positives does not erase subtle legitimate cues. |
| `first-dance` 4 was recognized as buildup and the onset moved to 5, displacing the ongoing action label. | Add a state-local enactment audit that records the first exact action target, prior enacted anchor and continuation separately. Test start followed by sustain, a genuine second start and a one-sentence-late prediction. Score exact start/continuation and phase-to-pattern agreement separately from playback gates. |
| The typed pass called the accepted offer at `reading-room` 7 a restart. | Score typed onset and restart against a separate enacted-start reference. Use matched offer-only, accepted-offer and renewed-action examples, including cases immediately after a stop. Keep raw typed errors visible when the compiler vetoes them. |
| A typed event inside the report was rejected for a frame mismatch. | Keep its rejected status and test neutral interior, nested entry and actual return with independent frame references. Track contract validity, semantic frame and applied resets independently. |
| Four neutral fixtures have limited coverage of writing style and scope. | Seal a cleared independent corpus and adjudicate the unresolved text targets. Compare both arms at matched latency and request limits, replay the actual cursor path, and verify hardware controls separately. |

## v10 timing and spend changes

| Discrepancy | Change | What would close it |
| --- | --- | --- |
| The opening setup inherited the effect of a later reciprocal response. | Teach the model to keep setup quiet while preserving a specific charged reaction or appraisal. Send a focused independent review when an exact but weak opening proposal lacks earlier romantic context. A definitive current quiet reply can suppress the proposal. | Score unilateral setup, standalone appraisal and reciprocal response separately on held-out examples. Verify both precision and recall. Keep unclear rechecks visible. |
| The first action was assigned to the next sentence and continuation was lost. | Ask the verifier to locate first enactment before classifying the current target. Independently review an onset next to a previous supported or independently typed start. Accept a continuation correction only with an explicit previous anchor and exact target evidence. | Count exact onset, restart and continuation separately. Identify a single adjacent displacement with both IDs and whether it displaced continuation. Confirm that a different enacted interaction can still start separately. |
| A typed restart appeared on a renewed offer. | Require first renewed action in the current frame. An offer can establish anticipation and a valid stop or decline still latches the compiler until enacted evidence arrives. | Audit explicit typed starts independently from accepted phases and applied gates. Track extra typed starts even when playback remains quiet. |
| A frame mistake produced an unusable typed row. | Resolve active frame before event. Verify the destination frame for entry and return and require an exact target citation for current onset or restart. | Score a current return beside an interior account sentence and a genuine nested entry. Preserve invalid rows and rejected evidence in their denominators. |
| Daily request quota cut off valid benchmark work. | Reserve estimated money across submissions under one group ID and settle actual measured usage and outstanding reservations. Separate the per-invocation transport limit from the run spend cap. | Verify that legacy quota exhaustion has no effect on the founder diagnostic. Stress parallel holds, duplicates, partial balance, expiry, missing usage and a simulated run with more than 1,000 provider calls. |

The timing report pins five exact enacted starts. `startTiming.typed` scores the explicit event, and `startTiming.enactedPhase` scores exact enactment with the correct phase. Each lane records adjacent shifts without awarding an exact match. `replayNeutralStartTiming(report)` also works on saved source-free reports carrying the existing behavior reference. Compare discovery, primary verification, accepted corrections and applied behavior separately. A timing correction leaves earlier evidence and raw scores intact.

### v10 live results and v11 follow-up

The four windowed fixture submissions used 76 provider calls, and a First Dance replicate used 25 more. All 101 calls settled under one $3 run ID for an estimated $0.037724, leaving $2.962276 available. The old page showed 27 requests remaining before deployment. The v10 page and grouped run used no daily or monthly benchmark request counter. The durable ledger also passed a local 1,000-call-equivalent test under a single run ID.

| Exact measure | v9 windowed | v10 windowed | v11 windowed |
| --- | ---: | ---: | ---: |
| Primary buildup matches and extras | 4/4, 2 extras | 4/4, 0 extras | 3/4, 0 extras |
| Accepted enacted starts and extras | 4/5, 1 extra | 5/5, 1 extra | 5/5, 0 extras |
| Independent typed starts and extras | 5/5, 1 extra | 4/5, 1 extra | 5/5, 0 extras |
| Applied sustained continuation | 0/1 | 0/1 | 1/1 |
| Applied reader cues and extras | 8/10, 1 extra | 8/10, 0 extras | 8/10, 0 extras |
| Playback gates | 32/33 | 33/33 | 33/33 |
| Exact typed boundaries and extras | 7/7, 0 extras | 7/7, 0 extras | 7/7, 0 extras |
| Applied boundaries and extras | 7/7, 0 extras | 7/7, 0 extras | 7/7, 1 extra |

The primary v10 run fixed the early setup and placed the first onset correctly. At the next sentence, discovery identified continuation while both causal passes called a second onset. The replicate identified continuation there but named its scope with the already verified onset ID, so the compiler dropped the link. The independent typed pass rejected one true restart in each of the two affected fixtures because Luna put the earlier context in the anchor field.

The v11 follow-up reviews consecutive onsets in the same verified scope even when both passes agree. A linked continuation can replace the second onset after an independent review. It also recognizes the exact prior anchor as an alias for the already verified scope. Unrelated scope mismatches, withheld anchors and earlier barriers remain ineligible. The typed adapter accepts a redundant earlier anchor only when the cited ID is in the submitted prefix and the verified start cites its own target. It keeps the cited history in the evidence list and records the normalization. These three corrections are tested independently of the live model.

The v11 primary run used 78 calls and its First Dance replicate used 25. Across v10 and v11, all 204 live calls settled under the same run ID for an estimated $0.076076. On the v11 primary run, an independent recheck corrected `first-dance` 5 to continuation and its prior-anchor alias preserved playback. All 33 typed rows were usable. The v11 projection passed seven of seven simulator contrast episodes with zero positive-target zero time and no hard-quiet, ceiling, cadence or pause violations across 18 conditions. One 420 WPM sentence ended before the next positive command was due.

The v11 repeat gave the duplicate onset a different scope number while citing the verified previous start. Timing review v2 accepts that citation for scheduling another blinded check. The prior citation alone supplies no playback evidence. At `reading-room` 7 the causal pass also replayed the preceding decline while the independent pass said no event. Timing review v2 keeps the existing latch and suppresses the disputed repeat as an extra applied boundary. It retains a separately confirmed second decline. Independent calls can produce different raw labels, so keep repeated timing cases and the cleared corpus in qualification.

### Targeted live reruns and final trigger change

Timing review v2 used 72 live calls on two First Dance runs and one Reading Room run. All 31 playback gates and all five expected applied boundaries matched, with zero extra boundaries. The first First Dance run linked its continuation correctly. The second put a duplicate onset on the same target. Both causal passes agreed on the duplicate, the cue pass proposed a different scope number, and it cited only the target itself. Across all rounds, 276 calls settled for an estimated $0.103602 under the single $3 run cap, with $2.896398 available at the end of testing.

Timing review v3 schedules a blinded check when consecutive current actions are verified starts in the same open run, even when the second cue proposes a new scope and cites only itself. A correction still needs verified continuation on the current target, an exact link to the immediately preceding enacted start and sustained phase. A separately verified second start remains a start. The regression suite covers both outcomes, including the exact metadata shape from the second live run.

Two live First Dance repeats on timing review v3 and rubric v11 used 51 calls and an estimated $0.019257. Both matched all 11 playback gates and both true enacted starts. One preserved continuation without intervention. In the other, the trigger dispatched the independent check, but its verified result called the continuation a new onset and cited only the current unit. This left one extra applied start and one missing continuation. All 327 calls through this point settled under the same ledger for an estimated $0.122859.

Rubric v12 now defines enactment at the level of the interaction. Taking the initial position and beginning the coordinated movement can be two steps of one agreed activity. A new verb, position or tempo cannot establish a second onset on its own. The focused check compares that case with an independently initiated interaction and retains a separate restart after an actual stop. This changes the three model passes without changing what evidence the compiler requires. First Dance is a development case. Freeze separate continuation, distinct-start and genuine-restart examples before judging recall and precision on unseen text.

The eight of ten applied reader cues in the full v11 run leave two earlier narrative buildup targets absent from playback. Both are explicitly quiet in the playback reference while the stop or decline is latched, at `first-dance` 9 and `reading-room` 7. Keep the narrative and playback scores separate when adjudicating them. The primary buildup lane recovered three of its four targets with zero extras. A held-out buildup set should report opening and post-stop appraisal separately and require evidence of renewed action before the playback gate reopens.

### Rubric v12 live result and compiler follow-up

The four fixed fixtures used 77 calls at an estimated $0.029710. All 33 typed rows were usable. The primary buildup result was three of four with zero extras. The independent typed and applied enacted starts each matched five of five with one extra. Typed and applied boundaries each matched seven of seven with one extra. The compiler matched 31 of 33 playback gates. The full run correctly linked the single continuation. An independent First Dance repeat used 25 calls at an estimated $0.009436. Both First Dance calls labeled the target as continuation with the correct prior anchor and had zero extra starts. The repeat lost the link during compilation while retaining all 11 gate matches. Across all rounds, 429 live requests settled for an estimated $0.162005. The run had $2.837995 available with no unresolved reservations.

| Exact target | Stage and evidence | Fix or qualification work |
| --- | --- | --- |
| `first-dance` 5, repeat | The cue pass linked to verified start 4. Start 4 also opened a new scope. The compiler rejected evidence at the scope boundary even after it had attested that start as part of the new scope. | Timing review v4 accepts the exact anchor at the boundary only when the current compiler pass has already attested it in the new scope. Earlier evidence, unavailable anchors and barriers still block the link. Covered by a local regression using the same evidence shape. |
| `old-letter` 5 | The typed pass repeated a return one unit after the verified return. The cue pass saw neutral present action. The merge produced a second reset. | Timing review v4 suppresses the disputed consecutive current-frame return in the same approved run. Raw typed output and a dedicated flag remain visible. A separately supported return remains eligible. Covered by a local regression. |
| `reading-room` 7 | Both causal passes treated acceptance of an offer as renewed participation immediately after a decline. The merge reopened playback a unit early. The legacy reader cue score consequently rose from eight to nine even though the stricter playback gate regressed. | Add an independent restart check at closed gates that answers whether renewed participation is physically depicted at the target. Retain the latch when the check reports offer-only or unresolved evidence, and retain the raw votes. Validate with held-out accepted offers, ambiguous participation and immediate true restarts. Require zero early restarts in this slice and report true restart recall and coverage alongside precision. This semantic discrepancy remains open. |

The v12 live counts precede the two timing review v4 compiler fixes. A corrected compiler regression and a passing live held-out model run are separate qualification results.

### Timing review v5 and the 41-story run

Rubric v13 checks a proposed restart behind a closed hard-stop or decline latch independently. The focused request receives the cleared causal prefix without the earlier judgments. It requires renewed enacted participation at the exact target. Offer-only, unresolved and deferred checks keep the latch closed. Raw cue and typed votes remain available for diagnosis. A later verified restart can still establish a new beat.

The deployed v13 run matched all 33 playback gates and all five exact applied starts, with zero extra applied starts. It matched the continuation and six of seven exact applied boundaries, with zero extra boundaries. `old-letter` 1 lost the exact reported-entry label, but the frame change still produced Reset. The typed pass had one extra start in First Dance. Primary buildup was two of four with zero extras, missing the two post-stop buildup labels that still require quiet playback. Both Reading Room runs kept the accepted offer quiet at 7 and independently confirmed the real restart at 8. First Dance also independently confirmed its real restart. The four fixtures used 78 calls at an estimated $0.029976. The Reading Room repeat brought the round to 100 settled calls and an estimated $0.038670.

The 41-work local evaluation aligned every source and reader-edition pin before comparing 17,827 text targets and 68 structural units. Replaying approved inputs reproduced all 17,895 profiles and all 17,895 traces exactly, with zero causal trace violations. The continuity scorer found no short baseline dips in 17,638 comparable windows. This verifies the compiler on reviewed input. The independent Loom browser-reader analysis below used text as input and projected paragraph cues to exact sentence targets. It measures direct-cue detection against the known reference and excludes 5,139 unresolved text targets from accuracy.

| Source group | Works | Known direct cues | Loom matches | Loom extras |
| --- | ---: | ---: | ---: | ---: |
| Original corpus | 11 | 1,015 | 16 | 29 |
| Story Dump 2 | 10 | 234 | 3 | 12 |
| Authored diagnostics | 20 | 1 | 0 | 0 |
| Total | 41 | 1,250 | 19 | 41 |

Loom direct-cue precision was 31.67% and recall was 1.52%. The current Luna runner indexed all 41 editions locally. It made zero corpus provider calls because a current exact-range grant was unavailable for each edition and the hosted current-rubric route serves fixed neutral fixtures. Corpus Luna precision and recall are unmeasured.

A shape-only planning pass found that 25 of 41 editions fit complete context. Under the current windowed source and request bounds, 427 discovery windows could cover 17,613 of 17,827 text units before checking clearance. A live study spanning all 41 can start with frozen cue and transition samples, then expand with resumable shards. Exhaustive two-pass verification would require 35,654 verification requests before discovery or focused checks. Report the approved, planned, dispatched, observed and scored denominators separately.

### Founder live corpus sample

Keep the source-bearing review packet and workbook outside Git. The repository contains the [source-free frozen scoring labels](nocturne-frozen-labels.md) and [approved annotation protocol](nocturne-approved-annotation-protocol.md). Open `/api/scene-analysis/luna-corpus` in a founder session on the app origin. Load the review JSON. Every exact target and its context appears in the browser before selection. The workbook provides an offline review view. The selection in the founder page is the approval used for dispatch. An unchecked excerpt is recorded as withheld. The review must cover permission to send the excerpt and the eligibility of all the context included in it.

Seal the selected excerpts, then start the sealed run. Sealing sends clip fingerprints and a run ID. The Worker uses the existing server-held OpenAI secret. It verifies each subsequent clip against the sealed roster before dispatch. A one-time clip reservation and shared $3 estimated spend ledger prevent repeated charges when a browser response is interrupted. Pause stops after the current clip. Reload the same packet in the same browser to resume clips that have not started. Download the results checkpoint to retain the source-free attempt records. Unconfirmed requests are recorded separately and require investigation before a deliberate rerun. Keep the scoring reference separate from any packet submitted to Luna.

Score the downloaded results against the frozen target roster and reference. Retain withheld, refused, unavailable and budget-deferred targets in coverage. Measure raw primary direct cue recognition, independent typed transitions, applied phase and pattern, and fallback behavior separately. Per-story recall needs at least one resolved positive target. This sample measures the proposed targets with their cleared causal context. A 41-story sample leaves unsampled sentences outside that denominator.

```sh
node scripts/evaluate-beat-continuity-corpus.mjs \
  --source /private/corpus-source.json \
  --reference /private/approved-labels.json \
  --target-roster /private/frozen-scoring-roster.json \
  --candidate v13=/private/satinlore-luna-corpus-results.json \
  --loom /private/loom-predictions.json \
  --output /private/luna-corpus-score.json --discrepancies
```

The first review packet covers 94 proposed clips and 181 targets across 34 editions, including 36 targets in the separate stress panel. The roster retains all 41 editions. Seven editions have unresolved transport receipts or dependent holds from an earlier study and contribute no proposed live excerpt. Clear those receipts and separately review exact ranges before adding any of the held editions. With every proposed clip selected, the conservative planning quote reserves an estimated $1.945977 across at most 637 requests. The estimate sums the maximum permitted calls for those exact clips. Actual usage settles per request under the durable run cap.

## v14 discrepancy repair and evaluation

The v13 reviewed run settled 379 calls on 77 clips and 148 targets across 31 stories. Luna and Loom found one of six positive direct cues on the common main sample. Luna found one of two on the common stress panel and added one false positive. The independent transition pass had 30 mismatches on 147 usable targets. Playback matched 80 of 148 patterns, including two of 63 expected non-baseline patterns. An always-Baseline control would have matched 85. Keep the main and stress panels separate and retain the frozen score even when the earlier label has ambiguous semantics.

| Failure group | What the v13 evidence showed | v14 change and evaluation |
| --- | --- | --- |
| Direct cue recognition | Six false negatives included two neutral judgments and four verified judgments for anticipation, continuation or release. Four expected positives had an ease or recover reference phase. The gold activation field and the direct contact/change score have different boundaries. | The rubric distinguishes physical contact or a new change from buildup, ongoing action and release. Current active and easing facts need a target citation. Keep the old direct score comparable. Report the exact observed action on misses and separately adjudicate direct enactment, buildup, continuity and release on unseen reviewed cases. |
| Independent transitions | Five scene cuts, four returns and two imagined entries were labeled none. Five ordinary activity stops were added where the reference expected no event. Two easing events became beat ends. One typed response failed its prior-anchor contract. | Require evidence of the trigger and the actual change or disruption, including the first narrated event in a changed frame. Preserve gradual withdrawal and distinguish routine task steps from a completed ordinary stop. Reject ordinary stop labels in a noncurrent frame. Compare exact event kinds, no-event controls and contract failures. |
| Arbitration | Two exact causal frame events were erased from the applied event field by a neutral typed verdict even though the trace reset. A mixed-frame return was applied early. Two primary uncertainty markers survived neutral typed results. | Preserve exact causal entry or return when there is separate causal corroboration. Veto a mixed premature return when the exact primary row still places the target inside the earlier frame. Keep disagreements and the independent vote visible. A protective or declined gate keeps priority. Audit remaining uncertainty disagreements separately from typed event misses. |
| Approved context | All 28 targets whose reference beat began before their clip missed the expected pattern. Ten pattern discrepancies cite reference evidence outside the dispatched prefix. Within a clip, a verified continuation cited an earlier unit that the runner had left discovery-only because every verification slot was spent on scored targets. | The founder runner can independently check up to two earlier supporting units inside each approved causal prefix. The supporting check yields to pinned checks under tight attempt, byte or spend limits. It never adds a scored target. Report unavailable reference evidence and separately test longer explicitly cleared causal prefixes. |
| Playback translation | 51 pattern errors fell to Baseline, including 14 Taper and 12 Undertone. In 36 of the 68 pattern errors, both applied phase and transition already matched the reference. Neutral scope renumbering and frame isolation could produce visible Reset without a grounded cut. | Let an exact, current verified release drive local easing without fabricating an earlier beat. Keep unverified context from carrying playback and avoid visible Reset from a quiet frame observation or neutral scope number alone. Use verified continuation anchors for beat carry. Test neutral, release, protective, restart and scope cases and track active-pattern recall as well as exact labels. |
| Coverage and comparison | Only 31 of 41 stories had submitted clips. Seventeen clips were withheld during review, and seven stories remained outside the excerpt roster with earlier unresolved receipts. Most usable rows were authored controls or cue negatives. | Use the same 77 approved clips and 148 target IDs for the paid comparison. Report changed decisions on common usable rows and gains or losses in usable coverage separately. Preserve every frozen row and report source stories apart from authored controls. Keep withheld material out of live requests and use a separate review before extending coverage. |

The regression tests check earlier supported carry, tight call and byte headroom, exact local release, hard-stop precedence, frame arbitration and source-free paired scores. The sample command accepts repeated candidates with the baseline first. It reports improved and regressed rows on common usable targets as well as gained and lost coverage. The discrepancy file records the observed action and reference evidence outside the submitted prefix without retaining prose.

For qualification, first compare v13 and v14 on the frozen reviewed sample with the same model, clip text, target IDs and spend cap. Then independently review the provisional cue labels and compile a new set of clearly eligible beats with both short and complete causal context. Measure direct cue recall and precision, typed event recall and false positives, active-pattern recall, false activation, taper timing and exact profile match. Keep actual reader behavior, simulator output and physical device qualification as separate checks.

### Paired live results

The v14 founder run completed all 77 approved clips and all 148 targets across 31 of the 41 rostered stories. It recorded 420 calls and $0.196649 in estimated charges, including 42 supporting checks. The run had no unsettled attempts. The 17 withheld clips and seven historical holds remain in the coverage record. Use the following common usable denominators for the paired changes.

| Measure | Main sample, v13 → v14 | Stress panel, v13 → v14 |
| --- | ---: | ---: |
| Exact playback pattern | 72/124 → 78/124 | 8/24 → 8/24 |
| Active playback intent recall | 4/45 → 19/45 | 2/14 → 6/14 |
| False active playback intent | 0 → 2 | 0 → 0 |
| Raw direct cue recall | 1/6 → 1/6 | 1/2 → 1/2 |
| Applied direct cue recall | 1/6 → 1/6 | 1/2 → 0/2 |
| Exact typed transitions | 106/121 → 102/121 | 11/23 → 10/23 |

Exact patterns rose to 86/148. An always-Baseline control matches 85/148. Of the 62 remaining pattern errors, 28 fell to Baseline and 30 had the expected applied phase and transition. The two new false activations followed a supporting cue into neutral units through the fade and floor rules. Keep support evidence distinct from authority to sustain a beat. Verify same-scope continuity through consecutive neutral targets and measure the time spent above baseline after a reference stop. Evaluate this alongside ordinary in-scene dialogue so the fix preserves legitimate carry.

The typed lane found more main-panel events and added false events. Across both panels it added five scene cuts and four onsets on no-event targets. Three typed responses failed the prior-anchor contract. Recheck the exact boundary trigger and new frame or scope in a focused lane, keep onset separate from within-beat change, and measure contract failures separately from semantic misses. For causal evaluation, five frozen transition labels in this roster were only knowable one unit later. Preserve the original retrospective labels and record the first time the reader could have known each event.

Two blinded model reviewers agreed on all 12 selected direct-cue cases and differed from the frozen binary label on three. Both live versions recognized three of the seven direct cues in that exploratory review. Independently adjudicate action, transition and playback intent as separate fields on a new sample with more positives. Report the frozen scores alongside the new reference. Avoid using one scoring field for both an enacted change and every label that should affect playback.

### Compiler follow-up after the live comparison

The recognition pass can verify a new action within an established beat while the transition pass calls it onset. Keep the same beat and waveform when a verified `change` has exact target evidence and a verified same-scope continuation link. Record the change as an applied direct cue. Ordinary continuation remains a continuity signal.

A verified scene cut can replace the merged continuation fact and hide its old anchor. Check the original primary fact before accepting a new cue or clearing an existing playback gate. Preserve the cut and clear carry. Apply the same check in the attestation ledger so later requests cannot reuse the stale cue. Tests cover open playback, blocked targets, a protective scope, hard stop, decline, and fresh local evidence at a genuine cut. These compiler tests followed the paired live run's build and have separate verification.

## v15 recognition and playback repair

V14 had 144 usable typed rows among 148 returned targets. Three typed rows failed the earlier-anchor contract, including one that was also unavailable in v13. Two of the three newly unavailable rows failed that contract. The other was a valid abstention on a reference cut. Report adapter failures and semantic abstentions separately.

| Issue | Implemented repair | Verification and remaining work |
| --- | --- | --- |
| New local contact inside an active or easing beat | Separate the local act from phase and scene transition. A distinct current act can use `contact` or `change` during easing, while a release-only target uses `release`. A new onset requires actual participation in an independent interaction. | Keep the frozen direct-cue score. Also inspect exact local action regardless of phase on adjudicated examples. Freeze a separate action, event and playback reference before tuning a fresh author-grouped sample. |
| False cuts, onsets and ordinary stops | Ask for a material before-and-after change and the first narrated unit of the destination scene. Require actual enacted participation for a start and an actual end or clear stop instruction for ordinary activity. | On common usable rows track per-kind precision, recall and added no-event errors. Include dialogue bridges, chronological markers, single routine steps, frame switches, and true starts and stops. Report causal first-known position separately from retrospective annotation. |
| Redundant anchor on a non-linking event | Remove only the redundant `priorAnchor` when the earlier ID and target are both cited inside the sent prefix and the exact event otherwise passes validation. Preserve the event, effect and citations, and record normalization. | Keep missing and ambiguous citations invalid. Preserve explicit easing links and the existing hard-stop and decline rules. Audit rejected and normalized targets separately. |
| Support-only cue carrying into neutral targets | Supporting checks may attest same-scope evidence. They do not start playback or add intensity. The first independently verified target that links to the support can open a low profile and retain that evidence. Ordinary verified beats still carry into appropriate connectors. | Verify the two previously false-active neutral rows, exact linked continuation, release, uninterrupted in-scene dialogue, and cut and gate precedence. Compare the same accepted labels with both compilers where the frozen request inputs can be reconstructed. |
| Playback translation and missing context | The checkpoint now retains source-free facts and attempts per approved clip, including supporting rows, so a replay can pin the exact context seen by the compiler. | Reconcile 62 v14 pattern mismatches by layer. Start with the 30 where applied phase and event already matched. Require exact baseline reconstruction before attributing a change to the compiler. Compare longer approved causal prefixes separately from a prompt change. |

The 77 approved clips are a development comparison. Keep source stories and authored controls separate. Use a new eligible holdout with independent labels and the [release acceptance gates](release-acceptance.md) for qualification. The held excerpts and seven unresolved editions remain coverage gaps until reviewed separately.

### Live comparison and compiler follow-up

The sealed v15 run completed 77 approved clips and 148 targets with 413 calls, $0.192311 in estimated charges and zero unsettled attempts. Raw frozen direct matches increased from 2/8 to 3/8, and applied matches increased from 1/8 to 4/8. The same separate blinded audit found 5/7 local direct actions with v15 versus 3/7 with v14. One approved frozen direct positive lost raw and applied coverage after a `fact-frame` rejection. Usable typed transitions rose from 144/148 to 147/148. There were zero typed `prior-anchor` rejections and one `transition-fact` rejection. No response needed the new anchor normalizer in this run.

| Measure | v14 live | v15 live with strict support | Guarded compiler replay of v15 facts |
| --- | ---: | ---: | ---: |
| Exact profiles | 86/148 | 85/148 | 87/148 |
| Expected active intent | 25/59 | 14/59 | 19/59 |
| False active intent | 2 | 0 | 0 |

The compiler replay reproduced all 148 archived outputs in each live build with no provider calls. Strict support removed both false activations on identical v14 facts and also reduced active recall from 25/59 to 16/59. The guarded follow-up permits an earlier exact current start or buildup to establish carry when discovery and verification agree on the action, phase, event, effect and scope. Release-only support cannot open a beat. Hard gates, verified cuts and incompatible frames keep precedence. A support row does not create a new target cue. The same guard produced 20/59 active intent and 87/148 exact profiles with zero false activations on v14 facts. It still carries through some disputed boundaries under the existing arbitration. Resolve those with independent continuity evidence before broadening the rule or claiming qualification.

## v16 focused continuity and waveform verification

V15 had six exact cut versus neutral disagreements. It found four of eight returned frozen scene cuts and made five extra cut calls. One extra cut was predicted by both passes, and four frozen cuts were missed by both. A third check on disagreements addresses only part of the boundary problem.

| Issue | V16 behavior | Remaining verification |
| --- | --- | --- |
| Disputed cut or uncertain carry | The reviewed founder runner may use an existing bounded recheck slot. It sends the same approved causal prefix for an independent assessment. The original primary and typed decisions remain available. The recheck can confirm the exact proposed cut with earlier and target evidence, or confirm a current-scope continuation with a previously verified enacted anchor in the supplied prefix. Unresolved votes keep the existing arbitration. | Compare the primary, typed, recheck and applied decisions separately. Check agreement on a wrong cut, unanimous misses, absent earlier evidence and one-unit causal timing. Blocked scopes and verified stops take precedence. |
| Waveform compression | A verified build with cited romantic context in the same scope can use Gradual build. Exact enacted sustain with a verified prior onset can use Sustain wave. Ordinary continuation and release-only support keep their existing limits. | Replay the identical provider facts. Preserve hard stops, real cuts and silent controls. Score exact profiles separately from active intent, then verify timing at different reading speeds. |
| Incompatible event or frame fields | The provider rubric asks for local enacted action independently of ongoing phase and makes the event-to-effect requirements explicit. A contradictory event or frame remains a validation failure. | Track malformed responses, valid abstention and factual mistakes separately. Test new action within an easing beat and soft withdrawal inside a continuing scene. |

On archived v15 facts, the compiler changes improve exact profiles from 87/148 to 90/148 against the guarded compiler, with 19/59 expected active decisions and zero false activations unchanged. That comparison excludes the new focused calls and requires identical historical requests. It tests waveform selection without giving credit for any additional recognition. The frozen development set cannot qualify broader natural stories or a physical device.

The v16 paid run completed 77 approved clips and 148 targets with 415 calls, $0.197352 estimated charge and zero unsettled attempts. Usable independent transitions rose to 148/148 from 147/148 in v15, with exact independent transitions at 117 in both runs. Applied transitions increased from 117/148 to 119/148. Frozen direct matches held at 3/8 raw and 4/8 applied. Scene-cut matches fell from 4/8 to 3/8 with five extras in both runs. The five focused checks left the final event and pattern scores unchanged in a matched replay that removed those calls. The single accepted focused vote corroborated a cut already applied on a frozen interruption target.

The follow-up treats an auxiliary buildup that cites only itself as provisional. Its hold is 16 words and it has no neutral-connector floor until an exact target verifies the same scope. Exact contact after a verified ordinary beat end can use Recovery for its own unit when both causal votes support it. This creates no carry anchor and cannot cross a cut, protective gate or restart latch. On identical paid v16 facts the follow-up raises exact patterns from 87/148 to 90/148, active intent from 23/59 to 24/59 and removes the only false activation. These gains are offline. Future live work should separate earlier scene state, material boundary and local action, and test missing-context and unanimous-error cases apart from disputes.

## v17 independent scene boundary and local event

The v16 archive includes a cut where Luna cited only the target and a separate cut where both recognition passes identified the new action but missed the scene entry. V17 returns a material scene boundary and a local event in the existing independent transition call. A verified cut identifies the entry at the exact target and a strictly earlier unit visible in the supplied prefix as the prior episode. A missing or unclear prior episode permits uncertainty. A subsequent cut requires evidence from the new scene. The receipt retains both decisions, their evidence roles and the applied transition. A standalone scene cut proposed by the primary pass requires the independent boundary proof. Explicit stops, protection and verified frame transitions retain priority. A malformed scene claim leaves a separately valid stop intact. The same line can retain the independently recognized local action as the compiler closes the old scope.

The compiler can deepen consecutive verified buildup within a paragraph when both units establish the same scope. This preserves the earlier evidence ID and keeps isolated, cross-paragraph and unverified buildup on the existing path. Replay of the same 148 v16 targets moves exact profile matches from 90 to 91, with 24/59 expected active profiles and zero extra activations on 89 frozen inactive targets. The follow-up is a separate replay result from live recognition.

The paired development panel keeps the same 77 previously reviewed clips and 148 frozen targets. Score the cut evidence roles, local event and applied event separately. Include the withheld and unresolved edition counts, exact and first-knowable event timing, natural and authored splits, and disagreement with independent action reviews. A second context arm needs its own exact approval. The frozen panel has one natural cut positive and no protected targets. Confirm generalisation with an independently adjudicated, unseen natural panel and verify protected handling in a separate control suite.

The live v17 benchmark completed 77 clips with 425 calls, $0.207346 in estimated charges and zero unsettled attempts. Exact profiles rose from 87 to 91 of 148. Expected active intent fell from 23 to 20 of 59, with zero extra active profiles. Exact applied events fell from 119 to 117 of 148. Scene-cut recall held at 3/8 with five extras. On the natural subset exact profiles rose from 12 to 14 of 36, and expected active intent fell from 15 to 12 of 28. The reviewed natural cut still landed as an accent. Earlier scene context, buildup and easing recognition need further work before release qualification.

Eight focused boundary calls left the paid outputs unchanged when ablated. The follow-up uses a definitive focused no-event verdict when the primary pass was also neutral and only the separate boundary response asserted a cut. It retains the original vote and does not establish continuity or a new cue. Replaying the same 148 targets applies the guard to three extra cuts, takes exact profiles to 93/148 and applied events to 120/148, and leaves all three matched cuts and both active-intent counts unchanged. This is an offline result on the development panel. A new natural holdout is needed to test the guard on disputed true cuts.

## Qualification

### V18 scene-only comparison and local taper

The reviewed founder benchmark sends a separate scene-boundary request for each pinned typed target. This request receives the same causal source prefix and target, with no other vote or attested label. A material cut cites an earlier scene, the event that displaces it, and the exact entry into the next scene. Non-cut verdicts identify continuing activity, routine movement, interruption, a viewpoint marker, a frame-only change or a scene already entered. Insufficient and ambiguous evidence have explicit uncertain outcomes. The control prompt and its cue and transition decisions retain their v17 rules. The added arm records evidence and status for comparison. It supplies no playback instruction.

The planner can taper a brief ordinary ending when both accepted passes establish it in the current frame and cite a recent independently verified start in the same scope. The taper applies to the ending unit and supplies no new cue or carry anchor. Stops, protection, frame changes and material cuts keep precedence. Compare compiled profiles and emitted simulator levels separately, including minimum and zero caps.

The v17 mismatch audit found 28 of 57 incorrect profiles and 12 of 31 incorrect applied transitions with a cited ID absent from the entire approved clip. A larger limit on that same clip cannot recover those coordinates. Pair exact current clips with separately reviewed longer prefixes where earlier evidence fits the context bounds. Score the first knowable event, raw cue and local action, applied transition, waveform, and output timing. Count unavailable targets explicitly. The development set has eight cut positives and one natural cut positive. Use independently adjudicated works for promotion and separate gate coverage for explicit stops and protected content.

V18 completed the same 77 clips and 148 targets in 582 calls at $0.236165 estimated spend. Applied transitions improved from 117/148 to 121/148 across the paid v17 and v18 runs. The v18 control recovered four of eight frozen cuts and applied one extra cut. Both same-run raw arms found the same four cuts. The typed arm made three extra claims and returned seven uncertain votes. The scene-only arm made five extra claims and returned 34 uncertain votes. Direct substitution changed the requests for eight targets and had no applied benefit on the remaining 140 comparable targets. Keep the scene-only pass in the founder diagnostic lane. The unchanged control prompt found the natural cut on this run, so its recovery cannot be attributed to the new prompt.

The follow-up preserves fresh enacted contact at a confirmed material cut when an independent local onset cites only the exact entry. The primary's earlier citations may identify the old scope or the verified prior scene. The same stop and restart gates apply. A corroborated brief ordinary beat ending can also taper when its closing phase is ease and it adds no new action. Exact replay of all 148 v18 targets restores one cue and two expected active profiles without adding an extra active profile. It takes exact profiles from 90/148 to 91/148 and active recall from 15/59 to 17/59. The two extra active profiles observed in paid v18 remain. Both emitted at background level in the default simulator checks, and one was a frozen Reset that expected silence. Wider context, independent waveform adjudication and calibration validation remain open.

Compare exact reviewed compiler output separately from semantic recognition. The shadow study reports usable model coverage, cue and typed-transition precision and recall, profile agreement, continuity links and causal trace violations. Compare current reader and archival provider outputs in separate lanes. For a paid paired run, hold the target roster and recent prefix fixed, use a shared run budget and stop the comparison for a refused run. Report both effective scores on every planned target and accuracy among targets both arms resolved. Compare recovered and lost matches and added false positives. Earlier eligibility evidence and earlier continuity anchors are separate strata. Verify timing and simulator behavior after model qualification.
## v19 local-action diagnosis and verified release

The founder corpus runner replaces the v18 scene-only comparison with a local-action comparison. Discovery, primary prefix, typed event and focused checks keep their existing wire contracts. The new request sees the same sealed causal text as the typed event check. It receives neither attestations nor scores. It returns an independent frame, action, phase and evidence verdict, including explicit outcomes for ordinary contact, proposals, depiction alone, continuation, release and insufficient context. The worker maps cited coordinates to the exact source edition. The comparison runs after control requests and is exported for evaluation only. It cannot add evidence to the playback compiler. The founder route retains its existing exact-clip seal and estimated $3 run cap.

Typed event responses that fail the status/effect contract retain the failure reason and a bounded diagnostic with enum values and evidence relationship flags. Validation still rejects the incompatible tuple. This makes a malformed result measurable separately from an admissible semantic abstention.

| Failure | Change or experiment | Evaluation |
| --- | --- | --- |
| Enacted change, ongoing action and release collapse into the same label | Compare the primary and independent local-action results on the same text. Keep action, phase and frame separate from whether a pattern is active. | Use independently adjudicated exact targets. Count false positives on ordinary contact, remembered action, proposal-only and release-only controls. A missing or refused result is unavailable. |
| A current beat eases after a return from a noncurrent frame | Permit a local taper only for exact corroborated release in the returned frame. Keep the configured background at low nonzero caps. | Replay accepted facts unchanged, then simulate at multiple reading speeds with fixed user settings, hard stops, paused output and zero caps. |
| Earlier evidence falls outside the reviewed clip | Pair the original and expanded causal prefixes on the same target and edition. Confirm the complete expanded clip before it can be dispatched. | Keep the prompt and target position fixed. Score availability, cue and event accuracy, earlier and target evidence, and neighboring false cuts separately. |
| A reference boundary has disputed semantics or timing | Retain the frozen score and record independent review and the first causal unit in parallel. | Compare exact and one-unit-late placement explicitly. Keep disagreements and unavailable evidence visible. |
| Phase and event agree but the waveform differs | Reconstruct accepted facts and replay the compiler and simulator separately. | Measure active intent, output above configured background, true stop leakage, and low-cap troughs across supported reading speeds. |

Use the targeted comparison to choose the next change. Before promoting an independent verdict into playback, pre-register its arbitration rule and evaluate on separately adjudicated natural works and hard negatives. This targeted panel and the recorded simulator output do not qualify a release or a physical device.

### Live evidence and next experiments

The 19 unchanged clips contain 37 targets across 16 works. They completed with 152 Luna calls and $0.069008 in estimated charges. Compared with v18 live on those clips, exact profiles rose from 12/37 to 14/37 and expected active intent rose from 7/26 to 11/26, with one extra active profile in both. Exact applied events remained 25/37. Correct cuts remained 3/5 and extra cuts rose from one to two. The unchanged control request contracts support historical comparison. Model judgments varied, so the compiler's contribution comes from the identical-fact replay.

The v19 primary recognized five of seven direct positives in the 12-target model-assisted audit. The blinded local-action check recognized seven and produced zero extras among five negatives. The compiler applied four of seven direct cues. Three of 37 blinded outputs failed the evidence contract. Replaying all 37 targets with the blinded lane removed reproduced every applied output and all retained requests. The follow-up records the rejected action and evidence relationships as enum values. This identifies absent, invalid or misplaced citations without storing rejected coordinates or changing the verdict.

Six matched authored context pairs improved applied cut decisions from 3/6 to 5/6 and exact profiles from 2/6 to 5/6. Both missed cuts were recovered. The existing false cut persisted and the three balanced controls retained their cut decisions. One corrected typed judgment cited newly supplied earlier evidence. The second cited a unit available at both widths. A separate natural pair recovered both frozen Tapers at `d2-02:1549,1550` with the wider prefix and kept the same correct applied events and phases. The wider input supplied the original scope at 1540. All four sealed live runs totaled 227 calls, $0.103555 in estimated charges, zero refusals and zero unsettled attempts.

1. Use the exact same approved target and model input in a repeat panel to estimate false-cut stability. Include viewpoint headings and ordinary interruptions alongside true scene changes, and require separate evidence for old state, material change and entry.
2. Verify current action separately when a direct action falls during recovery or at a true scene entry. A corroborated local act can coexist with the applied recovery or cut. Require independent evidence for a fresh scope after a cut. Test any arbitration change against the frozen trace and measured simulator output.
3. Expand the paired context study to independently reviewed natural examples and wider prefixes that contain the decisive earlier state. Preserve target placement, measure evidence citations, and compare a bounded earlier-state handoff where a single contiguous clip cannot fit.

## V20 boundary arbitration and exact local action

V20 keeps the provider request formats and prompts byte-identical. It changes how the founder shadow compiler applies validated evidence. A typed explicit-break claim inside a structurally continuous excerpt remains visible as a raw judgment. A parser-confirmed divider resets inherited continuity and stays outside the model requests. A disputed objective shift needs an independently verified entry whose scope starts on the target. Existing stop and protection gates keep precedence.

When the primary, typed and blinded local-action lanes corroborate enacted current contact in Recovery, the compiler records an applied cue and keeps the Recovery envelope. A new onset at a verified scene entry needs target-owned scope from discovery plus independent target-only typed and blinded evidence. The compiler clears the old scope and records the real cut and the fresh onset together. For a short release after a verified return to the current frame, typed and blinded evidence can supply the exact return link when the primary confirms the current release itself. The resulting local taper has no continuation anchor. An exhausted one-word taper on a longer unlinked quiet unit returns to Baseline. Exact scope links and short connectors retain their existing release evidence.

| Measure on 37 identical archived targets | V19 compiler | V20 compiler |
| --- | ---: | ---: |
| Exact profiles | 14 | 16 |
| Expected active profiles found | 11/26 | 14/26 |
| Extra active profiles | 1 | 0 |
| Exact applied events | 25 | 26 |
| Correct cuts | 3/5 | 3/5 |
| Extra cuts | 2 | 0 |
| Exact applied cue labels | 29/35 | 31/35 |

Track raw votes, application, and output separately. Repeat the 19 sealed development clips and score the earlier approved natural clips outside that panel as an extension. Keep narrow and wider context results paired by exact edition and target. Cases with excluded source or missing earlier units remain unavailable for contiguous comparison. Independent first-knowable transition labels, author-separated natural holdout, and physical output remain release dependencies.

### V20 live evidence

Three sealed runs completed 30 clip executions and 57 target decisions, including the two repeated context targets. They used 235 Luna calls and $0.103622 in estimated charges, with zero refusals and no unsettled attempts. In the matched 37-target panel, exact profiles rose from 14 to 15, expected active intent rose from 11/26 to 12/26, and extra active profiles fell from one to zero. Exact applied events rose from 25 to 26. Correct cuts fell from three to two and extra cuts fell from two to one. A previously correct natural cut lost its typed cut judgment on the new call. The remaining extra cut was a disputed late vote with a deferred focused check. The same fresh facts produced identical requests and matched output across both compilers except for the exhausted release tail. Of 149 matched requests, 76 returned a different status or validated fact field.

Both v20 widths produced the two expected natural Tapers and both correct applied events and phases. The 18-target natural extension scored 8/18 exact profiles versus 10/18 on the older live run. It kept 3/11 expected active profiles and 16/18 exact applied events. Both compilers produce identical results on the extension's fresh v20 facts. The two profile losses followed changes in the cited evidence for buildup and the subsequent quiet connector. These remain development comparisons.

The follow-up withholds a disputed typed-only cut when its focused check cannot be dispatched, and records the reason for deferral. On the same v20 responses, this removes the late Reset at `a20-09:17`, raises exact events from 26/37 to 27/37, and reduces extra cuts from one to zero. Both correctly recognized cuts remain. A separate validator change clears a redundant exact target ID from an otherwise valid no-action verdict with null context. This normalization adds no action or playback authority.

## V21 exact buildup evidence and first-entry evaluation

An adjacent buildup can advance the profile when the exact target supplies a new buildup in the current frame and identifies its predecessor as scope, the predecessor has independently verified current buildup, and the blinded local-action check links the same two coordinates. The rule requires an open, continuous frame and keeps direct action separate. An unbound proposal or adjacent sentence alone supplies no stronger profile.

The founder corpus adds a diagnostic for the first enacted entry into a materially new time, setting or objective. It uses the same reviewed causal prefix through the target and has no access to other model votes or frozen labels. Its positive verdict names the old episode, the first material change and the exact entry. An `already-entered` verdict names a strictly earlier entry, and uncertain verdicts preserve missing-context and ambiguity reasons. Only IDs inside the exact approved prefix can be cited. A structured divider, narrative-frame shift and new local action have separate decision paths.

The study compares the diagnostic against the raw typed vote and applied cut on the exact targets. A repeated subset measures agreement across independent calls. Keep later votes visible and compare exact placement with independently adjudicated first-knowable placement. The diagnostic alone carries no playback authority. Existing provider request bodies remain byte-identical. A new per-target diagnostic attempt shares the existing sealed run spend cap.

## V22 anchor recovery, scene entry and context experiments

A rejected primary anchor can leave the target unknown even when discovery and the independent event classifier returned useful observations. The founder study allows one focused recheck per clip for this validation failure. It sees the exact causal prefix, uses the ordinary validated fact schema and can recover only an independently supported neutral decision. Its diagnostic and application are recorded separately. A failed recheck remains unavailable. A neutral result supplies no new action, onset, transition, cue or scope. The fixed hold, eligibility and stop conditions still apply.

Within one cleared run, the founder scheduler releases an unused restart-check reservation after the final potential stop coordinate has passed, provided the verified state has no pending stop. Confirmed stops and later potential stop coordinates retain their reservation. The change uses the existing focused check allowance and retains the separate dollar cap.

An exact verified continuation can select Sustain wave when its earlier same-scope onset, current target and causal link are independently verified. The rule permits at most one short neutral connector within the same open scope. It updates the profile at that unit and does not extend the beat or add a cue or transition.

The first-entry check asks what earlier episode stopped governing and what episode is actually underway at the target. It separates enacted departure or arrival from preparation, movement within the same activity and simultaneous background action. It separates a replacement objective from fulfilling or interrupting the old one. The request keeps the same bounds and verdict schema. This check is scored separately from the typed event, local action and playback compiler.

Compare the 23 unchanged V21 targets and the ten repeated targets first. Score exact frozen agreement, availability, repeat agreement, extra cuts and any applied changes. A separate wider arm may use the exact previously reviewed sealed contexts, with identical edition, target IDs and causal end positions. Score each wider pair against its same-build short response. Record earlier context available to each request, later discovery text and the evidence the answer actually cites. A result on a wider span without new causal evidence is a model-response difference. Repeat such cases before inferring a context effect.

Keep source exclusions, refused requests and uncertain or invalid responses visible in coverage. A later confirmation does not establish an earlier real-time decision. Use two independent human reviews and an adjudicator for first-known boundaries, then measure cut timing and precision on unseen stories. Separately replay known facts for envelope hold, taper and decay at 120, 240 and 420 WPM. Device stop, pause and ceiling checks and physical observations remain distinct release criteria.

## V23 corroborated setting cuts and the 41-work evaluation

The founder shadow compares two independent first-entry judgments when the typed setting cut conflicts with a strictly neutral focused response. The focused answer contributes evidence of uncertainty when it supplies no same-scope link. A typed cut and an independently verified first-entry cut can settle that narrow case when they identify the same previous episode and exact enacted entry, the surrounding causal state is compatible, and no priority event applies. A verified same-scope continuation, a stale boundary, a stop or protection retains priority. A separate conflict record identifies legacy cut agreement alongside an independent viewpoint-only verdict for adjudication.

Replay approved compiler inputs on all 41 pinned works and score local recognition separately on the same source. Use the exact previously approved clips for the live founder arm and retain all 41 edition pins and 181 frozen development anchors in the accounting. Count held, excluded, absent and unconfirmed spans explicitly. Compare any historical model results on matching edition, unit and context fingerprints. Report observed accuracy and the effective denominator separately. A whole-work local replay and a reviewed-excerpt provider measurement answer different parts of the evaluation.

The browser can select all locally reviewed excerpts before sealing. Individual exclusions remain editable before approval. The seal still binds exact clip fingerprints, and the run dispatches only the selected sealed roster. Several independent sealed runs can execute in parallel, with a combined preflight against the authorized budget and reconciled settled calls.

## V24 same-episode checks, cue designation and context opportunity

On the founder shadow path, an independently disputed quiet setting or objective cut can use a bounded same-episode recheck. A verified earlier-to-current link must match the exact cut coordinates before the shadow compiler can suppress the reset. A mere negative, insufficient prefix, unserved check or invalid fact supplies no such link. Priority transitions, stopped or protected states, and blocked scopes retain precedence.

Cue designation and waveform selection use separate evidence gates. Exact enacted contact within an already linked continuation can count as a cue when the independent action and typed event corroborate it. The cue designation leaves reader cue, phase, transition and playback unchanged. An independently corroborated sustain can select its waveform within an established beat despite typed effect-free uncertainty. That rule has no authority to start, renew or reconnect a beat.

The targeted live comparison reuses exact previously approved clips and joins the v23 receipts to each edition and target digest. An additional request with no recorded response remains unavailable in fixed-response replay. Score observed calls separately from deterministic replay. In the reader planner, compare equal-budget opportunity at the opening and later positions before making any claim about actual semantic recall or device behavior.

The offline paced-budget candidate reserves part of the contextual allowance for later eligible text and rolls unused allowance forward. The reader continues to use its current session allocation while the candidate's protected-reference opportunities are reviewed. Corroborated present impairment can mark a bounded local review span as ineligible for contextual analysis and above-zero playback. Structural and clear time boundaries end the carry. Quoted, figurative or uncorroborated wording supplies no capacity flag by itself.
