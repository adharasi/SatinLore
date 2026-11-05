import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { createPrivateAppWorker } from "../deploy/cloudflare/worker.mjs";
import { validateNocturneContext } from "../app/static/reader/nocturne-context-contract.mjs";

const ORIGIN = "https://app.satinlore.com";
const BETA = "https://beta.satinlore.com";
const TESTER_EMAIL = "reader@example.test";
const CONFIG = { PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true", ACCESS_TEAM_DOMAIN: "fixture.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64), FOUNDER_EMAIL: "founder@example.test", BETA_TESTER_EMAILS: TESTER_EMAIL };
const KEY = "sk-proj-synthetic_credential_for_tests";
const CUES = [
  { id: 2, phase: "peak", rhythm: "dynamic", previous: "sustain", next: "recover", movementCount: 2, shape: "accented" },
  { id: 9, phase: "sustain", rhythm: "steady", previous: "build", next: "sustain", movementCount: 1, shape: "sustained" },
];
const LABELS = [{ id: 2, label: "accents" }, { id: 9, label: "steady" }];
const { privateKey, publicKey } = await generateKeyPair("RS256");
const localKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" }] });
async function token(email = CONFIG.FOUNDER_EMAIL) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: `https://${CONFIG.ACCESS_TEAM_DOMAIN}`, aud: CONFIG.ACCESS_AUD, sub: "synthetic-subject", email,
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
  assert.equal((await f.worker.fetch(request(jwt, { body: " ".repeat(16_385) }), f.env)).status, 413);
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
  assert.equal(options.redirect, "manual");
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

const CONTEXT = { version: "context-v1", consent: true, paragraphs: [
  { id: 3, text: "They had quietly cared for one another for years. Tonight, the invitation to stay felt different." },
  { id: 4, text: "At dawn they checked the train timetable and packed the maps." },
] };
const CONTEXT_LABELS = [
  { id: 3, category: "romance", phase: "build", shape: "unspecified", confidence: 94 },
  { id: 4, category: "neutral", phase: "quiet", shape: "unspecified", confidence: 99 },
];
const CONTEXT_V2 = { ...CONTEXT, version: "context-v2" };
const CONTEXT_V2_LABELS = [
  { id: 3, label: "romance.build", eventKind: "current", shape: "unspecified", confidence: 94 },
  { id: 4, label: "neutral.quiet", eventKind: "neutral", shape: "unspecified", confidence: 99 },
];
const CONTEXT_CONTRACT = "app/static/reader/nocturne-context-contract.mjs";
function contextUpstream(labels = CONTEXT_LABELS, usage = { input_tokens: 410, output_tokens: 102, total_tokens: 512 }) {
  return Response.json({ status: "completed", usage,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels }) }] }] });
}

test("context analysis requires explicit typed consent and strictly bounded excerpts before reserving quota", async () => {
  const f = fixture(), jwt = await token();
  for (const body of [
    { ...CONTEXT, consent: false }, { ...CONTEXT, consent: "true" }, { ...CONTEXT, version: "unknown" },
    { version: CONTEXT.version, paragraphs: CONTEXT.paragraphs }, { ...CONTEXT, title: "private title" },
    { ...CONTEXT, paragraphs: [] }, { ...CONTEXT, paragraphs: Array.from({ length: 9 }, (_, id) => ({ id, text: "A map." })) },
    { ...CONTEXT, paragraphs: [CONTEXT.paragraphs[0], CONTEXT.paragraphs[0]] },
    { ...CONTEXT, paragraphs: [...CONTEXT.paragraphs].reverse() },
    { ...CONTEXT, paragraphs: [{ id: -1, text: "A map." }] },
    { ...CONTEXT, paragraphs: [{ id: 2000, text: "A map." }] },
    { ...CONTEXT, paragraphs: [{ id: 1, text: "" }] },
    { ...CONTEXT, paragraphs: [{ id: 1, text: "\u0000private" }] },
    { ...CONTEXT, paragraphs: [{ id: 1, text: "字".repeat(1001) }] },
    { ...CONTEXT, paragraphs: Array.from({ length: 5 }, (_, id) => ({ id, text: "x".repeat(2500) })) },
    { ...CONTEXT, paragraphs: [{ ...CONTEXT.paragraphs[0], ceiling: 20 }] },
  ]) assert.equal((await f.worker.fetch(request(jwt, { body }), f.env)).status, 400);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reservations, []);
});

