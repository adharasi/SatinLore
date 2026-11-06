const defaultBudget = {requests: 12, sourceBytes: 120_000, tokens: 48_000};
const costKeys = Object.keys(defaultBudget);
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => Number.isFinite(value) && value >= 0;
const check = (condition, message) => {
  if (!condition) throw new TypeError(message);
};

function idSet(ids, allowed) {
  check(Array.isArray(ids) && ids.every(id => allowed.has(id)) && new Set(ids).size === ids.length,
    "Lookahead IDs must be unique and inside their source scope.");
  return new Set(ids);
}

function sourceTiming(units, wpm) {
  check(Array.isArray(units) && units.length > 0, "Lookahead needs ordered source units.");
  const indices = new Map(), offsets = [0];
  let previous = -1, totalWords = 0;
  for (const unit of units) {
    check(validCount(unit?.id) && unit.id > previous, "Lookahead source IDs must increase.");
    const words = unit.words ?? (typeof unit.text === "string" ? Math.max(1, unit.text.match(/\S+/gu)?.length ?? 0) : 0);
    check(validCount(words) && words > 0, "Lookahead needs a positive word count per unit.");
    indices.set(unit.id, indices.size);
    totalWords += words;
    const offset = Math.round(totalWords * 60_000 / wpm);
    check(validCount(totalWords) && validCount(offset) && offset > offsets.at(-1),
      "Lookahead needs a positive finite reading duration per unit.");
    offsets.push(offset);
    previous = unit.id;
  }
  return {indices, offsets};
}

function normalizeWindows(windows, indices) {
  check(Array.isArray(windows), "Lookahead needs approved windows.");
  let previous = -1;
  return windows.map((window, index) => {
    const ids = [...idSet(window?.ids, indices)];
    const positions = ids.map(id => indices.get(id));
    check(positions.length > 0 && positions.every((position, i) => position > (positions[i - 1] ?? previous)),
      "Lookahead windows must be ordered and disjoint.");
    check(costKeys.every(key => validCount(window.cost?.[key])) && window.cost.requests > 0,
      "Lookahead requires integer request, source byte and token costs.");
    previous = positions.at(-1);
    return {index, ids, positions, cost: Object.fromEntries(costKeys.map(key => [key, window.cost[key]]))};
  });
}

function readingGenerations(controls, indices, offsets, openingWaitMs) {
  check(Array.isArray(controls), "Lookahead controls must be ordered.");
  let previous = -1;
  for (const control of controls) {
    check(validTime(control?.timeMs) && control.timeMs > previous && (control.kind === "cancel" ||
      control.kind === "seek" && indices.has(control.unitId)), "Invalid lookahead control.");
    previous = control.timeMs;
  }

  const generations = [];
  let startMs = 0, readAt = openingWaitMs, from = 0;
  for (const control of controls) {
    if (control.timeMs > readAt + offsets.at(-1) - offsets[from]) break;
    generations.push({startMs, readAt, from, endMs: control.timeMs, interrupted: true});
    if (control.kind === "cancel") return generations;
    startMs = readAt = control.timeMs;
    from = indices.get(control.unitId);
  }
  generations.push({startMs, readAt, from, endMs: readAt + offsets.at(-1) - offsets[from], interrupted: false});
  return generations;
}

function attemptResult(response, window) {
  check(validTime(response?.latencyMs) && ["accepted", "transient", "failed"].includes(response.outcome),
    "Invalid lookahead attempt result.");
  const allowed = new Set(window.ids);
  const mapped = response.outcome === "accepted" ? idSet(response.mappedIds ?? window.ids, allowed) : new Set();
  const cues = idSet(response.cueIds ?? [], mapped);
  return {...response, mapped, cues};
}

function coverageFor(ids, planned, visits) {
  const relevant = visits.filter(visit => ids.has(visit.id));
  const count = predicate => new Set(relevant.filter(predicate).map(visit => visit.id)).size;
  const mapped = (visit, deadline) => visit.availableAtMs !== null && visit.availableAtMs <= visit[deadline];
  return {total: ids.size, planned: [...ids].filter(id => planned.has(id)).length, visited: count(() => true),
    mappedByEntry: count(visit => mapped(visit, "entryMs")), mappedByExit: count(visit => mapped(visit, "exitMs")),
    cuedByEntry: count(visit => visit.hasCue && mapped(visit, "entryMs")),
    cuedByExit: count(visit => visit.hasCue && mapped(visit, "exitMs"))};
}

