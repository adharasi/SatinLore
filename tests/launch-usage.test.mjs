import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { accountIdentity } from "../deploy/cloudflare/accounts.mjs";
import { createLaunchUsage, handleLaunchUsage, LaunchUsage, LAUNCH_USAGE_PATH } from "../deploy/cloudflare/launch-usage.mjs";
import { handleSceneAnalysis } from "../deploy/cloudflare/scene-analysis.mjs";

const ORIGIN = "https://app.satinlore.com";
const config = { origin: ORIGIN, issuer: ORIGIN };
const policy = { monthlyCap: 1_000, trial: 100, purchased: 1_200, revision: 1 };
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
  const results = await Promise.all([id, other].map(id => command("reserve", { id, tokens: 650, policy })));
  assert.deepEqual(results.map(result => result.status), [200, 429]);
  assert.equal((await command("reserve", { id, tokens: 650, policy })).state, "reserved");
  assert.equal((await command("reserve", { id, tokens: 651, policy })).status, 409);
  const dispatches = await Promise.all([1, 2].map(() => command("dispatch", { id, policy })));
  assert.deepEqual(dispatches.map(result => result.status), [200, 409]);
  restart();
  assert.equal((await command("refund", { id })).status, 409);
  assert.equal((await command("dispatch", { id, policy })).status, 409);
  assert.equal((await command("settle", { id, tokens: 65 })).state, "settled");
  assert.equal((await command("settle", { id, tokens: 65 })).status, 200);
  assert.equal((await command("settle", { id, tokens: 0 })).status, 409);
  const current = await command("status", { policy });
  assert.deepEqual(current.month, { endsAt: FEBRUARY, limit: 1_000, used: 65, reserved: 0, remaining: 935 });
  assert.deepEqual(current.credits, { trial: 100, purchased: 1_200, used: 65, reserved: 0, remaining: 1_235 });
  const reconfigured = await command("status", { policy: { ...policy, trial: 0 } });
  assert.deepEqual(reconfigured.credits, current.credits);
});

test("expiry refunds unstarted holds, charges uncertain calls, and carries used credits across UTC months", async t => {
  const { command } = ledgerFixture(t);
  const uncertain = randomUUID(), unused = randomUUID(), rollover = randomUUID();
  for (const id of [uncertain, unused, rollover]) assert.equal((await command("reserve", { id, tokens: 300, policy })).status, 200);
  assert.equal((await command("dispatch", { id: uncertain, policy })).status, 200);
  assert.equal((await command("dispatch", { id: rollover, policy }, FEBRUARY)).status, 429);
  const afterLease = JANUARY + 60_001;
  const current = await command("status", { policy }, afterLease);
  assert.equal(current.month.used, 0);
  assert.equal(current.month.remaining, 1_000);
  assert.deepEqual(current.credits, { trial: 100, purchased: 1_200, used: 300, reserved: 0, remaining: 1_000 });
  assert.equal((await command("reserve", { id: unused, tokens: 300, policy }, afterLease)).status, 409);
  assert.equal((await command("refund", { id: unused }, afterLease)).state, "refunded");
  assert.equal((await command("unknown", { id: uncertain }, afterLease)).state, "unknown");
  assert.equal((await command("settle", { id: uncertain, tokens: 180 }, afterLease)).state, "settled");
  assert.equal((await command("status", { policy }, afterLease)).credits.used, 180);
});

test("failed credit reconciliation blocks dispatch and late verified overage is charged exactly once", async t => {
  const { command } = ledgerFixture(t);
  const old = randomUUID(), paid = randomUUID();
  assert.equal((await command("reserve", { id: old, tokens: 1_000, policy })).status, 200);
  const reversed = { ...policy, purchased: 0, revision: 2 };
  assert.equal((await command("dispatch", { id: old, policy: reversed })).status, 429);
  assert.equal((await command("dispatch", { id: old, policy: reversed })).status, 409);
  await assert.rejects(command("reserve", { id: paid, tokens: 1_000, policy }), /entitlement revision/);
  const withPurchase = { ...policy, revision: 3 };
  assert.equal((await command("reserve", { id: paid, tokens: 800, policy: withPurchase })).status, 200);
  assert.equal((await command("dispatch", { id: paid, policy: withPurchase })).status, 200);
  assert.equal((await command("settle", { id: paid, tokens: 1_350 })).status, 200);
  const { credits, month, available } = await command("status", { policy: withPurchase });
  assert.equal(available, false);
  assert.equal(credits.used, 1_350);
  assert.equal(credits.remaining, 0);
  assert.equal(month.used, 1_350);
  assert.equal(month.remaining, 0);
});

