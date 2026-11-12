import assert from "node:assert/strict";
import test from "node:test";
import {planStory} from "../app/static/reader/beat-continuity.mjs";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const onset = {...neutral(1), status: "verified", depiction: "romantic", narrativePhase: "onset", action: "contact",
  transition: "onset", scopeId: 1, evidenceIds: [0, 1]};
const sustain = {...neutral(3), status: "verified", depiction: "romantic", narrativePhase: "sustain", action: "continuation",
  fact: "continue", scopeId: 0, evidenceIds: [0, 1, 3], priorAnchor: 1};
const sustainProposal = {...sustain, status: "candidate", fact: "none", scopeId: 1, evidenceIds: [1, 3], priorAnchor: null};
const local = {status: "verified", frame: "current", action: "continuation", phase: "sustain", contrast: "same-action", targetId: 3, contextId: 1};
const entry = {status: "none", reason: "same-episode", previousId: null, changeId: null, entryId: null};
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const timeCut = {status: "cut", reason: "time-jump", previousId: 2, entryId: 3};
const stop = unitId => ({...neutral(unitId), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [unitId]});

function run({opening = onset, openingProposal = {...onset, status: "candidate"}, continuation = sustain, proposal = sustainProposal,
  localVote = local, sceneEntry = entry, targetBoundary = noBoundary, connectorVote = neutral(2), rootVote = neutral(0),
  connector = "The lights dimmed.", blockedIds = [], supporting = 1, requests = [], targetTransition = {},
  uncertainContinuationArbitration = false, maxCueChecks = 0, confirmation = null, confirmationFailure = null} = {}) {
  const text = `Mira waited by the door. Lee took her hand. ${connector} Lee kept holding her hand. Someone knocked.`;
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    requests.push(request);
    const {mode, targetIds} = request;
    if (request.focus === "continuation-repair" && confirmationFailure) return {status: confirmationFailure};
    return {status: "ok", usage: {inputTokens: 100, outputTokens: 20}, facts: targetIds.map(id => {
      if (request.focus === "continuation-repair") return confirmation ?? neutral(id);
      if (mode === "scene-entry") return {unitId: id, sceneEntry};
      if (mode === "local-action") return {unitId: id, localAction: localVote};
      if (mode === "transition") return {...neutral(id), depiction: "unknown", narrativePhase: "unknown", action: "unknown",
        ...(id === 3 ? targetTransition : {}), sceneBoundary: id === 3 ? targetBoundary : noBoundary};
      if (id === 0) return rootVote;
      if (id === 1) return mode === "discovery" ? openingProposal : opening;
      if (id === 2) return connectorVote;
      if (id === 3) return mode === "discovery" ? proposal : continuation;
      return neutral(id);
    })};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "sustain-scope", text, grant, now: () => 1, provider, blockedIds, negativeStride: 0,
    verificationTargets: [3, 4], transitionTargets: [3, 4], verifyTransitions: true,
    maxVerification: 2, maxTransitionVerification: 2, maxSupportingVerification: Number(supporting),
    localActionVerificationTargets: localVote ? [3] : [], sceneEntryVerificationTargets: [3],
    uncertainContinuationArbitration, maxCueChecks});
}

test("exact continuation with different scope citations selects sustain on the existing held beat only", async () => {
  const controlRequests = [], candidateRequests = [];
  const neutralLocal = {status: "none", frame: "current", action: "none", phase: "quiet", contrast: "neutral", targetId: null, contextId: null};
  const control = await run({localVote: neutralLocal, requests: controlRequests});
  const candidate = await run({requests: candidateRequests});
  const row = candidate.units[3];
  assert.equal(control.units[3].pattern, "Onset rise");
  assert.equal(row.pattern, "Sustain wave");
  assert.equal(row.phase, "sustain");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.scopeId, 0);
  assert.equal(row.priorAnchor, 1);
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(row.localActionApplication, "sustain-scope-profile");
  assert.equal(row.trace.decision, "Select local sustain");
  assert.equal(row.trace.beat, control.units[3].trace.beat);
  assert.equal(row.trace.scene, control.units[3].trace.scene);
  assert.equal(row.trace.holdWords, control.units[3].trace.holdWords);
  assert.equal(row.trace.fadeWords, control.units[3].trace.fadeWords);
  assert.equal(row.trace.floorWords, control.units[3].trace.floorWords);
  assert.equal(row.trace.knownAt, 3);
  assert.deepEqual(row.trace.evidence, [0, 1, 3]);
  assert.deepEqual(candidate.units.slice(0, 3), control.units.slice(0, 3));
  assert.deepEqual(candidate.units[4], control.units[4]);
  assert.deepEqual(candidateRequests, controlRequests);
});

