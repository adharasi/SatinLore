import {planStory} from "../../app/static/reader/beat-continuity.mjs";
import {buildWholeStoryIndex, MAX_WHOLE_STORY_REQUESTS, planIndexedWholeStoryContext} from "./whole-story-context-planning.mjs";
import {executeWholeStoryContextPlan} from "./whole-story-context-execution.mjs";
import {createCausalAttestationLedger} from "./luna-causal-attestation.mjs";
import {mergeTransitionVerdict, transitionPriority} from "./luna-transition-verification.mjs";
import {LUNA_PROTOCOL_ENUMS, LUNA_PROTOCOL_FAILURE_REASONS, LUNA_PROTOCOL_LIMITS, LUNA_PROTOCOL_RUBRIC_VERSION,
  LUNA_PROTOCOL_TRANSITION_FACTS,
  lunaProtocolOutputTokens} from "./luna-protocol-provider.mjs";

const clearance = "No blocking event recorded";
const transitionCuts = new Set(["scene-cut", "chapter-end", "memory-entry", "imagined-entry", "reported-entry", "present-return"]);
const closingTransitions = new Set(["beat-end", "declined-restart"]);
const editorialFrames = new Set(["current", "remembered", "imagined", "reported", "mixed"]);
const activePhases = new Set(["build", "onset", "rebuild", "sustain", "peak"]);
const activeActions = new Set(["anticipation", "contact", "continuation", "change", "release"]);
const enactedActions = new Set(["contact", "continuation", "change"]);
const usable = new Set(["candidate", "verified", "neutral"]);
const direct = new Set(["explicit", "graphic"]);
const overt = new Set(["overt-sexual", ...direct]);
const fields = [...Object.keys(LUNA_PROTOCOL_ENUMS), "unitId", "scopeId", "evidenceIds", "priorAnchor"];
const int = n => Number.isSafeInteger(n) && n >= 0;
const words = text => text.match(/[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu)?.length ?? 0;
const reviewable = fact => fact.fact !== "none" || !["none", "unknown"].includes(fact.transition) ||
  activePhases.has(fact.narrativePhase) || ["ease", "recover"].includes(fact.narrativePhase) || activeActions.has(fact.action);
const inputFor = window => JSON.parse(window.body);
const anchorLinks = new Set(["continue", "ease", "span-end", "beat-end"]);
export const MAX_SHADOW_MICROS = 3_000_000;
export const MAX_SHADOW_VERIFICATIONS = 384;

function validateFact(fact, ids, target, mode, attested) {
  const verify = mode !== "discovery";
  const anchors = new Map(attested.map(row => [row.unitId, row]));
  const scopeAllowed = id => id === null || id <= target &&
    (ids.has(id) || attested.some(row => row.scopeId === id && row.frame === fact.frame));
  if (!fact || Object.keys(fact).length !== fields.length || !fields.every(field => Object.hasOwn(fact, field)) ||
      fact.unitId !== target || !Object.entries(LUNA_PROTOCOL_ENUMS).every(([key, values]) => values.includes(fact[key])) ||
      !scopeAllowed(fact.scopeId) ||
      !Array.isArray(fact.evidenceIds) || fact.evidenceIds.length > LUNA_PROTOCOL_LIMITS.maxEvidenceIds ||
      !fact.evidenceIds.every((id, i, all) => (ids.has(id) || anchors.has(id)) && (!i || id > all[i - 1])) ||
      (fact.priorAnchor !== null && (fact.priorAnchor >= target || !fact.evidenceIds.includes(fact.priorAnchor)))) return false;
  for (const id of fact.evidenceIds) {
    if (ids.has(id)) continue;
    const anchor = anchors.get(id);
    if (!verify || !anchorLinks.has(fact.fact) || fact.priorAnchor !== id || !fact.evidenceIds.includes(target) ||
        anchor.scopeId !== fact.scopeId || anchor.frame !== fact.frame) return false;
  }
  if (mode === "transition") {
    if (["low", "continue"].includes(fact.fact) || fact.action !== "unknown" || fact.narrativePhase !== "unknown" ||
        fact.depiction !== "unknown" || fact.status === "candidate") return false;
    if (fact.status === "verified") return Boolean(LUNA_PROTOCOL_TRANSITION_FACTS[fact.transition]?.includes(fact.fact) &&
      fact.evidenceIds.includes(target));
    return fact.fact === "none" && fact.priorAnchor === null && fact.evidenceIds.length === 0 &&
      fact.transition === (fact.status === "neutral" ? "none" : "unknown");
  }
  const effect = reviewable(fact);
  if ((verify && fact.status === "candidate") || (!verify && fact.status === "verified") ||
      (effect && (!["candidate", "verified"].includes(fact.status) || !fact.evidenceIds.length)) ||
      (fact.status === "neutral" && (effect || fact.narrativePhase !== "quiet")) ||
      (fact.fact === "continue" && (fact.priorAnchor === null || fact.scopeId === null || fact.scopeId > fact.priorAnchor)) ||
      (fact.priorAnchor !== null && !["continue", "ease", "span-end", "beat-end"].includes(fact.fact))) return false;
  if ((transitionCuts.has(fact.transition) || fact.transition === "hard-stop" ||
      ["cut", "beat-end", "neutralize", "protective"].includes(fact.fact)) && !fact.evidenceIds.includes(target)) return false;
  if (["low", "continue", "ease"].includes(fact.fact) && fact.frame !== "current") return false;
  if (fact.fact === "low" && !["anticipation", "contact", "change", "release"].includes(fact.action)) return false;
  if (verify && fact.fact === "low" && !fact.evidenceIds.includes(target)) return false;
  if (fact.fact === "ease" && !["ease", "recover"].includes(fact.narrativePhase)) return false;
  if (activePhases.has(fact.narrativePhase) && fact.frame === "current" && fact.fact === "none" &&
      !(fact.narrativePhase === "build" ? activeActions : enactedActions).has(fact.action)) return false;
  if (["restart", "onset"].includes(fact.transition) && fact.frame === "current" && !enactedActions.has(fact.action)) return false;
  if (transitionCuts.has(fact.transition) && !["cut", "low", "none", "protective"].includes(fact.fact)) return false;
  return true;
}

export function createLunaShadowBudget({maxAttempts = 96, maxSourceBytes = 500_000, maxMicros = 100_000} = {}) {
  if (![maxAttempts, maxSourceBytes, maxMicros].every(int) || maxAttempts > 2000 || maxMicros > MAX_SHADOW_MICROS) {
    throw new RangeError("Invalid shadow budget.");
  }
  let attempts = 0, sourceBytes = 0, reservedMicros = 0, chargedMicros = 0, unsettled = 0;
  let breached = false;
  const price = (input, output) => Math.ceil((input * (input > 272_000 ? 0.25 : 0.125) +
    output * (input > 272_000 ? 0.75 : 0.50)) * 1.10);
  return {
    reserve(body, targets) {
      // Bound the short-context input by UTF-8 bytes plus a fixed prompt/schema allowance.
      const bytes = Buffer.byteLength(body);
      const reserve = price(bytes + 8192, lunaProtocolOutputTokens(targets));
      if (breached || attempts >= maxAttempts || sourceBytes + bytes > maxSourceBytes ||
          chargedMicros + reservedMicros + reserve > maxMicros) return null;
      attempts++;
      sourceBytes += bytes;
      reservedMicros += reserve;
      unsettled++;
      let settled = false;
      return usage => {
        if (settled || !int(usage?.inputTokens) || !int(usage?.outputTokens)) return;
        settled = true;
        const actual = price(usage.inputTokens, usage.outputTokens);
        if (actual > reserve) breached = true;
        reservedMicros -= reserve;
        chargedMicros += actual;
        unsettled--;
      };
    },
    snapshot: () => ({capMicros: maxMicros, attempts, attemptedPayloadBytes: sourceBytes, reservedMicros, chargedMicros,
      unsettled, reservationBreach: breached}),
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

function playbackInputs(index, decisions, blocked) {
  let recent = [], last = "Baseline", lastFrame = null, lastScope = null, lastParagraph = null, barrierId = -1;
  let needsRestart = false;
  const anchors = new Map(), blockedScopes = new Set();
  return index.units.map(unit => {
    const result = decisions.get(unit.id);
    const fact = result?.effectiveAnnotation ?? result?.annotation;
    const effectVerified = result?.prefixVerified || result?.transitionVerification?.status === "verified";
    const evidence = fact?.evidenceIds ?? [];
    const mark = (kind, reason) => ({kind, knownAt: unit.id, evidence, reason});
    const independentBlock = blocked.has(unit.id);
    const gap = !fact || !usable.has(fact.status) || fact.frame === "uncertain" ||
      fact.narrativePhase === "unknown" && !reviewable(fact);
    const transition = fact?.transition;
    const kind = fact?.fact;
    const scopeId = fact?.scopeId;
    const blocksScope = kind === "protective" || transition === "hard-stop";
    if (kind === "protective" && scopeId != null) blockedScopes.add(scopeId);
    const protective = independentBlock || blocksScope || blockedScopes.has(scopeId);
    const neutralize = gap && !unit.structuralBoundary || kind === "neutralize" || transition === "uncertain-continuity";
    const beatEnd = kind === "beat-end" || closingTransitions.has(transition);
    const frame = effectVerified ? fact.frame : null;
    const current = frame === "current";
    const frameChange = editorialFrames.has(frame) && lastFrame && frame !== lastFrame;
    const scopeChange = effectVerified && scopeId === unit.id && lastScope !== null && scopeId !== lastScope;
    const cut = kind === "cut" || transitionCuts.has(transition) || frameChange || scopeChange;
    const boundary = protective ? mark("hard-stop", "Playback gate blocks automatic activation.") :
      cut ? mark("cut", "Verified scene or narrative-frame boundary.") :
      beatEnd ? mark("beat-end", "Verified narrative beat ending.") :
      kind === "span-end" || transition === "span-end" ? mark("span-end", "Verified release of the current span.") : null;
    if (protective) needsRestart = true;
    else if (cut) needsRestart = false;
    if (neutralize || protective || cut || beatEnd) {
      recent = [];
      last = "Baseline";
      anchors.clear();
      barrierId = unit.id;
    }
    if (!protective && !neutralize && !beatEnd && !unit.structuralBoundary) {
      // Context can occupy a position in the trailing window. Only a causal
      // annotation with supporting evidence contributes intensity to it.
      recent = [...recent.slice(-7), current && evidence.length ? fact.depiction : "unknown"];
    }
    const restart = ["restart", "onset"].includes(transition) && enactedActions.has(fact?.action) && evidence.includes(unit.id);
    const clear = !protective && !neutralize && !beatEnd && (!needsRestart || restart) && current && fact?.status === "verified" &&
      (cut ? evidence.includes(unit.id) : evidence.every(id => id > barrierId));
    const prior = fact?.priorAnchor;
    const linked = clear && prior !== null && prior !== undefined && anchors.has(prior) &&
      fact.scopeId !== null && anchors.get(prior) === fact.scopeId;
    if (result && kind === "continue" && !linked) result.playbackDisposition = "unattested-scope";
    const scope = linked ? {...mark("continue", "Prefix evidence links to an independently attested cue."), priorAnchor: prior} : null;
    const ease = clear && (kind === "ease" || transition === "ease" ||
      transition === "interruption" && fact.narrativePhase === "ease") ? mark("ease", "Prefix evidence supports easing.") : null;
    const low = clear && kind === "low" ?
      {...mark("low", "Prefix evidence establishes an independent low cue."),
        profile: fact.narrativePhase === "recover" ? "Recovery" : "Undertone"} : null;
    const canSignal = clear && evidence.includes(unit.id) && !["continue", "span-end"].includes(kind) &&
      !["declined-restart", "interruption", "non-romantic-activity-stop"].includes(transition);
    if (result?.prefixVerified && ["verified", "neutral"].includes(fact.status)) {
      result.cue = Boolean(canSignal && enactedActions.has(fact.action) && activePhases.has(fact.narrativePhase));
    }
    let pattern = unit.structuralBoundary ? "Divider" : protective ? "Stop" :
      cut && !low && !canSignal ? "Reset" : canSignal ? profileFor(fact, recent, last) : "Baseline";
    if (cut && !low && pattern === "Baseline") pattern = "Reset";
    if ((canSignal && (activePhases.has(fact.narrativePhase) || pattern === "Undertone")) || low) {
      anchors.set(unit.id, fact.scopeId ?? unit.id);
      needsRestart = false;
    }
    if (pattern !== "Baseline" && pattern !== "Divider") last = pattern;
    const size = unit.structuralBoundary ? 0 : words(unit.text);
    const connector = !frameChange && !neutralize && !protective && !cut &&
      (unit.paragraph === lastParagraph && size <= 12 || /^\s*[“"‘']/u.test(unit.text) && size <= 16);
    lastParagraph = unit.paragraph;
    if (editorialFrames.has(frame)) lastFrame = frame;
    if (effectVerified && scopeId != null) lastScope = scopeId;
    return {id: unit.id, words: size, paragraph: unit.paragraph,
      profile: {id: unit.id, pattern, block: null, phase_used: fact?.narrativePhase ?? "unknown",
        reason: protective ? "Playback gate blocks automatic activation." : "Compiled from available protocol evidence.",
        gate: protective ? "Blocked" : clearance},
      boundary, scope, ease, low, connector, protective,
      neutral: neutralize ? mark("neutralize", "Missing or unresolved scope clears carry.") : null};
  });
}

export async function runLunaProtocolShadow({id, text, sourceSha256, grant, provider, budget = createLunaShadowBudget(),
  signal = new AbortController().signal, startId = 0, blockedIds = [], arm = "windowed",
  limits = {}, maxVerification = 96, prefixUnits = 24, negativeStride = 20, now = Date.now,
  verificationTargets = [], verificationContext = "attested", verifyTransitions = false,
  maxTransitionVerification = 32, transitionTargets = []} = {}) {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,48}$/iu.test(id) || typeof now !== "function" ||
      !["windowed", "complete"].includes(arm) || !["recent", "attested"].includes(verificationContext) ||
      !int(maxVerification) || maxVerification > MAX_SHADOW_VERIFICATIONS || !Array.isArray(verificationTargets) ||
      typeof verifyTransitions !== "boolean" || !int(maxTransitionVerification) || maxTransitionVerification > MAX_SHADOW_VERIFICATIONS ||
      !Array.isArray(transitionTargets) || (!verifyTransitions && transitionTargets.length > 0) ||
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
  const telemetry = [];
  const refusedRuns = new Set();
  const invalidated = window => refusedRuns.has(window.runId);
  const attest = createCausalAttestationLedger(decisions, blocked, LUNA_PROTOCOL_LIMITS.maxAttested);
  function storePrefixResult(mode, id, verdict, status) {
    const before = decisions.get(id);
    const row = mode === "transition" ? {...before, transitionVerification: verdict,
      transitionVerificationStatus: verdict?.status ?? status} : {...before, status: verdict?.status ?? status,
      annotation: verdict, prefixVerified: Boolean(verdict), verificationStatus: verdict?.status ?? status};
    if (mode === "verify" && verdict && before.discovery &&
        ["fact", "transition", "narrativePhase", "frame", "depiction", "action"].some(field => verdict[field] !== before.discovery[field])) {
      row.playbackDisposition = "prefix-disagreement";
    }
    const merged = mergeTransitionVerdict(row.annotation, row.transitionVerification);
    row.effectiveAnnotation = merged.annotation;
    row.transitionFlag = merged.flag;
    decisions.set(id, row);
  }
  async function execute(windows, stage) {
    const attempts = new Map();
    const results = await executeWholeStoryContextPlan({windows}, {signal, maxAttempts: windows.length,
      maxRetries: 0, serialWithinRun: true,
      request: async window => {
        const mode = stage === "discovery" ? stage : window.id.split(":", 1)[0];
        const started = performance.now();
        const record = {mode, id: window.id, status: "budget-deferred", targetIds: window.targetIds,
          contextIds: window.contextIds};
        telemetry.push(record);
        attempts.set(window.id, record);
        const payload = inputFor(window);
        const submitted = new Set(payload.units.map(({id}) => id));
        if (mode === "verify") {
          const id = window.targetIds[0];
          storePrefixResult(mode, id, undefined, "verification-deferred");
        }
        if (signal.aborted || now() >= grant.expiresAt || ![...submitted].every(id => approved.has(id))) {
          record.status = "cancelled";
          return {status: "failed"};
        }
        if (invalidated(window)) {
          record.status = "refusal-dependent";
          return {status: "failed"};
        }
        const attested = mode !== "discovery" && verificationContext === "attested" ?
          attest({runId: window.runId, firstId: payload.units[0].id, target: window.targetIds[0]}) : [];
        const request = {mode, units: payload.units, targetIds: window.targetIds, ...(attested.length ? {attested} : {})};
        const settle = budget.reserve(JSON.stringify(request), window.targetIds.length);
        if (!settle) return {status: "failed"};
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
          return {status: "failed"};
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
          refusedRuns.add(window.runId);
          record.status = "provider-refused";
          return {status: "refused"};
        }
        if (answer?.status !== "ok") {
          record.status = ["incomplete", "invalid-response", "transient", "failed", "cancelled", "timed-out",
            "invalid-request"].includes(answer?.status) ? answer.status : "failed";
          return {status: "failed"};
        }
        const byTarget = new Map(Array.isArray(answer.facts) ? answer.facts.map(fact => [fact?.unitId, fact]) : []);
        if (answer.facts?.length !== window.targetIds.length || byTarget.size !== window.targetIds.length ||
            !window.targetIds.every(id => validateFact(byTarget.get(id), submitted, id, mode, attested))) {
          record.status = "invalid-response";
          record.failureReason = "rejected-fact-contract";
          return {status: "failed"};
        }
        record.status = "returned";
        if (mode !== "discovery" && !signal.aborted) storePrefixResult(mode, window.targetIds[0], byTarget.get(window.targetIds[0]), "returned");
        return {status: "annotated", annotations: window.targetIds.map(id => ({...byTarget.get(id), id}))};
      }});
    const byId = new Map(results.windows.map(result => [result.id, result]));
    return windows.map(window => ({window, result: byId.get(window.id),
      status: invalidated(window) && attempts.get(window.id)?.status !== "provider-refused" ? "refusal-dependent" :
        ["cancelled", "refusal-dependent"].includes(byId.get(window.id).status) ? byId.get(window.id).status :
          attempts.get(window.id)?.status ?? byId.get(window.id).status}));
  }
  if (provider && discovery.length) {
    const priority = [], important = [], routine = [], controls = [], proposals = new Map(), transitionJobs = [];
    const discoveries = await execute(discovery, "discovery");
    for (const {window, result, status} of discoveries) {
      if (status === "returned") for (const fact of result.annotations) proposals.set(fact.unitId, {fact, runId: window.runId});
    }
    for (const {window, result, status} of discoveries) {
      for (const id of window.targetIds) {
        decisions.set(id, {status, window, discoveryStatus: status});
        if (invalidated(window)) continue;
        if (nativeTargets.has(id)) priority.push(prefixJob(window, id, index, prefixUnits));
        else if (verifyTransitions && ["incomplete", "invalid-response"].includes(status) &&
            (id === window.targetIds[0] || negativeStride && id % negativeStride === 0)) {
          controls.push(prefixJob(window, id, index, prefixUnits));
        }
        if (verifyTransitions) transitionJobs.push({id, window,
          rank: transitionPriority(index.units[id], proposals.get(id)?.fact, typedTargets.has(id))});
      }
      if (status !== "returned") continue;
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
    for (const {id, window} of transitionJobs.sort((a, b) => b.rank - a.rank || a.id - b.id).slice(0, maxTransitionVerification)) {
      verification.push(prefixJob(window, id, index, prefixUnits, "transition"));
    }
    // Both model passes see only their own prefix and earlier attestations.
    // Finish both checks at a unit before exposing a merged earlier fact.
    verification.sort((a, b) => a.targetIds[0] - b.targetIds[0] || Number(a.id.startsWith("transition:")) -
      Number(b.id.startsWith("transition:")));
    for (let start = 0; start < verification.length; start += MAX_WHOLE_STORY_REQUESTS) {
      for (const {window, result, status} of await execute(verification.slice(start, start + MAX_WHOLE_STORY_REQUESTS), "prefix")) {
        storePrefixResult(window.id.split(":", 1)[0], window.targetIds[0],
          status === "returned" ? result.annotations[0] : undefined, status);
      }
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
  }
  const playback = planStory(id, playbackInputs(index, decisions, blocked));
  const units = index.units.map((unit, i) => {
    const [profile, trace] = playback[i];
    const {status, annotation, effectiveAnnotation, discovery, discoveryStatus, verificationStatus, transitionVerification,
      transitionVerificationStatus, transitionFlag, playbackDisposition, prefixVerified, cue} = decisions.get(unit.id);
    const {unitId: _target, id: _transportId, ...labels} = annotation ?? {};
    const {unitId: _discoveryTarget, id: _discoveryTransportId, ...provisionalLabels} = discovery ?? {};
    return {id: unit.id, unitSha256: unit.digest, ...labels, status, playbackStatus: "computed",
      pattern: profile.pattern, phase: profile.phase_used, beatId: trace.beat, sceneId: trace.scene,
      knownAt: trace.knownAt, evidenceIds: trace.evidence, labelKnownAt: annotation ? unit.id : null,
      labelEvidenceIds: annotation?.evidenceIds ?? [], trace, playbackDisposition, prefixVerified: Boolean(prefixVerified), cue,
      discovery: discovery ? provisionalLabels : undefined,
      discoveryStatus: discoveryStatus ?? status,
      transitionVerification, transitionVerificationStatus: transitionVerificationStatus ?? (verifyTransitions ? "not-requested" : undefined),
      transitionEvidenceIds: transitionVerification?.evidenceIds,
      transitionFlag, appliedTransition: (effectiveAnnotation ?? annotation)?.transition,
      verificationStatus: verificationStatus ?? (status === "verification-deferred" ? status : undefined)};
  });
  const outcomes = Object.fromEntries(Object.entries(Object.groupBy(telemetry, row => row.status))
    .map(([status, rows]) => [status, rows.length]));
  const nativeVerification = verificationTargets.map(id => ({id,
    status: decisions.get(id).verificationStatus ?? decisions.get(id).status}));
  return {id, sourceSha256, editionDigest, segmentationVersion, rubricVersion: LUNA_PROTOCOL_RUBRIC_VERSION,
    arm, verificationContext, verifyTransitions, units,
    summary: {plan: plan.summary, discoveryWindows: discovery.length, outcomes, attempts: telemetry, nativeVerification,
      budget: budget.snapshot()}};
}