test("explicit context requests classify existing text with bounded structured output and actual usage only", async () => {
  const f = fixture({ provider: () => contextUpstream([...CONTEXT_LABELS].reverse()) });
  const response = await f.worker.fetch(request(await token(), { body: CONTEXT }), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: "context-v1", labels: CONTEXT_LABELS,
    usage: { inputTokens: 410, outputTokens: 102, totalTokens: 512 } });
  const [{ options }] = f.calls;
  const provider = JSON.parse(options.body);
  assert.equal(provider.model, "gpt-6-luna");
  assert.equal(provider.store, false);
  assert.equal(provider.max_output_tokens, 1000);
  assert.deepEqual(provider.reasoning, { effort: "none" });
  assert.equal(provider.text.format.strict, true);
  assert.deepEqual(JSON.parse(provider.input), { paragraphs: CONTEXT.paragraphs });
  assert.match(provider.instructions, /untrusted source material/);
  assert.match(provider.instructions, /never generate, continue, quote, summarize or embellish/i);
  assert.doesNotMatch(provider.input, /context-v1|consent|synthetic-subject|example\.test|ceiling|device/);
  assert.equal(f.reservations.length, 1);
});

test("context output rejects extra prose, wrong identities and incoherent categories without exposing provider text", async () => {
  const jwt = await token(TESTER_EMAIL);
  for (const labels of [
    [{ ...CONTEXT_LABELS[0], explanation: "private canary" }, CONTEXT_LABELS[1]],
    [{ ...CONTEXT_LABELS[0], category: "private canary" }, CONTEXT_LABELS[1]],
    [{ ...CONTEXT_LABELS[0], category: "neutral", phase: "peak" }, CONTEXT_LABELS[1]],
    [{ ...CONTEXT_LABELS[0], category: "abstain", phase: "sustain" }, CONTEXT_LABELS[1]],
    [{ ...CONTEXT_LABELS[0], confidence: 101 }, CONTEXT_LABELS[1]],
    [{ ...CONTEXT_LABELS[0], confidence: 90.5 }, CONTEXT_LABELS[1]],
    [{ ...CONTEXT_LABELS[0], id: "3" }, CONTEXT_LABELS[1]],
    [CONTEXT_LABELS[0], CONTEXT_LABELS[0]], [CONTEXT_LABELS[0]],
    [CONTEXT_LABELS[0], { ...CONTEXT_LABELS[1], shape: "accented" }],
  ]) {
    const f = fixture({ provider: () => contextUpstream(labels) });
    const response = await f.worker.fetch(request(jwt, { body: CONTEXT }), f.env);
    assert.equal(response.status, 502);
    assert.deepEqual(Object.keys(await response.json()).sort(), ["code", "error"]);
    assert.equal(f.calls.length, 1, "No malformed result is retried.");
  }
});

test("context low confidence abstains, invalid usage stays unknown and refusal preserves the local fallback", async () => {
  const jwt = await token(TESTER_EMAIL);
  const weak = [{ ...CONTEXT_LABELS[0], confidence: 79 }, CONTEXT_LABELS[1]];
  for (const usage of [undefined, null, { input_tokens: -1, output_tokens: 100, total_tokens: 99 },
    { input_tokens: 100, output_tokens: 100, total_tokens: 999 }, { input_tokens: "100", output_tokens: 100, total_tokens: 200 },
    { input_tokens: 20_001, output_tokens: 100, total_tokens: 20_101 }, { input_tokens: 100, output_tokens: 1001, total_tokens: 1101 }]) {
    const f = fixture({ provider: () => contextUpstream(weak, usage ?? null) });
    const response = await f.worker.fetch(request(jwt, { body: CONTEXT }), f.env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.labels[0], { id: 3, category: "abstain", phase: "abstain", shape: "unspecified", confidence: 79 });
    assert.equal(body.usage, null);
  }
  const f = fixture({ provider: () => Response.json({ status: "completed", output: [{ type: "message", role: "assistant",
    content: [{ type: "refusal", refusal: "private canary" }] }] }) });
  const response = await f.worker.fetch(request(jwt, { body: CONTEXT }), f.env);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "refused");
});

