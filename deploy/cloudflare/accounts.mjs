/** Account data. Authenticated identity is selected by the outer Worker. */
import {TOY_PROFILES} from "../../app/static/devices/toy-profiles.mjs";
import {MAX_SAVED_STORIES, validateStoryRecord} from "../../app/static/reader/storage.mjs";
import {validateExperience} from "../../app/static/reader/experience-preferences.mjs";

const LIBRARY_ROUTE = "/api/account/library";
export const ACCOUNT_ROUTES = Object.freeze([
  "/api/account", "/api/presets", "/api/presets/delete", "/api/account/data", "/api/account/delete", LIBRARY_ROUTE,
]);
export const ACCOUNT_SCHEMA_VERSION = 1;
export const ACCOUNT_PRESET_LIMIT = 50;
export const ACCOUNT_BODY_BYTES = 16_384;
const APP_ORIGIN = "https://app.satinlore.com";
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, "https://beta.satinlore.com"]);
const INTERNAL_ORIGIN = "https://accounts.internal";
const ENSURE_EMAIL_ACCOUNT = "/internal/ensure-email-account";
const LIBRARY_KEY = "cloud-library:v1";
const LIBRARY_MAX_BYTES = 1_900_000;
const LIBRARY_BODY_BYTES = LIBRARY_MAX_BYTES + 512;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const STORY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", { fatal: true });
const STORY_UPDATES = ["title", "description", "favorite", "corrections", "position"];
const STORY_FIELDS = ["id", "text", "analysisVersion", ...STORY_UPDATES];
const PREFERENCE_FIELDS = ["appearance", "width", "fontSize", "spacing", "follow"];
// Presets may store simulator movements and never authorise live support.
const PRESET_ACTIONS = Object.fromEntries(TOY_PROFILES.map(profile => [profile.id, profile.simChannels]));
const CHANNEL_FIELDS = ["minimum", "background", "preferred", "maximum", "recovery", "gain", "rhythm"];
const MODES = new Set(["story", "continuous"]);
const RHYTHMS = new Set(["steady", "gentle", "dynamic", "scene"]);

export class AccountError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message = "Check the account fields and try again.", status = 400) => { throw new AccountError(message, status); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const exact = (value, allowed) => fields(value, allowed) && allowed.every(key => Object.hasOwn(value, key));
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const result = (body, status = 200, headers = {}) => Response.json(body, { status, headers: {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin", ...headers,
} });

/** Cloudflare identities are stable across the private hosts; app email identities are separate. */
function isEmailAccount(config, session) {
  return config?.origin === APP_ORIGIN && config.issuer === APP_ORIGIN && session?.authMode === "email" &&
    /^email-v1:[a-f0-9]{64}$/.test(session.subject);
}
export async function accountIdentity(config, session) {
  const emailIdentity = isEmailAccount(config, session);
  const accessIdentity = typeof config?.issuer === "string" && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.issuer);
  if ((!emailIdentity && !accessIdentity) ||
      typeof session?.subject !== "string" || !session.subject || session.subject.length > 512) fail("Sign in again to use your account.", 403);
  const bytes = await crypto.subtle.digest("SHA-256", ENCODER.encode(`satinlore:reader-account:v1:${config.issuer}:${session.subject}`));
  return "account:v1:" + Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

export function normalizeChannelSettings(value) {
  if (!exact(value, CHANNEL_FIELDS)) fail("Check the movement settings and try again.");
  for (const key of ["minimum", "background", "preferred", "maximum", "recovery"]) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 20) fail("Movement levels must be whole numbers from 0 to 20.");
  }
  if (value.minimum > value.maximum || value.background < value.minimum || value.background > value.maximum ||
      value.preferred < value.minimum || value.preferred > value.maximum || value.recovery > value.maximum) fail("Keep background and preferred levels within the selected minimum and maximum.");
  if (typeof value.gain !== "number" || !Number.isFinite(value.gain) || value.gain < 0 || value.gain > 2 ||
      Math.abs(value.gain * 10 - Math.round(value.gain * 10)) > 1e-9) fail("Choose a strength multiplier from 0 to 2 in steps of 0.1.");
  if (!RHYTHMS.has(value.rhythm)) fail("Choose a supported rhythm.");
  return Object.fromEntries(CHANNEL_FIELDS.map(key => [key, value[key]]));
}

