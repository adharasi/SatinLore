import test from "node:test";
import assert from "node:assert/strict";
import {ReaderModel} from "../app/static/reader/model.mjs";

const story = [
  "Their tender romantic kiss expressed affection.",
  "Rain tapped softly on the window.",
  "They shared a tender romantic embrace full of affection.",
].join("\n\n");

test("immediate and deferred analysis produce the same local scene mapping and preserve corrections", async () => {
  const immediate = new ReaderModel();
  immediate.load(story);
  assert.ok(immediate.effectiveLevels()[0] > 0);
  assert.equal(immediate.effectiveLevels()[1], immediate.effectiveLevels()[0], "A brief sensory detail retains the preceding level.");
  assert.equal(immediate.effectiveProfiles()[1].rhythm, immediate.effectiveProfiles()[0].rhythm);
  assert.equal(immediate.paragraphs[0].sceneId, immediate.paragraphs[2].sceneId);
  const deferred = new ReaderModel();
  deferred.load(story, {deferAnalysis: true});
  deferred.setOverride(1, 0);
  assert.equal(deferred.effectiveProfiles(), undefined);
  assert.equal(await deferred.analyse({yieldTask: async () => {}, batchSize: 1}), true);
  assert.deepEqual(deferred.effectiveProfiles(), immediate.effectiveProfiles());
  assert.equal(deferred.effectiveLevels()[1], 0);
  deferred.resetOverride(1);
  assert.deepEqual(deferred.effectiveLevels(), immediate.effectiveLevels());
});

test("failed or cancelled analysis cannot leave a scene profile active", async () => {
  const model = new ReaderModel();
  model.load(story);
  assert.ok(model.effectiveProfiles());
  const success = await model.analyse({yieldTask: async () => {}, score: () => ({band: 100, level: 20})});
  assert.equal(success, false);
  assert.equal(model.analysisStatus, "error");
  assert.equal(model.effectiveProfiles(), undefined);
  assert.deepEqual(model.effectiveLevels(), [0, 0, 0]);
  const stopped = new AbortController();
  stopped.abort();
  assert.equal(await model.analyse({yieldTask: async () => {}, signal: stopped.signal}), false);
  assert.equal(model.effectiveProfiles(), undefined);
});
