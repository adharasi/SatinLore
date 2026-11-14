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

const dayStory = "Day 5. Ada checked the maps. Lee put away the lantern.\n\nDay 6. They opened the mountain station.";
const arrivalStory = "June closed the old library. Lee fetched a coat.\n\nThey walked to the bus stop. The driver opened the doors.";
const timeStory = "June checked the recorder. Lee called the test off.\n\nAt dawn they inspected the equipment. They packed it away.";

async function arbitrate(text, {target = 2, first = 0, blockedIds = [], stopped = false, typed, typedFrame = "current", entry, focused, primary, arrived = arrival,
  earlier = oldPlace, observed = [], closed = false, lateCut = false, precedingFrame = "current"} = {}) {
  const indexed = buildWholeStoryIndex(text);
  const scopes = indexed.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}));
  const targets = [target, target + 1];
  const provider = Object.assign(async request => {
    observed.push(request);
    const facts = request.targetIds.map(unitId => {
      const stopFact = (stopped && unitId === target || closed && unitId === target - 1) ?
        {...stop, unitId, evidenceIds: [unitId]} : null;
      const ordinaryEnd = text === timeStory && unitId === target - 1 ? {...quiet(unitId), status: "verified",
        transition: "non-romantic-activity-stop", evidenceIds: [unitId]} : null;
      if (request.mode === "scene-entry") return {unitId, sceneEntry: unitId === target ? entry ?? noEntry("setup-only") :
        lateCut ? {...timeWitness, status: "none", reason: "already-entered"} : noEntry("same-episode")};
      if (request.mode === "scene-old-place") return {unitId, scenePlace: earlier};
      if (request.mode === "scene-arrival") return {unitId, scenePlace: arrived};
      if (request.mode === "transition") return {...(stopFact ?? ordinaryEnd ?? {...quiet(unitId), frame: typedFrame}),
        depiction: "unknown", action: "unknown", narrativePhase: "unknown",
        sceneBoundary: unitId === target ? typed ?? noBoundary : lateCut && unitId === target + 1 ?
          {status: "cut", reason: "time-jump", previousId: target - 1, entryId: unitId} : noBoundary};
      if (request.mode === "cue-check" && unitId === target && focused) return focused;
      if (request.mode === "verify" && unitId === target && primary && !stopFact) return primary;
      return stopFact ?? ordinaryEnd ?? {...quiet(unitId), frame: unitId === target - 1 ? precedingFrame : "current",
        scopeId: unitId === target && text === arrivalStory ? 1 : null};
    });
    return {status: "ok", usage: {inputTokens: 100, outputTokens: 30}, facts};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "boundary-arbitration", text, grant: {...grant,
    editionDigest: indexed.editionDigest, spans: scopes.slice(first)}, now: () => 1, provider, blockedIds,
    verificationTargets: targets, transitionTargets: targets, sceneEntryVerificationTargets: targets,
    verifyTransitions: true, negativeStride: 0, maxCueChecks: 2, verifyContinuityBoundary: true,
    sceneEntryArbitration: true, boundaryEntryConfirmation: true, verifySettingSituation: true, verifyBoundaryArbitration: true});
}

test("a numbered day heading establishes a cut only with an earlier anchored heading in the same narrative", async () => {
  const wide = await arbitrate(dayStory, {target: 3});
  assert.equal(wide.units[3].appliedTransition, "scene-cut");
  assert.equal(wide.units[3].boundaryWitnessStatus, "paired-day-headings");
  assert.equal(wide.units[3].pattern, "Reset");
  assert.deepEqual(wide.units[3].transitionEvidenceIds, [0, 2, 3]);
  assert.equal(wide.units[4].sceneId, wide.units[3].sceneId);
  assert.notEqual(wide.units[2].sceneId, wide.units[3].sceneId);
  const short = await arbitrate(dayStory, {target: 3, first: 1, typedFrame: "neutral", typed: unclear});
  assert.equal(short.units[3].pattern, "Reset");
  assert.equal(short.units[3].appliedTransition, "uncertain-continuity");
  assert.deepEqual(short.units[3].transitionEvidenceIds, [3]);
  assert.equal(short.units[3].sceneId, short.units[2].sceneId);
  for (const variant of [dayStory.replace("Day 6", "Day 5"), dayStory.replace("Day 6.", "They talked about day 6.")]) {
    assert.notEqual((await arbitrate(variant, {target: 3})).units[3].pattern, "Reset");
  }
  for (const options of [{blockedIds: [0]}, {blockedIds: [2]}, {closed: true}, {stopped: true}, {precedingFrame: "reported"}]) {
    assert.notEqual((await arbitrate(dayStory, {...options, target: 3})).units[3].appliedTransition, "scene-cut");
  }
  assert.equal((await arbitrate(dayStory, {target: 3, stopped: true})).units[3].pattern, "Stop");
});

