import assert from "node:assert/strict";
import test from "node:test";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {
  CONTEXT_MOVEMENT_STORIES, CUE_EDGE_CASES, READING_PASSAGES, SCENE_EVALUATION_STORIES, evaluateSceneStory,
} from "./scene-evaluation-fixtures.mjs";

for (const {label, text, level, movements} of CUE_EDGE_CASES) {
  test(`scene evaluation keeps ${label} in context`, () => {
    const model = new ReaderModel();
    const [paragraph] = model.load(text);
    assert.equal(paragraph.suggestedLevel, level);
    assert.deepEqual(paragraph.movements, movements);
  });
}

test("a continuous reading fixture has a bounded build, bridge, stronger beat, recovery and break", () => {
  const model = new ReaderModel();
  const paragraphs = model.load(READING_PASSAGES.join("\n\n"));
  const [build, firstAction, glass, clock, stronger, recovery, boundary, neutral] = paragraphs;
  assert.equal(build.phase, "build");
  assert.ok(build.suggestedLevel > 0 && build.suggestedLevel <= firstAction.suggestedLevel);
  for (const detail of [glass, clock]) {
    assert.equal(detail.sceneId, firstAction.sceneId);
    assert.ok(detail.suggestedLevel > 0 && detail.suggestedLevel <= firstAction.suggestedLevel);
  }
  assert.equal(stronger.sceneId, firstAction.sceneId);
  assert.ok(stronger.suggestedLevel > firstAction.suggestedLevel);
  assert.deepEqual(stronger.movements, [], "The turning fan cannot choose a device movement.");
  assert.equal(recovery.phase, "recover");
  assert.ok(recovery.suggestedLevel > 0 && recovery.suggestedLevel < stronger.suggestedLevel);
  assert.deepEqual([boundary.suggestedLevel, neutral.suggestedLevel], [0, 0]);
  assert.equal(boundary.quiet, true);
});

for (const story of [...SCENE_EVALUATION_STORIES, ...CONTEXT_MOVEMENT_STORIES]) {
  test(`scene read-through follows the annotated ${story.label} passages`, () => {
    const observations = evaluateSceneStory(ReaderModel, story);
    assert.deepEqual(
      observations.map(({label, observed}) => ({label, ...observed})),
      observations.map(({label, expected}) => ({label, ...expected})),
    );
  });
}
