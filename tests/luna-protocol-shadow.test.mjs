import assert from "node:assert/strict";
import test from "node:test";
import {createLunaShadowBudget, runLunaProtocolShadow} from "../scripts/lib/luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const story = "They exchanged a warm smile. A friend asked about the bus. They leaned closer. The topic changed. The bus arrived.";
const neutral = unitId => ({unitId, status: "neutral", depiction: "neutral", frame: "current", narrativePhase: "quiet",
  transition: "none", action: "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds: []});
const active = (unitId, mode, fields = {}) => ({...neutral(unitId), status: mode === "discovery" ? "candidate" : "verified",
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

test("a sampled continuation independently verifies its cleared unsampled prior anchor", async () => {
  const run = async (maxSupportingVerification, budgetOptions) => {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: []});
      if (id === 1) return active(id, mode, {scopeId: 1});
      if (id === 2) return active(id, mode, {scopeId: 1, fact: "continue", action: "continuation",
        narrativePhase: "sustain", priorAnchor: 1, evidenceIds: [1, 2]});
      return neutral(id);
    }, request => calls.push(request));
    const result = await runLunaProtocolShadow({...fixture(), provider, maxVerification: 1, verificationTargets: [2],
      verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2], maxSupportingVerification,
      budget: createLunaShadowBudget(budgetOptions)});
    return {result, calls};
  };
  const without = await run(0, {maxAttempts: 4});
  assert.equal(without.result.units[2].playbackDisposition, "unattested-scope");
  assert.equal(without.result.units[2].pattern, "Baseline");
  const {result, calls} = await run(1, {maxAttempts: 4});
  assert.deepEqual(calls.slice(1).map(({mode, targetIds}) => [mode, targetIds[0]]), [["verify", 1], ["verify", 2], ["transition", 2]]);
  assert.deepEqual(calls[1].units.map(({id}) => id), [0, 1]);
  assert.deepEqual(result.summary.supportingVerification, [{id: 1, status: "returned"}]);
  assert.equal(result.summary.attempts.find(row => row.supportingPrefix).mode, "verify");
  assert.deepEqual(result.summary.nativeVerification, [{id: 2, status: "verified"}]);
  assert.equal(result.units[1].pattern, "Baseline");
  assert.equal(result.units[2].pattern, "Undertone");
  assert.equal(result.units[2].beatId, "fixture:beat:2");
  assert.deepEqual(result.units[2].trace.evidence, [1, 2]);
  assert.equal(result.units[2].cue, false);

  for (const budgetOptions of [{maxAttempts: 3}, {maxSourceBytes: without.result.summary.budget.attemptedPayloadBytes}]) {
    const tight = await run(1, budgetOptions);
    assert.deepEqual(tight.calls.slice(1).map(({mode, targetIds}) => [mode, targetIds[0]]), [["verify", 2], ["transition", 2]]);
    assert.deepEqual(tight.result.summary.supportingVerification, [{id: 1, status: "budget-deferred"}]);
    assert.deepEqual(tight.result.summary.nativeVerification, [{id: 2, status: "verified"}]);
    assert.equal(tight.result.units[2].transitionVerification.status, "neutral");
  }
});

test("supporting checks never carry into neutral targets before an exact same-scope confirmation", async () => {
  const input = fixture("They exchanged a warm smile. She smiled back. The clock ticked. The door closed. Their familiar glance returned. The music played on.");
  const provider = fake((id, mode) => {
    if (id === 0) return active(id, mode, {narrativePhase: "build", scopeId: mode === "discovery" ? null : 0});
    if (id === 1 || id === 4) {
      const priorAnchor = id === 1 ? 0 : 1;
      return active(id, mode, {fact: "continue", action: "continuation", narrativePhase: "sustain", priorAnchor,
        evidenceIds: [priorAnchor, id]});
    }
    return neutral(id);
  });
  const result = await runLunaProtocolShadow({...input, provider, maxVerification: 4,
    verificationTargets: [2, 3, 4, 5], maxSupportingVerification: 2});
  assert.deepEqual(result.summary.supportingVerification, [{id: 0, status: "returned"}, {id: 1, status: "returned"}]);
  assert.deepEqual(result.units.map(({pattern}) => pattern), ["Baseline", "Baseline", "Baseline", "Baseline", "Undertone", "Undertone"]);
  assert.deepEqual(result.units.slice(0, 4).map(({beatId}) => beatId), [null, null, null, null]);
  assert.deepEqual(result.units[1].labelEvidenceIds, [0, 1]);
  assert.deepEqual(result.units[4].trace.evidence, [1, 4]);
  assert.equal(result.units[4].phase, "sustain");
  assert.equal(result.units[4].readerCue, true);
  assert.equal(result.units[4].cue, false);
  assert.equal(result.units[4].beatId, "fixture:beat:4");
  assert.equal(result.units[5].beatId, result.units[4].beatId);

  const ordinary = await runLunaProtocolShadow({...input, provider, maxVerification: 5,
    verificationTargets: [0, 2, 3, 4, 5], maxSupportingVerification: 2});
  assert.deepEqual(ordinary.summary.supportingVerification, [{id: 1, status: "returned"}]);
  assert.equal(ordinary.units[2].pattern, "Undertone");
  assert.equal(ordinary.units[3].pattern, "Undertone");
  assert.equal(ordinary.units[2].beatId, ordinary.units[0].beatId);
  assert.equal(ordinary.units[3].beatId, ordinary.units[0].beatId);
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
  const run = await runLunaProtocolShadow({...fixture(), provider, maxCueChecks: 1});
  assert.deepEqual(run.units.map(({pattern}) => pattern), ["Undertone", "Stop", "Baseline", "Baseline", "Rebuild rise"]);
  assert.deepEqual(run.units[1].evidenceIds, [1]);
  assert.deepEqual(run.units[2].labelEvidenceIds, []);
  assert.equal(run.units[2].primaryFailure, "target-evidence");
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
  const quote = createLunaShadowBudget();
  quote.reserve("{}", 1);
  const budget = createLunaShadowBudget({maxMicros: quote.snapshot().reservedMicros});
  const settle = budget.reserve("{}", 1);
  assert.equal(typeof settle, "function");
  assert.equal(budget.reserve("{}", 1), null);
  assert.equal(budget.snapshot().spendLimited, true);
  settle({inputTokens: 30_000, outputTokens: 2_000});
  assert.equal(budget.snapshot().reservationBreach, true);
  assert.equal(budget.reserve("{}", 1), null);
});

const typedTransition = (unitId, fields = {}) => ({...neutral(unitId), depiction: "unknown", narrativePhase: "unknown",
  action: "unknown", status: "verified", transition: "hard-stop", fact: "neutralize", evidenceIds: [unitId], ...fields});

