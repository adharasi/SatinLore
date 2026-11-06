import assert from "node:assert/strict";
import test from "node:test";
import {buildSceneUnits} from "../app/static/reader/scene-map.mjs";
import {analyzeNocturneSceneMap} from "../scripts/lib/nocturne-scene-analysis.mjs";

const units = buildSceneUnits(["They set a second cup beside the window.", "A private note remained in the drawer.", "The clock chimed."]);
const beat = (id, phase = "build") => ({first: id, last: id, phase, category: phase === "boundary" ? "neutral" : "romance",
  emphasis: phase === "boundary" ? 0 : 1, evidence: [id]});
const scene = (first, last, beats = []) => ({first, last, frame: "current", beats});
const usage = {input_tokens: 90, output_tokens: 45, output_tokens_details: {reasoning_tokens: 12}, input_tokens_details: {cached_tokens: 20}};
const structured = (value, metadata = {}) => Response.json({status: "completed", usage, output: [{type: "message", role: "assistant",
  content: [{type: "output_text", text: JSON.stringify(value)}]}], ...metadata});

test("scene analysis uses only explicitly approved exact source units and skips empty approvals", async () => {
  let calls = 0;
  const map = {scenes: [scene(0, 0, [beat(0)]), scene(2, 2)]};
  const provider = async (request, context) => {
    calls++;
    assert.equal(context.phase, "extract");
    assert.ok(context.signal instanceof AbortSignal);
    assert.equal(request.model, "gpt-6-luna");
    assert.deepEqual(request.reasoning, {effort: "medium"});
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    assert.match(request.instructions, /untrusted story data/u);
    assert.deepEqual(JSON.parse(request.input), {units: [0, 2].map(id => ({id, text: units[id].text, structuralBoundary: false}))});
    return structured(map);
  };
  const empty = await analyzeNocturneSceneMap({units, approvedIds: [], provider});
  assert.equal(empty.trace.status, "no_approved_units");
  assert.equal(empty.accepted, null);
  assert.equal(calls, 0);
  const result = await analyzeNocturneSceneMap({units, approvedIds: [2, 0], provider});
  assert.equal(calls, 1);
  assert.equal(result.trace.status, "completed");
  assert.deepEqual(result.accepted, map);
  assert.equal(result.trace.approvedUnits, 2);
  assert.equal(result.trace.excludedUnits, 1);
  assert.equal(result.trace.unverifiedBeats, 1);
  assert.deepEqual(result.trace.calls[0].usage, {inputTokens: 90, outputTokens: 45, reasoningTokens: 12, cachedInputTokens: 20});
  assert.doesNotMatch(JSON.stringify(result), /second cup|private note/u);
});

test("verification sees exact approved context and drops rejected and uncertain beats independently", async () => {
  const map = {scenes: [scene(0, 2, [beat(0), beat(1, "sustain"), beat(2, "boundary")])]};
  const provider = async (request, {phase}) => {
    if (phase === "extract") return structured(map);
    const input = JSON.parse(request.input);
    assert.equal(request.text.format.name, "nocturne_scene_review");
    assert.deepEqual(input.units.map(({id, text}) => ({id, text})), units.map(({id, text}) => ({id, text})));
    assert.deepEqual(input.beats.map(({id}) => id), [2, 0, 1]);
    return structured({decisions: [{id: 1, verdict: "uncertain"}, {id: 2, verdict: "keep"}, {id: 0, verdict: "reject"}]});
  };
  const result = await analyzeNocturneSceneMap({units, approvedIds: [0, 1, 2], provider, verify: true});
  assert.deepEqual(result.proposed, map);
  assert.deepEqual(result.accepted, {scenes: [scene(0, 2, [beat(2, "boundary")])]});
  assert.equal(result.trace.targetedBeats, 3);
  assert.equal(result.trace.keptBeats, 1);
  assert.equal(result.trace.rejectedBeats, 1);
  assert.equal(result.trace.uncertainBeats, 1);
  assert.equal(result.trace.unverifiedBeats, 0);
  assert.deepEqual(result.trace.calls.map(({result}) => result), ["parsed", "parsed"]);
});

