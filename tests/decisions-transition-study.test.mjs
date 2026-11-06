import assert from "node:assert/strict";
import test from "node:test";
import {digestDecisionsCorpusWindow} from "../deploy/cloudflare/decisions-corpus-pins.mjs";
import {runDecisionsTransitionStudy} from "../deploy/cloudflare/decisions-transition-study.mjs";

const key = "sk-transition-mock-0123456789";
const version = "story-transition-mock-v1";

async function story(id, sentences, boundaries = []) {
  const units = sentences.map((text, index) => ({id: index, paragraph: index, start: 0, end: text.length, text,
    structuralBoundary: false}));
  return {source: {id, units}, pin: {id, sha256: await digestDecisionsCorpusWindow(units), unitCount: units.length,
    positives: [], boundaries}};
}

async function fixture() {
  const calibration = await Promise.all([
    story("first", ["One person held out a hand.", "The bell rang.", "They stepped away.", "He returned to the room.",
      "The other person closed the door."], [2]),
    story("second", ["The two waited.", "They began to speak.", "The visitor cut them off.", "They left."], [2]),
    story("third", ["They waited quietly.", "The wind shook the window.", "They watched."]),
  ]);
  const holdout = await story("held", ["Held-out fixture stays local."]);
  return {pins: {version, calibration: calibration.map(item => item.pin), holdout: [holdout.pin]},
    payload: {version, split: "calibration", stories: calibration.map(item => item.source)}};
}

test("transition study scores one bounded Responses call with exact and one-to-one paragraph matches", async () => {
  const options = await fixture();
  const transitions = [
    {storyId: "first", anchor: 1, before: 0, after: 2, kind: "interruption"},
    {storyId: "first", anchor: 3, before: 2, after: 4, kind: "frame-return"},
    {storyId: "second", anchor: 2, before: 1, after: 3, kind: "interruption"},
    {storyId: "third", anchor: 1, before: 0, after: 2, kind: "interruption"},
    {storyId: "unapproved", anchor: 1, before: 0, after: 2, kind: "interruption"},
  ];
  let calls = 0;
  const report = await runDecisionsTransitionStudy({key, ...options, analysisFetcher: (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.match(init.body, /One person held out a hand/);
    assert.doesNotMatch(init.body, /Held-out fixture|"positives":|"boundaries":/);
    return Response.json({model: "gpt-6-luna", status: "completed", output: [{type: "message", role: "assistant",
      status: "completed", content: [{type: "output_text", text: JSON.stringify({transitions})}]}],
    usage: {input_tokens: 72, output_tokens: 31, total_tokens: 103}, privateBody: "provider body stays private"});
  }});
  assert.equal(calls, 1);
  assert.equal(report.plannedProviderCalls, 1);
  assert.equal(report.study, "story-transition-evidence-v2");
  assert.equal(report.totals.sourceUnits, 12);
  assert.equal(report.totals.parsedCalls, 1);
  assert.equal(report.provider.status, "partial");
  assert.equal(report.provider.rejectedTransitions, 1);
  assert.deepEqual(report.totals.sentenceBoundaries, {found: 1, missed: 1, false: 3, precision: .25, recall: .5});
  assert.deepEqual(report.totals.paragraphToleranceBoundaries, {found: 2, missed: 0, false: 2, precision: .5, recall: 1});
  assert.equal(report.stories[0].paragraphToleranceBoundaries.false, 1);
  assert.deepEqual(report.stories[0].predictedAnchors, [1, 3]);
  assert.deepEqual(report.stories[0].missedAnchorIds, [2]);
  assert.deepEqual(report.stories[0].falseAnchorIds, [1, 3]);
  assert.equal(report.totals.usage.inputTokens.total, 72);
  assert.doesNotMatch(JSON.stringify(report), /One person held out a hand|Held-out fixture|provider body stays private|sk-transition|"anchor"|unapproved/);
});

test("transition study rejects an unpinned split before transport and counts failed results against the gold denominator", async () => {
  const options = await fixture();
  const changed = structuredClone(options.payload);
  changed.stories[0].units[0].text = "This text is deliberately changed.";
  let calls = 0;
  const analysisFetcher = () => {
    calls++;
    return new Response("Private provider rejection", {status: 429});
  };
  await assert.rejects(runDecisionsTransitionStudy({key, ...options, payload: changed, analysisFetcher}), TypeError);
  assert.equal(calls, 0);
  const report = await runDecisionsTransitionStudy({key, ...options, analysisFetcher});
  assert.equal(calls, 1);
  assert.equal(report.totals.parsedCalls, 0);
  assert.deepEqual(report.totals.sentenceBoundaries, {found: 0, missed: 2, false: 0, precision: null, recall: 0});
  assert.deepEqual(report.totals.paragraphToleranceBoundaries, report.totals.sentenceBoundaries);
  assert.equal(report.provider.calls[0].status, 429);
  assert.doesNotMatch(JSON.stringify(report), /Private provider rejection/);
});

test("the state-evidence transition study is opt-in and scores only validated anchors", async () => {
  const options = await fixture();
  let calls = 0;
  const analysisFetcher = (_, init) => {
    calls++;
    const {text} = JSON.parse(init.body);
    const {required} = text.format.schema.properties.transitions.items;
    assert.ok(required.includes("beforeState"));
    assert.ok(required.includes("afterState"));
    const transitions = [
      {storyId: "first", anchor: 2, before: 1, after: 2, kind: "interruption"},
      {storyId: "second", anchor: 2, before: 1, after: 3, kind: "interruption",
        beforeState: "foreground-interaction", afterState: "redirected"},
    ];
    return Response.json({model: "gpt-6-luna", status: "completed", output: [{type: "message", role: "assistant",
      status: "completed", content: [{type: "output_text", text: JSON.stringify({transitions})}]}]});
  };
  await assert.rejects(runDecisionsTransitionStudy({key, ...options, analysisFetcher, requireStateEvidence: "true"}), TypeError);
  assert.equal(calls, 0);
  const report = await runDecisionsTransitionStudy({key, ...options, analysisFetcher, requireStateEvidence: true});
  assert.equal(calls, 1);
  assert.equal(report.study, "story-transition-evidence-v3-state-check");
  assert.equal(report.provider.rejectedTransitions, 1);
  assert.deepEqual(report.totals.sentenceBoundaries, {found: 1, missed: 1, false: 0, precision: 1, recall: .5});
  assert.doesNotMatch(JSON.stringify(report), /beforeState|afterState|foreground-interaction|redirected/);
});
