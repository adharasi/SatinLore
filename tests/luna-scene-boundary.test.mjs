import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {projectTypedTransition} from "../scripts/lib/luna-transition-verification.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const text = "June waited near the window. Lee took her hand. The next evening, they started their first dance together. The band took a break.";
const index = buildWholeStoryIndex(text);
const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
  purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 1000,
  spans: index.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const onset = unitId => ({...neutral(unitId), status: "verified", depiction: "romantic", narrativePhase: "onset",
  action: "contact", transition: "onset", scopeId: unitId, evidenceIds: [unitId]});
const primaryCut = unitId => ({...neutral(unitId), status: "verified", transition: "scene-cut", fact: "cut", evidenceIds: [unitId]});
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const cut = {status: "cut", reason: "time-jump", previousId: 1, entryId: 2};
const typed = (row, sceneBoundary = noBoundary) => ({...row, depiction: "unknown", narrativePhase: "unknown",
  action: "unknown", sceneBoundary});

async function study({cue = neutral, boundary = typed(neutral(2), cut), nextBoundary, focusAnswer, prefixUnits = 24,
  boundaryVerificationTargets, boundaryAnswer, observed = []} = {}) {
  const provider = Object.assign(async request => {
    observed.push(request);
    const {mode, targetIds} = request;
    if (mode === "scene-boundary") return boundaryAnswer(targetIds[0]);
    if (mode === "transition" && targetIds[0] === 2 && boundary === null) return {status: "invalid-response"};
    return {status: "ok", usage: {inputTokens: 120, outputTokens: 40}, facts: targetIds.map(id => {
      const local = id === 1 ? onset(id) : id === 2 ? cue(id) : neutral(id);
      if (mode === "transition") return id === 2 ? boundary : id === 3 && nextBoundary ? typed(local, nextBoundary) : typed(local);
      if (mode === "cue-check" && id === 2 && focusAnswer) return focusAnswer;
      if (mode === "discovery" && local.status === "verified") return {...local, status: "candidate"};
      return local;
    })};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "scene-boundary", text, grant, now: () => 1, provider, prefixUnits,
    verificationTargets: [1, 2, 3], transitionTargets: [1, 2, 3], verifyTransitions: true, negativeStride: 0,
    verifyContinuityBoundary: Boolean(focusAnswer), maxCueChecks: Number(Boolean(focusAnswer)), boundaryVerificationTargets});
}

test("does not apply a primary target-only cut without independent proof", async () => {
  for (const boundary of [typed(neutral(2)), typed(neutral(2), {...cut, previousId: 2}), null]) {
    const {units, summary} = await study({cue: primaryCut, boundary});
    const row = units[2];
    assert.equal(row.primaryPrefix.transition, "scene-cut");
    assert.equal(row.appliedTransition, "none");
    assert.equal(row.transitionFlag, "scene-boundary-unconfirmed");
    assert.equal(row.sceneId, units[1].sceneId);
    assert.notEqual(row.pattern, "Reset");
    if (boundary?.sceneBoundary.previousId === 2) {
      assert.deepEqual(summary.attempts.find(attempt => attempt.mode === "transition" && attempt.targetIds.includes(2)).rejectedFacts,
        [{id: 2, reason: "scene-boundary-evidence"}]);
    }
  }
});

test("a material cut can coexist with a local accent and preserve a new independently enacted onset", async () => {
  const accent = typed({...onset(2), transition: "accent", scopeId: 1}, cut);
  const {units} = await study({cue: id => ({...onset(id), scopeId: 1}), boundary: accent});
  const row = units[2];
  assert.equal(row.primaryPrefix.transition, "onset");
  assert.equal(row.transitionVerification.transition, "accent");
  assert.deepEqual(row.transitionVerification.sceneBoundary, cut);
  assert.equal(row.appliedTransition, "scene-cut");
  assert.equal(row.sceneId, "scene-boundary:scene:2");
  assert.equal(row.beatId, "scene-boundary:beat:2");
  assert.equal(row.pattern, "Onset rise");
});

test("a cut with no fresh onset isolates the scene and discards an old continuation", async () => {
  const cue = id => ({...onset(id), narrativePhase: "sustain", action: "continuation", transition: "none",
    fact: "continue", priorAnchor: 1, evidenceIds: [1, id]});
  for (const options of [{}, {cue}]) {
    const {units} = await study(options);
    const row = units[2];
    assert.equal(row.transitionVerification.status, "neutral");
    assert.equal(row.appliedTransition, "scene-cut");
    assert.deepEqual(row.transitionEvidenceIds, [1, 2]);
    assert.equal(row.sceneId, "scene-boundary:scene:2");
    assert.equal(row.beatId, null);
    assert.equal(row.pattern, "Reset");
  }
});

test("a repeated cut cannot reuse evidence from before the last verified entry", async () => {
  for (const previousId of [1, 2]) {
    const {units} = await study({nextBoundary: {...cut, entryId: 3, previousId}});
    const row = units[3];
    assert.equal(row.appliedTransition, previousId === 1 ? "none" : "scene-cut");
    assert.equal(row.transitionFlag, previousId === 1 ? "scene-boundary-stale" : "transition-conflict");
    assert.equal(row.sceneId, `scene-boundary:scene:${previousId + 1}`);
    assert.deepEqual(row.transitionEvidenceIds, [previousId, 3]);
  }
});

