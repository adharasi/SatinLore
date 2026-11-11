import assert from "node:assert/strict";
import test from "node:test";
import {createLunaProtocolProvider, LUNA_PROTOCOL_ENUMS, LUNA_PROTOCOL_FAILURE_REASONS, LUNA_PROTOCOL_LIMITS, LUNA_PROTOCOL_MODEL,
  LUNA_PROTOCOL_TARGET_FAILURES, LUNA_PROTOCOL_TARGET_NORMALIZATIONS, lunaProtocolInputOverhead, lunaProtocolOutputTokens}
  from "../scripts/lib/luna-protocol-provider.mjs";

const units = [{id: 10, text: "June noticed Lee watching her."}, {id: 11, text: "She smiled."}, {id: 12, text: "The clock chimed."}];
const secret = "test-key-never-returned";
const request = (mode = "discovery", targetIds = [11, 12]) => ({mode, units, targetIds});
const provider = (fetchImpl, options) => createLunaProtocolProvider({apiKey: secret, fetchImpl, ...options});
const fact = (unitId, extra) => ({unitId, depiction: "neutral", frame: "current", narrativePhase: "quiet", action: "none",
  transition: "none", fact: "none", scopeId: null, evidenceIds: [], priorAnchor: null, status: "neutral", ...extra});
const response = (facts, extra) => Response.json({model: LUNA_PROTOCOL_MODEL, status: "completed",
  output: [{type: "reasoning"}, {type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({facts})}]}],
  ...extra});
const failure = (status, failureReason) => ({status, failureReason, usage: null});
const success = (facts, usage = null, returnedModel = LUNA_PROTOCOL_MODEL) => ({status: "ok", facts, usage, returnedModel});
const targetFailure = (unitId, reason) => ({unitId, reason});
const rejected = targetFailures => ({...failure("invalid-response", "output-schema"), targetFailures});
const partial = (facts, targetFailures) => ({...success(facts), status: "partial", targetFailures});
const rejectedTransition = (row, reason) => {
  const failure = targetFailure(row.unitId, reason);
  if (reason === "status-effect") failure.detail = {status: row.status, frame: row.frame, transition: row.transition,
    fact: row.fact, hasScope: row.scopeId !== null, hasPriorAnchor: row.priorAnchor !== null,
    citesTarget: row.evidenceIds.includes(row.unitId), evidenceCount: row.evidenceIds.length};
  return rejected([failure]);
};

test("local action check sends only the blind prefix and separates local action from phase", async () => {
  const supplied = {mode: "local-action", units, targetIds: [12]};
  const localAction = {status: "verified", frame: "current", action: "contact", phase: "recover", contrast: "enacted",
    targetId: 12, contextId: 11};
  const row = {unitId: 12, localAction};
  let calls = 0;
  const run = provider(async (_url, {body}) => {
    calls++;
    const sent = JSON.parse(body);
    assert.deepEqual(JSON.parse(sent.input), {units, targetIds: [12]});
    assert.equal(sent.text.format.name, "nocturne_luna_local_action_v1");
    const schema = sent.text.format.schema.properties.facts.items;
    assert.deepEqual(schema.required, ["unitId", "localAction"]);
    assert.equal(schema.properties.localAction.additionalProperties, false);
    assert.match(sent.instructions, /what the target itself adds/u);
    assert.match(sent.instructions, /Never quote/u);
    return response([row]);
  });
  assert.deepEqual(await run({...supplied, priorVerdict: fact(12), candidates: [fact(12)]}), success([row]));
  const invalidRequest = failure("invalid-request", "request-shape");
  assert.deepEqual(await run({...supplied, targetIds: [11]}), invalidRequest);
  assert.deepEqual(await run({...supplied, attested: [{unitId: 9, scopeId: 9, frame: "current", action: "contact", narrativePhase: "onset"}]}),
    invalidRequest);
  assert.equal(calls, 1);

  const evidence = (targetEvidence, contextEvidence, status = "verified", action = "contact") =>
    ({status, action, targetEvidence, contextEvidence});
  for (const [extra, detail] of [
    [{targetId: null}, evidence("missing", "earlier-prefix")],
    [{targetId: 11}, evidence("earlier-prefix", "earlier-prefix")],
    [{contextId: 12}, evidence("exact-target", "exact-target")],
    [{contextId: 9}, evidence("exact-target", "outside-prefix")],
    [{contextId: 13}, evidence("exact-target", "after-target")],
    [{contextId: units[0].text}, evidence("exact-target", "invalid-id")],
    [{action: "continuation", contrast: "same-action", contextId: null}, evidence("exact-target", "missing", "verified", "continuation")],
    [{status: "none", action: "none", phase: "quiet", contrast: "neutral"}, evidence("exact-target", "earlier-prefix", "none", "none")],
    [{status: "uncertain", action: "unknown", phase: "unknown", contrast: "ambiguous", contextId: null},
      evidence("exact-target", "missing", "uncertain", "unknown")],
  ]) {
    const invalid = provider(async () => response([{...row, localAction: {...localAction, ...extra}}]));
    assert.deepEqual(await invalid(supplied), rejected([{...targetFailure(12, "local-action-evidence"), detail}]));
  }
  for (const [extra, reason] of [
    [{frame: "noncurrent"}, "local-action-shape"], [{action: "release"}, "local-action-shape"],
    [{phase: "quiet"}, "local-action-shape"], [{comment: units[0].text}, "local-action-shape"],
  ]) {
    const invalid = provider(async () => response([{...row, localAction: {...localAction, ...extra}}]));
    assert.deepEqual(await invalid(supplied), rejected([targetFailure(12, reason)]));
  }
  for (const verdict of [
    {...localAction, phase: "unknown", contextId: null},
    {status: "none", frame: "noncurrent", action: "none", phase: "quiet", contrast: "noncurrent", targetId: null, contextId: null},
    {status: "uncertain", frame: "current", action: "unknown", phase: "unknown", contrast: "insufficient-prefix",
      targetId: null, contextId: null},
  ]) {
    const verified = {...row, localAction: verdict};
    const run = provider(async () => response([verified]));
    assert.deepEqual(await run(supplied), success([verified]));
  }
});

