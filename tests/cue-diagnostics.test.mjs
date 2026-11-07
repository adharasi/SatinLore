import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {evaluateCueDiagnostics} from "../scripts/lib/cue-diagnostics.mjs";
import {buildCorpusDiagnosticTrace} from "../scripts/lib/corpus-diagnostic-trace.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const cue = (change = {}) => ({depiction: "romantic", frame: "current", activation: "cue", phase: "onset",
  transition: "none", evidenceIds: [0], knowledgeAtId: 0, ...change});
const quiet = (change = {}) => cue({depiction: "neutral", activation: "context", phase: "quiet", evidenceIds: [], ...change});
function fixture(expected = [cue()], predicted = [{status: "classified", causal: cue()}]) {
  const units = expected.map((label, id) => ({id, paragraph: id, unitSha256: hash(`neutral-unit-${id}`),
    reviewStatus: "resolved", status: "classified", causal: label, retrospective: label}));
  const reference = {datasetId: "neutral-diagnostic", rubricVersion: "test-v1", works: [{id: "w1", sourceSha256: hash("neutral-work"), units}]};
  const trace = {runId: "run1", datasetId: "neutral-diagnostic", referenceVersion: "test-v1", predictionVersion: "model-v1",
    works: [{id: "w1", sourceSha256: hash("neutral-work"), units: predicted.map((item, id) => ({id, unitSha256: units[id].unitSha256, ...item}))}], requests: []};
  return {reference, trace};
}

test("missing predictions remain missed cues in the frozen denominator", () => {
  const result = evaluateCueDiagnostics(fixture([cue(), cue({evidenceIds: [1], knowledgeAtId: 1})], [{status: "classified", causal: cue()}]));
  assert.deepEqual(result.summary.activation, {matched: 1, missed: 1, extra: 0, precision: 1, recall: 0.5, measured: true});
  assert.deepEqual(result.indexes.missedCues, ["w1:1"]);
  assert.equal(result.rows[1].diagnosis.reason, "unknown");
  assert.equal(result.rows[1].diagnosis.certainty, "unknown");
  assert.equal(result.summary.classifiedCoverage, 0.5);
});

test("a provider refusal and an application suppression are distinct from a semantic miss", () => {
  const input = fixture([cue(), cue({evidenceIds: [1]}), cue({evidenceIds: [2]})], [
    {status: "refused", requestIds: ["req1"]},
    {status: "classified", proposed: cue({evidenceIds: [1]}), applied: quiet(), failureCode: "confidence-filtered"},
    {status: "classified", causal: quiet({frame: "reported"})},
  ]);
  input.trace.requests = [{id: "req1", workId: "w1", status: "refused", targetIds: [0], contextIds: [], httpStatus: 200}];
  const result = evaluateCueDiagnostics(input);
  assert.deepEqual(result.rows.map(row => row.diagnosis.reason), ["provider-refused", "confidence-filtered", "model-negative"]);
  assert.equal(result.rows[2].mismatches.frame, true);
  assert.equal(result.rows[2].mismatches.phase, true);
  assert.equal(result.summary.proposedActivation.matched, 1);
  assert.equal(result.summary.activation.matched, 0);
  assert.deepEqual(result.rows[0].evidenceCoverage.missingRequiredIds, []);
});

