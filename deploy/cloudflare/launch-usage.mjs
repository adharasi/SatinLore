import { accountIdentity } from "./accounts.mjs";
import { readEntitlement } from "./commerce.mjs";

export const LAUNCH_USAGE_PATH = "/api/account/usage";
const APP_ORIGIN = "https://app.satinlore.com";
const INTERNAL_URL = "https://launch-usage.internal/ledger";
const OPERATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LEASE_MS = 60_000;
const RECEIPT_MS = 35 * 86_400_000;
const MAX_TOKENS = Math.floor(Number.MAX_SAFE_INTEGER / 4);
const OPERATIONS = {
  status: ["policy"], reserve: ["id", "tokens", "policy"], dispatch: ["id", "policy"],
  settle: ["id", "tokens"], refund: ["id"], "refund-before-fetch": ["id"], unknown: ["id"],
};
const reply = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () => reply({ error: "AI token usage is temporarily unavailable." }, 503);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOKENS;
const exact = (value, keys) => value && typeof value === "object" && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

function configuredCount(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value) && count(Number(value)) ? Number(value) : null;
}

function monthEnd(now) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function validPolicy(policy) {
  return exact(policy, ["monthlyCap", "trial", "purchased", "revision"]) && Object.values(policy).every(count) && policy.monthlyCap > 0;
}

function validOperation(value) {
  if (typeof value?.operation !== "string" || !Object.hasOwn(OPERATIONS, value.operation)) return false;
  const fields = OPERATIONS[value.operation];
  return exact(value, ["operation", ...fields]) && (!fields.includes("id") || (typeof value.id === "string" && OPERATION_ID.test(value.id))) &&
    (!fields.includes("tokens") || (count(value.tokens) && (value.operation !== "reserve" || value.tokens > 0))) &&
    (!fields.includes("policy") || validPolicy(value.policy));
}