test("scene-only verification sends a blind causal prefix and validates evidence roles", async () => {
  const supplied = {mode: "scene-boundary", units, targetIds: [12]};
  const sceneBoundary = {status: "cut", reason: "setting-shift", previousId: 10, changeId: 11,
    entryId: 12, contrast: "material-change"};
  const row = {unitId: 12, sceneBoundary};
  let calls = 0;
  const run = provider(async (_url, {body}) => {
    calls++;
    const sent = JSON.parse(body);
    assert.deepEqual(JSON.parse(sent.input), {units, targetIds: [12]});
    assert.equal(sent.text.format.name, "nocturne_luna_scene_boundary_v1");
    const schema = sent.text.format.schema.properties.facts.items;
    assert.deepEqual(schema.required, ["unitId", "sceneBoundary"]);
    assert.equal(schema.properties.sceneBoundary.additionalProperties, false);
    assert.match(sent.instructions, /time, setting, and the governing objective/u);
    assert.match(sent.instructions, /A decorative heading alone supplies no cut/u);
    return response([row]);
  });
  assert.deepEqual(await run({...supplied, priorVerdict: fact(12), candidates: [fact(12)]}), success([row]));
  assert.deepEqual(await run({...supplied, targetIds: [11]}), failure("invalid-request", "request-shape"));
  assert.deepEqual(await run({...supplied, attested: [{unitId: 9, scopeId: 9, frame: "current", action: "contact", narrativePhase: "onset"}]}),
    failure("invalid-request", "request-shape"));
  assert.equal(calls, 1);

  for (const extra of [{previousId: 9}, {changeId: 10}, {changeId: 13}, {entryId: 11}, {previousId: null}]) {
    const invalid = provider(async () => response([{...row, sceneBoundary: {...sceneBoundary, ...extra}}]));
    assert.deepEqual(await invalid(supplied), rejected([targetFailure(12, "scene-boundary-evidence")]));
  }
  for (const [status, reason, contrast] of [["none", "none", "viewpoint-marker"], ["uncertain", "unclear", "insufficient-prefix"]]) {
    const verdict = {...row, sceneBoundary: {status, reason, contrast, previousId: null, changeId: null, entryId: null}};
    assert.deepEqual(await provider(async () => response([verdict]))(supplied), success([verdict]));
    const incompatible = provider(async () => response([{...verdict, sceneBoundary: {...verdict.sceneBoundary, contrast: "material-change"}}]));
    assert.deepEqual(await incompatible(supplied), rejected([targetFailure(12, "scene-boundary-shape")]));
  }
  assert.deepEqual(await provider(async () => response([{...row, transition: "onset"}]))(supplied),
    rejected([targetFailure(12, "scene-boundary-shape")]));
});

