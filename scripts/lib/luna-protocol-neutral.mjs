import {createHash} from "node:crypto";
import {wholeStoryAnnotationFixtures} from "../../tests/whole-story-annotation-fixtures.mjs";
import {scoreBeatContinuityCorpus} from "./beat-continuity-evaluation.mjs";
import {LUNA_PROTOCOL_ENUMS, LUNA_PROTOCOL_FAILURE_REASONS, LUNA_PROTOCOL_MODEL, LUNA_PROTOCOL_TARGET_FAILURES,
  LUNA_PROTOCOL_TRANSITION_FACTS}
  from "./luna-protocol-provider.mjs";
import {createLunaShadowBudget, runLunaProtocolShadow} from "./luna-protocol-shadow.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "./whole-story-context-planning.mjs";

const fixtureVersion = "neutral-stories-v1";
const fixtureDigest = "40cd3c8f193ba7fb44b75234a1917b577ec5d742bceb532ea634cd0643691d6d";
const referenceScope = "Four pinned development fixtures for smoke checks. Release qualification requires an independent, frozen corpus.";
const behaviorReferenceVersion = "neutral-behavior-v1";
const behaviorReferenceDigest = "8fb2b416829e9cbc542bf03738b4da3563cdc668256a15b04f13b459c07b71f9";
const cueKinds = ["narrativeBuildup", "directEnacted", "continuation"];
const behaviorReference = {
  "first-dance": {
    narrativeBuildup: [2, 3, 9], directEnacted: [4, 10], continuation: [5],
    playbackGate: ["quiet", "quiet", "active", "active", "active", "active", "carry-optional", "hard-stop", "quiet", "quiet", "active"],
  },
  "old-letter": {
    narrativeBuildup: [], directEnacted: [7], continuation: [],
    playbackGate: ["quiet", "reset", "quiet", "quiet", "reset", "quiet", "quiet", "active"],
  },
  "reading-room": {
    narrativeBuildup: [7], directEnacted: [1, 8], continuation: [],
    playbackGate: ["quiet", "active", "quiet", "quiet", "quiet", "quiet", "quiet", "quiet", "active"],
  },
  "practice-drill": {
    narrativeBuildup: [], directEnacted: [], continuation: [],
    playbackGate: ["quiet", "quiet", "quiet", "quiet", "quiet"],
  },
};
const gateProfiles = Object.freeze({Baseline: "quiet", Stop: "hard-stop", Reset: "reset", Divider: "reset"});
const activeProfiles = new Set(["Undertone", "Gradual build", "Deepening build", "Onset rise", "Rebuild rise", "Sustain wave",
  "Deep sustain", "Crest approach", "Crest", "Taper", "Recovery", "Hold"]);
const activeCuePhases = new Set(["build", "onset", "rebuild", "sustain", "peak"]);
const behaviorStages = ["discovery", "prefix", "accepted", "applied"];
const unknownCueKinds = Object.freeze(Object.fromEntries(cueKinds.map(kind => [kind, null])));
const noCueKinds = Object.freeze(Object.fromEntries(cueKinds.map(kind => [kind, false])));
const stageDimensions = {
  discovery: ["cue", "narrativePhase", "transition"],
  prefix: ["cue", "narrativePhase"],
  transition: ["transition"],
  applied: ["cue", "transition"],
  reader: ["cue"],
};
const rawStages = ["discovery", "prefix", "transition"];
const attemptStage = {discovery: "discovery", verify: "prefix", transition: "transition", "cue-check": "cueRecovery"};
const observedStatuses = new Set(["candidate", "verified", "neutral"]);
const typedTransitions = new Set(LUNA_PROTOCOL_ENUMS.transition);
const phaseLabels = new Set(LUNA_PROTOCOL_ENUMS.narrativePhase);
const actionLabels = new Set(LUNA_PROTOCOL_ENUMS.action);
const diagnosticLabels = Object.entries(LUNA_PROTOCOL_ENUMS).filter(([field]) => field !== "status")
  .map(([field, values]) => [field, new Set(values)]);
const boundaryTransitions = new Set(["interruption", "span-end", "beat-end", "scene-cut", "chapter-end", "hard-stop",
  "memory-entry", "imagined-entry", "reported-entry", "present-return", "uncertain-continuity", "declined-restart",
  "non-romantic-activity-stop"]);
const failureReasons = new Set([...LUNA_PROTOCOL_FAILURE_REASONS, "rejected-fact-contract"]);
const targetFailureReasons = new Set(LUNA_PROTOCOL_TARGET_FAILURES);
const pipelineFlags = new Set(["prefix-disagreement", "unattested-scope", "transition-conflict", "protective-transition-conflict",
  "cue-boundary-suppressed", "cue-target-uncited", "cue-frame-ineligible", "cue-restart-required", "cue-stale-evidence"]);
const dispositions = new Set([...observedStatuses, "uncertain", "abstain", "withheld", "unavailable", "unverified",
  "failed", "missing", "budget-deferred", "provider-unavailable", "complete-arm-ineligible", "provider-refused",
  "refusal-dependent", "incomplete", "invalid-response", "transient", "cancelled", "timed-out", "invalid-request",
  "verification-deferred", "transition-verification-deferred", "not-requested", "not-needed", "returned", "partial"]);
const reportOnlyDispositions = new Set(["transition-verification-deferred", "not-requested", "returned"]);
const actionForPhase = {build: "anticipation", onset: "contact", sustain: "continuation", rebuild: "contact"};
const invalidOptions = "Invalid neutral benchmark options.";
const natural = value => Number.isSafeInteger(value) && value >= 0;
const disposition = (status, fallback = "unavailable") => dispositions.has(status) ? status : fallback;
const validIds = (ids, limit) => Array.isArray(ids) && ids.every(id => natural(id) && id < limit) ? [...ids] : null;
const rosterDigest = works => createHash("sha256").update(JSON.stringify(works.map(({id, sourceSha256}) => ({id, sourceSha256})))).digest("hex");

