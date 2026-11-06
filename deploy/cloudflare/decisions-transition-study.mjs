import {validateStoryStudyPayload} from "./decisions-story-study.mjs";
import {analyzeStoryTransitions, STORY_TRANSITION_PROMPT, STORY_TRANSITION_STATE_PROMPT} from "./story-transition-analysis.mjs";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const statuses = new Set(["completed", "partial", "aborted", "input_limit", "extraction_failed"]);
const callStatuses = new Set(["parsed", "http_error", "provider_error", "invalid_response", "refused", "truncated",
  "incomplete", "aborted", "timed_out"]);
const usageFields = ["inputTokens", "outputTokens", "reasoningTokens", "cachedInputTokens", "cacheWriteInputTokens"];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = values => values.reduce((total, value) => total + value, 0);

function score(found, expected, predicted) {
  return {found, missed: expected - found, false: predicted - found,
    precision: predicted ? found / predicted : null, recall: expected ? found / expected : null};
}

function matchParagraphs(expected, predicted) {
  let gold = 0, observed = 0, found = 0;
  // Match the earliest compatible pair. Both sequences are sorted by source order,
  // so skipping a paragraph outside the tolerance cannot lose a later match.
  while (gold < expected.length && observed < predicted.length) {
    const distance = expected[gold] - predicted[observed];
    if (distance < -1) gold++;
    else if (distance > 1) observed++;
    else {
      found++;
      gold++;
      observed++;
    }
  }
  return found;
}

function scoreStory(story, predicted) {
  const expected = story.boundaries;
  const expectedSet = new Set(expected);
  const predictedAnchors = [...predicted].sort((left, right) => left - right);
  const missedAnchorIds = expected.filter(id => !predicted.has(id));
  const falseAnchorIds = predictedAnchors.filter(id => !expectedSet.has(id));
  const paragraphs = ids => ids.map(id => story.units[id].paragraph);
  const exactFound = expected.length - missedAnchorIds.length;
  const paragraphFound = matchParagraphs(paragraphs(expected), paragraphs(predictedAnchors));
  return {story: story.id, sourceUnits: story.unitCount,
    predictedAnchors, missedAnchorIds, falseAnchorIds,
    sentenceBoundaries: score(exactFound, expected.length, predictedAnchors.length),
    paragraphToleranceBoundaries: score(paragraphFound, expected.length, predictedAnchors.length)};
}

function combineScores(stories, field) {
  const scores = stories.map(story => story[field]);
  const found = sum(scores.map(result => result.found));
  return score(found, found + sum(scores.map(result => result.missed)), found + sum(scores.map(result => result.false)));
}

function safeCall(call) {
  return {status: Number.isInteger(call.status) && call.status >= 100 && call.status <= 599 ? call.status : null,
    result: callStatuses.has(call.result) ? call.result : "unavailable", elapsedMs: count(call.elapsedMs),
    usage: call.usage ? Object.fromEntries(usageFields.map(field => [field, count(call.usage[field])])) : null};
}

/** Score the pinned split without forwarding annotation labels or exposing provider bodies. */
export async function runDecisionsTransitionStudy({key, analysisFetcher = fetch, signal, payload, pins,
  requireStateEvidence = false} = {}) {
  if (typeof key !== "string" || !/^sk-[A-Za-z0-9_-]{12,512}$/u.test(key) || key.startsWith("sk-admin-") ||
      typeof analysisFetcher !== "function" || (signal !== undefined && !(signal instanceof AbortSignal)) ||
      typeof requireStateEvidence !== "boolean") {
    throw new TypeError("Invalid story transition benchmark configuration.");
  }
  const validated = await validateStoryStudyPayload(payload, pins);
  const source = validated.stories.map(({id, units}) => ({id, units}));
  const plannedProviderCalls = 1;
  let attempted = false;
  const {transitions, trace} = await analyzeStoryTransitions({stories: source, signal, requireStateEvidence, provider: (request, options) => {
    options.signal.throwIfAborted();
    if (attempted) throw new RangeError("Story transition study request limit reached.");
    attempted = true;
    return analysisFetcher(RESPONSES_URL, {method: "POST", redirect: "manual", signal: options.signal,
      headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Cache-Control": "no-store"},
      body: JSON.stringify(request)});
  }});
  const predicted = new Map(source.map(story => [story.id, new Set()]));
  // The adapter validates every candidate's same-story source coordinates.
  for (const {storyId, anchor} of transitions) predicted.get(storyId).add(anchor);
  const stories = validated.stories.map(story => scoreStory(story, predicted.get(story.id)));
  const calls = trace.calls.map(safeCall);
  const elapsedMs = calls[0]?.elapsedMs ?? null;
  const usage = Object.fromEntries(usageFields.map(field => {
    const total = calls[0]?.usage?.[field] ?? null;
    return [field, {reportedCalls: total === null ? 0 : 1, total}];
  }));
  return {version: pins.version, split: validated.split, model: "gpt-6-luna",
    study: requireStateEvidence ? STORY_TRANSITION_STATE_PROMPT : STORY_TRANSITION_PROMPT,
    storyCount: stories.length, aborted: signal?.aborted === true, plannedProviderCalls, stories,
    provider: {status: statuses.has(trace.status) ? trace.status : "unavailable", calls,
      rejectedTransitions: count(trace.rejectedTransitions)},
    totals: {calls: calls.length, parsedCalls: calls.filter(call => call.result === "parsed").length,
      sourceUnits: sum(stories.map(story => story.sourceUnits)), sentenceBoundaries: combineScores(stories, "sentenceBoundaries"),
      paragraphToleranceBoundaries: combineScores(stories, "paragraphToleranceBoundaries"),
      latencyMs: {samples: elapsedMs === null ? 0 : 1, p50: elapsedMs, p95: elapsedMs}, usage}};
}