test("eligibility coverage checks one provider window and preserves the observed cue diagnosis", () => {
  const input = fixture([quiet(), quiet(), quiet(), cue({evidenceIds: [3], knowledgeAtId: 3})], [
    {status: "classified", causal: quiet()},
    {status: "classified", causal: quiet()},
    {status: "classified", causal: quiet()},
    {status: "classified", causal: quiet(), requestIds: ["attempt1", "attempt2", "plan", "context-only"]},
  ]);
  input.reference.works[0].units[3].scopeEligibility = {causal: {
    status: "eligible", adult: "adult", consent: "present", capacity: "present", evidenceIds: [0, 1, 2],
  }};
  input.trace.requests = [
    {id: "attempt1", workId: "w1", targetIds: [3], contextIds: [0], windowDisposition: "provider-attempt"},
    {id: "attempt2", workId: "w1", targetIds: [3], contextIds: [1, 2], windowDisposition: "provider-attempt"},
    {id: "plan", workId: "w1", targetIds: [3], contextIds: [0, 1, 2], windowDisposition: "planned-only"},
    {id: "context-only", workId: "w1", targetIds: [2], contextIds: [0, 1, 3], windowDisposition: "provider-attempt"},
  ];
  const result = evaluateCueDiagnostics(input);
  const row = result.rows[3];
  assert.deepEqual(row.evidenceCoverage, {known: true, requiredIds: [3], missingRequiredIds: [], basis: "provider-attempt-window"});
  assert.deepEqual(row.eligibilityEvidenceCoverage, {
    known: true, requiredIds: [0, 1, 2], missingRequiredIds: [0], basis: "provider-attempt-window",
  });
  assert.deepEqual(row.diagnosis, {reason: "model-negative", stage: "classification", certainty: "observed-label-disagreement",
    hypotheses: ["reference-eligibility-evidence-absent-from-retained-window"]});
  assert.equal(result.summary.activation.missed, 1);
});

test("unknown references and protected references do not become ordinary negatives", () => {
  const input = fixture([cue(), quiet({activation: "protected"}), cue({activation: "review"})], [
    {status: "classified", causal: cue()}, {status: "classified", causal: cue()}, {status: "classified", causal: cue()},
  ]);
  input.reference.works[0].units[0].reviewStatus = "pending";
  const result = evaluateCueDiagnostics(input);
  assert.equal(result.summary.referenceUnknown, 2);
  assert.equal(result.summary.resolvedReferences, 1);
  assert.deepEqual(result.indexes.referenceUnknown, ["w1:0", "w1:2"]);
  assert.deepEqual(result.indexes.falseCues, ["w1:1"]);
  assert.equal(result.summary.activation.extra, 1);
  assert.equal(result.summary.activation.recall, null);
});

test("wrong transition kind counts as one missed and one false typed event", () => {
  const result = evaluateCueDiagnostics(fixture([quiet({transition: "stop", evidenceIds: [0]})],
    [{status: "classified", causal: quiet({transition: "scene-cut", evidenceIds: [0]})}]));
  assert.deepEqual(result.summary.transitions, {matched: 0, missed: 1, extra: 1, precision: 0, recall: 0, measured: true});
  assert.equal(result.rows[0].transitionResult, "wrong-type");
  assert.deepEqual(result.indexes.missedTransitions, ["w1:0"]);
  assert.deepEqual(result.indexes.falseTransitions, ["w1:0"]);
});

test("causal and retrospective labels are evaluated independently", () => {
  const input = fixture([cue()], [{status: "classified", causal: quiet(), retrospective: cue()}]);
  assert.equal(evaluateCueDiagnostics(input).summary.activation.recall, 0);
  assert.equal(evaluateCueDiagnostics({...input, scope: "retrospective"}).summary.activation.recall, 1);
});

test("source, unit, reference version and duplicate target errors are rejected", () => {
  for (const change of [
    input => { input.trace.works[0].sourceSha256 = hash("other-work"); },
    input => { input.trace.works[0].units[0].unitSha256 = hash("other-unit"); },
    input => { input.trace.referenceVersion = "other-reference"; },
    input => { input.trace.works[0].units.push({...input.trace.works[0].units[0]}); },
    input => { input.reference.works[0].units.push({...input.reference.works[0].units[0]}); },
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => evaluateCueDiagnostics(input), TypeError);
  }
});

