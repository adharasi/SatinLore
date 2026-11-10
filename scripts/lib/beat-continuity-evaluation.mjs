import {createHash} from "node:crypto";

export const D2_DEVELOPMENT_COHORT = Object.freeze(Array.from({length: 10}, (_, i) => `d2-${String(i + 1).padStart(2, "0")}`));

const DIGEST = /^[0-9a-f]{64}$/;
const STORY_ID = /^[a-z][a-z0-9-]{0,63}$/;
const CLEAR_GATE = "No blocking event recorded";
const ABSENT = "unobserved";
const HARD_PROFILES = new Set(["Stop", "Reset", "Divider"]);
const PROFILES = new Set(["Baseline", "Undertone", "Gradual build", "Deepening build", "Onset rise",
  "Rebuild rise", "Sustain wave", "Deep sustain", "Crest approach", "Crest", "Taper", "Recovery", "Hold", ...HARD_PROFILES]);
const PHASES = new Set(["quiet", "build", "onset", "rebuild", "sustain", "ease", "recover", "peak", "unknown", "structural"]);
const TRANSITIONS = new Set(["none", "onset", "accent", "ease", "recover", "restart", "interruption", "span-end",
  "beat-end", "scene-cut", "chapter-end", "hard-stop", "memory-entry", "imagined-entry", "reported-entry",
  "present-return", "uncertain-continuity", "declined-restart", "non-romantic-activity-stop", "unknown"]);
const CATEGORIES = {
  depiction: new Set(["neutral", "romantic", "suggestive", "overt-sexual", "explicit", "graphic", "unknown"]),
  frame: new Set(["current", "remembered", "imagined", "reported", "mixed", "uncertain", "neutral"]),
  narrativePhase: PHASES,
  phase: PHASES,
  transition: TRANSITIONS,
  pattern: PROFILES,
};
const UNRESOLVED = new Set(["unknown", "uncertain"]);
const OBSERVED = new Set(["candidate", "verified", "neutral", "classified", "partial"]);
const STATUSES = new Set([...OBSERVED, "uncertain", "abstain", "withheld", "unavailable", "unverified", "failed",
  "missing", "not-admitted", "structural", "budget-deferred", "provider-unavailable", "complete-arm-ineligible",
  "provider-refused", "refusal-dependent", "incomplete", "invalid-response", "transient", "cancelled", "timed-out",
  "invalid-request", "verification-deferred"]);
const DIMENSIONS = new Set([...Object.keys(CATEGORIES), "cue", "knownAt", "transitionKnownAt", "evidenceIds",
  "beatId", "sceneId", "outputLevel"]);
const PLAYBACK = new Set(["pattern", "phase", "knownAt", "evidenceIds", "beatId", "sceneId", "outputLevel"]);

const ratio = (a, b) => b ? a / b : null;
const validId = id => Number.isSafeInteger(id) && id >= 0;
const textDigest = text => createHash("sha256").update(text, "utf8").digest("hex");
const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const aboveBaseline = pattern => PROFILES.has(pattern) && pattern !== "Baseline" && !HARD_PROFILES.has(pattern);
const storyId = id => typeof id === "string" && STORY_ID.test(id.toLowerCase()) ? id.toLowerCase() : null;

function indexWorks(doc, name) {
  if (!Array.isArray(doc?.works)) throw new TypeError(`Invalid ${name} works.`);
  const works = new Map();
  for (const work of doc.works) {
    const id = storyId(work?.id);
    if (!id || works.has(id) || !DIGEST.test(work.sourceSha256 ?? "") || !Array.isArray(work.units)) {
      throw new TypeError(`Invalid ${name} work identity.`);
    }
    works.set(id, work);
  }
  return works;
}

function indexUnits(work, name) {
  const units = new Map();
  for (const unit of work.units) {
    if (!validId(unit?.id) || units.has(unit.id)) throw new TypeError(`Invalid ${name} unit identity in ${work.id}.`);
    units.set(unit.id, unit);
  }
  return units;
}

