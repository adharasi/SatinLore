import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createPrivateAppWorker, privateAppConfiguration } from "../deploy/cloudflare/worker.mjs";
import { PRIVATE_ASSET_PATHS, PRIVATE_DOCUMENT_ROUTES, ALPHA_ASSETS, CORPUS_STUDY_CLIENT_ASSET } from "../deploy/cloudflare/assets.mjs";
import { FEEDBACK_INBOX_NAME } from "../deploy/cloudflare/feedback.mjs";
import { ALPHA_COOKIE } from "../deploy/cloudflare/alpha-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://app.satinlore.com";
const ENV = {
  PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true",
  ACCESS_TEAM_DOMAIN: "synthetic-team.cloudflareaccess.com",
  ACCESS_AUD: "a".repeat(64), FOUNDER_EMAIL: "founder@example.test",
};
const BETA_ONLY_ROUTES = new Set(["/simulator-lab", "/simulation.html", "/static/simulation.mjs", "/static/simulation.css",
  "/static/simulation/clock.mjs", "/static/simulation/transport.mjs", "/static/simulation/scenarios.mjs", "/static/devices/mock.mjs",
  "/static/devices/profile-simulator.mjs", "/static/devices/reader-beta-device.mjs", "/static/playback/controller.mjs",
  "/static/reader/beta-toolkit.mjs", "/static/reader/simulator-view.mjs", "/static/reader/practice-stories.mjs",
  "/static/reader/beta-recording.mjs", "/static/reader/beta-recording.css", "/static/reader/beta-stories.mjs"]);
const { privateKey, publicKey } = await generateKeyPair("RS256");
const otherKeys = await generateKeyPair("RS256");
const publicJwk = { ...await exportJWK(publicKey), kid: "synthetic-key", alg: "RS256" };
const localKeys = createLocalJWKSet({ keys: [publicJwk] });
async function token(changes = {}, key = privateKey, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: `https://${ENV.ACCESS_TEAM_DOMAIN}`, aud: ENV.ACCESS_AUD,
    sub: "synthetic-founder", email: ENV.FOUNDER_EMAIL, type: "app", iat: now, exp: now + 3600, ...changes,
  }).setProtectedHeader({ alg: "RS256", kid: "synthetic-key", ...header }).sign(key);
}
function fixture() {
  const reads = [], keyRequests = [];
  const worker = createPrivateAppWorker({ keyResolver: async (...args) => { keyRequests.push(args[0]); return localKeys(...args); } });
  const env = { ...ENV, ASSETS: { async fetch(request) {
    reads.push(request);
    const path = new URL(request.url).pathname;
    const bundle = '<!doctype html><script id="lovense-isolated-bundle">void 0;</script>';
    const document = '<!doctype html><head><script src="/static/app.mjs"></script></head><a href="/">Back</a>';
    return new Response(path === "/device-bridge.html" ? bundle : path.endsWith(".html") ? document : "Synthetic reader asset",
      { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" } });
  } } };
  return { worker, env, reads, keyRequests };
}
function request(path = "/", jwt, options = {}) {
  const { origin = ORIGIN, ...rest } = options;
  return new Request(origin + path, { ...rest, headers: { ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}), ...rest.headers } });
}

test("private preview requires complete exact-origin, issuer, dedicated-audience and founder configuration", () => {
  assert.deepEqual(privateAppConfiguration(ENV), { origin: ORIGIN, issuer: `https://${ENV.ACCESS_TEAM_DOMAIN}`, audience: ENV.ACCESS_AUD, email: ENV.FOUNDER_EMAIL });
  for (const key of Object.keys(ENV)) {
    const env = { ...ENV }; delete env[key];
    assert.equal(privateAppConfiguration(env), null, `missing ${key}`);
  }
  for (const changes of [
    { PUBLIC_APP_ORIGIN: ORIGIN + "/" }, { PUBLIC_APP_ORIGIN: "http://app.satinlore.com" },
    { PUBLIC_APP_ORIGIN: "https://satinlore.com" }, { PRIVATE_APP_ENABLED: "false" },
    { ACCESS_TEAM_DOMAIN: "https://synthetic-team.cloudflareaccess.com" },
    { ACCESS_TEAM_DOMAIN: "synthetic-team.cloudflareaccess.com.attacker.test" },
    { ACCESS_AUD: "" }, { ACCESS_AUD: "0".repeat(64) }, { ACCESS_AUD: "placeholder" },
    { FOUNDER_EMAIL: "@example.test" }, { FOUNDER_EMAIL: "anyone" },
  ]) assert.equal(privateAppConfiguration({ ...ENV, ...changes }), null);
});

