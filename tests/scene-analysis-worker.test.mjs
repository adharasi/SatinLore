import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { createPrivateAppWorker } from "../deploy/cloudflare/worker.mjs";

const ORIGIN = "https://app.satinlore.com";
const BETA = "https://beta.satinlore.com";
const CONFIG = { PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true", ACCESS_TEAM_DOMAIN: "fixture.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64), FOUNDER_EMAIL: "founder@example.test" };
const KEY = "sk-proj-synthetic_credential_for_tests";
const CUES = [
  { id: 2, phase: "peak", rhythm: "dynamic", previous: "sustain", next: "recover", movementCount: 2, shape: "accented" },
  { id: 9, phase: "sustain", rhythm: "steady", previous: "build", next: "sustain", movementCount: 1, shape: "sustained" },
];
const LABELS = [{ id: 2, label: "accents" }, { id: 9, label: "steady" }];
const { privateKey, publicKey } = await generateKeyPair("RS256");
const localKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" }] });
async function token() {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: `https://${CONFIG.ACCESS_TEAM_DOMAIN}`, aud: CONFIG.ACCESS_AUD, sub: "synthetic-subject", email: CONFIG.FOUNDER_EMAIL,
    type: "app", iat: now, exp: now + 3600 }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(privateKey);
}
function request(jwt, { host = ORIGIN, origin = host, path = "/api/scene-analysis", body = { cues: CUES }, headers = {}, method = "POST" } = {}) {
  return new Request(host + path, { method, headers: { ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
    ...(origin === null ? {} : { Origin: origin }), "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}
function upstream(labels = LABELS) {
  return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels }) }] }] });
}
function fixture({ keyResolver = localKeys, provider = () => upstream(), quotaStatus = 204 } = {}) {
  const calls = [], reservations = [];
  const worker = createPrivateAppWorker({ keyResolver, analysisFetcher: async (url, options) => {
    calls.push({ url, options });
    return provider();
  } });
  const env = { ...CONFIG, OPENAI_API_KEY: KEY, SCENE_ANALYSIS_BUDGET: {
    idFromName: value => value, get: name => ({ async fetch(request) {
      reservations.push({ name, url: request.url, method: request.method, body: await request.json() });
      return new Response(null, { status: quotaStatus, headers: { "Retry-After": "66" } });
    } }),
  } };
  return { worker, env, calls, reservations };
}