function sceneFixture(t, { purchased = 15_000, monthlyCap = "10000", up, onDispatch, entitlement } = {}) {
  const ledgers = new Map();
  const actors = [];
  const usageOps = [];
  const budgetOps = [];
  const providerCalls = [];
  const session = { authMode: "email", subject: `email-v1:${"a".repeat(64)}`, expiresAt: Date.now() + 60_000 };
  const env = {
    LAUNCH_AI_USAGE_ENABLED: "true", LAUNCH_AI_MONTHLY_TOKEN_CAP: monthlyCap,
    OPENAI_API_KEY: "sk-synthetic-only",
    COMMERCE: { idFromName: name => name, get: () => ({ async fetch(request) {
      const value = await request.json();
      assert.equal(value.action, "readEntitlement");
      actors.push(value.fields.subject);
      return entitlement ? entitlement() : Response.json({ credits: purchased, revision: 1 });
    } }) },
    LAUNCH_USAGE: { idFromName: name => name, get(name) {
      if (!ledgers.has(name)) ledgers.set(name, new LaunchUsage({ storage: storageFixture(t) }));
      return { async fetch(request) {
        const value = await request.clone().json();
        usageOps.push(value);
        const result = await ledgers.get(name).fetch(request);
        if (value.operation === "dispatch" && result.ok) onDispatch?.();
        return result;
      } };
    } },
    SCENE_ANALYSIS_BUDGET: { idFromName: name => name, get: () => ({ async fetch(request) {
      budgetOps.push(await request.json());
      return new Response(null, { status: 204 });
    } }) },
  };
  const analysisFetcher = (url, options) => {
    assert.equal(url, OUTBOUND);
    providerCalls.push(JSON.parse(options.body));
    return up ? up() : Response.json({ status: "completed", usage: { input_tokens: 80, output_tokens: 22,
      total_tokens: 102, output_tokens_details: { reasoning_tokens: 18 } },
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels: [{ id: 1, label: "steady" }] }) }] }] });
  };
  const scene = ({ who = session, reverify = () => who, signal, body = CUES } = {}) => handleSceneAnalysis(new Request(`${ORIGIN}/api/scene-analysis`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  }), env, { config, session: who, reverify, analysisFetcher, launchUsage: createLaunchUsage(env, { config, session: who }) });
  const usage = (who = session, headers) => handleLaunchUsage(new Request(`${ORIGIN}${LAUNCH_USAGE_PATH}`, { headers }), env, { config, session: who });
  return { env, session, actors, usageOps, budgetOps, providerCalls, scene, usage };
}

test("production scene path sends no private payload to the ledger and charges provider total tokens", async t => {
  const f = sceneFixture(t);
  assert.equal((await f.scene()).status, 200);
  const body = await (await f.usage()).json();
  assert.equal(body.credits.purchased, 15_000);
  assert.equal(body.credits.used, 102);
  assert.equal(body.month.remaining, 9_898);
  assert.equal(f.providerCalls.length, 1);
  assert.equal(f.budgetOps.length, 1);
  assert.deepEqual([...new Set(f.actors)], [await accountIdentity(config, f.session)]);
  assert.deepEqual(f.usageOps.map(value => value.operation), ["status", "reserve", "dispatch", "settle", "status"]);
  assert.doesNotMatch(JSON.stringify(f.usageOps), /synthetic|email-v1|steady|instructions|reasoning|input_tokens/);
  const other = { ...f.session, subject: `email-v1:${"b".repeat(64)}` };
  assert.equal((await (await f.usage(other)).json()).credits.used, 0);
  assert.equal((await f.usage(undefined, { Origin: "https://beta.satinlore.com" })).status, 403);
  assert.equal((await f.usage({ ...f.session, authMode: "access" })).status, 403);
});