test("submits only typed discovery inputs and accepts complete rows in target order", async () => {
  const proposed = fact(11, {status: "candidate", depiction: "romantic", narrativePhase: "build", fact: "low",
    action: "anticipation", scopeId: 10, evidenceIds: [10, 11]});
  let sent;
  const run = provider(async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    sent = JSON.parse(options.body);
    return response([fact(12), proposed], {model: `${LUNA_PROTOCOL_MODEL}-2026-10-01`, usage: {
      input_tokens: 100, output_tokens: 70, total_tokens: 170,
      input_tokens_details: {cached_tokens: 30}, output_tokens_details: {reasoning_tokens: 10},
    }});
  });
  const result = await run({...request(), unrelated: "private metadata", candidates: [proposed]});
  assert.deepEqual(result, success([proposed, fact(12)], {inputTokens: 100, outputTokens: 70, totalTokens: 170,
    cachedInputTokens: 30, cacheWriteInputTokens: null, reasoningTokens: 10}, `${LUNA_PROTOCOL_MODEL}-2026-10-01`));
  assert.deepEqual(JSON.parse(sent.input), {units, targetIds: [11, 12]});
  assert.equal(sent.store, false);
  assert.equal(sent.truncation, "disabled");
  assert.deepEqual(sent.prompt_cache_options, {mode: "explicit"});
  assert.equal(sent.max_output_tokens, lunaProtocolOutputTokens(2));
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.text.format.schema.additionalProperties, false);
  const row = sent.text.format.schema.properties.facts.items;
  assert.equal(row.additionalProperties, false);
  assert.deepEqual(row.required.toSorted(), Object.keys(proposed).toSorted());
  assert.deepEqual(row.properties.depiction.enum, LUNA_PROTOCOL_ENUMS.depiction);
  assert.ok(row.properties.narrativePhase.enum.includes("rebuild"));
  assert.match(sent.instructions, /untrusted data/u);
  assert.match(sent.instructions, /Contact serving an ordinary purpose supplies no romantic cue, onset, accent or restart/u);
  assert.equal(JSON.stringify(result).includes(units[0].text), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("verification accepts only an independent single-target prefix and ignores candidate hints", async () => {
  const checked = fact(11, {status: "verified", depiction: "romantic", narrativePhase: "build", action: "anticipation",
    fact: "low", evidenceIds: [10, 11]});
  const supplied = {mode: "verify", units: units.slice(0, 2), targetIds: [11]};
  let calls = 0;
  const run = provider(async (_url, {body}) => {
    calls++;
    const sent = JSON.parse(body);
    assert.deepEqual(JSON.parse(sent.input), {units: supplied.units, targetIds: [11]});
    assert.match(sent.instructions, /prefix ends at that target/u);
    assert.deepEqual(sent.text.format.schema.properties.facts.items.properties.status.enum,
      ["verified", "neutral", "uncertain", "abstain"]);
    return response([checked]);
  });
  assert.deepEqual(await run({...supplied, candidates: [fact(11, {status: "candidate", evidenceIds: [12]})]}), success([checked]));
  assert.equal((await run(request("verify", [11]))).status, "invalid-request");
  assert.equal((await run(request("verify"))).status, "invalid-request");
  assert.equal((await run({...supplied, units: [units[0], units[2]], targetIds: [12]})).status, "invalid-request");
  assert.equal(calls, 1);
  for (const extra of [{evidenceIds: [10, 12]}, {status: "candidate"}, {scopeId: 12}, {priorAnchor: 12}]) {
    const invalid = provider(async () => response([{...checked, ...extra}]));
    assert.equal((await invalid(supplied)).status, "invalid-response");
  }
});

const cueCheck = {mode: "cue-check", units: units.slice(0, 2), targetIds: [11]};
const enactedRestart = fact(11, {status: "verified", depiction: "romantic", narrativePhase: "rebuild", action: "contact",
  transition: "restart", fact: "low", scopeId: 10, evidenceIds: [10, 11]});

test("checks one target with the full cue schema and no prior judgment", async () => {
  let sent;
  const run = provider(async (_url, {body}) => {
    sent = JSON.parse(body);
    return response([enactedRestart]);
  });
  const cueUnits = [{id: 10, text: "June and Lee stepped apart."}, {id: 11, text: "June drew Lee close again and took his hand."}];
  const result = await run({...cueCheck, units: cueUnits, candidates: [enactedRestart], priorVerdict: fact(11)});
  assert.deepEqual(result, success([enactedRestart]));
  assert.deepEqual(JSON.parse(sent.input), {units: cueUnits, targetIds: [11]});
  assert.match(sent.instructions, /nocturne-luna-protocol-v17/u);
  assert.match(sent.instructions, /No candidate or previous judgment is supplied/u);
  assert.match(sent.instructions, /Every verified row must cite the target/u);
  assert.match(sent.instructions, /Reciprocal buildup requires the target to show a response/u);
  assert.match(sent.instructions, /Mere politeness, small talk, shared logistics/u);
  assert.match(sent.instructions, /deliberate echo with a meaningful reaction, gesture, or specific shared desire/u);
  assert.match(sent.instructions, /visible invitation that advances an already mutually wanted immediate interaction/u);
  assert.match(sent.instructions, /isolated opening request to which nobody responds at the target stays quiet/u);
  assert.match(sent.instructions, /Use onset for the first actual act that begins the current interaction/u);
  assert.match(sent.instructions, /the first visible detail supplies no onset/u);
  assert.match(sent.instructions, /Use restart for the first renewed enacted action after a current stop, decline or break/u);
  assert.match(sent.instructions, /A later reciprocal response never supplies buildup to the earlier opening/u);
  assert.match(sent.instructions, /A specific private perception or bodily reaction grounded in attraction can be buildup without a reply/u);
  assert.match(sent.instructions, /Mark that unit onset or restart even if the next unit describes the action more fully/u);
  assert.match(sent.instructions, /Group connected steps that carry out the same immediate invitation or goal/u);
  assert.equal(sent.text.format.name, "nocturne_luna_cue_check_v1");
  const rows = sent.text.format.schema.properties.facts;
  assert.equal(rows.maxItems, 1);
  assert.deepEqual(rows.items.required.toSorted(), Object.keys(enactedRestart).toSorted());
  assert.deepEqual(rows.items.properties.status.enum, ["verified", "neutral", "uncertain", "abstain"]);
  assert.deepEqual(await run({...cueCheck, units}), failure("invalid-request", "request-shape"));
  assert.deepEqual(await run({...cueCheck, targetIds: [10, 11]}), failure("invalid-request", "request-shape"));
});

test("focuses independent cue rechecks without transmitting a prior judgment or changing the row schema", async () => {
  let sent;
  let attempts = 0;
  const neutral = fact(11);
  const run = provider(async (_url, {body}) => {
    attempts++;
    sent = JSON.parse(body);
    return response([neutral]);
  });
  for (const [focus, instruction] of [
    ["buildup", /A general statement of excitement before the other person responds is quiet setup/u],
    ["enactment", /use fact continue, cite both units and name the earlier enacted unit as priorAnchor/u],
    ["restart-gate", /offering a hand and accepting the offer do not establish hand-holding/u],
    ["frame", /A sentence describing an event inside an established account remains in that account/u],
    ["continuity-boundary", /Verify the first supported boundary or an exact same-scope link/u],
  ]) {
    assert.deepEqual(await run({...cueCheck, focus, previous: {action: "contact"}}), success([neutral]));
    assert.match(sent.instructions, instruction);
    assert.deepEqual(JSON.parse(sent.input), {units: cueCheck.units, targetIds: cueCheck.targetIds});
    assert.equal(sent.text.format.name, "nocturne_luna_cue_check_v1");
  }
  for (const invalid of [{...cueCheck, focus: units[0].text}, {...cueCheck, focus: null}, {...cueCheck, focus: "toString"},
    {...cueCheck, mode: "verify", focus: "continuity-boundary"}]) {
    assert.deepEqual(await run(invalid), failure("invalid-request", "request-shape"));
  }
  assert.equal(attempts, 5);
});

test("requires present target evidence for activation and preserves no-cue and stop verdicts", async () => {
  const noCue = fact(11, {depiction: "explicit", frame: "reported"});
  const uncertain = fact(11, {status: "uncertain", frame: "uncertain", action: "unknown", narrativePhase: "unknown", transition: "unknown"});
  const stop = fact(11, {status: "verified", transition: "hard-stop", fact: "neutralize", evidenceIds: [11], action: "release"});
  for (const row of [noCue, uncertain, stop, {...stop, fact: "protective"}, {...stop, transition: "declined-restart"}]) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(cueCheck), success([row]));
  }
  for (const [row, reason] of [[{...enactedRestart, evidenceIds: [10]}, "target-evidence"],
    [{...enactedRestart, evidenceIds: [11, 12]}, "evidence-id"], [{...enactedRestart, status: "candidate"}, "status-mode"],
    [{...enactedRestart, action: "anticipation"}, "cue-action"], [{...enactedRestart, action: "continuation"}, "cue-action"],
    [{...enactedRestart, frame: "reported"}, "cue-action"],
    [{...noCue, narrativePhase: "build"}, "status-effect"], [{...uncertain, action: "contact"}, "status-effect"],
    [{...stop, narrativePhase: "build"}, "transition-fact"], [{...stop, fact: "low"}, "transition-fact"],
    [{...stop, transition: "non-romantic-activity-stop", fact: "protective"}, "transition-fact"]]) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(cueCheck), rejected([targetFailure(11, reason)]));
  }
  const refused = provider(async () => response([enactedRestart], {status: "incomplete", incomplete_details: {reason: "content_filter"}}));
  assert.deepEqual(await refused(cueCheck), failure("refused", "content-filter"));
});

const earlierAnchor = {unitId: 5, scopeId: 3, frame: "current", action: "contact", narrativePhase: "onset"};
const withAttested = {mode: "verify", units: units.slice(0, 2), targetIds: [11], attested: [earlierAnchor]};
const linked = fact(11, {status: "verified", narrativePhase: "sustain", action: "continuation", fact: "continue",
  scopeId: 3, priorAnchor: 5, evidenceIds: [5, 11]});

test("verification can cite an earlier attestation with direct evidence at the target", async () => {
  let sent;
  const run = provider(async (_url, {body}) => {
    sent = JSON.parse(body);
    return response([linked]);
  });
  const result = await run({...withAttested, candidates: [{text: "Unsupplied discovery prose"}]});
  assert.deepEqual(result, success([linked]));
  assert.deepEqual(JSON.parse(sent.input), {units: withAttested.units, targetIds: [11], attested: [earlierAnchor]});
  assert.match(sent.instructions, /independently verified earlier in this cleared run/u);
  assert.match(sent.instructions, /Do not infer present action, a new rise, eligibility/u);
  assert.deepEqual(Object.keys(JSON.parse(sent.input).attested[0]).toSorted(), Object.keys(earlierAnchor).toSorted());
});

test("the continuity recheck requires a cited link and keeps separately supported local action", async () => {
  const supplied = {...withAttested, mode: "cue-check", focus: "continuity-boundary"};
  const localAction = fact(11, {status: "verified", narrativePhase: "recover", action: "contact", evidenceIds: [11]});
  for (const row of [linked, localAction]) {
    const run = provider(async (_url, {body}) => {
      const {instructions} = JSON.parse(body);
      assert.match(instructions, /Cite the target and earlier link evidence when verifying continuity/u);
      assert.match(instructions, /If continuity is unresolved, omit the link and keep any independently supported target action/u);
      assert.match(instructions, /A stop or restriction takes priority over carry or renewed action/u);
      return response([row]);
    });
    assert.deepEqual(await run(supplied), success([row]));
  }
  const ungrounded = provider(async () => response([{...linked, evidenceIds: [11]}]));
  assert.deepEqual(await ungrounded(supplied), rejected([targetFailure(11, "attested-evidence")]));
});

