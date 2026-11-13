import assert from "node:assert/strict";
import test from "node:test";
import {createLunaProtocolProvider, LUNA_PROTOCOL_MODEL} from "../scripts/lib/luna-protocol-provider.mjs";
import {createLunaShadowBudget, runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const text = "June packed up the workshop. The next morning, she started her shift at the depot. Lee brought over the route sheet. They reviewed the schedule together.";
const index = buildWholeStoryIndex(text);
const sourceUnits = index.units.map(({id, text}) => ({id, text}));
const usage = {inputTokens: 100, outputTokens: 20};
const firstEntry = {status: "cut", reason: "material-time", previousId: 0, changeId: 1, entryId: 1};
const enteredEarlier = {...firstEntry, status: "none", reason: "already-entered"};
const noEntry = {status: "none", reason: "viewpoint-only", previousId: null, changeId: null, entryId: null};
const uncertain = {...noEntry, status: "uncertain", reason: "insufficient-prefix"};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const typedCut = {status: "cut", reason: "time-jump", previousId: 0, entryId: 1};
const typed = (row, sceneBoundary = noBoundary) => ({...row, depiction: "unknown", narrativePhase: "unknown",
  action: "unknown", sceneBoundary});
const result = (unitId, sceneEntry) => ({status: "ok", usage, facts: [{unitId, sceneEntry}]});
const response = facts => Response.json({model: LUNA_PROTOCOL_MODEL, status: "completed", output: [
  {type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({facts})}]},
]});

test("first-entry request is a strict independent causal comparison", async () => {
  let sent;
  const request = {mode: "scene-entry", units: sourceUnits.slice(0, 2), targetIds: [1]};
  const provider = createLunaProtocolProvider({apiKey: "neutral-fixture", fetchImpl: async (_url, {body}) => {
    sent = JSON.parse(body);
    return response([{unitId: 1, sceneEntry: firstEntry}]);
  }});
  assert.deepEqual((await provider({...request, priorVerdict: typed(neutral(1), typedCut)})).facts,
    [{unitId: 1, sceneEntry: firstEntry}]);
  assert.deepEqual(JSON.parse(sent.input), {units: request.units, targetIds: [1]});
  assert.equal(sent.text.format.name, "nocturne_luna_scene_entry_v1");
  const schema = sent.text.format.schema.properties.facts.items;
  assert.deepEqual(schema.required, ["unitId", "sceneEntry"]);
  assert.equal(schema.properties.sceneEntry.additionalProperties, false);
  assert.match(sent.instructions, /earliest supplied unit/u);
  assert.match(sent.instructions, /why the prior episode no longer governs/u);
  assert.match(sent.instructions, /enacted departure into a distinct journey/u);
  assert.match(sent.instructions, /a simultaneous glance at a background action/u);
  assert.match(sent.instructions, /a step that fulfills, resolves or interrupts the prior activity/u);
  assert.match(sent.instructions, /elapsed time alone can bridge the same episode/u);
  assert.equal((await provider({...request, units: sourceUnits})).status, "invalid-request");
  assert.equal((await provider({...request, focus: "continuity-boundary"})).status, "invalid-request");
  assert.equal((await provider({...request, attested: [{unitId: 0, scopeId: 0, frame: "current", action: "contact",
    narrativePhase: "onset"}]})).status, "invalid-request");
});

test("the focused time witness receives only the exact causal prefix", async () => {
  let sent, calls = 0;
  const request = {mode: "scene-entry", focus: "material-time-witness", units: sourceUnits.slice(0, 2), targetIds: [1]};
  const provider = createLunaProtocolProvider({apiKey: "neutral-fixture", fetchImpl: async (_url, {body}) => {
    calls++;
    sent = JSON.parse(body);
    return response([{unitId: 1, sceneEntry: firstEntry}]);
  }});
  assert.deepEqual((await provider({...request, earlierVerdict: typed(neutral(1), typedCut)})).facts,
    [{unitId: 1, sceneEntry: firstEntry}]);
  assert.deepEqual(JSON.parse(sent.input), {units: request.units, targetIds: [1]});
  assert.equal(sent.text.format.name, "nocturne_luna_scene_entry_v1");
  assert.match(sent.instructions, /material displacement in time/u);
  assert.match(sent.instructions, /within the same episode is elapsed-continuation/u);
  assert.equal((await provider({...request, mode: "scene-boundary"})).status, "invalid-request");
  assert.equal((await provider({...request, units: sourceUnits.slice(1, 2)})).status, "invalid-request");
  assert.equal((await provider({...request, units: sourceUnits})).status, "invalid-request");
  assert.equal((await provider({...request, attested: [{unitId: 0}]})).status, "invalid-request");
  assert.equal(calls, 1);
});

