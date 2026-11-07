import {wholeStoryAnnotationFixtures} from "../tests/whole-story-annotation-fixtures.mjs";
import {buildWholeStoryIndex, WHOLE_STORY_GRANT_PURPOSE} from "./lib/whole-story-context-planning.mjs";
import {planWholeStoryComparison} from "./lib/whole-story-comparison-plans.mjs";
import {executeWholeStoryContextPlan} from "./lib/whole-story-context-execution.mjs";
import {createWholeStoryLunaRequest} from "./lib/whole-story-luna-adapter.mjs";
import {combineWholeStoryScores, scoreWholeStoryAnnotations} from "./lib/whole-story-luna-metrics.mjs";

const editionPins = Object.freeze({
  "first-dance": "c749e4702c7d2f085c8419ca7745fe00edac8ce1f731f742e56bb01ae5ebf7f1",
  "old-letter": "b1cd58986823fd26adb75dff1353eec6a221547058447217d4b753bce50aedcf",
  "reading-room": "b4e0747aeaaf0f1f1012cbcb4f677e5f2f7dad43cd1cefbc0f2f8514350482f3",
  "practice-drill": "412f5cfeafa6e02c3461ba5085674bf6c19073d58d07aaad1f1679fd25b9fd56",
});
const armNames = ["whole", "paragraph", "sentence"];

function preparedFixtures({masked = false} = {}) {
  const now = Date.now();
  return wholeStoryAnnotationFixtures.map((fixture, ordinal) => {
    const text = fixture.paragraphs.join("\n\n");
    const {editionDigest, segmentationVersion, units} = buildWholeStoryIndex(text);
    if (editionDigest !== editionPins[fixture.id] || fixture.phases.length !== units.length) {
      throw new Error("A built-in benchmark edition or reference has changed.");
    }
    const clearAll = !masked || fixture.id !== "first-dance";
    const spans = units.filter(unit => clearAll || unit.id !== 4)
      .map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}));
    const identity = {editionDigest, segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE, expiresAt: now + 300_000};
    const wholeEditionGrant = clearAll ? {...identity, byteStart: 0, byteEnd: Buffer.byteLength(text)} : undefined;
    const plan = planWholeStoryComparison(text, {grant: {...identity, spans}, wholeEditionGrant, now,
      paragraphWindowSize: 2, causalPrefixUnits: 24, causalPrefixBytes: 12_000, limits: {maxRequests: 96}});
    const order = ordinal % 2 === 0 ? armNames : ["paragraph", "whole", "sentence"];
    return {fixture, units, plan, order};
  });
}

function budgetLedger(maxUsd, maxAttempts) {
  if (!Number.isFinite(maxUsd) || maxUsd < 0.01 || maxUsd > 20 || !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1 || maxAttempts > 256) throw new RangeError("Use a bounded founder research budget.");
  const limit = Math.floor(maxUsd * 1_000_000);
  let unsettled = 0, estimated = 0, peakReserved = 0, attempts = 0, unknownAttempts = 0;
  return {
    reserve({inputBytes, maxOutputTokens}) {
      // UTF-8 bytes plus framing headroom bound input for this fixed study.
      // Reserve the higher published context tier even for short requests.
      const reserve = Math.ceil((inputBytes + 2048) * 0.20 + maxOutputTokens * 0.75);
      if (attempts >= maxAttempts || estimated + unsettled + reserve > limit) return false;
      attempts++;
      unsettled += reserve;
      peakReserved = Math.max(peakReserved, unsettled);
      return reserve;
    },
    settle(reserve, usage) {
      const input = usage?.inputTokens ?? usage?.input_tokens;
      const output = usage?.outputTokens ?? usage?.output_tokens;
      if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) {
        unknownAttempts++;
        return;
      }
      unsettled -= reserve;
      estimated += Math.ceil(input * (input > 272_000 ? 0.20 : 0.10) + output * (input > 272_000 ? 0.75 : 0.50));
    },
    summary() {
      return {maxUsd, maxAttempts, attempts, unknownAttempts, estimatedUsd: estimated / 1_000_000,
        outstandingReserveUsd: unsettled / 1_000_000, peakReservedUsd: peakReserved / 1_000_000};
    },
  };
}

