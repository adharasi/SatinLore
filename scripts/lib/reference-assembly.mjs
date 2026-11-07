import {createHash} from "node:crypto";
import {CORPUS_ENUMS, CORPUS_REASON_CODES, REFERENCE_RUBRIC_VERSION} from "../../deploy/cloudflare/corpus-study-contract.mjs";

export const REFERENCE_ASSEMBLY_VERSION = "full-corpus-reference-assembly-v1";
const scopes = ["causal", "retrospective"];
const fields = ["depiction", "frame", "interaction", "activation", "phase", "transition"];
const roles = ["referenceA", "referenceB", "adjudicator"];
const eligibilityFields = ["status", "adult", "consent", "capacity"];
const hash = value => createHash("sha256").update(value).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const opaqueId = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uniqueSorted = values => [...new Set(values)].sort((a, b) => a - b);
const idsValid = ids => Array.isArray(ids) && ids.length <= 8 && ids.every((id, i) =>
  Number.isSafeInteger(id) && id >= 0 && (!i || ids[i - 1] < id));
const known = (field, value) => value !== "unknown" && value !== "uncertain" &&
  !(field === "activation" && value === "review");
const unknownLabel = () => ({depiction: "unknown", frame: "uncertain", interaction: "uncertain",
  activation: "review", phase: "unknown", transition: "unknown", evidenceIds: [], knowledgeAtId: null});
const unknownEligibility = () => ({status: "uncertain", adult: "uncertain", consent: "uncertain",
  capacity: "uncertain", evidenceIds: []});
const coreEligibility = row => eligibilityFields.map(field => row.eligibility[field]);
const groupValue = (view, scope, group) => group === "semantic"
  ? [view.row[scope].frame, view.row[scope].interaction, view.row[scope].activation, ...coreEligibility(view.row)]
  : [view.row[scope][group]];

function indexCorpus(corpus) {
  if (!corpus || !Array.isArray(corpus.works) || corpus.works.length > 10000) throw new TypeError("Invalid source corpus.");
  const works = new Map(); let unitCount = 0;
  for (const work of corpus.works) {
    if (!opaqueId(work.id) || works.has(work.id) || !digest(work.sourceSha256) || !digest(work.indexSha256) ||
        !Array.isArray(work.units)) throw new TypeError("Invalid source work identity.");
    const units = new Map(); let previous = -1;
    for (const unit of work.units) {
      if (!Number.isSafeInteger(unit.id) || unit.id <= previous || !Number.isSafeInteger(unit.paragraph) || unit.paragraph < 0 ||
          typeof unit.text !== "string" || !Number.isSafeInteger(unit.start) || !Number.isSafeInteger(unit.end) ||
          unit.start < 0 || unit.end < unit.start) throw new TypeError("Invalid source unit coordinates.");
      previous = unit.id;
      units.set(unit.id, {...unit, unitSha256: hash(unit.text)});
      if (++unitCount > 1000000) throw new RangeError("Source corpus exceeds assembly limit.");
    }
    works.set(work.id, {work, units});
  }
  return works;
}

function labelSyntax(label) {
  return label && fields.every(field => CORPUS_ENUMS[field].includes(label[field])) && idsValid(label.evidenceIds) &&
    (label.knowledgeAtId === null || Number.isSafeInteger(label.knowledgeAtId) && label.knowledgeAtId >= 0);
}

function eligibilitySyntax(value) {
  return value && CORPUS_ENUMS.eligibility.includes(value.status) &&
    ["adult", "consent", "capacity"].every(field => CORPUS_ENUMS[field].includes(value[field])) && idsValid(value.evidenceIds);
}

function scopeErrors(row, scope, available) {
  const label = row[scope], errors = [];
  if (!labelSyntax(label)) return ["invalid-label-schema"];
  if (label.evidenceIds.some(id => !available.has(id))) errors.push("evidence-outside-request");
  if (scope === "causal" && label.evidenceIds.some(id => id > row.id)) errors.push("future-causal-evidence");
  if (label.knowledgeAtId !== (label.evidenceIds.length ? label.evidenceIds.at(-1) : null)) errors.push("invalid-evidence-timing");
  if (label.activation === "cue") {
    if (!label.evidenceIds.includes(row.id) || label.interaction !== "depicted" || label.frame === "uncertain" ||
        ["quiet", "unknown"].includes(label.phase) || row.eligibility.status !== "eligible" ||
        row.eligibility.adult !== "adult" || row.eligibility.consent !== "present" || row.eligibility.capacity !== "present" ||
        !row.eligibility.evidenceIds.length) errors.push("invalid-cue-evidence");
    if (scope === "causal" && row.eligibility.evidenceIds.some(id => id > row.id)) errors.push("future-causal-eligibility");
  }
  if (["context", "protected"].includes(label.activation) && label.phase !== "quiet" ||
      label.activation === "review" && label.phase !== "unknown") errors.push("invalid-phase-activation");
  if (!["none", "unknown"].includes(label.transition) && !label.evidenceIds.includes(row.id)) errors.push("missing-transition-evidence");
  return errors;
}

