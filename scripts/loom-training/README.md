# Offline Loom recognition training

This experiment measures recognition independently of playback. The CPU comparators fit a linear cue head with hashed word and character features. The contextual arm adds separate word features from up to two earlier and two later paragraphs. It never looks across an excerpt or a visible structural break. An optional frozen local encoder can supply a contextual feature matrix for the same training and evaluation protocol. The learned scores are experimental and have no playback authority.

Run with Node.js and a Python lab environment containing NumPy, SciPy and scikit-learn. The experiment adds no application dependency. It makes no network calls.

```sh
python3 scripts/loom-training/train.py \
  --train-manifest /private/calibration.json \
  --evaluation-manifest /private/holdout.json

python3 -m unittest discover -s scripts/loom-training
```

The trainer accepts the version 1 work/excerpt corpus format with `calibration` works in the first manifest and `holdout` works in the second. Its private subprocess checks source digests and aligns labels with the app's exact reader paragraphs. Training and evaluation reject shared author, work, excerpt, digest and substantial normalized paragraph matches. Author IDs must identify authors consistently across editions. Independently check related series, aliases and near duplicates when assembling the corpora.

For each learned arm, leave one author out on calibration and select the lowest threshold with at least 90% observed precision, zero false boundary cues, five predicted cues and correct cues from at least three authors. Keep the threshold fixed for evaluation. A missing threshold means the arm abstains at this operating point. The report also includes ranking average precision and a fixed 0.5 exploratory comparator. Paragraphs annotated with both a true cue and a boundary are counted separately. Their timing needs sentence-level evaluation. Threshold selection on calibration makes its threshold-level results development evidence. Use genuinely unopened text for promotion testing.

The public command emits aggregate scores only. `export-corpus.mjs` is an internal captured subprocess protocol containing private reader text. Use the trainer entry point. `--weights-out /private/weights.json` optionally creates a new numeric experiment artifact outside the repository without a token vocabulary or text. Keep learned weights private while their provenance and generalisation are under evaluation.

Add `--semantic-heads` to fit separate category, narrative-frame and phase heads from the full paragraph labels. These share the adjacent-paragraph or supplied frozen-encoder feature matrix and use the same author-separated folds. The report counts class support, macro-F1 and unseen-label rows. Optional numeric export includes these heads. The existing cue gate is scored independently. A topical phase attached to a remembered or reported event does not grant a playback cue.

For a frozen encoder comparison, pass `--train-vectors` and `--evaluation-vectors` with separate local NPZ files. Each cache needs a two-dimensional float `vectors` array, `unit_hashes` containing the reader paragraph SHA-256 digests in exact manifest order, and a scalar `encoder_fingerprint` with a 64-character lowercase SHA-256 digest covering the encoder and preprocessing. Pin the same frozen encoder and dimensions in both caches. The experiment L2 normalizes each paragraph vector, then combines it with mean vectors on either side. It fits only the linear cue head and does not fine-tune the encoder. Keep cache creation offline and avoid fitting the encoder on evaluation text.

`encode.py` creates the caches from an already present fast-tokenizer BERT checkpoint with safetensors weights. Use the same Python environment with PyTorch and Transformers for both splits. The encoder reads locally, disables remote model code and fingerprints the checkpoint files and preprocessing. Long paragraphs use overlapping token windows. Keep the cache private and outside the repository.

```sh
python3 scripts/loom-training/encode.py --manifest /private/calibration.json \
  --split calibration --checkpoint /private/minilm --output /private/calibration.npz
python3 scripts/loom-training/encode.py --manifest /private/holdout.json \
  --split holdout --checkpoint /private/minilm --output /private/holdout.npz
python3 scripts/loom-training/train.py --train-manifest /private/calibration.json \
  --evaluation-manifest /private/holdout.json --train-vectors /private/calibration.npz \
  --evaluation-vectors /private/holdout.npz
```
