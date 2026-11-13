const noEvent = new Set(["none", "unknown"]);
const boundaryFacts = new Set(["cut", "neutralize", "protective", "beat-end", "span-end"]);
const cueStarts = new Set(["onset", "restart"]);
const nonClosingEvents = new Set(["onset", "restart", "accent", "ease", "recover", "interruption", "span-end", "non-romantic-activity-stop"]);
const enacted = new Set(["contact", "change"]);
const explicitCuts = new Set(["scene-cut", "chapter-end", "memory-entry", "imagined-entry", "reported-entry", "present-return"]);
const frameEntries = new Set(["memory-entry", "imagined-entry", "reported-entry"]);
const priorityOverSceneCut = new Set([...frameEntries, "present-return", "chapter-end", "hard-stop", "declined-restart"]);
const earlierFrames = new Set(["remembered", "imagined", "reported"]);
const pendingContextEffects = new Set(["none", "low", "continue", "ease"]);
const pendingContextEvents = new Set(["none", "onset", "accent", "ease", "recover"]);
const elapsedInterval = /^\s*(?:(?:after (?:a while|some time)|some time later|(?:a few|several) (?:minutes|hours) later|(?:minutes|hours) passed)\b|[^“"‘’\n.!?]{0,60}\b(?:stayed|waited|remained|lingered)\b[^“"‘’\n.!?]{0,90}\bfor (?:a while|some time)\b)/iu;
const voluntaryBoundaryHint = /\b(?:called time|called (?:for )?a (?:break|halt)|asked (?:for (?:a )?break|(?:them|him|her) to stop)|let go|stepped apart|withdrew|declined|refused|would rather|said no|stop(?:ped)?)\b/iu;
const namedStop = /\b(?:bus|tram|train|rest|pit|truck)\s+stop\b/giu;
const explicitBoundary = /\b(?:interrupted|ended|put (?:the|their|his|her) (?:letter|note|journal|diary|book) down|set (?:the|their|his|her) (?:letter|note|journal|diary|book) aside|read (?:the|their|his|her|an?) (?:account|letter|note|diary|journal)|read aloud|recounted|recalled|remembered|back in the present|returned to the present|for a while)\b/iu;
const contextChange = /\b(?:afterwards?|later|previously|then|back|again|apart|pause|waited|stayed|remained|wouldn't|didn't want|break|call|memory|account|old letter|time)\b/iu;

export function transitionPriority(unit, discovery, requested) {
  if (requested) return 100;
  if (discovery?.fact === "protective") return 90;
  if (hasVoluntaryBoundaryHint(unit) || explicitBoundary.test(unit.text)) return 80;
  if (discovery && !noEvent.has(discovery.transition)) return 60;
  return contextChange.test(unit.text) ? 20 : 0;
}

export function exactCurrentCue(cue, id) {
  return cue?.status === "verified" && cue.frame === "current" && cue.evidenceIds.includes(id);
}

export function freshEnactedStart(cue, id) {
  return exactCurrentCue(cue, id) && enacted.has(cue.action) &&
    (cueStarts.has(cue.transition) || ["onset", "rebuild"].includes(cue.narrativePhase));
}

export function restartCheckPending(boundary, row) {
  return (boundary === "hard-stop" || boundary === "declined-restart") &&
    !(row?.cueRecoveryReason === "restart-state" && row.cueRecovered);
}

export function possibleRestartClosure(unit, proposal) {
  return (restartCheckPending(proposal?.transition) && proposal.fact !== "protective") || hasVoluntaryBoundaryHint(unit);
}

function hasVoluntaryBoundaryHint(unit) {
  return voluntaryBoundaryHint.test(unit.text.replace(namedStop, ""));
}

export function verifiedContextCut(annotation, id) {
  return annotation?.status === "verified" && annotation.evidenceIds.includes(id) &&
    (annotation.fact === "cut" || explicitCuts.has(annotation.transition));
}

export function projectTypedTransition(verdict) {
  const {sceneBoundary} = verdict ?? {};
  if (sceneBoundary?.status !== "cut" || priorityOverSceneCut.has(verdict.transition) ||
      sceneBoundary.entryId !== verdict.unitId || !Number.isSafeInteger(sceneBoundary.previousId) ||
      sceneBoundary.previousId < 0 || sceneBoundary.previousId >= sceneBoundary.entryId) return verdict;
  return {...verdict, status: "verified", transition: "scene-cut", fact: "cut", scopeId: verdict.unitId,
    evidenceIds: [sceneBoundary.previousId, sceneBoundary.entryId], priorAnchor: null};
}

