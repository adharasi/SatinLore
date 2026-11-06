import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {nocturneCandidates, nocturneContextCandidates, nocturneContextNeedsReview,
  NOCTURNE_CONTEXT_SESSION_BYTES, NOCTURNE_CONTEXT_SESSION_REQUESTS} from "../app/static/reader/nocturne.mjs";
import {NOCTURNE_CONTEXT_VERSION, validContextAnnotation,
  validateNocturneContext} from "../app/static/reader/nocturne-context-contract.mjs";
import {loadCorpus} from "./evaluate-nocturne-corpus.mjs";

const modelOptions = {nocturne: true, peakPattern: "auto"};
const protectedLabel = label => label.protected === true || label.contextEligible === false;

function referenceAnnotation(label, id) {
  const annotation = {id, category: label.cueEligible ? label.category : "neutral",
    phase: label.cueEligible ? label.phase : "quiet", eventKind: label.eventKind,
    confidence: 100, shape: "unspecified"};
  if (!protectedLabel(label) && validContextAnnotation(annotation, NOCTURNE_CONTEXT_VERSION)) return annotation;
  return {id, category: "abstain", phase: "abstain", eventKind: "uncertain", confidence: 100, shape: "unspecified"};
}

function replayPlan(model, labels) {
  const attempted = new Set();
  let requests = 0, bytes = 0, overlapParagraphAttempts = 0;
  function plan(position, manual = false) {
    const maxBytes = NOCTURNE_CONTEXT_SESSION_BYTES - bytes;
    if (requests >= NOCTURNE_CONTEXT_SESSION_REQUESTS || maxBytes <= 0) return;
    if (!manual && !nocturneContextNeedsReview(model.paragraphs, position, {attempted, maxBytes})) return;
    const window = nocturneContextCandidates(model.paragraphs, position, {attempted, maxBytes});
    if (!window.paragraphs.length) return;
    requests++;
    bytes += window.sourceBytes;
    overlapParagraphAttempts += window.paragraphs.length - window.newIds.length;
    // Manufacture the answer locally after selection. Neither reference labels
    // nor source text are submitted to a provider or written to the report.
    const response = {version: NOCTURNE_CONTEXT_VERSION, usage: null,
      labels: window.paragraphs.map(({id}) => referenceAnnotation(labels[id], id))};
    const checked = validateNocturneContext(window.paragraphs, response);
    for (const id of window.newIds) {
      attempted.add(id);
      model.nocturneContext.set(id, checked.labels.get(id));
    }
  }

  // A manual enable at the first paragraph followed by one automatic check
  // per visited paragraph. Local reference replies complete synchronously.
  plan(0, true);
  for (let position = 0; position < labels.length; position++) plan(position);
  return {attempted, requests, bytes, overlapParagraphAttempts};
}

function passageCounts({model, labels}) {
  const baselineLevels = model.effectiveLevels(modelOptions);
  const baselineProfiles = model.effectiveProfiles(modelOptions);
  const cueOnlyIds = new Set(nocturneCandidates(model.paragraphs).cues.map(({id}) => id));
  const {attempted, requests, bytes, overlapParagraphAttempts} = replayPlan(model, labels);
  const oracleLevels = model.effectiveLevels(modelOptions);
  const oracleProfiles = model.effectiveProfiles(modelOptions);
  const counts = {passages: 1, paragraphs: labels.length, referenceCueParagraphs: 0,
    cueOnlyEligibleParagraphs: cueOnlyIds.size, cueOnlyEligibleReferenceCues: 0,
    individuallyContextEligibleParagraphs: 0, individuallyContextEligibleReferenceCues: 0,
    plannedParagraphs: attempted.size, plannedReferenceCues: 0, protectedReferenceParagraphs: 0,
    unplannedReferenceCuesLocallyQuiet: 0, unplannedReferenceCuesLocallyExcluded: 0,
    unplannedReferenceCuesOtherIneligible: 0, unplannedReferenceCuesIndividuallyEligible: 0,
    protectedReferenceParagraphsPlanned: 0, oracleAcceptedReferenceCues: 0,
    localPositiveSuggestions: 0, oraclePositiveSuggestions: 0, oracleRecoveredSuggestions: 0,
    localCurrentCues: 0, oracleCurrentCues: 0, oracleRecoveredCurrentCues: 0,
    localNonreferenceSuggestions: 0, oracleNonreferenceSuggestions: 0,
    plannedRequests: requests, plannedSourceBytes: bytes, overlapParagraphAttempts};

  for (const [index, label] of labels.entries()) {
    const individuallyEligible = nocturneContextNeedsReview([model.paragraphs[index]], 0);
    counts.individuallyContextEligibleParagraphs += Number(individuallyEligible);
    if (protectedLabel(label)) {
      counts.protectedReferenceParagraphs++;
      counts.protectedReferenceParagraphsPlanned += Number(attempted.has(index));
    }
    const localPositive = baselineLevels[index] > 0, oraclePositive = oracleLevels[index] > 0;
    if (!label.cueEligible) {
      counts.localNonreferenceSuggestions += Number(localPositive);
      counts.oracleNonreferenceSuggestions += Number(oraclePositive);
      continue;
    }
    counts.referenceCueParagraphs++;
    counts.cueOnlyEligibleReferenceCues += Number(cueOnlyIds.has(index));
    counts.individuallyContextEligibleReferenceCues += Number(individuallyEligible);
    if (attempted.has(index)) counts.plannedReferenceCues++;
    else if (individuallyEligible) counts.unplannedReferenceCuesIndividuallyEligible++;
    else if (model.paragraphs[index].quiet) counts.unplannedReferenceCuesLocallyQuiet++;
    else if (model.paragraphs[index].cloudExcluded) counts.unplannedReferenceCuesLocallyExcluded++;
    else counts.unplannedReferenceCuesOtherIneligible++;
    counts.oracleAcceptedReferenceCues += Number(model.contextualAnnotation(index)?.eventKind === "current");
    counts.localPositiveSuggestions += Number(localPositive);
    counts.oraclePositiveSuggestions += Number(oraclePositive);
    counts.oracleRecoveredSuggestions += Number(oraclePositive && !localPositive);
    const localCue = localPositive && baselineProfiles[index].currentCue === true;
    const oracleCue = oraclePositive && oracleProfiles[index].currentCue === true;
    counts.localCurrentCues += Number(localCue);
    counts.oracleCurrentCues += Number(oracleCue);
    counts.oracleRecoveredCurrentCues += Number(oracleCue && !localCue);
  }
  return counts;
}

export async function evaluateContextPlanning(manifestPath) {
  const corpus = await loadCorpus(manifestPath, "validate-only");
  if (corpus.passages.some(({scope}) => scope !== "exact")) throw new Error("Exact references required.");
  const splits = {};
  for (const passage of corpus.passages) {
    const split = splits[passage.split] ??= {};
    for (const [name, count] of Object.entries(passageCounts(passage))) split[name] = (split[name] ?? 0) + count;
  }
  return {measurement: "offline-context-planner-reference-replay",
    sessionLimits: {requests: NOCTURNE_CONTEXT_SESSION_REQUESTS, sourceBytes: NOCTURNE_CONTEXT_SESSION_BYTES},
    works: corpus.works, authors: corpus.authors, splits};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/evaluate-context-planning.mjs MANIFEST");
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await evaluateContextPlanning(process.argv[2]), null, 2));
    } catch {
      console.error("The exact manifest or local context replay could not be validated.");
      process.exitCode = 1;
    }
  }
}
