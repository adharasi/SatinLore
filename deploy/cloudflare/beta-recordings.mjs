/** Opted-in beta control timelines. Raw DOM, text, device IDs and credentials are never accepted. */
export const BETA_RECORDING_ORIGIN = "https://beta.satinlore.com";
export const BETA_RECORDING_CONSENT = "beta-controls-2026-11-02-v1";
export const BETA_RECORDING_RETENTION_MS = 30 * 86400000;
export const BETA_RECORDING_LIMITS = Object.freeze({ durationMs: 3600000, events: 20000, batchEvents: 100, sessionBytes: 4 * 1024 * 1024, totalBytes: 128 * 1024 * 1024, requestBytes: 98304 });
export const BETA_TOYS = Object.freeze(["none", "lush", "flexer", "nora", "domi", "velvo", "spinel", "dolce", "hush", "osci3"]);
export const BETA_CHANNELS = Object.freeze(["vibrate", "fingering", "rotate", "thrusting", "oscillate"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const OWNER = /^[a-f0-9]{64}$/;
const MODES = ["simulator", "live"];
const STEPS = ["account", "choose", "connect", "features", "calibration", "playground", "practice", "story", "complete", "presets"];
const CONTROLS = ["minimum", "background", "preferred", "maximum", "recovery", "gain", "rhythm", "continuity", "strength", "action", "mode", "start", "pause", "stop", "hold", "easeoff", "follow", "test"];
const VALUES = ["story", "continuous", "steady", "gentle", "dynamic", "scene", "off", "on", "simulator", "live", ...BETA_CHANNELS];
const STATES = ["paused", "playing", "testing", "stopped", "connected", "disconnected", "error"];
const encoder = new TextEncoder();

export class BetaRecordingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
function check(condition, message = "Use the supported beta recording fields.", status = 400) { if (!condition) throw new BetaRecordingError(message, status); }
const byteLength = value => encoder.encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), byte => byte.toString(16).padStart(2, "0")).join(""); }

