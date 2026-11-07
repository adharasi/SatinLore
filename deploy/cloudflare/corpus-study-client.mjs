// A founder-protected ES module. Do not bundle or serve it to reader sessions.
// Private source is held in memory. Checkpoints contain categories and digests.
export function corpusStudyClient({testOnly = false} = {}) {
  const PATH = "/api/scene-analysis/corpus-study";
  const VERSION = "2026-11-07-full-corpus-v7";
  const ROLES = ["referenceA", "referenceB", "detector", "transition", "adjudicator"];
  const MAX_CONCURRENCY = 12;
  const encoder = new TextEncoder();
  const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const isId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(value);
  const isFamily = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    encoder.encode(typeof value === "string" ? value : JSON.stringify(value)))), byte => byte.toString(16).padStart(2, "0")).join("");
  const unitKey = (work, unit) => digest([work.sourceSha256, work.indexSha256, unit.id, unit.unitSha256]);
  const fail = code => { throw new TypeError(code); };
  const reasons = ["grounded-current", "context-supported-continuation", "neutral-context", "noncurrent-frame", "mention-only", "nonromantic-activity", "mixed-unit", "hard-stop", "scene-boundary", "frame-transition", "declined-restart", "adult-status-uncertain", "consent-withdrawn", "consent-uncertain", "capacity-uncertain", "protected-content", "scope-uncertain", "insufficient-context", "evidence-outside-window", "ambiguous-language", "unsupported-language", "reference-disagreement", "provider-refusal", "causal-projection", "evidence-after-target", "depicted-noncurrent-interaction"];
  const enums = {
    depiction: ["neutral", "romantic", "suggestive", "explicit", "graphic", "unknown"],
    frame: ["current", "reported", "imagined", "remembered", "mixed", "neutral", "uncertain"],
    interaction: ["none", "mentioned", "depicted", "uncertain"],
    activation: ["cue", "context", "protected", "review"],
    phase: ["quiet", "build", "onset", "sustain", "accent", "ease", "recover", "restart", "unknown"],
    transition: ["none", "stop", "interruption", "present-return", "scene-cut", "reported-entry", "imagined-entry", "memory-entry", "uncertain-continuity", "declined-restart", "non-romantic-activity-stop", "unknown"],
    eligibility: ["eligible", "protected", "uncertain"], adult: ["adult", "minor", "uncertain", "not_applicable"],
    consent: ["present", "withdrawn", "absent", "uncertain", "not_applicable"], capacity: ["present", "absent", "uncertain", "not_applicable"]
  };
  const errorCodes = ["invalid_session", "invalid_origin", "invalid_request", "invalid_manifest", "invalid_batch", "input_limit", "provider_input_limit", "study_unavailable", "budget_unavailable", "run_conflict", "run_limit", "unknown_run", "invalid_reservation", "batch_not_pinned", "already_attempted", "refusal_blocked", "concurrency_limited", "budget_exhausted", "unknown_attempt", "invalid_settlement", "invalid_operation"];
  const decodeIssueCodes = [
    "duplicate_evidence_ids", "unsorted_evidence_ids", "missing_confidence", "invalid_confidence",
    "missing_reason_codes", "invalid_reason_codes", "invalid_reason_code", "duplicate_reason_codes",
    "excess_reason_codes", "missing_eligibility", "noncue_phase_normalized", "invalid_envelope",
    "invalid_row_keys", "invalid_target_id", "duplicate_target_id", "unexpected_target_id",
    "invalid_status_code", "invalid_label_keys", "invalid_label_code", "invalid_evidence_ids",
    "invalid_evidence_id", "excess_evidence_ids", "invalid_knowledge_at_id", "invalid_eligibility_keys",
    "invalid_eligibility_code", "invalid_neutral_shortcut"
  ];
  const failureCodes = ["provider_refusal", "provider_truncated", "invalid_response", "invalid_json", "invalid_schema", "missing_output", "duplicate_output", "evidence_outside_window", "invalid_evidence", "invalid_evidence_timing", "future_eligibility_evidence", "cue_invariant", "phase_invariant", "transition_evidence_missing", "refusal_invariant", "provider_rate_limit", "provider_http_error", "provider_key_rejected", "provider_model_access", "provider_model_mismatch", "provider_billing_limit", "provider_request_rejected", "provider_timeout", "provider_connection", "client_transport_unknown", "client_invalid_response", "client_invalid_row", "refusal_dependency", "settlement_unknown_dependency", "admission_unavailable", ...decodeIssueCodes];
  const labelFields = ["depiction", "frame", "interaction", "activation", "phase", "transition"];
  const decodeIssueFields = new Set([
    "$", "envelope", "rows", "row", "id", "status", "confidence", "reasonCodes", "neutralShortcut",
    "causal", "retrospective", "eligibility",
    ...["causal", "retrospective"].flatMap(scope => [...labelFields, "evidenceIds", "knowledgeAtId"].map(field => `${scope}.${field}`)),
    ...["status", "adult", "consent", "capacity", "evidenceIds"].map(field => `eligibility.${field}`)
  ]);
  const unknown = () => ({depiction: "unknown", frame: "uncertain", interaction: "uncertain", activation: "review", phase: "unknown", transition: "unknown", evidenceIds: [], knowledgeAtId: null});
  const fallback = (unit, code, status = "failed") => ({id: unit.id, unitSha256: unit.unitSha256, status,
    causal: unknown(), retrospective: unknown(), eligibility: {status: "uncertain", adult: "uncertain", consent: "uncertain", capacity: "uncertain", evidenceIds: []}, confidence: 0, reasonCodes: [], failureCode: code});
  const ids = values => Array.isArray(values) && values.length <= 8 && values.every((id, i) => integer(id) && (!i || id > values[i - 1]));

  async function prepareSource(text) {
    if (typeof text !== "string" || encoder.encode(text).byteLength > 8 * 1024 * 1024) fail("source_limit");
    let source; try { source = JSON.parse(text); } catch { fail("invalid_source"); }
    if (source?.schema !== 1 || source.referenceVersion !== "v7" || source.userConsented !== true ||
        source.sourceTransmissionPurpose !== "neutral-editorial-classification-only" || !Array.isArray(source.works) || !source.works.length || source.works.length > 100) fail("invalid_source");
    const seen = new Set(), works = []; let total = 0;
    for (const input of source.works) {
      if (!isId(input.id) || seen.has(input.id) || !isFamily(input.family) || !isHash(input.sourceSha256) || !isHash(input.indexSha256) || !Array.isArray(input.units) || !input.units.length) fail("invalid_source");
      seen.add(input.id); total += input.units.length; if (total > 50000) fail("source_limit");
      let priorId = -1, priorParagraph = -1, priorEnd = 0;
      const units = [];
      for (const inputUnit of input.units) {
        const u = inputUnit;
        if (!integer(u.id) || u.id <= priorId || u.id > 50000 || !integer(u.paragraph) || u.paragraph < priorParagraph ||
            !integer(u.start) || !integer(u.end) || u.end <= u.start || u.paragraph === priorParagraph && u.start < priorEnd ||
            typeof u.text !== "string" || !u.text.trim() || u.text.trim() !== u.text || !u.text.isWellFormed() || u.text.includes("\u0000") ||
            u.text.length !== u.end - u.start || typeof u.structuralBoundary !== "boolean" || !["approved", "blocked", "review"].includes(u.admission)) fail("invalid_source");
        units.push({id: u.id, paragraph: u.paragraph, start: u.start, end: u.end, text: u.text, structuralBoundary: u.structuralBoundary, admission: u.admission});
        priorId = u.id; priorParagraph = u.paragraph; priorEnd = u.end;
      }
      const sourceUnitSha256 = await digest(units.map(u => [u.id, u.paragraph, u.start, u.end, u.text, u.structuralBoundary]));
      if (input.sourceUnitSha256 !== undefined && input.sourceUnitSha256 !== sourceUnitSha256) fail("source_hash_mismatch");
      await Promise.all(units.map(async u => { u.unitSha256 = await digest(u.text); }));
      const indexSha256 = await digest(units.map(u => ({id: u.id, paragraph: u.paragraph, start: u.start, end: u.end, sha256: u.unitSha256, structuralBoundary: u.structuralBoundary})));
      if (indexSha256 !== input.indexSha256) fail("source_hash_mismatch");
      const work = {id: input.id, family: input.family, sourceSha256: input.sourceSha256, indexSha256, sourceUnitSha256, units};
      await Promise.all(units.map(async u => { u.unitKey = await unitKey(work, u); })); works.push(work);
    }
    return {sourceBundleSha256: await digest(text), works, units: total, targets: works.reduce((n, w) => n + w.units.filter(u => !u.structuralBoundary && u.admission === "approved").length, 0)};
  }

  function cleanLabel(label, supplied, targetId, causal, proposed = false) {
    if (!label || !ids(label.evidenceIds) || !proposed && label.evidenceIds.some(id => !supplied.has(id) || causal && id > targetId) ||
        !(label.knowledgeAtId === null || integer(label.knowledgeAtId)) || !proposed && label.knowledgeAtId !== (label.evidenceIds.at(-1) ?? null)) return null;
    const out = {};
    for (const field of labelFields) { if (!enums[field].includes(label[field])) return null; out[field] = label[field]; }
    return {...out, evidenceIds: [...label.evidenceIds], knowledgeAtId: label.knowledgeAtId};
  }
  function cleanEligibility(e, supplied, proposed = false) {
    if (!e || !enums.eligibility.includes(e.status) || !enums.adult.includes(e.adult) || !enums.consent.includes(e.consent) || !enums.capacity.includes(e.capacity) ||
        !ids(e.evidenceIds) || !proposed && e.evidenceIds.some(id => !supplied.has(id))) return null;
    return {status: e.status, adult: e.adult, consent: e.consent, capacity: e.capacity, evidenceIds: [...e.evidenceIds]};
  }
  function cleanDecodeIssues(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 4096).filter(issue => issue &&
      (issue.rowIndex === null || integer(issue.rowIndex)) && (issue.id === null || integer(issue.id)) &&
      decodeIssueFields.has(issue.field) && failureCodes.includes(issue.code) &&
      ["normalized", "error"].includes(issue.severity)).map(issue => ({
        rowIndex: issue.rowIndex, id: issue.id, field: issue.field, code: issue.code, severity: issue.severity
      }));
  }
  function cleanFieldStatus(value) {
    const result = {};
    for (const scope of ["causal", "retrospective"]) {
      const fields = {};
      for (const field of labelFields) {
        const status = value?.[scope]?.[field];
        if (["applied", "unresolved"].includes(status)) fields[field] = status;
      }
      if (Object.keys(fields).length) result[scope] = fields;
    }
    return result;
  }
  function cleanRow(row, unit, supplied) {
    if (!row || row.id !== unit.id || row.unitSha256 !== unit.unitSha256 || !["classified", "uncertain", "refused", "failed", "partial"].includes(row.status)) return fallback(unit, "client_invalid_row");
    const causal = cleanLabel(row.causal, supplied, unit.id, true), retrospective = cleanLabel(row.retrospective, supplied, unit.id, false), eligibility = cleanEligibility(row.eligibility, supplied);
    if (!causal || !retrospective || !eligibility || !integer(row.confidence) || row.confidence > 100 || !Array.isArray(row.reasonCodes) ||
        row.reasonCodes.length > 4 || row.reasonCodes.some(code => !reasons.includes(code)) || row.failureCode !== null && !failureCodes.includes(row.failureCode)) return fallback(unit, "client_invalid_row");
    const out = {id: unit.id, unitSha256: unit.unitSha256, status: row.status, causal, retrospective, eligibility,
      confidence: row.confidence, reasonCodes: [...row.reasonCodes], failureCode: row.failureCode};
    if (row.scopeStatus !== undefined) {
      const s = row.scopeStatus, states = ["classified", "uncertain", "refused", "invalid"];
      if (!s || !states.includes(s.causal) || !states.includes(s.retrospective) || !["valid", "invalid"].includes(s.eligibility)) return fallback(unit, "client_invalid_row");
      out.scopeStatus = {causal: s.causal, retrospective: s.retrospective, eligibility: s.eligibility};
    }
    if (row.validationErrors !== undefined) {
      const e = row.validationErrors;
      if (!e || [e.causal, e.retrospective, e.eligibility].some(code => code !== null && !failureCodes.includes(code))) return fallback(unit, "client_invalid_row");
      out.validationErrors = {causal: e.causal, retrospective: e.retrospective, eligibility: e.eligibility};
    }
    if (row.proposed !== undefined) {
      const p = row.proposed, c = cleanLabel(p?.causal, supplied, unit.id, true, true), r = cleanLabel(p?.retrospective, supplied, unit.id, false, true), e = cleanEligibility(p?.eligibility, supplied, true);
      if (!c || !r || !e) return fallback(unit, "client_invalid_row");
      out.proposed = {causal: c, retrospective: r, eligibility: e};
    }
    if (Array.isArray(row.decodeIssues)) out.decodeIssues = cleanDecodeIssues(row.decodeIssues);
    const fieldStatus = cleanFieldStatus(row.fieldStatus);
    if (Object.keys(fieldStatus).length) out.fieldStatus = fieldStatus;
    return out;
  }
  function cleanResult(value, task, runId) {
    const b = task.batch, targets = b.units.filter(u => u.target), supplied = new Set(b.units.map(u => u.id));
    const statuses = ["parsed", "partial", "refused", "truncated", "invalid_response", "http_error", "network_error", "timed_out", "model_mismatch"];
    if (value?.schema !== 1 || value.measurement !== "live-provider" || value.runId !== runId || value.batchId !== task.batchHash || value.workId !== b.workId ||
        value.sourceSha256 !== b.sourceSha256 || value.indexSha256 !== b.indexSha256 || value.role !== b.role || value.referenceVersion !== VERSION ||
        !statuses.includes(value.status) || !Array.isArray(value.rows) || value.rows.length > 64 || !Array.isArray(value.targetIds) || JSON.stringify(value.targetIds) !== JSON.stringify(targets.map(u => u.id)) ||
        !Array.isArray(value.contextIds) || JSON.stringify(value.contextIds) !== JSON.stringify(b.units.filter(u => !u.target).map(u => u.id))) return null;
    const keyed = new Map(), duplicate = new Set();
    for (const row of value.rows) { if (keyed.has(row?.id)) duplicate.add(row.id); keyed.set(row?.id, row); }
    const rows = targets.map(u => duplicate.has(u.id) ? fallback(u, "client_invalid_row") : cleanRow(keyed.get(u.id), u, supplied));
    const usage = value.usage && integer(value.usage.inputTokens) && integer(value.usage.outputTokens) ? {inputTokens: value.usage.inputTokens, outputTokens: value.usage.outputTokens} : null;
    return {schema: 1, measurement: "live-provider", runId, batchId: task.batchHash, workId: b.workId, sourceSha256: b.sourceSha256, indexSha256: b.indexSha256,
      referenceVersion: VERSION, predictionVersion: b.role === "detector" ? "source-first-detector-v7" : `${b.role}-v7`, role: b.role, model: "gpt-6-luna", causalStatus: "evidence-timing-projection",
      promptSha256: isHash(value.promptSha256) ? value.promptSha256 : null, returnedModel: typeof value.returnedModel === "string" && /^gpt-6-luna(?:-[a-z0-9-]{1,48})?$/.test(value.returnedModel) ? value.returnedModel : null,
      dispatched: value.dispatched === true, rejectedRows: integer(value.rejectedRows) ? value.rejectedRows : null, haltRecommended: value.haltRecommended === true,
      status: value.status, httpStatus: integer(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null,
      elapsedMs: integer(value.elapsedMs) ? value.elapsedMs : null, usage, maxOutputTokens: integer(value.maxOutputTokens) ? value.maxOutputTokens : null,
      targetIds: targets.map(u => u.id), contextIds: b.units.filter(u => !u.target).map(u => u.id),
      blockedUnitKeys: Array.isArray(value.blockedUnitKeys) ? value.blockedUnitKeys.filter(key => isHash(key) && task.unitKeys.includes(key)) : [],
      budget: {reservedMicros: integer(value.budget?.reservedMicros) ? value.budget.reservedMicros : null, settlementConfirmed: value.budget?.settlementConfirmed === true, usageMeasured: value.budget?.usageMeasured === true},
      ...(value.parserRevision === "v7-field-validation-2" ? {parserRevision: value.parserRevision} : {}),
      ...(Array.isArray(value.decodeIssues) ? {decodeIssues: cleanDecodeIssues(value.decodeIssues)} : {}),
      rows};
  }
  function localResult(task, runId, code, status = "not_submitted") {
    const b = task.batch;
    return {schema: 1, measurement: "client-disposition", runId, batchId: task.batchHash, workId: b.workId, sourceSha256: b.sourceSha256, indexSha256: b.indexSha256,
      referenceVersion: VERSION, role: b.role, status, targetIds: b.units.filter(u => u.target).map(u => u.id), contextIds: b.units.filter(u => !u.target).map(u => u.id),
      usage: null, rows: b.units.filter(u => u.target).map(u => fallback(u, code))};
  }
  function meaningful(row) { return JSON.stringify([row.status, row.causal, row.retrospective, row.eligibility]); }
  function adjudicationTargets(prepared, batches) {
    const labels = {referenceA: new Map(), referenceB: new Map()};
    for (const b of batches) if (Object.hasOwn(labels, b.role)) for (const row of b.rows ?? []) if (["classified", "uncertain", "partial"].includes(row.status)) labels[b.role].set(`${b.workId}:${row.id}`, row);
    const jobs = [];
    for (const w of prepared.works) {
      const targetIds = [];
      for (const u of w.units) {
        const a = labels.referenceA.get(`${w.id}:${u.id}`), b = labels.referenceB.get(`${w.id}:${u.id}`);
        if (!a || !b) continue;
        const anchor = [a, b].some(row => [row.causal, row.retrospective].some(l => ["cue", "protected"].includes(l.activation) || !["none", "unknown"].includes(l.transition)));
        if (meaningful(a) !== meaningful(b) || anchor) targetIds.push(u.id);
      }
      if (targetIds.length) jobs.push({workId: w.id, sourceSha256: w.sourceSha256, indexSha256: w.indexSha256, targetIds});
    }
    return jobs;
  }
  function chunks(values, role) {
    const out = []; let offset = 0;
    if (role === "referenceB" && values.length > 32) { out.push(values.slice(0, 32)); offset = 32; }
    while (offset < values.length) {
      let end = Math.min(values.length, offset + 64);
      if (role === "adjudicator") while (end > offset + 1 && values[end - 1].id - values[offset].id > 384) end--;
      out.push(values.slice(offset, end)); offset = end;
    }
    return out;
  }
  async function buildTasks(prepared, selectedRoles, adjudicationJobs = null) {
    if (!selectedRoles.length || selectedRoles.some(role => !ROLES.includes(role)) || new Set(selectedRoles).size !== selectedRoles.length) fail("invalid_roles");
    const tasks = [], jobTargets = new Map();
    if (selectedRoles.includes("adjudicator")) {
      if (!Array.isArray(adjudicationJobs) || !adjudicationJobs.length) fail("adjudication_inputs_missing");
      for (const job of adjudicationJobs) {
        const work = prepared.works.find(w => w.id === job.workId), targets = job.targetIds ?? job.unitIds;
        if (!work || job.sourceSha256 !== work.sourceSha256 || job.indexSha256 !== work.indexSha256 || !Array.isArray(targets) || !targets.length || targets.some(id => !integer(id))) fail("invalid_adjudication_jobs");
        const set = jobTargets.get(work.id) ?? new Set();
        for (const id of targets) { const u = work.units.find(unit => unit.id === id); if (!u || u.structuralBoundary || u.admission !== "approved") fail("invalid_adjudication_jobs"); set.add(id); }
        jobTargets.set(work.id, set);
      }
    }
    for (const role of selectedRoles) for (const work of prepared.works) {
      const available = work.units.filter(u => u.admission === "approved" && !u.structuralBoundary);
      const availableIndex = new Map(available.map((u, index) => [u.id, index]));
      const keyById = new Map(work.units.map(u => [u.id, u.unitKey]));
      const selected = role === "adjudicator" ? available.filter(u => jobTargets.get(work.id)?.has(u.id)) : available;
      for (const targets of chunks(selected, role)) {
        const wanted = new Set(targets.map(u => u.id)), first = availableIndex.get(targets[0].id), last = availableIndex.get(targets.at(-1).id);
        let candidates;
        if (role === "detector") candidates = available.slice(Math.max(0, first - 8), last + 1);
        else {
          const openings = role === "referenceA" ? available.slice(0, 24) : [], width = 512 - openings.length;
          const start = Math.max(0, Math.min(first - Math.floor((width - (last - first + 1)) / 2), available.length - width));
          const local = available.slice(start, start + width);
          candidates = [...new Map([...openings, ...local, ...targets].map(u => [u.id, u])).values()].sort((a, b) => a.id - b.id);
        }
        const maxUnits = role === "detector" ? 80 : 512;
        const priority = u => wanted.has(u.id) ? -1 : (role === "referenceA" && u.id < (available[24]?.id ?? Infinity) ? 0 : 1) * 1e7 + Math.min(Math.abs(u.id - targets[0].id), Math.abs(u.id - targets.at(-1).id));
        candidates.sort((a, b) => priority(a) - priority(b) || a.id - b.id);
        candidates = candidates.slice(0, maxUnits);
        const make = () => ({schema: 1, workId: work.id, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256, referenceVersion: VERSION, role,
          units: [...candidates].sort((a, b) => a.id - b.id).map(u => ({id: u.id, paragraph: u.paragraph, unitSha256: u.unitSha256, text: u.text, target: wanted.has(u.id), structuralBoundary: u.structuralBoundary}))});
        let batch = make();
        while (encoder.encode(JSON.stringify(batch)).byteLength > 112000 || batch.units.reduce((n, u) => n + encoder.encode(u.text).byteLength, 0) > 110000) {
          const index = candidates.findLastIndex(u => !wanted.has(u.id)); if (index < 0) fail("target_limit"); candidates.splice(index, 1); batch = make();
        }
        if (batch.units.filter(u => u.target).length !== targets.length) fail("target_limit");
        tasks.push({batch, batchHash: await digest(batch), unitKeys: batch.units.map(u => keyById.get(u.id))});
      }
    }
    if (!tasks.length || tasks.length > 1500 || new Set(tasks.map(t => t.batchHash)).size !== tasks.length) fail("plan_limit");
    return tasks;
  }

  function resumeDisposition(checkpoint, prepared) {
    if (!checkpoint) return {batches: [], attempts: [], plannedBatches: [], blockedUnitKeys: [], heldUnitKeys: [], checkpoint: null, jobs: null};
    if (checkpoint.schema !== 1 || checkpoint.sourceBundleSha256 !== prepared.sourceBundleSha256) fail("checkpoint_source_mismatch");
    if (Array.isArray(checkpoint.jobs) && !checkpoint.batches && [VERSION, "v7"].includes(checkpoint.referenceVersion)) return {batches: [], attempts: [], plannedBatches: [], blockedUnitKeys: [], heldUnitKeys: [], checkpoint: null, jobs: checkpoint.jobs};
    if (checkpoint.kind !== "satinlore-corpus-study-checkpoint" || checkpoint.referenceVersion !== VERSION || !isId(checkpoint.runId) || !Array.isArray(checkpoint.manifest) || !checkpoint.manifest.length || checkpoint.manifest.length > 1500 || checkpoint.manifest.some(h => !isHash(h)) || new Set(checkpoint.manifest).size !== checkpoint.manifest.length || !isHash(checkpoint.manifestHash) ||
        !Array.isArray(checkpoint.batches) || !Array.isArray(checkpoint.attempts) || !Array.isArray(checkpoint.plannedBatches) || checkpoint.plannedBatches.length > 10000 ||
        !Array.isArray(checkpoint.blockedUnitKeys) || checkpoint.blockedUnitKeys.some(h => !isHash(h)) || !Array.isArray(checkpoint.heldUnitKeys ?? []) || (checkpoint.heldUnitKeys ?? []).some(h => !isHash(h))) fail("invalid_checkpoint");
    return {batches: checkpoint.batches, attempts: checkpoint.attempts, plannedBatches: checkpoint.plannedBatches, blockedUnitKeys: checkpoint.blockedUnitKeys, heldUnitKeys: checkpoint.heldUnitKeys ?? [], checkpoint, jobs: null};
  }
  function planRecord(task) {
    const b = task.batch;
    return {batchId: task.batchHash, workId: b.workId, role: b.role, targetIds: b.units.filter(u => u.target).map(u => u.id), contextIds: b.units.filter(u => !u.target).map(u => u.id)};
  }
  async function recoverTask(prepared, record) {
    if (!record || !isHash(record.batchId) || !isId(record.workId) || !ROLES.includes(record.role) ||
        !Array.isArray(record.targetIds) || !record.targetIds.length || record.targetIds.length > 64 || !Array.isArray(record.contextIds) || record.targetIds.length + record.contextIds.length > (record.role === "detector" ? 80 : 512)) fail("invalid_checkpoint");
    const all = [...record.targetIds, ...record.contextIds], target = new Set(record.targetIds);
    if (all.some(id => !integer(id)) || new Set(all).size !== all.length) fail("invalid_checkpoint");
    const work = prepared.works.find(w => w.id === record.workId), mapped = new Map(work?.units.map(u => [u.id, u]));
    const selected = all.sort((a, b) => a - b).map(id => mapped.get(id));
    if (!work || selected.some(u => !u || u.structuralBoundary || u.admission !== "approved")) fail("checkpoint_plan_mismatch");
    const batch = {schema: 1, workId: work.id, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256, referenceVersion: VERSION, role: record.role,
      units: selected.map(u => ({id: u.id, paragraph: u.paragraph, unitSha256: u.unitSha256, text: u.text, target: target.has(u.id), structuralBoundary: u.structuralBoundary}))};
    const batchHash = await digest(batch);
    if (batchHash !== record.batchId) fail("checkpoint_plan_mismatch");
    return {batch, batchHash, unitKeys: selected.map(u => u.unitKey)};
  }
  const helpers = {prepareSource, buildTasks, digest, unitKey, cleanResult, cleanRow, localResult, adjudicationTargets, resumeDisposition, planRecord, recoverTask, VERSION};
  if (testOnly) return helpers;

  const el = id => document.getElementById(id);
  const state = {prepared: null, tasks: [], runId: null, manifest: [], selectedRoles: [], batches: new Map(), attempts: new Map(), history: new Map(), blocked: new Set(), held: new Set(), running: false, preparing: false, paused: true, active: 0, registered: false, pauseCode: null};
  const message = text => { el("progress").textContent = text; };
  const selected = () => ROLES.filter(role => el(role).checked);
  const update = () => {
    const rows = [...state.batches.values()].flatMap(b => b.rows ?? []), attempted = [...state.attempts.values()];
    el("summary").textContent = JSON.stringify({sourceItems: state.prepared?.works.length ?? 0, admittedTargets: state.prepared?.targets ?? 0, plannedBatches: state.tasks.length,
      attemptsRecorded: attempted.length, inFlight: state.active, completedBatches: state.batches.size, classifiedRows: rows.filter(r => r.status === "classified").length,
      unresolvedRows: rows.filter(r => r.status !== "classified").length, blockedUnits: state.blocked.size, heldUnits: state.held.size,
      reportedInputTokens: [...state.batches.values()].reduce((n, b) => n + (b.usage?.inputTokens ?? 0), 0), reportedOutputTokens: [...state.batches.values()].reduce((n, b) => n + (b.usage?.outputTokens ?? 0), 0)}, null, 2);
    el("prepare").disabled = state.running || state.preparing; el("start").disabled = state.running || state.preparing || !state.tasks.length; el("pause").disabled = !state.running; el("download").disabled = !state.prepared;
    for (const name of ["source", "checkpoint", "adjudication", ...ROLES]) if (el(name)) el(name).disabled = state.running || state.preparing;
  };
  const snapshot = () => ({schema: 1, kind: "satinlore-corpus-study-checkpoint", referenceVersion: VERSION, sourceBundleSha256: state.prepared.sourceBundleSha256,
    runId: state.runId, manifest: [...state.manifest], manifestHash: state.manifestHash, selectedRoles: [...state.selectedRoles],
    contextPolicy: {referenceA: "opening-24-plus-centered-local-with-gaps", referenceB: "centered-local", adjudicator: "blind-centered-local", referenceBFirstPartition: 32, detectorPrecedingUnits: 8, maxConcurrency: MAX_CONCURRENCY, overlappingWindowsConcurrent: false},
    workRoster: state.prepared.works.map(w => ({workId: w.id, family: w.family, sourceSha256: w.sourceSha256, indexSha256: w.indexSha256, sourceUnitSha256: w.sourceUnitSha256, units: w.units.length, targets: w.units.filter(u => !u.structuralBoundary && u.admission === "approved").length})),
    plannedBatches: [...state.history.values()], attempts: [...state.attempts.values()], batches: [...state.batches.values()], blockedUnitKeys: [...state.blocked].sort(), heldUnitKeys: [...state.held].sort(), updatedAt: new Date().toISOString()});

  async function readInput(input, maxBytes) {
    const file = input.files?.[0]; if (!file || file.size > maxBytes) fail("file_limit");
    const bytes = await file.arrayBuffer(); if (bytes.byteLength > maxBytes) fail("file_limit"); return new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes);
  }
  async function prepare() {
    if (state.running) return;
    message("Checking source hashes and preparing the selected passes…");
    const prepared = await prepareSource(await readInput(el("source"), 8 * 1024 * 1024));
    const readJson = async (name, limit) => { try { return JSON.parse(await readInput(el(name), limit)); } catch { fail("invalid_checkpoint"); } };
    const imported = el("checkpoint").files?.length ? await readJson("checkpoint", 64 * 1024 * 1024) : null;
    const retained = state.prepared?.sourceBundleSha256 === prepared.sourceBundleSha256 ? snapshot() : null;
    const resumed = [resumeDisposition(imported, prepared), resumeDisposition(retained, prepared)], roles = selected();
    const sidecar = el("adjudication")?.files?.length ? resumeDisposition(await readJson("adjudication", 8 * 1024 * 1024), prepared) : null;
    if (sidecar && !sidecar.jobs) fail("invalid_adjudication_jobs");
    const allRows = [...new Map(resumed.flatMap(r => r.batches).map(b => [b.batchId, b])).values()];
    const jobs = sidecar?.jobs ?? resumed[0].jobs ?? (roles.includes("adjudicator") ? adjudicationTargets(prepared, allRows) : null);
    const tasks = await buildTasks(prepared, roles, jobs), byHash = new Map(tasks.map(t => [t.batchHash, t]));
    const manifest = tasks.map(t => t.batchHash), manifestHash = await digest(manifest);
    for (const r of resumed) if (r.checkpoint && await digest(r.checkpoint.manifest) !== r.checkpoint.manifestHash) fail("invalid_checkpoint");
    const sameManifest = resumed.findLast(r => r.checkpoint?.manifestHash === manifestHash)?.checkpoint;
    const runId = sameManifest ? sameManifest.runId : `corpus-${crypto.randomUUID()}`;
    const batches = new Map(), attempts = new Map(), history = new Map(tasks.map(task => [task.batchHash, planRecord(task)]));
    const priorRecords = new Map(resumed.flatMap(r => r.plannedBatches).map(p => [p.batchId, p]));
    const resolvePrior = async record => {
      let task = byHash.get(record.batchId);
      if (!task) { task = await recoverTask(prepared, priorRecords.get(record.batchId) ?? record); byHash.set(task.batchHash, task); }
      history.set(task.batchHash, planRecord(task)); return task;
    };
    for (const b of allRows) {
      const task = await resolvePrior(b); if (!isId(b.runId)) fail("checkpoint_plan_mismatch");
      if (b.measurement === "live-provider") { const clean = cleanResult(b, task, b.runId); if (!clean) fail("invalid_checkpoint"); batches.set(b.batchId, clean); }
      else if (b.measurement === "client-disposition" && ["refusal_blocked", "unknown", "settlement_unknown"].includes(b.status)) batches.set(b.batchId, localResult(task, b.runId, b.status === "refusal_blocked" ? "refusal_dependency" : b.status === "settlement_unknown" ? "settlement_unknown_dependency" : "client_transport_unknown", b.status));
      else fail("invalid_checkpoint");
      attempts.set(b.batchId, {batchId: b.batchId, runId: b.runId, role: task.batch.role, workId: task.batch.workId, state: b.measurement === "live-provider" ? "complete" : b.status === "refusal_blocked" ? "blocked" : "unknown"});
    }
    for (const a of [...new Map(resumed.flatMap(r => r.attempts).map(a => [a.batchId, a])).values()]) {
      if (!isHash(a.batchId) || !isId(a.runId) || !ROLES.includes(a.role) || !isId(a.workId) || !["sending", "complete", "unknown", "blocked", "deferred"].includes(a.state)) fail("invalid_checkpoint");
      const task = await resolvePrior(a); if (task.batch.workId !== a.workId || task.batch.role !== a.role) fail("checkpoint_plan_mismatch");
      if (!attempts.has(a.batchId)) {
        const status = a.state === "deferred" ? "deferred" : "unknown";
        attempts.set(a.batchId, {batchId: a.batchId, runId: a.runId, role: a.role, workId: a.workId, state: status});
        if (status === "unknown") batches.set(a.batchId, localResult(task, a.runId, "client_transport_unknown", "unknown"));
      }
    }
    const knownKeys = new Set(prepared.works.flatMap(w => w.units.map(u => u.unitKey)));
    const verifiedKeys = key => knownKeys.has(key);
    Object.assign(state, {prepared, tasks, runId, manifest, manifestHash, selectedRoles: roles, batches, attempts, history,
      blocked: new Set(resumed.flatMap(r => r.blockedUnitKeys).filter(verifiedKeys)), held: new Set(resumed.flatMap(r => r.heldUnitKeys).filter(verifiedKeys)), paused: true, registered: false});
    for (const a of attempts.values()) if (a.state === "unknown") byHash.get(a.batchId)?.unitKeys.forEach(key => state.held.add(key));
    for (const b of batches.values()) for (const key of b.blockedUnitKeys ?? []) state.blocked.add(key);
    update(); message(`Prepared ${tasks.length} batches. Start sends these exact batches for neutral classification. Existing attempted batches will not be re-billed.`);
  }
  const responseJson = async response => {
    const length = response.headers.get("Content-Length"); if (length !== null && Number(length) > 2 * 1024 * 1024) fail("invalid_response");
    const text = await response.text(); if (encoder.encode(text).byteLength > 2 * 1024 * 1024) fail("invalid_response");
    try { return JSON.parse(text); } catch { fail("invalid_response"); }
  };
  const post = body => fetch(body.batch ? `${PATH}/batch` : `${PATH}/register`, {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body), redirect: "error", cache: "no-store"});
  async function execute(task) {
    const existing = state.attempts.get(task.batchHash); if (existing && existing.state !== "deferred") return;
    if (task.unitKeys.some(key => state.blocked.has(key))) {
      state.attempts.set(task.batchHash, {batchId: task.batchHash, runId: state.runId, role: task.batch.role, workId: task.batch.workId, state: "blocked"});
      state.batches.set(task.batchHash, localResult(task, state.runId, "refusal_dependency", "refusal_blocked")); update(); return;
    }
    if (task.unitKeys.some(key => state.held.has(key))) {
      state.attempts.set(task.batchHash, {batchId: task.batchHash, runId: state.runId, role: task.batch.role, workId: task.batch.workId, state: "unknown"});
      state.batches.set(task.batchHash, localResult(task, state.runId, "settlement_unknown_dependency", "settlement_unknown")); update(); return;
    }
    state.active++; state.attempts.set(task.batchHash, {batchId: task.batchHash, runId: state.runId, role: task.batch.role, workId: task.batch.workId, state: "sending"}); update();
    const pause = code => { state.paused = true; state.pauseCode = code; };
    const markUnknown = code => {
      state.attempts.get(task.batchHash).state = "unknown";
      state.batches.set(task.batchHash, localResult(task, state.runId, code, "unknown"));
      task.unitKeys.forEach(key => state.held.add(key)); pause(code);
    };
    try {
      const response = await post({runId: state.runId, batchHash: task.batchHash, batch: task.batch, sourceConsent: true}), value = await responseJson(response);
      if (!response.ok) {
        const code = errorCodes.includes(value?.code) ? value.code : "invalid_request";
        if (code === "refusal_blocked") {
          for (const key of Array.isArray(value.blockedUnitKeys) ? value.blockedUnitKeys : []) if (task.unitKeys.includes(key)) state.blocked.add(key);
          state.attempts.get(task.batchHash).state = "blocked"; state.batches.set(task.batchHash, localResult(task, state.runId, "refusal_dependency", "refusal_blocked"));
        } else if (["budget_exhausted", "concurrency_limited", "budget_unavailable", "study_unavailable"].includes(code)) { state.attempts.get(task.batchHash).state = "deferred"; pause(code); }
        else markUnknown("client_transport_unknown");
        return;
      }
      const result = cleanResult(value, task, state.runId);
      if (!result) { markUnknown("client_invalid_response"); return; }
      const refused = new Set(result.rows.filter(r => r.status === "refused").map(r => r.id));
      if (result.status === "refused") task.unitKeys.forEach(key => state.blocked.add(key));
      task.batch.units.forEach((unit, index) => { if (refused.has(unit.id)) state.blocked.add(task.unitKeys[index]); });
      result.blockedUnitKeys.forEach(key => state.blocked.add(key));
      state.batches.set(task.batchHash, result); state.attempts.get(task.batchHash).state = "complete";
      if (!result.budget.settlementConfirmed) { task.unitKeys.forEach(key => state.held.add(key)); pause("settlement_unconfirmed"); }
      else if (result.haltRecommended) pause(result.rows.find(row => row.failureCode)?.failureCode ?? "provider_halt");
    } catch {
      markUnknown("client_transport_unknown");
    } finally { state.active--; update(); }
  }
  async function start() {
    if (state.running || !state.tasks.length) return;
    if (!el("consent").checked || JSON.stringify(selected()) !== JSON.stringify(state.selectedRoles)) { message("Confirm the selected source-processing choice and prepare again after changing passes."); return; }
    state.running = true; state.paused = false; state.pauseCode = null; update();
    try {
      if (!state.registered) {
        const response = await post({runId: state.runId, manifest: state.manifest, sourceConsent: true}), value = await responseJson(response);
        if (!response.ok || value?.registered !== true) { message("The immutable run manifest could not be registered. No source batches were sent."); return; }
        state.registered = true;
      }
      message(`Running up to ${MAX_CONCURRENCY} nonoverlapping windows concurrently. Pause lets in-flight requests finish.`);
      const pending = state.tasks.filter(task => !state.attempts.has(task.batchHash) || state.attempts.get(task.batchHash).state === "deferred"), inFlight = new Map(), locked = new Set();
      while ((!state.paused && pending.length) || inFlight.size) {
        while (!state.paused && inFlight.size < MAX_CONCURRENCY && pending.length) {
          const index = pending.findIndex(task => task.unitKeys.every(key => !locked.has(key)));
          if (index < 0) break;
          const [task] = pending.splice(index, 1); task.unitKeys.forEach(key => locked.add(key));
          inFlight.set(task.batchHash, execute(task).finally(() => { inFlight.delete(task.batchHash); task.unitKeys.forEach(key => locked.delete(key)); }));
        }
        if (!inFlight.size) break;
        await Promise.race(inFlight.values());
      }
      if (state.paused) message(`Paused after in-flight calls completed${state.pauseCode ? ` (${state.pauseCode})` : ""}. Download the source-free checkpoint.`);
      else message("Selected passes finished. Download the source-free checkpoint before closing this page.");
    } catch { message("The study could not start. Source remains in this page. Download any existing checkpoint."); }
    finally { state.running = false; state.paused = true; update(); }
  }
  el("prepare").addEventListener("click", () => {
    if (state.running || state.preparing) return;
    state.preparing = true; update();
    void prepare().catch(() => { state.tasks = []; message("Preparation failed. Check the source/checkpoint version, hashes, file bounds and selected passes. No source was sent."); }).finally(() => { state.preparing = false; update(); });
  });
  el("start").addEventListener("click", () => { void start(); });
  el("pause").addEventListener("click", () => { state.paused = true; message("Pausing after in-flight calls finish…"); });
  el("consent").addEventListener("change", () => { if (!el("consent").checked && state.running) { state.paused = true; message("Source permission removed. No new batches will start."); } });
  el("download").addEventListener("click", () => {
    if (!state.prepared) return;
    const content = JSON.stringify(snapshot());
    if (encoder.encode(content).byteLength > 64 * 1024 * 1024) message("Results exported for offline analysis. This file exceeds the 64 MiB resume bound.");
    const blob = new Blob([content], {type: "application/json"}), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `satinlore-corpus-${state.runId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const name of ["source", "checkpoint", "adjudication", ...ROLES]) el(name)?.addEventListener("change", () => { if (!state.running && !state.preparing) { state.tasks = []; update(); message("Prepare the newly selected source, checkpoint and passes before starting."); } });
  window.addEventListener("pagehide", () => { state.paused = true; });
  update();
}
if (typeof document !== "undefined") corpusStudyClient();
