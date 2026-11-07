import assert from "node:assert/strict";
import test from "node:test";
import {planWholeStoryComparison} from "../scripts/lib/whole-story-comparison-plans.mjs";
import {executeWholeStoryContextPlan} from "../scripts/lib/whole-story-context-execution.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "../scripts/lib/whole-story-context-planning.mjs";

const now = 1_000;
function grants(text, withheld = []) {
  const {editionDigest, segmentationVersion, units} = buildWholeStoryIndex(text);
  const scope = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: now + 1};
  const spans = units.filter(unit => !unit.structuralBoundary && !withheld.includes(unit.id))
    .map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}));
  return {grant: {...scope, spans}, wholeEditionGrant: {...scope, byteStart: 0, byteEnd: Buffer.byteLength(text)}, now};
}

test("fully cleared arms share target IDs and the whole arm carries the exact edition once", () => {
  const text = "\uFEFF  A café opened. The lantern shone.\r\n\r\n<<<>>>\r\n\r\nA heron flew away.\r\n";
  const {targetIds, arms, summary} = planWholeStoryComparison(text, grants(text));
  assert.deepEqual(targetIds, [0, 1, 3]);
  assert.deepEqual(summary, {units: 4, structuralUnits: 1, approvedUnits: 3, withheldUnits: 0});
  for (const arm of Object.values(arms)) {
    assert.equal(arm.status, "planned");
    assert.deepEqual(arm.windows.flatMap(window => window.targetIds), targetIds);
    assert.equal(arm.summary.plannedTargets, 3);
  }
  assert.equal(arms.whole.windows.length, 1);
  const [window] = arms.whole.windows;
  const payload = JSON.parse(window.body), source = Buffer.from(payload.text);
  assert.equal(payload.text, text);
  assert.equal(window.sourceBytes, Buffer.byteLength(text));
  assert.equal(window.bodyBytes, Buffer.byteLength(window.body));
  assert.equal(arms.whole.summary.framingSourceBytes, window.sourceBytes - window.targetSourceBytes);
  assert.deepEqual(payload.units.map(({id, byteStart, byteEnd}) => [id, source.subarray(byteStart, byteEnd).toString()]),
    [[0, "A café opened."], [1, "The lantern shone."], [3, "A heron flew away."]]);
  assert.deepEqual(arms.paragraph.windows.map(({targetIds}) => targetIds), [[0, 1], [3]]);
  assert.deepEqual(arms.sentence.windows.map(({targetIds, contextIds}) => [targetIds, contextIds]), [[[0], []], [[1], [0]], [[3], []]]);
});

test("a partial edition cannot enter the whole arm even when accompanied by a full-edition grant", () => {
  const text = "The café opened.\n\nA bell rang. A note remained private. The lamp shone.\n\nThe room emptied.";
  const plan = planWholeStoryComparison(text, grants(text, [2]));
  assert.deepEqual(plan.targetIds, [0, 1, 3, 4]);
  assert.equal(plan.summary.withheldUnits, 1);
  assert.deepEqual(plan.arms.whole.windows, []);
  assert.equal(plan.arms.whole.reason, "partial-clearance");
  assert.deepEqual(plan.arms.paragraph.windows.map(({runId, targetIds}) => [runId, targetIds]), [[0, [0]], [4, [4]]]);
  assert.equal(plan.arms.paragraph.summary.ineligibleTargets, 2);
  assert.deepEqual(plan.arms.sentence.windows.map(({runId, targetIds, contextIds}) => [runId, targetIds, contextIds]),
    [[0, [0], []], [0, [1], [0]], [3, [3], []], [3, [4], [3]]]);
  for (const window of [...plan.arms.paragraph.windows, ...plan.arms.sentence.windows]) assert.doesNotMatch(window.body, /remained private/u);
});

test("whole-story input requires its own current grant over all bytes and respects whole-window caps", () => {
  const text = " A note arrived. The clock stopped. \r\n";
  const options = grants(text);
  const missing = planWholeStoryComparison(text, {...options, wholeEditionGrant: undefined});
  assert.equal(missing.arms.whole.reason, "missing-whole-edition-grant");
  for (const override of [{byteStart: 1}, {byteEnd: Buffer.byteLength(text) - 1}, {expiresAt: now}, {editionDigest: "0".repeat(64)}]) {
    const plan = planWholeStoryComparison(text, {...options, wholeEditionGrant: {...options.wholeEditionGrant, ...override}});
    assert.equal(plan.arms.whole.reason, "invalid-whole-edition-grant");
    assert.deepEqual(plan.arms.whole.windows, []);
    assert.equal(plan.arms.sentence.summary.plannedTargets, 2);
  }
  const tooLarge = planWholeStoryComparison(text, {...options, limits: {maxTargetsPerWindow: 1}, wholeLimits: {maxTargetsPerWindow: 1}});
  assert.equal(tooLarge.arms.whole.reason, "whole-edition-limit");
  assert.equal(tooLarge.arms.paragraph.summary.oversizedUnits, 2);
  assert.equal(tooLarge.arms.sentence.summary.plannedTargets, 2);
  const deferred = planWholeStoryComparison(text, {...options, limits: {maxRequests: 0}});
  assert.equal(deferred.arms.whole.reason, "budget-deferred");
  assert.equal(deferred.arms.whole.summary.budgetDeferredUnits, 2);
  assert.throws(() => planWholeStoryComparison(text.trim(), options), /exact story edition/);
});