test("two independent no-event judgments can withhold a disputed material cut without affecting a confirmed cut", async () => {
  const neutralCheck = await study({focusAnswer: neutral(2)});
  assert.equal(neutralCheck.units[2].cueRecoveryCorrection, "continuity-cut-veto");
  assert.equal(neutralCheck.units[2].appliedTransition, "none");
  assert.equal(neutralCheck.units[2].transitionVerification.sceneBoundary.status, "cut");
  assert.equal(neutralCheck.units[2].cue, false);
  assert.notEqual(neutralCheck.units[2].pattern, "Reset");

  const uncertain = {...neutral(2), status: "uncertain", transition: "unknown"};
  const confirmed = {...primaryCut(2), evidenceIds: [1, 2], scopeId: 2};
  for (const focusAnswer of [uncertain, confirmed]) {
    const {units} = await study({focusAnswer});
    assert.equal(units[2].appliedTransition, "scene-cut");
    assert.equal(units[2].pattern, "Reset");
  }

  const frameEntry = typed({...primaryCut(2), transition: "reported-entry", frame: "reported"}, cut);
  const {units} = await study({boundary: frameEntry, focusAnswer: neutral(2)});
  assert.equal(units[2].appliedTransition, "reported-entry");
});

test("local hard stops and frame transitions take precedence over the material cut", async () => {
  const stop = typed({...primaryCut(2), transition: "hard-stop", fact: "protective"}, cut);
  const frame = typed({...primaryCut(2), transition: "reported-entry", frame: "reported"}, cut);
  assert.equal(projectTypedTransition(stop), stop);
  assert.equal(projectTypedTransition(frame), frame);
  const {units} = await study({cue: onset, boundary: stop});
  assert.equal(units[2].appliedTransition, "hard-stop");
  assert.equal(units[2].pattern, "Stop");
  assert.equal(units[2].beatId, null);
});

test("the blind boundary arm preserves the control and measures the same pinned prefix", async () => {
  const observed = [], baselineRequests = [];
  const cue = id => ({...onset(id), scopeId: 1});
  const boundary = typed({...onset(2), transition: "accent", scopeId: 1});
  const baseline = await study({cue, boundary, observed: baselineRequests});
  const independent = {...cut, changeId: 2, contrast: "material-change"};
  const studyRun = await study({cue, boundary, observed, boundaryVerificationTargets: [2],
    boundaryAnswer: id => ({status: "ok", facts: [{unitId: id, sceneBoundary: independent}], usage: {inputTokens: 1, outputTokens: 1}})});
  const sent = observed.at(-1);
  const matched = baselineRequests.find(request => request.mode === "transition" && request.targetIds[0] === 2);
  assert.deepEqual(observed.slice(0, -1), baselineRequests);
  assert.deepEqual(sent, {mode: "scene-boundary", units: matched.units, targetIds: matched.targetIds});
  const {boundaryVerification, boundaryVerificationStatus, ...control} = studyRun.units[2];
  assert.deepEqual({...control, boundaryVerification: undefined, boundaryVerificationStatus: undefined}, baseline.units[2]);
  assert.deepEqual(boundaryVerification, {unitId: 2, id: 2, sceneBoundary: independent});
  assert.equal(boundaryVerificationStatus, "cut");
  assert.equal(studyRun.units[2].appliedTransition, "accent");
  const attempt = studyRun.summary.attempts.find(row => row.mode === "scene-boundary");
  assert.deepEqual({targetIds: attempt.targetIds, contextIds: attempt.contextIds, attestedIds: attempt.attestedIds, status: attempt.status},
    {targetIds: [2], contextIds: [0, 1], attestedIds: [], status: "returned"});
});

test("scene-only refusal and invalid evidence stay in the diagnostic lane", async () => {
  const stop = typed({...primaryCut(2), transition: "hard-stop", fact: "protective"});
  const {units, summary} = await study({boundary: stop, boundaryVerificationTargets: [2, 3],
    boundaryAnswer: () => ({status: "refused", usage: {inputTokens: 1, outputTokens: 1}})});
  assert.equal(units[2].appliedTransition, "hard-stop");
  assert.equal(units[2].pattern, "Stop");
  assert.equal(units[2].boundaryVerificationStatus, "provider-refused");
  assert.equal(units[3].boundaryVerificationStatus, "refusal-dependent");
  assert.equal(summary.attempts.filter(row => row.mode === "scene-boundary" && row.attempted).length, 1);

  const badProof = await study({prefixUnits: 2, boundaryVerificationTargets: [2],
    boundaryAnswer: id => ({status: "ok", facts: [{unitId: id,
      sceneBoundary: {...cut, previousId: 0, changeId: 2, contrast: "material-change"}}]})});
  assert.equal(badProof.units[2].boundaryVerificationStatus, "invalid-response");
  assert.deepEqual(badProof.summary.attempts.find(row => row.mode === "scene-boundary").rejectedFacts,
    [{id: 2, reason: "scene-boundary-evidence"}]);
  await assert.rejects(study({boundaryVerificationTargets: [0]}), /pinned transition target/u);
});