function referenceTransition(label) {
  if (label.v9Effect === "hard-stop") return "hard-stop";
  if (label.v9Event === "stop" || label.v9Event === "natural-end") {
    return label.v9Effect === "ease" ? "ease" : "beat-end";
  }
  return label.v9Event;
}

/** Verify source coordinates and extract the approved comparison labels without retaining story text. */
export function buildReferenceCorpus(source, approved, {storyIds = D2_DEVELOPMENT_COHORT} = {}) {
  const sources = indexWorks(source, "source"), labels = indexWorks(approved, "approved");
  const ids = storyIds.map(storyId);
  if (!ids.length || ids.includes(null) || new Set(ids).size !== ids.length) throw new TypeError("Invalid comparison cohort.");
  return {
    cohort: ids,
    works: ids.map(id => {
      const sourceWork = sources.get(id), labelWork = labels.get(id);
      if (!sourceWork || !labelWork || sourceWork.sourceSha256 !== labelWork.sourceSha256) {
        throw new TypeError(`Source and approved edition do not match for ${id}.`);
      }
      const sourceUnits = indexUnits(sourceWork, "source"), labelUnits = indexUnits(labelWork, "approved");
      if (sourceUnits.size !== labelUnits.size) throw new TypeError(`Unit coverage differs in ${id}.`);
      const units = [];
      for (const [unitId, unit] of sourceUnits) {
        const label = labelUnits.get(unitId);
        const structural = unit.structuralBoundary === true;
        if (!label || typeof unit.text !== "string" || !validId(unit.paragraph) ||
            textDigest(unit.text) !== label.unitSha256 || structural !== (label.sourceRole === "structural")) {
          throw new TypeError(`Source identity differs at ${id}:${unitId}.`);
        }
        const trace = label.continuity, profile = label.v9Pattern;
        if (!trace || !profile || !Array.isArray(trace.evidence)) {
          throw new TypeError(`Missing approved continuity trace at ${id}:${unitId}.`);
        }
        const protectedReference = profile.gate !== CLEAR_GATE || trace.decision === "Eligibility gate" ||
          label.causalActivation === "protected";
        const cue = protectedReference || label.causalActivation === "context" ? false :
          label.causalActivation === "cue" ? true : null;
        const target = {id: unitId, unitSha256: label.unitSha256, paragraph: unit.paragraph, structural,
          depiction: label.v9Depiction === "overt sexual" ? "overt-sexual" : label.v9Depiction,
          frame: label.v9Frame, narrativePhase: label.v9Phase, phase: profile.phase_used,
          transition: referenceTransition(label), transitionKnownAt: label.v9EventKnownAt,
          pattern: profile.pattern, beatId: trace.beat, sceneId: trace.scene, knownAt: trace.knownAt,
          evidenceIds: [...trace.evidence].sort((a, b) => a - b), cue, protectedReference,
          legacyCue: label.causalActivation === "cue",
          legacyCueKnown: ["cue", "context", "protected"].includes(label.causalActivation),
          hardAction: HARD_PROFILES.has(profile.pattern)};
        for (const [field, vocabulary] of Object.entries(CATEGORIES)) {
          if (!vocabulary.has(target[field])) throw new TypeError(`Unsupported approved ${field} at ${id}:${unitId}.`);
        }
        if ((target.knownAt !== null && (!validId(target.knownAt) || target.knownAt > unitId)) ||
            target.evidenceIds.some(evidence => !sourceUnits.has(evidence) || evidence > unitId) ||
            !validId(target.transitionKnownAt) || !sourceUnits.has(target.transitionKnownAt)) {
          throw new TypeError(`Invalid approved evidence coordinates at ${id}:${unitId}.`);
        }
        units.push(target);
      }
      units.sort((a, b) => a.id - b.id);
      return {id, sourceSha256: sourceWork.sourceSha256, units};
    }),
  };
}

