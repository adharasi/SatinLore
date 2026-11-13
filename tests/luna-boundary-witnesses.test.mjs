import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const text = "June kept watch at the inn. Lee carried a lamp to the door. At first light, they opened the mountain station. The station opened for travellers.";
const index = buildWholeStoryIndex(text);
const grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion,
  purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 1000,
  spans: index.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
const quiet = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const stop = {...quiet(2), status: "verified", transition: "hard-stop", fact: "protective", evidenceIds: [2]};
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const unclear = {status: "uncertain", reason: "unclear", previousId: null, entryId: null};
const noEntry = reason => ({status: reason === "insufficient-prefix" ? "uncertain" : "none", reason,
  previousId: null, entryId: null, changeId: null});
const time = {status: "cut", reason: "time-jump", previousId: 1, changeId: 2, entryId: 2, contrast: "material-change"};
const timeWitness = {status: "cut", reason: "material-time", previousId: 1, changeId: 2, entryId: 2};
const setting = {...time, reason: "setting-shift"};
const noPlace = {status: "uncertain", earlierId: null, currentId: null};
const oldPlace = {status: "established", earlierId: 0, currentId: null};
const arrival = {status: "distinct", earlierId: 0, currentId: 2};
const proposal = {...quiet(2), status: "candidate", transition: "scene-cut", fact: "cut", evidenceIds: [1, 2]};

async function study({observed = [], boundary = time, witness = timeWitness, old = oldPlace, arrived = arrival,
  entry = noEntry("frame-only"), typed = unclear, discover = quiet(2), primary = quiet(2), spans = grant.spans,
  enabled = true, refused = false} = {}) {
  const provider = Object.assign(async request => {
    observed.push(request);
    const {mode, focus, targetIds} = request;
    if (mode === "scene-boundary" && refused) return {status: "refused"};
    const facts = targetIds.map(unitId => {
      if (mode === "scene-boundary") return {unitId, sceneBoundary: boundary};
      if (mode === "scene-entry") return {unitId, sceneEntry: focus ? witness : unitId === 2 ? entry : noEntry("insufficient-prefix")};
      if (mode === "scene-old-place") return {unitId, scenePlace: old};
      if (mode === "scene-arrival") return {unitId, scenePlace: arrived};
      if (mode === "transition") return {...(unitId === 2 && primary === stop ? stop : quiet(unitId)), depiction: "unknown",
        action: "unknown", narrativePhase: "unknown", sceneBoundary: unitId === 2 ? typed : noBoundary};
      if (mode === "discovery" && unitId === 2) return discover;
      if (mode === "verify" && unitId === 2) return primary;
      return quiet(unitId);
    });
    return {status: "ok", usage: {inputTokens: 100, outputTokens: 30}, facts};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "boundary-witness", text, grant: {...grant, spans}, now: () => 1, provider,
    verificationTargets: [0, 2, 3].filter(id => spans.some(span => span.id === id)),
    transitionTargets: [0, 2, 3].filter(id => spans.some(span => span.id === id)),
    sceneEntryVerificationTargets: [0, 2, 3].filter(id => spans.some(span => span.id === id)),
    verifyTransitions: true, negativeStride: 0, sceneEntryArbitration: true, boundaryEntryConfirmation: true,
    verifySettingSituation: true, verifyBoundaryWitnesses: enabled});
}

