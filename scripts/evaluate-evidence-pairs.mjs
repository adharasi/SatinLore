import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {corpusStudyClient} from "../deploy/cloudflare/corpus-study-client.mjs";
import {CORPUS_COMPACT_PROMPTS, CORPUS_ENUMS, REFERENCE_RUBRIC_VERSION} from "../deploy/cloudflare/corpus-study-contract.mjs";
import {observedCorpusCode} from "./lib/corpus-diagnostic-metadata.mjs";
import {privateOutput} from "./lib/private-study-output.mjs";

const cohortKind = "satinlore-evidence-pair-cohort";
const planKind = "satinlore-evidence-pair-plan";
const checkpointKind = "satinlore-corpus-study-checkpoint";
const arms = ["baseline", "enriched"];
const model = "gpt-6-luna";
const stratumDecisions = new Map([["missing-anchor", "cue"], ["anchor-complete", "cue"],
  ["negative-control", "no-cue"], ["protected-control", "protected"]]);
const liveStatuses = new Map([["parsed", "returned"], ["partial", "returned"], ["refused", "refused"],
  ["truncated", "truncated"], ["invalid_response", "malformed"], ["http_error", "provider-error"],
  ["network_error", "provider-error"], ["timed_out", "timeout"], ["model_mismatch", "model-mismatch"]]);
const clientStatuses = new Map([["refusal_blocked", "refusal-hold"], ["unknown", "transport-unknown"],
  ["settlement_unknown", "settlement-hold"], ["response_lost", "response-lost"]]);
const attemptStatuses = new Map([["sending", "in-flight"], ["complete", "response-missing"], ["unknown", "transport-unknown"],
  ["blocked", "refusal-hold"], ["deferred", "deferred"], ["held", "settlement-hold"]]);
const {cleanRow} = corpusStudyClient({testOnly: true});
const sha256 = value => createHash("sha256").update(value).digest("hex");
const digest = value => sha256(JSON.stringify(value));
const promptSha256 = sha256(CORPUS_COMPACT_PROMPTS.detector);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(value) && !/^sk[-_]/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const unitId = value => integer(value) && value <= 50_000;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const coordinate = row => JSON.stringify([row.workId, row.targetId]);
const ratio = (n, d) => d ? n / d : null;
const invalid = () => { throw new TypeError("Invalid evidence pair checkpoint or cohort binding."); };

function index(rows, key, check) {
  if (!Array.isArray(rows)) invalid();
  const byKey = new Map();
  for (const row of rows) {
    if (!row || !check(row) || byKey.has(key(row))) invalid();
    byKey.set(key(row), row);
  }
  return byKey;
}

function earlier(ids, targetId) {
  return Array.isArray(ids) && ids.every((value, position) =>
    unitId(value) && value < targetId && (position === 0 || ids[position - 1] < value));
}