/** The Worker addresses one SQLite ledger for each verified email account. */
export class LaunchUsage {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS balance (
      id INTEGER PRIMARY KEY CHECK (id = 1), used INTEGER NOT NULL, reserved INTEGER NOT NULL,
      purchased INTEGER NOT NULL, revision INTEGER NOT NULL, trial INTEGER)`);
    this.sql.exec("INSERT OR IGNORE INTO balance VALUES (1, 0, 0, 0, -1, NULL)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS periods (
      ends_at INTEGER PRIMARY KEY, used INTEGER NOT NULL, reserved INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, ends_at INTEGER NOT NULL, reserved INTEGER NOT NULL, used INTEGER NOT NULL,
      state TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS attempts_expiry ON attempts(expires_at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS attempts_period ON attempts(ends_at)");
  }

  snapshot(now, { monthlyCap, trial, purchased, revision }) {
    // Assign the configured lifetime trial once, so later rollout changes cannot spend purchased credits retroactively.
    this.sql.exec("UPDATE balance SET purchased = ?, revision = ?, trial = COALESCE(trial, ?) WHERE id = 1 AND revision < ?",
      purchased, revision, trial, revision);
    const { revision: latest, ...balance } = this.sql.exec("SELECT used, reserved, purchased, trial, revision FROM balance WHERE id = 1").one();
    if (latest !== revision || balance.purchased !== purchased) throw new Error("Invalid entitlement revision");
    const endsAt = monthEnd(now);
    const month = this.sql.exec("SELECT used, reserved FROM periods WHERE ends_at = ?", endsAt).toArray()[0] ?? { used: 0, reserved: 0 };
    const monthRemaining = Math.max(0, monthlyCap - month.used - month.reserved);
    const creditRemaining = Math.max(0, balance.trial + balance.purchased - balance.used - balance.reserved);
    return {
      enabled: true,
      available: monthRemaining > 0 && creditRemaining > 0,
      month: { endsAt, limit: monthlyCap, ...month, remaining: monthRemaining },
      credits: { ...balance, remaining: creditRemaining },
    };
  }

  changeTotals(endsAt, used, reserved) {
    this.sql.exec("UPDATE balance SET used = used + ?, reserved = reserved + ? WHERE id = 1", used, reserved);
    this.sql.exec("UPDATE periods SET used = used + ?, reserved = reserved + ? WHERE ends_at = ?", used, reserved, endsAt);
  }

  finish(attempt, state, tokens, now) {
    const held = attempt.state === "unknown" ? 0 : attempt.reserved;
    this.changeTotals(attempt.ends_at, tokens - attempt.used, -held);
    this.sql.exec("UPDATE attempts SET used = ?, state = ?, expires_at = ? WHERE id = ?", tokens, state, now + RECEIPT_MS, attempt.id);
    return reply({ state });
  }

  expire(now) {
    for (const attempt of this.sql.exec("SELECT * FROM attempts WHERE expires_at <= ? AND state IN ('reserved', 'dispatched')", now).toArray()) {
      if (attempt.state === "reserved") this.finish(attempt, "refunded", 0, now);
      else this.finish(attempt, "unknown", attempt.reserved, now);
    }
    this.sql.exec("DELETE FROM attempts WHERE expires_at <= ?", now);
    this.sql.exec("DELETE FROM periods WHERE ends_at <= ? AND NOT EXISTS (SELECT 1 FROM attempts WHERE attempts.ends_at = periods.ends_at)", now - RECEIPT_MS);
  }

  process({ operation, id, tokens, policy }, now) {
    this.expire(now);
    const usage = policy && this.snapshot(now, policy);
    if (operation === "status") return reply(usage);
    const attempt = this.sql.exec("SELECT * FROM attempts WHERE id = ?", id).toArray()[0];
    const conflict = () => reply({ state: attempt?.state ?? "missing" }, 409);
    if (operation === "reserve") {
      if (attempt) return attempt.state === "reserved" && attempt.reserved === tokens ? reply({ state: "reserved" }) : conflict();
      if (tokens > Math.min(usage.month.remaining, usage.credits.remaining)) return reply({ error: "token_limit_reached" }, 429);
      this.sql.exec("INSERT OR IGNORE INTO periods VALUES (?, 0, 0)", usage.month.endsAt);
      this.sql.exec("INSERT INTO attempts VALUES (?, ?, ?, 0, 'reserved', ?)", id, usage.month.endsAt, tokens, now + LEASE_MS);
      this.changeTotals(usage.month.endsAt, 0, tokens);
      return reply({ state: "reserved" });
    }
    if (operation === "dispatch") {
      if (attempt?.state !== "reserved") return conflict();
      if (attempt.ends_at !== usage.month.endsAt || usage.month.used + usage.month.reserved > usage.month.limit ||
          usage.credits.used + usage.credits.reserved > usage.credits.trial + usage.credits.purchased) {
        this.finish(attempt, "refunded", 0, now);
        return reply({ error: "token_limit_reached" }, 429);
      }
      this.sql.exec("UPDATE attempts SET state = 'dispatched', expires_at = ? WHERE id = ?", now + LEASE_MS, id);
      return reply({ state: "dispatched" });
    }
    if (operation === "settle") {
      if (attempt?.state === "settled" && attempt.used === tokens) return reply({ state: "settled" });
      return ["dispatched", "unknown"].includes(attempt?.state) ? this.finish(attempt, "settled", tokens, now) : conflict();
    }
    if (operation === "refund" || operation === "refund-before-fetch") {
      if (attempt?.state === "refunded") return reply({ state: "refunded" });
      const refundable = operation === "refund" ? "reserved" : "dispatched";
      return attempt?.state === refundable ? this.finish(attempt, "refunded", 0, now) : conflict();
    }
    if (attempt?.state === "unknown") return reply({ state: "unknown" });
    return attempt?.state === "dispatched" ? this.finish(attempt, "unknown", attempt.reserved, now) : conflict();
  }

  async scheduleExpiry() {
    const { next } = this.sql.exec("SELECT MIN(expires_at) AS next FROM attempts").one();
    if (next !== null && await this.storage.getAlarm() !== next) await this.storage.setAlarm(next);
  }

  async fetch(request) {
    if (request.url !== INTERNAL_URL || request.method !== "POST") return reply({}, 404);
    let value;
    try { value = await request.json(); } catch { return reply({}, 400); }
    if (!validOperation(value)) return reply({}, 400);
    try {
      const result = this.storage.transactionSync(() => this.process(value, Date.now()));
      await this.scheduleExpiry();
      return result;
    } catch { return unavailable(); }
  }

  async alarm() {
    this.storage.transactionSync(() => this.expire(Date.now()));
    await this.scheduleExpiry();
  }
}

/** A conservative hold covers the complete UTF-8 envelope, provider framing and requested output. */
export function estimateLaunchTokens(payload, outputTokens) {
  return new TextEncoder().encode(payload).byteLength + 1024 + outputTokens;
}

export function reportedLaunchTokens(usage) {
  const { input_tokens: input, output_tokens: output, total_tokens: total } = usage ?? {};
  return count(input) && count(output) && count(total) && input + output === total ? total : null;
}

function emailSession(config, session) {
  return config?.origin === APP_ORIGIN && config.issuer === APP_ORIGIN && session?.authMode === "email" &&
    Number.isSafeInteger(session.expiresAt) && session.expiresAt > Date.now();
}

function usableNamespace(namespace) {
  return typeof namespace?.idFromName === "function" && typeof namespace.get === "function";
}

export function launchUsageConfigured(env) {
  return env.LAUNCH_AI_USAGE_ENABLED === "true" && configuredCount(env.LAUNCH_AI_MONTHLY_TOKEN_CAP) > 0 &&
    configuredCount(env.LAUNCH_AI_TRIAL_TOKENS ?? "0") !== null && usableNamespace(env.LAUNCH_USAGE) && usableNamespace(env.COMMERCE);
}

export function createLaunchUsage(env, { config, session }) {
  if (env.LAUNCH_AI_USAGE_ENABLED !== "true") return { enabled: false };
  const configured = launchUsageConfigured(env);
  const monthlyCap = configuredCount(env.LAUNCH_AI_MONTHLY_TOKEN_CAP);
  const trial = configuredCount(env.LAUNCH_AI_TRIAL_TOKENS ?? "0");
  async function command(operation, fields = {}) {
    const readsPolicy = ["status", "reserve", "dispatch"].includes(operation);
    if (!configured || (readsPolicy && !emailSession(config, session))) return unavailable();
    try {
      const subject = await accountIdentity(config, session);
      if (readsPolicy) {
        const response = await readEntitlement(env.COMMERCE, { subject });
        if (!response.ok) return unavailable();
        const { credits: purchased, revision } = await response.json();
        const policy = { monthlyCap, trial, purchased, revision };
        if (!validPolicy(policy)) return unavailable();
        fields = { ...fields, policy };
      }
      const namespace = env.LAUNCH_USAGE;
      return await namespace.get(namespace.idFromName(subject)).fetch(new Request(INTERNAL_URL, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ operation, ...fields }),
      }));
    } catch { return unavailable(); }
  }
  async function complete(operation, fields) {
    const result = await command(operation, fields);
    return result.status >= 500 ? command(operation, fields) : result;
  }
  return {
    enabled: true,
    estimateTokens: estimateLaunchTokens,
    status: () => command("status"),
    reserve: (id, tokens) => command("reserve", { id, tokens }),
    dispatch: id => command("dispatch", { id }),
    refund: id => complete("refund", { id }),
    // Only the handler with the dispatch acknowledgement can prove fetch never ran.
    refundBeforeFetch: id => complete("refund-before-fetch", { id }),
    finalize: (id, usage) => {
      const tokens = reportedLaunchTokens(usage);
      return tokens === null ? complete("unknown", { id }) : complete("settle", { id, tokens });
    },
  };
}

export async function handleLaunchUsage(request, env, { config, session }) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!emailSession(config, session) || url.origin !== config.origin || (origin !== null && origin !== config.origin) ||
      ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) return reply({ error: "Sign in to SatinLore to view AI token usage." }, 403);
  if (url.pathname !== LAUNCH_USAGE_PATH || url.search) return reply({ error: "Use the SatinLore account controls." }, 400);
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const usage = createLaunchUsage(env, { config, session });
  const result = usage.enabled ? await usage.status() : reply({ enabled: false, available: false });
  if (!emailSession(config, session)) return reply({ error: "Sign in to SatinLore to view AI token usage." }, 403);
  return request.method === "HEAD" ? new Response(null, result) : result;
}
