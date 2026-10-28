// Shared bounds for pasted and uploaded UTF-8 text. No network or persistence.
export const MAX_TEXT_BYTES = 500_000;
export const MAX_TEXT_CHARACTERS = 500_000;

export function splitText(text) {
  if (typeof text !== "string") throw new TypeError("Text must be a string.");
  if (text.length > MAX_TEXT_CHARACTERS || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    throw new Error("Use text no larger than 500 KB (500,000 bytes).");
  }
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
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
      const text = new TextDecoder("utf-8", {fatal: true}).decode(buffer);
      splitText(text); // Apply the same bounds before handing data to the UI.
      return text;
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
  }
}
