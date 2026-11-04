import { accountJson, ensureEmailAccount } from "./accounts.mjs";
import { sendReaderCode } from "./reader-auth-email.mjs";

export const APP_ORIGIN = "https://app.satinlore.com";
const AUTH_ORIGIN = "https://reader-auth.internal";
const AUTH_COOKIE = "__Host-satinlore-reader";
const AUTH_ROUTES = new Set(["/api/auth/request", "/api/auth/verify", "/api/auth/logout"]);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CODE_LIFETIME = 10 * MINUTE;
const SESSION_LIFETIME = 7 * DAY;
const RESEND_DELAY = MINUTE;
const HEX = /^[a-f0-9]{64}$/;
const SUBJECT = /^email-v1:[a-f0-9]{64}$/;
const OTP = /^[0-9]{6}$/;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
const digest = async value => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const json = (body, status = 200, headers) => Response.json(body, { status, headers });
const unavailable = () => json({ error: "Email sign-in is temporarily unavailable. Try again shortly." }, 503);

function emailAddress(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local.length > 64 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return email;
}

export function publicReaderConfiguration(env) {
  if (env.PUBLIC_READER_ENABLED !== "true" || env.PRIVATE_APP_ENABLED !== "true" || env.PUBLIC_APP_ORIGIN !== APP_ORIGIN) return null;
  const key = typeof env.PUBLIC_READER_OTP_KEY === "string" ? env.PUBLIC_READER_OTP_KEY.toLowerCase() : "";
  const region = env.AUTH_SES_REGION;
  const from = emailAddress(env.AUTH_SES_FROM_EMAIL);
  const accessKey = env.AUTH_SES_ACCESS_KEY_ID;
  const secretKey = env.AUTH_SES_SECRET_ACCESS_KEY;
  const sessionToken = env.AUTH_SES_SESSION_TOKEN;
  const store = env.PUBLIC_READER_AUTH;
  if (!HEX.test(key) || /^0+$/.test(key) || !store?.idFromName || !store?.get ||
      !env.READER_ACCOUNTS?.idFromName || !env.READER_ACCOUNTS?.get || typeof region !== "string" ||
      !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region) || !from ||
      typeof accessKey !== "string" || !/^[A-Z0-9]{16,128}$/.test(accessKey) ||
      typeof secretKey !== "string" || !/^[A-Za-z0-9/+=]{32,128}$/.test(secretKey) ||
      (sessionToken !== undefined && (typeof sessionToken !== "string" || !/^[A-Za-z0-9/_+=-]{16,4096}$/.test(sessionToken)))) return null;
  return {
    origin: APP_ORIGIN, issuer: APP_ORIGIN, audience: "satinlore-public-email-v1",
    key, store, email: { region, from, accessKey, secretKey, sessionToken },
  };
}

async function authenticateValue(key, purpose, value) {
  const bytes = Uint8Array.from(key.match(/../g), part => parseInt(part, 16));
  const hmac = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", hmac, encoder.encode(`satinlore:${purpose}:v1:${value}`)));
}

