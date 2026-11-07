import assert from "node:assert/strict";
import {setImmediate} from "node:timers/promises";
import test from "node:test";
import {executeWholeStoryContextPlan} from "../scripts/lib/whole-story-context-execution.mjs";

function window(id, targetIds, contextIds = [], runId = 0) {
  const units = [...contextIds, ...targetIds].map(id => ({id, text: "A lamp was lit."}));
  const body = JSON.stringify({runId, units, targetIds});
  return {id, runId, targetIds, contextIds, body, bodyBytes: Buffer.byteLength(body)};
}

const annotation = id => ({id, label: "neutral"});
const annotate = (...ids) => ({status: "annotated", annotations: ids.map(annotation)});
const refused = {status: "refused"};
const transient = {status: "transient"};
const states = result => result.windows.map(({id, status, attempts}) => [id, status, attempts]);

test("independent windows progress with bounded concurrency and preserve overlap priority", async () => {
  const a = window("a", [0]), b = window("b", [1], [0]), c = window("c", [2], [1]);
  const d = window("d", [3], [], 3), e = window("e", [4], [], 4);
  const calls = [], pending = new Map(), snapshots = [];
  const result = executeWholeStoryContextPlan({windows: [a, b, c, d, e]}, {
    request({id}) {
      calls.push(id);
      return new Promise(resolve => pending.set(id, resolve));
    },
    onProgress(progress) { snapshots.push(progress); },
  });
  assert.deepEqual(calls, ["a", "d"]);
  pending.get("d")(annotate(3));
  await setImmediate();
  assert.deepEqual(calls, ["a", "d", "e"]);
  pending.get("a")(annotate(0));
  await setImmediate();
  assert.deepEqual(calls, ["a", "d", "e", "b"]);
  pending.get("b")(annotate(1));
  await setImmediate();
  assert.deepEqual(calls, ["a", "d", "e", "b", "c"]);
  pending.get("c")(annotate(2));
  pending.get("e")(annotate(4));
  const finished = await result;
  assert.deepEqual(states(finished), ["a", "b", "c", "d", "e"].map(id => [id, "annotated", 1]));
  assert.ok(snapshots.every(({running, pending, completed, total}) =>
    running <= 2 && total === pending + running + completed));
  assert.deepEqual(finished.progress, {total: 5, completed: 5, attemptsStarted: 5, retriesStarted: 0,
    pending: 0, running: 0, annotated: 5, providerRefused: 0, refusalDependent: 0, failed: 0,
    budgetDeferred: 0, cancelled: 0});
});

test("terminal refusal invalidates accepted overlap and blocks rejected bytes in queued targets or context", async () => {
  const windows = [window("earlier", [0]), window("reject", [1], [0]), window("context", [2], [1]),
    window("target", [1]), window("disjoint", [3], [2]), window("other-run", [10], [], 10)];
  const calls = [];
  const result = await executeWholeStoryContextPlan({windows}, {
    async request({id, targetIds}) {
      calls.push(id);
      return id === "reject" ? {...refused, annotations: [annotation(1)]} : annotate(...targetIds);
    },
  });
  assert.deepEqual(calls, ["earlier", "other-run", "reject", "disjoint"]);
  assert.deepEqual(states(result), [["earlier", "refusal-dependent", 1], ["reject", "provider-refused", 1],
    ["context", "refusal-dependent", 0], ["target", "refusal-dependent", 0], ["disjoint", "annotated", 1],
    ["other-run", "annotated", 1]]);
  assert.equal(result.windows.some(row => row.status !== "annotated" && Object.hasOwn(row, "annotations")), false);
  assert.equal(result.progress.providerRefused, 1);
  assert.equal(result.progress.refusalDependent, 3);
  assert.equal(result.progress.annotated, 2);
  assert.equal(result.progress.retriesStarted, 0);
});

test("only explicit transient failures retry, with unchanged input and charged attempts", async () => {
  const windows = [window("a", [0]), window("b", [1]), window("c", [2])];
  const calls = [];
  const result = await executeWholeStoryContextPlan({windows}, {concurrency: 1, maxAttempts: 3,
    async request(input, {attempt}) {
      calls.push({input, attempt});
      if (input.id === "a") return attempt === 1 ? transient : annotate(0);
      return transient;
    },
  });
  assert.deepEqual(calls.map(({input, attempt}) => [input.id, attempt]), [["a", 1], ["a", 2], ["b", 1]]);
  assert.strictEqual(calls[0].input, calls[1].input);
  assert.equal(calls[1].input.body, windows[0].body);
  assert.ok(Object.isFrozen(calls[0].input) && Object.isFrozen(calls[0].input.targetIds));
  assert.deepEqual(states(result), [["a", "annotated", 2], ["b", "budget-deferred", 1], ["c", "budget-deferred", 0]]);
  assert.equal(result.progress.attemptsStarted, 3);
  assert.equal(result.progress.retriesStarted, 1);
  assert.equal(result.progress.budgetDeferred, 2);
});