function checkedPlan(cohort, checkpoint) {
  const plan = checkpoint?.evidencePairPlan;
  if (cohort?.schema !== 1 || cohort.kind !== cohortKind || !hash(cohort.referenceSha256) ||
      !hash(cohort.sourceBundleSha256) || !hash(cohort.planSha256) || checkpoint?.schema !== 1 || checkpoint.kind !== checkpointKind ||
      checkpoint.sourceBundleSha256 !== cohort.sourceBundleSha256 || checkpoint.referenceVersion !== REFERENCE_RUBRIC_VERSION ||
      !id(checkpoint.runId) || !same(checkpoint.selectedRoles, ["detector"]) || plan?.schema !== 1 || plan.kind !== planKind ||
      plan.sourceBundleSha256 !== cohort.sourceBundleSha256 || !Array.isArray(plan.pairs) ||
      !plan.pairs.length || plan.pairs.length > 150 || plan.planSha256 !== cohort.planSha256 ||
      plan.planSha256 !== digest({schema: 1, kind: planKind, sourceBundleSha256: plan.sourceBundleSha256, pairs: plan.pairs})) invalid();
  const cases = index(cohort.cases, coordinate, row => id(row.workId) && unitId(row.targetId) &&
    stratumDecisions.has(row.stratum) && stratumDecisions.get(row.stratum) === row.expected &&
    (row.expectedTransition === undefined || CORPUS_ENUMS.transition.includes(row.expectedTransition) && row.expectedTransition !== "unknown"));
  const roster = index(checkpoint.workRoster, row => row.workId, row =>
    id(row.workId) && hash(row.sourceSha256) && hash(row.indexSha256));
  const windows = new Map(), matchedCases = new Set();
  for (const pair of plan.pairs) {
    if (!pair || !unitId(pair.targetId) || !id(pair.workId) || !hash(pair.sourceSha256) || !hash(pair.indexSha256) ||
        !earlier(pair.baselineContextIds, pair.targetId) || !earlier(pair.addedContextIds, pair.targetId) ||
        !pair.addedContextIds.length || pair.baselineContextIds.length + pair.addedContextIds.length > 8 ||
        pair.addedContextIds.some(value => pair.baselineContextIds.includes(value))) invalid();
    const key = coordinate(pair), work = roster.get(pair.workId);
    if (!cases.has(key) || matchedCases.has(key) || work?.sourceSha256 !== pair.sourceSha256 ||
        work?.indexSha256 !== pair.indexSha256) invalid();
    matchedCases.add(key);
    for (const arm of arms) {
      const batchId = pair[arm + "BatchId"];
      if (!hash(batchId) || windows.has(batchId)) invalid();
      const contextIds = arm === "baseline" ? pair.baselineContextIds :
        [...pair.baselineContextIds, ...pair.addedContextIds].sort((a, b) => a - b);
      windows.set(batchId, {pair, contextIds});
    }
  }
  if (matchedCases.size !== cases.size || !same(checkpoint.manifest, [...windows.keys()]) ||
      checkpoint.manifestHash !== digest(checkpoint.manifest)) invalid();
  const matchWindow = row => {
    const window = windows.get(row.batchId);
    return window && row.role === "detector" && row.workId === window.pair.workId &&
      same(row.targetIds, [window.pair.targetId]) && same(row.contextIds, window.contextIds);
  };
  const planned = index(checkpoint.plannedBatches, row => row.batchId, matchWindow);
  if (planned.size !== windows.size) invalid();
  const attempts = index(checkpoint.attempts, row => row.batchId, row => windows.has(row.batchId) &&
    row.workId === windows.get(row.batchId).pair.workId && row.runId === checkpoint.runId &&
    row.role === "detector" && attemptStatuses.has(row.state));
  const returnedModels = new Set();
  const batches = index(checkpoint.batches, row => row.batchId, row => {
    if (!matchWindow(row) || row.schema !== 1 || row.runId !== checkpoint.runId ||
        row.referenceVersion !== checkpoint.referenceVersion ||
        row.sourceSha256 !== windows.get(row.batchId).pair.sourceSha256 ||
        row.indexSha256 !== windows.get(row.batchId).pair.indexSha256 || !attempts.has(row.batchId) ||
        !Array.isArray(row.rows) || row.rows.length > 1) return false;
    if (row.rows.some(unit => !unit || unit.id !== row.targetIds[0] || !hash(unit.unitSha256))) return false;
    if (row.measurement === "client-disposition") return clientStatuses.has(row.status);
    if (row.measurement !== "live-provider" || !liveStatuses.has(row.status) || typeof row.dispatched !== "boolean" ||
        row.model !== model || row.predictionVersion !== "source-first-detector-v7" || row.promptSha256 !== promptSha256) return false;
    if (row.returnedModel !== null) {
      if (typeof row.returnedModel !== "string" || !/^gpt-6-luna(?:-[a-z0-9-]{1,48})?$/.test(row.returnedModel)) return false;
      returnedModels.add(row.returnedModel);
    }
    return true;
  });
  if (returnedModels.size > 1) invalid();
  return {plan, cases, attempts, batches, returnedModel: [...returnedModels][0] ?? null};
}

