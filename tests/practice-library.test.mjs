import assert from "node:assert/strict";
import test from "node:test";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {nocturneCandidates} from "../app/static/reader/nocturne.mjs";
import {ANALYSED_PRACTICE_STORIES, PRACTICE_STORIES} from "../app/static/reader/practice-stories.mjs";
import {workspace} from "./helpers/workspace.mjs";

const expected = {
  "after-the-screening": {
    phases: ["quiet", "build", "sustain", "peak", "recover", "quiet", "quiet"],
    levels: [0, 1, 1, 5, 1, 0, 0],
    movements: ["", "", "vibrate", "vibrate", "vibrate", "", ""],
    cues: [[3, "peak", "sustained"], [2, "sustain", "sustained"]], excluded: 0,
  },
  "rooftop-greenhouse": {
    phases: ["build", "sustain", "peak", "recover", "quiet"],
    levels: [1, 2, 5, 1, 0],
    movements: ["vibrate", "vibrate", "vibrate", "vibrate", ""],
    cues: [[2, "peak", "accented"], [1, "sustain", "alternating"]], excluded: 0,
  },
  "workshop-after-hours": {
    phases: ["build", "sustain", "sustain", "sustain", "quiet"],
    levels: [1, 1, 1, 1, 0],
    movements: ["vibrate", "vibrate+fingering", "fingering", "fingering", ""],
    cues: [[3, "sustain", "sustained"], [1, "sustain", "unspecified"]], excluded: 1,
  },
  "radio-studio": {
    phases: ["quiet", "quiet", "build", "quiet", "build", "sustain", "quiet"],
    levels: [0, 0, 1, 0, 1, 1, 0],
    movements: ["", "", "vibrate", "", "vibrate", "vibrate", ""],
    cues: [[5, "sustain", "sustained"]], excluded: 3,
  },
};

for (const story of ANALYSED_PRACTICE_STORIES) {
  test(`${story.title} matches the annotated Loom sections and eligible Nocturne cues`, () => {
    const sections = new ReaderModel().load(story.text);
    const {cues, excluded, limited} = nocturneCandidates(sections);
    assert.deepEqual({phases: sections.map(section => section.phase), levels: sections.map(section => section.suggestedLevel),
      movements: sections.map(section => section.movements.join("+")), cues: cues.map(({id, phase, shape}) => [id, phase, shape]), excluded}, expected[story.id]);
    assert.equal(limited, 0);
    assert.ok(sections.every(section => section.override === null));
  });
}

test("the practice picker opens session-only analysed and known-level stories, with Stop and Escape", async t => {
  const app = workspace(); t.after(() => app.destroy());
  await app.settle();
  await app.click("control-playground");
  const picker = app.nodes.get("practice-story-choice"), dialog = app.nodes.get("practice-story-dialog");
  assert.equal(dialog.open, true);
  assert.deepEqual(picker.children.flatMap(group => group.children).map(option => option.value), PRACTICE_STORIES.map(story => story.id));
  await dialog.dispatch("cancel");
  assert.equal(dialog.open, false);
  assert.equal(app.read("currentStory()"), null);

  await app.click("control-playground");
  picker.value = "after-the-screening";
  await picker.dispatch("change");
  assert.match(app.nodes.get("practice-story-description").textContent, /sustained crest/);
  await app.click("practice-story-open"); await app.settle();
  assert.equal(dialog.open, false);
  assert.equal(app.read("currentStory().title"), "After the screening");
  assert.equal(app.read("currentStory().controlled"), false);
  assert.equal(app.read("currentStory().saved"), false);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("scene-model").disabled, false);
  assert.equal(app.read("currentStory().model.paragraphs[3].phase"), "peak");

  await app.click("control-playground");
  await app.click("practice-story-stop");
  assert.equal(dialog.open, false);
  assert.equal(app.read("currentStory().title"), "After the screening");
  await app.click("control-playground");
  picker.value = "control-check-v1";
  await picker.dispatch("change");
  await app.click("practice-story-open"); await app.settle();
  assert.equal(app.read("currentStory().controlled"), true);
  assert.equal(app.read("currentStory().model.paragraphs[2].override"), 4);
  assert.equal(app.nodes.get("scene-model").disabled, true);
  assert.match(app.nodes.get("scene-model-help").textContent, /fixed levels/);
  assert.equal(app.nodes.get("model-practice-shortcut").hidden, false);
  assert.equal(app.read("latest.running"), false);
  await app.click("model-practice-shortcut");
  assert.equal(picker.value, ANALYSED_PRACTICE_STORIES[0].id);
  await app.click("practice-story-open"); await app.settle();
  const model = app.nodes.get("scene-model");
  assert.equal(model.disabled, false);
  model.value = "nocturne"; await model.dispatch("change");
  assert.equal(app.read("currentStory().sceneModel"), "nocturne");
  assert.equal(app.libraryValues.size, 0);
  assert.deepEqual(app.errors, []);
});