function prepareFixtures(now) {
  if (createHash("sha256").update(JSON.stringify(wholeStoryAnnotationFixtures)).digest("hex") !== fixtureDigest) {
    throw new Error("The built-in neutral fixtures or reference have changed.");
  }
  if (createHash("sha256").update(JSON.stringify([fixtureDigest, behaviorReference])).digest("hex") !== behaviorReferenceDigest) {
    throw new Error("The built-in neutral behavior reference has changed.");
  }
  return wholeStoryAnnotationFixtures.map(({id, paragraphs, phases, events, evidence}) => {
    const text = paragraphs.join("\n\n");
    const {editionDigest, segmentationVersion, units} = buildWholeStoryIndex(text);
    if (units.length !== phases.length || units.some(unit => unit.structuralBoundary)) {
      throw new Error("The built-in neutral reference no longer matches reader units.");
    }
    const spans = units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}));
    const grant = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: now + 300_000, spans};
    const behavior = behaviorReference[id];
    if (behavior?.playbackGate.length !== units.length || cueKinds.some(kind => validIds(behavior[kind], units.length) === null)) {
      throw new Error("The built-in behavior reference no longer matches reader units.");
    }
    const reference = {id, sourceSha256: editionDigest, units: units.map(({id: unitId, paragraph, digest}) => {
      const narrativePhase = phases[unitId] === "restart" ? "rebuild" : phases[unitId];
      const transition = events[unitId] === "stop" ? "hard-stop" : events[unitId] ?? "none";
      return {id: unitId, paragraph, unitSha256: digest, narrativePhase, transition, cue: narrativePhase !== "quiet",
        frame: "uncertain", depiction: "unknown", structural: false, legacyCue: narrativePhase !== "quiet",
        legacyCueKnown: true, hardAction: transition === "hard-stop", protectedReference: false,
        behavior: {...Object.fromEntries(cueKinds.map(kind => [kind, behavior[kind].includes(unitId)])),
          playbackGate: behavior.playbackGate[unitId]}};
    })};
    return {id, text, grant, reference, evidence};
  });
}

export function getNeutralProtocolReference() {
  return {fixtureVersion, fixtureDigest, behaviorReferenceVersion, behaviorReferenceDigest,
    works: prepareFixtures(0).map(({reference}) => reference)};
}

export function scoreNeutralPlaybackGate(expected, pattern) {
  const actual = Object.hasOwn(gateProfiles, pattern) ? gateProfiles[pattern] : activeProfiles.has(pattern) ? "active" : null;
  return {expected, actual, matches: actual !== null && (actual === expected ||
    expected === "carry-optional" && ["quiet", "active"].includes(actual))};
}

