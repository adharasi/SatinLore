import {createStoryId} from "./identity.mjs";
import {validateStoryRecord, MAX_SAVED_STORIES, MAX_LIBRARY_BYTES} from "./storage.mjs";

export const BACKUP_FORMAT = "satinlore-story-backup";
const encoder = new TextEncoder();
const recordKeys = ["title", "text", "corrections", "position", "analysisVersion"];
const portableKeys = [...recordKeys, "description", "favorite"];
const fail = () => new Error("This backup could not be opened. Use a SatinLore JSON backup with up to 20 stories and 2 MB total. Your existing stories are unchanged.");
const bounded = raw => typeof raw === "string" && raw.length <= MAX_LIBRARY_BYTES && encoder.encode(raw).length <= MAX_LIBRARY_BYTES;
const plainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
function portableRecord(value, id = "backup-validation") {
  const safe = validateStoryRecord({...value, id}, {stored: false});
  return {title: safe.title, text: safe.text, corrections: safe.corrections, position: safe.position, analysisVersion: safe.analysisVersion,
    ...(safe.description ? {description: safe.description} : {}),
    ...(safe.favorite ? {favorite: true} : {})};
}
/** Export story text, title, optional description and favorite, manual corrections and place. Never export retained IDs or playback/session secrets. */
export function serializeBackup(stories) {
  try {
    if (!Array.isArray(stories) || stories.length < 1 || stories.length > MAX_SAVED_STORIES) throw fail();
    const records = stories.map(value => portableRecord(value));
    const raw = JSON.stringify({format: BACKUP_FORMAT, schemaVersion: 1, stories: records});
    if (!bounded(raw)) throw fail();
    return raw;
  } catch { throw fail(); }
}
/** Validation is all-or-nothing. Fresh IDs prevent a restored copy overwriting a saved/deleted record. */
export function parseBackup(raw, {existingIds = [], createId = createStoryId} = {}) {
  try {
    if (!bounded(raw)) throw fail();
    const envelope = JSON.parse(raw);
    if (!plainObject(envelope) || envelope.format !== BACKUP_FORMAT || envelope.schemaVersion !== 1 ||
        Object.keys(envelope).some(key => !["format", "schemaVersion", "stories"].includes(key)) ||
        !Array.isArray(envelope.stories) || envelope.stories.length < 1 || envelope.stories.length > MAX_SAVED_STORIES) throw fail();
    const records = envelope.stories.map(value => {
      if (!plainObject(value) || recordKeys.some(key => !Object.hasOwn(value, key)) ||
          Object.keys(value).some(key => !portableKeys.includes(key))) throw fail();
      return portableRecord(value);
    });
    const used = new Set(existingIds);
    return records.map(record => {
      const id = createId();
      if (used.has(id)) throw fail();
      used.add(id);
      return validateStoryRecord({...record, id}, {stored: false});
    });
  } catch { throw fail(); }
}
export class BackupImporter {
  constructor() { this.generation = 0; }
  invalidate() { ++this.generation; }
  async read(file, options = {}) {
    const generation = ++this.generation;
    try {
      if (!file || typeof file.name !== "string" || !file.name.toLowerCase().endsWith(".json") ||
          !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_LIBRARY_BYTES) throw fail();
      const buffer = await file.arrayBuffer();
      if (generation !== this.generation) return null;
      if (buffer.byteLength > MAX_LIBRARY_BYTES) throw fail();
      const raw = new TextDecoder("utf-8", {fatal: true}).decode(buffer);
      if (generation !== this.generation) return null;
      return parseBackup(raw, options);
    } catch {
      if (generation !== this.generation) return null;
      throw fail();
    }
  }
}
/** Initiating a download does not prove that a browser wrote a file. No network/persistence calls occur here. */
export function downloadBackup(stories, {filename = "satinlore-library-backup.json", document = globalThis.document,
  urls = globalThis.URL, schedule = globalThis.setTimeout} = {}) {
  const raw = serializeBackup(stories);
  let url;
  try {
    if (!document?.createElement || !urls?.createObjectURL || !urls?.revokeObjectURL) throw new Error();
    const blob = new Blob([raw], {type: "application/json;charset=utf-8"});
    url = urls.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // Use a generic name; a private title never enters the download URL or filesystem name.
    link.download = filename === "satinlore-story-backup.json" ? filename : "satinlore-library-backup.json";
    link.hidden = true;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    schedule(() => urls.revokeObjectURL(url), 60000);
    return {message: "Backup download started. Check your downloads and keep the file somewhere private; it contains your story text."};
  } catch {
    if (url) urls?.revokeObjectURL?.(url);
    throw new Error("The backup download could not be started. Your stories are unchanged.");
  }
}
