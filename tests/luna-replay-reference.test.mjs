import assert from "node:assert/strict";
import test from "node:test";
import {assessReplayPlayback, pinFrozenTarget} from "../scripts/lib/luna-replay-reference.mjs";
import {auditBoundaryControls} from "../scripts/audit-luna-boundary-controls.mjs";

const clip = {storyId: "neutral-work", sourceSha256: "source", editionDigest: "edition", units: [{id: 5, digest: "unit"}]};
const work = {id: clip.storyId, sourceSha256: clip.sourceSha256, editionDigest: clip.editionDigest,
  units: [{id: 5, unitSha256: "unit", pattern: "Taper", phase: "build", transition: "scene-cut", transitionKnownAt: 5, cue: true}]};
const roster = {...work, targetIds: [5], transitionTargetIds: [5]};

test("frozen replay joins require exact work, source, edition, target and unit identity", () => {
  assert.equal(pinFrozenTarget(clip, 5, work, roster).cueScored, true);
  for (const [candidateClip, candidateWork, candidateRoster, id] of [
    [{...clip, storyId: "other"}, work, roster, 5],
    [clip, {...work, sourceSha256: "other"}, roster, 5],
    [clip, work, {...roster, sourceSha256: "other"}, 5],
    [clip, {...work, editionDigest: "other"}, roster, 5],
    [clip, work, {...roster, editionDigest: "other"}, 5],
    [{...clip, units: [{id: 5, digest: "other"}]}, work, roster, 5],
    [clip, work, {...roster, transitionTargetIds: []}, 5],
    [clip, work, roster, 6],
  ]) assert.throws(() => pinFrozenTarget(candidateClip, id, candidateWork, candidateRoster), /pins differ/u);
});

test("first-knowable hard events are audited without changing a disputed frozen profile or cue", () => {
  const pin = pinFrozenTarget(clip, 5, work, roster);
  assert.equal(pin.pattern, "Taper");
  assert.equal(pin.cue, true);
  assert.equal(pin.hardBoundary, true);
  for (const row of [
    {...work.units[0], transitionKnownAt: 6},
    {...work.units[0], transitionKnownAt: 4},
    {...work.units[0], transition: "interruption"},
    {...work.units[0], transition: "none"},
  ]) assert.equal(pinFrozenTarget(clip, 5, {...work, units: [row]}, roster).hardBoundary, false);
});

test("nine speed and ceiling combinations expose missed event and profile boundaries without muting them", async () => {
  const {results} = await auditBoundaryControls();
  assert.equal(results.length, 36);
  for (const row of results) {
    assert.ok(row.samples > 0);
    assert.equal(row.commandViolations, 0);
    assert.equal(row.pauseViolation, 0);
    assert.equal(row.capViolationMs, 0);
    const missed = row.id.startsWith("missed-");
    // Recovery rounds to zero at the tight ceiling. That is a calibration
    // result, not recognition of the deliberately missing scene boundary.
    const positive = row.id === "missed-event-cut" ? row.maximum > 1 : row.maximum > 0;
    assert.equal(row.auditedHardTargets, Number(row.id !== "active-control"));
    assert.equal(row.hardViolations, Number(missed && positive));
    assert.equal(row.hardTargetViolations, Number(missed && positive));
    assert.equal(row.hardOutputViolations, Number(missed && positive));
    if (row.id === "compiled-reset" || !positive) {
      assert.equal(row.maximumTarget, 0);
      assert.equal(row.maximumOutput, 0);
    } else {
      assert.ok(row.maximumTarget > 0);
      assert.ok(row.maximumOutput > 0);
    }
  }
});

test("replay qualification rejects missed boundaries and missing conditions instead of accepting zero-only arms", async () => {
  const {results} = await auditBoundaryControls();
  const conditions = id => results.filter(row => row.id === id).map(row => ({wpm: row.wpm, maximum: row.maximum, after: {
    commandViolations: row.commandViolations, pauseViolation: row.pauseViolation, capViolationMs: row.capViolationMs,
    compiledHardViolations: [], frozenHardViolations: row.hardViolations ? [1] : [],
    frozenHardTargets: row.auditedHardTargets, frozenHardTargetViolations: row.hardTargetViolations,
    frozenHardOutputViolations: row.hardOutputViolations,
  }}));
  assert.equal(assessReplayPlayback(conditions("compiled-reset")), "pass");
  assert.equal(assessReplayPlayback(conditions("missed-profile-reset")), "fail");
  assert.equal(assessReplayPlayback(conditions("missed-event-cut")), "fail");
  assert.equal(assessReplayPlayback(conditions("missed-event-cut").filter(row => row.maximum === 0)), "incomplete");
  const valid = conditions("compiled-reset");
  assert.equal(assessReplayPlayback([...valid.slice(1), valid[1]]), "incomplete");
  assert.equal(assessReplayPlayback([{...valid[0], after: {...valid[0].after, frozenHardOutputViolations: NaN}}, ...valid.slice(1)]), "incomplete");
  // A positive target remains a failure even if its sampled output is zero.
  assert.equal(assessReplayPlayback([{...valid[0], after: {...valid[0].after, frozenHardTargetViolations: 1}}, ...valid.slice(1)]), "fail");
});