test("only scope- and action-corroborated active support can establish regular carry", async () => {
  const input = fixture("The doors opened. They took hands at the dance. The clock ticked. The music played on.");
  const cases = [
    {prior: "onset", expected: ["Onset rise", "Onset rise", "Onset rise"]},
    {prior: "anticipation", expected: ["Undertone", "Undertone", "Undertone"]},
    {prior: "release", expected: ["Baseline", "Baseline", "Baseline"]},
    {prior: "onset", conflict: "scope", expected: ["Baseline", "Baseline", "Baseline"]},
    {prior: "onset", conflict: "action", expected: ["Baseline", "Baseline", "Baseline"]},
    {prior: "onset", conflict: "frame", expected: ["Baseline", "Baseline", "Baseline"]},
    {prior: "onset", conflict: "suffix", expected: ["Baseline", "Baseline", "Baseline"]},
    {prior: "onset", cutoff: "hard-stop", expected: ["Onset rise", "Stop", "Baseline"]},
    {prior: "onset", cutoff: "scene-cut", expected: ["Onset rise", "Reset", "Baseline"]},
    {prior: "onset", earlierStop: true, expected: ["Baseline", "Baseline", "Baseline"]},
  ];
  for (const {prior, conflict, cutoff, earlierStop, expected} of cases) {
    const provider = fake((id, mode) => {
      if (mode === "transition") {
        if (id === 2 && cutoff === "hard-stop") return typedTransition(id);
        if (id === 2 && cutoff === "scene-cut") return typedTransition(id, {fact: "cut", transition: cutoff, scopeId: id, evidenceIds: [1, 2]});
        return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: []});
      }
      if (id === 0 && earlierStop) return active(id, mode, {fact: "neutralize", action: "none", transition: "hard-stop"});
      if (id !== 1) return neutral(id);
      if (prior === "release") return active(id, mode, {fact: "ease", action: "release", narrativePhase: "ease", transition: "ease"});
      if (prior === "anticipation") return active(id, mode, {narrativePhase: "build"});
      if (conflict === "frame" && mode === "discovery") return active(id, mode, {fact: "cut", action: "none",
        frame: "remembered", transition: "memory-entry"});
      return active(id, mode, {fact: "none", action: conflict === "action" && mode === "discovery" ? "change" : "contact",
        narrativePhase: "onset", transition: "onset", scopeId: conflict === "scope" && mode === "discovery" ? 1 : 0,
        evidenceIds: conflict === "suffix" && mode === "discovery" ? [1, 2] : [1]});
    });
    const targets = earlierStop ? [0, 2, 3] : [2, 3];
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: targets, maxVerification: targets.length,
      verifyTransitions: true, maxTransitionVerification: 2, transitionTargets: [2, 3], maxSupportingVerification: 1});
    assert.deepEqual(run.summary.supportingVerification, [{id: 1, status: "returned"}]);
    assert.deepEqual(run.units.slice(1).map(({pattern}) => pattern), expected, JSON.stringify({prior, conflict, cutoff, earlierStop}));
    assert.deepEqual(run.units.slice(1).map(({cue}) => cue), [false, false, false]);
    assert.deepEqual(run.units.slice(2).map(({primaryPrefix}) => primaryPrefix.status), ["neutral", "neutral"]);
    if (cutoff) assert.equal(run.units[2].appliedTransition, cutoff);
  }
});

test("self-only auxiliary buildup stays provisional until a scored target verifies its exact link", async () => {
  const input = fixture("The doors opened. They looked forward to dancing. The musicians started putting away their instruments while the people who sat near the doorway gathered their coats. The room gradually emptied. The clock chimed.");
  const cases = [
    {expected: ["Undertone", "Taper", "Taper"], hold: 16},
    {link: "exact", expected: ["Undertone", "Undertone", "Undertone"], hold: 16},
    {link: "prior-only", expected: ["Undertone", "Taper", "Taper"], hold: 16},
    {link: "wrong-scope", expected: ["Undertone", "Taper", "Taper"], hold: 16},
    {prior: "scoped-build", expected: ["Undertone", "Undertone", "Undertone"], hold: 32},
    {prior: "enacted", expected: ["Onset rise", "Undertone", "Undertone"], hold: 32},
  ];
  for (const {prior, link, expected, hold} of cases) {
    const provider = fake((id, mode) => {
      if (id === 1 && prior === "enacted") return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset", scopeId: 1});
      if (id === 1) return active(id, mode, {narrativePhase: "build", scopeId: 1, evidenceIds: prior === "scoped-build" ? [0, 1] : [1]});
      if (id === 3 && link) return active(id, mode, {fact: "continue", action: "continuation", priorAnchor: 1,
        narrativePhase: link === "prior-only" ? "quiet" : "sustain", scopeId: link === "wrong-scope" ? 0 : 1,
        evidenceIds: link === "prior-only" ? [1] : [1, 3]});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [2, 3, 4], maxVerification: 3,
      maxSupportingVerification: 1});
    assert.deepEqual(run.summary.supportingVerification, [{id: 1, status: "returned"}]);
    assert.equal(run.units[2].trace.holdWords, hold);
    assert.deepEqual(run.units.slice(2).map(row => row.pattern), expected, JSON.stringify({prior, link}));
    if (link === "exact") {
      assert.equal(run.units[3].trace.holdWords, 32);
      assert.deepEqual(run.units[3].trace.evidence, [1, 3]);
      assert.equal(run.units[4].trace.knownAt, 3);
    }
  }
});
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
  const neutralTyped = {status: "neutral", transition: "none", fact: "none", evidenceIds: []};
  const confirmedTyped = {status: "verified", transition: "restart", fact: "none", evidenceIds: [1, 2]};
  for (const [typed, phase, effect] of [[null, "rebuild", "none"], [neutralTyped, "rebuild", "none"],
    [confirmedTyped, "rebuild", "none"], [confirmedTyped, "onset", "low"]]) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, typed);
      if (id === 0) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"});
      if (id === 1) return active(id, mode, {fact: "neutralize", action: "release", narrativePhase: "quiet", transition: "hard-stop"});
      if (id === 2) return active(id, mode, {fact: effect, action: "contact", narrativePhase: phase,
        transition: "restart", scopeId: null, evidenceIds: typed?.status === "verified" ? [2] : [1, 2]});
      if (id === 3) return active(id, mode, {fact: "none", action: "continuation", narrativePhase: "sustain", scopeId: null});
      return neutral(id);
    }, request => calls.push(request));
    const run = await runLunaProtocolShadow({...fixture(text), provider, prefixUnits: 2, verificationTargets: [0, 1, 2, 3, 4], maxCueChecks: 1,
      ...(typed ? {verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2]} : {})});
    assert.deepEqual(run.units.slice(1, 4).map(({pattern}) => pattern), ["Stop", "Rebuild rise", "Sustain wave"]);
    assert.equal(run.units[2].cue, true);
    assert.equal(run.units[2].readerCue, true);
    assert.equal(run.units[2].appliedTransition, "restart");
    assert.deepEqual(calls.find(call => call.mode === "verify" && call.targetIds[0] === 4).attested,
      [{unitId: 2, scopeId: 2, frame: "current", action: "contact", narrativePhase: phase}]);
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

test("a corroborated release can cite the current return without carrying an old scope", async () => {
  const input = fixture("They recalled the previous evening. A warm smile brought them back to the present. The moment softened. The kettle clicked.");
  const options = {verificationTargets: [2, 3], maxVerification: 2, maxSupportingVerification: 2,
    verifyTransitions: true, transitionTargets: [2, 3], maxTransitionVerification: 2, localActionVerificationTargets: [2]};
  const provider = (contextId, citesReturn = true) => Object.assign(fake((id, mode) => {
    if (mode === "local-action") return {unitId: id, localAction: {status: "verified", frame: "current", action: "release",
      phase: "ease", contrast: "softening", targetId: id, contextId}};
    if (mode === "transition") return {...neutral(id), depiction: "unknown", narrativePhase: "unknown", action: "unknown",
      sceneBoundary: {status: "none", reason: "none", previousId: null, entryId: null},
      ...(id === 2 ? {status: "verified", transition: "interruption", evidenceIds: citesReturn ? [1, 2] : [2]} : {})};
    if (id === 0 && mode !== "discovery") return {...neutral(id), frame: "remembered", evidenceIds: [0]};
    if (id <= 1) return active(id, mode, {narrativePhase: "build", ...(mode === "discovery" ? {scopeId: null} : {})});
    if (id === 2 && mode !== "discovery") return active(id, mode, {action: "release", narrativePhase: "ease", transition: "interruption", fact: "ease"});
    return neutral(id);
  }), {sceneBoundaryProtocol: true});
  const {units} = await runLunaProtocolShadow({...input, ...options, provider: provider(1)});
  assert.equal(units[2].pattern, "Taper");
  assert.equal(units[2].verifiedRelease, true);
  assert.equal(units[2].beatId, null);
  assert.deepEqual(units[2].trace.evidence, [1, 2]);
  assert.equal(units[3].pattern, "Baseline");
  for (const missing of [provider(null), provider(0)]) {
    const rejected = await runLunaProtocolShadow({...input, ...options, provider: missing});
    assert.equal(rejected.units[2].pattern, "Baseline");
  }
  const ordinary = await runLunaProtocolShadow({...input, ...options, provider: provider(1, false)});
  assert.equal(ordinary.units[2].trace.decision, "Ease");
  assert.equal(ordinary.units[2].verifiedRelease, undefined);
});

