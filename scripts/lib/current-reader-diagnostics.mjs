import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {ReaderModel, ANALYSIS_VERSION} from "../../app/static/reader/model.mjs";
import {scoreParagraph} from "../../app/static/reader/scoring.mjs";
import {buildSceneUnits} from "../../app/static/reader/scene-map.mjs";
import {nocturneCandidates, nocturneContextCandidates, nocturneContextNeedsReview,
  nocturneContextVisitBoundaries, nocturneContextVisitAllowance,
  NOCTURNE_CONTEXT_SESSION_BYTES, NOCTURNE_CONTEXT_SESSION_REQUESTS} from "../../app/static/reader/nocturne.mjs";
import {MAX_CONTEXT_BYTES, MAX_PARAGRAPH_BYTES} from "../../app/static/reader/nocturne-context-contract.mjs";

const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
export const CURRENT_READER_REFERENCE_VERSION = "2026-11-07-full-corpus-v7";
const count = values => Object.fromEntries([...new Set(values)].sort().map(value =>
  [value, values.filter(item => item === value).length]));
const phases = {quiet: "quiet", build: "build", sustain: "sustain", peak: "accent", recover: "recover"};
const safeId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/u.test(value);
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const bytes = value => Buffer.byteLength(value, "utf8");

// These are observed runtime messages, not a second content classifier.
function localReason(paragraph) {
  if (paragraph.reason === "Sensitive wording; left at zero for review.") return "sensitive-wording";
  if (paragraph.reason === "Rest or scene boundary; left at zero.") return "boundary-or-rest";
  if (paragraph.reason === "The described movement stopped; left at zero.") return "movement-ended";
  if (paragraph.reason === "Context is uncertain or speculative; left at zero.") return "uncertain-or-speculative";
  if (paragraph.reason === "No matching cue pair; left at zero.") return "no-keyword-match";
  if (paragraph.reason === "Contact wording was uncertain or speculative.") return "uncertain-contact-wording";
  if (paragraph.reason === "Matched a described affectionate action.") return "affectionate-action-match";
  if (paragraph.reason === "Matched a contact and context cue in the same clause.") return "contact-context-match";
  return "scene-grouping-rule";
}

function suppression(paragraph) {
  const reason = localReason(paragraph);
  if (reason === "sensitive-wording") return "safety-filtered";
  if (["boundary-or-rest", "movement-ended"].includes(reason)) return "boundary-suppressed";
  if (paragraph.quiet || paragraph.cloudExcluded) return "application-suppressed";
  return null;
}

// Activation is only a projection of the reader's paragraph suggestion.
// Loom does not emit exact-unit depiction/frame/evidence/typed transitions.
function projectedLabel(positive, phase) {
  return {depiction: "unknown", frame: "uncertain", activation: positive ? "cue" : "context",
    phase: phases[phase] ?? "unknown", transition: "unknown", evidenceIds: []};
}

export function traceNocturneContextVisit(paragraphs, {start = 0, positions, capped = true, progressive = false} = {}) {
  const attempted = new Set(), windows = [];
  const state = {boundaries: capped && progressive ? nocturneContextVisitBoundaries(paragraphs, start) : [], requests: 0, bytesAttempted: 0};
  function visit(position, manual = false) {
    const {requests, bytes} = capped ? nocturneContextVisitAllowance(position, state) : {requests: Infinity, bytes: Infinity};
    if (requests <= 0 || bytes <= 0 ||
        !manual && !nocturneContextNeedsReview(paragraphs, position, {attempted, maxBytes: bytes})) return;
    const window = nocturneContextCandidates(paragraphs, position, {attempted, maxBytes: bytes});
    if (!window.paragraphs.length) return;
    windows.push({position, paragraphIds: window.paragraphs.map(row => row.id), newIds: [...window.newIds],
      sourceBytes: window.sourceBytes, excluded: window.excluded, limited: window.limited});
    state.requests++;
    state.bytesAttempted += window.sourceBytes;
    for (const id of window.newIds) attempted.add(id);
  }
  visit(start, true);
  if (positions) for (const position of positions) visit(position);
  else for (let position = start; position < paragraphs.length; position++) visit(position);
  return {attempted, windows, sourceBytes: state.bytesAttempted, boundaries: state.boundaries};
}