test("first-entry coordinates and status are validated before facts leave the provider", async () => {
  for (const [sceneEntry, expected] of [[enteredEarlier, null], [noEntry, null], [uncertain, null],
    [{...firstEntry, entryId: 3, changeId: 2, reason: "material-setting"}, null],
    [{...firstEntry, entryId: 3, changeId: 2, reason: "material-objective"}, null],
    [{...noEntry, reason: "ordinary-interruption"}, null], [{...noEntry, reason: "routine-movement"}, null],
    [{...firstEntry, entryId: 3, changeId: 2}, null],
    [{...firstEntry, entryId: 2}, "scene-entry-evidence"],
    [{...firstEntry, entryId: 3, previousId: 2}, "scene-entry-evidence"],
    [{...firstEntry, entryId: 3, previousId: 1, changeId: 4}, "scene-entry-evidence"],
    [{...enteredEarlier, entryId: 3}, "scene-entry-evidence"],
    [{...noEntry, previousId: 0}, "scene-entry-evidence"],
    [{...uncertain, changeId: 1}, "scene-entry-evidence"],
    [{...enteredEarlier, reason: "material-time"}, "scene-entry-shape"],
    [{...noEntry, note: sourceUnits[0].text}, "scene-entry-shape"]]) {
    const provider = createLunaProtocolProvider({apiKey: "neutral-fixture",
      fetchImpl: async () => response([{unitId: 3, sceneEntry}])});
    const answer = await provider({mode: "scene-entry", units: sourceUnits, targetIds: [3]});
    if (expected) {
      assert.equal(answer.status, "invalid-response");
      const [rejected] = answer.targetFailures;
      assert.equal(answer.targetFailures.length, 1);
      assert.equal(rejected.unitId, 3);
      assert.equal(rejected.reason, expected);
      assert.equal(rejected.detail?.status, expected === "scene-entry-evidence" ? sceneEntry.status : undefined);
      assert.equal(JSON.stringify(answer).includes(sourceUnits[0].text), false);
    } else {
      assert.deepEqual(answer.facts, [{unitId: 3, sceneEntry}]);
    }
  }
});

function run({sceneEntryVerificationTargets = [], verdict = id => result(id, id === 1 ? firstEntry : enteredEarlier),
  approved = [0, 1, 2, 3], transitionTargets = [1, 2], observed = [], priorStop = false, budget} = {}) {
  const provider = Object.assign(async request => {
    observed.push(request);
    if (request.mode === "scene-entry") return verdict(request.targetIds[0]);
    return {status: "ok", usage, facts: request.targetIds.map(id => {
      const local = id === 1 && priorStop ? {...neutral(id), status: "verified", transition: "hard-stop",
        fact: "protective", evidenceIds: [id]} : neutral(id);
      if (request.mode === "transition") return typed(local, id === 1 && !priorStop ? typedCut : noBoundary);
      return request.mode === "discovery" && local.status === "verified" ? {...local, status: "candidate"} : local;
    })};
  }, {sceneBoundaryProtocol: true});
  const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
    purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: index.units.filter(({id}) => approved.includes(id)).map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  return runLunaProtocolShadow({id: "first-entry", text, grant, now: () => 1, provider, budget, negativeStride: 0,
    verificationTargets: transitionTargets, transitionTargets, verifyTransitions: true, sceneEntryVerificationTargets});
}

test("a rejected entry exports coordinate relationships without rejected IDs or text", async () => {
  const misordered = {...firstEntry, previousId: 0, changeId: 0, entryId: 2};
  const detail = {status: "cut", reason: "material-time", previousEvidence: "earlier-prefix",
    changeEvidence: "earlier-prefix", entryEvidence: "after-target", inOrder: false};
  const provider = createLunaProtocolProvider({apiKey: "neutral-fixture",
    fetchImpl: async () => response([{unitId: 1, sceneEntry: misordered}])});
  const answer = await provider({mode: "scene-entry", units: sourceUnits.slice(0, 2), targetIds: [1]});
  const rejected = {unitId: 1, reason: "scene-entry-evidence", detail};
  assert.deepEqual(answer.targetFailures, [rejected]);
  for (const [verdict, expected] of [[result(1, misordered), detail], [answer, detail],
    [{...answer, targetFailures: [{...rejected, detail: {...detail, note: sourceUnits[0].text}}]}, undefined]]) {
    const replay = await run({sceneEntryVerificationTargets: [1], verdict: () => verdict});
    const attempt = replay.summary.attempts.find(row => row.mode === "scene-entry");
    assert.equal(attempt.status, "invalid-response");
    assert.deepEqual(attempt.rejectedFacts, [{id: 1, reason: "scene-entry-evidence", ...(expected ? {detail: expected} : {})}]);
    assert.equal(replay.units[1].sceneEntryVerification, undefined);
  }
});

