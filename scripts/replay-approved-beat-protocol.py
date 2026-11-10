"""Check exact JS parity against the approved offline corpus without publishing its source."""

from argparse import ArgumentParser
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import NamedTemporaryFile


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "scripts/lib/replay-approved-beat-protocol.mjs"
SCHEMA = "satinlore-approved-beat-inputs-v1"
SOURCE_KEYS = {"text", "sourceText", "paragraphText", "excerpt"}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_adapter(path):
    spec = spec_from_file_location("approved_replay_adapter", path)
    if not spec or not spec.loader:
        raise ValueError("Expected a local v6 replay.py adapter.")
    adapter = module_from_spec(spec)
    sys.path.insert(0, str(path.resolve().parent))
    try:
        spec.loader.exec_module(adapter)
    finally:
        sys.path.pop(0)
    return adapter


def works_by_id(data):
    works = {work["id"].upper(): work for work in data["works"]}
    if len(works) != len(data["works"]):
        raise ValueError("Corpus contains duplicate story identifiers.")
    return works


def contains_source_key(value):
    if isinstance(value, dict):
        return bool(SOURCE_KEYS.intersection(value)) or any(map(contains_source_key, value.values()))
    if isinstance(value, list):
        return any(map(contains_source_key, value))
    return False


def oracle_inputs(adapter, labels, sources, annotations, requested):
    baseline = works_by_id(labels)
    source = works_by_id(sources)
    selected = [story for story in baseline if not requested or story in requested]
    if not selected or requested and set(selected) != requested:
        raise ValueError("Story selection does not match the prior labels.")
    boundaries, review = adapter.indexes(labels, annotations)
    protected = {span["span"] for span in labels["tensionSpans"] if span.get("risk")}
    stories = []
    for story in selected:
        old_work, source_work = baseline[story], source.get(story)
        if not source_work or old_work["sourceSha256"] != source_work["sourceSha256"]:
            raise ValueError(f"Source hash mismatch in {story}.")
        if any("continuity" in unit for unit in old_work["units"]):
            raise ValueError("Input labels must precede v6 planning.")
        units = list(adapter.inputs(story, old_work["units"], source_work["units"], boundaries, review, protected))
        if not units or contains_source_key(units):
            raise ValueError(f"Unsafe or empty normalized inputs in {story}.")
        stories.append(dict(story=story, units=units))
    return dict(schema=SCHEMA, stories=stories), baseline


def first_difference(expected, actual, path=""):
    if type(expected) != type(actual):
        return path or "/"
    if isinstance(expected, dict):
        if expected.keys() != actual.keys():
            return path or "/"
        for key, value in expected.items():
            difference = first_difference(value, actual[key], f"{path}/{key}")
            if difference is not None:
                return difference
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            return path or "/"
        for index, (left, right) in enumerate(zip(expected, actual, strict=True)):
            difference = first_difference(left, right, f"{path}/{index}")
            if difference is not None:
                return difference
    elif expected != actual:
        return path or "/"
    return None


def compare_outputs(payload, baseline, reference, outputs):
    approved = works_by_id(reference)
    report = dict(stories=0, units=0, profilesMatched=0, tracesMatched=0, mismatches=[])
    candidates = []
    for planned, output in zip(payload["stories"], outputs, strict=True):
        story = planned["story"]
        if output["story"] != story:
            raise ValueError("Planner output changed the input story order.")
        source_work, expected_work = baseline[story], approved.get(story)
        if not expected_work or expected_work["sourceSha256"] != source_work["sourceSha256"]:
            raise ValueError(f"Approved source hash mismatch in {story}.")
        rows = []
        for old, expected, (profile, trace) in zip(source_work["units"], expected_work["units"], output["rows"], strict=True):
            if old["id"] != expected["id"] or old["unitSha256"] != expected["unitSha256"]:
                raise ValueError(f"Approved unit hash or identity mismatch in {story}.")
            for key, left, right in (("profilesMatched", expected["v9Pattern"], profile),
                                      ("tracesMatched", expected["continuity"], trace)):
                difference = first_difference(left, right)
                report[key] += difference is None
                if difference is not None and len(report["mismatches"]) < 20:
                    report["mismatches"].append(dict(story=story, unit=old["id"], field=key, path=difference))
            rows.append(dict(id=old["id"], unitSha256=old["unitSha256"], pattern=profile["pattern"],
                             beatId=trace["beat"], sceneId=trace["scene"], knownAt=trace["knownAt"],
                             evidenceIds=trace["evidence"], phase=profile["phase_used"]))
        candidates.append(dict(id=source_work["id"], sourceSha256=source_work["sourceSha256"], units=rows))
        report["stories"] += 1
        report["units"] += len(rows)
    report["exactMatch"] = report["profilesMatched"] == report["tracesMatched"] == report["units"]
    return report, dict(works=candidates)


