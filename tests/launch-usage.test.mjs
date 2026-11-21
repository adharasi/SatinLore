import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { accountIdentity } from "../deploy/cloudflare/accounts.mjs";
import { betaSandboxAiEnabled, createLaunchUsage, handleLaunchUsage, LaunchUsage, LAUNCH_USAGE_PATH, estimateLunaCost, reportedLunaCost } from "../deploy/cloudflare/launch-usage.mjs";
import { handleSceneAnalysis, SceneAnalysisBudget } from "../deploy/cloudflare/scene-analysis.mjs";

const ORIGIN = "https://app.satinlore.com";
const config = { origin: ORIGIN, issuer: ORIGIN };
const policy = { monthlyCap: 1_000, trial: 100, purchased: 1_200, revision: 1, subscriptionGrants: [] };
const JANUARY = Date.UTC(2026, 0, 31, 23, 59, 45);
const FEBRUARY = Date.UTC(2026, 1, 1);
const OUTBOUND = "https://api.openai.com/v1/responses";
const CUES = { cues: [{ id: 1, phase: "sustain", rhythm: "steady", previous: "quiet", next: "recover", movementCount: 1, shape: "sustained" }] };

function storageFixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let alarm = null;
  return {
    sql: { exec(query, ...parameters) {
      const statement = db.prepare(query);
      const rows = statement.columns().length ? statement.all(...parameters) : (statement.run(...parameters), []);
      return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } };
    } },
    transactionSync(callback) {
      db.exec("BEGIN IMMEDIATE");
      try { const result = callback(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarm = value; },
  };
}

function ledgerFixture(t) {
  const storage = storageFixture(t);
  let ledger = new LaunchUsage({ storage });
  const command = async (operation, fields, now = JANUARY) => {
    const result = storage.transactionSync(() => ledger.process({ operation, ...fields }, now));
    return { status: result.status, ...await result.json() };
  };
  return {
    command,
    restart() { ledger = new LaunchUsage({ storage }); },
  };
}

test("atomic holds and a single dispatch survive duplicate commands and a ledger restart", async t => {
  const { command, restart } = ledgerFixture(t);
  const id = randomUUID(), other = randomUUID();
  const results = await Promise.all([id, other].map(id => command("reserve", { id, amount: 650, policy })));
  assert.deepEqual(results.map(result => result.status), [200, 429]);
  assert.equal((await command("reserve", { id, amount: 650, policy })).state, "reserved");
  assert.equal((await command("reserve", { id, amount: 651, policy })).status, 409);
  const dispatches = await Promise.all([1, 2].map(() => command("dispatch", { id, policy })));
  assert.deepEqual(dispatches.map(result => result.status), [200, 409]);
  restart();
  assert.equal((await command("refund", { id })).status, 409);
  assert.equal((await command("dispatch", { id, policy })).status, 409);
  assert.equal((await command("settle", { id, amount: 65 })).state, "settled");
  assert.equal((await command("settle", { id, amount: 65 })).status, 200);
  assert.equal((await command("settle", { id, amount: 0 })).status, 409);
  const current = await command("status", { policy });
  assert.deepEqual(current.month, { endsAt: FEBRUARY, limit: 1_000, used: 65, reserved: 0, remaining: 935 });
  assert.deepEqual(current.credits, { trial: 100, purchased: 1_200, used: 65, reserved: 0, remaining: 1_235 });
  const reconfigured = await command("status", { policy: { ...policy, trial: 0 } });
  assert.deepEqual(reconfigured.credits, current.credits);
});

test("expiry refunds unstarted holds, charges uncertain calls, and carries used credits across UTC months", async t => {
  const { command } = ledgerFixture(t);
  const uncertain = randomUUID(), unused = randomUUID(), rollover = randomUUID();
  for (const id of [uncertain, unused, rollover]) assert.equal((await command("reserve", { id, amount: 300, policy })).status, 200);
  assert.equal((await command("dispatch", { id: uncertain, policy })).status, 200);
  assert.equal((await command("dispatch", { id: rollover, policy }, FEBRUARY)).status, 429);
  const afterLease = JANUARY + 60_001;
  const current = await command("status", { policy }, afterLease);
  assert.equal(current.month.used, 0);
  assert.equal(current.month.remaining, 1_000);
  assert.deepEqual(current.credits, { trial: 100, purchased: 1_200, used: 300, reserved: 0, remaining: 1_000 });
  assert.equal((await command("reserve", { id: unused, amount: 300, policy }, afterLease)).status, 409);
  assert.equal((await command("refund", { id: unused }, afterLease)).state, "refunded");
  assert.equal((await command("unknown", { id: uncertain }, afterLease)).state, "unknown");
  assert.equal((await command("settle", { id: uncertain, amount: 180 }, afterLease)).state, "settled");
  assert.equal((await command("status", { policy }, afterLease)).credits.used, 180);
});