test("entry and its adjacent already-entered control retain independent verdicts without playback authority", async () => {
  const controlRequests = [], observed = [];
  const control = await run({observed: controlRequests});
  const candidate = await run({observed, sceneEntryVerificationTargets: [1, 2]});
  assert.deepEqual(observed.slice(0, -2), controlRequests);
  for (const id of [1, 2]) {
    const typedRequest = controlRequests.find(row => row.mode === "transition" && row.targetIds[0] === id);
    assert.deepEqual(observed.find(row => row.mode === "scene-entry" && row.targetIds[0] === id),
      {mode: "scene-entry", units: typedRequest.units, targetIds: [id]});
    const {sceneEntryVerification, sceneEntryVerificationStatus, ...unchanged} = candidate.units[id];
    assert.deepEqual(unchanged, control.units[id]);
    assert.deepEqual(sceneEntryVerification, {unitId: id, id, sceneEntry: id === 1 ? firstEntry : enteredEarlier});
    assert.equal(sceneEntryVerificationStatus, id === 1 ? "cut" : "none");
  }
  assert.equal(candidate.units[1].appliedTransition, "scene-cut");
  assert.equal(candidate.units[2].appliedTransition, "none");
  assert.equal(candidate.units[2].sceneId, candidate.units[1].sceneId);
  const contradicted = await run({sceneEntryVerificationTargets: [1], verdict: id => result(id, noEntry)});
  assert.equal(contradicted.units[1].sceneEntryVerificationStatus, "none");
  assert.equal(contradicted.units[1].appliedTransition, "scene-cut");
});

test("first-entry calls obey approved spans, budget and diagnostic refusal", async () => {
  const observed = [];
  const resultWithGap = await run({approved: [0, 2, 3], transitionTargets: [2], sceneEntryVerificationTargets: [2], observed});
  assert.deepEqual(observed.find(row => row.mode === "scene-entry").units.map(({id}) => id), [2]);
  assert.equal(resultWithGap.units[2].sceneEntryVerificationStatus, "invalid-response");
  assert.deepEqual(resultWithGap.summary.attempts.find(row => row.mode === "scene-entry").rejectedFacts,
    [{id: 2, reason: "scene-entry-evidence", detail: {status: "none", reason: "already-entered",
    previousEvidence: "outside-prefix", changeEvidence: "outside-prefix", entryEvidence: "outside-prefix", inOrder: true}}]);
  assert.equal(JSON.stringify(resultWithGap).includes(sourceUnits[1].text), false);

  const baselineRequests = [];
  await run({observed: baselineRequests});
  const deferred = await run({budget: createLunaShadowBudget({maxAttempts: baselineRequests.length}), sceneEntryVerificationTargets: [1]});
  assert.equal(deferred.units[1].sceneEntryVerificationStatus, "budget-deferred");
  assert.equal(deferred.summary.attempts.find(row => row.mode === "scene-entry").attempted, undefined);
  const refused = await run({priorStop: true, sceneEntryVerificationTargets: [1, 2], verdict: () => ({status: "refused", usage})});
  assert.equal(refused.units[1].pattern, "Stop");
  assert.equal(refused.units[1].sceneEntryVerificationStatus, "provider-refused");
  assert.equal(refused.units[2].sceneEntryVerificationStatus, "refusal-dependent");
  await assert.rejects(run({sceneEntryVerificationTargets: [0]}), /pinned transition target/u);
  await assert.rejects(run({sceneEntryVerificationTargets: [1, 1]}), /pinned transition target/u);
  await assert.rejects(run({sceneEntryVerificationTargets: Array(25).fill(1)}), /Invalid shadow study options/u);
});

const settingCut = {...typedCut, reason: "setting-shift"};
const settingEntry = {...firstEntry, reason: "material-setting"};
const localNone = (unitId, frame) => ({unitId, localAction: {status: "none", frame, action: "none", phase: "quiet",
  contrast: frame === "current" ? "neutral" : "noncurrent", targetId: null, contextId: null}});

function researchRun({enabled = true, sameEpisode = false, boundary = settingCut, entry = settingEntry, entryResult, focus = neutral,
  doublePositive = false, doublePositiveNext = false, discoveryCitesTarget = false,
  blockedIds = [], approved = [0, 1, 2, 3], observed = [], budget} = {}) {
  const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
    purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: index.units.filter(({id}) => approved.includes(id)).map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    observed.push(request);
    const [id] = request.targetIds;
    if (request.mode === "scene-entry") return id === 1 && entryResult ? entryResult :
      result(id, id === 1 || doublePositiveNext ? entry : enteredEarlier);
    if (request.mode === "local-action") return {status: "ok", usage, facts: [localNone(id, doublePositive ? "noncurrent" : "current")]};
    if (request.mode === "cue-check") return {status: "ok", usage, facts: [focus(id)]};
    if (request.mode === "transition") {
      const later = {...(doublePositiveNext ? settingCut : typedCut), previousId: 0, entryId: 2};
      const local = id === 1 && !doublePositive ? {...neutral(id), status: "verified", transition: "non-romantic-activity-stop",
        evidenceIds: [id]} : neutral(id);
      return {status: "ok", usage, facts: [typed(local, id === 1 ? boundary : later)]};
    }
    return {status: "ok", usage, facts: request.targetIds.map(id => {
      if (request.mode === "verify" && (id === 1 && doublePositive || id === 2 && doublePositiveNext)) {
        return {...neutral(id), status: "verified", fact: "cut", transition: "scene-cut", evidenceIds: [0, id]};
      }
      return request.mode === "discovery" && discoveryCitesTarget ? {...neutral(id), evidenceIds: [id]} : neutral(id);
    })};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "setting-entry-study", text, grant, now: () => 1, provider, budget, blockedIds,
    verificationTargets: [1, 2], transitionTargets: [1, 2], verifyTransitions: true, verifyContinuityBoundary: true,
    maxCueChecks: 2, maxSupportingVerification: 1, sceneEntryVerificationTargets: [1, 2], localActionVerificationTargets: [1, 2],
    sceneEntryArbitration: enabled, sameEpisodeArbitration: sameEpisode});
}

