// Compile the v6 scene facts available at each unit into a qualitative plan.
// This mirrors the Python compiler and does not set intensity or device output.
const CLEAR_GATE = "No blocking event recorded";
const HARD_PROFILES = new Set(["Stop", "Reset", "Divider"]);
const ACTIVE = new Set([
  "Gradual build", "Deepening build", "Onset rise", "Rebuild rise", "Undertone",
  "Sustain wave", "Deep sustain", "Crest approach", "Crest",
]);
const EASING_PROFILES = new Set(["Taper", "Recovery"]);
const LOW_PROFILES = new Set(["Undertone", "Recovery"]);
const OLD_GAP = "The longer gap fades the existing envelope.";
const OLD_CARRY = "Carry the established profile through a brief gap. Keep its block and clock.";
const INHERITED_REASONS = new Set([OLD_CARRY, OLD_GAP]);
const UNCONFIRMED_HOLD_WORDS = 16;
const ESTABLISHED_HOLD_WORDS = 32;
const FADE_WORDS = 16;
const STRONG_HOLD_WORDS = 12;
const CONNECTOR_FLOOR_WORDS = 24;

class Beat {
  constructor(story, anchor, profile, supportEnd, established, paragraph, easing = false) {
    this.id = `${story}:beat:${anchor}`;
    this.anchor = anchor;
    this.profile = profile;
    this.supportEnd = supportEnd;
    this.established = established;
    this.provisional = false;
    this.paragraph = paragraph;
    this.easing = easing;
    this.quiet = false;
    this.recoveryEnd = null;
    this.released = false;
    this.releaseEnd = null;
    this.anchors = new Set([anchor]);
  }

  attest(id) {
    this.anchor = id;
    this.anchors.add(id);
  }

  release(cursor, words) {
    this.released = true;
    const end = cursor + Math.max(0, words);
    this.releaseEnd = this.releaseEnd === null ? end : Math.min(this.releaseEnd, end);
    return Math.max(0, this.releaseEnd - cursor);
  }
}

function availableFact(fact) {
  return fact && Object.keys(fact).length ? fact : null;
}

function factStart(fact) {
  return Object.hasOwn(fact, "start") ? fact.start : fact.knownAt;
}

function scopedTo(beat, scope) {
  if (!beat || !scope) return false;
  if (scope.priorAnchor != null) return beat.anchors.has(scope.priorAnchor);
  return beat.anchor >= factStart(scope);
}

function validateFacts(id, facts) {
  if (facts.some(fact => fact && fact.knownAt > id)) {
    throw new RangeError("Continuity facts must be available at the current unit.");
  }
  for (const fact of facts) {
    if (!fact || !Object.hasOwn(fact, "priorAnchor")) continue;
    const anchor = fact.priorAnchor;
    if (!Number.isInteger(anchor) || anchor < 0 || anchor > fact.knownAt || !fact.evidence.includes(anchor)) {
      throw new RangeError("A continuation must cite its independently available prior anchor.");
    }
  }
}

function localSignal(unit, profile) {
  if (profile.reason === OLD_CARRY || !ACTIVE.has(profile.pattern)) return null;
  const tension = unit.tension;
  if (tension?.decision === "Apply overlay" && tension.knownAt > unit.id) return null;
  return profile.pattern;
}

function citeEvidence(evidence, fact, id) {
  for (const anchor of fact.evidence ?? []) {
    if (anchor <= id) evidence.push(anchor);
  }
}

/**
 * Return one [profile, trace] pair per ordered unit.
 * Facts retain their original evidence coordinates and knownAt timestamps.
 */
