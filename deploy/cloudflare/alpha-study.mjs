import {
  ALPHA_ORIGIN, ALPHA_COOKIE, ALPHA_CONSENT, LEGACY_ALPHA_CONSENT, ALPHA_CLIP_CONSENT, AUTH_MS, STUDY_MS, RETENTION_MS,
  CLIP_RETENTION_MS, CLIP_LIMIT, USERNAMES, MODES, UUID, HASH, AlphaError, json, check, exact, integer,
  bytes, hex, digest, readBody, readJson, normalizeAlphaEvent, normalizeFeedback, normalizeAnnotation, validAlphaModel,
} from "./alpha-contract.mjs";

const INTERNAL = "https://alpha-study.internal";
const API = "/api/alpha";
const PASSWORD = /^[A-Za-z0-9_-]{43}$/;
const GLOBAL_LIMIT = 100;
const SESSION_EVENT_LIMIT = 20000;
const SESSION_BYTE_LIMIT = 4 * 1024 * 1024;
const TOTAL_EVENT_LIMIT = 64 * 1024 * 1024;
const TOTAL_CLIP_LIMIT = 96 * 1024 * 1024;
const CLIP_PART = 512 * 1024;
const LIMIT_WINDOW = 10 * 60_000;
const SESSION_ROUTE = new RegExp(`^${API}/(admin/)?sessions(?:/(${UUID.source.slice(1, -1)})(?:/(events|finish|feedback|annotations|withdraw|clip))?)?$`);
const AUTH_METHODS = new Map([[`${API}/auth`, ["GET", "HEAD"]], [`${API}/login`, ["POST"]], [`${API}/logout`, ["POST"]]]);

function credentials(env) {
  const dilan = env.ALPHA_DILAN_VERIFIER, sadie = env.ALPHA_SADIE_VERIFIER;
  if (typeof dilan !== "string" || typeof sadie !== "string" || !HASH.test(dilan) || !HASH.test(sadie) ||
      dilan === sadie || /^0+$/.test(dilan) || /^0+$/.test(sadie)) return null;
  return { Dilan: dilan, Sadie: sadie };
}

export function alphaConfigured(env) {
  return Boolean(credentials(env) && typeof env.ALPHA_STUDY?.idFromName === "function" && typeof env.ALPHA_STUDY?.get === "function");
}