test("opt-in arbitration restores only a corroborated exact setting cut before later causal controls", async () => {
  const controlRequests = [], observed = [];
  const baseline = await researchRun({enabled: false, observed: controlRequests});
  const candidate = await researchRun({observed});
  const firstEntryRequest = observed.find(row => row.mode === "scene-entry" && row.targetIds[0] === 1);
  const nextControl = observed.find(row => row.mode === "verify" && row.targetIds[0] === 2);
  assert.deepEqual(firstEntryRequest, controlRequests.find(row => row.mode === "scene-entry" && row.targetIds[0] === 1));
  assert.deepEqual(firstEntryRequest, {mode: "scene-entry", units: sourceUnits.slice(0, 2), targetIds: [1]});
  assert.ok(observed.indexOf(firstEntryRequest) > observed.findIndex(row => row.mode === "cue-check" && row.targetIds[0] === 1));
  assert.ok(observed.indexOf(firstEntryRequest) < observed.indexOf(nextControl));
  assert.equal(baseline.units[1].appliedTransition, "none");
  assert.equal(candidate.units[1].appliedTransition, "scene-cut");
  assert.equal(candidate.units[1].pattern, "Reset");
  assert.equal(candidate.units[1].sceneEntryArbitration, "corroborated-setting-cut");
  assert.equal(candidate.units[1].cue, false);
  assert.equal(candidate.units[1].cueRecoveryCorrection, "continuity-cut-veto");
  assert.equal(candidate.units[1].transitionVerification.transition, "non-romantic-activity-stop");
  assert.equal(candidate.units[2].transitionFlag, "scene-boundary-stale");
  assert.equal(candidate.units[2].appliedTransition, "none");
  assert.equal(candidate.units[2].sceneId, candidate.units[1].sceneId);
  assert.equal(observed.filter(row => row.mode === "scene-entry").length, 2);
});

test("setting arbitration leaves uncertainty, disagreement, verified stops, blocked paths and refusals unapplied", async () => {
  for (const options of [{entry: noEntry}, {entry: uncertain}, {entry: firstEntry}, {entry: {...settingEntry, changeId: 2}},
    {entry: {...settingEntry, previousId: 1}}, {boundary: typedCut}, {blockedIds: [0]}, {approved: [1, 2, 3]},
    {focus: id => ({...neutral(id), evidenceIds: [id]})},
    {focus: id => ({...neutral(id), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [id]})}]) {
    const candidate = await researchRun(options);
    assert.equal(candidate.units[1].sceneEntryArbitration, undefined);
    if (candidate.units[1].cueRecovery?.transition === "hard-stop") assert.equal(candidate.units[1].pattern, "Stop");
  }
  const observed = [];
  const refused = await researchRun({entryResult: {status: "refused", usage}, observed});
  assert.equal(refused.units[1].sceneEntryArbitration, undefined);
  assert.equal(refused.summary.attempts.find(row => row.mode === "scene-entry" && row.targetIds[0] === 1).status, "provider-refused");
  assert.equal(observed.some(row => row.mode === "transition" && row.targetIds[0] === 2), false);
  const deferred = await researchRun({budget: createLunaShadowBudget({maxAttempts: 6})});
  assert.equal(deferred.units[1].sceneEntryArbitration, undefined);
  assert.equal(deferred.summary.attempts.find(row => row.mode === "scene-entry" && row.targetIds[0] === 1).status, "budget-deferred");
});

test("a strict viewpoint conflict stays diagnostic when both legacy setting votes agree", async () => {
  const candidate = await researchRun({doublePositive: true, entry: noEntry});
  assert.equal(candidate.units[1].appliedTransition, "scene-cut");
  assert.equal(candidate.units[1].sceneEntryArbitration, "viewpoint-conflict");
  const control = await researchRun({doublePositive: true, entry: noEntry, boundary: typedCut});
  assert.equal(control.units[1].appliedTransition, "scene-cut");
  assert.equal(control.units[1].sceneEntryArbitration, undefined);
});