test("an independently enacted onset after a frame return may cite that return as context", async () => {
  const text = "She finished reading the old note. She put it down. They took each other's hands.";
  const provider = fake((id, mode) => {
    if (mode === "transition") return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: []});
    if (id === 0) return {...neutral(id), frame: "reported"};
    if (id === 1) return active(id, mode, {fact: "cut", action: "none", narrativePhase: "quiet", transition: "present-return"});
    return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", evidenceIds: [1, 2]});
  });
  const run = await runLunaProtocolShadow({...fixture(text), provider, verificationTargets: [0, 1, 2],
    verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2]});
  assert.deepEqual(run.units.map(row => row.pattern), ["Baseline", "Reset", "Onset rise"]);
  assert.equal(run.units[2].cue, true);
  assert.equal(run.units[2].appliedTransition, "none");
});

test("a repeated frame entry and an interior frame disagreement do not reset the same account", async () => {
  const text = "She picked up the letter. She began to read the account. They missed the last train. They waited on the platform. She put the letter down.";
  for (const nested of [false, true]) {
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {fact: "cut", transition: "reported-entry", frame: "reported",
        scopeId: nested ? 2 : null});
      if (id === 1 || id === 2 && nested) return active(id, mode, {fact: "cut", action: "none", frame: "reported",
        narrativePhase: "quiet", transition: "reported-entry", scopeId: id});
      if (id === 2) return {...neutral(id), frame: "reported", scopeId: 1};
      if (id === 3) return {...neutral(id), frame: "remembered", scopeId: nested ? 2 : 1};
      if (id === 4) return active(id, mode, {fact: "cut", action: "none", narrativePhase: "quiet", transition: "present-return"});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...fixture(text), provider, verificationTargets: [0, 1, 2, 3, 4],
      verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2]});
    assert.deepEqual(run.units.map(row => row.pattern), ["Baseline", "Reset", nested ? "Reset" : "Baseline", "Baseline", "Reset"]);
    assert.equal(run.units[2].transitionVerification.transition, "reported-entry");
    assert.equal(run.units[2].appliedTransition, nested ? "reported-entry" : "none");
    assert.equal(run.units[2].playbackDisposition, nested ? undefined : "duplicate-frame-entry");
  }
});

test("a disputed consecutive return stays in the current frame while the raw typed event stays visible", async () => {
  for (const {confirmed, blocked} of [{}, {confirmed: true}, {blocked: true}]) {
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {fact: "cut", transition: "present-return"});
      if (id === 0) return {...neutral(id), frame: "reported"};
      if (id === 1 || confirmed) return active(id, mode, {fact: "cut", action: "none", narrativePhase: "quiet",
        transition: "present-return"});
      return neutral(id);
    });
    const input = fixture("She read the account aloud. She put the letter down. Jo pointed out its date.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2], verifyTransitions: true,
      maxTransitionVerification: 1, transitionTargets: [2], blockedIds: blocked ? [1] : []});
    const keepReturn = confirmed || blocked;
    assert.equal(run.units[1].pattern, blocked ? "Stop" : "Reset");
    assert.equal(run.units[2].transitionVerification.transition, "present-return");
    assert.equal(run.units[2].appliedTransition, keepReturn ? "present-return" : "none");
    assert.equal(run.units[2].pattern, keepReturn ? "Reset" : "Baseline");
    assert.equal(run.units[2].playbackDisposition, keepReturn ? undefined : "duplicate-frame-return");
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
      const run = await runLunaProtocolShadow({...fixture(text), provider, verificationTargets: [0, 1, 2, 3], maxCueChecks: 2});
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
  assert.deepEqual(row.labelEvidenceIds, []);
  assert.equal(row.primaryFailure, "target-evidence");
  assert.equal(row.transitionFlag, "transition-conflict");
  assert.equal(row.cue, undefined);
  assert.equal(row.pattern, "Baseline");
  assert.equal(row.appliedTransition, undefined);
});

test("a typed onset on ordinary activity remains a raw prediction when the cue pass is neutral", async () => {
  const provider = fake((id, mode) => mode === "transition" ?
    typedTransition(id, {fact: "none", transition: "onset"}) : neutral(id));
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [1],
    verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [1]});
  const row = run.units[1];
  assert.equal(row.transitionVerification.transition, "onset");
  assert.equal(row.appliedTransition, "none");
  assert.equal(row.readerCue, false);
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

test("quiet romantic context gets a blinded check and weak recovery needs prior causal evidence", async () => {
  const cases = [
    {priorRomance: true, citesPrior: true, reason: "romantic-context", pattern: "Undertone"},
    {priorRomance: true, citesPrior: false, reason: "romantic-context", pattern: "Baseline"},
    {priorRomance: false, citesPrior: true, reason: "discovery-disagreement", pattern: "Baseline"},
  ];
  for (const {priorRomance, citesPrior, reason, pattern} of cases) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (id === 0) return {...neutral(id), depiction: priorRomance ? "romantic" : "neutral"};
      if (mode === "discovery" && !priorRomance) return active(id, mode, {narrativePhase: "build"});
      if (mode === "cue-check") return active(id, "verify", {narrativePhase: "build", evidenceIds: citesPrior ? [0, 1] : [1]});
      return {...neutral(id), depiction: "romantic"};
    }, request => calls.push(request));
    const input = fixture("Nora looked forward to their date. Eli smiled and said he felt the same.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1], maxCueChecks: 1});
    assert.equal(run.units[1].cueRecoveryReason, reason);
    assert.equal(run.units[1].primaryPrefix.status, "neutral");
    assert.equal(run.units[1].cueRecoveryGuard, pattern === "Baseline" ? "recovery-buildup-unlinked" : undefined);
    assert.equal(run.units[1].pattern, pattern);
    const check = calls.find(call => call.mode === "cue-check");
    assert.deepEqual(Object.keys(check).sort(), reason === "romantic-context" ? ["focus", "mode", "targetIds", "units"] : ["mode", "targetIds", "units"]);
    assert.equal(check.focus, reason === "romantic-context" ? "buildup" : undefined);
  }
});

