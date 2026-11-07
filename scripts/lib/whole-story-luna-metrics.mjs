const phasesKnown = new Set(["quiet", "build", "onset", "sustain", "accent", "ease", "recover", "restart"]);
const transitionKinds = new Set(["stop", "interruption", "reported-entry", "present-return", "scene-cut",
  "uncertain-continuity", "declined-restart", "non-romantic-activity-stop"]);
const hardStopKinds = new Set(["stop", "interruption", "scene-cut"]);

const binaryCounts = () => ({matched: 0, missed: 0, extra: 0});
const accuracyCounts = () => ({matched: 0, total: 0});
const eventCounts = () => ({exact: binaryCounts(), withinOneParagraph: binaryCounts()});
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const validId = id => Number.isSafeInteger(id) && id >= 0;

function emptyCounts() {
  return {
    delivery: {targets: 0, returned: 0, classified: 0, abstained: 0, uncertain: 0, missing: 0,
      referenceCues: 0, classifiedReferenceCues: 0},
    cues: binaryCounts(), coveredCues: binaryCounts(), phase: accuracyCounts(), coveredPhase: accuracyCounts(),
    events: {...eventCounts(), byType: {}},
    hardStops: {reference: 0, exact: 0, quiet: 0, active: 0, unclassified: 0},
  };
}

function reportBinary(counts) {
  const {matched, missed, extra} = counts;
  return {...counts, precision: ratio(matched, matched + extra), recall: ratio(matched, matched + missed)};
}

function reportEvents(counts) {
  return {exact: reportBinary(counts.exact), withinOneParagraph: reportBinary(counts.withinOneParagraph)};
}

function report(counts) {
  const {delivery, cues, coveredCues, phase, coveredPhase, events, hardStops} = counts;
  return {
    delivery: {...delivery, returnedCoverage: ratio(delivery.returned, delivery.targets),
      usableCoverage: ratio(delivery.classified, delivery.targets),
      usableCueCoverage: ratio(delivery.classifiedReferenceCues, delivery.referenceCues)},
    cues: reportBinary(cues), coveredCues: reportBinary(coveredCues),
    phase: {...phase, accuracy: ratio(phase.matched, phase.total)},
    coveredPhase: {...coveredPhase, accuracy: ratio(coveredPhase.matched, coveredPhase.total)},
    events: {...reportEvents(events), byType: Object.fromEntries(Object.entries(events.byType)
      .map(([kind, kindCounts]) => [kind, reportEvents(kindCounts)]))},
    hardStops: {...hardStops, missed: hardStops.reference - hardStops.exact},
  };
}

function compareCue(counts, expected, predicted) {
  if (expected && predicted) counts.matched++;
  else if (expected) counts.missed++;
  else if (predicted) counts.extra++;
}

function addCounts(total, part) {
  for (const field of Object.keys(total)) total[field] += part[field];
}

// For one transition kind, sorted paragraph anchors admit an optimal
// earliest-compatible pairing. A predicted event can be used only once.
function matchNearby(expected, predicted, units) {
  const paragraphs = ids => ids.map(id => units.get(id).paragraph).sort((a, b) => a - b);
  const references = paragraphs(expected), observations = paragraphs(predicted);
  let reference = 0, observation = 0, matched = 0;
  while (reference < references.length && observation < observations.length) {
    const distance = references[reference] - observations[observation];
    if (distance < -1) reference++;
    else if (distance > 1) observation++;
    else {
      matched++;
      reference++;
      observation++;
    }
  }
  return matched;
}

function scoreEvents(result, expected, predicted, units) {
  for (const kind of transitionKinds) {
    const references = [...expected].filter(([, event]) => event === kind).map(([id]) => id);
    const observations = [...predicted].filter(([, event]) => event === kind).map(([id]) => id);
    if (!references.length && !observations.length) continue;
    const kindCounts = eventCounts();
    kindCounts.exact.matched = observations.filter(id => expected.get(id) === kind).length;
    kindCounts.withinOneParagraph.matched = matchNearby(references, observations, units);
    for (const field of Object.keys(kindCounts)) {
      const count = kindCounts[field];
      count.missed = references.length - count.matched;
      count.extra = observations.length - count.matched;
      addCounts(result[field], count);
    }
    result.byType[kind] = kindCounts;
  }
}