test("context v2 accepts a full dialogue window under source and output limits", async () => {
  const sentence = "The train arrived at dawn. ".repeat(8);
  const paragraphs = Array.from({ length: 64 }, (_, id) => ({
    id, text: sentence.slice(0, id < 32 ? 188 : 187),
  }));
  const expected = paragraphs.map(({ id }) => ({ ...CONTEXT_V2_LABELS[1], id }));
  const usage = { input_tokens: 3200, output_tokens: 2500, total_tokens: 5700 };
  const f = fixture({ provider: () => contextUpstream([...expected].reverse(), usage) });
  const response = await f.worker.fetch(request(await token(), { body: { ...CONTEXT_V2, paragraphs } }), f.env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.version, "context-v2");
  assert.equal(result.labels.length, 64);
  assert.deepEqual(result.usage, { inputTokens: 3200, outputTokens: 2500, totalTokens: 5700 });
  assert.deepEqual([...validateNocturneContext(paragraphs, result).labels.keys()], paragraphs.map(({ id }) => id));
  const provider = JSON.parse(f.calls[0].options.body);
  assert.equal(provider.store, false);
  assert.equal(provider.max_output_tokens, 4096);
  assert.equal(provider.text.format.strict, true);
  assert.deepEqual(JSON.parse(provider.input), { paragraphs });
  const fields = provider.text.format.schema.properties.labels.items.properties;
  assert.ok(fields.label.enum.includes("romance.build"));
  assert.ok(fields.label.enum.includes("intimacy.peak"));
  assert.ok(!fields.label.enum.includes("flirting.peak"));
  assert.ok(!Object.hasOwn(fields, "phase"));
  assert.deepEqual(fields.eventKind.enum, ["current", "imagined", "reported", "historical", "uncertain", "neutral"]);
  assert.doesNotMatch(provider.input, /consent|context-v2|example\.test|synthetic-subject/);
  assert.equal(f.reservations.length, 1);
});

test("context v2 rejects count, UTF-8, consent and encoded body overruns before quota", async () => {
  const f = fixture(), jwt = await token();
  for (const body of [
    { ...CONTEXT_V2, consent: false },
    { ...CONTEXT_V2, paragraphs: Array.from({ length: 65 }, (_, id) => ({ id, text: "A map." })) },
    { ...CONTEXT_V2, paragraphs: [{ id: 0, text: "字".repeat(1001) }] },
    { ...CONTEXT_V2, paragraphs: [
      ...Array.from({ length: 4 }, (_, id) => ({ id, text: "字".repeat(1000) })),
      { id: 4, text: "A" },
    ] },
  ]) {
    assert.equal((await f.worker.fetch(request(jwt, { body }), f.env)).status, 400);
  }
  const escaped = { ...CONTEXT_V2, paragraphs: Array.from({ length: 3 }, (_, id) => ({ id, text: '"'.repeat(2999) + "A" })) };
  assert.equal((await f.worker.fetch(request(jwt, { body: escaped }), f.env)).status, 413);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reservations, []);
});

