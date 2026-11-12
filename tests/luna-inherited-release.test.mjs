import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const quiet = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const opening = {...quiet(0), status: "verified", depiction: "romantic", narrativePhase: "onset", action: "contact",
  transition: "onset", scopeId: 0, evidenceIds: [0]};
const release = {...quiet(1), status: "verified", depiction: "romantic", narrativePhase: "ease", action: "release",
  transition: "interruption", fact: "ease", scopeId: 0, evidenceIds: [0, 1], priorAnchor: 0};
const repeatedEase = {...quiet(2), status: "verified", narrativePhase: "ease", fact: "ease",
  scopeId: 1, evidenceIds: [1, 2], priorAnchor: 1};
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const ordinaryInterruption = {status: "none", reason: "ordinary-interruption", previousId: null, changeId: null, entryId: null};
const localRelease = (targetId, contextId) => ({status: "verified", frame: "current", action: "release", phase: "ease",
  contrast: "softening", targetId, contextId});
const localNeutral = {status: "none", frame: "noncurrent", action: "none", phase: "quiet", contrast: "noncurrent",
  targetId: null, contextId: null};
const usage = {inputTokens: 100, outputTokens: 20};

function run({observed = [], first = opening, later = repeatedEase, laterDiscovery = quiet(2), laterTyped = {frame: "neutral"},
  laterLocal = localNeutral, laterBoundary = noBoundary, earlierLocal = localRelease(1, 0), blockedIds = [],
  releaseText = "They slowed their steps in time with the music.", separator = " "} = {}) {
  const text = `Mira took Lee's hand. ${releaseText}${separator}The musicians played softly. The lights dimmed.`;
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    observed.push(request);
    const facts = request.targetIds.map(id => {
      if (request.mode === "scene-entry") return {unitId: id, sceneEntry: ordinaryInterruption};
      if (request.mode === "local-action") return {unitId: id, localAction: id === 1 ? earlierLocal : laterLocal};
      if (request.mode === "transition") return {...quiet(id), depiction: "unknown", narrativePhase: "unknown", action: "unknown",
        ...(id === 1 ? {status: "verified", transition: "interruption", evidenceIds: [1]} : id === 2 ? laterTyped : {}),
        sceneBoundary: id === 2 ? laterBoundary : noBoundary};
      if (id === 2) return request.mode === "discovery" ? laterDiscovery : later;
      const primary = id === 0 ? first : id === 1 ? release : quiet(id);
      return request.mode === "discovery" && primary.status === "verified" ? {...primary, status: "candidate"} : primary;
    });
    return {status: "ok", usage, facts};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "release-inheritance", text, grant, now: () => 1, provider, blockedIds,
    verificationTargets: units.map(({id}) => id), transitionTargets: [1, 2], verifyTransitions: true,
    localActionVerificationTargets: [1, 2], sceneEntryVerificationTargets: [1, 2], negativeStride: 0});
}

test("a neutral successor retains verified release provenance and its finite fade", async () => {
  const observed = [], controlRequests = [];
  const candidate = await run({observed});
  const control = await run({laterLocal: localRelease(2, 1), observed: controlRequests});
  const earlier = candidate.units[1], row = candidate.units[2], newRelease = control.units[2];
  assert.equal(earlier.trace.decision, "Ease");
  assert.equal(earlier.trace.knownAt, 1);
  assert.equal(row.trace.decision, "Inherit release fade");
  assert.equal(row.playbackDisposition, "inherited-release");
  assert.equal(row.pattern, "Taper");
  assert.equal(row.phase, "quiet");
  assert.equal(row.knownAt, 1);
  assert.deepEqual(row.evidenceIds, [0, 1]);
  assert.equal(row.labelKnownAt, 2);
  assert.deepEqual(row.labelEvidenceIds, [1, 2]);
  assert.equal(row.primaryPrefix.narrativePhase, "ease");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(newRelease.phase, "ease");
  assert.equal(newRelease.knownAt, 2);
  assert.equal(newRelease.playbackDisposition, "prefix-disagreement");
  for (const field of ["beat", "scene", "holdWords", "fadeWords", "floorWords"]) {
    assert.equal(row.trace[field], newRelease.trace[field]);
  }
  assert.equal(row.trace.holdWords, 0);
  assert.equal(row.trace.fadeWords, 7);
  assert.deepEqual(candidate.units.slice(0, 2), control.units.slice(0, 2));
  assert.deepEqual(candidate.units[3], control.units[3]);
  assert.deepEqual(observed, controlRequests);
});