/** Strict and deliberately non-extensible without a reviewed schema update. */
export function normalizeBetaEvent(value) {
  check(exact(value, ["t", "type", "step", "control", "channel", "value", "channels", "state", "question", "field", "scope", "fixture", "position", "event", "panel", "width", "kind", "x", "y", "toy", "mode"]));
  check(integer(value.t, 0, BETA_RECORDING_LIMITS.durationMs) && typeof value.type === "string");
  const base = { t: value.t, type: value.type };
  const only = keys => check(Object.keys(value).every(key => ["t", "type", ...keys].includes(key)));
  switch (value.type) {
    case "step": only(["step"]); check(STEPS.includes(value.step)); return { ...base, step: value.step };
    case "control": {
      only(["control", "channel", "value"]); check(CONTROLS.includes(value.control));
      check(value.channel === undefined || BETA_CHANNELS.includes(value.channel));
      check(value.value === undefined || typeof value.value === "number" && Number.isFinite(value.value) && value.value >= 0 && value.value <= 20 || VALUES.includes(value.value));
      return { ...base, control: value.control, ...(value.channel === undefined ? {} : { channel: value.channel }), ...(value.value === undefined ? {} : { value: value.value }) };
    }
    case "output": {
      only(["channels", "state"]); check(STATES.includes(value.state) && exact(value.channels, BETA_CHANNELS));
      const channels = {};
      for (const channel of BETA_CHANNELS) if (value.channels[channel] !== undefined) { check(Number.isFinite(value.channels[channel]) && value.channels[channel] >= 0 && value.channels[channel] <= 20); channels[channel] = value.channels[channel]; }
      return { ...base, channels, state: value.state };
    }
    case "rating": {
      only(["question", "value", "channel", "field"]); check(["comfort", "background", "preferred", "intensity", "sync", "overall", "pleasure"].includes(value.question) && integer(value.value, 1, 5));
      check(value.channel === undefined || BETA_CHANNELS.includes(value.channel));
      check(value.field === undefined || ["minimum", "background", "preferred", "maximum", "recovery"].includes(value.field));
      return { ...base, question: value.question, value: value.value, ...(value.channel === undefined ? {} : { channel: value.channel }), ...(value.field === undefined ? {} : { field: value.field }) };
    }
    case "preset": only(["event", "scope"]); check(["save", "apply", "delete"].includes(value.event) && ["account", "story"].includes(value.scope)); return { ...base, event: value.event, scope: value.scope };
    case "story": only(["fixture", "position"]); check(["practice", "harbour", "garden", "personal"].includes(value.fixture) && (value.position === undefined || integer(value.position, 0, 10000))); return { ...base, fixture: value.fixture, ...(value.position === undefined ? {} : { position: value.position }) };
    case "lifecycle": only(["event"]); check(["hidden", "visible", "connected", "disconnected", "error", "unload", "paused", "resumed"].includes(value.event)); return { ...base, event: value.event };
    case "view": only(["panel", "width"]); check(["library", "reader", "settings", "setup", "sidebar", "help"].includes(value.panel) && (value.width === undefined || integer(value.width, 320, 7680))); return { ...base, panel: value.panel, ...(value.width === undefined ? {} : { width: value.width }) };
    case "pointer": only(["kind", "x", "y"]); check(["click", "move", "touch", "scroll"].includes(value.kind) && integer(value.y, 0, 10000) && (value.x === undefined || integer(value.x, 0, 10000))); return { ...base, kind: value.kind, ...(value.x === undefined ? {} : { x: value.x }), y: value.y };
    case "device": only(["toy", "mode", "channels"]); check(BETA_TOYS.includes(value.toy) && MODES.includes(value.mode) && (value.channels === undefined || Array.isArray(value.channels) && value.channels.length <= 5 && value.channels.every(channel => BETA_CHANNELS.includes(channel)) && new Set(value.channels).size === value.channels.length)); return { ...base, toy: value.toy, mode: value.mode, ...(value.channels === undefined ? {} : { channels: [...value.channels] }) };
    default: throw new BetaRecordingError("This beta event is not supported.");
  }
}
export function normalizeBetaStart(value) {
  check(exact(value, ["action", "consentVersion", "idempotencyKey", "mode", "toy", "viewport"]) && Object.keys(value).length === 6);
  check(value.action === "start" && value.consentVersion === BETA_RECORDING_CONSENT, "Choose beta recording explicitly before starting.");
  check(typeof value.idempotencyKey === "string" && UUID.test(value.idempotencyKey) && MODES.includes(value.mode) && BETA_TOYS.includes(value.toy));
  check(exact(value.viewport, ["w", "h"]) && Object.keys(value.viewport).length === 2 && integer(value.viewport.w, 320, 7680) && integer(value.viewport.h, 240, 4320));
  return { action: "start", consentVersion: BETA_RECORDING_CONSENT, idempotencyKey: value.idempotencyKey.toLowerCase(), mode: value.mode, toy: value.toy, viewport: { w: value.viewport.w, h: value.viewport.h } };
}
export function normalizeBetaAppend(value) {
  check(exact(value, ["action", "sid", "seq", "events"]) && Object.keys(value).length === 4 && value.action === "append" && typeof value.sid === "string" && UUID.test(value.sid) && integer(value.seq, 1, BETA_RECORDING_LIMITS.events));
  check(Array.isArray(value.events) && value.events.length > 0 && value.events.length <= BETA_RECORDING_LIMITS.batchEvents);
  const events = value.events.map(normalizeBetaEvent);
  for (let index = 1; index < events.length; index++) check(events[index].t >= events[index - 1].t, "Recording events must stay in order.");
  return { action: "append", sid: value.sid.toLowerCase(), seq: value.seq, events };
}
export async function betaRecordingJson(request) {
  check(/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || ""));
  const length = request.headers.get("Content-Length");
  check(!length || /^\d+$/.test(length) && Number(length) <= BETA_RECORDING_LIMITS.requestBytes, "The beta recording request is too large.", 413);
  const reader = request.body?.getReader(); check(reader);
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 8000);
  const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > BETA_RECORDING_LIMITS.requestBytes) { await reader.cancel(); throw new BetaRecordingError("The beta recording request is too large.", 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new BetaRecordingError("Check the beta recording request."); }
  } finally { clearTimeout(timer); }
}
function summary(row) {
  return { sid: row.id, participant: row.owner.slice(0, 12), mode: row.mode, toy: row.toy, viewport: JSON.parse(row.viewport), startedAt: row.created_at, expiresAt: row.expires_at, retainedUntil: row.retained_until, consentVersion: row.consent_version, state: row.state === "active" && Date.now() >= row.expires_at ? "finished" : row.state, durationMs: row.last_t, eventCount: row.event_count, bytes: row.bytes, seq: row.seq };
}

