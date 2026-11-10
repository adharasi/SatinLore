import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { createPrivateAppWorker } from "../deploy/cloudflare/worker.mjs";
import { LUNA_CORPUS_PATH } from "../deploy/cloudflare/luna-corpus.mjs";
import { validateNocturneContext } from "../app/static/reader/nocturne-context-contract.mjs";
import { wholeStoryAnnotationFixtures } from "./whole-story-annotation-fixtures.mjs";

const ORIGIN = "https://app.satinlore.com";
const BETA = "https://beta.satinlore.com";
const TESTER_EMAIL = "reader@example.test";
const CONFIG = { PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true", ACCESS_TEAM_DOMAIN: "fixture.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64), FOUNDER_EMAIL: "founder@example.test", BETA_TESTER_EMAILS: TESTER_EMAIL };
const KEY = "sk-proj-synthetic_credential_for_tests";
const BENCHMARK = "/api/scene-analysis/decisions-benchmark";
const STUDY = "/api/scene-analysis/decisions-story-study";
const WHOLE_STORY_STUDY = "/api/scene-analysis/whole-story-luna-study";
const WHOLE_STORY_SUITE = "nocturne-whole-story-luna-v1";
const NEUTRAL_PROTOCOL_SUITE = "nocturne-luna-protocol-neutral-v2";
const NEUTRAL_PROTOCOL_FORM = "benchmark=luna-protocol-neutral-v2-complete-a";
const NEUTRAL_RUN_ID = "4a841e21-77e2-44de-bd67-0e10b443487d";
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
function request(jwt, { host = ORIGIN, origin = host, path = "/api/scene-analysis", body = { cues: CUES }, headers = {}, method = "POST", signal } = {}) {
  return new Request(host + path, { method, signal, headers: { ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
    ...(origin === null ? {} : { Origin: origin }), "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}
function upstream(labels = LABELS) {
  return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels }) }] }] });
}
function fixture({ keyResolver = localKeys, provider = () => upstream(), quotaStatus = 204,
  spend = ({ operation, usedMicros }) => Response.json({ shardCapMicros: 150_000, expiresAt: Date.now() + 86_400_000,
    remainingMicros: 3_000_000 - (operation === "reserve" ? 150_000 : usedMicros) }),
  wholeStoryLunaComparison } = {}) {
  const calls = [], reservations = [], spendRequests = [];
  const worker = createPrivateAppWorker({ keyResolver, wholeStoryLunaComparison, analysisFetcher: async (url, options) => {
    calls.push({ url, options });
    return provider(url, options);
  } });
  const env = { ...CONFIG, OPENAI_API_KEY: KEY, SCENE_ANALYSIS_BUDGET: {
    idFromName: value => value, get: name => ({ async fetch(request) {
      if (request.url === "https://scene-analysis.internal/founder-neutral-spend" && request.method === "POST") {
        const body = await request.json();
        spendRequests.push({ name, body });
        return spend(body);
      }
      reservations.push({ name, url: request.url, method: request.method, body: await request.json() });
      const status = typeof quotaStatus === "function" ? quotaStatus(reservations.length) : quotaStatus;
      return new Response(null, { status, headers: { "Retry-After": "66" } });
    } }),
  } };
  return { worker, env, calls, reservations, spendRequests };
}

function benchmarkRequest(jwt, options = {}) {
  return request(jwt, { host: BETA, path: BENCHMARK, body: "benchmark=luna-decisions-v1", ...options,
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...options.headers } });
}

function wholeStoryRequest(jwt, options = {}) {
  return request(jwt, { path: WHOLE_STORY_STUDY, body: "benchmark=whole-story-luna-v1", ...options,
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...options.headers } });
}

const enableWholeStory = env => ({ ...env, WHOLE_STORY_LUNA_STUDY_ENABLED: "true", PUBLIC_READER_ENABLED: "true" });