test("independent same-episode proof vetoes a double-positive cut before later causal controls", async () => {
  const observed = [];
  const linked = id => ({...neutral(id), evidenceIds: [0, id]});
  const options = {doublePositive: true, entry: noEntry, discoveryCitesTarget: true, focus: linked};
  const before = await researchRun(options);
  const after = await researchRun({...options, sameEpisode: true, observed});
  const first = observed.findIndex(row => row.mode === "scene-entry" && row.targetIds[0] === 1);
  const check = observed.findIndex(row => row.mode === "cue-check" && row.targetIds[0] === 1);
  const next = observed.findIndex(row => row.mode === "verify" && row.targetIds[0] === 2);
  assert.ok(first >= 0 && first < check && check < next);
  assert.deepEqual(observed[check], {mode: "cue-check", units: sourceUnits.slice(0, 2), targetIds: [1], focus: "episode-boundary"});
  assert.equal(after.units[0].sceneId, before.units[0].sceneId);
  assert.equal(after.units[0].appliedTransition, before.units[0].appliedTransition);
  assert.equal(before.units[1].appliedTransition, "scene-cut");
  assert.equal(after.units[1].appliedTransition, "none");
  assert.equal(after.units[1].sceneId, after.units[0].sceneId);
  assert.equal(after.units[1].pattern, "Baseline");
  assert.equal(after.units[1].cue, false);
  assert.equal(after.units[1].sceneEntryArbitration, "same-episode-veto");
  assert.equal(after.units[1].primaryPrefix.transition, "scene-cut");
  assert.equal(after.units[1].transitionVerification.sceneBoundary.status, "cut");
  assert.equal(after.units[1].cueRecoveryCorrection, "same-episode-veto");
  assert.equal(before.units[2].transitionFlag, "scene-boundary-stale");
  assert.notEqual(after.units[2].transitionFlag, "scene-boundary-stale");
  const capped = [];
  const two = await researchRun({...options, sameEpisode: true, doublePositiveNext: true, observed: capped});
  assert.equal(two.units[1].sceneEntryArbitration, "same-episode-veto");
  assert.equal(two.units[2].appliedTransition, "scene-cut");
  assert.equal(capped.filter(row => row.focus === "episode-boundary").length, 1);
});

test("same-episode arbitration preserves genuine cuts, missing corroboration and protective effects", async () => {
  const base = {doublePositive: true, sameEpisode: true};
  const linked = id => ({...neutral(id), evidenceIds: [0, id]});
  for (const options of [{entry: settingEntry, focus: linked}, {entry: uncertain, focus: linked},
    {entry: enteredEarlier, focus: linked}, {entry: noEntry, focus: neutral},
    {entry: noEntry, focus: id => ({...neutral(id), evidenceIds: [id]})},
    {entry: noEntry, focus: id => ({...neutral(id), status: "uncertain"})}]) {
    const run = await researchRun({...base, ...options});
    assert.equal(run.units[1].appliedTransition, "scene-cut");
    assert.notEqual(run.units[1].sceneEntryArbitration, "same-episode-veto");
  }
  const observed = [];
  const blocked = await researchRun({...base, entry: noEntry, focus: linked, blockedIds: [0], observed});
  assert.notEqual(blocked.units[1].sceneEntryArbitration, "same-episode-veto");
  assert.equal(observed.some(row => row.focus === "episode-boundary"), false);
  const protective = await researchRun({...base, entry: noEntry, focus: id => ({...neutral(id), status: "verified",
    transition: "hard-stop", fact: "protective", evidenceIds: [id]})});
  assert.equal(protective.units[1].appliedTransition, "hard-stop");
  assert.equal(protective.units[1].pattern, "Stop");
  assert.equal(protective.units[1].cue, false);
});

const objectiveEntry = {...firstEntry, reason: "material-objective"};
const objectiveBoundary = {status: "cut", reason: "objective-shift", previousId: 0, changeId: 1, entryId: 1,
  contrast: "material-change"};
const onset = unitId => ({...neutral(unitId), status: "verified", depiction: "romantic", action: "contact",
  narrativePhase: "onset", transition: "onset", scopeId: 0, evidenceIds: [unitId]});
const accent = {...onset(1), action: "change", narrativePhase: "sustain", transition: "accent", evidenceIds: [0, 1]};
const isolatedCue = {status: "verified", frame: "current", action: "change", phase: "onset", contrast: "enacted",
  targetId: 1, contextId: null};

