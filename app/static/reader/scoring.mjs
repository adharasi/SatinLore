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
const NON_ACTUAL = /\b(?:hop(?:e|es|ed|ing)|wish(?:es|ed|ing)?|wanted|would|could|might|describ(?:e|es|ed|ing)|mention(?:s|ed|ing)?|discuss(?:es|ed|ing)?|(?:she|he|they|we|i|you) (?:(?:was|were|is|are) )?plan(?:s|ned|ning)?|talked about|read about|(?:wrote|written|writ(?:e|es|ing)) about)\b/u;
const DETACHED_PAST = /^\s*(?:last (?:summer|winter|spring|autumn|fall|year|month|week)|(?:\d+|a|one|two|many|several) (?:years?|months?|weeks?|days?) ago|back then|earlier that (?:day|evening|night))\b/u;
const REPORTED_SPEECH = /\b(?:(?:said|says|whisper(?:s|ed)|ask(?:s|ed)|told|tells|read|reads)\s*,?\s*(?:["“]|that\b|about\b)|(?:told|tells|ask(?:s|ed))\s+(?:me|you|him|her|us|them)\s+(?:that|about)\b)/u;
const UNREALISED = /\b(?:expect(?:s|ed|ing)?|intend(?:s|ed|ing)?|consider(?:s|ed|ing)?|planned|planning|(?:was|were) going to|about to|almost|nearly|seem(?:s|ed)? to)\b/u;
const LINKED_CLAUSE = new Set(["and", "and then", "then", "as", "while", "after", "before", "followed by"]);
const CLAUSE_BREAK = /([.!?;\n]+|\b(?:and then|then|followed by|afterwards?|after|before|instead of|rather than|but|yet|whereas|although)\b|(?:,|\b(?:and|as|while)\b)(?=\s+(?:she|he|they|we|i|you|it|the|a|an|his|her|their|my|our|your)\b))/u;
const EXPLICIT_STOP = /(?:^|[.!?;“"\n]\s*)(?:no|stop)(?:[,.!?;”"\n]|$)|(?:^|[.!?;\n]\s*)(?:he|she|they|we) (?:stopped|refused|(?:pulled|backed) away(?: from (?:her|him|them|each other))?)(?=[.!?;\n]|$)|\b(?:asked|told)\b[^.!?;]{0,36}\bto stop\b|\b(?:said|whispered|shouted)\s*,?\s*["“'](?:no|stop)\b/u;
const normalized = text => text.toLowerCase().replace(/’/g, "'").trim();
const QUOTED_TEXT = /“[^”]*”|"[^"]*"|‘[^’]*’|(?<![\p{L}\p{N}])'[^'\n]*(?:'[\p{L}\p{N}][^'\n]*)*'(?![\p{L}\p{N}])/gu;
const QUOTE_GAP = "\u2063";
const narration = text => normalized(text.replace(QUOTED_TEXT, ` ${QUOTE_GAP} `));
const GENTLE_CONTACT = /\b(?:gentle|gently|soft|softly|slow|slowly)\s+$/u;
const GENTLE_FOLLOWING = /^\s+(?:(?:her|him|them|each other)\s+)?(?:very\s+)?(?:gently|softly|slowly)\b/u;

function gentleContact(clause, cues) {
  return cues.some(cue => {
    const match = cue.exec(clause);
    return GENTLE_CONTACT.test(clause.slice(0, match.index)) ||
      GENTLE_FOLLOWING.test(clause.slice(match.index + match[0].length));
  });
}

function clauseEvidence(value) {
  const contacts = new Set(), context = new Set(), active = [], actual = [];
  const parts = value.split(CLAUSE_BREAK);
  let uncertain = false, nonPresentMotion = false, cloudExcluded = false;
  let speculative = false, reported = false, detached = false, ordinal = -2;
  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index];
    const before = parts[index - 1];
    if (clause.trim()) ordinal += 2;
    detached = DETACHED_PAST.test(clause) || detached && before === ",";
    speculative = SPECULATION.test(clause) || detached ||
      speculative && LINKED_CLAUSE.has(before) ||
      before === "before" && UNCERTAIN_CONTEXT.test(parts[index - 2]);
    reported = REPORTED_SPEECH.test(clause) || reported && (LINKED_CLAUSE.has(before) || before === ",");
    const contactMatches = CONTACT_CUES.filter(cue => cue.test(clause));
    const contextMatches = CONTEXT_CUES.filter(cue => cue.test(clause));
    if (!contextMatches.length && gentleContact(clause, contactMatches)) contextMatches.push(GENTLE_CONTACT);
    // An unrealised cue applies when it introduces the action, rather than
    // when it describes a later consequence of an action that already happened.
    const unrealised = UNREALISED.exec(clause);
    const unrealisedAction = unrealised && [...contactMatches, MOTION_MATCH].map(cue => clause.search(cue))
      .filter(position => position >= 0).reduce((first, position) => Math.min(first, position), Infinity);
    const speculativeOrReported = speculative || reported || META_CONTEXT.test(clause) || NON_ACTUAL.test(clause) ||
      !!unrealised && Number.isFinite(unrealisedAction) && unrealised.index < unrealisedAction;
    if (speculativeOrReported || UNCERTAIN_CONTEXT.test(clause)) {
      const motion = hasMotionCue(clause);
      nonPresentMotion ||= speculativeOrReported && motion;
      cloudExcluded ||= motion || contactMatches.length > 0 || contextMatches.length > 0;
      if (!speculativeOrReported) {
        const earlier = MOTION_NEGATION.exec(clause.trim())?.[1];
        if (MOTION_ENDED.test(clause.trim())) actual.push({clause, index: ordinal, before});
        else if (earlier && !UNCERTAIN_CONTEXT.test(earlier)) actual.push({clause: earlier, index: ordinal, before});
      }
      uncertain ||= contactMatches.length > 0 || contextMatches.length > 0;
      continue;
    }
    actual.push({clause, index: ordinal, before});
    if (!contactMatches.length || !contextMatches.length) continue;
    active.push(clause);
    for (const cue of contactMatches) contacts.add(cue);
    for (const cue of contextMatches) context.add(cue);
  }
  return {band: active.length ? Math.min(4, contacts.size + context.size - 1) : 0, active, actual, uncertain, nonPresentMotion, cloudExcluded};
}

export function scoreParagraph(text) {
  if (typeof text !== "string") throw new TypeError("A paragraph must be text.");
  const value = normalized(text);
  if (EXPLICIT_STOP.test(value)) return {band: 0, level: 0, reason: "An explicit stop cue; left at zero."};
  const {band, uncertain} = clauseEvidence(narration(text));
  return {band, level: SUGGESTION_LEVELS[band], reason: band > 0 ? "Matched a contact and context cue in the same clause." :
    uncertain ? "Contact wording was uncertain or speculative." : "No matching cue pair; left at zero."};
}

const SCENE_SEPARATOR = /^(?:[\s*#~_—–-]{3,}|(?:chapter|part|book|scene)\s+(?:\d+|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[:.\-–—].*)?)$/u;
const REST_BOUNDARY = /\b(?:fell asleep|went to sleep|(?:settled|lay) down to rest|(?:need(?:ed)?|take|took) (?:a |some )?(?:break|rest)|paus(?:e|ed) (?:for breath|to rest)|a (?:long|quiet) pause|slowed to a stop|quiet (?:interlude|break))\b/u;
const TIME_BOUNDARY = /\b(?:(?:the )?(?:next|following) (?:day|morning|afternoon|evening|night|week|month|year)|(?:hours?|days?|weeks?|months?|years?) later|later that (?:evening|night))\b/u;
const SENSITIVE_CUE = /\b(?:non[ -]?consent(?:ual)?|coerc(?:e|ed|es|ing|ion)|forced|unwanted|under[ -]?age|child(?:ren)?|(?:1[0-7]|[1-9])[ -]year[ -]olds?|incest|bestiality|rape|assault(?:ed)?)\b/u;
const SOFT_PACE = /\b(?:slow(?:ly)?|unhurried|gentl(?:e|y)|gradual(?:ly)?|softly)\b/u;
const VARIABLE_PACE = /\b(?:quick(?:ly)?|sudden(?:ly)?|urgent(?:ly)?|abrupt(?:ly)?|rapid(?:ly)?)\b/u;
const MOVEMENT_CUES = [
  ["vibrate", /\b(?:vibrat(?:e|es|ed|ing|ions?)|puls(?:e|es|ed|ing)|buzz(?:es|ed|ing)?)\b/u],
  ["fingering", /\b(?:flex(?:es|ed|ing)?|fingering)\b/u],
  ["rotate", /\brotat(?:e|es|ed|ing|ions?)\b/u],
  ["thrusting", /\bthrust(?:s|ing)?\b/u],
  ["oscillate", /\b(?:oscillat(?:e|es|ed|ing|ions?)|side[ -]to[ -]side)\b/u],
];
const hasMotionCue = text => MOVEMENT_CUES.some(([, cue]) => cue.test(text));

const APPROACH = /\b(?:drew closer|leaned (?:in|closer)|moved closer|closed the (?:space|distance) between them)\b/u;
const ANTICIPATION = /\b(?:held (?:her|his|their) breath|heart (?:raced|quickened)|breath caught|waited (?:a beat|expectantly)|anticipation)\b/u;
const RELEASE = /\b(?:slowed|softened|eased|relaxed|settled)\b/u;
const PEAK = /\b(?:intensifi(?:ed|es)|crescendo|overwhelming|surge(?:d|s)?|reached (?:a|its|their) peak)\b/u;
const MOTION_LINK = /\b(?:hands?|fingers?|palms?|hips?|arms?|touch|contact|motion|movement|rhythm|device|flexer|toy)\s+(?:(?:was|were|is|are|kept|continued|started|began|slowly|quickly|gently|steadily|softly)(?: to)?\s+){0,3}$/u;
const OTHER_MOVER = /\b(?:fan|phone|watch|table|floor|walls?|window|bell|engine|train|car|clock|wheel|key(?:s|board)?|camera|motor|appliance|machine|speaker)\b/u;
const SOURCE_LINK = /\b(?:from|inside|in)\s+(?:(?:a|an|the|his|her|their|my|our|your|ceiling)\s+){0,2}$/u;
const DEVICE_NAME = "(?:(?:the|her|his|their|my|our|your)\\s+)?(?:device|flexer|toy)";
const DEVICE_LINK = new RegExp(`^\\s*${DEVICE_NAME}\\s+(?:(?:was|is|kept|continued|started|began|slowly|quickly|gently|steadily|softly)(?: to)?\\s+){0,3}$`, "u");
const DEVICE_REFERENT = new RegExp(`^(?:(?:she|he|they|we)\\s+(?:held|lifted|adjusted|picked up|turned on)\\s+${DEVICE_NAME}|${DEVICE_NAME}\\s+(?:lay|sat|rested|was)\\s+(?:still|warm|ready|(?:in|against) (?:her|his|their) (?:hand|palm|lap)|on the cushion))\\s*$`, "u");
const DEVICE_DISTRACTOR = /\b(?:hearts?|heartbeat|(?:his|her|a|the|my|their) pulse|lights?|lamps?|screens?|monitors?|alarm|radio|metronome|another|other)\b/u;
const IMPLIED_DEVICE = /^\s*(?:it|its (?:arm|motion|movement|rhythm)|the (?:motion|movement|rhythm))\s+(?:(?:was|is|kept|continued|started|began|slowly|quickly|gently|steadily|softly)(?: to)?\s+){0,3}$/u;
const MOTION_OBJECT = /^\s+(?:a|an|the|his|her|their|its|my|our|your)\b/u;
const MOTION_NOUN = "(?:vibration|flexing|rotation|thrusting|oscillation)";
const MOTION_CONTINUES = new RegExp(`^(?:the\\s+)?(?:(?:low|soft|gentle|steady|slow|quick|rhythmic)\\s+){0,2}${MOTION_NOUN}(?:\\s+and\\s+${MOTION_NOUN})?(?:\\s+(?:motion|movement))?\\s+(?:continued|resumed|stayed|grew|slowed|eased|softened|intensified)\\b`, "u");
const CONTINUING_ACTION = /\b(?:kept|continued(?: to)?)\s+(?:(?:slowly|gently|steadily|softly)\s+)?$/u;
const MOTION_VERB = "(?:vibrating|pulsing|buzzing|flexing|rotating|thrusting|oscillating)";
const STOP_SUBJECT = `(?:${DEVICE_NAME}|it)`;
const DEVICE_STOP = new RegExp(`^${STOP_SUBJECT}\\s+`, "u");
const STOP_END = "(?:\\s+(?:completely|entirely|altogether))?\\s*[,;.!?]?$";
const MOTION_ENDED = new RegExp(`^(?:(?:the\\s+)?${MOTION_NOUN}(?:\\s+and\\s+${MOTION_NOUN})?\\s+stopped|${STOP_SUBJECT}\\s+(?:stopped\\s+${MOTION_VERB}(?:\\s+and\\s+${MOTION_VERB})?|stopped|went still))${STOP_END}`, "u");
const SHARED_MOTION = /^\s*(?:(?:once|twice|slowly|quickly|gently|steadily|softly)\s*)?(?:,\s*(?:and\s+)?|and\s+)(?:(?:also|began|started|kept|slowly|quickly|gently|steadily|softly)(?: to)?\s+){0,3}$/u;
const INHERITED_MOTION = /^\s*,?\s*(?:(?:also|began|started|kept|slowly|quickly|gently|steadily|softly)(?: to)?\s+){0,3}$/u;
const MOTION_MATCH = new RegExp(MOVEMENT_CUES.map(([, cue]) => cue.source).join("|"), "gu");
const MOTION_NEGATION = new RegExp(`^(.+?)\\s+(?:without|and did not|and didn't)\\s+(?:${MOTION_MATCH.source})\\s*[,;.!?]?$`, "u");
const OVERLAP = new Set(["and", "as", "while"]);
const SUCCESSION = new Set(["and then", "then", "followed by", "afterward", "afterwards", "before"]);
const DIRECT_CONTACT = /^\s*(?:she|he|they|we)\s+(?:kissed|embraced|caressed)(?:\s+(?:again|once more))?\s*$/u;
const MOVEMENT_IDS = MOVEMENT_CUES.map(([movement]) => movement);
const movementId = word => MOVEMENT_CUES.find(([, cue]) => cue.test(word))[0];
const orderedMovements = ids => MOVEMENT_IDS.filter(id => ids.has(id));
const SHAPE_CUES = [
  ["accented", /^(?:in (?:short|quick|brief|sharp) (?:bursts?|beats?)|in (?:one|two|three) (?:short )?(?:bursts?|beats?)|staccato)\b/u],
  ["sustained", /^(?:steadily|continuously|in (?:a |one )?(?:long|steady|sustained|unbroken) (?:wave|hum|pulse))\b/u],
  ["alternating", /^(?:alternat(?:es?|ed|ing) between (?:strong(?:er)? and soft(?:er)?|soft(?:er)? and strong(?:er)?)|in (?:stronger and softer|softer and stronger) (?:beats|pulses|waves))\b/u],
];

function recordShapes(shapes, before, after) {
  const manner = after.trimStart().replace(/^(?:her|him|them|each other)\s+/u, "");
  for (const [shape, cue] of SHAPE_CUES) if (cue.test(manner)) shapes.add(shape);
  if (/\b(?:steadily|continuously)\s+$/u.test(before)) shapes.add("sustained");
}

function clauseMovements(clause, inheritsSubject, priorDevice) {
  const movements = [], shapes = new Set();
  const trimmed = clause.trim();
  const continuous = MOTION_CONTINUES.test(trimmed);
  const unambiguous = !OTHER_MOVER.test(trimmed) && !DEVICE_DISTRACTOR.test(trimmed);
  let previousEnd = null, deviceActor = false, continuation = false, unresolved = false;
  for (const match of clause.matchAll(MOTION_MATCH)) {
    const before = clause.slice(0, match.index);
    const end = match.index + match[0].length;
    const implied = IMPLIED_DEVICE.test(before);
    const referring = priorDevice && implied;
    unresolved ||= implied && !priorDevice;
    const linked = MOTION_LINK.test(before) ||
      /^side[ -]to[ -]side$/u.test(match[0]) && MOTION_LINK.test(before.replace(/\bmoved\s+$/u, "")) ||
      continuous &&
      (previousEnd === null || SHARED_MOTION.test(clause.slice(previousEnd, match.index)));
    const joined = previousEnd !== null && SHARED_MOTION.test(clause.slice(previousEnd, match.index));
    const shared = inheritsSubject && INHERITED_MOTION.test(before);
    const byDevice = DEVICE_LINK.test(before) || referring || joined && deviceActor || shared && priorDevice;
    if (!linked && !joined && !shared && !referring) continue;
    const deviceAlias = /^(?:puls|buzz)/u.test(match[0]);
    if (OTHER_MOVER.test(before) || !byDevice && deviceAlias) continue;
    const after = clause.slice(end);
    const other = continuous ? OTHER_MOVER.exec(after) : null;
    if (MOTION_OBJECT.test(after) || other && SOURCE_LINK.test(after.slice(0, other.index))) continue;
    movements.push(movementId(match[0]));
    recordShapes(shapes, before, after);
    continuation ||= referring || deviceAlias || continuous || CONTINUING_ACTION.test(before);
    deviceActor = byDevice;
    previousEnd = end;
  }
  return {movements, continuation, unresolved, shapes, deviceReference: unambiguous && (deviceActor || DEVICE_REFERENT.test(trimmed))};
}

function sceneMovements(actual, incomingDevice) {
  let previous, lastIndex = -2, deviceReference = incomingDevice, continuation = false, ended = false, unresolved = false;
  const selected = new Set(), endedMovements = new Set(), shapes = new Set();
  for (const {clause, index, before} of actual) {
    if (!clause.trim()) continue;
    // An omitted clause (for example speculation) invalidates the antecedent.
    if (lastIndex + 2 !== index || clause.includes(QUOTE_GAP)) deviceReference = false;
    lastIndex = index;
    // Actions in a comparison or in the earlier half of "X after Y" do not
    // select a movement for the paragraph's current beat.
    if (["rather than", "instead of"].includes(before)) continue;
    const overlaps = OVERLAP.has(before) || before === "," && OVERLAP.has(previous?.before);
    const trimmed = clause.trim();
    const stop = MOTION_ENDED.test(trimmed) && (!/^it\b/u.test(trimmed) || deviceReference);
    if (stop) {
      const named = [...trimmed.matchAll(MOTION_MATCH)].map(([word]) => movementId(word));
      const stopped = named.length ? named : MOVEMENT_IDS;
      if (!overlaps && before !== "after" || !named.length) {
        selected.clear();
        shapes.clear();
      }
      for (const movement of stopped) {
        selected.delete(movement);
        endedMovements.add(movement);
      }
      previous = null;
      deviceReference = named.length > 0 && DEVICE_STOP.test(trimmed);
      ended = selected.size === 0;
      continue;
    }
    if (before === "after") {
      deviceReference = false;
      continue;
    }
    const adjacent = previous?.index + 2 === index;
    const motion = clauseMovements(clause, adjacent && (overlaps || SUCCESSION.has(before)), deviceReference);
    const {movements} = motion;
    unresolved ||= motion.unresolved;
    deviceReference = motion.deviceReference;
    if (!movements.length) continue;
    if (!adjacent || !overlaps) {
      selected.clear();
      shapes.clear();
      continuation = false;
    }
    for (const shape of motion.shapes) shapes.add(shape);
    for (const movement of movements) {
      selected.add(movement);
      endedMovements.delete(movement);
    }
    ended = false;
    continuation ||= motion.continuation;
    previous = {index, before};
  }
  return {movements: orderedMovements(selected), endedMovements, ended, continuation, deviceReference, unresolved, shapes};
}

function sceneCandidate(paragraph, incomingDevice) {
  if (!paragraph || typeof paragraph.text !== "string" || !Number.isInteger(paragraph.band) ||
      paragraph.band < 0 || paragraph.band >= SUGGESTION_LEVELS.length || SUGGESTION_LEVELS[paragraph.band] !== paragraph.suggestedLevel || typeof paragraph.reason !== "string") {
    throw new TypeError("Use analysed paragraph results for scene suggestions.");
  }
  const value = normalized(paragraph.text);
  const narrated = narration(paragraph.text);
  const evidence = clauseEvidence(narrated);
  const rest = SCENE_SEPARATOR.test(value.split("\n", 1)[0].trim()) || REST_BOUNDARY.test(narrated) || TIME_BOUNDARY.test(narrated);
  const stopped = EXPLICIT_STOP.test(value);
  const sensitive = SENSITIVE_CUE.test(value);
  const motion = sceneMovements(evidence.actual, incomingDevice && !/^["'“‘]/u.test(value));
  const {movements: describedMovements, ended} = motion;
  const quotes = narrated !== value ? [...value.matchAll(QUOTED_TEXT)].map(([quote]) => quote) : [];
  const quotedMotion = quotes.some(hasMotionCue);
  const quotedContact = quotes.some(quote => CONTACT_CUES.some(cue => cue.test(quote)));
  const uncertain = !evidence.active.length && (evidence.uncertain ||
    !describedMovements.length && (motion.unresolved || evidence.nonPresentMotion || quotedMotion) || quotedContact);
  const quiet = rest || stopped || uncertain || sensitive || ended;
  const cloudExcluded = sensitive || uncertain || motion.unresolved || evidence.cloudExcluded || quotedMotion || quotedContact;
  const band = quiet ? 0 : paragraph.band;
  const actual = evidence.actual.map(({clause}) => clause).join(" ");
  const movementHints = quiet ? [] : describedMovements;
  const pace = evidence.active.join(" ");
  for (const clause of evidence.active) for (const cue of CONTACT_CUES) {
    const contact = cue.exec(clause);
    if (contact) recordShapes(motion.shapes, clause.slice(0, contact.index), clause.slice(contact.index + contact[0].length));
  }
  const shape = !quiet && !cloudExcluded && motion.shapes.size === 1 ? motion.shapes.values().next().value : "unspecified";
  const short = value.length > 0 && value.length <= 180 && value.split(/\s+/u).length <= 24;
  const advisory = sensitive ? "Sensitive wording may need a closer look. This local suggestion stays at zero." :
    uncertain ? "The wording is ambiguous or speculative. This suggestion stays at zero." : null;
  return {
    anchor: band > 0 && paragraph.override !== 0,
    evidenceBand: band,
    connective: band === 0 && !quiet && short && paragraph.override == null && !CONTACT_CUES.some(cue => cue.test(value)),
    contextualContact: band === 0 && !quiet && short && paragraph.override == null &&
      DIRECT_CONTACT.test(narrated.replace(/[.!?]$/u, "")),
    continuesMovement: movementHints.length > 0 && motion.continuation,
    movementHints,
    deviceReference: !quiet && motion.deviceReference,
    approaching: !quiet && APPROACH.test(actual) && ANTICIPATION.test(actual),
    releasing: !quiet && evidence.actual.some(({clause}) => !OTHER_MOVER.test(clause) && RELEASE.test(clause) &&
      (/\b(?:she|he|they|we|the movement|the rhythm|breath)\b/u.test(clause) || MOTION_CONTINUES.test(clause.trim()))),
    peaking: PEAK.test(pace),
    quick: VARIABLE_PACE.test(pace),
    slow: SOFT_PACE.test(pace),
    result: {band, level: SUGGESTION_LEVELS[band], reason: rest || stopped ? "Rest or scene boundary; left at zero." :
      ended ? "The described movement stopped; left at zero." :
      sensitive ? "Sensitive wording; left at zero for review." :
        uncertain ? "Context is uncertain or speculative; left at zero." : paragraph.reason,
      sceneId: null, phase: "quiet", rhythm: "steady", quiet, advisory, shape: "unspecified", cloudExcluded,
      movements: band > 0 ? movementHints : [],
      endedMovements: orderedMovements(motion.endedMovements)},
    shape,
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
  const candidates = [];
  for (const paragraph of paragraphs) {
    const previous = candidates.at(-1);
    candidates.push(sceneCandidate(paragraph, previous?.anchor && previous.deviceReference));
  }
  let nextScene = 0, activeScene = null, lastAnchor = -1;
  const endedMovements = new Set();
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
      applyBeat(result, {phase: "recover", band: 1, rhythm: "gentle", reason: "The preceding scene is easing off.",
        movements: candidate.continuesMovement ? candidate.movementHints : previous.movements});
    } else if (candidate.connective && index === lastAnchor + 1 && lastAnchor >= 0 && candidate.continuesMovement) {
      applyBeat(result, {phase: "sustain", band: Math.min(2, previous.band), rhythm: "gentle",
        reason: "The movements continue within the scene.", movements: candidate.movementHints});
    } else {
      const distance = index - lastAnchor;
      const follows = candidates[index + 1]?.anchor ||
        distance === 1 && candidates[index + 1]?.connective && candidates[index + 2]?.anchor;
      if ((!candidate.connective && !candidate.contextualContact) || lastAnchor < 0 || distance > 2 || !follows ||
          previous?.phase === "recover" && previous.band === 1) {
        activeScene = null;
        lastAnchor = -1;
        endedMovements.clear();
        continue;
      }
      const lead = candidates[lastAnchor].result;
      const band = Math.min(lead.band, distance === 1 ? 2 : 1);
      applyBeat(result, {phase: "sustain", band, rhythm: band === lead.band ? lead.rhythm : "gentle",
        reason: candidate.contextualContact ? "Contact continues between matched passages." :
          "Brief detail between matched passages; continued gently.", movements: previous.movements});
    }
    for (const movement of result.endedMovements) endedMovements.add(movement);
    for (const movement of candidate.movementHints) endedMovements.delete(movement);
    result.endedMovements = orderedMovements(endedMovements);
    result.movements = result.movements.filter(movement => !endedMovements.has(movement));
    if (activeScene === null) activeScene = ++nextScene;
    result.sceneId = activeScene;
    result.shape = candidate.shape;
  }
  return candidates.map(candidate => candidate.result);
}
