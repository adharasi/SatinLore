// Experimental English cue matching, not semantic understanding or a safety classifier.
// Suggestions stay local and should be reviewed; uncertain context defaults to zero.
export const SUGGESTION_LEVELS = Object.freeze([0, 1, 2, 3, 5]);

const CONTACT_CUES = [
  /\bkiss(?:es|ed|ing)?\b/,
  /\bembrac(?:e|es|ed|ing)\b/,
  /\bcaress(?:es|ed|ing)?\b/,
];
const CONTEXT_CUES = [
  /\btender(?:ly|ness)?\b/,
  /\baffection(?:ate|ately)?\b/,
  /\bromantic(?:ally)?\b|\bromance\b/,
  /\blonging\b/,
  /\bdesir(?:e|es|ed|ing)\b/,
  /\bpassion(?:ate|ately)?\b/,
  /\bintima(?:te|tely|cy)\b/,
];
const UNCERTAIN_CONTEXT = /\b(?:no|not|never|without|unwanted|refus(?:e|es|ed|ing)|stop(?:ped|ping)?|don't|doesn't|didn't|can't|cannot|wouldn't|isn't|wasn't|aren't|weren't)\b/;
const META_CONTEXT = /\b(?:definition|dictionary|terminology|review(?:s|ed)?|title|phrase|vocabulary)\b/;

export function scoreParagraph(text) {
  if (typeof text !== "string") throw new TypeError("A paragraph must be text.");
  const value = text.toLowerCase().replace(/’/g, "'");
  if (UNCERTAIN_CONTEXT.test(value) || META_CONTEXT.test(value)) {
    return {band: 0, level: 0, reason: "Context is uncertain; left at zero."};
  }
  const contacts = CONTACT_CUES.filter(cue => cue.test(value)).length;
  const context = CONTEXT_CUES.filter(cue => cue.test(value)).length;
  if (!contacts || !context) {
    return {band: 0, level: 0, reason: "No matching cue pair; left at zero."};
  }
  // Repeating a word never raises its weight. A contact and a separate context
  // cue are both required, but this still cannot determine narrative meaning.
  const band = Math.min(4, contacts + context - 1);
  return {band, level: SUGGESTION_LEVELS[band], reason: "Experimental local cue match; review this suggestion."};
}
