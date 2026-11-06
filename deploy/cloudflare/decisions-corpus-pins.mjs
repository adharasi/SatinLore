export const DECISIONS_CORPUS_VERSION = "original-hosted-corpus-v1";

// Generated from the hosted-approved original corpus. The full reference
// counts include excluded units. Only the digest-pinned units can be sent.
export const DECISIONS_CORPUS_PINS = [
  {
    id: "passage-1", unitCount: 43, approvedUnitCount: 40,
    sha256: "acee24e1b7db170c54252b840646384b64f75ed229064ae581c442ca67ec6074",
    positives: [16, 18, 19, 21, 22, 23, 25, 27, 28, 29, 30, 31, 32, 33, 34, 39, 40],
    boundaries: [35],
  },
  {
    id: "passage-2", unitCount: 39, approvedUnitCount: 39,
    sha256: "0a209fb9aab5c333c0984396300ec0f9608c398f0f756d5710181b891cecddd6",
    positives: [24, 26, 27, 28, 29, 30, 31, 32],
    boundaries: [34],
  },
  {
    id: "passage-3", unitCount: 34, approvedUnitCount: 30,
    sha256: "d856619cdfcfa5164a966969b45e50de4d4a38fc90fa6b9bb068907cc4060e92",
    positives: [12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24],
    boundaries: [28],
  },
];

const encoder = new TextEncoder();

// Bind order, IDs, offsets and exact text without depending on object key order.
export async function digestDecisionsCorpusWindow(units) {
  const canonical = JSON.stringify(units.map(({id, paragraph, start, end, text, structuralBoundary}) =>
    [id, paragraph, start, end, text, structuralBoundary]));
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
