import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createBetaPreviewWorker } from "../deploy/cloudflare/beta-preview.mjs";
import { STRIPE_API_VERSION } from "../deploy/cloudflare/stripe-billing.mjs";

const ORIGIN = "https://app.satinlore.com";
const TOKEN = "3".repeat(64);
const ACCESS_ISSUER = "preview-fixture.cloudflareaccess.com";
const BETA_AUD = "b".repeat(64);
const PRODUCTION_AUD = "a".repeat(64);
const FOUNDER = "founder@example.test";
const TESTER = "tester@example.test";
const WEBHOOK = "/beta/api/billing/stripe/webhook";
const WEBHOOK_SECRET = "whsec_syntheticBetaSigningFixture";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const keyResolver = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "preview-test" }] });

function assertion(email, audience = BETA_AUD) {
  return new SignJWT({ type: "app", email }).setProtectedHeader({ alg: "RS256", kid: "preview-test" })
    .setIssuer(`https://${ACCESS_ISSUER}`).setAudience(audience).setSubject(email).setIssuedAt().setExpirationTime("10m").sign(privateKey);
}

function fixture(overrides) {
  const reads = [], auth = [];
  const namespace = {
    idFromName: name => name,
    get: () => ({ async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = await request.json();
      auth.push({ path, body });
      if (path === "/session" && body.tokenHash === createHash("sha256").update(TOKEN).digest("hex")) {
        return Response.json({ subject: `email-v1:${"4".repeat(64)}`, expiresAt: Date.now() + 60_000 });
      }
      return new Response(null, { status: 404 });
    } }),
  };
  const env = {
    PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true", PUBLIC_READER_ENABLED: "true",
    ACCESS_TEAM_DOMAIN: ACCESS_ISSUER, ACCESS_AUD: PRODUCTION_AUD, APP_BETA_ACCESS_AUD: BETA_AUD,
    FOUNDER_EMAIL: FOUNDER, BETA_TESTER_EMAILS: TESTER, LAUNCH_BILLING_ADMIN_ENABLED: "true",
    LAUNCH_BILLING_POSTBACK_ENABLED: "true", LAUNCH_AI_COST_METERING_ENABLED: "true",
    PUBLIC_READER_OTP_KEY: "5".repeat(64), PUBLIC_READER_AUTH: namespace, READER_ACCOUNTS: namespace,
    AUTH_SES_REGION: "us-east-1", AUTH_SES_FROM_EMAIL: "mail@example.test",
    AUTH_SES_ACCESS_KEY_ID: "A".repeat(20), AUTH_SES_SECRET_ACCESS_KEY: "A".repeat(40),
    STRIPE_SECRET_KEY: "sk_test_previewFixtureDemo", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, COMMERCE: namespace,
    ASSETS: { async fetch(request) {
      reads.push(request);
      const path = new URL(request.url).pathname;
      const body = path === "/signup.html" ? await readFile(new URL("../app/static/signup.html", import.meta.url), "utf8") :
        path.endsWith(".html") ? '<!doctype html><head><script src="/static/app.mjs"></script></head>' : "// synthetic asset";
      return new Response(body, { headers: { "Set-Cookie": `__Host-satinlore-reader=${TOKEN}; Path=/; Secure; HttpOnly` } });
    } },
    ...overrides,
  };
  const worker = createBetaPreviewWorker({ keyResolver });
  return {
    auth, reads,
    request(path, { token, headers, ...init } = {}) {
      const requestHeaders = new Headers(headers);
      if (token) requestHeaders.set("Cf-Access-Jwt-Assertion", token);
      return worker.fetch(new Request(new URL(path, ORIGIN), { ...init, headers: requestHeaders }), env);
    },
  };
}