function safeRow(row, unit, batch) {
  const status = ["classified", "uncertain", "partial", "refused", "failed", "not_submitted"].includes(row?.status) ? row.status : "failed";
  if (!row || row.unitSha256 !== unit.unitSha256) return null;
  const available = new Set([...batch.targetIds, ...batch.contextIds]);
  const eligibilityValid = row.scopeStatus?.eligibility !== "invalid" && eligibilitySyntax(row.eligibility) &&
    row.eligibility.evidenceIds.every(id => available.has(id));
  const sanitized = {id: row.id, status, eligibility: eligibilityValid ? Object.fromEntries([...eligibilityFields, "evidenceIds"].map(field =>
    [field, structuredClone(row.eligibility[field])])) : unknownEligibility(),
    confidence: Number.isInteger(row.confidence) && row.confidence >= 0 && row.confidence <= 100 ? row.confidence : null,
    reasonCodes: (Array.isArray(row.reasonCodes) ? row.reasonCodes : []).filter(code => CORPUS_REASON_CODES.includes(code)),
    failureCode: typeof row.failureCode === "string" && /^[a-zA-Z0-9_-]{1,80}$/u.test(row.failureCode) ? row.failureCode : null};
  const errors = {}, scopedStatus = {};
  for (const scope of scopes) {
    const declared = row.scopeStatus?.[scope];
    scopedStatus[scope] = ["classified", "uncertain", "refused", "invalid"].includes(declared) ? declared : status;
    const label = declared === "invalid" && labelSyntax(row.proposed?.[scope]) ? row.proposed[scope] : row[scope];
    const validSyntax = labelSyntax(label);
    sanitized[scope] = validSyntax ? Object.fromEntries([...fields, "evidenceIds", "knowledgeAtId"].map(field =>
      [field, structuredClone(label[field])])) : unknownLabel();
    errors[scope] = validSyntax ? scopeErrors(sanitized, scope, available) : ["invalid-label-schema"];
  }
  return {row: sanitized, errors, scopedStatus, eligibilityValid};
}

function safeRequest(batch) {
  return {batchId: batch.batchId, workId: batch.workId, role: batch.role,
    sourceSha256: batch.sourceSha256, indexSha256: batch.indexSha256,
    promptSha256: digest(batch.promptSha256) ? batch.promptSha256 : null,
    model: typeof batch.model === "string" && /^[a-zA-Z0-9_.-]{1,80}$/u.test(batch.model) ? batch.model : null,
    status: typeof batch.status === "string" && /^[a-zA-Z0-9_-]{1,80}$/u.test(batch.status) ? batch.status : "unknown",
    targetIds: [...batch.targetIds], contextIds: [...batch.contextIds],
    returned: batch.returned !== false, causalStatus: "evidence-timing-projection"};
}

