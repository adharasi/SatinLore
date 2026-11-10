import assert from "node:assert/strict";
import test from "node:test";
import {compareNeutralArms} from "../scripts/compare-luna-protocol-neutral.mjs";
import {runLunaProtocolNeutral} from "../scripts/lib/luna-protocol-neutral.mjs";

test("paired arm scores retain all pinned targets and reject incompatible runs", async () => {
  const shards = [["first-dance", "old-letter"], ["reading-room", "practice-drill"]];
  const [complete, windowed] = await Promise.all(["complete", "windowed"].map(arm =>
    Promise.all(shards.map(fixtureIds => runLunaProtocolNeutral({mode: "mock", arm, fixtureIds})))));
  const result = compareNeutralArms(complete, windowed);
  assert.equal(result.sourceProseIncluded, false);
  assert.deepEqual(result.fixtureIds, shards.flat());
  const {primaryCue, typedBoundary} = result.comparison;
  assert.equal(primaryCue.allTargets.complete.targets, 33);
  assert.equal(primaryCue.allTargets.windowed.positives, 10);
  assert.equal(typedBoundary.commonObserved.windowed.positives, 7);
  assert.equal(typedBoundary.allTargets.complete.matched, 7);
  assert.deepEqual(primaryCue.differences, []);
  assert.throws(() => compareNeutralArms(windowed, complete), /same fixture pins/u);
  assert.throws(() => compareNeutralArms(complete, windowed.map(report => ({...report, rubricVersion: "other"}))), /same fixture pins/u);
});