test("a current quiet negative preserves the earlier release without using a mismatched scope", async () => {
  const currentNegative = {...localNeutral, frame: "current", contrast: "neutral"};
  const candidate = await run({later: {...repeatedEase, action: "release", transition: "ease", scopeId: 0},
    laterLocal: currentNegative, laterTyped: {frame: "current"}});
  assert.equal(candidate.units[2].playbackDisposition, "inherited-release");
  assert.equal(candidate.units[2].appliedTransition, "none");
  const wrongScope = await run({later: {...repeatedEase, scopeId: 2}});
  assert.notEqual(wrongScope.units[2].playbackDisposition, "inherited-release");
  const noncurrent = await run({laterDiscovery: {...quiet(2), frame: "reported"}});
  assert.notEqual(noncurrent.units[2].playbackDisposition, "inherited-release");
  const unknown = await run({laterLocal: null});
  assert.notEqual(unknown.units[2].playbackDisposition, "inherited-release");
});

test("expiry, a verified cut, and a protective stop prevent release inheritance", async () => {
  const expired = await run({releaseText: "They slowed their steps in time with the music while the musicians continued playing the last piece for the audience."});
  assert.equal(expired.units[2].pattern, "Baseline");
  assert.equal(expired.units[2].trace.fadeWords, 0);
  assert.notEqual(expired.units[2].playbackDisposition, "inherited-release");
  const cut = await run({laterTyped: {frame: "current"}, laterBoundary: {status: "cut", reason: "time-jump", previousId: 1, entryId: 2}});
  assert.equal(cut.units[2].pattern, "Reset");
  assert.notEqual(cut.units[2].playbackDisposition, "inherited-release");
  const stop = await run({blockedIds: [2]});
  assert.equal(stop.units[2].pattern, "Stop");
  assert.notEqual(stop.units[2].playbackDisposition, "inherited-release");
  assert.equal(stop.units[3].pattern, "Baseline");
});

const depictedOnly = {...localNeutral, frame: "current", contrast: "depiction-only"};

const phaseOnly = {...quiet(2), status: "verified", narrativePhase: "ease", scopeId: 0, evidenceIds: [1, 2]};
const phaseOnlyOptions = {first: quiet(0), later: phaseOnly, laterTyped: {frame: "current"}};

test("a neutral ease descriptor keeps the earlier release waveform and uses a quiet phase", async () => {
  const observed = [], controlRequests = [];
  const candidate = await run({...phaseOnlyOptions, observed});
  const control = await run({...phaseOnlyOptions, laterLocal: null, observed: controlRequests});
  const [first, earlier, row, after] = candidate.units;
  const before = control.units[2];
  assert.equal(earlier.trace.decision, "Ease");
  assert.equal(earlier.trace.knownAt, 1);
  assert.equal(earlier.trace.beat, "release-inheritance:beat:1");
  assert.equal(row.phase, "quiet");
  assert.equal(before.phase, "ease");
  assert.equal(row.pattern, "Taper");
  assert.equal(row.knownAt, 1);
  assert.equal(row.labelKnownAt, 2);
  assert.deepEqual(row.labelEvidenceIds, [1, 2]);
  assert.equal(row.primaryPrefix.narrativePhase, "ease");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(row.trace.holdWords, 0);
  assert.equal(row.trace.fadeWords, 7);
  assert.equal(row.trace.floorWords, 7);
  assert.deepEqual(row.trace, before.trace);
  assert.deepEqual([first, earlier, after], [control.units[0], control.units[1], control.units[3]]);
  assert.deepEqual(observed, controlRequests);
});