test("context v2 preserves narrative event kind and converts weak evidence to abstention", async () => {
  const labels = [
    CONTEXT_V2_LABELS[0],
    { ...CONTEXT_V2_LABELS[0], id: 4, eventKind: "imagined" },
    { ...CONTEXT_V2_LABELS[0], id: 5, eventKind: "reported" },
    { ...CONTEXT_V2_LABELS[0], id: 6, eventKind: "historical" },
    { ...CONTEXT_V2_LABELS[0], id: 7, confidence: 79 },
    { ...CONTEXT_V2_LABELS[1], id: 8 },
  ];
  const paragraphs = labels.map(({ id }) => ({ id, text: "A letter was folded." }));
  const f = fixture({ provider: () => contextUpstream(labels, { input_tokens: 120, output_tokens: 4097, total_tokens: 4217 }) });
  const response = await f.worker.fetch(request(await token(), { body: { ...CONTEXT_V2, paragraphs } }), f.env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.labels.map(({ eventKind }) => eventKind), ["current", "imagined", "reported", "historical", "uncertain", "neutral"]);
  assert.deepEqual(result.labels[4], { id: 7, category: "abstain", phase: "abstain", shape: "unspecified", confidence: 79, eventKind: "uncertain" });
  assert.equal(result.usage, null);
  assert.equal(validateNocturneContext(paragraphs, result).labels.size, paragraphs.length);
});

test("context v2 falls back on incompatible labels and refuses without exposing provider text", async () => {
  const jwt = await token(TESTER_EMAIL);
  for (const first of [
    { ...CONTEXT_V2_LABELS[0], label: "flirting.peak" },
    { ...CONTEXT_V2_LABELS[0], eventKind: "uncertain" },
    { ...CONTEXT_V2_LABELS[0], eventKind: "neutral" },
    { ...CONTEXT_V2_LABELS[0], label: "abstain.abstain" },
    { ...CONTEXT_V2_LABELS[0], eventKind: "private canary" },
    { ...CONTEXT_V2_LABELS[0], explanation: "private canary" },
    { ...CONTEXT_V2_LABELS[0], id: 4 },
    { ...CONTEXT_V2_LABELS[0], id: 999 },
  ]) {
    const f = fixture({ provider: () => contextUpstream([first, CONTEXT_V2_LABELS[1]]) });
    const response = await f.worker.fetch(request(jwt, { body: CONTEXT_V2 }), f.env);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.code, "invalid_result");
    assert.doesNotMatch(JSON.stringify(result), /canary/);
    assert.equal(f.calls.length, 1);
  }
  const refused = fixture({ provider: () => Response.json({ status: "completed", output: [{ type: "message",
    role: "assistant", content: [{ type: "refusal", refusal: "private canary" }] }] }) });
  const response = await refused.worker.fetch(request(jwt, { body: CONTEXT_V2 }), refused.env);
  assert.equal(response.status, 422);
  const result = await response.json();
  assert.equal(result.code, "refused");
  assert.doesNotMatch(JSON.stringify(result), /canary/);
});

test("native Workers fetch accepts a Nocturne response and never forwards credentials on redirects", async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = "deploy/cloudflare/scene-analysis.mjs";
  const upstreamURL = "https://api.openai.com/v1/responses";
  const outbound = [];
  let redirect = false;
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "scene-analysis-runtime-fixture.mjs", contents: `
      import { handleSceneAnalysis } from "./${source}";
      export { SceneAnalysisBudget } from "./${source}";
      export default { fetch(request, env) {
        const session = { subject: "synthetic-subject", expiresAt: Date.now() + 60_000, isFounder: true };
        return handleSceneAnalysis(request, env, {
          config: { origin: "${ORIGIN}", issuer: "https://fixture.cloudflareaccess.com" },
          session, reverify: () => session,
        });
      } };` },
    { type: "ESModule", path: root + source, contents: await readFile(root + source, "utf8") },
    { type: "ESModule", path: root + CONTEXT_CONTRACT, contents: await readFile(root + CONTEXT_CONTRACT, "utf8") },
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0,
  bindings: { OPENAI_API_KEY: KEY },
  durableObjects: { SCENE_ANALYSIS_BUDGET: { className: "SceneAnalysisBudget", useSQLite: true } },
  async outboundService(request) {
    outbound.push({ url: request.url, method: request.method, authorization: request.headers.get("Authorization") });
    if (request.url !== upstreamURL) return Response.json({ error: "unexpected destination" }, { status: 400 });
    const input = JSON.parse((await request.json()).input);
    if (input.paragraphs) {
      assert.deepEqual(input, { paragraphs: CONTEXT_V2.paragraphs });
      return contextUpstream(CONTEXT_V2_LABELS);
    }
    assert.deepEqual(input, { cues: CUES });
    return redirect ? Response.redirect("https://redirect.example.test/", 302) : upstream();
  } });
  t.after(() => mf.dispose());
  const analyse = (body = { cues: CUES }) => mf.dispatchFetch(`${ORIGIN}/api/scene-analysis`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const success = await analyse();
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { labels: LABELS });
  const contextResponse = await analyse(CONTEXT_V2);
  assert.equal(contextResponse.status, 200);
  assert.equal(validateNocturneContext(CONTEXT_V2.paragraphs, await contextResponse.json()).labels.size, 2);

  redirect = true;
  const rejected = await analyse();
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers.get("Location"), null);
  const result = await rejected.json();
  assert.ok(!JSON.stringify(result).includes(KEY));
  const expected = { url: upstreamURL, method: "POST", authorization: `Bearer ${KEY}` };
  assert.deepEqual(outbound, [expected, expected, expected], "The redirect destination receives no request or credential.");
});

