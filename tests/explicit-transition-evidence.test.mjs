import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {buildSceneUnits} from "../app/static/reader/scene-map.mjs";
import {evaluateExplicitTransitions} from "../scripts/evaluate-explicit-transitions.mjs";
import {explicitTransitionAnchors} from "../scripts/lib/explicit-transition-evidence.mjs";

const inspect = (...paragraphs) => explicitTransitionAnchors(buildSceneUnits(paragraphs));
const digest = text => createHash("sha256").update(text).digest("hex");
const quiet = (paragraph, protectedReference = false) => ({paragraph, cueEligible: false,
  category: "neutral", eventKind: "neutral", phase: "quiet", band: 0, boundary: false, protected: protectedReference});
const boundary = id => ({first: id, last: id, phase: "boundary", category: "neutral", emphasis: 0, evidence: [id]});

test("an enacted withdrawal corroborates the pause rather than adding a duplicate release", () => {
  assert.deepEqual(inspect("A latch rattled and I said wait.", "He let go at once."),
    {raw: [0, 1], corroborated: [0]});
  assert.deepEqual(inspect("Sam held my hand.", "“Stop,” I said, and Sam released my hand."),
    {raw: [1], corroborated: [1]});
  assert.deepEqual(inspect("We embraced.", "She stepped back."), {raw: [1], corroborated: [1]});
});

test("quiet, reported, hypothetical, negated and incidental cues lack enacted evidence", () => {
  assert.deepEqual(inspect("The room fell quiet.", "They watched the rain."), {raw: [], corroborated: []});
  for (const pair of [
    ["She recalled saying “wait.”", "He let go at once."],
    ["She said wait.", "He did not let go."],
    ["I imagined she said wait.", "He let go."],
    ["He said wait.", "She said he released her hand."],
    ["She said wait.", "He would let go."],
    ["She said wait.", "He let go yesterday."],
    ["She said wait.", "He let go of the rope."],
    ["She said wait for the train.", "He stepped back."],
    ["She said wait.", "He released her schedule."],
  ]) {
    const result = inspect(...pair);
    assert.notEqual(result.raw.length, 0);
    assert.deepEqual(result.corroborated, []);
  }
});

test("a separator or missing source position prevents adjacent corroboration", () => {
  assert.deepEqual(inspect("I said wait.", "***", "He let go."), {raw: [0, 2], corroborated: []});
  const units = buildSceneUnits(["I said wait.", "He let go."]);
  assert.deepEqual(explicitTransitionAnchors([units[0], {...units[1], id: 2}]),
    {raw: [0, 2], corroborated: []});
  assert.deepEqual(explicitTransitionAnchors([units[0], {...units[1], paragraph: 2}]),
    {raw: [0, 1], corroborated: []});
});

test("offline scoring keeps exact splits and matches at most one reference per prediction", async t => {
  const root = await mkdtemp(join(tmpdir(), "satinlore-explicit-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const manifestPath = join(root, "manifest.json");
  const holdout = "The lamp dimmed.\n\nI said wait. He let go.";
  const calibration = "She sat down. A gate closed.";
  await Promise.all([writeFile(join(root, "a.txt"), holdout), writeFile(join(root, "b.txt"), calibration)]);
  const works = [
    {id: "a", authorId: "author-a", split: "holdout", excerpts: [{id: "excerpt-a", file: "a.txt",
      sha256: digest(holdout), labels: [quiet(1, true), quiet(2)],
      sceneReference: {scenes: [{first: 0, last: 2, frame: "current", beats: [boundary(0), boundary(2)]}]}}]},
    {id: "b", authorId: "author-b", split: "calibration", excerpts: [{id: "excerpt-b", file: "b.txt",
      sha256: digest(calibration), labels: [quiet(1)],
      sceneReference: {scenes: [{first: 0, last: 1, frame: "current", beats: [boundary(1)]}]}}]},
  ];
  const writeManifest = () => writeFile(manifestPath, JSON.stringify({version: 1, works}));
  await writeManifest();
  const result = await evaluateExplicitTransitions(manifestPath);
  assert.equal(result.splits.calibration.referenceAnchors, 1);
  const metrics = result.splits.holdout;
  assert.equal(metrics.referenceAnchors, 2);
  assert.deepEqual(metrics.corroborated.sentenceBoundaries, {found: 0, missed: 2, false: 1, precision: 0, recall: 0});
  assert.deepEqual(metrics.corroborated.paragraphToleranceBoundaries,
    {found: 1, missed: 1, false: 0, precision: 1, recall: 0.5});
  assert.doesNotMatch(JSON.stringify(result), /lamp|gate|author-a|a\.txt/);
  delete works[0].excerpts[0].sceneReference;
  await writeManifest();
  await assert.rejects(evaluateExplicitTransitions(manifestPath), /requires exact references/);
});