/** One central object serializes quotas across participants. It is not publicly addressable. */
export class BetaRecordings {
  constructor(ctx, _env) { this.ctx = ctx; this.storage = ctx.storage; this.sql = ctx.storage.sql; this.initialized = false; this.queue = Promise.resolve(); }
  rows(query, ...values) { return this.sql.exec(query, ...values).toArray(); }
  exclusive(task) { const next = this.queue.then(task, task); this.queue = next.catch(() => {}); return next; }
  initialize() {
    if (this.initialized) return;
    this.sql.exec("PRAGMA foreign_keys=ON");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS beta_sessions (id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_id TEXT NOT NULL,start_fingerprint TEXT NOT NULL,consent_version TEXT NOT NULL,mode TEXT NOT NULL,toy TEXT NOT NULL,viewport TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,retained_until INTEGER NOT NULL,state TEXT NOT NULL,seq INTEGER NOT NULL DEFAULT 0,last_t INTEGER NOT NULL DEFAULT 0,event_count INTEGER NOT NULL DEFAULT 0,bytes INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,request_id))`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS beta_retention_idx ON beta_sessions(retained_until)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS beta_owner_idx ON beta_sessions(owner,created_at)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS beta_batches (sid TEXT NOT NULL REFERENCES beta_sessions(id) ON DELETE CASCADE,seq INTEGER NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(sid,seq))`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS beta_rates (owner TEXT NOT NULL,period TEXT NOT NULL,starts_at INTEGER NOT NULL,count INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(owner,period))");
    this.initialized = true;
  }
  purge(now) { this.sql.exec("DELETE FROM beta_sessions WHERE retained_until<=?", now); this.sql.exec("DELETE FROM beta_rates WHERE expires_at<=?", now); }
  async schedule() {
    const next = this.rows("SELECT MIN(expiry) expiry FROM (SELECT retained_until expiry FROM beta_sessions UNION ALL SELECT expires_at expiry FROM beta_rates)")[0]?.expiry;
    if (Number.isSafeInteger(next)) await this.storage.setAlarm(next);
    else if (this.storage.deleteAlarm) await this.storage.deleteAlarm();
  }
  async start(owner, body, now) {
    const value = normalizeBetaStart(body), fingerprint = await digest(JSON.stringify(value));
    const result = this.storage.transactionSync(() => {
      this.purge(now);
      const prior = this.rows("SELECT * FROM beta_sessions WHERE owner=? AND request_id=?", owner, value.idempotencyKey)[0];
      if (prior) { check(prior.state !== "withdrawn" && prior.start_fingerprint === fingerprint, "This recording request has already changed or been withdrawn.", 409); return { row: prior, duplicate: true }; }
      check(this.rows("SELECT COUNT(*) n FROM beta_sessions WHERE state<>'withdrawn'")[0].n < 2000 && this.rows("SELECT COUNT(*) n FROM beta_sessions WHERE owner=? AND state<>'withdrawn'", owner)[0].n < 100, "The retained beta recording limit has been reached.", 429);
      check(this.rows("SELECT COALESCE(SUM(bytes),0) n FROM beta_sessions")[0].n < BETA_RECORDING_LIMITS.totalBytes, "Beta recording storage is full. Your reader still works.", 429);
      const windows = [{ period: "hour", duration: 3600000, limit: 12 }, { period: "day", duration: 86400000, limit: 60 }].map(window => {
        const starts = Math.floor(now / window.duration) * window.duration;
        const old = this.rows("SELECT count FROM beta_rates WHERE owner=? AND period=? AND starts_at=?", owner, window.period, starts)[0];
        check((old?.count || 0) < window.limit, "Please try beta recording again later.", 429);
        return { ...window, starts, count: (old?.count || 0) + 1 };
      });
      for (const window of windows) this.sql.exec("INSERT INTO beta_rates(owner,period,starts_at,count,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,period) DO UPDATE SET starts_at=excluded.starts_at,count=excluded.count,expires_at=excluded.expires_at", owner, window.period, window.starts, window.count, window.starts + window.duration);
      const id = crypto.randomUUID();
      this.sql.exec("INSERT INTO beta_sessions(id,owner,request_id,start_fingerprint,consent_version,mode,toy,viewport,created_at,expires_at,retained_until,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id, owner, value.idempotencyKey, fingerprint, BETA_RECORDING_CONSENT, value.mode, value.toy, JSON.stringify(value.viewport), now, now + BETA_RECORDING_LIMITS.durationMs, now + BETA_RECORDING_RETENTION_MS, "active");
      return { row: this.rows("SELECT * FROM beta_sessions WHERE id=?", id)[0], duplicate: false };
    });
    await this.schedule();
    return json({ ok: true, sid: result.row.id, seq: result.row.seq, maxDurationMs: BETA_RECORDING_LIMITS.durationMs, maxEvents: BETA_RECORDING_LIMITS.events, maxBatchEvents: BETA_RECORDING_LIMITS.batchEvents, expiresAt: result.row.expires_at, retainedUntil: result.row.retained_until, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  }
  async append(owner, body, now) {
    const value = normalizeBetaAppend(body), payload = JSON.stringify(value.events), bytes = byteLength(payload), fingerprint = await digest(payload);
    const result = this.storage.transactionSync(() => {
      this.purge(now);
      const session = this.rows("SELECT * FROM beta_sessions WHERE id=? AND owner=? AND state<>'withdrawn'", value.sid, owner)[0];
      check(session, "This beta recording is unavailable.", 404);
      const old = this.rows("SELECT fingerprint FROM beta_batches WHERE sid=? AND seq=?", value.sid, value.seq)[0];
      if (old) { check(old.fingerprint === fingerprint, "A changed recording batch cannot replace an earlier one.", 409); return { seq: value.seq, duplicate: true }; }
      check(session.state === "active" && now < session.expires_at, "This beta recording has stopped. Start a new recording to continue.", 409);
      check(value.seq === session.seq + 1 && value.events[0].t >= session.last_t, "Send recording batches in order.", 409);
      const last = value.events.at(-1).t;
      check(last <= Math.min(BETA_RECORDING_LIMITS.durationMs, Math.max(0, now - session.created_at) + 5000), "The recording clock is out of range.");
      check(session.event_count + value.events.length <= BETA_RECORDING_LIMITS.events && session.bytes + bytes <= BETA_RECORDING_LIMITS.sessionBytes, "This beta recording has reached its limit.", 429);
      check(this.rows("SELECT COALESCE(SUM(bytes),0) n FROM beta_sessions")[0].n + bytes <= BETA_RECORDING_LIMITS.totalBytes, "Beta recording storage is full. Your reader still works.", 429);
      this.sql.exec("INSERT INTO beta_batches(sid,seq,fingerprint,payload) VALUES(?,?,?,?)", value.sid, value.seq, fingerprint, payload);
      const chosen = value.events.filter(event => event.type === "device").at(-1);
      this.sql.exec("UPDATE beta_sessions SET seq=?,last_t=?,event_count=event_count+?,bytes=bytes+?,mode=?,toy=? WHERE id=?", value.seq, last, value.events.length, bytes, chosen?.mode || session.mode, chosen?.toy || session.toy, value.sid);
      return { seq: value.seq, duplicate: false };
    });
    await this.schedule(); return json({ ok: true, ...result });
  }
  async end(owner, body, action, founder = false) {
    check(exact(body, founder ? ["sid", "confirm"] : ["action", "sid"]) && Object.keys(body).length === 2 && typeof body.sid === "string" && UUID.test(body.sid) && (founder ? body.confirm === true : body.action === action));
    const sid = body.sid.toLowerCase();
    const row = this.rows(`SELECT id FROM beta_sessions WHERE id=?${founder ? "" : " AND owner=?"}`, ...[sid, ...(founder ? [] : [owner])])[0];
    check(row, "This beta recording is unavailable.", 404);
    this.storage.transactionSync(() => {
      if (action === "stop") this.sql.exec("UPDATE beta_sessions SET state='stopped' WHERE id=? AND state='active'", sid);
      else {
        this.sql.exec("DELETE FROM beta_batches WHERE sid=?", sid);
        // An opaque tombstone prevents late retries from restoring withdrawn content.
        this.sql.exec("UPDATE beta_sessions SET state='withdrawn',mode='simulator',toy='none',viewport='{}',seq=0,last_t=0,event_count=0,bytes=0 WHERE id=?", sid);
      }
    });
    await this.schedule(); return json({ ok: true, sid, ...(action === "stop" ? { stopped: true } : { deleted: true }) });
  }
  list(url, owner, founder) {
    const allowed = founder ? ["limit", "before", "toy", "mode"] : ["limit", "before"];
    check([...url.searchParams.keys()].every(key => allowed.includes(key)) && new Set(url.searchParams.keys()).size === [...url.searchParams.keys()].length);
    const limitText = url.searchParams.get("limit"), limit = limitText === null ? (founder ? 50 : 20) : Number(limitText);
    check(integer(limit, 1, 100) && (limitText === null || /^\d+$/.test(limitText)));
    const conditions = ["state<>'withdrawn'"], values = [];
    if (!founder) { conditions.push("owner=?"); values.push(owner); }
    for (const [key, enums] of [["toy", BETA_TOYS], ["mode", MODES]]) if (url.searchParams.has(key)) { const value = url.searchParams.get(key); check(enums.includes(value)); conditions.push(`${key}=?`); values.push(value); }
    const before = url.searchParams.get("before");
    if (before) { const match = /^(\d{10,16})\.([a-f0-9-]{36})$/.exec(before); check(match && UUID.test(match[2]) && Number.isSafeInteger(Number(match[1]))); conditions.push("(created_at<? OR (created_at=? AND id<?))"); values.push(Number(match[1]), Number(match[1]), match[2]); }
    const rows = this.rows(`SELECT * FROM beta_sessions WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT ?`, ...values, limit + 1);
    const more = rows.length > limit, page = rows.slice(0, limit), last = page.at(-1);
    return json({ ok: true, sessions: page.map(summary), nextCursor: more && last ? `${last.created_at}.${last.id}` : null, retentionDays: 30, format: "beta-control-timeline-v1" });
  }
  detail(sid, owner, founder) {
    check(UUID.test(sid), "This beta recording is unavailable.", 404);
    const row = this.rows(`SELECT * FROM beta_sessions WHERE id=? AND state<>'withdrawn'${founder ? "" : " AND owner=?"}`, ...[sid, ...(founder ? [] : [owner])])[0]; check(row, "This beta recording is unavailable.", 404);
    const batches = this.rows("SELECT seq,payload FROM beta_batches WHERE sid=? ORDER BY seq", sid), events = [];
    let sequence = 0, last = 0;
    for (const batch of batches) {
      check(batch.seq === ++sequence, "This recording is incomplete.", 409);
      let values; try { values = JSON.parse(batch.payload); } catch { throw new BetaRecordingError("This recording is unavailable.", 409); }
      check(Array.isArray(values) && values.length > 0 && values.length <= BETA_RECORDING_LIMITS.batchEvents, "This recording is unavailable.", 409);
      for (const value of values) {
        let safe; try { safe = normalizeBetaEvent(value); } catch { throw new BetaRecordingError("This recording is incomplete.", 409); }
        check(safe.t >= last, "This recording is incomplete.", 409); last = safe.t; events.push(safe);
      }
    }
    check(events.length === row.event_count && events.length <= BETA_RECORDING_LIMITS.events, "This recording is incomplete.", 409);
    return json({ ok: true, format: "beta-control-timeline-v1", session: summary(row), events, scope: "SatinLore opted-in beta control timeline", privateText: "excluded", physicalOutput: "not measured" });
  }
  async handle(request) {
    const url = new URL(request.url), owner = request.headers.get("X-SatinLore-Participant"), role = request.headers.get("X-SatinLore-Role"), founder = role === "founder";
    check(url.origin === "https://beta-recordings.internal" && request.headers.get("Origin") === BETA_RECORDING_ORIGIN && OWNER.test(owner || "") && ["founder", "reader"].includes(role), "Not found.", 404);
    this.initialize(); this.purge(Date.now());
    const admin = url.pathname.startsWith("/api/admin/");
    if (admin) check(founder, "Founder access required.", 403);
    if (request.method === "GET") {
      if (["/api/beta/recordings", "/api/admin/beta-recordings"].includes(url.pathname)) return this.list(url, owner, admin);
      const match = /^\/api\/(?:admin\/beta-recordings|beta\/recordings)\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (match) { check(!url.search); return this.detail(match[1], owner, admin); }
    }
    check(!url.search);
    if (request.method === "POST" && url.pathname === "/api/admin/beta-recordings/delete") return this.end(owner, await betaRecordingJson(request), "withdraw", true);
    if (request.method === "POST" && url.pathname === "/api/beta/recordings") {
      const body = await betaRecordingJson(request);
      if (body?.action === "start") return this.start(owner, body, Date.now());
      if (body?.action === "append") return this.append(owner, body, Date.now());
      if (["stop", "withdraw"].includes(body?.action)) return this.end(owner, body, body.action);
      throw new BetaRecordingError("Choose a supported beta recording action.");
    }
    return json({ error: "Not found." }, 404);
  }
  async fetch(request) { return this.exclusive(async () => { try { return await this.handle(request); } catch (error) { if (error instanceof BetaRecordingError) return json({ error: error.message }, error.status); return json({ error: "Beta recording is temporarily unavailable. Your reader still works." }, 503); } }); }
  async alarm() { return this.exclusive(async () => { this.initialize(); this.purge(Date.now()); await this.schedule(); }); }
}

/** Called only after the host Worker's signed Access verification. Identity is never accepted from JSON. */
export async function handleBetaRecordings(request, env, { config, session } = {}) {
  const url = new URL(request.url);
  if (!/^\/api\/(?:beta\/recordings|admin\/beta-recordings)(?:\/|$)/.test(url.pathname)) return null;
  if (url.origin !== BETA_RECORDING_ORIGIN || config?.origin !== BETA_RECORDING_ORIGIN) return json({ error: "Recordings are available only on the beta host." }, 404);
  if (!session || typeof session.subject !== "string" || !session.subject || session.subject.length > 256 || !Number.isSafeInteger(session.expiresAt) || Date.now() >= session.expiresAt) return json({ error: "Please sign in again." }, 403);
  const admin = url.pathname.startsWith("/api/admin/");
  if (admin && session.isFounder !== true) return json({ error: "Founder access required." }, 403);
  if (request.method === "POST" && (request.headers.get("Origin") !== BETA_RECORDING_ORIGIN || ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site")))) return json({ error: "Use the controls on the beta website." }, 403);
  if (!env.BETA_RECORDINGS?.idFromName || !env.BETA_RECORDINGS?.get) return json({ error: "Beta recording storage is not configured. Your reader still works." }, 503);
  try {
    const owner = await digest(`satinlore:beta-recordings:v1:${config.issuer}:${session.subject}`);
    if (Date.now() >= session.expiresAt) return json({ error: "Please sign in again." }, 403);
    const headers = new Headers({ Origin: BETA_RECORDING_ORIGIN, "X-SatinLore-Participant": owner, "X-SatinLore-Role": session.isFounder === true ? "founder" : "reader" });
    let body;
    if (request.method === "POST") { body = await betaRecordingJson(request); headers.set("Content-Type", "application/json"); }
    const stub = env.BETA_RECORDINGS.get(env.BETA_RECORDINGS.idFromName("beta-recordings-v1"));
    return await stub.fetch(new Request(`https://beta-recordings.internal${url.pathname}${url.search}`, { method: request.method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  } catch (error) { return json({ error: error instanceof BetaRecordingError ? error.message : "Beta recording is temporarily unavailable. Your reader still works." }, error instanceof BetaRecordingError ? error.status : 503); }
}