test("a continuation after a decline gets a fresh restart check without weakening the gate", async () => {
  for (const enacted of [true, false]) {
    const provider = fake((id, mode) => {
      if (id === 0) return active(id, mode, {fact: "neutralize", action: "none", transition: "declined-restart"});
      if (id === 1) return active(id, mode, {narrativePhase: "build"});
      if (mode === "cue-check" && enacted) return active(id, "verify", {action: "contact", narrativePhase: "onset"});
      return active(id, mode === "cue-check" ? "verify" : mode, {fact: "continue", action: "continuation", narrativePhase: "sustain",
        priorAnchor: 1, evidenceIds: [1, 2]});
    });
    const input = fixture("They declined another dance. She offered her hand and he said yes. They took each other's hands.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2], maxCueChecks: 1});
    assert.deepEqual(run.units.map(row => row.pattern), ["Baseline", "Baseline", enacted ? "Rebuild rise" : "Baseline"]);
    assert.equal(run.units[2].primaryPrefix.action, "continuation");
    assert.equal(run.units[2].cueRecoveryReason, "restart-state");
    assert.equal(run.units[2].cueRecoveryGuard, enacted ? undefined : "recovery-start-unproved");
  }
});

test("a closed gate keeps an accepted offer quiet despite two start votes and opens on independently checked participation", async () => {
  for (const boundary of ["declined-restart", "hard-stop"]) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return id === 0 ? typedTransition(id, {transition: boundary}) :
        typedTransition(id, {fact: "none", transition: "restart"});
      if (id === 0) return active(id, mode, {fact: "neutralize", action: "none", transition: boundary});
      if (id === 1 && mode === "cue-check") return {...neutral(id), depiction: "romantic"};
      if (id === 3) return neutral(id);
      return active(id, mode, {fact: "none", action: "contact", narrativePhase: "rebuild", transition: "restart", scopeId: null});
    }, request => calls.push(request));
    const input = fixture("Lee asked for a break. June offered a hand and Lee accepted. Lee took her hand. The music faded.");
    const run = await runLunaProtocolShadow({...input, provider, prefixUnits: 2, verificationTargets: [0, 1, 2, 3],
      verifyTransitions: true, maxTransitionVerification: 3, transitionTargets: [0, 1, 2], maxCueChecks: 2});
    assert.deepEqual(calls.filter(call => call.mode === "cue-check").map(call => [call.targetIds[0], call.focus]),
      [[1, "restart-gate"], [2, "restart-gate"]]);
    assert.equal(run.units[1].primaryPrefix.transition, "restart");
    assert.equal(run.units[1].transitionVerification.transition, "restart");
    assert.equal(run.units[1].appliedTransition, "none");
    assert.equal(run.units[1].pattern, "Baseline");
    assert.equal(run.units[1].phase, "quiet");
    assert.equal(run.units[1].cueGuard, "cue-restart-unconfirmed");
    assert.equal(run.units[1].cueRecoveryGuard, "recovery-start-unproved");
    assert.equal(run.units[2].pattern, "Rebuild rise");
    assert.equal(run.units[2].appliedTransition, "restart");
    assert.equal(run.units[2].cueRecovered, true);
    assert.equal(calls.find(call => call.mode === "verify" && call.targetIds[0] === 3).attested, undefined);
  }
});

test("a restart can use the last cue check and requires confirmation when verification is unavailable", async () => {
  for (const outcome of ["confirmed", "uncertain", "budget-deferred", "disabled"]) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (id === 0) return active(id, mode, {narrativePhase: "build"});
      if (id === 1 && mode === "discovery") return neutral(id);
      if (id === 1) return active(id, mode, {fact: "neutralize", action: "none", transition: "declined-restart"});
      if (mode === "cue-check" && outcome === "uncertain") return {...neutral(id), status: "uncertain"};
      return active(id, mode, {fact: "none", action: "contact", narrativePhase: "rebuild", transition: "restart"});
    }, request => calls.push(request));
    const input = fixture("June looked forward to dancing. Lee declined to dance again. Then Lee took her hand and began to dance.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2],
      maxCueChecks: outcome === "disabled" ? 0 : 1,
      ...(outcome === "budget-deferred" ? {budget: createLunaShadowBudget({maxAttempts: 4})} : {})});
    const checks = calls.filter(call => call.mode === "cue-check");
    assert.deepEqual(checks.map(call => [call.targetIds[0], call.focus]),
      ["confirmed", "uncertain"].includes(outcome) ? [[2, "restart-gate"]] : []);
    const row = run.units[2];
    assert.equal(row.pattern, outcome === "confirmed" ? "Rebuild rise" : "Baseline");
    assert.equal(row.appliedTransition, outcome === "confirmed" ? "restart" : "none");
    assert.equal(row.cueGuard, outcome === "confirmed" ? undefined : "cue-restart-unconfirmed");
    assert.equal(row.cueRecoveryStatus, outcome === "disabled" ? undefined : outcome === "confirmed" ? "verified" : outcome);
  }
});

test("a typed-only restart gets a focused check and does not inherit intensity from a rejected restart", async () => {
  for (const rejectedDepiction of ["romantic", "explicit"]) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {fact: "none", transition: "restart"});
      if (id === 0) return active(id, mode, {fact: "neutralize", action: "release", transition: "hard-stop"});
      if (id === 1 && mode === "cue-check" || id === 2 && mode === "discovery") return neutral(id);
      if (id === 3) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "sustain", depiction: "explicit"});
      return active(id, mode, {fact: "none", action: "contact", narrativePhase: "rebuild", transition: "restart",
        depiction: id === 1 ? rejectedDepiction : "romantic"});
    }, request => calls.push(request));
    const input = fixture("They stopped and stepped apart. He offered his hand. She took it. They held each other closely.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 3], verifyTransitions: true,
      maxTransitionVerification: 1, transitionTargets: [2], maxCueChecks: 2});
    assert.deepEqual(calls.filter(call => call.mode === "cue-check").map(call => [call.targetIds[0], call.focus]),
      [[1, "restart-gate"], [2, "restart-gate"]]);
    assert.equal(run.units[2].primaryPrefix, undefined);
    assert.deepEqual(run.units.map(row => row.pattern), ["Stop", "Baseline", "Rebuild rise", "Sustain wave"]);
  }
});

test("a typed start can ask the cue pass to reconsider anticipation without supplying activation proof", async () => {
  const provider = fake((id, mode) => {
    if (mode === "transition") return typedTransition(id, {fact: "none", transition: "onset"});
    if (mode === "cue-check") return active(id, "verify", {action: "contact", narrativePhase: "onset"});
    if (id === 1) return active(id, mode, {narrativePhase: "build"});
    return neutral(id);
  });
  const input = fixture("She asked if they should dance. He said yes and took her hand.");
  const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1], verifyTransitions: true,
    maxTransitionVerification: 1, transitionTargets: [1], maxCueChecks: 1});
  assert.equal(run.units[1].primaryPrefix.action, "anticipation");
  assert.equal(run.units[1].cueRecoveryReason, "typed-start");
  assert.equal(run.units[1].cueRecovery.action, "contact");
  assert.equal(run.units[1].pattern, "Onset rise");
});

test("an opening buildup is suppressed only by an independent definitive quiet result", async () => {
  for (const checkStatus of ["neutral", "uncertain", "verified"]) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "cue-check" && checkStatus !== "verified") return {...neutral(id), status: checkStatus, depiction: "romantic"};
      if (id === 0) return active(id, mode === "cue-check" ? "verify" : mode, {narrativePhase: "build"});
      return neutral(id);
    }, request => calls.push(request));
    const run = await runLunaProtocolShadow({...fixture("They looked forward to the dance. The doors opened."), provider,
      verificationTargets: [0, 1], maxCueChecks: 1});
    const row = run.units[0];
    assert.equal(calls.find(call => call.mode === "cue-check").focus, "buildup");
    assert.equal(row.primaryPrefix.narrativePhase, "build");
    assert.equal(row.cueRecoveryReason, "opening-buildup");
    assert.equal(row.cueRecoveryCorrection, checkStatus === "neutral" ? "quiet-opening" : undefined);
    assert.equal(row.pattern, checkStatus === "neutral" ? "Baseline" : "Undertone");
  }
});

test("an adjacent disputed onset can become a linked continuation without moving evidence backward", async () => {
  for (const [linked, typedAgrees, changesScope, citesPrior, confirmsStart] of [
    [true, false, false, false, false], [true, true, false, false, false], [false, true, false, false, false],
    [true, true, true, true, false], [true, true, true, false, false], [false, true, true, false, true],
  ]) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return id === 1 || typedAgrees ? typedTransition(id, {fact: "none", transition: "onset"}) :
        typedTransition(id, {status: "neutral", fact: "none", transition: "none", evidenceIds: []});
      if (mode === "cue-check" && confirmsStart) return active(id, "verify", {fact: "none", narrativePhase: "onset",
        action: "change", transition: "onset", scopeId: id});
      if (mode === "cue-check") return active(id, "verify", {fact: linked ? "continue" : "none",
        priorAnchor: linked ? 1 : null, evidenceIds: [1, 2], narrativePhase: "sustain", action: "continuation"});
      if (id > 0) return active(id, mode, {fact: "none", narrativePhase: "onset", action: "contact", transition: "onset",
        ...(id === 2 && changesScope ? {scopeId: id, evidenceIds: citesPrior ? [1, id] : [id]} : {})});
      return neutral(id);
    }, request => calls.push(request));
    const input = fixture("They agreed to dance. He took her hand. They kept holding hands as they walked.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2], verifyTransitions: true,
      maxTransitionVerification: 2, transitionTargets: [1, 2], maxCueChecks: 1});
    const row = run.units[2];
    assert.equal(calls.find(call => call.mode === "cue-check").focus, "enactment");
    assert.equal(row.primaryPrefix.transition, "onset");
    assert.equal(row.cueRecoveryReason, "adjacent-start");
    assert.equal(row.cueRecoveryCorrection, linked ? "linked-continuation" : undefined);
    assert.equal(row.cueRecoveryGuard, linked || confirmsStart ? undefined : "recovery-continuation-unlinked");
    assert.equal(row.action, linked ? "continuation" : "contact");
    assert.equal(run.units[1].pattern, "Onset rise");
  }
});

