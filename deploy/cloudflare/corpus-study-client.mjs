// A founder-protected ES module. Do not bundle or serve it to reader sessions.
// Private source is held in memory. Checkpoints contain categories and digests.
export function corpusStudyClient({testOnly = false} = {}) {
  const PATH = "/api/scene-analysis/corpus-study";
  const VERSION = "2026-11-07-full-corpus-v7";
  const ROLES = ["referenceA", "referenceB", "detector", "transition", "adjudicator"];
  const MAX_CONCURRENCY = 12;
  const DEFAULT_CONCURRENCY = 6;
  const BATCH_STREAM_TYPE = "application/x-ndjson";
  const MAX_BATCH_RESULT_BYTES = 2 * 1024 * 1024;
  const MAX_HEARTBEATS = 16;
  const EVIDENCE_PAIR_PLAN_KIND = "satinlore-evidence-pair-plan";
  const MAX_EVIDENCE_PAIRS = 150;
  const LEDGER_STATES = ["complete", "refused", "inflight", "unknown", "absent"];
  const encoder = new TextEncoder();
  const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const isId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(value);
  const isFamily = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    encoder.encode(typeof value === "string" ? value : JSON.stringify(value)))), byte => byte.toString(16).padStart(2, "0")).join("");
  const unitKey = (work, unit) => digest([work.sourceSha256, work.indexSha256, unit.id, unit.unitSha256]);
  const fail = code => { throw new TypeError(code); };
  const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
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
  const failureCodes = ["provider_refusal", "provider_truncated", "invalid_response", "invalid_json", "invalid_schema", "missing_output", "duplicate_output", "evidence_outside_window", "invalid_evidence", "invalid_evidence_timing", "future_eligibility_evidence", "cue_invariant", "phase_invariant", "transition_evidence_missing", "refusal_invariant", "provider_rate_limit", "provider_http_error", "provider_key_rejected", "provider_model_access", "provider_model_mismatch", "provider_billing_limit", "provider_request_rejected", "provider_timeout", "provider_connection", "client_transport_unknown", "client_invalid_response", "client_invalid_row", "refusal_dependency", "settlement_unknown_dependency", "admission_unavailable", "provider_response_lost", "reconciled_refusal", ...decodeIssueCodes];
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
  function cleanTransport(value) {
    if (!["no_response", "response_invalid", "response_rejected", "response_mismatch"].includes(value?.stage)) return null;
    const httpStatus = Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null;
    return {stage: value.stage, httpStatus};
  }
  async function* responseChunks(response, maxBytes) {
    if (!response.body) fail("invalid_response");
    const length = response.headers.get("Content-Length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) fail("invalid_response");
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) fail("invalid_response");
        yield value;
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  function responseType(response) {
    return response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  }
  async function responseJson(response) {
    if (responseType(response) !== "application/json") fail("invalid_response");
    const decoder = new TextDecoder("utf-8", {fatal: true});
    let text = "";
    for await (const chunk of responseChunks(response, MAX_BATCH_RESULT_BYTES)) text += decoder.decode(chunk, {stream: true});
    return JSON.parse(text + decoder.decode());
  }
  async function readBatchResponse(response) {
    if (!response.ok || responseType(response) !== BATCH_STREAM_TYPE) return responseJson(response);
    const decoder = new TextDecoder("utf-8", {fatal: true});
    let heartbeats = 0, pending = "", result;
    for await (const chunk of responseChunks(response, MAX_BATCH_RESULT_BYTES + 512)) {
      pending += decoder.decode(chunk, {stream: true});
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (result !== undefined) fail("invalid_response");
        if (line === '{"type":"heartbeat"}') {
          if (++heartbeats > MAX_HEARTBEATS) fail("invalid_response");
          continue;
        }
        if (!heartbeats || encoder.encode(line).byteLength >= MAX_BATCH_RESULT_BYTES) fail("invalid_response");
        const frame = JSON.parse(line);
        if (!frame || typeof frame !== "object" || Object.keys(frame).length !== 2 ||
            frame.type !== "result" || !Object.hasOwn(frame, "value") || !frame.value ||
            typeof frame.value !== "object" || Array.isArray(frame.value)) fail("invalid_response");
        result = frame.value;
      }
    }
    if (pending + decoder.decode() || result === undefined) fail("invalid_response");
    return result;
  }
  function localResult(task, runId, code, status = "not_submitted", transport = null) {
    const b = task.batch, trace = cleanTransport(transport);
    return {schema: 1, measurement: "client-disposition", runId, batchId: task.batchHash, workId: b.workId, sourceSha256: b.sourceSha256, indexSha256: b.indexSha256,
      referenceVersion: VERSION, role: b.role, status, targetIds: b.units.filter(u => u.target).map(u => u.id), contextIds: b.units.filter(u => !u.target).map(u => u.id),
      ...(trace ? {transport: trace} : {}),
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
  function makeBatch(work, role, units, targetIds) {
    return {schema: 1, workId: work.id, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256, referenceVersion: VERSION, role,
      units: units.map(u => ({id: u.id, paragraph: u.paragraph, unitSha256: u.unitSha256, text: u.text, target: targetIds.has(u.id), structuralBoundary: u.structuralBoundary}))};
  }
  function fitsBatch(batch) {
    return encoder.encode(JSON.stringify(batch)).byteLength <= 112000 &&
      batch.units.reduce((n, u) => n + encoder.encode(u.text).byteLength, 0) <= 110000;
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
        const make = () => makeBatch(work, role, [...candidates].sort((a, b) => a.id - b.id), wanted);
        let batch = make();
        while (!fitsBatch(batch)) {
          const index = candidates.findLastIndex(u => !wanted.has(u.id)); if (index < 0) fail("target_limit"); candidates.splice(index, 1); batch = make();
        }
        if (batch.units.filter(u => u.target).length !== targets.length) fail("target_limit");
        tasks.push({batch, batchHash: await digest(batch), unitKeys: batch.units.map(u => keyById.get(u.id))});
      }
    }
    if (!tasks.length || tasks.length > 1500 || new Set(tasks.map(t => t.batchHash)).size !== tasks.length) fail("plan_limit");
    return tasks;
  }

  // Both arms use the ordinary detector contract. Only earlier context differs.
  async function buildEvidencePairTasks(prepared, plan) {
    if (!exactKeys(plan, ["schema", "kind", "sourceBundleSha256", "pairs"]) || plan.schema !== 1 ||
        plan.kind !== EVIDENCE_PAIR_PLAN_KIND || !isHash(plan.sourceBundleSha256) ||
        plan.sourceBundleSha256 !== prepared.sourceBundleSha256 || !Array.isArray(plan.pairs) ||
        !plan.pairs.length || plan.pairs.length > MAX_EVIDENCE_PAIRS) fail("invalid_evidence_pair_plan");
    const tasks = [], pairs = [], seenTargets = new Set();
    const workById = new Map(prepared.works.map(work => [work.id, work]));
    const unitsByWork = new Map();
    for (const pair of plan.pairs) {
      if (!exactKeys(pair, ["workId", "sourceSha256", "indexSha256", "targetId", "baselineContextIds", "addedContextIds"])) fail("invalid_evidence_pair");
      const {workId, sourceSha256, indexSha256, targetId, baselineContextIds, addedContextIds} = pair;
      const work = workById.get(workId), targetKey = `${workId}:${targetId}`;
      if (!work || work.sourceSha256 !== sourceSha256 || work.indexSha256 !== indexSha256 ||
          !integer(targetId) || seenTargets.has(targetKey) || !ids(baselineContextIds) || !ids(addedContextIds) ||
          !addedContextIds.length || baselineContextIds.length + addedContextIds.length > 8) fail("invalid_evidence_pair");
      seenTargets.add(targetKey);
      if (!unitsByWork.has(workId)) unitsByWork.set(workId, new Map(work.units.map(unit => [unit.id, unit])));
      const units = unitsByWork.get(workId), contextIds = [...baselineContextIds, ...addedContextIds];
      if (new Set(contextIds).size !== contextIds.length || contextIds.some(id => id >= targetId) ||
          [...contextIds, targetId].some(id => units.get(id)?.admission !== "approved" || units.get(id).structuralBoundary)) fail("invalid_evidence_pair");
      const targetIds = new Set([targetId]);
      async function buildArm(context) {
        const selected = [...context].sort((a, b) => a - b).concat(targetId).map(id => units.get(id));
        const batch = makeBatch(work, "detector", selected, targetIds);
        if (!fitsBatch(batch)) fail("evidence_pair_limit");
        return {batch, batchHash: await digest(batch), unitKeys: selected.map(unit => unit.unitKey)};
      }
      const [baseline, enriched] = await Promise.all([buildArm(baselineContextIds), buildArm(contextIds)]);
      tasks.push(baseline, enriched);
      pairs.push({workId, sourceSha256, indexSha256, targetId, baselineContextIds: [...baselineContextIds],
        addedContextIds: [...addedContextIds], baselineBatchId: baseline.batchHash, enrichedBatchId: enriched.batchHash});
    }
    return {tasks, pairs};
  }

  function resumeDisposition(checkpoint, prepared) {
    if (!checkpoint) return {batches: [], attempts: [], plannedBatches: [], blockedUnitKeys: [], heldUnitKeys: [], reconciliationEvents: [], checkpoint: null, jobs: null};
    if (checkpoint.schema !== 1 || checkpoint.sourceBundleSha256 !== prepared.sourceBundleSha256) fail("checkpoint_source_mismatch");
    if (Array.isArray(checkpoint.jobs) && !checkpoint.batches && [VERSION, "v7"].includes(checkpoint.referenceVersion)) return {batches: [], attempts: [], plannedBatches: [], blockedUnitKeys: [], heldUnitKeys: [], reconciliationEvents: [], checkpoint: null, jobs: checkpoint.jobs};
    if (checkpoint.kind !== "satinlore-corpus-study-checkpoint" || checkpoint.referenceVersion !== VERSION || !isId(checkpoint.runId) || !Array.isArray(checkpoint.manifest) || !checkpoint.manifest.length || checkpoint.manifest.length > 1500 || checkpoint.manifest.some(h => !isHash(h)) || new Set(checkpoint.manifest).size !== checkpoint.manifest.length || !isHash(checkpoint.manifestHash) ||
        !Array.isArray(checkpoint.batches) || !Array.isArray(checkpoint.attempts) || !Array.isArray(checkpoint.plannedBatches) || checkpoint.plannedBatches.length > 10000 ||
        !Array.isArray(checkpoint.blockedUnitKeys) || checkpoint.blockedUnitKeys.some(h => !isHash(h)) || !Array.isArray(checkpoint.heldUnitKeys ?? []) || (checkpoint.heldUnitKeys ?? []).some(h => !isHash(h)) ||
        !Array.isArray(checkpoint.reconciliationEvents ?? []) || (checkpoint.reconciliationEvents ?? []).length > 10000) fail("invalid_checkpoint");
    return {batches: checkpoint.batches, attempts: checkpoint.attempts, plannedBatches: checkpoint.plannedBatches, blockedUnitKeys: checkpoint.blockedUnitKeys, heldUnitKeys: checkpoint.heldUnitKeys ?? [], reconciliationEvents: checkpoint.reconciliationEvents ?? [], checkpoint, jobs: null};
  }
  function planRecord(task) {
    const b = task.batch;
    return {batchId: task.batchHash, workId: b.workId, role: b.role, targetIds: b.units.filter(u => u.target).map(u => u.id), contextIds: b.units.filter(u => !u.target).map(u => u.id)};
  }
  async function validateEvidencePairResume(resumed, evidencePairPlan, tasks, manifest, manifestHash) {
    const pairedCheckpoint = resumed.some(r => r.checkpoint && Object.hasOwn(r.checkpoint, "evidencePairPlan"));
    if (!evidencePairPlan && !pairedCheckpoint) return;
    if (!evidencePairPlan || resumed.some(r => r.jobs)) fail("evidence_pair_checkpoint_mismatch");
    const knownBatches = new Set(manifest), runIds = new Set();
    for (const r of resumed) {
      const checkpoint = r.checkpoint;
      if (!checkpoint) continue;
      const metadata = checkpoint.evidencePairPlan;
      if (!exactKeys(metadata, ["schema", "kind", "sourceBundleSha256", "pairs", "planSha256"])) fail("evidence_pair_checkpoint_mismatch");
      const {schema, kind, sourceBundleSha256, pairs, planSha256} = metadata;
      if (planSha256 !== evidencePairPlan.planSha256 ||
          await digest({schema, kind, sourceBundleSha256, pairs}) !== planSha256 ||
          checkpoint.manifestHash !== manifestHash || JSON.stringify(checkpoint.manifest) !== JSON.stringify(manifest) ||
          JSON.stringify(checkpoint.selectedRoles) !== '["detector"]' ||
          r.plannedBatches.length !== tasks.length ||
          r.plannedBatches.some((record, i) => JSON.stringify(record) !== JSON.stringify(planRecord(tasks[i])))) fail("evidence_pair_checkpoint_mismatch");
      const sameRun = record => record?.runId === checkpoint.runId && knownBatches.has(record.batchId);
      if ([r.batches, r.attempts].some(rows => !rows.every(sameRun) || new Set(rows.map(row => row.batchId)).size !== rows.length) ||
          !r.reconciliationEvents.every(sameRun)) fail("evidence_pair_checkpoint_mismatch");
      runIds.add(checkpoint.runId);
    }
    if (runIds.size > 1) fail("evidence_pair_checkpoint_mismatch");
  }
  async function recoverTask(prepared, record) {
    if (!record || !isHash(record.batchId) || !isId(record.workId) || !ROLES.includes(record.role) ||
        !Array.isArray(record.targetIds) || !record.targetIds.length || record.targetIds.length > 64 || !Array.isArray(record.contextIds) || record.targetIds.length + record.contextIds.length > (record.role === "detector" ? 80 : 512)) fail("invalid_checkpoint");
    const all = [...record.targetIds, ...record.contextIds], target = new Set(record.targetIds);
    if (all.some(id => !integer(id)) || new Set(all).size !== all.length) fail("invalid_checkpoint");
    const work = prepared.works.find(w => w.id === record.workId), mapped = new Map(work?.units.map(u => [u.id, u]));
    const selected = all.sort((a, b) => a - b).map(id => mapped.get(id));
    if (!work || selected.some(u => !u || u.structuralBoundary || u.admission !== "approved")) fail("checkpoint_plan_mismatch");
    const batch = makeBatch(work, record.role, selected, target);
    const batchHash = await digest(batch);
    if (batchHash !== record.batchId) fail("checkpoint_plan_mismatch");
    return {batch, batchHash, unitKeys: selected.map(u => u.unitKey)};
  }
  const helpers = {prepareSource, buildTasks, buildEvidencePairTasks, validateEvidencePairResume, digest, unitKey, cleanResult, cleanRow, localResult, adjudicationTargets, resumeDisposition, planRecord, recoverTask, readBatchResponse, VERSION};
  if (testOnly) return helpers;

  const el = id => document.getElementById(id);
  const state = {prepared: null, tasks: [], tasksByHash: new Map(), runId: null, manifest: [], selectedRoles: [], evidencePairPlan: null, batches: new Map(), attempts: new Map(), history: new Map(), blocked: new Set(), held: new Set(), legacyHolds: new Set(), refusedWindows: new Set(), reconciliationEvents: [], running: false, preparing: false, reconciling: false, paused: true, active: 0, registered: false, pauseCode: null, concurrency: DEFAULT_CONCURRENCY};
  const message = text => { el("progress").textContent = text; };
  const selected = () => ROLES.filter(role => el(role).checked);
  const unknownAttempts = () => [...state.attempts.values()].filter(attempt => attempt.state === "unknown");
  const taskFor = batchId => state.tasksByHash.get(batchId) ?? recoverTask(state.prepared, state.history.get(batchId));
  const overlapsRefusal = task => task.unitKeys.some(key => state.blocked.has(key) || state.refusedWindows.has(key));
  async function refreshHolds() {
    state.held = new Set(state.legacyHolds);
    state.refusedWindows.clear();
    for (const attempt of state.attempts.values()) {
      if (attempt.state === "unknown" || attempt.ledgerState === "refused") {
        const task = await taskFor(attempt.batchId);
        const holds = attempt.ledgerState === "refused" ? state.refusedWindows : state.held;
        task.unitKeys.forEach(key => holds.add(key));
      }
    }
    for (const attempt of state.attempts.values()) {
      if (attempt.state !== "held") continue;
      const task = await taskFor(attempt.batchId);
      if (overlapsRefusal(task)) {
        attempt.state = "blocked";
        state.batches.set(attempt.batchId, localResult(task, attempt.runId, "refusal_dependency", "refusal_blocked"));
      } else if (task.unitKeys.every(key => !state.held.has(key))) {
        attempt.state = "deferred";
        state.batches.delete(attempt.batchId);
      }
    }
  }
  const update = () => {
    const rows = [...state.batches.values()].flatMap(b => b.rows ?? []), attempted = [...state.attempts.values()];
    el("summary").textContent = JSON.stringify({sourceItems: state.prepared?.works.length ?? 0, admittedTargets: state.prepared?.targets ?? 0, plannedBatches: state.tasks.length,
      attemptsRecorded: attempted.length, inFlight: state.active, completedBatches: state.batches.size, classifiedRows: rows.filter(r => r.status === "classified").length,
      unresolvedRows: rows.filter(r => r.status !== "classified").length, blockedUnits: state.blocked.size, heldUnits: state.held.size,
      interruptedRequests: unknownAttempts().length, heldBatches: attempted.filter(a => a.state === "held").length, refusedWindowUnits: state.refusedWindows.size,
      reportedInputTokens: [...state.batches.values()].reduce((n, b) => n + (b.usage?.inputTokens ?? 0), 0), reportedOutputTokens: [...state.batches.values()].reduce((n, b) => n + (b.usage?.outputTokens ?? 0), 0)}, null, 2);
    const busy = state.running || state.preparing || state.reconciling;
    el("prepare").disabled = busy; el("start").disabled = busy || !state.tasks.length; el("pause").disabled = !state.running; el("download").disabled = !state.prepared;
    if (el("reconcile")) el("reconcile").disabled = busy || !unknownAttempts().length;
    for (const name of ["source", "checkpoint", "adjudication", "evidence-pairs", "concurrency", ...ROLES]) if (el(name)) el(name).disabled = busy;
  };
  const snapshot = () => ({schema: 1, kind: "satinlore-corpus-study-checkpoint", referenceVersion: VERSION, sourceBundleSha256: state.prepared.sourceBundleSha256,
    runId: state.runId, manifest: [...state.manifest], manifestHash: state.manifestHash, selectedRoles: [...state.selectedRoles],
    ...(state.evidencePairPlan ? {evidencePairPlan: state.evidencePairPlan} : {}),
    contextPolicy: {referenceA: "opening-24-plus-centered-local-with-gaps", referenceB: "centered-local", adjudicator: "blind-centered-local", referenceBFirstPartition: 32, detectorPrecedingUnits: 8, maxConcurrency: MAX_CONCURRENCY, concurrency: state.concurrency, overlappingWindowsConcurrent: false},
    workRoster: state.prepared.works.map(w => ({workId: w.id, family: w.family, sourceSha256: w.sourceSha256, indexSha256: w.indexSha256, sourceUnitSha256: w.sourceUnitSha256, units: w.units.length, targets: w.units.filter(u => !u.structuralBoundary && u.admission === "approved").length})),
    plannedBatches: [...state.history.values()], attempts: [...state.attempts.values()], batches: [...state.batches.values()], blockedUnitKeys: [...state.blocked].sort(), heldUnitKeys: [...state.held].sort(), reconciliationEvents: [...state.reconciliationEvents], updatedAt: new Date().toISOString()});

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
    const pairFile = Boolean(el("evidence-pairs")?.files?.length);
    const hasRetainedStudy = state.registered || state.attempts.size || state.batches.size;
    const retained = state.prepared?.sourceBundleSha256 === prepared.sourceBundleSha256 &&
      (hasRetainedStudy || !pairFile && !state.evidencePairPlan) ? snapshot() : null;
    const resumed = [resumeDisposition(imported, prepared), resumeDisposition(retained, prepared)], roles = selected();
    if (pairFile && (el("adjudication")?.files?.length || roles.length !== 1 || roles[0] !== "detector")) fail("invalid_evidence_pair_passes");
    const sidecar = el("adjudication")?.files?.length ? resumeDisposition(await readJson("adjudication", 8 * 1024 * 1024), prepared) : null;
    if (sidecar && !sidecar.jobs) fail("invalid_adjudication_jobs");
    const mergedRows = new Map(), attemptRecords = new Map();
    for (const r of resumed) {
      for (const a of r.attempts) {
        attemptRecords.set(a.batchId, a);
        if (a.state === "deferred") mergedRows.delete(a.batchId);
      }
      for (const b of r.batches) mergedRows.set(b.batchId, b);
    }
    const allRows = [...mergedRows.values()];
    const jobs = sidecar?.jobs ?? resumed[0].jobs ?? (roles.includes("adjudicator") ? adjudicationTargets(prepared, allRows) : null);
    let tasks, evidencePairPlan = null;
    if (pairFile) {
      const pairPlan = await buildEvidencePairTasks(prepared, await readJson("evidence-pairs", 128 * 1024));
      tasks = pairPlan.tasks;
      const metadata = {schema: 1, kind: EVIDENCE_PAIR_PLAN_KIND, sourceBundleSha256: prepared.sourceBundleSha256, pairs: pairPlan.pairs};
      evidencePairPlan = {...metadata, planSha256: await digest(metadata)};
    } else tasks = await buildTasks(prepared, roles, jobs);
    const byHash = new Map(tasks.map(t => [t.batchHash, t]));
    const manifest = tasks.map(t => t.batchHash), manifestHash = await digest(manifest);
    for (const r of resumed) if (r.checkpoint && await digest(r.checkpoint.manifest) !== r.checkpoint.manifestHash) fail("invalid_checkpoint");
    await validateEvidencePairResume(resumed, evidencePairPlan, tasks, manifest, manifestHash);
    const sameManifest = resumed.findLast(r => r.checkpoint?.manifestHash === manifestHash)?.checkpoint;
    const runId = sameManifest ? sameManifest.runId : `corpus-${crypto.randomUUID()}`;
    const batches = new Map(), attempts = new Map(), history = new Map(tasks.map(task => [task.batchHash, planRecord(task)]));
    const priorRecords = new Map(resumed.flatMap(r => r.plannedBatches).map(p => [p.batchId, p]));
    const resolvePrior = async record => {
      let task = byHash.get(record.batchId);
      if (!task) { task = await recoverTask(prepared, priorRecords.get(record.batchId) ?? record); byHash.set(task.batchHash, task); }
      history.set(task.batchHash, planRecord(task)); return task;
    };
    const ledgerStates = new Map();
    const reconciliationEvents = [...new Map(resumed.flatMap(r => r.reconciliationEvents).filter(e => e && isId(e.runId) && isHash(e.batchId) && integer(e.checkedAtMs) && [...LEDGER_STATES, "unreachable"].includes(e.state)).map(e => [JSON.stringify([e.runId, e.batchId, e.state, e.checkedAtMs]), {runId: e.runId, batchId: e.batchId, state: e.state, checkedAtMs: e.checkedAtMs}])).values()].slice(-10000);
    for (const e of reconciliationEvents) if (LEDGER_STATES.includes(e.state)) ledgerStates.set(`${e.runId}:${e.batchId}`, e.state);
    for (const b of allRows) {
      const task = await resolvePrior(b); if (!isId(b.runId)) fail("checkpoint_plan_mismatch");
      if (b.measurement === "live-provider") { const clean = cleanResult(b, task, b.runId); if (!clean) fail("invalid_checkpoint"); batches.set(b.batchId, clean); }
      else if (b.measurement === "client-disposition" && ["refusal_blocked", "unknown", "settlement_unknown", "response_lost"].includes(b.status)) {
        const code = {refusal_blocked: "refusal_dependency", unknown: "client_transport_unknown", settlement_unknown: "settlement_unknown_dependency", response_lost: "provider_response_lost"}[b.status];
        const failure = b.rows?.[0]?.failureCode;
        batches.set(b.batchId, localResult(task, b.runId, failureCodes.includes(failure) ? failure : code, b.status, b.transport));
      }
      else fail("invalid_checkpoint");
      const recorded = attemptRecords.get(b.batchId);
      const savedLedgerState = recorded?.runId === b.runId && ["absent", "complete", "refused"].includes(recorded.ledgerState) ? recorded.ledgerState : undefined;
      const ledgerState = ledgerStates.get(`${b.runId}:${b.batchId}`) ?? savedLedgerState;
      let disposition = {refusal_blocked: "blocked", settlement_unknown: "held", response_lost: "complete"}[b.status] ?? "unknown";
      if (b.measurement === "live-provider" && (b.budget?.settlementConfirmed || ledgerState === "complete")) disposition = "complete";
      if (ledgerState === "refused") disposition = "blocked";
      const keepLedgerState = ledgerState === "refused" || ledgerState === "complete" && disposition === "complete" || ledgerState === "absent" && disposition === "held";
      attempts.set(b.batchId, {batchId: b.batchId, runId: b.runId, role: task.batch.role, workId: task.batch.workId, state: disposition, ...(keepLedgerState ? {ledgerState} : {})});
    }
    for (const a of attemptRecords.values()) {
      if (!isHash(a.batchId) || !isId(a.runId) || !ROLES.includes(a.role) || !isId(a.workId) || !["sending", "complete", "unknown", "blocked", "deferred", "held"].includes(a.state)) fail("invalid_checkpoint");
      const task = await resolvePrior(a); if (task.batch.workId !== a.workId || task.batch.role !== a.role) fail("checkpoint_plan_mismatch");
      if (!attempts.has(a.batchId)) {
        const status = a.state === "deferred" ? "deferred" : "unknown";
        const absent = status === "deferred" && (ledgerStates.get(`${a.runId}:${a.batchId}`) ?? a.ledgerState) === "absent";
        attempts.set(a.batchId, {batchId: a.batchId, runId: a.runId, role: a.role, workId: a.workId, state: status, ...(absent ? {ledgerState: "absent"} : {})});
        if (status === "unknown") batches.set(a.batchId, localResult(task, a.runId, "client_transport_unknown", "unknown"));
      }
    }
    const knownKeys = new Set(prepared.works.flatMap(w => w.units.map(u => u.unitKey)));
    const verifiedKeys = key => knownKeys.has(key);
    const explainedHolds = new Set();
    for (const r of resumed) {
      const heldOnly = new Set(r.batches.filter(b => b.status === "settlement_unknown").map(b => b.batchId));
      const uncertain = r.attempts.filter(a => ["unknown", "sending"].includes(a.state) && !heldOnly.has(a.batchId));
      const unsettled = r.batches.filter(b => b.measurement === "live-provider" && b.budget?.settlementConfirmed === false);
      for (const record of [...uncertain, ...unsettled, ...r.reconciliationEvents]) byHash.get(record?.batchId)?.unitKeys.forEach(key => explainedHolds.add(key));
    }
    const legacyHolds = new Set(resumed.flatMap(r => r.heldUnitKeys).filter(key => verifiedKeys(key) && !explainedHolds.has(key)));
    Object.assign(state, {prepared, tasks, tasksByHash: new Map(tasks.map(task => [task.batchHash, task])), runId, manifest, manifestHash, selectedRoles: roles, evidencePairPlan, batches, attempts, history, reconciliationEvents,
      blocked: new Set(resumed.flatMap(r => r.blockedUnitKeys).filter(verifiedKeys)), legacyHolds, paused: true, registered: false});
    for (const b of batches.values()) for (const key of b.blockedUnitKeys ?? []) state.blocked.add(key);
    await refreshHolds();
    const pairCount = evidencePairPlan?.pairs.length;
    const preparedCount = pairCount ? `${pairCount} evidence ${pairCount === 1 ? "pair" : "pairs"} (${tasks.length} batches)` : `${tasks.length} batches`;
    update(); message(`Prepared ${preparedCount}. Start sends these exact batches for neutral classification. Existing attempted batches will not be re-billed.`);
  }
  const post = (operation, body, signal) => fetch(`${PATH}/${operation}`, {method: "POST", credentials: "same-origin",
    headers: {"Content-Type": "application/json", ...(operation === "batch" ? {Accept: BATCH_STREAM_TYPE} : {})},
    body: JSON.stringify(body), redirect: "error", cache: "no-store", signal});
  const canDispatch = task => {
    const attempt = state.attempts.get(task.batchHash);
    return !attempt || attempt.state === "deferred" && (attempt.ledgerState !== "absent" || attempt.runId === state.runId);
  };
  async function reconcile() {
    const candidates = unknownAttempts();
    if (state.running || state.preparing || state.reconciling || !candidates.length) return;
    state.reconciling = true; update(); message("Checking interrupted requests against the run ledger…");
    const byRun = new Map();
    for (const attempt of candidates) {
      const group = byRun.get(attempt.runId) ?? [];
      group.push(attempt); byRun.set(attempt.runId, group);
    }
    const totals = {complete: 0, refused: 0, absent: 0, unresolved: 0};
    try {
      for (const [runId, group] of byRun) {
        for (let offset = 0; offset < group.length; offset += 64) {
          const chunk = group.slice(offset, offset + 64), batchIds = chunk.map(a => a.batchId);
          let entries;
          try {
            const response = await post("reconcile", {runId, batchIds}, AbortSignal.timeout(20000));
            const value = await responseJson(response);
            if (!response.ok || value?.runId !== runId || !Array.isArray(value.batches) || value.batches.length !== chunk.length ||
                value.batches.some((b, index) => b?.batchId !== batchIds[index] || !LEDGER_STATES.includes(b.state))) fail("invalid_response");
            entries = value.batches;
          } catch { entries = batchIds.map(batchId => ({batchId, state: "unreachable"})); }
          for (const [index, entry] of entries.entries()) {
            const attempt = chunk[index], batch = state.batches.get(attempt.batchId);
            state.reconciliationEvents.push({runId, batchId: attempt.batchId, state: entry.state, checkedAtMs: Date.now()});
            if (entry.state === "complete") {
              attempt.state = "complete"; attempt.ledgerState = "complete"; totals.complete++;
              if (batch?.measurement !== "live-provider") state.batches.set(attempt.batchId, localResult(await taskFor(attempt.batchId), runId, "provider_response_lost", "response_lost", batch?.transport));
            } else if (entry.state === "refused") {
              attempt.state = "blocked"; attempt.ledgerState = "refused"; totals.refused++;
              if (batch?.measurement !== "live-provider") state.batches.set(attempt.batchId, localResult(await taskFor(attempt.batchId), runId, "reconciled_refusal", "refusal_blocked", batch?.transport));
            } else if (entry.state === "absent" && batch?.measurement !== "live-provider") {
              // The original run's atomic reservation prevents a duplicate if
              // the interrupted request arrives after this status check.
              attempt.state = "deferred"; attempt.ledgerState = "absent"; totals.absent++;
              state.batches.delete(attempt.batchId);
            } else totals.unresolved++;
          }
        }
      }
      state.reconciliationEvents = state.reconciliationEvents.slice(-10000);
      await refreshHolds();
      message(`Checked ${candidates.length} interrupted requests. ${totals.complete} completed, ${totals.refused} refused, ${totals.absent} eligible to retry in their original run, ${totals.unresolved} still unresolved.`);
    } finally { state.reconciling = false; update(); }
  }
  async function execute(task) {
    if (!canDispatch(task)) return;
    if (overlapsRefusal(task)) {
      state.attempts.set(task.batchHash, {batchId: task.batchHash, runId: state.runId, role: task.batch.role, workId: task.batch.workId, state: "blocked"});
      state.batches.set(task.batchHash, localResult(task, state.runId, "refusal_dependency", "refusal_blocked")); update(); return;
    }
    if (task.unitKeys.some(key => state.held.has(key))) {
      const previous = state.attempts.get(task.batchHash);
      state.attempts.set(task.batchHash, previous ? {...previous, state: "held"} : {batchId: task.batchHash, runId: state.runId, role: task.batch.role, workId: task.batch.workId, state: "held"});
      state.batches.set(task.batchHash, localResult(task, state.runId, "settlement_unknown_dependency", "settlement_unknown")); update(); return;
    }
    state.active++; state.attempts.set(task.batchHash, {batchId: task.batchHash, runId: state.runId, role: task.batch.role, workId: task.batch.workId, state: "sending"}); update();
    const pause = code => { state.paused = true; state.pauseCode = code; };
    let response;
    const markUnknown = (code, stage) => {
      state.attempts.get(task.batchHash).state = "unknown";
      state.batches.set(task.batchHash, localResult(task, state.runId, code, "unknown", {stage, httpStatus: response?.status ?? null}));
      task.unitKeys.forEach(key => state.held.add(key)); pause(code);
    };
    try {
      response = await post("batch", {runId: state.runId, batchHash: task.batchHash, batch: task.batch, sourceConsent: true}, AbortSignal.timeout(135_000));
      const value = await readBatchResponse(response);
      if (!response.ok) {
        const code = errorCodes.includes(value?.code) ? value.code : "invalid_request";
        if (code === "refusal_blocked") {
          for (const key of Array.isArray(value.blockedUnitKeys) ? value.blockedUnitKeys : []) if (task.unitKeys.includes(key)) state.blocked.add(key);
          state.attempts.get(task.batchHash).state = "blocked"; state.batches.set(task.batchHash, localResult(task, state.runId, "refusal_dependency", "refusal_blocked"));
        } else if (["budget_exhausted", "concurrency_limited", "study_unavailable"].includes(code)) { state.attempts.get(task.batchHash).state = "deferred"; pause(code); }
        else markUnknown("client_transport_unknown", "response_rejected");
        return;
      }
      const result = cleanResult(value, task, state.runId);
      if (!result) { markUnknown("client_invalid_response", "response_mismatch"); return; }
      const refused = new Set(result.rows.filter(r => r.status === "refused").map(r => r.id));
      if (result.status === "refused") task.unitKeys.forEach(key => state.blocked.add(key));
      task.batch.units.forEach((unit, index) => { if (refused.has(unit.id)) state.blocked.add(task.unitKeys[index]); });
      result.blockedUnitKeys.forEach(key => state.blocked.add(key));
      state.batches.set(task.batchHash, result); state.attempts.get(task.batchHash).state = "complete";
      if (!result.budget.settlementConfirmed) { state.attempts.get(task.batchHash).state = "unknown"; task.unitKeys.forEach(key => state.held.add(key)); pause("settlement_unconfirmed"); }
      else if (result.haltRecommended) pause(result.rows.find(row => row.failureCode)?.failureCode ?? "provider_halt");
    } catch {
      markUnknown("client_transport_unknown", response ? "response_invalid" : "no_response");
    } finally { state.active--; update(); }
  }
  async function start() {
    if (state.running || state.preparing || state.reconciling || !state.tasks.length) return;
    if (!el("consent").checked || JSON.stringify(selected()) !== JSON.stringify(state.selectedRoles)) { message("Confirm the selected source-processing choice and prepare again after changing passes."); return; }
    const concurrency = Number(el("concurrency")?.value ?? DEFAULT_CONCURRENCY);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) { message(`Choose a concurrency between 1 and ${MAX_CONCURRENCY}.`); return; }
    state.concurrency = concurrency;
    state.running = true; state.paused = false; state.pauseCode = null; update();
    try {
      if (!state.registered) {
        const response = await post("register", {runId: state.runId, manifest: state.manifest, sourceConsent: true}), value = await responseJson(response);
        if (!response.ok || value?.registered !== true) { message("The immutable run manifest could not be registered. No source batches were sent."); return; }
        state.registered = true;
      }
      message(`Running up to ${concurrency} nonoverlapping windows concurrently. Pause lets in-flight requests finish.`);
      const pending = state.tasks.filter(canDispatch), inFlight = new Map(), locked = new Set();
      while ((!state.paused && pending.length) || inFlight.size) {
        while (!state.paused && inFlight.size < concurrency && pending.length) {
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
    if (state.running || state.preparing || state.reconciling) return;
    state.preparing = true; update();
    void prepare().catch(() => { state.tasks = []; message("Preparation failed. Check the source/checkpoint version, hashes, file bounds and selected passes. No source was sent."); }).finally(() => { state.preparing = false; update(); });
  });
  el("start").addEventListener("click", () => { void start(); });
  el("reconcile")?.addEventListener("click", () => { void reconcile().catch(() => { message("The interrupted requests could not be checked. Their source holds remain in place."); }); });
  el("pause").addEventListener("click", () => { state.paused = true; message("Pausing after in-flight calls finish…"); });
  el("consent").addEventListener("change", () => { if (!el("consent").checked && state.running) { state.paused = true; message("Source permission removed. No new batches will start."); } });
  el("download").addEventListener("click", () => {
    if (!state.prepared) return;
    const content = JSON.stringify(snapshot());
    if (encoder.encode(content).byteLength > 64 * 1024 * 1024) message("Results exported for offline analysis. This file exceeds the 64 MiB resume bound.");
    const blob = new Blob([content], {type: "application/json"}), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `satinlore-corpus-${state.runId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const name of ["source", "checkpoint", "adjudication", "evidence-pairs", ...ROLES]) el(name)?.addEventListener("change", () => { if (!state.running && !state.preparing) { state.tasks = []; update(); message("Prepare the newly selected source, checkpoint and passes before starting."); } });
  window.addEventListener("pagehide", () => { state.paused = true; });
  update();
}
if (typeof document !== "undefined") corpusStudyClient();