test("all expected cues get an observed failure category or an explicit unknown", () => {
  const examples = [
    [{status: "not_admitted"}, "not-admitted"],
    [{status: "not_planned"}, "not-planned"],
    [{status: "budget_deferred"}, "budget-deferred"],
    [{status: "not_submitted"}, "not-submitted"],
    [{status: "cancelled"}, "cancelled"],
    [{status: "failed"}, "provider-error"],
    [{status: "truncated"}, "output-truncated"],
    [{status: "invalid"}, "schema-invalid"],
    [{status: "abstain"}, "model-abstained"],
    [{status: "uncertain"}, "model-uncertain"],
    [{status: "classified", causal: cue(), pipeline: {evidenceValid: false, applied: false}}, "evidence-invalid"],
    [{status: "classified", proposed: cue(), applied: quiet()}, "application-suppressed"],
    [{status: "classified", causal: quiet()}, "model-negative"],
  ];
  for (const [prediction, reason] of examples) {
    const result = evaluateCueDiagnostics(fixture([cue()], [prediction]));
    if (reason === "evidence-invalid") assert.equal(result.rows[0].diagnosis.reason, reason);
    else assert.equal(result.rows[0].diagnosis?.reason, reason);
    assert.equal(result.rows[0].cueResult, "missed");
  }
});

test("invalid provider label stays a validation miss without copying arbitrary output", () => {
  const input = fixture([cue()], [{status: "classified", causal: cue({phase: "PRIVATE_PROSE"}), rawOutput: "PRIVATE_PROSE"}]);
  const result = evaluateCueDiagnostics(input);
  assert.equal(result.rows[0].diagnosis.reason, "schema-invalid");
  assert.equal(JSON.stringify(result).includes("PRIVATE_PROSE"), false);
});

test("diagnostic exports whitelist metadata and preserve only categorical evidence", () => {
  const input = fixture([cue()], [{status: "failed", requestIds: ["req1"], text: "PRIVATE_SOURCE", headers: {authorization: "PRIVATE_SECRET"},
    rawResponse: "PRIVATE_PROVIDER_OUTPUT", failureCode: "UNTRUSTED_FAILURE_TEXT"}]);
  input.trace.requests = [{id: "req1", workId: "w1", status: "failed", error: "PRIVATE_ERROR", input: "PRIVATE_REQUEST_BODY",
    targetIds: [0], contextIds: [], headers: {authorization: "PRIVATE_SECRET"}, sourceText: "PRIVATE_SOURCE", elapsedMs: 12}];
  const result = evaluateCueDiagnostics(input);
  const encoded = JSON.stringify(result);
  for (const value of ["PRIVATE_", "UNTRUSTED_FAILURE_TEXT"]) assert.equal(encoded.includes(value), false);
  assert.equal(result.rows[0].prediction.requests[0].elapsedMs, 12);
  assert.equal(result.rows[0].diagnosis.reason, "provider-error");
});

test("a whole-work absence is distinct from a returned negative", () => {
  const input = fixture(); input.trace.works = [];
  const result = evaluateCueDiagnostics(input);
  assert.equal(result.rows[0].prediction.status, "missing");
  assert.equal(result.rows[0].cueResult, "missed");
  assert.equal(result.summary.returnedCoverage, 0);
  assert.equal(result.summary.activation.missed, 1);
});

test("graphic detail is scored for protected and review material without creating cues", () => {
  const input = fixture([
    quiet({depiction: "graphic", activation: "protected"}),
    quiet({depiction: "graphic", activation: "review", phase: "unknown"}),
    quiet({depiction: "explicit"}), quiet(),
  ], [
    {status: "classified", causal: quiet({depiction: "explicit", activation: "protected"})},
    {status: "uncertain", causal: quiet({depiction: "graphic", activation: "review", phase: "unknown"})},
    {status: "refused"}, {status: "failed"},
  ]);
  const result = evaluateCueDiagnostics(input);
  assert.equal(result.summary.referenceCues, 0);
  assert.equal(result.summary.referenceUnknown, 1);
  assert.equal(result.depiction.referenceKnown, 4);
  assert.deepEqual(result.depiction.graphic, {matched: 1, missed: 1, extra: 0, correctNegative: 0, unknownOnNegative: 2, precision: 1, recall: 0.5, measured: true});
  assert.equal(result.depiction.explicitOrGraphic.matched, 2);
  assert.equal(result.depiction.explicitOrGraphic.missed, 1);
  assert.equal(result.depiction.explicitOrGraphic.recall, 2 / 3);
  assert.equal(result.rows[0].depictionResult.graphicMiss, true);
  assert.equal(result.rows[1].depictionResult.graphicMiss, false);
  assert.equal(result.rows[1].cueResult, "reference-unknown");
});

