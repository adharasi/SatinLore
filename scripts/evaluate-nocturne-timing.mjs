// Private shadow comparison. The reference provider is deterministic and the
// simulated latencies and spend are scenario assumptions. No network or device.
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {compileSceneMap} from "../app/static/reader/scene-map.mjs";
import {loadCorpus, reviewNocturneWindow} from "./evaluate-nocturne-corpus.mjs";
import {replayPassage, sceneUnitWordCount, summarizePlayback} from "./evaluate-scene-map-playback.mjs";
import {simulateNocturneLookahead} from "./lib/nocturne-lookahead.mjs";

const PACES = [120, 240, 420];
const BUDGET = {requests: 12, sourceBytes: 60_000, tokens: 37_000};
const SCENARIOS = [
  {name: "reactive-8s", latencyMs: 8_000, lookaheadMs: 0, openingWaitMs: 0},
  {name: "lookahead-8s", latencyMs: 8_000, lookaheadMs: 30_000, openingWaitMs: 0},
  {name: "prepared-8s", latencyMs: 8_000, lookaheadMs: 30_000, openingWaitMs: 8_000},
  {name: "prepared-24s", latencyMs: 24_000, lookaheadMs: 30_000, openingWaitMs: 8_000},
  {name: "first-window-retry-8s", latencyMs: 8_000, lookaheadMs: 30_000, openingWaitMs: 8_000, retryFirst: true},
];

function addCounts(total, counts) {
  for (const [key, value] of Object.entries(counts)) total[key] = (total[key] ?? 0) + value;
}

async function reviewedWindows(passage, maxUnitsPerWindow) {
  const windows = [], answers = [], candidateMap = {scenes: []};
  const smallerWindows = passage.windows.flatMap(window => Array.from({length: Math.ceil(window.length / maxUnitsPerWindow)},
    (_, index) => window.slice(index * maxUnitsPerWindow, (index + 1) * maxUnitsPerWindow)));
  for (const window of smallerWindows) {
    const {accepted, trace} = await reviewNocturneWindow(passage.reference, window);
    const timeline = accepted ? compileSceneMap(accepted, window) : [];
    const bytes = window.reduce((sum, {text}) => sum + Buffer.byteLength(text), 0);
    const requests = Math.max(1, trace.calls.length);
    // The same source can be sent in extraction and verification. Reserve
    // each pass separately, including on a retry. Tokens are a rough stress
    // assumption and do not use returned usage or a provider tokenizer.
    windows.push({ids: window.map(unit => unit.id), cost: {requests, sourceBytes: bytes * requests,
      tokens: requests * (Math.ceil(bytes / 3) + 512) + window.length * 32}});
    answers.push({outcome: accepted ? "accepted" : "failed", mappedIds: timeline.filter(row => row.sceneId !== null).map(row => row.id),
      cueIds: timeline.filter(row => row.emphasis > 0).map(row => row.id)});
    if (accepted) candidateMap.scenes.push(...accepted.scenes);
  }
  return {windows, answers, candidateMap};
}

export async function evaluateNocturneTiming(manifestPath, {maxUnitsPerWindow = 300, hostedScope = false} = {}) {
  if (!Number.isInteger(maxUnitsPerWindow) || maxUnitsPerWindow < 1 || maxUnitsPerWindow > 300 ||
      typeof hostedScope !== "boolean") throw new TypeError("Use up to 300 source units per window.");
  const {passages} = await loadCorpus(manifestPath, hostedScope ? "live-provider" : "validate-only");
  const groups = {};
  for (const passage of passages) {
    const {units, reference, scope, split} = passage;
    const timedUnits = units.map(unit => ({id: unit.id, words: sceneUnitWordCount(unit)}));
    const {windows, answers, candidateMap} = await reviewedWindows(passage, maxUnitsPerWindow);
    const positiveUnitIds = compileSceneMap(reference, units).filter(row => row.emphasis > 0).map(row => row.id);
    const group = groups[`${split}/${scope}`] ??= {};
    for (const wpm of PACES) for (const scenario of SCENARIOS) {
      const {latencyMs, lookaheadMs, openingWaitMs} = scenario;
      const row = group[`${wpm}/${scenario.name}`] ??= {coverage: {units: {}, positives: {}}, spent: {}, attempts: {}, replays: []};
      const timing = simulateNocturneLookahead({units: timedUnits, windows, positiveUnitIds, wpm, lookaheadMs, openingWaitMs,
        budget: BUDGET, attempt: ({index, number}) => scenario.retryFirst && index === 0 && number === 1 ?
          {latencyMs, outcome: "transient"} : {...answers[index], latencyMs}});
      addCounts(row.coverage.units, timing.coverage.units);
      addCounts(row.coverage.positives, timing.coverage.positives);
      addCounts(row.spent, timing.spent);
      addCounts(row.attempts, timing.attempts);
      if (scope === "exact") {
        const onTimeUnits = new Set(timing.unitTrace.filter(visit => visit.availableAtMs !== null &&
          visit.availableAtMs <= visit.entryMs).map(visit => visit.id));
        row.replays.push(await replayPassage(passage, {pace: wpm, arm: "scene-unit", onTimeUnits, candidateMap}));
      }
    }
  }
  for (const group of Object.values(groups)) for (const row of Object.values(group)) {
    if (row.replays.length) row.playback = summarizePlayback(row.replays);
    delete row.replays;
  }
  return {interpretation: "Reference-answer replay with assumed provider completion times. Playback uses ideal sentence positions and maps ready by unit entry.",
    sourceScope: hostedScope ? "explicit-hosted-approval" : "offline-reference-eligible", maxUnitsPerWindow,
    paces: PACES, scenarios: SCENARIOS, budgetPerPassage: BUDGET, groups};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const {positionals, values} = parseArgs({allowPositionals: true, options: {
      "hosted-scope": {type: "boolean"}, "window-units": {type: "string"},
    }});
    if (positionals.length !== 1) throw new Error();
    console.log(JSON.stringify(await evaluateNocturneTiming(positionals[0], {hostedScope: values["hosted-scope"],
      maxUnitsPerWindow: values["window-units"] === undefined ? undefined : Number(values["window-units"])}), null, 2));
  } catch {
    console.error("Use node scripts/evaluate-nocturne-timing.mjs MANIFEST [--hosted-scope] [--window-units COUNT] with a validated private corpus.");
    process.exitCode = 1;
  }
}