function tokenFromRequest(request) {
  const cookie = request.headers.get("Cookie") || "";
  if (cookie.length > 16384) return null;
  const matches = cookie.split(";").map(part => part.trim()).filter(part => part.startsWith(`${ALPHA_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(ALPHA_COOKIE.length + 1);
  return HASH.test(token) ? token : null;
}

function cookie(token = "", maxAge = 0) {
  return `${ALPHA_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

function alphaHeaders(request) {
  const headers = new Headers();
  const token = tokenFromRequest(request);
  if (token) headers.set("X-Alpha-Session", token);
  for (const name of ["Content-Type", "Content-Length", "Range", "X-Alpha-Clip-Consent", "X-Alpha-Clip-Duration-Ms", "X-Alpha-Clip-Offset-Ms"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function stub(env) { return env.ALPHA_STUDY.get(env.ALPHA_STUDY.idFromName("alpha-study-v1")); }
function unavailable() { return json({ error: "Alpha sign-in is waiting for private setup." }, 503); }

export async function handleAlphaApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${API}/`)) return null;
  if (url.origin !== ALPHA_ORIGIN) return json({ error: "Use the alpha on the SatinLore app." }, 403);
  if (!alphaConfigured(env)) return unavailable();
  if (["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site")) ||
      request.method === "POST" && request.headers.get("Origin") !== ALPHA_ORIGIN) {
    return json({ error: "Use the controls on the alpha website." }, 403);
  }
  if (url.search.length > 100 || !["GET", "HEAD", "POST"].includes(request.method)) return json({ error: "This alpha request is not supported." }, 405);
  try {
    const headers = alphaHeaders(request);
    if (url.pathname === `${API}/login`) {
      // This trust-boundary header is derived from the platform's connecting IP.
      // Only the rate key is retained, for one short window.
      const address = (request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 64);
      headers.set("X-Alpha-Rate-Key", await digest(`satinlore:alpha:login:v1:${credentials(env).Dilan}:${address}`));
    }
    return await stub(env).fetch(new Request(`${INTERNAL}${url.pathname}${url.search}`, {
      method: request.method, headers, ...(request.method === "POST" ? { body: request.body, duplex: "half" } : {}),
    }));
  } catch { return json({ error: "Alpha storage is temporarily unavailable. Try again." }, 503); }
}

export async function verifyAlphaSession(request, env) {
  if (new URL(request.url).origin !== ALPHA_ORIGIN || !alphaConfigured(env) || !tokenFromRequest(request)) return null;
  try {
    const response = await stub(env).fetch(new Request(`${INTERNAL}${API}/auth`, { headers: alphaHeaders(request) }));
    if (!response.ok) return null;
    const info = await response.json();
    if (info.authenticated !== true || !USERNAMES.includes(info.username) || !integer(info.expiresAt, Date.now() + 1, Number.MAX_SAFE_INTEGER)) return null;
    return { username: info.username, subject: `alpha:${info.username.toLowerCase()}`, isFounder: info.username === "Dilan", expiresAt: info.expiresAt };
  } catch { return null; }
}

function hashEqual(left, right) {
  if (!HASH.test(left) || !HASH.test(right)) return false;
  let mismatch = 0;
  for (let index = 0; index < 64; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

const credentialTag = verifier => digest(`satinlore:alpha:credential:v1:${verifier}`);

function authInfo(auth) {
  return { authenticated: Boolean(auth), ...(auth ? { username: auth.username, isFounder: auth.username === "Dilan", expiresAt: auth.expires_at } : {}),
    consentVersion: ALPHA_CONSENT, clipConsentVersion: ALPHA_CLIP_CONSENT };
}

function studySummary(row, now = Date.now()) {
  return { id: row.id, username: row.username, mode: row.mode, state: row.finished_at || row.expires_at <= now ? "finished" : "active",
    ...(validAlphaModel(row.model) ? { model: row.model } : {}),
    consentVersion: row.consent_version, createdAt: row.created_at, expiresAt: row.expires_at, retainedUntil: row.retained_until,
    lastEventAt: row.last_event_at, eventCount: row.event_count, hasFeedback: row.feedback !== null, hasClip: Boolean(row.has_clip) };
}

function clipInfo(row) {
  return { type: row.media_type, bytes: row.bytes, durationMs: row.duration_ms, offsetMs: row.offset_ms,
    createdAt: row.created_at, retainedUntil: row.retained_until };
}

function rangeFor(value, length) {
  if (value === null) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d{0,10})-(\d{0,10})$/.exec(value);
  if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = Math.min(length - 1, match[1] && match[2] ? Number(match[2]) : length - 1);
  return start <= end && start < length ? { start, end, partial: true } : null;
}

function clipMetadata(request) {
  const type = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  check(["video/webm", "video/mp4"].includes(type), "Choose a supported alpha tab clip.", 415);
  check(request.headers.get("X-Alpha-Clip-Consent") === ALPHA_CLIP_CONSENT, "Choose to share this clip before uploading.");
  const duration = request.headers.get("X-Alpha-Clip-Duration-Ms");
  const offset = request.headers.get("X-Alpha-Clip-Offset-Ms") ?? "0";
  check(duration && /^\d{1,5}$/.test(duration) && integer(Number(duration), 1, 60000) && /^\d{1,7}$/.test(offset) &&
    integer(Number(offset), 0, STUDY_MS) && Number(offset) + Number(duration) <= STUDY_MS, "Choose a clip up to one minute long.");
  return { type, durationMs: Number(duration), offsetMs: Number(offset) };
}

export class AlphaStudy {
  constructor(ctx, env) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.env = env;
    this.initialized = false;
    this.clipUploads = new Set();
  }
  rows(query, ...values) { return this.sql.exec(query, ...values).toArray(); }
  one(query, ...values) { return this.rows(query, ...values)[0]; }
  initialize() {
    if (this.initialized) return;
    this.sql.exec("PRAGMA foreign_keys=ON");
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_auth (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, credential_tag TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, request_id TEXT NOT NULL, mode TEXT NOT NULL, consent_version TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, retained_until INTEGER NOT NULL, finished_at INTEGER, seq INTEGER NOT NULL DEFAULT 0, last_event_at INTEGER NOT NULL DEFAULT 0, event_count INTEGER NOT NULL DEFAULT 0, event_bytes INTEGER NOT NULL DEFAULT 0, feedback TEXT, model TEXT, UNIQUE(username, request_id))");
    if (!this.rows("PRAGMA table_info(alpha_sessions)").some(column => column.name === "model")) {
      this.sql.exec("ALTER TABLE alpha_sessions ADD COLUMN model TEXT");
    }
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_batches (session_id TEXT NOT NULL REFERENCES alpha_sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, events TEXT NOT NULL, PRIMARY KEY(session_id, seq))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_annotations (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES alpha_sessions(id) ON DELETE CASCADE, t INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(session_id, t, text))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_clips (session_id TEXT PRIMARY KEY REFERENCES alpha_sessions(id) ON DELETE CASCADE, media_type TEXT NOT NULL, bytes INTEGER NOT NULL, hash TEXT NOT NULL, duration_ms INTEGER NOT NULL, offset_ms INTEGER NOT NULL, consent_version TEXT NOT NULL, created_at INTEGER NOT NULL, retained_until INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_clip_parts (session_id TEXT NOT NULL REFERENCES alpha_clips(session_id) ON DELETE CASCADE, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(session_id, part))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS alpha_withdrawals (id TEXT PRIMARY KEY, username TEXT NOT NULL, request_id TEXT NOT NULL, retained_until INTEGER NOT NULL, UNIQUE(username, request_id))");
    this.initialized = true;
  }

  purge(now) {
    this.sql.exec("DELETE FROM alpha_clips WHERE retained_until<=?", now);
    this.sql.exec("DELETE FROM alpha_sessions WHERE retained_until<=?", now);
    this.sql.exec("DELETE FROM alpha_auth WHERE expires_at<=?", now);
    this.sql.exec("DELETE FROM alpha_attempts WHERE expires_at<=?", now);
    this.sql.exec("DELETE FROM alpha_withdrawals WHERE retained_until<=?", now);
  }

  async schedule(now) {
    const row = this.one(`SELECT MIN(expiry) expiry FROM (
      SELECT MIN(retained_until) expiry FROM alpha_sessions UNION ALL SELECT MIN(retained_until) FROM alpha_clips
      UNION ALL SELECT MIN(expires_at) FROM alpha_auth UNION ALL SELECT MIN(expires_at) FROM alpha_attempts
      UNION ALL SELECT MIN(retained_until) FROM alpha_withdrawals
    )`);
    if (row?.expiry != null) await this.storage.setAlarm(Math.max(now + 100, row.expiry));
    else await this.storage.deleteAlarm();
  }

  async alarm() { this.initialize(); const now = Date.now(); this.purge(now); await this.schedule(now); }

  async authenticate(request) {
    const token = request.headers.get("X-Alpha-Session") || "";
    if (!HASH.test(token)) return null;
    const tokenHash = await digest(token);
    const auth = this.one("SELECT * FROM alpha_auth WHERE token_hash=? AND expires_at>?", tokenHash, Date.now());
    const verifier = auth && credentials(this.env)?.[auth.username];
    if (!verifier || !hashEqual(auth.credential_tag, await credentialTag(verifier))) return null;
    // Logout and expiry can interleave with the digest above.
    return this.one("SELECT * FROM alpha_auth WHERE token_hash=? AND expires_at>?", tokenHash, Date.now()) ?? null;
  }

  loginPermission(rateKey, now) {
    const limits = [[`address:${rateKey}`, 12], ["all", 120]];
    return this.storage.transactionSync(() => {
      for (const [key, limit] of limits) {
        const row = this.one("SELECT count FROM alpha_attempts WHERE key=? AND expires_at>?", key, now);
        if (row?.count >= limit) return false;
      }
      for (const [key] of limits) {
        this.sql.exec(`INSERT INTO alpha_attempts(key,count,expires_at) VALUES(?,1,?)
          ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
          expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`, key, now + LIMIT_WINDOW, now, now);
      }
      return true;
    });
  }

  async login(request) {
    const rateKey = request.headers.get("X-Alpha-Rate-Key") || "";
    check(HASH.test(rateKey), "Use the alpha sign-in page.", 403);
    const now = Date.now();
    if (!this.loginPermission(rateKey, now)) return json({ error: "Too many sign-in attempts. Try again in ten minutes." }, 429, { "Retry-After": "600" });
    await this.schedule(now);
    const value = await readJson(request, 4096);
    check(exact(value, ["username", "password"]) && typeof value.username === "string" && value.username.length <= 32 && typeof value.password === "string" && value.password.length <= 128);
    const username = USERNAMES.find(name => name.toLowerCase() === value.username.trim().toLowerCase());
    const verifier = credentials(this.env)?.[username];
    const passwordHash = await digest(value.password);
    const matches = hashEqual(passwordHash, verifier ?? "0".repeat(64));
    check(username && verifier && PASSWORD.test(value.password) && matches, "The username or password was incorrect.", 401);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await digest(token);
    const tag = await credentialTag(verifier);
    const createdAt = Date.now(), expiresAt = createdAt + AUTH_MS;
    this.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO alpha_auth VALUES(?,?,?,?,?)", tokenHash, username, tag, createdAt, expiresAt);
      this.sql.exec("DELETE FROM alpha_auth WHERE username=? AND token_hash NOT IN (SELECT token_hash FROM alpha_auth WHERE username=? ORDER BY created_at DESC, token_hash DESC LIMIT 5)", username, username);
    });
    await this.schedule(createdAt);
    return json(authInfo({ username, expires_at: expiresAt }), 200, { "Set-Cookie": cookie(token, AUTH_MS / 1000) });
  }

  getSession(id) {
    return this.one("SELECT s.*, EXISTS(SELECT 1 FROM alpha_clips c WHERE c.session_id=s.id) has_clip FROM alpha_sessions s WHERE s.id=?", id);
  }

  list(username) {
    const query = "SELECT s.*, EXISTS(SELECT 1 FROM alpha_clips c WHERE c.session_id=s.id) has_clip FROM alpha_sessions s";
    const order = " ORDER BY s.created_at DESC,s.id DESC LIMIT 100";
    const rows = username ? this.rows(`${query} WHERE s.username=?${order}`, username) : this.rows(`${query}${order}`);
    return json({ sessions: rows.map(row => studySummary(row)) });
  }

  async start(username, value) {
    check(exact(value, ["consentVersion", "mode", "idempotencyKey", "model"], ["consentVersion", "mode", "idempotencyKey"]) && value.consentVersion === ALPHA_CONSENT,
      "Choose alpha recording explicitly before starting.");
    check(MODES.includes(value.mode) && typeof value.idempotencyKey === "string" && UUID.test(value.idempotencyKey) &&
      (value.model === undefined || validAlphaModel(value.model)));
    const now = Date.now(), requestId = value.idempotencyKey;
    const result = this.storage.transactionSync(() => {
      const old = this.one("SELECT * FROM alpha_sessions WHERE username=? AND request_id=?", username, requestId);
      if (old) {
        check(old.mode === value.mode && old.model === (value.model ?? null) && old.consent_version === ALPHA_CONSENT, "This session start was already used.", 409);
        return { row: old, duplicate: true };
      }
      check(!this.one("SELECT id FROM alpha_withdrawals WHERE username=? AND request_id=?", username, requestId), "This session was deleted.", 410);
      check(this.one("SELECT COUNT(*) count FROM alpha_sessions").count < GLOBAL_LIMIT, "Alpha storage is full. Delete an earlier session to continue.", 507);
      const id = crypto.randomUUID();
      this.sql.exec("INSERT INTO alpha_sessions(id,username,request_id,mode,consent_version,created_at,expires_at,retained_until,model) VALUES(?,?,?,?,?,?,?,?,?)",
        id, username, requestId, value.mode, ALPHA_CONSENT, now, now + STUDY_MS, now + RETENTION_MS, value.model ?? null);
      return { row: this.getSession(id), duplicate: false };
    });
    await this.schedule(now);
    return json({ id: result.row.id, seq: result.row.seq, expiresAt: result.row.expires_at, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  }

  append(row, value) {
    check(exact(value, ["seq", "events"]) && integer(value.seq, 1, SESSION_EVENT_LIMIT) && Array.isArray(value.events) && value.events.length >= 1 && value.events.length <= 100);
    const events = value.events.map(normalizeAlphaEvent);
    if (events.some(event => event.type === "screen" || event.type === "pointer")) {
      check(row.consent_version === ALPHA_CONSENT, "Start a session with the current recording choice to save the replay.", 403);
    }
    for (let index = 1; index < events.length; index++) check(events[index].t >= events[index - 1].t, "Keep alpha events in time order.");
    const encoded = JSON.stringify(events), length = bytes(encoded);
    const updated = this.storage.transactionSync(() => {
      const current = this.getSession(row.id);
      check(current, "This alpha session is unavailable.", 404);
      if (value.seq <= current.seq) {
        const existing = this.one("SELECT events FROM alpha_batches WHERE session_id=? AND seq=?", current.id, value.seq);
        check(existing?.events === encoded, "This event batch conflicts with the saved timeline.", 409);
        return { current, duplicate: true };
      }
      check(!current.finished_at && current.expires_at > Date.now(), "This alpha session has finished.", 409);
      check(value.seq === current.seq + 1 && events[0].t >= current.last_event_at, "This batch is out of order. Retry the earlier batch.", 409);
      check(current.event_count + events.length <= SESSION_EVENT_LIMIT && current.event_bytes + length <= SESSION_BYTE_LIMIT,
        "This session has reached its recording limit.", 507);
      check(this.one("SELECT COALESCE(SUM(event_bytes),0) total FROM alpha_sessions").total + length <= TOTAL_EVENT_LIMIT, "Alpha storage is full.", 507);
      const t = events.at(-1).t;
      this.sql.exec("INSERT INTO alpha_batches VALUES(?,?,?)", current.id, value.seq, encoded);
      this.sql.exec("UPDATE alpha_sessions SET seq=?,last_event_at=?,event_count=event_count+?,event_bytes=event_bytes+? WHERE id=?", value.seq, t, events.length, length, current.id);
      return { current: this.getSession(current.id), duplicate: false };
    });
    return json({ id: row.id, seq: value.seq, eventCount: updated.current.event_count, lastEventAt: updated.current.last_event_at, duplicate: updated.duplicate });
  }

  detail(row) {
    const events = this.rows("SELECT events FROM alpha_batches WHERE session_id=? ORDER BY seq", row.id).flatMap(batch => JSON.parse(batch.events));
    const annotations = this.rows("SELECT id,t,text,created_at createdAt FROM alpha_annotations WHERE session_id=? ORDER BY t,created_at,id", row.id);
    const clip = this.one("SELECT * FROM alpha_clips WHERE session_id=?", row.id);
    return json({ session: studySummary(row), events, feedback: row.feedback ? JSON.parse(row.feedback) : null, annotations, clip: clip ? clipInfo(clip) : null });
  }

  async withdraw(row) {
    this.storage.transactionSync(() => {
      this.sql.exec("INSERT OR IGNORE INTO alpha_withdrawals VALUES(?,?,?,?)", row.id, row.username, row.request_id, row.retained_until);
      this.sql.exec("DELETE FROM alpha_sessions WHERE id=?", row.id);
    });
    await this.schedule(Date.now());
    return json({ ok: true });
  }

  async shareClip(request, row, auth) {
    check(row.consent_version === LEGACY_ALPHA_CONSENT, "Clip uploads are available only for earlier Alpha sessions.", 405);
    check(studySummary(row).state === "finished", "Finish the session before sharing a clip.", 409);
    const meta = clipMetadata(request);
    const payload = await readBody(request, CLIP_LIMIT, 30000);
    const header = payload.subarray(0, 12);
    const webm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
    const mp4 = header.length >= 12 && String.fromCharCode(...header.subarray(4, 8)) === "ftyp";
    check(meta.type === "video/webm" ? webm : mp4, "The file did not match the selected clip format.", 415);
    const hash = await digest(payload);
    const renewed = await this.authenticate(request);
    check(renewed?.username === auth.username, "Sign in again before sharing the clip.", 401);
    const now = Date.now();
    const clip = this.storage.transactionSync(() => {
      const current = this.getSession(row.id);
      check(current && current.retained_until > now, "This alpha session is unavailable.", 404);
      const old = this.one("SELECT * FROM alpha_clips WHERE session_id=?", row.id);
      if (old && old.retained_until > now && old.hash === hash && old.duration_ms === meta.durationMs && old.offset_ms === meta.offsetMs && old.media_type === meta.type) return old;
      check(this.one("SELECT COALESCE(SUM(bytes),0) total FROM alpha_clips").total - (old?.bytes ?? 0) + payload.length <= TOTAL_CLIP_LIMIT, "Alpha clip storage is full.", 507);
      this.sql.exec("DELETE FROM alpha_clips WHERE session_id=?", row.id);
      this.sql.exec("INSERT INTO alpha_clips VALUES(?,?,?,?,?,?,?,?,?)", row.id, meta.type, payload.length, hash, meta.durationMs, meta.offsetMs,
        ALPHA_CLIP_CONSENT, now, Math.min(current.retained_until, now + CLIP_RETENTION_MS));
      for (let offset = 0, part = 0; offset < payload.length; offset += CLIP_PART, part++) {
        const chunk = payload.slice(offset, offset + CLIP_PART);
        this.sql.exec("INSERT INTO alpha_clip_parts VALUES(?,?,?)", row.id, part, chunk.buffer);
      }
      return this.one("SELECT * FROM alpha_clips WHERE session_id=?", row.id);
    });
    await this.schedule(now);
    return json({ clip: clipInfo(clip) });
  }

  readClip(request, row) {
    const clip = this.one("SELECT * FROM alpha_clips WHERE session_id=?", row.id);
    check(clip && clip.retained_until > Date.now(), "This clip is unavailable.", 404);
    const range = rangeFor(request.headers.get("Range"), clip.bytes);
    const headers = new Headers({ "Content-Type": clip.media_type, "Cache-Control": "no-store", "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" });
    if (!range) {
      headers.set("Content-Range", `bytes */${clip.bytes}`);
      return new Response(null, { status: 416, headers });
    }
    const { start, end, partial } = range;
    headers.set("Content-Length", String(end - start + 1));
    if (partial) headers.set("Content-Range", `bytes ${start}-${end}/${clip.bytes}`);
    let body = null;
    if (request.method !== "HEAD") {
      body = new Uint8Array(end - start + 1);
      for (let part = Math.floor(start / CLIP_PART); part <= Math.floor(end / CLIP_PART); part++) {
        const chunk = this.one("SELECT data FROM alpha_clip_parts WHERE session_id=? AND part=?", row.id, part);
        check(chunk, "This clip is unavailable.", 503);
        const offset = part * CLIP_PART;
        const from = Math.max(start, offset), to = Math.min(end + 1, offset + CLIP_PART);
        body.set(new Uint8Array(chunk.data).subarray(from - offset, to - offset), from - start);
      }
    }
    return new Response(body, { status: partial ? 206 : 200, headers });
  }

  async sessionRequest(request, url, auth) {
    const route = SESSION_ROUTE.exec(url.pathname);
    check(route, "This alpha action is unavailable.", 404);
    const [, adminPath, id, action] = route;
    const admin = Boolean(adminPath);
    check(!admin || auth.username === "Dilan", "Founder access required.", 403);
    const get = request.method === "GET" || request.method === "HEAD";
    check(!get || admin, "Saved Alpha recordings are available to the study reviewer.", 403);
    if (!id && get) {
      const keys = [...url.searchParams.keys()];
      const username = url.searchParams.get("username");
      check(keys.length === 0 || admin && keys.length === 1 && keys[0] === "username" && USERNAMES.includes(username));
      return this.list(username);
    }
    check(!url.search);
    if (!id) {
      check(!admin && request.method === "POST", "This alpha action is unavailable.", 405);
      const value = await readJson(request);
      const renewed = await this.authenticate(request);
      check(renewed?.username === auth.username, "Sign in again to start recording.", 401);
      return this.start(auth.username, value);
    }
    const row = this.getSession(id);
    if (get) {
      check(row && (admin || row.username === auth.username), "This alpha session is unavailable.", 404);
      if (action === "clip") return this.readClip(request, row);
      check(!action, "This alpha action is unavailable.", 405);
      return this.detail(row);
    }
    check(request.method === "POST" && action && (!admin || action === "withdraw"), "This alpha action is unavailable.", 405);
    if (action === "clip") {
      check(row?.username === auth.username, "This alpha session is unavailable.", 404);
      check(this.clipUploads.size < 2 && !this.clipUploads.has(id), "An alpha clip upload is already in progress. Try again shortly.", 409);
      this.clipUploads.add(id);
      try { return await this.shareClip(request, row, auth); }
      finally { this.clipUploads.delete(id); }
    }
    const value = await readJson(request);
    const renewed = await this.authenticate(request);
    check(renewed?.username === auth.username, "Sign in again to save this change.", 401);
    const current = this.getSession(id);
    if (!current && action === "withdraw") {
      check(exact(value, ["confirm"]) && value.confirm === true, "Confirm deletion first.");
      const previous = this.one("SELECT username FROM alpha_withdrawals WHERE id=?", id);
      if (previous && (admin || previous.username === auth.username)) return json({ ok: true });
    }
    check(current && (admin || current.username === auth.username), "This alpha session is unavailable.", 404);
    if (action === "withdraw") {
      check(exact(value, ["confirm"]) && value.confirm === true, "Confirm deletion first.");
      return this.withdraw(current);
    }
    if (action === "events") return this.append(current, value);
    if (action === "finish") {
      check(exact(value, []));
      this.sql.exec("UPDATE alpha_sessions SET finished_at=COALESCE(finished_at,?) WHERE id=?", Date.now(), id);
      return json({ session: studySummary(this.getSession(id)) });
    }
    if (action === "feedback") {
      const feedback = normalizeFeedback(value);
      this.sql.exec("UPDATE alpha_sessions SET feedback=? WHERE id=?", JSON.stringify(feedback), id);
      return json({ feedback });
    }
    check(action === "annotations", "This alpha action is unavailable.", 405);
    const note = normalizeAnnotation(value);
    check(note.t <= current.last_event_at, "Choose a saved time on the session timeline.");
    const existing = this.one("SELECT id,t,text,created_at createdAt FROM alpha_annotations WHERE session_id=? AND t=? AND text=?", id, note.t, note.text);
    if (existing) return json({ annotation: existing });
    check(this.one("SELECT COUNT(*) count FROM alpha_annotations WHERE session_id=?", id).count < 50, "This session has reached its note limit.", 507);
    const annotation = { id: crypto.randomUUID(), t: note.t, text: note.text, createdAt: Date.now() };
    this.sql.exec("INSERT INTO alpha_annotations VALUES(?,?,?,?,?)", annotation.id, id, note.t, note.text, annotation.createdAt);
    return json({ annotation }, 201);
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      check(url.origin === INTERNAL, "This alpha action is unavailable.", 404);
      if (!credentials(this.env)) return unavailable();
      this.initialize();
      this.purge(Date.now());
      const publicMethod = AUTH_METHODS.get(url.pathname);
      if (publicMethod) check(!url.search && publicMethod.includes(request.method), "This alpha action is unavailable.", 405);
      if (url.pathname === `${API}/login`) return await this.login(request);
      const auth = await this.authenticate(request);
      if (url.pathname === `${API}/auth`) return json(authInfo(auth));
      if (url.pathname === `${API}/logout`) {
        check(exact(await readJson(request, 4096), []));
        if (auth) this.sql.exec("DELETE FROM alpha_auth WHERE token_hash=?", auth.token_hash);
        return json({ ok: true }, 200, { "Set-Cookie": cookie() });
      }
      check(auth, "Sign in to the alpha first.", 401);
      return await this.sessionRequest(request, url, auth);
    } catch (error) {
      return error instanceof AlphaError ? json({ error: error.message }, error.status) : json({ error: "Alpha storage is temporarily unavailable. Try again." }, 503);
    }
  }
}