test("every static reader route denies missing tokens before fetching assets or signing keys", async () => {
  const f = fixture();
  for (const path of [...Object.keys(PRIVATE_DOCUMENT_ROUTES), ...PRIVATE_ASSET_PATHS]) {
    const result = await f.worker.fetch(request(path), f.env);
    if (BETA_ONLY_ROUTES.has(path) || ["/billing", "/billing.html", "/billing-admin.html", "/billing-admin/app.mjs"].includes(path)) {
      assert.equal(result.status, 404, path);
      continue;
    }
    assert.equal(result.status, 403, path);
    assert.deepEqual(await result.json(), { error: "Founder access required." });
  }
  assert.equal(f.reads.length, 0); assert.equal(f.keyRequests.length, 0);
  const result = await f.worker.fetch(request("/", await token()), { ...f.env, ACCESS_AUD: "" });
  assert.equal(result.status, 503); assert.equal(f.reads.length, 0); assert.equal(f.keyRequests.length, 0);
});

test("valid founder assertions grant only read-only allowlisted files and strip input metadata from asset fetch", async () => {
  const f = fixture(), jwt = await token();
  for (const path of [...Object.keys(PRIVATE_DOCUMENT_ROUTES), ...PRIVATE_ASSET_PATHS]) {
    const response = await f.worker.fetch(request(path, jwt), f.env);
    if (BETA_ONLY_ROUTES.has(path) || ["/billing", "/billing.html", "/billing-admin.html", "/billing-admin/app.mjs"].includes(path)) {
      assert.equal(response.status, 404, path);
      continue;
    }
    if (path.startsWith("/feedback-admin/") || ["/admin","/admin/","/beta-admin.html","/static/beta-admin.mjs","/static/beta-admin.css"].includes(path)) {
      assert.equal(response.status,403,path);continue;
    }
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    const policy = response.headers.get("Content-Security-Policy");
    if (["/device-bridge", "/device-bridge.html"].includes(path)) {
      assert.match(policy, /sandbox allow-scripts/);
      assert.doesNotMatch(policy, /allow-same-origin|unsafe-inline|unsafe-eval/);
      assert.match(policy, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
      assert.match(policy, /connect-src https:\/\/\*\.lovense/);
      assert.equal(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
    } else {
      assert.match(policy, /connect-src 'self'/);
      assert.match(policy, /script-src 'self';/);
      assert.match(policy, /frame-src https:\/\/app\.satinlore\.com\/device-bridge/);
      assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    }
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  await f.worker.fetch(request("/?private-query=must-not-reach-assets", jwt, { headers: { Cookie: "private=synthetic" } }), f.env);
  const asset = f.reads.at(-1);
  assert.equal(asset.url, ORIGIN + "/index.html");
  assert.equal(asset.headers.get("Cf-Access-Jwt-Assertion"), null);
  assert.equal(asset.headers.get("Cookie"), null);
  const head = await f.worker.fetch(request("/static/app.mjs", jwt, { method: "HEAD" }), f.env);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
});

test("wrong audience, identity, issuer, key, time, token kind and malformed assertions fail closed", async () => {
  const f = fixture();
  const now = Math.floor(Date.now() / 1000);
  for (const changes of [
    { aud: "b".repeat(64) }, { email: "another@example.test" }, { email: "founder@example.test.attacker" },
    { iss: "https://attacker.example.test" }, { exp: now - 1 }, { exp: undefined }, { iat: undefined },
    { iat: now + 120 }, { nbf: now + 120 }, { sub: "" }, { sub: undefined }, { type: "service" },
    { type: "org" }, { email: undefined }, { type: undefined }, { exp: now + .5 },
  ]) {
    const result = await f.worker.fetch(request("/", await token(changes)), f.env);
    assert.equal(result.status, 403, JSON.stringify(changes));
  }
  for (const jwt of ["malformed", "x".repeat(16_385), await token({}, otherKeys.privateKey), await token({}, privateKey, { kid: "unrecognized-key" })]) {
    const response = await f.worker.fetch(request("/", jwt), f.env);
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /synthetic-founder|attacker|Invalid|signature/);
  }
  const hmac = await new SignJWT({ email: ENV.FOUNDER_EMAIL }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("synthetic-not-a-production-key"));
  assert.equal((await f.worker.fetch(request("/", hmac), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request("/", undefined, { headers: { "Cf-Access-Authenticated-User-Email": ENV.FOUNDER_EMAIL } }), f.env)).status, 403);
  const unavailableKeys = createPrivateAppWorker({ keyResolver: async () => { throw new Error("synthetic key-service failure"); } });
  assert.equal((await unavailableKeys.fetch(request("/", await token()), f.env)).status, 403);
  assert.equal(f.reads.length, 0);
});

test("a valid assertion cannot enable alternate hostnames, local invitation or private-file routes", async () => {
  const f = fixture(), jwt = await token();
  for (const origin of ["https://satinlore-private-app.synthetic.workers.dev", "https://version.example.workers.dev", "https://www.app.satinlore.com", "https://satinlore.com", "http://app.satinlore.com", "https://app.satinlore.com:8443"]) {
    assert.equal((await f.worker.fetch(request("/", jwt, { origin }), f.env)).status, 403, origin);
  }
  for (const path of ["/device-check", "/static/device-check.html", "/static/device-check.mjs", "/static/device-bridge.mjs", "/static/devices/lovense.mjs", "/api/me", "/api/invites/redeem", "/api/logout", "/.env", "/data/satinlore.sqlite3", "/AGENTS.md", "/static/AGENTS.md", "/static/playback/README.md", "/unknown", "/static%2fapp.mjs"]) {
    assert.equal((await f.worker.fetch(request(path, jwt), f.env)).status, 404, path);
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const response = await f.worker.fetch(request("/api/access", jwt, { method }), f.env);
    assert.equal(response.status, 405); assert.equal(response.headers.get("Allow"), "GET, HEAD");
  }
  assert.equal(f.reads.length, 0);
});

test("the authenticated access probe exposes only expiry in milliseconds and labels each reader's connection mode", async () => {
  const f = fixture(), exp = Math.floor(Date.now() / 1000) + 120, jwt = await token({ exp });
  const response = await f.worker.fetch(request("/api/access", jwt), f.env);
  assert.deepEqual(await response.json(), { authenticated: true, expiresAt: exp * 1000 });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await (await f.worker.fetch(request("/api/health", jwt), f.env)).json(), { status: "ok", device_mode: "lovense", beta_ready: false });
  const betaHealth = await f.worker.fetch(request("/api/health", jwt, {origin: "https://beta.satinlore.com"}), f.env);
  assert.deepEqual(await betaHealth.json(), { status: "ok", device_mode: "simulator", beta_ready: false });
  assert.equal(f.reads.length, 0);
  assert.equal((await f.worker.fetch(request("/api/access"), f.env)).status, 403);
});

test("app beta requires its own signed Access audience for the page, modules and playback probe", async () => {
  const f = fixture();
  const aud = "b".repeat(64), legacyAud = "c".repeat(64), email = "tester@example.test";
  const env = {...f.env, APP_BETA_ACCESS_AUD: aud, BETA_ACCESS_AUD: legacyAud, BETA_TESTER_EMAILS: email,
    PUBLIC_READER_ENABLED: "true", PUBLIC_READER_OTP_KEY: "ba".repeat(32),
    PUBLIC_READER_AUTH: {idFromName() {}, get() {}}, READER_ACCOUNTS: {idFromName() {}, get() {}},
    AUTH_SES_REGION: "eu-west-2", AUTH_SES_FROM_EMAIL: "reader@example.test", AUTH_SES_ACCESS_KEY_ID: "X".repeat(20),
    AUTH_SES_SECRET_ACCESS_KEY: "X".repeat(40)};
  const expires = Math.floor(Date.now() / 1000) + 120;
  const tester = await token({ aud, email, exp: expires }), founder = await token({ aud });
  const rejected = [undefined, await token(), await token({aud: legacyAud, email}),
    await token({aud, email: "other@example.test"}), await token({aud: [aud, ENV.ACCESS_AUD]}),
    await token({aud, email, exp: expires - 180})];
  for (const path of ["/beta", "/beta/", "/beta/simulator-lab", "/beta/static/reader/beta-toolkit.mjs", "/beta/api/access"]) {
    for (const jwt of rejected) {
      assert.equal((await f.worker.fetch(request(path, jwt, {headers: {Cookie: "synthetic=public-session"}}), env)).status, 403, path);
    }
  }
  assert.equal(f.reads.length, 0);
  for (const value of [undefined, ENV.ACCESS_AUD, legacyAud, "placeholder"]) {
    assert.equal((await f.worker.fetch(request("/beta", tester), {...env, APP_BETA_ACCESS_AUD: value})).status, 503);
  }

  for (const path of ["/beta", "/beta/", "/beta/simulator-lab"]) {
    const page = await f.worker.fetch(request(path, tester), env);
    assert.equal(page.status, 200, path);
    assert.equal(page.headers.get("Cache-Control"), "no-store");
    assert.match(page.headers.get("Content-Security-Policy"), /frame-src 'none';/);
    const html = await page.text();
    assert.match(html, /name="satinlore-reader-mode" content="beta"/);
    assert.match(html, /src="\/beta\/static\/app\.mjs"/);
    assert.match(html, /href="\/beta"/);
    assert.doesNotMatch(html, /satinlore-public-auth/);
  }
  const module = await f.worker.fetch(request("/beta/static/reader/beta-toolkit.mjs?ignored=1", tester, {headers: {Cookie:"private=synthetic"}}), env);
  assert.equal(module.status, 200);
  assert.equal(f.reads.at(-1).url, ORIGIN + "/static/reader/beta-toolkit.mjs");
  assert.equal(f.reads.at(-1).headers.get("Cookie"), null);
  assert.equal(f.reads.at(-1).headers.get("Cf-Access-Jwt-Assertion"), null);
  const access = await f.worker.fetch(request("/beta/api/access", tester), env);
  assert.deepEqual(await access.json(), {authenticated: true, expiresAt: expires * 1000});
  const head = await f.worker.fetch(request("/beta", founder, {method: "HEAD"}), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await f.worker.fetch(request("/beta/api/access", tester, {method: "POST"}), env)).status, 405);
  for (const path of ["/beta/api/access?extra=1", "/beta/admin", "/beta/api/lovense/session", "/beta/api/billing-admin", "/beta/api/beta/recordings", "/beta/static/beta-admin.mjs", "/beta/.env"]) {
    assert.equal((await f.worker.fetch(request(path, founder), env)).status, 404, path);
  }

  for (const path of BETA_ONLY_ROUTES) {
    assert.equal((await f.worker.fetch(request(path, founder), env)).status, 404, path);
    assert.equal((await f.worker.fetch(request(path), env)).status, 404, path);
  }
  const publicReader = await (await f.worker.fetch(request("/"), env)).text();
  assert.match(publicReader, /name="satinlore-reader-mode" content="live"/);
  assert.match(publicReader, /satinlore-public-auth/);
  assert.match(publicReader, /src="\/static\/app\.mjs"/);
  const privateReader = await (await f.worker.fetch(request("/", await token()), {...env, PUBLIC_READER_ENABLED: "false"})).text();
  assert.match(privateReader, /name="satinlore-reader-mode" content="live"/);
  assert.doesNotMatch(privateReader, /satinlore-public-auth/);
  assert.equal((await f.worker.fetch(request("/", tester, {origin: "https://beta.satinlore.com"}), env)).status, 403);
  assert.equal((await f.worker.fetch(request("/simulator-lab", await token({aud: legacyAud, email}), {origin: "https://beta.satinlore.com"}), env)).status, 200);
});