function collectViews(corpus, checkpoints, expectedSourceBundleSha256) {
  const byRole = Object.fromEntries(roles.map(role => [role, new Map()])), requests = [], ignoredRoles = {};
  for (const checkpoint of checkpoints) {
    if (expectedSourceBundleSha256 && checkpoint.sourceBundleSha256 !== expectedSourceBundleSha256) {
      throw new TypeError("Checkpoint source bundle does not match.");
    }
    const batches = checkpoint.batches ?? checkpoint.results;
    if (!Array.isArray(batches) || batches.length > 100000) throw new TypeError("Invalid checkpoint batches.");
    for (const batch of batches) {
      if (!roles.includes(batch.role)) {
        const role = ["detector", "transition"].includes(batch.role) ? batch.role : "other";
        ignoredRoles[role] = (ignoredRoles[role] ?? 0) + 1; continue;
      }
      const source = corpus.get(batch.workId);
      if (!source || batch.sourceSha256 !== source.work.sourceSha256 || batch.indexSha256 !== source.work.indexSha256 ||
          batch.referenceVersion !== REFERENCE_RUBRIC_VERSION || !opaqueId(batch.batchId) ||
          !Array.isArray(batch.targetIds) || !Array.isArray(batch.contextIds) || !Array.isArray(batch.rows)) {
        throw new TypeError("Checkpoint source or rubric identity does not match.");
      }
      const allIds = [...batch.targetIds, ...batch.contextIds];
      if (new Set(allIds).size !== allIds.length || allIds.some(id => !source.units.has(id)) ||
          batch.targetIds.some(id => source.units.get(id).structuralBoundary)) throw new TypeError("Checkpoint unit identity does not match.");
      const requestIndex = requests.length; requests.push(safeRequest(batch));
      const rows = new Map();
      for (const row of batch.rows) {
        if (!batch.targetIds.includes(row?.id) || rows.has(row.id)) throw new TypeError("Invalid checkpoint target mapping.");
        rows.set(row.id, row);
      }
      for (const id of batch.targetIds) {
        const key = JSON.stringify([batch.workId, id]), raw = rows.get(id);
        const checked = raw ? safeRow(raw, source.units.get(id), batch) : null;
        const view = checked ? {...checked, requestIndex, duplicateConflict: false} :
          {row: null, errors: Object.fromEntries(scopes.map(scope => [scope, [raw ? "invalid-row-identity" : "missing-output"]])), requestIndex, duplicateConflict: false};
        const previous = byRole[batch.role].get(key);
        if (!previous) byRole[batch.role].set(key, view);
        else {
          const same = previous.row && view.row && equal(
            [previous.row.status, ...scopes.map(scope => fields.map(field => previous.row[scope][field])), coreEligibility(previous.row)],
            [view.row.status, ...scopes.map(scope => fields.map(field => view.row[scope][field])), coreEligibility(view.row)]);
          if (!same) previous.duplicateConflict = true;
        }
      }
    }
  }
  // Plans with no saved provider result are still observable coverage states.
  // They do not become model negatives or masquerade as completed requests.
  for (const checkpoint of checkpoints) {
    const attempts = new Map((checkpoint.attempts ?? []).map(attempt => [attempt.batchId, attempt.state]));
    for (const plan of checkpoint.plannedBatches ?? []) {
      if (!roles.includes(plan.role)) continue;
      const source = corpus.get(plan.workId);
      if (!source || !opaqueId(plan.batchId) || !Array.isArray(plan.targetIds) || !Array.isArray(plan.contextIds) ||
          [...plan.targetIds, ...plan.contextIds].some(id => !source.units.has(id)) ||
          plan.targetIds.some(id => source.units.get(id).structuralBoundary)) throw new TypeError("Invalid planned reference target identity.");
      const missing = plan.targetIds.map(id => JSON.stringify([plan.workId, id])).filter(key => !byRole[plan.role].has(key));
      if (!missing.length) continue;
      const attempt = attempts.get(plan.batchId);
      const missingReason = attempt === "blocked" ? "refusal-overlap-blocked" :
        ["sending", "unknown"].includes(attempt) ? "attempt-result-unknown" : attempt === "complete" ? "checkpoint-result-missing" : "not-dispatched";
      const missingStatus = ["attempt-result-unknown", "checkpoint-result-missing"].includes(missingReason) ? "failed" : "not_submitted";
      const requestIndex = requests.length;
      requests.push(safeRequest({...plan, sourceSha256: source.work.sourceSha256, indexSha256: source.work.indexSha256,
        status: missingReason, returned: false}));
      for (const key of missing) byRole[plan.role].set(key, {row: null, missingReason, missingStatus,
        errors: Object.fromEntries(scopes.map(scope => [scope, [missingReason]])), requestIndex, duplicateConflict: false});
    }
  }
  return {byRole, requests, ignoredRoles};
}

function contentAvailable(view, scope) {
  return Boolean(view?.row && !view.duplicateConflict && !["refused", "failed", "not_submitted"].includes(view.row.status) &&
    view.scopedStatus[scope] !== "refused" && !view.errors[scope].includes("invalid-label-schema"));
}