export function planStory(story, units) {
  let beat = null;
  let parked = null;
  let scene = null;
  let lastBarrier = null;
  let previousId = -1;
  let cursor = 0;
  const plan = [];
  for (const unit of units) {
    const {id, words, profile: source} = unit;
    if (id <= previousId || words < 0) {
      throw new RangeError("Expected ordered unit IDs and nonnegative word counts.");
    }
    previousId = id;
    const wordEnd = cursor + words;
    const paragraph = unit.paragraph ?? null;
    const pattern = source.pattern;
    const result = {...source};
    scene ??= `${story}:scene:${id}`;
    const boundary = availableFact(unit.boundary);
    const scope = availableFact(unit.scope);
    const neutral = availableFact(unit.neutral);
    const holdConfirmation = availableFact(unit.holdConfirmation);
    const inheritedRelease = availableFact(unit.inheritedRelease);
    const requestedEase = availableFact(unit.ease);
    const releaseAnchor = requestedEase?.requiresOpenAnchor;
    const ease = releaseAnchor == null || beat?.established && !beat.provisional && !beat.quiet && !beat.released &&
      beat.anchors.has(releaseAnchor) && (!requestedEase.requiresUnexpiredHold ||
        !beat.easing && cursor - beat.supportEnd < ESTABLISHED_HOLD_WORDS) ? requestedEase : null;
    const low = availableFact(unit.low);
    const spanEnd = boundary?.kind === "span-end";
    const barrier = boundary && !spanEnd;
    if (barrier && boundary.kind === "cut") scene = `${story}:scene:${id}`;
    let mark = boundary || scope;
    validateFacts(id, [boundary, scope, neutral, requestedEase, low, holdConfirmation, inheritedRelease]);
    const lowProfile = low && Object.hasOwn(low, "profile") ? low.profile : "Undertone";
    if (low && (low.knownAt !== id || !LOW_PROFILES.has(lowProfile) && !(low.localOnly && lowProfile === "Taper"))) {
      throw new RangeError("Independent low evidence must name a low profile at its evidence unit.");
    }
    const confirmsProvisional = scope?.confirmsProvisional === true && scope.knownAt === id && scope.priorAnchor != null &&
      scope.evidence.includes(id);
    const protective = source.gate !== CLEAR_GATE || unit.protective;
    let prior;
    if (protective || pattern === "Stop" || pattern === "Reset" || barrier || unit.manualZero) {
      prior = beat;
      beat = parked = null;
      lastBarrier = id;
    } else {
      if (!beat && scope?.priorAnchor != null && scopedTo(parked, scope) && (!parked.provisional || confirmsProvisional)) {
        beat = parked;
        parked = null;
      }
      if (beat?.provisional && confirmsProvisional && scopedTo(beat, scope)) {
        beat.attest(id);
        beat.supportEnd = wordEnd;
        beat.provisional = false;
        beat.established = true;
        beat.quiet = beat.released = false;
        beat.releaseEnd = null;
      }
      prior = beat;
    }

    let decision = "Local profile";
    let rationale = null;
    let holdWords = 0;
    let fadeWords = 0;
    let floorWords = 0;
    let traceBeat = beat;
    const evidence = [];
    const renewsOpenBeat = low?.requiresBeat && pattern === "Baseline" && !barrier && !spanEnd && !ease &&
      beat?.established && !beat.quiet && !beat.provisional && !beat.released &&
      beat.anchors.has(low.priorAnchor) && cursor - beat.supportEnd < ESTABLISHED_HOLD_WORDS;
    const confirmsHeldBeat = holdConfirmation && neutral && pattern === "Baseline" && !boundary && !scope && !ease && !low &&
      beat?.established && !beat.quiet && !beat.provisional && !beat.easing && !beat.released &&
      holdConfirmation.knownAt === id && beat.anchor === holdConfirmation.priorAnchor &&
      Math.max(0, cursor - beat.supportEnd) < ESTABLISHED_HOLD_WORDS;
    const priorTrace = inheritedRelease && plan.at(-1)?.[1];
    const sharesOpenRelease = inheritedRelease && !boundary && !ease &&
      beat?.easing && beat.released && !beat.quiet && beat.profile === "Taper" && beat.releaseEnd > cursor &&
      priorTrace?.decision === "Ease" && priorTrace.beat === beat.id && priorTrace.knownAt === inheritedRelease.knownAt;
    const inheritsOpenRelease = sharesOpenRelease && pattern === "Baseline" && !inheritedRelease.phaseOnly;
    if (protective || HARD_PROFILES.has(pattern)) {
      decision = protective ? "Eligibility gate" : pattern;
      traceBeat = null;
    } else if (unit.manualZero) {
      decision = "Manual zero";
      rationale = "User zero overrides continuity.";
      Object.assign(result, {pattern: "Baseline", block: null, reason: rationale});
    } else if (confirmsHeldBeat) {
      decision = "Resolve held continuity";
      rationale = holdConfirmation.reason;
      mark = holdConfirmation;
      holdWords = ESTABLISHED_HOLD_WORDS - Math.max(0, cursor - beat.supportEnd);
      fadeWords = holdWords + FADE_WORDS;
      Object.assign(result, {pattern: "Sustain wave", reason: rationale});
    } else if (neutral) {
      beat = parked = traceBeat = null;
      lastBarrier = id;
      decision = "Neutral context";
      rationale = neutral.reason;
      mark = neutral;
      Object.assign(result, {pattern: "Baseline", block: null, reason: rationale});
    } else if (barrier && boundary.kind === "beat-end") {
      traceBeat = prior;
      decision = "End beat";
      rationale = boundary.reason;
      const replacement = pattern === "Baseline" || pattern === "Taper" ? pattern : prior ? "Taper" : "Baseline";
      Object.assign(result, {pattern: replacement, block: prior?.id ?? null, reason: rationale});
      if (replacement === "Taper" && boundary.verifiedRelease) result.verifiedRelease = true;
    } else if (inheritsOpenRelease && !inheritedRelease.provenanceOnly) {
      decision = "Inherit release fade";
      rationale = inheritedRelease.reason;
      mark = inheritedRelease;
      fadeWords = beat.releaseEnd - cursor;
      floorWords = fadeWords;
      Object.assign(result, {pattern: "Taper", reason: rationale});
    } else if (low?.localOnly && !barrier && !spanEnd && !beat && !parked) {
      decision = lowProfile === "Taper" ? "Local taper" : "Local recovery";
      rationale = low.reason;
      mark = low;
      floorWords = words;
      Object.assign(result, {pattern: lowProfile, block: null, reason: rationale});
      if (lowProfile === "Taper") result.verifiedRelease = true;
    } else if (low && !low.localOnly && (low.requiresBeat ? renewsOpenBeat : !barrier || boundary.kind === "cut")) {
      const retained = scopedTo(beat, scope) || beat?.anchors.has(low.priorAnchor);
      if (!retained) {
        beat = new Beat(story, id, lowProfile, wordEnd, !low.provisional, paragraph);
        beat.provisional = low.provisional === true;
        parked = null;
      } else {
        beat.attest(id);
        beat.profile = lowProfile;
        beat.supportEnd = wordEnd;
        beat.quiet = false;
        if (beat.provisional && !low.provisional) {
          beat.provisional = false;
          beat.established = true;
        }
      }
      beat.easing = lowProfile === "Recovery";
      beat.released = beat.easing;
      beat.releaseEnd = beat.easing ? cursor : null;
      beat.recoveryEnd = beat.easing ? wordEnd : null;
      lastBarrier = null;
      traceBeat = beat;
      floorWords = words;
      decision = low.requiresBeat ? "Renew low envelope" : barrier ? "Independent low after cut" : "Independent low cue";
      rationale = low.reason;
      mark = low;
      if (barrier) citeEvidence(evidence, boundary, id);
      Object.assign(result, {pattern: lowProfile, reason: rationale});
    } else {
      const signal = localSignal(unit, source);
      let scoped = scopedTo(beat, scope) && !beat?.provisional;
      const connector = unit.connector;
      const localEase = EASING_PROFILES.has(pattern) && !INHERITED_REASONS.has(source.reason);
      const implicitRecovery = pattern === "Recovery" && scope && scope.priorAnchor == null && !beat;
      const spanRelease = spanEnd && !signal && beat && !beat.quiet;
      const softening = ease || localEase || implicitRecovery || spanRelease;
      const newRecoveryEvidence = [scope, ease].some(fact => fact &&
        (lastBarrier === null || factStart(fact) > lastBarrier));
      const canEnterRecovery = !barrier && (lastBarrier === null || newRecoveryEvidence);
      if (softening && (beat || (canEnterRecovery && EASING_PROFILES.has(pattern)))) {
        const recovery = pattern === "Recovery";
        const eased = recovery ? "Recovery" : "Taper";
        if (beat?.quiet && !scoped) beat = null;
        if (!beat && !barrier) {
          beat = new Beat(story, id, eased, cursor, true, paragraph, true);
          parked = null;
          scoped = scopedTo(beat, scope);
          lastBarrier = null;
        }
        if (beat) {
          if (!beat.easing) beat.supportEnd = cursor;
          if (recovery && localEase) {
            beat.attest(id);
            beat.recoveryEnd = wordEnd;
            scoped = scopedTo(beat, scope);
          }
          beat.profile = eased;
          beat.easing = true;
          beat.quiet = false;
          traceBeat = beat;
          fadeWords = beat.release(cursor, FADE_WORDS - (cursor - beat.supportEnd));
          floorWords = scoped ? Math.max(words, fadeWords) : fadeWords;
        }
        decision = !recovery || !beat || beat === prior ? "Ease" : "Enter recovery";
        mark = boundary || ease || scope;
        rationale = ease ? ease.reason : spanEnd ? boundary.reason : source.reason;
        Object.assign(result, {pattern: eased, reason: rationale});
        if (ease && releaseAnchor != null) {
          Object.assign(result, {phase_used: "ease", verifiedRelease: true, verifiedInterruptionRelease: true});
        }
      } else if (signal) {
        lastBarrier = null;
        if (beat?.quiet && !scoped) beat = null;
        const established = signal !== "Undertone" || Boolean(scope || beat);
        if (!beat) {
          beat = new Beat(story, id, signal, wordEnd, established, paragraph);
          parked = null;
          decision = "Enter beat";
        } else {
          beat.attest(id);
          beat.profile = signal;
          beat.supportEnd = wordEnd;
          beat.established = established;
          beat.provisional = false;
          beat.easing = false;
          beat.quiet = false;
          beat.recoveryEnd = null;
          beat.paragraph = paragraph;
          beat.released = false;
          beat.releaseEnd = null;
          decision = "Refresh beat";
        }
        traceBeat = beat;
        if (signal !== pattern) {
          Object.assign(result, {pattern: signal, reason: "Available local evidence renews the same beat."});
        }
      } else if (pattern === "Hold") {
        decision = "Hold for evidence";
      } else if (beat) {
        const age = Math.max(0, cursor - beat.supportEnd);
        const holding = beat.easing ? 0 : beat.established ? ESTABLISHED_HOLD_WORDS : UNCONFIRMED_HOLD_WORDS;
        const fadeEnd = holding + FADE_WORDS;
        const weakSwitch = !scoped && !beat.easing && !beat.established && beat.paragraph !== paragraph && !connector;
        const recoveryConnector = pattern === "Recovery" ||
          (pattern === "Taper" && scoped && INHERITED_REASONS.has(source.reason));
        const recoveryLeft = beat.profile === "Recovery" && recoveryConnector && beat.recoveryEnd !== null
          ? Math.max(0, beat.recoveryEnd + CONNECTOR_FLOOR_WORDS - cursor) : 0;
        const connectorLeft = connector ? Math.max(0, fadeEnd + CONNECTOR_FLOOR_WORDS - age) : 0;
        const supportedFloor = scoped || (!beat.provisional && !beat.quiet && (recoveryLeft || connectorLeft));
        if (!weakSwitch && !beat.quiet && age < holding && !beat.released) {
          let retained = age < STRONG_HOLD_WORDS ? beat.profile : "Undertone";
          if (retained === "Crest") retained = "Deep sustain";
          else if (retained === "Crest approach") retained = "Sustain wave";
          decision = "Carry beat";
          rationale = "Same beat continues through a quiet connector. Keep the existing rhythm.";
          holdWords = holding - age;
          fadeWords = fadeEnd - age;
          Object.assign(result, {pattern: retained, reason: rationale});
        } else if (supportedFloor && ((scoped && !beat.easing) || age >= fadeEnd || beat.quiet ||
                   (beat.released && age < holding))) {
          beat.quiet = false;
          decision = "Hold low floor";
          rationale = "The beat still continues. Keep its rhythm at a low floor.";
          fadeWords = beat.release(cursor, fadeEnd - age);
          const floorProfile = beat.easing && beat.profile === "Recovery" ? "Recovery" : "Undertone";
          Object.assign(result, {pattern: floorProfile, reason: rationale});
        } else if (!beat.quiet && age < fadeEnd) {
          decision = "Fade beat";
          rationale = "Uncertain continuity eases over a reading-distance budget.";
          fadeWords = beat.release(cursor, weakSwitch ? Math.min(FADE_WORDS, fadeEnd - age) : fadeEnd - age);
          const fadeProfile = beat.easing && beat.profile === "Recovery" ? "Recovery" : "Taper";
          // A one-word release tail cannot describe a longer, unlinked quiet unit.
          const exhaustedTail = beat.easing && fadeProfile === "Taper" && pattern === "Baseline" &&
            !supportedFloor && !connector && fadeWords <= 1 && words > FADE_WORDS;
          if (exhaustedTail) {
            traceBeat = null;
            decision = "Quiet after release";
            rationale = "Only the last word of a release reaches this unlinked unit.";
          }
          Object.assign(result, {pattern: exhaustedTail ? "Baseline" : fadeProfile, reason: rationale});
        } else {
          beat.quiet = true;
          traceBeat = null;
          decision = "Quiet pending evidence";
          rationale = "The intensity has faded. Continued playback needs evidence that the beat is still in focus.";
          Object.assign(result, {pattern: "Baseline", block: null, reason: rationale});
        }
        if (supportedFloor) {
          floorWords = scoped ? Math.max(words, fadeWords) : Math.max(connectorLeft, recoveryLeft);
        } else if (age >= fadeEnd + CONNECTOR_FLOOR_WORDS) {
          parked = beat;
          beat = null;
        }
      } else if (INHERITED_REASONS.has(source.reason) || pattern === "Recovery" || (pattern === "Taper" && !barrier)) {
        decision = "Fresh cue required";
        rationale = "The preceding beat has closed.";
        Object.assign(result, {pattern: "Baseline", block: null, reason: rationale});
      }
      if (barrier) {
        decision = signal ? "Fresh beat after cut" : "Scene cut";
        rationale = boundary.reason;
      }
    }

    if (inheritsOpenRelease && inheritedRelease.provenanceOnly && decision === "Fade beat" &&
        traceBeat?.id === priorTrace.beat && traceBeat.anchor < inheritedRelease.knownAt) {
      // The natural fade has already selected its pattern, duration and floor.
      // Its newer release provenance must survive the older beat anchor.
      decision = "Inherit release fade";
      mark = inheritedRelease;
    }
    if (sharesOpenRelease && inheritedRelease.phaseOnly && pattern === "Taper" && decision === "Ease" && !scope && !low &&
        traceBeat?.id === priorTrace.beat && traceBeat.anchor === inheritedRelease.knownAt) {
      // Keep the already compiled output and evidence time. The connector
      // supplies no new action, so the existing fade can have a quiet phase.
      result.phase_used = "quiet";
    }
    if (!protective && !HARD_PROFILES.has(pattern)) {
      result.block = traceBeat?.id ?? null;
      if (traceBeat) evidence.push(traceBeat.anchor);
    }
    if (mark) citeEvidence(evidence, mark, id);
    if (scope?.priorAnchor != null && scopedTo(traceBeat, scope)) evidence.push(scope.priorAnchor);
    // The evidence start describes the cue. knownAt records when it could be used.
    let knownAt = mark || evidence.length ? mark?.knownAt ?? 0 : null;
    for (const anchor of evidence) knownAt = Math.max(knownAt, anchor);
    if (knownAt === null && result.pattern !== pattern) knownAt = id;
    if (rationale && result.pattern !== pattern) result.reason = rationale;
    plan.push([result, {
      scene, beat: traceBeat?.id ?? null, decision, knownAt,
      evidence: [...new Set(evidence)].sort((a, b) => a - b),
      holdWords, fadeWords, floorWords, wordOffset: cursor, reason: rationale || result.reason,
    }]);
    cursor = wordEnd;
  }
  return plan;
}
