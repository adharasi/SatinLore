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

test("an exact enacted restart may cite the earlier stop and survive a neutral transition check", async () => {
  const text = "They held hands. She asked for a break and he let go. She took his hand again. " +
    "They kept holding hands. The clock ticked.";
  const typedCases = [null, {status: "neutral", transition: "none", fact: "none", evidenceIds: []},
    {status: "verified", transition: "restart", fact: "none", evidenceIds: [1, 2]}];
  for (const typed of typedCases) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, typed);
      if (id === 0) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"});
      if (id === 1) return active(id, mode, {fact: "neutralize", action: "release", narrativePhase: "quiet", transition: "hard-stop"});
      if (id === 2) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "rebuild",
        transition: "restart", scopeId: null, evidenceIds: typed?.status === "verified" ? [2] : [1, 2]});
      if (id === 3) return active(id, mode, {fact: "none", action: "continuation", narrativePhase: "sustain", scopeId: null});
      return neutral(id);
    }, request => calls.push(request));
    const run = await runLunaProtocolShadow({...fixture(text), provider, prefixUnits: 2, verificationTargets: [0, 1, 2, 3, 4],
      ...(typed ? {verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2]} : {})});
    assert.deepEqual(run.units.slice(1, 4).map(({pattern}) => pattern), ["Stop", "Rebuild rise", "Sustain wave"]);
    assert.equal(run.units[2].cue, true);
    assert.equal(run.units[2].readerCue, true);
    assert.equal(run.units[2].appliedTransition, "restart");
    assert.deepEqual(calls.find(call => call.mode === "verify" && call.targetIds[0] === 4).attested,
      [{unitId: 2, scopeId: 2, frame: "current", action: "contact", narrativePhase: "rebuild"}]);
  }
});

test("a neutral transition check does not erase a verified continuity veto or mute an ordinary connector", async () => {
  for (const uncertainty of [false, true]) {
    const target = uncertainty ? "Whether they were still holding hands was unclear." : "A clock ticked nearby.";
    const text = `They held hands. ${target} The room was still.`;
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: []});
      if (id === 0) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"});
      if (id === 1 && uncertainty) return active(id, mode, {fact: "neutralize", action: "none", narrativePhase: "quiet",
        transition: "uncertain-continuity"});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...fixture(text), provider, verificationTargets: [0, 1, 2],
      verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [1]});
    assert.equal(run.units[1].transitionVerification.status, "neutral");
    assert.equal(run.units[1].appliedTransition, uncertainty ? "uncertain-continuity" : "none");
    assert.deepEqual(run.units.slice(1).map(({pattern}) => pattern),
      uncertainty ? ["Baseline", "Baseline"] : ["Onset rise", "Onset rise"]);
  }
});

test("an opaque time interval clears carry and attestation only without renewed target evidence", async () => {
  const cases = [
    {target: "They stayed by the shelves for a while.", pattern: "Baseline", carryGap: true},
    {target: "She asked him about the clock.", pattern: "Onset rise"},
    {target: "“The clock has been broken for a while,” she said.", pattern: "Onset rise"},
    {target: "They stayed by the shelves for a while, still holding hands.", pattern: "Sustain wave", reattested: true},
  ];
  for (const {target, pattern, carryGap, reattested} of cases) {
    const text = `They held hands. ${target} The room was still. The clock ticked.`;
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: []});
      if (id === 0) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"});
      if (id === 1 && reattested) return active(id, mode, {fact: "none", action: "continuation", narrativePhase: "sustain"});
      return neutral(id);
    }, request => calls.push(request));
    const run = await runLunaProtocolShadow({...fixture(text), provider, prefixUnits: 2, verificationTargets: [0, 1, 2, 3],
      verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [1]});
    const row = run.units[1];
    assert.equal(row.transitionVerification.status, "neutral");
    assert.equal(row.pattern, pattern, target);
    assert.equal(row.continuityGuard, carryGap ? "elapsed-time-gap" : undefined);
    assert.equal(row.appliedTransition, carryGap ? "uncertain-continuity" : "none");
    if (carryGap) {
      assert.equal(row.trace.decision, "Neutral context");
      assert.deepEqual(row.trace.evidence, [1]);
      assert.equal(run.units[2].pattern, "Baseline");
    }
    const afterGap = calls.find(call => call.mode === "verify" && call.targetIds[0] === 3);
    assert.deepEqual(afterGap.attested?.map(({unitId}) => unitId), carryGap ? undefined : reattested ? [0, 1] : [0]);
  }
});

