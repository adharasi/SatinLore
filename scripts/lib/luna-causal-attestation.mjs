import {applyFrameScope, crossesCurrentFrame, elapsedContinuityGap, exactCurrentCue, freshEnactedStart,
  verifiedContextCut} from "./luna-transition-verification.mjs";

const exits = new Set(["cut", "neutralize", "protective", "beat-end"]);
const endings = new Set(["scene-cut", "chapter-end", "memory-entry", "imagined-entry", "reported-entry",
  "present-return", "hard-stop", "declined-restart", "beat-end", "uncertain-continuity"]);
const rises = new Set(["build", "onset", "rebuild", "sustain", "peak"]);
const actions = new Set(["anticipation", "contact", "continuation", "change"]);
const frames = new Set(["current", "remembered", "imagined", "reported", "mixed"]);
const MAX_ANCHOR_DISTANCE = 256;

// This ledger advances only as an individual cleared run verifies targets in
// source order. It carries typed attestations, never earlier source bytes.
export function createCausalAttestationLedger(decisions, blocked, maxAttested, units) {
  const runs = new Map();
  return ({runId, firstId, target}) => {
    if (!runs.has(runId)) runs.set(runId, {cursor: runId, anchors: [], frame: null, scope: null,
      barrierId: -1, needsRestart: false, protectedScopes: new Set()});
    const run = runs.get(runId);
    if (target < run.cursor) throw new Error("Verification must advance in source order.");
    for (; run.cursor < target; run.cursor++) {
      const id = run.cursor;
      const row = decisions.get(id);
      const annotation = applyFrameScope(row?.effectiveAnnotation ?? row?.annotation, run.frame, run.scope);
      const verified = row?.prefixVerified || row?.transitionVerification?.status === "verified";
      if (blocked.has(id) || row?.window?.runId !== runId || !annotation ||
          !["verified", "neutral", "candidate"].includes(annotation.status) || annotation.frame === "uncertain" ||
          annotation.narrativePhase === "unknown" && !verified) {
        run.anchors = [];
        run.barrierId = id;
        if (blocked.has(id)) run.needsRestart = true;
        continue;
      }
      if (!verified) continue;
      const {frame, scopeId, action, narrativePhase, fact, transition, status, evidenceIds} = annotation;
      const rawCue = row.prefixVerified ? row.annotation : null;
      const elapsedGap = elapsedContinuityGap(units[id], rawCue, annotation, run.anchors.at(-1)?.unitId);
      const independentScope = scopeId === id && run.scope !== null && scopeId !== run.scope;
      const frameChange = frames.has(frame) && crossesCurrentFrame(frame, run.frame);
      const contextCut = verifiedContextCut(annotation, id);
      const cut = contextCut || frameChange || independentScope && !run.needsRestart;
      const barrier = exits.has(fact) || endings.has(transition) || cut || elapsedGap;
      if (barrier) {
        run.anchors = [];
        run.barrierId = id;
      }
      if (frames.has(frame)) run.frame = frame;
      if (scopeId != null) run.scope = scopeId;
      if (fact === "protective" && scopeId != null) run.protectedScopes.add(scopeId);
      if (fact === "protective" || transition === "hard-stop" || transition === "declined-restart") run.needsRestart = true;
      else if (contextCut) run.needsRestart = false;
      const restart = freshEnactedStart(rawCue, id);
      // A hard exit never acts as an independent anchor. An ordinary cut can
      // also establish a new low cue on its own verified target.
      if (status !== "verified" || frame !== "current" || !exactCurrentCue(rawCue, id) ||
          run.protectedScopes.has(scopeId) || run.needsRestart && !restart || elapsedGap ||
          ["neutralize", "protective", "beat-end"].includes(fact) ||
          ["hard-stop", "declined-restart", "uncertain-continuity", "beat-end", "interruption",
            "non-romantic-activity-stop", "span-end"].includes(transition) ||
          !evidenceIds.includes(id) || !cut && !restart && evidenceIds.some(id => id <= run.barrierId) ||
          !(fact === "low" || fact === "none" && rises.has(narrativePhase) && actions.has(action))) continue;
      run.anchors.push({unitId: id, scopeId: scopeId ?? id, frame, action, narrativePhase});
      run.needsRestart = false;
    }
    run.anchors = run.anchors.filter(({unitId}) => target - unitId <= MAX_ANCHOR_DISTANCE);
    return run.anchors.filter(({unitId}) => unitId < firstId).slice(-maxAttested);
  };
}