function groupAvailable(view, scope, group) {
  if (!contentAvailable(view, scope)) return false;
  const row = view.row, label = row[scope];
  if (group === "semantic") return view.scopedStatus[scope] === "classified" && view.eligibilityValid &&
    !view.errors[scope].length && known("activation", label.activation) &&
    (label.activation !== "cue" || row.eligibility.status === "eligible") &&
    !(label.activation === "context" && label.interaction === "depicted" && label.frame === "uncertain");
  if (group === "transition" && view.errors[scope].some(error => ["evidence-outside-request", "future-causal-evidence",
    "invalid-evidence-timing", "missing-transition-evidence"].includes(error))) return false;
  if (group === "phase" && (view.scopedStatus[scope] === "invalid" || view.errors[scope].length)) return false;
  return known(group, label[group]);
}

function unresolvedStatus(views) {
  if (views.some(view => view?.row?.status === "refused")) return "refused";
  if (views.some(view => view?.duplicateConflict || view && !view.row && view.missingStatus !== "not_submitted" || view?.row?.status === "failed")) return "failed";
  if (views.every(view => !view || view.row?.status === "not_submitted" || view.missingStatus === "not_submitted")) return "not_submitted";
  return "pending";
}

function resolveGroup(a, b, c, scope, group) {
  const aOk = groupAvailable(a, scope, group), bOk = groupAvailable(b, scope, group), cOk = groupAvailable(c, scope, group);
  if (aOk && bOk && equal(groupValue(a, scope, group), groupValue(b, scope, group))) {
    return {status: "resolved", method: "independent-model-agreement", selected: a, supportingRoles: ["referenceA", "referenceB"]};
  }
  if (cOk) {
    const matched = [[aOk, a, "referenceA"], [bOk, b, "referenceB"]].find(([valid, view]) => valid &&
      equal(groupValue(view, scope, group), groupValue(c, scope, group)));
    if (matched) return {status: "resolved", method: "blind-third-view-confirmation", selected: c,
      supportingRoles: [matched[2], "adjudicator"]};
  }
  const hasDifference = contentAvailable(a, scope) && contentAvailable(b, scope) &&
    (aOk !== bOk || !equal(groupValue(a, scope, group), groupValue(b, scope, group)));
  return {status: unresolvedStatus([a, b, c]), method: c ? "unresolved-third-view" : hasDifference ? "reference-disagreement" : "insufficient-reference-evidence",
    selected: null, supportingRoles: [], needsAdjudication: (!c || c.missingReason === "not-dispatched") && hasDifference && (aOk || bOk)};
}

function assembleScope(a, b, c, scope) {
  const groups = Object.fromEntries(["semantic", "depiction", "phase", "transition"].map(group =>
    [group, resolveGroup(a, b, c, scope, group)]));
  const label = unknownLabel(), fieldStatus = Object.fromEntries(fields.map(field => [field, "pending"]));
  const selected = [];
  for (const [group, result] of Object.entries(groups)) {
    const groupFields = group === "semantic" ? ["frame", "interaction", "activation"] : [group];
    for (const field of groupFields) {
      fieldStatus[field] = result.status;
      if (result.selected) label[field] = result.selected.row[scope][field];
    }
    if (result.selected && !result.selected.errors[scope].some(error => ["evidence-outside-request",
      "future-causal-evidence", "invalid-evidence-timing"].includes(error))) selected.push(result.selected.row[scope]);
  }
  label.evidenceIds = uniqueSorted(selected.flatMap(item => item.evidenceIds));
  label.knowledgeAtId = label.evidenceIds.length ? label.evidenceIds.at(-1) : null;
  const resolution = Object.fromEntries(Object.entries(groups).map(([group, result]) => [group,
    {status: result.status, method: result.method, supportingRoles: result.supportingRoles}]));
  return {label, fieldStatus, groups, resolution, status: groups.semantic.status};
}