/** Score a single story. targetIds is a predeclared scoring slice, not the delivered set. */
export function scoreWholeStoryAnnotations({units, phases, events = {}, annotations = [], targetIds} = {}) {
  if (!Array.isArray(units) || !Array.isArray(phases) ||
      !(annotations instanceof Map || Array.isArray(annotations)) ||
      !(events instanceof Map || events && typeof events === "object" && !Array.isArray(events)) ||
      targetIds !== undefined && !Array.isArray(targetIds)) throw new TypeError("Invalid whole-story scoring input.");

  const unitById = new Map();
  for (const unit of units) {
    if (!validId(unit?.id) || !validId(unit.paragraph) || unitById.has(unit.id) || !phasesKnown.has(phases[unit.id])) {
      throw new TypeError("Invalid whole-story reference unit.");
    }
    unitById.set(unit.id, unit);
  }

  const requested = targetIds ?? [...unitById.keys()];
  const targets = new Set(requested);
  if (targets.size !== requested.length || requested.some(id => !unitById.has(id))) {
    throw new TypeError("Invalid whole-story scoring targets.");
  }

  const expectedEvents = new Map();
  for (const [key, kind] of events instanceof Map ? events : Object.entries(events)) {
    const id = typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : key;
    if (!unitById.has(id) || !(kind === "none" || transitionKinds.has(kind))) {
      throw new TypeError("Invalid whole-story reference transition.");
    }
    if (targets.has(id) && kind !== "none") expectedEvents.set(id, kind);
  }

  const rows = new Map();
  for (const [key, row] of annotations instanceof Map ? annotations : annotations.map(row => [row?.id, row])) {
    if (!row || row.id !== key || !unitById.has(key) || rows.has(key) || !["classified", "abstain", "uncertain"].includes(row.status) ||
        row.status === "classified" && (!phasesKnown.has(row.phase) || !(row.transition === "none" || transitionKinds.has(row.transition)))) {
      throw new TypeError("Invalid whole-story scoring annotation.");
    }
    rows.set(key, row);
  }

  const counts = emptyCounts();
  const predictedEvents = new Map();
  for (const id of targets) {
    const row = rows.get(id);
    const classified = row?.status === "classified";
    const expectedCue = phases[id] !== "quiet";
    const predictedCue = classified && row.phase !== "quiet";
    counts.delivery.targets++;
    counts.delivery.returned += Number(Boolean(row));
    counts.delivery.classified += Number(classified);
    counts.delivery.abstained += Number(row?.status === "abstain");
    counts.delivery.uncertain += Number(row?.status === "uncertain");
    counts.delivery.missing += Number(!row);
    counts.delivery.referenceCues += Number(expectedCue);
    counts.delivery.classifiedReferenceCues += Number(expectedCue && classified);

    compareCue(counts.cues, expectedCue, predictedCue);
    counts.phase.total++;
    if (classified) {
      const phaseMatch = Number(phases[id] === row.phase);
      counts.phase.matched += phaseMatch;
      counts.coveredPhase.total++;
      counts.coveredPhase.matched += phaseMatch;
      compareCue(counts.coveredCues, expectedCue, predictedCue);
      if (row.transition !== "none") predictedEvents.set(id, row.transition);
    }

    const expectedEvent = expectedEvents.get(id);
    if (hardStopKinds.has(expectedEvent)) {
      counts.hardStops.reference++;
      counts.hardStops.exact += Number(predictedEvents.get(id) === expectedEvent);
      counts.hardStops.quiet += Number(classified && !predictedCue);
      counts.hardStops.active += Number(predictedCue);
      counts.hardStops.unclassified += Number(!classified);
    }
  }
  scoreEvents(counts.events, expectedEvents, predictedEvents, unitById);
  return report(counts);
}

/** Pool story counts. Never average per-story percentages or match across stories. */
export function combineWholeStoryScores(scores) {
  if (!Array.isArray(scores)) throw new TypeError("Provide whole-story scores to combine.");
  const counts = emptyCounts();
  for (const score of scores) {
    for (const field of ["delivery", "cues", "coveredCues", "phase", "coveredPhase", "hardStops"]) {
      addCounts(counts[field], score[field]);
    }
    for (const field of ["exact", "withinOneParagraph"]) addCounts(counts.events[field], score.events[field]);
    for (const [kind, byType] of Object.entries(score.events.byType)) {
      const total = counts.events.byType[kind] ??= eventCounts();
      for (const field of ["exact", "withinOneParagraph"]) addCounts(total[field], byType[field]);
    }
  }
  return report(counts);
}