function oneTimeCode() {
  const values = new Uint32Array(1);
  // Discard the uneven tail of the random space so every code is equally likely.
  do { crypto.getRandomValues(values); } while (values[0] >= 4_294_000_000);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function cookieToken(request) {
  const pairs = (request.headers.get("Cookie") || "").split(";");
  const matches = pairs.map(pair => pair.trim()).filter(pair => pair.startsWith(AUTH_COOKIE + "="));
  const token = matches.length === 1 ? matches[0].slice(AUTH_COOKIE.length + 1) : "";
  return HEX.test(token) ? token : null;
}

function readerCookie(token = "") {
  const lifetime = token ? SESSION_LIFETIME / 1000 : 0;
  return `${AUTH_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${lifetime}`;
}

async function authStore(config, action, body) {
  const stub = config.store.get(config.store.idFromName("public-reader-auth:v1"));
  return stub.fetch(new Request(`${AUTH_ORIGIN}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

export async function verifyPublicReader(request, config) {
  if (new URL(request.url).origin !== config.origin) return null;
  const token = cookieToken(request);
  if (!token) return null;
  try {
    const response = await authStore(config, "session", { tokenHash: await digest(token) });
    if (!response.ok) return null;
    const { subject, expiresAt } = await response.json();
    if (!SUBJECT.test(subject) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
    return { subject, expiresAt, authMode: "email", isFounder: false };
  } catch {
    return null;
  }
}

export async function revokePublicReader(config, session) {
  try {
    const response = await authStore(config, "revoke", { subject: session.subject });
    if (response.ok) return { "Set-Cookie": readerCookie() };
  } catch { /* The caller reports that revocation was not confirmed. */ }
  return null;
}

const exact = (value, ...keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export async function handlePublicAuth(request, env, config, emailFetcher) {
  const { pathname, search } = new URL(request.url);
  if (!AUTH_ROUTES.has(pathname)) return null;
  if (request.method !== "POST") return json({ error: "Use the sign-in form on SatinLore." }, 405, { Allow: "POST" });
  if (search || request.headers.get("Origin") !== config.origin ||
      ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) {
    return json({ error: "Use the sign-in form on SatinLore." }, 403);
  }
  let body;
  try { body = await accountJson(request, config.origin); }
  catch { return json({ error: "Check the sign-in form and try again." }, 400); }
  try {
    if (pathname === "/api/auth/request") {
      const email = exact(body, "email") ? emailAddress(body.email) : null;
      if (!email) return json({ error: "Enter a valid email address." }, 400);
      const challenge = randomToken();
      const code = oneTimeCode();
      const ip = request.headers.get("CF-Connecting-IP") || "";
      const [emailKey, client, codeHash] = await Promise.all([
        authenticateValue(config.key, "email-identity", email),
        authenticateValue(config.key, "email-client", /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : "unknown"),
        authenticateValue(config.key, "email-code", `${challenge}:${code}`),
      ]);
      const reserved = await authStore(config, "start", { challenge, subject: "email-v1:" + emailKey, client, codeHash });
      if (reserved.status === 429) return json({ error: "Too many codes were requested. Wait a little and try again." }, 429, {
        "Retry-After": /^\d+$/.test(reserved.headers.get("Retry-After") || "") ? reserved.headers.get("Retry-After") : "60",
      });
      if (!reserved.ok) return unavailable();
      try { await sendReaderCode(config.email, email, code, emailFetcher); }
      catch {
        await authStore(config, "cancel", { challenge });
        return unavailable();
      }
      return json({ challenge, expiresIn: CODE_LIFETIME / 1000, resendAfter: RESEND_DELAY / 1000 }, 202);
    }
    if (pathname === "/api/auth/logout") {
      if (!exact(body)) return json({ error: "Use the sign-out button on SatinLore." }, 400);
      const token = cookieToken(request);
      if (token && !(await authStore(config, "logout", { tokenHash: await digest(token) })).ok) return unavailable();
      return json({ authenticated: false, expiresAt: null }, 200, { "Set-Cookie": readerCookie() });
    }
    if (!exact(body, "challenge", "code", "adult") || typeof body.challenge !== "string" || !HEX.test(body.challenge) ||
        typeof body.code !== "string" || !OTP.test(body.code) || body.adult !== true) {
      return json({ error: "Enter the six-digit code and confirm you are 18 or older." }, 400);
    }
    const token = randomToken();
    const tokenHash = await digest(token);
    const codeHash = await authenticateValue(config.key, "email-code", `${body.challenge}:${body.code}`);
    const verified = await authStore(config, "check", { challenge: body.challenge, codeHash, tokenHash });
    if (verified.status === 401) return json({ error: "This code is incorrect, expired, or already used. Request a new code if needed." }, 401);
    if (!verified.ok) return unavailable();
    const { subject, expiresAt, issuedAt } = await verified.json();
    const session = { subject, expiresAt, authMode: "email", isFounder: false };
    let registered = false;
    try { registered = await ensureEmailAccount(env, config, session, issuedAt); }
    finally {
      if (!registered) await authStore(config, "logout", { tokenHash });
    }
    if (!registered) return unavailable();
    // Reverify after account registration, which may race with account deletion.
    const active = await authStore(config, "session", { tokenHash });
    if (!active.ok) return json({ error: "This sign-in session ended. Request a new code." }, 401);
    const previous = cookieToken(request);
    if (previous) await authStore(config, "logout", { tokenHash: await digest(previous) });
    return json({ authenticated: true, expiresAt }, 200, { "Set-Cookie": readerCookie(token) });
  } catch {
    return unavailable();
  }
}

function constantTimeMatch(first, second) {
  let difference = 0;
  for (let index = 0; index < first.length; index++) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

/** An atomic, bounded sign-in store. It retains only keyed identifiers and token digests. */
export class PublicReaderAuth {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, subject TEXT NOT NULL, digest TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS challenge_subject ON challenges(subject)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS session_subject ON sessions(subject, expires)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS quota (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)");
  }
  clean(now) {
    this.sql.exec("DELETE FROM challenges WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM sessions WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM quota WHERE expires <= ?", now);
  }
  async schedule() {
    const next = this.sql.exec(`SELECT MIN(expires) AS next FROM (
      SELECT MIN(expires) AS expires FROM challenges UNION ALL
      SELECT MIN(expires) FROM sessions UNION ALL SELECT MIN(expires) FROM quota
    )`).one().next;
    if (next === null) return;
    const alarm = await this.storage.getAlarm();
    if (alarm === null || alarm > next) await this.storage.setAlarm(next);
  }
  async alarm() {
    this.clean(Date.now());
    await this.schedule();
  }
  start(body, now) {
    if (!HEX.test(body.challenge) || !SUBJECT.test(body.subject) || !HEX.test(body.client) || !HEX.test(body.codeHash)) return json({}, 400);
    return this.storage.transactionSync(() => {
      const limits = [
        [`resend:${body.subject}`, 1, RESEND_DELAY],
        [`address:${body.subject}`, 5, HOUR],
        [`client:${body.client}`, 12, HOUR],
        ["total-hour", 100, HOUR],
        ["total-day", 1000, DAY],
      ];
      const entries = limits.map(([key, limit, window]) => {
        const saved = this.sql.exec("SELECT count, expires FROM quota WHERE key = ? AND expires > ?", key, now).toArray()[0];
        return { key, limit, count: saved?.count ?? 0, expires: saved?.expires ?? now + window };
      });
      const denied = entries.filter(entry => entry.count >= entry.limit);
      if (denied.length) return json({}, 429, {
        "Retry-After": String(Math.ceil((Math.max(...denied.map(entry => entry.expires)) - now) / 1000)),
      });
      for (const { key, count, expires } of entries) {
        this.sql.exec("INSERT INTO quota VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, expires = excluded.expires",
          key, count + 1, expires);
      }
      this.sql.exec("DELETE FROM challenges WHERE subject = ?", body.subject);
      this.sql.exec("INSERT INTO challenges (id, subject, digest, expires) VALUES (?, ?, ?, ?)", body.challenge, body.subject, body.codeHash, now + CODE_LIFETIME);
      return json({}, 201);
    });
  }
  check(body, now) {
    if (![body.challenge, body.codeHash, body.tokenHash].every(value => HEX.test(value))) return json({}, 400);
    return this.storage.transactionSync(() => {
      const challenge = this.sql.exec("SELECT subject, digest, attempts, expires FROM challenges WHERE id = ? AND expires > ?",
        body.challenge, now).toArray()[0];
      if (!challenge) return json({}, 401);
      if (!constantTimeMatch(challenge.digest, body.codeHash)) {
        if (challenge.attempts >= 4) this.sql.exec("DELETE FROM challenges WHERE id = ?", body.challenge);
        else this.sql.exec("UPDATE challenges SET attempts = attempts + 1 WHERE id = ?", body.challenge);
        return json({}, 401);
      }
      const { subject } = challenge;
      const expiresAt = now + SESSION_LIFETIME;
      this.sql.exec("DELETE FROM challenges WHERE id = ?", body.challenge);
      // Bound the number of active sessions per account and retain the newest ones.
      this.sql.exec("DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE subject = ? ORDER BY expires DESC LIMIT -1 OFFSET 9)", subject);
      this.sql.exec("INSERT INTO sessions VALUES (?, ?, ?)", body.tokenHash, subject, expiresAt);
      return json({ subject, expiresAt, issuedAt: challenge.expires - CODE_LIFETIME });
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.origin !== AUTH_ORIGIN || url.search || request.method !== "POST") return json({}, 404);
    const now = Date.now();
    try {
      const body = await request.json();
      let response;
      if (url.pathname === "/start") response = this.start(body, now);
      else if (url.pathname === "/check") response = this.check(body, now);
      else if (url.pathname === "/cancel" && HEX.test(body.challenge)) {
        this.sql.exec("DELETE FROM challenges WHERE id = ?", body.challenge);
        return json({});
      } else if (url.pathname === "/session" && HEX.test(body.tokenHash)) {
        const session = this.sql.exec("SELECT subject, expires AS expiresAt FROM sessions WHERE token_hash = ? AND expires > ?",
          body.tokenHash, now).toArray()[0];
        return session ? json(session) : json({}, 401);
      } else if (url.pathname === "/logout" && HEX.test(body.tokenHash)) {
        this.sql.exec("DELETE FROM sessions WHERE token_hash = ?", body.tokenHash);
        return json({});
      } else if (url.pathname === "/revoke" && SUBJECT.test(body.subject)) {
        this.storage.transactionSync(() => {
          this.sql.exec("DELETE FROM challenges WHERE subject = ?", body.subject);
          this.sql.exec("DELETE FROM sessions WHERE subject = ?", body.subject);
        });
        return json({});
      } else return json({}, 404);
      if (response.ok) await this.schedule();
      return response;
    } catch {
      return json({}, 503);
    }
  }
}
