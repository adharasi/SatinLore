import { accountIdentity } from "./accounts.mjs";
import { launchCommerceNamespace, readEntitlement, stripeTestRealm } from "./commerce.mjs";

export const LAUNCH_USAGE_PATH = "/api/account/usage";
export const LAUNCH_COST_METERING_FLAG = "LAUNCH_AI_COST_METERING_ENABLED";
const LAUNCH_APP_CAP_SETTING = "LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD";
const UNIT = "nano_usd";
const DEFAULT_MONTHLY_CAP = "10000000000";
const PLAN_PERIOD_CAP = 2_000_000_000;
// OpenAI Standard, short context: https://developers.openai.com/api/docs/pricing
const LUNA = { input: 100, cached: 10, output: 500, write30m: 125, write12h: 250 };
const APP_ORIGIN = "https://app.satinlore.com";
const INTERNAL_URL = "https://launch-usage.internal/ledger";
const APP_LEDGER_URL = "https://launch-usage.internal/app-ledger";
const OPERATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LEASE_MS = 60_000;
const RECEIPT_MS = 35 * 86_400_000;
const MAX_AMOUNT = Math.floor(Number.MAX_SAFE_INTEGER / 4);
const LIMITED = { error: "analysis_credit_limit" };
const OPERATIONS = {
  status: ["policy"], reserve: ["id", "amount", "policy"], dispatch: ["id", "policy"],
  settle: ["id", "amount"], refund: ["id"], "refund-before-fetch": ["id"], unknown: ["id"],
};
const reply = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const unavailable = () => reply({ error: "AI analysis usage is temporarily unavailable." }, 503);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT;
const exact = (value, keys) => value && typeof value === "object" && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

function configuredCount(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value) && count(Number(value)) ? Number(value) : null;
}

function monthEnd(now) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function validGrant(grant) {
  return exact(grant, ["id", "credits", "startsAt", "endsAt"]) && typeof grant.id === "string" && /^[a-zA-Z0-9:_.-]{1,128}$/.test(grant.id) &&
    count(grant.credits) && grant.credits <= PLAN_PERIOD_CAP && count(grant.startsAt) && count(grant.endsAt) && grant.startsAt < grant.endsAt;
}

function validPolicy(policy) {
  if (!exact(policy, ["monthlyCap", "trial", "purchased", "revision", "subscriptionGrants"])) return false;
  const { monthlyCap, trial, purchased, revision, subscriptionGrants } = policy;
  return count(monthlyCap) && monthlyCap > 0 && count(trial) && count(purchased) && count(revision) &&
    Array.isArray(subscriptionGrants) && subscriptionGrants.length <= 48 && subscriptionGrants.every(validGrant) &&
    new Set(subscriptionGrants.map(grant => grant.id)).size === subscriptionGrants.length;
}

function validOperation(value, app) {
  if (typeof value?.operation !== "string" || !Object.hasOwn(OPERATIONS, value.operation)) return false;
  const fields = OPERATIONS[value.operation];
  const keys = app ? fields.map(key => key === "policy" ? "appCap" : key) : fields;
  return exact(value, ["operation", ...keys]) && (!fields.includes("id") || (typeof value.id === "string" && OPERATION_ID.test(value.id))) &&
    (!fields.includes("amount") || (count(value.amount) && (value.operation !== "reserve" || value.amount > 0))) &&
    (!fields.includes("policy") || (app ? count(value.appCap) && value.appCap > 0 : validPolicy(value.policy)));
}

