import {compileSceneMap, validateSceneMap} from "../../app/static/reader/scene-map.mjs";
import {digestDecisionsCorpusWindow} from "./decisions-corpus-pins.mjs";
import {analyzeNocturneDecisions, DECISIONS_TARGETS_PER_CALL} from "./scene-decisions.mjs";

export const STORY_STUDY_MAX_REQUESTS = 12;
export const STORY_STUDY_MAX_TOTAL_REQUESTS = 20;

const DECISIONS_URL = "https://api.openai.com/v1/decisions";
const MAX_BATCH_SOURCE_BYTES = 32_000;
const MAX_BATCH_SERIALIZED_SOURCE_BYTES = 64_000;
const encoder = new TextEncoder();
const arms = ["baseline", "candidate"];
const tallyFields = ["targetedUnits", "answeredUnits", "refusedUnits", "uncertainUnits", "inconsistentUnits",
  "failedUnits", "answeredQuestions", "refusedQuestions", "boundaryConflicts", "boundaryAnsweredQuestions",
  "boundaryRefusedQuestions", "boundaryUncertainUnits", "appliedBoundaryUnits"];
const usageFields = ["inputTokens", "outputTokens", "reasoningTokens", "cachedInputTokens", "cacheWriteInputTokens"];
const statuses = new Set(["completed", "partial", "aborted", "input_limit", "extraction_failed"]);
const callStatuses = new Set(["parsed", "http_error", "provider_error", "invalid_response", "refused", "aborted", "timed_out"]);
const exactFields = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/u.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = values => values.reduce((total, value) => total + value, 0);
const ratio = (value, denominator) => denominator ? value / denominator : null;
const invalidPayload = () => new TypeError("Submit the approved story study payload.");

function validAnchorIds(ids, unitCount) {
  return Array.isArray(ids) && ids.every((id, index) => Number.isSafeInteger(id) && id >= 0 &&
    id < unitCount && (index === 0 || id > ids[index - 1]));
}

// Count structural units against the plan too, so either split's call budget
// can be checked using its pins before receiving the other split's text.
function packStories(stories) {
  const batches = [];
  for (const story of [...stories].sort((a, b) => b.unitCount - a.unitCount)) {
    let batch = batches.find(item => item.unitCount + story.unitCount <= DECISIONS_TARGETS_PER_CALL);
    if (!batch) {
      batch = {stories: [], unitCount: 0};
      batches.push(batch);
    }
    batch.stories.push(story);
    batch.unitCount += story.unitCount;
  }
  return batches;
}

function validatePins(pins) {
  if (!pins || typeof pins !== "object" || Array.isArray(pins) || !validId(pins.version)) throw invalidPayload();
  let totalCalls = 0;
  const storyIds = new Set();
  for (const [split, stories] of Object.entries(pins)) {
    if (split === "version") continue;
    if (!validId(split) || !Array.isArray(stories) || !stories.length || stories.length > 48) throw invalidPayload();
    for (const pin of stories) {
      if (!exactFields(pin, ["id", "sha256", "unitCount", "positives", "boundaries"]) || !validId(pin.id) || storyIds.has(pin.id) ||
          typeof pin.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(pin.sha256) || !Number.isSafeInteger(pin.unitCount) ||
          pin.unitCount < 1 || pin.unitCount > DECISIONS_TARGETS_PER_CALL || !validAnchorIds(pin.positives, pin.unitCount) ||
          !validAnchorIds(pin.boundaries, pin.unitCount) || pin.positives.some(id => pin.boundaries.includes(id))) throw invalidPayload();
      storyIds.add(pin.id);
    }
    const calls = packStories(stories).length * arms.length;
    if (calls > STORY_STUDY_MAX_REQUESTS) throw invalidPayload();
    totalCalls += calls;
  }
  if (!totalCalls || totalCalls > STORY_STUDY_MAX_TOTAL_REQUESTS) throw invalidPayload();
}

