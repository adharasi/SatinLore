import assert from "node:assert/strict";
import test from "node:test";
import {createLunaProtocolProvider, LUNA_PROTOCOL_MODEL} from "../scripts/lib/luna-protocol-provider.mjs";
import {createLunaShadowBudget, runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const target = 2;
const earlierText = "June arranged the chairs in the workshop. She waited in the doorway for Lee.";
const viewpoint = "Lee looked back at her from the doorway.";
const relocation = "Lee left the workshop and began the briefing in the depot.";
const usage = {inputTokens: 100, outputTokens: 20};
const same = {status: "same", earlierId: 1, currentId: target, earlierBasis: "established-place", currentBasis: "same-place"};
const changed = {status: "changed", earlierId: 0, currentId: target, earlierBasis: "established-place", currentBasis: "distinct-place"};
const uncertain = {status: "uncertain", earlierId: null, currentId: null, earlierBasis: "unresolved", currentBasis: "unresolved"};
const unresolvedBoundary = {status: "uncertain", reason: "unclear", previousId: null, entryId: null};
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const cut = {status: "cut", reason: "setting-shift", previousId: 1, entryId: target};
const firstEntry = {status: "cut", reason: "material-setting", previousId: 1, changeId: target, entryId: target};
const boundary = {...cut, changeId: target, contrast: "material-change"};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const oldPlace = {status: "established", earlierId: 0, currentId: null};
const distinctArrival = {status: "distinct", earlierId: 0, currentId: target};
const uncertainPlace = {status: "uncertain", earlierId: null, currentId: null};
const placeModes = new Set(["scene-old-place", "scene-arrival"]);

test("scene-situation compares the exact prefix blind and accepts only enumerated evidence on both sides", async () => {
  const units = buildWholeStoryIndex(`${earlierText} ${relocation}`).units.map(({id, text}) => ({id, text}));
  const request = {mode: "scene-situation", units, targetIds: [target]};
  let sceneSituation = changed;
  let sent;
  const provider = createLunaProtocolProvider({apiKey: "neutral-fixture", fetchImpl: async (_url, {body}) => {
    sent = JSON.parse(body);
    return Response.json({model: LUNA_PROTOCOL_MODEL, status: "completed", output: [
      {type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({facts: [{unitId: target, sceneSituation}]})}]},
    ]});
  }});
  assert.deepEqual((await provider({...request, priorVerdict: cut})).facts, [{unitId: target, sceneSituation: changed}]);
  assert.deepEqual(JSON.parse(sent.input), {units, targetIds: [target]});
  assert.equal(sent.text.format.name, "nocturne_luna_scene_situation_v1");
  assert.match(sent.instructions, /distinct enacted place/u);
  assert.match(sent.instructions, /different viewpoint/u);
  assert.equal((await provider({...request, units: units.slice(-1)})).status, "invalid-request");
  assert.equal((await provider({...request, attested: [{unitId: 0, scopeId: 0, frame: "current", action: "contact",
    narrativePhase: "onset"}]})).status, "invalid-request");
  for (const [value, reason] of [[{...changed, earlierId: target}, "scene-situation-evidence"],
    [{...changed, currentId: 1}, "scene-situation-evidence"], [{...changed, earlierId: -1}, "scene-situation-evidence"],
    [{...changed, earlierBasis: "established-action"}, "scene-situation-shape"],
    [{...uncertain, earlierId: 1}, "scene-situation-evidence"], [{...same, note: viewpoint}, "scene-situation-shape"]]) {
    sceneSituation = value;
    const answer = await provider(request);
    assert.equal(answer.status, "invalid-response");
    assert.deepEqual(answer.targetFailures, [{unitId: target, reason}]);
    assert.ok(!JSON.stringify(answer).includes(viewpoint));
  }
});

test("split place questions isolate old place from arrival on the provider wire", async () => {
  const units = buildWholeStoryIndex(`${earlierText} ${relocation}`).units.map(({id, text}) => ({id, text}));
  const request = {units, targetIds: [target], priorVerdict: cut};
  let scenePlace = oldPlace;
  let sent;
  const provider = createLunaProtocolProvider({apiKey: "neutral-fixture", fetchImpl: async (_url, {body}) => {
    sent = JSON.parse(body);
    return Response.json({model: LUNA_PROTOCOL_MODEL, status: "completed", output: [
      {type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({facts: [{unitId: target, scenePlace}]})}]},
    ]});
  }});
  assert.deepEqual((await provider({...request, mode: "scene-old-place"})).facts, [{unitId: target, scenePlace: oldPlace}]);
  assert.deepEqual(JSON.parse(sent.input), {units: units.slice(0, -1), targetIds: [target]});
  assert.equal(sent.text.format.name, "nocturne_luna_scene_old_place_v1");
  assert.equal(sent.store, false);
  scenePlace = distinctArrival;
  assert.deepEqual((await provider({...request, mode: "scene-arrival", earlierPlace: oldPlace})).facts,
    [{unitId: target, scenePlace: distinctArrival}]);
  assert.deepEqual(JSON.parse(sent.input), {units, targetIds: [target]});
  assert.equal(sent.text.format.name, "nocturne_luna_scene_arrival_v1");
  assert.match(sent.instructions, /compressed journey/u);
  for (const [mode, verdict, reason] of [["scene-old-place", distinctArrival, "scene-place-shape"],
    ["scene-old-place", {...oldPlace, currentId: target}, "scene-place-evidence"],
    ["scene-old-place", {...oldPlace, earlierId: target}, "scene-place-evidence"],
    ["scene-arrival", oldPlace, "scene-place-shape"],
    ["scene-arrival", {...distinctArrival, currentId: 1}, "scene-place-evidence"],
    ["scene-arrival", {...distinctArrival, earlierId: target}, "scene-place-evidence"],
    ["scene-arrival", {...uncertainPlace, earlierId: 0}, "scene-place-evidence"]]) {
    scenePlace = verdict;
    const response = await provider({...request, mode});
    assert.equal(response.status, "invalid-response");
    assert.deepEqual(response.targetFailures, [{unitId: target, reason}]);
  }
});