test("row-global uncertainty does not erase a separately resolved retrospective cue", () => {
  const input = fixture([cue()], [{status: "classified", retrospective: cue(), causal: quiet()}]);
  const unit = input.reference.works[0].units[0];
  unit.status = "uncertain";
  unit.causal = cue({activation: "review", phase: "unknown", transition: "unknown", knowledgeAtId: null});
  unit.retrospective = cue({knowledgeAtId: 0});
  assert.equal(evaluateCueDiagnostics(input).summary.referenceUnknown, 1);
  assert.equal(evaluateCueDiagnostics({...input, scope: "retrospective"}).summary.activation.matched, 1);
});

test("noncurrent depicted cues remain semantic positives, without inventing a frame policy cause", () => {
  const input = fixture([cue({frame: "imagined", interaction: "depicted"})],
    [{status: "classified", causal: quiet({frame: "imagined", interaction: "mentioned"})}]);
  const result = evaluateCueDiagnostics(input);
  assert.equal(result.summary.referenceCues, 1);
  assert.equal(result.rows[0].diagnosis.reason, "model-negative");
  assert.equal(result.rows[0].mismatches.interaction, true);
  assert.equal(result.strata.frame.imagined.cues.missed, 1);
});

test("unknown reference transition is excluded from typed negatives independently of cue resolution", () => {
  const input = fixture([cue({transition: "unknown"})], [{status: "classified", causal: cue({transition: "scene-cut"})}]);
  const result = evaluateCueDiagnostics(input);
  assert.equal(result.summary.activation.matched, 1);
  assert.equal(result.summary.transitionReferenceUnknown, 1);
  assert.equal(result.summary.transitions.extra, 0);
  assert.equal(result.rows[0].transitionResult, "reference-unknown");
});

test("checkpoint adapts invalid causal evidence without dropping valid retrospective depiction", () => {
  const {reference} = fixture([cue({depiction: "graphic"})], []);
  const work = reference.works[0], proposed = cue({depiction: "graphic"});
  work.labels = work.units; delete work.units;
  const trace = buildCorpusDiagnosticTrace({reference, runId: "run1", batches: [{batchId: hash("req1"),
    runId: "run1", workId: "w1", sourceSha256: work.sourceSha256, role: "detector", referenceVersion: reference.rubricVersion,
    predictionVersion: "model-v1", measurement: "live-provider", status: "partial", httpStatus: 200, usage: {inputTokens: 200, outputTokens: 100},
    targetIds: [0], contextIds: [], rows: [{id: 0, unitSha256: work.labels[0].unitSha256, status: "partial",
      scopeStatus: {causal: "invalid", retrospective: "classified", eligibility: "valid"},
      validationErrors: {causal: "future_eligibility_evidence", retrospective: null, eligibility: null},
      proposed: {causal: proposed, retrospective: proposed}, causal: quiet({activation: "review", phase: "unknown", transition: "unknown", knowledgeAtId: null}),
      retrospective: proposed, failureCode: "future_eligibility_evidence", rawOutput: "PRIVATE_PROVIDER_OUTPUT"}]}]});
  const causal = evaluateCueDiagnostics({reference, trace}), retro = evaluateCueDiagnostics({reference, trace, scope: "retrospective"});
  assert.equal(causal.rows[0].diagnosis.reason, "evidence-invalid");
  assert.equal(causal.summary.activation.missed, 1);
  assert.equal(causal.summary.proposedActivation.matched, 1);
  assert.equal(causal.depiction.graphic.matched, 1);
  assert.equal(retro.summary.activation.matched, 1);
  assert.equal(retro.rows[0].prediction.failureCode, undefined);
  assert.equal(retro.rows[0].prediction.requests[0].inputTokens, 200);
  assert.equal(JSON.stringify(trace).includes("PRIVATE_PROVIDER_OUTPUT"), false);
});

