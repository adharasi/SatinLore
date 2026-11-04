import {NOCTURNE_LABELS} from "./calibration.mjs";
export {NOCTURNE_LABELS};
const MAX_CUES = 16;
const rhythms = ["steady", "gentle", "dynamic"];
const shapes = ["unspecified", "accented", "sustained", "alternating"];
const endpoint = "/api/scene-analysis";

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