test("a disputed repeat of a latched decline does not count as another boundary or reopen the gate", async () => {
  for (const confirmed of [false, true]) {
    const provider = fake((id, mode) => {
      if (mode === "transition") return confirmed ? typedTransition(id, {transition: "declined-restart", fact: "neutralize"}) :
        typedTransition(id, {status: "neutral", fact: "none", transition: "none", evidenceIds: []});
      if (id < 2) return active(id, mode, {fact: "neutralize", action: "none", transition: "declined-restart",
        evidenceIds: id === 0 ? [0] : [0, 1]});
      if (id === 2) return active(id, mode, {narrativePhase: "build"});
      return active(id, mode, {fact: "none", action: "contact", narrativePhase: "rebuild", transition: "restart"});
    });
    const input = fixture("They declined another dance. A new song began. They considered dancing again. They took hands and began to dance.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2, 3], verifyTransitions: true,
      maxTransitionVerification: 1, transitionTargets: [1], maxCueChecks: 1});
    assert.equal(run.units[0].appliedTransition, "declined-restart");
    assert.equal(run.units[1].primaryPrefix.transition, "declined-restart");
    assert.equal(run.units[1].appliedTransition, confirmed ? "declined-restart" : "none");
    assert.equal(run.units[1].playbackDisposition, confirmed ? undefined : "repeated-decline");
    assert.deepEqual(run.units.map(row => row.pattern), ["Baseline", "Baseline", "Baseline", "Rebuild rise"]);
  }
});

test("a verified continuation can use the exact prior anchor as a scope alias", async () => {
  for (const scopeId of [2, 1]) {
    const provider = fake((id, mode) => {
      if (id === 2) return active(id, mode, {fact: "none", narrativePhase: "onset", action: "contact", transition: "onset"});
      if (id === 3) return active(id, mode, {fact: "continue", narrativePhase: "sustain", action: "continuation", scopeId,
        priorAnchor: 2, evidenceIds: [2, 3]});
      return neutral(id);
    });
    const input = fixture("They arrived together. The doors opened. He took her hand. They kept holding hands as they walked.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2, 3]});
    assert.equal(run.units[3].scopeId, scopeId);
    assert.equal(run.units[3].readerCue, scopeId === 2);
    assert.equal(run.units[3].playbackDisposition, scopeId === 2 ? "continuation-scope-alias" : "unattested-scope");
  }
});

test("a continuation can cite the enacted start that opened its new scope while earlier scope evidence stays stale", async () => {
  for (const stale of [false, true]) {
    const provider = fake((id, mode) => {
      if (id === 0) return active(id, mode, {fact: "low", narrativePhase: "build", scopeId: 0});
      if (id === 1) return active(id, mode, {fact: "none", narrativePhase: "onset", action: "contact", transition: "onset",
        scopeId: 1, evidenceIds: [0, 1]});
      return active(id, mode, {fact: "continue", narrativePhase: "sustain", action: "continuation", scopeId: 1,
        priorAnchor: 1, evidenceIds: stale ? [0, 1, 2] : [1, 2]});
    });
    const input = fixture("They wanted to dance together. He took her hand. They kept holding hands as they walked.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2]});
    assert.equal(run.units[1].trace.decision, "Fresh beat after cut");
    assert.equal(run.units[2].readerCue, !stale);
    assert.equal(run.units[2].cueGuard, stale ? "cue-stale-evidence" : undefined);
  }
});

test("an exact linked change remains a direct cue without restarting the beat", async () => {
  const input = fixture("They exchanged a warm smile. They walked side by side. He changed how he held her hand.");
  const run = (action, attested) => runLunaProtocolShadow({...input, verificationTargets: [0, 1, 2],
    verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [2], provider: fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {transition: "onset", fact: "none"});
      if (id === 0 && attested) return active(id, mode, {narrativePhase: "build"});
      if (id === 2) return active(id, mode, {fact: "continue", action, narrativePhase: "sustain", priorAnchor: 0, evidenceIds: [0, 2]});
      return neutral(id);
    })});
  const changed = await run("change", true);
  const ordinary = await run("continuation", true);
  const unlinked = await run("change", false);
  assert.equal(changed.units[2].cue, true);
  assert.equal(changed.units[2].readerCue, true);
  assert.equal(changed.units[2].transitionVerification.transition, "onset");
  assert.equal(changed.units[2].appliedTransition, "none");
  assert.equal(changed.units[2].beatId, changed.units[0].beatId);
  assert.equal(changed.units[2].pattern, ordinary.units[2].pattern);
  assert.deepEqual(changed.units[2].trace, ordinary.units[2].trace);
  assert.equal(ordinary.units[2].cue, false);
  assert.equal(ordinary.units[2].readerCue, true);
  assert.equal(unlinked.units[2].cue, false);
  assert.equal(unlinked.units[2].playbackDisposition, "unattested-scope");
});

test("an exact scene cut cannot reuse a continuation from before the cut or clear its gate", async () => {
  const input = fixture("They exchanged a warm smile. Later they adjusted their steps. She looked forward to dancing. The clock chimed. The doors opened.");
  for (const gate of [null, "blocked", "protective", "hard-stop", "declined-restart"]) {
    const calls = [];
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {fact: "cut", transition: "scene-cut", scopeId: 1, evidenceIds: [0, 1]});
      if (id === 0 && ["protective", "hard-stop", "declined-restart"].includes(gate)) {
        return active(id, mode, {fact: gate === "protective" ? "protective" : "neutralize", action: "none",
          transition: gate === "declined-restart" ? gate : "hard-stop"});
      }
      if (id === 0) return active(id, mode);
      if (id === 1) return active(id, mode, {fact: "continue", action: "change", narrativePhase: "sustain", priorAnchor: 0, evidenceIds: [0, 1]});
      if (id === 2) return active(id, mode, {scopeId: 1, narrativePhase: "build"});
      return neutral(id);
    }, request => calls.push(request));
    const run = await runLunaProtocolShadow({...input, provider, prefixUnits: 2, verificationTargets: [0, 1, 2, 3, 4],
      blockedIds: gate === "blocked" ? [0] : [], verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [1]});
    const cut = run.units[1];
    assert.equal(cut.primaryPrefix.fact, "continue");
    assert.equal(cut.appliedTransition, "scene-cut");
    assert.equal(cut.pattern, "Reset");
    assert.equal(cut.beatId, null);
    assert.equal(cut.sceneId, "fixture:scene:1");
    assert.equal(cut.cue, false);
    assert.equal(cut.readerCue, false);
    assert.equal(run.units[2].pattern, gate ? "Baseline" : "Undertone");
    assert.deepEqual(calls.find(call => call.mode === "verify" && call.targetIds[0] === 4).attested, gate ? undefined :
      [{unitId: 2, scopeId: 1, frame: "current", action: "anticipation", narrativePhase: "build"}]);
  }
});

