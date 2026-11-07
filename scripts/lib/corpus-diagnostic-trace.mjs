// Adapts source-free founder corpus checkpoints. This module never reads source
// files, calls a provider or interprets provider prose.
import {sourceFreeCueTraceFields} from "./cue-diagnostics.mjs";
import {corpusFailureCategory, corpusParserMetadata, observedCorpusCode} from "./corpus-diagnostic-metadata.mjs";

const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const token = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value) && !/^sk[-_]/u.test(value);
const ids = value => Array.isArray(value) && value.every(integer) && new Set(value).size === value.length;
const safeLabel = label => sourceFreeCueTraceFields({causal: label}).causal;

/**
 * Build a canonical trace from raw, source-free /corpus-study batch reports.
 * Missing batches remain missing. One role and one run are evaluated at once.
 * Repeated target outputs require a caller-selected separate evaluation run.
 */
export function buildCorpusDiagnosticTrace({reference, checkpoint, batches = checkpoint?.batches,
  runId = checkpoint?.runId, role = "detector", predictionVersion} = {}) {
  if (!reference || !Array.isArray(reference.works) || !Array.isArray(batches) || !token(runId) || !token(reference.datasetId) ||
      !token(reference.rubricVersion) || !["detector", "transition"].includes(role) ||
      checkpoint && (checkpoint.referenceVersion !== reference.rubricVersion || checkpoint.runId !== runId)) {
    throw new TypeError("Invalid corpus checkpoint trace inputs.");
  }
  const workById = new Map(), outputWorks = new Map();
  for (const work of reference.works) {
    const units = work.units ?? work.labels;
    if (!token(work.id) || workById.has(work.id) || !hash(work.sourceSha256) || !Array.isArray(units)) throw new TypeError("Invalid corpus trace reference work.");
    const unitsById = new Map(units.map(unit => [unit.id, unit]));
    if (unitsById.size !== units.length) throw new TypeError("Duplicate corpus trace reference target.");
    workById.set(work.id, {work, unitsById});
    outputWorks.set(work.id, {id: work.id, sourceSha256: work.sourceSha256, units: []});
  }
  const requests = [], seenBatches = new Set(), seenTargets = new Set(), versions = new Set();
  let attemptedProvider = false;
  for (const batch of batches) {
    if (batch.role !== role) continue;
    if (batch.runId !== runId || batch.referenceVersion !== reference.rubricVersion || !hash(batch.batchId) ||
        seenBatches.has(batch.batchId) || batch.measurement !== "client-disposition" && !token(batch.predictionVersion)) {
      throw new TypeError("Corpus checkpoint identity or reference mismatch.");
    }
    seenBatches.add(batch.batchId);
    const found = workById.get(batch.workId);
    if (!found || found.work.sourceSha256 !== batch.sourceSha256 || !ids(batch.targetIds) || !ids(batch.contextIds) || !Array.isArray(batch.rows)) {
      throw new TypeError("Invalid corpus checkpoint source or targets.");
    }
    if (token(batch.predictionVersion)) versions.add(batch.predictionVersion);
    const dispatched = batch.measurement === "live-provider" && (batch.dispatched ?? true) === true || batch.status === "response_lost";
    const blocked = ["refusal_blocked", "settlement_unknown"].includes(batch.status);
    const {parserRevision, decodeIssues, transport} = corpusParserMetadata(batch);
    attemptedProvider ||= dispatched;
    const targetIds = new Set(batch.targetIds);
    if (targetIds.size !== batch.targetIds.length || [...targetIds].some(id => !integer(id) || !found.unitsById.has(id))) {
      throw new TypeError("Unknown or duplicate corpus checkpoint target.");
    }
    const request = {id: batch.batchId, workId: batch.workId, windowId: batch.batchId, stage: "provider",
      status: batch.status === "parsed" ? "completed" : batch.status === "partial" ? "partial" : batch.status === "invalid_response" ? "invalid" :
        batch.status === "refused" ? "refused" : batch.status === "truncated" ? "truncated" :
          blocked ? "not-admitted" : batch.status === "unknown" ? "missing" : "failed",
      windowDisposition: dispatched ? "provider-attempt" : batch.status === "unknown" ? "unknown" : "planned-only",
      targetIds: [...batch.targetIds], contextIds: [...batch.contextIds]};
    if (parserRevision) request.parserRevision = parserRevision;
    if (decodeIssues) request.decodeIssues = decodeIssues;
    if (transport) request.transport = transport;
    if (batch.status === "response_lost") request.failureCode = "provider-response-lost";
    if (batch.status !== "unknown") request.dispatched = dispatched;
    if (batch.status === "timed_out") request.failureCode = "timeout";
    for (const key of ["httpStatus", "elapsedMs"]) if (integer(batch[key])) request[key] = batch[key];
    for (const key of ["inputTokens", "outputTokens"]) if (integer(batch.usage?.[key])) request[key] = batch.usage[key];
    if (integer(batch.maxOutputTokens)) request.maxOutputTokens = batch.maxOutputTokens;
    if (integer(batch.budget?.reservedMicros)) request.reservedMicros = batch.budget.reservedMicros;
    for (const key of ["settlementConfirmed", "usageMeasured"]) if (typeof batch.budget?.[key] === "boolean") request[key] = batch.budget[key];
    requests.push(request);
    const byId = new Map();
    for (const row of batch.rows) {
      if (!targetIds.has(row.id) || byId.has(row.id)) throw new TypeError("Unknown or duplicate retained corpus output.");
      byId.set(row.id, row);
    }
    for (const id of targetIds) {
      const key = `${batch.workId}:${id}`;
      if (seenTargets.has(key)) throw new TypeError("Target was evaluated twice in one selected role/run.");
      seenTargets.add(key);
      const expected = found.unitsById.get(id), raw = byId.get(id);
      if (raw && raw.unitSha256 !== expected.unitSha256) throw new TypeError("Corpus checkpoint unit hash mismatch.");
      const observedFailureCode = observedCorpusCode(raw?.failureCode);
      const failureCode = raw ? corpusFailureCategory(observedFailureCode) : "missing-output";
      const metadata = corpusParserMetadata(raw);
      const targetedBatchIssues = decodeIssues?.filter(issue => issue.id === id) ?? [];
      if (targetedBatchIssues.length) metadata.decodeIssues = [...(metadata.decodeIssues ?? []), ...targetedBatchIssues];
      if (parserRevision) metadata.parserRevision = parserRevision;
      const checked = raw && raw.failureCode === null;
      const status = raw?.status ?? "missing";
      if (!["classified", "uncertain", "refused", "failed", "partial", "not_submitted", "not-submitted", "missing"].includes(status)) {
        throw new TypeError("Invalid retained corpus output status.");
      }
      const scoped = raw?.scopeStatus ? ["causal", "retrospective"].map(scope => {
        const scopedStatus = raw.scopeStatus[scope];
        if (!["classified", "uncertain", "refused", "invalid"].includes(scopedStatus)) throw new TypeError("Invalid corpus checkpoint scope status.");
        const scopeError = metadata.validationErrors?.[scope];
        const failure = scopedStatus === "refused" ? "provider-refused" :
          corpusFailureCategory(scopeError) ?? (scopedStatus === "invalid" ? "schema-invalid" : null);
        return {scope, status: scopedStatus, failure, scopeError: scopeError ?? null,
          label: safeLabel(raw[scope]), proposed: safeLabel(raw.proposed?.[scope] ?? raw[scope])};
      }) : null;
      outputWorks.get(batch.workId).units.push({id, unitSha256: expected.unitSha256, status,
        ...(raw ? sourceFreeCueTraceFields(raw) : {}),
        ...metadata,
        requestIds: [batch.batchId],
        pipeline: {admitted: !blocked, planned: true,
          ...(batch.status !== "unknown" ? {submitted: dispatched} : {}), returned: Boolean(checked),
          validated: Boolean(checked), evidenceValid: Boolean(checked), applied: Boolean(checked && status === "classified")},
        ...(scoped ? {
          scopeStatus: Object.fromEntries(scoped.map(row => [row.scope, row.status])),
          scopeFailureCodes: Object.fromEntries(scoped.map(row => [row.scope, row.failure])),
          scopeObservedFailureCodes: Object.fromEntries(scoped.map(row => [row.scope, row.scopeError])),
          scopePipeline: Object.fromEntries(scoped.map(row => [row.scope, {returned: true,
            validated: row.status !== "invalid", evidenceValid: !["evidence-invalid", "evidence-missing"].includes(row.failure), applied: row.status === "classified"}])),
          proposed: {...Object.fromEntries(scoped.map(row => [row.scope, row.proposed])),
            eligibility: sourceFreeCueTraceFields(raw.proposed).eligibility},
          applied: Object.fromEntries(scoped.map(row => [row.scope, row.label])),
          depictionStatus: Object.fromEntries(scoped.map(row => [row.scope, row.status === "refused" ? "unknown" : "classified"])),
        } : {}),
        ...(observedFailureCode ? {observedFailureCode} : {}),
        ...(failureCode ? {failureCode} : {})});
    }
  }
  if (checkpoint) {
    const attemptById = new Map((checkpoint.attempts ?? []).filter(row => row.role === role && row.runId === runId).map(row => [row.batchId, row]));
    for (const plan of checkpoint.plannedBatches ?? []) {
      if (plan.role !== role || seenBatches.has(plan.batchId)) continue;
      const found = workById.get(plan.workId);
      if (!hash(plan.batchId) || !found || !ids(plan.targetIds) || !ids(plan.contextIds) || plan.targetIds.some(id => !found.unitsById.has(id))) {
        throw new TypeError("Invalid unexecuted corpus plan.");
      }
      const attempt = attemptById.get(plan.batchId), state = attempt?.state ?? "not-started";
      if (!["sending", "complete", "unknown", "blocked", "deferred", "not-started"].includes(state)) throw new TypeError("Invalid corpus attempt state.");
      const knownUnsubmitted = ["deferred", "not-started", "blocked"].includes(state);
      const observedFailureCode = state === "deferred" ? observedCorpusCode(attempt?.code) : undefined;
      const failureCode = state === "blocked" ? "refusal-dependent" : state === "complete" ? "retained-output-missing" :
        corpusFailureCategory(observedFailureCode) ?? (knownUnsubmitted ? "not-submitted" : "unknown");
      const status = state === "blocked" ? "not-admitted" : failureCode === "budget-deferred" ? "budget-deferred" : knownUnsubmitted ? "not-submitted" : "missing";
      requests.push({id: plan.batchId, workId: plan.workId, windowId: plan.batchId, stage: "planning", status, failureCode,
        attemptState: state, windowDisposition: knownUnsubmitted ? "planned-only" : "unknown", targetIds: [...plan.targetIds], contextIds: [...plan.contextIds]});
      seenBatches.add(plan.batchId);
      for (const id of plan.targetIds) {
        const key = `${plan.workId}:${id}`;
        if (seenTargets.has(key)) throw new TypeError("Target was planned twice in one selected role/run.");
        seenTargets.add(key);
        outputWorks.get(plan.workId).units.push({id, unitSha256: found.unitsById.get(id).unitSha256, status,
          failureCode, ...(observedFailureCode ? {observedFailureCode} : {}), requestIds: [plan.batchId], pipeline: {admitted: state !== "blocked", planned: true,
            ...(knownUnsubmitted ? {submitted: false, returned: false} : {})}});
      }
    }
  }
  if (versions.size > 1 || predictionVersion !== undefined && versions.size && !versions.has(predictionVersion)) {
    throw new TypeError("Mixed corpus prediction versions require separate evaluations.");
  }
  return {schema: 1, datasetId: reference.datasetId, referenceVersion: reference.rubricVersion, runId,
    granularity: "exact-source-unit-classification",
    ...(!attemptedProvider ? {supportedPredictionFields: []} : {}),
    predictionVersion: predictionVersion ?? [...versions][0] ?? `${role}-not-run`, role,
    works: [...outputWorks.values()].map(work => ({...work, units: work.units.sort((a, b) => a.id - b.id)})), requests};
}
