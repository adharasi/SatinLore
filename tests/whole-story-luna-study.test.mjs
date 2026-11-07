import assert from "node:assert/strict";
import test from "node:test";
import {runBuiltInWholeStoryLunaComparison, runWholeStoryReferenceReplay} from "../scripts/compare-whole-story-luna.mjs";

function neutralResponse(ids, usage = {input_tokens: 120, output_tokens: 20, total_tokens: 140}) {
  const annotations = ids.map(id => ({id, status: "classified", depiction: "neutral", frame: "current", action: "none",
    phase: "quiet", transition: "none", evidenceIds: []}));
  return Response.json({model: "gpt-6-luna", status: "completed", usage,
    output: [{type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({annotations})}]}]});
}

test("reference replay distinguishes exposure from model accuracy and tests partial admission", async () => {
  const complete = await runWholeStoryReferenceReplay();
  assert.equal(complete.measurement, "offline-reference-replay");
  assert.equal(complete.providerCalls, 0);
  assert.deepEqual(["whole", "paragraph", "sentence"].map(arm => complete.pooled[arm].score.cues.matched), [10, 8, 10]);
  const masked = await runWholeStoryReferenceReplay({masked: true});
  assert.equal(masked.works[0].arms.whole.reason, "partial-clearance");
  assert.equal(masked.pooled.paragraph.score.delivery.missing, 2);
  assert.equal(masked.pooled.sentence.score.delivery.missing, 1);
  assert.equal(masked.pooled.sentence.score.delivery.abstained, 1);
});

test("three comparison arms use the same targets and never return prose", async () => {
  const calls = [];
  const report = await runBuiltInWholeStoryLunaComparison({apiKey: "mock-project-key", async fetchImpl(url, options) {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body), input = JSON.parse(body.input);
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.store, false);
    assert.equal(Object.hasOwn(input, "annotations"), false);
    if (Object.hasOwn(input, "text")) assert.ok(input.units.every(row => !Object.hasOwn(row, "text")));
    if (body.instructions.includes("causal verification")) assert.equal(input.units.at(-1).id, input.targetIds[0]);
    calls.push(input);
    return neutralResponse(input.targetIds);
  }});
  assert.equal(report.providerCalls, 48);
  assert.equal(report.budget.attempts, 48);
  assert.equal(report.budget.outstandingReserveUsd, 0);
  assert.equal(calls.filter(input => Object.hasOwn(input, "text")).length, 4);
  assert.equal(calls.filter(input => Object.hasOwn(input, "paragraphs")).length, 11);
  assert.deepEqual(Object.values(report.pooled).map(row => row.score.delivery.targets), [33, 33, 33]);
  assert.deepEqual(Object.values(report.pooled).map(row => row.score.cues.missed), [10, 10, 10]);
  assert.doesNotMatch(JSON.stringify(report), /Nora and Eli|mock-project-key/u);
});

test("a refusal closes matching source across arms and independent stories still finish", async () => {
  const calls = [];
  const report = await runBuiltInWholeStoryLunaComparison({apiKey: "mock-project-key", async fetchImpl(_url, options) {
    const input = JSON.parse(JSON.parse(options.body).input);
    calls.push(input);
    if (calls.length === 1) return Response.json({model: "gpt-6-luna", status: "completed",
      output: [{type: "message", role: "assistant", content: [{type: "refusal", refusal: "provider prose"}]}]});
    return neutralResponse(input.targetIds);
  }});
  assert.equal(report.providerCalls, 34);
  assert.equal(report.works[0].arms.whole.execution.providerRefused, 1);
  assert.equal(report.works[0].arms.paragraph.refusalBlocked, 3);
  assert.equal(report.works[0].arms.sentence.refusalBlocked, 11);
  assert.equal(report.works[1].arms.sentence.score.delivery.classified, 8);
  assert.equal(report.budget.unknownAttempts, 1);
  assert.ok(report.budget.outstandingReserveUsd > 0);
  assert.doesNotMatch(JSON.stringify(report), /provider prose/u);
});

test("a tight attempt allowance is reserved before dispatch", async () => {
  const report = await runBuiltInWholeStoryLunaComparison({apiKey: "mock-project-key", maxAttempts: 1,
    async fetchImpl(_url, options) {
      const input = JSON.parse(JSON.parse(options.body).input);
      return neutralResponse(input.targetIds);
    }});
  assert.equal(report.providerCalls, 1);
  assert.equal(report.budget.attempts, 1);
  assert.equal(Object.values(report.pooled).reduce((sum, arm) => sum + arm.attempts.budgetDeferred, 0), 47);
});