test("scope disagreement cannot elevate the waveform without exact independent agreement and reviewed short context", async () => {
  for (const options of [{localVote: null}, {localVote: {...local, contextId: 2}}, {sceneEntry: {...entry, reason: "routine-movement"}},
    {proposal: {...sustainProposal, scopeId: 0}}, {opening: {...onset, evidenceIds: [1]}}, {openingProposal: {...onset, status: "candidate", evidenceIds: [1]}},
    {connectorVote: {...neutral(2), frame: "reported"}}, {rootVote: {...neutral(0), frame: "reported"}},
    {connector: "While they stood there the people nearest the windows drew the heavy curtains slowly closed for the night."},
    {supporting: false}, {blockedIds: [0]}, {blockedIds: [2]}]) {
    const {units} = await run(options);
    assert.notEqual(units[3].localActionApplication, "sustain-scope-profile", JSON.stringify(options));
    assert.notEqual(units[3].pattern, "Sustain wave", JSON.stringify(options));
  }
});

test("a genuine boundary or protective stop outranks otherwise matching local sustain evidence", async () => {
  const cut = await run({targetBoundary: timeCut});
  assert.equal(cut.units[3].pattern, "Reset");
  assert.equal(cut.units[3].localActionApplication, undefined);
  const stopped = await run({continuation: stop(3)});
  assert.equal(stopped.units[3].pattern, "Stop");
  assert.equal(stopped.units[3].localActionApplication, undefined);
  assert.equal(stopped.units[4].pattern, "Baseline");
  const priorStop = await run({opening: stop(1)});
  assert.equal(priorStop.units[1].pattern, "Stop");
  assert.equal(priorStop.units[3].localActionApplication, undefined);
});

const rootedContinuation = {...sustain, evidenceIds: [1, 3]};

const exactScopedContinuation = {
  continuation: rootedContinuation, proposal: {...rootedContinuation, status: "candidate", scopeId: 1},
  sceneEntry: {...entry, reason: "ordinary-interruption"},
};

test("same action evidence lets an independently attested opener supply the earlier scene citation", async () => {
  const requests = [], controlRequests = [];
  const candidate = await run({...exactScopedContinuation, requests});
  const control = await run({...exactScopedContinuation, localVote: {...local, contextId: 2}, requests: controlRequests});
  const row = candidate.units[3];
  assert.equal(row.pattern, "Sustain wave");
  assert.equal(row.localActionApplication, "sustain-scope-profile");
  assert.equal(row.phase, "sustain");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.scopeId, 0);
  assert.equal(row.priorAnchor, 1);
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(row.trace.knownAt, 3);
  assert.deepEqual(row.trace.evidence, [1, 3]);
  assert.equal(control.units[3].pattern, "Onset rise");
  for (const field of ["beat", "scene", "holdWords", "fadeWords", "floorWords"]) {
    assert.equal(row.trace[field], control.units[3].trace[field]);
  }
  assert.deepEqual(candidate.units.slice(0, 3), control.units.slice(0, 3));
  assert.deepEqual(candidate.units[4], control.units[4]);
  assert.deepEqual(requests, controlRequests);
});

test("an interruption without both exact continuation votes cannot select a sustain waveform", async () => {
  for (const options of [{continuation: neutral(3)}, {proposal: {...sustainProposal, scopeId: 1}},
    {proposal: {...exactScopedContinuation.proposal, fact: "neutralize", transition: "uncertain-continuity"}},
    {opening: {...onset, evidenceIds: [1]}}, {localVote: null}, {targetBoundary: timeCut},
    {continuation: stop(3)}, {connectorVote: stop(2)}, {blockedIds: [2]},
    {targetTransition: {status: "verified", transition: "uncertain-continuity", fact: "neutralize", evidenceIds: [3]}},
    {connector: `${"The people near the windows drew the curtains slowly closed for the night ".repeat(4).trim()}.`}]) {
    const {units} = await run({...exactScopedContinuation, ...options});
    assert.notEqual(units[3].pattern, "Sustain wave", JSON.stringify(options));
    assert.notEqual(units[3].localActionApplication, "sustain-scope-profile", JSON.stringify(options));
  }
});

const rooted = {
  openingProposal: {...onset, status: "candidate", scopeId: 0, evidenceIds: [1]},
  continuation: rootedContinuation, proposal: {...rootedContinuation, status: "candidate"},
  sceneEntry: {...entry, reason: "ordinary-interruption"}, supporting: 2,
};

