# Manuscript playback benchmark

Run from the repository root with Node 24.

```sh
node scripts/evaluate-reader-corpus.mjs
node scripts/evaluate-reader-corpus.mjs /path/to/local/manifest.json
```

The offline benchmark reads exact, pinned passages and editorial annotations. It runs the current reader and real Lush simulator controller at a 10/20 maximum with scene rhythm enabled. Each section starts independently and is sampled at 0, 2, 4, 6 and 8 seconds. Both Loom and Nocturne local patterns are sampled. The harness verifies that Start is explicit, each nonzero command is finite and bounded, and pause clears the simulator and prevents another command. It sends zero network requests and prints paragraph ordinals, phases and numeric traces. Story text, notes, rights evidence and file paths stay out of results.

- **Active recall** counts intended movement beats where the simulated Lush vibrated. **Active precision** counts how many simulated active beats were intended to move.
- **False activations** count quiet sections where the Lush vibrated. **Quiet boundaries** isolate known stops, withdrawals and setting changes.
- **Continuity** counts intended contact that persists across narration or dialogue and received a nonzero trace. This measures inherited scene analysis at those sections. It starts the simulator fresh at each section, so scroll transition behavior is covered separately by the browser checks.
- **Silent passages** count excerpts with at least one intended active beat where every sampled section stayed still. **Variable active sections** indicate waveform variation without assigning a preference score.
- **Phase** reports exact label agreement and per-phase counts. **Hosted rhythm candidates** measure eligibility. This run leaves Nocturne's hosted timing provider disabled.

## Seed corpus

[Manifest and excerpts](../tests/fixtures/reader-corpus/manifest.json) contain 113 paragraph annotations across seven consecutive excerpts from five authors. The calibration set contains 54 paragraphs across Austen, Gaskell and Lawrence. Wharton and Chopin's 59 paragraphs are held out by author and work. Each passage was annotated in one editorial pass before its first score run. A second independent annotation is still pending.