async function settingRun({targetText = viewpoint, situation = same, situationFailure, typedBoundary = unresolvedBoundary,
  priorStop = false, targetStop = false, quietPrior = false, localActivityStop = false, includeSceneEntry = true, entry = firstEntry, entryFailure,
  includeSuccessor = false, focusedQuiet = false, focusedTargetOnly = true, verifySettingSituation = true, budget,
  oldWitness = uncertainPlace, arrivalWitness = uncertainPlace, oldWitnessFailure, arrivalWitnessFailure, discoveryReading,
  boundaryWitness = boundary} = {}) {
  const text = `${earlierText} ${targetText}${includeSuccessor ? " They started the next task." : ""}`;
  const index = buildWholeStoryIndex(text);
  const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
    purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: index.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const requests = [];
  const provider = Object.assign(async request => {
    requests.push(request);
    if (request.mode === "scene-entry") return entryFailure ? {status: entryFailure, usage} :
      {status: "ok", usage, facts: [{unitId: target, sceneEntry: entry}]};
    if (request.mode === "scene-boundary") return {status: "ok", usage, facts: [{unitId: target, sceneBoundary: boundaryWitness}]};
    if (request.mode === "scene-situation") return situationFailure ? {status: situationFailure, usage} :
      {status: "ok", usage, facts: [{unitId: target, sceneSituation: situation}]};
    if (placeModes.has(request.mode)) {
      const [failure, scenePlace] = request.mode === "scene-old-place" ? [oldWitnessFailure, oldWitness] : [arrivalWitnessFailure, arrivalWitness];
      return failure ? {status: failure, usage} : {status: "ok", usage, facts: [{unitId: target, scenePlace}]};
    }
    return {status: "ok", usage, facts: request.targetIds.map(id => {
      const cue = neutral(id);
      if (focusedQuiet && request.mode === "cue-check" && id === target) return focusedTargetOnly ? {...cue, evidenceIds: [id]} : cue;
      if (request.mode === "transition") return {...cue, depiction: "unknown", narrativePhase: "unknown", action: "unknown",
        sceneBoundary: typedBoundary, ...(localActivityStop && id === target ? {status: "verified", transition: "non-romantic-activity-stop",
          evidenceIds: [id]} : {})};
      const status = request.mode === "discovery" ? "candidate" : "verified";
      if (id === 1 && priorStop || id === target && targetStop) {
        return {...cue, status, transition: "hard-stop", fact: "protective", evidenceIds: [id]};
      }
      if (id === target && request.mode === "discovery" && discoveryReading) return {...cue, ...discoveryReading};
      if (id === 1 && !quietPrior) return {...cue, status, depiction: "romantic", narrativePhase: "build", action: "anticipation",
        fact: "low", scopeId: 0, evidenceIds: [0, 1]};
      return cue;
    })};
  }, {sceneBoundaryProtocol: true});
  const run = await runLunaProtocolShadow({id: "grounded-setting-study", text, grant, now: () => 1, provider, budget,
    verificationTargets: includeSuccessor ? [0, 1, target, target + 1] : [0, 1, target], transitionTargets: [target], verifyTransitions: true,
    sceneEntryVerificationTargets: includeSceneEntry ? [target] : [],
    sceneEntryArbitration: true, boundaryEntryConfirmation: true, verifySettingSituation,
    verifyContinuityBoundary: focusedQuiet, maxCueChecks: focusedQuiet ? 3 : 0, negativeStride: 0});
  return {run, requests};
}

test("independent setting grounding separates identical upstream votes for a viewpoint and a genuine compact move", async () => {
  const legacy = await settingRun({verifySettingSituation: false});
  const viewpointRun = await settingRun();
  const relocationRun = await settingRun({targetText: relocation, situation: changed});
  assert.equal(legacy.run.units[target].pattern, "Reset");
  for (const {run, requests} of [viewpointRun, relocationRun]) {
    const check = requests.filter(({mode}) => mode === "scene-situation");
    assert.equal(check.length, 1);
    const entry = requests.find(({mode}) => mode === "scene-entry");
    assert.deepEqual(check[0], {...entry, mode: "scene-situation"});
    assert.equal(run.units[target].readerCue, false);
    assert.deepEqual(run.units[target].boundaryVerification.sceneBoundary, boundary);
    assert.deepEqual(run.units[target].sceneEntryVerification.sceneEntry, firstEntry);
  }
  const held = viewpointRun.run.units[target];
  assert.equal(held.appliedTransition, "none");
  assert.equal(held.independentBoundaryStatus, "setting-continuity");
  assert.equal(held.sceneSituationVerificationStatus, "same");
  assert.equal(held.sceneId, viewpointRun.run.units[1].sceneId);
  const entered = relocationRun.run.units[target];
  assert.equal(entered.appliedTransition, "scene-cut");
  assert.equal(entered.pattern, "Reset");
  assert.equal(entered.independentBoundaryStatus, "corroborated");
  assert.equal(entered.sceneSituationVerificationStatus, "changed");
  assert.notEqual(entered.sceneId, relocationRun.run.units[1].sceneId);
});

test("unavailable, uncertain, malformed and deferred setting proof clear carry without a reset", async () => {
  const budget = createLunaShadowBudget();
  const reserve = budget.reserveSupporting;
  budget.reserveSupporting = (body, ...args) => JSON.parse(body).mode === "scene-situation" ? null : reserve(body, ...args);
  for (const [options, status] of [[{situation: uncertain}, "uncertain"], [{situationFailure: "refused"}, "provider-refused"],
    [{situationFailure: "transient"}, "transient"], [{situation: {...changed, currentId: 1}}, "invalid-response"],
    [{budget}, "budget-deferred"]]) {
    const {run} = await settingRun(options);
    const row = run.units[target];
    assert.equal(row.sceneSituationVerificationStatus, status);
    assert.equal(row.independentBoundaryStatus, "setting-context-unresolved");
    assert.equal(row.appliedTransition, "uncertain-continuity");
    assert.equal(row.pattern, "Baseline");
    assert.equal(row.beatId, null);
    assert.equal(row.sceneId, run.units[1].sceneId);
    assert.equal(row.readerCue, false);
  }
});

