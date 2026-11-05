// Shared bounds for pasted and uploaded UTF-8 text. No network or persistence.
export const MAX_TEXT_BYTES = 500_000;
export const MAX_TEXT_CHARACTERS = 500_000;
const LONG_PARAGRAPH = 1200;
const READING_SECTION_TARGET = 650;
const READING_SECTION_MINIMUM = 250;
const completeLine = /[.!?…]["'’”»)]*\s*$/u;

export function splitText(text) {
  if (typeof text !== "string") throw new TypeError("Text must be a string.");
  if (text.length > MAX_TEXT_CHARACTERS || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    throw new Error("Use text no larger than 500 KB (500,000 bytes).");
  }
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
}

function sentenceSections(text) {
  if (text.length < LONG_PARAGRAPH || typeof Intl.Segmenter !== "function") return [];
  const segmenter = new Intl.Segmenter("en", {granularity: "sentence"});
  const sections = [];
  let start = 0;
  for (const {index, segment} of segmenter.segment(text)) {
    if (index - start < READING_SECTION_MINIMUM || index + segment.length - start <= READING_SECTION_TARGET ||
        text.length - index < READING_SECTION_MINIMUM) continue;
    sections.push(text.slice(start, index).trim());
    start = index;
  }
  if (sections.length) sections.push(text.slice(start).trim());
  return sections;
}

// Clipboard and TXT sources can flatten paragraphs into lines or a single
// block. Repair only new input. Saved text still uses splitText directly so
// reading positions and corrections keep their original indices.
export function preparePlainStoryText(text) {
  const paragraphs = splitText(text);
  if (paragraphs.length !== 1) return text;
  const lines = paragraphs[0].split("\n");
  const sections = lines.length > 1 && lines.slice(0, -1).every(line => completeLine.test(line)) ?
    lines.map(line => line.trim()) : sentenceSections(paragraphs[0]);
  if (!sections.length) return text;
  const separated = sections.join("\n\n");
  // A valid input stays valid even when added separators would exceed the cap.
  return new TextEncoder().encode(separated).length <= MAX_TEXT_BYTES ? separated : text;
}

export class TextImporter {
  constructor() { this.generation = 0; }
  invalidate() { this.generation += 1; }

  async read(file) {
    const generation = ++this.generation;
    try {
      if (!file.name.toLowerCase().endsWith(".txt") || file.size > MAX_TEXT_BYTES) {
        throw new Error("Choose a .txt file no larger than 500 KB.");
      }
      const buffer = await file.arrayBuffer();
      if (generation !== this.generation) return null;
      let text;
      try { text = new TextDecoder("utf-8", {fatal: true}).decode(buffer); }
      catch { throw new Error("Choose a valid UTF-8 TXT file."); }
      splitText(text); // Apply the same bounds before handing data to the UI.
      return text;
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
  }
}