/** Independent SQLite ledgers track each verified email account and aggregate public spend. */
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
      state TEXT NOT NULL, expires_at INTEGER NOT NULL, allocation TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS subscription_periods (
      id TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, used INTEGER NOT NULL, reserved INTEGER NOT NULL)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS attempts_expiry ON attempts(expires_at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS attempts_period ON attempts(ends_at)");
  }

  subscriptionPeriods(grants, now) {
    const active = [];
    for (const { id, startsAt, endsAt, credits: granted } of grants) {
      if (startsAt > now || endsAt <= now) continue;
      this.sql.exec("INSERT OR IGNORE INTO subscription_periods VALUES (?, ?, ?, 0, 0)", id, startsAt, endsAt);
      const period = this.sql.exec("SELECT * FROM subscription_periods WHERE id = ?", id).one();
      if (period.starts_at !== startsAt || period.ends_at !== endsAt) throw new Error("Plan period changed");
      active.push({ id, endsAt, granted, used: period.used, reserved: period.reserved,
        remaining: Math.max(0, granted - period.used - period.reserved) });
    }
    return active.sort((left, right) => left.endsAt - right.endsAt || left.id.localeCompare(right.id));
  }

  snapshot(now, { monthlyCap, trial, purchased, revision, subscriptionGrants }) {
    // The first authenticated usage grant is permanent for this identity.
    this.sql.exec("UPDATE balance SET purchased = ?, revision = ?, trial = COALESCE(trial, ?) WHERE id = 1 AND revision < ?",
      purchased, revision, trial, revision);
    const { revision: latest, ...balance } = this.sql.exec("SELECT used, reserved, purchased, trial, revision FROM balance WHERE id = 1").one();
    if (latest !== revision || balance.purchased !== purchased) throw new Error("Invalid entitlement revision");
    const month = this.monthSnapshot(now, monthlyCap);
    const active = this.subscriptionPeriods(subscriptionGrants, now);
    const subscription = { granted: 0, used: 0, reserved: 0, remaining: 0, endsAt: active[0]?.endsAt ?? null };
    for (const period of active) {
      for (const key of ["granted", "used", "reserved", "remaining"]) subscription[key] += period[key];
    }
    const creditRemaining = Math.max(0, balance.trial + balance.purchased - balance.used - balance.reserved);
    return { active, usage: {
      enabled: true,
      unit: UNIT,
      available: month.remaining > 0 && (creditRemaining > 0 || subscription.remaining > 0),
      month,
      credits: { ...balance, remaining: creditRemaining },
      subscription,
    } };
  }

  monthSnapshot(now, limit) {
    const endsAt = monthEnd(now);
    const { used, reserved } = this.sql.exec("SELECT used, reserved FROM periods WHERE ends_at = ?", endsAt).toArray()[0] ?? { used: 0, reserved: 0 };
    return { endsAt, limit, used, reserved, remaining: Math.max(0, limit - used - reserved) };
  }

  changeSource(source, used, reserved) {
    if (source === null) this.sql.exec("UPDATE balance SET used = used + ?, reserved = reserved + ? WHERE id = 1", used, reserved);
    else this.sql.exec("UPDATE subscription_periods SET used = used + ?, reserved = reserved + ? WHERE id = ?", used, reserved, source);
  }

  finish(attempt, state, amount, now) {
    const allocation = JSON.parse(attempt.allocation);
    let before = attempt.used, after = amount;
    for (const { source, held } of allocation) {
      const previous = Math.min(held, before), next = Math.min(held, after);
      this.changeSource(source, next - previous, attempt.state === "unknown" ? 0 : -held);
      before -= previous;
      after -= next;
    }
    // Attribute a provider overrun to the original first funding source. It cannot debit a different grant or spill into top-ups.
    if (allocation.length && (before || after)) this.changeSource(allocation[0].source, after - before, 0);
    const held = attempt.state === "unknown" ? 0 : attempt.reserved;
    this.sql.exec("UPDATE periods SET used = used + ?, reserved = reserved - ? WHERE ends_at = ?", amount - attempt.used, held, attempt.ends_at);
    this.sql.exec("UPDATE attempts SET used = ?, state = ?, expires_at = ? WHERE id = ?", amount, state, now + RECEIPT_MS, attempt.id);
    return reply({ state });
  }

  reserveAttempt(id, amount, now, { usage, active = [] }) {
    const { month, subscription, credits } = usage;
    if (amount > month.remaining || (credits && amount > subscription.remaining + credits.remaining)) return reply(LIMITED, 429);
    const allocation = [];
    let remaining = amount;
    for (const { id: source, remaining: budget } of active) {
      const held = Math.min(remaining, budget);
      if (held) allocation.push({ source, held });
      remaining -= held;
      if (remaining === 0) break;
    }
    if (credits && remaining > 0) allocation.push({ source: null, held: remaining });
    this.sql.exec("INSERT OR IGNORE INTO periods VALUES (?, 0, 0)", usage.month.endsAt);
    this.sql.exec("INSERT INTO attempts VALUES (?, ?, ?, 0, 'reserved', ?, ?)", id, usage.month.endsAt, amount, now + LEASE_MS, JSON.stringify(allocation));
    for (const { source, held } of allocation) this.changeSource(source, 0, held);
    this.sql.exec("UPDATE periods SET reserved = reserved + ? WHERE ends_at = ?", amount, usage.month.endsAt);
    return reply({ state: "reserved" });
  }

  dispatchAttempt(attempt, now, { usage, active = [] }) {
    const balances = new Map(active.map(period => [period.id, period.granted - period.used - period.reserved]));
    if (usage.credits) balances.set(null, usage.credits.trial + usage.credits.purchased - usage.credits.used - usage.credits.reserved);
    if (attempt.ends_at !== usage.month.endsAt || usage.month.used + usage.month.reserved > usage.month.limit ||
        JSON.parse(attempt.allocation).some(({ source }) => !balances.has(source) || balances.get(source) < 0)) {
      this.finish(attempt, "refunded", 0, now);
      return reply(LIMITED, 429);
    }
    this.sql.exec("UPDATE attempts SET state = 'dispatched', expires_at = ? WHERE id = ?", now + LEASE_MS, attempt.id);
    return reply({ state: "dispatched" });
  }

  expire(now) {
    for (const attempt of this.sql.exec("SELECT * FROM attempts WHERE expires_at <= ? AND state IN ('reserved', 'dispatched')", now).toArray()) {
      if (attempt.state === "reserved") this.finish(attempt, "refunded", 0, now);
      else this.finish(attempt, "unknown", attempt.reserved, now);
    }
    this.sql.exec("DELETE FROM attempts WHERE expires_at <= ?", now);
    this.sql.exec("DELETE FROM periods WHERE ends_at <= ? AND NOT EXISTS (SELECT 1 FROM attempts WHERE attempts.ends_at = periods.ends_at)", now - RECEIPT_MS);
  }

  process({ operation, id, amount, policy, appCap }, now) {
    this.expire(now);
    const status = policy ? this.snapshot(now, policy) : appCap === undefined ? null : { usage: { month: this.monthSnapshot(now, appCap) } };
    if (operation === "status") return reply(status.usage);
    const attempt = this.sql.exec("SELECT * FROM attempts WHERE id = ?", id).toArray()[0];
    const conflict = () => reply({ state: attempt?.state ?? "missing" }, 409);
    if (operation === "reserve") {
      if (attempt) return attempt.state === "reserved" && attempt.reserved === amount ? reply({ state: "reserved" }) : conflict();
      return this.reserveAttempt(id, amount, now, status);
    }
    if (operation === "dispatch") return attempt?.state === "reserved" ? this.dispatchAttempt(attempt, now, status) : conflict();
    if (operation === "settle") {
      if (attempt?.state === "settled" && attempt.used === amount) return reply({ state: "settled" });
      return ["dispatched", "unknown"].includes(attempt?.state) ? this.finish(attempt, "settled", amount, now) : conflict();
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
    const app = request.url === APP_LEDGER_URL;
    if ((!app && request.url !== INTERNAL_URL) || request.method !== "POST") return reply({}, 404);
    let value;
    try { value = await request.json(); } catch { return reply({}, 400); }
    if (!validOperation(value, app)) return reply({}, 400);
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

/** Hold the entire text envelope at the uncached price plus provider framing and maximum output. */
export function estimateLunaCost(payload, outputTokens) {
  return (new TextEncoder().encode(payload).byteLength + 1024) * LUNA.input + outputTokens * LUNA.output;
}

export function reportedLunaCost(usage) {
  const { input_tokens: input, output_tokens: output, total_tokens: total, input_tokens_details: details } = usage ?? {};
  if (details !== undefined && (!details || typeof details !== "object" || Array.isArray(details))) return null;
  const { cached_tokens: cached = 0, cache_write_tokens: written = 0, cache_write_tokens_details: writes = {} } = details ?? {};
  if (!writes || typeof writes !== "object" || Array.isArray(writes)) return null;
  const { ttl_30m_tokens: write30m = 0, ttl_12h_tokens: write12h = 0 } = writes;
  if (![input, output, total, cached, written, write30m, write12h].every(count) || input + output !== total ||
      cached + written > input || write30m + write12h !== written) return null;
  const cost = (input - cached - written) * LUNA.input + cached * LUNA.cached +
    write30m * LUNA.write30m + write12h * LUNA.write12h + output * LUNA.output;
  return count(cost) ? cost : null;
}

function emailSession(config, session) {
  return config?.origin === APP_ORIGIN && config.issuer === APP_ORIGIN && session?.authMode === "email" &&
    Number.isSafeInteger(session.expiresAt) && session.expiresAt > Date.now();
}

function usableNamespace(namespace) {
  return typeof namespace?.idFromName === "function" && typeof namespace.get === "function";
}

function launchTrafficLimits(env) {
  const accountDay = configuredCount(env.LAUNCH_AI_ACCOUNT_REQUESTS_PER_DAY ?? "100");
  const appDay = configuredCount(env.LAUNCH_AI_APP_REQUESTS_PER_DAY ?? "1000");
  const appMonth = configuredCount(env.LAUNCH_AI_APP_REQUESTS_PER_MONTH ?? "15000");
  if (!accountDay || accountDay > 10_000 || !appDay || appDay > 100_000 || !appMonth || appMonth > 3_100_000 ||
      accountDay > appDay || appDay > appMonth) return null;
  return { accountDay, appDay, appMonth };
}

export function launchUsageConfigured(env) {
  return env[LAUNCH_COST_METERING_FLAG] === "true" && configuredCount(env.LAUNCH_AI_MONTHLY_CAP_NANO_USD ?? DEFAULT_MONTHLY_CAP) > 0 &&
    configuredCount(env.LAUNCH_AI_TRIAL_NANO_USD ?? "0") !== null && Boolean(launchTrafficLimits(env)) &&
    (env[LAUNCH_APP_CAP_SETTING] === undefined || configuredCount(env[LAUNCH_APP_CAP_SETTING]) > 0) &&
    usableNamespace(env.LAUNCH_USAGE) && usableNamespace(env.COMMERCE);
}

export function createLaunchUsage(env, { config, session }) {
  if (env[LAUNCH_COST_METERING_FLAG] !== "true") return { enabled: false };
  const configured = launchUsageConfigured(env);
  const monthlyCap = configuredCount(env.LAUNCH_AI_MONTHLY_CAP_NANO_USD ?? DEFAULT_MONTHLY_CAP);
  const appCapConfigured = env[LAUNCH_APP_CAP_SETTING] !== undefined;
  const appCap = appCapConfigured ? configuredCount(env[LAUNCH_APP_CAP_SETTING]) : MAX_AMOUNT;
  const testRealm = stripeTestRealm(env);
  const commerce = launchCommerceNamespace(env);
  const trial = configuredCount(env.LAUNCH_AI_TRIAL_NANO_USD ?? "0");
  const usesPolicy = operation => ["status", "reserve", "dispatch"].includes(operation);
  async function ledger(name, url, operation, fields) {
    const namespace = env.LAUNCH_USAGE;
    return namespace.get(namespace.idFromName(testRealm ? "stripe-test:" + name : name)).fetch(new Request(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ operation, ...fields }),
    }));
  }
  async function accountCommand(operation, fields = {}) {
    const readsPolicy = usesPolicy(operation);
    if (!configured || (readsPolicy && !emailSession(config, session))) return unavailable();
    try {
      const subject = await accountIdentity(config, session);
      if (readsPolicy) {
        const response = await readEntitlement(commerce, { subject });
        if (!response.ok) return unavailable();
        const { unit, credits: purchased, revision, subscriptionGrants } = await response.json();
        const policy = { monthlyCap, trial, purchased, revision, subscriptionGrants };
        if (unit !== UNIT || !validPolicy(policy)) return unavailable();
        fields = { ...fields, policy };
      }
      return await ledger(`cost:v1:${subject}`, INTERNAL_URL, operation, fields);
    } catch { return unavailable(); }
  }
  async function appCommand(operation, fields = {}) {
    if (!configured) return unavailable();
    try {
      return await ledger("cost:v1:app", APP_LEDGER_URL, operation, usesPolicy(operation) ? { ...fields, appCap } : fields);
    } catch { return unavailable(); }
  }
  async function complete(command, operation, fields) {
    const result = await command(operation, fields);
    return result.status >= 500 ? command(operation, fields) : result;
  }
  async function completeBoth(operation, fields) {
    const [account, app] = await Promise.all([complete(accountCommand, operation, fields), complete(appCommand, operation, fields)]);
    return account.ok ? app : account;
  }
  function appLimit(result) {
    return result.status === 429 ? reply({ error: "analysis_app_spend_limit" }, 429) : result;
  }
  async function status() {
    const account = await accountCommand("status");
    const paused = testRealm || env.LAUNCH_AI_PAUSED === "true";
    if (!account.ok || (!appCapConfigured && !paused)) return account;
    const usage = await account.json();
    if (usage.available && !paused) {
      const app = await appCommand("status");
      if (!app.ok) return unavailable();
      usage.available = (await app.json()).month.remaining > 0;
    } else usage.available = false;
    return reply(usage);
  }
  async function reserve(id, amount) {
    if (testRealm) return unavailable();
    const account = await accountCommand("reserve", { id, amount });
    if (!account.ok) return account;
    const app = await appCommand("reserve", { id, amount });
    if (!app.ok) {
      await complete(accountCommand, "refund", { id });
      if (app.status >= 500) await complete(appCommand, "refund", { id });
    }
    return appLimit(app);
  }
  async function dispatch(id) {
    if (testRealm) return unavailable();
    const account = await accountCommand("dispatch", { id });
    if (!account.ok) {
      await complete(appCommand, "refund", { id });
      return account;
    }
    const app = await appCommand("dispatch", { id });
    if (!app.ok) {
      await complete(accountCommand, "refund-before-fetch", { id });
      // This attempt cannot make its provider request without both dispatch acknowledgements.
      if (app.status >= 500 && !(await complete(appCommand, "refund", { id })).ok) {
        await complete(appCommand, "refund-before-fetch", { id });
      }
    }
    return appLimit(app);
  }
  return {
    enabled: true,
    estimateCost: estimateLunaCost,
    trafficLimits: launchTrafficLimits(env),
    status, reserve, dispatch,
    refund: id => completeBoth("refund", { id }),
    // Only the handler with the dispatch acknowledgement can prove fetch never ran.
    refundBeforeFetch: id => completeBoth("refund-before-fetch", { id }),
    finalize: (id, usage) => {
      const amount = reportedLunaCost(usage);
      return amount === null ? completeBoth("unknown", { id }) : completeBoth("settle", { id, amount });
    },
  };
}

export async function handleLaunchUsage(request, env, { config, session }) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!emailSession(config, session) || url.origin !== config.origin || (origin !== null && origin !== config.origin) ||
      ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) return reply({ error: "Sign in to SatinLore to view AI analysis usage." }, 403);
  if (url.pathname !== LAUNCH_USAGE_PATH || url.search) return reply({ error: "Use the SatinLore account controls." }, 400);
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const usage = createLaunchUsage(env, { config, session });
  const result = usage.enabled ? await usage.status() : reply({ enabled: false, available: false });
  if (!emailSession(config, session)) return reply({ error: "Sign in to SatinLore to view AI analysis usage." }, 403);
  return request.method === "HEAD" ? new Response(null, result) : result;
}