test("Nocturne maps unavailable, rejected, and malformed upstream results without leaking provider data", async () => {
  const jwt = await token(TESTER_EMAIL);
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

test("Nocturne gives only the founder fixed diagnostics for upstream and budget failures", async () => {
  const founder = await token(), tester = await token(TESTER_EMAIL);
  const error = (status, code, param) => Response.json({ error: { code, param, message: KEY }, request_id: KEY }, { status });
  for (const [provider, status, founderCode, testerCode = "provider_unavailable"] of [
    [() => error(400, KEY, KEY), 503, "provider_request_rejected"],
    [() => error(400, "unsupported_parameter", "prompt_cache_options.mode"), 503, "provider_cache_option"],
    [() => error(401, KEY), 503, "provider_key_rejected"],
    [() => error(403, KEY), 503, "provider_model_access"],
    [() => error(404, KEY), 503, "provider_model_access"],
    [() => error(429, "insufficient_quota"), 503, "provider_billing_limit"],
    [() => error(429, KEY), 503, "provider_rate_limit"],
    [() => { throw new DOMException(KEY, "TimeoutError"); }, 503, "provider_timeout"],
    [() => { throw new Error(KEY); }, 503, "provider_connection"],
    [() => error(500, KEY), 503, "provider_service_error"],
    [() => new Response(KEY), 502, "provider_response_invalid", "invalid_result"],
    [() => upstream([{ id: 2, label: KEY }, LABELS[1]]), 502, "provider_response_invalid", "invalid_result"],
  ]) {
    const f = fixture({ provider });
    for (const [jwt, code] of [[founder, founderCode], [tester, testerCode]]) {
      const response = await f.worker.fetch(request(jwt), f.env);
      assert.equal(response.status, status);
      const result = await response.json();
      assert.equal(result.code, code);
      assert.deepEqual(Object.keys(result).sort(), ["code", "error"]);
      assert.ok(!JSON.stringify(result).includes(KEY));
    }
    assert.equal(f.calls.length, 2);
  }

  const f = fixture({ quotaStatus: 503 });
  for (const [jwt, code] of [[founder, "budget_unavailable"], [tester, "provider_unavailable"]]) {
    const response = await f.worker.fetch(request(jwt), f.env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, code);
  }
  assert.deepEqual(f.calls, []);
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

  let contextVerifications = 0;
  const contextual = fixture({ provider: () => contextUpstream(), keyResolver: (...args) => {
    if (++contextVerifications > 1) throw new Error("Synthetic revoked identity");
    return localKeys(...args);
  } });
  const contextResponse = await contextual.worker.fetch(request(jwt, { body: CONTEXT }), contextual.env);
  assert.equal(contextResponse.status, 403);
  assert.equal((await contextResponse.json()).code, "invalid_session");
  assert.equal(contextual.calls.length, 1);
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
    { type: "ESModule", path: root + CONTEXT_CONTRACT, contents: await readFile(root + CONTEXT_CONTRACT, "utf8") },
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