| Work | Excerpts | Coverage |
| --- | --- | --- |
| Jane Austen, *Persuasion* | Chapter 23 | Affectionate conversation and a reunion without clear present contact. [Edition](https://standardebooks.org/ebooks/jane-austen/persuasion) |
| Elizabeth Gaskell, *North and South* | Chapter 52 | Indirectly described embrace, intervening dialogue and attention turning elsewhere. [Edition](https://standardebooks.org/ebooks/elizabeth-gaskell/north-and-south) |
| D. H. Lawrence, *Lady Chatterley’s Lover* | Chapters 3 and 16 | Non-graphic passages contrasting a request for affection, present contact and departures. [Edition](https://standardebooks.org/ebooks/d-h-lawrence/lady-chatterleys-lover) |
| Edith Wharton, *The Age of Innocence* | Chapters 15 and 16 | Imagined embrace, an alarmed reaction, present contact and withdrawal. [Edition](https://standardebooks.org/ebooks/edith-wharton/the-age-of-innocence) |
| Kate Chopin, *The Awakening* | Chapter 36 | Reciprocal contact, sustained dialogue, an interruption and a stronger farewell. [Edition](https://standardebooks.org/ebooks/kate-chopin/the-awakening) |

The manifest pins the Standard Ebooks source commit and edition license for each excerpt, identifies its exact source paragraph range and records public-domain evidence. Only the work's paragraph text is included. The underlying English works are recorded as public domain in the US. Their authors died between 1817 and 1937, beyond the ordinary UK 70-year term for these original texts. The edition's producers dedicate their editorial contributions under CC0. Review any new edition, translation and territory separately. [UK copyright duration](https://www.gov.uk/copyright/how-long-copyright-lasts) · [CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/)

## Version comparison

The same fixtures and trace settings were run against production commit `7fa385c` (v6.1), the initial v6.2 revision, and the release candidate. Loom and local Nocturne had the same activation results. The first v6.2 pass was frozen before reviewing the held-out failures. The final column shows an exploratory follow-up after inspecting those failures.

| Lush simulator result | Calibration v6.1 → release | Holdout v6.1 → first v6.2 | Held-out authors after review |
| --- | ---: | ---: | ---: |
| Intended active beats detected | 0/10 → 9/10 | 0/23 → 0/23 | 1/23 |
| False activations in quiet beats | 0/44 → 0/44 | 0/36 → 0/36 | 0/36 |
| Context-dependent active beats detected | 0/5 → 5/5 | 0/16 → 0/16 | 0/16 |
| Correctly quiet at marked boundaries | 4/4 → 4/4 | 7/7 → 7/7 | 7/7 |
| Exact phase | 44/54 → 53/54 | 36/59 → 36/59 | 37/59 |
| Intended-active excerpts that stayed silent | 3/3 → 1/3 | 2/2 → 2/2 | 1/2 |

The new rules detected Gaskell's sustained embrace and Lawrence's reciprocal parting embrace. The isolated affectionate hand kiss in Lawrence stayed quiet. The first v6.2 pass missed both held-out active excerpts. The follow-up picked up the start of Chopin's scene after expanding recognition of contact in ordinary language. It still misses the extended contact across dialogue and Wharton's mixed kiss-and-withdrawal paragraph. Most of the holdout positives come from one contiguous scene. Keep these cases as regressions, add a fresh author holdout, and test finer-grained boundaries and longer-range continuity there.

## Adding author-licensed work

1. Obtain the work from the rights holder and record the scope and term of permission. Start with offline commercial evaluation. Record separate permissions before redistributing excerpts, using them for training or sending raw text to a hosted provider. Keep private agreements and manuscripts outside Git. Literotica's terms restrict copying and LLM interaction with its published content, so its site is excluded from this corpus. [Literotica terms, section 16](https://www.literotica.com/resources/tos)
2. Select consecutive passages with enough lead-in and aftermath to test context. Include contemporary dialogue, euphemisms, uneven paragraph lengths, a long quiet opening, clear reciprocal contact, competing actions, memories, negation, explicit stops and unambiguous scene changes. Include multiple styles and narrators, plus truly quiet or ambiguous contrast examples. Set aside entire authors and series before tuning. Near duplicates belong in a single split.
3. Copy the version 1 manifest shape and place each passage in its own UTF-8 `<id>.txt` next to the manifest. Give each an author and work ID, exact source location, paragraph range, language, theme and rights record. Preserve paragraph breaks and use the SHA-256 digest of the UTF-8 text with LF line endings. Add `offline-evaluation` to `rights.allowedUses` once authorized, and `repository-redistribution` only where the permission covers it. The evaluator checks that the record is present, while the reviewer verifies the underlying rights.
4. Have two readers independently label each paragraph's expected beat before showing them the predictions. Use **quiet** for no current grounded contact, uncertainty, reported events or a stop, **build** for an opening or intensifying beat, **sustain** for ongoing contact, **peak** for a clearly established crest, and **recover** for a continued but easing beat. Mark context-dependent activation as `continuation` and a decisive quiet transition as `boundary`. Preserve disagreements and adjudicate before comparing models. Label narrative evidence separately from tester preferences and desired playback feel.
5. Compare each change on calibration, then run the frozen holdout for the release check. Review false ons and silent passages individually, especially at a boundary. Report recall and quiet errors separately so long quiet openings cannot inflate the headline. The next useful milestone is permission-cleared contemporary prose with independent annotations and enough active beats from held-out authors to compare styles and rhythms. Model selection and device motion are separate from personal preference, which requires voluntary, separately consented hardware testing.

This seed is an authentic regression suite for historical English prose. It has one annotated peak and few examples of strongly changing intensity. The [neutral model evaluation](reader-model-evaluation.md) complements it with known multi-movement and rhythm fixtures. Physical response and personal preferences require separate testing.
