"""Encode private corpus paragraphs using a frozen, local-only transformer checkpoint."""

import argparse
from hashlib import file_digest, sha256
import json
import os
from pathlib import Path
import subprocess

import numpy as np

from train import REPO, read_corpus

MAX_LENGTH = 256
STRIDE = 32


def fingerprint(checkpoint, torch_version, transformers_version):
    names = {"config.json", "tokenizer.json"}
    weights = sorted(checkpoint.glob("*.safetensors"))
    if not weights or not all((checkpoint / name).is_file() for name in names):
        raise ValueError("Use a local checkpoint with config.json, tokenizer.json and safetensors weights.")
    paths = set(checkpoint.glob("*.json")) | set(weights) | set(checkpoint.glob("*.txt")) | set(checkpoint.glob("*.model"))
    digests = {}
    for path in sorted(paths):
        with path.open("rb") as stream:
            digests[path.name] = file_digest(stream, "sha256").hexdigest()
    settings = {"algorithm": "masked-mean-normalize-chunk-mean-v1", "length": MAX_LENGTH, "stride": STRIDE,
                "torch": torch_version, "transformers": transformers_version, "files": digests}
    return sha256(json.dumps(settings, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def encode(texts, tokenizer, model, torch, device, batch_size):
    rows = []
    with torch.inference_mode():
        for start in range(0, len(texts), batch_size):
            batch = texts[start:start + batch_size]
            tokens = tokenizer(batch, padding=True, truncation=True, max_length=MAX_LENGTH, stride=STRIDE,
                               return_overflowing_tokens=True, return_tensors="pt")
            owners = tokens.pop("overflow_to_sample_mapping").numpy()
            totals = np.zeros((len(batch), model.config.hidden_size), dtype=np.float64)
            for chunk in range(0, len(owners), batch_size):
                end = chunk + batch_size
                inputs = {key: value[chunk:end].to(device) for key, value in tokens.items()}
                hidden = model(**inputs).last_hidden_state.float()
                mask = inputs["attention_mask"].unsqueeze(-1)
                pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1)
                normalized = torch.nn.functional.normalize(pooled).cpu().numpy()
                np.add.at(totals, owners[chunk:end], normalized)
            # Averaging token windows and then taking the L2 norm retains a
            # contribution from the end of a long paragraph without a silent cut.
            norms = np.linalg.norm(totals, axis=1, keepdims=True)
            rows.append((totals / np.maximum(norms, 1e-12)).astype(np.float32))
    return np.concatenate(rows)


def write_cache(path, vectors, hashes, encoder_fingerprint):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            np.savez_compressed(stream, vectors=vectors, unit_hashes=np.asarray(hashes), encoder_fingerprint=encoder_fingerprint)
    except BaseException:
        path.unlink()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--split", choices=("calibration", "holdout"), required=True)
    parser.add_argument("--checkpoint", type=Path, required=True, help="Already present safetensors checkpoint directory.")
    parser.add_argument("--output", type=Path, required=True, help="New private NPZ path outside the repository.")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(REPO) or args.output.suffix != ".npz" or not 1 <= args.batch_size <= 64:
        parser.error("Choose a new NPZ path outside the repository and a batch size from 1 to 64.")
    try:
        import torch
        import transformers
    except ImportError:
        parser.error("Install PyTorch and Transformers in the separate encoder environment.")
    try:
        checkpoint = args.checkpoint.resolve(strict=True)
        encoder_fingerprint = fingerprint(checkpoint, torch.__version__, transformers.__version__)
        if args.device == "cuda" and not torch.cuda.is_available():
            parser.error("CUDA is unavailable. Choose CPU or use a CUDA-enabled environment.")
        options = {"local_files_only": True, "trust_remote_code": False}
        tokenizer = transformers.AutoTokenizer.from_pretrained(checkpoint, use_fast=True, **options)
        model = transformers.AutoModel.from_pretrained(checkpoint, use_safetensors=True, **options)
        if (not tokenizer.is_fast or model.config.model_type != "bert" or
                model.config.max_position_embeddings < MAX_LENGTH or not 1 <= model.config.hidden_size <= 2048):
            parser.error("Use a compatible fast-tokenizer BERT encoder such as MiniLM.")
        rows = read_corpus(args.manifest, args.split)["rows"]
        vectors = encode([row["text"] for row in rows], tokenizer, model.float().to(args.device).eval(),
                         torch, args.device, args.batch_size)
        if not np.isfinite(vectors).all():
            parser.error("The encoder returned nonfinite features.")
        write_cache(args.output, vectors, [row["unitHash"] for row in rows], encoder_fingerprint)
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
        parser.error("Could not load the local checkpoint or corpus, encode rows, or write a new private cache.")
    print(json.dumps({"encodedRows": len(rows), "dimensions": vectors.shape[1], "encoderFingerprint": encoder_fingerprint}))


if __name__ == "__main__":
    main()