test("missing, duplicate, malformed, and unexpected responses cannot become annotations", async () => {
  const windows = [window("missing", [0, 1]), window("duplicate", [2, 3]), window("extra", [4]),
    window("wrong", [5]), window("throw", [6]), window("reject", [7]), window("transient", [8]),
    window("valid", [9, 10])];
  const result = await executeWholeStoryContextPlan({windows}, {maxAttempts: 9,
    request({id}) {
      if (id === "throw") throw new Error("Unclassified failure.");
      if (id === "reject") return Promise.reject(new Error("Unclassified failure."));
      return {missing: annotate(0), duplicate: annotate(2, 2), extra: annotate(4, 99), wrong: annotate(90),
        transient, valid: annotate(10, 9)}[id];
    },
  });
  assert.deepEqual(states(result), [["missing", "failed", 1], ["duplicate", "failed", 1], ["extra", "failed", 1],
    ["wrong", "failed", 1], ["throw", "failed", 1], ["reject", "failed", 1], ["transient", "failed", 2],
    ["valid", "annotated", 1]]);
  assert.deepEqual(result.windows.at(-1).annotations, [annotation(10), annotation(9)]);
});

test("abort resolves without waiting for transport and ignores late fulfillment and rejection", async () => {
  const controller = new AbortController(), snapshots = [], pending = new Map();
  const windows = [window("accepted", [0]), window("late", [1]), window("late-error", [2]),
    window("pending", [3], [2])];
  const running = executeWholeStoryContextPlan({windows}, {signal: controller.signal,
    request({id}, {signal}) {
      assert.strictEqual(signal, controller.signal);
      if (id === "accepted") return annotate(0);
      return new Promise((resolve, reject) => pending.set(id, {resolve, reject}));
    },
    onProgress(progress) { snapshots.push(progress); },
  });
  await setImmediate();
  assert.deepEqual([...pending.keys()], ["late", "late-error"]);
  controller.abort();
  const result = await running;
  const reports = snapshots.length;
  pending.get("late").resolve(annotate(1));
  pending.get("late-error").reject(new Error("Late failure."));
  await setImmediate();
  assert.deepEqual(states(result), [["accepted", "cancelled", 1], ["late", "cancelled", 1],
    ["late-error", "cancelled", 1], ["pending", "cancelled", 0]]);
  assert.equal(result.progress.cancelled, 4);
  assert.equal(result.windows.some(row => Object.hasOwn(row, "annotations")), false);
  assert.equal(snapshots.length, reports);
});

test("no request is sent with pre-abort, empty budget or invalid execution limits", async () => {
  const plan = {windows: [window("a", [0])]}, request = () => assert.fail("Unexpected request.");
  const cancelled = await executeWholeStoryContextPlan(plan, {request, signal: AbortSignal.abort()});
  assert.deepEqual(states(cancelled), [["a", "cancelled", 0]]);
  const deferred = await executeWholeStoryContextPlan(plan, {request, maxAttempts: 0});
  assert.deepEqual(states(deferred), [["a", "budget-deferred", 0]]);
  await assert.rejects(executeWholeStoryContextPlan(plan, {request, concurrency: 3}), TypeError);
  await assert.rejects(executeWholeStoryContextPlan(plan, {request, maxAttempts: 97}), TypeError);
  await assert.rejects(executeWholeStoryContextPlan(plan, {request, maxRetries: 2}), TypeError);
});

test("expanded plans have a separate explicit executor allowance", async () => {
  const windows = Array.from({length: 42}, (_, id) => window(id, [id], [], id));
  const request = ({id}) => annotate(id);
  const result = await executeWholeStoryContextPlan({windows}, {request});
  assert.equal(result.progress.attemptsStarted, 40);
  assert.deepEqual(states(result).slice(-2), [[40, "budget-deferred", 0], [41, "budget-deferred", 0]]);
  const extended = await executeWholeStoryContextPlan({windows}, {request, maxAttempts: 96});
  assert.equal(extended.progress.attemptsStarted, 42);
  assert.equal(extended.progress.budgetDeferred, 0);
});