function mockProvider({reference, evidence}) {
  return async ({mode, units, targetIds}) => {
    const submitted = new Set(units.map(({id}) => id));
    const facts = targetIds.map(unitId => {
      const {narrativePhase, transition, cue} = reference.units[unitId];
      const frame = reference.id === "old-letter" && unitId >= 1 && unitId <= 3 ? "reported" : "current";
      if (mode === "transition") {
        const fact = LUNA_PROTOCOL_TRANSITION_FACTS[transition]?.[0] ?? "none";
        return {unitId, status: transition === "none" ? "neutral" : "verified", depiction: "unknown",
          frame, narrativePhase: "unknown", transition, action: "unknown", fact, scopeId: null,
          priorAnchor: null, evidenceIds: transition === "none" ? [] : [unitId]};
      }
      const reviewed = cue || transition !== "none";
      const evidenceIds = evidence[unitId] ?? (reviewed ? [unitId] : []);
      if (evidenceIds.some(id => !submitted.has(id))) {
        return {unitId, status: "abstain", depiction: "unknown", frame: "uncertain", narrativePhase: "unknown",
          transition: "none", action: "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds: []};
      }
      return {unitId, status: reviewed ? mode === "discovery" ? "candidate" : "verified" : "neutral",
        depiction: cue ? "romantic" : "neutral", frame, narrativePhase, transition,
        action: actionForPhase[narrativePhase] ?? "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds};
    });
    return {status: "ok", facts, usage: {inputTokens: 0, outputTokens: 0}};
  };
}

function observation(row, stage) {
  if (stage === "applied" || stage === "reader") {
    const transitionOrigin = stage === "applied" ? appliedTransitionOrigin(row) : "unobserved";
    const value = stage === "reader" ? row.readerCue : row.cue;
    const cue = typeof value === "boolean" ? value : undefined;
    const returned = cue !== undefined || transitionOrigin !== "unobserved";
    return {result: {id: row.id, unitSha256: row.unitSha256,
      status: returned ? "verified" : disposition(observedStatuses.has(row.status) ? "unavailable" : row.status),
      ...(cue === undefined ? {} : {cue}), ...(transitionOrigin === "unobserved" ? {} : {transition: row.appliedTransition})},
    returned, evidenceIds: row.evidenceIds, transitionOrigin};
  }
  // A discovery label which did not require prefix review is in the final slot.
  const fact = {
    discovery: row.discovery ?? (row.verificationStatus === undefined && row.labelKnownAt !== null ? row : undefined),
    prefix: row.primaryPrefix, transition: row.transitionVerification, cueRecovery: row.cueRecovery,
  }[stage];
  const fallback = {
    discovery: row.discoveryStatus ?? row.status,
    prefix: row.verificationStatus ?? (row.labelKnownAt !== null ? "unverified" : row.status),
    transition: row.transitionVerificationStatus ??
      (observedStatuses.has(row.status) ? "transition-verification-deferred" : row.status),
    cueRecovery: row.cueRecoveryStatus ?? "not-requested",
  }[stage];
  const status = disposition(fact?.status ?? (observedStatuses.has(fallback) ? "unavailable" : fallback));
  if (status === "partial") return {result: {id: row.id, unitSha256: row.unitSha256, status: "invalid-response"}, returned: false};
  const result = {id: row.id, unitSha256: row.unitSha256, status};
  const evidenceIds = stage === "transition" ? row.transitionEvidenceIds :
    fact === row ? row.labelEvidenceIds : fact?.evidenceIds;
  if (fact) {
    if (stage !== "transition" && phaseLabels.has(fact.narrativePhase)) {
      result.narrativePhase = fact.narrativePhase;
      if (fact.narrativePhase !== "unknown") result.cue = fact.narrativePhase !== "quiet";
    }
    if (stage !== "prefix" && stage !== "cueRecovery" && typedTransitions.has(fact.transition)) result.transition = fact.transition;
  }
  return {result, returned: Boolean(fact), evidenceIds, labels: fact};
}

function metricRow(score) {
  const phase = score.labels.narrativePhase;
  return {targets: score.rows, observedTargets: score.observedRows, coverage: score.rowCoverage, dispositions: score.status,
    ...(score.cues ? {exactCues: score.cues.effective, observedCueTargets: score.cues.observedKnownRows} : {}),
    ...(score.typedTransitions ? {exactTypedTransitions: score.typedTransitions.exact,
      nearbyTypedTransitions: score.typedTransitions.withinOneParagraph,
      observedTypedTargets: score.labels.transition.observed} : {}),
    ...(phase ? {phase: {exact: phase.exact, observed: phase.observed}} : {})};
}

const boundaryValue = transition => boundaryTransitions.has(transition) || transition === "unknown" ? transition : "none";
const boundaryWork = work => ({...work, units: work.units.map(unit => Object.hasOwn(unit, "transition") ?
  {...unit, transition: boundaryValue(unit.transition)} : unit)});
function boundaryScore(reference, works) {
  const candidates = works.map(({id, sourceSha256, units}) => ({id, sourceSha256, units: units.map(row =>
    ({id: row.id, unitSha256: row.unitSha256, status: row.status,
      ...(Object.hasOwn(row, "transition") ? {transition: boundaryValue(row.transition)} : {})}))}));
  return scoreBeatContinuityCorpus({...reference, works: reference.works.map(boundaryWork)},
    {dimensions: ["transition"], works: candidates});
}

function boundaryReport(score, works) {
  const otherTypedPredictions = works.flatMap(work => work.units)
    .filter(row => observedStatuses.has(row.status) && typedTransitions.has(row.transition) &&
      !["none", "unknown"].includes(row.transition) && !boundaryTransitions.has(row.transition));
  return {exact: score.typedTransitions.exact, nearby: score.typedTransitions.withinOneParagraph,
    excludedNonBoundaryPredictions: Object.fromEntries(Object.entries(Object.groupBy(otherTypedPredictions, row => row.transition))
      .map(([type, rows]) => [type, rows.length]))};
}

function stageReport(reference, runs, stage) {
  const observations = runs.map(work => work.units.map(row => observation(row, stage)));
  const works = runs.map(({id, sourceSha256}, i) => ({id, sourceSha256, units: observations[i].map(({result}) =>
    reportOnlyDispositions.has(result.status) ? {...result, status: "verification-deferred"} : result)}));
  const score = scoreBeatContinuityCorpus(reference, {dimensions: stageDimensions[stage], works});
  const boundary = stageDimensions[stage].includes("transition") ? boundaryScore(reference, works) : null;
  const coverage = rows => ({returnedTargets: rows.filter(row => row.returned).length,
    dispositions: Object.fromEntries(Object.entries(Object.groupBy(rows, row => row.result.status))
      .map(([status, group]) => [status, group.length]))});
  return {...metricRow(score.summary), ...coverage(observations.flat()),
    ...(boundary ? {boundary: boundaryReport(boundary.summary, works)} : {}),
    works: score.stories.map(({id, ...metrics}, i) => ({id, ...metricRow(metrics), ...coverage(observations[i]),
      ...(boundary ? {boundary: boundaryReport(boundary.stories[i], [works[i]])} : {})}))};
}

function appliedTransitionOrigin(row) {
  if (!typedTransitions.has(row.appliedTransition) || row.appliedTransition === "unknown") return "unobserved";
  if (row.continuityGuard === "elapsed-time-gap") return "compiler-continuity-guard";
  const fromRecheck = row.cueRecovered || row.cueContractRepaired || (row.cueRecovery?.status === "verified" &&
    row.cueRecovery.transition === "hard-stop" && row.appliedTransition === "hard-stop" &&
    row.primaryPrefix?.transition !== "hard-stop");
  if (row.transitionFlag === "protective-transition-conflict" && row.prefixVerified) {
    return fromRecheck ? "protected-cue-check" : "protected-cue-prefix";
  }
  const dedicated = row.transitionVerification;
  if (dedicated && observedStatuses.has(dedicated.status) && dedicated.transition === row.appliedTransition) {
    if (row.prefixVerified && row.transition === row.appliedTransition) {
      return fromRecheck ? "transition-and-cue-check-agree" : "both-passes-agree";
    }
    return "transition-pass";
  }
  if (!row.prefixVerified || !observedStatuses.has(row.status)) return "unobserved";
  return fromRecheck ? "cue-check" : "cue-prefix";
}

function appliedChange(expected, raw, applied, nonEvent) {
  if (applied === undefined) return raw === undefined ? "unobserved" : "application-unobserved";
  if (raw === undefined) return applied === expected && expected !== nonEvent ? "recovered-by-coverage" : "raw-unobserved";
  if (raw === applied) return "unchanged";
  if (applied === expected) return expected === nonEvent ? "removed-false-positive" : "recovered-match";
  if (raw === expected) return expected === nonEvent ? "added-false-positive" : "lost-match";
  return "changed-mismatch";
}

function targetDisposition({contractRejection, returned, dispatched, requestStatus}) {
  if (contractRejection) return "rejected";
  if (returned) return "returned";
  if (!requestStatus) return "no-attempt-record";
  if (!dispatched) return "not-dispatched";
  if (["returned", "partial"].includes(requestStatus)) return "discarded-after-return";
  return "no-fact-returned";
}

const eligibleCueCheck = ({dispatched, requestStatus}) => dispatched || requestStatus === "budget-deferred";

function stageDiagnostic(gold, row, stage, attempt, referenceCueEvidenceIds, size) {
  const {result, returned, evidenceIds, labels} = observation(row, stage);
  const scoresCue = stage !== "transition";
  const scoresTransition = stage === "discovery" || stage === "transition";
  const contextIds = attempt?.attempted ? validIds(attempt.contextIds, size) : null;
  const targetIds = attempt?.attempted ? validIds(attempt.targetIds, size) : null;
  const attestedIds = attempt?.attempted ? validIds(attempt.attestedIds ?? [], size) : null;
  const submittedIds = contextIds === null || targetIds === null ? null : [...new Set([...contextIds, ...targetIds])];
  const missingReferenceCueEvidenceIds = !scoresCue || submittedIds === null ? null :
    referenceCueEvidenceIds.filter(id => !submittedIds.includes(id));
  const citedIds = returned ? validIds(evidenceIds, size) : null;
  const observed = observedStatuses.has(result.status);
  const reasons = [];
  if (!observed) reasons.push(`disposition:${result.status}`);
  if (missingReferenceCueEvidenceIds?.length) reasons.push("reference-cue-evidence-outside-raw-window");
  if (observed && scoresCue) {
    if (result.cue !== gold.cue) reasons.push(result.cue === undefined ? "cue-unresolved" : gold.cue ? "cue-missed" : "extra-cue");
    if (result.narrativePhase !== gold.narrativePhase) reasons.push("phase-mismatch");
  }
  if (observed && scoresTransition) {
    if (result.transition !== gold.transition) reasons.push(result.transition === "unknown" ? "transition-unresolved" :
      gold.transition === "none" ? "extra-transition" : result.transition === "none" ? "transition-missed" : "transition-type-mismatch");
    if (result.transition && !["none", "unknown"].includes(result.transition) && !citedIds?.includes(gold.id)) {
      reasons.push("target-uncited-for-transition");
    }
  }
  const rejectedReason = attempt?.rejectedFacts?.find(row => row.id === gold.id)?.reason;
  const request = {returned, dispatched: Boolean(attempt?.attempted),
    requestStatus: attempt ? disposition(attempt.status) : null,
    requestFailure: failureReasons.has(attempt?.failureReason) ? attempt.failureReason : null,
    contractRejection: targetFailureReasons.has(rejectedReason) ? rejectedReason : null};
  const safeLabels = labels ? {
    ...Object.fromEntries(diagnosticLabels.map(([field, values]) => [field, values.has(labels[field]) ? labels[field] : null])),
    scopeId: validIds([labels.scopeId], size)?.[0] ?? null, priorAnchor: validIds([labels.priorAnchor], size)?.[0] ?? null,
  } : null;
  return {status: result.status, ...request, targetDisposition: targetDisposition(request), submittedIds, attestedIds,
    targetCoverageMismatch: attempt?.targetCoverageMismatch === true,
    citedIds, missingReferenceCueEvidenceIds, reasons, labels: safeLabels,
    ...(scoresCue ? {narrativePhase: result.narrativePhase ?? null, cue: result.cue ?? null} : {}),
    ...(scoresTransition ? {transition: result.transition ?? null} : {}),
    ...(stage === "cueRecovery" ? {scheduled: Boolean(attempt) || row.cueRecoveryStatus !== undefined,
      selected: eligibleCueCheck(request),
      recovered: row.cueRecovered === true,
      contractRepaired: row.cueContractRepaired === true,
      primaryFailure: targetFailureReasons.has(row.primaryFailure) || failureReasons.has(row.primaryFailure) ? row.primaryFailure : null,
      action: actionLabels.has(row.cueRecovery?.action) ? row.cueRecovery.action : null} : {})};
}

function appliedMismatch(expected, actual, negative, label) {
  if (actual === undefined) return expected === negative ? [] : [`unobserved-${label}`];
  if (actual === expected) return [];
  if (expected === negative) return [`extra-${label}`];
  return [actual === negative ? `missing-${label}` : `${label}-type-mismatch`];
}

function semanticCueKinds(status, fact) {
  if (!observedStatuses.has(status) || !fact) return unknownCueKinds;
  if (status === "neutral") return noCueKinds;
  if (["mixed", "uncertain"].includes(fact.frame)) return unknownCueKinds;
  if (fact.frame !== "current") return noCueKinds;
  if (fact.narrativePhase === "unknown" || fact.action === "unknown") return unknownCueKinds;
  const active = activeCuePhases.has(fact.narrativePhase);
  return {narrativeBuildup: fact.narrativePhase === "build" && fact.action === "anticipation",
    directEnacted: active && ["contact", "change"].includes(fact.action),
    continuation: active && fact.action === "continuation"};
}

function behaviorDiagnostic(row, expected) {
  const discovery = observation(row, "discovery");
  const accepted = semanticCueKinds(row.status, row.prefixVerified ? row : null);
  const gated = (kind, observed) => typeof observed !== "boolean" ? null :
    observed ? accepted[kind] : false;
  return {discovery: semanticCueKinds(discovery.result.status, discovery.labels),
    prefix: semanticCueKinds(row.primaryPrefix?.status, row.primaryPrefix), accepted,
    applied: {narrativeBuildup: gated("narrativeBuildup", row.readerCue), directEnacted: gated("directEnacted", row.cue),
      continuation: gated("continuation", row.readerCue)},
    playbackGate: scoreNeutralPlaybackGate(expected.playbackGate, row.pattern)};
}

function compilerAnchor(value, story, kind, size) {
  const prefix = `${story}:${kind}:`;
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const id = Number(value.slice(prefix.length));
  return natural(id) && id < size && value === `${prefix}${id}` ? id : null;
}

function diagnosticWork(fixture, run) {
  const stages = new Map([...rawStages, "cueRecovery"].map(stage => [stage, new Map()]));
  const size = fixture.reference.units.length;
  for (const attempt of run.summary.attempts) {
    const stage = stages.get(attemptStage[attempt.mode]);
    if (!stage) continue;
    for (const id of validIds(attempt.targetIds, size) ?? []) stage.set(id, attempt);
  }
  return {id: run.id, sourceSha256: run.sourceSha256, units: run.units.map((row, i) => {
    const gold = fixture.reference.units[i];
    const cueEvidenceIds = fixture.evidence[gold.id] ?? [];
    const rawCue = observation(row, "prefix").result;
    const rawTyped = observation(row, "transition").result;
    const {result: applied, transitionOrigin} = observation(row, "applied");
    const {result: reader} = observation(row, "reader");
    const prefixTransition = row.primaryPrefix?.transition;
    const primaryCue = observedStatuses.has(rawCue.status) ? rawCue.cue : undefined;
    return {id: gold.id, unitSha256: gold.unitSha256, paragraph: gold.paragraph,
      expected: {narrativePhase: gold.narrativePhase, cue: gold.cue, transition: gold.transition, cueEvidenceIds,
        behavior: gold.behavior},
      behavior: behaviorDiagnostic(row, gold.behavior),
      pipelineFlags: [row.playbackDisposition, row.transitionFlag, row.cueGuard].filter(flag => pipelineFlags.has(flag)),
      applied: {status: applied.status, cue: applied.cue ?? null, transition: applied.transition ?? null, transitionOrigin,
        cuePrefixTransition: typedTransitions.has(prefixTransition) ? prefixTransition : null,
        readerCue: reader.cue ?? null,
        cueChange: appliedChange(gold.cue, primaryCue, applied.cue, false),
        readerCueChange: appliedChange(gold.cue, primaryCue, reader.cue, false),
        transitionChange: appliedChange(gold.transition, observedStatuses.has(rawTyped.status) && rawTyped.transition !== "unknown" ?
          rawTyped.transition : undefined, applied.transition, "none"),
        mismatches: [...appliedMismatch(gold.cue, reader.cue, false, "reader-cue"),
          ...appliedMismatch(gold.transition, applied.transition, "none", "transition")]},
      compiler: {pattern: row.pattern, phase: row.phase, decision: row.trace.decision,
        appliedTransition: row.appliedTransition ?? null, evidenceIds: validIds(row.evidenceIds, size),
        continuityGuard: row.continuityGuard === "elapsed-time-gap" ? row.continuityGuard : null,
        beatAnchor: compilerAnchor(row.beatId, run.id, "beat", gold.id + 1),
        sceneAnchor: compilerAnchor(row.sceneId, run.id, "scene", gold.id + 1)},
      ...Object.fromEntries([...stages].map(([stage, attempts]) =>
        [stage, stageDiagnostic(gold, row, stage, attempts.get(gold.id), cueEvidenceIds, size)]))};
  })};
}

const countValues = (rows, key) => Object.fromEntries(Object.entries(Object.groupBy(rows, key))
  .map(([value, group]) => [value, group.length]));

function behaviorReport(diagnostics) {
  const summarize = units => {
    const classify = (stage, kind) => {
      const expected = row => row.expected.behavior[kind] && (stage !== "applied" || row.expected.behavior.playbackGate === "active");
      const predicted = row => row.behavior[stage][kind];
      const referencePositives = units.filter(expected).length;
      const matched = units.filter(row => expected(row) && predicted(row) === true).length;
      const extra = units.filter(row => !expected(row) && predicted(row) === true).length;
      return {targets: units.length, observedTargets: units.filter(row => predicted(row) !== null).length,
        referencePositives, matched, missed: referencePositives - matched, extra,
        precision: ratio(matched, matched + extra), recall: ratio(matched, referencePositives)};
    };
    const gates = units.map(row => row.behavior.playbackGate);
    const summarizeGates = rows => ({targets: rows.length, observedTargets: rows.filter(row => row.actual !== null).length,
      matched: rows.filter(row => row.matches).length, missed: rows.filter(row => !row.matches).length});
    const stages = Object.fromEntries(behaviorStages.map(stage => [stage, Object.fromEntries(cueKinds.map(kind =>
      [kind, classify(stage, kind)]))]));
    const byExpected = Object.fromEntries(Object.entries(Object.groupBy(gates, row => row.expected))
      .map(([expected, rows]) => [expected, summarizeGates(rows)]));
    return {...stages, playbackGate: {...summarizeGates(gates), byExpected}};
  };
  return {...summarize(diagnostics.flatMap(work => work.units)),
    definitions: {
      narrativeBuildup: "Supported accumulation of present tension without fresh enactment at the target.",
      directEnacted: "Fresh, directly depicted enactment at the target.",
      continuation: "Direct support that an established beat is continuing. Neutral connectors can allow carry without a new cue.",
      accepted: "Final accepted cue label after any recheck, measured against the semantic reference.",
      applied: "Effective cue kinds after gating. Only semantic positives that require active playback count as expected here.",
      playbackGate: "Computed qualitative effect. Optional carry accepts quiet or active playback. This score does not measure device commands.",
    }, works: diagnostics.map(({id, units}) => ({id, ...summarize(units)}))};
}

function rawTargetReport(diagnostics, stage) {
  const summarize = units => {
    const submitted = units.filter(row => row[stage].dispatched);
    const unobserved = submitted.filter(row => !observedStatuses.has(row[stage].status));
    const rejected = units.flatMap(row => targetFailureReasons.has(row[stage].contractRejection) ?
      [{id: row.id, reason: row[stage].contractRejection}] : []);
    return {submitted, unobserved, rejected};
  };
  const units = diagnostics.flatMap(work => work.units);
  const {submitted, unobserved, rejected} = summarize(units);
  return {submittedTargets: submitted.length, unobservedSubmittedTargets: unobserved.length,
    rejectedTargets: rejected.length, rejections: countValues(rejected, row => row.reason),
    targetDispositions: countValues(units, row => targetDisposition(row[stage])),
    works: diagnostics.map(({id, units}) => {
      const {submitted, unobserved, rejected} = summarize(units);
      return {id, submittedTargetIds: submitted.map(row => row.id), unobservedSubmittedTargetIds: unobserved.map(row => row.id),
        rejectedTargets: rejected};
    })};
}

function readerCueChanges(diagnostics) {
  return countValues(diagnostics.flatMap(work => work.units), row => {
    const raw = observedStatuses.has(row.prefix.status) ? row.prefix.cue ?? undefined : undefined;
    return appliedChange(row.expected.cue, raw, row.applied.readerCue ?? undefined, false);
  });
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
  return {attempts: rows.length, measuredUsage: usage.length, unknownUsage: rows.length - usage.length,
    inputTokens: usage.reduce((sum, value) => sum + value.inputTokens, 0),
    outputTokens: usage.reduce((sum, value) => sum + value.outputTokens, 0),
    measuredTimings: timings.length, durationsMs: timings, p50AttemptMs: percentile(0.50), p95AttemptMs: percentile(0.95),
    returnedModels, failures};
}

function cueRecoveryReport(diagnostics, usage) {
  const summarize = units => ({
    targets: units.length,
    scheduledTargets: units.filter(row => row.cueRecovery.scheduled ?? row.cueRecovery.selected).length,
    selectedTargets: units.filter(row => eligibleCueCheck(row.cueRecovery)).length,
    attemptedTargets: units.filter(row => row.cueRecovery.dispatched).length,
    returnedTargets: units.filter(row => row.cueRecovery.returned).length,
    recoveredTargets: units.filter(row => row.cueRecovery.recovered).length,
    contractRepairedTargets: units.filter(row => row.cueRecovery.contractRepaired).length,
    recoveredReferenceCues: units.filter(row => row.cueRecovery.recovered && row.expected.cue).length,
    recoveredReferenceNonCues: units.filter(row => row.cueRecovery.recovered && !row.expected.cue).length,
    directCuesAfterRecovery: units.filter(row => row.cueRecovery.recovered && row.applied.cue === true).length,
    readerCuesAfterRecovery: units.filter(row => row.cueRecovery.recovered && row.applied.readerCue === true).length,
    dispositions: Object.fromEntries(Object.entries(Object.groupBy(units, row => row.cueRecovery.status))
      .map(([status, rows]) => [status, rows.length])),
  });
  return {...summarize(diagnostics.flatMap(work => work.units)), usage,
    selectionDefinition: "Scheduled checks have a recorded job. Selected checks qualify for dispatch, including budget deferrals.",
    targetDiagnostics: rawTargetReport(diagnostics, "cueRecovery"),
    works: diagnostics.map(({id, units}) => ({id, ...summarize(units)}))};
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

const invalidShards = "Use two complementary reports from the same neutral benchmark arm.";
function sumFields(rows, fields) {
  return Object.fromEntries(fields.map(field => {
    if (!rows.every(row => natural(row?.[field]))) throw new TypeError(invalidShards);
    return [field, rows.reduce((sum, row) => sum + row[field], 0)];
  }));
}

function mergeCounts(groups) {
  const totals = new Map();
  for (const group of groups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) throw new TypeError(invalidShards);
    for (const [key, count] of Object.entries(group)) {
      if (!natural(count)) throw new TypeError(invalidShards);
      totals.set(key, (totals.get(key) ?? 0) + count);
    }
  }
  return Object.fromEntries(totals);
}

const ratio = (value, total) => total ? value / total : null;
function mergeBinary(rows) {
  const counts = sumFields(rows, ["matched", "missed", "extra"]);
  return {...counts, precision: ratio(counts.matched, counts.matched + counts.extra),
    recall: ratio(counts.matched, counts.matched + counts.missed)};
}

function mergeUsage(rows) {
  const totals = sumFields(rows, ["attempts", "measuredUsage", "unknownUsage", "inputTokens", "outputTokens", "measuredTimings"]);
  if (rows.some(row => !Array.isArray(row.durationsMs) || row.durationsMs.length !== row.measuredTimings ||
      !row.durationsMs.every(natural) || !Array.isArray(row.returnedModels))) throw new TypeError(invalidShards);
  const durationsMs = rows.flatMap(row => row.durationsMs).sort((a, b) => a - b);
  const percentile = q => durationsMs[Math.ceil(durationsMs.length * q) - 1] ?? null;
  return {...totals, durationsMs, p50AttemptMs: percentile(0.50), p95AttemptMs: percentile(0.95),
    returnedModels: [...new Set(rows.flatMap(row => row.returnedModels))].sort(),
    failures: mergeCounts(rows.map(row => row.failures))};
}

/** Reassemble two exact, disjoint fixed-fixture reports without pooling percentages or replaying requests. */
export function combineNeutralReports(reports) {
  const {works: pins} = getNeutralProtocolReference();
  const allIds = pins.map(({id}) => id);
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const keys = ["arm", "verificationContext", "measurement", "model", "rubricVersion", "segmentationVersion"];
  if (!Array.isArray(reports) || reports.length !== 2 || reports.some(report => !report ||
      report.fixtureVersion !== fixtureVersion || report.fixtureDigest !== fixtureDigest || report.sourceProseIncluded !== false ||
      keys.some(key => !Object.hasOwn(report, key) || report[key] !== reports[0][key]) ||
      !Array.isArray(report.fixtureIds) || !report.fixtureIds.length || !Array.isArray(report.diagnostics) ||
      !equal(report.fixtureIds, report.diagnostics.map(({id}) => id)) ||
      report.fixtureRosterSha256 !== rosterDigest(report.diagnostics))) throw new TypeError(invalidShards);
  const workById = new Map(reports.flatMap(report => report.diagnostics).map(work => [work.id, work]));
  if (reports.flatMap(report => report.fixtureIds).length !== allIds.length || workById.size !== allIds.length ||
      pins.some(pin => {
        const work = workById.get(pin.id);
        return work?.sourceSha256 !== pin.sourceSha256 || !Array.isArray(work.units) || !equal(
          work.units.map(({id, unitSha256}) => ({id, unitSha256})), pin.units.map(({id, unitSha256}) => ({id, unitSha256})));
      })) throw new TypeError(invalidShards);
  const canonical = rows => allIds.map(id => rows.find(row => row.id === id));
  const diagnostics = canonical([...workById.values()]);
  const hasBehavior = reports.every(report => report.behaviorReferenceVersion === behaviorReferenceVersion &&
    report.behaviorReferenceDigest === behaviorReferenceDigest);
  if (!hasBehavior && reports.some(report => report.behavior || report.behaviorReferenceVersion || report.behaviorReferenceDigest) ||
      hasBehavior && pins.some((pin, i) => pin.units.some(({behavior}, j) => {
        const row = diagnostics[i].units[j];
        return !equal(row.expected?.behavior, behavior) || !behaviorStages.every(stage => cueKinds.every(kind =>
          row.behavior?.[stage]?.[kind] === null || typeof row.behavior?.[stage]?.[kind] === "boolean")) ||
          !equal(row.behavior.playbackGate, scoreNeutralPlaybackGate(behavior.playbackGate, row.compiler?.pattern));
      }))) throw new TypeError(invalidShards);
  const recoveryReports = reports.map(report => report.cueRecovery);
  const hasRecovery = reports.every(report => report.reader && report.cueRecovery);
  if (!hasRecovery && reports.some(report => report.reader || report.cueRecovery)) throw new TypeError(invalidShards);
  const stage = name => {
    const rows = reports.map(report => report[name]);
    const dimensions = stageDimensions[name];
    for (const [i, row] of rows.entries()) {
      const shardPins = pins.filter(pin => reports[i].fixtureIds.includes(pin.id));
      const expected = shardPins.flatMap(pin => pin.units);
      if (!row || !Array.isArray(row.works) || !equal(row.works.map(({id}) => id), reports[i].fixtureIds) ||
          row.targets !== expected.length || dimensions.includes("cue") &&
            row.exactCues?.matched + row.exactCues?.missed !== expected.filter(unit => unit.cue).length ||
          dimensions.includes("transition") &&
            row.exactTypedTransitions?.matched + row.exactTypedTransitions?.missed !== expected.filter(unit => unit.transition !== "none").length) {
        throw new TypeError(invalidShards);
      }
    }
    const totals = sumFields(rows, ["targets", "returnedTargets", "observedTargets",
      ...(dimensions.includes("cue") ? ["observedCueTargets"] : []),
      ...(dimensions.includes("transition") ? ["observedTypedTargets"] : [])]);
    return {...totals, coverage: ratio(totals.observedTargets, totals.targets),
      dispositions: mergeCounts(rows.map(row => row.dispositions)), works: canonical(rows.flatMap(row => row.works)),
      ...(dimensions.includes("cue") ? {exactCues: mergeBinary(rows.map(row => row.exactCues))} : {}),
      ...(dimensions.includes("narrativePhase") ? {phase: sumFields(rows.map(row => row.phase), ["exact", "observed"])} : {}),
      ...(dimensions.includes("transition") ? {
        exactTypedTransitions: mergeBinary(rows.map(row => row.exactTypedTransitions)),
        nearbyTypedTransitions: mergeBinary(rows.map(row => row.nearbyTypedTransitions)),
        boundary: {exact: mergeBinary(rows.map(row => row.boundary?.exact)), nearby: mergeBinary(rows.map(row => row.boundary?.nearby)),
          excludedNonBoundaryPredictions: mergeCounts(rows.map(row => row.boundary?.excludedNonBoundaryPredictions))},
      } : {}),
      ...(name === "applied" ? Object.fromEntries(["transitionOrigins", "cueChanges", "transitionChanges"]
        .map(key => [key, mergeCounts(rows.map(row => row[key]))])) : {}),
      ...(name === "reader" ? {cueChanges: readerCueChanges(diagnostics)} : {}),
      ...(rawStages.includes(name) ? {usage: mergeUsage(rows.map(row => row.usage)),
        targetDiagnostics: rawTargetReport(diagnostics, name)} : {})};
  };
  const [first] = reports;
  const planning = reports.map(report => report.planning);
  const budgets = reports.map(report => report.budget);
  return {...Object.fromEntries([...keys, "fixtureVersion", "fixtureDigest", "sourceProseIncluded", "independentCorpusBenchmark",
    "prefixPolicy", "cueDefinition", "appliedCueDefinition", "transitionDefinition", "boundaryDefinition",
    ...(hasRecovery ? ["readerCueDefinition"] : [])].map(key => [key, first[key]])),
    fixtureIds: allIds, fixtureRosterSha256: rosterDigest(diagnostics), referenceScope,
    ...(reports.every(report => natural(report.externalCalls)) ? sumFields(reports, ["externalCalls"]) : {}),
    planning: {...sumFields(planning, ["referenceTargets", "admittedTargets", "plannedTargets", "plannedDiscoveryWindows",
      "discoveryAttempts", "prefixAttempts", "transitionTargetLimit", "transitionAttempts",
      ...(hasRecovery ? ["cueCheckTargetLimit", "cueCheckAttempts"] : [])]),
    works: canonical(planning.flatMap(row => row.works))},
    budget: {...sumFields(budgets, ["capMicros", "attempts", "attemptedPayloadBytes", "reservedMicros", "chargedMicros", "unsettled"]),
      reservationBreach: budgets.some(row => row.reservationBreach)},
    shards: reports.map(report => ({fixtureIds: report.fixtureIds, fixtureRosterSha256: report.fixtureRosterSha256,
      providerStops: report.providerStops})),
    ...Object.fromEntries(Object.keys(stageDimensions).filter(name => name !== "reader" || hasRecovery)
      .map(name => [name, stage(name)])),
    ...(hasRecovery ? {cueRecovery: cueRecoveryReport(diagnostics, mergeUsage(recoveryReports.map(row => row.usage)))} : {}),
    ...(hasBehavior ? {behaviorReferenceVersion, behaviorReferenceDigest, behavior: behaviorReport(diagnostics)} : {}),
    diagnostics};
}

export async function runLunaProtocolNeutral({mode = "offline", arm = "windowed", provider, signal, now = Date.now,
  transitionLimit = 33, maxAttempts = 80, verifyTransitions = true, verificationContext = "attested", fixtureIds,
  maxCueChecks = 0} = {}) {
  if (!["offline", "mock", "live"].includes(mode) || !["windowed", "complete"].includes(arm) ||
      (provider !== undefined && (mode === "offline" || typeof provider !== "function")) ||
      (mode === "live" && !provider) || !natural(transitionLimit) || transitionLimit > 33 ||
      !natural(maxAttempts) || maxAttempts > 80 || typeof verifyTransitions !== "boolean" ||
      !natural(maxCueChecks) || maxCueChecks > 2 ||
      !["recent", "attested"].includes(verificationContext)) throw new TypeError(invalidOptions);
  const pinned = prepareFixtures(now());
  if (fixtureIds !== undefined && (!Array.isArray(fixtureIds) || !fixtureIds.length ||
      new Set(fixtureIds).size !== fixtureIds.length || fixtureIds.some(id => !pinned.some(fixture => fixture.id === id)))) {
    throw new TypeError(invalidOptions);
  }
  const fixtures = fixtureIds === undefined ? pinned : pinned.filter(fixture => fixtureIds.includes(fixture.id));
  const selectedSize = fixtures.reduce((sum, fixture) => sum + fixture.reference.units.length, 0);
  const transitionBudgets = transitionAllocation(fixtures, verifyTransitions ? Math.min(transitionLimit, selectedSize) : 0);
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
      verifyTransitions, maxTransitionVerification: transitionBudgets[index], verificationContext, maxCueChecks}));
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
    cueCheckTargetLimit: maxCueChecks,
    cueCheckAttempts: summary.attempts.filter(row => row.mode === "cue-check" && row.attempted).length,
  }));
  const totals = Object.fromEntries(Object.keys(planning[0]).filter(field => field !== "id")
    .map(field => [field, planning.reduce((sum, row) => sum + row[field], 0)]));
  const diagnostics = fixtures.map((fixture, i) => diagnosticWork(fixture, runs[i]));
  const appliedRows = diagnostics.flatMap(work => work.units).map(row => row.applied);
  const appliedCounts = field => Object.fromEntries(Object.entries(Object.groupBy(appliedRows, row => row[field]))
    .map(([value, rows]) => [value, rows.length]));
  return {fixtureVersion, fixtureDigest, fixtureIds: fixtures.map(({id}) => id), fixtureRosterSha256: rosterDigest(diagnostics),
    rubricVersion: runs[0].rubricVersion, segmentationVersion: runs[0].segmentationVersion,
    arm, verificationContext, measurement: {offline: "offline-planning", mock: provider ? "offline-injected-mock" : "offline-reference-mock",
      live: "live-neutral-provider"}[mode], model: mode === "live" ? LUNA_PROTOCOL_MODEL : null,
    independentCorpusBenchmark: false, sourceProseIncluded: false, referenceScope,
    ...(mode === "live" ? {} : {externalCalls: 0}),
    prefixPolicy: "Freeze all native cue targets before discovery. The transition-only stage has a separate target allowance.",
    cueDefinition: "An exact fixture unit with a non-quiet reference phase.",
    appliedCueDefinition: "Legacy direct cue after the merged gate, compared descriptively to non-quiet reference phases. The separate behavior scores use an explicit direct-enactment reference.",
    readerCueDefinition: "A supported direct cue, independent low cue, or scoped continuation after the merged gate, scored against the same fixture reference.",
    transitionDefinition: "An exact fixture unit and typed event. Nearby matching uses the same event type within one paragraph.",
    boundaryDefinition: {types: [...boundaryTransitions],
      excludes: "Onset, restart, accent, ease and recover remain in full typed scores and are excluded from boundary-only scores."},
    planning: {...totals, works: planning}, budget: budget.snapshot(), providerStops,
    ...Object.fromEntries(rawStages.map(stage => [stage,
      {...stageReport(reference, runs, stage), usage: attemptReport(runs, stage),
        targetDiagnostics: rawTargetReport(diagnostics, stage)}])),
    applied: {...stageReport(reference, runs, "applied"), transitionOrigins: appliedCounts("transitionOrigin"),
      cueChanges: appliedCounts("cueChange"), transitionChanges: appliedCounts("transitionChange")},
    reader: {...stageReport(reference, runs, "reader"), cueChanges: readerCueChanges(diagnostics)},
    cueRecovery: cueRecoveryReport(diagnostics, attemptReport(runs, "cueRecovery")),
    behaviorReferenceVersion, behaviorReferenceDigest, behavior: behaviorReport(diagnostics),
    diagnostics};
}