function usageSummary(attempts) {
  const time = attempts.filter(row => row.dispatched).map(row => row.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
  const reported = attempts.filter(row => Number.isSafeInteger(row.usage?.inputTokens ?? row.usage?.input_tokens) &&
    Number.isSafeInteger(row.usage?.outputTokens ?? row.usage?.output_tokens));
  const percentile = fraction => time.length ? Math.round(time[Math.ceil(time.length * fraction) - 1]) : null;
  return {dispatched: attempts.filter(row => row.dispatched).length, measuredAttempts: reported.length,
    inputTokens: reported.reduce((sum, row) => sum + (row.usage.inputTokens ?? row.usage.input_tokens), 0),
    outputTokens: reported.reduce((sum, row) => sum + (row.usage.outputTokens ?? row.usage.output_tokens), 0),
    p50AttemptMs: percentile(0.5), p95AttemptMs: percentile(0.95),
    returnedModels: [...new Set(attempts.map(row => row.returnedModel).filter(Boolean))].sort(),
    budgetDeferred: attempts.filter(row => row.result === "budget-deferred").length};
}

function oracleRequest(fixture, name) {
  return async ({targetIds, contextIds}) => {
    const submitted = new Set([...targetIds, ...contextIds]);
    return {status: "annotated", annotations: targetIds.map(id => {
      const phase = fixture.phases[id], evidenceIds = fixture.evidence[id] ?? [];
      const supported = evidenceIds.every(anchor => submitted.has(anchor) && (name !== "sentence" || anchor <= id));
      return {id, phase: supported ? phase : "unknown", status: supported ? "classified" : "abstain",
        transition: fixture.events[id] ?? "none", frame: "current",
        action: ({build: "anticipation", onset: "contact", sustain: "continuation", restart: "contact"})[phase] ?? "none",
        depiction: phase === "quiet" ? "neutral" : "romantic", evidenceIds: supported ? evidenceIds : []};
    })};
  };
}

const idsIn = ({targetIds, contextIds}) => [...targetIds, ...contextIds];

async function compare({makeRequest, measurement, signal, masked = false}) {
  const results = [], attempts = Object.fromEntries(armNames.map(name => [name, []]));
  for (const {fixture, units, plan, order} of preparedFixtures({masked})) {
    signal?.throwIfAborted();
    const refusedIds = new Set(), arms = {};
    for (const name of order) {
      const arm = plan.arms[name];
      if (arm.status === "skipped") {
        arms[name] = {status: arm.status, reason: arm.reason};
        continue;
      }
      let refusalBlocked = 0;
      const safeWindows = arm.windows.filter(window => !idsIn(window).some(id => refusedIds.has(id)));
      refusalBlocked += arm.windows.length - safeWindows.length;
      const request = makeRequest(fixture, name, attempts[name]);
      const start = performance.now();
      let firstUsableMs = null;
      const result = await executeWholeStoryContextPlan({windows: safeWindows}, {signal,
        maxAttempts: safeWindows.length, maxRetries: 0, concurrency: arm.concurrency,
        async request(window, options) {
          const ids = idsIn(window);
          if (ids.some(id => refusedIds.has(id))) {
            refusalBlocked++;
            return {status: "failed"};
          }
          const result = await request(window, options);
          if (result.status === "refused") for (const id of ids) refusedIds.add(id);
          if (firstUsableMs === null && result.status === "annotated" && result.annotations.some(row => row.status === "classified")) {
            firstUsableMs = Math.round(performance.now() - start);
          }
          return result;
        }});
      const predictions = result.windows.flatMap(row => row.annotations ?? []);
      arms[name] = {status: "completed", planning: arm.summary, execution: result.progress, refusalBlocked,
        firstUsableMs, completedMs: Math.round(performance.now() - start),
        score: scoreWholeStoryAnnotations({units, phases: fixture.phases, events: fixture.events, annotations: predictions})};
    }
    results.push({id: fixture.id, referenceUnits: units.length, order: [...order], arms});
  }
  const pooled = Object.fromEntries(armNames.map(name => {
    const eligible = results.filter(row => row.arms[name].score);
    return [name, {works: eligible.length, score: combineWholeStoryScores(eligible.map(row => row.arms[name].score)),
      attempts: usageSummary(attempts[name]), refusalBlocked: eligible.reduce((sum, row) => sum + row.arms[name].refusalBlocked, 0)}];
  }));
  return {measurement, model: measurement === "live-provider" ? "gpt-6-luna" : null, fixtureVersion: "neutral-stories-v1",
    providerCalls: Object.values(pooled).reduce((sum, arm) => sum + arm.attempts.dispatched, 0), pooled, works: results};
}

export async function runBuiltInWholeStoryLunaComparison({apiKey, fetchImpl = fetch, signal, maxUsd = 5, maxAttempts = 96} = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Configure an authorized project API key before starting the live comparison.");
  const budget = budgetLedger(maxUsd, maxAttempts);
  const result = await compare({measurement: "live-provider", signal, makeRequest(_fixture, name, attempts) {
    // The callbacks belong to one window so a parallel response cannot settle
    // another request's reservation.
    return (window, options) => {
      let reserve;
      const request = createWholeStoryLunaRequest({apiKey, fetchImpl, mode: name === "sentence" ? "verified" : "discovery",
        ...(name === "whole" ? {maxOutputTokens: 128_000} : {}),
        beforeAttempt(info) { reserve = budget.reserve(info); return reserve !== false; },
        onAttempt(row) {
          attempts.push(row);
          if (reserve) budget.settle(reserve, row.usage);
        }});
      return request(window, options);
    };
  }});
  signal?.throwIfAborted();
  return {...result, budget: budget.summary()};
}

export function runWholeStoryReferenceReplay(options = {}) {
  const {masked = false, signal} = options;
  return compare({measurement: "offline-reference-replay", makeRequest: oracleRequest, masked, signal});
}
