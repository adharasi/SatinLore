import {NOCTURNE_LABELS} from "./calibration.mjs";
export {NOCTURNE_LABELS};
const MAX_CUES = 16;
const rhythms = ["steady", "gentle", "dynamic"];
const shapes = ["unspecified", "accented", "sustained", "alternating"];
const endpoint = "/api/scene-analysis";
export const NOCTURNE_CONTEXT_VERSION = "context-v1";
export const NOCTURNE_CONTEXT_MODEL = "gpt-6-luna";
const contextCategories = ["neutral", "romance", "flirting", "tension", "intimacy", "explicit", "aftermath", "abstain"];
const contextPhases = {
  neutral: ["quiet"], romance: ["build", "sustain"], flirting: ["build", "sustain"], tension: ["build", "sustain"],
  intimacy: ["build", "sustain", "peak", "recover"], explicit: ["build", "sustain", "peak", "recover"],
  aftermath: ["quiet", "recover"], abstain: ["abstain"],
};
const byteLength = value => new TextEncoder().encode(value).length;

// A deliberate request covers a small cursor window. Whole paragraphs are
// omitted when over budget; truncation could remove a negation or scene break.
export function nocturneContextCandidates(paragraphs, position = 0) {
  const current = Number.isInteger(position) ? Math.max(0, Math.min(position, paragraphs.length - 1)) : 0;
  const first = Math.max(0, Math.min(current - 2, paragraphs.length - 8));
  const last = Math.min(paragraphs.length, first + 8);
  const result = [];
  let excluded = 0, limited = 0, bytes = 0;
  for (let id = first; id < last; id++) {
    const paragraph = paragraphs[id];
    if (!paragraph.analysed || paragraph.quiet || paragraph.cloudExcluded || paragraph.override !== null || typeof paragraph.text !== "string") {
      excluded++; continue;
    }
    const size = byteLength(paragraph.text);
    const candidate = {id, text: paragraph.text};
    if (!size || size > 3000 || bytes + size > 12000 || byteLength(JSON.stringify({version: NOCTURNE_CONTEXT_VERSION,
      consent: true, paragraphs: [...result, candidate]})) > 16384) { limited++; continue; }
    result.push(candidate); bytes += size;
  }
  return {paragraphs: result, excluded, limited};
}

export async function nocturneContextKey(paragraphs) {
  const input = JSON.stringify([NOCTURNE_CONTEXT_MODEL, NOCTURNE_CONTEXT_VERSION, paragraphs]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function validateNocturneContext(paragraphs, response) {
  if (!response || Object.keys(response).sort().join() !== "labels,usage,version" || response.version !== NOCTURNE_CONTEXT_VERSION ||
      !Array.isArray(response.labels) || response.labels.length !== paragraphs.length) throw new Error("Unexpected Nocturne annotations.");
  const expected = new Set(paragraphs.map(({id}) => id)), labels = new Map();
  for (const entry of response.labels) {
    if (!entry || Object.keys(entry).sort().join() !== "category,confidence,id,phase,shape" || !expected.delete(entry.id) ||
        !contextCategories.includes(entry.category) || !contextPhases[entry.category].includes(entry.phase) ||
        !shapes.includes(entry.shape) || !Number.isInteger(entry.confidence) || entry.confidence < 0 || entry.confidence > 100 ||
        ["quiet", "abstain"].includes(entry.phase) && entry.shape !== "unspecified") throw new Error("Unexpected Nocturne annotations.");
    labels.set(entry.id, {...entry});
  }
  const usage = response.usage;
  if (usage !== null && (!usage || Object.keys(usage).sort().join() !== "inputTokens,outputTokens,totalTokens" ||
      Object.values(usage).some(value => !Number.isSafeInteger(value) || value < 0) ||
      usage.totalTokens !== usage.inputTokens + usage.outputTokens)) throw new Error("Unexpected Nocturne usage.");
  return {labels, usage};
}

export async function requestNocturneContext(paragraphs, {consent = false, signal, request = fetch} = {}) {
  if (consent !== true) throw new Error("Choose whether to send nearby story excerpts first.");
  const timeout = AbortSignal.timeout(18000);
  const response = await request(endpoint, {method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
    headers: {"Content-Type": "application/json"}, body: JSON.stringify({version: NOCTURNE_CONTEXT_VERSION, consent: true, paragraphs}),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
  const value = await response.json();
  if (!response.ok) return {labels: null, usage: null, code: value?.code};
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
