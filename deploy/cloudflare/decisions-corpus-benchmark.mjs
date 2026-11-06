import {validateSceneMap} from "../../app/static/reader/scene-map.mjs";
import {runMatchedDecisionsBenchmark} from "./decisions-benchmark.mjs";
import {DECISIONS_CORPUS_PINS, DECISIONS_CORPUS_VERSION, digestDecisionsCorpusWindow} from "./decisions-corpus-pins.mjs";
import {DECISIONS_TARGETS_PER_CALL} from "./scene-decisions.mjs";

export const DECISIONS_CORPUS_MAX_REQUESTS = 6;

const exactFields = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const invalidPayload = () => new TypeError("Submit the approved corpus benchmark payload.");

/** Validate every pinned window before spending quota or forwarding any text. */
export async function validateDecisionsCorpusPayload(payload) {
  if (!exactFields(payload, ["version", "windows"]) || payload.version !== DECISIONS_CORPUS_VERSION ||
      !Array.isArray(payload.windows) || payload.windows.length * 2 !== DECISIONS_CORPUS_MAX_REQUESTS ||
      payload.windows.length !== DECISIONS_CORPUS_PINS.length) throw invalidPayload();

  return Promise.all(DECISIONS_CORPUS_PINS.map(async ({id, sha256, unitCount, approvedUnitCount, positives, boundaries}, index) => {
    const window = payload.windows[index];
    if (!exactFields(window, ["id", "units"]) || window.id !== id || !Array.isArray(window.units) ||
        window.units.length !== approvedUnitCount) throw invalidPayload();
    validateSceneMap({scenes: []}, window.units);
    const units = window.units.map(unit => ({...unit}));
    const targetCount = units.filter(unit => !unit.structuralBoundary).length;
    if (!targetCount || targetCount > DECISIONS_TARGETS_PER_CALL || units.at(-1).id >= unitCount ||
        await digestDecisionsCorpusWindow(units) !== sha256) throw invalidPayload();
    return {id, units, unitCount, positives, boundaries};
  }));
}

export async function runDecisionsCorpusBenchmark({key, analysisFetcher = fetch, signal, payload} = {}) {
  if (typeof analysisFetcher !== "function") throw new TypeError("Invalid Nocturne benchmark configuration.");
  const cases = await validateDecisionsCorpusPayload(payload);
  const approvedUnits = cases.reduce((sum, {units}) => sum + units.length, 0);
  const excludedUnits = cases.reduce((sum, {unitCount, units}) => sum + unitCount - units.length, 0);
  let attempts = 0;
  const result = await runMatchedDecisionsBenchmark({key, signal, cases, analysisFetcher: (url, init) => {
    if (attempts >= DECISIONS_CORPUS_MAX_REQUESTS) throw new RangeError("Corpus benchmark request limit reached.");
    attempts++;
    return analysisFetcher(url, init);
  }});
  return {...result, version: DECISIONS_CORPUS_VERSION, approvedUnits, excludedUnits};
}
