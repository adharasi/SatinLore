import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const story = "The hall opened for the dance. They took hands. The clock chimed. The room fell quiet.";
const neutral = unitId => ({unitId, depiction: "neutral", frame: "current", narrativePhase: "quiet", action: "none",
  status: "neutral", transition: "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds: []});
const cut = unitId => ({...neutral(unitId), status: "verified", transition: "scene-cut", fact: "cut",
  scopeId: unitId, evidenceIds: [unitId - 1, unitId]});
const stop = unitId => ({...neutral(unitId), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [unitId]});
const typed = row => ({...row, depiction: "unknown", action: "unknown", narrativePhase: "unknown"});
const linked = (unitId, scopeId = 0) => ({...neutral(unitId), status: "verified", transition: "none", fact: "continue",
  action: "continuation", narrativePhase: "sustain", scopeId, priorAnchor: 1, evidenceIds: [1, unitId]});

async function study({cutPass = "transition", answer = id => linked(id), verifyContinuityBoundary = true,
  blockPrior = false, blockTarget = false, refusal = false, text = story, maxCueChecks = 2,
  releaseUnusedRestartReservation = false, checkFuture = false} = {}) {
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const requests = [];
  const targets = checkFuture ? [1, 2, 3] : [1, 2];
  const result = await runLunaProtocolShadow({id: "continuity-fixture", text, grant, now: () => 1,
    verifyContinuityBoundary, verifyTransitions: true, verificationTargets: targets, transitionTargets: targets,
    maxVerification: targets.length, maxTransitionVerification: targets.length, maxCueChecks, releaseUnusedRestartReservation, negativeStride: 0,
    provider: async request => {
      requests.push(request);
      const {mode, targetIds} = request;
      if (mode === "cue-check" && refusal) return {status: "refused", usage: {inputTokens: 100, outputTokens: 10}};
      return {status: "ok", usage: {inputTokens: 100, outputTokens: 20}, facts: targetIds.map(id => {
        if (mode === "transition") return typed(id === 1 && blockPrior || id === 2 && blockTarget ? stop(id) :
          id === 2 && cutPass === "transition" ? cut(id) : neutral(id));
        if (id === 1 && mode !== "cue-check") return {...neutral(id), status: mode === "discovery" ? "candidate" : "verified",
          depiction: "romantic", action: "contact", narrativePhase: "onset", transition: "onset", scopeId: 0, evidenceIds: [id]};
        if (id === 2 && mode === "verify" && cutPass === "verify") return cut(id);
        if (id === 2 && mode === "discovery" && cutPass === "discovery") return {...neutral(id), status: "candidate",
          transition: "uncertain-continuity", fact: "neutralize", evidenceIds: [id]};
        return mode === "cue-check" ? answer(id) : neutral(id);
      })};
    }});
  return {requests, result, row: result.units[2]};
}

test("a disputed cut keeps both model votes and accepts only a cited, verified same-scope continuation", async () => {
  const {requests, row} = await study();
  const checks = requests.filter(({mode}) => mode === "cue-check");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].focus, "continuity-boundary");
  assert.deepEqual(checks[0].units.map(({id}) => id), [0, 1, 2]);
  assert.equal(row.primaryPrefix.status, "neutral");
  assert.equal(row.transitionVerification.transition, "scene-cut");
  assert.equal(row.cueRecoveryCorrection, "continuity-linked");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.cue, false);
  assert.notEqual(row.pattern, "Reset");
  assert.equal((await study({answer: id => linked(id, 1)})).row.appliedTransition, "scene-cut");
  assert.equal((await study({answer: neutral})).row.appliedTransition, "scene-cut");
});

test("a cited matching cut can settle the reverse disagreement and clears the old beat", async () => {
  const {row} = await study({cutPass: "verify", answer: cut});
  assert.equal(row.transitionVerification.status, "neutral");
  assert.equal(row.cueRecoveryCorrection, "continuity-cut");
  assert.equal(row.appliedTransition, "scene-cut");
  assert.equal(row.pattern, "Reset");
  assert.equal(row.beatId, null);
  const unsupported = await study({cutPass: "verify", answer: id => ({...cut(id), evidenceIds: [id]})});
  assert.equal(unsupported.row.appliedTransition, "none");
  assert.equal(unsupported.row.cueRecoveryGuard, "continuity-unresolved");
});

test("discovery uncertainty can request a scoped link without creating a new cut", async () => {
  assert.equal((await study({cutPass: "discovery"})).row.cueRecoveryCorrection, "continuity-linked");
  assert.equal((await study({cutPass: "discovery", answer: cut})).row.appliedTransition, "none");
});

test("known hard gates and refusal retain precedence over the focused recheck", async () => {
  for (const options of [{blockPrior: true}, {blockTarget: true}, {verifyContinuityBoundary: false}]) {
    const {requests} = await study(options);
    assert.equal(requests.some(({focus}) => focus === "continuity-boundary"), false);
  }
  assert.equal((await study({answer: stop})).row.pattern, "Stop");
  const refused = await study({refusal: true});
  assert.equal(refused.result.summary.attempts.some(({status}) => status === "provider-refused"), true);
  assert.equal(refused.row.pattern, "Baseline");
});

test("a disproved earlier stop hint releases the reserved slot for a later continuity check", async () => {
  const pastHint = {maxCueChecks: 1, text: "The hall opened for the dance. They took hands as the clock stopped. The room fell quiet."};
  const archived = await study(pastHint);
  assert.equal(archived.requests.some(({mode}) => mode === "cue-check"), false);
  assert.equal(archived.result.summary.attempts.find(row => row.id === "cue-check:2").deferralReason, "restart-check-reserved");
  const released = await study({...pastHint, releaseUnusedRestartReservation: true});
  assert.equal(released.requests.find(({mode}) => mode === "cue-check").focus, "continuity-boundary");
  assert.equal(released.row.cueRecoveryCorrection, "continuity-linked");

  const futureHint = await study({maxCueChecks: 1, releaseUnusedRestartReservation: true, checkFuture: true,
    text: "The hall opened for the dance. They took hands. The room fell quiet. The clock stopped."});
  assert.equal(futureHint.result.summary.attempts.find(row => row.id === "cue-check:2").deferralReason, "restart-check-reserved");
});
