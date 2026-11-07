import {buildWholeStoryIndex, MAX_WHOLE_STORY_REQUESTS, planWholeStoryContext, WHOLE_STORY_GRANT_PURPOSE,
  WHOLE_STORY_PLAN_LIMITS} from "./whole-story-context-planning.mjs";
import {MAX_TEXT_BYTES} from "../../app/static/reader/import.mjs";

export const WHOLE_STORY_SINGLE_REQUEST_LIMITS = Object.freeze({maxWindowSourceBytes: MAX_TEXT_BYTES,
  maxWindowBodyBytes: 750_000, maxTargetsPerWindow: 1200});

const maxParagraphWindowSize = 64;
const maxCausalPrefixUnits = 24;
const wholeGrantFields = ["editionDigest", "segmentationVersion", "purpose", "expiresAt", "byteStart", "byteEnd"];
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const spanBytes = unit => unit.byteEnd - unit.byteStart;
const totalSpanBytes = units => units.reduce((sum, unit) => sum + spanBytes(unit), 0);

function exactWholeGrant(grant, {editionDigest, segmentationVersion}, now, sourceBytes) {
  return grant && typeof grant === "object" && !Array.isArray(grant) &&
    Object.keys(grant).length === wholeGrantFields.length && wholeGrantFields.every(key => Object.hasOwn(grant, key)) &&
    grant.editionDigest === editionDigest && grant.segmentationVersion === segmentationVersion &&
    grant.purpose === WHOLE_STORY_GRANT_PURPOSE && Number.isSafeInteger(grant.expiresAt) && grant.expiresAt > now &&
    grant.byteStart === 0 && grant.byteEnd === sourceBytes;
}

function checkedWholeLimits(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.entries(overrides).some(([key, value]) =>
    !Object.hasOwn(WHOLE_STORY_SINGLE_REQUEST_LIMITS, key) || !bounded(value, 1, WHOLE_STORY_SINGLE_REQUEST_LIMITS[key]))) {
    throw new RangeError("Use bounded whole-edition limits.");
  }
  return {...WHOLE_STORY_SINGLE_REQUEST_LIMITS, ...overrides};
}

function makeWindow({id, identity, runId, targets, context = [], paragraphs, text}) {
  const targetIds = targets.map(({id}) => id), contextIds = context.map(({id}) => id);
  const units = text === undefined ? [...context, ...targets].map(({id, text}) => ({id, text})) :
    targets.map(({id, byteStart, byteEnd}) => ({id, byteStart, byteEnd}));
  const body = JSON.stringify({...identity, runId, units, targetIds,
    ...(paragraphs ? {paragraphs} : {}), ...(text === undefined ? {} : {text})});
  const targetSourceBytes = totalSpanBytes(targets), overlapSourceBytes = totalSpanBytes(context);
  const sourceBytes = text === undefined ? targetSourceBytes + overlapSourceBytes : Buffer.byteLength(text);
  return {id, runId, targetIds, contextIds, body, sourceBytes, bodyBytes: Buffer.byteLength(body), targetSourceBytes, overlapSourceBytes};
}

function fitsWindow(window, limits) {
  return window.sourceBytes <= limits.maxWindowSourceBytes && window.bodyBytes <= limits.maxWindowBodyBytes &&
    window.targetIds.length <= limits.maxTargetsPerWindow;
}

function schedule(windows, limits, startId) {
  const next = windows.findIndex(window => window.targetIds.at(-1) >= startId);
  const pivot = next < 0 ? Math.max(0, windows.length - 1) : next;
  const selected = [];
  let bytes = 0;
  for (const window of [...windows.slice(pivot), ...windows.slice(0, pivot)]) {
    if (selected.length >= limits.maxRequests) break;
    if (bytes + window.sourceBytes > limits.maxSourceBytes) continue;
    selected.push(window);
    bytes += window.sourceBytes;
  }
  return selected;
}