function independentRun({enabled = true, action = false, entry = objectiveEntry, boundary = objectiveBoundary,
  localAction = isolatedCue, priorStop = false, priorNeutralize = false, typedOnset = false, discoveryCut = false,
  staleControl = false, explicitBoundary = false,
  approved = [0, 1, 2, 3], blockedIds = [], budget, observed = []} = {}) {
  const targets = [1, 2];
  const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
    purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: index.units.filter(({id}) => approved.includes(id)).map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    observed.push(request);
    const [id] = request.targetIds;
    if (request.mode === "scene-entry") return result(id, id === 1 ? entry :
      {...objectiveEntry, previousId: 1, changeId: 2, entryId: 2});
    if (request.mode === "scene-boundary") return boundary?.status === "refused" ? {status: "refused", usage} :
      {status: "ok", usage, facts: [{unitId: id, sceneBoundary: id === 1 ? boundary :
        {...objectiveBoundary, previousId: 1, changeId: 2, entryId: 2}}]};
    if (request.mode === "local-action") return {status: "ok", usage, facts: [
      action ? {unitId: id, localAction} : localNone(id, "current")]};
    return {status: "ok", usage, facts: request.targetIds.map(unitId => {
      let cue = neutral(unitId);
      if (unitId === 0 && priorStop) cue = {...cue, status: "verified", transition: "hard-stop",
        fact: "protective", evidenceIds: [unitId]};
      else if (action && !priorNeutralize && unitId === 0) cue = onset(unitId);
      else if (action && unitId === 1) cue = request.mode === "discovery" ? onset(unitId) : accent;
      if (discoveryCut && unitId === 1 && request.mode === "discovery") return {...cue, status: "candidate",
        transition: "scene-cut", fact: "cut", scopeId: unitId, evidenceIds: [0, unitId]};
      if (request.mode === "discovery" && cue.status === "verified") return {...cue, status: "candidate"};
      if (request.mode === "transition") {
        if (priorNeutralize && unitId === 0) return typed({...neutral(unitId), status: "verified",
          transition: "uncertain-continuity", fact: "neutralize", evidenceIds: [unitId]});
        if (typedOnset && unitId === 1) return typed({...onset(unitId), scopeId: null});
        const rawBoundary = unitId === 2 && staleControl ? {...typedCut, entryId: 2} :
          action && unitId === 1 ? {status: "uncertain", reason: "unclear", previousId: null, entryId: null} : noBoundary;
        return typed(cue, rawBoundary);
      }
      return cue;
    })};
  }, {sceneBoundaryProtocol: true});
  const typedTargets = priorNeutralize ? [0, ...targets] : targets;
  return runLunaProtocolShadow({id: "independent-entry-study", text, grant, now: () => 1, provider, budget, blockedIds,
    prefixUnits: staleControl ? 24 : 2, negativeStride: 0,
    verificationTargets: priorStop || priorNeutralize || action ? [0, ...targets] : targets, transitionTargets: typedTargets,
    verifyTransitions: true, maxTransitionVerification: typedTargets.length, sceneEntryVerificationTargets: targets,
    boundaryVerificationTargets: explicitBoundary ? [1] : [],
    localActionVerificationTargets: [1], sceneEntryArbitration: true, boundaryEntryConfirmation: enabled});
}

test("independent material-entry agreement uses the same causal prefix once and prevents reuse of old scope", async () => {
  const controlRequests = [], observed = [];
  const baseline = await independentRun({enabled: false, action: true, observed: controlRequests});
  const candidate = await independentRun({action: true, observed});
  const entry = observed.find(request => request.mode === "scene-entry" && request.targetIds[0] === 1);
  const boundary = observed.find(request => request.mode === "scene-boundary");
  const later = observed.find(request => request.mode === "verify" && request.targetIds[0] === 2);
  assert.deepEqual(entry, {mode: "scene-entry", units: sourceUnits.slice(0, 2), targetIds: [1]});
  assert.deepEqual(boundary, {...entry, mode: "scene-boundary"});
  assert.ok(observed.indexOf(entry) < observed.indexOf(boundary));
  assert.ok(observed.indexOf(boundary) < observed.indexOf(later));
  assert.equal(observed.length, controlRequests.length + 1);
  assert.equal(observed.filter(request => request.mode === "scene-boundary").length, 1);
  assert.ok(controlRequests.find(request => request.mode === "verify" && request.targetIds[0] === 2).attested
    .some(({unitId}) => unitId === 0));
  assert.equal(later.attested, undefined);
  assert.equal(baseline.units[1].appliedTransition, "accent");
  assert.equal(baseline.units[1].readerCue, true);
  const unit = candidate.units[1];
  assert.equal(unit.appliedTransition, "scene-cut");
  assert.equal(unit.pattern, "Reset");
  assert.equal(unit.beatId, null);
  assert.equal(unit.cue, true);
  assert.equal(unit.readerCue, false);
  assert.equal(unit.localActionApplication, "independent-cut-local-cue");
  assert.equal(unit.sceneEntryArbitration, "independently-confirmed-cut");
  assert.equal(unit.transitionFlag, "scene-boundary-independently-confirmed");
  assert.equal(unit.transitionVerification.sceneBoundary.status, "uncertain");
  assert.deepEqual(unit.boundaryVerification.sceneBoundary, objectiveBoundary);
  assert.deepEqual(unit.transitionEvidenceIds, [0, 1]);
  assert.notEqual(unit.sceneId, candidate.units[0].sceneId);
  const withoutLocalProof = await independentRun({action: true, localAction: {...isolatedCue, contextId: 0}});
  assert.equal(withoutLocalProof.units[1].pattern, "Reset");
  assert.equal(withoutLocalProof.units[1].cue, false);
  assert.equal(withoutLocalProof.units[1].readerCue, false);
});

test("an independently confirmed neutral cut rejects a stale later vote", async () => {
  const candidate = await independentRun({staleControl: true});
  assert.equal(candidate.units[1].pattern, "Reset");
  assert.equal(candidate.units[1].cue, false);
  assert.equal(candidate.units[2].appliedTransition, "none");
  assert.equal(candidate.units[2].transitionFlag, "scene-boundary-stale");
  assert.equal(candidate.units[2].sceneId, candidate.units[1].sceneId);
});

