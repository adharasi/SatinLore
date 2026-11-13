import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const buildup = (unitId, status = "verified", evidenceIds = [unitId]) => ({...neutral(unitId), status,
  depiction: "romantic", narrativePhase: "build", action: "anticipation", fact: "low", scopeId: 0, evidenceIds});
const exactSupport = buildup(2, "verified", [1, 2]);
const sameEpisode = {status: "none", reason: "same-episode", previousId: null, changeId: null, entryId: null};
const quietBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const chargedReaction = {status: "verified", frame: "current", action: "anticipation", phase: "build",
  contrast: "charged-reaction", targetId: 1, contextId: 0};

function run({support = exactSupport, supportFailure, rejected = "status-effect", entry = sameEpisode, blockedIds = [],
  maxCueChecks = 2, requests = [], gap = "She felt a rising warmth at the way he looked at her while the piano played across the hall and the other guests finished their quiet conversation nearby."} = {}) {
  const text = `June noticed Lee waiting by the window. His smile caught her attention. ${gap}\n\n` +
    "They waited near the open door while the last of the musicians packed away their instruments. A chair scraped.";
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  assert.equal(units.length, 5);
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    requests.push(request);
    const {mode, targetIds} = request;
    if (mode === "cue-check" && request.focus === "buildup" && targetIds[0] === 2) {
      if (supportFailure) return {status: supportFailure};
      return {status: "ok", facts: [support]};
    }
    if (mode === "discovery") {
      const partial = targetIds.includes(2);
      return {status: partial ? "partial" : "ok",
        targetFailures: partial ? [{unitId: 2, reason: rejected}] : [],
        facts: targetIds.filter(id => id !== 2).map(id => id < 2 ? buildup(id, "candidate") : neutral(id))};
    }
    return {status: "ok", facts: targetIds.map(id => {
      if (mode === "scene-entry") return {unitId: id, sceneEntry: entry};
      if (mode === "local-action") return {unitId: id, localAction: chargedReaction};
      if (mode === "transition") return {...neutral(id), depiction: "unknown", narrativePhase: "unknown", action: "unknown",
        sceneBoundary: quietBoundary};
      return mode === "verify" && id < 2 ? buildup(id) : neutral(id);
    })};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "discovery-gap", text, grant, now: () => 1, provider, blockedIds, negativeStride: 0,
    verificationTargets: [1, 4], transitionTargets: [1, 4], verifyTransitions: true,
    maxVerification: 2, maxTransitionVerification: 2, maxSupportingVerification: 2,
    localActionVerificationTargets: [1], sceneEntryVerificationTargets: [1],
    verificationContext: "attested", uncertainContinuationArbitration: true, maxCueChecks});
}

const gapRequest = requests => requests.find(request => request.mode === "cue-check" && request.targetIds[0] === 2);

test("an invalid discovery gap can renew only the already-held low beat using blind exact support", async () => {
  const requests = [];
  const {units} = await run({requests});
  const request = gapRequest(requests);
  assert.equal(request?.focus, "buildup");
  assert.deepEqual(request.units.map(unit => unit.id), [0, 1, 2]);
  assert.equal(request.attestedAnchors, undefined);
  const [opening, anchor, gap, , successor] = units;
  assert.equal(anchor.pattern, "Gradual build");
  assert.equal(gap.pattern, "Undertone");
  assert.equal(gap.cue, false);
  assert.equal(gap.readerCue, false);
  assert.equal(gap.cueRecoveryCorrection, "discovery-gap-renewal");
  assert.equal(gap.trace.decision, "Renew low envelope");
  assert.equal(gap.trace.knownAt, 2);
  assert.deepEqual(gap.trace.evidence, [1, 2]);
  assert.equal(successor.pattern, "Undertone");
  assert.equal(successor.phase, "quiet");
  assert.equal(successor.trace.beat, opening.trace.beat);
  assert.equal(successor.trace.scene, anchor.trace.scene);
  assert.equal(successor.trace.knownAt, 2);
  assert.equal(successor.trace.holdWords, 16);
  assert.equal(successor.trace.fadeWords, 32);
});

test("quiet, imprecise, unavailable or refused proof keeps the invalid gap and does not renew the beat", async () => {
  for (const options of [{support: neutral(2)}, {support: {...exactSupport, scopeId: 1}},
    {support: {...exactSupport, evidenceIds: [2]}}, {supportFailure: "failed"}, {supportFailure: "refused"}]) {
    const requests = [];
    const {units} = await run({...options, requests});
    assert.ok(gapRequest(requests));
    assert.equal(units[2].cueRecoveryReason, "discovery-gap-support");
    assert.equal(units[2].cueRecoveryCorrection, undefined);
    assert.equal(units[2].pattern, "Baseline");
    assert.equal(units[4].pattern, "Baseline");
  }
});

test("gap checking skips boundary conflict, elapsed time, nonmatching errors and exhausted budget", async () => {
  for (const options of [{entry: {...sameEpisode, reason: "routine-movement"}}, {blockedIds: [2]},
    {gap: "Several hours later, she returned to the hall."}, {rejected: "missing-target"}, {maxCueChecks: 0}]) {
    const requests = [];
    const {units} = await run({...options, requests});
    assert.equal(gapRequest(requests), undefined);
    assert.equal(units[2].cueRecoveryCorrection, undefined);
    assert.equal(units[4].pattern, "Baseline");
  }
});

test("an exact protective verdict overrides recovery and closes the beat", async () => {
  const stop = {...neutral(2), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [2]};
  const {units} = await run({support: stop});
  assert.equal(units[2].cueRecoveryStatus, "protective-override");
  assert.equal(units[2].cueRecoveryCorrection, undefined);
  assert.equal(units[2].pattern, "Stop");
  assert.equal(units[4].pattern, "Baseline");
});
