import {splitText} from "./import.mjs";
import {groupScenes, scoreParagraph, SUGGESTION_LEVELS} from "./scoring.mjs";
import {LEGACY_NOCTURNE_CONTEXT_VERSION, MIN_CONTEXT_CONFIDENCE, NOCTURNE_CONTEXT_VERSION, validContextAnnotation} from "./nocturne-context-contract.mjs";

let sequence = 0;
export const MAX_PARAGRAPHS = 2000;
export const ANALYSIS_VERSION = "scene-rules-v6.4";
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
const validScore = score => score && Number.isInteger(score.band) && score.band >= 0 &&
  score.band < SUGGESTION_LEVELS.length && score.level === SUGGESTION_LEVELS[score.band] &&
  typeof score.reason === "string" && score.reason.length <= 200;
const contextLevels = Object.freeze({neutral: 0, romance: 1, flirting: 1, tension: 1, intimacy: 2, explicit: 3, aftermath: 1});
// Noncurrent context is review metadata. Playback falls back to local analysis.
function playbackAnnotation(annotation) {
  if (!annotation || ![undefined, "current", "neutral"].includes(annotation.eventKind)) return null;
  return annotation;
}

function applySceneSuggestions(paragraphs) {
  // A correction controls playback at its paragraph without rewriting the analysis.
  const scenes = groupScenes(paragraphs.map(paragraph => ({...paragraph, override: null})));
  if (scenes.length !== paragraphs.length || !scenes.every(validScore)) throw new Error("Invalid scene analysis.");
  for (let index = 0; index < scenes.length; index++) {
    const {band, level, reason, rhythm, quiet, sceneId, phase, advisory, movements, endedMovements, cloudExcluded, shape, currentCue, capacityReview} = scenes[index];
    Object.assign(paragraphs[index], {band, suggestedLevel: level, reason, rhythm, quiet, sceneId, phase, advisory, movements, endedMovements, cloudExcluded, shape,
      currentCue: currentCue === true, capacityReview: capacityReview === true});
  }
}

// The model is memory-only. StoryStore persists an explicit, separate allowlist.
export class ReaderModel {
  constructor() {
    this.documentId = null;
    this.paragraphs = [];
    this.analysisStatus = "pending";
    this.analysisVersion = ANALYSIS_VERSION;
    this.analysisGeneration = 0;
    this.nocturneLabels = new Map();
    this.nocturneContext = new Map();
  }

  load(text, {deferAnalysis = false, documentId = null} = {}) {
    const sections = splitText(text);
    if (!sections.length) throw new Error("Add some text first.");
    if (sections.length > MAX_PARAGRAPHS) throw new Error("Use up to 2,000 paragraphs in one text.");
    if (documentId !== null && (typeof documentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(documentId))) {
      throw new TypeError("Use a valid local story identifier.");
    }
    const id = documentId ?? `story-${++sequence}`;
    const paragraphs = sections.map((value, index) => {
      const score = deferAnalysis ? {level: 0, band: 0, reason: "Analysis pending."} : scoreParagraph(value);
      if (!deferAnalysis && !validScore(score)) throw new Error("The local analysis returned an invalid result.");
      return {id: `${id}-p${index + 1}`, text: value, suggestedLevel: score.level,
        band: score.band, reason: score.reason, override: null, analysed: !deferAnalysis};
    });
    if (!deferAnalysis) applySceneSuggestions(paragraphs);
    // Validate first: failed replacement must leave the previous model intact.
    ++this.analysisGeneration;
    this.documentId = id;
    this.paragraphs = paragraphs;
    this.nocturneLabels.clear();
    this.nocturneContext.clear();
    this.analysisStatus = deferAnalysis ? "pending" : "ready";
    this.analysisVersion = ANALYSIS_VERSION;
    return this.paragraphs;
  }

  get analysisReady() {
    return this.analysisStatus === "ready" && this.paragraphs.length > 0 && this.paragraphs.every(paragraph =>
      paragraph.analysed && validScore({band: paragraph.band, level: paragraph.suggestedLevel, reason: paragraph.reason}));
  }

  _zeroSuggestions(reason) {
    this.nocturneLabels.clear();
    this.nocturneContext.clear();
    for (const paragraph of this.paragraphs) {
      paragraph.suggestedLevel = 0;
      paragraph.band = 0;
      paragraph.reason = reason;
      paragraph.analysed = false;
      paragraph.rhythm = "steady";
      paragraph.quiet = false;
      paragraph.sceneId = null;
      paragraph.phase = "quiet";
      paragraph.advisory = null;
      paragraph.movements = [];
      paragraph.endedMovements = [];
      paragraph.cloudExcluded = false;
      paragraph.capacityReview = false;
      paragraph.shape = "unspecified";
      paragraph.currentCue = false;
    }
  }

  cancelAnalysis() {
    ++this.analysisGeneration;
    if (this.analysisStatus === "analysing") {
      this.analysisStatus = "pending";
      this._zeroSuggestions("Analysis paused. Retry when ready.");
    }
  }

