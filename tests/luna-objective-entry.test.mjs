import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const text = "Lee took Mira's hand. A guest knocked at the door. Mira answered the guest. Lee stayed in the hall.";
const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
  spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const onset = {...neutral(0), status: "verified", depiction: "romantic", narrativePhase: "onset", action: "contact",
  transition: "onset", scopeId: 0, evidenceIds: [0]};
const objective = {status: "cut", reason: "objective-shift", previousId: 1, entryId: 2};
const cut = {...neutral(2), status: "verified", transition: "scene-cut", fact: "cut", scopeId: 2, evidenceIds: [1, 2]};
const uncertain = {status: "uncertain", reason: "insufficient-prefix", previousId: null, changeId: null, entryId: null};
const interruption = {...uncertain, status: "none", reason: "ordinary-interruption"};
const material = {status: "cut", reason: "material-objective", previousId: 0, changeId: 2, entryId: 2};
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const stop = unitId => ({...neutral(unitId), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [unitId]});

function run({entry = uncertain, boundary = objective, verifiedPrior = neutral(1), primary = cut, localStop = false,
  unavailable = false, arbitrate = true, requests = []} = {}) {
  const provider = Object.assign(async request => {
    requests.push(request);
    const {mode, targetIds} = request;
    const usage = {inputTokens: 100, outputTokens: 20};
    if (mode === "scene-entry" && unavailable) return {status: "transient", usage};
    return {status: "ok", usage, facts: targetIds.map(id => {
      if (mode === "scene-entry") return {unitId: id, sceneEntry: entry};
      if (mode === "scene-boundary") return {unitId: id,
        sceneBoundary: {...objective, previousId: entry.previousId, changeId: 2, contrast: "material-change"}};
      if (mode === "transition") return {...neutral(id), depiction: "unknown", action: "unknown", narrativePhase: "unknown",
        ...(localStop ? {status: "verified", transition: "non-romantic-activity-stop", evidenceIds: [id]} : {}), sceneBoundary: boundary};
      if (id === 0) return mode === "discovery" ? {...onset, status: "candidate"} : onset;
      if (id === 1) return verifiedPrior;
      if (id === 2) return mode === "discovery" ? {...cut, status: "candidate"} : primary;
      return neutral(id);
    })};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "objective-entry", text, grant, now: () => 1, provider, negativeStride: 0, prefixUnits: 3,
    verificationTargets: [0, 1, 2, 3], maxVerification: 4, transitionTargets: [2], maxTransitionVerification: 1,
    verifyTransitions: true, sceneEntryArbitration: arbitrate, boundaryEntryConfirmation: arbitrate,
    sceneEntryVerificationTargets: [2]});
}

test("a correlated quiet objective cut requires the existing first-entry check before the next target", async () => {
  const previous = await run({arbitrate: false});
  const requests = [], runResult = await run({requests});
  const row = runResult.units[2];
  assert.equal(previous.units[2].pattern, "Reset");
  assert.equal(row.primaryPrefix.transition, "scene-cut");
  assert.equal(row.transitionVerification.sceneBoundary.reason, "objective-shift");
  assert.equal(row.sceneEntryVerificationStatus, "uncertain");
  assert.equal(row.appliedTransition, "uncertain-continuity");
  assert.equal(row.pattern, "Baseline");
  assert.equal(row.independentBoundaryStatus, "objective-context-unresolved");
  assert.equal(row.sceneId, runResult.units[1].sceneId);
  assert.equal(row.beatId, null);
  assert.equal(row.readerCue, false);
  const checks = requests.filter(({mode}) => mode === "scene-entry");
  assert.deepEqual(checks, [{mode: "scene-entry", units: units.slice(0, 3).map(({id, text}) => ({id, text})), targetIds: [2]}]);
  assert.ok(requests.indexOf(checks[0]) < requests.findIndex(({mode, targetIds}) => mode === "verify" && targetIds[0] === 3));
  assert.equal(requests.find(({mode, targetIds}) => mode === "verify" && targetIds[0] === 3).attested, undefined);
});

test("independent exact objective entry preserves Reset and ordinary interruption preserves eligible carry", async () => {
  const changed = await run({entry: material});
  assert.equal(changed.units[2].pattern, "Reset");
  assert.equal(changed.units[2].independentBoundaryStatus, "objective-corroborated");
  assert.notEqual(changed.units[2].sceneId, changed.units[1].sceneId);
  const separate = await run({entry: material, boundary: noBoundary, primary: neutral(2)});
  assert.equal(separate.units[2].pattern, "Reset");
  assert.equal(separate.units[2].sceneEntryArbitration, "independently-confirmed-cut");
  assert.equal(separate.units[2].independentBoundaryStatus, "corroborated");
  const requests = [], stayed = await run({entry: interruption, requests});
  const row = stayed.units[2];
  assert.equal(row.pattern, "Onset rise");
  assert.equal(row.beatId, stayed.units[1].beatId);
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.independentBoundaryStatus, "objective-continuity");
  assert.equal(row.readerCue, false);
  assert.equal(row.verifiedRelease, undefined);
  assert.equal(requests.find(({mode, targetIds}) => mode === "verify" && targetIds[0] === 3).attested[0].unitId, 0);
});

test("objective uncertainty cannot disturb a hard stop, time cut or independently verified activity stop", async () => {
  for (const controls of [{entry: {...material, changeId: 1}}, {entry: {...material, reason: "material-time"}},
    {unavailable: true}, {entry: material, verifiedPrior: stop(1)}]) {
    const {units} = await run(controls);
    assert.equal(units[2].pattern, "Baseline");
    assert.equal(units[2].appliedTransition, "uncertain-continuity");
  }
  const prior = await run({entry: interruption, verifiedPrior: stop(1)});
  assert.equal(prior.units[1].pattern, "Stop");
  assert.equal(prior.units[2].pattern, "Baseline");
  const target = await run({primary: stop(2)});
  assert.equal(target.units[2].pattern, "Stop");
  assert.equal(target.units[2].independentBoundaryStatus, undefined);
  const time = await run({boundary: {...objective, reason: "time-jump"}});
  assert.equal(time.units[2].pattern, "Reset");
  assert.equal(time.units[2].independentBoundaryStatus, undefined);
  const activity = await run({localStop: true});
  assert.equal(activity.units[2].pattern, "Baseline");
  assert.equal(activity.units[2].appliedTransition, "non-romantic-activity-stop");
});