function checkedObservation(batch, attempt) {
  const result = {state: attemptStatuses.get(attempt?.state) ?? "not-started", activation: null, transition: null,
    observedCall: false, elapsedMs: null, usage: null};
  if (!batch) return result;
  if (batch.measurement === "client-disposition") {
    result.state = clientStatuses.get(batch.status);
    result.observedCall = batch.status === "response_lost";
    return result;
  }
  result.observedCall = batch.dispatched;
  if (batch.dispatched && integer(batch.elapsedMs)) result.elapsedMs = batch.elapsedMs;
  if (batch.dispatched && integer(batch.usage?.inputTokens) && integer(batch.usage?.outputTokens)) {
    result.usage = {inputTokens: batch.usage.inputTokens, outputTokens: batch.usage.outputTokens};
  }
  result.state = liveStatuses.get(batch.status);
  const raw = batch.rows[0];
  const failureCode = observedCorpusCode(raw?.validationErrors?.causal ?? raw?.failureCode);
  if (failureCode) result.failureCode = failureCode;
  if (result.state !== "returned") return result;
  if (raw?.status === "refused" || raw?.scopeStatus?.causal === "refused") return {...result, state: "refused"};
  if (!batch.dispatched || batch.returnedModel === null) return {...result, state: "malformed"};
  if (batch.budget?.settlementConfirmed !== true || attempt.state !== "complete") return {...result, state: "settlement-unknown"};
  if (!raw) return {...result, state: "missing-row"};
  const unit = {id: raw.id, unitSha256: raw.unitSha256};
  const row = cleanRow(raw, unit, new Set([...batch.contextIds, unit.id]));
  const scopeState = row.scopeStatus?.causal ?? row.status;
  const transition = row.causal.transition;
  const fields = row.fieldStatus?.causal;
  const transitionChecked = (scopeState === "classified" && fields?.transition !== "unresolved" ||
    ["classified", "uncertain", "invalid"].includes(scopeState) && fields?.transition === "applied") &&
    (transition === "none" || transition !== "unknown" && row.causal.evidenceIds.includes(unit.id));
  if (transitionChecked) result.transition = transition;
  if (scopeState === "uncertain" || scopeState === "classified" && row.causal.activation === "review") {
    return {...result, state: "uncertain"};
  }
  if (scopeState !== "classified" || fields?.activation === "unresolved" || row.validationErrors?.causal) {
    return {...result, state: "malformed"};
  }
  const activation = row.causal.activation, eligibility = row.eligibility;
  if (activation === "cue" && (row.scopeStatus?.eligibility === "invalid" || !row.causal.evidenceIds.includes(unit.id) ||
      row.causal.interaction !== "depicted" || row.causal.frame === "uncertain" ||
      ["quiet", "unknown"].includes(row.causal.phase) || eligibility.status !== "eligible" || eligibility.adult !== "adult" ||
      eligibility.consent !== "present" || eligibility.capacity !== "present" || !eligibility.evidenceIds.length)) {
    return {...result, state: "malformed"};
  }
  return {...result, state: "classified", activation};
}

const usable = observation => ["classified", "uncertain"].includes(observation.state);
const positive = observation => observation.activation === "cue";

function armSummary(rows, arm) {
  let cues = 0, matches = 0, falseCues = 0, correctNoCue = 0, protectedCases = 0, protectedFalseCues = 0, protectedLabels = 0;
  let clearNegativeCases = 0, clearNegativeFalseCues = 0;
  let expectedEvents = 0, transitionObserved = 0, transitionMatches = 0, transitionExtras = 0, observedCalls = 0;
  let inputTokens = 0, outputTokens = 0, usageObservedCalls = 0;
  const states = {}, elapsed = [];
  for (const row of rows) {
    const result = row[arm];
    states[result.state] = (states[result.state] ?? 0) + 1;
    if (row.expected === "cue") { cues++; if (positive(result)) matches++; }
    else if (positive(result)) falseCues++;
    else if (result.state === "classified") correctNoCue++;
    if (row.expected === "protected") {
      protectedCases++;
      if (positive(result)) protectedFalseCues++;
      if (result.activation === "protected") protectedLabels++;
    }
    if (row.expected === "no-cue") {
      clearNegativeCases++;
      if (positive(result)) clearNegativeFalseCues++;
    }
    if (row.expectedTransition !== null) {
      const expectedEvent = row.expectedTransition !== "none";
      if (expectedEvent) expectedEvents++;
      if (result.transition !== null) transitionObserved++;
      if (expectedEvent && result.transition === row.expectedTransition) transitionMatches++;
      if (result.transition && result.transition !== "none" && result.transition !== row.expectedTransition) transitionExtras++;
    }
    if (result.observedCall) observedCalls++;
    if (result.elapsedMs !== null) elapsed.push(result.elapsedMs);
    if (result.usage) {
      usageObservedCalls++;
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
    }
  }
  elapsed.sort((a, b) => a - b);
  const percentile = p => elapsed[Math.ceil(elapsed.length * p) - 1] ?? null;
  return {states, cues, matches, missedCues: cues - matches, falseCues, correctNoCue,
    cuePrecision: ratio(matches, matches + falseCues), cueRecall: ratio(matches, cues),
    clearNegativeCases, clearNegativeFalseCues, clearNegativeFalseCueRate: ratio(clearNegativeFalseCues, clearNegativeCases),
    protectedCases, protectedFalseCues, protectedLabels,
    transitions: {expectedEvents, observed: transitionObserved, matched: transitionMatches,
      missed: expectedEvents - transitionMatches, extra: transitionExtras,
      precision: ratio(transitionMatches, transitionMatches + transitionExtras), recall: ratio(transitionMatches, expectedEvents)},
    observedCalls, usageObservedCalls, inputTokens, outputTokens,
    latency: {observedCalls: elapsed.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95)}};
}