test("a phase-only descriptor requires the exact earlier release and independent quiet readings", async () => {
  for (const negative of [{first: opening}, {later: {...phaseOnly, scopeId: 1}},
    {later: {...phaseOnly, evidenceIds: [0, 2]}}, {laterDiscovery: {...quiet(2), frame: "reported"}},
    {laterLocal: localRelease(2, 1)}, {laterTyped: {frame: "neutral"}}]) {
    const {units} = await run({...phaseOnlyOptions, ...negative});
    assert.equal(units[2].phase, "ease");
  }
  const cut = await run({...phaseOnlyOptions, laterBoundary: {status: "cut", reason: "time-jump", previousId: 1, entryId: 2}});
  assert.equal(cut.units[2].pattern, "Reset");
  const stop = await run({...phaseOnlyOptions, blockedIds: [2]});
  assert.equal(stop.units[2].pattern, "Stop");
  const expired = await run({...phaseOnlyOptions,
    releaseText: "They slowed their steps in time with the music while the musicians continued playing the last piece for the audience."});
  assert.equal(expired.units[2].phase, "ease");
});

test("a natural fade keeps its waveform and records the newer verified release coordinate", async () => {
  const scopedQuiet = {...quiet(2), scopeId: 0};
  const options = {later: scopedQuiet, laterDiscovery: scopedQuiet, laterTyped: {frame: "current"}, separator: "\n\n"};
  const candidate = await run({...options, laterLocal: depictedOnly});
  const control = await run({...options, laterLocal: {...depictedOnly, contrast: "neutral"}});
  const row = candidate.units[2];
  assert.equal(row.phase, "quiet");
  assert.equal(row.pattern, "Taper");
  assert.equal(row.knownAt, 1);
  assert.deepEqual(row.evidenceIds, [0, 1]);
  assert.equal(row.playbackDisposition, "inherited-release");
  assert.equal(control.units[2].trace.knownAt, 0);
  assert.equal(control.units[2].trace.decision, "Fade beat");
  assert.equal(row.trace.floorWords, 0);
  for (const field of ["beat", "scene", "holdWords", "fadeWords", "floorWords", "wordOffset", "reason"]) {
    assert.equal(row.trace[field], control.units[2].trace[field]);
  }
  assert.deepEqual(candidate.units[3], control.units[3]);
  const mismatchedScope = await run({...options, laterDiscovery: {...scopedQuiet, scopeId: 1}, laterLocal: depictedOnly});
  assert.notEqual(mismatchedScope.units[2].playbackDisposition, "inherited-release");
});

test("a repeated romantic release needs a specific independent depiction-only negative to inherit", async () => {
  const romanticRepeat = {...repeatedEase, depiction: "romantic", action: "release", scopeId: 0};
  const options = {later: romanticRepeat, laterTyped: {frame: "current"}};
  const candidate = await run({...options, laterLocal: depictedOnly});
  const row = candidate.units[2];
  assert.equal(row.pattern, "Taper");
  assert.equal(row.phase, "quiet");
  assert.equal(row.knownAt, 1);
  assert.equal(row.trace.fadeWords, 7);
  assert.equal(row.trace.floorWords, 7);
  assert.equal(row.playbackDisposition, "inherited-release");
  assert.equal(row.primaryPrefix.action, "release");
  for (const control of [{laterLocal: localRelease(2, 1)}, {laterLocal: localNeutral},
    {laterLocal: {...depictedOnly, contrast: "neutral"}},
    {laterLocal: depictedOnly, later: {...romanticRepeat, scopeId: 1}},
    {laterLocal: depictedOnly, laterTyped: {frame: "neutral"}}]) {
    const result = await run({...options, ...control});
    assert.notEqual(result.units[2].playbackDisposition, "inherited-release");
  }
});

const earlierBuild = {...opening, unitId: 1, action: "anticipation", narrativePhase: "build", transition: "none",
  fact: "low", evidenceIds: [1]};
