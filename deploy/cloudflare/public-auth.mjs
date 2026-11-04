import { scrypt } from "node:crypto";
import { accountJson, ensureEmailAccount } from "./accounts.mjs";
import { sendReaderCode } from "./reader-auth-email.mjs";

export const APP_ORIGIN = "https://app.satinlore.com";
const AUTH_ORIGIN = "https://reader-auth.internal";
const AUTH_COOKIE = "__Host-satinlore-reader";
const AUTH_ROUTES = new Set(["request", "register", "resend", "verify", "login", "forgot", "reset", "logout"]);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CODE_LIFETIME = 10 * MINUTE;
const SESSION_LIFETIME = 12 * HOUR;
const REMEMBERED_LIFETIME = 30 * DAY;
const RESEND_DELAY = MINUTE;
const SCRYPT_COST = Object.freeze({ N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const MAX_PENDING_HASHES = 4;
const HEX = /^[a-f0-9]{64}$/;
const SUBJECT = /^email-v1:[a-f0-9]{64}$/;
const OTP = /^[0-9]{6}$/;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
const digest = async value => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const json = (body, status = 200, headers) => Response.json(body, { status, headers });
const unavailable = () => json({ error: "Email sign-in is temporarily unavailable. Try again shortly." }, 503);
const invalidCode = () => json({ error: "This code is incorrect, expired, or already used. Request a new code if needed." }, 401);
const invalidPassword = () => json({ error: "Use a password of 15 to 128 characters (up to 512 bytes)." }, 400);
const unauthenticated = () => json({ error: "The email or password did not match. Check your details or reset your password." }, 401);

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

function normalizePassword(value) {
  if (typeof value !== "string" || value.length > 256 || !value.isWellFormed()) return null;
  const normalized = value.normalize("NFC");
  const count = [...normalized].length;
  return count >= 15 && count <= 128 && encoder.encode(normalized).byteLength <= 512 ? normalized : null;
}

function derivePassword(proof, salt) {
  // A single hash uses about 32 MiB. Keep the memory-hard work in the SQLite DO.
  return new Promise((resolve, reject) => scrypt(proof, salt, 32, SCRYPT_COST,
    (error, bytes) => error ? reject(error) : resolve(bytes.toString("hex"))));
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

function readerCookie(token = "", remember = false) {
  const expiration = !token ? "; Max-Age=0" : remember ? `; Max-Age=${REMEMBERED_LIFETIME / 1000}` : "";
  return `${AUTH_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax${expiration}`;
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

function quotaResponse(response, message) {
  const retryAfter = response.headers.get("Retry-After") || "";
  return json({ error: message }, 429, { "Retry-After": /^\d+$/.test(retryAfter) ? retryAfter : "60" });
}

async function requestIdentity(config, request, email) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const [emailKey, client] = await Promise.all([
    authenticateValue(config.key, "email-identity", email),
    authenticateValue(config.key, "email-client", /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : "unknown"),
  ]);
  return { subject: "email-v1:" + emailKey, client };
}

async function startEmailChallenge(action, body, request, config, emailFetcher, ctx) {
  const email = exact(body, ...(action === "register" ? ["email", "password", "adult"] : action === "resend" ? ["challenge", "email"] : ["email"]))
    ? emailAddress(body.email) : null;
  if (!email) return json({ error: "Enter a valid email address." }, 400);
  if (action === "register" && body.adult !== true) return json({ error: "Confirm that you are 18 or older." }, 400);
  const password = action === "register" ? normalizePassword(body.password) : null;
  if (action === "register" && !password) return invalidPassword();
  if (action === "resend" && (typeof body.challenge !== "string" || !HEX.test(body.challenge))) return invalidCode();
  const challenge = randomToken();
  const code = oneTimeCode();
  const [identity, codeHash] = await Promise.all([
    requestIdentity(config, request, email), authenticateValue(config.key, "email-code", `${challenge}:${code}`),
  ]);
  const reserved = await authStore(config, "password/start", { ...identity, challenge, codeHash,
    purpose: action === "register" ? "verify" : action === "forgot" ? "reset" : "resend",
    ...(action === "resend" ? { previous: body.challenge } : {}),
  });
  if (reserved.status === 401) return invalidCode();
  if (reserved.status === 429) return quotaResponse(reserved, "Too many codes were requested. Wait a little and try again.");
  if (!reserved.ok) return unavailable();
  const { purpose, send } = await reserved.json();
  if (password) {
    const proof = await authenticateValue(config.key, "password-prehash", password);
    if (!(await authStore(config, "password/stage", { challenge, proof })).ok) return unavailable();
  }
  const delivery = async () => {
    if (!send) return true;
    try { await sendReaderCode(config.email, email, code, purpose, emailFetcher); return true; }
    catch {
      try { await authStore(config, "password/cancel", { challenge }); } catch { /* Expiry still bounds the failed challenge. */ }
      return false;
    }
  };
  if (purpose === "reset") {
    // The client gets the same response without waiting for SES, including for an unknown email.
    if (ctx?.waitUntil) ctx.waitUntil(delivery());
    else await delivery();
  } else if (!await delivery()) return unavailable();
  return json({ challenge, expiresIn: CODE_LIFETIME / 1000, resendAfter: RESEND_DELAY / 1000 }, 202);
}

async function finishEmailChallenge(purpose, body, env, config) {
  const reset = purpose === "reset";
  if (!exact(body, ...(reset ? ["challenge", "code", "password"] : ["challenge", "code"])) ||
      typeof body.challenge !== "string" || !HEX.test(body.challenge) || typeof body.code !== "string" || !OTP.test(body.code)) {
    return json({ error: "Enter the six-digit code from your email." }, 400);
  }
  const password = reset ? normalizePassword(body.password) : null;
  if (reset && !password) return invalidPassword();
  const { challenge } = body;
  const codeHash = await authenticateValue(config.key, "email-code", `${challenge}:${body.code}`);
  const checked = await authStore(config, "password/check", { challenge, codeHash, purpose });
  if (checked.status === 401) return invalidCode();
  if (!checked.ok) return unavailable();
  const { subject, issuedAt, expiresAt } = await checked.json();
  let update = { challenge };
  if (reset) {
    update = { challenge, proof: await authenticateValue(config.key, "password-prehash", password) };
  } else if (!await ensureEmailAccount(env, config, { subject, expiresAt, authMode: "email", isFounder: false }, issuedAt)) {
    await authStore(config, "password/cancel", { challenge });
    return unavailable();
  }
  const committed = await authStore(config, `password/${reset ? "reset" : "register"}`, update);
  if (committed.status === 401) return invalidCode();
  if (!committed.ok) return unavailable();
  return reset ? json({ reset: true }, 200, { "Set-Cookie": readerCookie() }) : json({ verified: true });
}

async function loginWithPassword(body, request, config) {
  if (!exact(body, "email", "password", "remember") || typeof body.remember !== "boolean") {
    return json({ error: "Enter your email and password." }, 400);
  }
  const email = emailAddress(body.email);
  const password = normalizePassword(body.password);
  if (!email || !password) return unauthenticated();
  const token = randomToken();
  const [identity, tokenHash, proof] = await Promise.all([
    requestIdentity(config, request, email), digest(token), authenticateValue(config.key, "password-prehash", password),
  ]);
  const opened = await authStore(config, "password/login", {
    ...identity, proof, tokenHash, remember: body.remember,
  });
  if (opened.status === 429) return quotaResponse(opened, "Too many sign-in attempts. Wait a little and try again.");
  if (opened.status === 401) return unauthenticated();
  if (!opened.ok) return unavailable();
  const previous = cookieToken(request);
  if (previous) await authStore(config, "logout", { tokenHash: await digest(previous) });
  const { expiresAt } = await opened.json();
  return json({ authenticated: true, expiresAt }, 200, { "Set-Cookie": readerCookie(token, body.remember) });
}

export async function handlePublicAuth(request, env, config, emailFetcher, ctx) {
  const { pathname, search } = new URL(request.url);
  const action = pathname.startsWith("/api/auth/") ? pathname.slice("/api/auth/".length) : "";
  if (!AUTH_ROUTES.has(action)) return null;
  if (request.method !== "POST") return json({ error: "Use the sign-in form on SatinLore." }, 405, { Allow: "POST" });
  if (search || request.headers.get("Origin") !== config.origin ||
      ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) {
    return json({ error: "Use the sign-in form on SatinLore." }, 403);
  }
  let body;
  try { body = await accountJson(request, config.origin); }
  catch { return json({ error: "Check the sign-in form and try again." }, 400); }
  try {
    if (action === "request") return json({ error: "Use your email and password to sign in. Reload the reader to get the latest sign-in form." }, 410);
    if (["register", "resend", "forgot"].includes(action)) return await startEmailChallenge(action, body, request, config, emailFetcher, ctx);
    if (action === "login") return await loginWithPassword(body, request, config);
    if (action === "logout") {
      if (!exact(body)) return json({ error: "Use the sign-out button on SatinLore." }, 400);
      const token = cookieToken(request);
      if (token && !(await authStore(config, "logout", { tokenHash: await digest(token) })).ok) return unavailable();
      return json({ authenticated: false, expiresAt: null }, 200, { "Set-Cookie": readerCookie() });
    }
    return await finishEmailChallenge(action, body, env, config);
  } catch {
    return unavailable();
  }
}

function constantTimeMatch(first, second) {
  let difference = first.length ^ second.length;
  for (let index = 0; index < first.length; index++) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

/** Atomic credentials, short-lived email challenges and sign-in sessions. No email addresses or plaintext secrets are retained. */
export class PublicReaderAuth {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.pendingHashes = 0;
    this.hashQueue = Promise.resolve();
    this.sql.exec("CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, subject TEXT NOT NULL, digest TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS password_challenges (id TEXT PRIMARY KEY, subject TEXT NOT NULL,
      purpose TEXT NOT NULL, digest TEXT NOT NULL, issued INTEGER NOT NULL, expires INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0, salt TEXT, password_hash TEXT)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS password_challenge_subject ON password_challenges(subject, purpose)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS password_credentials (subject TEXT PRIMARY KEY, salt TEXT NOT NULL, digest TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS session_subject ON sessions(subject, expires)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS quota (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)");
  }
  clean(now) {
    this.sql.exec("DELETE FROM challenges WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM password_challenges WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM sessions WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM quota WHERE expires <= ?", now);
  }
  async schedule() {
    const next = this.sql.exec(`SELECT MIN(expires) AS next FROM (
      SELECT MIN(expires) AS expires FROM challenges UNION ALL SELECT MIN(expires) FROM password_challenges UNION ALL
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
  consumeQuota(limits, now) {
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
    return null;
  }
  credential(subject) {
    return this.sql.exec("SELECT salt, digest FROM password_credentials WHERE subject = ?", subject).toArray()[0];
  }
  async hashPassword(proof, salt) {
    if (this.pendingHashes >= MAX_PENDING_HASHES) return null;
    this.pendingHashes++;
    const pending = this.hashQueue.then(() => derivePassword(proof, salt));
    this.hashQueue = pending.then(() => undefined, () => undefined);
    try { return await pending; }
    finally { this.pendingHashes--; }
  }
  start(body, now) {
    if (!HEX.test(body.challenge) || !SUBJECT.test(body.subject) || !HEX.test(body.client) || !HEX.test(body.codeHash) ||
        !["verify", "reset", "resend"].includes(body.purpose)) return json({}, 400);
    return this.storage.transactionSync(() => {
      const previous = body.purpose === "resend" && this.sql.exec(`SELECT purpose, issued, salt, password_hash FROM password_challenges
        WHERE id = ? AND subject = ? AND expires > ? AND claimed = 0`, body.previous, body.subject, now).toArray()[0];
      if (body.purpose === "resend" && (!previous || (previous.purpose === "verify" && !previous.salt))) return json({}, 401);
      const blocked = this.consumeQuota([
        [`resend:${body.subject}`, 1, RESEND_DELAY], [`address:${body.subject}`, 5, HOUR],
        [`client:${body.client}`, 12, HOUR], ["total-hour", 100, HOUR], ["total-day", 1000, DAY],
      ], now);
      if (blocked) return blocked;
      const purpose = previous ? previous.purpose : body.purpose;
      this.sql.exec("DELETE FROM password_challenges WHERE subject = ? AND purpose = ? AND claimed = 0", body.subject, purpose);
      this.sql.exec(`INSERT INTO password_challenges (id, subject, purpose, digest, issued, expires, salt, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, body.challenge, body.subject, purpose, body.codeHash, previous?.issued ?? now,
      now + CODE_LIFETIME, previous?.salt ?? null, previous?.password_hash ?? null);
      return json({ purpose, send: purpose === "verify" || Boolean(this.credential(body.subject)) }, 201);
    });
  }
  async stage(body, now) {
    if (![body.challenge, body.proof].every(value => HEX.test(value))) return json({}, 400);
    const pending = this.sql.exec(`SELECT id FROM password_challenges WHERE id = ? AND purpose = 'verify'
      AND expires > ? AND claimed = 0 AND salt IS NULL`, body.challenge, now).toArray()[0];
    if (!pending) return json({}, 401);
    const salt = randomToken();
    const passwordHash = await this.hashPassword(body.proof, salt);
    if (!passwordHash) return json({}, 503);
    this.sql.exec(`UPDATE password_challenges SET salt = ?, password_hash = ?
      WHERE id = ? AND purpose = 'verify' AND expires > ? AND claimed = 0 AND salt IS NULL`, salt, passwordHash, body.challenge, Date.now());
    return json({}, this.sql.exec("SELECT changes() AS count").one().count === 1 ? 200 : 401);
  }
  check(body, now) {
    if (![body.challenge, body.codeHash].every(value => HEX.test(value)) || !["verify", "reset"].includes(body.purpose)) return json({}, 400);
    return this.storage.transactionSync(() => {
      const challenge = this.sql.exec(`SELECT subject, digest, attempts, issued, expires, salt FROM password_challenges
        WHERE id = ? AND expires > ? AND purpose = ? AND claimed = 0`, body.challenge, now, body.purpose).toArray()[0];
      if (!challenge) return json({}, 401);
      if (!constantTimeMatch(challenge.digest, body.codeHash)) {
        if (challenge.attempts >= 4) this.sql.exec("DELETE FROM password_challenges WHERE id = ?", body.challenge);
        else this.sql.exec("UPDATE password_challenges SET attempts = attempts + 1 WHERE id = ?", body.challenge);
        return json({}, 401);
      }
      if (body.purpose === "verify" ? !challenge.salt : !this.credential(challenge.subject)) return json({}, 401);
      this.sql.exec("UPDATE password_challenges SET claimed = 1 WHERE id = ?", body.challenge);
      return json({ subject: challenge.subject, expiresAt: challenge.expires, issuedAt: challenge.issued });
    });
  }
  async commitPassword(body, purpose, now) {
    const reset = purpose === "reset";
    if (!HEX.test(body.challenge) || (reset && !HEX.test(body.proof))) return json({}, 400);
    const claim = this.sql.exec(`SELECT subject, salt, password_hash FROM password_challenges
      WHERE id = ? AND purpose = ? AND expires > ? AND claimed = 1`, body.challenge, purpose, now).toArray()[0];
    if (!claim) return json({}, 401);
    const salt = reset ? randomToken() : claim.salt;
    const passwordHash = reset ? await this.hashPassword(body.proof, salt) : claim.password_hash;
    if (!passwordHash) return json({}, 503);
    return this.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM password_challenges WHERE id = ? AND expires > ? AND claimed = 1", body.challenge, Date.now());
      if (this.sql.exec("SELECT changes() AS count").one().count !== 1) return json({}, 401);
      if (reset) {
        if (!this.credential(claim.subject)) return json({}, 401);
        this.sql.exec("UPDATE password_credentials SET salt = ?, digest = ? WHERE subject = ?", salt, passwordHash, claim.subject);
        this.sql.exec("DELETE FROM sessions WHERE subject = ?", claim.subject);
        this.sql.exec("DELETE FROM password_challenges WHERE subject = ?", claim.subject);
      } else {
        // A new email verification can enroll a pre-existing passwordless account but can never replace a password.
        this.sql.exec("INSERT INTO password_credentials VALUES (?, ?, ?) ON CONFLICT(subject) DO NOTHING", claim.subject, salt, passwordHash);
      }
      return json({});
    });
  }
  async login(body, now) {
    if (!SUBJECT.test(body.subject) || ![body.client, body.proof, body.tokenHash].every(value => HEX.test(value)) ||
        typeof body.remember !== "boolean") return json({}, 400);
    const blocked = this.storage.transactionSync(() => this.consumeQuota([[`login-address:${body.subject}`, 8, 15 * MINUTE],
      [`login-client:${body.client}`, 35, 15 * MINUTE], ["login-total", 150, MINUTE]], now));
    if (blocked) return blocked;
    await this.schedule();
    const stored = this.credential(body.subject);
    // Derive a full candidate for either outcome, using an account-specific dummy salt when absent.
    const candidate = await this.hashPassword(body.proof, stored?.salt ?? body.subject.slice(-64));
    if (!candidate) return json({}, 503);
    if (!constantTimeMatch(candidate, stored?.digest ?? "0".repeat(64)) || !stored) return json({}, 401);
    return this.storage.transactionSync(() => {
      // Recheck the credential generation so a reset or deletion racing the KDF cannot mint a session.
      if (this.credential(body.subject)?.salt !== stored.salt) return json({}, 401);
      const expiresAt = Date.now() + (body.remember ? REMEMBERED_LIFETIME : SESSION_LIFETIME);
      this.sql.exec(`DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE subject = ?
        ORDER BY expires DESC LIMIT -1 OFFSET 9)`, body.subject);
      this.sql.exec("INSERT INTO sessions VALUES (?, ?, ?)", body.tokenHash, body.subject, expiresAt);
      return json({ expiresAt });
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.origin !== AUTH_ORIGIN || url.search || request.method !== "POST") return json({}, 404);
    const now = Date.now();
    try {
      const body = await request.json();
      let response;
      if (url.pathname === "/password/start") response = this.start(body, now);
      else if (url.pathname === "/password/stage") return await this.stage(body, now);
      else if (url.pathname === "/password/check") return this.check(body, now);
      else if (url.pathname === "/password/register") return await this.commitPassword(body, "verify", now);
      else if (url.pathname === "/password/reset") return await this.commitPassword(body, "reset", now);
      else if (url.pathname === "/password/login") response = await this.login(body, now);
      else if (url.pathname === "/password/cancel" && HEX.test(body.challenge)) {
        this.sql.exec("DELETE FROM password_challenges WHERE id = ?", body.challenge);
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
          this.sql.exec("DELETE FROM password_challenges WHERE subject = ?", body.subject);
          this.sql.exec("DELETE FROM password_credentials WHERE subject = ?", body.subject);
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
