import assert from "node:assert/strict";
import test from "node:test";
import {decodeCorpusCompactResponse, inspectCorpusCompactResponse} from "../deploy/cloudflare/corpus-study-contract.mjs";
import {parseCorpusProvider} from "../deploy/cloudflare/corpus-study.mjs";

const depicted = () => ({d: "r", f: "i", b: "d", a: "q", p: "b", t: "n", v: [1, 3], k: 3});
const quiet = () => ({d: "s", f: "r", b: "m", a: "c", p: "q", t: "n", v: [], k: null});
const row = () => ({i: 3, s: "c", c: depicted(), r: null,
  e: {s: "e", a: "a", c: "p", k: "p", v: [1]}, q: 90, z: [0]});

test("keeps typed cues when evidence ordering and optional metadata need normalization", () => {
  const input = row();
  input.c.v = [3, 1, 3];
  input.e.v = [2, 1, 2];
  input.q = 108;
  input.z = [0, 0, 2, 1, 3, 4, "untrusted-free-text"];
  const inspected = inspectCorpusCompactResponse({rows: [input]});
  assert.equal(inspected.fatalCode, null);
  assert.ok(inspected.issues.every(issue => issue.severity === "normalized"));
  assert.ok(inspected.issues.some(issue => issue.field === "causal.evidenceIds" && issue.code === "unsorted_evidence_ids"));
  assert.ok(inspected.issues.some(issue => issue.field === "eligibility.evidenceIds" && issue.code === "duplicate_evidence_ids"));
  assert.ok(inspected.issues.some(issue => issue.code === "invalid_confidence"));
  assert.doesNotMatch(JSON.stringify(inspected), /untrusted-free-text/u);
  const decoded = decodeCorpusCompactResponse({rows: [input]}).rows[0];
  assert.equal(decoded.causal.activation, "cue");
  assert.equal(decoded.causal.frame, "imagined");
  assert.deepEqual(decoded.causal.evidenceIds, [1, 3]);
  assert.deepEqual(decoded.retrospective.evidenceIds, [1, 3]);
  assert.deepEqual(decoded.eligibility.evidenceIds, [1, 2]);
  assert.equal(decoded.confidence, 0);
  assert.equal(decoded.reasonCodes.length, 4);
});

test("keeps a noncue with nullable eligibility and missing optional metadata", () => {
  const input = {i: 3, s: "c", c: quiet(), r: null, e: null};
  const inspected = inspectCorpusCompactResponse({rows: [input]});
  assert.deepEqual(inspected.issues.map(issue => issue.code), ["missing_eligibility", "missing_confidence", "missing_reason_codes"]);
  assert.equal(inspected.rows[0].causal.activation, "context");
  assert.equal(inspected.rows[0].eligibility.status, "uncertain");
  assert.deepEqual(inspected.rows[0].eligibility.evidenceIds, []);
  const plain = decodeCorpusCompactResponse({rows: [{...input, c: "n"}]}).rows[0];
  assert.equal(plain.eligibility.adult, "not_applicable");
});

test("flags a bad scope field without discarding a separately valid scope", () => {
  const input = row();
  input.c.p = "untrusted-free-text";
  input.r = depicted();
  const inspected = inspectCorpusCompactResponse({rows: [input]});
  assert.deepEqual(inspected.issues, [{rowIndex: 0, id: 3, field: "causal.phase", code: "invalid_label_code", severity: "error"}]);
  assert.equal(inspected.rows[0].causal.depiction, "romantic");
  assert.equal(inspected.rows[0].causal.phase, "unknown");
  assert.equal(inspected.rows[0].retrospective.phase, "build");
  assert.equal(decodeCorpusCompactResponse({rows: [input]}), null);
  assert.doesNotMatch(JSON.stringify(inspected), /untrusted-free-text/u);
});

test("rejects malformed evidence instead of filtering it into a usable claim", () => {
  const input = row();
  input.c.v = [1, 3, "untrusted-free-text"];
  const inspected = inspectCorpusCompactResponse({rows: [input]});
  assert.deepEqual(inspected.issues.map(issue => [issue.field, issue.code, issue.severity]), [
    ["causal.evidenceIds", "invalid_evidence_id", "error"],
    ["retrospective.evidenceIds", "invalid_evidence_id", "error"],
  ]);
  assert.deepEqual(inspected.rows[0].causal.evidenceIds, []);
  assert.equal(decodeCorpusCompactResponse({rows: [input]}), null);
});

test("nullable eligibility cannot authorize a cue or erase an independent quiet scope", () => {
  const input = {...row(), r: quiet(), e: null};
  const provider = {status: "completed", output: [{type: "message", role: "assistant", content: [
    {type: "output_text", text: JSON.stringify({rows: [input]})},
  ]}]};
  const batch = {units: [{id: 1, target: false}, {id: 3, target: true, unitSha256: "3".repeat(64)}]};
  const result = parseCorpusProvider(provider, batch).rows[0];
  assert.equal(result.status, "partial");
  assert.equal(result.failureCode, "cue_invariant");
  assert.equal(result.causal.activation, "review");
  assert.equal(result.retrospective.activation, "context");
  assert.equal(result.eligibility.status, "uncertain");
});