/** Check the complete pin plan and the submitted split before any provider calls. */
export async function validateStoryStudyPayload(payload, pins) {
  validatePins(pins);
  if (!exactFields(payload, ["version", "split", "stories"]) || payload.version !== pins.version ||
      !validId(payload.split) || !Object.hasOwn(pins, payload.split) || !Array.isArray(pins[payload.split]) ||
      !Array.isArray(payload.stories) || payload.stories.length !== pins[payload.split].length) throw invalidPayload();
  const stories = await Promise.all(pins[payload.split].map(async (pin, index) => {
    const story = payload.stories[index];
    if (!exactFields(story, ["id", "units"]) || story.id !== pin.id || !Array.isArray(story.units) ||
        story.units.length !== pin.unitCount) throw invalidPayload();
    validateSceneMap({scenes: []}, story.units);
    const units = story.units.map(unit => ({...unit}));
    if (units.some((unit, id) => unit.id !== id) || !units.some(unit => !unit.structuralBoundary) ||
        [...pin.positives, ...pin.boundaries].some(id => units[id].structuralBoundary) ||
        await digestDecisionsCorpusWindow(units) !== pin.sha256) throw invalidPayload();
    return {id: pin.id, units, unitCount: pin.unitCount, positives: [...pin.positives], boundaries: [...pin.boundaries]};
  }));
  const batches = packStories(stories);
  for (const batch of batches) {
    const {units} = rebaseBatch(batch);
    const bytes = sum(units.map(unit => encoder.encode(unit.text).length));
    const serialized = encoder.encode(JSON.stringify(units.map(({id, text, structuralBoundary}) =>
      ({id, text, structuralBoundary})))).length;
    if (bytes > MAX_BATCH_SOURCE_BYTES || serialized > MAX_BATCH_SERIALIZED_SOURCE_BYTES) throw invalidPayload();
  }
  return {split: payload.split, stories, plannedProviderCalls: batches.length * arms.length};
}

function rebaseBatch(batch) {
  const units = [], stories = [];
  let nextId = 0, nextParagraph = -1;
  for (const story of batch.stories) {
    const idBase = nextId, first = units.length;
    let previousParagraph = -1;
    for (const unit of story.units) {
      if (unit.paragraph !== previousParagraph) {
        previousParagraph = unit.paragraph;
        nextParagraph++;
      }
      units.push({...unit, id: nextId++, paragraph: nextParagraph});
    }
    stories.push({story, idBase, first, end: units.length});
    // The Decisions instructions forbid inference across an absent ordinal.
    nextId++;
    nextParagraph++;
  }
  return {units, stories};
}

function score(found, missed, falseCount) {
  return {found, missed, false: falseCount, precision: ratio(found, found + falseCount), recall: ratio(found, found + missed)};
}

function compare(expected, observed) {
  const gold = new Set(expected), actual = new Set(observed);
  const found = expected.filter(id => actual.has(id)).length;
  return score(found, expected.length - found, [...actual].filter(id => !gold.has(id)).length);
}

function safeCall(call) {
  return {status: Number.isInteger(call.status) && call.status >= 100 && call.status <= 599 ? call.status : null,
    result: callStatuses.has(call.result) ? call.result : "unavailable", elapsedMs: count(call.elapsedMs),
    usage: call.usage ? Object.fromEntries(usageFields.map(field => [field, count(call.usage[field])])) : null};
}

function scoreStory({story, idBase, first, end}, timeline, independentBoundaryIds) {
  const rows = timeline.slice(first, end);
  const mappedUnits = rows.filter(row => row.sceneId !== null && row.frame !== "uncertain").length;
  const sentenceCues = compare(story.positives, rows.filter(row => row.emphasis > 0).map(row => row.id - idBase));
  const sentenceBoundaries = compare(story.boundaries, rows.filter(row => row.boundary === "model").map(row => row.id - idBase));
  const negativeUnits = story.units.filter(unit => !unit.structuralBoundary).length - story.positives.length;
  return {mappedUnits, mappedCoverage: ratio(mappedUnits, story.unitCount), sentenceCues, sentenceBoundaries,
    nonCueFalsePositiveRate: ratio(sentenceCues.false, negativeUnits), independentBoundaryVotes: independentBoundaryIds === null ? null :
      compare(story.boundaries, [...independentBoundaryIds].filter(id => id >= idBase && id < idBase + story.unitCount)
        .map(id => id - idBase))};
}