function planningExclusion(paragraph, index, capped, uncapped) {
  if (capped.attempted.has(index)) return null;
  if (paragraph.quiet || paragraph.cloudExcluded) return suppression(paragraph) ?? "application-suppressed";
  if (bytes(paragraph.text) > MAX_PARAGRAPH_BYTES) return "paragraph-byte-limit";
  if (uncapped.attempted.has(index)) {
    if (index < capped.boundaries.at(-1)) return "session-progress-allocation";
    if (capped.windows.length >= NOCTURNE_CONTEXT_SESSION_REQUESTS) return "session-request-limit";
    return "session-source-byte-limit";
  }
  return "planner-window-or-body-limit";
}

function traceEnvelope({runId, datasetId, referenceVersion}, kind) {
  return {schema: 1, runId: `${runId}:${kind}`, datasetId, referenceVersion,
    predictionVersion: `${ANALYSIS_VERSION}:${kind}:offline-trace-v1`, measurement: "offline-current-reader",
    externalCalls: 0, sourceTextIncluded: false, granularity: "paragraph-projected-to-exact-source-units",
    supportedPredictionFields: kind === "loom" ? ["activation", "phase"] : [],
    scopeInterpretation: "Same paragraph projection in both scopes; no causal or retrospective semantic classifier is implied.",
    phaseProjection: {peak: "accent"}, works: [], requests: []};
}

