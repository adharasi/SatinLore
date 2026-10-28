import {splitText} from "./import.mjs";
import {scoreParagraph} from "./scoring.mjs";

let sequence = 0;
export const MAX_PARAGRAPHS = 2000;

// Story text and corrections exist only in this object, never storage or requests.
export class ReaderModel {
  constructor() {
    this.documentId = null;
    this.paragraphs = [];
  }

  load(text) {
    const sections = splitText(text);
    if (!sections.length) throw new Error("Add some text first.");
    if (sections.length > MAX_PARAGRAPHS) throw new Error("Use up to 2,000 paragraphs in one text.");
    const documentId = `story-${++sequence}`;
    const paragraphs = sections.map((value, index) => {
      const score = scoreParagraph(value);
      return {id: `${documentId}-p${index + 1}`, text: value,
        suggestedLevel: score.level, band: score.band, reason: score.reason, override: null};
    });
    // Invalid imports must not partially replace a loaded document.
    this.documentId = documentId;
    this.paragraphs = paragraphs;
    return this.paragraphs;
  }

  clear() {
    this.documentId = null;
    this.paragraphs = [];
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

  resetOverride(index) {
    this.paragraph(index).override = null;
  }

  effectiveLevels() {
    return this.paragraphs.map(paragraph => paragraph.override ?? paragraph.suggestedLevel);
  }
}
