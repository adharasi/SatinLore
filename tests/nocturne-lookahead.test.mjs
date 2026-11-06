import assert from "node:assert/strict";
import test from "node:test";
import {simulateNocturneLookahead} from "../scripts/lib/nocturne-lookahead.mjs";

const cost = {requests: 1, sourceBytes: 24, tokens: 8};
const units = (...ids) => ids.map(id => ({id, words: 10}));
const window = (...ids) => ({ids, cost});
const accepted = (latencyMs, cueIds, mappedIds) => ({latencyMs, outcome: "accepted", cueIds, mappedIds});

test("lookahead counts entry and exit coverage on the full reference scope", () => {
  const result = simulateNocturneLookahead({
    units: units(0, 1, 2, 3), windows: [window(0), window(2, 3)], positiveUnitIds: [0, 1, 2, 3],
    wpm: 60, lookaheadMs: 5000,
    attempt({index}) { return index === 0 ? accepted(3000, [0]) : accepted(12_000, [2], [2]); },
  });
  assert.deepEqual(result.coverage.positives,
    {total: 4, planned: 3, visited: 4, mappedByEntry: 0, mappedByExit: 2, cuedByEntry: 0, cuedByExit: 2});
  assert.deepEqual(result.unitTrace[2],
    {generation: 0, id: 2, entryMs: 20_000, exitMs: 30_000, availableAtMs: 27_000, hasCue: true});
  assert.equal(result.unitTrace[1].availableAtMs, null);
  assert.equal(result.unitTrace[3].availableAtMs, null);
  assert.equal(result.windowsTrace[1].transitions[1].timeMs, 15_000);
});

test("only the first approved opening window can start before the simulated reader", () => {
  const result = simulateNocturneLookahead({
    units: units(0, 2, 3), windows: [window(0), window(2)], positiveUnitIds: [0],
    wpm: 60, openingWaitMs: 3000, lookaheadMs: 30_000,
    attempt({window: approved}) { return accepted(2000, approved.ids); },
  });
  assert.equal(result.unitTrace[0].entryMs, 3000);
  assert.equal(result.unitTrace[0].availableAtMs, 2000);
  assert.equal(result.coverage.positives.cuedByEntry, 1);
  assert.deepEqual(result.windowsTrace.map(trace => trace.transitions[1].timeMs), [0, 3000]);
});

test("transient retry is bounded and all attempt costs count against the same budget", () => {
  const options = {
    units: units(0), windows: [window(0)], positiveUnitIds: [0], wpm: 60, retryDelayMs: 2000,
    attempt({number}) { return number === 1 ? {latencyMs: 1000, outcome: "transient"} : accepted(1000, [0]); },
  };
  const result = simulateNocturneLookahead(options);
  assert.deepEqual(result.attempts, {started: 2, retries: 1, stale: 0, late: 0});
  assert.deepEqual(result.spent, {requests: 2, sourceBytes: 48, tokens: 16});
  assert.deepEqual(result.windowsTrace[0].transitions,
    [{state: "queued", timeMs: 0}, {state: "in-flight", timeMs: 0}, {state: "queued", timeMs: 1000, reason: "retry"},
      {state: "in-flight", timeMs: 3000}, {state: "accepted", timeMs: 4000}]);
  for (const budget of [{...result.spent, requests: 1}, {...result.spent, sourceBytes: 47}, {...result.spent, tokens: 15}]) {
    const limited = simulateNocturneLookahead({...options, budget});
    assert.equal(limited.attempts.started, 1);
    assert.equal(limited.windowsTrace[0].transitions.at(-1).reason, "budget");
    assert.equal(limited.coverage.positives.cuedByExit, 0);
  }
  const permanent = simulateNocturneLookahead({...options, attempt: () => ({latencyMs: 500, outcome: "failed"})});
  assert.equal(permanent.attempts.started, 1);
  assert.equal(permanent.windowStates.failed, 1);
  const exhausted = simulateNocturneLookahead({...options, attempt: () => ({latencyMs: 500, outcome: "transient"})});
  assert.equal(exhausted.attempts.started, 2);
  assert.equal(exhausted.windowStates.failed, 1);
});

test("late work expires at the cursor and the next window can use its slot", () => {
  const result = simulateNocturneLookahead({
    units: units(0, 1), windows: [window(0), window(1)], positiveUnitIds: [0, 1], wpm: 60,
    attempt({index}) { return index === 0 ? accepted(12_000, [0]) : accepted(0, [1]); },
  });
  assert.equal(result.attempts.late, 1);
  assert.equal(result.windowsTrace[0].state, "expired");
  assert.equal(result.windowsTrace[1].transitions[1].timeMs, 10_000);
  assert.equal(result.unitTrace[0].availableAtMs, null);
  assert.equal(result.coverage.positives.cuedByEntry, 1);
});

test("retry backoff ends when its window is no longer useful", () => {
  const result = simulateNocturneLookahead({
    units: [{id: 0, words: 1}, {id: 1, words: 1}], windows: [window(0), window(1)],
    wpm: 60, retryDelayMs: 4000,
    attempt({index}) { return index === 0 ? {latencyMs: 200, outcome: "transient"} : accepted(0, [1]); },
  });
  assert.equal(result.attempts.retries, 0);
  assert.equal(result.windowsTrace[0].state, "expired");
  assert.equal(result.unitTrace[1].availableAtMs, 1000);
});

test("seeks discard old results and requeue only windows on the new path", () => {
  const result = simulateNocturneLookahead({
    units: units(0, 1, 2), windows: [window(0, 1), window(2)], positiveUnitIds: [0, 1, 2], wpm: 60,
    controls: [{timeMs: 3000, kind: "seek", unitId: 2}],
    attempt({index}) { return index === 0 ? accepted(5000, [0, 1]) : accepted(2000, [2]); },
  });
  assert.equal(result.attempts.stale, 1);
  assert.equal(result.spent.requests, 2);
  assert.deepEqual(result.unitTrace, [
    {generation: 0, id: 0, entryMs: 0, exitMs: 3000, availableAtMs: null, hasCue: false},
    {generation: 1, id: 2, entryMs: 3000, exitMs: 13_000, availableAtMs: 5000, hasCue: true},
  ]);
  assert.equal(result.coverage.positives.visited, 2);
  assert.equal(result.coverage.positives.cuedByExit, 1);
});

test("cancellation wins when a response completes at the same simulated instant", () => {
  const result = simulateNocturneLookahead({
    units: units(0, 1), windows: [window(0), window(1)], positiveUnitIds: [0, 1], wpm: 60,
    controls: [{timeMs: 3000, kind: "cancel"}], attempt: () => accepted(3000, [0]),
  });
  assert.equal(result.attempts.started, 1);
  assert.equal(result.attempts.stale, 1);
  assert.equal(result.coverage.positives.cuedByExit, 0);
});

test("only scoped IDs can be returned and traces contain no story prose", () => {
  const options = {units: [{id: 0, text: "The appointment was held outside."}], windows: [window(0)]};
  assert.throws(() => simulateNocturneLookahead({...options, attempt: () => accepted(0, [1])}), /source scope/);
  assert.throws(() => simulateNocturneLookahead({...options, windows: [window(0), window(0)], attempt: () => accepted(0)}),
    /ordered and disjoint/);
  const result = simulateNocturneLookahead({...options, attempt({window: approved}) {
    assert.deepEqual(Object.keys(approved), ["ids", "cost"]);
    return accepted(0);
  }});
  assert.doesNotMatch(JSON.stringify(result), /appointment|outside/);
  assert.equal(result.unitTrace[0].exitMs, 1250);
});
