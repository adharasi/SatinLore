import {createHash} from "node:crypto";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const fixtureSchema = "satinlore-approved-beat-corpus-v1";
export const fixturesDirectory = new URL("../../benchmarks/nocturne/approved-compiler/", import.meta.url);
export const comparisonBlockSize = 128;

const reasonSentinels = new Set([
  "The longer gap fades the existing envelope.",
  "Carry the established profile through a brief gap. Keep its block and clock.",
]);
const patterns = new Set(["Baseline", "Crest", "Crest approach", "Deep sustain", "Deepening build", "Divider", "Gradual build",
  "Hold", "Onset rise", "Rebuild rise", "Recovery", "Reset", "Stop", "Sustain wave", "Taper", "Undertone"]);
const phases = new Set(["build", "ease", "onset", "peak", "quiet", "rebuild", "recover", "structural", "sustain", "unknown"]);
const gates = new Set(["No blocking event recorded", "Review eligibility", "Stop"]);
const decisions = new Set(["Apply overlay", "Await evidence", "Context only", "Descriptive only", "Formatting marker",
  "Preserve current profile", "Prior frame closed"]);
const kinds = new Set(["beat-end", "continue", "cut", "ease", "low", "neutralize", "span-end"]);
const facts = ["boundary", "scope", "ease", "low", "neutral"];
const recentKeys = ["neutral", "romantic", "suggestive", "overt sexual", "explicit", "graphic", "unknown"];
const coordinate = value => Number.isSafeInteger(value) && value >= 0;

function safe(value, allowed) {
  if (!allowed.has(value)) throw Error("Unexpected approved compiler enum.");
  return value;
}

function reasonKey(reason) {
  if (typeof reason !== "string") throw Error("Expected approved compiler reason.");
  return reasonSentinels.has(reason) || /^sha256:[a-f0-9]{64}$/u.test(reason) ? reason : `sha256:${sha256(reason)}`;
}

function fieldMap(fields, values) {
  return Object.fromEntries(fields.map((field, index) => [field, values[index]]));
}

function encodeFact(fact, reasonIndex) {
  if (!fact) return null;
  if (!coordinate(fact.knownAt) || !fact.evidence.every(coordinate) ||
      [fact.start, fact.priorAnchor].some(value => value != null && !coordinate(value))) {
    throw Error("Invalid approved compiler fact coordinates.");
  }
  return [safe(fact.kind, kinds), fact.knownAt, reasonIndex(fact.reason), fact.evidence,
    fact.start ?? null, fact.priorAnchor ?? null, fact.profile == null ? null : safe(fact.profile, patterns)];
}

function decodeFact(values, reasons) {
  if (!values) return null;
  const [kind, knownAt, reason, evidence, start, priorAnchor, profile] = values;
  const fact = {kind, knownAt, reason: reasons[reason], evidence};
  if (start !== null) fact.start = start;
  if (priorAnchor !== null) fact.priorAnchor = priorAnchor;
  if (profile !== null) fact.profile = profile;
  return fact;
}

export function encodeInputs(stories) {
  const reasons = new Map();
  function reasonIndex(value) {
    const key = reasonKey(value);
    if (!reasons.has(key)) reasons.set(key, reasons.size);
    return reasons.get(key);
  }
  function encodeUnit({id, paragraph, words, profile, tension, connector, protective, ...evidence}) {
    if (![id, paragraph, words].every(coordinate) || profile.id !== id || typeof connector !== "boolean" ||
        typeof protective !== "boolean" || (profile.block != null &&
          !/^(?:O11|D2|A20)-\d{2}:(?:tension:)?\d{1,5}$/u.test(profile.block)) ||
        (tension.knownAt != null && !coordinate(tension.knownAt))) {
      throw Error("Invalid approved compiler unit.");
    }
    if (Object.keys(profile.recent).some(key => !recentKeys.includes(key)) ||
        !Object.values(profile.recent).every(coordinate)) throw Error("Invalid approved compiler recent counts.");
    const recent = Object.keys(profile.recent).length ? recentKeys.map(key => profile.recent[key]) : null;
    const labels = [safe(profile.pattern, patterns), reasonIndex(profile.reason), profile.block, safe(profile.phase_used, phases),
      safe(profile.gate, gates), recent];
    const decision = tension.decision == null ? null : safe(tension.decision, decisions);
    return [id, paragraph, words, labels, decision, tension.knownAt ?? null, connector, protective,
      ...facts.map(field => encodeFact(evidence[field], reasonIndex))];
  }
  const encoded = stories.map(({story, units}) => {
    if (!/^(?:O11|D2|A20)-\d{2}$/u.test(story)) throw Error("Invalid approved compiler story.");
    return [story, units.map(encodeUnit)];
  });
  return {schema: fixtureSchema, reasons: [...reasons.keys()], stories: encoded};
}

export function decodeInputs({schema, reasons, stories}) {
  if (schema !== fixtureSchema) throw Error("Unknown approved compiler fixture format.");
  return stories.map(([story, rows]) => ({story, units: rows.map(row => {
    const [id, paragraph, words, labels, decision, knownAt, connector, protective, ...entries] = row;
    const [pattern, reason, block, phase_used, gate, recent] = labels;
    const profile = {id, pattern, reason: reasons[reason], block, phase_used, gate, recent: recent ? fieldMap(recentKeys, recent) : {}};
    const tension = decision === null ? {} : {decision, knownAt};
    return {id, paragraph, words, profile, tension, connector, protective,
      ...fieldMap(facts, entries.map(fact => decodeFact(fact, reasons)))};
  })}));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export function digestOutputs(rows, column) {
  const redacted = rows.map(row => {
    const projected = row[column];
    return canonical({...projected, reason: reasonKey(projected.reason)});
  });
  return sha256(JSON.stringify(redacted));
}
