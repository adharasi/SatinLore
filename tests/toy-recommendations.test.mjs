import assert from "node:assert/strict";
import test from "node:test";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {storyToyRecommendation} from "../app/static/reader/toy-recommendations.mjs";
import {workspace} from "./helpers/workspace.mjs";

const flexerStory = "Their tender romantic kiss expressed affection. The toy vibrated and flexed together.";
const recommendationFor = story => storyToyRecommendation(new ReaderModel().load(story));

test("story recommendations match explicit movement cues to documented models", () => {
  assert.equal(recommendationFor(flexerStory), "Flexer — vibration and flexing (fingering).");
  assert.equal(recommendationFor("Their tender romantic kiss expressed affection. The motion flexed."), "Flexer — flexing (fingering).");
  const mixed = recommendationFor("They shared a tender kiss. The device vibrated, flexed, rotated, thrust, and oscillated together.");
  assert.match(mixed, /Flexer — vibration and flexing \(fingering\)/);
  assert.match(mixed, /Nora \/ Nora 2 — rotation/);
  assert.match(mixed, /Gravity — thrusting/);
  assert.match(mixed, /Osci 3 — oscillation \(extended Lovense connection needed\)/);
  assert.doesNotMatch(mixed, /Velvo|Spinel|Gush 2|Vulse/);
});

test("quoted, speculative and unrelated motion does not become a model match", () => {
  const uncertain = ["“The toy flexed,” she read from the script.", "She imagined the toy rotating.", "The fan rotated above them."].join("\n\n");
  assert.equal(recommendationFor(uncertain), "");
  assert.equal(recommendationFor(`${uncertain}\n\nThey shared a tender kiss.`), "");
  assert.match(recommendationFor("They shared a tender kiss. The toy vibrated steadily."), /^Lush or another compatible vibration model matches/);
});

test("the reader shows completed recommendations above the active story and clears old matches", async t => {
  const app = workspace(); t.after(() => app.destroy());
  await app.settle();
  const panel = app.nodes.get("story-toy-recommendations");
  const summary = app.nodes.get("story-toy-recommendations-summary");
  assert.equal(panel.hidden, true);
  await app.add(flexerStory);
  assert.equal(panel.hidden, false);
  assert.equal(panel.open, false);
  assert.match(summary.textContent, /Flexer.*fingering/);
  panel.open = true;
  await app.add("They shared a tender kiss.");
  assert.equal(panel.hidden, true, "General intensity cues do not imply a toy recommendation.");
  assert.equal(panel.open, false);
  assert.equal(summary.textContent, "");
  assert.equal(app.nodes.get("analysis-status").textContent, "Scene patterns ready");
  await app.add("The receipt listed three cab fares and their payment dates.");
  assert.equal(panel.hidden, true);
  assert.equal(app.nodes.get("analysis-status").textContent, "No scene changes detected");
  await app.click("connect");
  assert.match(app.nodes.get("start-help").textContent, /Choose a background level/);
  await app.click("start");
  assert.match(app.nodes.get("start-summary").textContent, /current level 1\/20/,
    "Fresh continuous-background preferences cover an ordinary unmatched passage.");
  await app.click("confirm-start");
  await app.settle();
  assert.equal(app.nodes.get("reading-sync-state").textContent, "Following");
  assert.equal(app.read("latest.output"), 1, "The calibrated background remains visible in the actual simulator output.");
  await app.click("stop");
  await app.click("control-playground");
  app.nodes.get("practice-story-choice").value = "control-check-v1";
  await app.click("practice-story-open");
  await app.settle();
  assert.equal(panel.hidden, true);
  assert.equal(summary.textContent, "");
  assert.deepEqual(app.errors, []);
});
