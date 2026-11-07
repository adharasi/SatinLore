// Offline evaluation only. Never copies source prose, raw provider output,
// headers, error messages or arbitrary metadata into a diagnostic report.
import {corpusParserMetadata, observedCorpusCode} from "./corpus-diagnostic-metadata.mjs";

const labels = {
  depiction: new Set(["neutral", "romantic", "suggestive", "explicit", "graphic", "unknown"]),
  frame: new Set(["current", "reported", "imagined", "remembered", "neutral", "mixed", "uncertain"]),
  activation: new Set(["cue", "context", "protected", "review", "unknown"]),
  interaction: new Set(["none", "mentioned", "depicted", "uncertain"]),
  action: new Set(["none", "anticipation", "contact", "continuation", "change", "release", "unknown"]),
  phase: new Set(["quiet", "build", "onset", "sustain", "accent", "ease", "recover", "restart", "unknown"]),
  transition: new Set(["none", "stop", "interruption", "present-return", "scene-cut", "reported-entry",
    "imagined-entry", "memory-entry", "uncertain-continuity", "declined-restart", "non-romantic-activity-stop", "unknown"]),
};
const statuses = new Set(["classified", "uncertain", "abstain", "refused", "failed", "invalid", "truncated",
  "missing", "not-submitted", "not-admitted", "not-planned", "budget-deferred", "cancelled", "partial"]);
const requestStatuses = new Set([...statuses, "completed", "parsed", "annotated", "reserved", "running", "invalid-map"]);
const stages = new Set(["admission", "planning", "budget", "submission", "provider", "decoding", "validation",
  "evidence", "application", "classification", "unknown"]);
const reasons = new Map([
  ["not-admitted", "admission"], ["not-planned", "planning"], ["budget-deferred", "budget"],
  ["not-submitted", "submission"], ["cancelled", "submission"], ["timeout", "provider"],
  ["provider-refused", "provider"], ["provider-error", "provider"], ["output-truncated", "decoding"],
  ["schema-invalid", "validation"], ["missing-output", "decoding"], ["model-abstained", "classification"],
  ["model-uncertain", "classification"], ["evidence-missing", "evidence"], ["evidence-invalid", "evidence"],
  ["safety-filtered", "application"], ["confidence-filtered", "application"], ["boundary-suppressed", "application"],
  ["frame-filtered", "application"], ["frame-policy-suppression", "application"], ["application-suppressed", "application"], ["model-negative", "classification"],
  ["refusal-dependent", "admission"], ["retained-output-missing", "decoding"],
  ["provider-rate-limit", "provider"], ["provider-key-rejected", "provider"], ["provider-model-access", "provider"],
  ["provider-model-mismatch", "provider"], ["provider-billing-limit", "provider"], ["provider-request-rejected", "provider"],
  ["settlement-unknown-dependent", "admission"], ["admission-unavailable", "admission"], ["budget-unavailable", "budget"],
  ["concurrency-limited", "submission"], ["client-transport-unknown", "submission"], ["unknown", "unknown"],
]);
const eligibilityValues = {
  status: new Set(["eligible", "protected", "uncertain"]),
  adult: new Set(["adult", "minor", "uncertain", "not_applicable"]),
  consent: new Set(["present", "withdrawn", "absent", "uncertain", "not_applicable"]),
  capacity: new Set(["present", "absent", "uncertain", "not_applicable"]),
};
const labelReasons = new Set(["grounded-current", "context-supported-continuation", "neutral-context", "noncurrent-frame",
  "mention-only", "nonromantic-activity", "mixed-unit", "hard-stop", "scene-boundary", "frame-transition", "declined-restart",
  "adult-status-uncertain", "consent-withdrawn", "consent-uncertain", "capacity-uncertain", "protected-content", "scope-uncertain",
  "insufficient-context", "evidence-outside-window", "ambiguous-language", "unsupported-language", "reference-disagreement",
  "provider-refusal", "causal-projection", "evidence-after-target", "depicted-noncurrent-interaction"]);
const localReasons = new Set(["no-keyword-match", "boundary-or-rest", "uncertain-or-speculative", "sensitive-wording",
  "contact-context-match", "affectionate-action-match", "movement-ended", "scene-grouping-rule", "uncertain-contact-wording"]);
const planningExclusions = new Set(["session-source-byte-limit", "boundary-suppressed", "application-suppressed", "safety-filtered",
  "not-admitted", "not-planned", "budget-deferred", "window-source-byte-limit", "window-request-limit", "paragraph-byte-limit",
  "session-request-limit", "planner-window-or-body-limit"]);
