# Nocturne Luna in VS Code

The baseline for the next development pass is **Luna rubric v47**, shipped at [`dd6ebf80c867`](https://github.com/adharasi/SatinLore/commit/dd6ebf80c86790a07fd26efbb73e5d59999458d7). The latest fresh provider measurement used [v46 at `bdf22efa6d01`](https://github.com/adharasi/SatinLore/commit/bdf22efa6d0110b56cde022190fbcdf0a81d271a). The founder tool is a diagnostic. The ordinary reader and physical-device scope have their own release checks.

## What to open

| Input | Location and coverage |
| --- | --- |
| Approved annotation protocol | [Repository Markdown](nocturne-approved-annotation-protocol.md) and the [approved Word original](https://chatgpt.com/library?file_id=libfile_21aa5bc6cbb881918680500efeeae81c&account_id=personal). |
| Frozen scoring dataset | [Label index and exporter](nocturne-frozen-labels.md). 181 targets across 34 sampled works, with exact edition and source pins for all 41. The roster includes 175 cue targets, 181 typed-transition targets and 36 overlapping stress targets. |
| All 41 works for deterministic replay | [Approved compiler manifest](../benchmarks/nocturne/approved-compiler/manifest.json). 11 original works, 10 from Story Dump 2 and 20 authored diagnostics. The compiled inputs and expected profile/trace digests cover 17,895 indexed units including 68 dividers. |
| Exact story editions, full labels and saved live responses | [Private development inputs ZIP](https://chatgpt.com/library?file_id=libfile_fde3_f-598782370da48191926782a6adbb7a09_53ee4825875c819186e32fc92e31a459&account_id=personal). The archive contains all 41 canonical story editions, the full historical annotation and replay inputs, and all seven v46 excerpt packets and receipts. See setup below. |
| Full annotated workbook | [Approved beat playback review](https://chatgpt.com/library?file_id=libfile_4f87a6edbbe881919fd5d0d26c6ac&account_id=personal). The [protocol](nocturne-approved-annotation-protocol.md#5-review-the-replay-against-the-source) identifies the columns and review sheets. |
| What failed and what shipped | [Current discrepancy closure](nocturne-discrepancy-closure.md), [181-target discrepancy ledger](nocturne-discrepancy-ledger.md), [shadow runner and version history](nocturne-beat-protocol-shadow.md), [v47 benchmark evidence](../benchmarks/nocturne/v47/) and [release qualification](nocturne-release-qualification.md). |

## Local setup

Open the SatinLore checkout root in VS Code and sign in to the [Codex extension](https://learn.chatgpt.com/docs/codex/ide). Use local agent execution so terminal commands run in the same checkout. Give any coding agent the prompt below. Select [GPT-6 Astra](https://learn.chatgpt.com/docs/models) at High reasoning if available. GPT-6.1 Sol at High is a good choice for longer iterative work or limited credits. These are coding agent settings. The runtime study continues to use GPT-6 Luna through the existing adapter.

Install Python 3.12+ and Node.js 24. From the repository root on `main`, run the commands in order. On macOS or Linux, use `python3` in place of `py`.

```powershell
git pull --ff-only origin main
npm ci --ignore-scripts
py bootstrap.py
py scripts/export-frozen-luna-benchmark.py ../satinlore-frozen-v47
node scripts/verify-approved-beat-corpus.mjs
py scripts/check.py
npm run build:worker
```

The exporter uses a new output directory. The compiler check needs only the checkout and Node. It should report 41 works and all 17,895 profiles and causal traces matching. The tracked fixtures carry compiler inputs without story text and hash free-form diagnostic reasons. Failures identify the work and the affected block of up to 128 units. Segmentation, effective cue recall, provider live behavior and physical-device operation each need their own evidence.

For original text, alternate prefixes, source-to-compiler parity or saved-answer replay, download the private ZIP above and extract its contents into the ignored `data/nocturne/` directory. The path from the checkout root should be `data/nocturne/exact-41-editions-private.json`. On Windows, for example:

```powershell
$archive = "$env:USERPROFILE/Downloads/SatinLore-Nocturne-Private-Development-Inputs-v1.zip"
Get-FileHash -Algorithm SHA256 $archive
Expand-Archive -LiteralPath $archive -DestinationPath data/nocturne
node scripts/verify-nocturne-corpus.mjs
git check-ignore data/nocturne/exact-41-editions-private.json
```

The ZIP SHA-256 is `fe8d833a8a63c7f16533ff439c721db650b09d93a336334520bed3aed46c7f3c`. The verifier checks the exact edition archive entry, all 41 work and edition pins, the 181 target unit pins and full reader segmentation. It should report 41 works, 17,895 units, 68 dividers and 181 frozen targets. The ZIP manifest pins every file. A different location can be passed with `--editions`. Keep source, annotations containing source, excerpt packets, receipts and credentials outside tracked Git; use IDs, hashes and typed findings in tracked evidence. Use a current, explicit authorisation for the exact clips, destination and spend before any fresh provider dispatch. The prior authorisation covered the completed v46 panels.

### Reproduce the historical adapter comparison

From the checkout root, run this command after extraction. It reads the full approved labels and the earlier reviewed inputs, and must return the same 17,895 exact profile and trace matches. Results, if requested with output flags, go outside the checkout.

```powershell
py scripts/replay-approved-beat-protocol.py --adapter data/nocturne/approved/v6-impl/replay.py --labels data/nocturne/approved/tension-apply/labels.json --source data/nocturne/approved/full-corpus-source-private.json --annotations data/nocturne/approved/scene-fix/annotations.json data/nocturne/approved/scene-fix/tail-controls.json data/nocturne/approved/v4-scope/d2-01.json data/nocturne/approved/v4-scope/d2-other.json data/nocturne/approved/v4-scope/o11.json data/nocturne/approved/v6-impl/continuity-review.json --expected data/nocturne/approved/v6-impl/labels.json
```

### Replay identical saved answers

After exporting the frozen sample and extracting the archive, create a baseline worktree at v46. Run the comparison once per packet you need, swapping the panel filename in both paths. Send output to a local directory outside the checkout if you want to keep it. The script replays saved facts locally with zero provider calls.

```powershell
git worktree add --detach ../satinlore-v46 bdf22efa6d0110b56cde022190fbcdf0a81d271a
node scripts/replay-luna-corpus-receipt.mjs --packet data/nocturne/live/v46/packets/breadth-1.json --receipt data/nocturne/live/v46/receipts/breadth-1.json --baseline ../satinlore-v46 --candidate . --reference ../satinlore-frozen-v47/separate-gold.json --roster ../satinlore-frozen-v47/frozen-scoring-roster.json --simulator
```

The [projected v46 live results](../benchmarks/nocturne/v47/v46-live-score-summary.json) pin each packet and receipt. Pass those digests using `--packet-sha256` and `--receipt-sha256` when validating an archived comparison. The [per-story offline results](../benchmarks/nocturne/v47/full-offline-per-story.csv) record reference and Loom/fallback results on the full corpus.

Across the seven panels, v46 reconstructed all 26 observations. V47 replayed 24 with the same answers. The two `o11-04` observations share a newly requested objective response missing from the v46 receipt. The v46 hosted run cost an estimated settled US$0.061706 across 154 requests. Exact profile agreement on matched observations moved from 9/24 in v44 to 7/24 in v46. Applied events moved from 15/24 to 16/24, typed events from 14/24 to 17/24 and judged cue agreement from 18/21 to 19/21. The four repeated waveform observations matched profiles 0/4. These results leave fresh v47 recognition and the independent 90% cue recall gate open. [Current findings](nocturne-discrepancy-closure.md)

## Next acceptance checks

| Target | First test | Pass evidence |
| --- | --- | --- |
| `a20-03:12` | Compare authored units 2–14 (targets 12 and 14) with the existing 8–14 and 11–14 arms. Consider units 0–14 if unit 2 lacks context. Keep the old-place witness blind to 12 and all decision inputs causal. | Ground the earlier place and first arrival independently. If corroborated, require one applied cut at 12, zero target and output in 9/9 conditions, new scene at 13 and no duplicate cut at 14. Match same place, proposed destination, intermediate frame or barrier, missing history and Stop controls. |
| `o11-04:224` | Test the v47 blind objective question with matching, same-episode and unavailable evidence. Review the disputed Taper location separately. | Keep candidate request, model judgment and applied event traceable. An independently verified cut clears the old scene and is zero in 9/9. |
| `a20-04:14`, `a20-17:12` | Keep short/wide/breadth day-heading controls and the dawn control in regression. Repeat the deployed rubric where specifically approved. | The wide heading arm cuts and short arms clear the beat with unresolved lineage when earlier context is absent. All stop output. The verified dawn cut persists at 13 without a duplicate. Track disagreement with the frozen profile separately. |
| `d2-02:1550`, `a20-18:15–16` | Compare both waveform repeats and change one witness at a time. Keep wrong action, wrong scope, expired carry, cut and Stop controls. | An established release retains the earlier clock and finite envelope. A fresh onset or ease needs exact contemporaneous support. Report repeat agreement and distinguish missing earlier evidence from an arbitration or renderer fault. |

## Copy into your coding agent

```text
Work locally in my adharasi/SatinLore checkout. Continue the Nocturne Luna discrepancy work from the v47 baseline (dd6ebf80c86790a07fd26efbb73e5d59999458d7) toward an independently validated reading and playback algorithm. Diagnose the failures, implement evidence-backed fixes, verify them and update the repository docs. Use the latest main and preserve any local work already present.

Read AGENTS.md, docs/nocturne-vscode-handoff.md, the approved annotation protocol, frozen label index, 181-target discrepancy ledger, current discrepancy closure and release qualification. Export the frozen scoring JSON and reproduce the 41-work compiler check before editing. If the private ZIP is installed under data/nocturne/, verify the exact editions and run the v46-to-current saved-answer comparison. If it is absent, carry on with the tracked compiler corpus, neutral fixtures and recorded evidence. Report which source-dependent checks still need the ZIP.

Map each failure to the first failing layer: source identity or coverage, request selection, provider recognition or abstention, evidence validation, compiler arbitration, scene or beat timing, or simulator playback. Record exact case IDs, inputs or hashes, provenance, denominator, prior behavior, proposed repair, acceptance case and negative controls. Keep frozen labels and roster fixed. Record possible reference corrections separately for blinded adjudication. Preserve all withheld, refused, invalid, clipped, unconfirmed and unscored cases with their real disposition.

First prioritize the A20-03 earlier venue/arrival test and the missing independent O11-04 objective check. Use the exact prefix widths and acceptance cases in the handoff. Preserve the v47 day-heading and dawn controls. Isolate the D2-02 release clock and the A20-18 continuity and interruption variability with matched repeats and single-condition controls. Address further ledger rows with the same approach and keep a reviewable issue-to-test trail. Implement only generally supported rules; avoid story-ID branches, one-off phrase tuning, benchmark leakage, and relaxed evidence gates.

Run fixed-answer replays before requesting new provider evidence. Compare raw cues and typed events, applied events, phase, profile, scene and beat lineage, evidence clock, envelope and actual simulator commands. Check 120, 240 and 420 WPM at ceilings 10, 1 and 0, including at adjudicated hard targets the compiler misses. Preserve zero output at verified hard boundaries and all existing Stop, pause, ceiling, expiry, cancellation and protected-scope rules. Keep simulator and physical-device claims separate.

Use the existing runtime model, bounded founder route and private credential handling. Fresh provider requests require current authorisation for the exact reviewed clips, Worker-to-OpenAI destination and spend cap. Process private inputs with local commands that emit IDs, hashes and typed facts. Keep raw stories, private annotations, packets and credentials out of Git, model prompts and tool output sent to agent or provider services. If live authorisation or another prerequisite is missing, finish the local implementation and verification and give me the exact proposed run and what it would settle.

Run the common checks, Worker build and relevant regressions. Update the discrepancy ledger and roadmap with evidence, before/after metrics, open cases and the next experiment. Report what replay proved, what a fresh run measured and what remains unknown. Treat the 41-work set as development. Release requires the predeclared author- and series-disjoint 1,000-work protocol, including the 90% cue recall, 92% precision, transition, coverage and zero-violation gates. Commit verified code and documentation. Direct pushes to main are authorised for verified changes in this task; use normal fast-forward Git operations and report the SHA.
```