test("the beta Worker only routes its namespace and requires the exact dedicated Access audience and tester identity", async () => {
  const { request, reads } = fixture();
  const tester = await assertion(TESTER);
  for (const path of ["/", "/alpha", "/beta-preview/", "/beta/alpha", "/beta/admin", "/beta/api/billing/verotel/postback",
    "/beta/api/billing/stripe/webhook/other", "https://beta.satinlore.com/beta/", "https://preview.example.workers.dev/beta/"]) {
    assert.equal((await request(path, { token: tester })).status, 404, path);
  }
  for (const token of [undefined, await assertion(TESTER, PRODUCTION_AUD), await assertion(TESTER, [BETA_AUD, PRODUCTION_AUD]),
    await assertion("unlisted@example.test")]) {
    assert.equal((await request("/beta/", { token })).status, 403);
  }
  assert.equal(reads.length, 0);
  assert.equal((await fixture({ APP_BETA_ACCESS_AUD: PRODUCTION_AUD }).request("/beta/", { token: tester })).status, 503);
  const redirect = await request("/beta", { token: tester });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("Location"), "/beta/");
  const anonymousAuth = await fixture({ PUBLIC_READER_ENABLED: "false" }).request("/beta/", { token: tester });
  assert.equal(anonymousAuth.status, 503);
});

test("beta signup serves a standalone page inside Access and stays out of caches and indexes", async () => {
  const tester = await assertion(TESTER);
  const { request, reads } = fixture();
  const url = "/beta/signup?ref=writer&next=billing";
  assert.equal((await request(url)).status, 403);
  const page = await request(url, {
    token: tester, headers: { Cookie: `__Host-satinlore-reader=${TOKEN}` },
  });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Location"), null);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.equal(page.headers.get("Set-Cookie"), null);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, `${ORIGIN}/signup.html`);
  assert.equal(reads[0].headers.get("Cf-Access-Jwt-Assertion"), null);
  assert.equal(reads[0].headers.get("Cookie"), null);
  const html = await page.text();
  assert.match(html, /name="satinlore-base-path" content="\/beta"/);
  assert.match(html, /src="\/beta\/static\/signup\.mjs"/);
  assert.match(html, /href="\/beta\/static\/signup\.css"/);
  assert.match(html, /id="public-register-form"/);
  assert.doesNotMatch(html, /static\/app\.mjs|workspace-header|draft-story/);
  assert.equal((await request("/beta/static/signup.mjs", { token: tester })).status, 200);
  assert.equal((await request("/beta/static/signup.mjs")).status, 403);
  const legacy = await request("/beta/?signin=1&mode=register&ref=writer", { token: tester });
  assert.equal(legacy.status, 303);
  assert.equal(legacy.headers.get("Location"), "/beta/signup?ref=WRITER&next=billing");
  const head = await request("/beta/signup", { method: "HEAD", token: tester });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
});

test("production or duplicated browser cookies cannot authenticate a beta reader, and sign-out clears only beta", async () => {
  const { request, auth } = fixture();
  const token = await assertion(TESTER);
  const productionCookie = `__Host-satinlore-reader=${TOKEN}`;
  const betaCookie = `__Secure-satinlore-beta-reader=${TOKEN}`;
  for (const Cookie of [productionCookie, `${betaCookie}; ${betaCookie}`]) {
    assert.deepEqual(await (await request("/beta/api/access", { token, headers: { Cookie } })).json(), {
      authenticated: false, expiresAt: null,
    });
  }
  assert.equal(auth.length, 0);
  const probe = await request("/beta/api/access", { token, headers: { Cookie: `${productionCookie}; ${betaCookie}` } });
  assert.equal((await probe.json()).authenticated, true);
  assert.deepEqual(auth.map(call => call.path), ["/session"]);
  const logoutHeaders = { "Content-Type": "application/json", Origin: ORIGIN, Cookie: productionCookie };
  const wrongOrigin = await request("/beta/api/auth/logout", { token, method: "POST", body: "{}",
    headers: { ...logoutHeaders, Origin: "https://beta.satinlore.com" } });
  assert.equal(wrongOrigin.status, 403);
  const logout = await request("/beta/api/auth/logout", { token, method: "POST", body: "{}", headers: logoutHeaders });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get("Set-Cookie"), "__Secure-satinlore-beta-reader=; Path=/beta; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
  assert.equal(auth.length, 1);
});