export function normalizePreset(value) {
  if (!fields(value, ["id", "name", "toy", "scope", "storyId", "mode", "channels", "version", "activeChannels", "ceiling"]) ||
      typeof value.id !== "string" || !UUID.test(value.id)) fail("Reopen the preset controls and try again.");
  if (value.version !== undefined && value.version !== ACCOUNT_SCHEMA_VERSION) fail("This preset version is not supported.");
  if (typeof value.name !== "string" || value.name.length > 64 || /[\u0000-\u001f\u007f]/u.test(value.name)) fail("Use a preset name of 1 to 64 characters.");
  const name = value.name.normalize("NFC").trim();
  if (!name || name.length > 64 || ENCODER.encode(name).byteLength > 256) fail("Use a preset name of 1 to 64 characters.");
  if (!Object.hasOwn(PRESET_ACTIONS, value.toy) || !["account", "story"].includes(value.scope) || !MODES.has(value.mode)) fail("Choose a supported toy and preset type.");
  const storyId = value.storyId === undefined ? null : value.storyId;
  if (value.scope === "story" ? typeof storyId !== "string" || !UUID.test(storyId) : storyId !== null) fail("Choose a local story for a story preset.");
  if (!object(value.channels) || Object.keys(value.channels).length < 1 || Object.keys(value.channels).length > 5 ||
      Object.keys(value.channels).some(key => !PRESET_ACTIONS[value.toy].includes(key))) fail("Use only the movements exposed for this toy profile.");
  const channels = Object.fromEntries(Object.entries(value.channels).map(([key, settings]) => [key, normalizeChannelSettings(settings)]));
  const activeChannels = value.activeChannels;
  if (activeChannels !== undefined && (!Array.isArray(activeChannels) || activeChannels.length < 1 || activeChannels.length > 5 ||
      new Set(activeChannels).size !== activeChannels.length || activeChannels.some(key => typeof key !== "string" || !Object.hasOwn(channels, key)))) fail("Choose distinct active movements from this preset's settings.");
  if (value.ceiling !== undefined && (!Number.isInteger(value.ceiling) || value.ceiling < 0 || value.ceiling > 20)) fail("Choose a whole-number master maximum from 0 to 20.");
  return { version: ACCOUNT_SCHEMA_VERSION, id: value.id.toLowerCase(), name, toy: value.toy, scope: value.scope,
    storyId: storyId?.toLowerCase() || null, mode: value.mode, channels,
    ...(activeChannels === undefined ? {} : { activeChannels: [...activeChannels] }),
    ...(value.ceiling === undefined ? {} : { ceiling: value.ceiling }) };
}

function requireAccountJsonHeaders(request, expectedOrigin, maxBytes) {
  if (!ALLOWED_ORIGINS.has(expectedOrigin) || request.headers.get("Origin") !== expectedOrigin ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) fail("Use the account controls on SatinLore.");
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) fail("The account request is too large.", 413);
}

export async function accountJson(request, expectedOrigin = request.headers.get("Origin"), maxBytes = ACCOUNT_BODY_BYTES) {
  requireAccountJsonHeaders(request, expectedOrigin, maxBytes);
  const reader = request.body?.getReader();
  if (!reader) fail();
  const chunks = []; let size = 0, timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) fail("The account request timed out. Please try again.", 408);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); fail("The account request is too large.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(DECODER.decode(bytes)); }
    catch { fail(); }
  } finally { clearTimeout(timeout); }
}

