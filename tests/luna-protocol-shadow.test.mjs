import assert from "node:assert/strict";
import test from "node:test";
import {createLunaShadowBudget, runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const story = "They exchanged a warm smile. A friend asked about the bus. They leaned closer. The topic changed. The bus arrived.";
const neutral = unitId => ({unitId, status: "neutral", depiction: "neutral", frame: "current", narrativePhase: "quiet",
  transition: "none", action: "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds: []});
const active = (unitId, mode, fields = {}) => ({...neutral(unitId), status: mode === "verify" ? "verified" : "candidate",
  depiction: "romantic", action: "anticipation", fact: "low", scopeId: 0, evidenceIds: [unitId], ...fields});
const fixture = (text = story, ids) => {
  const {units, editionDigest, segmentationVersion} = buildWholeStoryIndex(text);
  return {id: "fixture", text, negativeStride: 0, now: () => 100,
    grant: {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: 101,
      spans: units.filter(unit => ids?.includes(unit.id) ?? !unit.structuralBoundary)
        .map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))}};
};
const fake = (generate, observe = () => {}) => async request => {
  observe(request);
  return {status: "ok", facts: request.targetIds.map(id => generate(id, request.mode)),
    usage: {inputTokens: 100, outputTokens: 20}};
};

test("prefix verifies before activation, keeps a supported beat and protects a confirmed stop", async () => {
  const input = fixture();
  const calls = [];
  const provider = fake((id, mode) => {
    if (id === 0) return active(id, mode);
    if (id === 1) return active(id, mode, {action: "continuation", fact: "continue", priorAnchor: 0, evidenceIds: [0, 1]});
    if (id === 2) return active(id, mode, {action: "none", fact: "protective", transition: "hard-stop"});
    if (id === 3) return active(id, mode);
    return neutral(id);
  }, request => calls.push(request));
  const run = await runLunaProtocolShadow({...input, provider});
  assert.deepEqual(run.units.map(({pattern}) => pattern), ["Undertone", "Undertone", "Stop", "Stop", "Baseline"]);
  assert.equal(run.units[0].beatId, run.units[1].beatId);
  assert.equal(run.units[2].beatId, null);
  assert.equal(run.units[3].beatId, null);
  assert.equal(run.units[1].knownAt, 1);
  assert.equal(calls.length, 5);
  for (const call of calls.slice(1)) {
    assert.equal(call.mode, "verify");
    assert.equal(call.units.at(-1).id, call.targetIds[0]);
    assert.equal(Object.hasOwn(call, "candidates"), false);
  }
});

test("suffix-assisted discovery is disallowed in playback unless the prefix independently supports it", async () => {
  const provider = fake((id, mode) => id === 0 && mode === "discovery" ?
    active(id, mode, {evidenceIds: [2]}) : neutral(id));
  const run = await runLunaProtocolShadow({...fixture(), provider, arm: "complete"});
  assert.equal(run.summary.discoveryWindows, 1);
  assert.equal(run.units[0].playbackDisposition, "prefix-disagreement");
  assert.equal(run.units[0].pattern, "Baseline");
  assert.equal(run.units[0].status, "neutral");
});

test("expired or absent exact grants cause zero provider calls", async () => {
  let calls = 0;
  const provider = async () => { calls++; };
  const input = fixture();
  await assert.rejects(runLunaProtocolShadow({...input, provider, now: () => 101}), /current grant/u);
  const missing = await runLunaProtocolShadow({...input, grant: undefined, provider});
  assert.equal(calls, 0);
  assert.equal(missing.units.every(row => row.status === "withheld" && row.pattern === "Baseline"), true);
  assert.equal(missing.summary.budget.attempts, 0);
});

test("a refusal invalidates dependent work but a separate approved run still returns", async () => {
  const calls = [];
  const provider = async request => {
    calls.push(request.units.map(({id}) => id));
    if (request.units[0].id === 0) return {status: "refused"};
    return {status: "ok", facts: request.targetIds.map(neutral), usage: {inputTokens: 10, outputTokens: 10}};
  };
  const run = await runLunaProtocolShadow({...fixture(story, [0, 1, 3, 4]), provider, limits: {maxTargetsPerWindow: 1}});
  assert.deepEqual(run.units.map(({status}) => status), ["provider-refused", "refusal-dependent", "withheld", "neutral", "neutral"]);
  assert.deepEqual(calls, [[0], [3], [3, 4]]);
  assert.equal(run.units.every(row => row.pattern === "Baseline" && row.beatId === null), true);
  assert.equal(run.summary.budget.unsettled, 1);
  assert.equal(run.summary.budget.attempts, 3);
});

test("a continuation cannot enter from a prior anchor rejected by prefix verification", async () => {
  const provider = fake((id, mode) => {
    if (id === 0 && mode === "discovery") return active(id, mode);
    if (id === 1) return active(id, mode, {action: "continuation", fact: "continue", priorAnchor: 0, evidenceIds: [0, 1]});
    return neutral(id);
  });
  const run = await runLunaProtocolShadow({...fixture(), provider});
  assert.equal(run.units[1].playbackDisposition, "unattested-scope");
  assert.equal(run.units[1].pattern, "Baseline");
  assert.equal(run.units[1].beatId, null);
});

test("a missing verification budget defers a positive without converting it to a quiet label", async () => {
  const provider = fake((id, mode) => id === 0 ? active(id, mode) : neutral(id));
  const run = await runLunaProtocolShadow({...fixture(), provider, maxVerification: 0,
    budget: createLunaShadowBudget({maxAttempts: 1})});
  assert.equal(run.units[0].status, "verification-deferred");
  assert.equal(run.units[0].depiction, undefined);
  assert.equal(run.units[0].pattern, "Baseline");
  assert.equal(run.summary.budget.attempts, 1);
});

test("discovery-only depiction cannot deepen a separately verified sustain", async () => {
  const run = depiction => runLunaProtocolShadow({...fixture(), provider: fake((id, mode) => {
    if (id < 2 && mode === "discovery") return {...neutral(id), depiction};
    if (id === 2) return active(id, mode, {fact: "none", action: "continuation",
      narrativePhase: "sustain", depiction: "explicit"});
    return neutral(id);
  })});
  for (const depiction of ["neutral", "graphic"]) {
    const result = await run(depiction);
    assert.equal(result.units[2].pattern, "Sustain wave");
    assert.equal(result.units[0].depiction, depiction);
  }
});

test("a refusal closes its entire approved run, including nonoverlapping windows", async () => {
  const requests = [];
  const run = await runLunaProtocolShadow({...fixture(story, [0, 1, 3, 4]),
    limits: {maxTargetsPerWindow: 1, maxOverlapUnits: 0},
    provider: async ({targetIds}) => {
      requests.push(...targetIds);
      return targetIds[0] === 0 ? {status: "refused"} : {status: "ok", facts: targetIds.map(neutral)};
    }});
  assert.deepEqual(requests, [0, 3, 4]);
  assert.equal(run.units[1].status, "refusal-dependent");
  assert.equal(run.units[4].status, "neutral");
});

test("ordinary stop needs fresh enacted restart evidence while its earlier evidence cannot reactivate playback", async () => {
  const provider = fake((id, mode) => {
    if (id === 0) return active(id, mode);
    if (id === 1) return active(id, mode, {fact: "none", action: "release", transition: "hard-stop", scopeId: null});
    if (id === 2) return active(id, mode, {fact: "none", narrativePhase: "build", evidenceIds: [1]});
    if (id === 3) return active(id, mode, {fact: "none", narrativePhase: "build"});
    return active(id, mode, {fact: "none", narrativePhase: "rebuild", action: "contact", transition: "restart"});
  });
  const run = await runLunaProtocolShadow({...fixture(), provider});
  assert.deepEqual(run.units.map(({pattern}) => pattern), ["Undertone", "Stop", "Baseline", "Baseline", "Rebuild rise"]);
  assert.deepEqual(run.units[1].evidenceIds, [1]);
  assert.deepEqual(run.units[2].labelEvidenceIds, [1]);
  assert.equal(run.units[2].beatId, null);
  assert.notEqual(run.units[4].beatId, run.units[0].beatId);
});

const distantFixture = ["They exchanged a warm smile.", ...Array(29).fill("The clock chimed in the hallway."),
  "Their familiar glance returned."].join(" ");

async function distantRun(verificationContext, {cut = false, rejectedAnchor = false, suffix = "", withheld = false} = {}) {
  const calls = [];
  const text = distantFixture + suffix;
  const ids = withheld ? buildWholeStoryIndex(text).units.map(({id}) => id).filter(id => id !== 15) : undefined;
  const provider = async request => {
    const {mode, targetIds, attested} = request;
    calls.push(request);
    return {status: "ok", facts: targetIds.map(id => {
      if (id === 0 && !(rejectedAnchor && mode === "verify")) return active(id, mode);
      if (cut && id === 15) return active(id, mode, {fact: "cut", transition: "scene-cut", action: "none", scopeId: 15});
      if (mode === "verify" && id === 30 && attested?.some(row => row.unitId === 0)) {
        return active(id, mode, {fact: "continue", action: "continuation", priorAnchor: 0, evidenceIds: [0, 30]});
      }
      return neutral(id);
    }), usage: {inputTokens: 100, outputTokens: 20}};
  };
  const result = await runLunaProtocolShadow({...fixture(text, ids), provider, verificationContext,
    verificationTargets: [30], prefixUnits: 6});
  return {result, target: calls.find(call => call.mode === "verify" && call.targetIds[0] === 30)};
}

test("native verification can rejoin a distant independently attested beat without resending its prose", async () => {
  const recent = await distantRun("recent");
  const anchored = await distantRun("attested");
  assert.deepEqual(anchored.target.units, recent.target.units);
  assert.equal(anchored.target.units[0].id, 25);
  assert.deepEqual(anchored.target.attested, [{unitId: 0, scopeId: 0, frame: "current",
    action: "anticipation", narrativePhase: "quiet"}]);
  assert.equal(recent.result.units[30].pattern, "Baseline");
  assert.equal(anchored.result.units[30].pattern, "Undertone");
  assert.equal(anchored.result.units[30].beatId, anchored.result.units[0].beatId);
  assert.deepEqual(anchored.result.units[30].labelEvidenceIds, [0, 30]);
  assert.equal(anchored.result.units[30].cue, false);
  assert.deepEqual(anchored.result.summary.nativeVerification, [{id: 30, status: "verified"}]);
});

test("the attestation feed is prefix-stable and excludes cut, withheld and rejected anchors", async () => {
  const first = await distantRun("attested");
  const later = await distantRun("attested", {suffix: " The story took a completely different turn."});
  assert.deepEqual(first.target, later.target);
  for (const options of [{cut: true}, {withheld: true}, {rejectedAnchor: true}]) {
    const check = await distantRun("attested", options);
    assert.equal(check.target.attested, undefined);
    assert.equal(check.result.units[30].pattern, "Baseline");
  }
});

test("a frozen native target can be verified independently after an incomplete discovery response", async () => {
  const provider = async ({mode, targetIds: [id]}) => mode === "discovery" ? {status: "incomplete"} :
    {status: "ok", facts: [active(id, mode, {fact: "none", action: "contact",
      narrativePhase: "onset", transition: "onset"})]};
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [2]});
  assert.equal(run.units[1].status, "incomplete");
  assert.equal(run.units[2].cue, true);
  assert.equal(run.units[2].prefixVerified, true);
  assert.equal(run.summary.budget.unsettled, 2);
  assert.equal(run.summary.nativeVerification[0].status, "verified");
});