test("failed credit reconciliation blocks dispatch and late verified overage is charged exactly once", async t => {
  const { command } = ledgerFixture(t);
  const old = randomUUID(), paid = randomUUID();
  assert.equal((await command("reserve", { id: old, amount: 1_000, policy })).status, 200);
  const reversed = { ...policy, purchased: 0, revision: 2 };
  assert.equal((await command("dispatch", { id: old, policy: reversed })).status, 429);
  assert.equal((await command("dispatch", { id: old, policy: reversed })).status, 409);
  await assert.rejects(command("reserve", { id: paid, amount: 1_000, policy }), /entitlement revision/);
  const withPurchase = { ...policy, revision: 3 };
  assert.equal((await command("reserve", { id: paid, amount: 800, policy: withPurchase })).status, 200);
  assert.equal((await command("dispatch", { id: paid, policy: withPurchase })).status, 200);
  assert.equal((await command("settle", { id: paid, amount: 1_350 })).status, 200);
  const { credits, month, available } = await command("status", { policy: withPurchase });
  assert.equal(available, false);
  assert.equal(credits.used, 1_350);
  assert.equal(credits.remaining, 0);
  assert.equal(month.used, 1_350);
  assert.equal(month.remaining, 0);
});

test("Luna cost uses integer Standard prices for uncached, cached, cache writes and all output tokens", () => {
  assert.equal(estimateLunaCost("é", 600), (2 + 1_024) * 100 + 600 * 500);
  assert.equal(reportedLunaCost({ input_tokens: 12_000, total_tokens: 12_600, output_tokens: 600,
    input_tokens_details: { cached_tokens: 4_000, cache_write_tokens: 7_000,
      cache_write_tokens_details: { ttl_30m_tokens: 3_000, ttl_12h_tokens: 4_000 } },
    output_tokens_details: { reasoning_tokens: 500 },
  }), 1_815_000);
  for (const details of [null, [], { cached_tokens: null }, { cached_tokens: 101 }, { cached_tokens: -1 }, { cache_write_tokens: 7 },
    { cached_tokens: 50, cache_write_tokens: 60, cache_write_tokens_details: { ttl_30m_tokens: 60 } }]) {
    assert.equal(reportedLunaCost({ input_tokens: 100, total_tokens: 102, output_tokens: 2, input_tokens_details: details }), null);
  }
  assert.equal(reportedLunaCost({ input_tokens: 100, total_tokens: 103, output_tokens: 2 }), null);
});

test("subscription funds are spent before lifetime credit and a $2 period can be used exactly", async t => {
  const { command } = ledgerFixture(t);
  const grant = { id: `first:${JANUARY + 30_000}`, startsAt: JANUARY - 6000, endsAt: JANUARY + 30_000, credits: 2_000_000_000 };
  const funded = { ...policy, monthlyCap: 10_000_000_000, purchased: 500, subscriptionGrants: [grant] };
  const id = randomUUID();
  assert.equal((await command("reserve", { id, amount: 2_000_000_000, policy: funded })).status, 200);
  const held = await command("status", { policy: funded });
  assert.equal(held.subscription.reserved, 2_000_000_000);
  assert.equal(held.credits.reserved, 0);
  assert.equal((await command("dispatch", { id, policy: funded })).status, 200);
  assert.equal((await command("settle", { id, amount: 2_000_000_000 })).status, 200);
  const spent = await command("status", { policy: funded });
  assert.deepEqual(spent.subscription, { granted: 2_000_000_000, used: 2_000_000_000, reserved: 0, remaining: 0, endsAt: grant.endsAt });
  assert.equal(spent.credits.remaining, 600);
  assert.equal(spent.month.used, 2_000_000_000);
  assert.equal((await command("reserve", { id: randomUUID(), amount: 601, policy: funded })).status, 429);
});