test("a confirmed stop or decline needs fresh enacted action even if a stale cue names a new scope", async () => {
  for (const boundary of ["hard-stop", "declined-restart"]) {
    for (const scopeId of [0, 2]) {
      const target = boundary === "hard-stop" ? "She asked for a break and he let go." : "She declined to hold his hand again.";
      const text = `They held hands. ${target} They stayed where they were. She took his hand again.`;
      const provider = fake((id, mode) => {
        if (id === 0) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"});
        if (id === 1) return active(id, mode, {fact: "neutralize", action: "release", narrativePhase: "quiet", transition: boundary});
        if (id === 2) return active(id, mode, {fact: "none", action: "continuation", narrativePhase: "sustain", scopeId});
        return active(id, mode, {fact: "none", action: "contact", narrativePhase: "rebuild", transition: "restart"});
      });
      const run = await runLunaProtocolShadow({...fixture(text), provider, verificationTargets: [0, 1, 2, 3]});
      assert.equal(run.units[1].pattern, boundary === "hard-stop" ? "Stop" : "Baseline");
      assert.equal(run.units[2].cue, false, `${boundary} with scope ${scopeId}`);
      assert.equal(run.units[2].beatId, null);
      assert.equal(run.units[3].pattern, "Rebuild rise");
      assert.equal(run.units[3].cue, true);
    }
  }
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

test("partial discovery retains valid rows and recovers only the rejected native target", async () => {
  const calls = [];
  const provider = async request => {
    calls.push({mode: request.mode, targets: request.targetIds});
    const usage = {inputTokens: 100, outputTokens: 20};
    return request.mode === "discovery" ? {
      status: "partial", facts: request.targetIds.filter(id => id !== 2).map(neutral),
      targetFailures: [{unitId: 2, reason: "row-enum"}], usage,
    } : {status: "ok", facts: [neutral(2)], usage};
  };
  const run = await runLunaProtocolShadow({...fixture(), provider, maxVerification: 1});
  assert.deepEqual(calls, [{mode: "discovery", targets: [0, 1, 2, 3, 4]}, {mode: "verify", targets: [2]}]);
  assert.equal(run.units[0].discovery.status, "neutral");
  assert.equal(run.units[2].discovery, undefined);
  assert.equal(run.units[2].discoveryStatus, "invalid-response");
  assert.equal(run.units[2].verificationStatus, "neutral");
  assert.deepEqual(run.summary.attempts[0].rejectedFacts, [{id: 2, reason: "row-enum"}]);
});

test("a single invalid discovery fact does not discard valid neighboring facts", async () => {
  const provider = fake((id, mode) => id === 2 && mode === "discovery" ?
    active(id, mode, {scopeId: 5}) : neutral(id));
  const run = await runLunaProtocolShadow({...fixture(), provider, maxVerification: 0});
  assert.equal(run.units.filter(row => row.discovery?.status === "neutral").length, 4);
  assert.equal(run.units[2].discoveryStatus, "invalid-response");
  assert.equal(run.summary.attempts[0].status, "partial");
  assert.deepEqual(run.summary.attempts[0].rejectedFacts, [{id: 2, reason: "scope-id"}]);
});

test("a transition citation cannot supply a missing exact target citation for a cue", async () => {
  const provider = fake((id, mode) => {
    if (mode === "transition") return typedTransition(id, {fact: "none", transition: "onset"});
    if (mode === "verify") return active(id, mode, {fact: "none", action: "contact",
      narrativePhase: "onset", evidenceIds: [1]});
    return neutral(id);
  });
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [2],
    verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2]});
  const row = run.units[2];
  assert.equal(row.transitionVerification.transition, "onset");
  assert.deepEqual(row.transitionEvidenceIds, [2]);
  assert.deepEqual(row.labelEvidenceIds, [1]);
  assert.equal(row.cue, false);
  assert.equal(row.cueGuard, "cue-target-uncited");
  assert.equal(row.pattern, "Baseline");
});

