/** Private hosted feedback only. Identity is selected by the authenticated Worker, never a request field. */
export const FEEDBACK_RETENTION_MS = 30 * 86400000;
export const FEEDBACK_BODY_BYTES = 4096;
export const FEEDBACK_MESSAGE_BYTES = 2048;
export const FEEDBACK_CATEGORIES = Object.freeze(["bug", "idea", "reading", "other"]);
const ORIGIN = "https://app.satinlore.com";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const OWNER = /^[a-f0-9]{64}$/;
const INBOX_LIMIT = 10_000;
export const FEEDBACK_INBOX_NAME = "satinlore:feedback-inbox:v1";
export const FEEDBACK_REVIEW_STATUSES = Object.freeze(["new", "reviewing", "resolved"]);
const RATE_WINDOWS = Object.freeze([
  { name: "minute", duration: 60000, limit: 2 },
  { name: "hour", duration: 3600000, limit: 10 },
  { name: "day", duration: 86400000, limit: 20 },
]);

export class FeedbackError extends Error {
  constructor(message, status = 400, retryAfter = 0) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
function result(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...extraHeaders } });
}
function exactFields(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
}
export function normalizeFeedback(value) {
  if (!exactFields(value, ["idempotencyKey", "category", "message", "rating"])) throw new FeedbackError("Check the feedback fields and try again.");
  if (typeof value.idempotencyKey !== "string" || !UUID.test(value.idempotencyKey)) throw new FeedbackError("Please reopen the feedback form and try again.");
  if (!FEEDBACK_CATEGORIES.includes(value.category)) throw new FeedbackError("Choose a feedback category.");
  if (typeof value.message !== "string" || value.message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.message)) throw new FeedbackError("Use a short note, without story text or private details.");
  const message = value.message.normalize("NFC").trim();
  if (message.length < 5 || new TextEncoder().encode(message).byteLength > FEEDBACK_MESSAGE_BYTES) throw new FeedbackError("Use a note of 5–2,000 characters and no more than 2 KB.");
  const rating = value.rating === undefined || value.rating === null ? null : value.rating;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new FeedbackError("Choose a rating from 1 to 5, or leave it blank.");
  return { idempotencyKey: value.idempotencyKey.toLowerCase(), category: value.category, message, rating };
}
export async function feedbackJson(request) {
  if (request.headers.get("origin") !== ORIGIN || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new FeedbackError("Please use the form on the SatinLore app.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > FEEDBACK_BODY_BYTES)) throw new FeedbackError("The feedback request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackError("Check the feedback fields and try again.");
  const chunks = []; let size = 0;
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 8000);
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > FEEDBACK_BODY_BYTES) { await reader.cancel(); throw new FeedbackError("The feedback request is too large.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new FeedbackError("Check the feedback fields and try again."); }
  } finally { clearTimeout(timeout); }
}
async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify({ category: value.category, message: value.message, rating: value.rating }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function publicRecord(row) {
  return { id: row.id, category: row.category, rating: row.rating, message: row.message, createdAt: row.created_at, expiresAt: row.expires_at };
}
export function normalizeFeedbackReview(value) {
  if (!exactFields(value, ["id", "status"]) || typeof value.id !== "string" || !UUID.test(value.id) || !FEEDBACK_REVIEW_STATUSES.includes(value.status)) {
    throw new FeedbackError("Choose a valid feedback status.");
  }
  return { id: value.id.toLowerCase(), status: value.status };
}

// This instance is selected by a fixed internal name. It holds the same
// retention-limited notes for reader exports and founder review.
class FeedbackInbox {
  constructor(store) { this.store = store; this.sql = store.sql; }
  initialize() {
    if (this.initialized) return;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox_feedback (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, category TEXT NOT NULL, rating INTEGER, message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      UNIQUE(owner,request_id)
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS inbox_owner_created_idx ON inbox_feedback(owner,created_at DESC)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS inbox_created_idx ON inbox_feedback(created_at DESC)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS inbox_expires_idx ON inbox_feedback(expires_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS inbox_rates (owner TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(owner,period))");
    this.sql.exec("CREATE INDEX IF NOT EXISTS inbox_rates_expires_idx ON inbox_rates(expires_at)");
    this.initialized = true;
  }
  purge(now) {
    this.sql.exec("DELETE FROM inbox_feedback WHERE expires_at<=?", now);
    this.sql.exec("DELETE FROM inbox_rates WHERE expires_at<=?", now);
  }
  async scheduleCleanup() {
    const next = this.store.rows("SELECT MIN(expires_at) next_expiry FROM (SELECT expires_at FROM inbox_feedback UNION ALL SELECT expires_at FROM inbox_rates)")[0]?.next_expiry;
    if (Number.isSafeInteger(next)) await this.store.storage.setAlarm(next);
    else await this.store.storage.deleteAlarm();
  }
  async save(owner, value, now) {
    const digest = await fingerprint(value);
    const prior = this.store.rows("SELECT id,fingerprint,created_at,expires_at FROM inbox_feedback WHERE owner=? AND request_id=?", owner, value.idempotencyKey)[0];
    if (prior) return savedRetry(prior, digest);
    if (this.store.rows("SELECT COUNT(*) count FROM inbox_feedback WHERE owner=?", owner)[0].count >= 100) {
      throw new FeedbackError("You have reached the saved feedback limit. You can download or delete your feedback below.", 429);
    }
    if (this.store.rows("SELECT COUNT(*) count FROM inbox_feedback")[0].count >= INBOX_LIMIT) {
      throw new FeedbackError("The feedback inbox is temporarily full. Your note has not been sent.", 503);
    }
    const id = crypto.randomUUID();
    const expiresAt = now + FEEDBACK_RETENTION_MS;
    this.store.storage.transactionSync(() => {
      for (const { name, duration, limit } of RATE_WINDOWS) {
        const endsAt = (Math.floor(now / duration) + 1) * duration;
        const prior = this.store.rows("SELECT count FROM inbox_rates WHERE owner=? AND period=?", owner, name)[0];
        if (prior?.count >= limit) {
          throw new FeedbackError("You have sent a few notes recently. Please try again later.", 429, Math.max(1, Math.ceil((endsAt - now) / 1000)));
        }
        this.sql.exec("INSERT INTO inbox_rates(owner,period,count,expires_at) VALUES(?,?,1,?) ON CONFLICT(owner,period) DO UPDATE SET count=count+1,expires_at=excluded.expires_at", owner, name, endsAt);
      }
      this.sql.exec("INSERT INTO inbox_feedback(id,owner,request_id,fingerprint,category,rating,message,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)", id, owner, value.idempotencyKey, digest, value.category, value.rating, value.message, now, expiresAt);
    });
    return { ok: true, id, duplicate: false, createdAt: now, expiresAt };
  }
  async handle(request, path) {
    const now = Date.now();
    if (path === "/internal/inbox/review") {
      if (!["GET", "PATCH"].includes(request.method)) return result({ error: "Method not allowed." }, 405, { Allow: "GET, PATCH" });
      const update = request.method === "PATCH" ? normalizeFeedbackReview(await feedbackJson(request)) : null;
      this.initialize();
      this.purge(now);
      if (!update) {
        const notes = this.store.rows("SELECT * FROM inbox_feedback ORDER BY created_at DESC,id LIMIT 201");
        return result({ feedback: notes.slice(0, 200).map(row => ({ ...publicRecord(row), status: row.status })), limited: notes.length > 200 });
      }
      const updated = this.store.rows("UPDATE inbox_feedback SET status=? WHERE id=? RETURNING id", update.status, update.id)[0];
      return updated ? result({ ok: true, ...update }) : result({ error: "This note has expired or was deleted." }, 404);
    }
    const owner = request.headers.get("X-Feedback-Owner") || "";
    if (!OWNER.test(owner)) return result({ error: "Not found." }, 404);
    const write = request.method === "POST";
    const valid = path === "/internal/inbox/feedback" ? ["GET", "POST"].includes(request.method) : path === "/internal/inbox/delete" && write;
    if (!valid) return result({ error: "Not found." }, 404);
    const value = write ? await feedbackJson(request) : null;
    this.initialize();
    this.purge(now);
    if (path === "/internal/inbox/delete") {
      if (!exactFields(value, ["confirm"]) || value.confirm !== true) throw new FeedbackError("Confirm that you want to delete your saved feedback.");
      this.sql.exec("DELETE FROM inbox_feedback WHERE owner=?", owner);
      await this.scheduleCleanup();
      return result({ ok: true, deleted: true });
    }
    if (write) {
      const saved = await this.save(owner, normalizeFeedback(value), now);
      await this.scheduleCleanup();
      return result(saved, saved.duplicate ? 200 : 201);
    }
    const feedback = this.store.rows("SELECT * FROM inbox_feedback WHERE owner=? ORDER BY created_at DESC,id LIMIT 100", owner)
      .map(row => ({ ...publicRecord(row), status: row.status }));
    return result({ feedback });
  }
}
function savedRetry(prior, digest) {
  if (prior.fingerprint !== digest) throw new FeedbackError("That retry belongs to a different note. Reopen the form to send a new one.", 409);
  return { ok: true, id: prior.id, duplicate: true, createdAt: prior.created_at, expiresAt: prior.expires_at };
}

/** Fetch-style Durable Object; plain classes remain supported without exposing public RPC methods. */
export class PrivateFeedback {
  constructor(ctx, _env) {
    this.ctx = ctx; this.storage = ctx.storage; this.sql = ctx.storage.sql;
    this.initialized = false; this.queue = Promise.resolve();
    this.inbox = new FeedbackInbox(this);
  }
  exclusive(task) {
    const pending = this.queue.then(task, task);
    this.queue = pending.catch(() => {});
    return pending;
  }
  initialize() {
    if (this.initialized) return;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
      category TEXT NOT NULL, rating INTEGER, message TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS feedback_expires_idx ON feedback(expires_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS rate_windows (period TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
    this.initialized = true;
  }
  rows(query, ...values) { return this.sql.exec(query, ...values).toArray(); }
  purge(now) {
    this.sql.exec("DELETE FROM feedback WHERE expires_at<=?", now);
    this.sql.exec("DELETE FROM rate_windows WHERE expires_at<=?", now);
  }
  async scheduleCleanup() {
    const rows = this.rows("SELECT MIN(expires_at) next_expiry FROM (SELECT expires_at FROM feedback UNION ALL SELECT expires_at FROM rate_windows)");
    const next = rows[0]?.next_expiry;
    if (Number.isSafeInteger(next)) await this.storage.setAlarm(next);
    else { await this.storage.deleteAll(); this.initialized = false; }
  }
  async save(value, now) {
    const digest = await fingerprint(value);
    const outcome = this.storage.transactionSync(() => {
      this.purge(now);
      const prior = this.rows("SELECT id,fingerprint,created_at,expires_at FROM feedback WHERE request_id=?", value.idempotencyKey)[0];
      if (prior) return savedRetry(prior, digest);
      if (this.rows("SELECT COUNT(*) count FROM feedback")[0].count >= 100) throw new FeedbackError("You have reached the saved feedback limit. You can download or delete your feedback below.", 429);
      let retryAt = 0;
      const windows = RATE_WINDOWS.map(window => {
        const startsAt = Math.floor(now / window.duration) * window.duration;
        const row = this.rows("SELECT starts_at,count FROM rate_windows WHERE period=?", window.name)[0];
        const count = row?.starts_at === startsAt ? row.count : 0;
        if (count >= window.limit) retryAt = Math.max(retryAt, startsAt + window.duration);
        return { ...window, startsAt, count };
      });
      if (retryAt) throw new FeedbackError("You have sent a few notes recently. Please try again later.", 429, Math.max(1, Math.ceil((retryAt - now) / 1000)));
      for (const window of windows) this.sql.exec("INSERT INTO rate_windows(period,starts_at,count,expires_at) VALUES(?,?,?,?) ON CONFLICT(period) DO UPDATE SET starts_at=excluded.starts_at,count=excluded.count,expires_at=excluded.expires_at", window.name, window.startsAt, window.count + 1, window.startsAt + window.duration);
      const record = { id: crypto.randomUUID(), createdAt: now, expiresAt: now + FEEDBACK_RETENTION_MS };
      this.sql.exec("INSERT INTO feedback(id,request_id,fingerprint,category,rating,message,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)", record.id, value.idempotencyKey, digest, value.category, value.rating, value.message, record.createdAt, record.expiresAt);
      return { ok: true, ...record, duplicate: false };
    });
    // The acknowledgement follows both the durable write and its expiry alarm.
    await this.scheduleCleanup();
    return outcome;
  }
  async handle(request) {
    const url = new URL(request.url);
    if (url.search || (request.headers.get("origin") && request.headers.get("origin") !== ORIGIN)) return result({ error: "Please use the form on the SatinLore app." }, 400);
    if (url.pathname.startsWith("/internal/inbox/")) {
      if (url.origin !== "https://feedback.internal" || request.headers.get("origin") !== ORIGIN) return result({ error: "Not found." }, 404);
      return this.inbox.handle(request, url.pathname);
    }
    if (url.pathname === "/internal/legacy-retry" && url.origin === "https://feedback.internal" && request.method === "POST") {
      const value = normalizeFeedback(await feedbackJson(request));
      if (!this.initialized && !this.rows("SELECT name FROM sqlite_master WHERE name='feedback'").length) return result({ found: false }, 404);
      const prior = this.rows("SELECT id,fingerprint,created_at,expires_at FROM feedback WHERE request_id=? AND expires_at>?", value.idempotencyKey, Date.now())[0];
      return prior ? result(savedRetry(prior, await fingerprint(value))) : result({ found: false }, 404);
    }
    if (url.pathname === "/internal/lovense-rate") {
      // Invoked only by the authenticated Worker in an independent per-UID object.
      // It retains bounded counters, never vendor tokens, identities or messages.
      if (url.origin !== "https://feedback.internal" || request.method !== "POST" || request.headers.get("origin") !== ORIGIN) return result({ error: "Not found." }, 404);
      const value = await feedbackJson(request);
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) return result({ error: "Invalid connection request." }, 400);
      this.initialize();
      const now = Date.now();
      const outcome = this.storage.transactionSync(() => {
        this.purge(now);
        const windows = [{ name: "lovense-minute", duration: 60_000, limit: 3 }, { name: "lovense-hour", duration: 3_600_000, limit: 20 }].map(window => {
          const startsAt = Math.floor(now / window.duration) * window.duration;
          const prior = this.rows("SELECT starts_at,count FROM rate_windows WHERE period=?", window.name)[0];
          return { ...window, startsAt, count: prior?.starts_at === startsAt ? prior.count : 0 };
        });
        const denied = windows.filter(window => window.count >= window.limit);
        if (denied.length) return Math.max(...denied.map(window => window.startsAt + window.duration));
        for (const window of windows) this.sql.exec("INSERT INTO rate_windows(period,starts_at,count,expires_at) VALUES(?,?,?,?) ON CONFLICT(period) DO UPDATE SET starts_at=excluded.starts_at,count=excluded.count,expires_at=excluded.expires_at", window.name, window.startsAt, window.count + 1, window.startsAt + window.duration);
        return 0;
      });
      await this.scheduleCleanup();
      return outcome ? result({ error: "Try again shortly." }, 429, { "Retry-After": String(Math.max(1, Math.ceil((outcome - now) / 1000))) }) : result({ ok: true });
    }
    if (!["/api/feedback", "/api/my-data", "/api/my-data/delete"].includes(url.pathname)) return result({ error: "Not found." }, 404);
    const read = request.method === "GET" && ["/api/feedback", "/api/my-data"].includes(url.pathname);
    const write = request.method === "POST" && ["/api/feedback", "/api/my-data/delete"].includes(url.pathname);
    if (!read && !write) return result({ error: "Method not allowed." }, 405, { Allow: url.pathname === "/api/my-data" ? "GET" : url.pathname === "/api/my-data/delete" ? "POST" : "GET, POST" });
    let body;
    if (write) body = await feedbackJson(request);
    this.initialize();
    const now = Date.now();
    if (url.pathname === "/api/my-data/delete") {
      if (!exactFields(body, ["confirm"]) || body.confirm !== true) throw new FeedbackError("Confirm that you want to delete your saved feedback.");
      this.storage.transactionSync(() => { this.purge(now); this.sql.exec("DELETE FROM feedback"); });
      // Short-lived quota counters contain no messages and must survive a user
      // clearing feedback, so deletion cannot reset the write limit.
      await this.scheduleCleanup();
      return result({ ok: true, deleted: true });
    }
    if (request.method === "POST") {
      const saved = await this.save(normalizeFeedback(body), now);
      return result(saved, saved.duplicate ? 200 : 201);
    }
    this.storage.transactionSync(() => this.purge(now));
    const feedback = this.rows("SELECT id,category,rating,message,created_at,expires_at FROM feedback ORDER BY created_at DESC,id LIMIT 100").map(publicRecord);
    await this.scheduleCleanup();
    if (url.pathname === "/api/my-data") return result({ scope: "SatinLore app feedback", exportedAt: now, feedback }, 200, { "Content-Disposition": 'attachment; filename="satinlore-feedback.json"' });
    return result({ feedback });
  }
  fetch(request) {
    return this.exclusive(async () => {
      try { return await this.handle(request); }
      catch (error) {
        if (error instanceof FeedbackError) return result({ error: error.message }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
        return result({ error: "We could not confirm this just now. Please try again." }, 503);
      }
    });
  }
  alarm() {
    return this.exclusive(async () => {
      if (this.rows("SELECT name FROM sqlite_master WHERE name='inbox_feedback'").length) {
        this.inbox.purge(Date.now());
        await this.inbox.scheduleCleanup();
        return;
      }
      this.initialize();
      this.storage.transactionSync(() => this.purge(Date.now()));
      await this.scheduleCleanup();
    });
  }
}