test("shared spend cap rejects a second unknown reservation and freezes after a reservation breach", () => {
  assert.throws(() => createLunaShadowBudget({maxMicros: 3_000_001}), /budget/u);
  const budget = createLunaShadowBudget({maxMicros: 3_000});
  const settle = budget.reserve("{}", 1);
  assert.equal(typeof settle, "function");
  assert.equal(budget.reserve("{}", 1), null);
  settle({inputTokens: 8000, outputTokens: 2000});
  assert.equal(budget.snapshot().reservationBreach, true);
  assert.equal(budget.reserve("{}", 1), null);
});

const typedTransition = (unitId, fields = {}) => ({...neutral(unitId), depiction: "unknown", narrativePhase: "unknown",
  action: "unknown", status: "verified", transition: "hard-stop", fact: "neutralize", evidenceIds: [unitId], ...fields});

test("an independently verified hard stop applies even when cue discovery and verification missed it", async () => {
  const calls = [];
  const provider = fake((id, mode) => mode === "transition" ? typedTransition(id) : neutral(id),
    request => calls.push(request));
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [2],
    verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2]});
  assert.deepEqual(calls.map(({mode}) => mode), ["discovery", "verify", "transition"]);
  assert.deepEqual(calls[1].units, calls[2].units);
  assert.equal(Object.hasOwn(calls[2], "candidates"), false);
  assert.equal(run.units[2].transition, "none");
  assert.equal(run.units[2].transitionVerification.transition, "hard-stop");
  assert.deepEqual(run.units[2].transitionEvidenceIds, [2]);
  assert.equal(run.units[2].pattern, "Stop");
  assert.equal(run.units[2].cue, false);
});

