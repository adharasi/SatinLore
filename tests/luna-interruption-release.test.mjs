import assert from "node:assert/strict";
import test from "node:test";
import {createLunaProtocolProvider, LUNA_PROTOCOL_MODEL} from "../scripts/lib/luna-protocol-provider.mjs";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const text = "The last dance began. Mira took Lee's hand. They crossed the floor. Lee drew Mira closer. A falling glass startled them and their steps slowed. The quartet kept playing.";
const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
const sourceUnits = units.map(({id, text}) => ({id, text}));
const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
  spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
const usage = {inputTokens: 100, outputTokens: 20};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const onset = {...neutral(1), status: "verified", depiction: "romantic", narrativePhase: "onset", action: "contact",
  transition: "onset", scopeId: 0, evidenceIds: [0, 1]};
const sustain = {...onset, unitId: 3, narrativePhase: "sustain", transition: "none", scopeId: 1, evidenceIds: [1, 3]};
const cut = {status: "cut", reason: "objective-shift", previousId: 3, entryId: 4};
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const noEntry = {status: "none", reason: "ordinary-interruption", previousId: null, entryId: null, changeId: null};
const oldScope = {...neutral(4), status: "verified", transition: "scene-cut", fact: "cut", scopeId: 0, evidenceIds: [3, 4]};
const release = {...neutral(4), status: "verified", transition: "interruption", fact: "ease", narrativePhase: "ease",
  scopeId: 0, evidenceIds: [3, 4], priorAnchor: 3};
const stop = {...neutral(4), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [4]};

function run({observed = [], enabled = true, maxCueChecks = 2, boundary = cut, entry = noEntry, answer = release,
  blockedIds = []} = {}) {
  const provider = Object.assign(async request => {
    observed.push(request);
    const [id] = request.targetIds;
    const facts = request.targetIds.map(id => {
      if (request.mode === "cue-check") return request.focus === "interruption-release" ? answer : oldScope;
      if (request.mode === "scene-entry") return {unitId: id, sceneEntry: entry};
      if (request.mode === "transition") return {...neutral(id), depiction: "unknown", action: "unknown", narrativePhase: "unknown",
        sceneBoundary: id === 4 ? boundary : noBoundary};
      const local = id === 1 ? onset : id === 3 ? sustain : neutral(id);
      return request.mode === "discovery" && local.status === "verified" ? {...local, status: "candidate"} : local;
    });
    if (request.mode === "cue-check") assert.equal(id, 4);
    return {status: "ok", usage, facts};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "interruption", text, grant, now: () => 1, provider, blockedIds, negativeStride: 0,
    verificationTargets: units.map(({id}) => id), transitionTargets: [3, 4], verifyTransitions: true,
    verifyContinuityBoundary: true, maxCueChecks, sceneEntryVerificationTargets: [3, 4], interruptionReleaseArbitration: enabled});
}

test("independent exact release tapers the already-open beat without adding a cue or rewriting history", async () => {
  const control = await run({enabled: false});
  const observed = [], candidate = await run({observed});
  const row = candidate.units[4];
  assert.equal(control.units[4].cueRecoveryCorrection, "continuity-old-scope-veto");
  assert.equal(control.units[4].pattern, "Sustain wave");
  assert.equal(row.primaryPrefix.transition, "none");
  assert.equal(row.cueRecovery.transition, "scene-cut");
  assert.equal(row.appliedTransition, "interruption");
  assert.equal(row.pattern, "Taper");
  assert.equal(row.phase, "ease");
  assert.equal(row.interruptionReleaseVerificationStatus, "verified");
  assert.equal(row.interruptionReleaseApplication, "interruption-taper");
  assert.deepEqual(row.interruptionReleaseVerification.evidenceIds, [3, 4]);
  assert.deepEqual(row.evidenceIds, [3, 4]);
  assert.equal(row.knownAt, 4);
  assert.equal(row.beatId, candidate.units[3].beatId);
  assert.equal(row.sceneId, candidate.units[3].sceneId);
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.deepEqual(candidate.units.slice(0, 4), control.units.slice(0, 4));
  const requests = observed.filter(request => request.focus === "interruption-release");
  assert.deepEqual(requests, [{mode: "cue-check", units: sourceUnits.slice(0, 5), targetIds: [4], focus: "interruption-release"}]);
  assert.equal(candidate.summary.attempts.filter(row => row.mode === "cue-check" && row.attempted).length, 2);
});

