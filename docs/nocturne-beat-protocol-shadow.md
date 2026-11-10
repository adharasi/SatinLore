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

The founder-only study page offers fixed complete-context and windowed diagnostics on the four original neutral fixtures. Each arm has two complementary parts. Part A has 19 units and part B has 14. Both check every cue and transition in their part, and combining the reports restores the original 33-unit denominator. Complete context plans 40 and 30 calls. Windowed plans 43 and 33. The score-only reference stays outside the prompt.

Each diagnostic row contains its sentence ID, provisional discovery result, causal cue result, independent transition result and the compiled decision. Attempts report submitted and cited IDs, typed failure codes, timing and measured usage. The hosted response omits source text, provider response bodies and credentials. If quota closes the route after provider dispatch has begun, the report preserves completed results and marks unsent work as deferred. Use exact typed accuracy and protective-stop results alongside overall coverage when comparing runs.

### Improve coverage and precision in order

1. Preserve valid discovery rows from a completed response. Report invalid, duplicated or missing requested rows separately. Prioritize their native prefix checks within the run allowance. A provider refusal still closes its dependent run.
2. Require the cue's own evidence at the exact current target before applying a new cue. The transition verdict can close a beat and veto fresh activation. Its citation cannot supply missing cue evidence. Record when a cue was suppressed by a boundary, an ineligible frame or a missing target citation.
3. Compare raw model judgments, applied playback decisions and boundary-only transitions independently. Cue-phase events such as onset and restart are tracked in the full typed score. Boundary scoring measures scene or beat state changes separately. Compare the two parts only when their fixture pins, arm and rubric match.
4. Re-run the four original fixtures before extending coverage to a separately cleared corpus. Check the explicit stop, false cue count, exact boundaries and unavailable rows against the frozen reference. A live fixture result does not establish story-corpus accuracy.

### Request quotas and spend

The old research routes and normal reader share a deployment-wide 100-attempt UTC day and 1,000-attempt UTC month. The reader also has a per-reader allowance. Research routes have their own suite allowances. Each reservation checks both the applicable suite or reader allowance and the shared deployment allowance. One benchmark can exhaust those counters even when it costs very little. The counters reserve requests before sending them, and a reserved request can later fail.

The fixed founder neutral diagnostic uses its own atomic allowance of 256 attempts per UTC day and 2,000 per UTC month, with a shared 256-attempt suite ceiling across its parts. Reader and older study limits are separate. Each protected submission is capped at 48 provider attempts and a conservative $0.15 reservation. This leaves room below the 50 external subrequests per invocation on Cloudflare Workers Free. A combined complete-context test has a maximum $0.30 reservation across its two parts. Estimated charges and outstanding reservations are reported separately. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

The exact compiler regression uses `scripts/replay-approved-beat-protocol.py`. Supply the frozen prior v9 labels and review inputs separately from the approved v6 output. Run the CLI with `--help` for the input and output flags. It hydrates the approved input shape with the historical replay adapter, then compares complete JavaScript profile and trace objects against the expected outputs.

## Qualification

Compare exact reviewed compiler output separately from semantic recognition. The shadow study reports usable model coverage, cue and typed-transition precision and recall, profile agreement, continuity links and causal trace violations. Compare current reader and archival provider outputs in separate lanes. For a paid paired run, hold the target roster and recent prefix fixed, use a shared run budget and stop the comparison for a refused run. Report both effective scores on every planned target and accuracy among targets both arms resolved. Compare recovered and lost matches and added false positives. Earlier eligibility evidence and earlier continuity anchors are separate strata. Verify timing and simulator behavior after model qualification.
