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
const cut = {status: "cut", reason: "setting-shift", previousId: 1, entryId: target};
const firstEntry = {status: "cut", reason: "material-setting", previousId: 1, changeId: target, entryId: target};
const boundary = {...cut, changeId: target, contrast: "material-change"};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});

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

async function settingRun({targetText = viewpoint, situation = same, situationFailure, typedBoundary = unresolvedBoundary,
  priorStop = false, verifySettingSituation = true, budget} = {}) {
  const text = `${earlierText} ${targetText}`;
  const index = buildWholeStoryIndex(text);
  const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
    purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: index.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const requests = [];
  const provider = Object.assign(async request => {
    requests.push(request);
    if (request.mode === "scene-entry") return {status: "ok", usage, facts: [{unitId: target, sceneEntry: firstEntry}]};
    if (request.mode === "scene-boundary") return {status: "ok", usage, facts: [{unitId: target, sceneBoundary: boundary}]};
    if (request.mode === "scene-situation") return situationFailure ? {status: situationFailure, usage} :
      {status: "ok", usage, facts: [{unitId: target, sceneSituation: situation}]};
    return {status: "ok", usage, facts: request.targetIds.map(id => {
      const cue = neutral(id);
      if (request.mode === "transition") return {...cue, depiction: "unknown", narrativePhase: "unknown", action: "unknown",
        sceneBoundary: typedBoundary};
      const status = request.mode === "discovery" ? "candidate" : "verified";
      if (id === 1 && priorStop) return {...cue, status, transition: "hard-stop", fact: "protective", evidenceIds: [id]};
      if (id === 1) return {...cue, status, depiction: "romantic", narrativePhase: "build", action: "anticipation",
        fact: "low", scopeId: 0, evidenceIds: [0, 1]};
      return cue;
    })};
  }, {sceneBoundaryProtocol: true});
  const run = await runLunaProtocolShadow({id: "grounded-setting-study", text, grant, now: () => 1, provider, budget,
    verificationTargets: [0, 1, target], transitionTargets: [target], verifyTransitions: true, sceneEntryVerificationTargets: [target],
    sceneEntryArbitration: true, boundaryEntryConfirmation: true, verifySettingSituation, negativeStride: 0});
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

test("setting grounding leaves typed material cuts and preceding protection in force", async () => {
  const typed = await settingRun({typedBoundary: cut});
  assert.equal(typed.run.units[target].pattern, "Reset");
  assert.ok(!typed.requests.some(({mode}) => mode === "scene-situation"));
  const protectedRun = await settingRun({priorStop: true});
  assert.equal(protectedRun.run.units[1].pattern, "Stop");
  assert.equal(protectedRun.run.units[target].readerCue, false);
  assert.ok(!protectedRun.requests.some(({mode}) => mode === "scene-situation"));
});