test("time and protective cuts have independent authority, as does a local activity stop", async () => {
  const time = await settingRun({typedBoundary: {...cut, reason: "time-jump"}});
  assert.equal(time.run.units[target].pattern, "Reset");
  assert.ok(!time.requests.some(({mode}) => mode === "scene-situation"));
  const targetStop = await settingRun({typedBoundary: cut, targetStop: true});
  assert.equal(targetStop.run.units[target].pattern, "Stop");
  assert.ok(!targetStop.requests.some(({mode}) => mode === "scene-situation"));
  const protectedRun = await settingRun({priorStop: true});
  assert.equal(protectedRun.run.units[1].pattern, "Stop");
  assert.equal(protectedRun.run.units[target].readerCue, false);
  assert.ok(!protectedRun.requests.some(({mode}) => mode === "scene-situation"));
  const ordinary = await settingRun({typedBoundary: cut, localActivityStop: true, situation: uncertain});
  assert.equal(ordinary.run.units[target].sceneSituationVerificationStatus, "uncertain");
  assert.equal(ordinary.run.units[target].appliedTransition, "non-romantic-activity-stop");
  assert.equal(ordinary.run.units[target].pattern, "Baseline");
  assert.equal(ordinary.run.units[target].beatId, null);
});

const viewpointOnly = {status: "none", reason: "viewpoint-only", previousId: null, changeId: null, entryId: null};
const exactCut = {...neutral(target), status: "verified", transition: "scene-cut", fact: "cut", evidenceIds: [1, target]};

const activityStopAtArrival = {typedBoundary: noBoundary, localActivityStop: true, targetText: relocation, includeSuccessor: true};

test("a separately grounded arrival resets at the exact ordinary stop before successor verification", async () => {
  const {run, requests} = await settingRun({...activityStopAtArrival, situation: changed});
  const row = run.units[target];
  const entry = requests.find(({mode}) => mode === "scene-entry");
  const proof = requests.find(({mode}) => mode === "scene-situation");
  const successor = requests.find(({mode, targetIds}) => mode === "verify" && targetIds[0] === target + 1);
  assert.deepEqual(proof, {...entry, mode: "scene-situation"});
  assert.ok(requests.indexOf(entry) < requests.indexOf(proof) && requests.indexOf(proof) < requests.indexOf(successor));
  assert.equal(row.transitionVerification.transition, "non-romantic-activity-stop");
  assert.deepEqual(row.transitionVerification.sceneBoundary, noBoundary);
  assert.deepEqual(row.transitionVerification.evidenceIds, [target]);
  assert.equal(row.appliedTransition, "scene-cut");
  assert.equal(row.sceneEntryArbitration, "grounded-setting-cut");
  assert.deepEqual(row.transitionEvidenceIds, [0, target]);
  assert.equal(row.pattern, "Reset");
  assert.equal(row.readerCue, false);
  assert.notEqual(row.sceneId, run.units[target - 1].sceneId);
  assert.equal(run.units[target + 1].sceneId, row.sceneId);
  assert.equal(run.units[target + 1].pattern, "Baseline");
});

test("missing or contrary arrival proof preserves the independently verified ordinary stop", async () => {
  const budget = createLunaShadowBudget();
  const reserve = budget.reserveSupporting;
  budget.reserveSupporting = (body, ...args) => JSON.parse(body).mode === "scene-situation" ? null : reserve(body, ...args);
  for (const [options, expected] of [[{situation: same}, "same"], [{situation: uncertain}, "uncertain"],
    [{situationFailure: "refused"}, "provider-refused"], [{situationFailure: "transient"}, "transient"],
    [{situation: {...changed, currentId: 1}}, "invalid-response"], [{budget}, "budget-deferred"],
    [{entryFailure: "refused"}, undefined], [{entry: viewpointOnly}, undefined]]) {
    const {run, requests} = await settingRun({...activityStopAtArrival, quietPrior: true, ...options});
    const row = run.units[target];
    assert.equal(row.sceneSituationVerificationStatus, expected);
    assert.equal(row.appliedTransition, "non-romantic-activity-stop");
    assert.deepEqual(row.transitionEvidenceIds, [target]);
    assert.equal(row.pattern, "Baseline");
    assert.equal(row.beatId, null);
    assert.equal(row.sceneId, run.units[target - 1].sceneId);
    assert.ok(!requests.some(({mode}) => placeModes.has(mode)));
    if (expected === undefined) assert.ok(!requests.some(({mode}) => mode === "scene-situation"));
  }
  const held = await settingRun({...activityStopAtArrival, situation: uncertain});
  const legacy = await settingRun({...activityStopAtArrival, verifySettingSituation: false});
  assert.deepEqual(held.run.units[target].trace, legacy.run.units[target].trace);
  assert.equal(held.run.units[target].pattern, legacy.run.units[target].pattern);
});

test("an activity stop cannot nominate setting proof past time or protective authority", async () => {
  const time = await settingRun({...activityStopAtArrival, typedBoundary: {...cut, reason: "time-jump"}, situation: changed});
  assert.equal(time.run.units[target].pattern, "Reset");
  assert.ok(!time.requests.some(({mode}) => mode === "scene-situation"));
  for (const options of [{priorStop: true}, {targetStop: true}]) {
    const protectedRun = await settingRun({...activityStopAtArrival, ...options, situation: changed});
    assert.equal(protectedRun.run.units[options.priorStop ? target - 1 : target].pattern, "Stop");
    assert.equal(protectedRun.run.units[target].readerCue, false);
    assert.ok(!protectedRun.requests.some(({mode}) => mode === "scene-situation"));
  }
});

const acceptedSettingCandidate = {typedBoundary: cut, includeSuccessor: true, focusedQuiet: true, focusedTargetOnly: false,
  situation: uncertain, targetText: relocation};