test("release evidence needs the exact predecessor, effect, frame, and available budget", async () => {
  for (const answer of [neutral(4), {...release, scopeId: 2}, {...release, priorAnchor: null},
    {...release, fact: "none"}, {...release, action: "change"}, {...release, frame: "reported"}]) {
    const {units: compared} = await run({answer});
    assert.equal(compared[4].interruptionReleaseApplication, undefined);
    assert.equal(compared[4].appliedTransition, "none");
    assert.equal(compared[4].pattern, "Sustain wave");
  }
  const exhausted = await run({maxCueChecks: 1});
  assert.equal(exhausted.units[4].interruptionReleaseVerificationStatus, "budget-deferred");
  assert.equal(exhausted.summary.attempts.find(row => row.focus === "interruption-release").deferralReason, "cue-check-limit");
  assert.equal(exhausted.units[4].pattern, "Sustain wave");
});

test("an interruption check leaves real boundaries and blocked targets in control", async () => {
  for (const options of [{boundary: {...cut, reason: "time-jump"}},
    {entry: {...noEntry, reason: "routine-movement"}}, {blockedIds: [4]}]) {
    const observed = [], candidate = await run({...options, observed});
    assert.equal(observed.some(request => request.focus === "interruption-release"), false);
    assert.equal(candidate.units[4].interruptionReleaseApplication, undefined);
    if (options.blockedIds) assert.equal(candidate.units[4].pattern, "Stop");
  }
  const stopped = await run({answer: stop});
  assert.equal(stopped.units[4].interruptionReleaseVerificationStatus, "protective-override");
  assert.equal(stopped.units[4].interruptionReleaseApplication, undefined);
  assert.equal(stopped.units[4].appliedTransition, "hard-stop");
  assert.equal(stopped.units[4].pattern, "Stop");
});

const continuation = {...sustain, action: "continuation", scopeId: 0, fact: "continue", priorAnchor: 1};
const continuationDispute = {...neutral(3), status: "verified", depiction: "romantic", transition: "scene-cut", fact: "cut",
  scopeId: 0, evidenceIds: [0, 1, 2, 3]};

function runRepair({observed = [], answer = continuation, releaseAnswer = release, maxCueChecks = 2,
  blockedIds = [], priorAnswer = onset, connector = neutral(2), entryReason = "same-episode"} = {}) {
  const provider = Object.assign(async request => {
    observed.push(request);
    const facts = request.targetIds.map(id => {
      if (request.mode === "cue-check") {
        return request.focus === "continuation-repair" ? answer : releaseAnswer;
      }
      if (request.mode === "scene-entry") return {unitId: id,
        sceneEntry: id === 3 ? {...noEntry, reason: entryReason} : noEntry};
      if (request.mode === "local-action") return {unitId: id, localAction: id === 3 ?
        {status: "verified", frame: "current", action: "continuation", phase: "sustain", contrast: "same-action",
          targetId: id, contextId: 1} :
        {status: "none", frame: "noncurrent", action: "none", phase: "quiet", contrast: "noncurrent",
          targetId: null, contextId: null}};
      if (request.mode === "transition") return {...neutral(id), depiction: "unknown", action: "unknown", narrativePhase: "unknown",
        sceneBoundary: noBoundary};
      if (request.mode === "verify") return id === 1 ? priorAnswer : id === 3 ? continuationDispute : neutral(id);
      if (id === 1) return {...onset, status: "candidate", scopeId: id};
      if (id === 2) return connector;
      if (id === 3) return {...continuation, status: "candidate", scopeId: 1};
      if (id === 4) return {...oldScope, status: "candidate", scopeId: id};
      return neutral(id);
    });
    return {status: "ok", usage, facts};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "interruption-repair", text, grant, now: () => 1, provider, blockedIds,
    verificationTargets: [3, 4], maxVerification: 2, transitionTargets: [3, 4], maxTransitionVerification: 2,
    verifyTransitions: true, negativeStride: 0,
    verifyContinuityBoundary: true, maxCueChecks, maxSupportingVerification: 2,
    localActionVerificationTargets: [3, 4], sceneEntryVerificationTargets: [3, 4], interruptionReleaseArbitration: true});
}