function emptyState() { return { version: ACCOUNT_SCHEMA_VERSION, revision: 0, account: null, presets: [], rates: null }; }
function snapshot(state) {
  return { registered: state.account !== null, account: state.account, revision: state.revision, presets: state.presets,
    version: ACCOUNT_SCHEMA_VERSION, playback: "paused" };
}
function allowRate(state, now, minuteLimit = 30, dayLimit = 1000) {
  const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
  const old = state.rates || {};
  const next = { minute, minuteCount: old.minute === minute ? old.minuteCount : 0, day, dayCount: old.day === day ? old.dayCount : 0 };
  if (next.minuteCount >= minuteLimit || next.dayCount >= dayLimit) fail("You have saved several changes recently. Please try again shortly.", 429);
  next.minuteCount++; next.dayCount++; state.rates = next;
}

const storyKey = id => `cloud-story:v1:${id}`;
const emptyLibrary = () => ({ revision: 0, entries: [], preferences: null });
const libraryConflict = () => fail("Your saved library changed. Reload it before saving again.", 409);
const accountChanged = () => fail("Your signed-in account changed. Reload before saving again.", 409);

function normalizeLibraryMutation(body) {
  const common = ["action", "expectedOwner", "expectedRevision"];
  if (!object(body) || typeof body.expectedOwner !== "string" || !UUID.test(body.expectedOwner)) fail();
  if (body.action === "savePreferences") {
    if (!exact(body, [...common, "preferences"]) || (body.expectedRevision !== null && !revision(body.expectedRevision))) fail();
    const value = body.preferences;
    if (!fields(value, [...PREFERENCE_FIELDS, "experience"]) || !PREFERENCE_FIELDS.every(key => Object.hasOwn(value, key)) || !["dark", "light", "system"].includes(value.appearance) ||
        !["comfortable", "wide", "full"].includes(value.width) || !["small", "normal", "large"].includes(value.fontSize) ||
        !["compact", "normal", "relaxed"].includes(value.spacing) || typeof value.follow !== "boolean") fail("Check your reading preferences and try again.");
    const preferences = Object.fromEntries(PREFERENCE_FIELDS.map(key => [key, value[key]]));
    if (Object.hasOwn(value, "experience")) {
      try { preferences.experience = validateExperience(value.experience); }
      catch (error) { fail(error.message); }
    }
    return { ...body, preferences };
  }
  if (!revision(body.expectedRevision)) fail();
  if (body.action === "saveStory" && exact(body, [...common, "story"]) && fields(body.story, STORY_FIELDS)) {
    return { ...body, story: normalizeCloudStory(body.story) };
  }
  if (typeof body.id !== "string" || !STORY_ID.test(body.id)) fail();
  if (body.action === "updateStory" && exact(body, [...common, "id", "changes"]) &&
      fields(body.changes, STORY_UPDATES) && Object.keys(body.changes).length) return body;
  if (body.action === "deleteStory" && exact(body, [...common, "id"])) return body;
  fail();
}

function normalizeCloudStory(value) {
  try { return validateStoryRecord(value, { stored: false }); }
  catch { fail("Check the story and reading position before saving."); }
}

function storedStory(entry, textBytes) {
  const { bytes: _bytes, ...metadata } = entry;
  return { ...metadata, text: JSON.parse(DECODER.decode(textBytes)) };
}

async function librarySnapshot(storage) {
  const library = await storage.get(LIBRARY_KEY) || emptyLibrary();
  const textByKey = library.entries.length ? await storage.get(library.entries.map(entry => storyKey(entry.id))) : new Map();
  return { revision: library.revision, preferences: library.preferences,
    stories: library.entries.map(entry => storedStory(entry, textByKey.get(storyKey(entry.id)))) };
}