function normalizeCandidate(reference, candidate) {
  const inputs = indexWorks(candidate, "candidate"), expectedWorks = new Map(reference.works.map(work => [work.id, work]));
  const observedFields = new Set();
  const predictions = new Map();
  for (const [id, work] of inputs) {
    const expected = expectedWorks.get(id);
    if (!expected || work.sourceSha256 !== expected.sourceSha256) throw new TypeError(`Candidate edition differs for ${id}.`);
    const expectedUnits = new Map(expected.units.map(unit => [unit.id, unit]));
    const rows = indexUnits(work, "candidate");
    for (const [unitId, row] of rows) {
      if (!expectedUnits.has(unitId) || row.unitSha256 !== expectedUnits.get(unitId).unitSha256) {
        throw new TypeError(`Candidate identity differs at ${id}:${unitId}.`);
      }
      if (!STATUSES.has(row.status ?? "verified") || row.playbackStatus != null &&
          row.playbackStatus !== "computed" && !STATUSES.has(row.playbackStatus)) {
        throw new TypeError(`Invalid candidate disposition at ${id}:${unitId}.`);
      }
      for (const dimension of DIMENSIONS) if (Object.hasOwn(row, dimension)) observedFields.add(dimension);
      for (const [field, vocabulary] of Object.entries(CATEGORIES)) {
        if (Object.hasOwn(row, field) && row[field] !== null && !vocabulary.has(row[field])) {
          throw new TypeError(`Invalid candidate ${field} at ${id}:${unitId}.`);
        }
      }
      if (row.cue != null && typeof row.cue !== "boolean" || row.outputLevel != null &&
          (!validId(row.outputLevel) || row.outputLevel > 20) ||
          [row.knownAt, row.transitionKnownAt].some(value => value != null && !validId(value)) ||
          [row.beatId, row.sceneId].some(value => value != null && !(typeof value === "string" && value.length <= 128)) ||
          row.evidenceIds != null && (!Array.isArray(row.evidenceIds) || !row.evidenceIds.every(validId) ||
            new Set(row.evidenceIds).size !== row.evidenceIds.length)) {
        throw new TypeError(`Invalid candidate trace at ${id}:${unitId}.`);
      }
    }
    predictions.set(id, rows);
  }
  const declared = candidate.dimensions;
  if (declared !== undefined && (!Array.isArray(declared) || declared.some(field => !DIMENSIONS.has(field)) ||
      declared.length !== new Set(declared).size || [...observedFields].some(field => !declared.includes(field)))) {
    throw new TypeError("Invalid declared candidate dimensions.");
  }
  return {predictions, dimensions: new Set(declared ?? observedFields)};
}

function newBinary() { return {matched: 0, missed: 0, extra: 0}; }
function tallyBinary(metric, expected, observed) {
  if (expected && observed) metric.matched++;
  else if (expected) metric.missed++;
  else if (observed) metric.extra++;
}
function binaryReport(metric) {
  const {matched, missed, extra} = metric;
  return {...metric, precision: ratio(matched, matched + extra), recall: ratio(matched, matched + missed)};
}

function newLabelCounts() {
  return {reference: 0, unresolvedReference: 0, observedOnUnresolvedReference: 0, observed: 0, exact: 0, confusion: new Map()};
}
function labelReport(counts) {
  const {reference, unresolvedReference, observedOnUnresolvedReference, observed, exact, confusion} = counts;
  const categories = [...confusion].map(([expected, counts]) => {
    const support = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const matched = counts.get(expected) ?? 0;
    const predicted = [...confusion.values()].reduce((sum, row) => sum + (row.get(expected) ?? 0), 0);
    return {label: expected, support, matched, predicted, f1: ratio(2 * matched, support + predicted)};
  });
  return {reference, unresolvedReference, observedOnUnresolvedReference, observed, exact, accuracy: ratio(exact, reference),
    accuracyWhenObserved: ratio(exact, observed), coverage: ratio(observed, reference),
    macroF1: ratio(categories.reduce((sum, category) => sum + category.f1, 0), categories.length), categories,
    confusion: Object.fromEntries([...confusion].map(([key, row]) => [key, Object.fromEntries(row)]))};
}

