import {NOCTURNE_LABELS} from "./calibration.mjs";
import {NOCTURNE_CONTEXT_VERSION, NOCTURNE_CONTEXT_TIMEOUT_MS, MAX_CONTEXT_PARAGRAPHS, MAX_CONTEXT_BYTES, MAX_CONTEXT_BODY_BYTES, MAX_PARAGRAPH_BYTES, validateNocturneContext} from "./nocturne-context-contract.mjs";
export {NOCTURNE_LABELS};
export {NOCTURNE_CONTEXT_VERSION, validateNocturneContext};
const MAX_CUES = 16;
const rhythms = ["steady", "gentle", "dynamic"];
const shapes = ["unspecified", "accented", "sustained", "alternating"];
const endpoint = "/api/scene-analysis";
export const NOCTURNE_CONTEXT_SESSION_REQUESTS = 12;
export const NOCTURNE_CONTEXT_SESSION_BYTES = 60_000;
// Give the next window more lead time during fast, continuous reading.
const PREFETCH_BYTES = 1_500;
const OVERLAP_BYTES = 480;
const encoder = new TextEncoder();
const byteLength = value => encoder.encode(value).length;
const contextBody = paragraphs => JSON.stringify({version: NOCTURNE_CONTEXT_VERSION, consent: true, paragraphs});
const emptyBodyBytes = byteLength(contextBody([]));

function contextText(paragraph) {
  if (!paragraph?.analysed || paragraph.quiet || paragraph.cloudExcluded || paragraph.override !== null ||
      typeof paragraph.text !== "string" || !paragraph.text.trim() || paragraph.text.includes("\u0000")) return null;
  return paragraph.text;
}

function contextEntry(paragraphs, id) {
  const text = contextText(paragraphs[id]);
  if (text === null) return null;
  const paragraph = {id, text};
  return {paragraph, sourceBytes: byteLength(text), bodyBytes: byteLength(JSON.stringify(paragraph))};
}

function canFitEntry(entry, sourceLimit) {
  return entry.sourceBytes <= Math.min(sourceLimit, MAX_PARAGRAPH_BYTES) && emptyBodyBytes + entry.bodyBytes <= MAX_CONTEXT_BODY_BYTES;
}

function nextContextStart(paragraphs, position, attempted, sourceLimit, lookahead) {
  const current = Number.isInteger(position) ? Math.max(0, Math.min(position, paragraphs.length - 1)) : 0;
  const end = Math.min(paragraphs.length, current + MAX_CONTEXT_PARAGRAPHS);
  let distance = 0, excluded = 0, limited = 0;
  for (let id = current; id < end; id++) {
    if (id > current + 2 && distance > lookahead) break;
    if (!attempted.has(id)) {
      const entry = contextEntry(paragraphs, id);
      if (!entry) excluded++;
      else if (canFitEntry(entry, sourceLimit)) return {id, excluded, limited};
      else limited++;
    }
    distance += byteLength(paragraphs[id]?.text ?? "");
  }
  return {id: -1, excluded, limited};
}

export function nocturneContextNeedsReview(paragraphs, position, {attempted = new Set(), maxBytes = MAX_CONTEXT_BYTES} = {}) {
  return maxBytes > 0 && nextContextStart(paragraphs, position, attempted, maxBytes, PREFETCH_BYTES).id >= 0;
}

// Prefer new nearby text. A short already-attempted neighbour may provide
// context if it fits without reducing the amount of new text in the batch.
export function nocturneContextCandidates(paragraphs, position = 0, {attempted = new Set(), maxBytes = MAX_CONTEXT_BYTES} = {}) {
  const sourceLimit = Math.min(MAX_CONTEXT_BYTES, maxBytes);
  const start = nextContextStart(paragraphs, position, attempted, sourceLimit, MAX_CONTEXT_BYTES);
  const result = [], newIds = [];
  let {excluded, limited} = start;
  let sourceBytes = 0, bodyBytes = emptyBodyBytes;
  const fits = entry => result.length < MAX_CONTEXT_PARAGRAPHS && sourceBytes + entry.sourceBytes <= sourceLimit &&
    bodyBytes + entry.bodyBytes + Number(result.length > 0) <= MAX_CONTEXT_BODY_BYTES;
  function add(entry, overlap = false) {
    bodyBytes += entry.bodyBytes + Number(result.length > 0);
    sourceBytes += entry.sourceBytes;
    if (overlap) result.unshift(entry.paragraph);
    else { result.push(entry.paragraph); newIds.push(entry.paragraph.id); }
  }
  if (start.id >= 0) {
    const end = Math.min(paragraphs.length, start.id + MAX_CONTEXT_PARAGRAPHS);
    for (let id = start.id; id < end; id++) {
      if (attempted.has(id)) continue;
      const entry = contextEntry(paragraphs, id);
      if (!entry) { excluded++; continue; }
      if (!canFitEntry(entry, MAX_CONTEXT_BYTES)) { limited++; continue; }
      if (!fits(entry)) { limited++; break; }
      add(entry);
    }
    let overlapBytes = 0;
    for (let id = start.id - 1; id >= 0 && id >= start.id - 2 && attempted.has(id); id--) {
      const entry = contextEntry(paragraphs, id);
      if (!entry || overlapBytes + entry.sourceBytes > OVERLAP_BYTES || !fits(entry)) break;
      add(entry, true);
      overlapBytes += entry.sourceBytes;
    }
  }
  return {paragraphs: result, newIds, sourceBytes, excluded, limited};
}