function arm(windows, concurrency, approvedUnits, {reason, ineligibleTargets = 0, oversizedUnits = 0, runs = 0} = {}) {
  const summary = {approvedUnits, ineligibleTargets, oversizedUnits, runs, requests: windows.length,
    plannedTargets: 0, plannedTargetSourceBytes: 0, overlapUnits: 0, overlapSourceBytes: 0, framingSourceBytes: 0,
    sourceBytes: 0, bodyBytes: 0};
  for (const window of windows) {
    const {sourceBytes, bodyBytes, targetIds, contextIds, targetSourceBytes, overlapSourceBytes} = window;
    summary.plannedTargets += targetIds.length;
    summary.plannedTargetSourceBytes += targetSourceBytes;
    summary.overlapUnits += contextIds.length;
    summary.overlapSourceBytes += overlapSourceBytes;
    summary.framingSourceBytes += sourceBytes - targetSourceBytes - overlapSourceBytes;
    summary.sourceBytes += sourceBytes;
    summary.bodyBytes += bodyBytes;
  }
  summary.budgetDeferredUnits = approvedUnits - ineligibleTargets - oversizedUnits - summary.plannedTargets;
  return {status: windows.length ? "planned" : "skipped", ...(reason ? {reason} : {}), concurrency, windows, summary};
}

function wholeArm(text, identity, nonstructuralUnits, targets, grant, now, limits) {
  const approvedUnits = targets.length, sourceBytes = Buffer.byteLength(text);
  if (!approvedUnits) return arm([], 1, 0, {reason: "no-approved-targets"});
  if (approvedUnits !== nonstructuralUnits) {
    return arm([], 1, approvedUnits, {reason: "partial-clearance", ineligibleTargets: approvedUnits});
  }
  if (!exactWholeGrant(grant, identity, now, sourceBytes)) {
    return arm([], 1, approvedUnits, {reason: grant == null ? "missing-whole-edition-grant" : "invalid-whole-edition-grant",
      ineligibleTargets: approvedUnits});
  }
  const overLimit = () => arm([], 1, approvedUnits, {reason: "whole-edition-limit", oversizedUnits: approvedUnits, runs: 1});
  if (sourceBytes > limits.maxWindowSourceBytes || approvedUnits > limits.maxTargetsPerWindow) return overLimit();
  const runId = targets[0].id;
  const window = makeWindow({id: `whole:${runId}-${targets.at(-1).id}`, identity, runId, targets, text});
  if (!fitsWindow(window, limits)) return overLimit();
  const windows = schedule([window], limits, 0);
  return arm(windows, 1, approvedUnits, {reason: windows.length ? undefined : "budget-deferred", runs: 1});
}

function paragraphArm(identity, units, approved, limits, paragraphWindowSize, startId) {
  const paragraphs = Map.groupBy(units, ({paragraph}) => paragraph);
  const demand = [];
  let runId, pending = [], ineligibleTargets = 0, oversizedUnits = 0, runs = 0;
  function window(rows) {
    const targets = rows.flat(), paragraphs = rows.map(units => ({id: units[0].paragraph, unitIds: units.map(unit => unit.id)}));
    return makeWindow({id: `paragraph:${runId}:${targets[0].id}-${targets.at(-1).id}`, identity, runId, targets, paragraphs});
  }
  function flush() {
    if (pending.length) demand.push(window(pending));
    pending = [];
  }
  for (const rows of paragraphs.values()) {
    const approvedCount = rows.filter(unit => approved.has(unit.id)).length;
    // A partial paragraph cannot become a paragraph-window input. Keep the
    // individual cleared sentences available to the sentence arm instead.
    if (approvedCount !== rows.length) {
      ineligibleTargets += approvedCount;
      flush();
      runId = undefined;
      continue;
    }
    const fresh = runId === undefined;
    runId ??= rows[0].id;
    if (!fitsWindow(window([rows]), limits)) {
      oversizedUnits += rows.length;
      flush();
      runId = undefined;
      continue;
    }
    if (fresh) runs++;
    const joined = [...pending, rows], candidate = window(joined);
    if (joined.length > paragraphWindowSize || !fitsWindow(candidate, limits) || candidate.sourceBytes > limits.maxSourceBytes) flush();
    pending.push(rows);
  }
  flush();
  const windows = schedule(demand, limits, startId);
  return arm(windows, 2, approved.size, {ineligibleTargets, oversizedUnits, runs,
    reason: windows.length ? undefined : approved.size ? "no-paragraph-windows" : "no-approved-targets"});
}