test("expiry preserves lifetime credit and never quietly replaces an expired reservation with top-ups", async t => {
  const { command } = ledgerFixture(t);
  const ending = { id: "soon", startsAt: JANUARY - 1000, endsAt: JANUARY + 5000, credits: 600 };
  const funding = { ...policy, subscriptionGrants: [ending] };
  const crossing = randomUUID(), unused = randomUUID();
  assert.equal((await command("reserve", { id: crossing, amount: 600, policy: funding })).status, 200);
  assert.equal((await command("dispatch", { id: crossing, policy: funding })).status, 200);
  assert.equal((await command("settle", { id: crossing, amount: 300 }, JANUARY + 1000)).status, 200);
  assert.equal((await command("reserve", { id: unused, amount: 500, policy: funding }, JANUARY + 1000)).status, 200);
  assert.equal((await command("status", { policy: funding }, JANUARY + 1000)).credits.reserved, 200);
  assert.equal((await command("dispatch", { id: unused, policy: funding }, ending.endsAt)).status, 429);
  const expired = await command("status", { policy: { ...policy, subscriptionGrants: [] } }, ending.endsAt);
  assert.deepEqual(expired.subscription, { granted: 0, used: 0, reserved: 0, remaining: 0, endsAt: null });
  assert.equal(expired.credits.used, 0);
  assert.equal(expired.credits.reserved, 0);
  assert.equal(expired.credits.remaining, 1300);
});

test("late usage reconciles its original subscription window after expiry and does not spill into top-ups", async t => {
  const { command } = ledgerFixture(t);
  const ending = { id: "period-one", startsAt: JANUARY - 1000, endsAt: FEBRUARY, credits: 600 };
  const renewal = { id: "period-two", startsAt: FEBRUARY, endsAt: Date.UTC(2026, 2, 1), credits: 800 };
  const current = { ...policy, subscriptionGrants: [ending, renewal] };
  const id = randomUUID();
  assert.equal((await command("reserve", { id, amount: 600, policy: current })).status, 200);
  assert.equal((await command("dispatch", { id, policy: current })).status, 200);
  const nextMonth = JANUARY + 60_001;
  assert.equal((await command("unknown", { id }, nextMonth)).status, 200);
  assert.equal((await command("settle", { id, amount: 605 }, nextMonth)).status, 200);
  const renewed = await command("status", { policy: current }, nextMonth);
  assert.equal(renewed.subscription.remaining, 800);
  assert.equal(renewed.credits.remaining, 1300);
  assert.equal(renewed.month.used, 0);
  // Replaying the prior window proves its original source paid the true cost, including overage.
  const prior = await command("status", { policy: current }, JANUARY + 1000);
  assert.equal(prior.subscription.used, 605);
  assert.equal(prior.month.used, 605);
});

test("late settlement releases the part of a mixed reservation that did not need purchased credit", async t => {
  const { command } = ledgerFixture(t);
  const grant = { id: "short", startsAt: JANUARY - 1000, endsAt: JANUARY + 3000, credits: 600 };
  const active = { ...policy, subscriptionGrants: [grant] };
  const id = randomUUID();
  assert.equal((await command("reserve", { id, amount: 850, policy: active })).status, 200);
  assert.equal((await command("dispatch", { id, policy: active })).status, 200);
  assert.equal((await command("status", { policy: active })).credits.reserved, 250);
  assert.equal((await command("settle", { id, amount: 480 }, grant.endsAt)).status, 200);
  const expired = await command("status", { policy: active }, grant.endsAt);
  assert.equal(expired.subscription.remaining, 0);
  assert.deepEqual(expired.credits, { trial: 100, purchased: 1_200, used: 0, reserved: 0, remaining: 1_300 });
  assert.equal(expired.month.used, 480);
});