/** Trace the real local rules and real Nocturne selection without any API calls. */
export function traceCurrentReaderCorpus(pack, paragraphPack,
    {runId = "current-reader-corpus-v1", datasetId = "full-corpus-v7",
      referenceVersion = CURRENT_READER_REFERENCE_VERSION} = {}) {
  assert(pack?.schema === 1 && paragraphPack?.schema === 1 && Array.isArray(pack.works) &&
    Array.isArray(paragraphPack.works), "Invalid private corpus inputs.");
  assert(safeId(runId) && safeId(datasetId) && safeId(referenceVersion), "Use opaque diagnostic identifiers.");
  const sidecars = new Map(paragraphPack.works.map(work => [work.id, work]));
  assert(sidecars.size === paragraphPack.works.length && sidecars.size === pack.works.length,
    "Corpus sidecar work set differs.");
  const options = {runId, datasetId, referenceVersion};
  const loom = traceEnvelope(options, "loom"), context = traceEnvelope(options, "nocturne-context-planner"),
    cue = traceEnvelope(options, "nocturne-cue-planner");
  for (const trace of [loom, context, cue]) trace.sourcePackReferenceVersion = pack.referenceVersion;
  const workIds = new Set(), summaryRows = [];
  for (const source of pack.works) {
    assert(safeId(source.id) && !workIds.has(source.id) && sha(source.sourceSha256) && sha(source.indexSha256),
      "Invalid corpus source pins.");
    workIds.add(source.id);
    const sidecar = sidecars.get(source.id);
    assert(sidecar && source.sourceSha256 === sidecar.sourceSha256 && source.indexSha256 === sidecar.indexSha256 &&
      Array.isArray(sidecar.paragraphs), "Corpus paragraph sidecar pin mismatch.");
    const raw = sidecar.paragraphs.map((row, index) => {
      assert(row.id === index && typeof row.text === "string" && hash(row.text) === row.sha256,
        "Corpus paragraph hash mismatch.");
      return row.text;
    });
    const text = raw.join("\n\n");
    assert(hash(text) === (sidecar.readerEditionSha256 ?? sidecar.canonicalEditionSha256),
      "Canonical reader edition hash mismatch.");
    const model = new ReaderModel();
    const paragraphs = model.load(text, {documentId: source.id});
    assert(paragraphs.length === raw.length && paragraphs.every((row, id) => row.text === raw[id]),
      "Reader changed canonical paragraphs.");
    const actual = buildSceneUnits(paragraphs);
    assert(actual.length === source.units.length, "Reader source-unit count changed.");
    for (const [index, unit] of actual.entries()) {
      const pin = source.units[index];
      assert(["id", "paragraph", "start", "end", "text", "structuralBoundary"].every(key => pin[key] === unit[key]),
        "Reader source-unit identity changed.");
    }
    const levels = model.effectiveLevels();
    const rawScores = raw.map(scoreParagraph);
    const capped = traceNocturneContextVisit(paragraphs);
    const uncapped = traceNocturneContextVisit(paragraphs, {capped: false});
    const cues = nocturneCandidates(paragraphs), cueIds = new Set(cues.cues.map(row => row.id));
    const requestIdsByParagraph = new Map();
    for (const [index, window] of capped.windows.entries()) {
      const id = `context:${source.id}:${index}`;
      const newParagraphs = new Set(window.newIds);
      const inputParagraphs = new Set(window.paragraphIds);
      context.requests.push({id, workId: source.id, windowId: `window-${index}`, stage: "planning", status: "not-submitted",
        failureCode: "not-submitted", targetIds: actual.filter(row => !row.structuralBoundary && newParagraphs.has(row.paragraph)).map(row => row.id),
        contextIds: actual.filter(row => !row.structuralBoundary && inputParagraphs.has(row.paragraph) && !newParagraphs.has(row.paragraph)).map(row => row.id)});
      for (const paragraph of window.newIds) requestIdsByParagraph.set(paragraph, [id]);
    }
    const cueRequestId = `cue:${source.id}:0`;
    if (cueIds.size) cue.requests.push({id: cueRequestId, workId: source.id, stage: "planning", status: "not-submitted",
      failureCode: "not-submitted", targetIds: actual.filter(row => !row.structuralBoundary && cueIds.has(row.paragraph)).map(row => row.id), contextIds: []});
    const headers = {id: source.id, sourceSha256: source.sourceSha256, indexSha256: source.indexSha256,
      canonicalInputSha256: sidecar.canonicalEditionSha256, readerEditionSha256: hash(text), family: source.family};
    const loomWork = {...headers, units: []}, contextWork = {...headers, units: []}, cueWork = {...headers, units: []};
    const exclusions = [];
    for (const unit of actual.filter(row => !row.structuralBoundary)) {
      const paragraph = paragraphs[unit.paragraph], rawScore = rawScores[unit.paragraph];
      const common = {id: unit.id, paragraph: unit.paragraph, unitSha256: hash(unit.text)};
      const applied = projectedLabel(levels[unit.paragraph] > 0, paragraph.phase);
      const proposed = projectedLabel(rawScore.level > 0, "unknown");
      const failureCode = levels[unit.paragraph] > 0 ? null : suppression(paragraph) ??
        (rawScore.level > 0 ? "application-suppressed" : "model-negative");
      loomWork.units.push({...common, status: "classified", proposed: {causal: proposed, retrospective: proposed},
        applied: {causal: applied, retrospective: applied}, requestIds: [],
        pipeline: {admitted: true, planned: true, validated: true, applied: true},
        ...(failureCode ? {failureCode} : {}), local: {level: levels[unit.paragraph], rawLevel: rawScore.level,
          phase: paragraph.phase, reasonCode: localReason(paragraph), quiet: paragraph.quiet, cloudExcluded: paragraph.cloudExcluded,
          currentCue: paragraph.currentCue === true, localization: "paragraph-projection"}});
      const selected = capped.attempted.has(unit.paragraph);
      const exclusion = planningExclusion(paragraph, unit.paragraph, capped, uncapped);
      if (exclusion) exclusions.push(exclusion);
      const budgetDeferred = ["session-request-limit", "session-source-byte-limit", "session-progress-allocation"].includes(exclusion);
      contextWork.units.push({...common, status: selected ? "not-submitted" : budgetDeferred ? "budget-deferred" : "not-planned",
        proposed: null, applied: null, requestIds: requestIdsByParagraph.get(unit.paragraph) ?? [],
        pipeline: {admitted: !paragraph.quiet && !paragraph.cloudExcluded, planned: selected, submitted: false, returned: false,
          validated: false, applied: false}, failureCode: selected ? "not-submitted" : budgetDeferred ? "budget-deferred" :
          suppression(paragraph) ?? "not-planned", planning: {selected, uncappedSelected: uncapped.attempted.has(unit.paragraph),
          exclusion, paragraphBytes: bytes(paragraph.text)}});
      const cueSelected = cueIds.has(unit.paragraph);
      cueWork.units.push({...common, status: cueSelected ? "not-submitted" : "not-planned", proposed: null, applied: null,
        requestIds: cueSelected ? [cueRequestId] : [], pipeline: {admitted: !paragraph.cloudExcluded,
          planned: cueSelected, submitted: false, returned: false, validated: false, applied: false},
        failureCode: cueSelected ? "not-submitted" : suppression(paragraph) ?? "not-planned",
        planning: {selected: cueSelected, eligiblePhase: ["sustain", "peak"].includes(paragraph.phase),
          paragraphSelectedCount: cueIds.size, paragraphLimit: 16}});
    }
    loom.works.push(loomWork); context.works.push(contextWork); cue.works.push(cueWork);
    summaryRows.push({...headers, paragraphs: paragraphs.length, indexedUnits: actual.length, targets: loomWork.units.length,
      structuralUnits: actual.filter(row => row.structuralBoundary).length,
      paragraphPositive: levels.filter(level => level > 0).length,
      projectedPositiveTargets: loomWork.units.filter(row => row.applied.causal.activation === "cue").length,
      quietParagraphs: paragraphs.filter(row => row.quiet).length,
      cloudExcludedParagraphs: paragraphs.filter(row => row.cloudExcluded).length,
      contextPlanning: {requests: capped.windows.length, sourceBytes: capped.sourceBytes,
        progressionBoundaries: capped.boundaries,
        selectedParagraphs: capped.attempted.size, selectedTargets: contextWork.units.filter(row => row.pipeline.planned).length,
        uncappedRequests: uncapped.windows.length, uncappedSelectedParagraphs: uncapped.attempted.size,
        excludedTargetReasons: count(exclusions)}, cuePlanning: {selectedParagraphs: cueIds.size, limitedParagraphs: cues.limited,
        selectedTargets: cueWork.units.filter(row => row.pipeline.planned).length}});
  }
  assert(workIds.size === sidecars.size, "Corpus work IDs differ.");
  const summary = {schema: 1, measurement: "offline-current-reader-not-provider-recognition", externalCalls: 0,
    analysisVersion: ANALYSIS_VERSION, works: summaryRows.length, indexedUnits: summaryRows.reduce((n, row) => n + row.indexedUnits, 0),
    targets: summaryRows.reduce((n, row) => n + row.targets, 0),
    structuralUnits: summaryRows.reduce((n, row) => n + row.structuralUnits, 0),
    projectedPositiveTargets: summaryRows.reduce((n, row) => n + row.projectedPositiveTargets, 0),
    contextSelectedTargets: summaryRows.reduce((n, row) => n + row.contextPlanning.selectedTargets, 0),
    cueSelectedTargets: summaryRows.reduce((n, row) => n + row.cuePlanning.selectedTargets, 0),
    contextLimits: {sessionRequests: NOCTURNE_CONTEXT_SESSION_REQUESTS, sessionSourceBytes: NOCTURNE_CONTEXT_SESSION_BYTES,
      requestSourceBytes: MAX_CONTEXT_BYTES, paragraphBytes: MAX_PARAGRAPH_BYTES},
    qualifications: ["actual-local-rules-and-planner-imports", "exact-canonical-source-and-unit-identity-verified",
      "loom-positive-means-paragraph-suggestion-above-zero", "sentence-rows-are-paragraph-projections",
      "no-exact-unit-depiction-frame-evidence-or-typed-transition-predictions", "no-provider-responses-simulated",
      "context-planning-assumes-manual-enable-at-opening-and-complete-monotonic-paragraph-traversal",
      "planner-output-measures-submission-opportunity-only", "no-device-or-reader-timing-qualification"], rows: summaryRows};
  return {loom, context, cue, summary};
}