function emptyCounts(dimensions) {
  return {
    rows: 0, structuralRows: 0, status: new Map(), playbackRows: 0, eligibleReferenceCues: 0, legacyReferenceCues: 0,
    protectedReferenceRows: 0, hardActions: 0, outputObserved: 0, protectedPositiveOutput: 0,
    protectedActiveProfiles: 0, newProtectedActiveProfiles: 0, missedHardProfiles: 0, causalTraceViolations: 0,
    unresolvedCueReferences: 0,
    labels: Object.fromEntries([...dimensions].filter(field => Object.hasOwn(CATEGORIES, field)).map(field => [field, newLabelCounts()])),
    exactTrace: Object.fromEntries(["knownAt", "transitionKnownAt", "evidenceIds"].filter(field => dimensions.has(field))
      .map(field => [field, {total: 0, observed: 0, exact: 0}])),
    cues: newBinary(), coveredCues: newBinary(), legacyCues: newBinary(), legacyKnownRows: 0, observedCueRows: 0,
    cuesOnUnresolvedReference: 0, transitions: newBinary(),
    nearbyTransitions: newBinary(), structuralPattern: {reference: 0, observed: 0, exact: 0},
    beatLinks: newBinary(), sceneLinks: newBinary(), adjacentPairs: 0, beatPairsObserved: 0, scenePairsObserved: 0,
    shortDips: {reference: 0, observed: 0, matched: 0, comparableWindows: 0},
  };
}

function targetObserved(row, field) {
  if (!row || !Object.hasOwn(row, field)) return false;
  const status = PLAYBACK.has(field) ? row.playbackStatus ?? row.status : row.status;
  if (!OBSERVED.has(status ?? "verified") && status !== "computed" &&
      !(status === "structural" && field === "pattern")) return false;
  return row[field] !== null || ["knownAt", "beatId", "sceneId"].includes(field);
}

