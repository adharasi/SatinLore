import {MAX_WHOLE_STORY_REQUESTS, WHOLE_STORY_PLAN_LIMITS} from "./whole-story-context-planning.mjs";

const maxConcurrentRequests = 2;
const progressFields = {
  pending: "pending", running: "running", annotated: "annotated",
  "provider-refused": "providerRefused", "refusal-dependent": "refusalDependent",
  failed: "failed", "budget-deferred": "budgetDeferred", cancelled: "cancelled",
};

function limit(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function validId(value) {
  return typeof value === "string" ? value.length > 0 : limit(value, 0);
}

function prepare(windows) {
  const ids = new Set();
  return windows.map(({id, runId, targetIds, contextIds, sourceBytes, bodyBytes, targetSourceBytes, overlapSourceBytes, body}) => {
    if (!validId(id) || ids.has(id) || !validId(runId) || !Array.isArray(targetIds) || !targetIds.length ||
        !Array.isArray(contextIds) || typeof body !== "string" || !body.length) {
      throw new TypeError("Invalid approved context window.");
    }
    const submitted = new Set([...targetIds, ...contextIds]);
    if (submitted.size !== targetIds.length + contextIds.length || ![...submitted].every(validId)) {
      throw new TypeError("Invalid submitted context IDs.");
    }
    ids.add(id);
    const window = Object.freeze({id, runId, body, sourceBytes, bodyBytes, targetSourceBytes, overlapSourceBytes,
      targetIds: Object.freeze([...targetIds]), contextIds: Object.freeze([...contextIds])});
    return {window, submitted, status: "pending", attempts: 0};
  });
}

function overlaps(a, b) {
  for (const id of a.submitted) if (b.submitted.has(id)) return true;
  return false;
}

function decode(response, targetIds, allowPartial) {
  if (response?.status === "refused" || response?.status === "transient") return {status: response.status};
  const annotations = response?.annotations;
  if (response?.status === "annotated" && Array.isArray(annotations) && annotations.length &&
      (allowPartial || annotations.length === targetIds.length)) {
    const allowed = new Set(targetIds);
    if (annotations.every(annotation => allowed.delete(annotation?.id))) {
      return {status: "annotated", annotations: [...annotations]};
    }
  }
  return {status: "failed"};
}

// Offline only: the injected request is the sole transport. Its adapter must
// validate annotation payloads and explicitly identify confirmed transient
// failures or refusals. This executor checks exact target coverage and does not
// retry unclassified errors, change request bodies, or construct new requests.
export async function executeWholeStoryContextPlan(plan, {request, signal = new AbortController().signal,
  concurrency = maxConcurrentRequests, maxAttempts = Math.min(plan?.windows?.length, WHOLE_STORY_PLAN_LIMITS.maxRequests),
  maxRetries = 1, serialWithinRun = false, allowPartial = false, onProgress = () => {}} = {}) {
  if (!Array.isArray(plan?.windows) || typeof request !== "function" || typeof onProgress !== "function" ||
      typeof serialWithinRun !== "boolean" || typeof allowPartial !== "boolean" ||
      !limit(concurrency, 1) || concurrency > maxConcurrentRequests || !limit(maxAttempts, 0) ||
      maxAttempts > MAX_WHOLE_STORY_REQUESTS || !limit(maxRetries, 0) || maxRetries > 1) {
    throw new TypeError("Invalid approved context execution options.");
  }
  const records = prepare(plan.windows);
  let active = 0, attemptsStarted = 0, retriesStarted = 0, done = false;

  function snapshot() {
    const counts = {total: records.length, completed: 0, attemptsStarted, retriesStarted};
    for (const field of Object.values(progressFields)) counts[field] = 0;
    for (const {status} of records) counts[progressFields[status]]++;
    counts.completed = counts.total - counts.pending - counts.running;
    return counts;
  }

  function publish(progress = snapshot()) {
    // Observers only see counters and cannot interfere with dispatch.
    try { onProgress({...progress}); } catch { /* Ignore observer failure. */ }
  }

  return new Promise(resolve => {
    function finish() {
      done = true;
      signal.removeEventListener("abort", cancel);
      const progress = snapshot();
      publish(progress);
      const windows = records.map(({window: {id, runId}, status, attempts, annotations}) =>
        ({id, runId, status, attempts, ...(status === "annotated" ? {annotations} : {})}));
      resolve({windows, progress});
    }

    function cancel() {
      if (done) return;
      for (const record of records) {
        if (["pending", "running", "annotated"].includes(record.status)) {
          record.status = "cancelled";
          delete record.annotations;
        }
      }
      finish();
    }

    function settle(record, result) {
      if (done) return;
      if (result.status === "transient" && record.attempts <= maxRetries) {
        if (attemptsStarted < maxAttempts) {
          start(record);
          if (!done) publish();
          return;
        }
        record.status = "budget-deferred";
      } else if (result.status === "refused") {
        record.status = "provider-refused";
        // A later refusal invalidates earlier annotations that relied on any
        // of the same submitted units. A skipped window is not itself a refusal.
        for (const other of records) {
          if ((other.status === "pending" || other.status === "annotated") && overlaps(record, other)) {
            other.status = "refusal-dependent";
            delete other.annotations;
          }
        }
      } else {
        record.status = result.status === "annotated" ? "annotated" : "failed";
        if (record.status === "annotated") record.annotations = result.annotations;
      }
      active--;
      drive();
    }

    function start(record) {
      attemptsStarted++;
      if (++record.attempts > 1) retriesStarted++;
      let operation;
      try { operation = request(record.window, {signal, attempt: record.attempts}); } catch { /* Failed below. */ }
      Promise.resolve(operation).then(response => {
        if (done) return;
        let result;
        try { result = decode(response, record.window.targetIds, allowPartial); } catch { result = {status: "failed"}; }
        settle(record, result);
      }, () => settle(record, {status: "failed"}));
    }

    function drive() {
      for (const [index, record] of records.entries()) {
        if (done || active >= concurrency || attemptsStarted >= maxAttempts) break;
        if (record.status !== "pending") continue;
        // Preserve planner priority for overlapping input, while letting other
        // cleared windows run during an outstanding request.
        const blocked = records.slice(0, index).some(other =>
          (other.status === "pending" || other.status === "running") &&
          (overlaps(record, other) || serialWithinRun && record.window.runId === other.window.runId));
        if (blocked) continue;
        record.status = "running";
        active++;
        start(record);
      }
      if (done) return;
      if (!active) {
        for (const record of records) if (record.status === "pending") record.status = "budget-deferred";
        finish();
      } else {
        publish();
      }
    }

    if (signal.aborted) cancel();
    else {
      signal.addEventListener("abort", cancel, {once: true});
      drive();
    }
  });
}
