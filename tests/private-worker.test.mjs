import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createPrivateAppWorker, privateAppConfiguration } from "../deploy/cloudflare/worker.mjs";
import { PRIVATE_ASSET_PATHS } from "../deploy/cloudflare/assets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://app.satinlore.com";
const ENV = {
  PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true",
  ACCESS_TEAM_DOMAIN: "synthetic-team.cloudflareaccess.com",
  ACCESS_AUD: "a".repeat(64), FOUNDER_EMAIL: "founder@example.test",
};
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
    return new Response("Synthetic reader asset", { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" } });
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
  for (const path of ["/", ...PRIVATE_ASSET_PATHS]) {
    const result = await f.worker.fetch(request(path), f.env);
    assert.equal(result.status, 403, path);
    assert.deepEqual(await result.json(), { error: "Founder access required." });
  }
  assert.equal(f.reads.length, 0); assert.equal(f.keyRequests.length, 0);
  const result = await f.worker.fetch(request("/", await token()), { ...f.env, ACCESS_AUD: "" });
  assert.equal(result.status, 503); assert.equal(f.reads.length, 0); assert.equal(f.keyRequests.length, 0);
});

test("valid founder assertions grant only read-only allowlisted files and strip input metadata from asset fetch", async () => {
  const f = fixture(), jwt = await token();
  for (const path of ["/", ...PRIVATE_ASSET_PATHS]) {
    const response = await f.worker.fetch(request(path, jwt), f.env);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self'/);
    assert.match(response.headers.get("Content-Security-Policy"), /frame-src 'none'/);
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

test("a valid assertion cannot enable alternate hostnames, hardware, invitation or private-file routes", async () => {
  const f = fixture(), jwt = await token();
  for (const origin of ["https://satinlore-private-app.synthetic.workers.dev", "https://version.example.workers.dev", "https://www.app.satinlore.com", "https://satinlore.com", "http://app.satinlore.com", "https://app.satinlore.com:8443"]) {
    assert.equal((await f.worker.fetch(request("/", jwt, { origin }), f.env)).status, 403, origin);
  }
  for (const path of ["/device-check", "/device-bridge", "/static/device-check.html", "/static/device-check.mjs", "/static/device-bridge.mjs", "/static/devices/lovense.mjs", "/api/me", "/api/invites/redeem", "/api/lovense/session", "/api/logout", "/.env", "/data/satinlore.sqlite3", "/AGENTS.md", "/static/AGENTS.md", "/static/playback/README.md", "/unknown", "/static%2fapp.mjs"]) {
    assert.equal((await f.worker.fetch(request(path, jwt), f.env)).status, 404, path);
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const response = await f.worker.fetch(request("/api/access", jwt, { method }), f.env);
    assert.equal(response.status, 405); assert.equal(response.headers.get("Allow"), "GET, HEAD");
  }
  assert.equal(f.reads.length, 0);
});

test("the authenticated access probe exposes only expiry in milliseconds; health never claims a complete beta", async () => {
  const f = fixture(), exp = Math.floor(Date.now() / 1000) + 120, jwt = await token({ exp });
  const response = await f.worker.fetch(request("/api/access", jwt), f.env);
  assert.deepEqual(await response.json(), { authenticated: true, expiresAt: exp * 1000 });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await (await f.worker.fetch(request("/api/health", jwt), f.env)).json(), { status: "ok", device_mode: "simulator", beta_ready: false });
  assert.equal(f.reads.length, 0);
  assert.equal((await f.worker.fetch(request("/api/access"), f.env)).status, 403);
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
  assert.deepEqual(config.routes, [{ pattern: "app.satinlore.com", custom_domain: true }]);
  assert.equal(config.d1_databases, undefined); assert.equal(config.r2_buckets, undefined);
  assert.equal(config.keep_vars, true);
  for (const key of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "PRIVATE_APP_ENABLED"]) assert.equal(Object.hasOwn(config.vars, key), false, `${key} must remain dashboard-owned`);
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
  assert.deepEqual((await list(output)).sort(), [...PRIVATE_ASSET_PATHS].sort());
  const hosted = await readFile(resolve(output, "index.html"), "utf8");
  assert.match(hosted, /<meta name="satinlore-hosted-access" content="true">/);
  assert.doesNotMatch(hosted, /device-check|device-bridge|lovense\.mjs/);
  assert.equal(await readFile(resolve(ROOT, "app/static/index.html"), "utf8"), localIndex);
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