/** SQLite-backed Durable Object KV keeps each private text separate from frequently changed metadata. */
export class ReaderAccount {
  constructor(ctx, _env) { this.storage = ctx.storage; this.queue = Promise.resolve(); }
  exclusive(task) { const pending = this.queue.then(task, task); this.queue = pending.catch(() => {}); return pending; }
  async handleLibrary(request) {
    if (request.headers.get("Origin") !== APP_ORIGIN || request.headers.get("X-SatinLore-Account-Mode") !== "email") {
      return result({ error: "Sign in with your SatinLore account to use cloud saving." }, 403);
    }
    const expiresAt = Number(request.headers.get("X-SatinLore-Account-Expires-At"));
    const ensureFresh = () => {
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) fail("Sign in again to use your account.", 403);
    };
    ensureFresh();
    if (request.method === "GET") {
      const state = await this.storage.get("state") || emptyState();
      if (!state.account) accountChanged();
      return result({ owner: state.account.id, ...await librarySnapshot(this.storage) });
    }
    if (request.method !== "POST") return result({ error: "Use the account controls on SatinLore." }, 405, { Allow: "GET, POST" });
    const mutation = normalizeLibraryMutation(await accountJson(request, APP_ORIGIN, LIBRARY_BODY_BYTES));
    const now = Date.now();
    return this.storage.transaction(async txn => {
      ensureFresh();
      const state = await txn.get("state") || emptyState();
      if (state.account?.id !== mutation.expectedOwner) accountChanged();
      const library = await txn.get(LIBRARY_KEY) || emptyLibrary();
      if (mutation.action === "savePreferences") {
        const current = library.preferences?.revision ?? null;
        if (current !== mutation.expectedRevision) fail("Your reading preferences changed. Reload before saving again.", 409);
        // Older tabs can save appearance without losing a profile saved in another tab.
        const preferences = { ...(library.preferences?.experience ? {experience: library.preferences.experience} : {}),
          ...mutation.preferences, revision: (current ?? 0) + 1 };
        allowRate(library, now, 60, 3000);
        library.preferences = preferences;
        await txn.put(LIBRARY_KEY, library);
        return result({ preferences });
      }
      if (library.revision !== mutation.expectedRevision) libraryConflict();
      const id = mutation.story?.id ?? mutation.id;
      const key = storyKey(id);
      const index = library.entries.findIndex(entry => entry.id === id);
      const prior = library.entries[index];
      if (mutation.action !== "saveStory" && !prior) fail("This story is no longer saved to your account.", 404);
      library.revision++;
      if (mutation.action === "deleteStory") {
        library.entries.splice(index, 1);
        await txn.delete(key);
        await txn.put(LIBRARY_KEY, library);
        return result({ revision: library.revision, deleted: true });
      }
      if (!prior && library.entries.length >= MAX_SAVED_STORIES) fail(`Your account can save up to ${MAX_SAVED_STORIES} stories.`, 429);
      const record = mutation.story ?? normalizeCloudStory({ ...storedStory(prior, await txn.get(key)), ...mutation.changes });
      const next = { ...record, updatedAt: now, revision: library.revision };
      const bytes = ENCODER.encode(JSON.stringify(next)).byteLength;
      const used = library.entries.reduce((total, entry) => total + entry.bytes, 0) - (prior?.bytes ?? 0);
      if (used + bytes > LIBRARY_MAX_BYTES) fail("Your account story library is full. Delete a saved story or use browser saving.", 413);
      allowRate(library, now, 60, 3000);
      const { text, ...metadata } = next;
      const entry = { ...metadata, bytes };
      if (prior) library.entries[index] = entry; else library.entries.push(entry);
      if (mutation.action === "saveStory") await txn.put(key, ENCODER.encode(JSON.stringify(text)));
      await txn.put(LIBRARY_KEY, library);
      return result(mutation.action === "updateStory" ? { revision: library.revision, updatedAt: now, storyRevision: next.revision } :
        { revision: library.revision, story: next });
    });
  }
  async handle(request) {
    const url = new URL(request.url);
    if (url.origin !== INTERNAL_ORIGIN || url.search || !ALLOWED_ORIGINS.has(request.headers.get("Origin"))) {
      return result({ error: "Not found." }, 404);
    }
    if (url.pathname === ENSURE_EMAIL_ACCOUNT) {
      if (request.method !== "POST" || request.headers.get("Origin") !== APP_ORIGIN) return result({ error: "Not found." }, 404);
      const body = await accountJson(request);
      const now = Date.now();
      if (!exact(body, ["issuedAt"]) || !Number.isSafeInteger(body.issuedAt) || body.issuedAt <= 0 || body.issuedAt > now) fail();
      return this.storage.transaction(async txn => {
        const state = await txn.get("state") || emptyState();
        // A code requested before deletion must not recreate the deleted account.
        if ((state.deletedAt ?? 0) >= body.issuedAt) fail("Request a new sign-in code to create an account.", 409);
        if (state.account) return result({ ok: true });
        state.account = { id: crypto.randomUUID(), createdAt: now, adultConfirmedAt: now };
        state.revision++;
        await txn.put("state", state);
        return result({ ok: true }, 201);
      });
    }
    if (!ACCOUNT_ROUTES.includes(url.pathname)) return result({ error: "Not found." }, 404);
    if (url.pathname === LIBRARY_ROUTE) return this.handleLibrary(request);
    const methods = ["/api/account", "/api/presets"].includes(url.pathname) ? ["GET", "POST"] : url.pathname === "/api/account/data" ? ["GET"] : ["POST"];
    if (!methods.includes(request.method)) return result({ error: "Use the account controls on SatinLore." }, 405, { Allow: methods.join(", ") });
    if (request.method === "GET") {
      const state = await this.storage.get("state") || emptyState();
      if (url.pathname === "/api/account/data") {
        const emailMode = request.headers.get("Origin") === APP_ORIGIN && request.headers.get("X-SatinLore-Account-Mode") === "email";
        return result({ format: "satinlore-account-v1", exportedAt: Date.now(), ...snapshot(state),
          ...(emailMode ? { library: await librarySnapshot(this.storage) } : {}) });
      }
      return result(snapshot(state));
    }
    const body = await accountJson(request);
    if (!object(body) || !revision(body.expectedRevision)) fail("Reload your account before saving changes.");
    let preset;
    if (url.pathname === "/api/account") {
      if (!exact(body, ["action", "adult", "expectedRevision"]) || body.action !== "create" || body.adult !== true) fail("Confirm that you are 18 or over before creating an account.");
    } else if (url.pathname === "/api/presets") {
      if (!exact(body, ["expectedRevision", "preset"])) fail();
      preset = normalizePreset(body.preset);
    } else if (url.pathname === "/api/presets/delete") {
      if (!exact(body, ["id", "expectedRevision"]) || typeof body.id !== "string" || !UUID.test(body.id)) fail();
    } else if (!exact(body, ["confirm", "expectedRevision"]) || body.confirm !== true) fail("Confirm deletion before removing your account data.");
    const now = Date.now();
    const updated = await this.storage.transaction(async txn => {
      const state = await txn.get("state") || emptyState();
      if (state.revision !== body.expectedRevision) fail("Your account changed in another tab. Reload before saving.", 409);
      if (url.pathname === "/api/account") {
        if (state.account) fail("Your account already exists. Reload to continue.", 409);
        state.account = { id: crypto.randomUUID(), createdAt: now, adultConfirmedAt: now };
      } else if (url.pathname === "/api/account/delete") {
        // Retain stale-write guards and rate counters after removing the account and presets.
        state.account = null; state.presets = [];
        state.deletedAt = now;
        const library = await txn.get(LIBRARY_KEY);
        if (library) await txn.delete([LIBRARY_KEY, ...library.entries.map(entry => storyKey(entry.id))]);
      } else {
        if (!state.account) fail("Create your account before saving presets.", 409);
        if (url.pathname === "/api/presets") {
          const index = state.presets.findIndex(item => item.id === preset.id);
          if (index === -1 && state.presets.length >= ACCOUNT_PRESET_LIMIT) fail("You have reached 50 presets. Delete one before adding another.", 429);
          const saved = { ...preset, createdAt: index === -1 ? now : state.presets[index].createdAt, updatedAt: now };
          if (index === -1) state.presets.push(saved); else state.presets[index] = saved;
        } else {
          const index = state.presets.findIndex(item => item.id === body.id.toLowerCase());
          if (index === -1) fail("That preset is no longer saved. Reload your account.", 404);
          state.presets.splice(index, 1);
        }
      }
      // A privacy deletion remains available even after the ordinary save quota.
      if (url.pathname !== "/api/account/delete") allowRate(state, now);
      state.revision++;
      await txn.put("state", state);
      return snapshot(state);
    });
    return result({ ok: true, ...updated }, url.pathname === "/api/account" ? 201 : 200);
  }
  async fetch(request) {
    return this.exclusive(async () => {
      try { return await this.handle(request); }
      catch (error) {
        if (error instanceof AccountError) return result({ error: error.message }, error.status);
        return result({ error: "Your account changes could not be confirmed as saved. Please retry." }, 503);
      }
    });
  }
}