test("uncertain joint proof can recover a setting cut using exact independent witnesses", async () => {
  const {run, requests} = await settingRun({...acceptedSettingCandidate, oldWitness: oldPlace, arrivalWitness: distinctArrival});
  const row = run.units[target];
  assert.equal(row.sceneSituationVerificationStatus, "uncertain");
  assert.equal(row.sceneOldPlaceVerificationStatus, "established");
  assert.equal(row.sceneArrivalVerificationStatus, "distinct");
  assert.equal(row.scenePlaceRecoveryStatus, "changed");
  assert.equal(row.appliedTransition, "scene-cut");
  assert.equal(row.pattern, "Reset");
  assert.equal(row.readerCue, false);
  assert.deepEqual(row.trace.evidence, [0, target]);
  assert.deepEqual(row.transitionEvidenceIds, [0, target]);
  assert.equal(row.transitionVerification.sceneBoundary.previousId, 1);
  const joint = requests.find(({mode}) => mode === "scene-situation");
  const checks = requests.filter(({mode}) => placeModes.has(mode));
  assert.deepEqual(checks, [{...joint, mode: "scene-old-place"}, {...joint, mode: "scene-arrival"}]);
  const successor = requests.find(({mode, targetIds}) => mode === "verify" && targetIds[0] === target + 1);
  assert.ok(requests.indexOf(joint) < requests.indexOf(checks[0]) && requests.indexOf(checks[1]) < requests.indexOf(successor));
});

test("joint uncertainty with split disagreement or failure leaves existing safety and carry decisions intact", async () => {
  const budget = createLunaShadowBudget();
  const reserve = budget.reserveSupporting;
  budget.reserveSupporting = (body, ...args) => JSON.parse(body).mode === "scene-arrival" ? null : reserve(body, ...args);
  for (const [controls, expected, calls] of [
    [{}, "old-uncertain", 1],
    [{oldWitness: {...oldPlace, earlierId: target}}, "old-invalid-response", 1],
    [{oldWitness: oldPlace, arrivalWitness: {...distinctArrival, earlierId: 1}}, "witness-disagreement", 2],
    [{oldWitness: oldPlace, arrivalWitnessFailure: "transient"}, "arrival-transient", 2],
    [{oldWitness: oldPlace, budget}, "arrival-budget-deferred", 1],
  ]) {
    const {run, requests} = await settingRun({...acceptedSettingCandidate, ...controls});
    const row = run.units[target];
    assert.equal(row.scenePlaceRecoveryStatus, expected);
    assert.equal(row.appliedTransition, "uncertain-continuity");
    assert.equal(row.pattern, "Baseline");
    assert.equal(requests.filter(({mode}) => placeModes.has(mode)).length, calls);
  }
  const samePlace = await settingRun({...acceptedSettingCandidate, targetText: viewpoint, oldWitness: oldPlace,
    arrivalWitness: {...distinctArrival, status: "same"}});
  assert.equal(samePlace.run.units[target].scenePlaceRecoveryStatus, "same");
  assert.equal(samePlace.run.units[target].appliedTransition, "none");
  assert.equal(samePlace.run.units[target].sceneId, samePlace.run.units[1].sceneId);
  for (const controls of [{entry: viewpointOnly}, {typedBoundary: {...cut, reason: "time-jump"}},
    {priorStop: true}, {targetStop: true}, {localActivityStop: true}, {situationFailure: "refused"}, {situation: changed}]) {
    const {requests} = await settingRun({...acceptedSettingCandidate, ...controls});
    assert.ok(!requests.some(({mode}) => placeModes.has(mode)));
  }
  const refused = await settingRun({...acceptedSettingCandidate, oldWitnessFailure: "refused"});
  assert.equal(refused.run.summary.attempts.find(({mode}) => mode === "scene-old-place").status, "provider-refused");
  assert.equal(refused.requests.at(-1).mode, "scene-old-place");
});

test("a focused neutral target citation can ask for place proof when both setting votes cite the same predecessor", async () => {
  const samePredecessor = {...acceptedSettingCandidate, focusedTargetOnly: true};
  const grounded = await settingRun({...samePredecessor, situation: changed});
  assert.equal(grounded.run.units[target].cueRecoveryCorrection, "continuity-cut-veto");
  assert.equal(grounded.run.units[target].appliedTransition, "scene-cut");
  assert.deepEqual(grounded.run.units[target].transitionEvidenceIds, [0, target]);
  assert.equal(grounded.requests.filter(({mode}) => mode === "scene-situation").length, 1);
  for (const options of [{}, {situationFailure: "transient"}]) {
    const {run, requests} = await settingRun({...samePredecessor, ...options});
    assert.equal(requests.filter(({mode}) => mode === "scene-situation").length, 1);
    assert.equal(run.units[target].appliedTransition, "none");
    assert.equal(run.units[target].sceneId, run.units[1].sceneId);
    assert.equal(run.units[target].independentBoundaryStatus, "setting-context-unresolved");
  }
  const protective = await settingRun({...samePredecessor, targetStop: true, situation: changed});
  assert.equal(protective.run.units[target].pattern, "Stop");
  assert.ok(!protective.requests.some(({mode}) => mode === "scene-situation"));
});