test("a blinded cue check can recover a causal disagreement and preserves the primary verdict", async () => {
  const calls = [];
  const provider = fake((id, mode) => id === 2 && ["discovery", "cue-check"].includes(mode) ?
    active(id, mode === "cue-check" ? "verify" : mode, {fact: "none", action: "contact", narrativePhase: "onset"}) :
    neutral(id), request => calls.push(request));
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [2], maxCueChecks: 1});
  assert.deepEqual(calls.map(x => x.mode), ["discovery", "verify", "cue-check"]);
  assert.deepEqual(calls[1].units, calls[2].units);
  assert.deepEqual(Object.keys(calls[2]).sort(), ["mode", "targetIds", "units"]);
  assert.equal(run.units[2].primaryPrefix.status, "neutral");
  assert.equal(run.units[2].cueRecovery.status, "verified");
  assert.equal(run.units[2].cueRecovered, true);
  assert.equal(run.units[2].cue, true);
  assert.equal(run.units[2].readerCue, true);
});

test("one blinded check can replace an invalid semantic tuple without making it a primary success", async () => {
  for (const viaAdapter of [false, true]) {
    const calls = [];
    const provider = async request => {
      calls.push(request);
      const usage = {inputTokens: 100, outputTokens: 20};
      const [id] = request.targetIds;
      if (request.mode === "verify" && id === 2) {
        return viaAdapter ? {status: "invalid-response", targetFailures: [{unitId: id, reason: "phase-action"}], usage} :
          {status: "ok", facts: [active(id, "verify", {narrativePhase: "sustain", fact: "none", action: "anticipation"})], usage};
      }
      if (request.mode === "verify" && id === 3) {
        return {status: "invalid-response", targetFailures: [{unitId: id, reason: "scope-id"}], usage};
      }
      return {status: "ok", facts: request.targetIds.map(neutral), usage};
    };
    const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [2, 3], maxCueChecks: 2});
    assert.deepEqual(calls.map(call => call.mode), ["discovery", "verify", "cue-check", "verify"]);
    assert.deepEqual(calls[1].units, calls[2].units);
    assert.deepEqual(Object.keys(calls[2]).sort(), ["mode", "targetIds", "units"]);
    assert.equal(run.units[2].verificationStatus, "invalid-response");
    assert.equal(run.units[2].primaryFailure, "phase-action");
    assert.equal(run.units[2].cueContractRepaired, true);
    assert.equal(run.units[2].cueRecovered, false);
    assert.equal(run.units[2].status, "neutral");
    assert.equal(run.units[2].readerCue, false);
    assert.equal(run.units[3].verificationStatus, "invalid-response");
    assert.equal(run.units[3].cueRecoveryStatus, "not-needed");
  }
});

test("a cue recheck cannot override a separately verified stop or depend on future discovery evidence", async () => {
  const calls = [];
  const provider = fake((id, mode) => {
    if (mode === "transition") return typedTransition(id);
    if (mode === "discovery" && [1, 2].includes(id)) return active(id, mode,
      {fact: "none", action: "contact", narrativePhase: "onset", evidenceIds: id === 1 ? [1, 4] : [2]});
    return neutral(id);
  }, request => calls.push(request));
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [1, 2], verifyTransitions: true,
    maxTransitionVerification: 1, transitionTargets: [2], maxCueChecks: 2});
  assert.equal(calls.some(x => x.mode === "cue-check"), false);
  assert.equal(run.units[2].pattern, "Stop");
  assert.equal(run.units[2].cueRecoveryStatus, "not-needed");
});
