import {createHash} from "node:crypto";
import {splitText} from "../../app/static/reader/import.mjs";
import {buildSceneUnits} from "../../app/static/reader/scene-map.mjs";

export const WHOLE_STORY_SEGMENTATION_VERSION = "reader-sentences-v1";
export const WHOLE_STORY_GRANT_PURPOSE = "nocturne-luna-editorial-shadow";
export const MAX_WHOLE_STORY_REQUESTS = 96;
export const WHOLE_STORY_PLAN_LIMITS = Object.freeze({maxRequests: 40, maxSourceBytes: 500_000,
  maxWindowSourceBytes: 12_000, maxWindowBodyBytes: 16_384, maxTargetsPerWindow: 48,
  maxOverlapUnits: 4, maxOverlapBytes: 1200});
const maximumLimits = {...WHOLE_STORY_PLAN_LIMITS, maxRequests: MAX_WHOLE_STORY_REQUESTS};

const exactFields = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const whole = value => Number.isSafeInteger(value) && value >= 0;
const digestPattern = /^[a-f0-9]{64}$/u;
const sourceDigest = text => createHash("sha256").update(text, "utf8").digest("hex");

// The reader normalizes CRLF before segmenting. Project its coordinates back to
// the original edition without normalizing the bytes used in a grant or payload.
function editionOffsets(text, normalizedLength) {
  const utf16 = new Uint32Array(normalizedLength + 1), utf8 = new Uint32Array(normalizedLength + 1);
  let source = 0, normalized = 0, bytes = 0;
  while (source < text.length) {
    const codePoint = text.codePointAt(source);
    if (codePoint === 13 && text.charCodeAt(source + 1) === 10) {
      source += 2;
      normalized++;
      bytes += 2;
    } else {
      const width = codePoint > 0xffff ? 2 : 1;
      source += width;
      normalized += width;
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : width === 1 ? 3 : 4;
    }
    utf16[normalized] = source;
    utf8[normalized] = bytes;
  }
  return {utf16, utf8};
}

export function buildWholeStoryIndex(text) {
  if (typeof text !== "string" || !text.isWellFormed() || text.includes("\u0000")) {
    throw new TypeError("Use a well-formed story edition without NUL characters.");
  }
  const paragraphs = splitText(text);
  const normalized = text.replace(/\r\n?/gu, "\n");
  const {utf16, utf8} = editionOffsets(text, normalized.length);
  let paragraphEnd = 0;
  const starts = paragraphs.map(paragraph => {
    const start = normalized.indexOf(paragraph, paragraphEnd);
    if (start < 0) throw new TypeError("Cannot align this story edition with reader paragraphs.");
    paragraphEnd = start + paragraph.length;
    return start;
  });
  const units = buildSceneUnits(paragraphs).map(unit => {
    const start = starts[unit.paragraph] + unit.start, end = starts[unit.paragraph] + unit.end;
    const exact = text.slice(utf16[start], utf16[end]);
    if (exact.replace(/\r\n?/gu, "\n") !== unit.text) throw new TypeError("Cannot align this story edition with reader sentences.");
    return {...unit, text: exact, byteStart: utf8[start], byteEnd: utf8[end], digest: sourceDigest(exact)};
  });
  return {editionDigest: sourceDigest(text), segmentationVersion: WHOLE_STORY_SEGMENTATION_VERSION, units};
}

function checkedGrant(index, grant, now) {
  if (grant == null) return new Set();
  const invalid = () => new TypeError("Use a current grant for this exact story edition and its exact spans.");
  if (!exactFields(grant, ["editionDigest", "segmentationVersion", "purpose", "expiresAt", "spans"]) ||
      grant.editionDigest !== index.editionDigest || grant.segmentationVersion !== index.segmentationVersion ||
      grant.purpose !== WHOLE_STORY_GRANT_PURPOSE || !whole(grant.expiresAt) || grant.expiresAt <= now ||
      !Array.isArray(grant.spans) || grant.spans.length > index.units.length) throw invalid();
  const approved = new Set();
  for (const span of grant.spans) {
    if (!exactFields(span, ["id", "byteStart", "byteEnd", "digest"]) || !whole(span.id) || approved.has(span.id) ||
        typeof span.digest !== "string" || !digestPattern.test(span.digest)) throw invalid();
    const unit = index.units[span.id];
    if (!unit || unit.structuralBoundary || unit.byteStart !== span.byteStart || unit.byteEnd !== span.byteEnd ||
        unit.digest !== span.digest) throw invalid();
    approved.add(span.id);
  }
  return approved;
}

function checkedLimits(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new TypeError("Use bounded planner limits.");
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(maximumLimits, key) || !whole(value) || value > maximumLimits[key] ||
        (!value && ["maxWindowSourceBytes", "maxWindowBodyBytes", "maxTargetsPerWindow"].includes(key))) {
      throw new RangeError("Use bounded planner limits.");
    }
  }
  return {...WHOLE_STORY_PLAN_LIMITS, ...overrides};
}