test("invalid first-entry evidence can nominate two exact place witnesses for a quiet disputed arrival", async () => {
  const options = {...acceptedSettingCandidate, focusedTargetOnly: true, entryFailure: "invalid-response", quietPrior: true};
  const accepted = await settingRun({...options, oldWitness: oldPlace, arrivalWitness: distinctArrival});
  const row = accepted.run.units[target];
  assert.equal(row.sceneEntryVerificationStatus, "invalid-response");
  assert.equal(row.scenePlaceRecoveryStatus, "changed");
  assert.equal(row.appliedTransition, "scene-cut");
  assert.deepEqual(row.transitionEvidenceIds, [0, target]);
  assert.equal(row.pattern, "Reset");
  assert.equal(row.readerCue, false);
  assert.equal(accepted.run.units[target + 1].sceneId, row.sceneId);
  const entry = accepted.requests.find(({mode}) => mode === "scene-entry");
  const places = accepted.requests.filter(({mode}) => placeModes.has(mode));
  assert.deepEqual(places, [{...entry, mode: "scene-old-place"}, {...entry, mode: "scene-arrival"}]);
  assert.ok(!accepted.requests.some(({mode}) => mode === "scene-situation"));
  assert.ok(accepted.requests.indexOf(places[1]) < accepted.requests.findIndex(({mode, targetIds}) =>
    mode === "verify" && targetIds[0] === target + 1));
  for (const [control, placeStatus] of [[{oldWitness: oldPlace, arrivalWitness: {...distinctArrival, status: "same"}}, "same"],
    [{oldWitness: oldPlace, arrivalWitness: {...distinctArrival, earlierId: 1}}, "witness-disagreement"],
    [{oldWitness: oldPlace, arrivalWitnessFailure: "transient"}, "arrival-transient"],
    [{}, "old-uncertain"], [{entryFailure: "transient"}, undefined], [{entryFailure: "refused"}, undefined]]) {
    const result = await settingRun({...options, ...control});
    const rejected = result.run.units[target];
    assert.equal(rejected.scenePlaceRecoveryStatus, placeStatus);
    assert.notEqual(rejected.appliedTransition, "scene-cut");
    assert.equal(rejected.sceneId, result.run.units[target - 1].sceneId);
    if (!placeStatus) assert.ok(!result.requests.some(({mode}) => placeModes.has(mode)));
  }
});

test("a valid first entry can nominate exact place witnesses when the other lanes are quiet", async () => {
  const options = {typedBoundary: noBoundary, entry: {...firstEntry, previousId: 0},
    boundaryWitness: {...noBoundary, changeId: null, contrast: "routine-movement"}, targetText: relocation,
    includeSuccessor: true, oldWitness: oldPlace, arrivalWitness: distinctArrival};
  const accepted = await settingRun(options);
  const row = accepted.run.units[target];
  assert.equal(row.sceneEntryVerificationStatus, "cut");
  assert.equal(row.transitionVerification.status, "neutral");
  assert.equal(row.scenePlaceRecoveryStatus, "changed");
  assert.equal(row.appliedTransition, "scene-cut");
  assert.deepEqual(row.transitionEvidenceIds, [0, target]);
  assert.equal(row.pattern, "Reset");
  assert.equal(row.readerCue, false);
  assert.equal(accepted.run.units[target + 1].sceneId, row.sceneId);
  const entry = accepted.requests.find(({mode}) => mode === "scene-entry");
  const places = accepted.requests.filter(({mode}) => placeModes.has(mode));
  assert.deepEqual(places, [{...entry, mode: "scene-old-place"}, {...entry, mode: "scene-arrival"}]);
  const successor = accepted.requests.findIndex(({mode, targetIds}) => mode === "verify" && targetIds[0] === target + 1);
  assert.ok(accepted.requests.indexOf(places[1]) < successor);
  assert.ok(!accepted.requests.some(({mode}) => mode === "scene-situation"));

  for (const [control, placeStatus] of [[{oldWitness: uncertainPlace}, "old-uncertain"],
    [{arrivalWitness: {...distinctArrival, status: "same"}}, "same"],
    [{arrivalWitness: {...distinctArrival, earlierId: 1}}, "witness-disagreement"],
    [{arrivalWitnessFailure: "transient"}, "arrival-transient"], [{entry: viewpointOnly}, undefined],
    [{priorStop: true}, undefined], [{targetStop: true}, undefined],
    [{boundaryWitness: {...boundary, reason: "time-jump"}}, undefined],
    [{boundaryWitness: {...boundary, reason: "objective-shift"}}, undefined]]) {
    const result = await settingRun({...options, ...control});
    assert.equal(result.run.units[target].scenePlaceRecoveryStatus, placeStatus);
    assert.notEqual(result.run.units[target].appliedTransition, "scene-cut");
    if (!placeStatus) assert.ok(!result.requests.some(({mode}) => placeModes.has(mode)));
  }
});

test("different old-setting coordinates at the same material entry require exact place witnesses", async () => {
  const options = {typedBoundary: noBoundary, entry: {...firstEntry, previousId: 0}, boundaryWitness: boundary,
    targetText: relocation, includeSuccessor: true, oldWitness: oldPlace, arrivalWitness: distinctArrival};
  const accepted = await settingRun(options);
  const row = accepted.run.units[target];
  assert.equal(row.sceneEntryVerification.sceneEntry.previousId, 0);
  assert.equal(row.boundaryVerification.sceneBoundary.previousId, 1);
  assert.equal(row.scenePlaceRecoveryStatus, "changed");
  assert.deepEqual(row.transitionEvidenceIds, [0, target]);
  assert.equal(row.appliedTransition, "scene-cut");
  assert.equal(row.pattern, "Reset");
  assert.equal(row.readerCue, false);
  assert.equal(accepted.run.units[target + 1].sceneId, row.sceneId);
  const entry = accepted.requests.find(({mode}) => mode === "scene-entry");
  const places = accepted.requests.filter(({mode}) => placeModes.has(mode));
  assert.deepEqual(places, [{...entry, mode: "scene-old-place"}, {...entry, mode: "scene-arrival"}]);
  assert.ok(accepted.requests.indexOf(places[1]) < accepted.requests.findIndex(({mode, targetIds}) =>
    mode === "verify" && targetIds[0] === target + 1));
  assert.ok(!accepted.requests.some(({mode}) => mode === "scene-situation"));
  for (const [control, placeStatus] of [
    [{oldWitness: {...oldPlace, earlierId: 1}}, "old-path-ineligible"],
    [{oldWitness: uncertainPlace}, "old-uncertain"],
    [{arrivalWitness: {...distinctArrival, earlierId: 1}}, "witness-disagreement"],
    [{arrivalWitness: {...distinctArrival, status: "same"}}, "same"],
    [{arrivalWitnessFailure: "transient"}, "arrival-transient"],
    [{entry: viewpointOnly}, undefined],
    [{boundaryWitness: {...boundary, reason: "time-jump"}}, undefined],
    [{priorStop: true}, undefined],
    [{targetStop: true}, undefined],
  ]) {
    const result = await settingRun({...options, ...control});
    const negative = result.run.units[target];
    assert.equal(negative.scenePlaceRecoveryStatus, placeStatus);
    assert.notEqual(negative.appliedTransition, "scene-cut");
    if (!placeStatus) assert.ok(!result.requests.some(({mode}) => placeModes.has(mode)));
  }
});