function summarize(rows) {
  const complete = rows.filter(row => usable(row.baseline) && usable(row.enriched));
  const pairedPositive = complete.filter(row => row.expected === "cue");
  const pairedNegative = complete.filter(row => row.expected !== "cue");
  const reportArms = group => Object.fromEntries(arms.map(arm => [arm, armSummary(group, arm)]));
  return {plannedPairs: rows.length, completePairs: complete.length, incompletePairs: rows.length - complete.length,
    bothClassified: complete.filter(row => arms.every(arm => row[arm].state === "classified")).length,
    cueGains: pairedPositive.filter(row => !positive(row.baseline) && positive(row.enriched)).length,
    cueRegressions: pairedPositive.filter(row => positive(row.baseline) && !positive(row.enriched)).length,
    cueTies: pairedPositive.filter(row => positive(row.baseline) === positive(row.enriched)).length,
    falseCueIntroductions: pairedNegative.filter(row => !positive(row.baseline) && positive(row.enriched)).length,
    falseCueRemovals: pairedNegative.filter(row => positive(row.baseline) && !positive(row.enriched)).length,
    effective: reportArms(rows), pairedComplete: reportArms(complete)};
}

export function evaluateEvidencePairs({cohort, checkpoint}) {
  const {plan, cases, attempts, batches, returnedModel} = checkedPlan(cohort, checkpoint);
  const rows = plan.pairs.map(pair => {
    const entry = cases.get(coordinate(pair)), baseline = batches.get(pair.baselineBatchId), enriched = batches.get(pair.enrichedBatchId);
    if (baseline?.rows[0] && enriched?.rows[0] && baseline.rows[0].unitSha256 !== enriched.rows[0].unitSha256) invalid();
    return {workId: pair.workId, targetId: pair.targetId, expected: entry.expected, stratum: entry.stratum,
      expectedTransition: entry.expectedTransition ?? null,
      baselineBatchId: pair.baselineBatchId, enrichedBatchId: pair.enrichedBatchId,
      baseline: checkedObservation(baseline, attempts.get(pair.baselineBatchId)),
      enriched: checkedObservation(enriched, attempts.get(pair.enrichedBatchId))};
  });
  const groups = field => Object.fromEntries([...new Set(rows.map(row => row[field]))].sort()
    .map(value => [value, summarize(rows.filter(row => row[field] === value))]));
  return {schema: 1, kind: "satinlore-evidence-pair-report", scope: "causal", inputPolicy: "bounded-prefix-only",
    referenceVersion: checkpoint.referenceVersion, referenceSha256: cohort.referenceSha256,
    sourceBundleSha256: plan.sourceBundleSha256, planSha256: plan.planSha256, manifestHash: checkpoint.manifestHash,
    runId: checkpoint.runId, model, returnedModel, promptSha256, sourceProseIncluded: false,
    pairCompletionPolicy: "both-arms-classified-or-uncertain-with-confirmed-settlement",
    summary: summarize(rows), byStratum: groups("stratum"), byWork: groups("workId"), rows};
}

export async function main(args) {
  const names = new Set(["--cohort", "--checkpoint", "--output"]), options = new Map();
  if (args.length !== 6) invalid();
  for (let offset = 0; offset < args.length; offset += 2) {
    const [name, value] = args.slice(offset, offset + 2);
    if (!names.has(name) || options.has(name) || !value || value.startsWith("--")) invalid();
    options.set(name, resolve(value));
  }
  if (new Set(options.values()).size !== 3) invalid();
  const output = await privateOutput(options.get("--output"));
  const [cohort, checkpoint] = await Promise.all(["--cohort", "--checkpoint"].map(async name =>
    JSON.parse(await readFile(options.get(name), "utf8"))));
  const result = evaluateEvidencePairs({cohort, checkpoint});
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {mode: 0o600, flag: "wx"});
  return {plannedPairs: result.summary.plannedPairs, completePairs: result.summary.completePairs};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)))); }
  catch {
    console.error("Evidence pair evaluation failed. Use --cohort FILE --checkpoint FILE --output NEW_FILE.");
    process.exitCode = 1;
  }
}
