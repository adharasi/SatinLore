import assert from "node:assert/strict";
import {test} from "node:test";
import {buildSceneUnits} from "../app/static/reader/scene-map.mjs";
import {analyzeStoryTransitions} from "../deploy/cloudflare/story-transition-analysis.mjs";

const stories = [
  {id: "a", units: buildSceneUnits(["They unpacked the instruments. The alarm sounded. They went outside."])},
  {id: "b", units: buildSceneUnits(["She described her school. She pointed to the bridge they were crossing."])},
];
const transitions = [
  {storyId: "a", before: 0, anchor: 1, after: 2, kind: "interruption"},
  {storyId: "b", before: 0, anchor: 1, after: 1, kind: "frame-return"},
];
const output = (value, usage = {input_tokens: 40, output_tokens: 20}) => Response.json({
  status: "completed",
  usage,
  output: [{type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify(value)}]}],
});

test("transition-only analysis sends one ordered, bounded story split and returns evidence IDs", async () => {
  let calls = 0;
  const {transitions: actual, trace} = await analyzeStoryTransitions({stories, provider: (request, {signal}) => {
    calls++;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(request.model, "gpt-6-luna");
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.name, "nocturne_story_transitions");
    assert.deepEqual(request.text.format.schema.properties.transitions.items.required, ["storyId", "anchor", "before", "after", "kind"]);
    assert.deepEqual(JSON.parse(request.input), {stories: stories.map(({id, units}) => ({id,
      units: units.map(({id, paragraph, text, structuralBoundary}) => ({id, paragraph, text, structuralBoundary})),
    }))});
    return output({transitions}, {input_tokens: 80, output_tokens: 20, input_tokens_details: {cached_tokens: 5},
      output_tokens_details: {reasoning_tokens: 10}, extra: "private-provider-data"});
  }});
  assert.deepEqual(actual, transitions);
  assert.equal(calls, 1);
  assert.equal(trace.status, "completed");
  assert.equal(trace.rejectedTransitions, 0);
  assert.equal(trace.calls[0].result, "parsed");
  assert.equal(trace.calls[0].status, 200);
  assert.deepEqual(trace.calls[0].usage, {inputTokens: 80, outputTokens: 20, reasoningTokens: 10, cachedInputTokens: 5});
  assert.doesNotMatch(JSON.stringify({actual, trace}), /unpacked|private-provider-data/u);
});

test("transition-only analysis drops invalid order, anchors and evidence and keeps independent valid rows", async () => {
  for (const [proposed, kept] of [
    [[...transitions].reverse(), [transitions[1]]],
    [[transitions[0], transitions[0]], [transitions[0]]],
    [[{...transitions[0], before: 1}], []],
    [[{...transitions[0], after: 3}], []],
    [[{...transitions[0], storyId: "c"}], []],
    [[{...transitions[0], kind: "guess"}], []],
    [[{...transitions[0], text: "private-provider-data"}, ...transitions], transitions],
  ]) {
    const result = await analyzeStoryTransitions({stories, provider: () => output({transitions: proposed})});
    assert.deepEqual(result.transitions, kept);
    assert.equal(result.trace.status, "partial");
    assert.equal(result.trace.rejectedTransitions, 1);
    assert.equal(result.trace.calls[0].result, "parsed");
    assert.doesNotMatch(JSON.stringify(result), /private-provider-data/u);
  }

  const withGap = {id: "a", units: stories[0].units.filter(({id}) => id !== 1)};
  const withMarker = {id: "a", units: buildSceneUnits(["They unpacked the instruments.\n***\nThey went outside."])};
  for (const story of [withGap, withMarker]) {
    const result = await analyzeStoryTransitions({stories: [story],
      provider: () => output({transitions: [{...transitions[0], anchor: 2}]})});
    assert.deepEqual(result.transitions, []);
    assert.equal(result.trace.rejectedTransitions, 1);
    assert.equal(result.trace.status, "partial");
  }
});