test("only an exact quiet discovery can nominate setting proof with a neutral frame", async () => {
  const options = {...acceptedSettingCandidate, focusedTargetOnly: true, discoveryReading: {frame: "neutral"}};
  const unresolved = await settingRun(options);
  assert.equal(unresolved.run.units[target].discovery.frame, "neutral");
  assert.equal(unresolved.run.units[target].cueRecoveryCorrection, "continuity-cut-veto");
  assert.equal(unresolved.run.units[target].sceneSituationVerificationStatus, "uncertain");
  assert.equal(unresolved.run.units[target].appliedTransition, "none");

  const grounded = await settingRun({...options, oldWitness: oldPlace, arrivalWitness: distinctArrival});
  assert.equal(grounded.run.units[target].scenePlaceRecoveryStatus, "changed");
  assert.equal(grounded.run.units[target].appliedTransition, "scene-cut");
  assert.deepEqual(grounded.run.units[target].transitionEvidenceIds, [0, target]);
  assert.equal(grounded.run.units[target].readerCue, false);

  for (const discoveryReading of [{frame: "remembered"}, {frame: "reported"}, {frame: "uncertain"},
    {frame: "neutral", status: "uncertain", action: "unknown", narrativePhase: "unknown", transition: "unknown"},
    {frame: "neutral", depiction: "romantic"}, {frame: "neutral", evidenceIds: [target]}]) {
    const {run, requests} = await settingRun({...options, discoveryReading, situation: changed});
    assert.ok(!requests.some(({mode}) => mode === "scene-situation"));
    assert.notEqual(run.units[target].appliedTransition, "scene-cut");
  }
});

test("two setting checks with different predecessors require independent proof of the shared arrival", async () => {
  const split = {typedBoundary: cut, entry: {...firstEntry, previousId: 0}, includeSuccessor: true, focusedQuiet: true};
  const legacy = await settingRun({...split, verifySettingSituation: false});
  const move = await settingRun({...split, targetText: relocation, situation: changed});
  const row = move.run.units[target];
  assert.equal(legacy.run.units[target].appliedTransition, "none");
  assert.equal(row.sceneSituationVerificationStatus, "changed");
  assert.equal(row.appliedTransition, "scene-cut");
  assert.equal(row.pattern, "Reset");
  assert.equal(row.readerCue, false);
  assert.equal(row.sceneEntryArbitration, "grounded-setting-cut");
  assert.deepEqual(row.transitionEvidenceIds, [0, target]);
  assert.equal(row.transitionVerification.sceneBoundary.previousId, 1);
  assert.deepEqual(row.trace.evidence, [0, target]);
  assert.notEqual(row.sceneId, move.run.units[1].sceneId);
  const request = move.requests.find(({mode}) => mode === "scene-situation");
  const entryRequest = move.requests.find(({mode}) => mode === "scene-entry");
  assert.deepEqual(request, {...entryRequest, mode: "scene-situation"});
  const successorIndex = move.requests.findIndex(({mode, targetIds}) => mode === "verify" && targetIds[0] === target + 1);
  assert.ok(move.requests.indexOf(entryRequest) < move.requests.indexOf(request) && move.requests.indexOf(request) < successorIndex);

  for (const controls of [{situation: {...same, earlierId: 0}}, {situation: uncertain}, {situationFailure: "transient"},
    {situation: {...changed, earlierId: 1}}]) {
    const {run, requests} = await settingRun({...split, ...controls});
    assert.equal(requests.filter(({mode}) => mode === "scene-situation").length, 1);
    assert.equal(run.units[target].appliedTransition, legacy.run.units[target].appliedTransition);
    assert.deepEqual(run.units[target].trace, legacy.run.units[target].trace);
    assert.equal(run.units[target].pattern, legacy.run.units[target].pattern);
  }
  for (const controls of [{typedBoundary: unresolvedBoundary, includeSceneEntry: false}, {entry: viewpointOnly},
    {priorStop: true}, {targetStop: true}, {localActivityStop: true}]) {
    const {requests} = await settingRun({...split, ...controls});
    assert.ok(!requests.some(({mode}) => mode === "scene-situation"));
  }
});