test("rejects invalid attestation metadata before dispatch", async () => {
  const run = provider(async () => assert.fail("Invalid attestations must never dispatch."));
  for (const attested of [null, {}, [{...earlierAnchor, text: units[0].text}], [{...earlierAnchor, status: "candidate"}],
    [{...earlierAnchor, unitId: 10}], [{...earlierAnchor, unitId: 11}], [{...earlierAnchor, unitId: 12}],
    [{...earlierAnchor, unitId: -1}], [{...earlierAnchor, scopeId: 6}], [{...earlierAnchor, frame: "other"}],
    [{...earlierAnchor, action: "other"}], [{...earlierAnchor, narrativePhase: "other"}],
    [earlierAnchor, {...earlierAnchor, unitId: 4}], [earlierAnchor, earlierAnchor], Array(1),
    Array.from({length: LUNA_PROTOCOL_LIMITS.maxAttested + 1}, (_, id) => ({...earlierAnchor, unitId: id, scopeId: 0}))]) {
    assert.equal((await run({...withAttested, attested})).status, "invalid-request");
  }
  assert.equal((await run({...request(), attested: [earlierAnchor]})).status, "invalid-request");
});

test("attestations cannot supply a new cue, replace target evidence or import another scope", async () => {
  const extraAnchor = {...earlierAnchor, unitId: 8, scopeId: 7};
  const supplied = {...withAttested, attested: [earlierAnchor, extraAnchor]};
  for (const extra of [{evidenceIds: [5]}, {evidenceIds: [5, 10]}, {evidenceIds: [3, 5, 11]}, {evidenceIds: [5, 6, 11]},
    {evidenceIds: [5, 8, 11]}, {evidenceIds: [5, 12]}, {evidenceIds: [8, 11], priorAnchor: 8}, {priorAnchor: 10},
    {priorAnchor: null}, {scopeId: 7}, {scopeId: null}, {frame: "remembered"}, {fact: "low"}, {fact: "protective"}]) {
    const run = provider(async () => response([{...linked, ...extra}]));
    assert.equal((await run(supplied)).status, "invalid-response");
  }
  const ungrounded = provider(async () => response([linked]));
  assert.equal((await ungrounded({...withAttested, attested: [{...earlierAnchor, action: "none"}]})).status, "invalid-response");
  assert.equal((await ungrounded({...withAttested, attested: []})).status, "invalid-response");
  const localEvidence = {...linked, priorAnchor: 10, evidenceIds: [10, 11]};
  const crossFrame = provider(async () => response([localEvidence]));
  assert.equal((await crossFrame({...withAttested, attested: [{...earlierAnchor, frame: "remembered"}]})).status, "invalid-response");
});

test("preserves provider refusal on a request with an earlier attestation", async () => {
  let attempts = 0;
  const run = provider(async () => {
    attempts++;
    return response([linked], {status: "incomplete", incomplete_details: {reason: "content_filter"}});
  });
  assert.deepEqual(await run(withAttested), failure("refused", "content-filter"));
  assert.equal(attempts, 1);
});

const transitionRequest = {...withAttested, mode: "transition"};
const noSceneBoundary = {status: "none", reason: "none", previousId: null, entryId: null};
const transitionRow = (transition, fact, extra) => ({unitId: 11, frame: "current", transition, fact,
  scopeId: null, evidenceIds: [11], priorAnchor: null, status: "verified", sceneBoundary: noSceneBoundary, ...extra});
const normalizedTransitionRow = row => ({...row, depiction: "unknown", narrativePhase: "unknown", action: "unknown"});

test("the spend reserve covers the largest actual rubric, attestation and schema overhead", async () => {
  const observed = [];
  const run = provider(async (_url, {body}) => {
    const request = JSON.parse(body);
    observed.push(Buffer.byteLength(request.instructions) + Buffer.byteLength(JSON.stringify(request.text.format)));
    return new Response(null, {status: 500});
  });
  const focused = [undefined, "buildup", "enactment", "restart-gate", "frame", "continuity-boundary"]
    .map(focus => ({...withAttested, mode: "cue-check", focus}));
  for (const supplied of [request(), withAttested, transitionRequest, ...focused]) await run(supplied);
  assert.equal(observed.length, 9);
  assert.equal(lunaProtocolInputOverhead, Math.max(...observed) + 512);
});

test("sends an independent transition rubric with one compact typed row and no cue proposal", async () => {
  const eased = transitionRow("interruption", "ease", {scopeId: 3, evidenceIds: [5, 11], priorAnchor: 5});
  let sent;
  const run = provider(async (_url, {body}) => {
    sent = JSON.parse(body);
    return response([eased]);
  });
  const result = await run({...transitionRequest, candidates: [linked], cue: {narrativePhase: "peak"}});
  assert.deepEqual(result, success([normalizedTransitionRow(eased)]));
  assert.deepEqual(JSON.parse(sent.input), {units: transitionRequest.units, targetIds: [11], attested: [earlierAnchor]});
  assert.match(sent.instructions, /verify one typed narrative transition independently/u);
  assert.match(sent.instructions, /protective only when the target directly establishes an active restriction/u);
  assert.match(sent.instructions, /Ordinary movement stopping/iu);
  assert.match(sent.instructions, /Set frame to reported if the target enters the account/u);
  assert.match(sent.instructions, /Events within a recollection, imagined scene or report do not establish a transition/u);
  assert.match(sent.instructions, /An elapsed interval can make continuity unresolved even with the same people and place/u);
  assert.match(sent.instructions, /Ordinary dialogue or background detail within a continuous moment supplies no such boundary/u);
  assert.match(sent.instructions, /An earlier closing event is context only/u);
  assert.match(sent.instructions, /Contact serving an ordinary purpose supplies no romantic cue, onset, accent or restart/u);
  assert.match(sent.instructions, /final repetition or change in speed while the activity continues supplies no stop/u);
  assert.match(sent.instructions, /An unrelated object becoming still supplies no stop by itself/u);
  assert.match(sent.instructions, /Require the effect of the disruption as well as the trigger/u);
  assert.match(sent.instructions, /Use time-jump for a definite jump into a new episode, including one in the same location/u);
  assert.match(sent.instructions, /Identify what was underway in the old episode, what materially displaced it/u);
  assert.match(sent.instructions, /new speaker, ordinary movement between nearby places or next task step alone leaves the current scene in place/u);
  assert.match(sent.instructions, /previousId cites a strictly earlier supplied text unit/u);
  assert.match(sent.instructions, /A new episode can begin with an independently enacted onset or accent/u);
  assert.match(sent.instructions, /An imagined scenario starts when its events are first presented/u);
  assert.match(sent.instructions, /Ending the account and handling its source in the present can establish the return/u);
  assert.match(sent.instructions, /A task or stimulus within the imagined, remembered or reported episode leaves that frame in place/u);
  assert.match(sent.instructions, /Movement inside the noncurrent frame and a later reference after the return supply no additional return/u);
  assert.match(sent.instructions, /Use beat-end when the target establishes that the interaction itself concludes/u);
  assert.match(sent.instructions, /Choose one typed event and its matching fact separately from sceneBoundary/u);
  assert.match(sent.instructions, /use status uncertain or abstain with transition unknown/u);
  assert.match(sent.instructions, /reported or remembered action does not establish a prior current start/u);
  assert.match(sent.instructions, /If the target ends before participation begins, it has no restart/u);
  assert.match(sent.instructions, /For onset or restart use priorAnchor null/u);
  assert.match(sent.instructions, /Interior sentences in the same account have no entry, return, or live-interaction transition/u);
  const rows = sent.text.format.schema.properties.facts;
  assert.equal(rows.maxItems, 1);
  assert.equal(rows.items.additionalProperties, false);
  assert.deepEqual(rows.items.required.toSorted(), Object.keys(eased).toSorted());
  assert.equal(rows.items.properties.fact.enum.includes("low"), false);
  assert.equal(rows.items.properties.transition.enum.includes("scene-cut"), false);
  assert.deepEqual(rows.items.properties.sceneBoundary.required.toSorted(), Object.keys(noSceneBoundary).toSorted());
  assert.deepEqual(await run({...transitionRequest, units}), failure("invalid-request", "request-shape"));
  assert.deepEqual(await run({...transitionRequest, targetIds: [10, 11]}), failure("invalid-request", "request-shape"));
});

