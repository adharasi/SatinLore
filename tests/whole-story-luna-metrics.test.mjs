import test from "node:test";
import assert from "node:assert/strict";
import {combineWholeStoryScores, scoreWholeStoryAnnotations} from "../scripts/lib/whole-story-luna-metrics.mjs";

const units = (...paragraphs) => paragraphs.map((paragraph, id) => ({id, paragraph}));
const classified = (id, phase, transition = "none") => ({id, status: "classified", phase, transition,
  depiction: "neutral", frame: "current", action: "none", evidenceIds: [id]});
const abstain = id => ({id, status: "abstain", phase: "unknown", transition: "unknown", depiction: "neutral",
  frame: "uncertain", action: "unknown", evidenceIds: []});

test("missing and abstaining cue anchors stay in effective denominators", () => {
  const score = scoreWholeStoryAnnotations({units: units(0, 0, 1, 1, 2, 3, 3),
    phases: ["build", "onset", "sustain", "quiet", "quiet", "quiet", "quiet"],
    annotations: [classified(0, "onset"), abstain(1), classified(3, "sustain"), classified(4, "quiet"),
      {...abstain(5), status: "uncertain"}]});
  assert.deepEqual(score.cues, {matched: 1, missed: 2, extra: 1, precision: 1 / 2, recall: 1 / 3});
  assert.deepEqual(score.coveredCues, {matched: 1, missed: 0, extra: 1, precision: 1 / 2, recall: 1});
  assert.deepEqual(score.delivery, {targets: 7, returned: 5, classified: 3, abstained: 1, uncertain: 1, missing: 2,
    referenceCues: 3, classifiedReferenceCues: 1, returnedCoverage: 5 / 7, usableCoverage: 3 / 7, usableCueCoverage: 1 / 3});
  assert.deepEqual(score.phase, {matched: 1, total: 7, accuracy: 1 / 7});
  assert.deepEqual(score.coveredPhase, {matched: 1, total: 3, accuracy: 1 / 3});
});

test("boundary matching requires the same type and a one-to-one match", () => {
  const score = scoreWholeStoryAnnotations({units: units(0, 1, 1, 2, 3, 5, 7),
    phases: ["quiet", "quiet", "quiet", "quiet", "quiet", "quiet", "quiet"],
    events: {1: "stop", 2: "stop", 3: "reported-entry", 5: "interruption", 6: "scene-cut"},
    annotations: [classified(0, "quiet", "stop"), classified(1, "quiet", "scene-cut"),
      classified(3, "quiet", "present-return"), classified(5, "onset", "interruption"), abstain(6)]});
  assert.deepEqual(score.events.exact, {matched: 1, missed: 4, extra: 3, precision: 1 / 4, recall: 1 / 5});
  assert.deepEqual(score.events.withinOneParagraph, {matched: 2, missed: 3, extra: 2, precision: 1 / 2, recall: 2 / 5});
  assert.deepEqual(score.events.byType.stop.withinOneParagraph, {matched: 1, missed: 1, extra: 0, precision: 1, recall: 1 / 2});
  assert.deepEqual(score.hardStops, {reference: 4, exact: 1, quiet: 1, active: 1, unclassified: 2, missed: 3});
});

test("fixed target slices exclude outside annotations and reject invalid IDs", () => {
  const input = {units: units(0, 1), phases: ["build", "quiet"], events: new Map([[1, "stop"]]),
    annotations: new Map([[0, classified(0, "build")], [1, classified(1, "quiet", "stop")]])};
  const score = scoreWholeStoryAnnotations({...input, targetIds: [1]});
  assert.equal(score.delivery.targets, 1);
  assert.equal(score.cues.recall, null);
  assert.equal(score.events.exact.recall, 1);
  assert.throws(() => scoreWholeStoryAnnotations({...input, targetIds: [1, 1]}), /scoring targets/);
  assert.throws(() => scoreWholeStoryAnnotations({...input, annotations: [classified(0, "build"), classified(0, "build")]}),
    /scoring annotation/);
});

test("combined scores recompute rates without pairing events across stories", () => {
  const first = scoreWholeStoryAnnotations({units: units(0, 1), phases: ["onset", "quiet"], events: {1: "stop"},
    annotations: [classified(0, "onset")]});
  const second = scoreWholeStoryAnnotations({units: units(0, 1, 2), phases: ["quiet", "build", "sustain"],
    annotations: [classified(0, "quiet", "stop"), classified(1, "quiet"), abstain(2)]});
  const total = combineWholeStoryScores([first, second]);
  assert.deepEqual(total.cues, {matched: 1, missed: 2, extra: 0, precision: 1, recall: 1 / 3});
  assert.equal(total.delivery.usableCoverage, 3 / 5);
  assert.equal(total.phase.accuracy, 2 / 5);
  assert.deepEqual(total.events.byType.stop.withinOneParagraph, {matched: 0, missed: 1, extra: 1, precision: 0, recall: 0});
  assert.equal(combineWholeStoryScores([]).events.exact.recall, null);
});