test("exact quiet root and onset independently establish the supporting opener before a local sustain", async () => {
  const requests = [];
  const candidate = await run({...rooted, requests});
  const withoutLocalVote = await run({...rooted, localVote: null});
  const start = candidate.units[1];
  assert.equal(start.pattern, "Onset rise");
  assert.equal(start.playbackDisposition, "supporting-rooted-onset");
  assert.equal(start.cue, false);
  assert.equal(start.readerCue, false);
  assert.equal(start.trace.knownAt, 1);
  assert.deepEqual(start, withoutLocalVote.units[1]);
  const request = requests.find(request => request.mode === "verify" && request.targetIds[0] === 1);
  assert.deepEqual(request.units.map(unit => unit.id), [0, 1]);

  const row = candidate.units[3];
  assert.equal(row.pattern, "Sustain wave");
  assert.equal(row.localActionApplication, "sustain-scope-profile");
  assert.equal(row.scopeId, 0);
  assert.equal(row.priorAnchor, 1);
  assert.equal(row.phase, "sustain");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(row.trace.knownAt, 3);
  assert.deepEqual(row.trace.evidence, [1, 3]);
  assert.equal(withoutLocalVote.units[3].pattern, "Onset rise");
  for (const field of ["beat", "scene", "holdWords", "fadeWords", "floorWords"]) {
    assert.equal(row.trace[field], withoutLocalVote.units[3].trace[field]);
  }
  assert.deepEqual(candidate.units[4], withoutLocalVote.units[4]);
});

test("rooted support requires an exact quiet premise and holds no authority across a boundary", async () => {
  for (const options of [{supporting: 1}, {rootVote: {...neutral(0), frame: "reported"}}, {rootVote: stop(0)},
    {rootVote: {...neutral(0), evidenceIds: [0]}}, {opening: {...onset, evidenceIds: [1]}},
    {openingProposal: {...rooted.openingProposal, evidenceIds: [0, 1]}}, {blockedIds: [0]}]) {
    const {units} = await run({...rooted, ...options});
    assert.notEqual(units[1].playbackDisposition, "supporting-rooted-onset", JSON.stringify(options));
    assert.notEqual(units[3].pattern, "Sustain wave", JSON.stringify(options));
  }
  for (const options of [{connectorVote: stop(2)}, {blockedIds: [2]}, {targetBoundary: timeCut},
    {continuation: stop(3)}, {localVote: {...local, contextId: 2}},
    {connector: "While they stood there the people nearest the windows drew the heavy curtains slowly closed for the night."}]) {
    const {units} = await run({...rooted, ...options});
    assert.notEqual(units[3].pattern, "Sustain wave", JSON.stringify(options));
  }
});

const uncertainTransition = {status: "verified", transition: "uncertain-continuity", fact: "neutralize", evidenceIds: [3]};
const uncertaintyFixture = {
  continuation: rootedContinuation, proposal: {...neutral(3), status: "candidate", depiction: "romantic",
    narrativePhase: "sustain", action: "contact", scopeId: 1, evidenceIds: [3]},
  openingProposal: {...onset, status: "candidate", evidenceIds: [1]}, sceneEntry: {...entry, reason: "ordinary-interruption"},
  targetTransition: uncertainTransition, uncertainContinuationArbitration: true, maxCueChecks: 1,
  confirmation: {...rootedContinuation, scopeId: 1},
};

test("an exact blind continuation can resolve typed uncertainty without renewing or inventing a cue", async () => {
  const requests = [], controlRequests = [];
  const candidate = await run({...uncertaintyFixture, requests});
  const control = await run({...uncertaintyFixture, uncertainContinuationArbitration: false, requests: controlRequests});
  const noUncertainty = await run({...uncertaintyFixture, targetTransition: {}, continuation: neutral(3), proposal: neutral(3)});
  const row = candidate.units[3];
  assert.equal(control.units[3].pattern, "Baseline");
  assert.equal(row.pattern, "Sustain wave");
  assert.equal(row.phase, "sustain");
  assert.equal(row.appliedTransition, "none");
  assert.deepEqual(row.transitionVerification, control.units[3].transitionVerification);
  assert.deepEqual(row.primaryPrefix, control.units[3].primaryPrefix);
  assert.deepEqual(row.transitionEvidenceIds, [1, 3]);
  assert.equal(row.uncertainContinuationVerificationStatus, "verified");
  assert.equal(row.localActionApplication, "sustain-uncertainty-profile");
  assert.equal(row.trace.decision, "Resolve held continuity");
  assert.equal(row.trace.knownAt, 3);
  assert.deepEqual(row.trace.evidence, [1, 3]);
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(row.trace.floorWords, 0);
  for (const field of ["beat", "scene", "holdWords", "fadeWords"]) {
    assert.equal(row.trace[field], noUncertainty.units[3].trace[field]);
  }
  assert.deepEqual(candidate.units.slice(0, 3), control.units.slice(0, 3));
  assert.deepEqual(candidate.units[4].trace, noUncertainty.units[4].trace);
  assert.deepEqual(requests.slice(0, -1), controlRequests);
  const request = requests.at(-1);
  assert.equal(request.mode, "cue-check");
  assert.equal(request.focus, "continuation-repair");
  assert.deepEqual(request.targetIds, [3]);
  assert.deepEqual(request.units.map(unit => unit.id), [0, 1, 2, 3]);
  assert.equal(request.attested, undefined);
  const attempt = candidate.summary.attempts.at(-1);
  assert.equal(attempt.cueCheckReason, "uncertain-continuation");
  assert.equal(attempt.status, "returned");
});