const precedingRelease = {...release, unitId: 2, evidenceIds: [2], priorAnchor: null};
const rootedEase = {...precedingRelease, unitId: 3, transition: "ease", scopeId: 1, evidenceIds: [1, 2, 3], priorAnchor: 1};
const isolatedQuiet = {...localNeutral, frame: "current", contrast: "neutral"};
const scopedQuietDiscovery = {...quiet(3), scopeId: 0, evidenceIds: [3]};

function runOldRoot({observed = [], target = rootedEase, targetLocal = isolatedQuiet, earlier = precedingRelease,
  earlierLocal = localRelease(2, 1), discovery = scopedQuietDiscovery, blockedIds = []} = {}) {
  const text = "The quartet played. Mira watched Lee. They slowed their steps in time with the music. The lights dimmed. A door creaked.";
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async request => {
    observed.push(request);
    const facts = request.targetIds.map(id => {
      if (request.mode === "scene-entry") return {unitId: id, sceneEntry: ordinaryInterruption};
      if (request.mode === "local-action") return {unitId: id, localAction: id === 2 ? earlierLocal : targetLocal};
      if (request.mode === "transition") return {...quiet(id), depiction: "unknown", narrativePhase: "unknown", action: "unknown",
        ...(id === 2 ? {status: "verified", transition: "interruption", evidenceIds: [2]} : {}), sceneBoundary: noBoundary};
      if (id === 3) return request.mode === "discovery" ? discovery : target;
      const primary = id === 1 ? earlierBuild : id === 2 ? earlier : quiet(id);
      return request.mode === "discovery" && primary.status === "verified" ? {...primary, status: "candidate"} : primary;
    });
    return {status: "ok", usage, facts};
  }, {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "rooted-release-inheritance", text, grant, now: () => 1, provider, blockedIds,
    verificationTargets: units.map(({id}) => id), transitionTargets: [2, 3], verifyTransitions: true,
    localActionVerificationTargets: [2, 3], sceneEntryVerificationTargets: [2, 3], negativeStride: 0});
}

test("an older beat root cannot re-date the independently checked release on the adjacent quiet unit", async () => {
  const observed = [], controlRequests = [];
  const candidate = await runOldRoot({observed});
  const control = await runOldRoot({targetLocal: localRelease(3, 2), observed: controlRequests});
  const row = candidate.units[3], newRelease = control.units[3];
  assert.equal(row.primaryPrefix.action, "release");
  assert.deepEqual(row.primaryPrefix.evidenceIds, [1, 2, 3]);
  assert.equal(row.playbackDisposition, "inherited-release");
  assert.equal(row.pattern, "Taper");
  assert.equal(row.phase, "quiet");
  assert.equal(row.knownAt, 2);
  assert.deepEqual(row.evidenceIds, [1, 2]);
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.cue, false);
  assert.equal(row.readerCue, false);
  assert.equal(newRelease.phase, "ease");
  assert.equal(newRelease.knownAt, 3);
  for (const field of ["beat", "scene", "holdWords", "fadeWords", "floorWords", "wordOffset"]) {
    assert.equal(row.trace[field], newRelease.trace[field]);
  }
  assert.deepEqual(candidate.units.slice(0, 3), control.units.slice(0, 3));
  assert.deepEqual(observed, controlRequests);
});

test("old-root release inheritance requires each exact link and a current quiet target", async () => {
  for (const options of [{targetLocal: localNeutral}, {targetLocal: null}, {earlierLocal: localRelease(2, 0)},
    {target: {...rootedEase, evidenceIds: [1, 3]}}, {discovery: {...scopedQuietDiscovery, scopeId: 1}},
    {earlier: {...precedingRelease, scopeId: 1}}]) {
    const {units: compared} = await runOldRoot(options);
    assert.notEqual(compared[3].playbackDisposition, "inherited-release");
  }
  const blocked = await runOldRoot({blockedIds: [3]});
  assert.equal(blocked.units[3].pattern, "Stop");
});
