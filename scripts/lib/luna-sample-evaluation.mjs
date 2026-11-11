import {buildReferenceCorpus} from "./beat-continuity-evaluation.mjs";
import {LUNA_PROTOCOL_ENUMS, LUNA_PROTOCOL_MODEL, LUNA_PROTOCOL_RUBRIC_VERSION} from "./luna-protocol-provider.mjs";
import {projectTypedTransition} from "./luna-transition-verification.mjs";

const digest = /^[a-f0-9]{64}$/u;
const modes = new Set(["discovery", "verify", "transition", "cue-check"]);
const dispositions = new Set(["candidate", "verified", "neutral", "classified", "partial", "uncertain", "abstain",
  "withheld", "unavailable", "unverified", "failed", "missing", "not-admitted", "structural", "budget-deferred",
  "provider-unavailable", "complete-arm-ineligible", "provider-refused", "refusal-dependent", "incomplete",
  "invalid-response", "transient", "cancelled", "timed-out", "invalid-request", "verification-deferred",
  "not-requested", "not-needed", "not-recorded", "not-dispatched", "unconfirmed", "blocked", "expired", "completed", "returned"]);
const transitions = new Set(LUNA_PROTOCOL_ENUMS.transition.filter(value => value !== "unknown"));
const activePhases = new Set(["build", "onset", "rebuild", "sustain", "peak"]);
const enacted = new Set(["contact", "change"]);
const validResults = new Set(["verified", "neutral", "classified"]);
const sceneBoundaryStatuses = new Set(["none", "uncertain", "cut"]);
const sceneBoundaryReasons = new Set(["none", "unclear", "time-jump", "setting-shift", "objective-shift", "explicit-break"]);
const cueGuards = new Set(["cue-boundary-suppressed", "cue-frame-ineligible", "cue-target-uncited", "cue-restart-unconfirmed",
  "cue-restart-required", "cue-stale-evidence"]);
const playbackDispositions = new Set(["repeated-decline", "duplicate-frame-entry", "duplicate-frame-return", "unattested-scope",
  "continuation-scope-alias", "prefix-disagreement"]);
const hardPatterns = new Set(["Stop", "Reset", "Divider"]);
const approvedPatterns = new Set(["Baseline", "Undertone", "Gradual build", "Deepening build", "Onset rise", "Rebuild rise",
  "Sustain wave", "Deep sustain", "Crest approach", "Crest", "Taper", "Recovery", "Hold", ...hardPatterns]);
const playbackPhases = new Set(["quiet", "build", "onset", "rebuild", "sustain", "ease", "recover", "peak"]);
const ratio = (part, total) => total ? part / total : null;
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const disposition = (...values) => values.find(value => dispositions.has(value)) ?? "not-recorded";
const referenceResolved = value => value !== null && value !== "unknown" && value !== "uncertain";

function pinnedTargets(ids, gold) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isSafeInteger(id) || !gold.has(id) || gold.get(id).structural)) {
    throw new TypeError("Invalid sample target roster.");
  }
  return ids;
}

export function buildLunaSampleReference(source, labels, roster) {
  if (roster?.schema !== "luna-v13-review-roster-v1" || !Array.isArray(roster.works) || !roster.works.length ||
      roster.works.some(work => !work || typeof work.id !== "string" || work.id !== work.id.toLowerCase() ||
        !digest.test(work.sourceSha256 ?? "") || !digest.test(work.editionDigest ?? ""))) {
    throw new TypeError("Invalid sample roster pins.");
  }
  const reference = buildReferenceCorpus(source, labels, {storyIds: roster.works.map(work => work.id)});
  return reference.works.map((work, i) => {
    const {sourceSha256, editionDigest, targetIds, transitionTargetIds, stressTargetIds = []} = roster.works[i];
    if (sourceSha256 !== work.sourceSha256) throw new TypeError("Sample roster source edition differs.");
    const gold = new Map(work.units.map(unit => [unit.id, unit]));
    return {id: work.id, sourceSha256, editionDigest, gold,
      cueIds: pinnedTargets(targetIds, gold), transitionIds: pinnedTargets(transitionTargetIds, gold),
      stressIds: new Set(pinnedTargets(stressTargetIds, gold))};
  });
}

