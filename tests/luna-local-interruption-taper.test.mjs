import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const typed = (row, sceneBoundary = noBoundary) => ({...row, depiction: "unknown", narrativePhase: "unknown",
  action: "unknown", sceneBoundary});
const release = {status: "verified", frame: "current", action: "release", phase: "ease",
  contrast: "softening", targetId: 2, contextId: null};
const interruption = {status: "none", reason: "ordinary-interruption", previousId: null, changeId: null, entryId: null};

async function run({typedEvidence = [1, 2], local = release, sceneEntry = interruption, supporting = true, supportFact,
  sceneBoundary = noBoundary, blockedIds = [], newParagraph = false, action = "release"} = {}) {
  const text = "They waited by the door. She watched him with quiet anticipation." +
    (newParagraph ? "\n\n" : " ") + "She softened as someone knocked. They heard another knock.";
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
    spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const provider = Object.assign(async ({mode, targetIds}) => ({
    status: "ok", usage: {inputTokens: 100, outputTokens: 20}, facts: targetIds.map(id => {
      if (mode === "local-action") return {unitId: id, localAction: local};
      if (mode === "scene-entry") return {unitId: id, sceneEntry};
      if (mode === "transition") return id === 2 ?
        typed({...neutral(id), status: "verified", transition: "interruption", evidenceIds: typedEvidence}, sceneBoundary) : typed(neutral(id));
      const status = mode === "discovery" ? "candidate" : "verified";
      if (id === 1) return mode === "verify" && supportFact ? supportFact :
        {...neutral(id), status, depiction: "romantic", narrativePhase: "build", action: "anticipation", fact: "low", evidenceIds: [id]};
      if (id === 2) return {...neutral(id), status, depiction: "romantic", narrativePhase: "ease", action,
        transition: "interruption", fact: "beat-end", scopeId: 0, evidenceIds: mode === "discovery" ? [id] : [1, id]};
      return neutral(id);
    }),
  }), {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "interruption-taper", text, grant, now: () => 1, provider, blockedIds,
    verificationTargets: [2, 3], maxVerification: 2, verifyTransitions: true, transitionTargets: [2, 3],
    maxTransitionVerification: 2, localActionVerificationTargets: local ? [2] : [], sceneEntryVerificationTargets: [2],
    maxSupportingVerification: supporting ? 1 : 0, negativeStride: 0});
}

test("a verified interruption release can taper locally without closing or carrying an invented beat", async () => {
  const result = await run();
  assert.deepEqual(result.summary.supportingVerification, [{id: 1, status: "returned"}]);
  const [support, target, followup] = result.units.slice(1);
  assert.equal(support.pattern, "Baseline");
  assert.equal(target.pattern, "Taper");
  assert.equal(target.phase, "ease");
  assert.equal(target.appliedTransition, "interruption");
  assert.equal(target.primaryPrefix.fact, "beat-end");
  assert.equal(target.transitionVerification.fact, "none");
  assert.equal(target.verifiedRelease, true);
  assert.equal(target.localActionApplication, "local-interruption-taper");
  assert.equal(target.cue, false);
  assert.equal(target.readerCue, false);
  assert.equal(target.beatId, null);
  assert.deepEqual(target.trace.evidence, [1, 2]);
  assert.equal(target.trace.decision, "Local taper");
  assert.equal(followup.pattern, "Baseline");
  assert.equal(followup.beatId, null);
});

test("local interruption taper requires all three target readings and adjacent verified support", async () => {
  const blockedSupport = {...neutral(1), status: "verified", fact: "protective", transition: "hard-stop", evidenceIds: [1]};
  for (const options of [{typedEvidence: [2]}, {local: null}, {local: {...release, contextId: 1}},
    {sceneEntry: {...interruption, reason: "same-episode"}}, {supporting: false}, {supportFact: neutral(1)},
    {supportFact: blockedSupport}, {blockedIds: [1]}, {newParagraph: true}]) {
    const {units} = await run(options);
    assert.equal(units[2].pattern, "Baseline", JSON.stringify(options));
    assert.equal(units[2].localActionApplication, undefined);
    assert.equal(units[2].verifiedRelease, undefined);
    assert.equal(units[3].pattern, "Baseline");
  }
});

test("local interruption taper preserves verified scene cuts and protective gates", async () => {
  const {units} = await run({sceneBoundary: {status: "cut", reason: "time-jump", previousId: 1, entryId: 2}});
  assert.equal(units[2].pattern, "Reset");
  assert.equal(units[2].appliedTransition, "scene-cut");
  assert.equal(units[2].localActionApplication, undefined);
  const blocked = await run({blockedIds: [2]});
  assert.equal(blocked.units[2].pattern, "Stop");
  assert.equal(blocked.units[2].localActionApplication, undefined);
});