test("an unresolved quiet time boundary needs two exact current witnesses before any successor", async () => {
  const observed = [], {units, summary} = await study({observed});
  const target = units[2];
  assert.equal(target.transitionVerification.sceneBoundary.status, "uncertain");
  assert.equal(target.sceneEntryVerification.sceneEntry.reason, "frame-only");
  assert.equal(target.boundaryVerification.sceneBoundary.reason, "time-jump");
  assert.deepEqual(target.sceneTimeWitness.sceneEntry, timeWitness);
  assert.equal(target.sceneTimeWitnessStatus, "cut");
  assert.equal(target.boundaryWitnessStatus, "confirmed-time-cut");
  assert.equal(target.appliedTransition, "scene-cut");
  assert.equal(target.pattern, "Reset");
  assert.deepEqual(target.transitionEvidenceIds, [1, 2]);
  assert.equal(units[3].sceneId, target.sceneId);
  assert.notEqual(target.sceneId, units[1].sceneId);
  const at = observed.findIndex(request => request.focus === "material-time-witness");
  assert.deepEqual(observed[at - 1], {mode: "scene-boundary", units: observed[at].units, targetIds: [2]});
  assert.deepEqual(observed[at].units.map(({id}) => id), [0, 1, 2]);
  assert.equal(observed[at].attested, undefined);
  assert.ok(at < observed.findIndex(request => request.mode === "verify" && request.targetIds[0] === 3));
  assert.equal(summary.attempts.filter(row => row.id.endsWith(":boundary-witnesses")).length, 1);
  assert.equal(summary.attempts.find(row => row.focus === "material-time-witness").mode, "scene-entry");
});

test("a first-entry abstention only grounds a setting cut with matching old and new place witnesses", async () => {
  const observed = [];
  const {units} = await study({observed, boundary: setting, entry: noEntry("insufficient-prefix"), typed: noBoundary});
  const target = units[2];
  assert.equal(target.boundaryWitnessStatus, "confirmed-setting-cut");
  assert.equal(target.pattern, "Reset");
  assert.equal(target.sceneEntryVerification.sceneEntry.reason, "insufficient-prefix");
  assert.equal(target.boundaryVerification.sceneBoundary.previousId, 1);
  assert.deepEqual(target.transitionEvidenceIds, [0, 2]);
  assert.deepEqual(observed.filter(({mode, targetIds}) => mode.startsWith("scene-") && targetIds[0] === 2).map(({mode}) => mode),
    ["scene-entry", "scene-boundary", "scene-old-place", "scene-arrival"]);
  for (const options of [{old: noPlace}, {arrived: {...arrival, status: "same"}}, {arrived: {...arrival, earlierId: 1}}]) {
    const negative = await study({boundary: setting, ...options});
    assert.equal(negative.units[2].boundaryWitnessStatus, "setting-unconfirmed");
    assert.equal(negative.units[2].appliedTransition, "none");
    assert.notEqual(negative.units[2].pattern, "Reset");
  }
});

test("routine movement, incomplete or competing evidence, and refusal cannot apply the fallback cut", async () => {
  const routine = {...noBoundary, changeId: null, contrast: "routine-movement"};
  const insufficient = {...unclear, changeId: null, contrast: "insufficient-prefix"};
  for (const options of [{boundary: routine}, {boundary: insufficient}, {witness: noEntry("elapsed-continuation")},
    {witness: {...timeWitness, previousId: 0}}, {witness: {...timeWitness, reason: "material-setting"}},
    {witness: {...timeWitness, entryId: 3}}, {refused: true}]) {
    const observed = [], {units} = await study({...options, observed});
    assert.notEqual(units[2].pattern, "Reset");
    assert.notEqual(units[2].appliedTransition, "scene-cut");
    if (options.boundary || options.refused) assert.equal(observed.some(request => request.focus), false);
  }
});

test("unscoped discovery may nominate the same exact checks but a grant gap and protective Stop retain priority", async () => {
  const widened = await study({typed: noBoundary, entry: noEntry("setup-only"), discover: proposal});
  assert.equal(widened.units[2].boundaryWitnessStatus, "confirmed-time-cut");
  for (const options of [{spans: grant.spans.filter(span => span.id !== 1)}, {primary: stop},
    {entry: noEntry("routine-movement")}, {enabled: false}]) {
    const observed = [], {units} = await study({...options, observed});
    assert.equal(observed.some(request => request.mode === "scene-boundary" && request.targetIds[0] === 2), false);
    assert.equal(units[2].boundaryWitnessStatus, undefined);
    if (options.primary) assert.equal(units[2].pattern, "Stop");
  }
});
