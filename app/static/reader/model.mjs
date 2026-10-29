import {splitText} from "./import.mjs";
import {scoreParagraph, SUGGESTION_LEVELS} from "./scoring.mjs";

let sequence = 0;
export const MAX_PARAGRAPHS = 2000;
export const ANALYSIS_VERSION = "rules-v1";
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
const validScore = score => score && Number.isInteger(score.band) && score.band >= 0 &&
  score.band < SUGGESTION_LEVELS.length && score.level === SUGGESTION_LEVELS[score.band] &&
  typeof score.reason === "string" && score.reason.length <= 200;

// The model is memory-only. StoryStore persists an explicit, separate allowlist.
export class ReaderModel {
  constructor() {
    this.documentId = null;
    this.paragraphs = [];
    this.analysisStatus = "pending";
    this.analysisVersion = ANALYSIS_VERSION;
    this.analysisGeneration = 0;
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
    // Validate first: failed replacement must leave the previous model intact.
    ++this.analysisGeneration;
    this.documentId = id;
    this.paragraphs = paragraphs;
    this.analysisStatus = deferAnalysis ? "pending" : "ready";
    this.analysisVersion = ANALYSIS_VERSION;
    return this.paragraphs;
  }

  get analysisReady() {
    return this.analysisStatus === "ready" && this.paragraphs.length > 0 && this.paragraphs.every(paragraph =>
      paragraph.analysed && validScore({band: paragraph.band, level: paragraph.suggestedLevel, reason: paragraph.reason}));
  }

  _zeroSuggestions(reason) {
    for (const paragraph of this.paragraphs) {
      paragraph.suggestedLevel = 0;
      paragraph.band = 0;
      paragraph.reason = reason;
      paragraph.analysed = false;
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

  effectiveLevels() {
    if (!this.analysisReady) return this.paragraphs.map(() => 0);
    return this.paragraphs.map(paragraph => paragraph.override ?? paragraph.suggestedLevel);
  }
}