function indexPredictions(reference, candidate, loom) {
  const pins = new Map(reference.map(work => [work.id, work]));
  if (!Array.isArray(candidate?.works)) throw new TypeError("Invalid sampled prediction works.");
  const indexed = new Map();
  for (const work of candidate.works) {
    const pin = pins.get(work?.id);
    if (!pin && loom) continue; // A saved Loom baseline may include additional pinned editions.
    if (!pin || indexed.has(work.id) || pin.sourceSha256 !== work.sourceSha256 ||
        (!loom && pin.editionDigest !== work.editionDigest) || !Array.isArray(work.units)) {
      throw new TypeError("Sample prediction edition differs.");
    }
    const rows = new Map();
    for (const row of work.units) {
      if (!row || rows.has(row.id) || pin.gold.get(row.id)?.unitSha256 !== row.unitSha256) {
        throw new TypeError("Sample prediction unit identity differs.");
      }
      rows.set(row.id, row);
    }
    const attempts = new Map();
    for (const attempt of work.summary?.attempts ?? []) {
      if (!modes.has(attempt.mode) || attempt.supportingPrefix || !Array.isArray(attempt.targetIds)) continue;
      for (const id of attempt.targetIds) attempts.set(`${attempt.mode}:${id}`, attempt);
    }
    indexed.set(work.id, {rows, attempts});
  }
  for (const clip of candidate.clips ?? []) {
    if (!clip || !pins.has(clip.storyId) || !Array.isArray(clip.targetIds)) throw new TypeError("Invalid sample clip outcome.");
    const work = indexed.get(clip.storyId) ?? {rows: new Map(), attempts: new Map()};
    work.clipStatuses ??= new Map();
    for (const id of clip.targetIds) {
      if (!pins.get(clip.storyId).gold.has(id) || work.clipStatuses.has(id)) {
        throw new TypeError("Sample clip target differs or is duplicated.");
      }
      work.clipStatuses.set(id, clip.status === "spend-cap" ? "budget-deferred" : disposition(clip.status));
    }
    indexed.set(clip.storyId, work);
  }
  return indexed;
}

function rawCue(fact, id) {
  if (fact?.status === "neutral") return false;
  if (fact?.status !== "verified" || ["uncertain", "mixed"].includes(fact.frame) ||
      fact.narrativePhase === "unknown" || fact.action === "unknown") return null;
  return fact.frame === "current" && activePhases.has(fact.narrativePhase) && enacted.has(fact.action) &&
    Array.isArray(fact.evidenceIds) && fact.evidenceIds.includes(id);
}

function rawTransition(fact, id) {
  const projected = projectTypedTransition(fact);
  if (projected?.status === "neutral" && projected.transition === "none") return "none";
  return projected?.status === "verified" && transitions.has(projected.transition) &&
    Array.isArray(projected.evidenceIds) && projected.evidenceIds.includes(id) ? projected.transition : null;
}

function stageDisposition(fact, status, attempt, row, clip) {
  if (!fact && status === "not-requested" && !attempt && !validResults.has(row?.status)) {
    return disposition(row?.status, clip, status);
  }
  return disposition(fact?.status, status, attempt?.status, row?.status, clip);
}

function rowObservation(work, id, lane) {
  const row = work?.rows.get(id);
  const prefix = work?.attempts.get(`verify:${id}`);
  const typed = work?.attempts.get(`transition:${id}`);
  const clip = work?.clipStatuses?.get(id);
  switch (lane) {
    case "rawCue":
      return {value: rawCue(row?.primaryPrefix, id), dispatched: prefix?.attempted === true,
        status: stageDisposition(row?.primaryPrefix, row?.verificationStatus, prefix, row, clip)};
    case "appliedCue":
      return {value: typeof row?.cue === "boolean" ? row.cue : null,
        status: disposition(row?.status, clip)};
    case "typedTransition":
      return {value: rawTransition(row?.transitionVerification, id), dispatched: typed?.attempted === true,
        status: stageDisposition(projectTypedTransition(row?.transitionVerification), row?.transitionVerificationStatus, typed, row, clip)};
    case "appliedTransition":
      return {value: transitions.has(row?.appliedTransition) ? row.appliedTransition : null,
        status: disposition(row?.status, clip)};
    case "compiledPattern":
      return {value: row?.playbackStatus === "computed" && approvedPatterns.has(row.pattern) ? row.pattern : null,
        status: disposition(row?.status, clip)};
    case "compiledPhase":
      return {value: row?.playbackStatus === "computed" && playbackPhases.has(row.phase) ? row.phase : null,
        status: disposition(row?.status, clip)};
    case "loomCue": {
      const projected = row?.applied?.causal?.activation;
      const value = typeof row?.cue === "boolean" ? row.cue :
        projected === "cue" ? true : projected === "context" ? false : null;
      return {value: validResults.has(row?.status) ? value : null, status: disposition(row?.status, clip)};
    }
  }
  throw new TypeError("Unknown sample score lane.");
}