function recordRow(counts, gold, actual, dimensions, knownIds) {
  const reasons = [];
  const status = actual ? actual.status ?? "verified" : "missing";
  if (gold.structural) {
    counts.structuralRows++;
    if (dimensions.has("pattern")) {
      const observed = targetObserved(actual, "pattern");
      counts.structuralPattern.reference++;
      counts.structuralPattern.observed += Number(observed);
      counts.structuralPattern.exact += Number(observed && actual.pattern === gold.pattern);
      if (!observed || actual.pattern !== gold.pattern) reasons.push("structural-pattern:missed");
    }
    return reasons;
  }
  counts.rows++;
  counts.playbackRows += Number(targetObserved(actual, "pattern"));
  increment(counts.status, status);
  counts.eligibleReferenceCues += Number(gold.cue === true);
  counts.legacyReferenceCues += Number(gold.legacyCue);
  counts.legacyKnownRows += Number(gold.legacyCueKnown);
  counts.unresolvedCueReferences += Number(gold.cue === null);
  counts.protectedReferenceRows += Number(gold.protectedReference);
  counts.hardActions += Number(gold.hardAction);
  if (!OBSERVED.has(status)) reasons.push(`disposition:${status}`);
  for (const [field, stats] of Object.entries(counts.labels)) {
    const expected = gold[field];
    const observed = targetObserved(actual, field) && !UNRESOLVED.has(actual[field]) ? actual[field] : ABSENT;
    if (UNRESOLVED.has(expected)) {
      stats.unresolvedReference++;
      stats.observedOnUnresolvedReference += Number(observed !== ABSENT);
      continue;
    }
    stats.reference++;
    stats.observed += Number(observed !== ABSENT);
    stats.exact += Number(observed === expected);
    const row = stats.confusion.get(expected) ?? new Map();
    increment(row, observed);
    stats.confusion.set(expected, row);
    if (observed !== expected) reasons.push(observed === ABSENT ? `${field}:unobserved` : `${field}:mismatch`);
  }
  for (const [field, stats] of Object.entries(counts.exactTrace)) {
    if (field === "transitionKnownAt" && ["none", "unknown"].includes(gold.transition)) continue;
    stats.total++;
    if (!targetObserved(actual, field)) continue;
    stats.observed++;
    const value = field === "evidenceIds" ? [...actual[field]].sort((a, b) => a - b) : actual[field];
    const equal = field === "evidenceIds" ? gold[field].length === value.length &&
      gold[field].every((id, i) => id === value[i]) : gold[field] === value;
    stats.exact += Number(equal);
    if (!equal) reasons.push(`${field}:mismatch`);
  }
  if (dimensions.has("cue")) {
    const observed = targetObserved(actual, "cue");
    const positive = observed && actual.cue;
    if (gold.cue === null) {
      counts.cuesOnUnresolvedReference += Number(positive);
      if (positive) reasons.push("cue:unresolved-reference");
    } else {
      counts.observedCueRows += Number(observed);
      tallyBinary(counts.cues, gold.cue, positive);
      if (observed) tallyBinary(counts.coveredCues, gold.cue, positive);
      if (gold.cue && !positive) reasons.push(observed ? "cue:classified-negative" : `cue:missed-${status}`);
      if (!gold.cue && positive) reasons.push("cue:extra");
    }
    if (gold.legacyCueKnown) tallyBinary(counts.legacyCues, gold.legacyCue, positive);
  }
  if (dimensions.has("transition") && gold.transition !== "unknown") {
    const expected = gold.transition !== "none";
    const observed = targetObserved(actual, "transition") && !["none", "unknown"].includes(actual.transition);
    const matched = expected && observed && actual.transition === gold.transition;
    counts.transitions.matched += Number(matched);
    counts.transitions.missed += Number(expected && !matched);
    counts.transitions.extra += Number(observed && !matched);
    if (expected && !matched) reasons.push("typed-transition:missed");
    if (observed && !matched) reasons.push("typed-transition:extra");
  }
  if (targetObserved(actual, "outputLevel")) {
    counts.outputObserved++;
    if ((gold.protectedReference || gold.hardAction) && actual.outputLevel > 0) {
      counts.protectedPositiveOutput++;
      reasons.push("protected-positive-output");
    }
  }
  if (targetObserved(actual, "pattern") && gold.protectedReference && aboveBaseline(actual.pattern)) {
    counts.protectedActiveProfiles++;
    if (!aboveBaseline(gold.pattern)) {
      counts.newProtectedActiveProfiles++;
      reasons.push("new-protected-active-profile");
    }
  }
  if (dimensions.has("pattern") && gold.hardAction && (!targetObserved(actual, "pattern") || actual.pattern !== gold.pattern)) {
    counts.missedHardProfiles++;
    reasons.push("hard-profile:missed");
  }
  if (actual && (actual.knownAt != null && (!knownIds.has(actual.knownAt) || actual.knownAt > gold.id) ||
      actual.evidenceIds?.some(id => !knownIds.has(id) || id > gold.id || (actual.knownAt != null && id > actual.knownAt)))) {
    counts.causalTraceViolations++;
    reasons.push("causal-evidence:invalid");
  }
  return reasons;
}

function recordLinks(counts, before, gold, prior, actual, dimensions, reasons) {
  if (!before || before.structural || gold.structural || gold.id !== before.id + 1) return;
  counts.adjacentPairs++;
  for (const [field, pairCoverage, metric] of [["beatId", "beatPairsObserved", "beatLinks"],
    ["sceneId", "scenePairsObserved", "sceneLinks"]]) {
    if (!dimensions.has(field)) continue;
    const expected = gold[field] !== null && gold[field] === before[field];
    const covered = targetObserved(prior, field) && targetObserved(actual, field);
    counts[pairCoverage] += Number(covered);
    const linked = covered && actual[field] !== null && actual[field] === prior[field];
    tallyBinary(counts[metric], expected, linked);
    if (reasons && expected !== linked) reasons.push(`${field}-link:${expected ? "missed" : "extra"}`);
  }
}