test("unexecuted planned requests are tracked without claiming classifier quality or returned labels", () => {
  const {reference} = fixture([cue(), cue({evidenceIds: [1]})], []);
  const plan = [0, 1].map(id => ({batchId: hash(`plan${id}`), role: "detector", workId: "w1", targetIds: [id], contextIds: []}));
  const trace = buildCorpusDiagnosticTrace({reference, checkpoint: {runId: "run1", referenceVersion: reference.rubricVersion,
    batches: [], plannedBatches: plan, attempts: [{batchId: plan[0].batchId, role: "detector", runId: "run1", state: "deferred", code: "budget_exhausted"}]}});
  const result = evaluateCueDiagnostics({reference, trace});
  assert.equal(result.summary.activation.measured, false);
  assert.equal(result.summary.activation.recall, null);
  assert.equal(result.summary.traceCoverage, 1);
  assert.equal(result.summary.returnedCoverage, 0);
  assert.equal(result.summary.pipeline.planned.referenceCueYes, 2);
  assert.equal(result.summary.pipeline.submitted.referenceCueNo, 2);
  assert.deepEqual(result.rows.map(row => row.diagnosis.reason), ["budget-deferred", "not-submitted"]);
});

function retainedBatch(reference, row, overrides = {}) {
  const work = reference.works[0];
  return {batchId: hash("parser-result"), runId: "run1", workId: work.id, sourceSha256: work.sourceSha256,
    role: "detector", referenceVersion: reference.rubricVersion, predictionVersion: "model-v1", measurement: "live-provider",
    status: "partial", parserRevision: "v7-field-validation-2", dispatched: true, targetIds: [0], contextIds: [],
    rows: [{id: 0, unitSha256: work.units[0].unitSha256, ...row}], ...overrides};
}

test("field validation keeps a valid transition when the cue has invalid causal eligibility evidence", () => {
  const expected = cue({depiction: "graphic", transition: "stop"});
  const {reference} = fixture([expected], []);
  const issue = {rowIndex: 0, id: 0, field: "causal.activation", code: "future_eligibility_evidence", severity: "error"};
  const extraId = {rowIndex: 1, id: 44, field: "id", code: "unexpected_target_id", severity: "error"};
  const eligibility = {status: "eligible", adult: "adult", consent: "present", capacity: "present", evidenceIds: [1]};
  const batch = retainedBatch(reference, {
    status: "partial", failureCode: issue.code,
    causal: {...expected, activation: "review", phase: "unknown"}, retrospective: expected,
    scopeStatus: {causal: "invalid", retrospective: "classified", eligibility: "valid"},
    validationErrors: {causal: issue.code, retrospective: null, eligibility: null},
    fieldStatus: {causal: {activation: "unresolved", phase: "unresolved", depiction: "applied", transition: "applied"}},
    decodeIssues: [{...issue, prose: "PRIVATE_SOURCE"}, {...issue, code: "PRIVATE_CODE"}],
    proposed: {causal: expected, retrospective: expected, eligibility},
  }, {decodeIssues: [extraId]});
  const trace = buildCorpusDiagnosticTrace({reference, batches: [batch], runId: "run1"});
  const result = evaluateCueDiagnostics({reference, trace}), row = result.rows[0];
  assert.equal(row.cueResult, "missed");
  assert.equal(row.diagnosis.reason, "evidence-invalid");
  assert.equal(row.diagnosis.observedCode, issue.code);
  assert.equal(row.prediction.parserRevision, "v7-field-validation-2");
  assert.deepEqual(row.prediction.decodeIssues, [issue]);
  assert.deepEqual(row.prediction.requests[0].decodeIssues, [extraId]);
  assert.deepEqual(row.prediction.proposedEligibility, eligibility);
  assert.equal(row.prediction.fieldStatus.causal.activation, "unresolved");
  assert.equal(row.prediction.appliedFields.activation, undefined);
  assert.equal(row.prediction.appliedFields.transition, "stop");
  assert.equal(row.transitionResult, "matched");
  assert.equal(result.summary.transitions.matched, 1);
  assert.equal(result.depiction.graphic.matched, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);

  const retrospective = evaluateCueDiagnostics({reference, trace, scope: "retrospective"}).rows[0];
  assert.equal(retrospective.cueResult, "matched");
  assert.equal(retrospective.prediction.observedFailureCode, undefined);
  assert.equal(retrospective.prediction.rowFailureCode, issue.code);
});