test("unfunded or misconfigured email calls stop before shared quota and flag-off preserves prior behavior", async t => {
  const unfunded = sceneFixture(t, { purchased: 0 });
  const lowCap = sceneFixture(t, { monthlyCap: "1" });
  const invalid = sceneFixture(t, { monthlyCap: "0" });
  const storageOffline = sceneFixture(t, { entitlement: () => Response.json({}, { status: 503 }) });
  for (const [f, status] of [[unfunded, 429], [lowCap, 429], [invalid, 503], [storageOffline, 503]]) {
    assert.equal((await f.scene()).status, status);
    assert.equal(f.providerCalls.length, 0);
    assert.equal(f.budgetOps.length, 0);
  }
  const trial = sceneFixture(t, { purchased: 0 });
  trial.env.LAUNCH_AI_TRIAL_TOKENS = "10000";
  assert.equal((await trial.scene()).status, 200);
  assert.equal((await (await trial.usage()).json()).credits.remaining, 9_898);
  unfunded.env.LAUNCH_AI_USAGE_ENABLED = "false";
  assert.deepEqual(await (await unfunded.usage()).json(), { enabled: false, available: false });
  assert.equal((await unfunded.scene()).status, 200);
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
  const hold = unknown.usageOps.find(value => value.operation === "reserve").tokens;
  assert.equal((await (await unknown.usage()).json()).credits.used, hold);
  assert.equal((await (await unknown.usage()).json()).credits.reserved, 0);

  const refused = sceneFixture(t, { up: () => Response.json({ status: "completed", usage: {
    input_tokens: 20, output_tokens: 7, total_tokens: 27,
  }, output: [{ type: "message", role: "assistant", content: [{ type: "refusal" }] }] }) });
  assert.equal((await refused.scene()).status, 422);
  assert.equal((await (await refused.usage()).json()).credits.used, 27);
});

test("Cloudflare SQLite bindings persist a successful metered provider response", { timeout: 20_000 }, async t => {
  const source = await build({ stdin: {
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "launch-usage-fixture.mjs", contents: `
      import { createLaunchUsage, handleLaunchUsage, LAUNCH_USAGE_PATH } from './deploy/cloudflare/launch-usage.mjs';
      import { handleSceneAnalysis } from './deploy/cloudflare/scene-analysis.mjs';
      export { LaunchUsage } from './deploy/cloudflare/launch-usage.mjs';
      export { SatinLoreCommerce } from './deploy/cloudflare/commerce.mjs';
      export { SceneAnalysisBudget } from './deploy/cloudflare/scene-analysis.mjs';
      export default { fetch(request, env) {
        const config = { origin: '${ORIGIN}', issuer: '${ORIGIN}' };
        const session = { authMode: 'email', subject: 'email-v1:' + 'a'.repeat(64), expiresAt: Date.now() + 60000 };
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
    bindings: { OPENAI_API_KEY: "sk-synthetic-only", LAUNCH_AI_USAGE_ENABLED: "true", LAUNCH_AI_MONTHLY_TOKEN_CAP: "4000", LAUNCH_AI_TRIAL_TOKENS: "10000" },
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
  const submit = () => mf.dispatchFetch(`${ORIGIN}/api/scene-analysis`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(CUES),
  });
  const first = submit();
  try {
    await Promise.race([providerStarted, first.then(response => assert.fail(`Provider was not reached, HTTP ${response.status}`))]);
    assert.equal((await submit()).status, 429);
  } finally { releaseProvider(); }
  assert.equal((await first).status, 200);
  assert.equal(outbound, 1);
  const status = await mf.dispatchFetch(`${ORIGIN}${LAUNCH_USAGE_PATH}`);
  assert.equal(status.status, 200);
  const ledger = await status.json();
  assert.equal(ledger.credits.purchased, 0);
  assert.equal(ledger.credits.used, 560);
  assert.equal(ledger.credits.remaining, 9_440);
  assert.equal(ledger.month.used, 560);
});