// A sorted, one-to-one match for one event type avoids reusing nearby predictions.
function nearbyTransitions(work, predictions) {
  const expected = new Map(), observed = new Map();
  for (const unit of work.units) {
    if (unit.structural || unit.transition === "unknown") continue;
    if (unit.transition !== "none") {
      if (!expected.has(unit.transition)) expected.set(unit.transition, []);
      expected.get(unit.transition).push(unit.paragraph);
    }
    const prediction = predictions.get(unit.id);
    if (targetObserved(prediction, "transition") && !["none", "unknown"].includes(prediction.transition)) {
      if (!observed.has(prediction.transition)) observed.set(prediction.transition, []);
      observed.get(prediction.transition).push(unit.paragraph);
    }
  }
  const counts = newBinary();
  for (const kind of new Set([...expected.keys(), ...observed.keys()])) {
    const left = (expected.get(kind) ?? []).sort((a, b) => a - b);
    const right = (observed.get(kind) ?? []).sort((a, b) => a - b);
    let i = 0, j = 0, matched = 0;
    while (i < left.length && j < right.length) {
      if (left[i] < right[j] - 1) i++;
      else if (right[j] < left[i] - 1) j++;
      else { i++; j++; matched++; }
    }
    counts.matched += matched;
    counts.missed += left.length - matched;
    counts.extra += right.length - matched;
  }
  return counts;
}

function compareShortDips(work, predictions, dimensions) {
  const counts = {reference: 0, observed: 0, matched: 0, comparableWindows: 0};
  for (let i = 1; i + 1 < work.units.length; i++) {
    for (const size of [1, 2]) {
      const rows = work.units.slice(i - 1, i + size + 1);
      if (rows.length !== size + 2 || rows.some((row, k) => row.structural || row.id !== rows[0].id + k)) continue;
      const [first, last] = [rows[0], rows.at(-1)];
      // Reference beat membership avoids counting real cuts as dips and provides a stable comparison scope.
      if (first.beatId == null || first.beatId !== last.beatId || first.sceneId !== last.sceneId) continue;
      const isDip = labels => aboveBaseline(labels[0].pattern) && aboveBaseline(labels.at(-1).pattern) &&
        labels.slice(1, -1).every(row => row.pattern === "Baseline");
      const expected = isDip(rows);
      const actual = rows.map(row => predictions.get(row.id));
      const comparable = dimensions.has("pattern") && actual.every(row => targetObserved(row, "pattern"));
      const observed = comparable && isDip(actual);
      counts.reference += Number(expected);
      counts.comparableWindows += Number(comparable);
      counts.observed += Number(observed);
      counts.matched += Number(expected && observed);
    }
  }
  return counts;
}

function reportCounts(counts, dimensions, {withinWork = true} = {}) {
  const {rows, structuralRows, status, eligibleReferenceCues, legacyReferenceCues, protectedReferenceRows, hardActions,
    outputObserved, protectedPositiveOutput, protectedActiveProfiles, newProtectedActiveProfiles, missedHardProfiles,
    causalTraceViolations, unresolvedCueReferences, labels, exactTrace, cues, coveredCues, legacyCues, observedCueRows,
    transitions, nearbyTransitions: nearby, beatLinks, sceneLinks, adjacentPairs, beatPairsObserved, scenePairsObserved,
    structuralPattern, shortDips, playbackRows, legacyKnownRows, cuesOnUnresolvedReference} = counts;
  const observedRows = [...status].filter(([key]) => OBSERVED.has(key)).reduce((sum, [, count]) => sum + count, 0);
  return {
    rows, structuralRows, status: Object.fromEntries(status), observedRows, rowCoverage: ratio(observedRows, rows), playbackRows,
    eligibleReferenceCues, legacyReferenceCues, unresolvedCueReferences,
    labels: Object.fromEntries(Object.entries(labels).map(([field, value]) => [field, labelReport(value)])),
    trace: Object.fromEntries(Object.entries(exactTrace).map(([field, value]) => [field,
      {...value, accuracy: ratio(value.exact, value.total), accuracyWhenObserved: ratio(value.exact, value.observed)}])),
    cues: dimensions.has("cue") ? {effective: binaryReport(cues), observed: binaryReport(coveredCues),
      observedKnownRows: observedCueRows, knownRows: rows - unresolvedCueReferences,
      cuesOnUnresolvedReference, legacyRawAnchorComparison: {knownRows: legacyKnownRows, ...binaryReport(legacyCues)}} : null,
    typedTransitions: dimensions.has("transition") ? {exact: binaryReport(transitions),
      withinOneParagraph: withinWork ? binaryReport(nearby) : null} : null,
    continuity: {
      beat: withinWork && dimensions.has("beatId") ? {adjacentPairs, observed: beatPairsObserved, ...binaryReport(beatLinks)} : null,
      scene: withinWork && dimensions.has("sceneId") ? {adjacentPairs, observed: scenePairsObserved, ...binaryReport(sceneLinks)} : null,
      shortBaselineDips: withinWork && dimensions.has("pattern") ? shortDips : null,
    },
    structuralPattern: dimensions.has("pattern") ? structuralPattern : null,
    protection: {protectedReferenceRows, hardActions,
      missedHardProfiles: dimensions.has("pattern") ? missedHardProfiles : null,
      activeProfilesOnProtectedReference: dimensions.has("pattern") ? protectedActiveProfiles : null,
      newActiveProfilesOnProtectedReference: dimensions.has("pattern") ? newProtectedActiveProfiles : null,
      observedOutputRows: outputObserved, positiveOutputOnProtectedReference: outputObserved ? protectedPositiveOutput : null},
    causalTraceViolations: dimensions.has("knownAt") || dimensions.has("evidenceIds") ? causalTraceViolations : null,
  };
}