test("independently accepts a supported scene boundary with an onset or no local event", async () => {
  const sceneBoundary = {status: "cut", reason: "time-jump", previousId: 10, entryId: 11};
  const possible = {status: "uncertain", reason: "unclear", previousId: null, entryId: null};
  for (const row of [
    transitionRow("onset", "none", {sceneBoundary}),
    transitionRow("none", "none", {status: "neutral", evidenceIds: [], sceneBoundary}),
    transitionRow("accent", "none", {sceneBoundary: possible}),
    transitionRow("hard-stop", "protective", {sceneBoundary}),
  ]) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), success([normalizedTransitionRow(row)]));
  }
});

test("requires earlier supplied scene evidence and an exact new entry for any material cut", async () => {
  const sceneBoundary = {status: "cut", reason: "objective-shift", previousId: 10, entryId: 11};
  const row = transitionRow("accent", "none", {sceneBoundary});
  for (const [fact, reason] of [
    ...[{previousId: null}, {previousId: 5}, {previousId: 11}, {entryId: 10}, {entryId: 12}].map(change =>
      [{...row, sceneBoundary: {...sceneBoundary, ...change}}, "scene-boundary-evidence"]),
    [{...row, sceneBoundary: {...noSceneBoundary, previousId: 10}}, "scene-boundary-evidence"],
    [{...row, sceneBoundary: {...sceneBoundary, reason: "unclear"}}, "scene-boundary-shape"],
    [{...row, frame: "uncertain"}, "scene-boundary-shape"],
    [{...row, transition: "scene-cut", fact: "cut"}, "scene-boundary-event"],
    [{...row, sceneBoundary: undefined}, "row-shape"],
  ]) {
    const run = provider(async () => response([fact]));
    assert.deepEqual(await run(transitionRequest), rejected([targetFailure(11, reason)]));
  }
});

test("rejects conflicting typed events without guessing the intended boundary", async () => {
  const conflicting = transitionRow("beat-end", "ease", {scopeId: 10, priorAnchor: 10, evidenceIds: [10, 11]});
  const run = provider(async () => response([conflicting]));
  assert.deepEqual(await run(transitionRequest), rejected([targetFailure(11, "transition-fact")]));
});

test("keeps hard stops, interruptions, declined restarts and ordinary stops distinct", async () => {
  const noEvent = {status: "neutral", evidenceIds: []};
  const permitted = [transitionRow("hard-stop", "neutralize"), transitionRow("hard-stop", "protective"),
    transitionRow("interruption", "none"), transitionRow("declined-restart", "neutralize"), transitionRow("restart", "none"),
    transitionRow("non-romantic-activity-stop", "none"), transitionRow("reported-entry", "cut", {frame: "reported"}),
    transitionRow("non-romantic-activity-stop", "none", {frame: "neutral"}),
    transitionRow("present-return", "cut"), transitionRow("uncertain-continuity", "neutralize"), transitionRow("none", "none", noEvent),
    transitionRow("none", "none", {...noEvent, frame: "reported"}),
    transitionRow("unknown", "none", {...noEvent, status: "abstain", frame: "uncertain"})];
  for (const row of permitted) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), success([normalizedTransitionRow(row)]));
  }
  const invalid = [
    [transitionRow("hard-stop", "none"), "transition-fact"],
    [transitionRow("hard-stop", "protective", {evidenceIds: [10]}), "target-evidence"],
    [transitionRow("non-romantic-activity-stop", "protective"), "transition-fact"],
    [transitionRow("non-romantic-activity-stop", "neutralize"), "transition-fact"],
    [transitionRow("non-romantic-activity-stop", "none", {evidenceIds: [10]}), "target-evidence"],
    [transitionRow("non-romantic-activity-stop", "none", {frame: "reported"}), "transition-frame"],
    [transitionRow("declined-restart", "none"), "transition-fact"],
    [transitionRow("restart", "low"), "transition-fact"],
    [transitionRow("restart", "none", {evidenceIds: [10]}), "target-evidence"],
    [transitionRow("interruption", "ease", {scopeId: 3, evidenceIds: [5, 10], priorAnchor: 5}), "attested-evidence"],
    [transitionRow("reported-entry", "cut", {frame: "current"}), "transition-frame"],
    [transitionRow("present-return", "cut", {frame: "remembered"}), "transition-frame"],
    [transitionRow("span-end", "span-end", {frame: "reported"}), "transition-frame"],
    [transitionRow("uncertain-continuity", "neutralize", {evidenceIds: [10]}), "target-evidence"],
    [transitionRow("none", "none"), "transition-fact"],
    [transitionRow("unknown", "none", {...noEvent, status: "neutral"}), "status-effect"],
    [transitionRow("uncertain-continuity", "neutralize", {...noEvent, status: "uncertain"}), "status-effect"],
    [transitionRow("hard-stop", "neutralize", {evidenceIds: [11, 12]}), "evidence-id"],
    [transitionRow("restart", "none", {action: "contact"}), "row-shape"],
    [transitionRow("restart", "none", {status: "candidate"}), "status-mode"],
  ];
  for (const [row, reason] of invalid) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), rejectedTransition(row, reason));
  }
});

