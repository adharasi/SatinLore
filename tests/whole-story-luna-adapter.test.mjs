import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {WHOLE_STORY_SEGMENTATION_VERSION} from "../scripts/lib/whole-story-context-planning.mjs";
import {createWholeStoryLunaRequest, WHOLE_STORY_LUNA_MODEL, wholeStoryLunaOutputTokens}
  from "../scripts/lib/whole-story-luna-adapter.mjs";

const neutralText = "A lamp was lit.";
const sourceDigest = text => createHash("sha256").update(text, "utf8").digest("hex");
const ignoredProviderText = "Unexpected provider prose.";
const unit = (id, text = neutralText) => ({id, text});
const normalWindow = (targetIds, contextIds = [], extra = {}) =>
  windowOf({units: [...contextIds, ...targetIds].map(id => unit(id)), targetIds, ...extra}, contextIds);
function windowOf({text, units, targetIds, paragraphs}, contextIds = []) {
  const runId = 0;
  const source = text ?? units.map(unit => unit.text).join("");
  const body = JSON.stringify({editionDigest: sourceDigest(source), segmentationVersion: WHOLE_STORY_SEGMENTATION_VERSION,
    runId, units, targetIds, ...(text === undefined ? {} : {text}), ...(paragraphs === undefined ? {} : {paragraphs})});
  return {runId, targetIds, contextIds, body, sourceBytes: Buffer.byteLength(source), bodyBytes: Buffer.byteLength(body)};
}

const neutral = (id, fields = {}) => ({id, status: "classified", depiction: "neutral", frame: "current", action: "none",
  phase: "quiet", transition: "none", evidenceIds: [], ...fields});
const active = (id, fields = {}) => neutral(id, {depiction: "romantic", action: "contact", phase: "onset", evidenceIds: [id], ...fields});
const response = (annotations, fields = {}) => Response.json({model: WHOLE_STORY_LUNA_MODEL, status: "completed",
  output: [{type: "reasoning"}, {type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({annotations})}]}],
  ...fields});
const mock = (fetchImpl, options = {}) => createWholeStoryLunaRequest({apiKey: "test-key", fetchImpl, ...options});

test("sends a pinned, stateless and cache-disabled structured request, then records only bounded usage", async () => {
  const recorded = [], reservations = [];
  const supplied = normalWindow([1, 2], [0]);
  const request = mock(async (url, {method, headers, redirect, cache, body}) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(method, "POST");
    assert.equal(redirect, "manual");
    assert.equal(cache, "no-store");
    assert.deepEqual(headers, {Authorization: "Bearer test-key", "Content-Type": "application/json", "Cache-Control": "no-store"});
    const parsed = JSON.parse(body);
    assert.equal(parsed.model, "gpt-6-luna");
    assert.equal(parsed.store, false);
    assert.equal(parsed.truncation, "disabled");
    assert.deepEqual(parsed.prompt_cache_options, {mode: "explicit"});
    assert.deepEqual(Object.keys(parsed).sort(), ["input", "instructions", "max_output_tokens", "model", "prompt_cache_options",
      "reasoning", "store", "text", "truncation"]);
    assert.equal(parsed.text.format.strict, true);
    assert.equal(parsed.text.format.schema.additionalProperties, false);
    const fields = parsed.text.format.schema.properties.annotations.items.properties;
    assert.deepEqual(fields.phase.enum, ["quiet", "build", "onset", "sustain", "accent", "ease", "recover", "restart", "unknown"]);
    assert.deepEqual(JSON.parse(parsed.input), {units: [unit(0), unit(1), unit(2)], targetIds: [1, 2]});
    assert.deepEqual(reservations, [{inputBytes: Buffer.byteLength(body), maxOutputTokens: parsed.max_output_tokens,
      attempt: 1, mode: "discovery"}]);
    return response([neutral(2, {frame: "reported", depiction: "graphic", action: "contact"}), active(1)], {
      model: "gpt-6-luna-2026-10-01", usage: {input_tokens: 90, output_tokens: 10, total_tokens: 100,
        input_tokens_details: {cached_tokens: 0, cache_write_tokens: 1}, output_tokens_details: {reasoning_tokens: 2}},
    });
  }, {beforeAttempt: budget => { reservations.push(budget); return true; }, onAttempt: event => recorded.push(event)});
  const result = await request(supplied);
  assert.equal(result.status, "annotated");
  assert.deepEqual(result.annotations, [active(1), neutral(2, {frame: "reported", depiction: "graphic", action: "contact"})]);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].dispatched, true);
  assert.equal(recorded[0].returnedModel, "gpt-6-luna-2026-10-01");
  assert.deepEqual(recorded[0].usage, {inputTokens: 90, outputTokens: 10, cachedInputTokens: 0, cacheWriteInputTokens: 1, reasoningTokens: 2});
  assert.equal(JSON.stringify(recorded).includes(neutralText), false);
  assert.equal(JSON.stringify(recorded).includes("test-key"), false);
});