test("a verified scene cut can start a new beat on independent target evidence when the target is open", async () => {
  const input = fixture("They exchanged a warm smile. Hours later they took hands at the dance. The clock chimed.");
  const provider = fake((id, mode) => {
    if (mode === "transition") return typedTransition(id, {fact: "cut", transition: "scene-cut", scopeId: 1, evidenceIds: [0, 1]});
    if (id === 0) return active(id, mode);
    if (id === 1) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset", scopeId: 1});
    return neutral(id);
  });
  for (const blocked of [false, true]) {
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2], blockedIds: blocked ? [1] : [],
      verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [1]});
    const cut = run.units[1];
    assert.equal(cut.appliedTransition, "scene-cut");
    assert.equal(cut.pattern, blocked ? "Stop" : "Onset rise");
    assert.equal(cut.cue, !blocked);
    assert.equal(cut.beatId, blocked ? null : "fixture:beat:1");
  }
});

test("an independent scene boundary opens only an exact new local beat on a clear gate", async () => {
  const input = fixture("They danced by the window. Hours later they arrived at the hall. The clock chimed.");
  const cases = [
    {local: "onset", pattern: "Onset rise"},
    {local: "onset", scopeId: 0, pattern: "Reset"},
    {local: "accent", pattern: "Reset"},
    {local: "continuation", pattern: "Reset"},
    {local: "none", pattern: "Reset"},
    {local: "onset", blockedIds: [1], pattern: "Stop"},
    {local: "onset", earlierStop: true, pattern: "Reset"},
  ];
  for (const {local, scopeId = 1, blockedIds = [], earlierStop, pattern} of cases) {
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: [],
        sceneBoundary: {status: "cut", reason: "time-jump", previousId: 0, entryId: 1}});
      if (id === 0) return earlierStop ? active(id, mode, {fact: "protective", action: "none", transition: "hard-stop"}) :
        active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"});
      if (id !== 1 || local === "none") return neutral(id);
      if (local === "continuation") return active(id, mode, {fact: "continue", action: "continuation", narrativePhase: "sustain",
        priorAnchor: 0, evidenceIds: [0, 1]});
      return active(id, mode, {fact: "none", action: local === "onset" ? "contact" : "change",
        narrativePhase: local === "onset" ? "onset" : "sustain", transition: local, scopeId});
    });
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2], blockedIds, verifyTransitions: true,
      maxTransitionVerification: 1, transitionTargets: [1], requireSceneBoundary: true});
    const row = run.units[1];
    assert.equal(row.transitionVerification.transition, "none");
    assert.equal(row.appliedTransition, "scene-cut");
    assert.equal(row.pattern, pattern);
    assert.equal(row.cue, pattern === "Onset rise");
    assert.equal(row.beatId, pattern === "Onset rise" ? "fixture:beat:1" : null);
    if (pattern === "Reset") assert.equal(run.units[2].pattern, "Baseline");
  }
});

test("deferred context can support an exact low cue but cannot carry playback or suppress a prior block", async () => {
  for (const blocked of [false, true]) {
    const provider = fake((id, mode) => {
      if (id === 0) return active(id, mode, {narrativePhase: "build"});
      if (id === 1) return active(id, mode, {narrativePhase: "build", evidenceIds: [0, 1]});
      return neutral(id);
    });
    const input = fixture("They exchanged a look. She noticed his nervous smile. The door opened.");
    const run = await runLunaProtocolShadow({...input, provider, maxVerification: 1,
      verificationTargets: [1], blockedIds: blocked ? [0] : []});
    assert.deepEqual(run.units.slice(0, 2).map(row => row.pattern), blocked ? ["Stop", "Baseline"] : ["Baseline", "Undertone"]);
    assert.equal(run.units[0].status, "verification-deferred");
    assert.equal(run.units[1].cue, false);
    assert.equal(run.units[1].readerCue, !blocked);
    if (!blocked) assert.deepEqual(run.units[1].trace.evidence, [0, 1]);
  }
});

test("verified buildup with cited romantic context uses a gradual profile while keeping cue metadata separate", async () => {
  const input = fixture("The door opened. They exchanged a warm smile. She looked forward to the dance.");
  for (const [contextScope, evidenceIds, pattern] of [[null, [1, 2], "Gradual build"], [1, [1, 2], "Undertone"],
    [null, [2], "Undertone"]]) {
    const provider = fake((id, mode) => {
      if (id === 1) return {...neutral(id), depiction: "romantic", scopeId: contextScope, evidenceIds: [id]};
      if (id === 2) return active(id, mode, {narrativePhase: "build", depiction: "neutral", evidenceIds});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...input, provider, maxVerification: 1, verificationTargets: [2]});
    assert.equal(run.units[1].pattern, "Baseline");
    assert.equal(run.units[2].pattern, pattern);
    assert.equal(run.units[2].phase, "build");
    assert.equal(run.units[2].cue, false);
    assert.deepEqual(run.units[2].trace.evidence, evidenceIds);
  }
});

test("adjacent exact buildup accumulates only within its open paragraph and declared scope", async () => {
  const cases = [
    {pattern: "Gradual build"},
    {previousScope: 1, pattern: "Undertone"},
    {paragraphBreak: true, pattern: "Undertone"},
    {supporting: false, pattern: "Undertone"},
    {blocked: true, pattern: "Baseline"},
  ];
  for (const {previousScope = 0, paragraphBreak, supporting = true, blocked, pattern} of cases) {
    const separator = paragraphBreak ? "\n\n" : " ";
    const input = fixture(`The doors opened. June looked forward to the dance.${separator}She felt her anticipation growing.`);
    const provider = fake((id, mode) => {
      if (id === 1) return active(id, mode, {narrativePhase: "build", scopeId: mode === "discovery" ? null : previousScope});
      if (id === 2) return active(id, mode, {narrativePhase: "build"});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...input, provider, maxVerification: 1, verificationTargets: [2],
      maxSupportingVerification: supporting ? 1 : 0, blockedIds: blocked ? [1] : []});
    const [previous, target] = run.units.slice(1);
    assert.equal(previous.pattern, blocked ? "Stop" : "Baseline");
    assert.equal(target.pattern, pattern);
    assert.equal(target.cue, false);
    assert.deepEqual(target.primaryPrefix.evidenceIds, [2]);
    if (pattern === "Gradual build") {
      assert.deepEqual(target.trace.evidence, [1, 2]);
      assert.equal(target.knownAt, 2);
      assert.equal(target.readerCue, true);
    }
  }
});

test("an independently linked build lets auxiliary evidence renew only an open low envelope", async () => {
  const source = "The music began and both friends smiled. June looked forward to the dance. " +
    "She expected that sharing the dance would be pleasant and kept thinking of that quiet moment while the musicians continued playing for the people gathering in the room. " +
    "The guests chatted quietly nearby while someone in the hall adjusted the lights for the music. The doors stayed open.";
  const cases = [
    {target: "Gradual build", support: "Renew low envelope", tail: "Undertone"},
    {contextId: null, target: "Undertone", tail: "Taper"},
    {supportScope: 1, target: "Gradual build", tail: "Taper"},
    {blocked: true, target: "Baseline", tail: "Baseline"},
  ];
  for (const {contextId = 0, supportScope = 0, blocked, target, support, tail} of cases) {
    const provider = Object.assign(fake((id, mode) => {
      if (mode === "local-action") return {unitId: id, localAction: {status: "verified", frame: "current", action: "anticipation",
        phase: "build", contrast: "charged-reaction", targetId: id, contextId}};
      if (mode === "transition") return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: [],
        sceneBoundary: {status: "none", reason: "none", previousId: null, entryId: null}});
      if (id <= 2) return active(id, mode, {narrativePhase: "build", scopeId: mode === "discovery" || id === 0 ? null :
        id === 2 ? supportScope : 0});
      return neutral(id);
    }), {sceneBoundaryProtocol: true});
    const run = await runLunaProtocolShadow({...fixture(source), provider, verificationTargets: [1, 4], maxVerification: 2,
      maxSupportingVerification: 2, verifyTransitions: true, transitionTargets: [1], maxTransitionVerification: 1,
      localActionVerificationTargets: [1], blockedIds: blocked ? [0] : []});
    const [earlier, buildup, auxiliary, , quiet] = run.units;
    assert.equal(earlier.pattern, blocked ? "Stop" : "Baseline");
    assert.equal(buildup.pattern, target);
    assert.equal(quiet.pattern, tail);
    assert.equal(auxiliary.readerCue, false);
    assert.equal(quiet.readerCue, false);
    assert.equal(buildup.cue, false);
    assert.deepEqual(buildup.primaryPrefix.evidenceIds, [1]);
    if (support) {
      assert.equal(auxiliary.trace.decision, support);
      assert.deepEqual(buildup.trace.evidence, [0, 1]);
      assert.deepEqual(quiet.trace.evidence, [2]);
      assert.equal(quiet.knownAt, 2);
    } else assert.notEqual(auxiliary.trace.decision, "Renew low envelope");
  }
});