export function assembleFullCorpusReference({corpus, checkpoints, sourceBundleSha256 = null}) {
  if (!Array.isArray(checkpoints) || !checkpoints.length) throw new TypeError("Reference checkpoints are required.");
  const sourceIndex = indexCorpus(corpus);
  const {byRole, requests, ignoredRoles} = collectViews(sourceIndex, checkpoints, sourceBundleSha256);
  const reference = {schema: 1, datasetId: "full-corpus-v7", rubricVersion: REFERENCE_RUBRIC_VERSION,
    assemblyVersion: REFERENCE_ASSEMBLY_VERSION, reviewerStatus: "model-assisted-development-reference",
    humanReviewed: false, frozenSnapshot: true, sourceProseIncluded: false, sourceBundleSha256,
    causalStatus: "evidence-timing-projection", retrospectiveScope: "supplied-source-window",
    resolutionPolicy: {semanticFields: ["frame", "interaction", "activation", ...eligibilityFields.map(field => `eligibility.${field}`)],
      independentGroups: ["semantic", "depiction", "phase", "transition"],
      evidenceDifferencesCreateDisagreement: false, confidenceSelectsReference: false,
      detectorOutputUsed: false, thirdViewMustMatchAtLeastOneValidFirstViewPerGroup: true},
    requests, ignoredRoles, works: []};
  const selection = {schema: 1, referenceVersion: REFERENCE_RUBRIC_VERSION, sourceBundleSha256,
    purpose: "blind-third-source-view-selection", containsReferenceLabelValues: false, jobs: []};
  const counts = {works: sourceIndex.size, sourceUnits: 0, targets: 0, structural: 0,
    scopes: Object.fromEntries(scopes.map(scope => [scope, {}])), depiction: Object.fromEntries(scopes.map(scope => [scope, {}])),
    activation: Object.fromEntries(scopes.map(scope => [scope, {}])), allFieldsResolvedTargets: 0,
    targetRowsWithAnyPendingScope: 0, adjudicationTargets: 0};
  for (const {work, units} of sourceIndex.values()) {
    const output = {id: work.id, family: work.family, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256,
      sourceUnitSha256: work.sourceUnitSha256, sourceUnitCount: units.size,
      unitCount: [...units.values()].filter(unit => !unit.structuralBoundary).length,
      nonTargetUnits: [], labels: []};
    const workSelection = [];
    for (const unit of units.values()) {
      counts.sourceUnits++;
      const coords = {id: unit.id, unitSha256: unit.unitSha256, paragraph: unit.paragraph,
        startUtf16: unit.start, endUtf16: unit.end};
      if (unit.structuralBoundary) {
        output.nonTargetUnits.push({...coords, status: "not_target", reasonCode: "structural-unit"}); counts.structural++; continue;
      }
      counts.targets++;
      const key = JSON.stringify([work.id, unit.id]);
      const [a, b, c] = roles.map(role => byRole[role].get(key));
      const assembled = Object.fromEntries(scopes.map(scope => [scope, assembleScope(a, b, c, scope)]));
      const scopesResolved = scopes.filter(scope => assembled[scope].status === "resolved");
      const hasAdjudication = scopes.some(scope => Object.values(assembled[scope].groups).some(group => group.method === "blind-third-view-confirmation"));
      const semanticSelection = [...scopes].reverse().map(scope => assembled[scope].groups.semantic.selected).find(Boolean);
      const unresolved = unresolvedStatus([a, b, c]);
      const row = {...coords, status: scopesResolved.length ? "classified" : unresolved === "pending" ? "uncertain" : unresolved,
        sourceAdmission: ["approved", "blocked", "review"].includes(unit.admission) ? unit.admission : "unknown",
        reviewStatus: scopesResolved.length === scopes.length ? hasAdjudication ? "model-assisted-adjudicated" : "model-assisted-agreed" : "pending",
        scopeStatus: Object.fromEntries(scopes.map(scope => [scope, assembled[scope].status])),
        fieldStatus: Object.fromEntries(scopes.map(scope => [scope, assembled[scope].fieldStatus])),
        depictionStatus: Object.fromEntries(scopes.map(scope => [scope, assembled[scope].fieldStatus.depiction])),
        causal: assembled.causal.label, retrospective: assembled.retrospective.label,
        eligibility: semanticSelection ? structuredClone(semanticSelection.row.eligibility) : unknownEligibility(),
        scopeEligibility: Object.fromEntries(scopes.map(scope => [scope, assembled[scope].groups.semantic.selected
          ? structuredClone(assembled[scope].groups.semantic.selected.row.eligibility) : unknownEligibility()])),
        adjudication: {scopes: Object.fromEntries(scopes.map(scope => [scope, assembled[scope].resolution])),
          detectorConcealed: true, thirdViewBlindToFirstViews: true},
        provenance: Object.fromEntries(roles.map((role, i) => [role, [a, b, c][i] ? {requestIndex: [a, b, c][i].requestIndex,
          rowStatus: [a, b, c][i].row?.status ?? [a, b, c][i].missingStatus ?? "invalid", duplicateConflict: [a, b, c][i].duplicateConflict,
          missingReason: [a, b, c][i].missingReason ?? null,
          confidence: [a, b, c][i].row?.confidence ?? null, reasonCodes: [a, b, c][i].row?.reasonCodes ?? [],
          failureCode: [a, b, c][i].row?.failureCode ?? null,
          scopeValidationErrors: [a, b, c][i].errors} : null]))};
      output.labels.push(row);
      for (const scope of scopes) {
        const status = row.scopeStatus[scope]; counts.scopes[scope][status] = (counts.scopes[scope][status] ?? 0) + 1;
        const depiction = row.depictionStatus[scope] === "resolved" ? row[scope].depiction : "unresolved";
        counts.depiction[scope][depiction] = (counts.depiction[scope][depiction] ?? 0) + 1;
        const activation = status === "resolved" ? row[scope].activation : "unresolved";
        counts.activation[scope][activation] = (counts.activation[scope][activation] ?? 0) + 1;
      }
      if (scopes.every(scope => fields.every(field => row.fieldStatus[scope][field] === "resolved"))) counts.allFieldsResolvedTargets++;
      if (scopesResolved.length < scopes.length) counts.targetRowsWithAnyPendingScope++;
      const conflicts = scopes.filter(scope => Object.values(assembled[scope].groups).some(group => group.needsAdjudication));
      if (conflicts.length) workSelection.push({id: unit.id, scopes: conflicts});
    }
    for (let start = 0; start < workSelection.length; start += 64) {
      const slice = workSelection.slice(start, start + 64);
      selection.jobs.push({workId: work.id, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256,
        targetIds: slice.map(item => item.id), scopeConflicts: slice});
      counts.adjudicationTargets += slice.length;
    }
    reference.works.push(output);
  }
  reference.counts = counts;
  selection.targetCount = counts.adjudicationTargets;
  reference.referenceSha256 = hash(JSON.stringify(reference));
  selection.referenceSnapshotSha256 = reference.referenceSha256;
  return {reference, adjudicationSelection: selection};
}