async function focusedSettingRun({targetText = viewpoint, situation = same, entry = viewpointOnly, proof = exactCut,
  verifySettingSituation = true, protectedPrior = false, followingDispute = false, discoveryCut = false, prefixUnits = 3,
  rootedPrimary = false, localPrimaryScope = null, heldAdjacent = false,
  oldWitness = uncertainPlace, arrivalWitness = uncertainPlace} = {}) {
  const nextId = target + 1;
  const text = `${earlierText} ${targetText} They waited for the signal.`;
  const index = buildWholeStoryIndex(text);
  const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
    purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: index.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const requests = [];
  const provider = Object.assign(async request => {
    requests.push(request);
    const [id] = request.targetIds;
    if (request.mode === "scene-entry") return {status: "ok", usage, facts: [{unitId: id, sceneEntry: id === target ? entry :
      {...firstEntry, previousId: target, entryId: id, changeId: id}}]};
    if (request.mode === "scene-boundary") return {status: "ok", usage, facts: [{unitId: id,
      sceneBoundary: {...boundary, previousId: target, entryId: id, changeId: id}}]};
    if (request.mode === "scene-situation") return {status: "ok", usage, facts: [{unitId: id, sceneSituation: situation}]};
    if (placeModes.has(request.mode)) return {status: "ok", usage, facts: [{unitId: id,
      scenePlace: request.mode === "scene-old-place" ? oldWitness : arrivalWitness}]};
    if (request.mode === "cue-check") return {status: "ok", usage, facts: [proof]};
    if (request.mode === "local-action") return {status: "ok", usage, facts: [{unitId: id, localAction: {status: "none",
      frame: "noncurrent", action: "none", phase: "quiet", contrast: "noncurrent", targetId: null, contextId: null}}]};
    return {status: "ok", usage, facts: request.targetIds.map(unitId => {
      const cue = neutral(unitId);
      if (request.mode === "transition") return {...cue, depiction: "unknown", narrativePhase: "unknown", action: "unknown",
        sceneBoundary: unitId === target ? cut : unresolvedBoundary};
      if (request.mode === "discovery") return discoveryCut && unitId === target ?
        {...exactCut, status: "candidate", scopeId: target} : cue;
      if (unitId === target) return rootedPrimary ? {...exactCut, scopeId: 0, evidenceIds: [0, 1, target]} :
        {...exactCut, scopeId: localPrimaryScope};
      if (unitId === 0) return {...cue, status: "verified", transition: protectedPrior ? "hard-stop" : "onset",
        fact: protectedPrior ? "protective" : "none", depiction: "romantic", narrativePhase: protectedPrior ? "quiet" : "onset",
        action: protectedPrior ? "none" : "contact", scopeId: 0, evidenceIds: [0]};
      if (unitId === 1 && heldAdjacent) return {...cue, status: "verified", depiction: "romantic", narrativePhase: "build",
        action: "anticipation", fact: "low", scopeId: 0, evidenceIds: [1]};
      return cue;
    })};
  }, {sceneBoundaryProtocol: true});
  const transitions = followingDispute ? [target, nextId] : [target];
  const run = await runLunaProtocolShadow({id: "focused-setting-study", text, grant, now: () => 1, provider, prefixUnits,
    verificationTargets: [0, 1, target, nextId], transitionTargets: transitions, verifyTransitions: true,
    sceneEntryVerificationTargets: transitions, localActionVerificationTargets: [target], sceneEntryArbitration: true,
    boundaryEntryConfirmation: true, verifySettingSituation, sameEpisodeArbitration: true, maxCueChecks: 1, negativeStride: 0});
  return {run, requests};
}

test("rooted quiet cut votes can preserve held same-place continuity after an uncertain comparison", async () => {
  const options = {rootedPrimary: true, discoveryCut: true, situation: uncertain, oldWitness: oldPlace};
  const accepted = await focusedSettingRun({...options, arrivalWitness: {...distinctArrival, status: "same"}});
  const row = accepted.run.units[target];
  assert.equal(row.sceneSituationVerificationStatus, "uncertain");
  assert.equal(row.sceneEntryVerification.sceneEntry.reason, "viewpoint-only");
  assert.equal(row.scenePlaceRecoveryStatus, "same");
  assert.equal(row.independentBoundaryStatus, "setting-continuity");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.readerCue, false);
  assert.equal(row.sceneId, accepted.run.units[target - 1].sceneId);
  assert.equal(row.beatId, accepted.run.units[target - 1].beatId);
  assert.ok(row.trace.holdWords > 0);
  const joint = accepted.requests.find(({mode}) => mode === "scene-situation");
  const places = accepted.requests.filter(({mode}) => placeModes.has(mode));
  assert.deepEqual(places, [{...joint, mode: "scene-old-place"}, {...joint, mode: "scene-arrival"}]);
  const move = await focusedSettingRun({...options, targetText: relocation, arrivalWitness: distinctArrival});
  assert.equal(move.run.units[target].appliedTransition, "scene-cut");
  assert.equal(move.run.units[target].pattern, "Reset");
  const unresolved = await focusedSettingRun(options);
  assert.equal(unresolved.run.units[target].scenePlaceRecoveryStatus, "arrival-uncertain");
  assert.equal(unresolved.run.units[target].appliedTransition, "uncertain-continuity");
  assert.equal(unresolved.run.units[target].pattern, "Baseline");
  for (const control of [{rootedPrimary: false}, {discoveryCut: false}, {protectedPrior: true}]) {
    const result = await focusedSettingRun({...options, ...control});
    assert.ok(!result.requests.some(({mode}) => placeModes.has(mode)));
  }
});

test("both adjacent viewpoint scopes can corroborate the existing place after a focused cut echo", async () => {
  for (const [discoveryCut, localPrimaryScope, focusedScope, prefixUnits, earlierId] of [
    [true, target, target, 3, 0], [false, target, null, 2, 1], [false, target - 1, null, 3, 0],
  ]) {
    const options = {discoveryCut, localPrimaryScope, heldAdjacent: true, prefixUnits, situation: uncertain,
      proof: {...exactCut, scopeId: focusedScope}, oldWitness: {...oldPlace, earlierId},
      arrivalWitness: {...distinctArrival, earlierId, status: "same"}};
    const accepted = await focusedSettingRun(options);
    const row = accepted.run.units[target];
    assert.equal(row.sceneEntryVerification.sceneEntry.reason, "viewpoint-only");
    assert.equal(row.scenePlaceRecoveryStatus, "same");
    assert.equal(row.appliedTransition, "none");
    assert.equal(row.independentBoundaryStatus, "setting-continuity");
    assert.equal(row.sceneId, accepted.run.units[target - 1].sceneId);
    assert.equal(row.beatId, accepted.run.units[target - 1].beatId);
    assert.ok(row.trace.holdWords > 0);
    const joint = accepted.requests.find(({mode}) => mode === "scene-situation");
    assert.deepEqual(accepted.requests.filter(({mode}) => placeModes.has(mode)),
      [{...joint, mode: "scene-old-place"}, {...joint, mode: "scene-arrival"}]);
    const move = await focusedSettingRun({...options, targetText: relocation, arrivalWitness: {...options.arrivalWitness, status: "distinct"}});
    assert.equal(move.run.units[target].appliedTransition, "scene-cut");
    assert.equal(move.run.units[target].pattern, "Reset");
    const unresolved = await focusedSettingRun({...options, arrivalWitness: uncertainPlace});
    assert.equal(unresolved.run.units[target].appliedTransition, "uncertain-continuity");
    assert.equal(unresolved.run.units[target].pattern, "Baseline");
  }
});

