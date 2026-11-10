import assert from "node:assert/strict";
import test from "node:test";
import {createLunaProtocolProvider, LUNA_PROTOCOL_ENUMS, LUNA_PROTOCOL_FAILURE_REASONS, LUNA_PROTOCOL_LIMITS, LUNA_PROTOCOL_MODEL,
  lunaProtocolOutputTokens} from "../scripts/lib/luna-protocol-provider.mjs";

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

test("submits only typed discovery inputs and accepts complete rows in target order", async () => {
  const proposed = fact(11, {status: "candidate", depiction: "romantic", narrativePhase: "build", fact: "low",
    scopeId: 10, evidenceIds: [10, 11]});
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
  assert.equal(JSON.stringify(result).includes(units[0].text), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("verification accepts only an independent single-target prefix and ignores candidate hints", async () => {
  const checked = fact(11, {status: "verified", depiction: "romantic", narrativePhase: "build", fact: "low", evidenceIds: [10, 11]});
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
const transitionRow = (transition, fact, extra) => ({unitId: 11, frame: "current", transition, fact,
  scopeId: null, evidenceIds: [11], priorAnchor: null, status: "verified", ...extra});
const normalizedTransitionRow = row => ({...row, depiction: "unknown", narrativePhase: "unknown", action: "unknown"});

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
  const rows = sent.text.format.schema.properties.facts;
  assert.equal(rows.maxItems, 1);
  assert.equal(rows.items.additionalProperties, false);
  assert.deepEqual(rows.items.required.toSorted(), Object.keys(eased).toSorted());
  assert.equal(rows.items.properties.fact.enum.includes("low"), false);
  assert.deepEqual(await run({...transitionRequest, units}), failure("invalid-request", "request-shape"));
  assert.deepEqual(await run({...transitionRequest, targetIds: [10, 11]}), failure("invalid-request", "request-shape"));
});

test("keeps hard stops, interruptions, declined restarts and ordinary stops distinct", async () => {
  const noEvent = {status: "neutral", evidenceIds: []};
  const permitted = [transitionRow("hard-stop", "neutralize"), transitionRow("hard-stop", "protective"),
    transitionRow("interruption", "none"), transitionRow("declined-restart", "neutralize"), transitionRow("restart", "none"),
    transitionRow("non-romantic-activity-stop", "none"), transitionRow("reported-entry", "cut", {frame: "reported"}),
    transitionRow("present-return", "cut"), transitionRow("uncertain-continuity", "neutralize"), transitionRow("none", "none", noEvent),
    transitionRow("unknown", "none", {...noEvent, status: "abstain", frame: "uncertain"})];
  for (const row of permitted) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), success([normalizedTransitionRow(row)]));
  }
  const invalid = [transitionRow("hard-stop", "none"), transitionRow("hard-stop", "protective", {evidenceIds: [10]}),
    transitionRow("non-romantic-activity-stop", "protective"), transitionRow("non-romantic-activity-stop", "neutralize"),
    transitionRow("declined-restart", "none"), transitionRow("restart", "low"), transitionRow("restart", "none", {evidenceIds: [10]}),
    transitionRow("interruption", "ease", {scopeId: 3, evidenceIds: [5, 10], priorAnchor: 5}),
    transitionRow("reported-entry", "cut", {frame: "current"}), transitionRow("present-return", "cut", {frame: "remembered"}),
    transitionRow("none", "none"), transitionRow("none", "none", {status: "neutral"}),
    transitionRow("uncertain-continuity", "neutralize", {...noEvent, status: "uncertain"}),
    transitionRow("hard-stop", "neutralize", {evidenceIds: [11, 12]}), transitionRow("restart", "none", {action: "contact"})];
  for (const row of invalid) {
    const run = provider(async () => response([row]));
    assert.deepEqual(await run(transitionRequest), failure("invalid-response", "output-schema"));
  }
});

test("rejects missing, duplicate, source-bearing, fabricated and noncausal rows", async () => {
  const row = fact(11, {status: "candidate", fact: "continue", scopeId: 10, priorAnchor: 10, evidenceIds: [10, 11]});
  const tail = fact(12);
  const valid = provider(async () => response([row, tail]));
  assert.equal((await valid(request())).status, "ok");
  for (const rows of [[row], [row, row], [row, fact(13)], [row, {...tail, quote: units[2].text}],
    [{...row, evidenceIds: [11, 10]}, tail], [{...row, evidenceIds: [10, 10]}, tail], [{...row, scopeId: 9}, tail],
    [{...row, priorAnchor: 11}, tail], [{...row, evidenceIds: [11]}, tail], [{...row, status: "uncertain"}, tail],
    [{...row, fact: "cut", evidenceIds: [10]}, tail], [{...row, fact: "low", evidenceIds: []}, tail]]) {
    const run = provider(async () => response(rows));
    assert.deepEqual(await run(request()), failure("invalid-response", "output-schema"));
  }
});

test("keeps discovery-only suffix evidence provisional and retains no-proposal outcomes", async () => {
  const candidate = fact(11, {status: "candidate", depiction: "romantic", narrativePhase: "build", fact: "low", evidenceIds: [11, 12]});
  for (const status of ["neutral", "uncertain", "abstain"]) {
    const noProposal = fact(12, {status, depiction: "unknown", narrativePhase: "unknown"});
    const run = provider(async () => response([candidate, noProposal]));
    assert.deepEqual(await run(request()), success([candidate, noProposal]));
  }
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
