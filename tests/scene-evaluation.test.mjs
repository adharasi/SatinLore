import assert from "node:assert/strict";
import test from "node:test";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {
  AMBIGUITY_STORIES, CONTEXT_MOVEMENT_STORIES, CUE_EDGE_CASES, READING_PASSAGES, SCENE_EVALUATION_STORIES, evaluateSceneStory,
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

for (const story of [...SCENE_EVALUATION_STORIES, ...CONTEXT_MOVEMENT_STORIES, ...AMBIGUITY_STORIES]) {
  test(`scene read-through follows the annotated ${story.label} passages`, () => {
    const observations = evaluateSceneStory(ReaderModel, story);
    assert.deepEqual(
      observations.map(({label, observed}) => ({label, ...observed})),
      observations.map(({label, expected}) => ({label, ...expected})),
    );
  });
}

test("the local scorer only exposes rhythm shapes from current contact and grounded movement", () => {
  const story = [
    "They shared a tender kiss. The toy vibrated steadily.",
    "Their passionate, tender kiss and romantic embrace expressed affection. The toy vibrated in short bursts while her fingers flexed.",
    "They shared a tender kiss. The toy buzzed in stronger and softer pulses.",
    "They shared a tender kiss by a steadily turning fan. The toy vibrated.",
    "They shared a tender kiss. The toy vibrated in short bursts while her fingers flexed steadily.",
    "They shared a tender kiss. The toy vibrated in short bursts, then rotated.",
  ];
  const sections = new ReaderModel().load(story.join("\n\n"));
  assert.equal(sections[1].phase, "peak");
  assert.deepEqual(sections.map(section => section.shape), [
    "sustained", "accented", "alternating", "unspecified", "unspecified", "unspecified",
  ]);
  assert.ok(sections.every(section => !section.cloudExcluded));
});

test("mixed reported, negated and unresolved cues preserve valid local beats without remote candidates", () => {
  const story = [
    "They shared a tender kiss. He said that the toy vibrated steadily.",
    "They shared a tender kiss. The toy pulsed but did not rotate.",
    "“The toy vibrated in short bursts,” she read. They shared a tender kiss.",
    "They shared a tender kiss. Her phone was nearby. It buzzed steadily.",
    "The caption used the word unwanted. They shared a tender kiss.",
    "They shared a tender kiss. The toy vibrated steadily.",
    "***",
    "The following week, she watered the plants.",
  ];
  const sections = new ReaderModel().load(story.join("\n\n"));
  assert.deepEqual(sections.map(section => section.cloudExcluded), [true, true, true, true, true, false, false, false]);
  assert.deepEqual(sections.map(section => section.shape), [
    "unspecified", "unspecified", "unspecified", "unspecified", "unspecified", "sustained", "unspecified", "unspecified",
  ]);
  assert.ok(sections.slice(0, 4).every(section => section.suggestedLevel > 0));
  assert.equal(sections[4].suggestedLevel, 0);
  assert.ok(sections.slice(6).every(section => section.quiet));
});

test("explicit sensitive cue matches stay quiet locally and are excluded from remote analysis", () => {
  const paragraphs = new ReaderModel().load([
    "The report used the term non-consent. They shared a tender kiss.",
    "A news clipping mentioned a 17-year-old. They shared a tender kiss.",
    "The article mentioned an under-age person. They shared a tender kiss.",
  ].join("\n\n"));
  for (const paragraph of paragraphs) {
    assert.equal(paragraph.suggestedLevel, 0);
    assert.equal(paragraph.quiet, true);
    assert.equal(paragraph.cloudExcluded, true);
  }
});