test("a focused repeated setting cut is adjudicated before the following target receives context", async () => {
  const legacy = await focusedSettingRun({verifySettingSituation: false});
  const continuity = await focusedSettingRun();
  const trueMove = await focusedSettingRun({targetText: relocation, situation: {...changed, earlierId: 1}});
  const unresolved = await focusedSettingRun({situation: uncertain});
  assert.equal(legacy.run.units[target].pattern, "Reset");
  for (const {requests} of [continuity, trueMove, unresolved]) {
    const entryIndex = requests.findIndex(({mode}) => mode === "scene-entry");
    const focusedIndex = requests.findIndex(({focus}) => focus === "episode-boundary");
    const situationIndex = requests.findIndex(({mode}) => mode === "scene-situation");
    const successorIndex = requests.findIndex(({mode, targetIds}) => mode === "verify" && targetIds[0] === target + 1);
    assert.ok(entryIndex < focusedIndex && focusedIndex < situationIndex && situationIndex < successorIndex);
    assert.deepEqual(requests[situationIndex], {...requests[entryIndex], mode: "scene-situation"});
    assert.ok(!requests.some(({mode}) => mode === "scene-boundary"));
    assert.equal(requests.filter(({mode}) => mode === "local-action").length, 1);
  }
  const held = continuity.run.units[target];
  assert.equal(held.appliedTransition, "none");
  assert.equal(held.independentBoundaryStatus, "setting-continuity");
  assert.equal(held.readerCue, false);
  assert.equal(held.sceneId, continuity.run.units[1].sceneId);
  const entered = trueMove.run.units[target];
  assert.equal(entered.appliedTransition, "scene-cut");
  assert.equal(entered.pattern, "Reset");
  assert.equal(entered.independentBoundaryStatus, "corroborated");
  assert.equal(entered.sceneEntryArbitration, "viewpoint-conflict");
  const pause = unresolved.run.units[target];
  assert.equal(pause.pattern, "Baseline");
  assert.equal(pause.appliedTransition, "uncertain-continuity");
  assert.equal(pause.beatId, null);
  assert.equal(pause.sceneId, unresolved.run.units[1].sceneId);
  assert.equal(pause.readerCue, false);
  const successor = ({requests}) => requests.find(({mode, targetIds}) => mode === "verify" && targetIds[0] === target + 1);
  assert.ok(successor(continuity).attested?.some(({unitId}) => unitId === 0));
  assert.equal(successor(legacy).attested, undefined);
  assert.equal(successor(unresolved).attested, undefined);
});

test("two eligible routes share one setting proof and later unproved carry is cleared", async () => {
  const {run, requests} = await focusedSettingRun({followingDispute: true});
  assert.equal(requests.filter(({mode}) => mode === "scene-situation").length, 1);
  assert.equal(run.units[target].independentBoundaryStatus, "setting-continuity");
  assert.equal(run.units[target + 1].sceneSituationVerificationStatus, "confirmation-limit");
  assert.equal(run.units[target + 1].appliedTransition, "uncertain-continuity");
  assert.equal(run.units[target + 1].pattern, "Baseline");
});

test("quiet setting proof is required when all votes agree and when no entry or focused diagnostic exists", async () => {
  for (const options of [{entry: firstEntry}, {entry: firstEntry, discoveryCut: true},
    {proof: {...exactCut, evidenceIds: [0, target]}}]) {
    const {run, requests} = await focusedSettingRun(options);
    assert.equal(requests.filter(({mode}) => mode === "scene-situation").length, 1);
    assert.equal(run.units[target].transitionVerification.sceneBoundary.status, "cut");
    assert.equal(run.units[target].appliedTransition, "none");
    assert.equal(run.units[target].readerCue, false);
    const situationIndex = requests.findIndex(({mode}) => mode === "scene-situation");
    const successorIndex = requests.findIndex(({mode, targetIds}) => mode === "verify" && targetIds[0] === target + 1);
    assert.ok(situationIndex < successorIndex);
  }
  const move = await focusedSettingRun({entry: firstEntry, targetText: relocation, situation: changed});
  assert.equal(move.run.units[target].pattern, "Reset");
  assert.equal(move.run.units[target].sceneSituationVerificationStatus, "changed");
  const typedOnly = await settingRun({typedBoundary: cut, includeSceneEntry: false, situation: uncertain});
  assert.equal(typedOnly.run.units[target].pattern, "Baseline");
  assert.equal(typedOnly.run.units[target].appliedTransition, "uncertain-continuity");
  assert.deepEqual(typedOnly.requests.filter(({mode}) => mode === "scene-situation"),
    [{...typedOnly.requests.find(({mode, targetIds}) => mode === "transition" && targetIds[0] === target),
      mode: "scene-situation"}]);
});

test("setting proof cannot cross a protected boundary or cite a clipped earlier situation", async () => {
  const protectedRun = await focusedSettingRun({protectedPrior: true});
  assert.ok(!protectedRun.requests.some(({mode}) => mode === "scene-situation"));
  assert.equal(protectedRun.run.units[0].pattern, "Stop");
  assert.equal(protectedRun.run.units[target].pattern, "Baseline");
  assert.equal(protectedRun.run.units[target].sceneSituationVerificationStatus, "path-ineligible");
  assert.equal(protectedRun.run.units[target].readerCue, false);
  const clipped = await focusedSettingRun({prefixUnits: 2, situation: changed});
  assert.equal(clipped.run.units[target].sceneSituationVerificationStatus, "invalid-response");
  assert.equal(clipped.run.units[target].pattern, "Baseline");
  assert.equal(clipped.run.units[target].readerCue, false);
});
