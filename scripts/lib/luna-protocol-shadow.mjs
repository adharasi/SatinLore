import {planStory} from "../../app/static/reader/beat-continuity.mjs";
import {buildWholeStoryIndex, MAX_WHOLE_STORY_REQUESTS, planIndexedWholeStoryContext} from "./whole-story-context-planning.mjs";
import {executeWholeStoryContextPlan} from "./whole-story-context-execution.mjs";
import {createCausalAttestationLedger} from "./luna-causal-attestation.mjs";
import {applyFrameScope, applyLatchedDecline, applyRepeatedReturn, continuityDispute, continuationScope, crossesCurrentFrame,
  elapsedContinuityGap, exactCurrentCue, freshEnactedStart, isDeferredCurrentContext, mergeTransitionVerdict, possibleRestartClosure,
  projectTypedTransition, resolveContinuityDispute, restartCheckPending, startsAtSceneEntry, transitionPriority,
  verifiedContextCut, verifiedSceneEntry} from "./luna-transition-verification.mjs";
import {LUNA_PROTOCOL_ENUMS, LUNA_PROTOCOL_FAILURE_REASONS, LUNA_PROTOCOL_LIMITS, LUNA_PROTOCOL_RUBRIC_VERSION,
  LUNA_PROTOCOL_TARGET_FAILURES, LUNA_PROTOCOL_TARGET_NORMALIZATIONS, lunaProtocolCueViolation, lunaProtocolInputOverhead, lunaProtocolOutputTokens,
  lunaProtocolBoundaryOnlyViolation, lunaProtocolLocalActionEvidenceDetail, lunaProtocolLocalActionViolation, lunaProtocolSceneBoundaryViolation,
  lunaProtocolSceneEntryViolation, lunaProtocolSceneSituationViolation, lunaProtocolTransitionViolation,
  sanitizeLunaLocalActionEvidenceDetail, sanitizeLunaStatusEffectDetail}
  from "./luna-protocol-provider.mjs";

