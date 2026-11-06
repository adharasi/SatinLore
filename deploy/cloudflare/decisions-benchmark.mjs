import {buildSceneUnits, compileSceneMap} from "../../app/static/reader/scene-map.mjs";
import {analyzeNocturneSceneMap} from "../../scripts/lib/nocturne-scene-analysis.mjs";
import {analyzeNocturneDecisions} from "./scene-decisions.mjs";

// The same two neutral originals and labels as the private scene-map evaluator.
// Only these server-held sentences can reach the provider through this helper.
const fixtures = [
  {
    id: "invitation-and-interruption",
    paragraphs: [
      "Rain tapped the windows. Sam put a second cup beside Anya's.",
      "'I hoped you'd stay for dinner,' Sam said. 'Only if it is just us,' Anya replied.",
      "Sam reached for Anya's hand and she took it. The doorbell rang and they both stepped away.",
      "The courier asked where to put the box.",
    ],
    positives: [2, 3, 4], boundaries: [5], unitCount: 7,
  },
  {
    id: "report-and-reciprocation",
    paragraphs: [
      "Years later, Mari told Rae about a dance. In her account the dancer had drawn closer.",
      "Mari set the photograph aside and turned to Rae.",
      "Mari asked, 'Would you dance with me now?' 'I thought you'd never ask,' Rae said.",
      "They joined hands and began to dance.",
    ],
    positives: [3, 4, 5], boundaries: [2], unitCount: 6,
  },
];

const endpoints = {
  responses: "https://api.openai.com/v1/responses",
  decisions: "https://api.openai.com/v1/decisions",
};
const variants = ["responses", "decisions"];
const statuses = new Set(["completed", "partial", "aborted", "input_limit", "extraction_failed"]);
const callStatuses = new Set(["parsed", "http_error", "provider_error", "invalid_response", "invalid_map",
  "refused", "truncated", "incomplete", "aborted", "timed_out"]);
const usageFields = ["inputTokens", "outputTokens", "reasoningTokens", "cachedInputTokens", "cacheWriteInputTokens"];
const tallyFields = ["targetedUnits", "answeredUnits", "mappedUnits", "refusedUnits", "uncertainUnits", "inconsistentUnits",
  "failedUnits", "answeredQuestions", "refusedQuestions"];

export const DECISIONS_BENCHMARK_REQUESTS = fixtures.length * variants.length;

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const ratio = (value, total) => total ? value / total : null;

function score(found, missed, falseCount) {
  return {found, missed, false: falseCount, precision: ratio(found, found + falseCount), recall: ratio(found, found + missed)};
}

function compare(expected, predicted) {
  const gold = new Set(expected), actual = new Set(predicted);
  const found = expected.filter(id => actual.has(id)).length;
  return score(found, expected.length - found, [...actual].filter(id => !gold.has(id)).length);
}

function safeCall(call) {
  const usage = call.usage ? Object.fromEntries(usageFields.map(field => [field, count(call.usage[field])])) : null;
  return {
    status: Number.isInteger(call.status) && call.status >= 100 && call.status <= 599 ? call.status : null,
    result: callStatuses.has(call.result) ? call.result : "unavailable",
    elapsedMs: count(call.elapsedMs), usage,
  };
}

function resultFor(fixture, units, {accepted, trace}) {
  const timeline = accepted ? compileSceneMap(accepted, units) : [];
  return {
    status: statuses.has(trace.status) ? trace.status : "unavailable",
    validMap: accepted !== null,
    mappedUnits: timeline.filter(row => row.sceneId !== null && row.frame !== "uncertain").length,
    sentenceCues: compare(fixture.positives, timeline.filter(row => row.emphasis > 0).map(row => row.id)),
    sentenceBoundaries: compare(fixture.boundaries, timeline.filter(row => row.boundary === "model").map(row => row.id)),
    calls: trace.calls.map(safeCall),
    answerCounts: Object.fromEntries(tallyFields.flatMap(field => count(trace[field]) === null ? [] : [[field, trace[field]]])),
  };
}

function summarize(rows, variant) {
  const results = rows.map(row => row[variant]);
  const calls = results.flatMap(result => result.calls);
  const sum = (values, field) => values.reduce((total, value) => total + value[field], 0);
  const sourceUnits = sum(rows, "sourceUnits"), mappedUnits = sum(results, "mappedUnits");
  const scores = field => {
    const values = results.map(result => result[field]);
    return score(sum(values, "found"), sum(values, "missed"), sum(values, "false"));
  };
  const timings = calls.flatMap(call => call.elapsedMs === null ? [] : [call.elapsedMs]).sort((a, b) => a - b);
  const percentile = fraction => timings[Math.ceil(timings.length * fraction) - 1] ?? null;
  const usage = Object.fromEntries(usageFields.map(field => {
    const reported = calls.filter(call => call.usage?.[field] != null);
    return [field, {reportedCalls: reported.length, total: reported.length ? sum(reported.map(call => call.usage), field) : null}];
  }));
  return {
    calls: calls.length, validMaps: results.filter(result => result.validMap).length,
    sourceUnits, mappedUnits, mappedCoverage: ratio(mappedUnits, sourceUnits),
    sentenceCues: scores("sentenceCues"), sentenceBoundaries: scores("sentenceBoundaries"),
    latencyMs: {samples: timings.length, p50: percentile(0.5), p95: percentile(0.95)}, usage,
    answerCounts: Object.fromEntries(tallyFields.flatMap(field => {
      const reported = results.map(result => result.answerCounts).filter(counts => field in counts);
      return reported.length ? [[field, sum(reported, field)]] : [];
    })),
  };
}

// Caller owns authentication, quota reservations and revalidation. There is
// one call per model per fixture and no retry or provider fallback here.
export async function runDecisionsBenchmark({key, analysisFetcher = fetch, signal} = {}) {
  if (typeof key !== "string" || !/^sk-[A-Za-z0-9_-]{12,512}$/.test(key) || key.startsWith("sk-admin-") ||
      typeof analysisFetcher !== "function" || (signal !== undefined && !(signal instanceof AbortSignal))) {
    throw new TypeError("Invalid Nocturne benchmark configuration.");
  }
  const rows = [];
  for (const [index, fixture] of fixtures.entries()) {
    const units = buildSceneUnits(fixture.paragraphs);
    if (units.length !== fixture.unitCount) throw new Error("The benchmark source units changed.");
    const row = {fixture: fixture.id, sourceUnits: units.length};
    const approvedIds = units.map(unit => unit.id);
    // Counterbalance the order to reduce the effect of always testing one
    // endpoint first. Two samples still constitute a smoke test.
    for (const variant of index % 2 ? [...variants].reverse() : variants) {
      const analyze = variant === "responses" ? analyzeNocturneSceneMap : analyzeNocturneDecisions;
      const result = await analyze({units, approvedIds, signal, provider: (body, options) => {
        options.signal.throwIfAborted();
        return analysisFetcher(endpoints[variant], {
          method: "POST", redirect: "manual", signal: options.signal,
          headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Cache-Control": "no-store"},
          body: JSON.stringify(body),
        });
      }});
      row[variant] = resultFor(fixture, units, result);
    }
    rows.push(row);
  }
  return {
    version: "original-sentence-fixtures-v1", model: "gpt-6-luna", fixtureCount: fixtures.length,
    aborted: signal?.aborted === true, fixtures: rows,
    totals: Object.fromEntries(variants.map(variant => [variant, summarize(rows, variant)])),
  };
}
