import tempfile
from pathlib import Path
import unittest

import numpy as np

from train import cached_encoder_features, choose_threshold, context_indices, counts, ensure_disjoint, semantic_metrics


def row(author, text, unit_hash):
    return {"author": author, "work": f"{author}-work", "excerpt": f"{author}-excerpt",
            "excerptHash": f"{author}-digest", "text": text, "unitHash": unit_hash}


class TrainingProtocolTests(unittest.TestCase):
    def test_disjoint_split_rejects_author_overlap_and_normalized_duplicates(self):
        text = "One day we will map the entire forest from the entrance to the other side."
        train = [row("first", text, "a" * 64)]
        with self.assertRaisesRegex(ValueError, "overlap on author"):
            ensure_disjoint(train, [row("first", "A different story.", "b" * 64)])
        with self.assertRaisesRegex(ValueError, "normalized paragraph"):
            ensure_disjoint(train, [row("second", text.upper().rstrip("."), "c" * 64)])

    def test_context_cannot_cross_excerpt_or_structural_heading(self):
        rows = [row("first", "First paragraph.", "a" * 64), row("first", "CHAPTER TWO", "b" * 64),
                row("first", "New chapter.", "c" * 64), row("second", "Another excerpt.", "d" * 64)]
        self.assertEqual(context_indices(rows, 2, -1), [])
        self.assertEqual(context_indices(rows, 2, 1), [])

    def test_frozen_features_are_bound_to_exact_order_and_context(self):
        rows = [row("first", "First paragraph.", "a" * 64), row("first", "A continuation.", "b" * 64)]
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "vectors.npz"
            np.savez(file, unit_hashes=np.array(["a" * 64, "b" * 64]), encoder_fingerprint="c" * 64,
                     vectors=np.array([[3., 0.], [0., 4.]]))
            fingerprint, features = cached_encoder_features(rows, file)
            self.assertEqual(fingerprint, "c" * 64)
            np.testing.assert_array_equal(features, [[1, 0, 0, 0, 0, 1], [0, 1, 1, 0, 0, 0]])
            with self.assertRaisesRegex(ValueError, "hashes must match"):
                cached_encoder_features(rows[::-1], file)

    def test_gate_abstains_on_boundary_errors_or_thin_author_support(self):
        actual = np.array([True] * 5 + [False])
        boundary = np.array([False] * 5 + [True])
        authors = np.array(["one", "one", "two", "two", "three", "three"])
        self.assertEqual(choose_threshold(actual, np.array([.9] * 5 + [.1]), boundary, authors), .9)
        self.assertIsNone(choose_threshold(actual, np.array([.9] * 6), boundary, authors))
        self.assertIsNone(choose_threshold(actual, np.array([.9] * 5 + [.1]), boundary, np.array(["one"] * 6)))

    def test_mixed_boundary_rows_are_counted_separately(self):
        report = counts(np.array([True, False]), np.array([True, True]), np.array([True, True]))
        self.assertEqual(report["boundaryPositiveRows"], 1)
        self.assertEqual(report["boundaryFalseCues"], 1)

    def test_semantic_metrics_count_unseen_holdout_classes_as_misses(self):
        report = semantic_metrics(np.array(["neutral", "flirting"]), np.array(["neutral", "neutral"]), ["neutral"])
        self.assertEqual(report["unseenLabelRows"], 1)
        self.assertEqual(report["classes"]["flirting"], {"support": 1, "correct": 0})
        self.assertAlmostEqual(report["macroF1"], 1 / 3)