test("whole-story study requires opt-in, exact app origin, founder Access and the fixed form", async () => {
  const f = fixture({ wholeStoryLunaComparison: () => assert.fail("Invalid requests must never run the study.") });
  const founder = await token(), tester = await token(TESTER_EMAIL), env = enableWholeStory(f.env);
  const get = { method: "GET", origin: null, headers: { "Sec-Fetch-Site": "none" } };
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, get), f.env)).status, 404);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { ...get, host: BETA }), env)).status, 404);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { ...get, host: "https://worker.example.test" }), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(null, get), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(tester, get), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(tester), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { ...get, origin: BETA }), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { origin: null }), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { origin: BETA }), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { headers: { "Sec-Fetch-Site": "same-site" } }), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { path: `${WHOLE_STORY_STUDY}?input=unapproved` }), env)).status, 400);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { body: "benchmark=whole-story-luna-v1&text=x" }), env)).status, 400);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { body: "benchmark=luna-protocol-neutral-v2-complete" }), env)).status, 400);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { body: NEUTRAL_PROTOCOL_FORM + "&text=x" }), env)).status, 400);
  assert.equal((await f.worker.fetch(wholeStoryRequest(tester, { body: NEUTRAL_PROTOCOL_FORM }), env)).status, 403);
  assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { body: "x".repeat(129) }), env)).status, 413);
  for (const field of ["runId=invalid", `runId=${NEUTRAL_RUN_ID}&runId=`, `runId=${NEUTRAL_RUN_ID}&cap=10`,
    "benchmark=luna-protocol-neutral-v2-windowed-b"]) {
    assert.equal((await f.worker.fetch(wholeStoryRequest(founder, { body: `${NEUTRAL_PROTOCOL_FORM}&${field}` }), env)).status, 400);
  }
  const upload = new FormData();
  upload.set("payload", new File(["unapproved"], "upload.txt"));
  assert.equal((await f.worker.fetch(new Request(ORIGIN + WHOLE_STORY_STUDY, { method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": founder, Origin: ORIGIN }, body: upload }), env)).status, 400);
  const page = await f.worker.fetch(wholeStoryRequest(founder, get), env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Referrer-Policy"), "same-origin");
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  const html = await page.text();
  assert.match(html, /<form method="post"><button name="benchmark" value="whole-story-luna-v1"/);
  assert.match(html, /Luna rubric v14 is active/);
  assert.match(html, /Timing review v5 is active/);
  assert.match(html, /\$3 estimated spend cap for 24 hours/);
  assert.match(html, /Shared run ID \(optional\)/);
  for (const arm of ["complete", "windowed"]) for (const shard of ["a", "b"]) {
    assert.ok(html.includes(`value="luna-protocol-neutral-v2-${arm}-${shard}"`));
  }
  assert.doesNotMatch(html, /multipart|<textarea/);
  assert.equal(await (await f.worker.fetch(wholeStoryRequest(founder, { ...get, method: "HEAD" }), env)).text(), "");
  assert.deepEqual(f.spendRequests, []);
  assert.deepEqual(f.reservations, []);
  assert.deepEqual(f.calls, []);
});

const studyProvider = "https://api.openai.com/v1/responses";
const studyAttempt = (fetchImpl, options = {}) => fetchImpl(studyProvider, { method: "POST", body: '{"model":"gpt-6-luna"}', ...options });

function neutralProtocolUpstream(_url, options) {
  const body = JSON.parse(options.body);
  const { targetIds } = JSON.parse(body.input);
  const transitionOnly = body.text.format.name === "nocturne_luna_transition_v1";
  const facts = targetIds.map(unitId => ({ unitId, status: "neutral", frame: "current", transition: "none",
    fact: "none", scopeId: null, priorAnchor: null, evidenceIds: [],
    ...(transitionOnly ? {} : { depiction: "neutral", narrativePhase: "quiet", action: "none" }),
  }));
  return Response.json({ status: "completed", model: "gpt-6-luna", usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ facts }) }] }] });
}

test("the four fixed neutral protocol forms cover both cohorts within the request cap", async () => {
  const founder = await token();
  const rosterHashes = new Map();
  for (const [arm, shard, discovery, targets] of [
    ["complete", "a", 2, 19], ["complete", "b", 2, 14], ["windowed", "a", 5, 19], ["windowed", "b", 5, 14],
  ]) {
    const f = fixture({ provider: neutralProtocolUpstream,
      wholeStoryLunaComparison: () => assert.fail("The v2 form must select the new study.") });
    const response = await f.worker.fetch(wholeStoryRequest(founder, { body: `benchmark=luna-protocol-neutral-v2-${arm}-${shard}` }),
      enableWholeStory(f.env));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /^application\/json/u);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const serialized = await response.text();
    const result = JSON.parse(serialized);
    assert.equal(result.measurement, "live-neutral-provider");
    assert.equal(result.hostedStudyVersion, NEUTRAL_PROTOCOL_SUITE);
    assert.equal(result.hostedShard, shard);
    assert.deepEqual(result.hostedSpend, { capMicros: 150_000, shardCapMicros: 150_000 });
    assert.deepEqual(result.hostedTransport, { maxProviderCalls: discovery + 2 * targets + 4 });
    assert.deepEqual(f.spendRequests, []);
    assert.equal(result.hostedTermination, "completed");
    assert.equal(result.arm, arm);
    assert.equal(result.sourceProseIncluded, false);
    assert.equal(result.planning.plannedTargets, targets);
    assert.equal(result.planning.discoveryAttempts, discovery);
    assert.equal(result.planning.prefixAttempts, targets);
    assert.equal(result.planning.transitionAttempts, targets);
    assert.equal(result.transition.targets, targets);
    assert.equal(result.transition.returnedTargets, targets);
    assert.equal(result.externalCalls, discovery + 2 * targets);
    assert.ok(result.externalCalls <= result.hostedTransport.maxProviderCalls);
    assert.equal(result.externalCalls, f.calls.length);
    assert.equal(f.reservations.length, 0);
    assert.ok(f.calls.every(({ url, options }) => url === studyProvider && options.redirect === "manual" &&
      options.headers.Authorization === `Bearer ${KEY}`));
    const ids = shard === "a" ? ["first-dance", "old-letter"] : ["reading-room", "practice-drill"];
    assert.deepEqual(result.fixtureIds, ids);
    assert.deepEqual(result.diagnostics.map(work => work.id), ids);
    const roster = result.diagnostics.map(({ id, sourceSha256 }) => ({ id, sourceSha256 }));
    assert.equal(result.fixtureRosterSha256, createHash("sha256").update(JSON.stringify(roster)).digest("hex"));
    if (rosterHashes.has(shard)) assert.equal(result.fixtureRosterSha256, rosterHashes.get(shard));
    else rosterHashes.set(shard, result.fixtureRosterSha256);
    assert.equal(result.diagnostics.flatMap(work => work.units).length, targets);
    const event = result.diagnostics[0].units.find(unit => unit.id === (shard === "a" ? 7 : 4));
    assert.equal(event.expected.transition, shard === "a" ? "hard-stop" : "interruption");
    assert.equal(event.discovery.transition, "none");
    assert.ok(event.discovery.reasons.includes("transition-missed"));
    assert.equal(serialized.includes(KEY), false);
    for (const fixture of wholeStoryAnnotationFixtures) for (const paragraph of fixture.paragraphs) {
      assert.equal(serialized.includes(paragraph), false);
    }
  }
  assert.notEqual(rosterHashes.get("a"), rosterHashes.get("b"));
});