export function verifiedSceneEntry(annotation, typed, id) {
  return annotation?.transition === "scene-cut" && annotation.fact === "cut" && typed?.sceneBoundary?.entryId === id &&
    typed.sceneBoundary.status === "cut";
}

export function startsAtSceneEntry(cue, typed, id) {
  if (!freshEnactedStart(cue, id)) return false;
  if (cue.scopeId === id || cue.evidenceIds.length === 1 && typed?.status === "verified" &&
      [...cueStarts, "accent"].includes(typed.transition) && typed.evidenceIds.includes(id)) return true;

  // The combined cue can cite the old scope and the previous scene while the typed
  // onset independently establishes a fresh action from the entry alone.
  const scene = typed?.sceneBoundary;
  const previous = scene?.previousId;
  const localOnset = exactCurrentCue(typed, id) && typed.transition === "onset" && typed.fact === "none" &&
    typed.priorAnchor === null && (typed.scopeId === null || typed.scopeId === id) && typed.evidenceIds.length === 1;
  return localOnset && scene?.status === "cut" && scene.entryId === id && Number.isSafeInteger(previous) &&
    previous >= 0 && previous < id && cue.transition === "scene-cut" && cue.fact === "cut" &&
    cue.narrativePhase === "onset" && cue.priorAnchor === null && (cue.scopeId === null || cue.scopeId <= previous) &&
    cue.evidenceIds.includes(previous) && cue.evidenceIds.every(evidence => evidence === id || evidence === previous || evidence === cue.scopeId);
}

export function continuityDispute(primary, typed, discovery, id, localAnchors) {
  const exactCut = fact => verifiedContextCut(fact, id) && fact.fact === "cut" && explicitCuts.has(fact.transition);
  const boundary = projectTypedTransition(typed);
  const legacyPrimaryCut = primary?.transition !== "scene-cut" || typed?.sceneBoundary === undefined;
  const cut = legacyPrimaryCut && exactCut(primary) && boundary?.status === "neutral" ? primary :
    exactCut(boundary) && primary?.status === "neutral" ? boundary : null;
  const anchors = localAnchors.filter(anchor => anchor.frame === "current" && enacted.has(anchor.action));
  if (cut) return {cut, anchors: cut.transition === "scene-cut" && primary.frame === "current" && typed.frame === "current" ? anchors : []};
  if (anchors.length && primary?.status === "neutral" && primary.frame === "current" &&
      typed?.status === "neutral" && typed.frame === "current" && discovery?.status === "candidate" &&
      discovery.frame === "current" && discovery.transition === "uncertain-continuity" &&
      discovery.evidenceIds.includes(id) && discovery.evidenceIds.every(evidence => evidence <= id)) return {anchors};
  return null;
}

export function resolveContinuityDispute(dispute, verdict, id, primary) {
  const cut = dispute?.cut;
  const quietEarlierFrame = fact => fact?.status === "neutral" && earlierFrames.has(fact.frame) &&
    fact.transition === "none" && fact.fact === "none" && fact.action === "none" && fact.narrativePhase === "quiet" &&
    fact.priorAnchor === null;
  // A mixed return is disputed when both prefix readers place this exact unit
  // in the same earlier frame. The blind check supplies the target citation.
  if (cut?.transition === "present-return" && cut.frame === "mixed" && cut.sceneBoundary?.status === "none" &&
      cut.evidenceIds.some(evidence => evidence < id) &&
      quietEarlierFrame(primary) && quietEarlierFrame(verdict) && primary.frame === verdict.frame &&
      primary.scopeId === verdict.scopeId && verdict.evidenceIds.length === 1 && verdict.evidenceIds[0] === id) {
    return "continuity-frame-veto";
  }
  if (dispute?.cut?.transition === "scene-cut" && dispute.cut.sceneBoundary?.status === "cut" &&
      verdict?.status === "neutral" && verdict.transition === "none" &&
      ["current", "neutral"].includes(verdict.frame)) return "continuity-cut-veto";
  if (!dispute || verdict?.status !== "verified" || !verdict.evidenceIds.includes(id)) return undefined;
  if (verdict.transition === "hard-stop" || verdict.transition === "declined-restart") return "continuity-stop";
  const {anchors} = dispute;
  // The check corroborates a change of subject but places it within an older
  // scope. That contradicts a scene entry whose new objective must start here.
  if (cut?.sceneBoundary?.reason === "objective-shift" && verdict.transition === "scene-cut" &&
      verdict.fact === "cut" && verdict.frame === cut.frame && verdict.action === "none" &&
      verdict.narrativePhase === "quiet" && Number.isSafeInteger(verdict.scopeId) && verdict.scopeId < id &&
      verdict.evidenceIds.includes(cut.sceneBoundary.previousId)) return "continuity-old-scope-veto";
  if (cut && verdict.fact === "cut" && verdict.transition === cut.transition && verdict.frame === cut.frame &&
      verdict.action === "none" && verdict.narrativePhase === "quiet" && verdict.evidenceIds.some(evidence => evidence < id) &&
      (verdict.transition !== "scene-cut" || verdict.scopeId === id)) return "continuity-cut";
  if (verdict.frame === "current" && verdict.fact === "continue" && verdict.action === "continuation" &&
      verdict.narrativePhase === "sustain" && verdict.transition === "none" &&
      anchors.some(anchor => anchor.unitId === verdict.priorAnchor && anchor.scopeId === verdict.scopeId)) {
    return "continuity-linked";
  }
  return undefined;
}

