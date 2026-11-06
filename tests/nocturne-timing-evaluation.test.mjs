import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {evaluateNocturneTiming} from "../scripts/evaluate-nocturne-timing.mjs";

test("timing replay sends only ready cues to the actual simulator controller", async t => {
  const folder = await mkdtemp(join(tmpdir(), "satinlore-timing-"));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const text = "Mira asked Sam whether they might spend the afternoon together in the park after their friends had gone home.\n\nThe blue train rolled out of sight.";
  await writeFile(join(folder, "fixture.txt"), text);
  const manifest = join(folder, "manifest.json");
  await writeFile(manifest, JSON.stringify({version: 1, works: [{id: "fixture", authorId: "example", split: "holdout", excerpts: [{
    id: "fixture-excerpt", file: "fixture.txt", sha256: createHash("sha256").update(text).digest("hex"),
    labels: [
      {paragraph: 1, cueEligible: true, category: "romance", eventKind: "current", phase: "sustain", band: 2, boundary: false},
      {paragraph: 2, cueEligible: false, category: "neutral", eventKind: "neutral", phase: "quiet", band: 0, boundary: true},
    ],
    sceneReference: {scenes: [
      {first: 0, last: 0, frame: "current", beats: [{first: 0, last: 0, phase: "sustain", category: "romance", emphasis: 2, evidence: [0]}]},
      {first: 1, last: 1, frame: "neutral", beats: [{first: 1, last: 1, phase: "boundary", category: "neutral", emphasis: 0, evidence: [1]}]},
    ]},
  }]}]}));
  const result = await evaluateNocturneTiming(manifest);
  const group = result.groups["holdout/exact"];
  const reactive = group["240/reactive-8s"], prepared = group["240/prepared-8s"];
  assert.equal(reactive.coverage.positives.total, 1);
  assert.equal(reactive.coverage.positives.cuedByEntry, 0);
  assert.equal(reactive.playback.sustainedContrastEpisodes, 0);
  assert.equal(prepared.coverage.positives.cuedByEntry, 1);
  assert.equal(prepared.playback.sustainedContrastEpisodes, 1);
  assert.equal(prepared.playback.stopFailures, 0);
  assert.equal(prepared.playback.capViolationCommands, 0);
  assert.doesNotMatch(JSON.stringify(result), /Mira|park|fixture\.txt/);
  await assert.rejects(evaluateNocturneTiming(manifest, {hostedScope: true}), /pinned scene digest/);
});