test("Nocturne requires Access and its exact origin, and readiness never calls OpenAI", async () => {
  const f = fixture(), jwt = await token();
  assert.equal((await f.worker.fetch(request(null, { method: "GET" }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request(jwt, { host: "https://other.example.test" }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request(jwt, { host: BETA, origin: ORIGIN }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request(jwt, { origin: null }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request(jwt, { headers: { "Sec-Fetch-Site": "same-site" } }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request(jwt, { method: "GET", headers: { "Sec-Fetch-Site": "cross-site" } }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request(jwt, { path: "/api/scene-analysis?story=private" }), f.env)).status, 400);
  assert.equal((await f.worker.fetch(request(jwt, { method: "DELETE" }), f.env)).status, 405);
  const status = await f.worker.fetch(request(jwt, { method: "GET", origin: null }), f.env);
  assert.equal(status.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await status.json(), { available: true });
  for (const patch of [{ OPENAI_API_KEY: undefined }, { OPENAI_API_KEY: "sk-admin-not-a-project-secret" }, { SCENE_ANALYSIS_BUDGET: undefined }]) {
    const env = { ...f.env, ...patch };
    assert.deepEqual(await (await f.worker.fetch(request(jwt, { method: "GET" }), env)).json(), { available: false });
    assert.equal((await f.worker.fetch(request(jwt), env)).status, 503);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reservations, []);
});

test("Nocturne rejects text, unknown fields, out-of-range cues and oversized requests before spending quota", async () => {
  const f = fixture(), jwt = await token();
  for (const body of [
    { cues: CUES, story: "private prose" }, { cues: [{ ...CUES[0], text: "private prose" }] },
    { cues: [{ ...CUES[0], shape: "arbitrary prose" }] }, { cues: [{ ...CUES[0], phase: "quiet" }] },
    { cues: [{ ...CUES[0], next: "unknown" }] }, { cues: [{ ...CUES[0], movementCount: 6 }] },
    { cues: [{ ...CUES[0], id: 2000 }] }, { cues: [CUES[0], CUES[0]] },
    { cues: Array.from({ length: 17 }, (_, id) => ({ ...CUES[0], id })) }, { cues: [] }, "{",
  ]) {
    assert.equal((await f.worker.fetch(request(jwt, { body }), f.env)).status, 400);
  }
  assert.equal((await f.worker.fetch(request(jwt, { body: " ".repeat(4097) }), f.env)).status, 413);
  assert.equal((await f.worker.fetch(request(jwt, { headers: { "Content-Type": "text/plain" } }), f.env)).status, 400);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reservations, []);
});

test("Nocturne sends only bounded cue data to Luna and returns typed, ordered labels", async () => {
  const f = fixture({ provider: () => upstream([...LABELS].reverse()) });
  const response = await f.worker.fetch(request(await token(), { host: BETA }), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { labels: LABELS });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(f.calls.length, 1);
  assert.equal(f.reservations.length, 1);
  const [{ url, options }] = f.calls;
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.deepEqual(options.headers, { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Cache-Control": "no-store" });
  assert.equal(options.redirect, "error");
  const provider = JSON.parse(options.body);
  assert.deepEqual(JSON.parse(provider.input), { cues: CUES });
  assert.equal(provider.model, "gpt-6-luna");
  assert.equal(provider.store, false);
  assert.deepEqual(provider.prompt_cache_options, { mode: "explicit" });
  assert.equal(provider.text.format.strict, true);
  assert.equal(provider.max_output_tokens, 600);
  assert.doesNotMatch(options.body, /synthetic-subject|example\.test|Bearer|private prose/);
  assert.equal(f.reservations[0].name, "scene-analysis:v1");
  assert.deepEqual(Object.keys(f.reservations[0].body), ["reader"]);
  assert.match(f.reservations[0].body.reader, /^[a-f0-9]{64}$/);
});

test("Nocturne maps unavailable, rejected, and malformed upstream results without leaking provider data", async () => {
  const jwt = await token();
  for (const [provider, status, code] of [
    [() => Response.json({ error: KEY }, { status: 401 }), 503, "provider_unavailable"],
    [() => Response.json({ error: KEY }, { status: 429 }), 503, "provider_unavailable"],
    [() => { throw new Error(KEY); }, 503, "provider_unavailable"],
    [() => Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: KEY }] }] }), 422, "refused"],
    [() => Response.json({ status: "incomplete", incomplete_details: { reason: "content_filter" } }), 422, "refused"],
    [() => Response.json({ status: "incomplete", output: [] }), 502, "invalid_result"],
    [() => upstream([{ id: 2, label: "wave" }, LABELS[1]]), 502, "invalid_result"],
    [() => upstream([{ id: 2, label: "crest", level: 20 }, LABELS[1]]), 502, "invalid_result"],
    [() => upstream([LABELS[0], LABELS[0]]), 502, "invalid_result"],
    [() => upstream([LABELS[0], { id: 99, label: "steady" }]), 502, "invalid_result"],
    [() => upstream([LABELS[0]]), 502, "invalid_result"],
    [() => Response.json({ overflow: "x".repeat(25_000) }), 502, "invalid_result"],
  ]) {
    const f = fixture({ provider });
    const response = await f.worker.fetch(request(jwt), f.env);
    assert.equal(response.status, status);
    const result = await response.json();
    assert.equal(result.code, code);
    assert.deepEqual(Object.keys(result).sort(), ["code", "error"]);
    assert.ok(!JSON.stringify(result).includes(KEY));
    assert.equal(f.calls.length, 1, "No failure is retried automatically.");
  }
});

test("Nocturne fails closed on quota errors and rechecks the Access session after OpenAI", async () => {
  const jwt = await token();
  for (const quotaStatus of [429, 503]) {
    const f = fixture({ quotaStatus });
    const response = await f.worker.fetch(request(jwt), f.env);
    assert.equal(response.status, quotaStatus);
    assert.equal(response.headers.get("Retry-After"), quotaStatus === 429 ? "66" : null);
    assert.deepEqual(f.calls, []);
  }
  let verifications = 0;
  const f = fixture({ keyResolver: (...args) => {
    if (++verifications > 1) throw new Error("Synthetic revoked identity");
    return localKeys(...args);
  } });
  const response = await f.worker.fetch(request(jwt), f.env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "invalid_session");
  assert.equal(f.calls.length, 1);
});

test("the SQLite budget admits concurrent work up to per-reader and deployment limits", { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = "deploy/cloudflare/scene-analysis.mjs";
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "scene-budget-test-worker.mjs", contents: `export { SceneAnalysisBudget } from "./${source}";
      export default { fetch(request, env) {
        const stub = env.SCENE_ANALYSIS_BUDGET.get(env.SCENE_ANALYSIS_BUDGET.idFromName("scene-analysis:v1"));
        return stub.fetch(new Request("https://scene-analysis.internal/reserve", request));
      } };` },
    { type: "ESModule", path: root + source, contents: await readFile(root + source, "utf8") },
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0,
  durableObjects: { SCENE_ANALYSIS_BUDGET: { className: "SceneAnalysisBudget", useSQLite: true } } });
  t.after(() => mf.dispose());
  const reserve = id => mf.dispatchFetch("https://app.satinlore.com/fixture", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reader: id.toString(16).padStart(64, "0") }),
  });
  const first = await Promise.all(Array.from({ length: 16 }, () => reserve(1)));
  assert.equal(first.filter(response => response.status === 204).length, 12);
  assert.equal(first.filter(response => response.status === 429).length, 4);
  const rest = await Promise.all(Array.from({ length: 92 }, (_, index) => reserve(index + 2)));
  assert.equal(rest.filter(response => response.status === 204).length, 88);
  assert.equal(rest.filter(response => response.status === 429).length, 4);
  assert.match((await reserve(100)).headers.get("Retry-After"), /^\d+$/);
});