test("exact sustained contact can use a separately verified onset without promoting ordinary continuation", async () => {
  const input = fixture("The doors opened. They took hands. They held hands closely. The music played on.");
  for (const [priorPhase, action, pattern] of [["onset", "contact", "Sustain wave"], ["onset", "continuation", "Undertone"],
    ["build", "contact", "Undertone"]]) {
    const provider = fake((id, mode) => {
      if (id === 1) {
        const scopeId = mode === "discovery" ? 1 : 0;
        return priorPhase === "onset" ? active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset", scopeId}) :
          active(id, mode, {narrativePhase: "build", scopeId});
      }
      if (id === 2) return active(id, mode, {fact: "continue", action, narrativePhase: "sustain", priorAnchor: 1, evidenceIds: [1, 2]});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...input, provider, maxVerification: 2, verificationTargets: [2, 3], maxSupportingVerification: 1});
    assert.deepEqual(run.summary.supportingVerification, [{id: 1, status: "returned"}]);
    assert.deepEqual(run.units.slice(1).map(row => row.pattern), ["Baseline", pattern, pattern]);
    assert.equal(run.units[2].phase, "sustain");
    assert.equal(run.units[2].cue, false);
    assert.deepEqual(run.units[2].trace.evidence, [1, 2]);
  }
});

test("an independently verified local release can taper an isolated sample without inventing prior carry", async () => {
  for (const [fact, event, typedFact] of [["ease", "interruption", "none"], ["span-end", "interruption", "none"],
    ["beat-end", "beat-end", "beat-end"], ["none", "interruption", "none"]]) {
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {fact: typedFact, transition: event});
      if (id === 0) return active(id, mode, {narrativePhase: "build"});
      if (id === 1 && fact !== "none") return active(id, mode, {fact, narrativePhase: "ease", action: "release",
        transition: event, evidenceIds: [0, 1]});
      return neutral(id);
    });
    const input = fixture("They exchanged a warm look. They let the moment soften. The door opened.");
    const run = await runLunaProtocolShadow({...input, provider, maxVerification: 1, verificationTargets: [1],
      verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [1]});
    assert.equal(run.units[0].pattern, "Baseline");
    assert.equal(run.units[1].pattern, fact === "none" ? "Baseline" : "Taper");
    assert.equal(run.units[1].cue, false);
    if (fact === "beat-end") assert.equal(run.units[1].beatId, null);
  }
});

test("a verified beat end with no new action tapers only a recent accepted start in the same scope", async () => {
  const cases = [
    {expected: "Taper"},
    {closingPhase: "ease", expected: "Taper"},
    {closingPhase: "ease", openingAction: "anticipation", expected: "Baseline"},
    {closingScope: 1, expected: "Baseline"},
    {typedEarlier: false, expected: "Baseline"},
    {blockedIds: [1], expected: "Baseline"},
    {blockedIds: [3], expected: "Stop"},
    {longGap: true, expected: "Baseline"},
  ];
  for (const {expected, closingScope = 0, closingPhase = "quiet", openingAction = "contact", typedEarlier = true, blockedIds = [], longGap = false} of cases) {
    const connector = longGap ?
      "They kept pace while the room slowly filled with guests who had come from the nearby houses to watch the musicians play before the last street lamps were turned on that evening outside the hall." :
      "The musicians reached the final bars.";
    const input = fixture(`They took hands for the dance. The lights changed. ${connector} They finished the dance. The room went quiet.`);
    const provider = fake((id, mode) => {
      if (mode === "transition") return typedTransition(id, {transition: "beat-end", fact: "beat-end",
        priorAnchor: typedEarlier ? 2 : null, evidenceIds: typedEarlier ? [2, id] : [id]});
      if (id === 0) return openingAction === "contact" ?
        active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"}) :
        active(id, mode, {narrativePhase: "build"});
      if (id === 2 && mode === "discovery") return active(id, mode, {fact: "continue", action: "continuation",
        narrativePhase: "sustain", priorAnchor: 0, evidenceIds: [0, id]});
      if (id === 3) return active(id, mode, {fact: "beat-end", action: "none", narrativePhase: closingPhase,
        transition: "beat-end", scopeId: closingScope, priorAnchor: 0, evidenceIds: [0, id]});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 3], maxVerification: 2,
      verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [3], blockedIds});
    const [target, after] = run.units.slice(3);
    assert.equal(target.pattern, expected, JSON.stringify({closingScope, closingPhase, openingAction, typedEarlier, blockedIds, longGap}));
    assert.equal(target.cue, false);
    assert.equal(target.readerCue, false);
    assert.equal(target.appliedTransition, "beat-end");
    assert.equal(after.pattern, "Baseline");
    assert.equal(after.beatId, null);
    if (expected === "Taper") {
      assert.equal(target.trace.decision, "End beat");
      assert.equal(target.knownAt, 3);
      assert.deepEqual(target.trace.evidence, [0, 2, 3]);
    }
  }
});

test("exact recovery contact after a verified ordinary beat end stays local to the scored target", async () => {
  const input = fixture("They took hands. They finished the dance. The musicians packed up. She pressed his hand in thanks. The lights dimmed.");
  const cases = [
    {ending: "beat-end", expected: "Recovery"},
    {ending: "beat-end", rawAction: "release", expected: "Baseline"},
    {ending: "beat-end", typedSupport: "old-anchor", expected: "Baseline"},
    {ending: "beat-end", typedSupport: "neutral", expected: "Baseline"},
    {ending: "scene-cut", expected: "Baseline"},
    {ending: "hard-stop", expected: "Baseline"},
    {ending: "declined-restart", expected: "Baseline"},
    {ending: "protected", expected: "Stop"},
  ];
  for (const {ending, rawAction = "contact", typedSupport, expected} of cases) {
    const provider = fake((id, mode) => {
      if (mode === "transition") {
        if (typedSupport === "neutral") return typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: []});
        const priorAnchor = typedSupport === "old-anchor" ? 0 : 1;
        return typedTransition(id, {fact: "ease", transition: "recover", priorAnchor, evidenceIds: [priorAnchor, id]});
      }
      if (id === 0) return active(id, mode, {fact: "none", action: "contact", narrativePhase: "onset", transition: "onset"});
      if (id === 1) {
        const fact = ending === "beat-end" ? "beat-end" : ending === "scene-cut" ? "cut" : ending === "protected" ? "protective" : "neutralize";
        return active(id, mode, {fact, action: "none", transition: ending === "protected" ? "hard-stop" : ending});
      }
      if (id === 3) return active(id, mode, {fact: "ease", action: rawAction, narrativePhase: "recover", transition: "recover",
        priorAnchor: 0, evidenceIds: [0, 3]});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 2, 3, 4], maxVerification: 4,
      maxSupportingVerification: 1, verifyTransitions: true, maxTransitionVerification: 1, transitionTargets: [3]});
    assert.equal(run.units[3].pattern, expected, JSON.stringify({ending, rawAction, typedSupport}));
    assert.equal(run.units[3].cue, false);
    assert.equal(run.units[3].beatId, null);
    assert.equal(run.units[4].pattern, "Baseline");
    assert.equal(run.units[4].beatId, null);
    if (expected === "Recovery") {
      assert.equal(run.units[3].phase, "recover");
      assert.equal(run.units[3].appliedTransition, "recover");
      assert.deepEqual(run.units[3].trace.evidence, [1, 3]);
    }
  }
});

