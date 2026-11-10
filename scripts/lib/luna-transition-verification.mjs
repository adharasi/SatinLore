const noEvent = new Set(["none", "unknown"]);
const boundaryFacts = new Set(["cut", "neutralize", "protective", "beat-end", "span-end"]);
const cueStarts = new Set(["onset", "restart"]);
const nonClosingEvents = new Set(["onset", "restart", "accent", "ease", "recover", "interruption", "span-end", "non-romantic-activity-stop"]);
const enacted = new Set(["contact", "continuation", "change"]);
const explicitCuts = new Set(["scene-cut", "chapter-end", "memory-entry", "imagined-entry", "reported-entry", "present-return"]);
const elapsedInterval = /^\s*(?:(?:after (?:a while|some time)|some time later|(?:a few|several) (?:minutes|hours) later|(?:minutes|hours) passed)\b|[^“"‘’\n.!?]{0,60}\b(?:stayed|waited|remained|lingered)\b[^“"‘’\n.!?]{0,90}\bfor (?:a while|some time)\b)/iu;
const explicitBoundary = /\b(?:called time|called (?:for )?a (?:break|halt)|asked (?:for (?:a )?break|(?:them|him|her) to stop)|let go|stepped apart|interrupted|withdrew|declined|refused|would rather|said no|stop(?:ped)?|ended|put (?:the|their|his|her) (?:letter|note|journal|diary|book) down|set (?:the|their|his|her) (?:letter|note|journal|diary|book) aside|read (?:the|their|his|her|an?) (?:account|letter|note|diary|journal)|read aloud|recounted|recalled|remembered|back in the present|returned to the present|for a while)\b/iu;
const contextChange = /\b(?:afterwards?|later|previously|then|back|again|apart|pause|waited|stayed|remained|wouldn't|didn't want|break|call|memory|account|old letter|time)\b/iu;

export function transitionPriority(unit, discovery, requested) {
  if (requested) return 100;
  if (discovery?.fact === "protective") return 90;
  if (explicitBoundary.test(unit.text)) return 80;
  if (discovery && !noEvent.has(discovery.transition)) return 60;
  return contextChange.test(unit.text) ? 20 : 0;
}

export function exactCurrentCue(cue, id) {
  return cue?.status === "verified" && cue.frame === "current" && cue.evidenceIds.includes(id);
}

export function freshEnactedStart(cue, transition, id) {
  return exactCurrentCue(cue, id) && enacted.has(cue.action) &&
    (cueStarts.has(cue.transition) || cueStarts.has(transition) && ["onset", "rebuild"].includes(cue.narrativePhase));
}

export function verifiedContextCut(annotation, id) {
  return annotation?.status === "verified" && annotation.evidenceIds.includes(id) &&
    (annotation.fact === "cut" || explicitCuts.has(annotation.transition));
}

export function elapsedContinuityGap(unit, cue, annotation, lastAnchor) {
  return lastAnchor != null && unit.id - lastAnchor <= 2 && cue?.status === "neutral" &&
    cue.frame === "current" && annotation?.status === "neutral" && noEvent.has(annotation.transition) &&
    elapsedInterval.test(unit.text);
}

// Separate model verdicts remain in the diagnostic record. Playback applies
// the checked boundary while retaining cue semantics from its independent pass.
export function mergeTransitionVerdict(cue, verdict) {
  if (!verdict || !["verified", "neutral"].includes(verdict.status)) return {annotation: cue};
  const protectiveCue = cue?.fact === "protective" || cue?.transition === "hard-stop";
  const conflict = cue && !noEvent.has(cue.transition) && cue.transition !== verdict.transition;
  if (protectiveCue && (conflict || verdict.transition !== "hard-stop")) {
    return {annotation: cue, flag: "protective-transition-conflict"};
  }
  if (cue?.status === "verified" && cue.transition === "declined-restart" && cue.evidenceIds.includes(cue.unitId) &&
      nonClosingEvents.has(verdict.transition)) return {annotation: cue, flag: "transition-conflict"};
  if (verdict.status === "neutral") {
    if (!cue) return {annotation: cue};
    if (freshEnactedStart(cue, cue.transition, cue.unitId) || cue.status === "verified" &&
        cue.evidenceIds.includes(cue.unitId) && (cue.transition === "uncertain-continuity" || cue.fact === "neutralize")) {
      return {annotation: cue, flag: "transition-conflict"};
    }
    const fact = boundaryFacts.has(cue.fact) && !protectiveCue ? "none" : cue.fact;
    return {annotation: {...cue, fact, transition: "none", priorAnchor: fact === "none" ? null : cue.priorAnchor},
      flag: conflict ? "transition-conflict" : undefined};
  }
  if (cueStarts.has(verdict.transition) && !freshEnactedStart(cue, verdict.transition, verdict.unitId)) {
    return {annotation: cue, flag: "transition-conflict"};
  }
  const effect = cue?.fact === "protective" || verdict.fact === "none" && cue?.fact && !boundaryFacts.has(cue.fact) ?
    cue.fact : verdict.fact;
  return {annotation: {...verdict, depiction: cue?.depiction ?? "unknown", action: cue?.action ?? "unknown",
    narrativePhase: cue?.narrativePhase ?? "unknown", fact: effect,
    scopeId: verdict.scopeId ?? cue?.scopeId ?? null,
    priorAnchor: verdict.priorAnchor ?? (effect === cue?.fact ? cue?.priorAnchor : null) ?? null,
    evidenceIds: [...new Set([...(cue?.evidenceIds ?? []), ...verdict.evidenceIds])].sort((a, b) => a - b)},
  flag: conflict ? "transition-conflict" : undefined};
}