test("a malformed scene claim cannot discard a verified local stop or introduce a cut", async () => {
  for (const [event, effect] of [["hard-stop", "protective"], ["declined-restart", "neutralize"]]) {
    const row = transitionRow(event, effect, {sceneBoundary: {status: "cut", reason: "time-jump", previousId: 11, entryId: 11}});
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), {...success([normalizedTransitionRow({...row,
      sceneBoundary: {status: "uncertain", reason: "unclear", previousId: null, entryId: null}})]),
    targetNormalizations: [{unitId: 11, reason: "protective-scene-boundary-unresolved"}]});
  }
});

test("canonicalizes only benign no-event metadata after validating the response and exact prefix IDs", async () => {
  const neutral = transitionRow("none", "none", {status: "neutral", scopeId: 10, evidenceIds: [10, 11]});
  for (const row of [neutral, {...neutral, status: "uncertain"}, {...neutral, status: "abstain", transition: "unknown"}]) {
    const run = provider(async () => response([row]));
    const expected = normalizedTransitionRow({...row, transition: row.status === "neutral" ? "none" : "unknown",
      scopeId: null, evidenceIds: []});
    const reason = "canonical-no-event";
    assert.ok(LUNA_PROTOCOL_TARGET_NORMALIZATIONS.includes(reason));
    assert.deepEqual(await run(transitionRequest), {...success([expected]), targetNormalizations: [{unitId: 11, reason}]});
  }
  for (const [extra, reason] of [
    [{transition: "uncertain-continuity"}, "status-effect"], [{fact: "protective"}, "status-effect"],
    [{priorAnchor: 10}, "prior-anchor"], [{scopeId: 3}, "status-effect"], [{scopeId: 9}, "scope-id"],
    [{evidenceIds: [5, 11]}, "attested-evidence"], [{evidenceIds: [10, 12]}, "evidence-id"],
    [{evidenceIds: [11, 10]}, "evidence-id"], [{untyped: units[0].text}, "row-shape"],
  ]) {
    const row = {...neutral, ...extra};
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), rejectedTransition(row, reason));
  }
});

test("retains verified starts and their evidence when an in-prefix context ID is also named as an anchor", async () => {
  const reason = "start-context-anchor";
  assert.ok(LUNA_PROTOCOL_TARGET_NORMALIZATIONS.includes(reason));
  const valid = transitionRow("restart", "none", {scopeId: 10, priorAnchor: 10, evidenceIds: [10, 11]});
  for (const transition of ["onset", "restart"]) {
    const row = {...valid, transition};
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), {...success([normalizedTransitionRow({...row, priorAnchor: null})]),
      targetNormalizations: [{unitId: 11, reason}]});
  }
  for (const [extra, rejectedReason] of [
    [{priorAnchor: 9}, "prior-anchor"], [{priorAnchor: 11}, "prior-anchor"],
    [{priorAnchor: 5, evidenceIds: [5, 11]}, "attested-evidence"],
    [{evidenceIds: [11]}, "prior-anchor"], [{evidenceIds: [10]}, "prior-anchor"],
    [{frame: "reported"}, "prior-anchor"], [{fact: "cut"}, "prior-anchor"],
    [{status: "uncertain"}, "prior-anchor"], [{transition: "hard-stop", fact: "neutralize"}, "prior-anchor"],
  ]) {
    const run = provider(async () => response([{...valid, ...extra}]));
    assert.deepEqual(await run(transitionRequest), rejected([targetFailure(11, rejectedReason)]));
  }
});

test("repairs only a redundant cited earlier ID on a valid non-linking transition", async () => {
  const reason = "transition-context-anchor";
  const earlier = {scopeId: 11, priorAnchor: 10, evidenceIds: [10, 11]};
  for (const row of [transitionRow("chapter-end", "cut", earlier),
    transitionRow("imagined-entry", "cut", {...earlier, frame: "imagined"}),
    transitionRow("present-return", "cut", earlier), transitionRow("accent", "none", earlier),
    transitionRow("interruption", "none", earlier), transitionRow("non-romantic-activity-stop", "none", earlier)]) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), {...success([normalizedTransitionRow({...row, priorAnchor: null})]),
      targetNormalizations: [{unitId: 11, reason}]});
  }
  assert.ok(LUNA_PROTOCOL_TARGET_NORMALIZATIONS.includes(reason));
  const cut = transitionRow("chapter-end", "cut", earlier);
  for (const [row, expected] of [
    [{...cut, evidenceIds: [11]}, "prior-anchor"], [{...cut, evidenceIds: [10]}, "prior-anchor"],
    [{...cut, frame: "uncertain"}, "prior-anchor"], [{...cut, transition: "memory-entry"}, "prior-anchor"],
    [{...cut, fact: "none"}, "prior-anchor"], [{...cut, priorAnchor: 11}, "prior-anchor"],
    [{...cut, priorAnchor: 5, evidenceIds: [5, 11]}, "attested-evidence"],
    [transitionRow("hard-stop", "protective", earlier), "prior-anchor"],
    [transitionRow("declined-restart", "neutralize", earlier), "prior-anchor"],
    [transitionRow("uncertain-continuity", "neutralize", earlier), "prior-anchor"],
  ]) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), rejected([targetFailure(11, expected)]));
  }
  const linkedEase = transitionRow("ease", "ease", {...earlier, scopeId: 10});
  const protectiveStop = transitionRow("hard-stop", "protective");
  for (const row of [linkedEase, protectiveStop]) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), success([normalizedTransitionRow(row)]));
  }
});

