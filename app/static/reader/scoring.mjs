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

const SCENE_SEPARATOR = /^(?:[\s*#~_—–-]{3,}|(?:chapter|part|book|scene)\s+(?:\d+|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[:.\-–—].*)?)$/u;
const REST_BOUNDARY = /\b(?:fell asleep|went to sleep|(?:settled|lay) down to rest|(?:need(?:ed)?|take|took) (?:a |some )?(?:break|rest)|paus(?:e|ed) (?:for breath|to rest)|a (?:long|quiet) pause|slowed to a stop|quiet (?:interlude|break))\b/u;
const TIME_BOUNDARY = /\b(?:(?:the )?(?:next|following) (?:day|morning|night)|(?:hours?|days?|weeks?|months?|years?) later|later that (?:evening|night))\b/u;
const SENSITIVE_CUE = /\b(?:non[ -]consensual|coerc(?:e|ed|es|ing|ion)|forced|unwanted|underage|child(?:ren)?|rape|assault(?:ed)?)\b/u;
const SOFT_PACE = /\b(?:slow(?:ly)?|unhurried|gentl(?:e|y)|gradual(?:ly)?|softly)\b/u;
const VARIABLE_PACE = /\b(?:quick(?:ly)?|sudden(?:ly)?|urgent(?:ly)?|abrupt(?:ly)?|rapid(?:ly)?)\b/u;
const MOVEMENT_CUES = [
  ["vibrate", /\bvibrat(?:e|es|ed|ing|ions?)\b/u],
  ["fingering", /\b(?:flex(?:es|ed|ing)?|fingering)\b/u],
  ["rotate", /\brotat(?:e|es|ed|ing|ions?)\b/u],
  ["thrusting", /\bthrust(?:s|ing)?\b/u],
  ["oscillate", /\b(?:oscillat(?:e|es|ed|ing|ions?)|side[ -]to[ -]side)\b/u],
];

function sceneCandidate(paragraph) {
  if (!paragraph || typeof paragraph.text !== "string" || !Number.isInteger(paragraph.band) ||
      paragraph.band < 0 || paragraph.band >= SUGGESTION_LEVELS.length || SUGGESTION_LEVELS[paragraph.band] !== paragraph.suggestedLevel || typeof paragraph.reason !== "string") {
    throw new TypeError("Use analysed paragraph results for scene suggestions.");
  }
  const value = paragraph.text.toLowerCase().replace(/’/g, "'").trim();
  const heading = SCENE_SEPARATOR.test(value.split("\n", 1)[0].trim());
  const rest = heading || REST_BOUNDARY.test(value) || TIME_BOUNDARY.test(value);
  const uncertain = UNCERTAIN_CONTEXT.test(value) || META_CONTEXT.test(value);
  const sensitive = SENSITIVE_CUE.test(value);
  const quiet = rest || uncertain || sensitive;
  const band = quiet ? 0 : paragraph.band;
  const level = SUGGESTION_LEVELS[band];
  const hasContact = CONTACT_CUES.some(cue => cue.test(value));
  const hasContext = CONTEXT_CUES.some(cue => cue.test(value));
  const advisory = sensitive ? "Sensitive wording may need a closer look. This local suggestion stays at zero." :
    uncertain && (hasContact || hasContext) ? "The wording is ambiguous. Review this zero suggestion if needed." :
      band === 4 ? "Review this stronger local suggestion if needed." : null;
  const rhythm = level >= 3 && (band === 4 || VARIABLE_PACE.test(value)) ? "dynamic" :
    level >= 2 && SOFT_PACE.test(value) ? "gentle" : "steady";
  // Motion cues describe an already matched scene. They cannot activate one.
  const movements = level > 0 ? MOVEMENT_CUES.filter(([, cue]) => cue.test(value)).map(([id]) => id) : [];
  const short = value.length > 0 && value.length <= 180 && value.split(/\s+/u).length <= 24;
  return {
    anchor: level > 0 && paragraph.override !== 0,
    connective: level === 0 && !quiet && !hasContact && short && paragraph.override == null,
    result: {band, level, reason: rest ? "Rest or scene boundary; left at zero." :
      sensitive ? "Sensitive wording; left at zero for review." :
        uncertain ? "Context is uncertain; left at zero." : paragraph.reason,
      sceneId: null, rhythm, quiet, advisory, movements},
  };
}

// Group the complete raw cue pass, never an already grouped result. The scene
// information is advisory metadata. The reader still owns explicit overrides,
// quiet enforcement, device arming and ceilings.
export function groupScenes(paragraphs) {
  if (!Array.isArray(paragraphs)) throw new TypeError("Use an array of analysed paragraphs.");
  const candidates = paragraphs.map(sceneCandidate);
  let nextScene = 0;
  let activeScene = null;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const before = candidates[index - 1], after = candidates[index + 1];
    const carriesThrough = candidate.connective && before?.anchor && after?.anchor;
    if (!candidate.anchor && !carriesThrough) {
      activeScene = null;
      continue;
    }
    if (activeScene === null) activeScene = ++nextScene;
    if (carriesThrough) {
      // Keep the preceding cadence for this brief detail. Changing to a lower
      // level here would send Stop before the next finite device renewal.
      const {band, level, rhythm, movements} = before.result;
      Object.assign(candidate.result, {band, level, rhythm, movements: [...movements],
        reason: "Brief detail within the same scene; kept the preceding rhythm."});
    }
    candidate.result.sceneId = activeScene;
  }
  return candidates.map(candidate => candidate.result);
}