/** The email Worker calls this only after consuming an adult-confirmed, current code. */
export async function ensureEmailAccount(env, config, session, issuedAt) {
  if (session?.authMode !== "email" || session.expiresAt <= Date.now()) return false;
  const identity = await accountIdentity(config, session);
  const response = await env.READER_ACCOUNTS.get(env.READER_ACCOUNTS.idFromName(identity)).fetch(new Request(INTERNAL_ORIGIN + ENSURE_EMAIL_ACCOUNT, {
    method: "POST", headers: { Origin: config.origin, "Content-Type": "application/json" }, body: JSON.stringify({ issuedAt }),
  }));
  return response.ok;
}

/** Return null for another route. Call only after the outer Worker verifies the session. */
export async function handleAccount(request, env, { config, session } = {}) {
  const url = new URL(request.url);
  if (!ACCOUNT_ROUTES.includes(url.pathname)) return null;
  try {
    if (!ALLOWED_ORIGINS.has(config?.origin) || url.origin !== config.origin || url.search ||
        !Number.isSafeInteger(session?.expiresAt) || session.expiresAt <= Date.now()) return result({ error: "Sign in again to use your account." }, 403);
    const emailMode = isEmailAccount(config, session);
    if (url.pathname === LIBRARY_ROUTE && (!emailMode || ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site")))) {
      return result({ error: "Sign in with your SatinLore account to use cloud saving." }, 403);
    }
    if (request.method === "POST" && (request.headers.get("Origin") !== config.origin ||
        ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site")))) return result({ error: "Use the account controls on SatinLore." }, 403);
    if (session.authMode === "email" && url.pathname === "/api/account" && request.method === "POST") {
      return result({ error: "Verify your email to create an account." }, 405, { Allow: "GET" });
    }
    if (!env.READER_ACCOUNTS || typeof env.READER_ACCOUNTS.idFromName !== "function" || typeof env.READER_ACCOUNTS.get !== "function") return result({ error: "Account storage is temporarily unavailable. Your changes have not been saved." }, 503);
    const identity = await accountIdentity(config, session);
    const libraryRequest = url.pathname === LIBRARY_ROUTE;
    const stream = libraryRequest && request.method === "POST";
    if (stream) requireAccountJsonHeaders(request, config.origin, LIBRARY_BODY_BYTES);
    const body = request.method === "POST" && !stream ? await accountJson(request, config.origin) : undefined;
    if (session.expiresAt <= Date.now()) return result({ error: "Sign in again to use your account." }, 403);
    // Do not forward cookies, JWTs, email, user-supplied account identifiers or URLs.
    const headers = new Headers({ Origin: config.origin });
    if (emailMode) headers.set("X-SatinLore-Account-Mode", "email");
    if (libraryRequest) headers.set("X-SatinLore-Account-Expires-At", String(session.expiresAt));
    if (stream || body !== undefined) headers.set("Content-Type", "application/json");
    // The DO reads and validates bounded library JSON. Avoid parsing private, potentially large text twice.
    const response = await env.READER_ACCOUNTS.get(env.READER_ACCOUNTS.idFromName(identity)).fetch(new Request(INTERNAL_ORIGIN + url.pathname, {
      method: request.method, headers, ...(stream ? { body: request.body, duplex: "half" } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
    if (session.expiresAt <= Date.now()) return result({ error: "Sign in again to view your account. Reload after signing in to check any pending save." }, 403);
    return response;
  } catch (error) {
    if (error instanceof AccountError) return result({ error: error.message }, error.status);
    return result({ error: "Account storage is temporarily unavailable. Your changes have not been saved." }, 503);
  }
}