const pipelineFields = ["admitted", "planned", "submitted", "returned", "validated", "evidenceValid", "applied"];
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value && typeof value === "object" && !Array.isArray(value);
const ratio = (a, b) => b ? a / b : null;
const ids = value => Array.isArray(value) && value.every(integer) && new Set(value).size === value.length;
const token = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value) && !/^sk[-_]/u.test(value);
const status = value => typeof value === "string" ? value.replaceAll("_", "-") : undefined;
const count = (target, key) => { target[key] = (target[key] ?? 0) + 1; };

function identity(value, name) {
  if (!token(value)) throw new TypeError(`Invalid diagnostic ${name}.`);
  return value;
}

function checkedLabel(value, {required = false} = {}) {
  if (!object(value)) {
    if (required) throw new TypeError("Reference label is missing.");
    return null;
  }
  const result = {};
  for (const [field, choices] of Object.entries(labels)) {
    if (value[field] === undefined && ["action", "interaction"].includes(field)) continue;
    if (!choices.has(value[field])) {
      if (required) throw new TypeError("Invalid reference label category.");
      return null;
    }
    result[field] = value[field];
  }
  if (!ids(value.evidenceIds ?? [])) {
    if (required) throw new TypeError("Invalid reference evidence IDs.");
    return null;
  }
  result.evidenceIds = [...(value.evidenceIds ?? [])];
  if (value.knowledgeAtId !== undefined) {
    if (!(value.knowledgeAtId === null || integer(value.knowledgeAtId))) {
      if (required) throw new TypeError("Invalid reference knowledge anchor.");
      return null;
    }
    result.knowledgeAtId = value.knowledgeAtId;
  }
  return result;
}

function referenceLabel(unit, scope) {
  return unit[scope] ?? unit.label;
}

function referenceResolved(unit, label, scope) {
  const declared = status(unit.scopeStatus?.[scope] ?? unit.reviewStatus ?? unit.adjudication?.status);
  return !["pending", "unreviewed", "unresolved", "refused", "not-submitted", "failed", "uncertain", "missing"].includes(declared) &&
    !["refused", "failed", "not-submitted", "missing", "abstain"].includes(status(unit.status)) &&
    label && label.activation !== "review" && label.activation !== "unknown";
}

function cleanEligibility(value) {
  if (!object(value) || Object.entries(eligibilityValues).some(([field, choices]) => !choices.has(value[field])) || !ids(value.evidenceIds ?? [])) return null;
  return {...Object.fromEntries(Object.keys(eligibilityValues).map(field => [field, value[field]])), evidenceIds: [...(value.evidenceIds ?? [])]};
}
const cleanReasons = value => Array.isArray(value) ? [...new Set(value.filter(item => labelReasons.has(item)))].slice(0, 4) : [];

/** Keep only typed categorical fields from a retained annotation. */
export function sourceFreeCueTraceFields(value) {
  const result = {};
  for (const scope of ["causal", "retrospective"]) {
    const label = checkedLabel(value?.[scope]);
    if (label) result[scope] = label;
  }
  const eligibility = cleanEligibility(value?.eligibility);
  if (eligibility) result.eligibility = eligibility;
  if (Number.isInteger(value?.confidence) && value.confidence >= 0 && value.confidence <= 100) result.confidence = value.confidence;
  result.reasonCodes = cleanReasons(value?.reasonCodes);
  return result;
}

function cleanPipeline(value = {}) {
  const result = {};
  for (const key of pipelineFields) {
    if (typeof value[key] === "boolean") result[key] = value[key];
  }
  return result;
}

