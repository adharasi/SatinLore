import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const onset = {...neutral(2), status: "verified", depiction: "romantic", narrativePhase: "onset", action: "contact",
  transition: "onset", scopeId: 0, evidenceIds: [0, 1, 2]};
const accent = {...onset, unitId: 3, narrativePhase: "build", action: "change", transition: "accent", fact: "low", evidenceIds: [2, 3]};
const continuation = {...accent, narrativePhase: "sustain", action: "continuation", transition: "none", fact: "continue", priorAnchor: 2};
const stop = {...neutral(3), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [3]};
const ordinaryEntry = {status: "none", reason: "ordinary-interruption", previousId: null, entryId: null, changeId: null};
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const typedCut = {status: "cut", reason: "time-jump", previousId: 3, entryId: 4};
const currentNoAction = {status: "none", frame: "current", action: "none", phase: "quiet", contrast: "neutral",
  targetId: null, contextId: null};
const usage = {inputTokens: 100, outputTokens: 20};

function run({observed = [], answer = continuation, enabled = true, blockedIds = [], targetEntry = ordinaryEntry,
  targetBoundary = noBoundary, targetText = "Someone knocked.", maxCueChecks = 1, priorAccent = accent,
  disputed = false, verifyAuxiliaryDisagreement = disputed, releaseProof} = {}) {
  const text = `The quartet began. Mira waited near the door. Lee took her hand. Lee drew her closer.\n\n${targetText} The quartet played on.`;
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    observed.push(request);
    if (request.focus === "continuation-repair" && !answer) return {status: "refused", usage};
    const facts = request.targetIds.map(id => {
      if (disputed) {
        if (request.focus === "interruption-release" && id === 4) {
          return releaseProof ?? {...neutral(4), status: "verified", narrativePhase: "sustain", action: "continuation",
            fact: "continue", scopeId: 1, priorAnchor: 3, evidenceIds: [1, 2, 3, 4]};
        }
        if (request.mode === "verify" && id === 2) {
          return {...onset, narrativePhase: "build", transition: "none", fact: "low", evidenceIds: [1, 2]};
        }
        if (request.mode === "verify" && id === 3) return {...onset, unitId: 3, scopeId: 1, evidenceIds: [1, 2, 3]};
        if (request.mode === "discovery" && id === 2) {
          return {...onset, status: "candidate", depiction: "suggestive", scopeId: 1, evidenceIds: [2]};
        }
        if (request.mode === "discovery" && id === 3) {
          return {...accent, status: "candidate", depiction: "suggestive", narrativePhase: "sustain",
            fact: "none", scopeId: 1, evidenceIds: [3]};
        }
      }
      if (request.mode === "cue-check") return request.focus === "continuation-repair" ? answer : neutral(id);
      if (request.mode === "scene-entry") return {unitId: id, sceneEntry: id === 4 ? targetEntry : ordinaryEntry};
      if (request.mode === "local-action") return {unitId: id, localAction: currentNoAction};
      if (request.mode === "transition") return {...neutral(id), depiction: "unknown", action: "unknown", narrativePhase: "unknown",
        sceneBoundary: id === 4 ? targetBoundary : noBoundary};
      if (request.mode === "verify") return id === 2 ? onset : id === 3 ? priorAccent : neutral(id);
      if (id === 2) return {...onset, status: "candidate", scopeId: 2, evidenceIds: [2]};
      if (id === 3) return {...accent, status: "candidate", narrativePhase: "sustain", fact: "none", scopeId: 2, evidenceIds: [3]};
      return neutral(id);
    });
    return {status: "ok", usage, facts};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "auxiliary-continuation", text, grant, now: () => 1, provider, blockedIds,
    verificationTargets: [1, 4], maxVerification: 2, transitionTargets: [1, 4], maxTransitionVerification: 2,
    maxSupportingVerification: 2, negativeStride: 0, verifyTransitions: true, maxCueChecks,
    sceneEntryVerificationTargets: [4], localActionVerificationTargets: [4], uncertainContinuationArbitration: enabled,
    interruptionReleaseArbitration: disputed, verifyAuxiliaryDisagreement});
}