const spanBytes = ({byteStart, byteEnd}) => byteEnd - byteStart;
const sumSpanBytes = units => units.reduce((sum, unit) => sum + spanBytes(unit), 0);

function makeWindow(identity, runId, targets, context = []) {
  const targetIds = targets.map(({id}) => id), contextIds = context.map(({id}) => id);
  const units = [...context, ...targets].map(({id, text}) => ({id, text}));
  const body = JSON.stringify({...identity, runId, units, targetIds});
  const targetSourceBytes = sumSpanBytes(targets), overlapSourceBytes = sumSpanBytes(context);
  return {id: `${runId}:${targetIds[0]}-${targetIds.at(-1)}`, runId, targetIds, contextIds, body,
    bodyBytes: Buffer.byteLength(body), sourceBytes: targetSourceBytes + overlapSourceBytes, targetSourceBytes, overlapSourceBytes};
}

function buildRuns(units, approved, identity, fits) {
  const runs = [];
  let run, oversized = 0;
  for (const unit of units) {
    if (!approved.has(unit.id)) {
      run = undefined;
      continue;
    }
    if (!fits(makeWindow(identity, run?.[0].id ?? unit.id, [unit]))) {
      oversized++;
      run = undefined;
      continue;
    }
    if (!run) runs.push(run = []);
    run.push(unit);
  }
  return {runs, oversized};
}

function runWindows(run, identity, limits, fits) {
  const windows = [], runId = run[0].id;
  for (let start = 0; start < run.length;) {
    const targets = [run[start]], context = [];
    let window = makeWindow(identity, runId, targets);
    for (let index = start + 1; index < run.length && targets.length < limits.maxTargetsPerWindow; index++) {
      const next = makeWindow(identity, runId, [...targets, run[index]]);
      if (!fits(next)) break;
      targets.push(run[index]);
      window = next;
    }
    for (let index = start - 1; index >= 0 && context.length < limits.maxOverlapUnits; index--) {
      const next = makeWindow(identity, runId, targets, [run[index], ...context]);
      if (next.overlapSourceBytes > limits.maxOverlapBytes || !fits(next)) break;
      context.unshift(run[index]);
      window = next;
    }
    windows.push(window);
    start += targets.length;
  }
  return windows;
}

// Offline only. The caller supplies a trusted review grant. Matching hashes
// validates what it covers, while the caller remains responsible for its origin.
export function planWholeStoryContext(text, {grant, now = Date.now(), startId = 0, limits: overrides = {}} = {}) {
  return planIndexedWholeStoryContext(buildWholeStoryIndex(text), {grant, now, startId, limits: overrides});
}

// Use only an index produced by buildWholeStoryIndex for the current edition.
export function planIndexedWholeStoryContext({units, ...identity}, {grant, now = Date.now(), startId = 0, limits: overrides = {}} = {}) {
  if (!whole(now) || !whole(startId) || startId >= Math.max(1, units.length)) throw new RangeError("Use a valid time and starting sentence.");
  const approved = checkedGrant({units, ...identity}, grant, now), limits = checkedLimits(overrides);
  const fits = window => window.sourceBytes <= limits.maxWindowSourceBytes && window.bodyBytes <= limits.maxWindowBodyBytes;
  const {runs, oversized} = buildRuns(units, approved, identity, fits);
  const fitsSession = window => fits(window) && window.sourceBytes <= limits.maxSourceBytes;
  const demand = runs.flatMap(run => runWindows(run, identity, limits, fitsSession));
  const first = demand.findIndex(window => window.targetIds.at(-1) >= startId);
  const pivot = first < 0 ? Math.max(0, demand.length - 1) : first;
  const windows = [];
  let sourceBytes = 0, bodyBytes = 0, plannedTargets = 0, plannedTargetSourceBytes = 0, overlapUnits = 0;
  for (const window of [...demand.slice(pivot), ...demand.slice(0, pivot)]) {
    if (windows.length >= limits.maxRequests) break;
    if (sourceBytes + window.sourceBytes > limits.maxSourceBytes) continue;
    windows.push(window);
    sourceBytes += window.sourceBytes;
    bodyBytes += window.bodyBytes;
    plannedTargets += window.targetIds.length;
    plannedTargetSourceBytes += window.targetSourceBytes;
    overlapUnits += window.contextIds.length;
  }
  const structuralUnits = units.filter(unit => unit.structuralBoundary).length;
  return {...identity, windows, summary: {units: units.length, structuralUnits, approvedUnits: approved.size,
    withheldUnits: units.length - structuralUnits - approved.size, runs: runs.length, oversizedUnits: oversized,
    budgetDeferredUnits: approved.size - oversized - plannedTargets, plannedTargets, plannedTargetSourceBytes, overlapUnits,
    overlapSourceBytes: sourceBytes - plannedTargetSourceBytes, sourceBytes, bodyBytes, requests: windows.length}};
}