export function isDeferredCurrentContext(row) {
  const proposed = row?.discovery;
  return row?.status === "verification-deferred" && proposed?.status === "candidate" && proposed.frame === "current" &&
    pendingContextEffects.has(proposed.fact) && pendingContextEvents.has(proposed.transition);
}

export function repeatedFrameEntry(annotation, previousFrame, previousScope) {
  return frameEntries.has(annotation?.transition) && annotation.frame === previousFrame &&
    (annotation.scopeId == null || annotation.scopeId === previousScope);
}

export function applyFrameScope(annotation, previousFrame, previousScope) {
  return repeatedFrameEntry(annotation, previousFrame, previousScope) ?
    {...annotation, transition: "none", fact: "none", priorAnchor: null} : annotation;
}

export function applyRepeatedReturn(annotation, previous, cue, id) {
  if (annotation?.status !== "verified" || annotation.transition !== "present-return" || annotation.frame !== "current" ||
      !annotation.evidenceIds.includes(id) || previous?.status !== "verified" || previous.transition !== "present-return" ||
      previous.frame !== "current" || !previous.evidenceIds.includes(id - 1) ||
      cue?.status !== "neutral" || cue.frame !== "current" || cue.transition !== "none") return annotation;
  return cue;
}

export function crossesCurrentFrame(frame, previousFrame) {
  return previousFrame != null && (frame === "current") !== (previousFrame === "current");
}

export function continuationScope(annotation, anchorScope) {
  return annotation?.fact === "continue" && annotation.scopeId === annotation.priorAnchor && anchorScope != null ?
    anchorScope : annotation?.scopeId;
}

export function applyLatchedDecline(annotation, prior, typed, id) {
  if (annotation?.status !== "verified" || annotation.transition !== "declined-restart" || annotation.fact !== "neutralize" ||
      typed?.status !== "neutral" || prior?.status !== "verified" || prior.transition !== "declined-restart" ||
      !prior.evidenceIds.includes(id - 1) || !annotation.evidenceIds.includes(id - 1) || !annotation.evidenceIds.includes(id)) return annotation;
  // The previous decline continues to latch playback. A disputed replay of it
  // supplies no additional boundary or evidence of renewed action.
  return {...annotation, transition: "none", fact: "none", priorAnchor: null};
}

export function elapsedContinuityGap(unit, cue, annotation, lastAnchor) {
  return lastAnchor != null && unit.id - lastAnchor <= 2 && cue?.status === "neutral" &&
    cue.frame === "current" && annotation?.status === "neutral" && noEvent.has(annotation.transition) &&
    elapsedInterval.test(unit.text);
}

