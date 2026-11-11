import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const text = "June and Lee held hands. June squeezed Lee’s hand. They listened to the music.";
const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 2,
  spans: units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
const neutral = unitId => ({unitId, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
  action: "none", transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null});
const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const typed = row => ({...row, depiction: "unknown", narrativePhase: "unknown", action: "unknown", sceneBoundary: noBoundary});
const opening = {...neutral(0), status: "verified", depiction: "romantic", narrativePhase: "build",
  action: "contact", fact: "low", scopeId: 0, evidenceIds: [0]};
const continuation = {...neutral(1), status: "verified", depiction: "romantic", narrativePhase: "sustain",
  action: "continuation", fact: "continue", scopeId: 0, evidenceIds: [0, 1], priorAnchor: 0};
const accent = {...continuation, action: "contact", transition: "accent", fact: "none", priorAnchor: null};
const typedAccent = typed({...accent, scopeId: null});
const enacted = {status: "verified", frame: "current", action: "contact", phase: "sustain",
  contrast: "enacted", targetId: 1, contextId: 0};

function run({proposal = accent, primary = continuation, transition = typedAccent,
  local = enacted, prior = opening, blockedIds = []} = {}) {
  const provider = Object.assign(async ({mode, targetIds}) => ({status: "ok", usage: {inputTokens: 100, outputTokens: 20},
    facts: targetIds.map(id => {
      if (mode === "local-action") return {unitId: id, localAction: local};
      if (mode === "transition") return id === 1 ? transition : typed(neutral(id));
      const row = id === 0 ? prior : id === 1 ? mode === "discovery" ? proposal : primary : neutral(id);
      return mode === "discovery" && row.status === "verified" ? {...row, status: "candidate"} : row;
    })}), {sceneBoundaryProtocol: true});
  return runLunaProtocolShadow({id: "linked-accent", text, grant, now: () => 1, provider, blockedIds, negativeStride: 0,
    verificationTargets: [0, 1, 2], verifyTransitions: true, transitionTargets: [0, 1, 2],
    localActionVerificationTargets: local ? [1] : []});
}

test("independently verified local contact on a linked accent adds only its cue designation", async () => {
  const {units: control} = await run({local: null});
  const {units: observed} = await run();
  const cue = observed[1];
  assert.equal(control[1].cue, false);
  assert.equal(control[1].readerCue, true);
  assert.equal(cue.cue, true);
  assert.equal(cue.localActionApplication, "linked-accent-cue");
  for (const key of ["phase", "appliedTransition", "readerCue", "pattern", "beatId", "knownAt", "trace"]) {
    assert.deepEqual(cue[key], control[1][key]);
  }
  assert.deepEqual(observed[0], control[0]);
  assert.deepEqual(observed[2], control[2]);
});

test("uncorroborated, uncited, inactive and protected accents cannot acquire a local cue designation", async () => {
  for (const options of [
    {local: null},
    {local: {...enacted, phase: "onset"}},
    {local: {...enacted, contextId: null}},
    {local: {...enacted, action: "change"}},
    {proposal: {...accent, scopeId: 1}},
    {proposal: {...accent, evidenceIds: [1]}},
    {transition: typed({...accent, scopeId: null, evidenceIds: [1]})},
    {transition: typed(neutral(1))},
    {transition: {...typedAccent, sceneBoundary: {status: "cut", reason: "time-jump", previousId: 0, entryId: 1}}},
    {prior: neutral(0)},
    {blockedIds: [1]},
  ]) {
    const {units: observed} = await run(options);
    assert.notEqual(observed[1].localActionApplication, "linked-accent-cue");
    assert.notEqual(observed[1].cue, true);
  }
});