test("a verified short continuation can resolve an unchecked cut before an independent taper", async () => {
  const observed = [], {units: compared, summary} = await runRepair({observed});
  const [prior, connector, sustain, taper] = compared.slice(1, 5);
  assert.equal(prior.pattern, "Baseline");
  assert.equal(connector.pattern, "Baseline");
  assert.equal(sustain.primaryPrefix.transition, "scene-cut");
  assert.equal(sustain.pattern, "Sustain wave");
  assert.equal(sustain.phase, "sustain");
  assert.equal(sustain.cue, false);
  assert.equal(sustain.readerCue, true);
  assert.equal(sustain.interruptionContinuationApplication, "linked-sustain");
  assert.equal(sustain.interruptionContinuationVerificationStatus, "verified");
  assert.deepEqual(sustain.evidenceIds, [1, 3]);
  assert.equal(taper.pattern, "Taper");
  assert.equal(taper.appliedTransition, "interruption");
  assert.equal(taper.interruptionReleaseApplication, "interruption-taper");
  assert.equal(taper.beatId, sustain.beatId);
  assert.equal(taper.sceneId, sustain.sceneId);
  assert.deepEqual(taper.evidenceIds, [3, 4]);
  assert.equal(taper.readerCue, false);
  assert.deepEqual(observed.filter(request => request.mode === "cue-check"), [
    {mode: "cue-check", units: sourceUnits.slice(0, 4), targetIds: [3], focus: "continuation-repair"},
    {mode: "cue-check", units: sourceUnits.slice(0, 5), targetIds: [4], focus: "interruption-release"},
  ]);
  assert.equal(summary.attempts.filter(row => row.mode === "cue-check" && row.attempted).length, 2);
});

test("the continuation requires exact positive support and keeps boundary, protection and quota priority", async () => {
  const priorStop = {...neutral(1), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [1]};
  const targetStop = {...neutral(3), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [3]};
  for (const options of [{answer: neutral(3)}, {answer: {...continuation, scopeId: 2}},
    {answer: {...continuation, evidenceIds: [0, 1, 3]}}, {answer: {...continuation, frame: "reported"}},
    {priorAnswer: neutral(1)}, {priorAnswer: priorStop}, {blockedIds: [2]},
    {entryReason: "routine-movement"}, {connector: {...neutral(2), evidenceIds: [2]}}, {answer: targetStop}]) {
    const observed = [], {units: compared} = await runRepair({...options, observed});
    assert.equal(compared[3].interruptionContinuationApplication, undefined);
    assert.equal(compared[3].readerCue, false);
    assert.equal(compared[4].interruptionReleaseApplication, undefined);
    assert.equal(observed.some(request => request.focus === "interruption-release"), false);
    if (options.answer === targetStop) {
      assert.equal(compared[3].pattern, "Stop");
      assert.equal(compared[3].interruptionContinuationVerificationStatus, "protective-override");
    }
  }
  const exhausted = await runRepair({maxCueChecks: 1});
  assert.equal(exhausted.units[3].interruptionContinuationApplication, "linked-sustain");
  assert.equal(exhausted.units[4].interruptionReleaseVerificationStatus, "budget-deferred");
  assert.equal(exhausted.units[4].interruptionReleaseApplication, undefined);
});

test("the provider accepts an independent release prefix and rejects an attached attestation", async () => {
  let calls = 0;
  const provider = createLunaProtocolProvider({apiKey: "fixture", fetchImpl: async () => {
    calls++;
    return Response.json({model: LUNA_PROTOCOL_MODEL, status: "completed", output: [
      {type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({facts: [release]})}]},
    ]});
  }});
  const request = {mode: "cue-check", units: sourceUnits.slice(0, 5), targetIds: [4], focus: "interruption-release"};
  assert.deepEqual((await provider(request)).facts, [release]);
  assert.equal((await provider({...request, units: sourceUnits.slice(1, 5), attested: [
    {unitId: 0, scopeId: 0, frame: "current", action: "contact", narrativePhase: "sustain"}]})).status, "invalid-request");
  assert.equal((await provider({...request, focus: "continuation-repair", units: sourceUnits.slice(1, 5), attested: [
    {unitId: 0, scopeId: 0, frame: "current", action: "contact", narrativePhase: "sustain"}]})).status, "invalid-request");
  assert.equal(calls, 1);
});
