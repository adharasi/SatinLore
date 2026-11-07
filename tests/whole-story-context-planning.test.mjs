import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {splitText} from "../app/static/reader/import.mjs";
import {buildSceneUnits} from "../app/static/reader/scene-map.mjs";
import {buildWholeStoryIndex, planWholeStoryContext, WHOLE_STORY_GRANT_PURPOSE}
  from "../scripts/lib/whole-story-context-planning.mjs";

const now = 1_000;
const sha256 = value => createHash("sha256").update(value).digest("hex");
function grantFor(text, approvedIds) {
  const {editionDigest, segmentationVersion, units} = buildWholeStoryIndex(text);
  const spans = units.filter(unit => approvedIds?.includes(unit.id) ?? !unit.structuralBoundary)
    .map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}));
  return {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: now + 1, spans};
}

test("index projects normalized reader coordinates back to exact edition bytes", () => {
  const text = "\uFEFF  Café 🪶\r\ncontinued. Next sentence.\r\n\r\n  Café 🪶 continued.\r\n\r\n<<<>>>\r\n\r\nThe café reopened.";
  const bytes = Buffer.from(text);
  const {editionDigest, units} = buildWholeStoryIndex(text);
  assert.equal(editionDigest, sha256(bytes));
  const coordinates = unit => [unit.id, unit.paragraph, unit.start, unit.end, unit.structuralBoundary];
  assert.deepEqual(units.map(coordinates), buildSceneUnits(splitText(text)).map(coordinates));
  assert.deepEqual(units.map(unit => unit.text), ["Café 🪶\r\ncontinued.", "Next sentence.", "Café 🪶 continued.", "<<<>>>", "The café reopened."]);
  for (const {text: exact, byteStart, byteEnd, digest} of units) {
    const source = bytes.subarray(byteStart, byteEnd);
    assert.equal(source.toString(), exact);
    assert.equal(digest, sha256(source));
  }
  assert.throws(() => buildWholeStoryIndex("Invalid \ud800."), /well-formed/);
  assert.throws(() => buildWholeStoryIndex("Invalid \u0000."), /well-formed/);
});

test("only exact, current and purpose-bound grants can authorize a plan", () => {
  const text = "The door opened. The lamp flickered.\n\n<<<>>>\n\nThe hall was still.";
  const grant = grantFor(text);
  const rejected = [
    {...grant, purpose: "other-use"},
    {...grant, expiresAt: now},
    {...grant, segmentationVersion: "obsolete"},
    {...grant, spans: [grant.spans[0], grant.spans[0]]},
    {...grant, spans: [grant.spans[0], {...grant.spans[1], byteStart: grant.spans[0].byteStart}]},
    {...grant, spans: [grant.spans[0], {...grant.spans[1], digest: grant.spans[0].digest}]},
    grantFor(text, [0, 2]),
  ];
  for (const candidate of rejected) assert.throws(() => planWholeStoryContext(text, {grant: candidate, now}), /exact story edition/);
  assert.throws(() => planWholeStoryContext(` ${text}`, {grant, now}), /exact story edition/);
  const unknown = planWholeStoryContext(text, {now});
  assert.deepEqual(unknown.windows, []);
  assert.equal(unknown.summary.withheldUnits, 3);
  assert.equal(unknown.summary.structuralUnits, 1);
  assert.equal(planWholeStoryContext("", {now}).summary.units, 0);
});