test("standalone neutral shards can run even when shared reader quota is exhausted or unavailable", async () => {
  const founder = await token();
  for (const budget of [true, false]) {
    const f = fixture({ quotaStatus: 429, provider: neutralProtocolUpstream });
    const response = await f.worker.fetch(wholeStoryRequest(founder, { body: `${NEUTRAL_PROTOCOL_FORM}&runId=` }),
      enableWholeStory({ ...f.env, ...(budget ? {} : { SCENE_ANALYSIS_BUDGET: undefined }) }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).externalCalls, 40);
    assert.deepEqual(f.reservations, []);
    assert.deepEqual(f.spendRequests, []);
  }
});

test("grouped windowed forms share a spend ledger and settle only known or reserved usage", async () => {
  const founder = await token();
  const f = fixture({ provider: neutralProtocolUpstream, quotaStatus: 429 });
  for (const [shard, discovery, units] of [["first-dance", 3, 11], ["old-letter", 2, 8], ["reading-room", 3, 9], ["practice-drill", 2, 5]]) {
    const body = `runId=${NEUTRAL_RUN_ID}&benchmark=luna-protocol-neutral-v10-windowed-${shard}`;
    const response = await f.worker.fetch(wholeStoryRequest(founder, { body }), enableWholeStory(f.env));
    assert.equal(response.status, 200);
    const result = await response.json();
    const { hostedSpend, hostedTransport, externalCalls } = result;
    assert.deepEqual(result.fixtureIds, [shard]);
    assert.equal(result.planning.cueCheckTargetLimit, 6);
    assert.equal(result.planning.discoveryAttempts, discovery);
    assert.equal(result.prefix.returnedTargets, units);
    assert.equal(result.transition.returnedTargets, units);
    assert.equal(externalCalls, discovery + 2 * units);
    assert.equal(hostedTransport.maxProviderCalls, discovery + 2 * units + 6);
    assert.equal(hostedSpend.capMicros, 3_000_000);
    assert.equal(hostedSpend.shardCapMicros, 150_000);
    assert.equal(hostedSpend.settled, true);
    assert.equal(hostedSpend.runId, NEUTRAL_RUN_ID);
    assert.equal(hostedSpend.remainingMicros, 3_000_000 - result.budget.chargedMicros);
    const [{ name, body: reserved }, { body: settled }] = f.spendRequests.slice(-2);
    assert.equal(name, "scene-analysis:v1");
    assert.match(reserved.reader, /^[a-f0-9]{64}$/);
    assert.equal(reserved.runId, NEUTRAL_RUN_ID);
    assert.equal(reserved.operation, "reserve");
    assert.deepEqual(settled, { ...reserved, operation: "settle", usedMicros: result.budget.chargedMicros });
  }
  assert.equal(new Set(f.spendRequests.map(({ body }) => body.shardId)).size, 4);
  assert.deepEqual(f.reservations, []);
});

test("grouped neutral dispatch fails closed on depleted or unavailable spend and respects a partial shard hold", async () => {
  const founder = await token();
  const body = `${NEUTRAL_PROTOCOL_FORM}&runId=${NEUTRAL_RUN_ID}`;
  for (const [status, code] of [[429, "spend_cap"], [409, "run_conflict"], [503, "budget_unavailable"]]) {
    const f = fixture({ spend: () => new Response(null, { status }) });
    const response = await f.worker.fetch(wholeStoryRequest(founder, { body }), enableWholeStory(f.env));
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture({ provider: neutralProtocolUpstream, spend: ({ operation }) => Response.json({
    shardCapMicros: 1, remainingMicros: operation === "reserve" ? 0 : 1, expiresAt: Date.now() + 86_400_000 }) });
  const response = await f.worker.fetch(wholeStoryRequest(founder, { body }), enableWholeStory(f.env));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.externalCalls, 0);
  assert.equal(result.hostedSpend.shardCapMicros, 1);
  assert.equal(result.hostedSpend.remainingMicros, 1);
  assert.equal(result.budget.attempts, 0);
  assert.equal(f.spendRequests[1].body.usedMicros, 0);
});