const lanes = {
  rawCue: {gold: "cue", selection: "cue", negative: false, dispatch: true},
  appliedCue: {gold: "cue", selection: "cue", negative: false},
  typedTransition: {gold: "transition", selection: "transition", negative: "none", dispatch: true},
  appliedTransition: {gold: "transition", selection: "transition", negative: "none"},
  compiledPattern: {gold: "pattern", selection: "playback", negative: "Baseline"},
  compiledPhase: {gold: "phase", selection: "playback"},
  loomCue: {gold: "cue", selection: "cue", negative: false},
};

function emptyScore() {
  return {planned: 0, usable: 0, dispatched: 0, knownReference: 0, usableKnownReference: 0, exact: 0,
    goldPositives: 0, usableGoldPositives: 0, predictedPositives: 0, matched: 0, dispositions: new Map()};
}

function scoreRow(score, expected, observed, lane) {
  score.planned++;
  score.dispatched += Number(observed.dispatched === true);
  score.usable += Number(observed.value !== null);
  count(score.dispositions, observed.status);
  if (!referenceResolved(expected)) return;
  score.knownReference++;
  score.usableKnownReference += Number(observed.value !== null);
  score.exact += Number(observed.value === expected);
  if (!Object.hasOwn(lane, "negative")) return;
  score.goldPositives += Number(expected !== lane.negative);
  score.usableGoldPositives += Number(expected !== lane.negative && observed.value !== null);
  score.predictedPositives += Number(observed.value !== null && observed.value !== lane.negative);
  score.matched += Number(expected !== lane.negative && observed.value === expected);
}

function metrics(score, lane) {
  const {planned, usable, dispatched, knownReference, usableKnownReference, exact, goldPositives, usableGoldPositives,
    predictedPositives, matched, dispositions} = score;
  return {planned, usable, ...(lane.dispatch ? {dispatched} : {}),
    usableCoverage: ratio(usable, planned), knownReference, unresolvedReference: planned - knownReference, usableKnownReference, exact,
    effectiveExactAccuracy: ratio(exact, knownReference), usableExactAccuracy: ratio(exact, usableKnownReference),
    ...(Object.hasOwn(lane, "negative") ? {goldPositives, usableGoldPositives, predictedPositives, matched,
      missed: goldPositives - matched, extra: predictedPositives - matched, precision: ratio(matched, predictedPositives),
      effectiveRecall: ratio(matched, goldPositives), usableRecall: ratio(matched, usableGoldPositives)} : {}),
    dispositions: Object.fromEntries(dispositions)};
}

function panelIds(work, selection, stress) {
  const ids = selection === "cue" ? work.cueIds : selection === "transition" ? work.transitionIds :
    [...new Set([...work.cueIds, ...work.transitionIds, ...work.stressIds])];
  return ids.filter(id => work.stressIds.has(id) === stress);
}

function discrepancyContext(work, gold, lane) {
  const row = work?.rows.get(gold.id);
  const mode = lane === "typedTransition" ? "transition" : "verify";
  const attempt = work?.attempts.get(`${mode}:${gold.id}`);
  const contextIds = attempt?.attempted && Array.isArray(attempt.contextIds) ?
    new Set([gold.id, ...attempt.contextIds, ...(Array.isArray(attempt.attestedIds) ? attempt.attestedIds : [])]) : null;
  const referenceEvidenceOutsidePrefix = contextIds && lane !== "loomCue" ? gold.evidenceIds.filter(id => !contextIds.has(id)) : null;
  if (!row && !contextIds) return {};
  const primary = row?.primaryPrefix;
  const typed = row?.transitionVerification;
  const independentTransition = rawTransition(typed, gold.id);
  return {referenceNarrativePhase: gold.narrativePhase, referenceEvidenceOutsidePrefix,
    ...(LUNA_PROTOCOL_ENUMS.action.includes(primary?.action) ? {primaryAction: primary.action} : {}),
    ...(LUNA_PROTOCOL_ENUMS.fact.includes(primary?.fact) ? {primaryFact: primary.fact} : {}),
    ...(transitions.has(primary?.transition) ? {primaryTransition: primary.transition} : {}),
    ...(independentTransition !== null ? {independentTransition} : {}),
    ...(typed?.sceneBoundary && transitions.has(typed.transition) ? {independentLocalTransition: typed.transition} : {}),
    ...(sceneBoundaryStatuses.has(typed?.sceneBoundary?.status) ? {independentSceneBoundary: typed.sceneBoundary.status} : {}),
    ...(sceneBoundaryReasons.has(typed?.sceneBoundary?.reason) ? {sceneBoundaryReason: typed.sceneBoundary.reason} : {}),
    ...(cueGuards.has(row?.cueGuard) ? {cueGuard: row.cueGuard} : {}),
    ...(playbackDispositions.has(row?.playbackDisposition) ? {playbackDisposition: row.playbackDisposition} : {})};
}