export function auditPriorReference(reference, prior) {
  if (!reference.frozenSnapshot || !digest(reference.referenceSha256)) throw new TypeError("Freeze the reference before prior-label audit.");
  const byHash = new Map(reference.works.map(work => [work.sourceSha256, {work, labels: new Map(work.labels.map(label => [label.id, label]))}]));
  const priorRows = [];
  for (const work of prior.works ?? []) {
    const labels = Array.isArray(work.labels) ? work.labels : Array.isArray(work.exactSemanticLabels) ? work.exactSemanticLabels : [];
    for (const label of labels) priorRows.push({sourceSha256: work.sourceSha256, id: label.id, label});
  }
  for (const paragraph of prior.paragraphs ?? []) {
    const sourceSha256 = paragraph.sourceSha256 ?? prior.workSourceSha256?.[paragraph.work];
    for (const span of paragraph.spans ?? []) priorRows.push({sourceSha256, id: span.runtimeId, label: span});
  }
  const audit = {schema: 1, measurement: "post-freeze-prior-reference-contradiction-audit", referenceSha256: reference.referenceSha256,
    priorLabelCount: priorRows.length, matchedUnitCount: 0, unmatchedUnitCount: 0, changedFields: {}, rows: []};
  for (const item of priorRows) {
    const matched = byHash.get(item.sourceSha256), row = matched?.labels.get(item.id);
    const priorUnitSha256 = item.label.unitSha256 ?? item.label.sentenceSha256;
    if (!row || priorUnitSha256 && priorUnitSha256 !== row.unitSha256) {audit.unmatchedUnitCount++; continue;}
    audit.matchedUnitCount++;
    const changed = [];
    for (const scope of scopes) {
      const old = item.label[scope] ?? {...item.label, activation: item.label[`${scope}Activation`] ?? item.label.activation};
      for (const field of fields) if (CORPUS_ENUMS[field].includes(old[field]) && row.fieldStatus[scope][field] === "resolved" && old[field] !== row[scope][field]) {
        const key = `${scope}.${field}`; changed.push({field: key, previous: old[field], current: row[scope][field]});
        audit.changedFields[key] = (audit.changedFields[key] ?? 0) + 1;
      }
    }
    if (changed.length) audit.rows.push({workId: matched.work.id, id: row.id, unitSha256: row.unitSha256, changed});
  }
  return audit;
}
