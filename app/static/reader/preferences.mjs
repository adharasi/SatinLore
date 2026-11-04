// Reading presentation only. Appearance has its own pre-paint preference; story/playback state never enters this key.
export const READER_PREFERENCES_KEY = "satinlore.reader-preferences.v1";
export const DEFAULT_READER_PREFERENCES = Object.freeze({width: "wide", fontSize: "normal", spacing: "normal", follow: true});
const choices = {width: ["comfortable", "wide", "full"], fontSize: ["small", "normal", "large"], spacing: ["compact", "normal", "relaxed"]};
export function validateReaderPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_READER_PREFERENCES, key))) throw new TypeError("Invalid reading preferences.");
  const next = {...DEFAULT_READER_PREFERENCES, ...value};
  if (typeof next.follow !== "boolean" || Object.entries(choices).some(([key, allowed]) => !allowed.includes(next[key]))) throw new TypeError("Invalid reading preferences.");
  return {width: next.width, fontSize: next.fontSize, spacing: next.spacing, follow: next.follow};
}
export class ReaderPreferences {
  constructor({storage = () => globalThis.localStorage} = {}) {
    this.storageSource = storage;
    this.current = {...DEFAULT_READER_PREFERENCES};
  }
  get values() { return {...this.current}; }
  _storage() {
    const storage = typeof this.storageSource === "function" ? this.storageSource() : this.storageSource;
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw new Error("Unavailable storage.");
    return storage;
  }
  load() {
    this.current = {...DEFAULT_READER_PREFERENCES};
    let raw;
    try { raw = this._storage().getItem(READER_PREFERENCES_KEY); }
    catch { return {preferences: this.values, available: false, message: "Reading preferences are for this visit because browser storage is unavailable."}; }
    if (raw === null) return {preferences: this.values, available: true, message: ""};
    try {
      if (typeof raw !== "string" || raw.length > 500) throw new Error();
      const envelope = JSON.parse(raw);
      if (!envelope || envelope.schemaVersion !== 1 || Object.keys(envelope).some(key => !["schemaVersion", "preferences"].includes(key))) throw new Error();
      this.current = validateReaderPreferences(envelope.preferences);
      return {preferences: this.values, available: true, message: ""};
    } catch { return {preferences: this.values, available: true, message: "Saved reading preferences could not be read. Default settings are in use for this visit."}; }
  }
  update(patch) {
    const next = validateReaderPreferences({...this.current, ...validatedPatch(patch)});
    this.current = next;
    try {
      this._storage().setItem(READER_PREFERENCES_KEY, JSON.stringify({schemaVersion: 1, preferences: next}));
      return {preferences: this.values, saved: true, message: "Reading preferences saved on this browser."};
    } catch { return {preferences: this.values, saved: false, message: "Reading preferences changed for this visit, but could not be saved on this browser."}; }
  }
}
function validatedPatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_READER_PREFERENCES, key))) throw new TypeError("Invalid reading preferences.");
  // Validate supplied values without filling defaults, so changing one setting preserves the others.
  validateReaderPreferences(value);
  return value;
}