test("verified requests accept one contiguous causal prefix and reject future text and citations", async () => {
  const calls = [], traces = [];
  const request = mock(async (_url, {body}) => {
    const {input, instructions} = JSON.parse(body);
    calls.push(JSON.parse(input));
    assert.match(instructions, /prefix ends at that target/u);
    return response([active(1, {evidenceIds: calls.length === 1 ? [0, 1] : [1, 2]})]);
  }, {mode: "verified", onAttempt: event => traces.push(event)});
  assert.equal((await request(normalWindow([1], [0]))).status, "annotated");
  assert.deepEqual(calls, [{units: [unit(0), unit(1)], targetIds: [1]}]);
  assert.equal((await request(normalWindow([1], [0]))).status, "failed");
  assert.equal((await request(normalWindow([1, 2], [0]))).status, "failed");
  assert.equal((await request(normalWindow([2], [0]))).status, "failed");
  assert.equal((await request(normalWindow([1], [0], {units: [unit(0), unit(1), unit(2)]}))).status, "failed");
  assert.equal((await request(normalWindow([1], [0], {paragraphs: [{id: 0, unitIds: [0, 1]}]}))).status, "failed");
  assert.equal(calls.length, 2);
  assert.deepEqual(traces.map(({dispatched, result}) => [dispatched, result]), [[true, "annotated"],
    [true, "invalid-response"], [false, "invalid-window"], [false, "invalid-window"], [false, "invalid-window"], [false, "invalid-window"]]);
});

test("discovery uses the same rubric across representations and accepts a bounded full edition larger than a regular window", async () => {
  const calls = [];
  const request = mock(async (_url, {body}) => {
    const parsed = JSON.parse(body), input = JSON.parse(parsed.input);
    calls.push({input, instructions: parsed.instructions, format: parsed.text.format, outputLimit: parsed.max_output_tokens});
    return response(input.targetIds.map(id => neutral(id)));
  }, {maxOutputTokens: 128_000});
  const sentence = "A lamp was lit. ".repeat(14).trim(), units = [], targetIds = [];
  let text = "";
  for (let id = 0; id < 60; id++) {
    const byteStart = Buffer.byteLength(text);
    text += sentence;
    units.push({id, byteStart, byteEnd: Buffer.byteLength(text)});
    targetIds.push(id);
    text += "\n\n";
  }
  assert.ok(Buffer.byteLength(text) > 12_000);
  assert.equal((await request(windowOf({text, units, targetIds}))).status, "annotated");
  assert.equal((await request(normalWindow([0, 1], [], {paragraphs: [{id: 0, unitIds: [0, 1]}]}))).status, "annotated");
  assert.equal((await request(normalWindow(targetIds))).status, "failed");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].input, {text, units, targetIds});
  assert.deepEqual(calls[1].input.paragraphs, [{id: 0, unitIds: [0, 1]}]);
  assert.equal(calls[0].instructions, calls[1].instructions);
  assert.deepEqual(calls[0].format, calls[1].format);
  assert.equal(calls[0].outputLimit, wholeStoryLunaOutputTokens(60, 128_000));
  assert.equal(wholeStoryLunaOutputTokens(1200, 128_000), 128_000);
});

