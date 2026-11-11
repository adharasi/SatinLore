import {createHash} from "node:crypto";
import {traceNocturneContextVisit} from "./current-reader-diagnostics.mjs";

export const NOCTURNE_PARAGRAPH_CLEARANCE_PURPOSE = "nocturne-reviewed-context-paragraphs";

const hash = text => createHash("sha256").update(text, "utf8").digest("hex");
const unsigned = value => Number.isSafeInteger(value) && value >= 0;

function checkedClearance(paragraphs, clearance, now) {
  if (!unsigned(now)) throw new RangeError("Use a valid review time.");
  if (clearance == null) return new Set();
  const invalid = () => new TypeError("Use current review clearance for the exact reader edition and paragraphs.");
  if (clearance.purpose !== NOCTURNE_PARAGRAPH_CLEARANCE_PURPOSE || !unsigned(clearance.expiresAt) ||
      clearance.expiresAt <= now || !Array.isArray(clearance.paragraphs) ||
      clearance.paragraphs.length > paragraphs.length ||
      clearance.readerEditionSha256 !== hash(paragraphs.map(row => row.text).join("\n\n"))) throw invalid();

  const reviewed = new Set();
  for (const pin of clearance.paragraphs) {
    const row = pin && unsigned(pin.id) ? paragraphs[pin.id] : undefined;
    if (!row || reviewed.has(pin.id) || pin.sha256 !== hash(row.text)) throw invalid();
    reviewed.add(pin.id);
  }
  return reviewed;
}

// Offline replay only. The caller supplies trusted full-paragraph clearance.
// These checks verify exact bytes and scope, while the reviewer decides eligibility.
export function traceClearedNocturneContextVisit(paragraphs,
    {clearance, now = Date.now(), start = 0, positions, progressive = false} = {}) {
  if (!Array.isArray(paragraphs) || paragraphs.some(row => typeof row?.text !== "string")) {
    throw new TypeError("Use the indexed paragraphs from a loaded reader edition.");
  }
  const reviewed = checkedClearance(paragraphs, clearance, now);
  const scoped = paragraphs.map((row, id) => reviewed.has(id) ? row : {...row, cloudExcluded: true});
  const trace = traceNocturneContextVisit(scoped, {start, positions, progressive});
  if (trace.windows.some(window => window.paragraphIds.some(id => !reviewed.has(id)))) {
    throw new Error("Review clearance did not cover every planned input.");
  }
  return trace;
}
