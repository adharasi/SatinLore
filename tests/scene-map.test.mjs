import assert from "node:assert/strict";
import test from "node:test";
import {buildSceneUnits, compileSceneMap, validateSceneMap} from "../app/static/reader/scene-map.mjs";

const beat = (first, last, phase, category, emphasis, evidence = [first]) =>
  ({first, last, phase, category, emphasis, evidence});
const scene = (first, last, frame, beats = []) => ({first, last, frame, beats});

test("sentence units retain original UTF-16 offsets and isolate structural markers", () => {
  const paragraphs = ["  🧭 The train arrived. “Here we are!” They waved.  ", "A key was missing.\n***\nLater it turned up.",
    "Chapter IV: The departure\nThey left."];
  const units = buildSceneUnits(paragraphs.map(text => ({text})));
  assert.deepEqual(buildSceneUnits(paragraphs), units);
  assert.deepEqual(units.map(({id, paragraph, structuralBoundary}) => [id, paragraph, structuralBoundary]), [
    [0, 0, false], [1, 0, false], [2, 0, false], [3, 1, false], [4, 1, true], [5, 1, false], [6, 2, true], [7, 2, false],
  ]);
  assert.equal(units[0].start, 2);
  assert.equal(units[1].text, "“Here we are!”");
  for (const unit of units) assert.equal(paragraphs[unit.paragraph].slice(unit.start, unit.end), unit.text);
  assert.throws(() => buildSceneUnits(["é".repeat(250_001)]), /Invalid scene source units/);
});

test("scene validation accepts a detached sparse map and rejects missing anchors or boundaries inside scenes", () => {
  const all = buildSceneUnits(["A cup sat on a desk. She smiled. They left.", "***", "Another day began."]);
  const units = all.filter(unit => unit.id !== 1);
  const map = {scenes: [scene(0, 0, "neutral"), scene(2, 2, "current", [beat(2, 2, "build", "romance", 1)]),
    scene(3, 3, "neutral", [beat(3, 3, "boundary", "neutral", 0)])]};
  const validated = validateSceneMap(map, units);
  assert.deepEqual(validated, map);
  validated.scenes[1].beats[0].evidence.push(3);
  assert.deepEqual(map.scenes[1].beats[0].evidence, [2]);
  for (const scenes of [[scene(0, 2, "neutral")], [scene(2, 4, "neutral")], [scene(3, 3, "current")],
    [scene(2, 2, "current"), scene(2, 2, "neutral")], Array(1)]) {
    assert.throws(() => validateSceneMap({scenes}, units), /Invalid scene map/);
  }
  assert.throws(() => validateSceneMap({scenes: []}, [units[1], units[0]]), /Invalid scene source units/);
  assert.throws(() => validateSceneMap({scenes: []}, [{...units[0], end: units[0].end + 1}]), /Invalid scene source units/);
});

test("scene maps reject unknown keys, invalid evidence, overlaps and active noncurrent beats", () => {
  const units = buildSceneUnits(["It grew dark. She waited. He arrived."]);
  const cue = beat(1, 1, "build", "romance", 2, [0, 1]);
  const validate = (beats, frame = "current") => validateSceneMap({scenes: [scene(0, 2, frame, beats)]}, units);
  assert.doesNotThrow(() => validate([cue]));
  for (const beats of [[{...cue, override: 20}], [{...cue, emphasis: 4}], [{...cue, category: "neutral"}],
    [{...cue, evidence: [0]}], [{...cue, evidence: [1, 1]}], [{...cue, evidence: [1, 0]}], [{...cue, evidence: [1, 3]}],
    [cue, cue], [beat(1, 2, "boundary", "neutral", 0)], Array(1)]) {
    assert.throws(() => validate(beats), /Invalid scene map/);
  }
  for (const frame of ["imagined", "historical", "reported", "neutral", "mixed", "uncertain"]) {
    assert.throws(() => validate([cue], frame), /Invalid scene map/);
  }
});

test("compiled shadow rows preserve sentence interruption and local zero without carrying across scenes", () => {
  const units = buildSceneUnits(["Mira waited. He took her hand. She pulled away.", "***", "The train left.", "They smiled."]);
  const map = {scenes: [scene(0, 2, "current", [beat(1, 1, "sustain", "romance", 2), beat(2, 2, "boundary", "neutral", 0)]),
    scene(5, 5, "current", [beat(5, 5, "build", "romance", 1)])]};
  const timeline = compileSceneMap(map, units);
  assert.deepEqual(timeline.map(row => [row.id, row.sceneId, row.phase, row.emphasis, row.boundary]), [
    [0, 0, "quiet", 0, null], [1, 0, "sustain", 2, null], [2, 0, "boundary", 0, "model"],
    [3, null, "boundary", 0, "structural"], [4, null, "unmapped", 0, null], [5, 5, "build", 1, null],
  ]);
  assert.ok(timeline.every(row => !Object.hasOwn(row, "text") && !Object.hasOwn(row, "level")));
  const masked = compileSceneMap(map, units, {quietParagraphs: new Set([0])});
  assert.deepEqual(masked.slice(0, 3).map(row => [row.phase, row.emphasis, row.localQuiet]),
    [["quiet", 0, true], ["quiet", 0, true], ["boundary", 0, true]]);
  assert.deepEqual(masked.slice(3), timeline.slice(3));
});
test("printed soft wraps preserve sentence identity and exact source offsets", () => {
  const text = "The evening train\narrived on time.\nThey waved.\n***\nThe next day was clear.";
  const units = buildSceneUnits([text]);
  assert.deepEqual(units.map(unit => [unit.text, unit.structuralBoundary]), [
    ["The evening train\narrived on time.", false], ["They waved.", false], ["***", true], ["The next day was clear.", false],
  ]);
  for (const unit of units) assert.equal(text.slice(unit.start, unit.end), unit.text);
});