  async analyse({onProgress = () => {}, signal, batchSize = 32, yieldTask = nextTask, score = scoreParagraph} = {}) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 2000) throw new RangeError("Use a bounded analysis batch.");
    if (!this.paragraphs.length) return false;
    const generation = ++this.analysisGeneration;
    const documentId = this.documentId;
    const current = () => generation === this.analysisGeneration && documentId === this.documentId;
    const cancelled = () => {
      if (!current()) return true;
      if (signal?.aborted) { this.cancelAnalysis(); return true; }
      return false;
    };
    this.analysisStatus = "analysing";
    this.analysisVersion = ANALYSIS_VERSION;
    this._zeroSuggestions("Analysing on this browser.");
    try {
      onProgress(this);
      // Yield before scoring so the continuous reading canvas can paint first.
      await yieldTask();
      for (let start = 0; start < this.paragraphs.length; start += batchSize) {
        if (cancelled()) return false;
        const end = Math.min(start + batchSize, this.paragraphs.length);
        for (let index = start; index < end; index++) {
          const result = score(this.paragraphs[index].text);
          if (!validScore(result)) throw new Error("Invalid analysis result.");
          // Deliberate corrections stay separate and survive reanalysis.
          Object.assign(this.paragraphs[index], {suggestedLevel: result.level, band: result.band,
            reason: result.reason, analysed: true});
        }
        if (cancelled()) return false;
        onProgress(this);
        if (end < this.paragraphs.length) await yieldTask();
      }
      if (cancelled()) return false;
      applySceneSuggestions(this.paragraphs);
      this.analysisStatus = "ready";
      onProgress(this);
      return current() && this.analysisReady;
    } catch {
      if (!current()) return false;
      this.analysisStatus = "error";
      this._zeroSuggestions("Analysis unavailable. Read silently or retry.");
      // No raw exception or story content leaves this model.
      return false;
    }
  }

  clear() {
    ++this.analysisGeneration;
    this.documentId = null;
    this.paragraphs = [];
    this.nocturneLabels.clear();
    this.nocturneContext.clear();
    this.analysisStatus = "pending";
  }

  paragraph(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.paragraphs.length) {
      throw new RangeError("Choose a paragraph from the current text.");
    }
    return this.paragraphs[index];
  }

  setOverride(index, level) {
    if (!Number.isInteger(level) || level < 0 || level > 20) {
      throw new RangeError("Choose a whole-number level between 0 and 20.");
    }
    this.paragraph(index).override = level;
  }

  resetOverride(index) { this.paragraph(index).override = null; }

  contextualAnnotation(index) {
    const paragraph = this.paragraph(index), annotation = this.nocturneContext.get(index);
    // Provider annotations never override a local hard boundary, content
    // exclusion, missing analysis, or explicit correction.
    const version = annotation?.eventKind === undefined ? LEGACY_NOCTURNE_CONTEXT_VERSION : NOCTURNE_CONTEXT_VERSION;
    if (!paragraph.analysed || paragraph.quiet || paragraph.cloudExcluded || paragraph.override !== null ||
        annotation?.id !== index || !validContextAnnotation(annotation, version) ||
        annotation.confidence < MIN_CONTEXT_CONFIDENCE || !Object.hasOwn(contextLevels, annotation.category)) return null;
    return annotation;
  }

  suggestedLevel(index, {nocturne = false} = {}) {
    const paragraph = this.paragraph(index);
    const annotation = nocturne ? playbackAnnotation(this.contextualAnnotation(index)) : null;
    return annotation ? contextLevels[annotation.category] : paragraph.suggestedLevel;
  }

  effectiveProfile(index, {nocturne = false, peakPattern, edging = false, edgePattern = "auto"} = {}) {
    const original = this.paragraph(index);
    const annotation = nocturne ? playbackAnnotation(this.contextualAnnotation(index)) : null;
    const {rhythm, quiet, phase, sceneId, shape, override, movements = [], endedMovements = []} = annotation ?
      {...original, phase: annotation.phase, shape: annotation.shape, sceneId: original.sceneId ?? MAX_PARAGRAPHS + index + 1} : original;
    const currentCue = original.analysed && !original.cloudExcluded && !quiet && override === null &&
      ["build", "sustain", "peak"].includes(phase) &&
      (annotation ? annotation.eventKind === "current" : original.currentCue === true);
    const peak = nocturne && !quiet && phase === "peak" && peakPattern !== undefined;
    const localPeak = peak && peakPattern === "auto" && (shape === "accented" || shape === "alternating") ? "accents" : undefined;
    const pattern = nocturne ? (annotation && annotation.phase !== original.phase ? undefined : this.nocturneLabels.get(index)) ?? localPeak : undefined;
    const buildAndEase = nocturne && !quiet && (phase === "build" || phase === "sustain") &&
      (edgePattern === "ease" || (edgePattern === "auto" && edging));
    return {rhythm, quiet, phase, sceneId, manual: override !== null, movements: [...movements], endedMovements: [...endedMovements],
      ...(currentCue ? {currentCue: true} : {}),
      ...(currentCue && annotation && original.sceneId == null ? {simulatorSceneId: sceneId} : {}),
      ...(!quiet && ["build", "sustain"].includes(phase) && shape && shape !== "unspecified" ? {shape} : {}),
      ...(pattern === undefined ? {} : {pattern}),
      ...(peak ? peakPattern === "auto" ? {automaticPeak: true} : {peakPreset: peakPattern} : {}),
      ...(buildAndEase ? {edging: true} : {})};
  }

  effectiveProfiles(options) {
    if (!this.analysisReady) return undefined;
    let contextSceneId;
    return this.paragraphs.map((_, index) => {
      const profile = this.effectiveProfile(index, options);
      if (profile.simulatorSceneId === undefined) contextSceneId = undefined;
      else {
        // Adjacent contextual cues share a simulator scene. The renderer still
        // resets its clock when their phase, shape or movement changes.
        contextSceneId ??= profile.simulatorSceneId;
        profile.simulatorSceneId = contextSceneId;
      }
      return profile;
    });
  }

  effectiveLevels(options = {}) {
    if (!this.analysisReady) return this.paragraphs.map(() => 0);
    return this.paragraphs.map((paragraph, index) => paragraph.capacityReview ? 0 : paragraph.override ?? this.suggestedLevel(index, options));
  }
}
