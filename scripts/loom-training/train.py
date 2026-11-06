"""Train and evaluate offline recognition comparators on private, author-disjoint text."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from time import perf_counter
import unicodedata

import numpy as np
from scipy.sparse import hstack
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.preprocessing import normalize
from threadpoolctl import threadpool_limits


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FEATURES = 2**14
CONTEXT = 2
PRECISION = 0.90
MIN_CUES = 5
MIN_AUTHORS = 3
BREAK = re.compile(r"^\s*(?:chapter\b|[\s*#\-–—―=~_]{3,}$)", re.IGNORECASE)
WORD = {"analyzer": "word", "ngram_range": (1, 2), "token_pattern": r"(?u)\b\w[\w']*\b"}
CHAR = {"analyzer": "char_wb", "ngram_range": (3, 5)}


def read_corpus(path, split):
    result = subprocess.run(["node", str(HERE / "export-corpus.mjs"), str(path), split],
                            capture_output=True, check=False, timeout=90)
    if result.returncode != 0:
        raise ValueError(f"Cannot read the {split} corpus. Check the split, source digests and labels.")
    return json.loads(result.stdout)


def duplicate_keys(rows):
    keys = set()
    for row in rows:
        normalized = re.findall(r"\w+", unicodedata.normalize("NFKC", row["text"]).casefold())
        if len(normalized) >= 12:
            keys.add(" ".join(normalized))
    return keys


def ensure_disjoint(train, evaluation):
    for field in ("author", "work", "excerpt", "excerptHash"):
        if {row[field] for row in train} & {row[field] for row in evaluation}:
            raise ValueError(f"Training and evaluation overlap on {field}.")
    if duplicate_keys(train) & duplicate_keys(evaluation):
        raise ValueError("Training and evaluation share a substantial normalized paragraph.")


def context_indices(rows, i, direction):
    row = rows[i]
    if BREAK.search(row["text"]):
        return []
    result = []
    for offset in range(1, CONTEXT + 1):
        index = i + offset * direction
        if not 0 <= index < len(rows):
            break
        neighbor = rows[index]
        if neighbor["excerpt"] != row["excerpt"] or BREAK.search(neighbor["text"]):
            break
        result.append(index)
    return result


def feature_matrices(rows):
    word = HashingVectorizer(n_features=FEATURES, **WORD)
    char = HashingVectorizer(n_features=FEATURES, **CHAR)
    texts = [row["text"] for row in rows]
    current = hstack([word.transform(texts), char.transform(texts)], format="csr")
    context = []
    for direction in (-1, 1):
        contexts = ["\n".join(texts[index] for index in sorted(context_indices(rows, i, direction)))
                    for i in range(len(rows))]
        context.append(word.transform(contexts))
    return {"paragraph": current, "adjacent-paragraphs": hstack([current, *context], format="csr")}


def cached_encoder_features(rows, path):
    with np.load(path, allow_pickle=False) as data:
        vectors = data["vectors"]
        fingerprint = data["encoder_fingerprint"].item()
        if not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
            raise ValueError("Use a SHA-256 encoder fingerprint in the feature cache.")
        if not np.array_equal(data["unit_hashes"], np.array([row["unitHash"] for row in rows])):
            raise ValueError("Feature cache paragraph hashes must match the corpus in order.")
        if (vectors.ndim != 2 or vectors.shape[0] != len(rows) or not 1 <= vectors.shape[1] <= 2048 or
                vectors.dtype.kind not in "f" or not np.isfinite(vectors).all()):
            raise ValueError("Use finite, aligned floating-point feature vectors.")
        vectors = normalize(vectors.astype(np.float64))
    context = []
    for direction in (-1, 1):
        adjacent = [context_indices(rows, i, direction) for i in range(len(rows))]
        context.append(np.array([vectors[indices].mean(axis=0) if indices else np.zeros(vectors.shape[1])
                                 for indices in adjacent]))
    return fingerprint, np.column_stack([vectors, *context])


def fit(matrix, cue):
    return LogisticRegression(C=1.0, solver="liblinear", max_iter=1000, random_state=0).fit(matrix, cue)


def counts(actual, predicted, boundary):
    tp = int((actual & predicted).sum())
    fp = int((~actual & predicted).sum())
    positives = int(actual.sum())
    return {"trueCues": tp, "falseCues": fp, "positiveCues": positives,
            "missedCues": positives - tp, "boundaryFalseCues": int((boundary & ~actual & predicted).sum()),
            "boundaryCount": int(boundary.sum()), "boundaryPositiveRows": int((boundary & actual).sum()),
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / positives if positives else None}


def choose_threshold(actual, probabilities, boundary, authors):
    for threshold in np.unique(probabilities):
        predicted = probabilities >= threshold
        scored = counts(actual, predicted, boundary)
        if (predicted.sum() >= MIN_CUES and len(set(authors[actual & predicted])) >= MIN_AUTHORS and
                not scored["boundaryFalseCues"] and scored["precision"] >= PRECISION):
            return float(threshold)
    return None


def metrics(rows, scores, threshold):
    actual = np.array([row["cue"] for row in rows])
    boundary = np.array([row["boundary"] for row in rows])
    predicted = scores >= threshold if threshold is not None else np.zeros(len(rows), dtype=bool)
    categories = np.array([row["category"] for row in rows])
    return {"rows": len(rows), "authors": len({row["author"] for row in rows}),
            "averagePrecision": float(average_precision_score(actual, scores)) if actual.any() else None,
            "decision": counts(actual, predicted, boundary),
            "positiveCategories": {category: {"found": int((actual & predicted & (categories == category)).sum()),
                                               "total": int((actual & (categories == category)).sum())}
                                   for category in sorted(set(categories[actual]))}}


def train(rows, matrices, evaluation=None, evaluation_matrices=None):
    cue = np.array([row["cue"] for row in rows])
    boundary = np.array([row["boundary"] for row in rows])
    authors = np.array([row["author"] for row in rows])
    if len(set(authors)) < MIN_AUTHORS or len(set(cue)) < 2:
        raise ValueError("Training requires at least three authors and examples of both classes.")
    folds = list(LeaveOneGroupOut().split(cue, cue, authors))
    for training, validation in folds:
        if len(set(cue[training])) < 2:
            raise ValueError("Each author-excluded training fold needs examples of both classes.")
        if duplicate_keys(rows[i] for i in training) & duplicate_keys(rows[i] for i in validation):
            raise ValueError("Calibration folds share a substantial normalized paragraph.")
    report = {"rules": {"calibration": metrics(rows, np.array([row["ruleCue"] for row in rows]), .5)}}
    if evaluation is not None:
        report["rules"]["evaluation"] = metrics(evaluation, np.array([row["ruleCue"] for row in evaluation]), .5)
    weights = {}
    with threadpool_limits(limits=1):
        for name, matrix in matrices.items():
            scores = np.empty(len(rows))
            for training, validation in folds:
                model = fit(matrix[training], cue[training])
                scores[validation] = model.predict_proba(matrix[validation])[:, 1]
            threshold = choose_threshold(cue, scores, boundary, authors)
            report[name] = {"threshold": threshold, "calibration": metrics(rows, scores, threshold),
                            "exploratoryCalibrationAtHalf": metrics(rows, scores, .5)}
            model = fit(matrix, cue)
            if evaluation is not None:
                scores = model.predict_proba(evaluation_matrices[name])[:, 1]
                report[name]["evaluation"] = metrics(evaluation, scores, threshold)
                report[name]["exploratoryEvaluationAtHalf"] = metrics(evaluation, scores, .5)
            weights[name] = {"threshold": threshold, "intercept": float(model.intercept_[0]),
                             "coefficients": model.coef_[0].tolist()}
    return report, weights


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-manifest", required=True, type=Path)
    parser.add_argument("--evaluation-manifest", type=Path, help="Disjoint evaluation corpus, never used to fit or select thresholds.")
    parser.add_argument("--train-vectors", type=Path, help="Optional frozen local encoder features in a private NPZ file.")
    parser.add_argument("--evaluation-vectors", type=Path)
    parser.add_argument("--weights-out", type=Path, help="Optional new file outside the repository for numeric weights.")
    args = parser.parse_args()
    if args.weights_out and args.weights_out.resolve().is_relative_to(REPO):
        parser.error("Weights must be written outside the repository.")
    if args.evaluation_vectors and not args.evaluation_manifest or args.evaluation_manifest and (
            bool(args.train_vectors) != bool(args.evaluation_vectors)):
        parser.error("Supply both vector caches for an encoder comparison with evaluation.")
    started = perf_counter()
    try:
        calibration = read_corpus(args.train_manifest, "calibration")
        rows = calibration["rows"]
        evaluation = read_corpus(args.evaluation_manifest, "holdout")["rows"] if args.evaluation_manifest else None
        if evaluation is not None:
            ensure_disjoint(rows, evaluation)
        matrices = feature_matrices(rows)
        evaluation_matrices = feature_matrices(evaluation) if evaluation is not None else None
        fingerprint = None
        if args.train_vectors:
            fingerprint, matrices["frozen-encoder-context"] = cached_encoder_features(rows, args.train_vectors)
            if evaluation_matrices is not None:
                other, evaluation_matrices["frozen-encoder-context"] = cached_encoder_features(evaluation, args.evaluation_vectors)
                if other != fingerprint or evaluation_matrices["frozen-encoder-context"].shape[1] != matrices["frozen-encoder-context"].shape[1]:
                    raise ValueError("Both vector caches must use the same encoder and dimensions.")
        report, weights = train(rows, matrices, evaluation, evaluation_matrices)
        feature_config = {"hashDimensions": FEATURES, "contextRadius": CONTEXT, "word": WORD, "character": CHAR,
                          "encoderFingerprint": fingerprint}
        if args.weights_out:
            # x prevents replacing prior weights and gives concurrent runs separate ownership.
            with open(args.weights_out, "x", encoding="utf-8", opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
                json.dump({"version": 1, "features": feature_config, "models": weights}, file, allow_nan=False)
    except ValueError as error:
        parser.error(str(error))
    except (OSError, KeyError, subprocess.TimeoutExpired):
        parser.error("Could not load the offline inputs or write a new private weight file.")
    print(json.dumps({"analysisVersion": calibration["analysisVersion"], "features": feature_config,
                      "thresholdSelection": {"precision": PRECISION, "minimumCues": MIN_CUES,
                                             "minimumCorrectAuthors": MIN_AUTHORS, "boundaryFalseCues": 0},
                      "calibrationProtocol": "leave one author out; threshold selected on combined calibration predictions",
                      "evaluationProtocol": "untuned disjoint comparison; prior runs may have opened the corpus",
                      "elapsedSeconds": round(perf_counter() - started, 3), "results": report}, indent=2))


if __name__ == "__main__":
    main()