test("only beta founders see billing admin, while testers can still open the simulator and lab", async () => {
  const { request, reads } = fixture();
  const tester = await assertion(TESTER);
  const founder = await assertion(FOUNDER);
  for (const path of ["/beta/billing-admin", "/beta/billing-admin/app.mjs", "/beta/api/billing-admin"]) {
    assert.equal((await request(path, { token: tester })).status, 403);
  }
  assert.equal((await request("/beta/billing-admin", { token: founder })).status, 200);
  const simulator = await request("/beta/simulator", { token: tester });
  assert.equal(simulator.status, 200);
  assert.match(await simulator.text(), /<head><meta name="satinlore-simulator-path" content="\/beta\/simulator"><script src="\/beta\/simulator\/static\/app\.mjs"/u);
  assert.equal((await request("/beta/simulator-lab", { token: tester })).status, 200);
  assert.equal((await request("/beta/simulator/static/simulation.mjs", { token: tester })).status, 200);
  assert.equal((await request("/beta/static/simulation.mjs", { token: tester })).status, 404);
  assert.equal((await request("/beta/simulator/static/billing.mjs", { token: tester })).status, 404);
  const probe = await request("/beta/simulator/api/access", { token: tester });
  assert.equal((await probe.json()).authenticated, true);
  assert.deepEqual(reads.map(request => new URL(request.url).pathname), [
    "/billing-admin.html", "/index.html", "/simulation.html", "/static/simulation.mjs",
  ]);
});

function stripeRequest(livemode, { secret = WEBHOOK_SECRET } = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ object: "event", id: "evt_preview", type: "charge.pending", livemode,
    created: timestamp, api_version: STRIPE_API_VERSION });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { method: "POST", body, headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` } };
}

test("only a correctly signed sandbox Stripe POST can use the exact webhook route without Access", async () => {
  const { request } = fixture({ STRIPE_MODE: "live", LAUNCH_PAYMENT_PROVIDER: "verotel" });
  assert.equal((await request(WEBHOOK)).status, 405);
  assert.equal((await request(`${WEBHOOK}?extra=1`, stripeRequest(false))).status, 400);
  assert.equal((await request(`${WEBHOOK}/`, stripeRequest(false))).status, 404);
  assert.equal((await request("/beta/api/billing/checkout", stripeRequest(false))).status, 403);
  assert.equal((await request(WEBHOOK, stripeRequest(false, { secret: "synthetic-wrong-key" }))).status, 400);
  assert.equal((await request(WEBHOOK, stripeRequest(true))).status, 400);
  const accepted = await request(WEBHOOK, stripeRequest(false));
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get("Cache-Control"), "no-store");
  assert.equal(accepted.headers.get("Set-Cookie"), null);
  assert.equal((await fixture({ STRIPE_SECRET_KEY: "sk_live_previewFixtureDemo" }).request(WEBHOOK, stripeRequest(false))).status, 503);
});

test("beta deployment owns its routes and SQLite bindings independently of the launch Worker", async () => {
  const load = name => readFile(new URL(`../${name}`, import.meta.url), "utf8").then(JSON.parse);
  const [beta, launch] = await Promise.all([load("wrangler.beta.jsonc"), load("wrangler.jsonc")]);
  assert.notEqual(beta.name, launch.name);
  assert.equal(beta.workers_dev, false);
  assert.equal(beta.preview_urls, false);
  assert.equal(beta.assets.run_worker_first, true);
  assert.equal(beta.vars.STRIPE_MODE, "test");
  assert.deepEqual(beta.routes, [
    { pattern: `${ORIGIN}/beta`, zone_name: "satinlore.com" }, { pattern: `${ORIGIN}/beta/*`, zone_name: "satinlore.com" },
  ]);
  const classes = beta.durable_objects.bindings.map(binding => {
    assert.deepEqual(Object.keys(binding).sort(), ["class_name", "name"]);
    return binding.class_name;
  });
  assert.deepEqual(beta.migrations[0].new_sqlite_classes, classes);
  assert.ok(!classes.includes("BetaRecordings") && !classes.includes("AlphaStudy"));
});
