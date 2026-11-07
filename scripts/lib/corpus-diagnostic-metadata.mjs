const failureCategories = new Map([
  ["provider_refusal", "provider-refused"],
  ["provider_truncated", "output-truncated"],
  ["provider_connection", "provider-error"],
  ["provider_http_error", "provider-error"],
  ["provider_timeout", "timeout"],
  ["provider_rate_limit", "provider-rate-limit"],
  ["provider_key_rejected", "provider-key-rejected"],
  ["provider_model_access", "provider-model-access"],
  ["provider_model_mismatch", "provider-model-mismatch"],
  ["provider_billing_limit", "provider-billing-limit"],
  ["provider_request_rejected", "provider-request-rejected"],
  ["missing_output", "missing-output"],
  ["transition_evidence_missing", "evidence-missing"],
  ["refusal_overlap", "refusal-dependent"],
  ["refusal_dependency", "refusal-dependent"],
  ["settlement_unknown_dependency", "settlement-unknown-dependent"],
  ["admission_unavailable", "admission-unavailable"],
  ["budget_limit", "budget-deferred"],
  ["budget_exhausted", "budget-deferred"],
  ["budget_unavailable", "budget-unavailable"],
  ["study_unavailable", "admission-unavailable"],
  ["concurrency_limited", "concurrency-limited"],
  ["not_submitted", "not-submitted"],
  ["client_transport_unknown", "client-transport-unknown"],
  ["provider_response_lost", "provider-response-lost"],
  ["reconciled_refusal", "provider-refused"],
  ["client_invalid_response", "retained-output-missing"],
]);
const schemaCodes = new Set([
  "invalid_response", "invalid_json", "invalid_schema", "duplicate_output", "cue_invariant", "phase_invariant",
  "refusal_invariant", "client_invalid_row", "invalid_envelope", "invalid_row_keys", "invalid_target_id",
  "duplicate_target_id", "unexpected_target_id", "invalid_status_code", "invalid_label_keys", "invalid_label_code",
  "invalid_eligibility_keys", "invalid_eligibility_code", "invalid_neutral_shortcut",
]);
const evidenceCodes = new Set([
  "evidence_outside_window", "invalid_evidence", "invalid_evidence_timing", "future_eligibility_evidence",
  "invalid_evidence_ids", "invalid_evidence_id", "excess_evidence_ids", "invalid_knowledge_at_id",
]);
const normalizationCodes = new Set([
  "duplicate_evidence_ids", "unsorted_evidence_ids", "missing_confidence", "invalid_confidence", "missing_reason_codes",
  "invalid_reason_codes", "invalid_reason_code", "duplicate_reason_codes", "excess_reason_codes", "missing_eligibility",
  "noncue_phase_normalized",
]);
const scopes = ["causal", "retrospective"];
const labelFields = ["depiction", "frame", "interaction", "activation", "phase", "transition"];
const issueFields = new Set([
  "$", "envelope", "rows", "row", "id", "status", "confidence", "reasonCodes", "neutralShortcut", ...scopes, "eligibility",
  ...scopes.flatMap(scope => [...labelFields, "evidenceIds", "knowledgeAtId"].map(field => `${scope}.${field}`)),
  ...["status", "adult", "consent", "capacity", "evidenceIds"].map(field => `eligibility.${field}`),
]);

export function corpusFailureCategory(code) {
  if (schemaCodes.has(code)) return "schema-invalid";
  if (evidenceCodes.has(code)) return "evidence-invalid";
  return failureCategories.get(code);
}

export function observedCorpusCode(code) {
  return corpusFailureCategory(code) || normalizationCodes.has(code) ? code : undefined;
}

/** Preserve typed parser facts without copying arbitrary checkpoint metadata. */
export function corpusParserMetadata(value) {
  const result = {};
  if (value?.parserRevision === "v7-field-validation-2") result.parserRevision = value.parserRevision;
  if (["no_response", "response_invalid", "response_rejected", "response_mismatch"].includes(value?.transport?.stage)) {
    const httpStatus = value.transport.httpStatus;
    result.transport = {stage: value.transport.stage, httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null};
  }
  if (Array.isArray(value?.decodeIssues)) {
    const coordinate = id => id === null || Number.isSafeInteger(id) && id >= 0;
    result.decodeIssues = value.decodeIssues.slice(0, 4096).filter(issue => issue &&
      coordinate(issue.rowIndex) && coordinate(issue.id) && issueFields.has(issue.field) && observedCorpusCode(issue.code) &&
      ["normalized", "error"].includes(issue.severity)).map(({rowIndex, id, field, code, severity}) => ({rowIndex, id, field, code, severity}));
  }
  const fieldStatus = {};
  for (const scope of scopes) {
    const fields = {};
    for (const field of labelFields) {
      const state = value?.fieldStatus?.[scope]?.[field];
      if (state === "applied" || state === "unresolved") fields[field] = state;
    }
    if (Object.keys(fields).length) fieldStatus[scope] = fields;
  }
  if (Object.keys(fieldStatus).length) result.fieldStatus = fieldStatus;
  const validationErrors = {};
  for (const scope of [...scopes, "eligibility"]) {
    const code = value?.validationErrors?.[scope];
    if (code === null || corpusFailureCategory(code)) validationErrors[scope] = code;
  }
  if (Object.keys(validationErrors).length) result.validationErrors = validationErrors;
  return result;
}