def write_private(path, data):
    path = path.resolve()
    if path.is_relative_to(ROOT):
        raise ValueError("Write oracle outputs outside the repository.")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temp:
        try:
            json.dump(data, temp, ensure_ascii=False, separators=(",", ":"))
            temp.write("\n")
            temp.close()
            os.replace(temp.name, path)
        finally:
            Path(temp.name).unlink(missing_ok=True)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", type=Path, required=True, help="Path to the private v6 replay.py adapter")
    parser.add_argument("--labels", type=Path, required=True, help="Prior v9 tension labels, before v6 planning")
    parser.add_argument("--source", type=Path, required=True, help="Private source unit index")
    parser.add_argument("--annotations", type=Path, nargs="+", required=True, help="Reviewed annotation lists in replay order")
    parser.add_argument("--expected", type=Path, help="Approved v6 labels for exact profile and trace comparison")
    parser.add_argument("--story", action="append", help="Restrict to this story ID. Repeat for multiple stories.")
    parser.add_argument("--normalized-output", type=Path, help="Optional private normalized planner inputs")
    parser.add_argument("--candidate-output", type=Path, help="Optional private source-free evaluation candidate")
    parser.add_argument("--report-output", type=Path, help="Optional private exact parity report")
    args = parser.parse_args()
    if not args.expected and (not args.normalized_output or args.candidate_output or args.report_output):
        parser.error("Provide --expected for parity, or --normalized-output to prepare inputs only.")

    inputs = [args.adapter, args.labels, args.source, *args.annotations]
    if args.expected:
        inputs.append(args.expected)
    outputs = [path.resolve() for path in (args.normalized_output, args.candidate_output, args.report_output) if path]
    if len(set(outputs)) != len(outputs) or set(outputs).intersection(path.resolve() for path in inputs):
        parser.error("Outputs must be distinct from each other and from the inputs.")
    if any(path.is_relative_to(ROOT) for path in outputs):
        parser.error("Write oracle outputs outside the repository.")

    annotations = [row for path in args.annotations for row in load(path)]
    payload, baseline = oracle_inputs(load_adapter(args.adapter), load(args.labels), load(args.source),
                                     annotations, {story.upper() for story in args.story or []})
    if args.normalized_output:
        write_private(args.normalized_output, payload)
    if not args.expected:
        print(json.dumps(dict(stories=len(payload["stories"]), units=sum(len(s["units"]) for s in payload["stories"]))))
        return 0

    reference = load(args.expected)
    if not args.story and set(works_by_id(reference)) != set(baseline):
        raise ValueError("Approved output and prior labels do not cover the same story set.")
    run = subprocess.run(["node", str(BRIDGE)], input=json.dumps(payload, ensure_ascii=False),
                         text=True, encoding="utf-8", capture_output=True)
    if run.returncode:
        raise ValueError("The JavaScript planner could not replay the normalized approved inputs.")
    report, candidate = compare_outputs(payload, baseline, reference, json.loads(run.stdout))
    if args.report_output:
        write_private(args.report_output, report)
    if args.candidate_output and report["exactMatch"]:
        write_private(args.candidate_output, candidate)
    print(json.dumps(report))
    return 0 if report["exactMatch"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, KeyError, TypeError, AssertionError, json.JSONDecodeError):
        sys.exit("The private oracle inputs could not be read or validated.")
    except ValueError as error:
        sys.exit(str(error))