test("serialized targets and overlap include only approved exact text from one contiguous run", () => {
  const text = ["The compass worked. The map unfolded. The note stayed private. The door opened.",
    "<<<>>>", "The wind rose. The lamp shone. The tower stood."].join("\n\n");
  const grant = grantFor(text, [0, 1, 3, 5, 6, 7]);
  const plan = planWholeStoryContext(text, {grant, now, limits: {maxTargetsPerWindow: 1, maxOverlapUnits: 2}});
  assert.deepEqual(plan.windows.map(({id, runId, targetIds, contextIds}) => [id, runId, targetIds, contextIds]), [
    ["0:0-0", 0, [0], []], ["0:1-1", 0, [1], [0]], ["3:3-3", 3, [3], []],
    ["5:5-5", 5, [5], []], ["5:6-6", 5, [6], [5]], ["5:7-7", 5, [7], [5, 6]],
  ]);
  const index = buildWholeStoryIndex(text);
  for (const window of plan.windows) {
    const {runId, targetIds, contextIds, bodyBytes, sourceBytes, body} = window;
    assert.deepEqual(JSON.parse(body), {editionDigest: grant.editionDigest, segmentationVersion: grant.segmentationVersion,
      runId, targetIds, units: [...contextIds, ...targetIds].map(id => ({id, text: index.units[id].text}))});
    assert.doesNotMatch(body, /private|<<<>>>/u);
    assert.equal(Buffer.byteLength(body), bodyBytes);
    assert.equal(JSON.parse(body).units.reduce((sum, unit) => sum + Buffer.byteLength(unit.text), 0), sourceBytes);
  }
  assert.equal(plan.summary.withheldUnits, 1);
  assert.equal(plan.summary.plannedTargets, 6);
  assert.equal(plan.summary.overlapUnits, 4);
  assert.equal(plan.summary.sourceBytes, plan.summary.plannedTargetSourceBytes + plan.summary.overlapSourceBytes);
});

test("escaped body overflow makes an opaque gap and starts a new run", () => {
  const text = `The lamp shone. The path held ${"\\".repeat(120)} marks. The tree stood. The gate opened.`;
  const grant = grantFor(text);
  const plan = planWholeStoryContext(text, {grant, now, limits: {maxWindowSourceBytes: 200, maxWindowBodyBytes: 320}});
  assert.equal(plan.summary.oversizedUnits, 1);
  assert.deepEqual(plan.windows.map(({runId, targetIds, contextIds}) => [runId, targetIds, contextIds]), [[0, [0], []], [2, [2, 3], []]]);
  assert.ok(plan.windows.every(({sourceBytes, bodyBytes}) => sourceBytes <= 200 && bodyBytes <= 320));
  assert.equal(plan.summary.budgetDeferredUnits, 0);
});

test("a resumed plan prioritizes the cursor and charges repeated source bytes to the visit", () => {
  const text = "The lamp shone. The gate opened. The wind rose. The path cleared.";
  const grant = grantFor(text);
  const limits = {maxRequests: 3, maxTargetsPerWindow: 1, maxOverlapUnits: 1, maxSourceBytes: 40};
  const plan = planWholeStoryContext(text, {grant, now, startId: 2, limits});
  assert.deepEqual(plan.windows.map(({targetIds, contextIds}) => [targetIds, contextIds]), [[[2], [1]]]);
  assert.equal(plan.summary.requests, 1);
  assert.equal(plan.summary.budgetDeferredUnits, 3);
  assert.ok(plan.summary.sourceBytes <= 40);
  assert.equal(plan.summary.sourceBytes, Buffer.byteLength("The gate opened.The wind rose."));
  const constrained = planWholeStoryContext(text, {grant, now, limits: {maxSourceBytes: 20}});
  assert.deepEqual(constrained.windows.map(window => window.targetIds), [[0]]);
  const noRequests = planWholeStoryContext(text, {grant, now, limits: {maxRequests: 0}});
  assert.equal(noRequests.summary.budgetDeferredUnits, 4);
  assert.throws(() => planWholeStoryContext(text, {grant, now, startId: 5}), /starting sentence/);
  assert.throws(() => planWholeStoryContext(text, {grant, now, limits: {maxRequests: 97}}), /bounded planner limits/);
});

test("the same approval mask supports bounded 12, 48 and 96 attempt replays", () => {
  const text = Array.from({length: 110}, (_, index) => `The room held chair ${index}.`).join("\n\n");
  const grant = grantFor(text);
  for (const maxRequests of [12, 48, 96]) {
    const plan = planWholeStoryContext(text, {grant, now, limits: {maxRequests, maxTargetsPerWindow: 1, maxOverlapUnits: 0}});
    assert.equal(plan.summary.approvedUnits, 110);
    assert.equal(plan.summary.requests, maxRequests);
    assert.equal(plan.summary.budgetDeferredUnits, 110 - maxRequests);
  }
});