test("opt-in state evidence keeps explicit pauses, neutral hard cuts and frame returns with compatible evidence", async () => {
  const cases = [
    {id: "a", units: buildSceneUnits(["They were holding hands. A shelf tipped and she said wait. He let go and caught it."])},
    {id: "b", units: buildSceneUnits(["The crew fought to contain the leak. At dawn the investigators inspected the damage."])},
    {id: "c", units: buildSceneUnits(["He told of crossing the old bridge. She gestured toward the platform they stood on now."])},
  ];
  const accepted = [
    {storyId: "a", before: 0, anchor: 1, after: 2, kind: "interruption"},
    {storyId: "b", before: 0, anchor: 1, after: 1, kind: "time-place-cut"},
    {storyId: "c", before: 0, anchor: 1, after: 1, kind: "frame-return"},
  ];
  const result = await analyzeStoryTransitions({stories: cases, requireStateEvidence: true, provider: request => {
    const format = request.text.format;
    assert.equal(format.name, "nocturne_story_transitions_state_check");
    assert.equal(format.strict, true);
    const fields = format.schema.properties.transitions.items;
    assert.deepEqual(fields.required, ["storyId", "anchor", "before", "after", "kind", "beforeState", "afterState"]);
    assert.ok(fields.properties.beforeState.enum.includes("active-episode"));
    assert.ok(fields.properties.afterState.enum.includes("new-episode"));
    return output({transitions: [
      {...accepted[0], beforeState: "foreground-interaction", afterState: "redirected"},
      {...accepted[1], beforeState: "active-episode", afterState: "new-episode"},
      {...accepted[2], beforeState: "embedded-frame", afterState: "outer-resumed"},
    ]});
  }});
  assert.deepEqual(result.transitions, accepted);
  assert.equal(result.trace.status, "completed");
  assert.equal(result.trace.rejectedTransitions, 0);
});

test("opt-in state evidence rejects missing, routine and incompatible before/after states", async () => {
  for (const rejected of [
    transitions[0],
    {...transitions[0], beforeState: "routine", afterState: "redirected"},
    {...transitions[0], beforeState: "foreground-interaction", afterState: "routine-continuation"},
    {...transitions[0], beforeState: "active-episode", afterState: "outer-resumed"},
    {...transitions[0], beforeState: "embedded-frame", afterState: "new-episode"},
    {...transitions[0], kind: "frame-return", beforeState: "active-episode", afterState: "outer-resumed"},
    {...transitions[0], kind: "withdrawal", beforeState: "active-episode", afterState: "disengaged"},
    {...transitions[0], kind: "time-place-cut", beforeState: "routine", afterState: "new-episode"},
  ]) {
    const result = await analyzeStoryTransitions({stories, requireStateEvidence: true, provider: () => output({
      transitions: [rejected, {...transitions[1], beforeState: "embedded-frame", afterState: "outer-resumed"}],
    })});
    assert.deepEqual(result.transitions, [transitions[1]]);
    assert.equal(result.trace.status, "partial");
    assert.equal(result.trace.rejectedTransitions, 1);
    assert.equal(result.trace.calls[0].result, "parsed");
  }
});

test("transition-only analysis keeps refusal and provider failure free of provider text", async () => {
  const refusal = Response.json({status: "completed", output: [{type: "message", role: "assistant",
    content: [{type: "refusal", refusal: "private-provider-data"}]}]});
  const failed = new Response("private-provider-data", {status: 429});
  for (const requireStateEvidence of [false, true]) {
    for (const [response, expected] of [[refusal, "refused"], [failed, "http_error"],
      [output({transitions: [], text: "private-provider-data"}), "invalid_response"]]) {
      const result = await analyzeStoryTransitions({stories, requireStateEvidence, provider: () => response.clone()});
      assert.deepEqual(result.transitions, []);
      assert.equal(result.trace.status, "extraction_failed");
      assert.equal(result.trace.calls[0].result, expected);
      assert.doesNotMatch(JSON.stringify(result), /private-provider-data/u);
    }
  }
});

test("transition-only analysis checks cancellation and bounds before calling the provider", async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = () => assert.fail("Provider should not be called");
  const cancelled = await analyzeStoryTransitions({stories, provider, signal: controller.signal});
  assert.deepEqual(cancelled, {transitions: [], trace: {status: "aborted", calls: [], rejectedTransitions: 0}});
  const longSplit = [{id: "a", units: buildSceneUnits(Array(201).fill("They waited."))}];
  const oversized = await analyzeStoryTransitions({stories: longSplit, provider});
  assert.deepEqual(oversized, {transitions: [], trace: {status: "input_limit", calls: [], rejectedTransitions: 0}});
  await assert.rejects(analyzeStoryTransitions({stories: [stories[0], stories[0]], provider}), TypeError);
  await assert.rejects(analyzeStoryTransitions({stories, provider, requireStateEvidence: "yes"}), TypeError);
});