test("accepts only validated discovery rows and diagnoses requested targets without returning prose", async () => {
  const row = fact(11, {status: "candidate", fact: "continue", scopeId: 10, priorAnchor: 10, evidenceIds: [10, 11]});
  const tail = fact(12);
  const unknownTarget = fact(123456, {quote: units[2].text});
  const cases = [
    [[row, tail], success([row, tail])],
    [[unknownTarget, tail, row], success([row, tail])],
    [[row], partial([row], [targetFailure(12, "missing-target")])],
    [[row, unknownTarget], partial([row], [targetFailure(12, "missing-target")])],
    [[row, {...tail, quote: units[2].text}], partial([row], [targetFailure(12, "row-shape")])],
    [[row, {...row, depiction: "romantic"}, tail], partial([tail], [targetFailure(11, "duplicate-target")])],
    [[row, row], rejected([targetFailure(11, "duplicate-target"), targetFailure(12, "missing-target")])],
    [[], rejected([targetFailure(11, "missing-target"), targetFailure(12, "missing-target")])],
  ];
  for (const [rows, expected] of cases) {
    const run = provider(async () => response(rows));
    assert.deepEqual(await run(request()), expected);
  }
  for (const [extra, reason] of [[{evidenceIds: [11, 10]}, "evidence-id"], [{evidenceIds: [10, 10]}, "evidence-id"],
    [{scopeId: 9}, "scope-id"], [{priorAnchor: 11}, "prior-anchor"], [{evidenceIds: [11]}, "prior-anchor"],
    [{status: "uncertain"}, "status-effect"], [{fact: "cut", evidenceIds: [10], priorAnchor: null}, "target-evidence"],
    [{fact: "low", evidenceIds: []}, "target-evidence"], [{depiction: units[0].text}, "row-enum"]]) {
    const run = provider(async () => response([{...row, ...extra}, tail]));
    assert.deepEqual(await run(request()), partial([tail], [targetFailure(11, reason)]));
    assert.ok(LUNA_PROTOCOL_TARGET_FAILURES.includes(reason));
  }
});

test("keeps single-target verification atomic when the provider returns extra or duplicate rows", async () => {
  const verified = fact(11, {status: "verified"});
  const verifyRequest = {mode: "verify", units: units.slice(0, 2), targetIds: [11]};
  for (const [rows, reason] of [[[verified, fact(12)], "unexpected-row"], [[verified, verified], "duplicate-target"],
    [[fact(12)], "missing-target"], [[], "missing-target"]]) {
    const run = provider(async () => response(rows));
    assert.deepEqual(await run(verifyRequest), rejected([targetFailure(11, reason)]));
  }
});

test("returns no partial rows from refusals, incomplete outputs or malformed envelopes", async () => {
  const row = fact(11), output = part => [{type: "message", role: "assistant", content: [part]}];
  const cases = [
    [response([row], {status: "incomplete", incomplete_details: {reason: "max_output_tokens"}}),
      failure("incomplete", "output-token-limit")],
    [response([row], {status: "incomplete", incomplete_details: {reason: "content_filter"}}), failure("refused", "content-filter")],
    [response([row], {output: output({type: "output_text", text: '{"facts":['})}), failure("invalid-response", "output-schema")],
    [response([row], {output: output({type: "output_text", text: JSON.stringify({facts: [row], note: units[0].text})})}),
      failure("invalid-response", "output-schema")],
  ];
  for (const [reply, expected] of cases) {
    const run = provider(async () => reply);
    assert.deepEqual(await run(request()), expected);
  }
});

test("keeps discovery-only suffix evidence provisional and retains no-proposal outcomes", async () => {
  const candidate = fact(11, {status: "candidate", depiction: "romantic", narrativePhase: "build", action: "anticipation",
    fact: "low", evidenceIds: [11, 12]});
  for (const status of ["neutral", "uncertain", "abstain"]) {
    const noProposal = fact(12, {status, depiction: "unknown", narrativePhase: status === "neutral" ? "quiet" : "unknown"});
    const run = provider(async () => response([candidate, noProposal]));
    assert.deepEqual(await run(request()), success([candidate, noProposal]));
  }
});

test("keeps local cue, continuity, frame and neutral decisions independently grounded", async () => {
  const supplied = {mode: "verify", units: units.slice(0, 2), targetIds: [11]};
  const build = fact(11, {status: "verified", narrativePhase: "build", action: "anticipation", evidenceIds: [10, 11]});
  const onset = {...build, narrativePhase: "onset", action: "contact", transition: "onset"};
  const neutral = fact(11, {depiction: "romantic"});
  const ordinaryStop = fact(11, {status: "verified", transition: "non-romantic-activity-stop", evidenceIds: [11]});
  const continuityGap = fact(11, {status: "verified", transition: "uncertain-continuity", fact: "neutralize", evidenceIds: [11]});
  const reportEntry = fact(11, {status: "verified", frame: "reported", transition: "reported-entry", fact: "cut", evidenceIds: [11]});
  for (const row of [build, onset, {...onset, transition: "restart", narrativePhase: "rebuild"},
    neutral, {...neutral, frame: "reported"}, ordinaryStop, continuityGap, reportEntry]) {
    const run = provider(async (_url, {body}) => {
      const {instructions} = JSON.parse(body);
      assert.match(instructions, /routine line in a live beat can be neutral/u);
      assert.match(instructions, /Use an input unit ID at or before the target, or null/u);
      return response([row]);
    });
    assert.deepEqual(await run(supplied), success([row]));
  }
  for (const [row, reason] of [
    [{...build, action: "none"}, "phase-action"], [{...build, evidenceIds: []}, "target-evidence"],
    [{...build, fact: "low", evidenceIds: [10]}, "target-evidence"], [{...build, fact: "low", frame: "reported"}, "fact-frame"],
    [{...build, fact: "low", action: "continuation"}, "fact-action"], [{...build, fact: "ease"}, "fact-phase"],
    [{...build, priorAnchor: 10}, "prior-anchor"], [{...build, transition: "restart"}, "transition-action"],
    [{...onset, action: "continuation"}, "phase-action"],
    [{...onset, evidenceIds: [10]}, "target-evidence"],
    [{...onset, frame: "reported"}, "transition-frame"],
    [{...onset, transition: "restart", narrativePhase: "rebuild", evidenceIds: [10]}, "target-evidence"],
    [{...onset, action: "continuation", narrativePhase: "rebuild", transition: "restart"}, "transition-action"],
    [{...onset, fact: "continue", scopeId: 10, priorAnchor: 10}, "transition-fact"],
    [{...build, status: "uncertain"}, "status-effect"], [{...neutral, narrativePhase: "unknown"}, "status-effect"],
    [{...ordinaryStop, status: "neutral"}, "status-effect"], [{...reportEntry, status: "neutral"}, "status-effect"],
    [{...ordinaryStop, evidenceIds: [10]}, "target-evidence"], [{...continuityGap, evidenceIds: [10]}, "target-evidence"],
    [{...reportEntry, fact: "span-end"}, "transition-fact"], [{...reportEntry, frame: "current"}, "transition-frame"],
    [{...reportEntry, evidenceIds: [10]}, "target-evidence"], [{...neutral, scopeId: 9}, "scope-id"],
  ]) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(supplied), rejected([targetFailure(11, reason)]));
    assert.ok(LUNA_PROTOCOL_TARGET_FAILURES.includes(reason));
  }
});

