/** Private hosted feedback only. Identity is selected by the authenticated Worker, never a request field. */
export const FEEDBACK_RETENTION_MS = 30 * 86400000;
export const FEEDBACK_BODY_BYTES = 4096;
export const FEEDBACK_MESSAGE_BYTES = 2048;
export const FEEDBACK_CATEGORIES = Object.freeze(["bug", "idea", "reading", "other"]);
const ORIGIN = "https://app.satinlore.com";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
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

/** Fetch-style Durable Object; plain classes remain supported without exposing public RPC methods. */
export class PrivateFeedback {
  constructor(ctx, _env) {
    this.ctx = ctx; this.storage = ctx.storage; this.sql = ctx.storage.sql;
    this.initialized = false; this.queue = Promise.resolve();
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
      if (prior) {
        if (prior.fingerprint !== digest) throw new FeedbackError("That retry belongs to a different note. Reopen the form to send a new one.", 409);
        return { ok: true, id: prior.id, duplicate: true, createdAt: prior.created_at, expiresAt: prior.expires_at };
      }
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
      this.initialize();
      this.storage.transactionSync(() => this.purge(Date.now()));
      await this.scheduleCleanup();
    });
  }
}
