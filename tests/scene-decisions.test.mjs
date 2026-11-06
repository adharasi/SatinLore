import assert from "node:assert/strict";
import test from "node:test";
import {buildSceneUnits, compileSceneMap} from "../app/static/reader/scene-map.mjs";
import {analyzeNocturneDecisions} from "../deploy/cloudflare/scene-decisions.mjs";

const usage = {input_tokens: 90, output_tokens: 12, total_tokens: 102,
  input_tokens_details: {cached_tokens: 0, cache_write_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}};
const neutral = {frame: "neutral", phase: "quiet", category: "neutral"};
const cue = {frame: "current", phase: "build", category: "romance"};
const answer = (name, choice) => choice === null ? {name, type: "refusal"} :
  {name, type: "choice", choice, confidence: 0.85, probabilities: [{value: choice, probability: 0.85}]};
function payload(request, labels = {}) {
  return {model: "gpt-6-luna", usage, answers: request.questions.map(({name}) => {
    const [, id, field] = /^u(\d+)-(frame|phase|category)$/u.exec(name);
    const label = labels[id] ?? neutral;
    return answer(name, label[field]);
  })};
}

test("Decisions sends only explicitly approved source, uses named choices and disables prompt caching", async () => {
  const units = buildSceneUnits(["They shared a smile.", "Private excluded text.", "***", "They talked over dinner."]);
  const result = await analyzeNocturneDecisions({units, approvedIds: [0, 2, 3], provider: async (request, context) => {
    assert.deepEqual(context.phase, "decisions");
    assert.equal(context.signal.aborted, false);
    assert.equal(request.model, "gpt-6-luna");
    assert.deepEqual(request.prompt_cache_options, {mode: "explicit"});
    assert.equal(Object.hasOwn(request, "store"), false);
    assert.equal(request.input[0].role, "developer");
    assert.deepEqual(request.input[1].content[0].data.units.map(({id}) => id), [0, 2, 3]);
    assert.doesNotMatch(JSON.stringify(request), /Private excluded text/);
    assert.deepEqual(request.questions.map(({name}) => name),
      ["u0-frame", "u0-phase", "u0-category", "u3-frame", "u3-phase", "u3-category"]);
    assert.equal(request.questions.every(({type, choices}) => type === "choice" && choices.length >= 7), true);
    return Response.json(payload(request, {0: cue}));
  }});
  assert.deepEqual(result.trace.status, "completed");
  assert.deepEqual(result.trace.calls[0].usage, {inputTokens: 90, outputTokens: 12, reasoningTokens: 0,
    cachedInputTokens: 0, cacheWriteInputTokens: 0});
  assert.equal(result.trace.excludedUnits, 1);
  assert.equal(result.trace.targetedUnits, 2);
  assert.equal(result.trace.structuralUnits, 1);
  assert.equal(result.trace.mappedUnits, 3);
  assert.equal(result.trace.acceptedBeats, 1);
  assert.deepEqual(compileSceneMap(result.accepted, units).map(({phase, boundary}) => [phase, boundary]),
    [["build", null], ["unmapped", null], ["boundary", "structural"], ["quiet", null]]);
  assert.doesNotMatch(JSON.stringify(result), /shared a smile|Private excluded text/);
});

test("Decisions preserves valid partial coverage and separates refusals, uncertainty and contradictions", async () => {
  const units = buildSceneUnits(["They shared a smile.", "They planned dinner.", "They left together.",
    "He remembered that evening.", "The meeting ended.", "They began a new conversation."]);
  const result = await analyzeNocturneDecisions({units, approvedIds: units.map(({id}) => id), provider: async request =>
    Response.json(payload(request, {0: cue, 1: {...cue, phase: null}, 2: {...cue, frame: "uncertain"},
      3: {...cue, frame: "historical"}, 4: {...neutral, frame: "current", phase: "boundary"}, 5: cue}))});
  assert.equal(result.trace.status, "completed");
  assert.equal(result.trace.refusedQuestions, 1);
  assert.equal(result.trace.refusedUnits, 1);
  assert.equal(result.trace.answeredUnits, 5);
  assert.equal(result.trace.uncertainUnits, 1);
  assert.equal(result.trace.inconsistentUnits, 1);
  assert.deepEqual(result.accepted.scenes.map(({first, last}) => [first, last]), [[0, 0], [4, 4], [5, 5]]);
  assert.deepEqual(compileSceneMap(result.accepted, units).map(({phase}) => phase),
    ["build", "unmapped", "unmapped", "unmapped", "boundary", "build"]);
});

test("joint Decisions maps one allowed label per approved target and preserves local breaks and omissions", async () => {
  const units = buildSceneUnits(["She offered to stay.", "She moved the lamp.", "Private excluded text.", "***",
    "The door opened abruptly.", "They sat for a while.", "Her thoughts were elsewhere.", "They greeted the guests."]);
  const result = await analyzeNocturneDecisions({units, approvedIds: [0, 1, 3, 4, 5, 6, 7], joint: true, provider: async request => {
    assert.deepEqual(request.questions.map(({name}) => name), ["u0-joint", "u1-joint", "u4-joint", "u5-joint", "u6-joint", "u7-joint"]);
    assert.ok(request.questions.every(({type, choices}) => type === "choice" && choices.length === 32 &&
      choices.every(choice => Object.keys(choice).length === 1 && typeof choice.value === "string")));
    assert.match(request.input[0].content, /clearly reciprocates the immediate current exchange/);
    assert.match(request.input[0].content, /explicit return from reported/);
    assert.doesNotMatch(JSON.stringify(request), /Private excluded text/);
    const choices = ["build-flirting", "quiet-reported", "boundary", null, "uncertain", "quiet-current"];
    return Response.json({model: "gpt-6-luna", usage, answers: request.questions.map(({name}, index) => answer(name, choices[index]))});
  }});
  assert.equal(result.trace.status, "completed");
  assert.equal(result.trace.excludedUnits, 1);
  assert.equal(result.trace.structuralUnits, 1);
  assert.equal(result.trace.answeredQuestions, 5);
  assert.equal(result.trace.refusedQuestions, 1);
  assert.equal(result.trace.answeredUnits, 5);
  assert.equal(result.trace.refusedUnits, 1);
  assert.equal(result.trace.uncertainUnits, 1);
  assert.equal(result.trace.inconsistentUnits, 0);
  assert.equal(result.trace.mappedUnits, 5);
  assert.deepEqual(compileSceneMap(result.accepted, units).map(({frame, phase, category, boundary}) =>
    [frame, phase, category, boundary]), [
    ["current", "build", "flirting", null], ["reported", "quiet", "neutral", null], [null, "unmapped", "neutral", null],
    ["neutral", "boundary", "neutral", "structural"], ["current", "boundary", "neutral", "model"],
    [null, "unmapped", "neutral", null], [null, "unmapped", "neutral", null], ["current", "quiet", "neutral", null],
  ]);
});