test("a reduced subscription grant cannot dispatch against a different funding source", async t => {
  const { command } = ledgerFixture(t);
  const grant = { id: "reduced", startsAt: JANUARY - 1000, endsAt: FEBRUARY, credits: 600 };
  const active = { ...policy, subscriptionGrants: [grant] };
  const id = randomUUID();
  assert.equal((await command("reserve", { id, amount: 500, policy: active })).status, 200);
  const trimmed = { ...active, revision: 2, subscriptionGrants: [{ ...grant, credits: 200 }] };
  assert.equal((await command("dispatch", { id, policy: trimmed })).status, 429);
  const current = await command("status", { policy: trimmed });
  assert.equal(current.subscription.remaining, 200);
  assert.equal(current.credits.remaining, 1_300);
  await assert.rejects(command("status", { policy: active }), /entitlement revision/);
});

test("launch request limits enforce per-account and app budgets independently of beta", async t => {
  const ledger = new SceneAnalysisBudget({ storage: storageFixture(t) });
  const limits = { accountDay: 1, appDay: 2, appMonth: 2 };
  const allow = (reader, launch) => ledger.fetch(new Request(`https://scene-analysis.internal/reserve${launch ? "-launch" : ""}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reader: reader.repeat(64), ...(launch ? { limits } : {}) }),
  }));
  assert.equal((await allow("a", true)).status, 204);
  assert.equal((await allow("a", true)).status, 429);
  assert.equal((await allow("b", true)).status, 204);
  const capped = await allow("c", true);
  assert.equal(capped.status, 429);
  assert.match(capped.headers.get("Retry-After"), /^\d+$/);
  assert.equal((await allow("a", false)).status, 204);
  assert.equal((await allow("c", false)).status, 204);
});

function sceneFixture(t, { purchased = 15_000_000_000, monthlyCap, up, onDispatch, entitlement } = {}) {
  const ledgers = new Map();
  const actors = [];
  const usageOps = [];
  const appUsageOps = [];
  const budgetOps = [];
  const providerCalls = [];
  const session = { authMode: "email", subject: `email-v1:${"a".repeat(64)}`, expiresAt: Date.now() + 60_000 };
  const env = {
    LAUNCH_AI_COST_METERING_ENABLED: "true", ...(monthlyCap ? { LAUNCH_AI_MONTHLY_CAP_NANO_USD: monthlyCap } : {}),
    OPENAI_API_KEY: "sk-synthetic-only",
    COMMERCE: { idFromName: name => name, get: () => ({ async fetch(request) {
      const value = await request.json();
      assert.equal(value.action, "readEntitlement");
      actors.push(value.fields.subject);
      return entitlement ? entitlement() : Response.json({ unit: "nano_usd", credits: purchased, revision: 1, subscriptionGrants: [] });
    } }) },
    LAUNCH_USAGE: { idFromName: name => name, get(name) {
      const isApp = name === "cost:v1:app";
      if (!isApp) assert.match(name, /^cost:v1:account:v1:[a-f0-9]{64}$/);
      if (!ledgers.has(name)) ledgers.set(name, new LaunchUsage({ storage: storageFixture(t) }));
      return { async fetch(request) {
        const value = await request.clone().json();
        (isApp ? appUsageOps : usageOps).push(value);
        const result = await ledgers.get(name).fetch(request);
        if (value.operation === "dispatch" && result.ok) onDispatch?.();
        return result;
      } };
    } },
    SCENE_ANALYSIS_BUDGET: { idFromName: name => name, get: id => ({ async fetch(request) {
      budgetOps.push({ id, url: request.url, value: await request.json() });
      return new Response(null, { status: 204 });
    } }) },
  };
  const analysisFetcher = (url, options) => {
    assert.equal(url, OUTBOUND);
    providerCalls.push(JSON.parse(options.body));
    return up ? up() : Response.json({ status: "completed", usage: { input_tokens: 80, output_tokens: 22,
      total_tokens: 102, input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 18 } },
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels: [{ id: 1, label: "steady" }] }) }] }] });
  };
  const scene = ({ who = session, reverify = () => who, signal, body = CUES } = {}) => handleSceneAnalysis(new Request(`${ORIGIN}/api/scene-analysis`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  }), env, { config, session: who, reverify, analysisFetcher, launchUsage: createLaunchUsage(env, { config, session: who }) });
  const usage = (who = session, headers) => handleLaunchUsage(new Request(`${ORIGIN}${LAUNCH_USAGE_PATH}`, { headers }), env, { config, session: who });
  return { env, session, actors, usageOps, appUsageOps, budgetOps, providerCalls, scene, usage };
}

test("Stripe test credits are visible in their own namespace but cannot reserve or dispatch paid AI", async t => {
  const {env, session, usage, providerCalls, scene} = sceneFixture(t);
  Object.assign(env, {LAUNCH_PAYMENT_PROVIDER: "stripe", STRIPE_MODE: "test"});
  const names = [];
  const testNamespace = (binding, prefix) => ({idFromName(name) {
    assert.match(name, prefix);
    names.push(name);
    return binding.idFromName(name.slice("stripe-test:".length));
  }, get: name => binding.get(name)});
  env.COMMERCE = testNamespace(env.COMMERCE, /^stripe-test:launch$/);
  env.LAUNCH_USAGE = testNamespace(env.LAUNCH_USAGE, /^stripe-test:cost:v1:account:v1:[a-f0-9]{64}$/);
  const view = await (await usage()).json();
  assert.equal(view.credits.purchased, 15_000_000_000);
  assert.equal(view.available, false);
  assert.equal(names.length, 2);
  assert.equal((await scene()).status, 503);
  assert.equal((await createLaunchUsage(env, {config, session}).dispatch(randomUUID())).status, 503);
  assert.equal(providerCalls.length, 0);
});

test("beta OpenAI opt-in requires a separate key and caps sandbox ledger spending", async t => {
  const { env, session, usage, scene, providerCalls } = sceneFixture(t);
  Object.assign(env, { BETA_PREVIEW_PREFIX: "/beta", BETA_OPENAI_ENABLED: "true", BETA_OPENAI_API_KEY: "sk-proj-beta-fixture-only",
    LAUNCH_PAYMENT_PROVIDER: "stripe", STRIPE_MODE: "test", LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD: "1000000" });
  assert.equal(betaSandboxAiEnabled(env), true);
  for (const overrides of [
    { BETA_PREVIEW_PREFIX: undefined }, { BETA_OPENAI_ENABLED: undefined }, { BETA_OPENAI_API_KEY: undefined },
    { BETA_OPENAI_API_KEY: env.OPENAI_API_KEY }, { STRIPE_MODE: "live" }, { LAUNCH_AI_PAUSED: "true" },
    { LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD: undefined }, { LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD: "0" },
  ]) assert.equal(betaSandboxAiEnabled({ ...env, ...overrides }), false);
  assert.equal((await scene({ who: { ...session, authMode: "access" } })).status, 503);
  assert.equal(providerCalls.length, 0);

  const names = [];
  const sandbox = binding => ({ idFromName(name) {
    assert.ok(name.startsWith("stripe-test:"));
    names.push(name);
    return binding.idFromName(name.slice("stripe-test:".length));
  }, get: name => binding.get(name) });
  env.COMMERCE = sandbox(env.COMMERCE);
  env.LAUNCH_USAGE = sandbox(env.LAUNCH_USAGE);
  const ledger = createLaunchUsage(env, { config, session });
  const id = randomUUID();
  assert.equal((await (await usage()).json()).available, true);
  assert.equal((await ledger.reserve(id, 1_000_000)).status, 200);
  assert.equal((await ledger.dispatch(id)).status, 200);
  assert.equal((await ledger.finalize(id, { input_tokens: 80, output_tokens: 22, total_tokens: 102 })).status, 200);
  assert.equal((await (await usage()).json()).credits.used, 19_000);
  const limit = await ledger.reserve(randomUUID(), 1_000_000);
  assert.equal(limit.status, 429);
  assert.deepEqual(await limit.json(), { error: "analysis_app_spend_limit" });
  assert.ok(names.includes("stripe-test:launch"));
  assert.ok(names.includes("stripe-test:cost:v1:app"));
});

test("production scene path sends no private payload to the ledger and settles the Luna cost mix", async t => {
  const f = sceneFixture(t);
  assert.equal((await f.scene()).status, 200);
  const body = await (await f.usage()).json();
  assert.equal(body.unit, "nano_usd");
  assert.equal(body.credits.purchased, 15_000_000_000);
  assert.equal(body.credits.used, 16_300);
  assert.equal(body.month.remaining, 10_000_000_000 - 16_300);
  assert.equal(f.providerCalls.length, 1);
  assert.equal(f.providerCalls[0].service_tier, "default");
  assert.deepEqual(f.providerCalls[0].prompt_cache_options, { mode: "explicit" });
  assert.equal(f.budgetOps.length, 1);
  assert.equal(f.budgetOps[0].id, "scene-analysis:launch:v1");
  assert.equal(f.budgetOps[0].url, "https://scene-analysis.internal/reserve-launch");
  assert.deepEqual(f.budgetOps[0].value.limits, { accountDay: 100, appDay: 1000, appMonth: 15000 });
  assert.deepEqual([...new Set(f.actors)], [await accountIdentity(config, f.session)]);
  assert.deepEqual(f.usageOps.map(value => value.operation), ["status", "reserve", "dispatch", "settle", "status"]);
  assert.deepEqual(f.appUsageOps.map(value => value.operation), ["reserve", "dispatch", "settle"]);
  assert.doesNotMatch(JSON.stringify(f.usageOps), /synthetic|email-v1|steady|instructions|reasoning|input_tokens/);
  assert.doesNotMatch(JSON.stringify(f.appUsageOps), /synthetic|email-v1|account:v1|steady|instructions|reasoning|input_tokens/);
  const other = { ...f.session, subject: `email-v1:${"b".repeat(64)}` };
  assert.equal((await (await f.usage(other)).json()).credits.used, 0);
  assert.equal((await f.usage(undefined, { Origin: "https://beta.satinlore.com" })).status, 403);
  assert.equal((await f.usage({ ...f.session, authMode: "access" })).status, 403);
});

test("a monthly app cost limit serializes different accounts and refunds a rejected account hold", async t => {
  let entered, release;
  const enteredProvider = new Promise(resolve => { entered = resolve; });
  const resumeProvider = new Promise(resolve => { release = resolve; });
  const f = sceneFixture(t, { async up() {
    entered();
    await resumeProvider;
    return Response.json({ status: "completed", usage: { input_tokens: 80, output_tokens: 22, total_tokens: 102 },
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels: [{ id: 1, label: "steady" }] }) }] }] });
  } });
  const other = { ...f.session, subject: `email-v1:${"b".repeat(64)}` };
  // Measure the fixed conservative request hold with the exact launch payload.
  const probe = sceneFixture(t);
  assert.equal((await probe.scene()).status, 200);
  const { amount } = probe.appUsageOps.find(value => value.operation === "reserve");
  probe.env.LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD = String(amount);
  assert.equal((await probe.scene()).status, 429, "Enabling the cap must include earlier metered spend in this release.");
  f.env.LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD = String(amount);
  const first = f.scene();
  try {
    await Promise.race([enteredProvider, first.then(response => assert.fail(`Provider was not reached, HTTP ${response.status}`))]);
    assert.equal((await (await f.usage(other)).json()).available, false);
    const rejected = await f.scene({ who: other });
    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).code, "rate_limited");
    const ledger = await (await f.usage(other)).json();
    assert.equal(ledger.credits.reserved, 0);
    assert.equal(ledger.credits.used, 0);
  } finally { release(); }
  assert.equal((await first).status, 200);
  assert.equal((await (await f.usage(other)).json()).available, true);
  // The next full hold still cannot fit until the cap accounts for the settled spend.
  assert.equal((await f.scene({ who: other })).status, 429);
  f.env.LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD = String(amount + 19_000);
  assert.equal((await f.scene({ who: other })).status, 200);
  assert.equal(f.providerCalls.length, 2);
});

test("app calendar rollover and a pause leave personal credits and research traffic intact", async t => {
  const { command } = ledgerFixture(t);
  const expired = randomUUID(), rollover = randomUUID();
  const appCap = 900;
  assert.equal((await command("reserve", { id: expired, amount: 600, appCap })).status, 200);
  assert.equal((await command("dispatch", { id: expired, appCap })).status, 200);
  assert.equal((await command("reserve", { id: rollover, amount: 300, appCap })).status, 200);
  assert.equal((await command("dispatch", { id: rollover, appCap }, FEBRUARY)).status, 429);
  assert.equal((await command("settle", { id: expired, amount: 500 }, FEBRUARY)).status, 200);
  assert.equal((await command("status", { appCap }, JANUARY + 1000)).month.remaining, 400);
  assert.equal((await command("status", { appCap }, FEBRUARY)).month.remaining, 900);

  const f = sceneFixture(t);
  f.env.LAUNCH_AI_PAUSED = "true";
  assert.equal((await f.scene()).status, 503);
  assert.equal((await (await f.usage()).json()).available, false);
  assert.equal(f.providerCalls.length, 0);
  assert.equal((await f.scene({ who: { ...f.session, authMode: "access" } })).status, 200);
  assert.equal(f.providerCalls.length, 1);

  f.env.LAUNCH_AI_PAUSED = "false";
  f.env.LAUNCH_AI_COST_METERING_ENABLED = "false";
  f.env.LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD = "1000000";
  assert.equal((await f.scene()).status, 503);
  assert.equal(f.providerCalls.length, 1);
});

test("unfunded or misconfigured email calls stop before shared quota and flag-off preserves prior behavior", async t => {
  const unfunded = sceneFixture(t, { purchased: 0 });
  const lowCap = sceneFixture(t, { monthlyCap: "1" });
  const invalid = sceneFixture(t, { monthlyCap: "0" });
  const storageOffline = sceneFixture(t, { entitlement: () => Response.json({}, { status: 503 }) });
  const legacy = sceneFixture(t, { entitlement: () => Response.json({ credits: 9_999_999, revision: 1 }) });
  const invalidTraffic = sceneFixture(t);
  invalidTraffic.env.LAUNCH_AI_APP_REQUESTS_PER_DAY = "0001";
  for (const [f, status] of [[unfunded, 429], [lowCap, 429], [invalid, 503], [storageOffline, 503], [legacy, 503], [invalidTraffic, 503]]) {
    assert.equal((await f.scene()).status, status);
    assert.equal(f.providerCalls.length, 0);
    assert.equal(f.budgetOps.length, 0);
  }
  const trial = sceneFixture(t, { purchased: 0 });
  trial.env.LAUNCH_AI_TRIAL_NANO_USD = "10000000";
  assert.equal((await trial.scene()).status, 200);
  assert.equal((await (await trial.usage()).json()).credits.remaining, 10_000_000 - 16_300);
  unfunded.env.LAUNCH_AI_COST_METERING_ENABLED = "false";
  unfunded.env.LAUNCH_AI_USAGE_ENABLED = "true";
  assert.deepEqual(await (await unfunded.usage()).json(), { enabled: false, available: false });
  assert.equal((await unfunded.scene()).status, 200);
  assert.equal(unfunded.budgetOps[0].id, "scene-analysis:v1");
  assert.equal(unfunded.providerCalls[0].service_tier, undefined);
});

test("confirmed non-dispatch refunds, while refused or uncertain provider calls are metered", async t => {
  const revoked = sceneFixture(t);
  assert.equal((await revoked.scene({ reverify: () => null })).status, 403);
  assert.equal(revoked.providerCalls.length, 0);
  assert.equal((await (await revoked.usage()).json()).credits.reserved, 0);
  assert.ok(revoked.usageOps.some(value => value.operation === "refund"));

  const disconnect = new AbortController();
  const aborted = sceneFixture(t, { onDispatch: () => disconnect.abort() });
  assert.equal((await aborted.scene({ signal: disconnect.signal })).status, 403);
  assert.equal(aborted.providerCalls.length, 0);
  assert.equal((await (await aborted.usage()).json()).credits.used, 0);
  assert.ok(aborted.usageOps.some(value => value.operation === "refund-before-fetch"));

  const unknown = sceneFixture(t, { up() { throw new TypeError("test transport failure"); } });
  assert.equal((await unknown.scene()).status, 503);
  assert.equal(unknown.providerCalls.length, 1);
  const hold = unknown.usageOps.find(value => value.operation === "reserve").amount;
  assert.equal((await (await unknown.usage()).json()).credits.used, hold);
  assert.equal((await (await unknown.usage()).json()).credits.reserved, 0);

  const refused = sceneFixture(t, { up: () => Response.json({ status: "completed", usage: {
    input_tokens: 20, output_tokens: 7, total_tokens: 27,
  }, output: [{ type: "message", role: "assistant", content: [{ type: "refusal" }] }] }) });
  assert.equal((await refused.scene()).status, 422);
  assert.equal((await (await refused.usage()).json()).credits.used, 5_500);
});

test("Cloudflare SQLite bindings persist a successful metered provider response", { timeout: 20_000 }, async t => {
  const source = await build({ stdin: {
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "launch-usage-fixture.mjs", contents: `
      import { createLaunchUsage, handleLaunchUsage, LAUNCH_USAGE_PATH, estimateLunaCost, reportedLunaCost } from './deploy/cloudflare/launch-usage.mjs';
      import { handleSceneAnalysis } from './deploy/cloudflare/scene-analysis.mjs';
      export { LaunchUsage } from './deploy/cloudflare/launch-usage.mjs';
      export { SatinLoreCommerce } from './deploy/cloudflare/commerce.mjs';
      export { SceneAnalysisBudget } from './deploy/cloudflare/scene-analysis.mjs';
      export default { fetch(request, env) {
        const config = { origin: '${ORIGIN}', issuer: '${ORIGIN}' };
        const fixture = request.headers.get('X-Second-Test-Account') === 'true' ? 'b' : 'a';
        const session = { authMode: 'email', subject: 'email-v1:' + fixture.repeat(64), expiresAt: Date.now() + 60000 };
        if (new URL(request.url).pathname === LAUNCH_USAGE_PATH) return handleLaunchUsage(request, env, { config, session });
        return handleSceneAnalysis(request, env, { config, session, reverify: () => session,
          launchUsage: createLaunchUsage(env, { config, session }) });
      } };
    `,
  }, bundle: true, write: false, format: "esm", external: ["node:crypto"] });
  let outbound = 0, notifyStart, releaseProvider;
  const providerStarted = new Promise(resolve => { notifyStart = resolve; });
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "launch-usage-fixture.mjs", contents: source.outputFiles[0].text }],
    compatibilityDate: "2026-05-22", compatibilityFlags: ["nodejs_compat"], cf: false, port: 0, inspectorPort: 0,
    bindings: { OPENAI_API_KEY: "sk-synthetic-only", LAUNCH_AI_COST_METERING_ENABLED: "true", LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD: "800000",
      LAUNCH_AI_ACCOUNT_REQUESTS_PER_DAY: "1", LAUNCH_AI_MONTHLY_CAP_NANO_USD: "800000", LAUNCH_AI_TRIAL_NANO_USD: "10000000" },
    durableObjects: {
      COMMERCE: { className: "SatinLoreCommerce", useSQLite: true },
      LAUNCH_USAGE: { className: "LaunchUsage", useSQLite: true },
      SCENE_ANALYSIS_BUDGET: { className: "SceneAnalysisBudget", useSQLite: true },
    },
    async outboundService(request) {
      outbound++;
      assert.equal(request.url, OUTBOUND);
      notifyStart();
      await providerGate;
      return Response.json({ status: "completed", usage: { input_tokens: 500, output_tokens: 60, total_tokens: 560 },
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels: [{ id: 1, label: "steady" }] }) }] }] });
    },
  });
  t.after(() => mf.dispose());
  const submit = (other = false) => mf.dispatchFetch(`${ORIGIN}/api/scene-analysis`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Second-Test-Account": String(other) }, body: JSON.stringify(CUES),
  });
  const first = submit();
  try {
    await Promise.race([providerStarted, first.then(response => assert.fail(`Provider was not reached, HTTP ${response.status}`))]);
    const during = await submit();
    assert.equal(during.status, 429);
    assert.equal((await during.json()).code, "analysis_credit_limit");
    const differentReader = await submit(true);
    assert.equal(differentReader.status, 429);
    assert.match((await differentReader.json()).error, /monthly AI spending limit/);
  } finally { releaseProvider(); }
  assert.equal((await first).status, 200);
  const overDailyLimit = await submit();
  assert.equal(overDailyLimit.status, 429);
  assert.equal((await overDailyLimit.json()).code, "rate_limited");
  assert.match(overDailyLimit.headers.get("Retry-After"), /^\d+$/);
  assert.equal(outbound, 1);
  const status = await mf.dispatchFetch(`${ORIGIN}${LAUNCH_USAGE_PATH}`);
  assert.equal(status.status, 200);
  const ledger = await status.json();
  assert.equal(ledger.credits.purchased, 0);
  assert.equal(ledger.credits.used, 80_000);
  assert.equal(ledger.credits.remaining, 9_920_000);
  assert.equal(ledger.month.used, 80_000);
});
