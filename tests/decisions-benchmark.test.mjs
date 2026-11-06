import assert from "node:assert/strict";
import test from "node:test";
import {DECISIONS_BENCHMARK_REQUESTS, runDecisionsBenchmark} from "../deploy/cloudflare/decisions-benchmark.mjs";

const key = "sk-test-fixture-abc123";
const model = "gpt-6-luna";
const beat = (id, phase) => ({first: id, last: id, phase, category: phase === "boundary" ? "neutral" : "romance",
  emphasis: phase === "boundary" ? 0 : 1, evidence: [id]});
const expected = units => units.length === 7 ? {positives: [2, 3, 4], boundaries: [5]} : {positives: [3, 4, 5], boundaries: [2]};
const inFixture = (label, id) => label.boundaries.includes(id) ? "boundary" : label.positives.includes(id) ? "build" : "quiet";

function responses(body) {
  const {units} = JSON.parse(body.input);
  const label = expected(units);
  const scenes = units.map(({id}) => {
    const phase = inFixture(label, id);
    return {first: id, last: id, frame: "current", beats: phase === "quiet" ? [] : [beat(id, phase)]};
  });
  return Response.json({status: "completed", usage: {input_tokens: 100, output_tokens: 20},
    output: [{type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({scenes})}]}]});
}

function decisions(body, refusedName) {
  const {units} = body.input[1].content[0].data;
  const label = expected(units);
  const answers = body.questions.map(({name}) => {
    if (name === refusedName) return {type: "refusal", name, privateProviderMetadata: "provider-refusal-detail"};
    const [, id, field] = /^u(\d+)-(frame|phase|category)$/.exec(name);
    const phase = inFixture(label, Number(id));
    const choice = field === "frame" ? "current" : field === "phase" ? phase : phase === "build" ? "romance" : "neutral";
    return {type: "choice", name, choice, confidence: 1, probabilities: [{value: choice, probability: 1}]};
  });
  return Response.json({model, usage: {input_tokens: 80, output_tokens: 0, total_tokens: 80}, answers});
}

test("the fixed benchmark runs one matched call per endpoint and fixture", async () => {
  const requests = [], inputs = new Map();
  const result = await runDecisionsBenchmark({key, text: "untrusted-caller-text", analysisFetcher: (url, options) => {
    assert.match(url, /^https:\/\/api\.openai\.com\/v1\/(responses|decisions)$/);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.headers["Cache-Control"], "no-store");
    assert.doesNotMatch(options.body, /untrusted-caller-text|sk-test-fixture/);
    const body = JSON.parse(options.body);
    assert.equal(body.model, model);
    const endpoint = url.split("/").at(-1);
    if (endpoint === "responses") assert.equal(body.store, false);
    assert.deepEqual(body.prompt_cache_options, {mode: "explicit"});
    const {units} = endpoint === "responses" ? JSON.parse(body.input) : body.input[1].content[0].data;
    assert.equal(units.length === 6 || units.length === 7, true);
    const prior = inputs.get(units.length);
    if (prior) assert.deepEqual(prior, units);
    else inputs.set(units.length, units);
    requests.push(endpoint);
    return endpoint === "responses" ? responses(body) : decisions(body);
  }});
  assert.equal(DECISIONS_BENCHMARK_REQUESTS, 4);
  assert.deepEqual(requests, ["responses", "decisions", "decisions", "responses"]);
  assert.equal(result.fixtureCount, 2);
  for (const arm of Object.values(result.totals)) {
    assert.equal(arm.calls, 2);
    assert.equal(arm.validMaps, 2);
    assert.equal(arm.sourceUnits, 13);
    assert.equal(arm.mappedUnits, 13);
    assert.equal(arm.mappedCoverage, 1);
    assert.deepEqual(arm.sentenceCues, {found: 6, missed: 0, false: 0, precision: 1, recall: 1});
    assert.deepEqual(arm.sentenceBoundaries, {found: 2, missed: 0, false: 0, precision: 1, recall: 1});
    assert.equal(arm.latencyMs.samples, 2);
    assert.ok(arm.latencyMs.p95 >= arm.latencyMs.p50);
  }
  assert.deepEqual(result.totals.responses.usage.outputTokens, {reportedCalls: 2, total: 40});
  assert.deepEqual(result.totals.decisions.usage.outputTokens, {reportedCalls: 2, total: 0});
  assert.deepEqual(result.totals.decisions.usage.cachedInputTokens, {reportedCalls: 0, total: null});
  assert.doesNotMatch(JSON.stringify(result), /sk-test-fixture|Sam|Mari|Authorization|untrusted-caller-text/);
});

test("missing and refused results remain in the score denominator without leaking provider text", async () => {
  const result = await runDecisionsBenchmark({key, analysisFetcher: (url, {body}) => {
    if (url.endsWith("/responses")) return new Response("private-response-error-detail", {status: 429});
    return decisions(JSON.parse(body), "u4-frame");
  }});
  const {responses, decisions: decisionsResult} = result.totals;
  assert.equal(responses.validMaps, 0);
  assert.equal(responses.mappedCoverage, 0);
  assert.deepEqual(responses.sentenceCues, {found: 0, missed: 6, false: 0, precision: null, recall: 0});
  assert.deepEqual(responses.usage.inputTokens, {reportedCalls: 0, total: null});
  assert.equal(decisionsResult.answerCounts.refusedUnits, 2);
  assert.equal(decisionsResult.mappedUnits, 11);
  assert.equal(decisionsResult.sentenceCues.found, 4);
  assert.equal(decisionsResult.sentenceCues.missed, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-response-error-detail|provider-refusal-detail/);
});

test("an aborted benchmark starts no further requests and publishes no late map", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await runDecisionsBenchmark({key, signal: controller.signal, analysisFetcher: (_, {body}) => {
    calls++;
    controller.abort();
    return responses(JSON.parse(body));
  }});
  assert.equal(calls, 1);
  assert.equal(result.aborted, true);
  assert.equal(result.totals.responses.validMaps, 0);
  assert.equal(result.totals.decisions.calls, 0);
  assert.equal(result.totals.decisions.sentenceCues.missed, 6);
});
