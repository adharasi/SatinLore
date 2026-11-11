# Frozen Luna development labels

This reference is the exact frozen scoring sample used by the Luna live development comparisons. It includes **181 targets across 34 sampled works**, with edition pins for **all 41 works**. The [approved annotation protocol](nocturne-approved-annotation-protocol.md) defines how to interpret the labels. The full 17,895-unit annotated workbook and original source stay in the private review materials.

| Corpus | Work pins | Sampled targets | Cue targets | Stress targets |
| --- | ---: | ---: | ---: | ---: |
| [Original corpus](nocturne-frozen-labels/o11.md) | 11 | 51 | 47 | 16 |
| [Story Dump 2](nocturne-frozen-labels/d2.md) | 10 | 18 | 18 | 6 |
| [Authored diagnostic fixtures](nocturne-frozen-labels/a20.md) | 20 | 112 | 110 | 14 |
| Total | 41 | 181 | 175 | 36 |

The parts hold the original `goldWorks` and `rosterWorks` records. Each row retains its exact source, edition and unit hashes, labels, evidence IDs and timing. The corpus order and per-work target order match the frozen input. A work with no sampled targets still retains its pin. The 36 stress targets overlap the 181 sampled targets.

## Use with VS Code agents

1. Start with the [annotation protocol](nocturne-approved-annotation-protocol.md), then open the corpus part that contains the target work ID.
2. Join a candidate by work `id`, `sourceSha256`, `editionDigest`, unit `id` and `unitSha256`. Keep the given coordinates and record absent or unavailable candidates separately.
3. Score cues only at `targetIds` and transitions at `transitionTargetIds`. Report `stressTargetIds` separately. Treat `cue: null` as unresolved. Keep the narrative description, raw candidate, applied event and playback profile distinct. Use `transitionKnownAt` when testing when a transition could first be recognized.
4. Record proposed reference corrections separately with their evidence and provenance. Preserve this frozen development sample when comparing revisions. Use independent references for release qualification.

The sampled labels contain no story prose. Source-dependent replay uses the exact local edition and its supporting review materials. Live classification requires the separately reviewed exact excerpts and context described in the [founder corpus instructions](nocturne-beat-protocol-shadow.md#founder-live-corpus-sample).

| Field | Meaning |
| --- | --- |
| `id`, `paragraph`, `structural` | Exact unit coordinate, containing paragraph and structural-row flag. |
| `depiction`, `frame`, `narrativePhase` | What the text depicts, the applicable narrative frame and the descriptive phase. |
| `phase`, `pattern`, `beatId`, `sceneId` | Reference effective phase, qualitative playback profile and associated beat and scene. |
| `transition`, `transitionKnownAt` | Frozen event at the target and the first unit that supplied sufficient event evidence. |
| `knownAt`, `evidenceIds` | When the reference playback decision was supported and the work-local evidence it cites. |
| `cue`, `protectedReference`, `hardAction` | Cue scoring outcome, scoped protection reference and hard-action flag. |
| `legacyCue`, `legacyCueKnown` | Earlier cue value and whether that value was known. |

## Full-corpus provenance

The **SatinLore Full Corpus Beat Playback Review** workbook covers all 17,895 indexed units across 41 works, including 68 structural dividers. The full approved label input has the same digest as `referenceSha256` in the frozen sample. The workbook contains review and source context. Use the separately retained local corpus inputs with the [compiler parity tool](../scripts/replay-approved-beat-protocol.py) to reproduce the full playback reference.

| Original artifact | SHA-256 |
| --- | --- |
| `SatinLore-Full-Corpus-Beat-Playback-Review-2026-11-10.xlsx` | `d50d7760d533789eaf228df9229c7c3dbdacd40ab66c57a6416818ab39de00f0` |
| Full approved v6 label input `labels.json` | `74c9388c0433cce598601bdb6a905f3b88f6348641b69b020ecedbe6fc603e1f` |
| Full compiler replay projection `approved-profile-replay.json` | `541dcf3a371782cfaeaf3edd3df5dabed90e54fdbb23eabb1b528f4d4e02e6f4` |

## Export the original JSON

Run the dependency-free exporter from the repository root. Give it a new directory path. It writes byte-for-byte copies of `separate-gold.json` and `frozen-scoring-roster.json` after checking both SHA-256 hashes.

```sh
python scripts/export-frozen-luna-benchmark.py ../frozen-luna-export
```

The JSON block below supplies the original top-level headers and expected hashes. The exporter appends `works` from the three parts in the order shown above.

```json
{
  "separate-gold.json": {
    "header": {
      "schema": "luna-v13-gold-v1",
      "seed": "satinlore-v13-excerpt-review-2026-11-10-v1",
      "sourceSha256": "974013d39fc937ed436f80681c04cfd4a31f25909a9892134d38bd0ee0c0ec7c",
      "referenceSha256": "74c9388c0433cce598601bdb6a905f3b88f6348641b69b020ecedbe6fc603e1f"
    },
    "sha256": "2218a5e851dd5621bc59cc6fbb1a4604acc09f25c9eb5919e590f6b77ce479f4"
  },
  "frozen-scoring-roster.json": {
    "header": {
      "schema": "luna-v13-review-roster-v1",
      "seed": "satinlore-v13-excerpt-review-2026-11-10-v1"
    },
    "sha256": "cfb35bda6de5259549152f931a46b420a5a99cac53f45fb04555840bebdbbd55"
  }
}
```
