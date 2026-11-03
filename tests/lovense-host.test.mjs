import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createPrivateAppWorker, privateAppConfiguration } from "../deploy/cloudflare/worker.mjs";
import { LOVENSE_TOKEN_URL, emptyLovenseRequest, issueLovenseToken, lovenseConfiguration, lovenseReadiness, lovenseIdentity } from "../deploy/cloudflare/lovense.mjs";

const ORIGIN = "https://app.satinlore.com";
const CONFIG = { PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true", ACCESS_TEAM_DOMAIN: "fixture.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64), FOUNDER_EMAIL: "founder@example.test" };
const VENDOR = { LOVENSE_DEVELOPER_TOKEN: "synthetic-server-only-developer-credential", LOVENSE_UID_SECRET: "5".repeat(64), LOVENSE_PLATFORM: "SatinLore synthetic fixture" };
const { privateKey, publicKey } = await generateKeyPair("RS256");
const localKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" }] });
async function token(changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: `https://${CONFIG.ACCESS_TEAM_DOMAIN}`, aud: CONFIG.ACCESS_AUD, sub: "synthetic-subject", email: CONFIG.FOUNDER_EMAIL,
    type: "app", iat: now, exp: now + 3600, ...changes }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(privateKey);
}
function request(jwt, { path = "/api/lovense/session", body = {}, origin = ORIGIN, headers = {}, method = "POST" } = {}) {
  return new Request(ORIGIN + path, { method, headers: { ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}), Origin: origin, "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
}
function fixture({ keyResolver = localKeys, vendor, quota } = {}) {
  const vendorCalls = [], quotas = [], names = [];
  const worker = createPrivateAppWorker({ keyResolver, lovenseFetcher: async (url, options) => {
    vendorCalls.push({url, options}); return vendor ? vendor(url, options) : Response.json({ code: 0, data: { authToken: "synthetic-user-authentication-token" } });
  } });
  const env = { ...CONFIG, ...VENDOR, PRIVATE_FEEDBACK: { idFromName(name) { names.push(name); return name; }, get(name) { return { async fetch(input) {
    quotas.push({name, input}); return quota ? quota(input) : Response.json({ok: true});
  } }; } } };
  return {worker, env, vendorCalls, quotas, names};
}

test("hosted Lovense settings fail closed and use independent secret-derived pseudonymous identities", async () => {
  for (const key of Object.keys(VENDOR)) { const env = {...VENDOR}; delete env[key]; assert.equal(lovenseConfiguration(env), null); }
  assert.equal(lovenseConfiguration({...VENDOR, LOVENSE_UID_SECRET: "not-private"}), null);
  assert.equal(lovenseConfiguration({...VENDOR, LOVENSE_PLATFORM: "bad\nname"}), null);
  const uid = await lovenseIdentity("subject-one", CONFIG.ACCESS_AUD, VENDOR.LOVENSE_UID_SECRET);
  assert.match(uid, /^sl_[a-f0-9]{64}$/); assert.doesNotMatch(uid, /subject|founder/);
  assert.equal(await lovenseIdentity("subject-one", CONFIG.ACCESS_AUD, VENDOR.LOVENSE_UID_SECRET), uid);
  assert.notEqual(await lovenseIdentity("subject-two", CONFIG.ACCESS_AUD, VENDOR.LOVENSE_UID_SECRET), uid);
  assert.notEqual(await lovenseIdentity("subject-one", CONFIG.ACCESS_AUD, "6".repeat(64)), uid);
});
test("tester admission remains an explicit bounded allowlist in addition to signed Access authorization", async () => {
  const f = fixture(), jwt = await token({ email: "tester@example.test" });
  assert.equal((await f.worker.fetch(request(jwt), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request(jwt), {...f.env, BETA_TESTER_EMAILS: " tester@example.test "})).status, 200);
  assert.equal((await f.worker.fetch(request(await token({email: "other@example.test"})), {...f.env, BETA_TESTER_EMAILS: "tester@example.test"})).status, 403);
  for (const invalid of ["anyone", "*", "a@b.test,".repeat(21), "x".repeat(6001), ["tester@example.test"]]) {
    assert.equal(privateAppConfiguration({...CONFIG, BETA_TESTER_EMAILS: invalid}), null);
  }
});
test("status reveals availability only and all Lovense endpoints require the existing signed identity", async () => {
  const f = fixture(), jwt = await token();
  for (const path of ["/api/lovense/status", "/api/lovense/session"]) assert.equal((await f.worker.fetch(request(undefined, {path,method:path.endsWith("status")?"GET":"POST"}), f.env)).status, 403);
  const status = await (await f.worker.fetch(request(jwt, {path:"/api/lovense/status",method:"GET"}), {...f.env, LOVENSE_DEVELOPER_TOKEN: undefined})).json();
  assert.equal(status.available, false); assert.equal(typeof status.message, "string");
  assert.deepEqual(Object.keys(status).sort(), ["available", "checks", "message"]);
  assert.deepEqual(status.checks, {developerToken: "missing", platform: "ready", uidSecret: "ready", storage: "ready"});
  assert.match(status.message, /LOVENSE_DEVELOPER_TOKEN runtime Secret/);
  assert.equal((await f.worker.fetch(request(jwt), {...f.env, LOVENSE_DEVELOPER_TOKEN: undefined})).status, 503);
  assert.equal(f.vendorCalls.length, 0); assert.equal(f.quotas.length, 0);
});
test("readiness identifies missing and malformed runtime settings without exposing a value or contacting Lovense", async () => {
  const f = fixture(), jwt = await token();
  const invalid = {...f.env, LOVENSE_PLATFORM:"private<invalid>name", LOVENSE_UID_SECRET:"private-user-id-is-not-a-secret", PRIVATE_FEEDBACK:undefined};
  const response = await f.worker.fetch(request(jwt, {path:"/api/lovense/status",method:"GET"}), invalid);
  const value = await response.json();
  assert.equal(value.available, false);
  assert.deepEqual(value.checks, {developerToken:"ready", platform:"invalid", uidSecret:"invalid", storage:"missing"});
  assert.doesNotMatch(JSON.stringify(value), /private<invalid>|private-user-id|synthetic-server-only/);
  assert.equal(f.vendorCalls.length,0);
  assert.equal(lovenseReadiness(VENDOR,true).available,true);
  assert.deepEqual(lovenseConfiguration({...VENDOR,LOVENSE_DEVELOPER_TOKEN:`  ${VENDOR.LOVENSE_DEVELOPER_TOKEN} \n`,LOVENSE_UID_SECRET:` ${VENDOR.LOVENSE_UID_SECRET} `}),lovenseConfiguration(VENDOR));
});
test("beta origin is signed and exact-host gated, with a separately scoped optional audience and private bridge policy", async () => {
  const f=fixture(), jwt=await token(), beta="https://beta.satinlore.com";
  const betaRequest=(jwt,{method="GET",path="/api/lovense/status",origin=beta,...options}={})=>new Request(beta+path,{method,headers:{...(jwt?{"Cf-Access-Jwt-Assertion":jwt}:{}),Origin:origin,"Content-Type":"application/json"},...(method==="POST"?{body:"{}"}:{}),...options});
  assert.equal((await f.worker.fetch(betaRequest(),f.env)).status,403);
  const ready=await f.worker.fetch(betaRequest(jwt),f.env);
  assert.equal(ready.status,200);assert.equal((await ready.json()).available,true);
  assert.match(ready.headers.get("Content-Security-Policy"),/frame-src https:\/\/beta\.satinlore\.com\/device-bridge/);
  assert.equal((await f.worker.fetch(betaRequest(jwt,{method:"POST",path:"/api/lovense/session",origin:ORIGIN}),f.env)).status,403);
  assert.equal(f.vendorCalls.length,0);
  const paired=await f.worker.fetch(betaRequest(jwt,{method:"POST",path:"/api/lovense/session"}),f.env);
  assert.equal(paired.status,200);assert.equal(f.quotas[0].input.headers.get("Origin"),ORIGIN);
  const alternateAudience="b".repeat(64), alternateEnv={...f.env,BETA_ACCESS_AUD:alternateAudience};
  assert.equal((await f.worker.fetch(betaRequest(jwt),alternateEnv)).status,403);
  const betaJwt=await token({aud:alternateAudience});
  assert.equal((await f.worker.fetch(betaRequest(betaJwt),alternateEnv)).status,200);
  assert.equal((await f.worker.fetch(request(betaJwt,{path:"/api/lovense/status",method:"GET"}),alternateEnv)).status,403);
  assert.equal((await f.worker.fetch(betaRequest(jwt),{...f.env,BETA_ACCESS_AUD:"invalid"})).status,503);
});
test("connection credentials accept no client identity or story fields and require exact-origin bounded JSON", async () => {
  const f = fixture(), jwt = await token();
  for (const options of [
    { origin: "https://evil.example.test" }, { headers: { "Sec-Fetch-Site":"same-site" } }, { headers: { "Sec-Fetch-Site":"cross-site" } },
    { headers: { "Content-Type":"text/plain" } }, { body: {uid:"other-reader"} }, { body: {story:"never-forward"} }, { body: [] },
    { body: "x".repeat(65) }, { path:"/api/lovense/session?uid=other-reader" },
  ]) assert.ok([400,403,413].includes((await f.worker.fetch(request(jwt, options), f.env)).status));
  assert.equal((await f.worker.fetch(request(jwt, {method:"GET"}), f.env)).status, 405);
  assert.equal(f.vendorCalls.length, 0); assert.equal(f.quotas.length, 0);
  const malformed = new Request(ORIGIN + "/api/lovense/session", {method:"POST", headers:{"Content-Type":"application/json"}, body:new Uint8Array([0xff])});
  await assert.rejects(emptyLovenseRequest(malformed));
});
test("server exchange sends only server credential and derived UID; response expires within the current Access session", async () => {
  const f = fixture(), jwt = await token(), start = Math.floor(Date.now()/1000);
  const response = await f.worker.fetch(request(jwt), f.env), value = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Object.keys(value).sort(), ["authToken","expires_at","platform","uid"]);
  assert.match(value.uid, /^sl_[a-f0-9]{64}$/); assert.equal(value.platform, VENDOR.LOVENSE_PLATFORM);
  assert.ok(value.expires_at >= start+899 && value.expires_at <= start+901);
  const sent = f.vendorCalls[0]; assert.equal(sent.url, LOVENSE_TOKEN_URL);
  assert.deepEqual(JSON.parse(sent.options.body), {token: VENDOR.LOVENSE_DEVELOPER_TOKEN, uid:value.uid});
  assert.equal(sent.options.credentials, "omit"); assert.equal(sent.options.redirect, "error"); assert.ok(sent.options.signal);
  assert.equal(f.names[0], `lovense-issue:v1:${value.uid}`); assert.equal(f.quotas[0].input.url, "https://feedback.internal/internal/lovense-rate");
  assert.equal(await f.quotas[0].input.text(), "{}");
  assert.doesNotMatch(JSON.stringify(value), /synthetic-server-only|synthetic-subject|founder@example/);
  const short = await (await f.worker.fetch(request(await token({exp:start+120})), f.env)).json();
  assert.equal(short.expires_at, start+120);
});
test("quota rejection and storage failures precede vendor requests, without false successful connection claims", async () => {
  const jwt = await token();
  for (const status of [429,503]) {
    const f = fixture({quota: () => Response.json({error:"private failure"},{status,headers:{"Retry-After":"60"}})});
    const response = await f.worker.fetch(request(jwt), f.env);
    assert.equal(response.status,status); assert.equal(f.vendorCalls.length,0);
    assert.doesNotMatch(await response.text(), /private failure|authToken/);
  }
});
test("post-vendor Access revalidation discards credentials when authentication expires or changes", async () => {
  let checks=0;
  const f=fixture({keyResolver: async (...args)=>{if (++checks>1) throw new Error("synthetic revoked access");return localKeys(...args);}});
  const response=await f.worker.fetch(request(await token()), f.env);
  assert.equal(response.status,403); assert.equal(f.vendorCalls.length,1);
  assert.doesNotMatch(await response.text(), /authToken|synthetic-user-authentication-token|synthetic revoked/);
});
test("vendor failures, redirects, oversized/invalid response bodies and developer-token echoes are redacted", async () => {
  const config=lovenseConfiguration(VENDOR);
  for (const vendor of [
    () => new Response("secret vendor exception",{status:500}), () => new Response("redirect",{status:302}),
    () => Response.json({code:0,data:{authToken:VENDOR.LOVENSE_DEVELOPER_TOKEN}}),
    () => Response.json({code:0,data:{authToken:" "}}), () => Response.json({code:200,data:{authToken:"token"}}),
    () => new Response("x".repeat(16385)), () => new Response(new Uint8Array([0xff])),
    () => {throw new Error("secret credential leaked by transport");},
  ]) await assert.rejects(issueLovenseToken(config,"sl_fixture",{fetcher:vendor}), error=>error.status===502&&!/secret|credential leaked|synthetic-server/.test(error.message));
});
