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

const SPECULATION = /\b(?:imagin(?:e|es|ed|ing)|dream(?:ed|t|ing)|remember(?:s|ed|ing)?|recall(?:s|ed|ing)?|pretend(?:s|ed|ing)?|if)\b/u;
const NON_ACTUAL = /\b(?:hop(?:e|es|ed|ing)|wish(?:es|ed|ing)?|wanted|would|could|might|describ(?:e|es|ed|ing)|mention(?:s|ed|ing)?|discuss(?:es|ed|ing)?|talked about|read about)\b/u;
const DETACHED_PAST = /^\s*(?:last (?:summer|winter|spring|autumn|fall|year|month|week)|(?:\d+|a|one|two|many|several) (?:years?|months?|weeks?|days?) ago|back then|earlier that (?:day|evening|night))\b/u;
const REPORTED_SPEECH = /\b(?:said|whispered|asked|told|read)\s*,?\s*(?:["“]|that\b|about\b)/u;
const CLAUSE_BREAK = /([.!?;\n]+|\b(?:but|yet|whereas|although)\b|\b(?:and|as|while)\b(?=\s+(?:she|he|they|we|i|you|the|a|an|his|her|their|my|our|your)\b))/u;
const EXPLICIT_STOP = /(?:^|[.!?;“"\n]\s*)(?:no|stop)(?:[,.!?;”"\n]|$)|(?:^|[.!?;\n]\s*)(?:he|she|they|we) (?:stopped|refused|pulled away|backed away)(?=[.!?;\n]|$)|\b(?:asked|told)\b[^.!?;]{0,36}\bto stop\b|\b(?:said|whispered|shouted)\s*,?\s*["“'](?:no|stop)\b/u;
const normalized = text => text.toLowerCase().replace(/’/g, "'").trim();

function clauseEvidence(value) {
  const contacts = new Set(), context = new Set(), active = [], actual = [];
  const parts = value.split(CLAUSE_BREAK);
  let uncertain = false, speculative = false;
  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index];
    speculative = SPECULATION.test(clause) || DETACHED_PAST.test(clause) || speculative && ["and", "as", "while"].includes(parts[index - 1]);
    const contactMatches = CONTACT_CUES.filter(cue => cue.test(clause));
    const contextMatches = CONTEXT_CUES.filter(cue => cue.test(clause));
    if (speculative || UNCERTAIN_CONTEXT.test(clause) || META_CONTEXT.test(clause) || NON_ACTUAL.test(clause) || REPORTED_SPEECH.test(clause)) {
      uncertain ||= contactMatches.length > 0 || contextMatches.length > 0;
      continue;
    }
    actual.push(clause);
    if (!contactMatches.length || !contextMatches.length) continue;
    active.push(clause);
    for (const cue of contactMatches) contacts.add(cue);
    for (const cue of contextMatches) context.add(cue);
  }
  return {band: active.length ? Math.min(4, contacts.size + context.size - 1) : 0, active, actual, uncertain};
}

export function scoreParagraph(text) {
  if (typeof text !== "string") throw new TypeError("A paragraph must be text.");
  const value = normalized(text);
  if (EXPLICIT_STOP.test(value)) return {band: 0, level: 0, reason: "An explicit stop cue; left at zero."};
  const {band, uncertain} = clauseEvidence(value);
  return {band, level: SUGGESTION_LEVELS[band], reason: band > 0 ? "Matched a contact and context cue in the same clause." :
    uncertain ? "Contact wording was uncertain or speculative." : "No matching cue pair; left at zero."};
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

const APPROACH = /\b(?:drew closer|leaned (?:in|closer)|moved closer|closed the (?:space|distance) between them)\b/u;
const ANTICIPATION = /\b(?:held (?:her|his|their) breath|heart (?:raced|quickened)|breath caught|waited (?:a beat|expectantly)|anticipation)\b/u;
const RELEASE = /\b(?:slowed|softened|eased|relaxed|settled)\b/u;
const PEAK = /\b(?:intensifi(?:ed|es)|crescendo|overwhelming|surge(?:d|s)?|reached (?:a|its|their) peak)\b/u;
const MOTION_LINK = /\b(?:hands?|fingers?|palms?|hips?|arms?|touch|contact|motion|movement|rhythm|device|flexer|toy)\s+(?:(?:was|were|is|are|kept|started|began|slowly|quickly|gently|steadily|softly)(?: to)?\s+){0,3}$/u;
const OTHER_MOVER = /\b(?:fan|phone|watch|table|floor|walls?|window|bell|engine|train|car|clock|wheel|key(?:s|board)?|camera|motor|appliance|machine|speaker)\b/u;
const MOTION_OBJECT = /^\s+(?:a|an|the|his|her|their|its|my|our|your)\b/u;
const MOTION_CONTINUES = /^the\s+(?:(?:low|soft|gentle|steady|slow|quick|rhythmic)\s+){0,2}(?:vibration|flexing|rotation|thrusting|oscillation)(?:\s+(?:motion|movement))?\s+(?:continued|resumed|stayed|grew|softened|intensified)\b/u;

function sceneCandidate(paragraph) {
  if (!paragraph || typeof paragraph.text !== "string" || !Number.isInteger(paragraph.band) ||
      paragraph.band < 0 || paragraph.band >= SUGGESTION_LEVELS.length || SUGGESTION_LEVELS[paragraph.band] !== paragraph.suggestedLevel || typeof paragraph.reason !== "string") {
    throw new TypeError("Use analysed paragraph results for scene suggestions.");
  }
  const value = normalized(paragraph.text);
  const evidence = clauseEvidence(value);
  const rest = SCENE_SEPARATOR.test(value.split("\n", 1)[0].trim()) || REST_BOUNDARY.test(value) || TIME_BOUNDARY.test(value);
  const stopped = EXPLICIT_STOP.test(value);
  const sensitive = SENSITIVE_CUE.test(value);
  const uncertain = evidence.uncertain && !evidence.active.length;
  const quiet = rest || stopped || uncertain || sensitive;
  const band = quiet ? 0 : paragraph.band;
  const actual = evidence.actual.join(" ");
  const motionClauses = band > 0 ? evidence.actual.filter(clause => !OTHER_MOVER.test(clause)) : [];
  const movements = MOVEMENT_CUES.filter(([, cue]) => motionClauses.some(clause => {
    const match = cue.exec(clause);
    return match && !MOTION_OBJECT.test(clause.slice(match.index + match[0].length)) &&
      (MOTION_LINK.test(clause.slice(0, match.index)) || MOTION_CONTINUES.test(clause.trim()));
  })).map(([id]) => id);
  const pace = evidence.active.join(" ");
  const short = value.length > 0 && value.length <= 180 && value.split(/\s+/u).length <= 24;
  const advisory = sensitive ? "Sensitive wording may need a closer look. This local suggestion stays at zero." :
    uncertain ? "The wording is ambiguous or speculative. This suggestion stays at zero." : null;
  return {
    anchor: band > 0 && paragraph.override !== 0,
    evidenceBand: band,
    connective: band === 0 && !quiet && short && paragraph.override == null && !CONTACT_CUES.some(cue => cue.test(value)),
    approaching: !quiet && APPROACH.test(actual) && ANTICIPATION.test(actual),
    releasing: !quiet && evidence.actual.some(clause => !OTHER_MOVER.test(clause) &&
      /\b(?:she|he|they|we|the movement|the rhythm|breath)\b/u.test(clause) && RELEASE.test(clause)),
    peaking: PEAK.test(pace),
    quick: VARIABLE_PACE.test(pace),
    slow: SOFT_PACE.test(pace),
    result: {band, level: SUGGESTION_LEVELS[band], reason: rest || stopped ? "Rest or scene boundary; left at zero." :
      sensitive ? "Sensitive wording; left at zero for review." :
        uncertain ? "Context is uncertain or speculative; left at zero." : paragraph.reason,
      sceneId: null, phase: "quiet", rhythm: "steady", quiet, advisory, movements},
  };
}

function applyBeat(result, {phase, band, rhythm, reason, movements}) {
  Object.assign(result, {phase, band, level: SUGGESTION_LEVELS[band], rhythm, reason,
    ...(movements ? {movements: [...movements]} : {})});
}

// Group complete raw scores so an isolated anticipation cue or a descriptive
// gap cannot activate a scene on its own. Never carry a beat across a boundary.
export function groupScenes(paragraphs) {
  if (!Array.isArray(paragraphs)) throw new TypeError("Use an array of analysed paragraphs.");
  const candidates = paragraphs.map(sceneCandidate);
  let nextScene = 0, activeScene = null, lastAnchor = -1;
  for (const [index, candidate] of candidates.entries()) {
    const {result} = candidate;
    const previous = candidates[index - 1]?.result;
    if (candidate.anchor) {
      const recovery = activeScene !== null && (candidate.releasing || previous?.phase === "peak" && result.band < previous.band - 1);
      const lead = candidates[lastAnchor];
      const peak = !recovery && activeScene !== null && result.band >= 3 &&
        (candidate.peaking && !lead?.peaking || result.band === 4 && lead && lead.evidenceBand < result.band);
      const phase = recovery ? "recover" : peak ? "peak" :
        activeScene === null && result.band <= 1 ? "build" : "sustain";
      const band = recovery ? Math.min(2, result.band) : peak ? 4 : Math.min(3, result.band);
      const rhythm = peak || !recovery && band >= 3 && candidate.quick ? "dynamic" :
        recovery || band >= 2 && candidate.slow ? "gentle" : "steady";
      applyBeat(result, {phase, band, rhythm, reason: result.reason});
      if (peak) result.advisory = "Review this stronger local suggestion if needed.";
      lastAnchor = index;
    } else if (candidate.connective && activeScene === null && candidate.approaching && candidates[index + 1]?.anchor) {
      applyBeat(result, {phase: "build", band: 1, rhythm: "gentle", reason: "Anticipation immediately before a matched scene."});
    } else if (candidate.connective && index === lastAnchor + 1 && lastAnchor >= 0 && candidate.releasing) {
      applyBeat(result, {phase: "recover", band: 1, rhythm: "gentle", reason: "The preceding scene is easing off.", movements: previous.movements});
    } else {
      const distance = index - lastAnchor;
      const follows = candidates[index + 1]?.anchor ||
        distance === 1 && candidates[index + 1]?.connective && candidates[index + 2]?.anchor;
      if (!candidate.connective || lastAnchor < 0 || distance > 2 || !follows || previous?.phase === "recover" && previous.band === 1) {
        activeScene = null;
        lastAnchor = -1;
        continue;
      }
      const lead = candidates[lastAnchor].result;
      const band = Math.min(lead.band, distance === 1 ? 2 : 1);
      applyBeat(result, {phase: "sustain", band, rhythm: band === lead.band ? lead.rhythm : "gentle",
        reason: "Brief detail between matched passages; continued gently.", movements: lead.movements});
    }
    if (activeScene === null) activeScene = ++nextScene;
    result.sceneId = activeScene;
  }
  return candidates.map(candidate => candidate.result);
}