test("neutral scope numbering and quiet frame observations do not invent reset output", async () => {
  const provider = fake((id, mode) => {
    if (id === 0) return active(id, mode, {narrativePhase: "build"});
    if (id === 1) return {...neutral(id), scopeId: 1};
    if (id === 2) return {...neutral(id), frame: "remembered"};
    return neutral(id);
  });
  const run = await runLunaProtocolShadow({...fixture(), provider, verificationTargets: [0, 1, 2, 3]});
  assert.deepEqual(run.units.slice(0, 4).map(row => row.pattern), ["Undertone", "Undertone", "Baseline", "Baseline"]);
  assert.equal(run.units[1].sceneId, run.units[0].sceneId);
  assert.equal(run.units[2].beatId, null);
  assert.equal(run.units[2].appliedTransition, "none");
});

test("an exact frame entry survives typed silence, and a mixed return waits for current evidence", async () => {
  for (const futureCited of [false, true]) {
    const provider = fake((id, mode) => {
      if (mode === "transition") return id === 2 ? typedTransition(id, {fact: "cut", frame: "mixed", transition: "present-return"}) :
        typedTransition(id, {status: "neutral", fact: "none", transition: "none", evidenceIds: []});
      if (id === 1) return active(id, mode, {fact: "cut", frame: "imagined", action: "none", narrativePhase: "quiet",
        transition: "imagined-entry", scopeId: 1, evidenceIds: mode === "discovery" && futureCited ? [1, 2] : [1]});
      if (id === 2) return {...neutral(id), frame: "imagined", evidenceIds: [2]};
      if (id === 3 && mode !== "discovery") return active(id, mode, {fact: "cut", action: "none", narrativePhase: "quiet",
        transition: "present-return", evidenceIds: [2, 3]});
      return neutral(id);
    });
    const input = fixture("They talked by the window. She imagined the trip. The imagined train crossed a bridge. She came back to the room.");
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2, 3],
      verifyTransitions: true, maxTransitionVerification: 3, transitionTargets: [1, 2, 3]});
    assert.equal(run.units[1].transitionVerification.transition, "none");
    assert.equal(run.units[1].appliedTransition, futureCited ? "none" : "imagined-entry");
    assert.equal(run.units[1].pattern, futureCited ? "Baseline" : "Reset");
    assert.equal(run.units[2].transitionVerification.transition, "present-return");
    assert.equal(run.units[2].appliedTransition, "none");
    assert.equal(run.units[2].pattern, "Baseline");
    assert.equal(run.units[3].transitionVerification.transition, "none");
    assert.equal(run.units[3].appliedTransition, "present-return");
  }
});

test("a recovered frame edge and a local release cannot clear a verified stop", async () => {
  const provider = fake((id, mode) => {
    if (mode === "transition") return id === 0 ? typedTransition(id, {fact: "neutralize", transition: "hard-stop"}) :
      typedTransition(id, {status: "neutral", fact: "none", transition: "none", evidenceIds: []});
    if (id === 0) return active(id, mode, {fact: "neutralize", action: "release", narrativePhase: "quiet", transition: "hard-stop"});
    if (id === 1) return active(id, mode, {fact: "cut", frame: "imagined", action: "none", narrativePhase: "quiet",
      transition: "imagined-entry", scopeId: 1});
    if (id === 2) return active(id, mode, {fact: "cut", action: "none", narrativePhase: "quiet", transition: "present-return"});
    if (id === 3) return active(id, mode, {fact: "ease", action: "release", narrativePhase: "ease", transition: "ease"});
    return active(id, mode, {narrativePhase: "build", scopeId: 4});
  });
  const input = fixture("They agreed to stop. She imagined a trip. She came back to the room. They let the moment soften. He offered a smile.");
  const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [0, 1, 2, 3, 4],
    verifyTransitions: true, maxTransitionVerification: 5, transitionTargets: [0, 1, 2, 3, 4]});
  assert.deepEqual(run.units.map(row => row.pattern), ["Stop", "Reset", "Reset", "Baseline", "Baseline"]);
  assert.equal(run.units[4].cueGuard, "cue-restart-required");
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

test("post-return releases use only exact current-frame evidence and create no anchor", async () => {
  const cases = [
    {patterns: ["Taper", "Taper"]},
    {scope: 0, patterns: ["Baseline", "Baseline"]},
    {followupCitesRelease: false, patterns: ["Taper", "Baseline"]},
    {blockedIds: [1], patterns: ["Baseline", "Baseline"]},
    {blockedIds: [2], patterns: ["Stop", "Baseline"]},
    {typedFirst: "none", patterns: ["Baseline", "Baseline"]},
    {typedFirst: "unresolved", patterns: ["Baseline", "Baseline"]},
  ];
  for (const {patterns, scope = 1, followupCitesRelease = true, blockedIds = [], typedFirst = "interruption"} of cases) {
    const noBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
    const input = fixture("They remembered their dance. She thought of the dance tonight. He paused to put down his coat. She let go of his hand. The street lamps came on.");
    const provider = fake((id, mode) => {
      if (mode === "transition") return id === 2 && typedFirst === "interruption" ?
        typedTransition(id, {transition: "interruption", fact: "none", sceneBoundary: noBoundary}) :
        typedTransition(id, {status: "neutral", transition: "none", fact: "none", evidenceIds: [], sceneBoundary: typedFirst === "unresolved" ? {status: "uncertain", reason: "insufficient-prefix",
          previousId: null, entryId: null} : noBoundary});
      if (id === 0) return active(id, mode, {narrativePhase: "build", ...(mode === "discovery" ? {} : {frame: "remembered", fact: "none"})});
      if (id === 1) return active(id, mode, {narrativePhase: "build"});
      if (id === 2) return active(id, mode, {narrativePhase: "ease", action: "release", fact: "ease", transition: "interruption",
        scopeId: scope, priorAnchor: 1, evidenceIds: [0, 1, 2]});
      if (id === 3) return active(id, mode, {narrativePhase: "ease", action: "release", fact: "ease",
        scopeId: scope, priorAnchor: 1, evidenceIds: followupCitesRelease ? [1, 2, 3] : [1, 3]});
      return neutral(id);
    });
    const run = await runLunaProtocolShadow({...input, provider, verificationTargets: [2, 3], maxVerification: 2,
      verifyTransitions: true, maxTransitionVerification: 2, transitionTargets: [2, 3], maxSupportingVerification: 2, blockedIds});
    assert.deepEqual(run.units.slice(2).map(row => row.pattern), [...patterns, "Baseline"],
      JSON.stringify({scope, followupCitesRelease, blockedIds, typedFirst}));
    assert.equal(run.units[2].cue, false);
    assert.equal(run.units[3].cue, false);
    assert.equal(run.units[2].beatId, null);
    assert.equal(run.units[3].beatId, null);
    assert.equal(run.units[2].verifiedRelease === true, patterns[0] === "Taper");
    assert.equal(run.units[3].verifiedRelease === true, patterns[1] === "Taper");
    assert.equal(run.units[4].beatId, null);
    if (patterns[0] === "Taper") {
      assert.equal(run.units[2].trace.decision, "Local taper");
      assert.deepEqual(run.units[2].trace.evidence, [1, 2]);
      assert.deepEqual(run.units[2].primaryPrefix.evidenceIds, [0, 1, 2]);
    }
  }
});