test("optional metadata normalization stays separate from unresolved depiction and a cue disagreement", () => {
  const {reference} = fixture([cue({depiction: "graphic"})], []);
  const classified = quiet({depiction: "graphic"});
  const batch = retainedBatch(reference, {
    status: "partial", failureCode: "invalid_label_code", confidence: 0,
    causal: {...classified, depiction: "unknown"}, retrospective: classified,
    scopeStatus: {causal: "classified", retrospective: "classified", eligibility: "valid"},
    validationErrors: {causal: null, retrospective: null, eligibility: null},
    fieldStatus: {causal: {depiction: "unresolved", activation: "applied"}},
    decodeIssues: [
      {rowIndex: 0, id: 0, field: "causal.depiction", code: "invalid_label_code", severity: "error"},
      {rowIndex: 0, id: 0, field: "confidence", code: "missing_confidence", severity: "normalized"},
      {rowIndex: 0, id: 0, field: "reasonCodes", code: "invalid_reason_codes", severity: "normalized"},
    ],
    proposed: {causal: classified, retrospective: classified},
  });
  const trace = buildCorpusDiagnosticTrace({reference, batches: [batch], runId: "run1"});
  const result = evaluateCueDiagnostics({reference, trace}), row = result.rows[0];
  assert.equal(row.diagnosis.reason, "model-negative");
  assert.equal(row.prediction.applied.activation, "context");
  assert.equal(row.prediction.appliedFields.depiction, undefined);
  assert.equal(row.depictionResult.available, false);
  assert.equal(result.depiction.graphic.missed, 1);
  assert.deepEqual(row.prediction.confidence, {value: 0, scale: 100, normalized: true});
  assert.equal(row.prediction.decodeIssues.filter(issue => issue.severity === "normalized").length, 2);
});

test("new provider and client failure codes preserve their observed cause and stage", () => {
  const {reference} = fixture();
  const examples = [
    ["provider_key_rejected", "provider-key-rejected", "provider"],
    ["provider_model_access", "provider-model-access", "provider"],
    ["provider_model_mismatch", "provider-model-mismatch", "provider"],
    ["provider_billing_limit", "provider-billing-limit", "provider"],
    ["provider_request_rejected", "provider-request-rejected", "provider"],
    ["provider_rate_limit", "provider-rate-limit", "provider"],
    ["client_invalid_row", "schema-invalid", "validation"],
    ["client_transport_unknown", "client-transport-unknown", "transport"],
    ["provider_response_lost", "provider-response-lost", "transport"],
    ["admission_unavailable", "admission-unavailable", "admission"],
    ["settlement_unknown_dependency", "settlement-unknown-dependent", "admission"],
  ];
  for (const [code, reason, stage] of examples) {
    const blocked = code === "settlement_unknown_dependency";
    const batch = retainedBatch(reference, {status: "failed", failureCode: code}, blocked ?
      {measurement: "client-disposition", status: "settlement_unknown", dispatched: false} : {status: "http_error"});
    const trace = buildCorpusDiagnosticTrace({reference, batches: [batch], runId: "run1"});
    const {rows: [row]} = evaluateCueDiagnostics({reference, trace});
    assert.deepEqual(row.diagnosis, {reason, stage, certainty: "observed-pipeline-stage", observedCode: code});
    if (blocked) assert.equal(row.prediction.pipeline.admitted, false);
  }
});

test("a retained Worker result before provider dispatch remains unsent", () => {
  const {reference} = fixture();
  const batch = retainedBatch(reference, {status: "failed", failureCode: "provider_connection"},
    {status: "network_error", dispatched: false});
  const trace = buildCorpusDiagnosticTrace({reference, batches: [batch], runId: "run1"});
  const result = evaluateCueDiagnostics({reference, trace});
  assert.equal(result.rows[0].prediction.pipeline.submitted, false);
  assert.equal(result.rows[0].prediction.requests[0].dispatched, false);
  assert.equal(result.rows[0].evidenceCoverage.basis, "planned-window");
  assert.equal(result.summary.activation.measured, false);
});
