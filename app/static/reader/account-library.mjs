import {validateStoryRecord} from "./storage.mjs";
import {validateReaderPreferences} from "./preferences.mjs";
import {validateExperience} from "./experience-preferences.mjs";

const ownerPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const revision = value => Number.isSafeInteger(value) && value >= 0;
const changedSession = () => new Error("Your sign-in changed. Open your account library again before saving.");
const unavailable = () => new Error("The account library is temporarily unavailable. Try again shortly.");

function validatedPreferences(value) {
  if (value === null) return null;
  if (!value || !revision(value.revision) || !["dark", "light", "system"].includes(value.appearance)) throw unavailable();
  const {revision: savedRevision, appearance, experience, ...reader} = value;
  return {revision: savedRevision, appearance, ...validateReaderPreferences(reader),
    ...(experience === undefined ? {} : {experience: validateExperience(experience)})};
}

/** Story data lives only in authenticated requests and in this tab's memory. */
export class AccountLibrary {
  constructor({request = (path, options) => fetch(path, options)} = {}) {
    this.request = request;
    this.session = null;
  }

  clear() {
    this.session?.abort.abort();
    this.session = null;
  }

  get owner() { return this.session?.owner ?? null; }

  async send(session, body) {
    const response = await this.request("/api/account/library", {
      method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.any([session.abort.signal, AbortSignal.timeout(15_000)]),
      ...(body ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {}),
    });
    if (session !== this.session) throw changedSession();
    const value = await response.json().catch(() => null);
    if (session !== this.session) throw changedSession();
    if (!response.ok || response.redirected || !value) {
      if (response.status === 409) throw new Error("Your account library or settings changed elsewhere. Reload before trying again.");
      if (typeof value?.error === "string" && value.error.length <= 220) throw new Error(value.error);
      throw unavailable();
    }
    return value;
  }

  async open() {
    this.clear();
    const session = {abort: new AbortController(), owner: null, revision: 0, preferencesRevision: null, pending: Promise.resolve()};
    this.session = session;
    try {
      const value = await this.send(session);
      if (typeof value.owner !== "string" || !ownerPattern.test(value.owner) || !revision(value.revision) || !Array.isArray(value.stories) || value.stories.length > 20) throw unavailable();
      const stories = value.stories.map(record => validateStoryRecord(record));
      const preferences = validatedPreferences(value.preferences);
      session.owner = value.owner;
      session.revision = value.revision;
      session.preferencesRevision = preferences?.revision ?? null;
      return {owner: session.owner, stories, preferences};
    } catch (error) {
      if (session === this.session) this.clear();
      throw error;
    }
  }

  write(owner, action, fields) {
    const session = this.session;
    if (!session?.owner || session.owner !== owner) return Promise.reject(changedSession());
    const prefs = action === "savePreferences";
    const task = session.pending.catch(() => {}).then(async () => {
      if (session !== this.session) throw changedSession();
      const value = await this.send(session, {expectedOwner: owner, expectedRevision: prefs ? session.preferencesRevision : session.revision, action, ...fields});
      if (prefs) {
        const preferences = validatedPreferences(value.preferences);
        if (!preferences) throw unavailable();
        session.preferencesRevision = preferences.revision;
      } else {
        if (!revision(value.revision)) throw unavailable();
        session.revision = value.revision;
      }
      return value;
    });
    session.pending = task;
    return task;
  }

  saveStory(owner, record) {
    const {folderId, ...story} = validateStoryRecord(record, {stored: false});
    return this.write(owner, "saveStory", {story}).then(value => validateStoryRecord(value.story));
  }

  updateStory(owner, {id, position, corrections, title, description, favorite}) {
    return this.write(owner, "updateStory", {id, changes: {position, corrections, title, description, favorite}})
      .then(value => {
        if (!revision(value.storyRevision) || !revision(value.updatedAt)) throw unavailable();
        return {revision: value.storyRevision, updatedAt: value.updatedAt};
      });
  }

  deleteStory(owner, id) {
    return this.write(owner, "deleteStory", {id}).then(value => {
      if (value.deleted !== true) throw unavailable();
      return true;
    });
  }

  savePreferences(owner, preferences) { return this.write(owner, "savePreferences", {preferences}); }
}