test("strict output rejects incomplete coverage, prose, ungrounded or inconsistent labels, and model drift", async () => {
  const invalid = [
    [neutral(0)], [neutral(0), neutral(0)], [neutral(0), neutral(9)], [neutral(0), {...active(1), prose: ignoredProviderText}],
    [neutral(0), active(1, {frame: "mixed"})], [neutral(0), active(1, {action: "anticipation"})],
    [neutral(0), active(1, {evidenceIds: []})], [neutral(0), active(1, {evidenceIds: [2]})],
    [neutral(0), active(1, {evidenceIds: [1, 1]})], [neutral(0), active(1, {transition: "stop"})],
    [neutral(0), neutral(1, {transition: "stop", evidenceIds: [0]})], [neutral(0), neutral(1, {phase: "unknown"})],
    [neutral(0), active(1, {status: "abstain"})],
  ];
  for (const annotations of invalid) {
    assert.deepEqual(await mock(() => response(annotations))(normalWindow([0, 1])), {status: "failed"});
  }
  const valid = [neutral(0, {status: "abstain", depiction: "romantic", frame: "uncertain", action: "unknown",
    phase: "unknown", transition: "unknown"}), neutral(1, {transition: "stop", evidenceIds: [1]})];
  const drift = mock(() => response(valid, {model: ignoredProviderText}));
  assert.deepEqual(await drift(normalWindow([0, 1])), {status: "failed"});
  assert.deepEqual(await mock(() => response(valid))(normalWindow([0, 1])), {status: "annotated", annotations: valid});
});

test("refusals and incomplete failures are terminal and provider text never reaches results or attempt reports", async () => {
  const cases = [
    [() => Response.json({status: "completed", output: [{type: "message", role: "assistant",
      content: [{type: "refusal", refusal: ignoredProviderText}]}]}), "refused", "refused"],
    [() => Response.json({status: "incomplete", incomplete_details: {reason: "content_filter"}}), "refused", "refused"],
    [() => Response.json({error: {code: "content_policy_violation", message: ignoredProviderText}}, {status: 400}), "refused", "refused"],
    [() => Response.json({status: "incomplete", incomplete_details: {reason: "max_output_tokens"}}), "failed", "incomplete"],
    [() => Response.json({error: {code: "rate_limit_exceeded", message: ignoredProviderText}}, {status: 429}), "failed", "http-error"],
    [() => new Response(ignoredProviderText, {status: 503}), "failed", "http-error"],
    [() => { throw new Error(ignoredProviderText); }, "failed", "network-error"],
  ];
  for (const [provider, expected, outcome] of cases) {
    const traces = [];
    let attempts = 0;
    const request = mock(() => { attempts++; return provider(); }, {onAttempt: event => traces.push(event)});
    const actual = await request(normalWindow([0]));
    assert.deepEqual(actual, {status: expected});
    assert.equal(attempts, 1);
    assert.equal(traces[0].result, outcome);
    assert.equal(JSON.stringify(traces).includes(ignoredProviderText), false);
  }
});

test("pre-dispatch budget and cancellation prevent requests, and in-flight cancellation ignores late mock responses", async () => {
  const traces = [];
  const denied = mock(() => assert.fail("Should not dispatch."), {beforeAttempt: () => false, onAttempt: event => traces.push(event)});
  assert.deepEqual(await denied(normalWindow([0])), {status: "failed"});
  assert.deepEqual(await denied(normalWindow([0]), {signal: AbortSignal.abort()}), {status: "failed"});
  assert.deepEqual(traces.map(({result, dispatched}) => [result, dispatched]), [["budget-deferred", false], ["cancelled", false]]);

  const controller = new AbortController();
  let finish;
  const running = mock(() => new Promise(resolve => { finish = resolve; }), {onAttempt: event => traces.push(event)});
  const promise = running(normalWindow([0]), {signal: controller.signal});
  controller.abort();
  assert.deepEqual(await promise, {status: "failed"});
  assert.equal(traces.at(-1).result, "cancelled");
  assert.equal(traces.at(-1).dispatched, true);
  finish(response([neutral(0)]));
});