const clearance = "No blocking event recorded";
const transitionCuts = new Set(["scene-cut", "chapter-end", "memory-entry", "imagined-entry", "reported-entry", "present-return"]);
const closingTransitions = new Set(["beat-end", "declined-restart"]);
const quietTransitions = new Set(["declined-restart", "interruption", "non-romantic-activity-stop", "span-end"]);
const recoveryBarriers = new Set([...quietTransitions, ...transitionCuts, "hard-stop", "beat-end", "uncertain-continuity"]);
const recoveryBlockingFacts = new Set(["cut", "protective", "neutralize", "beat-end", "span-end"]);
const prefixOrder = {verify: 0, transition: 1, "cue-check": 2};
const editorialFrames = new Set(["current", "remembered", "imagined", "reported", "mixed"]);
const activePhases = new Set(["build", "onset", "rebuild", "sustain", "peak"]);
const activeActions = new Set(["anticipation", "contact", "continuation", "change", "release"]);
const directActions = new Set(["contact", "change"]);
const enactedActions = new Set([...directActions, "continuation"]);
const usable = new Set(["candidate", "verified", "neutral"]);
const direct = new Set(["explicit", "graphic"]);
const overt = new Set(["overt-sexual", ...direct]);
const romanticDepictions = new Set(["romantic", "suggestive", ...overt]);
const fields = [...Object.keys(LUNA_PROTOCOL_ENUMS), "unitId", "scopeId", "evidenceIds", "priorAnchor"];
const int = n => Number.isSafeInteger(n) && n >= 0;
const words = text => text.match(/[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu)?.length ?? 0;
const reviewable = fact => fact.fact !== "none" || !["none", "unknown"].includes(fact.transition) ||
  activePhases.has(fact.narrativePhase) || ["ease", "recover"].includes(fact.narrativePhase) || activeActions.has(fact.action);
const inputFor = window => JSON.parse(window.body);
const anchorLinks = new Set(["continue", "ease", "span-end", "beat-end"]);
const repairableCueContracts = new Set(["status-effect", "phase-action", "transition-fact", "transition-action", "fact-phase", "fact-action"]);
const cueCheckFocus = {"opening-buildup": "buildup", "romantic-context": "buildup", "adjacent-start": "enactment",
  "restart-state": "restart-gate", "typed-start": "enactment", "continuity-boundary": "continuity-boundary",
  "primary-anchor-repair": "anchor-repair", "same-episode-boundary": "episode-boundary",
  "continuation-repair": "continuation-repair", "interruption-release": "interruption-release",
  "sustain-connector": "episode-boundary"};
const startTransitions = new Set(["onset", "restart"]);
const diagnosticLanes = {
  "scene-boundary": {verdictKey: "boundaryVerification", statusKey: "boundaryVerificationStatus", factKey: "sceneBoundary"},
  "local-action": {verdictKey: "localActionVerification", statusKey: "localActionVerificationStatus", factKey: "localAction"},
  "scene-entry": {verdictKey: "sceneEntryVerification", statusKey: "sceneEntryVerificationStatus", factKey: "sceneEntry"},
  "scene-situation": {verdictKey: "sceneSituationVerification", statusKey: "sceneSituationVerificationStatus", factKey: "sceneSituation"},
};
export const MAX_SHADOW_MICROS = 3_000_000;
export const MAX_SHADOW_VERIFICATIONS = 384;
export const MAX_LOCAL_ACTION_DIAGNOSTIC_TARGETS = 24;
const MAX_SCENE_ENTRY_DIAGNOSTIC_TARGETS = 24;

function currentCueAt(fact, id, status) {
  return fact?.status === status && fact.frame === "current" && activePhases.has(fact.narrativePhase) &&
    fact.evidenceIds.includes(id) && fact.evidenceIds.every(evidence => evidence <= id) &&
    !recoveryBarriers.has(fact.transition) && !recoveryBlockingFacts.has(fact.fact);
}

function recentRomanticContext(decisions, blocked, target, runId) {
  const support = [];
  for (let id = target - 1; id >= Math.max(runId, target - 3); id--) {
    const row = decisions.get(id);
    const cue = row?.prefixVerified ? row.annotation : null;
    const effect = row?.effectiveAnnotation ?? cue;
    if (blocked.has(id) || row?.window?.runId !== runId || cue?.frame !== "current" ||
        recoveryBarriers.has(effect.transition) || recoveryBlockingFacts.has(effect.fact)) break;
    if (["verified", "neutral"].includes(cue.status) && romanticDepictions.has(cue.depiction)) support.push(id);
  }
  return support;
}

function exactTypedStart(fact, id) {
  return fact?.status === "verified" && fact.frame === "current" && startTransitions.has(fact.transition) &&
    fact.evidenceIds.includes(id);
}

const quietNegative = fact => fact?.status === "neutral" && fact.frame === "current" &&
  fact.narrativePhase === "quiet" && fact.action === "none" && fact.transition === "none" && fact.fact === "none" &&
  fact.scopeId === null && fact.priorAnchor === null;
const strictQuietNegative = fact => quietNegative(fact) && fact.evidenceIds.length === 0;

function typedQuietWithoutBoundary(typed) {
  return typed?.status === "neutral" && typed.frame === "current" && typed.transition === "none" && typed.fact === "none" &&
    typed.scopeId === null && typed.priorAnchor === null && typed.evidenceIds.length === 0 && typed.sceneBoundary?.status === "none";
}

function continuationRepairCandidate(row, id, index, decisions, blocked, supportingIds) {
  const {primaryPrefix: primary, effectiveAnnotation: effect, discovery, localActionVerification, sceneEntryVerification} = row;
  const local = localActionVerification?.localAction;
  const entry = sceneEntryVerification?.sceneEntry;
  const priorId = local?.contextId;
  if (priorId == null || id - priorId < 1 || id - priorId > 2 || !row.prefixVerified || supportingIds.has(id) ||
      row.transitionFlag !== "scene-boundary-unconfirmed" || effect?.frame !== "current" || effect.transition !== "none" ||
      effect.fact !== "none" ||
      !typedQuietWithoutBoundary(row.transitionVerification) || entry?.status !== "none" || entry.reason !== "same-episode" ||
      local.status !== "verified" || local.frame !== "current" || local.action !== "continuation" || local.phase !== "sustain" ||
      local.contrast !== "same-action" || local.targetId !== id ||
      primary?.status !== "verified" || primary.frame !== "current" || primary.transition !== "scene-cut" || primary.fact !== "cut" ||
      primary.action !== "none" || primary.narrativePhase !== "quiet" || primary.priorAnchor !== null ||
      !primary.evidenceIds.includes(priorId) || !primary.evidenceIds.includes(id) ||
      discovery?.status !== "candidate" || discovery.frame !== "current" || discovery.action !== "continuation" ||
      discovery.narrativePhase !== "sustain" || discovery.transition !== "none" || discovery.fact !== "continue" ||
      discovery.priorAnchor !== priorId || discovery.evidenceIds.length !== 2 || discovery.evidenceIds[0] !== priorId ||
      discovery.evidenceIds[1] !== id || !romanticDepictions.has(discovery.depiction)) return null;
  const previous = decisions.get(priorId), anchor = previous?.prefixVerified ? previous.annotation : null;
  const previousEffect = previous?.effectiveAnnotation;
  const proposed = previous?.discovery;
  if (!row.window || previous?.window?.runId !== row.window.runId || !freshEnactedStart(anchor, priorId) ||
      anchor.narrativePhase !== "onset" || anchor.transition !== "onset" || anchor.fact !== "none" ||
      anchor.scopeId == null || anchor.scopeId > priorId || anchor.scopeId !== primary.scopeId ||
      ![anchor.scopeId, priorId].includes(discovery.scopeId) || proposed?.status !== "candidate" ||
      proposed.frame !== "current" || proposed.action !== anchor.action || proposed.narrativePhase !== "onset" ||
      proposed.transition !== "onset" || proposed.fact !== "none" || !proposed.evidenceIds.includes(priorId) ||
      previousEffect?.frame !== "current" || previousEffect.transition !== "onset" || previousEffect.fact !== "none") return null;
  for (let candidateId = priorId; candidateId <= id; candidateId++) {
    const unit = index.units[candidateId];
    if (blocked.has(candidateId) || unit.structuralBoundary) return null;
    if (candidateId !== priorId && candidateId !== id) {
      const connector = decisions.get(candidateId);
      if (connector?.window?.runId !== row.window.runId || words(unit.text) > 16 ||
          !strictQuietNegative(connector.effectiveAnnotation ?? connector.annotation ?? connector.discovery)) return null;
    }
  }
  return {priorId, scope: anchor.scopeId};
}

function verifiedContinuationRepair(verdict, candidate, id) {
  return exactCurrentCue(verdict, id) && verdict.action === "continuation" && verdict.narrativePhase === "sustain" &&
    verdict.transition === "none" && verdict.fact === "continue" && romanticDepictions.has(verdict.depiction) &&
    verdict.priorAnchor === candidate.priorId && [candidate.scope, candidate.priorId].includes(verdict.scopeId) &&
    verdict.evidenceIds.length === 2 && verdict.evidenceIds[0] === candidate.priorId && verdict.evidenceIds[1] === id;
}

function interruptionReleaseCandidate(row, previous, id) {
  const priorId = id - 1;
  const prior = previous?.interruptionContinuationCue ?? (previous?.prefixVerified ? previous.annotation : null);
  const priorEffect = previous?.interruptionContinuationCue ?? previous?.effectiveAnnotation;
  const typed = row.transitionVerification;
  const focused = row.cueRecovery;
  const boundary = typed?.sceneBoundary;
  const entry = row.sceneEntryVerification?.sceneEntry;
  const local = row.localActionVerification?.localAction;
  if (row.window && row.window.runId === previous?.window?.runId && entry?.status === "none" &&
      entry.reason === "ordinary-interruption" && strictQuietNegative(row.primaryPrefix) &&
      strictQuietNegative(row.effectiveAnnotation) && typedQuietWithoutBoundary(typed) &&
      (!local || local.status === "none" && ["current", "noncurrent"].includes(local.frame) && local.action === "none") &&
      exactCurrentCue(prior, priorId) && prior.scopeId != null && ["onset", "rebuild", "sustain", "peak"].includes(prior.narrativePhase) &&
      enactedActions.has(prior.action) && ["none", "continue"].includes(prior.fact) && !recoveryBarriers.has(prior.transition) &&
      priorEffect?.frame === "current" && !recoveryBarriers.has(priorEffect.transition) && !recoveryBlockingFacts.has(priorEffect.fact)) {
    return {priorId, oldScope: prior.scopeId, priorScope: prior.scopeId};
  }
  const sameScope = prior?.scopeId === focused?.scopeId || row.continuityDispute?.anchors.some(anchor =>
    anchor.scopeId === focused?.scopeId && anchor.unitId < priorId && prior?.evidenceIds.includes(anchor.unitId));
  return row.window && row.window.runId === previous?.window?.runId && sameScope &&
    row.cueRecoveryCorrection === "continuity-old-scope-veto" && row.transitionFlag === "scene-boundary-old-scope" &&
    strictQuietNegative(row.primaryPrefix) && strictQuietNegative(row.effectiveAnnotation) &&
    typed?.status === "neutral" && typed.frame === "current" && typed.transition === "none" && typed.fact === "none" &&
    boundary?.status === "cut" && boundary.reason === "objective-shift" && boundary.previousId === priorId && boundary.entryId === id &&
    focused?.frame === "current" && focused.scopeId <= priorId && focused.evidenceIds.length === 2 &&
    focused.evidenceIds[0] === priorId && focused.evidenceIds[1] === id &&
    entry?.status === "none" && entry.reason === "ordinary-interruption" &&
    (!local || local.status === "none" && local.frame === "current" && local.action === "none") &&
    exactCurrentCue(prior, priorId) && ["onset", "rebuild", "sustain", "peak"].includes(prior.narrativePhase) &&
    enactedActions.has(prior.action) && ["none", "continue"].includes(prior.fact) && !recoveryBarriers.has(prior.transition) &&
    priorEffect?.frame === "current" && !recoveryBarriers.has(priorEffect.transition) && !recoveryBlockingFacts.has(priorEffect.fact) ?
    {priorId, oldScope: focused.scopeId, priorScope: prior.scopeId} : null;
}

function verifiedInterruptionRelease(verdict, candidate, id) {
  return candidate && exactCurrentCue(verdict, id) && verdict.transition === "interruption" && verdict.fact === "ease" &&
    verdict.narrativePhase === "ease" && ["release", "none"].includes(verdict.action) &&
    verdict.priorAnchor === candidate.priorId && verdict.evidenceIds.length === 2 && verdict.evidenceIds[0] === candidate.priorId &&
    verdict.evidenceIds[1] === id && verdict.scopeId != null &&
    [candidate.priorId, candidate.oldScope, candidate.priorScope].includes(verdict.scopeId);
}

const sameEpisodeReasons = new Set(["viewpoint-only", "same-episode", "ordinary-interruption", "routine-movement", "elapsed-continuation"]);
const materialEntryReasons = {"material-time": "time-jump", "material-setting": "setting-shift", "material-objective": "objective-shift"};

function sameEpisodeCutCandidate(row, id, causal) {
  const {primaryPrefix: primary, transitionVerification: typed, discovery} = row;
  const cut = typed?.sceneBoundary;
  const quietCut = row.effectiveAnnotation?.transition === "scene-cut" && row.transitionFlag !== "scene-boundary-stale" &&
    primary?.status === "verified" && primary.frame === "current" && primary.narrativePhase === "quiet" &&
    primary.action === "none" && primary.transition === "scene-cut" && primary.fact === "cut" && primary.priorAnchor === null &&
    typed?.status === "neutral" && typed.frame === "current" && typed.transition === "none" && typed.fact === "none" &&
    typed.scopeId === null && typed.priorAnchor === null && typed.evidenceIds.length === 0 &&
    cut?.status === "cut" && ["setting-shift", "objective-shift"].includes(cut.reason) && cut.entryId === id &&
    cut.previousId >= row.previousSceneBoundaryId && primary.evidenceIds.includes(cut.previousId) && primary.evidenceIds.includes(id);
  if (!quietCut) return false;
  if (quietNegative(discovery) && discovery.evidenceIds.every(evidence => evidence === id)) return true;
  // A discovery cut can be a correlated reading of a viewpoint change. Reopen
  // this exact setting dispute only with an already verified episode.
  if (!causal || cut.reason !== "setting-shift" || cut.previousId !== id - 1 ||
      primary.depiction !== "neutral" || primary.scopeId !== id || discovery?.status !== "candidate" ||
      discovery.frame !== "current" || discovery.depiction !== "neutral" || discovery.narrativePhase !== "quiet" ||
      discovery.action !== "none" || discovery.transition !== "scene-cut" || discovery.fact !== "cut" ||
      discovery.scopeId !== id || discovery.priorAnchor !== null || discovery.evidenceIds.length !== 2 ||
      discovery.evidenceIds[0] !== cut.previousId || discovery.evidenceIds[1] !== id) return false;
  const previous = causal.localAnchors.find(anchor => anchor.unitId === cut.previousId);
  return previous && !causal.protectedScopes.has(previous.scopeId) && causal.localAnchors.some(anchor =>
    anchor.unitId < previous.unitId && anchor.scopeId === previous.scopeId);
}

function sameEpisodeNoCut(entry) {
  return entry?.status === "none" && sameEpisodeReasons.has(entry.reason);
}

function disputedSettingEntry(row, id) {
  const typed = row.transitionVerification;
  const cut = typed?.sceneBoundary;
  return row.cueRecoveryCorrection === "continuity-cut-veto" && row.transitionFlag === "transition-conflict" &&
    strictQuietNegative(row.discovery) && strictQuietNegative(row.primaryPrefix) && strictQuietNegative(row.cueRecovery) &&
    typed?.frame === "current" && typed.fact === "none" && typed.scopeId === null && typed.priorAnchor === null &&
    (typed.status === "neutral" && typed.transition === "none" ||
      typed.status === "verified" && typed.transition === "non-romantic-activity-stop" &&
      typed.evidenceIds.length === 1 && typed.evidenceIds[0] === id) &&
    cut?.status === "cut" && cut.reason === "setting-shift" && cut.entryId === id &&
    cut.previousId >= row.previousSceneBoundaryId;
}

function independentEntryCandidate(row, id) {
  const {primaryPrefix: primary, transitionVerification: typed, effectiveAnnotation: effect, discovery} = row;
  const localAccent = fact => exactCurrentCue(fact, id) && fact.transition === "accent" &&
    fact.fact === "none" && fact.priorAnchor === null;
  const typedNeutral = typed?.status === "neutral" && typed.frame === "current" && typed.transition === "none" &&
    typed.fact === "none" && typed.scopeId === null && typed.priorAnchor === null && typed.evidenceIds.length === 0;
  const exactTypedOnset = exactCurrentCue(typed, id) && typed.transition === "onset" && typed.fact === "none" &&
    typed.priorAnchor === null && (typed.scopeId === null || typed.scopeId === id) && typed.evidenceIds.length === 1;
  const discoveryLocal = discovery?.frame === "current" && discovery.fact === "none" &&
    ["none", "onset", "accent"].includes(discovery.transition);
  // Discovery nominates an opportunity. Its earlier coordinate supplies no
  // boundary authority and may differ from the two independent readings.
  const discoveryCut = discovery?.status === "candidate" && discovery.frame === "current" &&
    discovery.depiction === "neutral" && discovery.narrativePhase === "quiet" && discovery.action === "none" &&
    discovery.transition === "scene-cut" && discovery.fact === "cut" && discovery.scopeId === id &&
    discovery.priorAnchor === null && discovery.evidenceIds.length === 2 &&
    discovery.evidenceIds[0] < id && discovery.evidenceIds[1] === id;
  return row.prefixVerified && row.annotation === primary && !row.cueRecoveryCorrection &&
    (!row.cueRecovery || quietNegative(row.cueRecovery)) &&
    effect?.frame === "current" && ["none", "accent"].includes(effect.transition) && effect.fact === "none" &&
    ["none", "uncertain"].includes(typed?.sceneBoundary?.status) &&
    (discoveryLocal && (quietNegative(primary) && typedNeutral || localAccent(primary) && (localAccent(typed) || exactTypedOnset)) ||
      discoveryCut && strictQuietNegative(primary) && typedNeutral);
}

function agreesOnMaterialEntry(entry, boundary, id) {
  return entry?.status === "cut" && entry.entryId === id && entry.changeId === id && Object.hasOwn(materialEntryReasons, entry.reason) &&
    boundary?.status === "cut" && boundary.contrast === "material-change" && boundary.reason === materialEntryReasons[entry.reason] &&
    boundary.previousId === entry.previousId && boundary.changeId === id && boundary.entryId === id;
}

function hasViewpointConflict(row, id) {
  const entry = row.sceneEntryVerification?.sceneEntry;
  const action = row.localActionVerification?.localAction;
  return sameEpisodeCutCandidate(row, id) && row.transitionVerification.sceneBoundary.reason === "setting-shift" &&
    entry?.status === "none" && entry.reason === "viewpoint-only" && action?.status === "none" && action.frame === "noncurrent";
}

function quietSettingBoundary(row, id) {
  const effect = row.effectiveAnnotation;
  if (effect?.transition !== "scene-cut" || effect.fact !== "cut" || !exactCurrentCue(effect, id) ||
      !["quiet", "unknown"].includes(effect.narrativePhase) || !["none", "unknown"].includes(effect.action)) return null;
  const boundary = row.sceneEntryArbitration === "independently-confirmed-cut" ? row.boundaryVerification?.sceneBoundary :
    row.transitionVerification?.sceneBoundary;
  return boundary?.status === "cut" && boundary.reason === "setting-shift" && boundary.entryId === id &&
    effect.evidenceIds.includes(boundary.previousId) ? boundary : null;
}

function followsDisputedStart(decisions, blocked, id, runId, primary, typed) {
  const prior = decisions.get(id - 1);
  if (!freshEnactedStart(primary, id) || blocked.has(id - 1) || prior?.window?.runId !== runId) return false;
  const earlier = prior.annotation;
  const earlierTyped = prior.transitionVerification;
  const earlierVerified = prior.prefixVerified && freshEnactedStart(earlier, id - 1);
  if (exactTypedStart(typed, id)) return typed.transition === "onset" && earlierVerified;
  if (earlierVerified) return true;
  const priorScope = earlier?.scopeId ?? earlierTyped?.scopeId;
  return (primary.scopeId == null || priorScope == null || primary.scopeId === priorScope || primary.evidenceIds.includes(id - 1)) &&
    exactTypedStart(earlierTyped, id - 1);
}

function factViolation(fact, ids, target, mode, attested, requireSceneBoundary) {
  if (mode === "scene-boundary") return lunaProtocolBoundaryOnlyViolation(fact, target, id => ids.has(id));
  if (mode === "local-action") return lunaProtocolLocalActionViolation(fact, target, id => ids.has(id));
  if (mode === "scene-entry") return lunaProtocolSceneEntryViolation(fact, target, id => ids.has(id));
  if (mode === "scene-situation") return lunaProtocolSceneSituationViolation(fact, target, id => ids.has(id));
  const verify = mode !== "discovery";
  const anchors = new Map(attested.map(row => [row.unitId, row]));
  const scopeAllowed = id => id === null || id <= target &&
    (ids.has(id) || attested.some(row => row.scopeId === id && row.frame === fact.frame));
  const hasSceneBoundary = mode === "transition" && Object.hasOwn(fact, "sceneBoundary");
  if (Object.keys(fact).length !== fields.length + Number(hasSceneBoundary) || !fields.every(field => Object.hasOwn(fact, field)) ||
      fact.unitId !== target || !Object.entries(LUNA_PROTOCOL_ENUMS).every(([key, values]) => values.includes(fact[key]))) return "row-shape";
  if (!scopeAllowed(fact.scopeId)) return "scope-id";
  if (!Array.isArray(fact.evidenceIds) || fact.evidenceIds.length > LUNA_PROTOCOL_LIMITS.maxEvidenceIds ||
      !fact.evidenceIds.every((id, i, all) => (ids.has(id) || anchors.has(id)) && (!i || id > all[i - 1]))) return "evidence-id";
  if (fact.priorAnchor !== null && (fact.priorAnchor >= target || !fact.evidenceIds.includes(fact.priorAnchor))) return "prior-anchor";
  for (const id of fact.evidenceIds) {
    if (ids.has(id)) continue;
    const anchor = anchors.get(id);
    if (!verify || !anchorLinks.has(fact.fact) || fact.priorAnchor !== id || !fact.evidenceIds.includes(target) ||
        anchor.scopeId !== fact.scopeId || anchor.frame !== fact.frame) return "attested-evidence";
  }
  if (mode === "transition") {
    if (["low", "continue"].includes(fact.fact) || fact.action !== "unknown" || fact.narrativePhase !== "unknown" ||
        fact.depiction !== "unknown") return "transition-shape";
    return lunaProtocolTransitionViolation(fact) ?? (requireSceneBoundary || hasSceneBoundary ?
      lunaProtocolSceneBoundaryViolation(fact, id => ids.has(id)) : null);
  }
  return lunaProtocolCueViolation(fact, mode);
}

const requestPrice = (input, output) => Math.ceil((input * (input > 272_000 ? 0.25 : 0.125) +
  output * (input > 272_000 ? 0.75 : 0.50)) * 1.10);

function requestQuote(body, targets) {
  const sourceBytes = Buffer.byteLength(body);
  return {sourceBytes, reservedMicros: requestPrice(sourceBytes + lunaProtocolInputOverhead, lunaProtocolOutputTokens(targets))};
}

export function createLunaShadowBudget({maxAttempts = 96, maxSourceBytes = 500_000, maxMicros = 100_000} = {}) {
  if (![maxAttempts, maxSourceBytes, maxMicros].every(int) || maxAttempts > 2000 || maxMicros > MAX_SHADOW_MICROS) {
    throw new RangeError("Invalid shadow budget.");
  }
  let attempts = 0, sourceBytes = 0, reservedMicros = 0, chargedMicros = 0, unsettled = 0;
  let breached = false, spendLimited = false;
  function reserve(body, targets, retained = null) {
    // Bound the short-context input by UTF-8 bytes plus a fixed prompt/schema allowance.
    const {sourceBytes: bytes, reservedMicros: reserve} = requestQuote(body, targets);
    const proposedMicros = chargedMicros + reservedMicros + reserve + (retained?.reservedMicros ?? 0);
    if (breached || proposedMicros > maxMicros) {
      if (!retained) spendLimited = true;
      return null;
    }
    if (attempts + 1 + (retained?.attempts ?? 0) > maxAttempts ||
        sourceBytes + bytes + (retained?.sourceBytes ?? 0) > maxSourceBytes) return null;
    attempts++;
    sourceBytes += bytes;
    reservedMicros += reserve;
    unsettled++;
    let settled = false;
    return usage => {
      if (settled || !int(usage?.inputTokens) || !int(usage?.outputTokens)) return;
      settled = true;
      const actual = requestPrice(usage.inputTokens, usage.outputTokens);
      if (actual > reserve) breached = true;
      reservedMicros -= reserve;
      chargedMicros += actual;
      unsettled--;
    };
  }
  return {
    reserve: (body, targets) => reserve(body, targets),
    reserveSupporting: (body, targets, retained) => reserve(body, targets, retained),
    snapshot: () => ({capMicros: maxMicros, attempts, attemptedPayloadBytes: sourceBytes, reservedMicros, chargedMicros,
      unsettled, reservationBreach: breached, spendLimited}),
  };
}

function prefixJob(window, unitId, index, limit, mode = "verify") {
  const units = index.units.slice(Math.max(window.runId, unitId - limit + 1), unitId + 1)
    .map(({id, text}) => ({id, text}));
  const targetIds = [unitId];
  let body = JSON.stringify({units, targetIds});
  while (units.length > 1 && Buffer.byteLength(body) > LUNA_PROTOCOL_LIMITS.maxSourceBytes) {
    units.shift();
    body = JSON.stringify({units, targetIds});
  }
  const contextIds = units.slice(0, -1).map(({id}) => id);
  return {id: `${mode}:${unitId}`, runId: window.runId, targetIds, contextIds, body};
}

function pinnedPrefixQuote(window, verificationContext) {
  const {units, targetIds} = inputFor(window);
  const mode = window.id.split(":", 1)[0];
  const previousUnits = units[0].id - window.runId;
  const anchorLimit = verificationContext === "attested" ? Math.min(previousUnits, LUNA_PROTOCOL_LIMITS.maxAttested) : 0;
  // Use upper-length fields for the later attestations whose exact values are still unknown.
  const upperAnchor = {unitId: targetIds[0], scopeId: targetIds[0], frame: "remembered", action: "anticipation", narrativePhase: "rebuild"};
  const attested = anchorLimit > 0 ? Array(anchorLimit).fill(upperAnchor) : [];
  return requestQuote(JSON.stringify({mode, units, targetIds, ...(attested.length ? {attested} : {})}), targetIds.length);
}

function supportingPrefixJobs(pinned, scheduled, index, decisions, proposals, blocked, prefixUnits, limit) {
  const candidates = new Map();
  for (const target of pinned) {
    const id = target.targetIds[0], proposed = proposals.get(id)?.fact;
    for (let i = target.contextIds.length - 1; i >= 0; i--) {
      const prior = target.contextIds[i];
      if (blocked.has(prior)) break;
      if (scheduled.has(prior)) continue;
      const row = decisions.get(prior), fact = proposals.get(prior)?.fact;
      if (row?.window?.runId !== target.runId) continue;
      const cited = fact?.status === "candidate" && fact.evidenceIds.includes(prior);
      const closure = possibleRestartClosure(index.units[prior], fact) || cited && transitionCuts.has(fact.transition);
      const referenced = proposed?.status === "candidate" && proposed.evidenceIds.includes(id) &&
        (proposed.priorAnchor === prior || proposed.action === "continuation" && proposed.scopeId === prior);
      const cue = cited && fact.frame === "current" && reviewable(fact) && fact.fact !== "continue";
      const rank = closure ? 3 : referenced ? 2 : cue ? 1 : 0;
      if (!rank) continue;
      const distance = id - prior, existing = candidates.get(prior);
      if (!existing || rank > existing.rank || rank === existing.rank && distance < existing.distance) {
        candidates.set(prior, {rank, distance, window: row.window});
      }
    }
  }
  return [...candidates].sort((a, b) => b[1].rank - a[1].rank || a[1].distance - b[1].distance || a[0] - b[0])
    .slice(0, limit).map(([id, {window}]) => prefixJob(window, id, index, prefixUnits));
}

function pickVerification(priority, important, routine, controls, limit) {
  const picked = [...priority.slice(0, limit)];
  // Hold out a small independent control sample even when long active runs
  // would otherwise consume the entire verification allowance.
  const remaining = limit - picked.length;
  const controlCount = Math.min(controls.length, Math.floor(remaining / 10));
  picked.push(...important.slice(0, remaining - controlCount));
  const slots = remaining - controlCount - (picked.length - Math.min(priority.length, limit));
  const count = Math.min(routine.length, slots);
  for (let i = 0; i < count; i++) picked.push(routine[Math.floor(i * routine.length / count)]);
  picked.push(...controls.slice(0, limit - picked.length));
  return picked.sort((a, b) => a.targetIds[0] - b.targetIds[0]);
}

function profileFor(fact, recent, last) {
  const phase = fact.narrativePhase;
  const directCount = recent.filter(label => direct.has(label)).length;
  const dense = directCount >= 2 && directCount * 3 >= recent.length;
  if (phase === "peak") return "Crest";
  if (phase === "recover") return "Recovery";
  if (phase === "ease") return "Taper";
  if (fact.transition === "restart" || phase === "rebuild") return "Rebuild rise";
  if (phase === "onset") return "Onset rise";
  if (phase === "sustain") {
    if (dense && fact.transition === "accent" && ["Deep sustain", "Crest approach"].includes(last)) return "Crest approach";
    return dense ? "Deep sustain" : "Sustain wave";
  }
  if (phase === "build") return dense || recent.filter(label => overt.has(label)).length >= 3 ||
    recent.filter(label => label === "suggestive").length >= 4 ? "Deepening build" : "Gradual build";
  return ["romantic", "suggestive", "overt-sexual"].includes(fact.depiction) && fact.action === "anticipation" ?
    "Undertone" : "Baseline";
}

function localDirectAction(row, id) {
  const local = row?.localActionVerification?.localAction;
  return local?.status === "verified" && local.frame === "current" && local.targetId === id &&
    local.contrast === "enacted" && directActions.has(local.action) ? local : null;
}

function corroboratesLocalInterruptionTaper(row, previous, id) {
  const {primaryPrefix: primary, transitionVerification: typed, localActionVerification, sceneEntryVerification} = row;
  const local = localActionVerification?.localAction;
  const entry = sceneEntryVerification?.sceneEntry;
  const prior = id - 1;
  const exactInterruption = fact => exactCurrentCue(fact, id) && fact.transition === "interruption" && fact.priorAnchor === null;
  if (!exactInterruption(primary) || primary.fact !== "beat-end" || primary.action !== "release" || primary.narrativePhase !== "ease" ||
      !exactInterruption(typed) || typed.fact !== "none" || typed.sceneBoundary?.status !== "none" ||
      local?.status !== "verified" || local.frame !== "current" || local.action !== "release" ||
      local.phase !== "ease" || local.contrast !== "softening" || local.targetId !== id || local.contextId !== null ||
      entry?.status !== "none" || entry.reason !== "ordinary-interruption") return false;
  // Both earlier readings support the adjacent context. This is enough to
  // taper the separately verified release at the target, with no carry.
  const support = previous?.prefixVerified ? previous.effectiveAnnotation : null;
  const buildup = fact => fact?.frame === "current" && romanticDepictions.has(fact.depiction) &&
    fact.action === "anticipation" && fact.narrativePhase === "build" && fact.transition === "none" &&
    fact.fact === "low" && fact.priorAnchor === null && fact.evidenceIds.length === 1 && fact.evidenceIds[0] === prior;
  if (previous?.window?.runId !== row.window?.runId || support?.status !== "verified" ||
      previous.discovery?.status !== "candidate" || !buildup(support) || !buildup(previous.discovery)) return false;

  const exactPair = fact => fact.evidenceIds.length === 2 && fact.evidenceIds[0] === prior;
  if (exactPair(primary) && exactPair(typed)) return true;

  // Separately verified adjacent facts in the same scope can support a local
  // release without claiming the earlier unit was cited by the interruption.
  const proposal = row.discovery;
  const targetOnly = fact => fact.evidenceIds.length === 1 && fact.evidenceIds[0] === id;
  return targetOnly(primary) && targetOnly(typed) && primary.scopeId != null && primary.scopeId === support.scopeId &&
    typed.scopeId === null && proposal?.status === "candidate" && proposal.frame === "current" &&
    proposal.action === "release" && proposal.narrativePhase === "ease" && proposal.transition === "beat-end" &&
    proposal.fact === "beat-end" && proposal.priorAnchor === null && targetOnly(proposal) &&
    (proposal.scopeId === null || proposal.scopeId === primary.scopeId);
}

function corroboratesIndependentCutCue(row, cue, typed, id) {
  const local = localDirectAction(row, id);
  const proposal = row.discovery;
  // Only the isolated local reading can put the action on the cut itself.
  // Prefix and typed cues agree on the accent but may cite the scene it ends.
  return local?.phase === "onset" && local.contextId === null && cue === row.primaryPrefix &&
    row.cueRecovery?.status !== "neutral" && exactCurrentCue(cue, id) &&
    cue.action === local.action && cue.narrativePhase === "sustain" && cue.transition === "accent" && cue.fact === "none" &&
    proposal?.status === "candidate" && proposal.frame === "current" && directActions.has(proposal.action) &&
    proposal.narrativePhase === "onset" && proposal.transition === "onset" && proposal.fact === "none" &&
    proposal.priorAnchor === null && proposal.evidenceIds.length === 1 && proposal.evidenceIds[0] === id &&
    exactCurrentCue(typed, id) && typed.transition === "accent" && typed.fact === "none";
}

function corroboratesSceneEntry(row, cue, typed, id) {
  const local = localDirectAction(row, id);
  const proposal = row.discovery;
  const previousSceneId = typed?.sceneBoundary?.previousId;
  // The old scope can be cited by the combined primary reading. The other
  // three roles must isolate the new action at the entry itself.
  return local?.phase === "onset" && local.contextId === null && cue === row.primaryPrefix && row.cueRecovery?.status !== "neutral" &&
    freshEnactedStart(cue, id) && cue.narrativePhase === "onset" && cue.transition === "onset" && cue.fact === "none" &&
    cue.scopeId != null && cue.scopeId <= previousSceneId && cue.priorAnchor === null &&
    cue.evidenceIds.length === 2 && cue.evidenceIds[0] === cue.scopeId &&
    proposal?.status === "candidate" && proposal.frame === "current" && proposal.action === cue.action &&
    proposal.narrativePhase === "onset" && proposal.transition === "onset" && proposal.fact === "none" &&
    proposal.scopeId === id && proposal.priorAnchor === null && proposal.evidenceIds.length === 1 && proposal.evidenceIds[0] === id &&
    exactCurrentCue(typed, id) && typed.transition === "onset" && typed.fact === "none" && typed.priorAnchor === null &&
    (typed.scopeId === null || typed.scopeId === id) && typed.evidenceIds.length === 1;
}

function corroboratesLinkedAccentCue(row, cue, typed, id, prior) {
  const local = localDirectAction(row, id);
  const proposal = row.discovery;
  // The linked beat still governs playback. Report exact local contact or
  // change only when independent observations identify this same accent.
  return cue === row.primaryPrefix && cue.action === "continuation" && cue.narrativePhase === "sustain" &&
    cue.transition === "none" && cue.evidenceIds.length === 2 && cue.evidenceIds[0] === prior &&
    row.cueRecovery?.status !== "neutral" && local?.phase === "sustain" && local.contextId === prior &&
    proposal?.status === "candidate" && proposal.frame === "current" && proposal.scopeId === cue.scopeId &&
    proposal.action === local.action && proposal.narrativePhase === "sustain" && proposal.transition === "accent" &&
    proposal.fact === "none" && proposal.priorAnchor === null && proposal.evidenceIds.length === 2 &&
    proposal.evidenceIds[0] === prior && proposal.evidenceIds[1] === id &&
    typed?.status === "verified" && typed.frame === "current" && typed.transition === "accent" && typed.fact === "none" &&
    typed.scopeId === null && typed.priorAnchor === null && typed.evidenceIds.length === 2 &&
    typed.evidenceIds[0] === prior && typed.evidenceIds[1] === id && typed.sceneBoundary?.status === "none";
}

function corroboratesRecoveryCue(row, cue, typed, id) {
  const local = localDirectAction(row, id);
  return local?.phase === "recover" && local.action === cue?.action && cue === row.primaryPrefix && row.cueRecovery?.status !== "neutral" &&
    cue.narrativePhase === "recover" && cue.transition === "recover" && cue.fact === "ease" &&
    exactCurrentCue(typed, id) && typed.transition === "recover" && typed.fact === "ease" && typed.sceneBoundary?.status === "none" &&
    (local.contextId === null || cue.evidenceIds.includes(local.contextId) && typed.evidenceIds.includes(local.contextId));
}

function corroboratesReleaseLinkedRecoveryCue(row, cue, typed, decisions, id, barrier) {
  const local = localDirectAction(row, id);
  const releaseId = typed?.priorAnchor;
  if (local?.phase !== "recover" || local.action !== "contact" || local.contextId !== releaseId ||
      releaseId == null || releaseId <= barrier || id - releaseId > 3) return false;
  const release = decisions.get(releaseId);
  const anchor = release?.prefixVerified ? release.effectiveAnnotation : null;
  const proposal = row.discovery;
  const exactPair = fact => fact.evidenceIds.length === 2 && fact.evidenceIds[0] === releaseId && fact.evidenceIds[1] === id;
  if (cue !== row.primaryPrefix || row.cueRecovery?.status === "neutral" || !exactCurrentCue(cue, id) ||
      cue.action !== "contact" || cue.narrativePhase !== "recover" || cue.transition !== "recover" || cue.fact !== "none" ||
      cue.priorAnchor !== null || cue.scopeId === null || !exactPair(cue) ||
      !exactCurrentCue(typed, id) || typed.transition !== "recover" || typed.fact !== "ease" || typed.scopeId !== null ||
      typed.sceneBoundary?.status !== "none" || !exactPair(typed) ||
      proposal?.status !== "candidate" || proposal.frame !== "current" || proposal.action !== "contact" ||
      proposal.narrativePhase !== "recover" || proposal.transition !== "none" || proposal.fact !== "low" ||
      proposal.scopeId !== null || proposal.priorAnchor !== null || proposal.evidenceIds.length !== 1 || proposal.evidenceIds[0] !== id ||
      !exactCurrentCue(anchor, releaseId) || anchor.scopeId !== cue.scopeId || anchor.action !== "release" ||
      anchor.narrativePhase !== "ease" || anchor.transition !== "ease" || anchor.fact !== "ease" ||
      release.window?.runId !== row.window?.runId) return false;
  // The exact released scope may bridge only verified current connectors.
  for (let prior = releaseId + 1; prior < id; prior++) {
    const connector = decisions.get(prior);
    const fact = connector?.prefixVerified ? connector.effectiveAnnotation : null;
    if (connector?.window?.runId !== row.window?.runId || fact?.frame !== "current" ||
        !["neutral", "verified"].includes(fact.status) || !["quiet", "recover"].includes(fact.narrativePhase) ||
        fact.action !== "none" || fact.transition !== "none" || fact.fact !== "none" ||
        (fact.scopeId !== null && fact.scopeId !== cue.scopeId)) return false;
  }
  return true;
}

function corroboratesAdjacentBuild(row, cue, typed, prior, id) {
  const local = row.localActionVerification?.localAction;
  // The primary pass names the earlier unit as the scope start. The exact local
  // pass must independently link to that unit before its unspecified scope can
  // be used for this progression.
  return cue === row.primaryPrefix && cue.scopeId === id - 1 && cue.transition === "none" && cue.priorAnchor === null &&
    cue.evidenceIds.length === 1 && romanticDepictions.has(cue.depiction) && row.cueRecovery?.status !== "neutral" &&
    prior.scopeId === null && prior.priorAnchor === null && prior.evidenceIds.length === 1 &&
    prior.fact === "low" && prior.transition === "none" &&
    prior.action === "anticipation" && prior.narrativePhase === "build" && romanticDepictions.has(prior.depiction) &&
    local?.status === "verified" && local.frame === "current" && local.targetId === id && local.contextId === id - 1 &&
    local.action === "anticipation" && local.phase === "build" && local.contrast === "charged-reaction" &&
    typed?.status === "neutral" && typed.frame === "current" && typed.transition === "none" && typed.sceneBoundary?.status === "none";
}

function corroboratesSustain(row, cue, typed, anchor, id, prior) {
  const local = row.localActionVerification?.localAction;
  const scope = cue.scopeId;
  const evidence = cue.evidenceIds;
  const exactLink = evidence.length === 2 && evidence[0] === prior && evidence[1] === id;
  // A third ID can attest the same scope root already cited by the opening.
  const rootedLink = scope < prior && anchor?.evidenceIds.includes(scope) && evidence.length === 3 &&
    evidence[0] === scope && evidence[1] === prior && evidence[2] === id;
  const noTypedEffect = typed?.frame === "current" && typed.sceneBoundary?.status === "none" &&
    (typed.status === "neutral" && typed.transition === "none" ||
      typed.status === "uncertain" && typed.transition === "unknown" && typed.fact === "none" &&
      typed.scopeId === null && typed.priorAnchor === null && typed.evidenceIds.length === 0);
  return cue === row.primaryPrefix && row.cueRecovery?.status !== "neutral" &&
    scope != null && scope === anchor?.scopeId && freshEnactedStart(anchor, prior) && (exactLink || rootedLink) &&
    ["contact", "continuation"].includes(cue.action) && cue.narrativePhase === "sustain" && cue.transition === "none" &&
    romanticDepictions.has(cue.depiction) && local?.status === "verified" && local.frame === "current" &&
    local.action === "continuation" && local.phase === "sustain" && local.contrast === "same-action" &&
    local.targetId === id && local.contextId === prior && noTypedEffect;
}

function disputedSustainConnector(index, decisions, blocked, supportingIds, id) {
  const row = decisions.get(id);
  const cue = row.primaryPrefix;
  const prior = cue?.priorAnchor;
  if (prior !== id - 2 || cue.fact !== "continue" || blocked.has(prior) || blocked.has(id - 1) || blocked.has(id) ||
      !supportingIds.has(prior) || !supportingIds.has(id - 1) || supportingIds.has(id)) return null;
  const anchor = decisions.get(prior);
  const connector = decisions.get(id - 1);
  const proposal = connector.primaryPrefix;
  const effect = connector.effectiveAnnotation;
  const entry = row.sceneEntryVerification?.sceneEntry;
  if (!row.window || anchor.window?.runId !== row.window.runId || connector.window?.runId !== row.window.runId ||
      index.units[id - 1].structuralBoundary || words(index.units[id - 1].text) > 16 ||
      connector.transitionFlag !== "scene-boundary-unconfirmed" || connector.transitionVerification ||
      effect?.status !== "verified" || effect.frame !== "current" || effect.transition !== "none" || effect.fact !== "none" ||
      proposal?.transition !== "scene-cut" || proposal.fact !== "cut" || proposal.action !== "none" ||
      proposal.narrativePhase !== "quiet" || !proposal.evidenceIds.includes(prior) || !proposal.evidenceIds.includes(id - 1) ||
      row.effectiveAnnotation?.fact !== "continue" || entry?.status !== "none" || entry.reason !== "same-episode" ||
      !corroboratesSustain(row, cue, row.transitionVerification, anchor.primaryPrefix, id, prior)) return null;
  return {connector, prior};
}

function verifiedSustainConnector(verdict, prior, connectorId) {
  return quietNegative(verdict) && verdict.evidenceIds.length === 2 &&
    verdict.evidenceIds[0] === prior && verdict.evidenceIds[1] === connectorId;
}

function playbackInputs(index, decisions, blocked, supportingIds) {
  let recent = [], last = "Baseline", lastFrame = null, lastScope = null, lastParagraph = null, evidenceBarrierId = -1;
  let restartBoundary = null, lastAnchor = null, lastBarrierWasBeatEnd = false;
  let lastBarrierWasFrameReturn = false, firstLocalFrameRelease = null;
  let priorBuildLink = null;
  const anchors = new Map(), supportingAnchors = new Set(), provisionalAnchors = new Set(), blockedScopes = new Set();
  return index.units.map(unit => {
    const result = decisions.get(unit.id);
    const size = unit.structuralBoundary ? 0 : words(unit.text);
    const repair = result?.interruptionContinuationCue;
    const repairAnchor = repair?.priorAnchor;
    const eligibleRepair = repair && repairAnchor >= evidenceBarrierId && anchors.get(repairAnchor) === repair.scopeId &&
      !restartBoundary && !blockedScopes.has(repair.scopeId) &&
      (lastAnchor === repairAnchor || lastAnchor === null && supportingAnchors.has(repairAnchor)) ? repair : null;
    const proposed = eligibleRepair ?? result?.effectiveAnnotation ?? result?.annotation;
    const framed = applyFrameScope(proposed, lastFrame, lastScope);
    const previous = decisions.get(unit.id - 1);
    const rawCue = eligibleRepair ?? (result?.prefixVerified ? result.annotation : null);
    const typed = result?.transitionVerification;
    const auxiliary = supportingIds.has(unit.id);
    const priorFact = previous?.window && previous.window.runId === result?.window?.runId && !blocked.has(unit.id - 1) ?
      (previous.interruptionContinuationApplication ? previous.interruptionContinuationCue : null) ??
        previous.effectiveAnnotation ?? previous.annotation : null;
    const returned = applyRepeatedReturn(framed, blockedScopes.has(priorFact?.scopeId) ? null : priorFact, rawCue, unit.id);
    const fact = restartBoundary ? applyLatchedDecline(returned, priorFact, result?.transitionVerification, unit.id) : returned;
    if (fact !== proposed) {
      result.appliedTransitionOverride = "none";
      result.playbackDisposition = fact !== returned ? "repeated-decline" :
        returned !== framed ? "duplicate-frame-return" : "duplicate-frame-entry";
    }
    const ownCueEvidence = exactCurrentCue(rawCue, unit.id);
    const independentSceneBoundary = result?.sceneEntryArbitration === "independently-confirmed-cut";
    const verifiedSceneBoundary = independentSceneBoundary || verifiedSceneEntry(fact, typed, unit.id);
    const effectVerified = result?.prefixVerified || result?.transitionVerification?.status === "verified" ||
      verifiedSceneBoundary;
    const evidence = fact?.evidenceIds ?? [];
    const previousEvidenceBarrier = evidenceBarrierId;
    const mark = (kind, reason, proof = evidence) => ({kind, knownAt: unit.id, evidence: proof, reason});
    const independentBlock = blocked.has(unit.id);
    const gap = !fact || !usable.has(fact.status) || fact.frame === "uncertain" ||
      fact.narrativePhase === "unknown" && !reviewable(fact);
    const transition = fact?.transition;
    const kind = fact?.fact;
    const prior = fact?.priorAnchor;
    const scopeId = continuationScope(fact, anchors.get(prior));
    if (kind === "protective" && scopeId != null) blockedScopes.add(scopeId);
    const restrictedScope = kind === "protective" || blockedScopes.has(scopeId) || blockedScopes.has(fact?.scopeId);
    const protective = independentBlock || restrictedScope || transition === "hard-stop";
    const elapsedGap = !protective && elapsedContinuityGap(unit, rawCue, fact, lastAnchor);
    if (elapsedGap) result.continuityGuard = "elapsed-time-gap";
    const neutralize = gap && !unit.structuralBoundary || kind === "neutralize" || transition === "uncertain-continuity" || elapsedGap;
    const beatEnd = kind === "beat-end" || closingTransitions.has(transition);
    const frame = effectVerified ? fact?.frame ?? null : null;
    const current = frame === "current";
    const frameChange = editorialFrames.has(frame) && crossesCurrentFrame(frame, lastFrame);
    const enactedStart = freshEnactedStart(rawCue, unit.id);
    const scopeChange = enactedStart && scopeId === unit.id && lastScope !== null && scopeId !== lastScope;
    const contextCut = effectVerified && verifiedContextCut(fact, unit.id);
    const cut = unit.structuralBoundary || contextCut || frameChange || scopeChange && !restartBoundary;
    const proposal = result?.discovery;
    const corroboratedSeed = auxiliary && ownCueEvidence && current && !protective && !neutralize && !cut && !beatEnd && !restartBoundary &&
      proposal?.status === "candidate" && proposal.frame === "current" && proposal.scopeId != null && proposal.scopeId === rawCue.scopeId &&
      proposal.evidenceIds.includes(unit.id) && proposal.evidenceIds.every(id => id <= unit.id) &&
      rawCue.evidenceIds.every(id => id >= previousEvidenceBarrier) &&
      ["action", "narrativePhase", "transition", "fact"].every(key => proposal[key] === rawCue[key]) &&
      (enactedStart && rawCue.transition === "onset" && rawCue.narrativePhase === "onset" && rawCue.fact === "none" ||
        rawCue.action === "anticipation" && rawCue.narrativePhase === "build" && rawCue.transition === "none" && rawCue.fact === "low");
    const supporting = auxiliary && !corroboratedSeed;
    const provisionalSeed = corroboratedSeed && rawCue.action === "anticipation" && rawCue.evidenceIds.length === 1;
    // A typed cut can replace the primary fact, but its earlier link still cannot cross the cut.
    const preCutContinuation = cut && rawCue?.fact === "continue";
    const directEntry = verifiedSceneBoundary && !independentSceneBoundary && !restartBoundary && startsAtSceneEntry(rawCue, typed, unit.id);
    const corroboratedEntry = verifiedSceneBoundary && !independentSceneBoundary && !directEntry && !restartBoundary && !auxiliary &&
      !protective && !neutralize && corroboratesSceneEntry(result, rawCue, typed, unit.id);
    const localStartAfterCut = !preCutContinuation && (!verifiedSceneBoundary || directEntry || corroboratedEntry);
    const boundaryEvidence = corroboratedEntry ? [typed.sceneBoundary.previousId, unit.id] : evidence;
    const boundary = protective ? mark("hard-stop", "Playback gate blocks automatic activation.") :
      unit.structuralBoundary ? mark("cut", "A source divider isolates earlier playback.", [unit.id]) :
      cut ? mark("cut", contextCut ? "Verified scene or narrative-frame boundary." : "A changed frame or fresh scope isolates earlier playback.",
        boundaryEvidence) :
      beatEnd ? mark("beat-end", "Verified narrative beat ending.") :
      kind === "span-end" || transition === "span-end" ? mark("span-end", "Verified release of the current span.") : null;
    if (independentBlock) restartBoundary = "blocked";
    else if (restrictedScope) restartBoundary = "protective";
    else if (transition === "hard-stop" || transition === "declined-restart") restartBoundary = transition;
    // A verified scene change cannot itself resolve an outstanding stop or decline.
    else if (contextCut && !preCutContinuation && !verifiedSceneBoundary &&
        result?.transitionVerification?.status !== "neutral") restartBoundary = null;
    if (neutralize || protective || cut || beatEnd) {
      recent = [];
      last = "Baseline";
      anchors.clear();
      supportingAnchors.clear();
      provisionalAnchors.clear();
      lastAnchor = null;
      // A deferred positive proposal cannot carry playback. Its cleared text
      // may still contextualize a later independently verified target.
      if (protective || cut || beatEnd || !gap || !isDeferredCurrentContext(result)) {
        evidenceBarrierId = unit.id;
        lastBarrierWasBeatEnd = !protective && !cut && !neutralize && effectVerified && kind === "beat-end" &&
          transition === "beat-end" && fact.status === "verified" && evidence.includes(unit.id);
        lastBarrierWasFrameReturn = frameChange && current && !contextCut && !protective && !neutralize &&
          ownCueEvidence && rawCue.fact === "low";
        firstLocalFrameRelease = null;
      }
    }
    const pendingRestart = enactedStart && restartCheckPending(restartBoundary, result);
    const restart = enactedStart && !pendingRestart;
    if (!protective && !neutralize && !beatEnd && !unit.structuralBoundary) {
      // Context can occupy a position in the trailing window. Only a causal
      // annotation with supporting evidence on an open gate contributes intensity.
      recent = [...recent.slice(-7), !supporting && !provisionalSeed && current && ownCueEvidence && localStartAfterCut && (!restartBoundary || restart) ?
        rawCue.depiction : "unknown"];
    }
    if (pendingRestart && startTransitions.has(transition)) result.appliedTransitionOverride = "none";
    // Earlier stops establish history for a fresh enacted restart. They never
    // count as positive evidence or restore an old continuation anchor.
    const hasAnchor = kind === "continue" && prior >= evidenceBarrierId && anchors.has(prior) &&
      scopeId !== null && anchors.get(prior) === scopeId;
    // A start on a cut belongs to the new scope once this pass attests it.
    const freshEvidence = cut ? localStartAfterCut && evidence.includes(unit.id) :
      restart || evidence.every(id => id > evidenceBarrierId || hasAnchor && id === prior);
    const clear = !protective && !neutralize && !beatEnd && (!restartBoundary || restart) && current && fact?.status === "verified" &&
      freshEvidence;
    const linked = clear && hasAnchor;
    const exactLink = linked && ownCueEvidence && rawCue.fact === "continue" && rawCue.priorAnchor === prior &&
      continuationScope(rawCue, anchors.get(prior)) === scopeId;
    const supportLinked = exactLink && supportingAnchors.has(prior);
    if (result && kind === "continue" && !linked) result.playbackDisposition = "unattested-scope";
    else if (result && linked && scopeId !== fact.scopeId) result.playbackDisposition = "continuation-scope-alias";
    const canEase = !protective && !neutralize && !cut && !restartBoundary && current && ownCueEvidence &&
      evidence.every(id => id > previousEvidenceBarrier);
    const localRelease = canEase &&
      rawCue.action === "release" && ["ease", "recover"].includes(rawCue.narrativePhase) &&
      ["none", "ease", "recover", "interruption", "span-end", "beat-end"].includes(transition) &&
      (["ease", "span-end", "beat-end"].includes(kind) || transition === "interruption" && rawCue.fact === "span-end");
    const endingAnchor = rawCue?.priorAnchor;
    const recentOpening = endingAnchor != null && unit.id - endingAnchor <= 3 ? decisions.get(endingAnchor) : null;
    // An ordinary ending can taper a recent enacted beat even when it adds no release action.
    const closeWithTaper = !auxiliary && canEase && transition === "beat-end" && kind === "beat-end" &&
      rawCue.action === "none" && ["quiet", "ease"].includes(rawCue.narrativePhase) && rawCue.transition === "beat-end" &&
      rawCue.fact === "beat-end" && rawCue.scopeId != null && size <= 16 &&
      recentOpening?.readerCue && recentOpening.window?.runId === result.window?.runId &&
      freshEnactedStart(recentOpening.annotation, endingAnchor) && recentOpening.annotation.scopeId === rawCue.scopeId &&
      exactCurrentCue(typed, unit.id) && typed.transition === "beat-end" && typed.fact === "beat-end" &&
      typed.priorAnchor != null && typed.priorAnchor >= endingAnchor &&
      index.units.slice(endingAnchor + 1, unit.id).reduce((count, row) => count + words(row.text), 0) <= 32;
    const releaseCandidate = result.interruptionReleaseCandidate;
    const confirmedRelease = !auxiliary && !protective && !neutralize && !cut && !restartBoundary && !beatEnd && current &&
      releaseCandidate && lastAnchor === releaseCandidate.priorId && !blockedScopes.has(releaseCandidate.oldScope) &&
      (anchors.get(releaseCandidate.priorId) === releaseCandidate.oldScope || priorFact?.evidenceIds.some(id =>
        id < releaseCandidate.priorId && anchors.get(id) === releaseCandidate.oldScope)) &&
      verifiedInterruptionRelease(result.interruptionReleaseVerification, releaseCandidate, unit.id);
    const ease = confirmedRelease ? {...mark("ease", "Independent evidence verifies an interruption that eases the open beat.",
      result.interruptionReleaseVerification.evidenceIds), requiresOpenAnchor: releaseCandidate.priorId} :
      localRelease || clear && (kind === "ease" || transition === "ease" ||
      transition === "interruption" && fact.narrativePhase === "ease") ? mark("ease", "Prefix evidence supports easing.") : null;
    const quietBoundary = protective || neutralize || beatEnd || quietTransitions.has(transition);
    const confirmsProvisional = !auxiliary && !quietBoundary && exactLink && provisionalAnchors.has(prior);
    const rebuild = restart && (restartBoundary || transition === "restart" || fact.narrativePhase === "rebuild");
    const hasLow = clear && ownCueEvidence && !quietBoundary && kind === "low" && !restart;
    const canProgressBuild = !auxiliary && !cut && hasLow && rawCue.narrativePhase === "build" &&
      rawCue.action === "anticipation";
    const citedBuildContext = canProgressBuild && rawCue.evidenceIds.some(id => {
      if (id >= unit.id || blocked.has(id)) return false;
      const context = decisions.get(id);
      const cue = context?.prefixVerified ? context.annotation : context?.discovery;
      return context?.window?.runId === result.window?.runId && ["verified", "neutral"].includes(cue?.status) &&
        (context.prefixVerified || cue.status === "neutral") && cue.frame === "current" && romanticDepictions.has(cue.depiction) &&
        (cue.scopeId == null || cue.scopeId === scopeId) && cue.evidenceIds.includes(id) &&
        !recoveryBarriers.has(cue.transition) && !recoveryBlockingFacts.has(cue.fact);
    });
    const priorId = unit.id - 1;
    // Two exact, adjacent buildup units in the same declared scope can establish
    // progression even when each pass cites only the unit it verified.
    const adjacentContext = canProgressBuild && lastParagraph === unit.paragraph && rawCue.scopeId != null &&
      rawCue.scopeId === scopeId && anchors.get(priorId) === scopeId &&
      previous?.prefixVerified && exactCurrentCue(priorFact, priorId);
    const adjacentBuild = adjacentContext &&
      priorFact.scopeId === scopeId && priorFact.fact === "low" && priorFact.transition === "none" &&
      priorFact.action === "anticipation" && priorFact.narrativePhase === "build" &&
      romanticDepictions.has(priorFact.depiction) && romanticDepictions.has(rawCue.depiction);
    const independentlyLinkedBuild = adjacentContext && !restartBoundary &&
      corroboratesAdjacentBuild(result, rawCue, typed, priorFact, unit.id);
    const buildProgress = citedBuildContext || adjacentBuild || independentlyLinkedBuild;
    // A matching support-only unit may renew the low envelope of the preceding
    // corroborated buildup. It cannot start a beat or acquire a reader cue.
    const supportsVerifiedBuild = auxiliary && !cut && !restartBoundary && hasLow && lastParagraph === unit.paragraph &&
      priorBuildLink?.id === priorId && rawCue === result.primaryPrefix && rawCue.scopeId === priorBuildLink.scopeId &&
      rawCue.action === "anticipation" && rawCue.narrativePhase === "build" && rawCue.transition === "none" &&
      rawCue.priorAnchor === null && rawCue.evidenceIds.length === 1 &&
      currentCueAt(proposal, unit.id, "candidate") && proposal.scopeId === null && proposal.priorAnchor === null &&
      proposal.evidenceIds.length === 1 && ["action", "narrativePhase", "transition", "fact", "depiction"].every(key => proposal[key] === rawCue[key]);
    priorBuildLink = independentlyLinkedBuild ? {id: unit.id, scopeId} : null;
    const connectorRow = exactLink && unit.id - prior === 2 ? previous : null;
    const connectorFact = connectorRow?.effectiveAnnotation ?? connectorRow?.annotation;
    const shortSustainLink = unit.id === prior + 1 || connectorFact?.status === "neutral" && connectorFact.frame === "current" &&
      connectorFact.transition === "none" && connectorFact.fact === "none" && connectorRow.window?.runId === result.window?.runId &&
      words(index.units[prior + 1].text) <= 16;
    const confirmedConnector = supportLinked && connectorRow?.sustainConnectorVerificationStatus === "verified" &&
      verifiedSustainConnector(connectorRow.sustainConnectorVerification, prior, unit.id - 1);
    if (!auxiliary && !quietBoundary && !cut && !restartBoundary && exactLink && (shortSustainLink || confirmedConnector) &&
      (lastAnchor === prior || lastAnchor === null && supportLinked) &&
      corroboratesSustain(result, rawCue, typed, decisions.get(prior)?.primaryPrefix, unit.id, prior)) {
      result.localActionApplication = "sustain-profile";
    }
    const repairedSustain = !auxiliary && !quietBoundary && !cut && !restartBoundary && exactLink && shortSustainLink &&
      result.interruptionContinuationCue === rawCue && (lastAnchor === prior || lastAnchor === null && supportLinked);
    const linkedSustain = repairedSustain || !auxiliary && !quietBoundary && supportLinked && rawCue.action === "contact" &&
      rawCue.narrativePhase === "sustain" && romanticDepictions.has(rawCue.depiction) &&
      freshEnactedStart(decisions.get(prior)?.annotation, prior);
    if (repairedSustain) result.interruptionContinuationApplication = "linked-sustain";
    const scope = linked && !supporting ? {...mark("continue", "Prefix evidence links to an independently attested cue."), priorAnchor: prior,
      ...(confirmsProvisional ? {confirmsProvisional} : {})} :
      citedBuildContext ? mark("build", "Exact buildup advances previously cited romantic context.") :
      adjacentBuild ? mark("build", "Adjacent verified buildup advances the same romantic scope.", [priorId, ...evidence]) :
      independentlyLinkedBuild ? mark("build", "Independent current evidence links the buildup to its verified scope start.",
        [priorId, ...evidence]) : null;
    const recoveryAfterEnd = !auxiliary && !quietBoundary && !cut && !restartBoundary && lastAnchor === null && lastBarrierWasBeatEnd &&
      current && ownCueEvidence && rawCue.fact === "ease" && rawCue.narrativePhase === "recover" && rawCue.action === "contact" &&
      rawCue.transition === "recover" && romanticDepictions.has(rawCue.depiction) &&
      typed?.status === "verified" && typed.frame === "current" && typed.fact === "ease" && typed.transition === "recover" &&
      typed.priorAnchor === previousEvidenceBarrier && typed.evidenceIds.includes(unit.id);
    // A current-frame return can be the exact release anchor. Earlier citations
    // stay in the raw judgment and never renew a remembered beat.
    const releaseAfterReturn = !canEase && !auxiliary && !protective && !neutralize && !cut && !restartBoundary && current &&
      lastBarrierWasFrameReturn && size <= 16 && ownCueEvidence && rawCue.action === "release" &&
      rawCue.narrativePhase === "ease" && rawCue.fact === "ease" &&
      decisions.get(previousEvidenceBarrier)?.window?.runId === result.window?.runId &&
      typed?.frame === "current" && typed.sceneBoundary?.status === "none";
    const primaryReturnLink = rawCue?.scopeId === previousEvidenceBarrier && rawCue.priorAnchor === previousEvidenceBarrier;
    const localReleaseVote = result?.localActionVerification?.localAction;
    const corroboratedReturnLink = releaseAfterReturn && rawCue === result.primaryPrefix && rawCue.priorAnchor === null &&
      rawCue.evidenceIds.length === 1 && rawCue.evidenceIds[0] === unit.id &&
      typed.evidenceIds.length === 2 && typed.evidenceIds[0] === previousEvidenceBarrier &&
      localReleaseVote?.status === "verified" && localReleaseVote.frame === "current" && localReleaseVote.action === "release" &&
      localReleaseVote.phase === "ease" && localReleaseVote.contrast === "softening" &&
      localReleaseVote.targetId === unit.id && localReleaseVote.contextId === previousEvidenceBarrier;
    const firstRelease = releaseAfterReturn && unit.id === previousEvidenceBarrier + 1 &&
      (primaryReturnLink || corroboratedReturnLink) &&
      transition === "interruption" && rawCue.transition === "interruption" &&
      exactCurrentCue(typed, unit.id) && typed.transition === "interruption" && typed.fact === "none";
    const nextRelease = releaseAfterReturn && primaryReturnLink && firstLocalFrameRelease === unit.id - 1 &&
      unit.paragraph === lastParagraph && rawCue.evidenceIds.includes(firstLocalFrameRelease) &&
      transition === "none" && rawCue.transition === "none" && typed.status === "neutral" && typed.transition === "none";
    if (firstRelease) firstLocalFrameRelease = unit.id;
    const localInterruptionTaper = !auxiliary && canEase && !beatEnd && lastAnchor === null &&
      transition === "interruption" && kind === "none" && size <= 16 && unit.paragraph === lastParagraph &&
      rawCue === result.primaryPrefix && supportingIds.has(priorId) &&
      corroboratesLocalInterruptionTaper(result, previous, unit.id);
    if (localInterruptionTaper) result.localActionApplication = "local-interruption-taper";
    const low = firstRelease || nextRelease ? {...mark("low", "Exact release follows a verified return to the current frame.",
      firstRelease && corroboratedReturnLink ? [previousEvidenceBarrier, unit.id] :
        evidence.filter(id => id >= previousEvidenceBarrier)), profile: "Taper", localOnly: true} :
      localInterruptionTaper ? {...mark("low", "Independent current evidence verifies a local interruption release.",
        [priorId, unit.id]), profile: "Taper", localOnly: true} :
      recoveryAfterEnd ? {...mark("low", "Exact current contact supports local recovery after a verified beat end.",
      [previousEvidenceBarrier, unit.id]), profile: "Recovery", localOnly: true} :
      supportsVerifiedBuild ? {...mark("low", "Verified support renews the low envelope of an open buildup.", [priorId, unit.id]),
        profile: "Undertone", priorAnchor: priorId, requiresBeat: true} :
      !supporting && !quietBoundary && (hasLow && !buildProgress || supportLinked && !linkedSustain) ?
      {...mark("low", supportLinked ? "Exact target evidence renews a beat supported by its prefix." :
        "Prefix evidence establishes an independent low cue."), profile: fact.narrativePhase === "recover" ? "Recovery" : "Undertone",
      ...(provisionalSeed ? {provisional: true} : {})} : null;
    const signal = clear && ownCueEvidence && !quietBoundary && !["continue", "span-end"].includes(kind);
    const canSignal = !supporting && signal;
    if (canSignal && corroboratedEntry) result.localActionApplication = "scene-entry-onset";
    if (canSignal && !auxiliary && !cut && !restartBoundary && transition === "recover" && kind === "ease" &&
        corroboratesRecoveryCue(result, rawCue, typed, unit.id)) {
      result.localActionApplication = "recovery-cue";
    } else if (recoveryAfterEnd && localDirectAction(result, unit.id)?.contextId === previousEvidenceBarrier &&
        corroboratesRecoveryCue(result, rawCue, typed, unit.id)) {
      // The local recovery is already compiled. Report the corroborated
      // contact without restoring the ended beat or authorizing a reader cue.
      result.localActionApplication = "post-beat-recovery-cue";
    } else if (canSignal && ease && !auxiliary && !cut && !restartBoundary && lastAnchor === null &&
        corroboratesReleaseLinkedRecoveryCue(result, rawCue, typed, decisions, unit.id, previousEvidenceBarrier)) {
      result.localActionApplication = "release-linked-recovery-cue";
    }
    if (canSignal && rebuild && !verifiedSceneBoundary && restartCheckPending(restartBoundary)) {
      result.appliedTransitionOverride = "restart";
    }
    if (rawCue?.status === "verified" && activePhases.has(rawCue.narrativePhase)) {
      if (quietBoundary) result.cueGuard = "cue-boundary-suppressed";
      else if (rawCue.frame !== "current" || !current) result.cueGuard = "cue-frame-ineligible";
      else if (!ownCueEvidence) result.cueGuard = "cue-target-uncited";
      else if (pendingRestart) result.cueGuard = "cue-restart-unconfirmed";
      else if (restartBoundary && !restart) result.cueGuard = "cue-restart-required";
      else if (!freshEvidence) result.cueGuard = "cue-stale-evidence";
    }
    if (rawCue && ["verified", "neutral"].includes(rawCue.status)) {
      const observedCue = !auxiliary && ownCueEvidence && !quietBoundary && activePhases.has(rawCue.narrativePhase);
      result.cue = Boolean(!auxiliary && canSignal && enactedActions.has(fact.action) && activePhases.has(fact.narrativePhase) ||
        linked && observedCue && rawCue.action === "change");
      result.readerCue = result.cue || Boolean(observedCue &&
        (canSignal && rawCue.action === "anticipation" || linked && rawCue.action === "continuation"));
      if (independentSceneBoundary && contextCut && !auxiliary && !protective && !neutralize && !restartBoundary &&
          corroboratesIndependentCutCue(result, rawCue, typed, unit.id)) {
        result.localActionApplication = "independent-cut-local-cue";
      }
      if (result.readerCue && !result.cue && observedCue && exactLink && !cut && !restartBoundary &&
          transition === "accent" && prior === unit.id - 1 && lastAnchor === prior &&
          corroboratesLinkedAccentCue(result, rawCue, typed, unit.id, prior)) {
        result.localActionApplication = "linked-accent-cue";
      }
    }
    const signalProfile = signal ? rebuild ? "Rebuild rise" : profileFor(fact, recent, last) : "Baseline";
    let pattern = unit.structuralBoundary ? "Divider" : protective ? "Stop" :
      closeWithTaper ? "Taper" : !supporting && localRelease ? beatEnd || fact.narrativePhase === "ease" ? "Taper" : "Recovery" :
      linkedSustain ? "Sustain wave" : buildProgress ? "Gradual build" :
      canSignal ? signalProfile : "Baseline";
    if (contextCut && !low && pattern === "Baseline") pattern = "Reset";
    const localAnchor = hasLow || signal && (activePhases.has(fact.narrativePhase) || signalProfile === "Undertone");
    // Auxiliary checks supply anchors. Only an exact playback target can start playback.
    if (supporting && !quietBoundary && (localAnchor || linked && ownCueEvidence)) {
      anchors.set(unit.id, scopeId ?? unit.id);
      supportingAnchors.add(unit.id);
    } else if (!supporting && (localAnchor || low && !low.localOnly || linkedSustain || confirmsProvisional)) {
      anchors.set(unit.id, scopeId ?? unit.id);
      if (provisionalSeed) provisionalAnchors.add(unit.id);
      if (confirmsProvisional) provisionalAnchors.delete(prior);
      lastAnchor = unit.id;
      restartBoundary = null;
    }
    if (pattern !== "Baseline" && pattern !== "Divider") last = pattern;
    const connector = !frameChange && !neutralize && !protective && !cut &&
      (unit.paragraph === lastParagraph && size <= 12 || /^\s*[“"‘']/u.test(unit.text) && size <= 16);
    lastParagraph = unit.paragraph;
    if (unit.structuralBoundary) {
      lastFrame = lastScope = null;
    } else {
      if (editorialFrames.has(frame)) lastFrame = frame;
      if (effectVerified && scopeId != null) lastScope = scopeId;
    }
    return {id: unit.id, words: size, paragraph: unit.paragraph,
      profile: {id: unit.id, pattern, block: null,
        phase_used: pendingRestart ? "quiet" : canSignal && rebuild ? "rebuild" : fact?.narrativePhase ?? "unknown",
        reason: protective ? "Playback gate blocks automatic activation." : "Compiled from available protocol evidence.",
        gate: protective ? "Blocked" : clearance},
      boundary: closeWithTaper ? {...boundary, verifiedRelease: true,
        reason: "Two current readings confirm the ending of a recent enacted beat."} : boundary,
      scope, ease, low, connector, protective,
      neutral: neutralize ? elapsedGap ? mark("neutralize", "An elapsed interval leaves the earlier beat unresolved.", [unit.id]) :
        mark("neutralize", "Missing or unresolved scope clears carry.") : null};
  });
}

export async function runLunaProtocolShadow({id, text, sourceSha256, grant, provider, budget = createLunaShadowBudget(),
  signal = new AbortController().signal, startId = 0, blockedIds = [], arm = "windowed",
  limits = {}, maxVerification = 96, prefixUnits = 24, negativeStride = 20, now = Date.now,
  verificationTargets = [], verificationContext = "attested", verifyTransitions = false,
  maxTransitionVerification = 32, transitionTargets = [], maxCueChecks = 0, maxSupportingVerification = 0, maxPrimaryAnchorRepairs = 0,
  verifyContinuityBoundary = false, releaseUnusedRestartReservation = false, sceneEntryArbitration = false, sameEpisodeArbitration = false,
  interruptionReleaseArbitration = false, sustainConnectorVerification = false,
  boundaryEntryConfirmation = false, verifySettingSituation = false,
  requireSceneBoundary = verifyTransitions && provider?.sceneBoundaryProtocol === true,
  boundaryVerificationTargets = [], localActionVerificationTargets = [], sceneEntryVerificationTargets = []} = {}) {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,48}$/iu.test(id) || typeof now !== "function" ||
      !["windowed", "complete"].includes(arm) || !["recent", "attested"].includes(verificationContext) ||
      !int(maxVerification) || maxVerification > MAX_SHADOW_VERIFICATIONS || !Array.isArray(verificationTargets) ||
      !int(maxSupportingVerification) || maxSupportingVerification > 8 || maxVerification + maxSupportingVerification > MAX_SHADOW_VERIFICATIONS ||
      typeof verifyTransitions !== "boolean" || !int(maxTransitionVerification) || maxTransitionVerification > MAX_SHADOW_VERIFICATIONS ||
      !int(maxCueChecks) || maxCueChecks > 8 || !int(maxPrimaryAnchorRepairs) || maxPrimaryAnchorRepairs > 1 ||
      typeof verifyContinuityBoundary !== "boolean" || typeof releaseUnusedRestartReservation !== "boolean" ||
      typeof requireSceneBoundary !== "boolean" || typeof sceneEntryArbitration !== "boolean" ||
      typeof sameEpisodeArbitration !== "boolean" || sameEpisodeArbitration && !sceneEntryArbitration ||
      typeof interruptionReleaseArbitration !== "boolean" || typeof sustainConnectorVerification !== "boolean" ||
      typeof boundaryEntryConfirmation !== "boolean" || boundaryEntryConfirmation && !sceneEntryArbitration ||
      typeof verifySettingSituation !== "boolean" || verifySettingSituation && !boundaryEntryConfirmation ||
      !Array.isArray(transitionTargets) || (!verifyTransitions && transitionTargets.length > 0) || !Array.isArray(boundaryVerificationTargets) ||
      !Array.isArray(localActionVerificationTargets) || localActionVerificationTargets.length > MAX_LOCAL_ACTION_DIAGNOSTIC_TARGETS ||
      !Array.isArray(sceneEntryVerificationTargets) || sceneEntryVerificationTargets.length > MAX_SCENE_ENTRY_DIAGNOSTIC_TARGETS ||
      !int(prefixUnits) || prefixUnits < 1 || prefixUnits > 32 || !int(negativeStride) || !Array.isArray(blockedIds)) {
    throw new TypeError("Invalid shadow study options.");
  }
  if (sourceSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(sourceSha256)) throw new TypeError("Invalid source digest.");
  const index = buildWholeStoryIndex(text);
  const {editionDigest, segmentationVersion} = index;
  const plan = planIndexedWholeStoryContext(index, {grant, now: now(), startId, limits});
  const blocked = new Set(blockedIds);
  if (!blockedIds.every(id => int(id) && id < index.units.length)) throw new TypeError("Invalid independent playback blocks.");
  const approved = new Set(grant?.spans.map(({id}) => id) ?? []);
  const nativeTargets = new Set(verificationTargets);
  if (nativeTargets.size !== verificationTargets.length || nativeTargets.size > maxVerification ||
      !verificationTargets.every(id => int(id) && approved.has(id))) throw new TypeError("Invalid native verification targets.");
  const typedTargets = new Set(transitionTargets);
  if (typedTargets.size !== transitionTargets.length || typedTargets.size > maxTransitionVerification ||
      !transitionTargets.every(id => int(id) && approved.has(id))) throw new TypeError("Invalid transition verification targets.");
  const boundaryTargets = new Set(boundaryVerificationTargets);
  if (boundaryTargets.size !== boundaryVerificationTargets.length || !boundaryVerificationTargets.every(id => typedTargets.has(id))) {
    throw new TypeError("Boundary verification requires a unique pinned transition target.");
  }
  const localActionTargets = new Set(localActionVerificationTargets);
  if (localActionTargets.size !== localActionVerificationTargets.length || !localActionVerificationTargets.every(id => typedTargets.has(id))) {
    throw new TypeError("Local action verification requires a unique pinned transition target.");
  }
  const sceneEntryTargets = new Set(sceneEntryVerificationTargets);
  if (sceneEntryTargets.size !== sceneEntryVerificationTargets.length || !sceneEntryVerificationTargets.every(id => typedTargets.has(id))) {
    throw new TypeError("Scene entry verification requires a unique pinned transition target.");
  }
  const decisions = new Map(index.units.map(unit => [unit.id, {status: unit.structuralBoundary ? "structural" :
    !approved.has(unit.id) ? "withheld" : provider ? "budget-deferred" : "provider-unavailable"}]));
  let discovery = plan.windows;
  if (arm === "complete") {
    const targetIds = index.units.map(({id}) => id);
    const units = index.units.map(({id, text}) => ({id, text}));
    const body = JSON.stringify({units, targetIds});
    discovery = units.length > 0 && approved.size === units.length && units.length <= LUNA_PROTOCOL_LIMITS.maxTargets &&
      units.every(({text}) => Buffer.byteLength(text) <= LUNA_PROTOCOL_LIMITS.maxUnitBytes) &&
      Buffer.byteLength(body) <= LUNA_PROTOCOL_LIMITS.maxSourceBytes ?
      [{id: "complete", runId: 0, body, targetIds, contextIds: []}] : [];
    if (!discovery.length) for (const id of approved) decisions.set(id, {status: "complete-arm-ineligible"});
  }
  const telemetry = [], supportingIds = new Set(), pendingPinned = new Map();
  let cueChecksStarted = 0, primaryAnchorRepairsStarted = 0, sameEpisodeCheckStarted = false;
  let settingSituationStarted = false;
  let lastPotentialRestartClosure = -1, singleVerificationRun = false;
  const refusedRuns = new Set();
  const refusedDiagnosticRuns = new Map([...Object.keys(diagnosticLanes), "continuation-repair", "interruption-release", "sustain-connector"]
    .map(mode => [mode, new Set()]));
  const invalidated = window => refusedRuns.has(window.runId);
  const attest = createCausalAttestationLedger(decisions, blocked, LUNA_PROTOCOL_LIMITS.maxAttested, index.units);
  function storePrefixResult(mode, id, verdict, status, reason, cueCheckReason) {
    const before = decisions.get(id);
    if (mode === "cue-check" && cueCheckReason === "same-episode-boundary") {
      const previousId = before.transitionVerification.sceneBoundary.previousId;
      const veto = quietNegative(verdict) && verdict.evidenceIds.length === 2 &&
        verdict.evidenceIds[0] === previousId && verdict.evidenceIds[1] === id;
      const stop = verdict?.status === "verified" && ["hard-stop", "declined-restart"].includes(verdict.transition) &&
        verdict.evidenceIds.includes(id);
      const row = {...before, cueRecovery: verdict, cueRecoveryStatus: verdict?.status ?? status,
        cueRecoveryReason: cueCheckReason, cueRecoveryCorrection: veto ? "same-episode-veto" : undefined,
        cueRecoveryGuard: veto || stop ? undefined : "same-episode-unconfirmed"};
      if (veto) Object.assign(row, {effectiveAnnotation: verdict, sceneEntryArbitration: "same-episode-veto",
        transitionFlag: "scene-boundary-same-episode"});
      if (stop) Object.assign(row, {annotation: verdict, effectiveAnnotation: verdict, transitionFlag: "protective-transition-conflict"});
      decisions.set(id, row);
      return;
    }
    const continuity = mode === "cue-check" && cueCheckReason === "continuity-boundary";
    const continuityCorrection = continuity ? resolveContinuityDispute(before.continuityDispute, verdict, id) : undefined;
    const oldScopeVeto = continuityCorrection === "continuity-old-scope-veto";
    const disputedCut = before.continuityDispute?.cut;
    const cutCheckDeferred = continuity && status === "budget-deferred" && disputedCut?.transition === "scene-cut" &&
      disputedCut.sceneBoundary?.status === "cut";
    let row;
    if (mode === "transition") {
      row = {...before, transitionVerification: verdict, transitionVerificationStatus: verdict?.status ?? status};
    } else if (mode === "cue-check" && cueCheckReason === "primary-anchor-repair") {
      // Keep the failed primary visible. Only an independently confirmed
      // current neutral can replace its unavailable playback annotation.
      const repaired = verdict?.status === "neutral" && verdict.frame === "current" && verdict.scopeId === null &&
        verdict.evidenceIds.length === 0;
      row = {...before, cueRecovery: verdict, cueRecoveryStatus: verdict?.status ?? status,
        cueRecoveryReason: cueCheckReason, cueContractRepaired: repaired,
        cueRecoveryGuard: verdict && !repaired ? "primary-anchor-repair-unconfirmed" : undefined};
      if (repaired) Object.assign(row, {annotation: verdict, prefixVerified: true, status: verdict.status});
    } else if (continuity) {
      row = {...before, cueRecovery: verdict, cueRecoveryStatus: verdict?.status ?? status,
        cueRecoveryReason: cueCheckReason, cueRecoveryCorrection: continuityCorrection,
        cueRecoveryGuard: cutCheckDeferred ? "continuity-budget-deferred" :
          verdict && !continuityCorrection ? "continuity-unresolved" : undefined};
      if (continuityCorrection && !oldScopeVeto) Object.assign(row, {annotation: verdict, prefixVerified: true, status: verdict.status});
    } else if (mode === "cue-check") {
      const candidate = currentCueAt(verdict, id, "verified");
      const opening = cueCheckReason === "opening-buildup";
      const adjacent = cueCheckReason === "adjacent-start";
      const restartState = cueCheckReason === "restart-state";
      const enactedStart = candidate && freshEnactedStart(verdict, id);
      const protective = verdict?.status === "verified" && (verdict.fact === "protective" || verdict.transition === "hard-stop" ||
        restartState && verdict.transition === "declined-restart");
      const support = recentRomanticContext(decisions, blocked, id, before.window?.runId);
      const linked = candidate && verdict.fact === "continue" && verdict.action === "continuation" &&
        verdict.narrativePhase === "sustain" && verdict.priorAnchor === id - 1;
      const correction = opening && verdict?.status === "neutral" && ["current", "neutral"].includes(verdict.frame) ? "quiet-opening" :
        adjacent && linked ? "linked-continuation" : undefined;
      const recoveryGuard = candidate && adjacent && !linked && !freshEnactedStart(verdict, id) ? "recovery-continuation-unlinked" :
        (restartState && !protective || candidate && cueCheckReason === "typed-start") && !enactedStart ? "recovery-start-unproved" :
        candidate && verdict.action === "anticipation" && verdict.depiction === "romantic" &&
        !opening && !verdict.evidenceIds.some(evidence => support.includes(evidence)) ? "recovery-buildup-unlinked" : undefined;
      const recovered = candidate && !opening && !adjacent && !recoveryGuard;
      const repaired = repairableCueContracts.has(before.primaryFailure) && verdict?.status === "neutral";
      row = {...before, cueRecovery: verdict, cueRecoveryStatus: verdict?.status ?? status, cueRecovered: recovered,
        cueRecoveryReason: cueCheckReason, cueRecoveryGuard: recoveryGuard, cueRecoveryCorrection: correction,
        cueContractRepaired: repaired || repairableCueContracts.has(before.primaryFailure) && (recovered || protective)};
      if (recovered || protective || repaired || correction) Object.assign(row, {annotation: verdict, prefixVerified: true, status: verdict.status});
    } else {
      row = {...before, status: verdict?.status ?? status, annotation: verdict, primaryPrefix: verdict,
        prefixVerified: Boolean(verdict), verificationStatus: verdict?.status ?? status, primaryFailure: reason};
    }
    if (mode === "verify" && verdict && before.discovery &&
        ["fact", "transition", "narrativePhase", "frame", "depiction", "action"].some(field => verdict[field] !== before.discovery[field])) {
      row.playbackDisposition = "prefix-disagreement";
    }
    const previous = decisions.get(id - 1);
    const prior = previous?.window?.runId === row.window?.runId && previous?.prefixVerified && !blocked.has(id - 1) ?
      previous.effectiveAnnotation ?? previous.annotation : null;
    const typed = row.transitionVerification;
    const staleBoundary = typed?.sceneBoundary?.status === "cut" && typed.sceneBoundary.previousId < row.previousSceneBoundaryId;
    const applicableTyped = staleBoundary || cutCheckDeferred ? {...typed, sceneBoundary: undefined} : typed;
    const legacyContinuityCorrection = continuityCorrection && !(continuityCorrection === "continuity-cut" && applicableTyped?.sceneBoundary);
    const merged = legacyContinuityCorrection ? {annotation: row.annotation,
      flag: oldScopeVeto ? "scene-boundary-old-scope" : "transition-conflict"} :
      mergeTransitionVerdict(row.annotation, applicableTyped, row.discovery, prior, requireSceneBoundary);
    row.effectiveAnnotation = merged.annotation;
    row.transitionFlag = staleBoundary ? "scene-boundary-stale" : cutCheckDeferred ? "scene-boundary-check-deferred" : merged.flag;
    decisions.set(id, row);
  }
  function deferPrefixRequest(record, id, deferralReason) {
    record.deferralReason = deferralReason;
    if (["continuity-boundary", "primary-anchor-repair", "same-episode-boundary"].includes(record.cueCheckReason)) {
      storePrefixResult("cue-check", id, undefined, record.status, undefined, record.cueCheckReason);
    }
    return {status: "failed"};
  }
  async function execute(windows, stage, earlyDiagnostic = false) {
    const attempts = new Map();
    const independentCueCheck = stage === "interruption-release" || stage === "continuation-repair" || stage === "sustain-connector";
    const diagnosticRefusals = refusedDiagnosticRuns.get(stage);
    const skipped = window => invalidated(window) || diagnosticRefusals?.has(window.runId);
    const results = await executeWholeStoryContextPlan({windows}, {signal, maxAttempts: windows.length,
      maxRetries: 0, serialWithinRun: true, allowPartial: stage === "discovery",
      request: async window => {
        const mode = stage === "discovery" ? stage : window.id.split(":", 1)[0];
        const id = window.targetIds[0];
        const supportingPrefix = mode === "verify" && supportingIds.has(id);
        const started = performance.now();
        const record = {mode, id: window.id, status: "budget-deferred", targetIds: window.targetIds,
          contextIds: window.contextIds, ...(supportingPrefix ? {supportingPrefix} : {})};
        telemetry.push(record);
        attempts.set(window.id, record);
        const payload = inputFor(window);
        const submitted = new Set(payload.units.map(({id}) => id));
        if (mode === "verify" && !supportingPrefix) {
          storePrefixResult(mode, id, undefined, "verification-deferred");
        }
        if (signal.aborted || now() >= grant.expiresAt || ![...submitted].every(id => approved.has(id))) {
          pendingPinned.delete(window.id);
          record.status = "cancelled";
          return {status: "failed"};
        }
        if (skipped(window)) {
          pendingPinned.delete(window.id);
          record.status = "refusal-dependent";
          return {status: "failed"};
        }
        const causal = mode === "discovery" || diagnosticRefusals ? null : attest({runId: window.runId, firstId: payload.units[0].id, target: id});
        if (mode === "transition") decisions.get(id).previousSceneBoundaryId = causal.sceneBoundaryId;
        if (independentCueCheck) {
          record.cueCheckReason = stage;
          record.focus = cueCheckFocus[stage];
          if (cueChecksStarted >= maxCueChecks) return deferPrefixRequest(record, id, "cue-check-limit");
        } else if (mode === "cue-check") {
          const row = decisions.get(id);
          const primary = row.primaryPrefix;
          const typed = row.transitionVerification;
          const unresolved = ["neutral", "uncertain"].includes(primary?.status);
          const restartState = restartCheckPending(causal.restartBoundary) &&
            (freshEnactedStart(primary, id) || exactCurrentCue(primary, id) && primary.action === "continuation" || exactTypedStart(typed, id));
          const typedStart = !causal.restartBoundary && typed?.status === "verified" && typed.transition === "onset" &&
            exactCurrentCue(primary, id) && primary.action === "anticipation" && primary.narrativePhase === "build";
          const support = recentRomanticContext(decisions, blocked, id, window.runId);
          const opening = !causal.restartBoundary && exactCurrentCue(primary, id) && primary.depiction === "romantic" &&
            primary.action === "anticipation" && primary.narrativePhase === "build" && !support.length;
          const adjacent = !causal.restartBoundary && followsDisputedStart(decisions, blocked, id, window.runId, primary, typed);
          const romanticContext = primary?.status === "neutral" && primary.frame === "current" &&
            romanticDepictions.has(primary.depiction) && support.length > 0;
          const disagreement = unresolved && currentCueAt(row.discovery, id, "candidate");
          const dispute = verifyContinuityBoundary && !causal.restartBoundary && row.transitionFlag !== "scene-boundary-stale" && payload.units.length > 1 &&
            continuityDispute(primary, typed, row.discovery, id, causal.localAnchors);
          const anchorRepair = maxPrimaryAnchorRepairs > 0 && nativeTargets.has(id) && row.primaryFailure === "prior-anchor" &&
            !causal.restartBoundary && row.discovery?.status === "neutral" && row.discovery.frame === "current" &&
            typed?.status === "neutral" && ["current", "neutral"].includes(typed.frame) && typed.transition === "none" &&
            (!typed.sceneBoundary || typed.sceneBoundary.status === "none");
          const entry = row.sceneEntryVerification?.sceneEntry;
          const episodeDispute = sameEpisodeArbitration && !sameEpisodeCheckStarted && !causal.restartBoundary &&
            sameEpisodeNoCut(entry) && (row.discovery?.status !== "candidate" || entry.reason === "viewpoint-only") &&
            sameEpisodeCutCandidate(row, id, causal);
          record.cueCheckReason = restartState ? "restart-state" : typedStart ? "typed-start" :
            episodeDispute ? "same-episode-boundary" : dispute ? "continuity-boundary" : adjacent ? "adjacent-start" : opening ? "opening-buildup" :
            romanticContext ? "romantic-context" : disagreement ? "discovery-disagreement" :
            anchorRepair ? "primary-anchor-repair" : repairableCueContracts.has(row.primaryFailure) ? "contract-repair" : undefined;
          const boundaryCheck = record.cueCheckReason === "continuity-boundary";
          if (!record.cueCheckReason || !boundaryCheck && recoveryBarriers.has(typed?.transition) || blocked.has(id) ||
              ["blocked", "protective"].includes(causal.restartBoundary) || causal.protectedScopes.has(primary?.scopeId) ||
              boundaryCheck && causal.protectedScopes.has(typed?.scopeId)) {
            record.cueCheckReason = undefined;
            record.status = "not-needed";
            return {status: "failed"};
          }
          if (boundaryCheck) row.continuityDispute = dispute;
          if (record.cueCheckReason === "primary-anchor-repair") {
            if (primaryAnchorRepairsStarted >= maxPrimaryAnchorRepairs) return deferPrefixRequest(record, id, "primary-anchor-repair-limit");
          } else {
            if (cueChecksStarted >= maxCueChecks) return deferPrefixRequest(record, id, "cue-check-limit");
            // In a single cleared run, checks execute in source order. A
            // passed closure hint no longer needs a reserved check unless the
            // causal state or exact target still shows an unresolved stop.
            const restartCheckReserved = lastPotentialRestartClosure >= 0 &&
              (!releaseUnusedRestartReservation || !singleVerificationRun || id <= lastPotentialRestartClosure ||
                restartCheckPending(causal.restartBoundary) || restartCheckPending(row.effectiveAnnotation?.transition));
            if (restartCheckReserved && !restartState && cueChecksStarted + 1 >= maxCueChecks) {
              return deferPrefixRequest(record, id, "restart-check-reserved");
            }
          }
        }
        const episodeCheck = record.cueCheckReason === "same-episode-boundary";
        const attested = !episodeCheck && causal && verificationContext === "attested" ? causal.anchors : [];
        const focus = cueCheckFocus[record.cueCheckReason];
        const request = {mode, units: payload.units, targetIds: window.targetIds, ...(attested.length ? {attested} : {}),
          ...(focus ? {focus} : {})};
        const body = JSON.stringify(request);
        const optional = independentCueCheck || episodeCheck || earlyDiagnostic || mode === "scene-situation" ||
          mode !== "discovery" && !diagnosticRefusals && maxSupportingVerification > 0 && !pendingPinned.has(window.id);
        const retained = {attempts: pendingPinned.size, sourceBytes: 0, reservedMicros: 0};
        if (optional) for (const quote of pendingPinned.values()) {
          retained.sourceBytes += quote.sourceBytes;
          retained.reservedMicros += quote.reservedMicros;
        }
        const settle = optional ? budget.reserveSupporting?.(body, window.targetIds.length, retained) :
          budget.reserve(body, window.targetIds.length);
        if (!settle) return deferPrefixRequest(record, id, "request-budget");
        pendingPinned.delete(window.id);
        if (episodeCheck) sameEpisodeCheckStarted = true;
        if (record.cueCheckReason === "primary-anchor-repair") primaryAnchorRepairsStarted++;
        else if (mode === "cue-check") cueChecksStarted++;
        record.attempted = true;
        record.contextUnits = payload.units.length - window.targetIds.length;
        if (mode !== "discovery") record.attestedIds = attested.map(({unitId}) => unitId);
        let answer;
        try {
          answer = await provider(request, {signal});
        } catch {
          answer = {status: "failed"};
        }
        if (answer?.status === "not-dispatched") {
          // The trusted transport rejected this request before forwarding it.
          record.attempted = false;
          if (LUNA_PROTOCOL_FAILURE_REASONS.includes(answer.failureReason)) record.failureReason = answer.failureReason;
          settle({inputTokens: 0, outputTokens: 0});
          return deferPrefixRequest(record, id, "transport-not-dispatched");
        }
        record.elapsedMs = Math.round(performance.now() - started);
        settle(answer?.usage);
        if (int(answer?.usage?.inputTokens) && int(answer?.usage?.outputTokens)) {
          record.usage = {inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens};
        }
        if (typeof answer?.returnedModel === "string" && /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/u.test(answer.returnedModel)) {
          record.returnedModel = answer.returnedModel;
        }
        if (LUNA_PROTOCOL_FAILURE_REASONS.includes(answer?.failureReason)) {
          record.failureReason = answer.failureReason;
        }
        if (answer?.status === "refused") {
          (earlyDiagnostic ? refusedRuns : diagnosticRefusals ?? refusedRuns).add(window.runId);
          record.status = "provider-refused";
          return {status: "refused"};
        }
        const expected = new Set(window.targetIds);
        const failureRows = (Array.isArray(answer?.targetFailures) ? answer.targetFailures : [])
          .filter(row => expected.has(row?.unitId) && LUNA_PROTOCOL_TARGET_FAILURES.includes(row.reason));
        const rejections = new Map(failureRows.map(row => [row.unitId, row.reason]));
        const details = new Map();
        for (const {unitId, reason, detail} of failureRows) {
          const safe = mode === "transition" && reason === "status-effect" ? sanitizeLunaStatusEffectDetail(detail) :
            mode === "local-action" && reason === "local-action-evidence" ? sanitizeLunaLocalActionEvidenceDetail(detail) : undefined;
          if (safe) details.set(unitId, {reason, detail: safe});
        }
        const rejectionRows = () => [...rejections].map(([id, reason]) => {
          const recorded = details.get(id);
          const detail = recorded?.reason === reason ? recorded.detail : undefined;
          return {id, reason, ...(detail ? {detail} : {})};
        });
        if (answer?.status !== "ok" && !(mode === "discovery" && answer?.status === "partial")) {
          if (rejections.size) record.rejectedFacts = rejectionRows();
          record.status = ["incomplete", "invalid-response", "transient", "failed", "cancelled", "timed-out",
            "invalid-request"].includes(answer?.status) ? answer.status : "failed";
          if (mode === "verify" && !supportingPrefix && record.status === "invalid-response") {
            storePrefixResult(mode, window.targetIds[0], undefined, record.status, rejections.get(window.targetIds[0]));
          }
          return {status: "failed"};
        }
        const facts = Array.isArray(answer.facts) ? answer.facts : [];
        const byTarget = new Map();
        for (const fact of facts) {
          if (!expected.has(fact?.unitId)) continue;
          if (byTarget.has(fact.unitId)) rejections.set(fact.unitId, "duplicate-target");
          byTarget.set(fact.unitId, fact);
        }
        const annotations = [];
        for (const id of window.targetIds) {
          const fact = byTarget.get(id);
          const providerReason = rejections.get(id);
          const reason = providerReason ?? (fact ? factViolation(fact, submitted, id, mode, attested, requireSceneBoundary) : "missing-target");
          if (reason) {
            rejections.set(id, reason);
            if (!providerReason && mode === "local-action" && reason === "local-action-evidence") {
              details.set(id, {reason, detail: lunaProtocolLocalActionEvidenceDetail(fact, id, proofId => submitted.has(proofId))});
            }
          } else annotations.push({...fact, id});
        }
        const targetCoverageMismatch = facts.length !== expected.size || byTarget.size !== expected.size ||
          [...rejections.values()].some(reason => ["missing-target", "duplicate-target", "unexpected-row"].includes(reason));
        const partial = targetCoverageMismatch || rejections.size > 0;
        if (partial) {
          record.failureReason = "rejected-fact-contract";
          record.rejectedFacts = rejectionRows();
          record.targetCoverageMismatch = targetCoverageMismatch;
        }
        if (!annotations.length || mode !== "discovery" && partial) {
          record.status = "invalid-response";
          if (mode === "verify" && !supportingPrefix) storePrefixResult(mode, id, undefined, record.status, rejections.get(id));
          return {status: "failed"};
        }
        record.status = partial ? "partial" : "returned";
        const acceptedIds = new Set(annotations.map(row => row.id));
        const normalized = (Array.isArray(answer.targetNormalizations) ? answer.targetNormalizations : [])
          .filter(row => acceptedIds.has(row?.unitId) && LUNA_PROTOCOL_TARGET_NORMALIZATIONS.includes(row.reason));
        if (normalized.length) record.normalizedFacts = normalized.map(({unitId, reason}) => ({id: unitId, reason}));
        if (mode !== "discovery" && !diagnosticRefusals && !signal.aborted) {
          storePrefixResult(mode, id, byTarget.get(id), "returned", undefined, record.cueCheckReason);
        }
        return {status: "annotated", annotations};
      }});
    const byId = new Map(results.windows.map(result => [result.id, result]));
    return windows.map(window => ({window, result: byId.get(window.id), rejectedFacts: attempts.get(window.id)?.rejectedFacts ?? [],
      cueCheckReason: attempts.get(window.id)?.cueCheckReason,
      status: skipped(window) && attempts.get(window.id)?.status !== "provider-refused" ? "refusal-dependent" :
        ["cancelled", "refusal-dependent"].includes(byId.get(window.id).status) ? byId.get(window.id).status :
          attempts.get(window.id)?.status ?? byId.get(window.id).status}));
  }
  async function applyPrefixJobs(jobs) {
    for (const {window, result, status, rejectedFacts, cueCheckReason} of await execute(jobs, "prefix")) {
      const [mode] = window.id.split(":", 1), id = window.targetIds[0];
      if (mode === "verify" && supportingIds.has(id) && status !== "returned") continue;
      storePrefixResult(mode, id,
        status === "returned" ? result.annotations[0] : undefined, status, rejectedFacts[0]?.reason, cueCheckReason);
    }
  }
  async function applyDiagnosticJobs(mode, jobs, early = false) {
    const {verdictKey, statusKey, factKey} = diagnosticLanes[mode];
    for (const {window, result, status} of await execute(jobs, mode, early)) {
      const row = decisions.get(window.targetIds[0]);
      const verdict = status === "returned" ? result.annotations[0] : undefined;
      row[verdictKey] = verdict;
      row[statusKey] = verdict?.[factKey].status ?? status;
    }
  }
  function comparisonPathEligible(job, id, earlierId, firstId, causal, closedPredecessor = null) {
    return earlierId >= causal.sceneBoundaryId && earlierId >= firstId && !index.units.slice(earlierId, id).some(unit => {
      const prior = decisions.get(unit.id);
      const effect = prior?.effectiveAnnotation ?? prior?.annotation;
      // The immediately preceding neutralization still closes playback. Its
      // exact current unit can supply the comparison text for a new scene.
      const quietPredecessor = unit.id === id - 1 && closedPredecessor === unit.id && exactCurrentCue(effect, unit.id) &&
        effect.transition === "uncertain-continuity" && effect.fact === "neutralize" && effect.narrativePhase === "quiet" &&
        effect.action === "none" && effect.priorAnchor === null && effect.evidenceIds.length === 1;
      return blocked.has(unit.id) || unit.structuralBoundary || prior?.window?.runId !== job.runId ||
        (!quietPredecessor && (recoveryBarriers.has(effect?.transition) || recoveryBlockingFacts.has(effect?.fact)));
    });
  }
  async function adjudicateQuietSetting(job, row, id) {
    if (!job || invalidated(job)) return;
    const boundary = quietSettingBoundary(row, id);
    if (!boundary) return;
    const {previousId} = boundary;
    const firstId = inputFor(job).units[0].id;
    const causal = attest({runId: job.runId, firstId, target: id});
    const pathEligible = earlierId => comparisonPathEligible(job, id, earlierId, firstId, causal, previousId);
    if (blocked.has(id) || index.units[id].structuralBoundary || causal.restartBoundary || !pathEligible(previousId) ||
        [row.annotation, row.primaryPrefix, row.cueRecovery, row.transitionVerification].some(
          fact => causal.protectedScopes.has(fact?.scopeId))) row.sceneSituationVerificationStatus = "path-ineligible";
    else if (settingSituationStarted) row.sceneSituationVerificationStatus = "confirmation-limit";
    else {
      settingSituationStarted = true;
      await applyDiagnosticJobs("scene-situation", [{...job, id: `scene-situation:${id}`}]);
    }
    const situation = row.sceneSituationVerification?.sceneSituation;
    const grounded = situation?.earlierId != null && situation.earlierId <= previousId && pathEligible(situation.earlierId);
    if (grounded && situation.status === "changed") {
      row.independentBoundaryStatus = "corroborated";
      return;
    }
    const same = grounded && situation.status === "same";
    const quiet = {unitId: id, id, status: "neutral", frame: "current", depiction: "neutral", narrativePhase: "quiet",
      action: "none", transition: "none", fact: "none", scopeId: null, priorAnchor: null, evidenceIds: []};
    const typed = row.transitionVerification;
    // A setting dispute cannot remove an independent, exact local activity stop.
    if (typed?.transition === "non-romantic-activity-stop" && exactCurrentCue(typed, id)) {
      row.effectiveAnnotation = {...quiet, status: "verified", transition: typed.transition, fact: same ? "none" : "neutralize",
        evidenceIds: same ? typed.evidenceIds : [previousId, id]};
    } else row.effectiveAnnotation = same ? quiet : {...quiet, status: "verified", transition: "uncertain-continuity",
      fact: "neutralize", evidenceIds: [previousId, id]};
    if (["independently-confirmed-cut", "corroborated-setting-cut"].includes(row.sceneEntryArbitration)) {
      delete row.sceneEntryArbitration;
    }
    row.independentBoundaryStatus = same ? "setting-continuity" : "setting-context-unresolved";
    row.transitionFlag = same ? "scene-boundary-same-setting" : "scene-boundary-setting-context-unresolved";
  }
  async function confirmIndependentEntry(job, row, id) {
    const firstId = inputFor(job).units[0].id;
    if (firstId === id) {
      row.independentBoundaryStatus = "first-entry-unproved";
      return false;
    }
    const causal = attest({runId: job.runId, firstId, target: id});
    if (blocked.has(id) || index.units[id].structuralBoundary || causal.restartBoundary ||
        [row.primaryPrefix, row.transitionVerification, row.discovery].some(fact => causal.protectedScopes.has(fact.scopeId))) {
      row.independentBoundaryStatus = "priority-barrier";
      return false;
    }
    await applyDiagnosticJobs("scene-entry", [job], true);
    const entry = row.sceneEntryVerification?.sceneEntry;
    if (entry?.status !== "cut" || entry.changeId !== id || !Object.hasOwn(materialEntryReasons, entry.reason)) {
      row.independentBoundaryStatus = row.sceneEntryVerificationStatus === "budget-deferred" ?
        "confirmation-deferred" : "first-entry-unproved";
      return false;
    }
    const pathEligible = earlierId => comparisonPathEligible(job, id, earlierId, firstId, causal, entry.previousId);
    if (!pathEligible(entry.previousId)) {
      row.independentBoundaryStatus = "path-ineligible";
      return false;
    }
    // Reuse the accepted causal prefix byte for byte. This request sees no prior verdicts or attestations.
    await applyDiagnosticJobs("scene-boundary", [{...job, id: `scene-boundary:${id}`}], true);
    const boundary = row.boundaryVerification?.sceneBoundary;
    row.independentBoundaryStatus = boundary ? "disagreement" : row.boundaryVerificationStatus === "budget-deferred" ?
      "confirmation-deferred" : "confirmation-unavailable";
    if (agreesOnMaterialEntry(entry, boundary, id)) {
      const {reason, previousId, entryId} = boundary;
      const confirmed = {...row.transitionVerification, sceneBoundary: {status: "cut", reason, previousId, entryId}};
      const merged = mergeTransitionVerdict(row.annotation, confirmed, row.discovery,
        decisions.get(id - 1)?.effectiveAnnotation, requireSceneBoundary);
      if (merged.annotation?.transition === "scene-cut") {
        row.effectiveAnnotation = {...merged.annotation, evidenceIds: [previousId, entryId]};
        row.transitionFlag = "scene-boundary-independently-confirmed";
        row.sceneEntryArbitration = "independently-confirmed-cut";
        row.independentBoundaryStatus = "corroborated";
      } else {
        row.independentBoundaryStatus = "priority-barrier";
      }
    }
    return true;
  }
  if (provider && discovery.length) {
    const priority = [], important = [], routine = [], controls = [], proposals = new Map(), transitionJobs = [];
    const discoveries = await execute(discovery, "discovery");
    for (const {window, result, status} of discoveries) {
      if (["returned", "partial"].includes(status)) {
        for (const fact of result.annotations) proposals.set(fact.unitId, {fact, runId: window.runId});
      }
    }
    for (const {window, result, status, rejectedFacts} of discoveries) {
      const rejectedById = new Map(rejectedFacts.map(({id, reason}) => [id, reason]));
      for (const id of window.targetIds) {
        const rejected = rejectedById.get(id);
        const rowStatus = status === "partial" && rejected ? rejected === "missing-target" ? "missing" : "invalid-response" : status;
        decisions.set(id, {status: rowStatus, window, discoveryStatus: rowStatus});
        if (invalidated(window)) continue;
        if (nativeTargets.has(id)) priority.push(prefixJob(window, id, index, prefixUnits));
        else if (status === "partial" && rejected) important.push(prefixJob(window, id, index, prefixUnits));
        else if (verifyTransitions && ["incomplete", "invalid-response"].includes(status) &&
            (id === window.targetIds[0] || negativeStride && id % negativeStride === 0)) {
          controls.push(prefixJob(window, id, index, prefixUnits));
        }
        if (verifyTransitions) transitionJobs.push({id, window,
          rank: transitionPriority(index.units[id], proposals.get(id)?.fact, typedTargets.has(id))});
      }
      if (!["returned", "partial"].includes(status)) continue;
      for (const fact of result.annotations) {
        const previous = proposals.get(fact.unitId - 1);
        const frameChange = editorialFrames.has(fact.frame) && previous?.runId === window.runId &&
          editorialFrames.has(previous.fact.frame) && previous.fact.frame !== fact.frame;
        const needsVerification = reviewable(fact) || frameChange;
        const isPriority = nativeTargets.has(fact.unitId);
        if (needsVerification && !isPriority) {
          const queue = frameChange || fact.fact === "protective" || transitionCuts.has(fact.transition) ||
            ["hard-stop", "onset", "restart", "beat-end"].includes(fact.transition) ? important : routine;
          queue.push(prefixJob(window, fact.unitId, index, prefixUnits));
        } else if (!isPriority && negativeStride && ["neutral", "uncertain", "abstain"].includes(fact.status) &&
            fact.unitId % negativeStride === 0) controls.push(prefixJob(window, fact.unitId, index, prefixUnits));
        decisions.set(fact.unitId, {status: needsVerification || isPriority ? "verification-deferred" : fact.status,
          discoveryStatus: fact.status,
          window, discovery: fact, annotation: needsVerification || isPriority ? undefined : fact});
      }
    }
    const verification = pickVerification(priority, important, routine, controls, maxVerification);
    const diagnosticJobs = Object.fromEntries(Object.keys(diagnosticLanes).map(mode => [mode, []]));
    for (const {id, window} of transitionJobs.sort((a, b) => b.rank - a.rank || a.id - b.id).slice(0, maxTransitionVerification)) {
      const job = prefixJob(window, id, index, prefixUnits, "transition");
      verification.push(job);
      if (boundaryTargets.has(id)) diagnosticJobs["scene-boundary"].push({...job, id: `scene-boundary:${id}`});
      if (localActionTargets.has(id)) diagnosticJobs["local-action"].push({...job, id: `local-action:${id}`});
      if (sceneEntryTargets.has(id)) diagnosticJobs["scene-entry"].push({...job, id: `scene-entry:${id}`});
    }
    let supporting = [];
    if (maxSupportingVerification || sceneEntryArbitration) {
      const pinned = verification.filter(window =>
        (window.id.startsWith("verify:") ? nativeTargets : typedTargets).has(window.targetIds[0]));
      for (const window of pinned) pendingPinned.set(window.id, pinnedPrefixQuote(window, verificationContext));
      if (maxSupportingVerification) supporting = supportingPrefixJobs(pinned, new Set(verification.map(window => window.targetIds[0])),
        index, decisions, proposals, blocked, prefixUnits, maxSupportingVerification);
      for (const window of supporting) supportingIds.add(window.targetIds[0]);
    }
    if (maxCueChecks || maxPrimaryAnchorRepairs) {
      const checkTargets = new Map(verification.map(window => [window.targetIds[0], window]));
      lastPotentialRestartClosure = Math.max(-1, ...[...checkTargets.keys(), ...supportingIds].filter(id =>
        possibleRestartClosure(index.units[id], proposals.get(id)?.fact)));
      for (const [id, window] of checkTargets) {
        if (maxCueChecks || nativeTargets.has(id)) verification.push(prefixJob(window, id, index, prefixUnits, "cue-check"));
      }
    }
    verification.push(...supporting);
    if (maxCueChecks || maxPrimaryAnchorRepairs || boundaryEntryConfirmation) {
      singleVerificationRun = new Set(verification.map(window => window.runId)).size === 1;
    }
    // Both model passes see only their own prefix and earlier attestations.
    // Finish both checks at a unit before exposing a merged earlier fact.
    verification.sort((a, b) => a.targetIds[0] - b.targetIds[0] || prefixOrder[a.id.split(":", 1)[0]] -
      prefixOrder[b.id.split(":", 1)[0]]);
    const earlyEntry = sceneEntryArbitration && singleVerificationRun && diagnosticJobs["scene-entry"].length > 0;
    if (earlyEntry || verifySettingSituation) {
      const entryJobs = new Map(earlyEntry ? diagnosticJobs["scene-entry"].map(job => [job.targetIds[0], job]) : []);
      let independentConfirmationUsed = false;
      async function applyRemainingEntry(entryJob, row, id) {
        if (!entryJobs.has(id) || invalidated(entryJob)) return;
        if (!disputedSettingEntry(row, id)) {
          if (boundaryEntryConfirmation && !boundaryTargets.has(id) && independentEntryCandidate(row, id)) {
            if (independentConfirmationUsed) row.independentBoundaryStatus = "confirmation-limit";
            else {
              independentConfirmationUsed = await confirmIndependentEntry(entryJob, row, id);
              if (row.sceneEntryVerificationStatus) entryJobs.delete(id);
            }
          }
          return;
        }
        const previousId = row.transitionVerification.sceneBoundary.previousId;
        const path = index.units.slice(previousId, id + 1);
        if (path.some(unit => blocked.has(unit.id) || unit.structuralBoundary || decisions.get(unit.id)?.window?.runId !== entryJob.runId)) return;
        const causal = attest({runId: entryJob.runId, firstId: inputFor(entryJob).units[0].id, target: id});
        if (causal.restartBoundary || causal.protectedScopes.has(row.transitionVerification.scopeId)) return;
        await applyDiagnosticJobs("scene-entry", [entryJob], true);
        entryJobs.delete(id);
        const entry = row.sceneEntryVerification?.sceneEntry;
        if (entry?.status !== "cut" || entry.reason !== "material-setting" || entry.previousId !== previousId ||
            entry.changeId !== id || entry.entryId !== id) return;
        const prior = decisions.get(id - 1)?.effectiveAnnotation;
        const merged = mergeTransitionVerdict(row.annotation, row.transitionVerification, row.discovery, prior, requireSceneBoundary);
        if (merged.annotation?.transition !== "scene-cut") return;
        row.effectiveAnnotation = merged.annotation;
        row.transitionFlag = "scene-boundary-setting-corroborated";
        row.sceneEntryArbitration = "corroborated-setting-cut";
      }
      for (const [id, jobs] of Map.groupBy(verification, job => job.targetIds[0])) {
        const entryJob = entryJobs.get(id);
        const check = sameEpisodeArbitration && entryJob && cueChecksStarted < maxCueChecks && !sameEpisodeCheckStarted &&
          jobs.find(job => job.id.startsWith("cue-check:"));
        if (check) {
          await applyPrefixJobs(jobs.filter(job => job !== check));
          const row = decisions.get(id);
          if (row.transitionVerification?.sceneBoundary?.status === "cut" && !invalidated(entryJob)) {
            const {previousId} = row.transitionVerification.sceneBoundary;
            const firstId = inputFor(entryJob).units[0].id;
            const causal = attest({runId: entryJob.runId, firstId, target: id});
            const path = index.units.slice(previousId, id + 1);
            const open = path.every(unit => {
              const prior = decisions.get(unit.id);
              const fact = prior.effectiveAnnotation ?? prior.annotation;
              return !blocked.has(unit.id) && !unit.structuralBoundary && prior.window?.runId === entryJob.runId &&
                (unit.id === id || !recoveryBarriers.has(fact?.transition) && !recoveryBlockingFacts.has(fact?.fact));
            });
            if (sameEpisodeCutCandidate(row, id, causal) && previousId >= firstId && open &&
                !causal.restartBoundary && !causal.protectedScopes.has(row.primaryPrefix.scopeId)) {
              await applyDiagnosticJobs("scene-entry", [entryJob], true);
              entryJobs.delete(id);
            }
          }
          await applyPrefixJobs([check]);
          const reviewed = decisions.get(id);
          if (reviewed.discovery?.status === "candidate" && reviewed.cueRecoveryReason === "same-episode-boundary" &&
              reviewed.effectiveAnnotation?.transition === "scene-cut") reviewed.sceneEntryArbitration = "viewpoint-conflict";
        } else await applyPrefixJobs(jobs);
        const row = decisions.get(id);
        await applyRemainingEntry(entryJob, row, id);
        // A later target must never attest a provisional setting reset. All
        // accepted quiet setting cuts use the same proof, regardless of votes.
        if (verifySettingSituation) {
          const settingJob = entryJob ?? jobs.find(job => job.id.startsWith("transition:"));
          await adjudicateQuietSetting(settingJob, row, id);
        }
      }
      if (earlyEntry) diagnosticJobs["scene-entry"] = [...entryJobs.values()];
    } else for (let start = 0; start < verification.length; start += MAX_WHOLE_STORY_REQUESTS) {
      await applyPrefixJobs(verification.slice(start, start + MAX_WHOLE_STORY_REQUESTS));
    }
    for (const [id, decision] of decisions) {
      if (decision.window && invalidated(decision.window)) {
        const status = [decision.status, decision.transitionVerificationStatus].includes("provider-refused") ?
          "provider-refused" : "refusal-dependent";
        decisions.set(id, {status, discoveryStatus: status,
          transitionVerificationStatus: verifyTransitions ? status : undefined});
      } else if (signal.aborted || now() >= grant.expiresAt) {
        decisions.set(id, {status: approved.has(id) ? "cancelled" : decision.status});
      }
    }
    // Diagnostics without a causal arbitration role run after prefix controls.
    for (const [mode, jobs] of Object.entries(diagnosticJobs)) {
      for (let start = 0; start < jobs.length; start += MAX_WHOLE_STORY_REQUESTS) {
        await applyDiagnosticJobs(mode, jobs.slice(start, start + MAX_WHOLE_STORY_REQUESTS));
      }
    }
    if (sceneEntryArbitration) for (const id of sceneEntryTargets) {
      const row = decisions.get(id);
      if (hasViewpointConflict(row, id)) row.sceneEntryArbitration = "viewpoint-conflict";
    }
    if (interruptionReleaseArbitration) {
      for (const id of sceneEntryTargets) {
        const row = decisions.get(id);
        const candidate = continuationRepairCandidate(row, id, index, decisions, blocked, supportingIds);
        if (!candidate) continue;
        const job = prefixJob(row.window, id, index, prefixUnits, "cue-check");
        if (!job.contextIds.includes(candidate.priorId)) continue;
        const [{result, status}] = await execute([{...job, id: `${job.id}:continuation-repair`}], "continuation-repair");
        const verdict = status === "returned" ? result.annotations[0] : undefined;
        row.interruptionContinuationVerification = verdict;
        row.interruptionContinuationVerificationStatus = verdict ? "unconfirmed" : status;
        if (verdict && verifiedContinuationRepair(verdict, candidate, id)) {
          const repaired = {...verdict, scopeId: candidate.scope};
          row.interruptionContinuationCue = repaired;
          row.interruptionContinuationVerificationStatus = "verified";
        } else if (exactCurrentCue(verdict, id) && ["hard-stop", "declined-restart"].includes(verdict.transition)) {
          row.effectiveAnnotation = verdict;
          row.transitionFlag = "protective-transition-conflict";
          row.interruptionContinuationVerificationStatus = "protective-override";
        }
        break;
      }
      for (const {id} of index.units) {
        if (!sceneEntryTargets.has(id) || blocked.has(id) || blocked.has(id - 1)) continue;
        const row = decisions.get(id);
        const candidate = interruptionReleaseCandidate(row, decisions.get(id - 1), id);
        if (!candidate) continue;
        const job = prefixJob(row.window, id, index, prefixUnits, "cue-check");
        if (!job.contextIds.includes(candidate.priorId)) continue;
        const [{result, status}] = await execute([{...job, id: `${job.id}:interruption-release`}], "interruption-release");
        const verdict = status === "returned" ? result.annotations[0] : undefined;
        row.interruptionReleaseCandidate = candidate;
        row.interruptionReleaseVerification = verdict;
        row.interruptionReleaseVerificationStatus = verdict ?
          verifiedInterruptionRelease(verdict, candidate, id) ? "verified" : "unconfirmed" : status;
        if (exactCurrentCue(verdict, id) && ["hard-stop", "declined-restart"].includes(verdict.transition)) {
          row.effectiveAnnotation = verdict;
          row.transitionFlag = "protective-transition-conflict";
          row.interruptionReleaseVerificationStatus = "protective-override";
        }
        break;
      }
    }
    if (sustainConnectorVerification) for (const id of sceneEntryTargets) {
      const candidate = disputedSustainConnector(index, decisions, blocked, supportingIds, id);
      if (!candidate) continue;
      const {connector, prior} = candidate;
      const connectorId = id - 1;
      const job = prefixJob(connector.window, connectorId, index, prefixUnits, "cue-check");
      if (!job.contextIds.includes(prior)) continue;
      // The later sustain may nominate the check, but the blind request ends
      // on the disputed connector and includes no later evidence.
      const [{result, status}] = await execute([{...job, id: `${job.id}:sustain-connector`}], "sustain-connector");
      const verdict = status === "returned" ? result.annotations[0] : undefined;
      connector.sustainConnectorVerification = verdict;
      connector.sustainConnectorVerificationStatus = verdict ?
        verifiedSustainConnector(verdict, prior, connectorId) ? "verified" : "unconfirmed" : status;
      if (exactCurrentCue(verdict, connectorId) && ["hard-stop", "declined-restart"].includes(verdict.transition)) {
        connector.effectiveAnnotation = verdict;
        connector.transitionFlag = "protective-transition-conflict";
        connector.sustainConnectorVerificationStatus = "protective-override";
      }
      break;
    }
  }
  const playback = planStory(id, playbackInputs(index, decisions, blocked, supportingIds));
  const units = index.units.map((unit, i) => {
    const [profile, trace] = playback[i];
    const {status, annotation, effectiveAnnotation, discovery, discoveryStatus, verificationStatus, transitionVerification,
      transitionVerificationStatus, boundaryVerification, boundaryVerificationStatus, localActionVerification, localActionVerificationStatus,
      sceneEntryVerification, sceneEntryVerificationStatus, sceneEntryArbitration: entryArbitration,
      sceneSituationVerification, sceneSituationVerificationStatus,
      transitionFlag, playbackDisposition, prefixVerified, cue, cueGuard, readerCue, localActionApplication,
      primaryPrefix, primaryFailure, cueRecovery, cueRecoveryStatus, cueRecovered, cueContractRepaired,
      cueRecoveryReason, cueRecoveryGuard, cueRecoveryCorrection, continuityGuard, appliedTransitionOverride,
      interruptionContinuationVerification, interruptionContinuationVerificationStatus, interruptionContinuationApplication,
      interruptionReleaseVerification, interruptionReleaseVerificationStatus,
      sustainConnectorVerification: connectorVerification, sustainConnectorVerificationStatus} = decisions.get(unit.id);
    const {unitId: _target, id: _transportId, ...labels} = annotation ?? {};
    const {unitId: _discoveryTarget, id: _discoveryTransportId, ...provisionalLabels} = discovery ?? {};
    // A recovery cue can report enacted contact at the active target without
    // renewing a beat or changing the compiled profile or transition.
    const recoveryCue = localActionApplication === "recovery-cue" && profile.pattern === "Recovery";
    const postBeatRecoveryCue = localActionApplication === "post-beat-recovery-cue" && profile.pattern === "Recovery" &&
      trace.decision === "Local recovery" && trace.beat === null && trace.knownAt === unit.id;
    const releaseLinkedRecoveryCue = localActionApplication === "release-linked-recovery-cue" && profile.pattern === "Recovery" &&
      trace.decision === "Enter recovery" && trace.beat !== null && trace.knownAt === unit.id;
    // Correct the waveform of an exact sustain without renewing carry past it.
    const sustainProfile = localActionApplication === "sustain-profile" && trace.beat !== null && trace.knownAt === unit.id &&
      ["Onset rise", "Undertone"].includes(profile.pattern);
    const linkedAccentCue = localActionApplication === "linked-accent-cue";
    const independentCutCue = localActionApplication === "independent-cut-local-cue" && profile.pattern === "Reset";
    const localInterruptionTaper = localActionApplication === "local-interruption-taper" && profile.pattern === "Taper" &&
      trace.decision === "Local taper" && trace.beat === null && trace.knownAt === unit.id;
    const appliedLocalAction = recoveryCue || postBeatRecoveryCue || releaseLinkedRecoveryCue || linkedAccentCue || sustainProfile || independentCutCue ||
      localInterruptionTaper || localActionApplication === "scene-entry-onset" ?
      localActionApplication : undefined;
    return {id: unit.id, unitSha256: unit.digest, ...labels, status, playbackStatus: "computed",
      pattern: sustainProfile ? "Sustain wave" : profile.pattern, phase: profile.phase_used, beatId: trace.beat, sceneId: trace.scene,
      ...(profile.verifiedRelease ? {verifiedRelease: true} : {}),
      knownAt: trace.knownAt, evidenceIds: trace.evidence, labelKnownAt: annotation ? unit.id : null,
      labelEvidenceIds: annotation?.evidenceIds ?? [], trace, playbackDisposition, prefixVerified: Boolean(prefixVerified),
      cue: recoveryCue || postBeatRecoveryCue || releaseLinkedRecoveryCue || linkedAccentCue || independentCutCue || cue,
      discovery: discovery ? provisionalLabels : undefined,
      discoveryStatus: discoveryStatus ?? status,
      transitionVerification, transitionVerificationStatus: transitionVerificationStatus ?? (verifyTransitions ? "not-requested" : undefined),
      boundaryVerification, boundaryVerificationStatus: boundaryVerificationStatus ?? (boundaryTargets.has(unit.id) ? status : undefined),
      ...(localActionTargets.has(unit.id) ? {localActionVerification,
        localActionVerificationStatus: localActionVerificationStatus ?? status} : {}),
      ...(sceneEntryTargets.has(unit.id) ? {sceneEntryVerification,
        sceneEntryVerificationStatus: sceneEntryVerificationStatus ?? status} : {}),
      ...(sceneSituationVerificationStatus ? {sceneSituationVerification, sceneSituationVerificationStatus} : {}),
      independentBoundaryStatus: decisions.get(unit.id).independentBoundaryStatus,
      ...(entryArbitration ? {sceneEntryArbitration: entryArbitration} : {}),
      ...(appliedLocalAction ? {localActionApplication: appliedLocalAction} : {}),
      ...(interruptionContinuationVerificationStatus ? {interruptionContinuationVerification, interruptionContinuationVerificationStatus} : {}),
      ...(interruptionContinuationApplication ? {interruptionContinuationApplication} : {}),
      ...(interruptionReleaseVerificationStatus ? {interruptionReleaseVerification, interruptionReleaseVerificationStatus} : {}),
      ...(sustainConnectorVerificationStatus ? {sustainConnectorVerification: connectorVerification,
        sustainConnectorVerificationStatus} : {}),
      ...(profile.verifiedInterruptionRelease ? {interruptionReleaseApplication: "interruption-taper"} : {}),
      transitionEvidenceIds: entryArbitration === "independently-confirmed-cut" ? effectiveAnnotation.evidenceIds :
        projectTypedTransition(transitionVerification)?.evidenceIds,
      transitionFlag, cueGuard, readerCue: recoveryCue || readerCue, primaryPrefix, primaryFailure, cueRecovery, cueRecoveryStatus, cueRecovered,
      cueContractRepaired, cueRecoveryReason, cueRecoveryGuard, cueRecoveryCorrection, continuityGuard,
      appliedTransition: continuityGuard ? "uncertain-continuity" : profile.verifiedInterruptionRelease ? "interruption" :
        appliedTransitionOverride ?? (effectiveAnnotation ?? annotation)?.transition,
      verificationStatus: verificationStatus ?? (status === "verification-deferred" ? status : undefined)};
  });
  const outcomes = Object.fromEntries(Object.entries(Object.groupBy(telemetry, row => row.status))
    .map(([status, rows]) => [status, rows.length]));
  const nativeVerification = verificationTargets.map(id => ({id,
    status: decisions.get(id).verificationStatus ?? decisions.get(id).status}));
  const supportingVerification = telemetry.filter(row => row.supportingPrefix).map(row => ({id: row.targetIds[0], status: row.status}));
  return {id, sourceSha256, editionDigest, segmentationVersion, rubricVersion: LUNA_PROTOCOL_RUBRIC_VERSION,
    arm, verificationContext, verifyTransitions, units,
    summary: {plan: plan.summary, discoveryWindows: discovery.length, outcomes, attempts: telemetry, nativeVerification, supportingVerification,
      budget: budget.snapshot()}};
}