// Separate model verdicts remain in the diagnostic record. Playback applies
// the checked boundary while retaining cue semantics from its independent pass.
export function mergeTransitionVerdict(cue, typed, discovery, prior, requireSceneBoundary = false) {
  // Authored dividers are processed locally and split approval runs before a
  // typed request. The model cannot supply new structural authority from a
  // contiguous text prefix. Retain the typed local event and raw boundary vote.
  const dividerUnproved = typed?.sceneBoundary?.status === "cut" && typed.sceneBoundary.reason === "explicit-break" &&
    !priorityOverSceneCut.has(typed.transition);
  const verdict = dividerUnproved ? typed : projectTypedTransition(typed);
  const primarySceneCut = cue?.transition === "scene-cut";
  const unnamedCut = cue?.fact === "cut" && !explicitCuts.has(cue.transition);
  const uncheckedCut = (requireSceneBoundary || typed?.sceneBoundary !== undefined) && (primarySceneCut || unnamedCut) &&
    verdict?.transition !== "scene-cut";
  if (uncheckedCut) cue = {...cue, transition: primarySceneCut ? "none" : cue.transition,
    fact: cue.fact === "cut" ? "none" : cue.fact, priorAnchor: null};
  const boundaryFlag = dividerUnproved ? "scene-boundary-divider-unproved" : uncheckedCut ? "scene-boundary-unconfirmed" : undefined;
  if (!verdict || !["verified", "neutral"].includes(verdict.status)) return {annotation: cue, flag: boundaryFlag};
  const protectiveCue = cue?.fact === "protective" || cue?.transition === "hard-stop";
  const conflict = cue && (cue.transition !== verdict.transition && !noEvent.has(cue.transition) ||
    cue.status === "neutral" && verifiedContextCut(verdict, verdict.unitId));
  if (protectiveCue && (conflict || verdict.transition !== "hard-stop")) {
    return {annotation: cue, flag: "protective-transition-conflict"};
  }
  if (cue?.status === "verified" && cue.transition === "declined-restart" && cue.evidenceIds.includes(cue.unitId) &&
      (nonClosingEvents.has(verdict.transition) || verdict.transition === "scene-cut" && typed?.sceneBoundary?.status === "cut")) {
    return {annotation: cue, flag: "transition-conflict"};
  }
  if (verdict.status === "verified" && verdict.transition === "present-return" && verdict.frame === "mixed" &&
      cue?.status === "neutral" && earlierFrames.has(cue.frame) && cue.evidenceIds.includes(cue.unitId)) {
    return {annotation: cue, flag: "transition-conflict"};
  }
  if (verdict.status === "neutral") {
    if (!cue) return {annotation: cue};
    const matchedFrameEntry = frameEntries.has(cue.transition) && discovery?.status === "candidate" &&
      discovery.frame === cue.frame && discovery.transition === cue.transition &&
      discovery.evidenceIds.includes(cue.unitId) && discovery.evidenceIds.every(id => id <= cue.unitId);
    const matchedFrameReturn = cue.transition === "present-return" && cue.frame === "current" && verdict.frame === "current" &&
      ["verified", "neutral"].includes(prior?.status) && earlierFrames.has(prior.frame) &&
      prior.evidenceIds.includes(prior.unitId);
    if (cue.status === "verified" && cue.fact === "cut" && cue.evidenceIds.includes(cue.unitId) &&
        (matchedFrameEntry || matchedFrameReturn)) return {annotation: cue, flag: "transition-conflict"};
    if (freshEnactedStart(cue, cue.unitId) || cue.status === "verified" &&
        cue.evidenceIds.includes(cue.unitId) && (cue.transition === "uncertain-continuity" || cue.fact === "neutralize")) {
      return {annotation: cue, flag: boundaryFlag ?? (conflict ? "transition-conflict" : undefined)};
    }
    const fact = boundaryFacts.has(cue.fact) && !protectiveCue ? "none" : cue.fact;
    return {annotation: {...cue, fact, transition: "none", priorAnchor: fact === "none" ? null : cue.priorAnchor},
      flag: boundaryFlag ?? (conflict ? "transition-conflict" : undefined)};
  }
  if (cueStarts.has(verdict.transition) && !freshEnactedStart(cue, verdict.unitId)) {
    return {annotation: cue, flag: boundaryFlag ?? "transition-conflict"};
  }
  const effect = cue?.fact === "protective" || verdict.fact === "none" && cue?.fact && !boundaryFacts.has(cue.fact) ?
    cue.fact : verdict.fact;
  return {annotation: {...verdict, depiction: cue?.depiction ?? "unknown", action: cue?.action ?? "unknown",
    narrativePhase: cue?.narrativePhase ?? "unknown", fact: effect,
    scopeId: verdict.scopeId ?? cue?.scopeId ?? null,
    priorAnchor: verdict.priorAnchor ?? (effect === cue?.fact ? cue?.priorAnchor : null) ?? null,
    evidenceIds: [...new Set([...(cue?.evidenceIds ?? []), ...verdict.evidenceIds])].sort((a, b) => a - b)},
  flag: boundaryFlag ?? (conflict ? "transition-conflict" : undefined)};
}