function cleanRequest(value) {
  if (!object(value)) throw new TypeError("Invalid diagnostic request.");
  const result = {id: identity(value.id, "request ID")};
  for (const key of ["workId", "windowId"]) if (value[key] !== undefined) result[key] = identity(value[key], key);
  if (value.stage !== undefined && stages.has(value.stage)) result.stage = value.stage;
  if (requestStatuses.has(status(value.status))) result.status = status(value.status);
  if (reasons.has(value.failureCode)) result.failureCode = value.failureCode;
  for (const key of ["targetIds", "contextIds"]) {
    if (value[key] !== undefined) {
      if (!ids(value[key])) throw new TypeError("Invalid diagnostic window IDs.");
      result[key] = [...value[key]];
    }
  }
  for (const key of ["attempt", "elapsedMs", "inputTokens", "outputTokens", "maxOutputTokens", "reservedMicros"]) {
    if (value[key] !== undefined) {
      if (!integer(value[key])) throw new TypeError("Invalid diagnostic request measurement.");
      result[key] = value[key];
    }
  }
  for (const key of ["settlementConfirmed", "usageMeasured", "dispatched"]) if (typeof value[key] === "boolean") result[key] = value[key];
  if (Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  if (["completed", "max-output-tokens", "content-filter", "unknown"].includes(status(value.finishReason))) result.finishReason = status(value.finishReason);
  if (["sending", "complete", "unknown", "blocked", "deferred", "not-started"].includes(value.attemptState)) result.attemptState = value.attemptState;
  if (["provider-attempt", "planned-only", "unknown"].includes(value.windowDisposition)) result.windowDisposition = value.windowDisposition;
  const {parserRevision, decodeIssues} = corpusParserMetadata(value);
  if (parserRevision) result.parserRevision = parserRevision;
  if (decodeIssues) result.decodeIssues = decodeIssues;
  return result;
}

function normalizePrediction(unit, scope, requests) {
  if (!unit) return {status: "missing", proposed: null, applied: null, requestIds: [], requests: [], pipeline: {}};
  const rowStatus = status(unit.status);
  const currentStatus = status(unit.scopeStatus?.[scope] ?? rowStatus);
  if (!statuses.has(rowStatus) || !statuses.has(currentStatus)) throw new TypeError("Invalid prediction trace status.");
  const proposedInput = unit.proposed?.[scope] ?? unit.proposed ?? unit[scope] ?? unit.label;
  const proposed = checkedLabel(proposedInput);
  const hasApplied = Object.hasOwn(unit, "applied");
  const pipeline = cleanPipeline({...unit.pipeline, ...unit.scopePipeline?.[scope]});
  const appliedInput = hasApplied ? unit.applied?.[scope] ?? unit.applied : proposedInput;
  const selectedApplied = checkedLabel(appliedInput);
  const applied = currentStatus === "classified" && pipeline.applied !== false ? selectedApplied : null;
  const requestIds = unit.requestIds ?? [];
  if (!Array.isArray(requestIds) || new Set(requestIds).size !== requestIds.length || requestIds.some(id => !token(id) || !requests.has(id))) {
    throw new TypeError("Unresolved diagnostic request ID.");
  }
  const result = {status: currentStatus, rowStatus, proposed, applied, requestIds: [...requestIds],
    requests: requestIds.map(id => requests.get(id)), pipeline,
    eligibility: cleanEligibility(unit.eligibility), reasonCodes: cleanReasons(unit.reasonCodes), ...corpusParserMetadata(unit)};
  const proposedEligibility = cleanEligibility(unit.proposed?.eligibility);
  if (proposedEligibility) result.proposedEligibility = proposedEligibility;
  if (unit.local && localReasons.has(unit.local.reasonCode)) {
    result.local = {reasonCode: unit.local.reasonCode};
    for (const field of ["level", "rawLevel"]) if (integer(unit.local[field]) && unit.local[field] <= 20) result.local[field] = unit.local[field];
    for (const field of ["quiet", "cloudExcluded", "currentCue"]) if (typeof unit.local[field] === "boolean") result.local[field] = unit.local[field];
  }
  if (object(unit.planning)) {
    result.planning = {};
    for (const field of ["selected", "uncappedSelected"]) if (typeof unit.planning[field] === "boolean") result.planning[field] = unit.planning[field];
    if (unit.planning.exclusion === null || planningExclusions.has(unit.planning.exclusion)) result.planning.exclusion = unit.planning.exclusion;
    if (integer(unit.planning.paragraphBytes)) result.planning.paragraphBytes = unit.planning.paragraphBytes;
  }
  const fields = result.fieldStatus?.[scope];
  result.appliedFields = {};
  if (selectedApplied && ["classified", "invalid", "uncertain"].includes(currentStatus)) {
    for (const field of Object.keys(labels)) {
      if (selectedApplied[field] !== undefined && fields?.[field] !== "unresolved" && (applied || fields?.[field] === "applied")) {
        result.appliedFields[field] = selectedApplied[field];
      }
    }
  }
  const depiction = result.appliedFields.depiction ?? proposedInput?.depiction;
  result.depiction = labels.depiction.has(depiction) ? depiction : "unknown";
  result.depictionAvailable = result.depiction !== "unknown" &&
    (fields?.depiction !== undefined ? result.appliedFields.depiction !== undefined :
      ["classified", "uncertain", "abstain"].includes(currentStatus) && pipeline.validated !== false ||
        currentStatus === "invalid" && unit.depictionStatus?.[scope] === "classified");
  const failureCode = Object.hasOwn(unit.scopeFailureCodes ?? {}, scope) ? unit.scopeFailureCodes[scope] : unit.failureCode;
  if (reasons.has(failureCode)) result.failureCode = failureCode;
  const observedFailureCode = observedCorpusCode(Object.hasOwn(unit.scopeObservedFailureCodes ?? {}, scope) ?
    unit.scopeObservedFailureCodes[scope] : unit.observedFailureCode);
  if (observedFailureCode) result.observedFailureCode = observedFailureCode;
  const rowFailureCode = observedCorpusCode(unit.observedFailureCode);
  if (rowFailureCode) result.rowFailureCode = rowFailureCode;
  if (unit.confidenceScale === "fraction" && typeof unit.confidence === "number" && Number.isFinite(unit.confidence) && unit.confidence >= 0 && unit.confidence <= 1) {
    result.confidence = {value: unit.confidence, scale: 1};
  } else if (Number.isInteger(unit.confidence) && unit.confidence >= 0 && unit.confidence <= 100) {
    result.confidence = {value: unit.confidence, scale: 100};
  }
  if (result.confidence && result.decodeIssues?.some(issue => issue.field === "confidence" && issue.severity === "normalized")) {
    result.confidence.normalized = true;
  }
  if (currentStatus === "classified" && (!proposed || hasApplied && unit.applied !== null && !selectedApplied)) {
    result.failureCode = "schema-invalid";
    result.applied = null;
    result.appliedFields = {};
    result.depictionAvailable = false;
  }
  return result;
}

function failureOf(prediction) {
  const {pipeline, requests} = prediction;
  if (prediction.failureCode) return prediction.failureCode;
  if (pipeline.admitted === false || prediction.status === "not-admitted") return "not-admitted";
  if (prediction.status === "budget-deferred" || requests.some(row => row.status === "budget-deferred")) return "budget-deferred";
  if (pipeline.planned === false || prediction.status === "not-planned") return "not-planned";
  if (prediction.status === "cancelled" || requests.some(row => row.status === "cancelled")) return "cancelled";
  if (pipeline.submitted === false || prediction.status === "not-submitted") return "not-submitted";
  if (prediction.status === "refused" || requests.some(row => row.status === "refused" || row.failureCode === "provider-refused" || row.finishReason === "content-filter")) return "provider-refused";
  if (requests.some(row => row.failureCode === "timeout")) return "timeout";
  if (prediction.status === "failed" || requests.some(row => row.httpStatus >= 400 || row.status === "failed")) return "provider-error";
  if (prediction.status === "truncated" || requests.some(row => row.finishReason === "max-output-tokens" || row.status === "truncated")) return "output-truncated";
  if (pipeline.validated === false || prediction.status === "invalid" || requests.some(row => row.status === "invalid-map")) return "schema-invalid";
  if (prediction.status === "abstain") return "model-abstained";
  if (prediction.status === "uncertain") return "model-uncertain";
  if (pipeline.evidenceValid === false) return "evidence-invalid";
  if (prediction.proposed?.activation === "cue" && prediction.proposed.evidenceIds.length === 0) return "evidence-missing";
  if (prediction.proposed?.activation === "cue" && prediction.applied?.activation !== "cue") return "application-suppressed";
  if (prediction.status === "classified" && prediction.proposed) return "model-negative";
  if (pipeline.returned === false || prediction.status === "missing") return prediction.requests.length ? "missing-output" : "unknown";
  return "unknown";
}

function binary() { return {matched: 0, missed: 0, extra: 0}; }
function score(counts, expected, predicted) {
  if (expected && predicted) counts.matched++;
  else if (expected) counts.missed++;
  else if (predicted) counts.extra++;
}
function report(counts) {
  return {...counts, precision: ratio(counts.matched, counts.matched + counts.extra),
    recall: ratio(counts.matched, counts.matched + counts.missed)};
}
const measuredReport = (counts, measured) => ({...report(counts), measured,
  ...(!measured ? {precision: null, recall: null} : {})});

function detailCounts() {
  return {targets: 0, referenceKnown: 0, referenceUnknown: 0, predictionKnown: 0, predictionUnknown: 0,
    graphic: {...binary(), correctNegative: 0, unknownOnNegative: 0},
    explicitOrGraphic: {...binary(), correctNegative: 0, unknownOnNegative: 0},
    exact: {matched: 0, total: 0}, confusion: {}};
}
function scoreDetail(counts, expected, predicted, available) {
  counts.targets++;
  if (!labels.depiction.has(expected) || expected === "unknown") { counts.referenceUnknown++; return; }
  counts.referenceKnown++; counts.predictionKnown += Number(available); counts.predictionUnknown += Number(!available);
  counts.exact.total++; counts.exact.matched += Number(available && expected === predicted);
  const confusion = counts.confusion[expected] ??= {};
  count(confusion, available ? predicted : "unavailable");
  for (const [field, positive] of [["graphic", new Set(["graphic"])], ["explicitOrGraphic", new Set(["explicit", "graphic"])]]) {
    const expectedPositive = positive.has(expected), predictedPositive = available && positive.has(predicted);
    score(counts[field], expectedPositive, predictedPositive);
    counts[field].correctNegative += Number(!expectedPositive && available && !predictedPositive);
    counts[field].unknownOnNegative += Number(!expectedPositive && !available);
  }
}
function reportDetails(counts, measured) {
  return {...counts, measured, graphic: measuredReport(counts.graphic, measured), explicitOrGraphic: measuredReport(counts.explicitOrGraphic, measured),
    exact: {...counts.exact, accuracy: measured ? ratio(counts.exact.matched, counts.exact.total) : null},
    knownPredictionCoverage: ratio(counts.predictionKnown, counts.referenceKnown)};
}

/**
 * Evaluate frozen exact-unit references against retained prediction traces.
 * A missing prediction stays in the positive reference denominator. Unknown
 * reference labels are separately counted and never silently become negatives.
 */
export function evaluateCueDiagnostics({reference, trace, scope = "causal"} = {}) {
  if (!["causal", "retrospective"].includes(scope) || !object(reference) || !object(trace) ||
      !Array.isArray(reference.works) || !Array.isArray(trace.works)) throw new TypeError("Invalid diagnostic inputs.");
  const datasetId = identity(reference.datasetId, "dataset ID");
  const referenceVersion = identity(reference.rubricVersion ?? reference.referenceVersion, "reference version");
  if (trace.datasetId !== datasetId || trace.referenceVersion !== referenceVersion) throw new TypeError("Diagnostic dataset or reference version mismatch.");
  const runId = identity(trace.runId, "run ID");
  const predictionVersion = identity(trace.predictionVersion, "prediction version");
  if (trace.supportedPredictionFields !== undefined && (!Array.isArray(trace.supportedPredictionFields) ||
      new Set(trace.supportedPredictionFields).size !== trace.supportedPredictionFields.length ||
      trace.supportedPredictionFields.some(field => !Object.hasOwn(labels, field)))) throw new TypeError("Invalid supported prediction fields.");
  const supported = new Set(trace.supportedPredictionFields ?? Object.keys(labels));
  const requests = new Map();
  for (const item of trace.requests ?? []) {
    const row = cleanRequest(item);
    if (requests.has(row.id)) throw new TypeError("Duplicate diagnostic request ID.");
    requests.set(row.id, row);
  }
  const observedWorks = new Map();
  for (const work of trace.works) {
    identity(work.id, "work ID");
    if (observedWorks.has(work.id) || !Array.isArray(work.units) || !sha(work.sourceSha256)) throw new TypeError("Invalid diagnostic trace work.");
    observedWorks.set(work.id, work);
  }
  const rows = [], indexes = {missedCues: [], falseCues: [], missedTransitions: [], falseTransitions: [], referenceUnknown: [], transitionReferenceUnknown: []};
  const summary = {targets: 0, resolvedReferences: 0, referenceUnknown: 0, traceRows: 0, returned: 0, classified: 0, proposedClassified: 0,
    referenceCues: 0, observedCueCoverage: 0, activation: binary(), proposedActivation: binary(), transitions: binary(),
    transitionReferenceKnown: 0, transitionReferenceUnknown: 0,
    phase: {matched: 0, total: 0, unknownReferences: 0}, frame: {matched: 0, total: 0, unknownReferences: 0},
    missingCueReasons: {}, statusCounts: {}, workCount: 0};
  const strata = {depiction: {}, frame: {}, interaction: {}};
  const pipeline = Object.fromEntries(pipelineFields.map(key => [key, {yes: 0, no: 0, unknown: 0,
    referenceCueYes: 0, referenceCueNo: 0, referenceCueUnknown: 0}]));
  const depiction = detailCounts(), depictionByEligibility = {};
  const knownWorks = new Set();
  for (const work of reference.works) {
    identity(work.id, "work ID");
    const referenceUnits = work.units ?? work.labels;
    if (knownWorks.has(work.id) || !sha(work.sourceSha256) || !Array.isArray(referenceUnits) ||
        work.unitCount !== undefined && work.unitCount !== referenceUnits.length) throw new TypeError("Invalid diagnostic reference work.");
    knownWorks.add(work.id); summary.workCount++;
    const observed = observedWorks.get(work.id);
    if (observed && observed.sourceSha256 !== work.sourceSha256) throw new TypeError("Diagnostic source hash mismatch.");
    const predictions = new Map();
    for (const unit of observed?.units ?? []) {
      if (!integer(unit.id) || predictions.has(unit.id) || !sha(unit.unitSha256)) throw new TypeError("Invalid diagnostic prediction identity.");
      predictions.set(unit.id, unit);
    }
    const knownUnits = new Set(referenceUnits.map(unit => unit.id));
    if (knownUnits.size !== referenceUnits.length) throw new TypeError("Duplicate diagnostic reference target.");
    const visited = new Set();
    for (const unit of referenceUnits) {
      if (!integer(unit.id) || !integer(unit.paragraph) || !sha(unit.unitSha256) || visited.has(unit.id)) throw new TypeError("Invalid diagnostic reference identity.");
      visited.add(unit.id);
      const observation = predictions.get(unit.id);
      if (observation && observation.unitSha256 !== unit.unitSha256) throw new TypeError("Diagnostic unit hash mismatch.");
      const expectedInput = referenceLabel(unit, scope);
      const isDeclaredUnknown = ["pending", "unreviewed", "unresolved", "refused", "not-submitted", "failed", "uncertain", "missing"].includes(status(unit.scopeStatus?.[scope] ?? unit.reviewStatus ?? unit.adjudication?.status)) ||
        ["uncertain", "refused", "failed", "not-submitted", "missing", "abstain"].includes(status(unit.status));
      const expected = checkedLabel(expectedInput, {required: !isDeclaredUnknown});
      if (expected?.evidenceIds.some(id => !knownUnits.has(id))) throw new TypeError("Reference evidence points outside its work.");
      const resolved = Boolean(referenceResolved(unit, expected, scope));
      const prediction = normalizePrediction(observation, scope, requests);
      const key = `${work.id}:${unit.id}`;
      const expectedCue = resolved && expected.activation === "cue";
      const proposedCue = ["classified", "invalid"].includes(prediction.status) && prediction.proposed?.activation === "cue";
      const appliedCue = prediction.applied?.activation === "cue";
      const mismatch = {}, proposedMismatch = {};
      for (const field of Object.keys(labels)) {
        if (!resolved || !supported.has(field) || [undefined, "unknown", "uncertain"].includes(expected[field])) continue;
        const appliedField = prediction.appliedFields?.[field];
        if (appliedField !== undefined && expected[field] !== appliedField) mismatch[field] = true;
        if (prediction.proposed && expected[field] !== prediction.proposed[field]) proposedMismatch[field] = true;
      }
      const transitionStatus = status(unit.transitionStatus?.[scope] ?? unit.fieldStatus?.[scope]?.transition ?? unit.scopeStatus?.[scope] ?? unit.reviewStatus ?? unit.adjudication?.status);
      const transitionResolved = expected && expected.transition !== "unknown" && !["pending", "unreviewed", "unresolved", "refused", "not-submitted", "failed", "uncertain", "missing"].includes(transitionStatus) &&
        !["refused", "failed", "not-submitted", "missing", "abstain"].includes(status(unit.status));
      const referenceTransition = transitionResolved && expected.transition !== "none";
      const appliedTransition = prediction.appliedFields?.transition;
      const predictedTransition = appliedTransition !== undefined && !["none", "unknown"].includes(appliedTransition);
      const transitionMatch = referenceTransition && appliedTransition === expected.transition;
      const cueResult = !resolved ? "reference-unknown" : expectedCue ? appliedCue ? "matched" : "missed" : appliedCue ? "extra" : "correct-negative";
      const transitionResult = !transitionResolved ? "reference-unknown" : transitionMatch ? "matched" : referenceTransition ? predictedTransition ? "wrong-type" : "missed" : predictedTransition ? "extra" : "correct-negative";
      const reason = expectedCue && !appliedCue ? failureOf(prediction) : null;
      const expectedEligibility = cleanEligibility(unit.scopeEligibility?.[scope] ?? unit.eligibility);
      const depictionStatus = unit.depictionStatus?.[scope] ?? unit.fieldStatus?.[scope]?.depiction;
      const expectedDepiction = ["pending", "unreviewed", "unresolved"].includes(depictionStatus) ? "unknown" : expectedInput?.depiction;
      const predictedDepiction = prediction.depiction ?? "unknown";
      const depictionAvailable = prediction.depictionAvailable === true;
      scoreDetail(depiction, expectedDepiction, predictedDepiction, depictionAvailable);
      const eligibilityGroup = expectedEligibility?.status ?? "unspecified";
      scoreDetail(depictionByEligibility[eligibilityGroup] ??= detailCounts(), expectedDepiction, predictedDepiction, depictionAvailable);
      const submitted = new Set(prediction.requests.filter(row => row.workId === work.id)
        .flatMap(row => [...(row.targetIds ?? []), ...(row.contextIds ?? [])]));
      const hasEvidenceCoverage = prediction.requests.some(row => Array.isArray(row.targetIds) && Array.isArray(row.contextIds) && row.workId === work.id);
      const missingRequiredIds = hasEvidenceCoverage ? (expected?.evidenceIds ?? []).filter(id => !submitted.has(id)) : null;
      const row = {key, workId: work.id, sourceSha256: work.sourceSha256, unitId: unit.id, unitSha256: unit.unitSha256, paragraph: unit.paragraph,
        referenceResolved: resolved, transitionReferenceResolved: Boolean(transitionResolved), expected, expectedEligibility, referenceReasonCodes: cleanReasons(unit.reasonCodes),
        prediction, cueResult, transitionResult, mismatches: mismatch, proposedMismatches: proposedMismatch,
        depictionResult: {expected: labels.depiction.has(expectedDepiction) ? expectedDepiction : "unknown",
          predicted: predictedDepiction, available: depictionAvailable,
          graphicMiss: expectedDepiction === "graphic" && (!depictionAvailable || predictedDepiction !== "graphic"),
          explicitOrGraphicMiss: ["explicit", "graphic"].includes(expectedDepiction) && (!depictionAvailable || !["explicit", "graphic"].includes(predictedDepiction))},
        diagnosis: reason ? {reason, stage: reasons.get(reason) ?? "unknown", certainty: reason === "unknown" ? "unknown" :
          reason === "model-negative" ? "observed-label-disagreement" : "observed-pipeline-stage",
          ...(prediction.observedFailureCode ? {observedCode: prediction.observedFailureCode} : {}),
          ...(prediction.local ? {observedRule: prediction.local.reasonCode} : {}),
          ...(prediction.planning?.exclusion ? {observedPlanningExclusion: prediction.planning.exclusion} : {}),
          ...(missingRequiredIds?.length ? {hypotheses: ["reference-evidence-absent-from-retained-window"]} : {})} : null,
        evidenceCoverage: {known: hasEvidenceCoverage, requiredIds: expected?.evidenceIds ?? [], missingRequiredIds,
          basis: !hasEvidenceCoverage ? "unknown" : prediction.requests.some(row => row.windowDisposition === "provider-attempt") ?
            "provider-attempt-window" : prediction.requests.every(row => row.windowDisposition === "planned-only") ? "planned-window" : "retained-window"}};
      rows.push(row); summary.targets++; count(summary.statusCounts, prediction.status);
      summary.traceRows += Number(Boolean(observation));
      const returned = prediction.pipeline.returned ?? (observation && Boolean(prediction.proposed) && ["classified", "uncertain", "abstain", "invalid"].includes(prediction.status));
      summary.returned += Number(Boolean(returned));
      summary.proposedClassified += Number(prediction.status === "classified" && Boolean(prediction.proposed));
      summary.classified += Number(Boolean(prediction.applied));
      for (const field of pipelineFields) {
        const value = prediction.pipeline[field];
        const column = value === true ? "yes" : value === false ? "no" : "unknown";
        pipeline[field][column]++;
        if (expectedCue) pipeline[field][value === true ? "referenceCueYes" : value === false ? "referenceCueNo" : "referenceCueUnknown"]++;
      }
      if (transitionResolved) {
        summary.transitionReferenceKnown++;
        if (referenceTransition && !transitionMatch) summary.transitions.missed++;
        if (predictedTransition && !transitionMatch) summary.transitions.extra++;
        if (transitionMatch) summary.transitions.matched++;
        if (["missed", "wrong-type"].includes(transitionResult)) indexes.missedTransitions.push(key);
        if (["extra", "wrong-type"].includes(transitionResult)) indexes.falseTransitions.push(key);
      } else { summary.transitionReferenceUnknown++; indexes.transitionReferenceUnknown.push(key); }
      if (!resolved) { summary.referenceUnknown++; indexes.referenceUnknown.push(key); continue; }
      summary.resolvedReferences++;
      summary.referenceCues += Number(expectedCue); summary.observedCueCoverage += Number(expectedCue && Boolean(prediction.applied));
      score(summary.activation, expectedCue, appliedCue); score(summary.proposedActivation, expectedCue, proposedCue);
      for (const field of Object.keys(strata)) {
        if (expected[field] === undefined) continue;
        const group = strata[field][expected[field]] ??= {targets: 0, cues: binary(), missingCueReasons: {}};
        group.targets++; score(group.cues, expectedCue, appliedCue);
        if (reason) count(group.missingCueReasons, reason);
      }
      for (const field of ["phase", "frame"]) {
        if (["unknown", "uncertain"].includes(expected[field])) { summary[field].unknownReferences++; continue; }
        summary[field].total++; summary[field].matched += Number(expected[field] === prediction.appliedFields?.[field]);
      }
      if (cueResult === "missed") { indexes.missedCues.push(key); count(summary.missingCueReasons, reason); }
      if (cueResult === "extra") indexes.falseCues.push(key);
    }
    if ([...predictions.keys()].some(id => !knownUnits.has(id))) throw new TypeError("Prediction contains an unknown reference target.");
  }
  if ([...observedWorks.keys()].some(id => !knownWorks.has(id))) throw new TypeError("Prediction contains an unknown reference work.");
  return {schema: 1, measurement: "offline-exact-unit-diagnostics", datasetId, referenceVersion, predictionVersion, runId, scope,
    supportedPredictionFields: [...supported],
    granularity: ["paragraph-projected-to-exact-source-units", "exact-source-unit-classification"].includes(trace.granularity) ? trace.granularity : "not-declared",
    summary: {...summary, activation: measuredReport(summary.activation, supported.has("activation")),
      proposedActivation: measuredReport(summary.proposedActivation, supported.has("activation")),
      transitions: measuredReport(summary.transitions, supported.has("transition")),
      phase: {...summary.phase, measured: supported.has("phase"), accuracy: supported.has("phase") ? ratio(summary.phase.matched, summary.phase.total) : null},
      frame: {...summary.frame, measured: supported.has("frame"), accuracy: supported.has("frame") ? ratio(summary.frame.matched, summary.frame.total) : null},
      pipeline, traceCoverage: ratio(summary.traceRows, summary.targets), returnedCoverage: ratio(summary.returned, summary.targets),
      classifiedCoverage: ratio(summary.classified, summary.targets), cueCoverage: ratio(summary.observedCueCoverage, summary.referenceCues)},
    depiction: reportDetails(depiction, supported.has("depiction")), depictionByEligibility: Object.fromEntries(Object.entries(depictionByEligibility)
      .map(([eligibility, counts]) => [eligibility, reportDetails(counts, supported.has("depiction"))])),
    strata: Object.fromEntries(Object.entries(strata).map(([field, values]) => [field,
      Object.fromEntries(Object.entries(values).map(([value, group]) => [value, {...group, cues: measuredReport(group.cues, supported.has("activation"))}]))])),
    indexes, rows,
    limitations: ["model-negative-identifies-disagreement-not-its-semantic-cause", "missing-request-evidence-is-not-inferred",
      "unknown-reference-labels-are-excluded-not-converted-to-negative", "known-depiction-scored-independently-of-cue-eligibility",
      "row-global-eligibility-does-not-backfill-causal-reference-activation", "confidence-is-reported-not-calibrated",
      "unsupported-prediction-fields-have-null-quality-rates-and-measured-false",
      "diagnostics-have-no-device-authority"]};
}