test("verification is bounded and checks later peaks before ordinary early beats", async () => {
  const source = buildSceneUnits(Array.from({length: 27}, (_, id) => `The notice on shelf ${id} rustled.`));
  const map = {scenes: [scene(0, 26, source.map(({id}) => beat(id, id === 26 ? "peak" : "build")))]};
  const provider = async (request, {phase}) => {
    if (phase === "extract") return structured(map);
    const {beats} = JSON.parse(request.input);
    assert.equal(beats.length, 24);
    assert.equal(beats[0].id, 26);
    return structured({decisions: beats.map(({id}) => ({id, verdict: "keep"}))});
  };
  const result = await analyzeNocturneSceneMap({units: source, approvedIds: source.map(({id}) => id), provider, verify: true});
  assert.equal(result.trace.unverifiedBeats, 3);
  assert.equal(result.trace.acceptedBeats, 27);
});

test("invalid evidence, invented fields and malformed verification cannot become accepted output", async () => {
  for (const map of [
    {scenes: [scene(0, 2, [beat(0)])]},
    {scenes: [scene(0, 0, [{...beat(0), evidence: [1]}])]},
    {scenes: [scene(0, 0, [{...beat(0), quote: "Provider prose."}])]},
  ]) {
    const result = await analyzeNocturneSceneMap({units, approvedIds: [0, 2], provider: async () => structured(map)});
    assert.equal(result.trace.calls[0].result, "invalid_map");
    assert.equal(result.accepted, null);
    assert.doesNotMatch(JSON.stringify(result), /Provider prose/u);
  }
  const map = {scenes: [scene(0, 0, [beat(0)])]};
  const result = await analyzeNocturneSceneMap({units, approvedIds: [0], verify: true, provider: async (_, {phase}) =>
    structured(phase === "extract" ? map : {decisions: [{id: 12, verdict: "keep"}]})});
  assert.equal(result.trace.status, "verification_failed");
  assert.equal(result.trace.calls[1].result, "invalid_review");
  assert.deepEqual(result.proposed, map);
  assert.equal(result.accepted, null);
});

test("refusals, truncation, provider errors and oversized responses are separately reported without prose", async () => {
  const results = [
    [() => structured({}, {status: "incomplete", incomplete_details: {reason: "content_filter"}}), "refused"],
    [() => structured({}, {status: "incomplete", incomplete_details: {reason: "max_output_tokens"}}), "truncated"],
    [() => new Response("Provider error prose.", {status: 429}), "http_error"],
    [() => new Response("x".repeat(192_001)), "invalid_response"],
    [() => { throw new Error("Transport error prose."); }, "provider_error"],
  ];
  for (const [provider, expected] of results) {
    const result = await analyzeNocturneSceneMap({units, approvedIds: [0], provider});
    assert.equal(result.trace.status, "extraction_failed");
    assert.equal(result.trace.calls[0].result, expected);
    assert.equal(result.accepted, null);
    assert.doesNotMatch(JSON.stringify(result), /error prose/u);
  }
});

test("invalid approval and stale work never yield accepted analysis", async () => {
  const provider = async () => { assert.fail("The provider must not run."); };
  await assert.rejects(analyzeNocturneSceneMap({units, provider}), /approved source IDs/u);
  await assert.rejects(analyzeNocturneSceneMap({units, approvedIds: [0, 0], provider}), /approved source IDs/u);
  await assert.rejects(analyzeNocturneSceneMap({units, approvedIds: [3], provider}), /approved source IDs/u);
  const longUnits = buildSceneUnits(["é".repeat(16_001)]);
  await assert.rejects(analyzeNocturneSceneMap({units: longUnits, approvedIds: [0], provider}), /analysis limit/u);

  const controller = new AbortController();
  const result = await analyzeNocturneSceneMap({units, approvedIds: [0], signal: controller.signal, provider: async () => {
    controller.abort();
    return structured({scenes: [scene(0, 0, [beat(0)])]});
  }});
  assert.equal(result.trace.status, "aborted");
  assert.equal(result.trace.calls[0].result, "aborted");
  assert.equal(result.accepted, null);
  const stale = await analyzeNocturneSceneMap({units, approvedIds: [0], signal: controller.signal, provider});
  assert.equal(stale.trace.calls.length, 0);
});

test("escaped JSON exceeding the input limit never reaches the provider", async () => {
  const source = buildSceneUnits(["\u0001".repeat(20_000)]);
  const result = await analyzeNocturneSceneMap({units: source, approvedIds: [0], provider: () => {
    assert.fail("The provider must not run.");
  }});
  assert.equal(result.trace.status, "input_limit");
  assert.deepEqual(result.trace.calls, []);
  assert.equal(result.accepted, null);
});
