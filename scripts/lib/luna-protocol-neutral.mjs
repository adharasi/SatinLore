import {createHash} from "node:crypto";
import {wholeStoryAnnotationFixtures} from "../../tests/whole-story-annotation-fixtures.mjs";
import {scoreBeatContinuityCorpus} from "./beat-continuity-evaluation.mjs";
import {LUNA_PROTOCOL_FAILURE_REASONS, LUNA_PROTOCOL_MODEL, LUNA_PROTOCOL_TRANSITION_FACTS} from "./luna-protocol-provider.mjs";
import {createLunaShadowBudget, runLunaProtocolShadow} from "./luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "./whole-story-context-planning.mjs";

const fixtureVersion = "neutral-stories-v1";
const fixtureDigest = "40cd3c8f193ba7fb44b75234a1917b577ec5d742bceb532ea634cd0643691d6d";
const stageDimensions = {
  discovery: ["cue", "narrativePhase", "transition"],
  prefix: ["cue", "narrativePhase"],
  transition: ["transition"],
};
const attemptStage = {discovery: "discovery", verify: "prefix", transition: "transition"};
const observedStatuses = new Set(["candidate", "verified", "neutral"]);
const failureReasons = new Set([...LUNA_PROTOCOL_FAILURE_REASONS, "rejected-fact-contract"]);
const pipelineFlags = new Set(["prefix-disagreement", "unattested-scope", "transition-conflict", "protective-transition-conflict"]);
const dispositions = new Set([...observedStatuses, "uncertain", "abstain", "withheld", "unavailable", "unverified",
  "failed", "missing", "budget-deferred", "provider-unavailable", "complete-arm-ineligible", "provider-refused",
  "refusal-dependent", "incomplete", "invalid-response", "transient", "cancelled", "timed-out", "invalid-request",
  "verification-deferred", "transition-verification-deferred", "not-requested", "returned"]);
const reportOnlyDispositions = new Set(["transition-verification-deferred", "not-requested", "returned"]);
const actionForPhase = {build: "anticipation", onset: "contact", sustain: "continuation", rebuild: "contact"};
const invalidOptions = "Invalid neutral benchmark options.";
const natural = value => Number.isSafeInteger(value) && value >= 0;
const disposition = (status, fallback = "unavailable") => dispositions.has(status) ? status : fallback;
const validIds = (ids, limit) => Array.isArray(ids) && ids.every(id => natural(id) && id < limit) ? [...ids] : null;

function prepareFixtures(now) {
  if (createHash("sha256").update(JSON.stringify(wholeStoryAnnotationFixtures)).digest("hex") !== fixtureDigest) {
    throw new Error("The built-in neutral fixtures or reference have changed.");
  }
  return wholeStoryAnnotationFixtures.map(({id, paragraphs, phases, events, evidence}) => {
    const text = paragraphs.join("\n\n");
    const {editionDigest, segmentationVersion, units} = buildWholeStoryIndex(text);
    if (units.length !== phases.length || units.some(unit => unit.structuralBoundary)) {
      throw new Error("The built-in neutral reference no longer matches reader units.");
    }
    const spans = units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}));
    const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: now + 300_000, spans};
    const reference = {id, sourceSha256: editionDigest, units: units.map(({id, paragraph, digest}) => {
      const narrativePhase = phases[id] === "restart" ? "rebuild" : phases[id];
      const transition = events[id] === "stop" ? "hard-stop" : events[id] ?? "none";
      return {id, paragraph, unitSha256: digest, narrativePhase, transition, cue: narrativePhase !== "quiet",
        frame: "uncertain", depiction: "unknown", structural: false, legacyCue: narrativePhase !== "quiet",
        legacyCueKnown: true, hardAction: transition === "hard-stop", protectedReference: false};
    })};
    return {id, text, grant, reference, evidence};
  });
}

