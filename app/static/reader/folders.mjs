import {createStoryId} from "./identity.mjs";

export const MAX_FOLDERS = 30;
export const MAX_FOLDER_NAME = 60;
export class FolderStorageError extends Error {
  constructor(code, message) { super(message); this.name = "FolderStorageError"; this.code = code; }
}
const fail = (code, message) => new FolderStorageError(code, message);
const corrupt = () => fail("corrupt", "Saved folders could not be read. Existing browser data has been kept unchanged.");
export const isFolderId = value => typeof value === "string" && /^folder-[A-Za-z0-9][A-Za-z0-9_-]{0,72}$/.test(value);
const key = value => value.normalize("NFKC").toLocaleLowerCase("en");
export function folderName(value) {
  if (typeof value !== "string") throw fail("invalid", "Enter a folder name of up to 60 characters.");
  const name = value.trim().replace(/\s+/gu, " ");
  if (!name || name.length > MAX_FOLDER_NAME || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw fail("invalid", "Enter a folder name of up to 60 characters.");
  }
  return name;
}
export function validateFolderCatalog(value = []) {
  if (!Array.isArray(value) || value.length > MAX_FOLDERS) throw corrupt();
  const ids = new Set(), names = new Set();
  return value.map(folder => {
    if (!folder || typeof folder !== "object" || Array.isArray(folder) ||
        Object.keys(folder).length !== 3 || Object.keys(folder).some(field => !["id", "name", "revision"].includes(field)) ||
        !isFolderId(folder.id) || !Number.isSafeInteger(folder.revision) || folder.revision < 1) throw corrupt();
    let name;
    try { name = folderName(folder.name); } catch { throw corrupt(); }
    if (name !== folder.name || ids.has(folder.id) || names.has(key(name))) throw corrupt();
    ids.add(folder.id); names.add(key(name));
    return {id: folder.id, name, revision: folder.revision};
  });
}
export function selectFolderStories(stories, selected = "all") {
  if (selected === "all") return [...stories];
  if (selected === "unfiled") return stories.filter(story => !story.folderId);
  return stories.filter(story => story.folderId === selected);
}

/** Folders share the story store's envelope and lock, so operations never partially update two keys.
 * Folder names are retained by explicit Create/Rename actions. Unsaved story membership stays in
 * the workspace; it is retained only when that story is explicitly saved through StoryStore.
 */
export class FolderStore {
  constructor({store, createId = createStoryId} = {}) {
    if (!store?._read || !store?._write || !store?._mutate) throw new Error("A story store is required for folders.");
    this.store = store; this.createId = createId;
  }
  async loadAll() {
    try {
      const {folders, errors} = this.store._read();
      return {folders, errors: [...errors], unavailable: false};
    } catch (error) {
      return {folders: [], errors: [error.message], unavailable: error.code !== "corrupt"};
    }
  }
  _read() {
    const value = this.store._read();
    if (value.errors.length) throw corrupt();
    return value;
  }
  _folder(folders, id, expectedRevision) {
    const folder = folders.find(item => item.id === id);
    if (!folder || expectedRevision !== null && expectedRevision !== folder.revision) {
      throw fail("conflict", "This folder changed or was deleted in another tab. Reload before changing it.");
    }
    return folder;
  }
  async create(value) {
    const name = folderName(value);
    const id = `folder-${this.createId()}`;
    if (!isFolderId(id)) throw fail("invalid", "A folder could not be created. Try an up-to-date browser.");
    return this.store._mutate(() => {
      const {stories, folders} = this._read();
      if (folders.length >= MAX_FOLDERS) throw fail("limit", "This browser can keep up to 30 folders.");
      if (folders.some(item => key(item.name) === key(name))) throw fail("duplicate", "A folder with this name already exists.");
      if (folders.some(item => item.id === id)) throw fail("conflict", "A folder could not be created. Try again.");
      const next = {id, name, revision: 1};
      this.store._write(stories, [...folders, next]);
      return next;
    });
  }
  async rename(id, value, {expectedRevision = null} = {}) {
    const name = folderName(value);
    return this.store._mutate(() => {
      const {stories, folders} = this._read();
      const current = this._folder(folders, id, expectedRevision);
      if (folders.some(item => item.id !== id && key(item.name) === key(name))) throw fail("duplicate", "A folder with this name already exists.");
      const next = {...current, name, revision: current.revision + 1};
      this.store._write(stories, folders.map(item => item.id === id ? next : item));
      return next;
    });
  }
  async delete(id, {expectedRevision = null} = {}) {
    return this.store._mutate(() => {
      const {stories, folders} = this._read();
      this._folder(folders, id, expectedRevision);
      const changes = [];
      const remaining = stories.map(story => {
        if (story.folderId !== id) return story;
        const {folderId, ...record} = story;
        const next = {...record, revision: record.revision + 1, updatedAt: this.store.now()};
        changes.push({id: next.id, revision: next.revision, updatedAt: next.updatedAt, folderId: null});
        return next;
      });
      this.store._write(remaining, folders.filter(folder => folder.id !== id));
      return {deleted: true, stories: changes};
    });
  }
}