// A sequential virtual scheduler for offline evaluation. Costs and timing are
// scenario inputs; this module owns no transport, real clock, or source output.
export function simulateNocturneLookahead({units, windows, positiveUnitIds = [], wpm = 240,
  lookaheadMs = 30_000, openingWaitMs = 0, retryDelayMs = 1000, budget = defaultBudget, attempt, controls = []}) {
  check(validTime(wpm) && wpm > 0 && validTime(lookaheadMs) && validTime(openingWaitMs) && validTime(retryDelayMs) &&
    costKeys.every(key => validCount(budget?.[key])) && typeof attempt === "function", "Invalid lookahead configuration.");
  const {indices, offsets} = sourceTiming(units, wpm);
  const jobs = normalizeWindows(windows, indices);
  const positives = idSet(positiveUnitIds, indices);
  const planned = new Set(jobs.flatMap(window => window.ids));
  const generations = readingGenerations(controls, indices, offsets, openingWaitMs);
  const spent = {requests: 0, sourceBytes: 0, tokens: 0};
  const attempts = {started: 0, retries: 0, stale: 0, late: 0};
  const windowsTrace = [], unitTrace = [];

  for (const [generation, epoch] of generations.entries()) {
    const {startMs, readAt, from, endMs, interrupted} = epoch;
    const timeAt = index => readAt + offsets[index] - offsets[from];
    const mappings = new Map();
    let clock = startMs;
    for (const job of jobs) {
      const first = job.positions.find(position => position >= from);
      if (first === undefined) continue;
      const entryMs = timeAt(first), exitMs = timeAt(job.positions.at(-1) + 1);
      const opening = generation === 0 && job.index === 0 && entryMs <= readAt + lookaheadMs;
      const earliest = opening ? startMs : Math.max(readAt, entryMs - lookaheadMs);
      const transitions = [{state: "queued", timeMs: startMs}];
      const record = {generation, index: job.index, attempts: 0, transitions, acceptedAtMs: null};
      const change = (state, timeMs, reason) => transitions.push({state, timeMs, ...(reason ? {reason} : {})});
      windowsTrace.push(record);
      clock = Math.max(clock, earliest);

      for (let number = 1; number <= 2; number++) {
        const limit = Math.min(exitMs, endMs);
        if (clock >= limit) {
          change("expired", limit, interrupted && endMs <= exitMs ? "interrupted" : "cursor");
          break;
        }
        if (!costKeys.every(key => job.cost[key] <= budget[key] - spent[key])) {
          change("expired", clock, "budget");
          break;
        }
        for (const key of costKeys) spent[key] += job.cost[key];
        record.attempts++;
        attempts.started++;
        attempts.retries += Number(number > 1);
        change("in-flight", clock);
        const {latencyMs, outcome, mapped, cues} = attemptResult(
          attempt({window: {ids: [...job.ids], cost: {...job.cost}}, index: job.index, number, generation}), job);
        const completedAt = clock + latencyMs;
        if (interrupted && endMs <= exitMs && completedAt >= endMs) {
          attempts.stale++;
          clock = endMs;
          change("expired", clock, "interrupted");
          break;
        }
        if (completedAt > limit) {
          attempts.late++;
          clock = limit;
          change("expired", clock, "cursor");
          break;
        }
        clock = completedAt;
        if (outcome === "accepted") {
          change("accepted", clock);
          record.acceptedAtMs = clock;
          for (const id of mapped) mappings.set(id, {availableAtMs: clock, hasCue: cues.has(id)});
          break;
        }
        if (outcome === "failed" || number === 2) {
          change("failed", clock, outcome);
          break;
        }
        change("queued", clock, "retry");
        clock = Math.min(clock + retryDelayMs, limit);
      }
      record.state = transitions.at(-1).state;
    }
    for (let index = from; index < units.length && timeAt(index) < endMs; index++) {
      const id = units[index].id;
      const mapping = mappings.get(id) ?? {availableAtMs: null, hasCue: false};
      unitTrace.push({generation, id, entryMs: timeAt(index), exitMs: Math.min(timeAt(index + 1), endMs), ...mapping});
    }
  }

  const windowStates = {"queued": 0, "in-flight": 0, accepted: 0, failed: 0, expired: 0};
  for (const {state} of windowsTrace) windowStates[state]++;
  return {wpm, openingWaitMs, lookaheadMs, spent, attempts, windowStates, windowsTrace, unitTrace,
    coverage: {units: coverageFor(new Set(indices.keys()), planned, unitTrace),
      positives: coverageFor(positives, planned, unitTrace)}};
}