export async function requestNocturneContext(paragraphs, {consent = false, signal, request = fetch} = {}) {
  if (consent !== true) throw new Error("Choose whether to send nearby story excerpts first.");
  const timeout = AbortSignal.timeout(NOCTURNE_CONTEXT_TIMEOUT_MS);
  const response = await request(endpoint, {method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
    headers: {"Content-Type": "application/json"}, body: contextBody(paragraphs),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
  const value = await response.json();
  if (!response.ok) return {labels: null, usage: null, code: value?.code};
  if (value?.version !== NOCTURNE_CONTEXT_VERSION) throw new Error("Unexpected Nocturne annotations.");
  return {...validateNocturneContext(paragraphs, value), code: null};
}

function nearbyPhase(paragraph, sceneId) {
  return paragraph && paragraph.sceneId === sceneId && !paragraph.quiet && !paragraph.cloudExcluded &&
    Object.hasOwn(NOCTURNE_LABELS, paragraph.phase) ? paragraph.phase : "quiet";
}

// Only allowlisted categories and paragraph ordinals cross this boundary.
export function nocturneCandidates(paragraphs) {
  const cues = [];
  let excluded = 0;
  for (const [id, paragraph] of paragraphs.entries()) {
    if (paragraph.cloudExcluded) { excluded++; continue; }
    if (!paragraph.analysed || paragraph.quiet || paragraph.override !== null || paragraph.suggestedLevel <= 0 ||
        !["sustain", "peak"].includes(paragraph.phase)) continue;
    const {sceneId, phase, rhythm, shape, movements} = paragraph;
    cues.push({id, phase, rhythm: rhythms.includes(rhythm) ? rhythm : "steady",
      previous: nearbyPhase(paragraphs[id - 1], sceneId), next: nearbyPhase(paragraphs[id + 1], sceneId),
      movementCount: Math.min(5, movements?.length ?? 0), shape: shapes.includes(shape) ? shape : "unspecified"});
  }
  const priority = cue => cue.phase === "peak" ? 2 : cue.shape !== "unspecified" ? 1 : 0;
  cues.sort((a, b) => priority(b) - priority(a));
  return {cues: cues.slice(0, MAX_CUES), excluded, limited: Math.max(0, cues.length - MAX_CUES)};
}

export function validateNocturneLabels(cues, response) {
  if (!response || Object.keys(response).length !== 1 || !Array.isArray(response.labels) || response.labels.length !== cues.length) {
    throw new Error("Unexpected Nocturne labels.");
  }
  const expected = new Map(cues.map(({id, phase}) => [id, NOCTURNE_LABELS[phase]]));
  const labels = new Map();
  for (const entry of response.labels) {
    if (!entry || Object.keys(entry).length !== 2 || !expected.get(entry.id)?.includes(entry.label)) {
      throw new Error("Unexpected Nocturne labels.");
    }
    expected.delete(entry.id);
    if (entry.label !== "abstain") labels.set(entry.id, entry.label);
  }
  return labels;
}

export async function nocturneAvailable(request = fetch) {
  try {
    const response = await request(endpoint, {cache: "no-store", credentials: "same-origin", redirect: "error",
      signal: AbortSignal.timeout(5000)});
    return response.ok && (await response.json()).available === true;
  } catch { return false; }
}

export async function requestNocturne(cues, {signal, request = fetch} = {}) {
  const timeout = AbortSignal.timeout(18000);
  const response = await request(endpoint, {method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
    headers: {"Content-Type": "application/json"}, body: JSON.stringify({cues}),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
  const value = await response.json();
  if (!response.ok) return {labels: null, code: value?.code};
  return {labels: validateNocturneLabels(cues, value), code: null};
}
