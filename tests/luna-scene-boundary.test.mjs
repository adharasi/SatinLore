import assert from "node:assert/strict";
import test from "node:test";
import {createLunaShadowBudget, runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {projectTypedTransition, startsAtSceneEntry} from "../scripts/lib/luna-transition-verification.mjs";
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
  boundaryVerificationTargets, boundaryAnswer, localActionVerificationTargets, localActionAnswer, transitionAnswer, budget,
  priorCue = onset(1), priorTyped = typed(priorCue), observed = []} = {}) {
  const provider = Object.assign(async request => {
    observed.push(request);
    const {mode, targetIds} = request;
    if (mode === "scene-boundary") return boundaryAnswer(targetIds[0]);
    if (mode === "local-action") return localActionAnswer(targetIds[0]);
    if (mode === "transition" && targetIds[0] === 2 && transitionAnswer) return transitionAnswer;
    if (mode === "transition" && targetIds[0] === 2 && boundary === null) return {status: "invalid-response"};
    return {status: "ok", usage: {inputTokens: 120, outputTokens: 40}, facts: targetIds.map(id => {
      const local = id === 1 ? priorCue : id === 2 ? cue(id) : neutral(id);
      if (mode === "transition") {
        if (id === 1) return priorTyped;
        return id === 2 ? boundary : id === 3 && nextBoundary ? typed(local, nextBoundary) : typed(local);
      }
      if (mode === "cue-check" && id === 2 && focusAnswer) return focusAnswer;
      if (mode === "discovery" && local.status === "verified") return {...local, status: "candidate"};
      return local;
    })};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "scene-boundary", text, grant, now: () => 1, provider, prefixUnits, budget,
    verificationTargets: [1, 2, 3], transitionTargets: [1, 2, 3], verifyTransitions: true, negativeStride: 0,
    verifyContinuityBoundary: Boolean(focusAnswer), maxCueChecks: Number(Boolean(focusAnswer)),
    boundaryVerificationTargets, localActionVerificationTargets});
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

test("an exact local onset after a cut does not borrow evidence from the old scene", async () => {
  const combined = id => ({...onset(id), transition: "scene-cut", fact: "cut", scopeId: 0, evidenceIds: [0, 1, id]});
  const boundary = typed({...onset(2), scopeId: null}, cut);
  const {units} = await study({cue: combined, boundary});
  const entry = units[2];
  assert.equal(entry.appliedTransition, "scene-cut");
  assert.equal(entry.pattern, "Onset rise");
  assert.equal(entry.cue, true);
  assert.equal(entry.sceneId, "scene-boundary:scene:2");
  assert.equal(entry.beatId, "scene-boundary:beat:2");
  assert.equal(entry.knownAt, 2);
  assert.deepEqual(entry.primaryPrefix.evidenceIds, [0, 1, 2]);
  assert.deepEqual(entry.transitionVerification.evidenceIds, [2]);

  for (const [transition, fact] of [["hard-stop", "protective"], ["hard-stop", "neutralize"], ["declined-restart", "neutralize"]]) {
    const stop = {...neutral(1), status: "verified", transition, fact, evidenceIds: [1]};
    const stopped = await study({cue: combined, boundary, priorCue: stop, priorTyped: typed(stop)});
    assert.equal(stopped.units[2].appliedTransition, "scene-cut");
    assert.equal(stopped.units[2].pattern, "Reset");
    assert.equal(stopped.units[2].cue, false);
    assert.equal(stopped.units[2].beatId, null);
  }

  const earlierCut = {...cut, previousId: 0, entryId: 1};
  const stale = await study({cue: id => ({...combined(id), evidenceIds: [0, id]}),
    boundary: {...boundary, sceneBoundary: {...cut, previousId: 0}}, priorCue: neutral(1), priorTyped: typed(neutral(1), earlierCut)});
  assert.equal(stale.units[2].transitionFlag, "scene-boundary-stale");
  assert.notEqual(stale.units[2].appliedTransition, "scene-cut");
  assert.equal(stale.units[2].sceneId, stale.units[1].sceneId);
});

test("a cut's old citations do not qualify a local start without matching evidence roles", () => {
  const boundary = typed({...onset(4), scopeId: null}, {...cut, previousId: 3, entryId: 4});
  const combined = {...onset(4), transition: "scene-cut", fact: "cut", scopeId: 1, evidenceIds: [1, 3, 4]};
  assert.equal(startsAtSceneEntry(combined, boundary, 4), true);
  for (const change of [{action: "continuation"}, {transition: "onset", fact: "none"}, {evidenceIds: [1, 2, 3, 4]},
    {evidenceIds: [1, 4]}, {priorAnchor: 1}]) {
    assert.equal(startsAtSceneEntry({...combined, ...change}, boundary, 4), false);
  }
  for (const change of [{transition: "accent"}, {frame: "reported"}, {scopeId: 1}, {evidenceIds: [3, 4]},
    {sceneBoundary: noBoundary}, {sceneBoundary: {...boundary.sceneBoundary, entryId: 3}}]) {
    assert.equal(startsAtSceneEntry(combined, {...boundary, ...change}, 4), false);
  }
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

const localAction = {status: "verified", frame: "current", action: "contact", phase: "onset", contrast: "enacted",
  targetId: 2, contextId: 1};
const localActionAnswer = unitId => ({status: "ok", usage: {inputTokens: 1, outputTokens: 1}, facts: [{unitId, localAction}]});

test("local action is blinded, after controls, and cannot change playback", async () => {
  const observed = [], baselineRequests = [];
  const baseline = await study({observed: baselineRequests});
  const measured = await study({observed, localActionVerificationTargets: [2], localActionAnswer});
  const sent = observed.at(-1);
  const matched = baselineRequests.find(request => request.mode === "transition" && request.targetIds[0] === 2);
  assert.deepEqual(observed.slice(0, -1), baselineRequests);
  assert.deepEqual(sent, {mode: "local-action", units: matched.units, targetIds: matched.targetIds});
  const {localActionVerification, localActionVerificationStatus, ...control} = measured.units[2];
  assert.deepEqual(control, baseline.units[2]);
  assert.deepEqual(localActionVerification, {id: 2, unitId: 2, localAction});
  assert.equal(localActionVerificationStatus, "verified");
  assert.equal(measured.units[2].appliedTransition, "scene-cut");
  const attempt = measured.summary.attempts.find(row => row.mode === "local-action");
  assert.deepEqual({targetIds: attempt.targetIds, contextIds: attempt.contextIds, attestedIds: attempt.attestedIds, status: attempt.status},
    {targetIds: [2], contextIds: [0, 1], attestedIds: [], status: "returned"});

  const exhausted = await study({budget: createLunaShadowBudget({maxAttempts: baselineRequests.length}),
    localActionVerificationTargets: [2], localActionAnswer});
  assert.equal(exhausted.units[2].localActionVerificationStatus, "budget-deferred");
  assert.equal(exhausted.units[2].appliedTransition, baseline.units[2].appliedTransition);
  assert.equal(exhausted.summary.attempts.find(row => row.mode === "local-action").attempted, undefined);
  await assert.rejects(study({localActionVerificationTargets: [0]}), /pinned transition target/u);
  await assert.rejects(study({localActionVerificationTargets: [2, 2]}), /unique pinned transition target/u);
});

test("local action rejects invalid evidence and isolates refusal from hard stops", async () => {
  const stop = typed({...primaryCut(2), transition: "hard-stop", fact: "protective"});
  const {units, summary} = await study({boundary: stop, localActionVerificationTargets: [2, 3],
    localActionAnswer: () => ({status: "refused", usage: {inputTokens: 1, outputTokens: 1}})});
  assert.equal(units[2].appliedTransition, "hard-stop");
  assert.equal(units[2].pattern, "Stop");
  assert.equal(units[2].localActionVerificationStatus, "provider-refused");
  assert.equal(units[3].localActionVerificationStatus, "refusal-dependent");
  assert.equal(summary.attempts.filter(row => row.mode === "local-action" && row.attempted).length, 1);

  const invalid = await study({prefixUnits: 2, localActionVerificationTargets: [2],
    localActionAnswer: unitId => ({status: "ok", facts: [{unitId, localAction: {...localAction, contextId: 0}}]})});
  assert.equal(invalid.units[2].localActionVerificationStatus, "invalid-response");
  assert.deepEqual(invalid.summary.attempts.find(row => row.mode === "local-action").rejectedFacts,
    [{id: 2, reason: "local-action-evidence", detail: {status: "verified", action: "contact",
      targetEvidence: "exact-target", contextEvidence: "outside-prefix"}}]);
});

test("local action rejection preserves enum-only provider evidence details", async () => {
  const detail = {status: "verified", action: "continuation", targetEvidence: "exact-target", contextEvidence: "missing"};
  for (const [submitted, expected] of [[detail, detail], [{...detail, comment: text}, undefined],
    [{...detail, targetEvidence: text}, undefined], [{...detail, contextEvidence: 45}, undefined]]) {
    const {units, summary} = await study({localActionVerificationTargets: [2], localActionAnswer: unitId => ({
      status: "invalid-response", targetFailures: [{unitId, reason: "local-action-evidence", detail: submitted}],
    })});
    const attempt = summary.attempts.find(row => row.mode === "local-action");
    assert.deepEqual(attempt.rejectedFacts, [{id: 2, reason: "local-action-evidence", ...(expected ? {detail: expected} : {})}]);
    assert.equal(JSON.stringify(attempt).includes(text), false);
    assert.equal(units[2].localActionVerificationStatus, "invalid-response");
    assert.equal(units[2].appliedTransition, "scene-cut");
  }
});

test("typed rejection carries only allowlisted status-effect diagnostics", async () => {
  const detail = {status: "uncertain", frame: "current", transition: "ease", fact: "ease", hasScope: true,
    hasPriorAnchor: false, citesTarget: true, evidenceCount: 1};
  for (const [submitted, expected] of [[detail, detail], [{...detail, comment: text}, undefined],
    [{...detail, status: text}, undefined]]) {
    const transitionAnswer = {status: "invalid-response", targetFailures: [{unitId: 2, reason: "status-effect", detail: submitted}]};
    const {summary} = await study({transitionAnswer});
    const attempt = summary.attempts.find(row => row.mode === "transition" && row.targetIds[0] === 2);
    assert.deepEqual(attempt.rejectedFacts, [{id: 2, reason: "status-effect", ...(expected ? {detail: expected} : {})}]);
    assert.equal(JSON.stringify(attempt).includes(text), false);
  }
});
