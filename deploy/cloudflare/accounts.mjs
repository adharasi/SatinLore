/** Account presets only. Authenticated identity is selected by the outer Worker. */
export const ACCOUNT_ROUTES = Object.freeze([
  "/api/account", "/api/presets", "/api/presets/delete", "/api/account/data", "/api/account/delete",
]);
export const ACCOUNT_SCHEMA_VERSION = 1;
export const ACCOUNT_PRESET_LIMIT = 50;
export const ACCOUNT_BODY_BYTES = 16_384;
const ALLOWED_ORIGINS = new Set(["https://app.satinlore.com", "https://beta.satinlore.com"]);
const INTERNAL_ORIGIN = "https://accounts.internal";
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const ENCODER = new TextEncoder();
const PRESET_ACTIONS = Object.freeze({
  lush: ["vibrate"], flexer: ["vibrate", "fingering"], nora: ["vibrate", "rotate"], domi: ["vibrate"],
  velvo: ["vibrate", "rotate"], spinel: ["vibrate", "thrusting"], dolce: ["vibrate"], hush: ["vibrate"],
  // Oscillation may be saved for simulation. Saving never authorises live support.
  osci3: ["vibrate", "oscillate"],
});
const CHANNEL_FIELDS = ["minimum", "background", "preferred", "maximum", "recovery", "gain", "rhythm"];
const MODES = new Set(["story", "continuous"]);
const RHYTHMS = new Set(["steady", "gentle", "dynamic"]);

export class AccountError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message = "Check the account fields and try again.", status = 400) => { throw new AccountError(message, status); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const exact = (value, allowed) => fields(value, allowed) && allowed.every(key => Object.hasOwn(value, key));
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const result = (body, status = 200, headers = {}) => Response.json(body, { status, headers: {
  "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", ...headers,
} });

/** A per-user namespace stable across the two explicitly allowed hosts/audiences. */
export async function accountIdentity(config, session) {
  if (typeof config?.issuer !== "string" || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.issuer) ||
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

export async function accountJson(request, expectedOrigin = request.headers.get("Origin")) {
  if (!ALLOWED_ORIGINS.has(expectedOrigin) || request.headers.get("Origin") !== expectedOrigin ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) fail("Use the account controls on SatinLore.");
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > ACCOUNT_BODY_BYTES)) fail("The preset request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) fail();
  const chunks = []; let size = 0, timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) fail("The preset request timed out. Please try again.", 408);
      if (done) break;
      size += value.byteLength;
      if (size > ACCOUNT_BODY_BYTES) { await reader.cancel(); fail("The preset request is too large.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { fail(); }
  } finally { clearTimeout(timeout); }
}

function emptyState() { return { version: ACCOUNT_SCHEMA_VERSION, revision: 0, account: null, presets: [], rates: null }; }
function snapshot(state) {
  return { registered: state.account !== null, account: state.account, revision: state.revision, presets: state.presets,
    version: ACCOUNT_SCHEMA_VERSION, playback: "paused" };
}
function allowRate(state, now) {
  const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
  const old = state.rates || {};
  const next = { minute, minuteCount: old.minute === minute ? old.minuteCount : 0, day, dayCount: old.day === day ? old.dayCount : 0 };
  if (next.minuteCount >= 30 || next.dayCount >= 1000) fail("You have saved several changes recently. Please try again shortly.", 429);
  next.minuteCount++; next.dayCount++; state.rates = next;
}

/** SQLite-backed Durable Object KV is sufficient for the bounded per-user preset document. */
export class ReaderAccount {
  constructor(ctx, _env) { this.storage = ctx.storage; this.queue = Promise.resolve(); }
  exclusive(task) { const pending = this.queue.then(task, task); this.queue = pending.catch(() => {}); return pending; }
  async handle(request) {
    const url = new URL(request.url);
    if (url.origin !== INTERNAL_ORIGIN || url.search || !ACCOUNT_ROUTES.includes(url.pathname) ||
        !ALLOWED_ORIGINS.has(request.headers.get("Origin"))) return result({ error: "Not found." }, 404);
    const methods = ["/api/account", "/api/presets"].includes(url.pathname) ? ["GET", "POST"] : url.pathname === "/api/account/data" ? ["GET"] : ["POST"];
    if (!methods.includes(request.method)) return result({ error: "Use the account controls on SatinLore." }, 405, { Allow: methods.join(", ") });
    if (request.method === "GET") {
      const state = await this.storage.get("state") || emptyState();
      if (url.pathname === "/api/account/data") return result({ format: "satinlore-account-v1", exportedAt: Date.now(), ...snapshot(state) });
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
    } else if (!exact(body, ["confirm", "expectedRevision"]) || body.confirm !== true) fail("Confirm deletion before removing your account and presets.");
    const now = Date.now();
    const updated = await this.storage.transaction(async txn => {
      const state = await txn.get("state") || emptyState();
      if (state.revision !== body.expectedRevision) fail("Your account changed in another tab. Reload before saving.", 409);
      if (url.pathname === "/api/account") {
        if (state.account) fail("Your account already exists. Reload to continue.", 409);
        state.account = { id: crypto.randomUUID(), createdAt: now, adultConfirmedAt: now };
      } else if (url.pathname === "/api/account/delete") {
        // Preserve only revision and rate counters so a stale tab cannot recreate deleted data.
        state.account = null; state.presets = [];
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

/** Return null for another route. Call only after the outer Worker verifies Access. */
export async function handleAccount(request, env, { config, session } = {}) {
  const url = new URL(request.url);
  if (!ACCOUNT_ROUTES.includes(url.pathname)) return null;
  try {
    if (!ALLOWED_ORIGINS.has(config?.origin) || url.origin !== config.origin || url.search ||
        !Number.isSafeInteger(session?.expiresAt) || session.expiresAt <= Date.now()) return result({ error: "Sign in again to use your account." }, 403);
    if (request.method === "POST" && (request.headers.get("Origin") !== config.origin ||
        ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site")))) return result({ error: "Use the account controls on SatinLore." }, 403);
    if (!env.READER_ACCOUNTS || typeof env.READER_ACCOUNTS.idFromName !== "function" || typeof env.READER_ACCOUNTS.get !== "function") return result({ error: "Account storage is temporarily unavailable. Your changes have not been saved." }, 503);
    const identity = await accountIdentity(config, session);
    const body = request.method === "POST" ? await accountJson(request, config.origin) : undefined;
    if (session.expiresAt <= Date.now()) return result({ error: "Sign in again to use your account." }, 403);
    // Do not forward cookies, JWTs, email, user-supplied account identifiers or URLs.
    const headers = new Headers({ Origin: config.origin });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await env.READER_ACCOUNTS.get(env.READER_ACCOUNTS.idFromName(identity)).fetch(new Request(INTERNAL_ORIGIN + url.pathname, {
      method: request.method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
    if (session.expiresAt <= Date.now()) return result({ error: "Sign in again to view your account. Reload after signing in to check any pending save." }, 403);
    return response;
  } catch (error) {
    if (error instanceof AccountError) return result({ error: error.message }, error.status);
    return result({ error: "Account storage is temporarily unavailable. Your changes have not been saved." }, 503);
  }
}
