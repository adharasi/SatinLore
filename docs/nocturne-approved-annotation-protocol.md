# SatinLore Approved Corpus Annotation Protocol

*Development reference for the 41-story beat playback review · 10 November 2026*

This protocol records how the approved workbook was assembled and how to review a new annotation against it. It separates source description, narrative progression, eligibility, evidence timing and qualitative playback. A neutral sentence can continue an established beat. An explicit depiction can be a recollection or belong to a protected scope. Keeping both facts visible lets the planner derive a profile while preserving the source reading.

The repository references are the [Luna shadow runner guide](nocturne-beat-protocol-shadow.md) and the [frozen development labels](nocturne-frozen-labels.md). This Markdown edition follows the [approved Word protocol](https://chatgpt.com/library?file_id=libfile_21aa5bc6cbb881918680500efeeae81c&account_id=personal), SHA-256 `850bd89f9f95b17e571204290c1fe55f87d315557e8763a4e546ebc8643ecfef`. The [VS Code handoff](nocturne-vscode-handoff.md) has the exact development inputs and replay commands.

The reference combines 11 original works, 10 works in Story Dump 2 and 20 authored fixtures. The approved replay covers 17,895 indexed units, including 17,827 nonstructural units and 68 dividers. Its inputs carry forward some earlier labels alongside targeted source-checked revisions. Treat the workbook as an approved development and regression reference. An independent holdout is needed for release qualification. The [full-corpus provenance](nocturne-frozen-labels.md#full-corpus-provenance) identifies the approved beat playback workbook.

## 1 Freeze source identity

Keep the exact work edition, work ID, story family, source hash, and ordered unit IDs. Each unit keeps its paragraph, inclusive start and exclusive end offsets, source role and SHA-256. Preserve structural rows. A formatting divider can appear inside a continuing context. A later sentence may supply the first evidence of a true scene change. Match rows by source identity before joining labels, never by similar wording or spreadsheet row number.

Keep each annotation’s source evidence and provenance. Retain source-checked decisions, continuity bridges, fixture review and inherited labels as distinct bases. Retain conflicting proposals or unavailable source as explicit review or coverage outcomes. A missing row cannot become a neutral negative or authorize playback. The current workbook preserves earlier labels for comparison. The supporting *Full story label review guide* documents those earlier labels.

## 2 Label the text and the scene independently

| Field | Vocabulary and review rule |
| --- | --- |
| Depiction | `neutral`, `romantic`, `suggestive`, `overt sexual`, `explicit`, `graphic`, `unknown`. Separate emotional closeness and implied attraction from direct desire, direct depiction and granular detail. Label the language in the unit. |
| Narrative frame | `current`, `remembered`, `reported`, `imagined`, `mixed`, `neutral`, `uncertain`. Resolve who is involved and which timeline applies. A passing thought or speaker change can remain inside the same scene. |
| Interaction | `depicted`, `mentioned`, `none`, `uncertain`. A highly descriptive reference may still mention an event. A romantic build can be one-sided or unfold across several units. |
| Phase | `quiet`, `build`, `onset`, `sustain`, `ease`, `recover`, `unknown`, plus v9 `rebuild` and `peak`. Structural units use `structural`. Choose a stable phase span from progression evidence and keep accent and restart markers separately. |

Build records increasing attention, desire, expectation, proximity or reciprocity. Onset is the first meaningful enacted step. Sustain keeps the interaction underway through compatible descriptions, dialogue and connective activity. Ease is a taper within an active beat. Recover is relevant aftermath. Rebuild requires a renewed rise after local easing in the same context. Peak requires a supported local culmination. A graphic sentence can occur without one. Quiet means the track lacks active progression. Unknown means the progression or frame is materially unclear or unavailable. The supporting *Scene phase and transition protocol v8* and *Pattern labels and block rules* expand these definitions.

### Eligibility and frame scope

Assess adulthood, consent and capacity separately for each applicable participant, activity and timeline. In an assessed ordinary adult context, coherent evidence with no material contrary signal supports a presumed-clear disposition. Stronger source evidence can support clear explicitly. An adult in one frame establishes only that person's status in the applicable timeline. Earlier consent, an unrelated refusal and a historical event each remain attached to their own scope.

Credible unresolved age, consent or capacity concerns require scoped review. Established underage involvement, coercion, refusal, withdrawal or incapacity blocks the affected interaction. A concern survives an ordinary connector, paragraph, speaker or batch boundary. Resolve it with evidence or a demonstrably separate scope. Record source availability separately. The workbook retains legacy eligibility evidence and its effective gate as different fields. Absence of a blocking event records the planner’s state, with explicit supporting facts recorded separately. Keep narrative phase even when a playback gate prevents activation.

## 3 Record transitions with two clocks

Keep the source anchor where an event happened and `knownAt`, the first unit where sufficient evidence was available. Record type, scope, effect and evidence IDs. In a retrospective review later text can clarify an earlier anchor. In causal replay a later positive cannot start a rise early. Later-established evidence about an age that already applied can inhibit an earlier span. Withdrawal and loss of capacity take effect at the first supported change. Preserve clause ordering where a unit contains more than one event. Use a conservative projection at a genuine stop where paragraph resolution cannot represent the order.

| Source evidence | Effect |
| --- | --- |
| Ordinary dialogue, brief interruption or connective activity | Retain the beat. Use `carry`, `ease` or `hold` when the text supports that specific effect. |
| Natural ending or declining a restart | Ease from the supported point. Recovery or quiet follows where supported. A new onset needs fresh evidence. |
| Memory, reported or imagined entry, or present return | Track the frame change independently. A checked frame ending can close the old carry and require a fresh cue. |
| Actual unrelated scene or chapter boundary | Close the previous scene. Use `hard-cut` where verified. Treat an isolated decorative divider as formatting. |
| Unequivocal stop or confirmed block | Apply scoped `hard-stop` and keep the narrative label. |
| Uncertain continuity or unresolved legacy event | Retain the diagnostic for review. Use bounded easing or hold where justified. |

## 4 Derive the playback profile in three passes

1. **Compile the v9 prefix.** Process units in source order. Use only evidence available at the unit and the effective phase at that time. Keep a trailing window of up to eight units in the current pattern block. At least two explicit or graphic units and a direct share of at least one third support a dense profile. Three overt-or-stronger cues or sustained suggestive buildup can also deepen a build. Use verified onset, rebuild, crest approach and culmination evidence for those distinct profiles. A short gap can carry the prior profile for up to two units at this stage. Longer gaps can taper. Real cuts clear accumulated density. Hard Stop, Reset and formatting Divider are represented explicitly.
2. **Apply reviewed reader tension.** The approved reference has 145 tension spans, including 35 marked protective. It records attention, embodied reaction, anticipation or reveal, proximity, subtext, interruption, aftermath and connector continuity. A gaze, hesitation or bodily reaction alone is weak evidence. Resolve it with the surrounding focus and available anchors. In a clear, quiet or unknown low-profile scope, verified rising tension can add Gradual build, held tension can add Undertone and an established envelope can taper as tension eases. Protective spans stay descriptive. Stronger active profiles and hard boundaries retain priority. Keep setup, await evidence and context-only rows visible. The supporting *Reader tension audit* records the reviewed spans.
3. **Apply v6 beat continuity.** Replay 203 reviewed facts covering continuation, neutral context, cuts, easing, independent low cues and reviewed span endings. A verified `priorAnchor` links a continuation to evidence already attested by the same beat. It may precede the annotation range. A reviewed span ending can ease without closing the narrative beat. An independent present low cue can open Undertone or Recovery on its own evidence unit. Neutral context, real beat or scene endings, protective gates and manual zero clear the old carry. Preserve eligible Recovery across compatible connectors even if the prior profile says Taper. Once easing begins the release deadline can shorten. A later rise needs new evidence.

The final planner uses word budgets of 12 for a stronger hold, 16 for an unconfirmed hold, 32 for an established hold, 16 for fade and 24 for the connector floor. A verified scoped continuation can preserve a low floor beyond the ordinary intensity budget. An exhausted beat can be parked and rejoined through a verified earlier anchor while its context remains valid. These are offline reference parameters. Actual rhythm, device movement, calibration and scheduling are separate. The *Beat continuity planner and verification bundle* records the approved offline checks.

## 5 Review the replay against the source

| Reference case | Expected decision |
| --- | --- |
| O11-02 unit 1745 | Hold Recovery on beat 1724 using earlier cue 1742, despite the inherited Taper. |
| D2-02 units 1436 to 1438 | Ease at the reviewed span end. Independent present evidence establishes a low beat at 1437 and carries at 1438. |
| D2-02 unit 2056 | Keep beat 2049 at Undertone using cue 2051, which precedes the reviewed continuation. |
| D2-01 units 3525 to 3534 | Preserve Divider at 3525. The new-day evidence at 3526 cuts the old scene. The separate short beat ends at 3528 and unit 3534 has fresh evidence. |
| O11-03 units 510 to 513 | Keep the protected retrospective scope quiet. Fresh present adult evidence at 512 establishes an independent low cue that can carry at 513. |

In story sheets, **K–N** show depiction, frame, interaction and phase. **E/AE/AG** show transition, effect and known-by unit. **O–T** hold prior eligibility and evidence. **AQ–AU** show block, rationale, recent counts, gate and effective phase. **BC** is phase availability. **BE–BM** show tension and frame ending. **F** is the approved profile and **BN** the prior continuity profile. **BO–BW** show scene, beat, decision, timing, evidence, hold, fade, rationale and floor. Use the Continuity annotations, Tension spans, Frame endings, Transition review and Age evidence tabs for the supporting records.

The historical v6 replay joins the frozen sources, earlier tension labels, prior scene-floor replay and review records before planning each unit. Its verifier checks source joins, causal evidence and regression controls. The replay changed 30 profiles, retained 13 confirmed carries and their beat clocks, and kept all 72 quiet and 19 ambiguous controls at Baseline. Short dips fell from 104 to 91 under the frozen audit. The count includes legitimate pauses. The workbook checks all 17,895 rows, including 817 hard profiles and 1,859 protected rows, which can overlap. Keep the historical tuning artifacts and reviewed examples as regression fixtures when evaluating Luna on a separate, sealed holdout. Run [compiler parity](../scripts/verify-approved-beat-corpus.mjs) from Git or use the [historical adapter wrapper](../scripts/replay-approved-beat-protocol.py) with the private corpus inputs.