test("an independent neutral verdict cannot clear a protective cue verification", async () => {
  const provider = fake((id, mode) => {
    if (mode === "transition") return typedTransition(id, {status: "neutral", fact: "none", transition: "none", evidenceIds: []});
    if (id === 2) return active(id, mode, {fact: "protective", action: "release", transition: "hard-stop"});
    return neutral(id);
  });
  const run = await runLunaProtocolShadow({...fixture(), provider, verifyTransitions: true,
    maxTransitionVerification: 1, transitionTargets: [2]});
  assert.equal(run.units[2].transitionFlag, "protective-transition-conflict");
  assert.equal(run.units[2].pattern, "Stop");
});

test("typed transitions require evidence at the exact target and report rejection without source text", async () => {
  const provider = fake((id, mode) => mode === "transition" ? typedTransition(id, {evidenceIds: [id - 1]}) : neutral(id));
  const run = await runLunaProtocolShadow({...fixture(), provider, verifyTransitions: true,
    maxTransitionVerification: 1, transitionTargets: [2]});
  assert.equal(run.units[2].transitionVerificationStatus, "invalid-response");
  assert.equal(run.units[2].pattern, "Baseline");
  const attempt = run.summary.attempts.find(row => row.mode === "transition");
  assert.equal(attempt.failureReason, "rejected-fact-contract");
  assert.deepEqual(attempt.rejectedFacts, [{id: 2, reason: "target-evidence"}]);
  assert.deepEqual(attempt.targetIds, [2]);
  assert.deepEqual(attempt.contextIds, [0, 1]);
  assert.equal(Object.hasOwn(attempt, "text"), false);
});