test("whole-story study rechecks founder and reserves every exact provider attempt before returning aggregates", async () => {
  let checks = 0;
  const aggregate = { measurement: "live-provider", fixtureVersion: "neutral-stories-v1", providerCalls: 2 };
  const f = fixture({ keyResolver: (...args) => { checks++; return localKeys(...args); }, provider: () => new Response("untrusted provider body"),
    async wholeStoryLunaComparison({ apiKey, fetchImpl, signal, maxAttempts, maxUsd }) {
      assert.equal(apiKey, KEY);
      assert.equal(maxAttempts, 64);
      assert.equal(maxUsd, 1);
      await studyAttempt(fetchImpl, { signal, redirect: "follow", headers: { "X-Incoming": "untrusted header" } });
      await studyAttempt(fetchImpl, { signal });
      return aggregate;
    } });
  const response = await f.worker.fetch(wholeStoryRequest(await token()), enableWholeStory(f.env));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), aggregate);
  assert.equal(checks, 4, "Initial founder check, one per outbound attempt, and one before returning results.");
  assert.equal(f.reservations.length, 2);
  assert.ok(f.reservations.every(entry => entry.name === "scene-analysis:v1" && entry.body.suite === WHOLE_STORY_SUITE &&
    /^[a-f0-9]{64}$/.test(entry.body.reader)));
  assert.deepEqual(f.calls.map(({ url }) => url), [studyProvider, studyProvider]);
  assert.ok(f.calls.every(({ options }) => options.redirect === "manual" && options.headers.Authorization === `Bearer ${KEY}` &&
    !Object.hasOwn(options.headers, "X-Incoming") && options.signal instanceof AbortSignal));
});

test("whole-story study stops for quota, rejected provider endpoints and an ended founder session", async () => {
  const founder = await token();
  const attemptTwo = async ({ fetchImpl }) => { await studyAttempt(fetchImpl); await studyAttempt(fetchImpl); };
  const quota = fixture({ wholeStoryLunaComparison: attemptTwo, quotaStatus: count => count === 1 ? 204 : 429 });
  const denied = await quota.worker.fetch(wholeStoryRequest(founder), enableWholeStory(quota.env));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("Retry-After"), "66");
  assert.equal(quota.reservations.length, 2);
  assert.equal(quota.calls.length, 1);

  const wrongEndpoint = fixture({ wholeStoryLunaComparison: ({ fetchImpl }) => fetchImpl("https://other.example.test/", { method: "POST", body: "{}" }) });
  assert.equal((await wrongEndpoint.worker.fetch(wholeStoryRequest(founder), enableWholeStory(wrongEndpoint.env))).status, 503);
  assert.deepEqual(wrongEndpoint.reservations, []);
  assert.deepEqual(wrongEndpoint.calls, []);

  let checks = 0;
  const expired = fixture({ wholeStoryLunaComparison: attemptTwo, keyResolver: (...args) => {
    if (++checks === 3) throw new Error("Synthetic expired session.");
    return localKeys(...args);
  } });
  assert.equal((await expired.worker.fetch(wholeStoryRequest(founder), enableWholeStory(expired.env))).status, 403);
  assert.equal(expired.reservations.length, 1);
  assert.equal(expired.calls.length, 1);
});

test("whole-story study aborts pending work on disconnect and cannot resume provider dispatch", async () => {
  const disconnect = new AbortController();
  let started, lateCall;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = fixture({ provider: () => { started(); return new Promise(() => {}); },
    async wholeStoryLunaComparison({ fetchImpl, signal }) {
      signal.addEventListener("abort", () => { lateCall = studyAttempt(fetchImpl).catch(error => error); }, { once: true });
      await studyAttempt(fetchImpl);
    } });
  const pending = f.worker.fetch(wholeStoryRequest(await token(), { signal: disconnect.signal }), enableWholeStory(f.env));
  await waiting;
  disconnect.abort();
  assert.equal((await pending).status, 403);
  assert.equal((await lateCall).name, "AbortError");
  assert.equal(f.reservations.length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.signal.aborted, true);
});