test("a blind continuation proof carries only the quiet native target", async () => {
  const observed = [], control = await run({enabled: false}), actual = await run({observed});
  const [opener, proof, target, next] = actual.units.slice(2);
  const requests = observed.filter(request => request.focus === "continuation-repair");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].targetIds, [3]);
  assert.deepEqual(requests[0].units.map(({id}) => id), [0, 1, 2, 3]);
  assert.equal(requests[0].attested, undefined);
  assert.equal(actual.summary.attempts.find(row => row.cueCheckReason === "auxiliary-continuation").attempted, true);
  assert.equal(proof.interruptionContinuationVerificationStatus, "verified");
  assert.deepEqual(proof.interruptionContinuationVerification.evidenceIds, [2, 3]);
  for (const support of [opener, proof]) {
    assert.equal(support.pattern, "Baseline");
    assert.equal(support.cue, false);
    assert.equal(support.readerCue, false);
    assert.deepEqual(support.trace, control.units[support.id].trace);
  }
  assert.equal(control.units[4].pattern, "Baseline");
  assert.equal(target.pattern, "Sustain wave");
  assert.equal(target.phase, "quiet");
  assert.equal(target.appliedTransition, "none");
  assert.equal(target.cue, false);
  assert.equal(target.readerCue, false);
  assert.equal(target.trace.decision, "Carry verified supporting beat");
  assert.equal(target.trace.knownAt, 3);
  assert.deepEqual(target.trace.evidence, [2, 3]);
  assert.equal(target.trace.holdWords, 32);
  assert.equal(target.trace.fadeWords, 48);
  assert.equal(target.trace.floorWords, 0);
  assert.deepEqual(next, control.units[5]);
});

test("support alone, wrong links and refusal leave the native target quiet", async () => {
  for (const answer of [neutral(3), {...continuation, scopeId: 1}, {...continuation, evidenceIds: [0, 2, 3]},
    {...continuation, priorAnchor: 1}, {...continuation, frame: "reported"}, null]) {
    const {units} = await run({answer});
    if (answer) assert.ok(["unconfirmed", "invalid-response"].includes(units[3].interruptionContinuationVerificationStatus));
    else assert.equal(units[3].interruptionContinuationVerificationStatus, "provider-refused");
    assert.equal(units[4].pattern, "Baseline");
    assert.equal(units[4].cue, false);
  }
  const actual = await run({answer: stop});
  assert.equal(actual.units[3].interruptionContinuationVerificationStatus, "protective-override");
  assert.equal(actual.units[3].pattern, "Stop");
  assert.equal(actual.units[4].pattern, "Baseline");
});

test("a first entry, typed cut, elapsed interval, missing support or budget excludes the proof", async () => {
  for (const options of [{targetEntry: {status: "cut", reason: "material-objective", previousId: 3, changeId: 4, entryId: 4}},
    {targetEntry: {...ordinaryEntry, reason: "routine-movement"}}, {targetBoundary: typedCut},
    {targetText: "A few minutes later, someone knocked."}, {priorAccent: {...accent, scopeId: 1}}, {blockedIds: [3]}, {maxCueChecks: 0}]) {
    const observed = [], {units} = await run({...options, observed});
    assert.equal(observed.some(request => request.focus === "continuation-repair"), false, JSON.stringify(options));
    assert.notEqual(units[4].pattern, "Sustain wave");
  }
});

test("a failed release check can nominate one blind support check after the cue allowance", async () => {
  const observed = [];
  const actual = await run({disputed: true, observed, answer: {...continuation, scopeId: 1}});
  const focused = observed.filter(request => request.focus);
  assert.deepEqual(focused.map(({focus, targetIds}) => [focus, targetIds]), [
    ["interruption-release", [4]], ["continuation-repair", [3]],
  ]);
  assert.deepEqual(focused[1].units.map(({id}) => id), [0, 1, 2, 3]);
  assert.equal(focused[1].attested, undefined);
  assert.equal(actual.units[4].interruptionReleaseVerificationStatus, "unconfirmed");
  assert.equal(actual.units[3].interruptionContinuationVerificationStatus, "verified");
  assert.deepEqual(actual.units.map(row => row.pattern), [
    "Baseline", "Baseline", "Baseline", "Baseline", "Sustain wave", "Baseline",
  ]);
  assert.deepEqual(actual.units[4].trace.evidence, [2, 3]);
});

test("neutral proof or an unrelated release reply cannot carry disputed supporting actions", async () => {
  const negative = await run({disputed: true, answer: neutral(3)});
  assert.equal(negative.units[3].interruptionContinuationVerificationStatus, "unconfirmed");
  assert.equal(negative.units[4].pattern, "Baseline");
  for (const options of [{releaseProof: neutral(4)}, {verifyAuxiliaryDisagreement: false}]) {
    const observed = [];
    const actual = await run({disputed: true, observed, ...options});
    assert.equal(observed.some(request => request.focus === "continuation-repair"), false);
    assert.equal(actual.units[4].pattern, "Baseline");
  }
});
