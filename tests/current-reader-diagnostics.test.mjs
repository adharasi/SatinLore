import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {buildSceneUnits} from "../app/static/reader/scene-map.mjs";
import {traceCurrentReaderCorpus} from "../scripts/lib/current-reader-diagnostics.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
function inputs(paragraphs) {
  const source = paragraphs.join("\n\n"), sourceSha256 = hash(source);
  const units = buildSceneUnits(paragraphs);
  const indexSha256 = hash(JSON.stringify(units.map(({text, ...unit}) => ({...unit, unitSha256: hash(text)}))));
  return [{schema: 1, referenceVersion: "v7", works: [{id: "neutral-fixture", family: "neutral", sourceSha256, indexSha256,
    units: units.map(unit => ({...unit, admission: "approved"}))}]},
  {schema: 1, works: [{id: "neutral-fixture", sourceSha256, indexSha256, canonicalEditionSha256: sourceSha256,
    paragraphs: paragraphs.map((text, id) => ({id, text, sha256: hash(text)}))}]}];
}

test("reports the real paragraph projection and omits source prose", () => {
  const paragraphs = ["The lamp stood beside them. She kissed him back.", "They opened the timetable."];
  const result = traceCurrentReaderCorpus(...inputs(paragraphs));
  const rows = result.loom.works[0].units;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].applied.causal.activation, "cue");
  assert.equal(rows[1].applied.causal.activation, "cue");
  assert.equal(rows[0].local.localization, "paragraph-projection");
  assert.equal(rows[0].applied.causal.depiction, "unknown");
  assert.equal(rows[0].applied.causal.transition, "unknown");
  assert.equal(result.loom.externalCalls, 0);
  assert.equal(result.loom.referenceVersion, "2026-11-07-full-corpus-v7");
  assert.equal(result.loom.sourcePackReferenceVersion, "v7");
  assert.equal(JSON.stringify(result).includes("The lamp stood beside them"), false);
  assert.equal(JSON.stringify(result).includes('"text"'), false);
});

test("context selection stays unsubmitted and a quiet boundary preserves its exclusion", () => {
  const result = traceCurrentReaderCorpus(...inputs(["She kissed him back.", "The next morning, they opened the timetable."]));
  const [selected, boundary] = result.context.works[0].units;
  assert.equal(selected.status, "not-submitted");
  assert.equal(selected.pipeline.planned, true);
  assert.equal(selected.pipeline.submitted, false);
  assert.equal(selected.applied, null);
  assert.equal(boundary.status, "not-planned");
  assert.equal(boundary.failureCode, "boundary-suppressed");
  assert.equal(boundary.planning.exclusion, "boundary-suppressed");
  assert.equal(result.context.requests[0].status, "not-submitted");
});

test("oversized paragraphs are input-limit exclusions rather than provider negatives", () => {
  const result = traceCurrentReaderCorpus(...inputs(["The room had a lamp. ".repeat(200).trim()]));
  assert(result.context.works[0].units.every(row => row.status === "not-planned" &&
    row.planning.exclusion === "paragraph-byte-limit"));
  assert.equal(result.context.requests.length, 0);
});

test("the current visit cap is visible separately from uncapped planner demand", () => {
  const result = traceCurrentReaderCorpus(...inputs(Array.from({length: 850}, () => "A person entered the reading room.")));
  const row = result.summary.rows[0];
  assert.equal(row.contextPlanning.requests, 12);
  assert(row.contextPlanning.uncappedRequests > 12);
  assert(result.context.works[0].units.some(unit => unit.status === "budget-deferred" &&
    unit.planning.exclusion === "session-request-limit"));
});

test("rejects source and index mismatches before issuing a trace", () => {
  const [pack, sidecar] = inputs(["They opened the timetable."]);
  pack.works[0].units[0].text = "They closed the timetable.";
  assert.throws(() => traceCurrentReaderCorpus(pack, sidecar), /identity changed/u);
  sidecar.works[0].paragraphs[0].sha256 = "0".repeat(64);
  assert.throws(() => traceCurrentReaderCorpus(pack, sidecar), /paragraph hash mismatch/u);
});