function extendPrefix(window, identity, units, approved, limits, depth, bytes) {
  const target = units[window.targetIds[0]], context = [];
  const forContext = () => makeWindow({id: window.id, identity, runId: window.runId, targets: [target], context});
  let candidate = forContext();
  for (let id = target.id - 1; id >= window.runId && context.length < depth && approved.has(id); id--) {
    context.unshift(units[id]);
    const next = forContext();
    if (next.overlapSourceBytes > bytes || !fitsWindow(next, limits) || next.sourceBytes > limits.maxSourceBytes) break;
    candidate = next;
  }
  return candidate;
}

// A founder comparison plan has one fixed approved target denominator. This
// checks source admission, not model context or response capacity.
export function planWholeStoryComparison(text, {grant, wholeEditionGrant, now = Date.now(), startId = 0,
  limits: overrides = {}, wholeLimits: wholeOverrides = {}, paragraphWindowSize = 3, causalPrefixUnits, causalPrefixBytes} = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) ||
      (Object.hasOwn(overrides, "maxTargetsPerWindow") &&
        !bounded(overrides.maxTargetsPerWindow, 1, WHOLE_STORY_PLAN_LIMITS.maxTargetsPerWindow))) {
    throw new RangeError("Use bounded comparison limits.");
  }
  const limits = {...WHOLE_STORY_PLAN_LIMITS, ...overrides};
  const wholeLimits = {...limits, ...checkedWholeLimits(wholeOverrides)};
  const depth = causalPrefixUnits === undefined ? limits.maxOverlapUnits : causalPrefixUnits;
  const bytes = causalPrefixBytes === undefined ? limits.maxOverlapBytes : causalPrefixBytes;
  if (!bounded(paragraphWindowSize, 1, maxParagraphWindowSize) || !bounded(depth, 0, maxCausalPrefixUnits) ||
      !bounded(bytes, 0, WHOLE_STORY_PLAN_LIMITS.maxWindowSourceBytes)) throw new RangeError("Use bounded comparison limits.");
  const {units, ...identity} = buildWholeStoryIndex(text);
  const customPrefix = causalPrefixUnits !== undefined || causalPrefixBytes !== undefined;
  const sentenceLimits = {...overrides, maxTargetsPerWindow: 1};
  const base = planWholeStoryContext(text, {grant, now, startId, limits: sentenceLimits});
  const approved = new Set(grant?.spans.map(({id}) => id));
  const targets = units.filter(unit => approved.has(unit.id));
  let sentenceWindows = base.windows;
  if (customPrefix) {
    const demand = planWholeStoryContext(text, {grant, now, startId, limits: {...sentenceLimits,
      maxRequests: MAX_WHOLE_STORY_REQUESTS, maxSourceBytes: WHOLE_STORY_PLAN_LIMITS.maxSourceBytes, maxOverlapUnits: 0}});
    const expanded = demand.windows.map(window => extendPrefix(window, identity, units, approved, limits, depth, bytes));
    sentenceWindows = schedule(expanded, limits, startId);
  }
  const sentence = arm(sentenceWindows, 2, approved.size, {oversizedUnits: base.summary.oversizedUnits, runs: base.summary.runs,
    reason: sentenceWindows.length ? undefined : approved.size ? "no-sentence-windows" : "no-approved-targets"});
  const structuralUnits = units.filter(unit => unit.structuralBoundary).length;
  const nonstructuralUnits = units.length - structuralUnits;
  const summary = {units: units.length, structuralUnits, approvedUnits: approved.size, withheldUnits: nonstructuralUnits - approved.size};
  return {...identity, targetIds: targets.map(({id}) => id), summary, arms: {
    whole: wholeArm(text, identity, nonstructuralUnits, targets, wholeEditionGrant, now, wholeLimits),
    paragraph: paragraphArm(identity, units, approved, limits, paragraphWindowSize, startId), sentence,
  }};
}