export function scoreLunaSample(reference, candidate, {loom, includeDiscrepancies = false} = {}) {
  const indexed = indexPredictions(reference, candidate, false);
  const baseline = loom ? indexPredictions(reference, loom, true) : null;
  const definitions = Object.entries(lanes).filter(([name]) => name !== "loomCue" || baseline);
  const panels = [["sample", false], ["stress", true]];
  const totals = new Map(panels.map(([panel]) => [panel, new Map(definitions.map(([name]) => [name, emptyScore()]))]));
  const discrepancies = [];
  const works = reference.map(work => ({
    id: work.id, sourceSha256: work.sourceSha256, editionDigest: work.editionDigest,
    panels: Object.fromEntries(panels.map(([panel, stress]) => [panel, Object.fromEntries(definitions.map(([name, lane]) => {
      const local = emptyScore();
      for (const id of panelIds(work, lane.selection, stress)) {
        const gold = work.gold.get(id);
        const expected = gold[lane.gold];
        const predictions = (name === "loomCue" ? baseline : indexed).get(work.id);
        const observed = rowObservation(predictions, id, name);
        scoreRow(local, expected, observed, lane);
        scoreRow(totals.get(panel).get(name), expected, observed, lane);
        if (includeDiscrepancies && observed.value !== expected) {
          discrepancies.push({storyId: work.id, unitId: id, panel, lane: name, expected, observed: observed.value,
            status: observed.status, referenceResolved: referenceResolved(expected), ...discrepancyContext(predictions, gold, name)});
        }
      }
      return [name, metrics(local, lane)];
    }))])),
  }));
  return {measurement: "unweighted-frozen-sample-diagnostic", sourceProseIncluded: false,
    candidateProvenance: {measurement: candidate.measurement === "live-corpus-luna" ? "live-corpus-luna" : null,
      model: candidate.model === LUNA_PROTOCOL_MODEL ? candidate.model : null,
      rubricVersion: ["nocturne-luna-protocol-v13", "nocturne-luna-protocol-v14", "nocturne-luna-protocol-v15", "nocturne-luna-protocol-v16",
        "nocturne-luna-protocol-v17", "nocturne-luna-protocol-v18", LUNA_PROTOCOL_RUBRIC_VERSION]
        .includes(candidate.rubricVersion) ? candidate.rubricVersion : null},
    summary: Object.fromEntries(panels.map(([panel]) => [panel, Object.fromEntries(definitions.map(([name, lane]) =>
      [name, metrics(totals.get(panel).get(name), lane)]))])),
    works, ...(includeDiscrepancies ? {discrepancies} : {})};
}

export function compareLunaSamples(reference, baseline, candidate) {
  const left = indexPredictions(reference, baseline, false), right = indexPredictions(reference, candidate, false);
  const definitions = Object.entries(lanes).filter(([name]) => name !== "loomCue");
  return Object.fromEntries([["sample", false], ["stress", true]].map(([panel, stress]) => [panel,
    Object.fromEntries(definitions.map(([name, lane]) => {
      const counts = {knownTargets: 0, commonUsable: 0, gainedUsable: 0, lostUsable: 0, baselineExact: 0,
        candidateExact: 0, improved: 0, regressed: 0};
      const positives = {commonGoldPositives: 0, baselineMatches: 0, candidateMatches: 0, baselineExtras: 0, candidateExtras: 0};
      for (const work of reference) for (const id of panelIds(work, lane.selection, stress)) {
        const expected = work.gold.get(id)[lane.gold];
        if (!referenceResolved(expected)) continue;
        const before = rowObservation(left.get(work.id), id, name).value;
        const after = rowObservation(right.get(work.id), id, name).value;
        counts.knownTargets++;
        if (before === null) counts.gainedUsable += Number(after !== null);
        else if (after === null) counts.lostUsable++;
        else {
          counts.commonUsable++;
          const hadMatch = before === expected, hasMatch = after === expected;
          counts.baselineExact += Number(hadMatch);
          counts.candidateExact += Number(hasMatch);
          counts.improved += Number(!hadMatch && hasMatch);
          counts.regressed += Number(hadMatch && !hasMatch);
          if (Object.hasOwn(lane, "negative")) {
            positives.commonGoldPositives += Number(expected !== lane.negative);
            positives.baselineMatches += Number(expected !== lane.negative && hadMatch);
            positives.candidateMatches += Number(expected !== lane.negative && hasMatch);
            positives.baselineExtras += Number(before !== lane.negative && !hadMatch);
            positives.candidateExtras += Number(after !== lane.negative && !hasMatch);
          }
        }
      }
      return [name, {...counts, ...(Object.hasOwn(lane, "negative") ? positives : {})}];
    }))]));
}