test("bounded native recovery selects an incomplete discovery window without replaying discovery", async () => {
  const modes = [];
  const provider = async ({mode, targetIds: [id]}) => {
    modes.push(mode);
    if (mode === "discovery") return {status: "incomplete", failureReason: "output-token-limit"};
    return {status: "ok", facts: [neutral(id)], usage: {inputTokens: 100, outputTokens: 20}};
  };
  const run = await runLunaProtocolShadow({...fixture(), provider, verifyTransitions: true, maxTransitionVerification: 0});
  assert.deepEqual(modes, ["discovery", "verify"]);
  assert.equal(run.units[0].discoveryStatus, "incomplete");
  assert.equal(run.units[0].verificationStatus, "neutral");
  assert.equal(run.units[1].verificationStatus, undefined);
  assert.equal(run.summary.attempts[0].failureReason, "output-token-limit");
});

test("refusal closes both model passes across the affected run", async () => {
  const modes = [];
  const provider = async ({mode}) => { modes.push(mode); return {status: "refused", failureReason: "provider-refusal"}; };
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [2],
    verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2]});
  assert.deepEqual(modes, ["discovery"]);
  assert.equal(run.units[2].status, "provider-refused");
  assert.equal(run.units[2].transitionVerificationStatus, "provider-refused");
});
