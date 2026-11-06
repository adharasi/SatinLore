import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {evaluateContextPlanning} from "../scripts/evaluate-context-planning.mjs";

const digest = text => createHash("sha256").update(text).digest("hex");
const quiet = (paragraph, extra = {}) => ({paragraph, cueEligible: false, category: "neutral", eventKind: "neutral",
  phase: "quiet", band: 0, boundary: false, ...extra});
const cue = paragraph => ({paragraph, cueEligible: true, category: "romance", eventKind: "current",
  phase: "build", band: 1, boundary: false});

test("context coverage uses the session cap and validated local replies without emitting source", async t => {
  const root = await mkdtemp(join(tmpdir(), "satinlore-context-plan-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const manifest = join(root, "corpus.json");
  t.mock.method(globalThis, "fetch", () => assert.fail("Offline planner must not fetch."));
  const sources = [
    {id: "small", split: "calibration", text: "The tide covered the stone.\n\nRain tapped the window.",
      labels: [quiet(1, {protected: true}), cue(2)], activeId: 1},
    {id: "long", split: "holdout", text: Array(800).fill("The square was empty.").join("\n\n"),
      labels: [...Array.from({length: 799}, (_, index) => quiet(index + 1)), cue(800)], activeId: 799},
  ];
  const works = await Promise.all(sources.map(async ({id, split, text, labels, activeId}) => {
    const file = id + ".txt";
    await writeFile(join(root, file), text);
    return {id, split, authorId: "author-" + id, excerpts: [{id: "excerpt-" + id, file, sha256: digest(text), labels,
      sceneReference: {scenes: [{first: activeId, last: activeId, frame: "current", beats: [
        {first: activeId, last: activeId, category: "romance", phase: "build", emphasis: 1, evidence: [activeId]},
      ]}]}}]};
  }));
  await writeFile(manifest, JSON.stringify({version: 1, works}));

  const result = await evaluateContextPlanning(manifest);
  const {calibration, holdout} = result.splits;
  assert.equal(calibration.protectedReferenceParagraphsPlanned, 1);
  assert.equal(calibration.oracleRecoveredCurrentCues, 1);
  assert.equal(holdout.plannedRequests, result.sessionLimits.requests);
  assert.equal(holdout.individuallyContextEligibleReferenceCues, 1);
  assert.equal(holdout.unplannedReferenceCuesIndividuallyEligible, 1);
  assert.equal(holdout.oracleRecoveredCurrentCues, 0);
  assert.doesNotMatch(JSON.stringify(result), /stone|window|square|author-small|small\.txt/);
});
