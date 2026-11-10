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

## Qualification

Compare exact reviewed compiler output separately from semantic recognition. The shadow study reports usable model coverage, cue and typed-transition precision and recall, profile agreement, continuity links and causal trace violations. Compare current reader and archival provider outputs in separate lanes. For a paid paired run, hold the target roster and recent prefix fixed, use a shared run budget and stop the comparison for a refused run. Report both effective scores on every planned target and accuracy among targets both arms resolved. Compare recovered and lost matches and added false positives. Earlier eligibility evidence and earlier continuity anchors are separate strata. Verify timing and simulator behavior after model qualification.