test("unavailable asset bindings and asset-service errors cannot serve an unprotected fallback", async () => {
  const f = fixture(), jwt = await token();
  assert.equal((await f.worker.fetch(request("/", jwt), { ...f.env, ASSETS: undefined })).status, 503);
  assert.equal((await f.worker.fetch(request("/", jwt), { ...f.env, ASSETS: { fetch: async () => { throw new Error("synthetic-private-error"); } } })).status, 503);
  assert.equal((await f.worker.fetch(request("/", jwt), { ...f.env, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } })).status, 404);
});

test("deployment invokes authentication ahead of all assets and packages only the explicit reader set", async () => {
  const config = JSON.parse(await readFile(resolve(ROOT, "wrangler.jsonc"), "utf8"));
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.not_found_handling, "none");
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "app.satinlore.com", custom_domain: true }, {pattern:"beta.satinlore.com",custom_domain:true}]);
  assert.equal(config.d1_databases, undefined); assert.equal(config.r2_buckets, undefined);
  assert.deepEqual(config.durable_objects.bindings, [{ name: "PRIVATE_FEEDBACK", class_name: "PrivateFeedback" },{name:"READER_ACCOUNTS",class_name:"ReaderAccount"},{name:"BETA_RECORDINGS",class_name:"BetaRecordings"},{name:"ALPHA_STUDY",class_name:"AlphaStudy"},{name:"SCENE_ANALYSIS_BUDGET",class_name:"SceneAnalysisBudget"},{name:"PUBLIC_READER_AUTH",class_name:"PublicReaderAuth"},{name:"COMMERCE",class_name:"SatinLoreCommerce"},{name:"LAUNCH_USAGE",class_name:"LaunchUsage"}]);
  assert.deepEqual(config.migrations, [{ tag: "v1", new_sqlite_classes: ["PrivateFeedback"] },{tag:"v2",new_sqlite_classes:["ReaderAccount","BetaRecordings"]},{tag:"v3",new_sqlite_classes:["AlphaStudy"]},{tag:"v4",new_sqlite_classes:["SceneAnalysisBudget"]},{tag:"v5",new_sqlite_classes:["PublicReaderAuth"]},{tag:"v6",new_sqlite_classes:["SatinLoreCommerce","LaunchUsage"]}]);
  assert.equal(config.keep_vars, true);
  for (const key of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "APP_BETA_ACCESS_AUD", "PRIVATE_APP_ENABLED", "PUBLIC_READER_ENABLED", "PUBLIC_READER_OTP_KEY"]) {
    assert.equal(Object.hasOwn(config.vars, key), false, `${key} must remain dashboard-owned`);
  }
  assert.equal(config.vars.PUBLIC_APP_ORIGIN, ORIGIN);
  assert.equal(config.vars.FOUNDER_EMAIL, "team@satinlore.com");
  assert.equal(privateAppConfiguration(config.vars), null);
  assert.equal(privateAppConfiguration({ ...config.vars, ACCESS_AUD: "" }), null);
  const localIndex = await readFile(resolve(ROOT, "app/static/index.html"), "utf8");
  execFileSync(process.execPath, [resolve(ROOT, "scripts/build-private-app.mjs")], { cwd: ROOT });
  const output = resolve(ROOT, "dist/private-app");
  async function list(path, prefix = "") {
    const files = [];
    for (const item of await readdir(path, { withFileTypes: true })) {
      const name = `${prefix}/${item.name}`;
      files.push(...(item.isDirectory() ? await list(resolve(path, item.name), name) : [name]));
    }
    return files;
  }
  assert.deepEqual((await list(output)).sort(), [...PRIVATE_ASSET_PATHS, ...ALPHA_ASSETS.map(([, path]) => path), CORPUS_STUDY_CLIENT_ASSET].sort());
  assert.equal(PRIVATE_ASSET_PATHS.includes(CORPUS_STUDY_CLIENT_ASSET),false,"Research module must not enter reader asset routing.");
  assert.equal(await readFile(resolve(output,CORPUS_STUDY_CLIENT_ASSET.slice(1)),"utf8"),
    await readFile(resolve(ROOT,"deploy/cloudflare/corpus-study-client.mjs"),"utf8"));
  const hosted = await readFile(resolve(output, "index.html"), "utf8");
  assert.match(hosted, /<meta name="satinlore-hosted-access" content="true">/);
  for (const path of Object.values(PRIVATE_DOCUMENT_ROUTES)) {
    const page = await readFile(resolve(output, path.slice(1)), "utf8");
    assert.match(page, /<meta name="satinlore-hosted-access" content="true">/);
    assert.match(page, /<meta name="satinlore-build" content="(?:[a-f0-9]{40}|local)">/);
  }
  assert.doesNotMatch(hosted, /<script[^>]+(?:lovense-api|device-bridge)/i);
  const help = await readFile(resolve(output, "help.html"), "utf8");
  assert.match(help, /<a href="https:\/\/developers\.openai\.com\/api\/docs\/guides\/your-data" target="_blank" rel="noopener">OpenAI’s data controls<\/a>/);
  assert.doesNotMatch(help, /<(?:script|img|link)[^>]+(?:src|href)=["']https?:\/\//i);
  const bridge = await readFile(resolve(output, "device-bridge.html"), "utf8");
  assert.match(bridge, /<script id="lovense-isolated-bundle">/);
  const embedded = bridge.match(/<script id="lovense-isolated-bundle">([\s\S]*?)<\/script>/);
  assert.ok(embedded, "The compiled bridge script is present in the packaged document.");
  assert.doesNotThrow(() => new Script(embedded[1], { filename: "packaged-device-bridge.js" }));
  assert.doesNotMatch(bridge, /<script[^>]+src=|import\s+.*from\s+["']/i);
  assert.match(bridge, /https:\/\/api\.lovense-api\.com\/basic-sdk\/core\.min\.js/);
  assert.doesNotMatch(bridge, /LOVENSE_DEVELOPER_TOKEN|LOVENSE_UID_SECRET/);
  assert.equal(await readFile(resolve(ROOT, "app/static/index.html"), "utf8"), localIndex);
});

test("the unauthenticated Alpha namespace serves its sign-in shell without opening reader or study data", async () => {
  const f = fixture();
  const page = await f.worker.fetch(request("/alpha?next=admin"), f.env);
  assert.equal(page.status, 200);
  assert.equal(f.reads[0].url, ORIGIN + "/alpha/index.html");
  assert.match(page.headers.get("Permissions-Policy"), /display-capture=\(self\)/);
  assert.match(page.headers.get("Content-Security-Policy"), /media-src 'self' blob:/);
  assert.match(page.headers.get("Content-Security-Policy"), /frame-src https:\/\/app\.satinlore\.com\/alpha\/device-bridge;/);
  assert.equal((await f.worker.fetch(request("/alpha/static/theme.css"), f.env)).status, 200);
  for (const path of ["/alpha/device-bridge", "/alpha/api/access", "/alpha/api/lovense/status", "/alpha/static/alpha-admin.mjs"]) {
    assert.equal((await f.worker.fetch(request(path), f.env)).status, 401, path);
  }
  for (const path of ["/alpha/admin.html", "/alpha/static/app.mjs", "/alpha/api/account", "/alpha/static/reader/storage.mjs"]) {
    assert.equal((await f.worker.fetch(request(path), f.env)).status, 404, path);
  }
  assert.equal((await f.worker.fetch(request("/alpha", await token(), { origin: "https://beta.satinlore.com" }), f.env)).status, 404);
  assert.equal((await f.worker.fetch(request("/static/app.mjs", undefined, { headers: { Cookie: "__Host-satinlore_alpha=synthetic" } }), f.env)).status, 403);
  assert.equal(f.reads.length, 2);
});

test("Alpha's login module remains available while simulator code needs a verified Alpha session", async () => {
  const f = fixture(), alphaToken = "a".repeat(64);
  const env = {...f.env, ALPHA_DILAN_VERIFIER: "b".repeat(64), ALPHA_SADIE_VERIFIER: "c".repeat(64),
    ALPHA_STUDY: {idFromName: name => name, get: () => ({async fetch(request) {
      const authenticated = request.headers.get("X-Alpha-Session") === alphaToken;
      return Response.json({authenticated, username: "Sadie", expiresAt: Date.now() + 60_000});
    }})}};
  assert.equal((await f.worker.fetch(request("/alpha/static/alpha.mjs"), env)).status, 200);
  for (const file of ["alpha-device.mjs", "alpha-movement-view.mjs", "devices/reader-beta-device.mjs",
    "devices/profile-simulator.mjs", "playback/controller.mjs", "reader/simulator-view.mjs"]) {
    const path = `/alpha/static/${file}`;
    assert.equal((await f.worker.fetch(request(path, await token()), env)).status, 401, path);
    const headers = {Cookie: `${ALPHA_COOKIE}=${alphaToken}`};
    assert.equal((await f.worker.fetch(request(path, undefined, { headers }), env)).status, 200, path);
    assert.equal(f.reads.at(-1).headers.get("Cookie"), null);
  }
});

test("beta review documents and assets require the founder on the beta host", async()=>{
  const f=fixture(),founder=await token(),tester=await token({sub:"synthetic-tester",email:"tester@example.test"});
  const env={...f.env,BETA_TESTER_EMAILS:"tester@example.test"};
  for(const path of ["/admin","/admin/","/beta-admin.html","/static/beta-admin.mjs","/static/beta-admin.css"]){
    assert.equal((await f.worker.fetch(request(path,founder,{origin:"https://beta.satinlore.com"}),env)).status,200);
    assert.equal((await f.worker.fetch(request(path,tester,{origin:"https://beta.satinlore.com"}),env)).status,403);
    assert.equal((await f.worker.fetch(request(path,founder),env)).status,403);
  }
  assert.equal((await f.worker.fetch(request('/api/admin/beta-recordings',tester,{origin:"https://beta.satinlore.com"}),env)).status,403);
});

test("a first deployment without dashboard Access settings is unavailable and the runtime pause remains fail closed", async () => {
  const config = JSON.parse(await readFile(resolve(ROOT, "wrangler.jsonc"), "utf8"));
  const f = fixture();
  const jwt = await token({ email: config.vars.FOUNDER_EMAIL });
  const initial = { ...config.vars, ASSETS: f.env.ASSETS };
  assert.equal((await f.worker.fetch(request("/", jwt), initial)).status, 503);
  assert.equal(f.reads.length, 0); assert.equal(f.keyRequests.length, 0);
  const configured = { ...initial, ACCESS_TEAM_DOMAIN: ENV.ACCESS_TEAM_DOMAIN, ACCESS_AUD: ENV.ACCESS_AUD, PRIVATE_APP_ENABLED: "true" };
  assert.equal((await f.worker.fetch(request("/api/access", jwt), configured)).status, 200);
  assert.equal((await f.worker.fetch(request("/", jwt), { ...configured, PRIVATE_APP_ENABLED: "false" })).status, 503);
  for (const key of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "PRIVATE_APP_ENABLED"]) {
    const missing = { ...configured }; delete missing[key];
    assert.equal((await f.worker.fetch(request("/", jwt), missing)).status, 503, `missing runtime ${key}`);
  }
  assert.equal(f.reads.length, 0);
});

function feedbackFixture() {
  const f = fixture(), names = [], forwarded = [];
  f.env.PRIVATE_FEEDBACK = {
    idFromName(name) { names.push(name); return name; },
    get(id) { return { async fetch(input) {
      const path = new URL(input.url).pathname;
      forwarded.push({ id, request: input, body: ["POST", "PATCH"].includes(input.method) ? await input.json() : null });
      if (path === "/internal/legacy-retry") return Response.json({ found: false }, { status: 404 });
      if (input.method === "GET") return Response.json({ feedback: [] });
      return Response.json({ ok: true });
    } }; },
  };
  return { ...f, names, forwarded };
}
const validFeedback = { idempotencyKey: "6d8cfa2b-8b90-4ea0-a98e-4137bc3f4620", category: "bug", message: "Synthetic control check." };
const feedbackPost = body => ({ method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("private feedback requires signed identity and the exact writing origin before touching storage", async () => {
  const f = feedbackFixture(), jwt = await token();
  for (const path of ["/api/feedback", "/api/my-data", "/api/my-data/delete"]) {
    assert.equal((await f.worker.fetch(request(path), f.env)).status, 403);
  }
  assert.equal((await f.worker.fetch(request("/api/feedback", await token({ email: "another@example.test" }), feedbackPost(validFeedback)), f.env)).status, 403);
  for (const headers of [
    { Origin: "https://attacker.example.test", "Content-Type": "application/json" },
    { "Content-Type": "application/json" },
    { Origin: ORIGIN, "Content-Type": "application/json", "Sec-Fetch-Site": "same-site" },
  ]) assert.equal((await f.worker.fetch(request("/api/feedback", jwt, { ...feedbackPost(validFeedback), headers }), f.env)).status, 403);
  assert.equal(f.names.length, 0); assert.equal(f.forwarded.length, 0);
});

test("feedback storage is selected only from verified identity and never receives identity headers or query values", async () => {
  const f = feedbackFixture(), jwt = await token();
  const response = await f.worker.fetch(request("/api/feedback?user=untrusted", jwt, feedbackPost(validFeedback)), f.env);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(f.forwarded[1].body, { ...validFeedback, rating: null });
  assert.equal(f.forwarded[1].id, FEEDBACK_INBOX_NAME);
  const firstName = f.forwarded[1].request.headers.get("X-Feedback-Owner"); assert.match(firstName, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(firstName, /synthetic|founder/);
  await f.worker.fetch(request("/api/my-data?email=untrusted", jwt, { headers: { Cookie: "private=synthetic", "X-Feedback-Owner": "b".repeat(64) } }), f.env);
  const forwarded = f.forwarded[2].request;
  assert.equal(forwarded.url, "https://feedback.internal/internal/inbox/feedback");
  assert.equal(forwarded.headers.get("X-Feedback-Owner"), firstName);
  assert.equal(forwarded.headers.get("Cookie"), null); assert.equal(forwarded.headers.get("Cf-Access-Jwt-Assertion"), null);
  assert.equal(f.forwarded[3].id, firstName);
  await f.worker.fetch(request("/api/my-data", await token({ sub: "other-synthetic-subject" })), f.env);
  assert.notEqual(f.forwarded[4].request.headers.get("X-Feedback-Owner"), firstName);
  const access = await (await f.worker.fetch(request("/api/access", jwt), f.env)).json();
  assert.deepEqual(Object.keys(access).sort(), ["authenticated", "expiresAt"]);
  assert.equal(access.authenticated, true); assert.equal(Number.isSafeInteger(access.expiresAt), true);
});

test("feedback rejects identity fields, excess bodies and unconfirmed deletion before forwarding a mutation", async () => {
  const f = feedbackFixture(), jwt = await token();
  for (const body of [{ ...validFeedback, email: ENV.FOUNDER_EMAIL }, { ...validFeedback, story: "Synthetic text" }, { ...validFeedback, userId: "untrusted" }]) {
    assert.equal((await f.worker.fetch(request("/api/feedback", jwt, feedbackPost(body)), f.env)).status, 400);
  }
  assert.equal((await f.worker.fetch(request("/api/feedback", jwt, feedbackPost({ ...validFeedback, message: "x".repeat(5000) })), f.env)).status, 413);
  for (const body of [{}, { confirm: false }, { confirm: true, userId: "untrusted" }]) {
    assert.equal((await f.worker.fetch(request("/api/my-data/delete", jwt, feedbackPost(body)), f.env)).status, 400);
  }
  assert.equal(f.forwarded.length, 0);
  assert.equal((await f.worker.fetch(request("/api/my-data/delete", jwt, feedbackPost({ confirm: true })), f.env)).status, 200);
  assert.deepEqual(f.forwarded[0].body, { confirm: true });
  assert.equal(f.forwarded[0].id, FEEDBACK_INBOX_NAME);
  assert.deepEqual(f.forwarded[1].body, { confirm: true });
});

test("feedback review assets and API require the signed founder at the beta host", async () => {
  const f = feedbackFixture();
  const origin = "https://beta.satinlore.com";
  const founder = await token();
  const testerEmail = "synthetic-tester@example.test";
  const tester = await token({ email: testerEmail, sub: "synthetic-tester" });
  f.env.BETA_TESTER_EMAILS = testerEmail;
  const paths = ["/feedback-admin", "/feedback-admin/index.html", "/feedback-admin/review.mjs", "/feedback-admin/api"];
  for (const path of paths) {
    assert.equal((await f.worker.fetch(request(path, undefined, { origin }), f.env)).status, 403);
    assert.equal((await f.worker.fetch(request(path, tester, { origin }), f.env)).status, 403);
    assert.equal((await f.worker.fetch(request(path, founder), f.env)).status, 403);
  }
  assert.equal(f.forwarded.length, 0);
  assert.equal(f.reads.length, 0);
  for (const path of paths) assert.equal((await f.worker.fetch(request(path, founder, { origin }), f.env)).status, 200, path);
  const update = { id: validFeedback.idempotencyKey, status: "reviewing" };
  const patch = (body, suppliedOrigin = origin) => ({
    origin, method: "PATCH", headers: { Origin: suppliedOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await f.worker.fetch(request("/feedback-admin/api", founder, patch(update, ORIGIN)), f.env)).status, 403);
  assert.equal((await f.worker.fetch(request("/feedback-admin/api", founder, patch({ ...update, owner: "untrusted" })), f.env)).status, 400);
  assert.equal((await f.worker.fetch(request("/feedback-admin/api", founder, patch(update)), f.env)).status, 200);
  assert.deepEqual(f.forwarded.map(entry => [entry.id, entry.body]), [[FEEDBACK_INBOX_NAME, null], [FEEDBACK_INBOX_NAME, update]]);
});

test("feedback outages and wrong methods return truthful errors without private exceptions", async () => {
  const f = fixture(), jwt = await token();
  assert.equal((await f.worker.fetch(request("/api/feedback", jwt), f.env)).status, 503);
  const service = feedbackFixture();
  service.env.PRIVATE_FEEDBACK.get = () => ({ fetch() { throw new Error("synthetic-private-failure"); } });
  const response = await service.worker.fetch(request("/api/my-data", jwt), service.env);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /synthetic-private-failure/);
  for (const path of ["/api/feedback", "/api/my-data", "/api/my-data/delete"]) {
    assert.equal((await service.worker.fetch(request(path, jwt, { method: "DELETE" }), service.env)).status, 405);
  }
});