test("exact independent cut settles local accent and onset disagreement after closed playback", async () => {
  const observed = [];
  const candidate = await independentRun({action: true, typedOnset: true, priorNeutralize: true,
    localAction: {...isolatedCue, status: "none", frame: "noncurrent", action: "none", phase: "quiet", contrast: "noncurrent", targetId: null},
    observed});
  assert.equal(candidate.units[0].appliedTransition, "uncertain-continuity");
  assert.equal(candidate.units[0].pattern, "Baseline");
  assert.equal(candidate.units[1].transitionVerification.transition, "onset");
  assert.equal(candidate.units[1].primaryPrefix.transition, "accent");
  assert.equal(candidate.units[1].appliedTransition, "scene-cut");
  assert.equal(candidate.units[1].pattern, "Reset");
  assert.equal(candidate.units[1].cue, false);
  assert.equal(candidate.units[1].readerCue, false);
  assert.equal(candidate.units[1].independentBoundaryStatus, "corroborated");
  assert.deepEqual(observed.find(request => request.mode === "scene-boundary"),
    {...observed.find(request => request.mode === "scene-entry" && request.targetIds[0] === 1), mode: "scene-boundary"});
});

test("a quiet provisional discovery cut only nominates independent confirmation", async () => {
  const qualifying = {discoveryCut: true};
  const baseline = await independentRun({...qualifying, enabled: false});
  const confirmed = await independentRun(qualifying);
  assert.equal(baseline.units[1].appliedTransition, "none");
  assert.equal(confirmed.units[1].appliedTransition, "scene-cut");
  assert.equal(confirmed.units[1].cue, false);
  assert.equal(confirmed.units[1].readerCue, false);
  assert.equal(confirmed.units[1].independentBoundaryStatus, "corroborated");
  assert.equal(confirmed.units[2].independentBoundaryStatus, "confirmation-limit");
  const disagree = await independentRun({...qualifying, boundary: {...objectiveBoundary, reason: "setting-shift"}});
  assert.equal(disagree.units[1].appliedTransition, "none");
  assert.equal(disagree.units[1].independentBoundaryStatus, "disagreement");
  const unproved = await independentRun({...qualifying, entry: uncertain});
  assert.equal(unproved.units[1].appliedTransition, "none");
  assert.equal(unproved.units[1].independentBoundaryStatus, "first-entry-unproved");
  const budget = await independentRun({...qualifying, budget: createLunaShadowBudget({maxAttempts: 5})});
  assert.equal(budget.units[1].appliedTransition, "none");
  assert.equal(budget.units[1].independentBoundaryStatus, "confirmation-deferred");
});

test("independent material-entry comparison preserves uncertain and protected targets", async () => {
  for (const options of [{entry: uncertain}, {entry: noEntry}, {entry: enteredEarlier}, {entry: firstEntry},
    {boundary: {...objectiveBoundary, reason: "setting-shift"}},
    {boundary: {...noBoundary, changeId: null, contrast: "routine-movement"}},
    {boundary: {status: "refused", usage}}, {approved: [1, 2, 3]}, {blockedIds: [0]}, {priorStop: true},
    {explicitBoundary: true}, {budget: createLunaShadowBudget({maxAttempts: 5})}]) {
    const observed = [];
    const candidate = await independentRun({...options, observed});
    assert.equal(candidate.units[1].sceneEntryArbitration, undefined, JSON.stringify(options));
    if (options.priorStop) {
      assert.equal(candidate.units[0].pattern, "Stop");
      assert.equal(observed.some(request => request.mode === "scene-boundary"), false);
      assert.equal(candidate.units[1].independentBoundaryStatus, "priority-barrier");
    }
    if (options.explicitBoundary) assert.equal(observed.filter(request =>
      request.mode === "scene-boundary" && request.targetIds[0] === 1).length, 1);
    if (options.budget) assert.ok(observed.some(request => request.mode === "transition" && request.targetIds[0] === 2),
      JSON.stringify(candidate.summary.attempts));
  }
});

const viewpointText = "The music began. Lee watched the doorway. June waited beside Lee. Across the room, Pat looked up. They waited for the signal.";
const viewpointIndex = buildWholeStoryIndex(viewpointText);
const viewpointTarget = 3;
const viewpointCut = {status: "cut", reason: "setting-shift", previousId: 2, entryId: viewpointTarget};
const viewpointEntry = {status: "cut", reason: "material-setting", previousId: 2, changeId: viewpointTarget, entryId: viewpointTarget};
const sameEpisodeProof = {...neutral(viewpointTarget), evidenceIds: [2, viewpointTarget]};

