import assert from "node:assert/strict";
import test from "node:test";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {buildSceneUnits} from "../app/static/reader/scene-map.mjs";
import {replayPassage, sceneUnitWordCount, summarizePlayback} from "../scripts/evaluate-scene-map-playback.mjs";

function fixture({protectedSecond = false} = {}) {
  const model = new ReaderModel();
  model.load("The team set up the large reading room with twenty additional seats and new tables for the event. The clock struck noon and the door shut.\n\nA few people came in from the rain.");
  const units = buildSceneUnits(model.paragraphs);
  assert.equal(units.length, 3);
  const reference = {scenes: [{first: 0, last: 1, frame: "current", beats: [
    {first: 0, last: 0, category: "tension", phase: "peak", emphasis: 3, evidence: [0]},
    {first: 1, last: 1, category: "neutral", phase: "boundary", emphasis: 0, evidence: [1]},
  ]}]};
  return {scope: "exact", model, units, reference, labels: [{}, {protected: protectedSecond}]};
}

test("ideal sentence timing can render a cue before a boundary in the same paragraph", async () => {
  const passage = fixture();
  const paragraph = summarizePlayback([await replayPassage(passage, {arm: "scene-paragraph"})]);
  const sentence = summarizePlayback([await replayPassage(passage)]);
  assert.equal(paragraph.eligibleEpisodes, 1);
  assert.equal(paragraph.sustainedContrastEpisodes, 0);
  assert.equal(sentence.sustainedContrastEpisodes, 1);
  assert.equal(sentence.p95DispatchDelayMsAmongSustainedEpisodes, 0);
  assert.equal(sentence.boundaryNonzeroUnits, 0);
  assert.equal(sentence.stopFailures, 0);
  assert.equal(sentence.durationViolationCommands, 0);
  assert.equal(sentence.cadenceViolationCommands, 0);
});

test("late and missing provider results cannot inherit the expected boundary", async () => {
  const passage = fixture({protectedSecond: true});
  const replay = await replayPassage(passage, {onTimeUnits: new Set([2]), candidateMap: passage.reference});
  assert.equal(replay.stats.lateCueUnits, 1);
  assert.equal(replay.episodes[0].sustainedContrast, false);
  assert.equal(replay.stats.boundaryNonzeroUnits, 1);
  assert.equal(replay.stats.boundaryAboveBackgroundMs, 0);
  assert.equal(replay.stats.hardQuietViolationMs, 0);
  assert.equal(replay.stats.hardQuietViolationCommands, 0);

  const missing = await replayPassage(passage, {onTimeUnits: new Set([0, 1, 2]), candidateMap: {scenes: []}});
  assert.equal(missing.stats.boundaryNonzeroUnits, 1);
  assert.equal(missing.episodes[0].sustainedContrast, false);
});

test("fixed caps hold and missing headroom stays out of the contrast denominator", async () => {
  const replay = summarizePlayback([await replayPassage(fixture(), {maximum: 1})]);
  assert.equal(replay.maximumOutput, 1);
  assert.equal(replay.eligibleEpisodes, 0);
  assert.equal(replay.sustainedContrastEpisodeRate, null);
  assert.equal(replay.capViolationCommands, 0);
  assert.equal(replay.capViolationMs, 0);
  assert.equal(sceneUnitWordCount({text: "***"}), 1);
  assert.equal(sceneUnitWordCount({text: "We can’t wait."}), 3);
});