test("Decisions rejects missing, reordered, out-of-domain and invalid probability answers", async () => {
  const units = buildSceneUnits(["The group returned."]);
  for (const mutate of [
    data => { data.answers.pop(); },
    data => { data.answers.reverse(); },
    data => { data.answers[1].name = data.answers[0].name; },
    data => { data.answers[1].choice = "unexpected phase"; },
    data => { data.answers[1].confidence = 1.2; },
    data => { data.answers[1].probabilities[0].probability = -0.1; },
    data => { data.answers[1].probabilities[0].value = "not a supplied option"; },
    data => { data.model = "unexpected model"; },
  ]) {
    const result = await analyzeNocturneDecisions({units, approvedIds: [0], provider: async request => {
      const data = payload(request);
      mutate(data);
      return Response.json(data);
    }});
    assert.equal(result.trace.status, "extraction_failed");
    assert.equal(result.trace.calls[0].result, "invalid_response");
    assert.equal(result.trace.failedUnits, 1);
    assert.equal(result.accepted, null);
  }
});

test("Decisions distinguishes a complete refusal and ignores invalid usage fields", async () => {
  const units = buildSceneUnits(["The group returned."]);
  const result = await analyzeNocturneDecisions({units, approvedIds: [0], provider: async request => {
    const data = payload(request, {0: {frame: null, phase: null, category: null}});
    data.usage = {...usage, total_tokens: 100};
    return Response.json(data);
  }});
  assert.equal(result.trace.calls[0].result, "refused");
  assert.equal(result.trace.calls[0].usage, null);
  assert.equal(result.trace.refusedUnits, 1);
  assert.equal(result.trace.refusedQuestions, 3);
  assert.deepEqual(result.accepted, {scenes: []});
});

test("Decisions bounds each batch and preserves valid output before an upstream failure", async () => {
  const units = buildSceneUnits(Array.from({length: 98}, (_, index) => `Entry ${index} ended.`));
  let count = 0;
  const result = await analyzeNocturneDecisions({units, approvedIds: units.map(({id}) => id), provider: async request => {
    count++;
    assert.equal(request.questions.length, 144);
    assert.equal(request.input[1].content[0].data.units.length, 98);
    return count === 1 ? Response.json(payload(request)) : new Response("Untrusted error text", {status: 429});
  }});
  assert.equal(count, 2);
  assert.equal(result.trace.status, "partial");
  assert.equal(result.trace.mappedUnits, 48);
  assert.equal(result.trace.failedUnits, 50);
  assert.deepEqual(result.trace.calls.map(({result}) => result), ["parsed", "http_error"]);
  assert.deepEqual(result.accepted.scenes.map(({first, last}) => [first, last]), [[0, 47]]);
  assert.doesNotMatch(JSON.stringify(result), /Untrusted error text|Entry/);
});

test("Decisions honors approval, cancellation and request and response limits", async () => {
  const units = buildSceneUnits(["They stopped talking."]);
  const noCall = async () => assert.fail("Unexpected provider call.");
  await assert.rejects(analyzeNocturneDecisions({units, approvedIds: [1], provider: noCall}), /approved source IDs/);
  await assert.rejects(analyzeNocturneDecisions({units, approvedIds: [0, 0], provider: noCall}), /approved source IDs/);
  const empty = await analyzeNocturneDecisions({units, approvedIds: [], provider: noCall});
  assert.equal(empty.trace.status, "no_approved_units");

  const escaped = "\0".repeat(32_000);
  const bounded = await analyzeNocturneDecisions({units: [{id: 0, paragraph: 0, start: 0, end: escaped.length,
    text: escaped, structuralBoundary: false}], approvedIds: [0], provider: noCall});
  assert.equal(bounded.trace.status, "input_limit");

  const oversized = await analyzeNocturneDecisions({units, approvedIds: [0], provider: async () => new Response("x".repeat(192_001))});
  assert.equal(oversized.trace.calls[0].result, "invalid_response");
  assert.equal(oversized.accepted, null);

  const controller = new AbortController();
  const aborted = await analyzeNocturneDecisions({units, approvedIds: [0], signal: controller.signal, provider: async request => {
    controller.abort();
    return Response.json(payload(request));
  }});
  assert.equal(aborted.trace.status, "aborted");
  assert.equal(aborted.accepted, null);
  const preaborted = await analyzeNocturneDecisions({units, approvedIds: [0], signal: controller.signal, provider: noCall});
  assert.equal(preaborted.trace.status, "aborted");
  assert.deepEqual(preaborted.trace.calls, []);
});
