"""Recreate the pinned, source-free Luna sample JSON from its Markdown files."""

import argparse
import hashlib
import json
from pathlib import Path
import re


DOCS = Path(__file__).resolve().parents[1] / "docs"
PARTS = ("o11.md", "d2.md", "a20.md")
RECORDS = {
    "separate-gold.json": "goldWorks",
    "frozen-scoring-roster.json": "rosterWorks",
}


def read_record(path: Path) -> dict:
    blocks = re.findall(r"^```json\n(.*?)^```$", path.read_text(encoding="utf-8"), re.MULTILINE | re.DOTALL)
    if len(blocks) != 1:
        raise ValueError(f"Expected one JSON block in {path.name}.")
    record = json.loads(blocks[0])
    if not isinstance(record, dict):
        raise ValueError(f"Expected a JSON object in {path.name}.")
    return record


def build_exports() -> dict[str, bytes]:
    metadata = read_record(DOCS / "nocturne-frozen-labels.md")
    parts = [read_record(DOCS / "nocturne-frozen-labels" / name) for name in PARTS]
    exports = {}
    for name, key in RECORDS.items():
        header = metadata[name]["header"]
        works = [work for part in parts for work in part[key]]
        contents = (json.dumps({**header, "works": works}, indent=2) + "\n").encode("utf-8")
        if hashlib.sha256(contents).hexdigest() != metadata[name]["sha256"]:
            raise ValueError(f"Frozen checksum mismatch for {name}.")
        exports[name] = contents
    return exports


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="New directory for the two verified JSON files")
    args = parser.parse_args()
    try:
        exports = build_exports()
        args.directory.mkdir()
        for name, contents in exports.items():
            (args.directory / name).write_bytes(contents)
    except (OSError, KeyError, TypeError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Exported and verified {len(exports)} frozen JSON files.")


if __name__ == "__main__":
    main()
