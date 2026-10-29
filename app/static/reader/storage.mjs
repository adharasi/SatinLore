import {splitText} from "./import.mjs";
import {MAX_PARAGRAPHS, ANALYSIS_VERSION} from "./model.mjs";

export const LIBRARY_KEY = "satinlore.library.v1";
export const LIBRARY_LOCK = "satinlore-local-library";
export const MAX_SAVED_STORIES = 20;
export const MAX_LIBRARY_BYTES = 2_000_000;
const encoder = new TextEncoder();

export class StoryStorageError extends Error {
  constructor(code, message) { super(message); this.name = "StoryStorageError"; this.code = code; }
}
const invalid = () => new StoryStorageError("corrupt", "Some saved story data cannot be read. It has been kept unchanged. Delete all saved stories to reset this library.");
const isId = id => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id);

// Never hydrate playback/session state or trust saved automatic predictions.
export function validateStoryRecord(value, {stored = true} = {}) {
  if (!value || typeof value !== "object" || !isId(value.id) || typeof value.title !== "string" ||
      !value.title.trim() || value.title.length > 120 || typeof value.text !== "string") throw invalid();
  let paragraphs;
  try { paragraphs = splitText(value.text); } catch { throw invalid(); }
  if (!paragraphs.length || paragraphs.length > MAX_PARAGRAPHS || !Array.isArray(value.corrections) ||
      value.corrections.length !== paragraphs.length || value.corrections.some(level =>
        level !== null && (!Number.isInteger(level) || level < 0 || level > 20)) ||
      !Number.isInteger(value.position) || value.position < 0 || value.position >= paragraphs.length ||
      typeof value.analysisVersion !== "string" || !value.analysisVersion.length || value.analysisVersion.length > 40) throw invalid();
  if (stored && (!Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0)) throw invalid();
  return {id: value.id, title: value.title.trim(), text: value.text,
    corrections: [...value.corrections], position: value.position,
    analysisVersion: value.analysisVersion,
    ...(stored ? {updatedAt: value.updatedAt, revision: value.revision} : {})};
}

export function withBrowserLibraryLock(task, manager = globalThis.navigator?.locks) {
  if (!manager?.request) {
    return Promise.reject(new StoryStorageError("unsupported", "Saving needs a browser with Web Locks support. Your story is still available for this visit."));
  }
  return manager.request(LIBRARY_LOCK, task);
}

export class StoryStore {
  constructor({storage = () => globalThis.localStorage, withLock = withBrowserLibraryLock, now = () => Date.now()} = {}) {
    this.storageSource = storage;
    this.withLock = withLock;
    this.now = now;
  }

  _storage() {
    try {
      const storage = typeof this.storageSource === "function" ? this.storageSource() : this.storageSource;
      if (!storage || typeof storage.getItem !== "function") throw new Error();
      return storage;
    } catch { throw new StoryStorageError("unavailable", "Browser storage is unavailable. Your story is still available for this visit."); }
  }

  _read() {
    const storage = this._storage();
    let raw;
    try { raw = storage.getItem(LIBRARY_KEY); }
    catch { throw new StoryStorageError("unavailable", "Browser storage could not be read. Your story remains available for this visit."); }
    if (raw === null) return {stories: [], errors: []};
    if (typeof raw !== "string" || raw.length > MAX_LIBRARY_BYTES || encoder.encode(raw).length > MAX_LIBRARY_BYTES) throw invalid();
    let envelope;
    try { envelope = JSON.parse(raw); } catch { throw invalid(); }
    if (!envelope || envelope.schemaVersion !== 1 || !Array.isArray(envelope.stories) || envelope.stories.length > MAX_SAVED_STORIES) throw invalid();
    const stories = [], errors = [], seen = new Set();
    for (const value of envelope.stories) {
      try {
        const record = validateStoryRecord(value);
        if (seen.has(record.id)) throw invalid();
        seen.add(record.id); stories.push(record);
      } catch { errors.push(invalid().message); }
    }
    return {stories, errors};
  }

  async loadAll() {
    try { return {...this._read(), unavailable: false}; }
    catch (error) { return {stories: [], errors: [error.message], unavailable: error.code !== "corrupt"}; }
  }

  async _mutate(task) {
    try { return await this.withLock(task); }
    catch (error) {
      if (error instanceof StoryStorageError) throw error;
      throw new StoryStorageError("unavailable", "The browser could not update saved stories. Nothing is confirmed saved or deleted.");
    }
  }

  _write(stories) {
    const raw = JSON.stringify({schemaVersion: 1, stories});
    if (encoder.encode(raw).length > MAX_LIBRARY_BYTES) {
      throw new StoryStorageError("limit", "This local library has reached its 2 MB limit. Delete an older saved story or keep this story session only.");
    }
    try { this._storage().setItem(LIBRARY_KEY, raw); }
    catch (error) {
      if (error instanceof StoryStorageError) throw error;
      throw new StoryStorageError(error?.name === "QuotaExceededError" ? "quota" : "unavailable",
        "This story could not be saved. Browser storage may be full or unavailable; your in-memory story is unchanged.");
    }
  }

  async saveStory(value, {expectedRevision = null} = {}) {
    // Copy/validate at invocation: queued persistence must not capture later mutation.
    const record = validateStoryRecord({...value, analysisVersion: value.analysisVersion ?? ANALYSIS_VERSION}, {stored: false});
    return this._mutate(() => {
      const {stories, errors} = this._read();
      if (errors.length) throw invalid();
      const index = stories.findIndex(story => story.id === record.id);
      const existing = stories[index];
      if (existing ? expectedRevision !== existing.revision : expectedRevision !== null) {
        throw new StoryStorageError("conflict", "This saved story changed or was deleted in another tab. Reopen it before saving again.");
      }
      if (!existing && stories.length >= MAX_SAVED_STORIES) {
        throw new StoryStorageError("limit", "This browser can save up to 20 stories. Delete one or keep this story session only.");
      }
      const next = {...record, updatedAt: this.now(), revision: (existing?.revision ?? 0) + 1};
      validateStoryRecord(next);
      if (existing) stories[index] = next; else stories.push(next);
      this._write(stories);
      return next;
    });
  }

  async deleteStory(id, {expectedRevision = null} = {}) {
    if (!isId(id)) throw invalid();
    return this._mutate(() => {
      const {stories, errors} = this._read();
      if (errors.length) throw invalid();
      const existing = stories.find(story => story.id === id);
      if (expectedRevision !== null && existing && existing.revision !== expectedRevision) {
        throw new StoryStorageError("conflict", "This story changed in another tab. Reopen it before deleting it.");
      }
      if (!existing) return {deleted: false};
      this._write(stories.filter(story => story.id !== id));
      return {deleted: true};
    });
  }

  async deleteAll() {
    return this._mutate(() => {
      try { this._storage().removeItem(LIBRARY_KEY); }
      catch (error) {
        if (error instanceof StoryStorageError) throw error;
        throw new StoryStorageError("unavailable", "Saved stories could not be deleted. Browser storage is unavailable.");
      }
      return {deleted: true};
    });
  }
}
