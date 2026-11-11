import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const text = "June and Lee held hands. The music slowed. They reached for each other again. The lights went out.";
const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
  spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const onset = unitId => ({...neutral(unitId), status: "verified", depiction: "romantic", narrativePhase: "onset",
  action: "contact", transition: "onset", scopeId: unitId, evidenceIds: [unitId]});
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const cut = {status: "cut", reason: "time-jump", previousId: 1, entryId: 2};
const typed = (row, sceneBoundary = noBoundary) => ({...row, depiction: "unknown", narrativePhase: "unknown",
  action: "unknown", sceneBoundary});
const oldScopeOnset = {...onset(2), scopeId: 0, evidenceIds: [0, 2]};
const recover = {...oldScopeOnset, narrativePhase: "recover", transition: "recover", fact: "ease",
  evidenceIds: [0, 1, 2], priorAnchor: 0};
const directOnset = {status: "verified", frame: "current", action: "change", phase: "onset",
  contrast: "enacted", targetId: 2, contextId: null};
const directRecover = {...directOnset, action: "contact", phase: "recover", contextId: 1};
const stop = {...neutral(1), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [1]};

function run({primary = oldScopeOnset, discovery = onset(2), transition = typed({...onset(2), scopeId: null}, cut),
  local = directOnset, prior = neutral(1), blockedIds = []} = {}) {
  const provider = Object.assign(async ({mode, targetIds}) => ({status: "ok", usage: {inputTokens: 100, outputTokens: 20},
    facts: targetIds.map(id => {
      if (mode === "local-action") return {unitId: id, localAction: local};
      if (id === 2 && mode === "transition") return transition;
      const row = id === 0 ? onset(0) : id === 1 ? prior : id === 2 ? mode === "discovery" ? discovery : primary : neutral(id);
      if (mode === "transition") return typed(row);
      return mode === "discovery" && row.status === "verified" ? {...row, status: "candidate"} : row;
    })}), {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "action", text, grant, now: () => 1, provider, blockedIds, negativeStride: 0,
    verificationTargets: [0, 1, 2, 3], verifyTransitions: true, transitionTargets: [0, 1, 2, 3],
    localActionVerificationTargets: local ? [2] : []});
}

test("an enacted recovery cue preserves the compiled phase, envelope and continuation", async () => {
  const options = {primary: recover, discovery: {...recover, evidenceIds: [2], priorAnchor: null},
    transition: typed({...recover, scopeId: null, priorAnchor: null, evidenceIds: [1, 2]})};
  const control = await run({...options, local: null});
  const actual = await run({...options, local: directRecover});
  const row = actual.units[2];
  assert.equal(control.units[2].cue, false);
  assert.equal(row.pattern, "Recovery");
  assert.equal(row.phase, "recover");
  assert.equal(row.appliedTransition, "recover");
  assert.equal(row.cue, true);
  assert.equal(row.readerCue, true);
  assert.equal(row.localActionApplication, "recovery-cue");
  assert.deepEqual(row.trace, control.units[2].trace);
  assert.deepEqual(actual.units[3], control.units[3]);
  for (const changes of [{local: {...directRecover, action: "change"}}, {local: {...directRecover, contextId: 0}}, {blockedIds: [2]}]) {
    const {units: compared} = await run({...options, local: directRecover, ...changes});
    assert.equal(compared[2].cue, false);
    assert.equal(compared[2].localActionApplication, undefined);
  }
});

test("a corroborated onset starts a new scope at a material cut", async () => {
  const control = await run({local: null});
  const {units: actual} = await run();
  const row = actual[2];
  assert.equal(control.units[2].pattern, "Reset");
  assert.equal(row.appliedTransition, "scene-cut");
  assert.equal(row.cue, true);
  assert.equal(row.pattern, "Onset rise");
  assert.equal(row.sceneId, "action:scene:2");
  assert.equal(row.beatId, "action:beat:2");
  assert.equal(row.localActionApplication, "scene-entry-onset");
  assert.deepEqual(row.primaryPrefix.evidenceIds, [0, 2]);
  assert.deepEqual(row.transitionVerification.evidenceIds, [2]);
  assert.deepEqual(row.trace.evidence, [1, 2]);
  assert.notEqual(row.beatId, actual[0].beatId);
});

test("old-scope onset requires all new-scope roles and an open gate", async () => {
  for (const options of [
    {discovery: oldScopeOnset},
    {discovery: {...onset(2), evidenceIds: [1, 2]}},
    {local: {...directOnset, contextId: 1}},
    {local: {...directOnset, phase: "recover"}},
    {transition: typed({...onset(2), scopeId: null, evidenceIds: [1, 2]}, cut)},
    {prior: stop},
    {blockedIds: [2]},
  ]) {
    const {units: actual} = await run(options);
    const row = actual[2];
    assert.equal(row.pattern, options.blockedIds ? "Stop" : "Reset");
    assert.equal(row.cue, false);
    assert.equal(row.beatId, null);
    assert.equal(row.localActionApplication, undefined);
  }
});