test("the single-request arm admits a complete edition beyond ordinary window input bounds", () => {
  const text = Array.from({length: 65}, (_, index) => `The hall held ${"old ".repeat(55)}chair ${index}.`).join("\n\n");
  const options = grants(text), {arms} = planWholeStoryComparison(text, options);
  assert.equal(arms.whole.windows.length, 1);
  assert.equal(arms.whole.summary.plannedTargets, 65);
  assert.ok(arms.whole.windows[0].sourceBytes > 12_000);
  assert.equal(JSON.parse(arms.whole.windows[0].body).text, text);
  assert.ok(arms.paragraph.windows.every(window => window.sourceBytes <= 12_000 && window.targetIds.length <= 48));
  const constrained = planWholeStoryComparison(text, {...options, limits: {maxSourceBytes: 12_000}});
  assert.equal(constrained.arms.whole.reason, "budget-deferred");
  assert.throws(() => planWholeStoryComparison(text, {...options, wholeLimits: {maxTargetsPerWindow: 1201}}), /bounded whole-edition limits/);
});

test("an expanded verified prefix stays causal, authorized and bounded", () => {
  const text = Array.from({length: 34}, (_, index) => `The hall held chair ${index}.`).join("\n\n");
  const options = grants(text, [26]);
  const baseline = planWholeStoryComparison(text, options);
  assert.deepEqual(baseline.arms.sentence.windows.find(window => window.targetIds[0] === 25).contextIds, [21, 22, 23, 24]);
  const expanded = planWholeStoryComparison(text, {...options, causalPrefixUnits: 24, causalPrefixBytes: 12_000});
  const before = expanded.arms.sentence.windows.find(window => window.targetIds[0] === 25);
  const after = expanded.arms.sentence.windows.find(window => window.targetIds[0] === 30);
  assert.deepEqual(before.contextIds, Array.from({length: 24}, (_, index) => index + 1));
  assert.deepEqual(after.contextIds, [27, 28, 29]);
  for (const {targetIds, contextIds, body, bodyBytes} of expanded.arms.sentence.windows) {
    assert.equal(targetIds.length, 1);
    assert.ok(contextIds.every(id => id < targetIds[0] && id !== 26));
    assert.deepEqual(JSON.parse(body).units.map(({id}) => id), [...contextIds, ...targetIds]);
    assert.equal(bodyBytes, Buffer.byteLength(body));
    assert.ok(bodyBytes <= 16_384);
  }
  const byteBound = planWholeStoryComparison(text, {...options, causalPrefixUnits: 24, causalPrefixBytes: 30});
  assert.ok(byteBound.arms.sentence.windows.every(window => window.contextIds.length <= 1 && window.overlapSourceBytes <= 30));
  assert.throws(() => planWholeStoryComparison(text, {...options, causalPrefixUnits: 25}), /bounded comparison limits/);
});

test("paragraph windows preserve layout grouping and can execute concurrently without overlap", async () => {
  const text = "The bird flew. The pond rippled.\n\nThe path curved.\n\nThe light faded. The lamps came on.\n\nThe gate closed.";
  const {arms} = planWholeStoryComparison(text, {...grants(text), paragraphWindowSize: 2, startId: 4});
  assert.equal(arms.paragraph.concurrency, 2);
  assert.deepEqual(arms.paragraph.windows.map(window => JSON.parse(window.body).paragraphs), [
    [{id: 2, unitIds: [3, 4]}, {id: 3, unitIds: [5]}], [{id: 0, unitIds: [0, 1]}, {id: 1, unitIds: [2]}],
  ]);
  let active = 0, peak = 0;
  const execution = await executeWholeStoryContextPlan(arms.paragraph, {concurrency: arms.paragraph.concurrency, async request(window) {
    assert.deepEqual(window.contextIds, []);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return {status: "annotated", annotations: window.targetIds.map(id => ({id}))};
  }});
  assert.equal(execution.progress.annotated, 2);
  assert.equal(peak, 2);
});
