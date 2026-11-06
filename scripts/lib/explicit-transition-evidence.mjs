import {validateSceneMap} from "../../app/static/reader/scene-map.mjs";

const pauseWord = "(?:wait|stop|pause|hold on|let go|no)";
const command = `(?:please\\s+)?${pauseWord}(?:\\s+(?:please|now|a moment|a second))?`;
const speechVerb = "(?:said|says|asked|asks|called|calls|whispered|whispers|told|tells)";
const speaker = "(?:i|you|he|she|they|we|\\p{Lu}\\p{Ll}+)";
const interruptionWord = new RegExp(`\\b${pauseWord}\\b`, "iu");
const reportedSpeech = new RegExp(`\\b${speechVerb}\\b`, "iu");
const spokenAfterVerb = new RegExp(
  `\\b${speaker}\\s+${speechVerb}(?:\\s+(?:him|her|them|me|us)\\s+to)?[,:]?\\s+["']?${command}(?=[.!?;:,"']|$)`,
  "u",
);
const quotedBeforeVerb = new RegExp(
  `(?:^|[.!?;]\\s+)(["'])${command}[.!?,]?\\1(?:\\s+${speaker}\\s+${speechVerb}\\b|(?=\\s*[.!?]?$))`,
  "u",
);
const releaseVerb = "(?:let go|lets go|released|releases|stepped back|steps back|stepped apart|step apart|pulled away|pulls away|backed away|backs away|drew back|draws back|withdrew|withdraws|broke (?:the|their) embrace)";
const releaseWord = new RegExp(`\\b${releaseVerb}\\b`, "iu");
const personOrContact = "(?:me|him|them|us|each other|(?:my|his|her|their|your|our) (?:hands?|wrist|arm|shoulder|waist|fingers|hold|grip)|her(?=\\s*(?:[.!?,;]|$)|\\s+(?:immediately|gently|at once|and)\\b))";
const releaseEvidence = new RegExp(
  `\\b${speaker}\\s+(?:immediately\\s+)?(?:let(?:s)? go(?:(?:\\s+of\\s+${personOrContact}\\b)|(?!\\s+of\\b))|releas(?:ed|es)\\s+${personOrContact}\\b|step(?:ped|s)? (?:back|apart)|pull(?:ed|s) away|back(?:ed|s) away|drew back|draws back|withdrew|withdraws|broke (?:the|their) embrace)\\b`,
  "u",
);
const priorContact = /\b(?:held|clasped|took|kept|squeezed) (?:my|his|her|their|your|our|each other's) (?:hand|hands|wrist|arm)\b|\b(?:embraced|held each other)\b/u;
const nonEnacted = /\b(?:if|unless|would|might|should|will|shall|not|never|suppos\w*|imagin\w*|dream\w*|pretend\w*|remember\w*|recall\w*|recount\w*|rehears\w*|quot\w*|repeat\w*|promis\w*|plan\w*|yesterday|last (?:night|week|year)|used to)\b|\b(?:didn't|wouldn't|wasn't|couldn't)\b|\bhad\s+(?:said|told|asked|released|let|pulled|stepped)\b/u;
const contextTail = /^(?:\s|["',])*(?:yesterday|last (?:night|week|year)|earlier|before (?:that|then))\b/u;

function normalize(text) {
  // Preserve upper-case initials for named subjects. Lowercase only words we
  // recognize as sentence-start pronouns or command/reporting vocabulary.
  return text.replace(/[“”]/gu, '"').replace(/[‘’]/gu, "'").replace(/\s+/gu, " ")
    .replace(/\b(?:I|You|He|She|They|We|Wait|Stop|Pause|Hold|Let|No|Please|If|Unless|Yesterday|Last)\b/gu,
      word => word.toLowerCase());
}

function isUnquoted(text, index) {
  return text.slice(0, index).split('"').length % 2 === 1;
}

function enactedAt(text, match) {
  const prefix = text.slice(0, match.index).toLowerCase();
  return !nonEnacted.test(prefix) && !reportedSpeech.test(prefix) &&
    !contextTail.test(text.slice(match.index + match[0].length).toLowerCase());
}

function requestAt(text) {
  const quoted = quotedBeforeVerb.exec(text);
  if (quoted && enactedAt(text, quoted)) return quoted;
  const spoken = spokenAfterVerb.exec(text);
  return spoken && isUnquoted(text, spoken.index) && enactedAt(text, spoken) ? spoken : null;
}

function hasRelease(text) {
  const match = releaseEvidence.exec(text);
  return Boolean(match && isUnquoted(text, match.index) && enactedAt(text, match));
}

function adjacent(left, right) {
  return left && right && !left.structuralBoundary && !right.structuralBoundary &&
    right.id === left.id + 1 && right.paragraph - left.paragraph <= 1;
}

// Input is one passage from one story. This offline diagnostic only accepts
// enactment beside the request or beside explicitly narrated prior contact.
export function explicitTransitionAnchors(units) {
  validateSceneMap({scenes: []}, units);
  const texts = units.map(({text}) => normalize(text));
  const raw = [], corroborated = [];
  let precedingWitness = -1;
  for (const [index, unit] of units.entries()) {
    if (unit.structuralBoundary) continue;
    const text = texts[index];
    const rawRequest = interruptionWord.test(text) &&
      (reportedSpeech.test(text) || text.includes('"') || quotedBeforeVerb.test(text));
    const rawRelease = releaseWord.test(text);
    if (!rawRequest && !rawRelease) continue;
    raw.push(unit.id);
    const request = rawRequest ? requestAt(text) : null;
    if (request) {
      const after = text.slice(request.index + request[0].length);
      if (hasRelease(after)) {
        corroborated.push(unit.id);
      } else if (adjacent(unit, units[index + 1]) && hasRelease(texts[index + 1])) {
        corroborated.push(unit.id);
        precedingWitness = units[index + 1].id;
      }
    } else if (rawRelease && precedingWitness !== unit.id && adjacent(units[index - 1], unit) && hasRelease(text)) {
      const prior = texts[index - 1];
      const contact = priorContact.exec(prior.toLowerCase());
      if (contact && isUnquoted(prior, contact.index) && enactedAt(prior, contact)) corroborated.push(unit.id);
    }
  }
  return {raw, corroborated};
}