test("the fixed Decisions benchmark requires signed founder Access and an exact same-origin form", async () => {
  const f = fixture(), founder = await token(), tester = await token(TESTER_EMAIL);
  assert.equal((await f.worker.fetch(benchmarkRequest(null, { method: "GET" }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(benchmarkRequest(tester), f.env)).status, 403);
  const publicEnv = { ...f.env, PUBLIC_READER_ENABLED: "true" };
  assert.equal((await f.worker.fetch(benchmarkRequest(null, { host: ORIGIN }), publicEnv)).status, 403);
  assert.equal((await f.worker.fetch(benchmarkRequest(founder, { host: ORIGIN, method: "GET" }), publicEnv)).status, 200);
  assert.equal((await f.worker.fetch(benchmarkRequest(founder, { origin: ORIGIN }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(benchmarkRequest(founder, { headers: { "Sec-Fetch-Site": "same-site" } }), f.env)).status, 403);
  assert.equal((await f.worker.fetch(benchmarkRequest(founder, { path: `${BENCHMARK}?source=outside` }), f.env)).status, 400);
  assert.equal((await f.worker.fetch(benchmarkRequest(founder, { body: "benchmark=luna-decisions-v1&source=outside" }), f.env)).status, 400);
  assert.equal((await f.worker.fetch(benchmarkRequest(founder, { body: "x".repeat(65) }), f.env)).status, 413);
  const page = await f.worker.fetch(benchmarkRequest(founder, { method: "GET", origin: null,
    headers: { "Sec-Fetch-Site": "cross-site" } }), f.env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.equal(page.headers.get("Referrer-Policy"), "same-origin");
  assert.match(await page.text(), /Run benchmark/);
  assert.deepEqual(f.reservations, []);
  assert.deepEqual(f.calls, []);
});

test("the Decisions benchmark reserves each call and stops before a denied request", async () => {
  const f = fixture({ quotaStatus: attempts => attempts < 3 ? 204 : 429, provider: () => new Response("provider-only details", { status: 403 }) });
  const response = await f.worker.fetch(benchmarkRequest(await token()), f.env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "66");
  assert.equal(f.reservations.length, 3);
  assert.deepEqual(f.calls.map(call => call.url), ["https://api.openai.com/v1/responses", "https://api.openai.com/v1/decisions"]);
  assert.doesNotMatch(await response.text(), /provider-only details/);
});

test("the Decisions benchmark rejects an unapproved corpus file before quota or provider access", async () => {
  const f = fixture(), founder = await token();
  const body = new FormData();
  body.set("payload", new File(['{"version":"original-hosted-corpus-v1","windows":[]}'], "corpus.json",
    { type: "application/json" }));
  const response = await f.worker.fetch(new Request(ORIGIN + BENCHMARK, { method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": founder, Origin: ORIGIN }, body }), f.env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_request");
  assert.deepEqual(f.reservations, []);
  assert.deepEqual(f.calls, []);
});

test("the story study accepts only a signed founder and a pinned same-origin upload", async () => {
  const f = fixture(), founder = await token(), tester = await token(TESTER_EMAIL);
  const page = await f.worker.fetch(benchmarkRequest(founder, { host: ORIGIN, path: STUDY, method: "GET" }), f.env);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Run transition state-check candidate/);
  assert.match(html, /Compare cue continuity on calibration/);
  assert.equal((await f.worker.fetch(benchmarkRequest(tester, { path: STUDY, method: "GET" }), f.env)).status, 403);
  const body = new FormData();
  body.set("payload", new File(['{"version":"nocturne-story-study-20-2026-11-06-v1","split":"calibration","stories":[]}'], "study.json"));
  body.set("mode", "transitions-state");
  const submitted = (origin) => new Request(ORIGIN + STUDY, { method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": founder, Origin: origin }, body });
  assert.equal((await f.worker.fetch(submitted(BETA), f.env)).status, 403);
  assert.equal((await f.worker.fetch(submitted(ORIGIN), f.env)).status, 400);
  body.set("mode", "cue-continuity");
  assert.equal((await f.worker.fetch(submitted(ORIGIN), f.env)).status, 400);
  assert.deepEqual(f.reservations, []);
  assert.deepEqual(f.calls, []);
});

test("the Decisions benchmark returns safe counts and HTTP failure diagnostics on both endpoints", async () => {
  const f = fixture({ provider: () => new Response("provider-only details", { status: 403 }) });
  const response = await f.worker.fetch(benchmarkRequest(await token()), f.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(f.reservations.length, 4);
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls.every(call => call.options.redirect === "manual"));
  const body = await response.text(), result = JSON.parse(body);
  assert.equal(result.totals.decisions.sentenceCues.missed, 6);
  assert.equal(result.fixtures[0].decisions.calls[0].status, 403);
  assert.doesNotMatch(body, /provider-only details|synthetic_credential|Rain tapped/);
});

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
const SCENE_ANALYSIS_MODULES = ["deploy/cloudflare/scene-analysis.mjs", CONTEXT_CONTRACT,
  "deploy/cloudflare/corpus-study-budget.mjs",
  "deploy/cloudflare/decisions-benchmark.mjs", "deploy/cloudflare/scene-decisions.mjs",
  "deploy/cloudflare/decisions-corpus-benchmark.mjs", "deploy/cloudflare/decisions-corpus-pins.mjs",
  "deploy/cloudflare/decisions-story-study.mjs", "deploy/cloudflare/decisions-story-study-pins.mjs",
  "deploy/cloudflare/decisions-transition-study.mjs", "deploy/cloudflare/story-transition-analysis.mjs",
  "scripts/lib/nocturne-scene-analysis.mjs", "app/static/reader/scene-map.mjs", "app/static/reader/import.mjs"];
const sceneModules = root => Promise.all(SCENE_ANALYSIS_MODULES.map(async source => ({
  type: "ESModule", path: root + source, contents: await readFile(root + source, "utf8"),
})));
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
    ...await sceneModules(root),
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

async function studyBudget(t) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = "deploy/cloudflare/scene-analysis.mjs";
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "scene-budget-test-worker.mjs", contents: `
      import { SceneAnalysisBudget as Budget } from "./${source}";
      export class SceneAnalysisBudget extends Budget {
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (!["/expire-neutral-run", "/expire-reviewed-lease"].includes(path)) return super.fetch(request);
          const { runId } = await request.json();
          if (path === "/expire-neutral-run") this.sql.exec("UPDATE neutral_spend_run SET expires_at=? WHERE id=?", Date.now() - 1, runId);
          else this.sql.exec("UPDATE luna_corpus_review SET lease_until=? WHERE run_id=?", Date.now() - 1, runId);
          return new Response(null, { status: 204 });
        }
      }
      export default { fetch(request, env) {
        const stub = env.SCENE_ANALYSIS_BUDGET.get(env.SCENE_ANALYSIS_BUDGET.idFromName("scene-analysis:v1"));
        return stub.fetch(new Request("https://scene-analysis.internal" + new URL(request.url).pathname, request));
      } };` },
    ...await sceneModules(root),
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0,
  durableObjects: { SCENE_ANALYSIS_BUDGET: { className: "SceneAnalysisBudget", useSQLite: true } } });
  t.after(() => mf.dispose());
  const reserve = (id, suite) => mf.dispatchFetch("https://app.satinlore.com/reserve", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reader: id.toString(16).padStart(64, "0"), ...(suite ? { suite } : {}) }),
  });
  const post = (path, body) => mf.dispatchFetch(`https://app.satinlore.com/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const spend = (runId, shardId, operation, usedMicros, reader = "a".repeat(64)) => post("founder-neutral-spend", {
    runId, shardId, operation, reader, ...(usedMicros === undefined ? {} : { usedMicros }),
  });
  return { reserve, spend, reviewedSpend: value => post("founder-neutral-spend", value),
    expireRun: runId => post("expire-neutral-run", { runId }), expireReviewedLease: runId => post("expire-reviewed-lease", {runId}) };
}

const sha256 = value => createHash("sha256").update(value).digest("hex");

function reviewedClip(first = 32, sentence = "The kettle started to sing.") {
  const texts = ["The window was open.", sentence];
  let offset = 110;
  return {id: randomUUID(), storyId: "neutral-research-example", sourceSha256: "a".repeat(64), editionDigest: "b".repeat(64),
    units: texts.map((text, position) => {
      const byteStart = offset, byteEnd = byteStart + Buffer.byteLength(text);
      offset = byteEnd + 1;
      return {id: first + position, paragraph: 9, byteStart, byteEnd, digest: sha256(text), text};
    }), targetIds: [first + 1]};
}

test("the Luna corpus Worker sends only sealed exact excerpts and maps live rows to original coordinates", {timeout: 30000}, async t => {
  const {reviewedSpend} = await studyBudget(t);
  const f = fixture({provider: neutralProtocolUpstream, spend: reviewedSpend});
  const founder = await token(), tester = await token(TESTER_EMAIL), env = enableWholeStory(f.env);
  const clip = reviewedClip(), runId = randomUUID(), clipDigest = sha256(JSON.stringify(clip));
  const approval = {runId, clips: [{id: clip.id, digest: clipDigest}], reviewConfirmed: true};
  const post = (path, body, options = {}) => f.worker.fetch(request(founder, {path: `${LUNA_CORPUS_PATH}/${path}`, body, ...options}), env);
  assert.equal((await f.worker.fetch(request(founder, {method: "GET", path: LUNA_CORPUS_PATH}), f.env)).status, 404);
  assert.equal((await f.worker.fetch(request(tester, {method: "GET", path: LUNA_CORPUS_PATH}), env)).status, 403);
  assert.equal((await f.worker.fetch(request(founder, {method: "GET", path: LUNA_CORPUS_PATH, host: BETA}), env)).status, 404);
  const page = await f.worker.fetch(request(founder, {method: "GET", path: LUNA_CORPUS_PATH}), env);
  assert.match(await page.text(), /SatinLore founder Luna corpus review/u);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.equal((await post("approve", approval, {origin: "https://other.example"})).status, 403);
  assert.equal((await post("approve", {...approval, reviewConfirmed: false})).status, 400);
  const unapproved = await post("shard", {runId, clip});
  assert.equal(unapproved.status, 403);
  assert.equal((await unapproved.json()).code, "clip_not_approved");
  assert.equal(f.calls.length, 0);

  const approved = await post("approve", approval);
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).clipCount, 1);
  assert.equal((await post("approve", approval)).status, 200);
  const changed = {...reviewedClip(32, "The radio started to play."), id: clip.id};
  assert.equal((await post("shard", {runId, clip: changed})).status, 403);
  assert.equal((await post("approve", {...approval, clips: [{id: clip.id, digest: sha256(JSON.stringify(changed))}]})).status, 409);
  assert.equal(f.calls.length, 0);

  const live = await post("shard", {runId, clip});
  assert.equal(live.status, 200);
  const serialized = await live.text();
  const result = JSON.parse(serialized);
  assert.equal(result.status, "completed");
  assert.equal(result.clipDigest, clipDigest);
  assert.equal(result.externalCalls, 3);
  assert.equal(result.hostedSpend.capMicros, 3_000_000);
  assert.equal(result.hostedSpend.settled, true);
  assert.ok(result.hostedSpend.remainingMicros < 3_000_000);
  assert.deepEqual(result.units.map(row => [row.id, row.unitSha256]), clip.units.map(row => [row.id, row.digest]));
  assert.deepEqual(result.summary.attempts.filter(row => row.attempted).map(row => row.targetIds), [[32, 33], [33], [33]]);
  assert.equal(result.units[1].primaryPrefix.unitId, 33);
  assert.equal(result.units[1].transitionVerification.unitId, 33);
  assert.ok(f.calls.every(({url, options}) => url === studyProvider && options.redirect === "manual" && options.headers.Authorization === `Bearer ${KEY}`));
  const sent = f.calls.flatMap(({options}) => JSON.parse(JSON.parse(options.body).input).units.map(row => row.text));
  assert.ok(sent.every(text => clip.units.some(unit => unit.text === text)));
  assert.ok(clip.units.every(unit => !serialized.includes(unit.text) && !JSON.stringify(f.spendRequests).includes(unit.text)));
  assert.equal(serialized.includes(KEY), false);
  const duplicate = await post("shard", {runId, clip});
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, "shard_already_started");
  assert.equal(f.calls.length, 3);
});

test("a Luna corpus refusal halts the approved run without replaying another clip", {timeout: 30000}, async t => {
  const {reviewedSpend} = await studyBudget(t);
  const f = fixture({spend: reviewedSpend, provider: () => Response.json({status: "completed", model: "gpt-6-luna",
    usage: {input_tokens: 20, output_tokens: 5, total_tokens: 25}, output: [{type: "message", role: "assistant",
      content: [{type: "refusal", refusal: "private response canary"}]}]})});
  const founder = await token(), runId = randomUUID(), env = enableWholeStory(f.env);
  const first = reviewedClip(), second = reviewedClip(63);
  const post = (path, body) => f.worker.fetch(request(founder, {path: `${LUNA_CORPUS_PATH}/${path}`, body}), env);
  const approved = await post("approve", {runId, clips: [first, second].map(clip => ({id: clip.id, digest: sha256(JSON.stringify(clip))})), reviewConfirmed: true});
  assert.equal(approved.status, 200);
  const refused = await post("shard", {runId, clip: first});
  assert.equal(refused.status, 200);
  const body = await refused.text();
  assert.doesNotMatch(body, /private response canary/u);
  assert.equal(JSON.parse(body).status, "provider-refused");
  const halted = await post("shard", {runId, clip: second});
  assert.equal(halted.status, 409);
  assert.equal((await halted.json()).code, "run_halted");
  assert.equal(f.calls.length, 1);
});

test("a Luna corpus unknown shard keeps its spend hold and releases the in-flight lease for a different clip", {timeout: 30000}, async t => {
  const {reviewedSpend, expireReviewedLease} = await studyBudget(t);
  const runId = randomUUID();
  const clips = ["a", "b", "c"].map(character => ({id: randomUUID(), digest: character.repeat(64)}));
  const shared = {runId, reader: "e".repeat(64), rubricVersion: "nocturne-luna-protocol-v13"};
  assert.equal((await reviewedSpend({...shared, operation: "approve-reviewed", clips})).status, 200);
  const use = (position, operation = "reserve-reviewed", rest = {}) => reviewedSpend({...shared, operation,
    shardId: clips[position].id, clipDigest: clips[position].digest, ...rest});
  assert.equal((await use(0, "reserve-reviewed", {reader: "f".repeat(64)})).status, 409);
  assert.equal((await use(0, "reserve-reviewed", {rubricVersion: "different-rubric"})).status, 403);
  const first = await use(0);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).remainingMicros, 2_850_000);
  const blocked = await use(1);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.headers.get("X-Study-Error"), "shard_in_flight");
  assert.equal((await expireReviewedLease(runId)).status, 204);
  assert.equal((await use(0)).headers.get("X-Study-Error"), "shard_already_started");
  const second = await use(1);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).remainingMicros, 2_700_000);
  assert.equal((await use(0, "settle-reviewed", {usedMicros: 500, providerRefused: false})).status, 200);
  assert.equal((await use(2)).headers.get("X-Study-Error"), "shard_in_flight", "A late receipt cannot release the current lease.");
  assert.equal((await use(1, "settle-reviewed", {usedMicros: 1000, providerRefused: false})).status, 200);
  assert.equal((await use(2)).status, 200);
});

test("the SQLite budget admits concurrent work up to per-reader and deployment limits", { timeout: 30000 }, async t => {
  const { reserve } = await studyBudget(t);
  const first = await Promise.all(Array.from({ length: 16 }, () => reserve(1)));
  assert.equal(first.filter(response => response.status === 204).length, 12);
  assert.equal(first.filter(response => response.status === 429).length, 4);
  assert.equal((await reserve(1, "unknown-study")).status, 400);
  const study = await Promise.all(Array.from({ length: 22 }, () => reserve(1, "nocturne-story-study-20-2026-11-06-v1")));
  assert.equal(study.filter(response => response.status === 204).length, 20);
  assert.equal(study.filter(response => response.status === 429).length, 2);
  const pairs = await Promise.all(Array.from({ length: 4 }, () => reserve(1, "nocturne-cue-continuity-pair")));
  assert.equal(pairs.filter(response => response.status === 204).length, 1);
  assert.equal(pairs.filter(response => response.status === 429).length, 3);
  assert.equal((await reserve(1)).status, 429);
  const wholeStory = await Promise.all(Array.from({ length: 66 }, (_, index) => reserve(index + 3, WHOLE_STORY_SUITE)));
  assert.equal(wholeStory.filter(response => response.status === 204).length, 64);
  assert.equal(wholeStory.filter(response => response.status === 429).length, 2);
  const rest = await Promise.all(Array.from({ length: 92 }, (_, index) => reserve(index + 2)));
  assert.equal(rest.filter(response => response.status === 204).length, 2);
  assert.equal(rest.filter(response => response.status === 429).length, 90);
  assert.match((await reserve(100)).headers.get("Retry-After"), /^\d+$/);
});

test("one estimated-spend run permits at least 1,000 call equivalents without using reader allowance", { timeout: 30000 }, async t => {
  const { reserve, spend } = await studyBudget(t);
  const ordinary = await Promise.all(Array.from({ length: 100 }, (_, index) => reserve(index + 1)));
  assert.ok(ordinary.every(response => response.status === 204));
  const run = randomUUID();
  let equivalents = 0;
  for (let batch = 0; batch < 25; batch++) {
    const shard = randomUUID();
    const held = await spend(run, shard, "reserve");
    assert.equal(held.status, 200);
    assert.equal((await held.json()).shardCapMicros, 150_000);
    const receipt = await spend(run, shard, "settle", 40 * 500);
    assert.equal(receipt.status, 200);
    assert.equal((await receipt.json()).remainingMicros, 3_000_000 - (batch + 1) * 20_000);
    equivalents += 40;
  }
  assert.equal(equivalents, 1000);
  assert.equal((await reserve(101)).status, 429);
  assert.equal((await reserve(101, NEUTRAL_PROTOCOL_SUITE)).status, 400);
});

test("grouped spend reserves atomically, releases measured savings once and holds unsettled work", { timeout: 30000 }, async t => {
  const { reserve, spend } = await studyBudget(t);
  const run = randomUUID(), shards = Array.from({ length: 21 }, () => randomUUID());
  const responses = await Promise.all(shards.map(shard => spend(run, shard, "reserve")));
  assert.equal(responses.filter(response => response.status === 200).length, 20);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
  const accepted = shards[responses.findIndex(response => response.status === 200)];
  assert.equal((await spend(run, accepted, "reserve")).status, 409);
  assert.equal((await spend(run, accepted, "settle", 50_000, "b".repeat(64))).status, 409);
  for (let repetition = 0; repetition < 2; repetition++) {
    const receipt = await spend(run, accepted, "settle", 50_000);
    assert.equal(receipt.status, 200);
    assert.equal((await receipt.json()).remainingMicros, 100_000);
  }
  assert.equal((await spend(run, accepted, "settle", 0)).status, 409);
  const partial = await spend(run, randomUUID(), "reserve");
  assert.equal(partial.status, 200);
  const { shardCapMicros, remainingMicros } = await partial.json();
  assert.equal(shardCapMicros, 100_000);
  assert.equal(remainingMicros, 0);
  assert.equal((await spend(run, randomUUID(), "reserve")).status, 429);
  assert.equal((await reserve(1, WHOLE_STORY_SUITE)).status, 204);
  assert.equal((await reserve(1)).status, 204);
});

test("expired run IDs reject new dispatch, and a reported spend overrun closes the run", { timeout: 30000 }, async t => {
  const { spend, expireRun } = await studyBudget(t);
  const run = randomUUID(), shard = randomUUID();
  assert.equal((await spend(run, shard, "reserve")).status, 200);
  assert.equal((await expireRun(run)).status, 204);
  assert.equal((await spend(run, randomUUID(), "reserve")).status, 409);
  assert.equal((await spend(run, shard, "settle", 3)).status, 200);
  const breach = randomUUID(), old = randomUUID();
  assert.equal((await spend(breach, old, "reserve")).status, 200);
  const receipt = await spend(breach, old, "settle", 150_001);
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).remainingMicros, 0);
  assert.equal((await spend(breach, randomUUID(), "reserve")).status, 429);
});