function summarize(stories, batches, arm) {
  const scored = stories.map(story => story[arm]);
  const measured = batches.map(batch => batch[arm]);
  const calls = measured.flatMap(batch => batch.calls);
  const timings = calls.flatMap(call => call.elapsedMs === null ? [] : [call.elapsedMs]).sort((a, b) => a - b);
  const percentile = fraction => timings[Math.ceil(timings.length * fraction) - 1] ?? null;
  const sourceUnits = sum(stories.map(story => story.sourceUnits));
  const negativeUnits = sum(stories.map(story => story.negativeUnits));
  const mappedUnits = sum(scored.map(result => result.mappedUnits));
  const aggregate = field => {
    const values = scored.flatMap(result => result[field] ? [result[field]] : []);
    return values.length ? score(sum(values.map(value => value.found)), sum(values.map(value => value.missed)),
      sum(values.map(value => value.false))) : null;
  };
  const sentenceCues = aggregate("sentenceCues");
  const usage = Object.fromEntries(usageFields.map(field => {
    const reported = calls.flatMap(call => call.usage?.[field] == null ? [] : [call.usage[field]]);
    return [field, {reportedCalls: reported.length, total: reported.length ? sum(reported) : null}];
  }));
  return {calls: calls.length, parsedCalls: calls.filter(call => call.result === "parsed").length,
    sourceUnits, negativeUnits, mappedUnits, mappedCoverage: ratio(mappedUnits, sourceUnits), sentenceCues,
    sentenceBoundaries: aggregate("sentenceBoundaries"), independentBoundaryVotes: aggregate("independentBoundaryVotes"),
    nonCueFalsePositiveRate: ratio(sentenceCues.false, negativeUnits),
    latencyMs: {samples: timings.length, p50: percentile(0.5), p95: percentile(0.95)}, usage,
    answerCounts: Object.fromEntries(tallyFields.flatMap(field => {
      const values = measured.flatMap(batch => batch.answerCounts[field] === undefined ? [] : [batch.answerCounts[field]]);
      return values.length ? [[field, sum(values)]] : [];
    }))};
}

/** Score both Decisions prompts on identical story windows, never returning source or provider bodies. */
export async function runDecisionsStoryStudy({key, analysisFetcher = fetch, signal, payload, pins} = {}) {
  if (typeof key !== "string" || !/^sk-[A-Za-z0-9_-]{12,512}$/u.test(key) || key.startsWith("sk-admin-") ||
      typeof analysisFetcher !== "function" || (signal !== undefined && !(signal instanceof AbortSignal))) {
    throw new TypeError("Invalid story study benchmark configuration.");
  }
  const validated = await validateStoryStudyPayload(payload, pins);
  let attempts = 0;
  const batches = [];
  const scored = new Map(validated.stories.map(story => [story.id, {story: story.id, sourceUnits: story.unitCount,
    negativeUnits: story.units.filter(unit => !unit.structuralBoundary).length - story.positives.length}]));
  for (const [index, batch] of packStories(validated.stories).entries()) {
    const {units, stories} = rebaseBatch(batch);
    const approvedIds = units.map(unit => unit.id);
    const report = {stories: stories.map(({story}) => story.id)};
    for (const arm of index % 2 ? [...arms].reverse() : arms) {
      const separateBoundary = arm === "candidate";
      const {accepted, trace, boundaryIds} = await analyzeNocturneDecisions({units, approvedIds, signal, joint: true, separateBoundary,
        provider: (request, options) => {
          options.signal.throwIfAborted();
          if (attempts >= validated.plannedProviderCalls) throw new RangeError("Story study request limit reached.");
          attempts++;
          return analysisFetcher(DECISIONS_URL, {method: "POST", redirect: "manual", signal: options.signal,
            headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Cache-Control": "no-store"},
            body: JSON.stringify(request)});
        }});
      const timeline = accepted ? compileSceneMap(accepted, units) : [];
      const independentBoundaryIds = separateBoundary ? new Set(boundaryIds) : null;
      for (const entry of stories) scored.get(entry.story.id)[arm] = scoreStory(entry, timeline, independentBoundaryIds);
      report[arm] = {status: statuses.has(trace.status) ? trace.status : "unavailable", calls: trace.calls.map(safeCall),
        answerCounts: Object.fromEntries(tallyFields.flatMap(field => count(trace[field]) === null ? [] : [[field, trace[field]]]))};
    }
    batches.push(report);
  }
  const stories = [...scored.values()];
  return {version: pins.version, split: validated.split, model: "gpt-6-luna", storyCount: stories.length,
    prompts: {baseline: "joint-label-v2", candidate: "joint-label-v3-separate-boundary"},
    aborted: signal?.aborted === true, plannedProviderCalls: validated.plannedProviderCalls, stories, batches,
    totals: Object.fromEntries(arms.map(arm => [arm, summarize(stories, batches, arm)]))};
}