function addBinary(total, part) {
  for (const field of Object.keys(total)) total[field] += part[field];
}

/** Compare by exact source identity. No model calls, reader state, or story text leave this runner. */
export function scoreBeatContinuityCorpus(reference, candidate, {includeDiscrepancies = false} = {}) {
  const {predictions, dimensions} = normalizeCandidate(reference, candidate);
  const total = emptyCounts(dimensions), stories = [], byDepiction = new Map(), byFrame = new Map();
  const discrepancies = [], discrepancyCounts = new Map();
  for (const work of reference.works) {
    const rows = predictions.get(work.id) ?? new Map();
    const knownIds = new Set(work.units.map(unit => unit.id));
    const local = emptyCounts(dimensions);
    let before, prior;
    for (const gold of work.units) {
      const actual = rows.get(gold.id);
      const reasons = recordRow(local, gold, actual, dimensions, knownIds);
      recordRow(total, gold, actual, dimensions, knownIds);
      recordLinks(local, before, gold, prior, actual, dimensions, reasons);
      recordLinks(total, before, gold, prior, actual, dimensions);
      before = gold;
      prior = actual;
      if (!gold.structural) {
        for (const [group, field] of [[byDepiction, "depiction"], [byFrame, "frame"]]) {
          const counts = group.get(gold[field]) ?? emptyCounts(dimensions);
          recordRow(counts, gold, actual, dimensions, knownIds);
          group.set(gold[field], counts);
        }
      }
      for (const reason of reasons) increment(discrepancyCounts, reason);
      if (includeDiscrepancies && reasons.length) {
        discrepancies.push({story: work.id, id: gold.id, unitSha256: gold.unitSha256, reasons,
          labels: Object.fromEntries([...dimensions].filter(field => Object.hasOwn(CATEGORIES, field))
            .map(field => [field, {approved: gold[field], observed: targetObserved(actual, field) ? actual[field] : null}]))});
      }
    }
    if (dimensions.has("transition")) {
      local.nearbyTransitions = nearbyTransitions(work, rows);
      addBinary(total.nearbyTransitions, local.nearbyTransitions);
    }
    if (dimensions.has("pattern")) {
      local.shortDips = compareShortDips(work, rows, dimensions);
      addBinary(total.shortDips, local.shortDips);
    }
    stories.push({id: work.id, sourceSha256: work.sourceSha256, ...reportCounts(local, dimensions)});
  }
  return {cohort: reference.cohort, dimensions: [...dimensions].sort(), summary: reportCounts(total, dimensions), stories,
    byDepiction: Object.fromEntries([...byDepiction].map(([label, counts]) => [label, reportCounts(counts, dimensions, {withinWork: false})])),
    byFrame: Object.fromEntries([...byFrame].map(([label, counts]) => [label, reportCounts(counts, dimensions, {withinWork: false})])),
    discrepancyCounts: Object.fromEntries(discrepancyCounts), ...(includeDiscrepancies ? {discrepancies} : {})};
}