test("continuity uncertainty stays conservative on missing, conflicting or invalid proof", async () => {
  for (const [options, status] of [[{confirmation: null}, "unconfirmed"],
    [{confirmation: {...uncertaintyFixture.confirmation, scopeId: 2}}, "invalid-response"],
    [{confirmation: {...uncertaintyFixture.confirmation, evidenceIds: [1, 3, 4]}}, "invalid-response"],
    [{confirmationFailure: "transient"}, "transient"], [{confirmationFailure: "refused"}, "provider-refused"],
    [{maxCueChecks: 0}, "budget-deferred"]]) {
    const {units} = await run({...uncertaintyFixture, ...options});
    assert.equal(units[3].uncertainContinuationVerificationStatus, status, JSON.stringify(options));
    assert.equal(units[3].pattern, "Baseline");
    assert.equal(units[3].appliedTransition, "uncertain-continuity");
    assert.equal(units[3].localActionApplication, undefined);
    assert.equal(units[4].pattern, "Baseline");
  }
});

test("uncertainty confirmation cannot be requested across a real boundary or missing causal evidence", async () => {
  for (const options of [{targetBoundary: timeCut}, {continuation: stop(3)}, {connectorVote: stop(2)},
    {opening: stop(1)}, {blockedIds: [2]}, {rootVote: {...neutral(0), frame: "reported"}},
    {opening: {...onset, evidenceIds: [1]}}, {localVote: {...local, contextId: 2}},
    {proposal: neutral(3)}, {targetTransition: {...uncertainTransition, evidenceIds: [1, 3]}},
    {sceneEntry: {...entry, reason: "routine-movement"}},
    {connector: "Several minutes later the lights dimmed."}, {connector: "They stopped to listen."},
    {connector: "While they stood there the people nearest the windows drew the heavy curtains slowly closed for the night."}]) {
    const requests = [];
    const {units} = await run({...uncertaintyFixture, ...options, requests});
    assert.equal(units[3].uncertainContinuationVerificationStatus, undefined, JSON.stringify(options));
    assert.notEqual(units[3].pattern, "Sustain wave", JSON.stringify(options));
    assert.ok(requests.every(request => request.focus !== "continuation-repair"), JSON.stringify(options));
  }
  const {units} = await run({...uncertaintyFixture, confirmation: stop(3)});
  assert.equal(units[3].uncertainContinuationVerificationStatus, "protective-override");
  assert.equal(units[3].pattern, "Stop");
  assert.equal(units[3].appliedTransition, "hard-stop");
  assert.equal(units[4].pattern, "Baseline");
});

test("the compiler cannot use an exact confirmation to restore an expired or manually zeroed beat", () => {
  const unit = (id, pattern, words) => ({id, words, profile: {id, pattern, gate: "No blocking event recorded"}});
  const confirmed = {...unit(2, "Baseline", 2), neutral: {knownAt: 2, evidence: [2]},
    holdConfirmation: {kind: "continue", knownAt: 2, evidence: [0, 2], priorAnchor: 0}};
  const opening = unit(0, "Onset rise", 2);
  for (const [middle, target] of [[unit(1, "Baseline", 32), confirmed],
    [unit(1, "Baseline", 1), {...confirmed, manualZero: true}], [unit(1, "Reset", 1), confirmed]]) {
    const [, , [profile, trace]] = planStory("held", [opening, middle, target]);
    assert.equal(profile.pattern, "Baseline");
    assert.notEqual(trace.decision, "Resolve held continuity");
  }
});
