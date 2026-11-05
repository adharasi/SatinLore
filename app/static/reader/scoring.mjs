// Experimental English cue matching, not semantic understanding or a safety classifier.
// Suggestions stay local and should be reviewed; uncertain context defaults to zero.
export const SUGGESTION_LEVELS = Object.freeze([0, 1, 2, 3, 5]);

const CONTACT_CUES = [
  /\bkiss(?:es|ed|ing)?\b/,
  /\bembrac(?:e|es|ed|ing)\b/,
  /\bcaress(?:es|ed|ing)?\b/,
];
const FIGURATIVE_CONTACT = /\b(?:blew|blows?|sent|sends?) (?:me|you|him|her|them) (?:(?:a|some) )?(?:[\p{L}]+ )?(?:words and )?kiss(?:es)?\b/gu;
const CONTACT_BODY_SUBJECT = /^\s*(?:my|his|her|their|our|your) (?:lips|mouth|arms?|hands?)\b/u;
const MODAL_CONTACT = /\b(?:would|could)\b/u;
const WRAPPED_COMPLEMENT = /^\s*(?:in|with|against|on|upon)\b/u;
// Narrated contact often has no adjective and never names a device. Keep this
// distinct from the cues that identify a particular toy movement.
const ENACTED_CONTACT = [
  /\b(?:our|their) (?:lips|mouths) (?:met|meet|touched|touch|came together|come together)\b/u,
  /\b(?:(?:my|his|her|your) (?:lips|mouth)|[\p{L}]+(?:'s|') lips) (?:met|found|touched|brushed|covered|pressed against) (?:against )?(?:mine|yours|his|hers|theirs|(?:my|his|her|your) (?:lips|mouth))\b/u,
  /\b(?:pressed|press(?:es)?|brushed|brush(?:es)?|moved|moves?) (?:my|his|her|your) (?:lips|mouth) (?:to|against|over) (?:mine|yours|his|hers|theirs|(?:my|his|her|your) (?:lips|mouth))\b/u,
  /\b(?:lean(?:ed|s)? (?:in|over|forward)|dr(?:ew|aws?) (?:me|you|him|her|them) clos(?:e|er)) and kiss(?:ed|es)? (?:me|you|him|her|them|each other)\b|\bkiss(?:ed|es)? (?:me|you|him|her|them) back\b/u,
  /\b(?:(?:the|their|our) (?:(?:tender|slow|gentle|soft|lingering) )?kiss (?:deepened|deepens|intensified)|(?:deepened|deepens) (?:the|their|our) kiss|kiss(?:ed|es) (?:me|you|him|her|them|each other) (?:harder|more urgently|more deeply))\b/u,
];
const INTENSIFIED_CONTACT = ENACTED_CONTACT.at(-1);
const INNOCENT_KISS = /\b(?:kiss(?:ed|es)? (?:me|you|him|her|them) (?:goodbye|goodnight|hello)|(?:(?:on|against)|kiss(?:ed|es)?) (?:the|my|his|her|your|their) (?:cheek|forehead|temple|hand|knuckles)|(?:my|his|her|their|the) (?:sister|brother|mother|father|grandmother|grandfather|aunt|uncle|son|daughter|baby|dog|cat))\b/u;
const enactedContact = clause => !INNOCENT_KISS.test(clause) && ENACTED_CONTACT.some(cue => cue.test(clause));
const hasContactCue = value => CONTACT_CUES.some(cue => cue.test(value)) || enactedContact(value);
const CLINGING_EMBRACE = /\b(?:my|his|her|their|our|your) arms (?:round|around) (?:my|his|her|your|their) (?:neck|waist|shoulders?)\b[^.!?;]{0,32}\b(?:clung|clings?) to (?:me|you|him|her|them)\b/u;
const CLOSE_HOLD = /\b(?:held|clasped|holds?|clasps?) (?:me|you|him|her|them|each other) close\b/u;
const RECIPROCAL_HOLD = /\bkiss(?:ed|es)? (?:me|you|him|her|them|each other) and (?:held|holds?) (?:me|you|him|her|them|each other) close\b/u;
const FACE_AT_SHOULDER = /\b(?:(?:laid|rested) (?:my|his|her|your|their) (?:head|face|cheek)|(?:turned|tilted) (?:my|his|her|your|their) (?:head|face)[^.!?;]{0,96}\b(?:laid|rested) it) on (?:my|his|her|your|their) shoulder\b/u;
const BARE_CONTACT = /\b(?:(?:(?:we|they) (?:kissed|kiss|embraced|embrace)|(?:kiss(?:ed|es)|embrac(?:ed|es)) (?:me|you|him|her|them|each other))(?=\s*(?:[,—–-]|$)|\s+(?:and|again|closely|for|with|in|on|at|as|when)\b)|(?:put|slipped|wrapped|flung|threw|folded) (?:my|his|her|their|our|your) arms (?:round|around) (?:me|you|him|her|them|each other|(?:my|his|her|their|our|your) (?:neck|waist|shoulders?))\b)/u;
const PERSONAL_AFFECTION = /\b(?:(?:tender|affectionate|loving|romantic) (?:look|smile|gaze|touch|expression)|(?:tenderness|affection|longing|desire|love|passion) (?:for|between) (?:me|you|him|her|them|us|each other)|(?:tenderness|affection|longing|love) (?:in|filled) (?:my|his|her|their|our|your) (?:eyes|gaze|voice|heart|face|expression)|(?:looked|gazed|smiled) at (?:me|you|him|her|them|each other) (?:lovingly|tenderly|with (?:tenderness|affection|longing|love))|(?:my|his|her|their|our|your) (?:eyes|voice|face|smile) (?:shone|glowed|softened|filled) with (?:tenderness|affection|longing|love))\b/u;
const CONTACT_REPORT = /\b(?:claim(?:ed|s)?|alleg(?:ed|es)|thought|suspect(?:ed|s)?|read(?:s|ing)?|(?:from|in) (?:a|the) (?:play|film|movie|script|letter)|for the camera)\b/u;
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
const EXPLICIT_STOP = /(?:^|[.!?;“"\n]\s*)(?:no|stop)(?:[,.!?;”"\n]|$)|(?:^|[.!?;\n]\s*)(?:he|she|they|we) (?:stopped|refused|(?:pulled|backed) away(?: from (?:her|him|them|each other))?)(?=[.!?;\n]|$)|\b(?:asked|told)\b[^.!?;]{0,36}\bto stop\b|\b(?:said|whispered|shouted)\s*,?\s*["“'](?:no|stop)\b|(?:^|[^\p{L}\p{N}])['‘](?:no|stop)[,.!?;]*'(?![\p{L}\p{N}])/u;
const normalized = text => text.toLowerCase().replace(/’/g, "'").replace(/[^\S\n]+/gu, " ").trim();
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

function neighboringContact(actual) {
  const grounded = clause => !clause.includes(QUOTE_GAP) && !INNOCENT_KISS.test(clause) && !CONTACT_REPORT.test(clause);
  const adjacent = (left, right) => left && right && right.index - left.index === 2 &&
    /^(?:,|and|as|while|then|and then|[.!?;]+)$/u.test(right.before);
  const affectionate = ({clause}) => grounded(clause) && PERSONAL_AFFECTION.test(clause);
  return actual.find((contact, index) => {
    if (!BARE_CONTACT.test(contact.clause) || !grounded(contact.clause) || contact.before === "before") return false;
    const previous = actual[index - 1], next = actual[index + 1];
    return adjacent(previous, contact) && affectionate(previous) || adjacent(contact, next) && affectionate(next);
  });
}

function clauseEvidence(value) {
  const contacts = new Set(), context = new Set(), active = [], actual = [];
  const parts = value.split(CLAUSE_BREAK);
  let uncertain = false, nonPresentMotion = false, cloudExcluded = false, directBand = 0;
  let speculative = false, reported = false, detached = false, ordinal = -2;
  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index].replace(FIGURATIVE_CONTACT, "");
    const before = parts[index - 1];
    if (clause.trim()) ordinal += 2;
    detached = DETACHED_PAST.test(clause) || detached && before === ",";
    speculative = SPECULATION.test(clause) || detached ||
      speculative && LINKED_CLAUSE.has(before) ||
      before === "before" && UNCERTAIN_CONTEXT.test(parts[index - 2]);
    reported = REPORTED_SPEECH.test(clause) || reported && (LINKED_CLAUSE.has(before) || before === ",");
    const innocent = INNOCENT_KISS.test(clause);
    const direct = !innocent && ENACTED_CONTACT.find(cue => cue.test(clause));
    const contactMatches = innocent ? [] : CONTACT_CUES.filter(cue => cue.test(clause));
    if (direct && !contactMatches.length) contactMatches.push(direct);
    const contextMatches = CONTEXT_CUES.filter(cue => cue.test(clause));
    if (!contextMatches.length && gentleContact(clause, contactMatches)) contextMatches.push(GENTLE_CONTACT);
    // An unrealised cue applies when it introduces the action, rather than
    // when it describes a later consequence of an action that already happened.
    const unrealised = UNREALISED.exec(clause);
    const unrealisedAction = unrealised && [...contactMatches, MOTION_MATCH].map(cue => clause.search(cue))
      .filter(position => position >= 0).reduce((first, position) => Math.min(first, position), Infinity);
    // A linked body description can elaborate the previous unrealised
    // contact without introducing a new actor or a current action.
    const prior = parts[index - 2] ?? "";
    const priorClause = parts[index - 3] === "\n" && WRAPPED_COMPLEMENT.test(prior) ? `${parts[index - 4]} ${prior}` : prior;
    const modalContinuation = (before === "and" || before === ",") && CONTACT_BODY_SUBJECT.test(clause) &&
      MODAL_CONTACT.test(priorClause) && hasContactCue(priorClause);
    const speculativeOrReported = speculative || reported || META_CONTEXT.test(clause) || NON_ACTUAL.test(clause) ||
      modalContinuation || !!unrealised && Number.isFinite(unrealisedAction) && unrealised.index < unrealisedAction;
    if (speculativeOrReported || UNCERTAIN_CONTEXT.test(clause) || direct && before === "before") {
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
    if (!contactMatches.length || !contextMatches.length && !direct) continue;
    active.push(clause);
    if (direct) directBand = Math.max(directBand, INTENSIFIED_CONTACT.test(clause) ? 2 : 1);
    if (!contextMatches.length) continue;
    for (const cue of contactMatches) contacts.add(cue);
    for (const cue of contextMatches) context.add(cue);
  }
  const holdsContact = !INNOCENT_KISS.test(value) && (actual.some(({clause}) => CLINGING_EMBRACE.test(clause) || RECIPROCAL_HOLD.test(clause)) ||
    actual.some(({clause}) => FACE_AT_SHOULDER.test(clause)) && actual.some(({clause}) => CLOSE_HOLD.test(clause)));
  if (holdsContact) directBand = Math.max(directBand, 1);
  // A plain action can borrow one adjacent piece of personal context, never a
  // distant keyword or a cue across a skipped, quoted, or contrary clause.
  if (!directBand && !active.length) {
    const contact = neighboringContact(actual);
    if (contact) {
      active.push(contact.clause);
      directBand = 1;
    }
  }
  return {band: Math.max(directBand, Math.min(4, contacts.size + context.size - 1)), active, actual,
    uncertain, nonPresentMotion, cloudExcluded, directBand, holdsContact};
}