test("paired day headings corroborate an exact typed cut against an uncited continuation veto", async () => {
  const typed = {status: "cut", reason: "time-jump", previousId: 2, entryId: 3};
  const primary = {...quiet(3), depiction: "romantic"};
  const focused = {...primary, evidenceIds: [3]};
  const options = {target: 3, typed, primary, focused, entry: noEntry("elapsed-continuation")};
  const {units} = await arbitrate(dayStory, options);
  assert.equal(units[3].cueRecoveryCorrection, "continuity-cut-veto");
  assert.equal(units[3].sceneEntryVerification.sceneEntry.reason, "elapsed-continuation");
  assert.equal(units[3].boundaryWitnessStatus, "paired-day-headings");
  assert.equal(units[3].appliedTransition, "scene-cut");
  assert.equal(units[3].pattern, "Reset");
  assert.deepEqual(units[3].transitionEvidenceIds, [0, 2, 3]);
  assert.equal(units[4].sceneId, units[3].sceneId);
  const setupOnly = {...options, focused: quiet(3), entry: noEntry("setup-only")};
  assert.equal((await arbitrate(dayStory, setupOnly)).units[3].appliedTransition, "scene-cut");
  const clipped = await arbitrate(dayStory, {...setupOnly, first: 1});
  assert.equal(clipped.units[3].pattern, "Reset");
  assert.equal(clipped.units[3].appliedTransition, "uncertain-continuity");
  assert.deepEqual(clipped.units[3].transitionEvidenceIds, [3]);
  assert.equal(clipped.units[3].sceneId, clipped.units[2].sceneId);
  for (const override of [{entry: noEntry("same-episode")}, {focused: {...focused, evidenceIds: [2, 3]}},
    {typed: {...typed, previousId: 1}}, {precedingFrame: "reported"}]) {
    const negative = await arbitrate(dayStory, {...options, ...override});
    assert.notEqual(negative.units[3].appliedTransition, "scene-cut");
  }
  for (const variant of [dayStory.replace("Day 6", "Day 5"), dayStory.replace("Day 6.", "They talked about day 6.")]) {
    assert.notEqual((await arbitrate(variant, options)).units[3].appliedTransition, "scene-cut");
  }
  assert.equal((await arbitrate(dayStory, {...options, stopped: true})).units[3].pattern, "Stop");
});

test("a named bus stop can nominate independent arrival proof and cannot suppress a real Stop", async () => {
  const observed = [], routine = noEntry("routine-movement");
  const {units} = await arbitrate(arrivalStory, {entry: routine, observed});
  assert.equal(units[2].appliedTransition, "scene-cut");
  assert.equal(units[2].pattern, "Reset");
  assert.equal(units[2].scenePlaceRecoveryStatus, "changed");
  assert.deepEqual(units[2].transitionEvidenceIds, [0, 2]);
  const arrivalRequest = observed.find(({mode}) => mode === "scene-arrival");
  assert.equal(arrivalRequest.focus, "paragraph-arrival");
  assert.equal(arrivalRequest.attested, undefined);
  assert.deepEqual(arrivalRequest.units.map(unit => unit.id), [0, 1, 2]);
  for (const options of [{earlier: noPlace}, {arrived: {...arrival, status: "same"}},
    {arrived: {...arrival, earlierId: 1}}, {blockedIds: [1]}, {stopped: true}]) {
    const outcome = await arbitrate(arrivalStory, {entry: routine, ...options});
    assert.notEqual(outcome.units[2].appliedTransition, "scene-cut");
    if (options.stopped) assert.equal(outcome.units[2].pattern, "Stop");
  }
  const instruction = arrivalStory.replace("They walked to the bus stop.", "They walked to the bus stop and Lee asked June to stop.");
  assert.notEqual((await arbitrate(instruction)).units[2].appliedTransition, "scene-cut");
});

test("an ungrounded continuity veto yields to matching exact time evidence before the successor", async () => {
  const typed = {status: "cut", reason: "time-jump", previousId: 1, entryId: 2};
  const focused = quiet(2);
  const observed = [];
  const {units} = await arbitrate(timeStory, {typed, entry: timeWitness, focused, observed, lateCut: true});
  assert.equal(units[2].cueRecoveryCorrection, "continuity-cut-veto");
  assert.equal(units[2].boundaryWitnessStatus, "corroborated-typed-time-cut");
  assert.equal(units[2].pattern, "Reset");
  assert.equal(units[2].appliedTransition, "scene-cut");
  assert.equal(units[3].appliedTransition, "none");
  assert.equal(units[3].sceneId, units[2].sceneId);
  assert.ok(observed.findIndex(row => row.mode === "scene-entry" && row.targetIds[0] === 2) <
    observed.findIndex(row => row.mode === "verify" && row.targetIds[0] === 3));
  for (const options of [{entry: noEntry("elapsed-continuation")}, {entry: {...timeWitness, previousId: 0}},
    {blockedIds: [1]}, {focused: {...focused, evidenceIds: [1, 2]}}, {focused: stop}]) {
    const negative = await arbitrate(timeStory, {typed, entry: timeWitness, focused, ...options});
    assert.notEqual(negative.units[2].appliedTransition, "scene-cut", JSON.stringify(options));
    if (options.focused === stop) assert.equal(negative.units[2].pattern, "Stop");
  }
});