test("independent current contribution keeps ongoing and winding-down cues with target evidence", async () => {
  const supplied = {mode: "verify", units: units.slice(0, 2), targetIds: [11]};
  for (const [narrativePhase, action, factType] of [
    ["build", "anticipation", "none"], ["sustain", "continuation", "none"],
    ["ease", "release", "ease"], ["recover", "release", "none"],
    ["ease", "contact", "ease"], ["recover", "change", "none"],
  ]) {
    const row = fact(11, {status: "verified", depiction: "romantic", narrativePhase, action,
      fact: factType, evidenceIds: [10, 11]});
    const run = provider(async (_url, {body}) => {
      const {instructions} = JSON.parse(body);
      assert.match(instructions, /A new touch or a visible modification of the same interaction can be direct even while the beat continues/u);
      assert.match(instructions, /Use continuation when the target depicts only the same ongoing action/u);
      assert.match(instructions, /If an easing or recovery target also depicts a distinct newly enacted contact or change/u);
      assert.match(instructions, /A supported stop or restriction still takes priority/u);
      assert.match(instructions, /A target can show an easing or recovery cue without a new onset or typed event/u);
      return response([row]);
    });
    assert.deepEqual(await run(supplied), success([row]));
    const missingTarget = provider(async () => response([{...row, evidenceIds: [10]}]));
    assert.deepEqual(await missingTarget(supplied), rejected([targetFailure(11, "target-evidence")]));
  }
  const reportedStop = fact(11, {status: "verified", frame: "reported", transition: "non-romantic-activity-stop", evidenceIds: [11]});
  const noncurrent = provider(async () => response([reportedStop]));
  assert.deepEqual(await noncurrent(supplied), rejected([targetFailure(11, "transition-frame")]));
  const reportedDecline = fact(11, {status: "verified", frame: "reported", depiction: "romantic", narrativePhase: "ease",
    action: "release", fact: "ease", evidenceIds: [10, 11]});
  const crossedFrame = provider(async () => response([reportedDecline]));
  assert.deepEqual(await crossedFrame(supplied), rejected([targetFailure(11, "fact-frame")]));
});

test("bounds source and request tokens before transport", async () => {
  const run = provider(async () => assert.fail("Invalid requests must never dispatch."));
  const manyUnits = Array.from({length: LUNA_PROTOCOL_LIMITS.maxUnits + 1}, (_, id) => ({id, text: "A."}));
  const wideUnits = Array.from({length: 7}, (_, id) => ({id, text: "z".repeat(20_000)}));
  const encodedUnits = Array.from({length: 6}, (_, id) => ({id, text: "\\".repeat(20_000)}));
  for (const invalid of [null, {...request(), mode: "toString"}, {...request(), targetIds: [11, 11]},
    {...request(), targetIds: [11, 13]}, {...request(), units: manyUnits}, {...request(), units: wideUnits, targetIds: [0]},
    {...request(), units: encodedUnits, targetIds: [0]}, {...request(), units: [{id: 10, text: "\ud800"}], targetIds: [10]},
    {...request(), units: [{id: 10, text: "yes", secret}], targetIds: [10]},
    {...request(), units: [{id: 10, text: "é".repeat(LUNA_PROTOCOL_LIMITS.maxUnitBytes)}], targetIds: [10]}]) {
    assert.equal((await run(invalid)).status, "invalid-request");
  }
  assert.ok(lunaProtocolOutputTokens(40) > lunaProtocolOutputTokens(1));
  assert.throws(() => lunaProtocolOutputTokens(0), RangeError);
  assert.throws(() => lunaProtocolOutputTokens(LUNA_PROTOCOL_LIMITS.maxTargets + 1), RangeError);
});

test("distinguishes refusals, incomplete results, terminal HTTP errors and transient failures", async () => {
  const providerProse = "Private provider diagnostic with example source.";
  const cases = [
    [() => response([], {output: [{type: "message", role: "assistant", content: [{type: "refusal", refusal: providerProse}]}]}),
      "refused", "provider-refusal"],
    [() => Response.json({error: {code: "content_policy_violation", message: providerProse}}, {status: 400}), "refused", "content-filter"],
    [() => response([], {status: "incomplete", incomplete_details: {reason: "content_filter"}}), "refused", "content-filter"],
    [() => response([], {status: "incomplete", incomplete_details: {reason: "max_output_tokens"}}), "incomplete", "output-token-limit"],
    [() => response([], {status: "incomplete", incomplete_details: {reason: providerProse}}), "incomplete", "provider-incomplete"],
    [() => Response.json({error: {code: "invalid_json_schema", message: providerProse}}, {status: 400}), "failed", "http-schema"],
    [() => Response.json({error: {code: "insufficient_quota", message: providerProse}}, {status: 429}), "failed", "http-quota"],
    [() => Response.json({error: {code: "rate_limit_exceeded", message: providerProse}}, {status: 429}), "transient", "http-rate-limit"],
    [() => new Response(providerProse, {status: 503}), "transient", "http-server"],
    [() => new Response(providerProse, {status: 401}), "failed", "http-auth"],
    [() => new Response(providerProse, {status: 307}), "failed", "http-redirect"],
    [() => { throw new Error(providerProse); }, "transient", "transport"],
  ];
  for (const [reply, status, failureReason] of cases) {
    const run = provider(async () => reply());
    const result = await run(request());
    assert.deepEqual(result, failure(status, failureReason));
    assert.ok(LUNA_PROTOCOL_FAILURE_REASONS.includes(result.failureReason));
  }
});

test("rejects malformed envelopes and keeps only valid usage counts", async () => {
  const rows = [fact(11), fact(12)];
  for (const fields of [{model: "different-model"}, {output: [{type: "message", role: "user", content: []}]},
    {output: [{type: "function_call"}]}, {output: []}]) {
    const run = provider(async () => response(rows, fields));
    assert.equal((await run(request())).status, "invalid-response");
  }
  const invalidUsage = provider(async () => response(rows, {usage: {input_tokens: 3, output_tokens: 4, total_tokens: 8}}));
  assert.deepEqual(await invalidUsage(request()), success(rows));
});

test("bounds provider body reads and cancels an oversized stream", async () => {
  let cancelled = false;
  const run = provider(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1_000_001)); },
    cancel() { cancelled = true; },
  })));
  assert.deepEqual(await run(request()), failure("invalid-response", "response-body"));
  assert.equal(cancelled, true);
});

test("reports cancellation and timeout without waiting for a stalled transport", async () => {
  const controller = new AbortController();
  let start;
  const entered = new Promise(resolve => { start = resolve; });
  const run = provider(async () => { start(); return new Promise(() => {}); });
  const pending = run(request(), {signal: controller.signal});
  await entered;
  controller.abort();
  assert.deepEqual(await pending, failure("cancelled", "caller-cancelled"));
  assert.deepEqual(await run(request(), {signal: controller.signal}), failure("cancelled", "caller-cancelled"));

  const timeout = provider(() => new Promise(resolve => setTimeout(resolve, 20)), {timeoutMs: 1});
  assert.deepEqual(await timeout(request()), failure("timed-out", "request-timeout"));
});