export function scoreParagraph(text) {
  if (typeof text !== "string") throw new TypeError("A paragraph must be text.");
  const value = normalized(text);
  if (EXPLICIT_STOP.test(value)) return {band: 0, level: 0, reason: "An explicit stop cue; left at zero."};
  const {band, uncertain, directBand} = clauseEvidence(narration(text));
  return {band, level: SUGGESTION_LEVELS[band], reason: directBand && directBand === band ? "Matched a described affectionate action." :
    band > 0 ? "Matched a contact and context cue in the same clause." :
    uncertain ? "Contact wording was uncertain or speculative." : "No matching cue pair; left at zero."};
}

const SCENE_SEPARATOR = /^(?:[\s*#~_—–-]{3,}|(?:chapter|part|book|scene)\s+(?:\d+|[ivxlcdm]{1,8}|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[:.\-–—].*)?)$/u;
const REST_BOUNDARY = /\b(?:fell asleep|went to sleep|(?:settled|lay) down to rest|(?:need(?:ed)?|take|took) (?:a |some )?(?:break|rest)|paus(?:e|ed) (?:for breath|to rest)|a (?:long|quiet) pause|slowed to a stop|quiet (?:interlude|break))\b/u;
const TIME_BOUNDARY = /\b(?:(?:the )?(?:next|following) (?:day|morning|afternoon|evening|night|week|month|year)|(?:hours?|days?|weeks?|months?|years?) later|later that (?:evening|night))\b/u;
const SENSITIVE_CUE = /\b(?:non[ -]?consent(?:ual)?|coerc(?:e|ed|es|ing|ion)|forced|unwanted|under[ -]?age|child(?:ren)?|(?:1[0-7]|[1-9])[ -]years?[ -]olds?|incest|bestiality|rape|assault(?:ed)?)\b/u;
const SENSITIVE_AGE = /(?<![\p{L}\p{N}-])(?<!twenty |thirty |forty |fifty |sixty |seventy |eighty |ninety )(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)[ -]years?[ -]olds?\b/u;
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
const CONTACT_APPROACH = /\b(?:drew (?:me|him|her|them) clos(?:e|er)|(?:rested|placed) (?:a|my|his|her|their) hand (?:at|on) (?:my|his|her|their) waist)\b/u;
const CONTACT_CONTINUES = /\b(?:kiss(?:ed|es) (?:me|you|him|her|them|each other) (?:again|once more)|(?:kept|continued) (?:on |to )?kiss(?:ing)?|(?:my|his|her|their|our) arms (?:(?:were|are) still around|tightened around|stayed around|remained around) (?:me|you|him|her|them|each other)|(?:their|our) lips (?:stayed|remained) together|(?:the|their|our) (?:kiss|embrace) (?:continued|lingered)|held (?:the|their|our) (?:kiss|embrace))\b/u;
const REPOSITIONED_CONTACT = /\b(?:(?:laid|placed|moved|slid) (?:my|his|her|their|your|our) (?:hands|arms) (?:round|around|against|over|onto) (?:my|his|her|their|your|our) (?:back|shoulders?|neck|waist|arms?|hands?)|disengaged (?:my|his|her|their|your|our) hands from (?:my|his|her|their|your|our) face[^.!?;]{0,36}\b(?:laid|placed|moved) (?:my|his|her|their|your|our) arms)\b/u;
const DIALOGUE_TAG = /\b(?:he|she|they|i) (?:said|murmured|asked|replied|whispered|answered|continued)\b/gu;
const DIALOGUE_DEPARTURE = /\b(?:i|we) (?:must|have to|need to|should|ought to) (?:go|leave|run|head off)\b/u;
const RELATIONAL_AFFECTION = /\b(?:(?:in love with|falling for|attracted to|had a crush on|flirt(?:ed|s|ing) with|(?:affection|longing|tenderness) for)|(?:like|liked|love|loved) (?:it )?when (?:i|you|he|she|they) (?:touched|held|smiled at|looked at)) (me|you|him|her|them|each other)(?=\s*$|[,.!?;]| (?:and|as|while|when|too|again)\b)/u;
const RELATIONAL_GESTURES = [
  /\b(?:took|reached for) (my|his|her|your|their) hand\b/u,
  /\b(?:(?:met|held|caught) (my|his|her|your|their) (?:gaze|eye)|(?:looked|gazed) into (my|his|her|your|their) eyes)\b/u,
  /\b(?:smiled|grinned|leaned) (?:at|toward|towards) (me|you|him|her|them|each other)\b/u,
  /\bbrushed (?:a (?:wet )?lock of )?hair (?:off|away from) (my|his|her|your|their) (?:forehead|face|eyes)\b/u,
  /\b(?:held|clasped) (me|you|him|her|them|each other) close\b/u,
];
const POSSESSIVE_RECIPIENTS = {my: "me", his: "him", her: "her", your: "you", their: "them"};
const RESPONSE_ACTORS = {my: "i", his: "he", her: "she", their: "they"};
const RELATIONAL_RESPONSE = /^(?:(i|he|she|they) (?:blushed|went pink)|(my|his|her|their) (?:cheeks|face) (?:flushed|grew warm|turned pink))(?: again| at (?:the|his|her|my|their) (?:compliment|words))?[.!?]*$/u;
const DIRECT_COMPLIMENT = /^(?:i (?:really )?(?:like|love|adore) (?:you|being with you|spending time with you|your (?:eyes|smile|laugh))|(?:i (?:think|know) )?you(?:'re| are| look) (?:(?:so|really|very|absolutely) )?(?:beautiful|handsome|gorgeous|lovely|attractive)(?: tonight)?)[.!…,]*$/u;
const COMPLIMENT_ATTRIBUTION = /^\u2063\s*(?:(i|he|she|they) (?:said|murmured|replied|whispered|answered)(?:[.!?,]+\s*|$))?/u;
const RELATIONAL_FRAME = /\b(?:sister|brother|mother|father|grandmother|grandfather|aunt|uncle|son|daughter|baby|grandchild|siblings|parents?|puppy|kitten|rehears(?:e|ed|al|ing)|recit(?:e|ed|es|ing)|quot(?:e|ed|es|ing)|script|lyrics|overheard|pictured|envisioned|used to|back when|back then|years ago|last (?:summer|winter|spring|autumn|fall|year)|(?:in|from) (?:a|the) (?:film|movie|play|script))\b/u;
const RELATIONAL_REPORT = /\b(?:(?:said|says|(?:whisper|murmur)(?:ed|s)) (?:i|you|he|she|they|we)|(?:told|tells) (?:me|you|him|her|them|us))\b/u;
const RELATIONAL_SCOPE = new Set(["after", "before", "instead of", "rather than", "but", "yet", "whereas", "although"]);
const PAST_PERFECT_CONTACT = /\bhad (?:(?:just|already|often|once|ever|never|[\p{L}]+ly) ){0,2}(?:kissed|embraced|returned)\b/u;
const RELATIONAL_LOOKBACK = /\b(?:remember(?:ed|ing)|recall(?:ed|ing)|recollect(?:ed|ing)|memor(?:y|ies) of|in those days|(?:mind|thoughts?) (?:went back|returned) to)\b/u;
const RELATIONAL_WITHDRAWAL = /\b(?:hands?|arms?) (?:slipped|withdrew) (?:out of|from) (?:mine|his|hers|ours|yours|theirs)\b/u;
const RETROSPECTIVE_ENTRY = /\b(?:on looking back|in those days|back then|(?:mind|thoughts?) (?:went back|returned) to|could (?:still )?remember (?:[\p{L}]+ing|(?:that|the) (?:day|night|evening|morning|summer|winter|moment)))\b/u;
const RETROSPECTIVE_RETURN = /\b(?:back in the present|back to the present|the memory faded)\b/u;
const GROUNDED_CONTACT = /\b(?:(?:we|they) (?:kiss(?:ed)?|embrace(?:d)?)|(?:kiss(?:ed|es)|embrac(?:ed|es)|caress(?:ed|es)) (?:me|you|him|her|them|each other)|(?:is|are|was|were) (?:[\p{L}]+ly )?(?:kissing|embracing|caressing) (?:me|you|him|her|them|each other|(?:the|my|his|her|your|their) (?:[\p{L}]+ )?(?:lips|mouth|shoulder)))\b/u;
const RELEASE = /\b(?:slowed|softened|eased|relaxed|settled|(?:their|our) breathing (?:evened out|grew quieter))\b/u;
const CONTACT_RELEASE = /\b(?:(?:they|we) (?:eased|drifted|drew|moved) apart|(?:the|their|our) (?:kiss|embrace) (?:softened|eased))\b/u;
const PEAK = /\b(?:intensifi(?:ed|es)|crescendo|overwhelming|surge(?:d|s)?|reached (?:a|its|their) peak)\b/u;
const MOTION_LINK = /\b(?:hands?|fingers?|palms?|hips?|arms?|touch|contact|motion|movement|rhythm|device|flexer|toy)\s+(?:(?:was|were|is|are|kept|continued|started|began|slowly|quickly|gently|steadily|softly)(?: to)?\s+){0,3}$/u;
const MAX_MOVEMENT_CONTEXT = 128;
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
  const otherMover = OTHER_MOVER.exec(clause);
  const unambiguous = !otherMover && !DEVICE_DISTRACTOR.test(trimmed);
  let previousEnd = null, deviceActor = false, continuation = false, unresolved = false;
  for (const match of clause.matchAll(MOTION_MATCH)) {
    if (otherMover && otherMover.index < match.index) break;
    const before = clause.slice(0, match.index);
    // The movement link is a short suffix. Rescanning the whole prefix for
    // every cue stalls the reader on long paragraphs pasted from the web.
    const nearby = before.slice(-MAX_MOVEMENT_CONTEXT);
    const end = match.index + match[0].length;
    const implied = IMPLIED_DEVICE.test(before);
    const referring = priorDevice && implied;
    unresolved ||= implied && !priorDevice;
    const linked = MOTION_LINK.test(nearby) ||
      /^side[ -]to[ -]side$/u.test(match[0]) && MOTION_LINK.test(nearby.replace(/\bmoved\s+$/u, "")) ||
      continuous &&
      (previousEnd === null || SHARED_MOTION.test(clause.slice(previousEnd, match.index)));
    const joined = previousEnd !== null && SHARED_MOTION.test(clause.slice(previousEnd, match.index));
    const shared = inheritsSubject && INHERITED_MOTION.test(before);
    const byDevice = DEVICE_LINK.test(before) || referring || joined && deviceActor || shared && priorDevice;
    if (!linked && !joined && !shared && !referring) continue;
    const deviceAlias = /^(?:puls|buzz)/u.test(match[0]);
    if (!byDevice && deviceAlias) continue;
    const after = clause.slice(end);
    const afterToOtherMover = continuous && otherMover && otherMover.index >= end ?
      clause.slice(Math.max(end, otherMover.index - MAX_MOVEMENT_CONTEXT), otherMover.index) : "";
    if (MOTION_OBJECT.test(after) || SOURCE_LINK.test(afterToOtherMover)) continue;
    movements.push(movementId(match[0]));
    recordShapes(shapes, nearby, after);
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

function relationshipEvidence(value, narrated, actual, quotes, short) {
  if (RELATIONAL_FRAME.test(narrated)) return null;
  // Only use narrated, present clauses that the existing scope scan retained.
  // A named emotion and a directed gesture are separate pieces of evidence.
  let previous;
  let paired = false;
  const affectionTargets = new Set(), gestureTargets = new Set();
  for (const {clause, index, before} of actual) {
    if (!clause.trim() || clause.includes(QUOTE_GAP) || RELATIONAL_SCOPE.has(before) || CONTACT_REPORT.test(clause) ||
        RELATIONAL_REPORT.test(clause) || UNREALISED.test(clause) || UNCERTAIN_CONTEXT.test(clause)) continue;
    const affection = RELATIONAL_AFFECTION.exec(clause)?.[1];
    const gestures = RELATIONAL_GESTURES.flatMap(cue => {
      const target = cue.exec(clause)?.slice(1).find(Boolean);
      return target ? [POSSESSIVE_RECIPIENTS[target] ?? target] : [];
    });
    paired ||= gestures.includes(affection) || previous && previous.index + 2 === index &&
      (previous.gestures.includes(affection) || gestures.includes(previous.affection));
    if (affection) affectionTargets.add(affection);
    for (const target of gestures) gestureTargets.add(target);
    previous = {index, affection, gestures};
  }
  // A simple direct compliment can also be corroborated by an actual reaction.
  // Dialogue without a reaction is insufficient, even when it sounds romantic.
  const compliment = short && quotes.length === 1 && value.startsWith(quotes[0]) &&
    !CONTACT_REPORT.test(narrated) && !SPECULATION.test(narrated) && !NON_ACTUAL.test(narrated) &&
    !UNCERTAIN_CONTEXT.test(narrated) && !UNREALISED.test(narrated) &&
    DIRECT_COMPLIMENT.test(quotes[0].slice(1, -1).trim());
  const attribution = compliment ? COMPLIMENT_ATTRIBUTION.exec(narrated) : null;
  const [prefix = "", speaker] = attribution ?? [];
  const response = short && RELATIONAL_RESPONSE.exec(narrated.slice(prefix.length));
  const responseActor = response && (response[1] ?? RESPONSE_ACTORS[response[2]]);
  return {paired, compliment: compliment && (prefix.length === narrated.length || Boolean(responseActor)), speaker, responseActor,
    affectionTargets: short ? [...affectionTargets] : [], gestureTargets: short ? gestureTargets : new Set()};
}

const hasComplimentResponse = (left, right) => left.compliment && right.responseActor && left.speaker !== right.responseActor;

function linkedRelationship(previous, next) {
  return previous && next && (!previous.responseActor && !next.compliment && hasComplimentResponse(previous, next) ||
    previous.affectionTargets.some(target => next.gestureTargets.has(target)) ||
    next.affectionTargets.some(target => previous.gestureTargets.has(target)));
}

function sceneCandidate(paragraph, incomingDevice) {
  if (!paragraph || typeof paragraph.text !== "string" || !Number.isInteger(paragraph.band) ||
      paragraph.band < 0 || paragraph.band >= SUGGESTION_LEVELS.length || SUGGESTION_LEVELS[paragraph.band] !== paragraph.suggestedLevel || typeof paragraph.reason !== "string") {
    throw new TypeError("Use analysed paragraph results for scene suggestions.");
  }
  const value = normalized(paragraph.text);
  const narrated = narration(paragraph.text);
  const evidence = clauseEvidence(narrated);
  const separator = SCENE_SEPARATOR.test(value.split("\n", 1)[0].trim());
  const rest = separator || REST_BOUNDARY.test(narrated) || TIME_BOUNDARY.test(narrated);
  const stopped = EXPLICIT_STOP.test(value);
  const sensitive = SENSITIVE_CUE.test(value) || SENSITIVE_AGE.test(value);
  const motion = sceneMovements(evidence.actual, incomingDevice && !/^["'“‘]/u.test(value));
  const {movements: describedMovements, ended} = motion;
  const quotes = narrated !== value ? [...value.matchAll(QUOTED_TEXT)].map(([quote]) => quote) : [];
  const quotedMotion = quotes.some(hasMotionCue);
  const quotedContact = quotes.some(quote => hasContactCue(quote) || CONTACT_CONTINUES.test(quote));
  const uncertain = !evidence.active.length && !evidence.holdsContact && (evidence.uncertain ||
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
  const dialogue = value.length <= 240 && /^["'“‘]/u.test(value) && !DIALOGUE_DEPARTURE.test(value) &&
    !narrated.replace(DIALOGUE_TAG, "").replace(/[\u2063\s,.!?…—–-]/gu, "");
  const repositionsHold = !quiet && !cloudExcluded && paragraph.override == null && REPOSITIONED_CONTACT.test(actual);
  const relationship = band === 0 && !quiet && !cloudExcluded && paragraph.override == null ?
    relationshipEvidence(value, narrated, evidence.actual, quotes, short) : null;
  const startsRetrospective = RETROSPECTIVE_ENTRY.test(narrated);
  const groundedContact = band > 0 && !cloudExcluded && paragraph.override == null && !startsRetrospective &&
    !RELATIONAL_FRAME.test(narrated) && !RELATIONAL_LOOKBACK.test(narrated) && !RELATIONAL_WITHDRAWAL.test(narrated) &&
    evidence.active.some(clause => !clause.includes(QUOTE_GAP) && !CONTACT_REPORT.test(clause) &&
      !INNOCENT_KISS.test(clause) && !PAST_PERFECT_CONTACT.test(clause) &&
      (enactedContact(clause) || GROUNDED_CONTACT.test(clause)));
  const advisory = sensitive ? "Sensitive wording may need a closer look. This local suggestion stays at zero." :
    uncertain ? "The wording is ambiguous or speculative. This suggestion stays at zero." : null;
  return {
    anchor: band > 0 && paragraph.override !== 0,
    evidenceBand: band,
    relationship,
    startsRetrospective,
    resetsRetrospective: separator || RETROSPECTIVE_RETURN.test(narrated),
    groundedContact,
    connective: band === 0 && !quiet && short && paragraph.override == null && !hasContactCue(value),
    contextualContact: band === 0 && !quiet && short && paragraph.override == null &&
      DIRECT_CONTACT.test(narrated.replace(/[.!?]$/u, "")),
    continuesContact: !quiet && !cloudExcluded && paragraph.override == null && CONTACT_CONTINUES.test(actual),
    holdsContact: band > 0 && evidence.holdsContact,
    carriesHold: repositionsHold || !quiet && !cloudExcluded && paragraph.override == null && dialogue,
    repositionsHold,
    continuesMovement: movementHints.length > 0 && motion.continuation,
    changesMovementRhythm: movementHints.length > 0 && (shape === "accented" || shape === "alternating"),
    movementHints,
    deviceReference: !quiet && motion.deviceReference,
    approaching: !quiet && !cloudExcluded && paragraph.override == null &&
      (CONTACT_APPROACH.test(actual) || APPROACH.test(actual) && ANTICIPATION.test(actual)),
    endingContact: !quiet && !cloudExcluded && paragraph.override == null && CONTACT_RELEASE.test(actual),
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
  let recalledThrough = -1;
  for (const [index, paragraph] of paragraphs.entries()) {
    const previous = candidates.at(-1);
    const candidate = sceneCandidate(paragraph, previous?.anchor && previous.deviceReference);
    if (candidate.resetsRetrospective) recalledThrough = -1;
    else if (candidate.startsRetrospective) recalledThrough = index + 2;
    // Only veto fresh local promotions and provenance. Existing explicit
    // movement, quiet and manually chosen values keep their own rules.
    if (index <= recalledThrough) {
      candidate.relationship = null;
      candidate.groundedContact = false;
    }
    candidates.push(candidate);
  }
  for (const [index, candidate] of candidates.entries()) {
    const signal = candidate.relationship;
    const previous = candidates[index - 1]?.relationship;
    const next = candidates[index + 1]?.relationship;
    if (!signal || !(signal.paired || hasComplimentResponse(signal, signal) ||
        linkedRelationship(previous, signal) || linkedRelationship(signal, next))) continue;
    candidate.anchor = true;
    candidate.evidenceBand = 1;
    candidate.movementHints = [];
    Object.assign(candidate.result, {band: 1, level: SUGGESTION_LEVELS[1], currentCue: true,
      reason: "Matched a present affectionate gesture or a corroborated compliment."});
  }
  let nextScene = 0, activeScene = null, lastAnchor = -1, heldContact = false;
  const endedMovements = new Set();
  for (const [index, candidate] of candidates.entries()) {
    const {result} = candidate;
    const previous = candidates[index - 1]?.result;
    const next = candidates[index + 1];
    const distance = index - lastAnchor;
    if (candidate.anchor) {
      const recovery = activeScene !== null && (candidate.endingContact || candidate.releasing || previous?.phase === "peak" && result.band < previous.band - 1);
      const lead = candidates[lastAnchor];
      const peak = !recovery && activeScene !== null && result.band >= 3 &&
        (candidate.peaking && !lead?.peaking || result.band === 4 && lead && lead.evidenceBand < result.band);
      const earlyContact = activeScene === null && (result.band <= 1 || result.band === 2 && candidate.slow) ||
        lastAnchor < 0 && result.band === 1 && candidate.slow;
      const phase = recovery ? "recover" : peak ? "peak" :
        earlyContact ? "build" : "sustain";
      const band = recovery ? Math.min(2, result.band) : peak ? 4 : Math.min(3, result.band);
      const rhythm = peak || !recovery && band >= 3 && candidate.quick ? "dynamic" :
        recovery || band >= 2 && candidate.slow ? "gentle" : "steady";
      const movements = !result.currentCue && !result.movements.length && candidate.continuesContact && activeScene !== null ? previous?.movements : undefined;
      applyBeat(result, {phase, band, rhythm, reason: result.reason, movements});
      if (candidate.groundedContact) result.currentCue = true;
      if (peak) result.advisory = "Review this stronger local suggestion if needed.";
      heldContact = !recovery && (candidate.holdsContact || heldContact && candidate.continuesContact);
      lastAnchor = index;
    } else if (lastAnchor < 0 && candidate.approaching && (next?.anchor || next?.approaching && candidates[index + 2]?.anchor)) {
      applyBeat(result, {phase: "build", band: 1, rhythm: "gentle", reason: "An approach immediately before matched contact."});
    } else if (lastAnchor >= 0 && (distance <= 2 && candidate.endingContact || distance === 1 && candidate.connective && candidate.releasing)) {
      applyBeat(result, {phase: "recover", band: 1, rhythm: "gentle", reason: "The preceding scene is easing off.",
        movements: candidate.movementHints.length ? candidate.movementHints : previous.movements});
      heldContact = false;
    } else if (lastAnchor >= 0 && previous?.phase !== "recover" && distance <= 2 && candidate.continuesContact) {
      applyBeat(result, {phase: "sustain", band: Math.min(2, previous.band), rhythm: previous.rhythm,
        reason: "The contact continues within the scene.", movements: candidate.movementHints.length ? candidate.movementHints : previous.movements});
      lastAnchor = index;
    } else if (heldContact && candidate.carriesHold && (distance <= 2 || distance === 3 && candidate.repositionsHold)) {
      applyBeat(result, {phase: "sustain", band: 1, rhythm: "steady", reason: "A short exchange within established contact.", movements: previous.movements});
      if (candidate.repositionsHold) lastAnchor = index;
    } else if (lastAnchor >= 0 && distance === 1 && (candidate.connective && candidate.continuesMovement || candidate.changesMovementRhythm)) {
      applyBeat(result, {phase: "sustain", band: Math.min(2, previous.band), rhythm: candidate.changesMovementRhythm ? "dynamic" : "gentle",
        reason: "The movements continue within the scene.", movements: candidate.movementHints});
    } else {
      const follows = next?.anchor || next?.continuesContact || next?.endingContact ||
        distance === 1 && next?.connective && candidates[index + 2]?.anchor;
      if ((!candidate.connective && !candidate.contextualContact) || lastAnchor < 0 || distance > 2 || !follows ||
          previous?.phase === "recover" && previous.band === 1) {
        activeScene = null;
        lastAnchor = -1;
        heldContact = false;
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