function viewpointRun({entry = noEntry, proof = sameEpisodeProof, cut = viewpointCut,
  discoveryEvidence = [2, viewpointTarget], firstAnchor = true, sharedScope = true, priorStop = false,
  blockedIds = [], approved = [0, 1, 2, 3, 4], budget, observed = []} = {}) {
  const targets = [1, 2, 3, 4].filter(id => approved.includes(id));
  const grant = {editionDigest: viewpointIndex.editionDigest, segmentationVersion: viewpointIndex.segmentationVersion,
    purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: viewpointIndex.units.filter(({id}) => approved.includes(id)).map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    observed.push(request);
    const [target] = request.targetIds;
    if (request.mode === "scene-entry") return result(target, entry);
    if (request.mode === "cue-check") return {status: "ok", usage, facts: [proof]};
    return {status: "ok", usage, facts: request.targetIds.map(id => {
      if (request.mode === "transition") return typed(neutral(id), id === viewpointTarget ? cut : {...viewpointCut, entryId: 4});
      if (id === viewpointTarget) {
        const discovery = request.mode === "discovery";
        return {...neutral(id), status: discovery ? "candidate" : "verified", fact: "cut", transition: "scene-cut",
          scopeId: id, evidenceIds: discovery ? discoveryEvidence : [0, 1, 2, id]};
      }
      if (id === 2 && priorStop) return {...neutral(id), status: request.mode === "discovery" ? "candidate" : "verified",
        transition: "hard-stop", fact: "protective", evidenceIds: [id]};
      if (id === 2 || id === 1 && firstAnchor) return {...neutral(id), status: request.mode === "discovery" ? "candidate" : "verified",
        depiction: id === 1 ? "suggestive" : "romantic", narrativePhase: "build", action: "anticipation", fact: "low",
        scopeId: id === 2 && !sharedScope ? 1 : 0, evidenceIds: id === 2 ? [1, id] : [0, id]};
      return neutral(id);
    })};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "viewpoint-setting-study", text: viewpointText, grant, now: () => 1, provider, budget,
    blockedIds, negativeStride: 0, verificationTargets: targets, transitionTargets: [3, 4], maxTransitionVerification: 2,
    verifyTransitions: true, sceneEntryVerificationTargets: [3], maxCueChecks: 1,
    sceneEntryArbitration: true, sameEpisodeArbitration: true});
}

test("exact discovery-supported setting disagreement gets one independent viewpoint continuity check", async () => {
  const observed = [];
  const candidate = await viewpointRun({observed});
  const entry = observed.findIndex(request => request.mode === "scene-entry");
  const proof = observed.findIndex(request => request.focus === "episode-boundary");
  const next = observed.findIndex(request => request.mode === "verify" && request.targetIds[0] === 4);
  assert.ok(entry >= 0 && entry < proof && proof < next);
  assert.deepEqual(observed[proof], {...observed[entry], mode: "cue-check", focus: "episode-boundary"});
  assert.equal(observed.filter(request => request.mode === "cue-check").length, 1);
  const row = candidate.units[viewpointTarget];
  assert.equal(row.sceneEntryArbitration, "same-episode-veto");
  assert.equal(row.discovery.transition, "scene-cut");
  assert.equal(row.primaryPrefix.transition, "scene-cut");
  assert.equal(row.transitionVerification.sceneBoundary.status, "cut");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.sceneId, candidate.units[2].sceneId);
  assert.equal(row.beatId, candidate.units[2].beatId);
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(candidate.units[4].appliedTransition, "scene-cut");
});

test("a discovery-supported cut keeps precedence without exact earlier state and affirmative viewpoint continuity", async () => {
  const protectedProof = {...neutral(viewpointTarget), status: "verified", transition: "hard-stop",
    fact: "protective", evidenceIds: [viewpointTarget]};
  for (const options of [{entry: viewpointEntry}, {entry: uncertain}, {entry: {...noEntry, reason: "routine-movement"}},
    {cut: {...viewpointCut, reason: "objective-shift"}}, {discoveryEvidence: [viewpointTarget]},
    {proof: neutral(viewpointTarget)}, {proof: {...sameEpisodeProof, evidenceIds: [1, viewpointTarget]}},
    {proof: protectedProof}, {firstAnchor: false}, {sharedScope: false}, {priorStop: true},
    {blockedIds: [1]}, {approved: [0, 2, 3, 4]}, {budget: createLunaShadowBudget({maxAttempts: 8})}]) {
    const observed = [];
    const candidate = await viewpointRun({...options, observed});
    assert.notEqual(candidate.units[viewpointTarget].sceneEntryArbitration, "same-episode-veto");
    if (options.proof === protectedProof) assert.equal(candidate.units[viewpointTarget].pattern, "Stop");
    else if (options.approved === undefined) assert.equal(candidate.units[viewpointTarget].appliedTransition, "scene-cut");
    if (options.priorStop) assert.equal(candidate.units[2].pattern, "Stop");
    if (options.approved) assert.ok(observed.every(request => request.units.every(({id}) => options.approved.includes(id))));
    if (options.proof && options.proof !== protectedProof) {
      assert.equal(candidate.units[viewpointTarget].sceneEntryArbitration, "viewpoint-conflict");
    }
    if (!options.proof) assert.equal(observed.some(request => request.focus === "episode-boundary"), false);
  }
});