function mockProvider({reference, evidence}) {
  return async ({mode, units, targetIds}) => {
    const submitted = new Set(units.map(({id}) => id));
    const facts = targetIds.map(unitId => {
      const {narrativePhase, transition, cue} = reference.units[unitId];
      if (mode === "transition") {
        const fact = LUNA_PROTOCOL_TRANSITION_FACTS[transition]?.[0] ?? "none";
        return {unitId, status: transition === "none" ? "neutral" : "verified", depiction: "unknown",
          frame: transition === "reported-entry" ? "reported" : "current",
          narrativePhase: "unknown", transition, action: "unknown", fact, scopeId: null,
          priorAnchor: null, evidenceIds: transition === "none" ? [] : [unitId]};
      }
      const reviewed = cue || transition !== "none";
      const evidenceIds = evidence[unitId] ?? (reviewed ? [unitId] : []);
      if (evidenceIds.some(id => !submitted.has(id))) {
        return {unitId, status: "abstain", depiction: "unknown", frame: "uncertain", narrativePhase: "unknown",
          transition: "none", action: "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds: []};
      }
      return {unitId, status: reviewed ? mode === "verify" ? "verified" : "candidate" : "neutral",
        depiction: cue ? "romantic" : "neutral", frame: "current", narrativePhase, transition,
        action: actionForPhase[narrativePhase] ?? "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds};
    });
    return {status: "ok", facts, usage: {inputTokens: 0, outputTokens: 0}};
  };
}

function observation(row, stage) {
  // A discovery label which did not require prefix review is in the final slot.
  const fact = stage === "transition" ? row.transitionVerification :
    stage === "prefix" ? (row.prefixVerified ? row : undefined) :
    row.discovery ?? (row.verificationStatus === undefined && row.labelKnownAt !== null ? row : undefined);
  const fallback = stage === "transition" ? row.transitionVerificationStatus ??
    (observedStatuses.has(row.status) ? "transition-verification-deferred" : row.status) :
    stage === "prefix" ? row.verificationStatus ?? (row.labelKnownAt !== null ? "unverified" : row.status) :
      row.discoveryStatus ?? row.status;
  const status = disposition(fact?.status ?? (observedStatuses.has(fallback) ? "unavailable" : fallback));
  const result = {id: row.id, unitSha256: row.unitSha256, status};
  const evidenceIds = stage === "transition" ? row.transitionEvidenceIds :
    fact === row ? row.labelEvidenceIds : fact?.evidenceIds;
  if (fact) {
    if (stage !== "transition") {
      result.narrativePhase = fact.narrativePhase;
      if (fact.narrativePhase !== "unknown") result.cue = fact.narrativePhase !== "quiet";
    }
    if (stage !== "prefix") result.transition = fact.transition;
  }
  return {result, returned: Boolean(fact), evidenceIds};
}

function metricRow(score) {
  const phase = score.labels.narrativePhase;
  return {targets: score.rows, observedTargets: score.observedRows, coverage: score.rowCoverage, dispositions: score.status,
    ...(score.cues ? {exactCues: score.cues.effective} : {}),
    ...(score.typedTransitions ? {exactTypedTransitions: score.typedTransitions.exact,
      nearbyTypedTransitions: score.typedTransitions.withinOneParagraph} : {}),
    ...(phase ? {phase: {exact: phase.exact, observed: phase.observed}} : {})};
}

function stageReport(reference, runs, stage) {
  const observations = runs.map(work => work.units.map(row => observation(row, stage)));
  const works = runs.map(({id, sourceSha256}, i) => ({id, sourceSha256, units: observations[i].map(({result}) =>
    reportOnlyDispositions.has(result.status) ? {...result, status: "verification-deferred"} : result)}));
  const score = scoreBeatContinuityCorpus(reference, {dimensions: stageDimensions[stage], works});
  const coverage = rows => ({returnedTargets: rows.filter(row => row.returned).length,
    dispositions: Object.fromEntries(Object.entries(Object.groupBy(rows, row => row.result.status))
      .map(([status, group]) => [status, group.length]))});
  return {...metricRow(score.summary), ...coverage(observations.flat()),
    works: score.stories.map(({id, ...metrics}, i) => ({id, ...metricRow(metrics), ...coverage(observations[i])}))};
}

function stageDiagnostic(gold, row, stage, attempt, referenceCueEvidenceIds, size) {
  const {result, returned, evidenceIds} = observation(row, stage);
  const contextIds = attempt ? validIds(attempt.contextIds, size) : null;
  const targetIds = attempt ? validIds(attempt.targetIds, size) : null;
  const attestedIds = attempt ? validIds(attempt.attestedIds ?? [], size) : null;
  const submittedIds = contextIds === null || targetIds === null ? null : [...new Set([...contextIds, ...targetIds])];
  const missingReferenceCueEvidenceIds = stage === "transition" || submittedIds === null ? null :
    referenceCueEvidenceIds.filter(id => !submittedIds.includes(id));
  const citedIds = returned ? validIds(evidenceIds, size) : null;
  const observed = observedStatuses.has(result.status);
  const reasons = [];
  if (!observed) reasons.push(`disposition:${result.status}`);
  if (missingReferenceCueEvidenceIds?.length) reasons.push("reference-cue-evidence-outside-raw-window");
  if (observed && stage !== "transition") {
    if (result.cue !== gold.cue) reasons.push(result.cue === undefined ? "cue-unresolved" : gold.cue ? "cue-missed" : "extra-cue");
    if (result.narrativePhase !== gold.narrativePhase) reasons.push("phase-mismatch");
  }
  if (observed && stage !== "prefix") {
    if (result.transition !== gold.transition) reasons.push(result.transition === "unknown" ? "transition-unresolved" :
      gold.transition === "none" ? "extra-transition" : result.transition === "none" ? "transition-missed" : "transition-type-mismatch");
    if (result.transition && !["none", "unknown"].includes(result.transition) && !citedIds?.includes(gold.id)) {
      reasons.push("target-uncited-for-transition");
    }
  }
  return {status: result.status, returned, dispatched: Boolean(attempt?.attempted), submittedIds, attestedIds,
    requestStatus: attempt ? disposition(attempt.status) : null,
    requestFailure: failureReasons.has(attempt?.failureReason) ? attempt.failureReason : null,
    contractRejection: attempt?.rejectedFacts?.find(row => row.id === gold.id)?.reason ?? null,
    targetCoverageMismatch: attempt?.targetCoverageMismatch ?? false,
    citedIds, missingReferenceCueEvidenceIds, reasons,
    ...(stage !== "transition" ? {narrativePhase: result.narrativePhase ?? null, cue: result.cue ?? null} : {}),
    ...(stage !== "prefix" ? {transition: result.transition ?? null} : {})};
}

function diagnosticWork(fixture, run) {
  const stages = new Map(Object.keys(stageDimensions).map(stage => [stage, new Map()]));
  const size = fixture.reference.units.length;
  for (const attempt of run.summary.attempts) {
    const stage = stages.get(attemptStage[attempt.mode]);
    if (!stage || !attempt.attempted) continue;
    for (const id of validIds(attempt.targetIds, size) ?? []) stage.set(id, attempt);
  }
  return {id: run.id, sourceSha256: run.sourceSha256, units: run.units.map((row, i) => {
    const gold = fixture.reference.units[i];
    const cueEvidenceIds = fixture.evidence[gold.id] ?? [];
    return {id: gold.id, unitSha256: gold.unitSha256, paragraph: gold.paragraph,
      expected: {narrativePhase: gold.narrativePhase, cue: gold.cue, transition: gold.transition, cueEvidenceIds},
      pipelineFlags: [row.playbackDisposition, row.transitionFlag].filter(flag => pipelineFlags.has(flag)),
      compiler: {pattern: row.pattern, phase: row.phase, decision: row.trace.decision,
        appliedTransition: row.appliedTransition ?? null, evidenceIds: validIds(row.evidenceIds, size)},
      ...Object.fromEntries([...stages].map(([stage, attempts]) =>
        [stage, stageDiagnostic(gold, row, stage, attempts.get(gold.id), cueEvidenceIds, size)]))};
  })};
}

function attemptReport(runs, stage) {
  const rows = runs.flatMap(run => run.summary.attempts).filter(row => attemptStage[row.mode] === stage && row.attempted);
  const usage = rows.map(row => row.usage).filter(value => natural(value?.inputTokens) && natural(value?.outputTokens));
  const timings = rows.map(row => row.elapsedMs).filter(natural).sort((a, b) => a - b);
  const percentile = q => timings[Math.ceil(timings.length * q) - 1] ?? null;
  const returnedModels = [...new Set(rows.map(row => row.returnedModel).filter(model =>
    typeof model === "string" && /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/u.test(model)))].sort();
  const failures = Object.fromEntries(Object.entries(Object.groupBy(rows.filter(row => failureReasons.has(row.failureReason)),
    row => row.failureReason)).map(([reason, group]) => [reason, group.length]));
  return {attempts: rows.length, measuredUsage: usage.length, inputTokens: usage.reduce((sum, value) => sum + value.inputTokens, 0),
    outputTokens: usage.reduce((sum, value) => sum + value.outputTokens, 0),
    measuredTimings: timings.length, p50AttemptMs: percentile(0.50), p95AttemptMs: percentile(0.95), returnedModels, failures};
}

function transitionAllocation(fixtures, limit) {
  const size = fixtures.reduce((sum, fixture) => sum + fixture.reference.units.length, 0);
  const quotas = fixtures.map((fixture, index) => ({index, quota: fixture.reference.units.length * limit / size}));
  const limits = quotas.map(({quota}) => Math.floor(quota));
  const remaining = limit - limits.reduce((sum, count) => sum + count, 0);
  quotas.sort((a, b) => (b.quota - limits[b.index]) - (a.quota - limits[a.index]) || a.index - b.index);
  for (const {index} of quotas.slice(0, remaining)) limits[index]++;
  return limits;
}

export async function runLunaProtocolNeutral({mode = "offline", arm = "windowed", provider, signal, now = Date.now,
  transitionLimit = 33, maxAttempts = 80, verifyTransitions = true, verificationContext = "attested"} = {}) {
  if (!["offline", "mock", "live"].includes(mode) || !["windowed", "complete"].includes(arm) ||
      (provider !== undefined && (mode === "offline" || typeof provider !== "function")) ||
      (mode === "live" && !provider) || !natural(transitionLimit) || transitionLimit > 33 ||
      !natural(maxAttempts) || maxAttempts > 80 || typeof verifyTransitions !== "boolean" ||
      !["recent", "attested"].includes(verificationContext)) throw new TypeError(invalidOptions);
  const fixtures = prepareFixtures(now());
  const transitionBudgets = transitionAllocation(fixtures, verifyTransitions ? transitionLimit : 0);
  const budget = createLunaShadowBudget({maxAttempts, maxSourceBytes: 128_000, maxMicros: 150_000});
  const providerStops = {};
  const guardedProvider = provider && (async (request, options) => {
    const stopped = providerStops.all ?? providerStops[request.mode];
    if (stopped) return {status: "not-dispatched", failureReason: stopped};
    const result = await provider(request, options);
    if (["http-auth", "http-quota", "http-redirect", "model-mismatch"].includes(result?.failureReason)) {
      providerStops.all = result.failureReason;
    } else if (["http-schema", "http-client"].includes(result?.failureReason)) {
      providerStops[request.mode] = result.failureReason;
    }
    return result;
  });
  const runs = [];
  for (const [index, fixture] of fixtures.entries()) {
    const {id, text, grant, reference} = fixture;
    runs.push(await runLunaProtocolShadow({id, text, sourceSha256: reference.sourceSha256, grant, budget, signal, now, arm,
      provider: mode === "mock" ? guardedProvider ?? mockProvider(fixture) : guardedProvider,
      limits: {maxTargetsPerWindow: 4, maxOverlapUnits: 2}, verificationTargets: reference.units.map(({id}) => id),
      verifyTransitions, maxTransitionVerification: transitionBudgets[index], verificationContext}));
  }
  const reference = {cohort: fixtures.map(({id}) => id), works: fixtures.map(({reference}) => reference)};
  const planning = runs.map(({id, summary}, index) => ({
    id, referenceTargets: summary.plan.units, admittedTargets: summary.plan.approvedUnits,
    plannedTargets: arm === "complete" ? (summary.discoveryWindows ? summary.plan.units : 0) : summary.plan.plannedTargets,
    plannedDiscoveryWindows: summary.discoveryWindows,
    discoveryAttempts: summary.attempts.filter(row => row.mode === "discovery" && row.attempted).length,
    prefixAttempts: summary.attempts.filter(row => row.mode === "verify" && row.attempted).length,
    transitionTargetLimit: transitionBudgets[index],
    transitionAttempts: summary.attempts.filter(row => row.mode === "transition" && row.attempted).length,
  }));
  const totals = Object.fromEntries(Object.keys(planning[0]).filter(field => field !== "id")
    .map(field => [field, planning.reduce((sum, row) => sum + row[field], 0)]));
  return {fixtureVersion, fixtureDigest, rubricVersion: runs[0].rubricVersion, segmentationVersion: runs[0].segmentationVersion,
    arm, verificationContext, measurement: {offline: "offline-planning", mock: provider ? "offline-injected-mock" : "offline-reference-mock",
      live: "live-neutral-provider"}[mode], model: mode === "live" ? LUNA_PROTOCOL_MODEL : null,
    independentCorpusBenchmark: false, sourceProseIncluded: false, ...(mode === "live" ? {} : {externalCalls: 0}),
    prefixPolicy: "Freeze all native cue targets before discovery. The transition-only stage has a separate target allowance.",
    cueDefinition: "An exact fixture unit with a non-quiet reference phase.",
    transitionDefinition: "An exact fixture unit and typed event. Nearby matching uses the same event type within one paragraph.",
    planning: {...totals, works: planning}, budget: budget.snapshot(), providerStops,
    ...Object.fromEntries(Object.keys(stageDimensions).map(stage => [stage,
      {...stageReport(reference, runs, stage), usage: attemptReport(runs, stage)}])),
    diagnostics: fixtures.map((fixture, i) => diagnosticWork(fixture, runs[i]))};
}
