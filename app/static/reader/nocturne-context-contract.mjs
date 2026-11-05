export const LEGACY_NOCTURNE_CONTEXT_VERSION = "context-v1";
export const NOCTURNE_CONTEXT_VERSION = "context-v2";
export const MAX_CONTEXT_PARAGRAPHS = 64;
export const MAX_CONTEXT_BYTES = 12_000;
export const MAX_CONTEXT_BODY_BYTES = 16_384;
export const MAX_PARAGRAPH_BYTES = 3000;
export const NOCTURNE_CONTEXT_TIMEOUT_MS = 30_000;
export const MAX_CONTEXT_OUTPUT_TOKENS = 4096;
export const MIN_CONTEXT_CONFIDENCE = 80;

export const CATEGORY_PHASES = Object.freeze({
  neutral: ["quiet"], romance: ["build", "sustain"], flirting: ["build", "sustain"], tension: ["build", "sustain"],
  intimacy: ["build", "sustain", "peak", "recover"], explicit: ["build", "sustain", "peak", "recover"],
  aftermath: ["quiet", "recover"], abstain: ["abstain"],
});
export const CONTEXT_LABELS = Object.freeze(Object.entries(CATEGORY_PHASES)
  .flatMap(([category, phases]) => phases.map(phase => category + "." + phase)));
export const CONTEXT_EVENT_KINDS = Object.freeze(["current", "imagined", "reported", "historical", "uncertain", "neutral"]);
export const CONTEXT_SHAPES = Object.freeze(["unspecified", "accented", "sustained", "alternating"]);

function exactFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

export function validContextAnnotation(entry, version) {
  const fields = ["id", "category", "phase", "shape", "confidence"];
  if (version === NOCTURNE_CONTEXT_VERSION) fields.push("eventKind");
  else if (version !== LEGACY_NOCTURNE_CONTEXT_VERSION) return false;
  if (!exactFields(entry, fields) || !Number.isInteger(entry.id) || entry.id < 0 || entry.id > 1999 ||
      typeof entry.category !== "string" || !Object.hasOwn(CATEGORY_PHASES, entry.category) ||
      !CATEGORY_PHASES[entry.category].includes(entry.phase) || !CONTEXT_SHAPES.includes(entry.shape) ||
      !Number.isInteger(entry.confidence) || entry.confidence < 0 || entry.confidence > 100 ||
      (["quiet", "abstain"].includes(entry.phase) && entry.shape !== "unspecified")) return false;
  if (version === LEGACY_NOCTURNE_CONTEXT_VERSION) return true;
  return CONTEXT_EVENT_KINDS.includes(entry.eventKind) &&
    (entry.eventKind === "uncertain") === (entry.category === "abstain") &&
    (entry.eventKind !== "neutral" || entry.category === "neutral");
}

export function validContextUsage(inputTokens, outputTokens, totalTokens, version) {
  const outputLimit = version === NOCTURNE_CONTEXT_VERSION ? MAX_CONTEXT_OUTPUT_TOKENS : 1000;
  return [inputTokens, outputTokens, totalTokens].every(value => Number.isSafeInteger(value) && value >= 0) &&
    inputTokens <= 20_000 && outputTokens <= outputLimit && totalTokens === inputTokens + outputTokens;
}

export function validateNocturneContext(paragraphs, response) {
  if (!exactFields(response, ["version", "labels", "usage"]) ||
      ![NOCTURNE_CONTEXT_VERSION, LEGACY_NOCTURNE_CONTEXT_VERSION].includes(response.version) ||
      !Array.isArray(response.labels) || response.labels.length !== paragraphs.length) {
    throw new Error("Unexpected Nocturne annotations.");
  }
  const expected = new Set(paragraphs.map(({id}) => id)), labels = new Map();
  for (const entry of response.labels) {
    if (!validContextAnnotation(entry, response.version) || !expected.delete(entry.id)) {
      throw new Error("Unexpected Nocturne annotations.");
    }
    labels.set(entry.id, {...entry});
  }
  const usage = response.usage;
  if (usage !== null && (!exactFields(usage, ["inputTokens", "outputTokens", "totalTokens"]) ||
      !validContextUsage(usage.inputTokens, usage.outputTokens, usage.totalTokens, response.version))) {
    throw new Error("Unexpected Nocturne usage.");
  }
  return {labels, usage};
}
