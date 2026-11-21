import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { STRIPE_API_VERSION } from "../deploy/cloudflare/stripe-billing.mjs";

const origin = "https://app.satinlore.com";
const teamDomain = "synthetic-team.cloudflareaccess.com";
const audience = "a".repeat(64);
const betaAudience = "b".repeat(64);
const founder = "founder@example.test";
const tester = "preview-reader@example.test";
const productionReader = "root-reader@example.test";
const password = "long synthetic reader password";
const stripeSecret = "sk_test_123456FixtureBeta";
const webhookSecret = "whsec_123456FixtureBeta";
const modelSecret = "sk-proj-synthetic_beta_credential_for_tests";
const stripeCheckoutUrl = "https://checkout.stripe.com/c/pay/cs_test_Subscription#fixture";
const cues = [{ id: 2, phase: "peak", rhythm: "dynamic", previous: "sustain", next: "recover", movementCount: 2, shape: "accented" }];
const labels = [{ id: 2, label: "accents" }];

async function readJson(response, status = 200) {
  const result = await response;
  const body = await result.json();
  assert.equal(result.status, status, JSON.stringify(body));
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  return body;
}

test("mounted beta isolates password accounts and supports a sandbox subscription and metered AI", { timeout: 30_000 }, async t => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = { ...await exportJWK(publicKey), kid: "synthetic-key", alg: "RS256" };
  const compiled = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    sourcefile: "beta-preview-journey-fixture.mjs", contents: `
      import { createLocalJWKSet } from "jose";
      import { createBetaPreviewWorker } from "./deploy/cloudflare/beta-preview.mjs";
      import { createPrivateAppWorker } from "./deploy/cloudflare/worker.mjs";
      export { LaunchUsage, PublicReaderAuth, ReaderAccount, SceneAnalysisBudget, SatinLoreCommerce } from "./deploy/cloudflare/worker.mjs";
      const keyResolver = createLocalJWKSet({ keys: [${JSON.stringify(key)}] });
      const beta = createBetaPreviewWorker({ keyResolver });
      const production = createPrivateAppWorker({ keyResolver });
      const ASSETS = { fetch: async request => {
        const path = new URL(request.url).pathname;
        if (!path.endsWith(".html")) return new Response("export {};", { headers: { "Content-Type": "application/javascript" } });
        const markup = path === "/signup.html"
          ? '<!doctype html><html><head><script src="/static/signup.mjs" type="module"></script></head><body>Create an account</body></html>'
          : '<!doctype html><html><head><script src="/static/app.mjs" type="module"></script></head><body><a href="/billing">Billing</a></body></html>';
        return new Response(markup, { headers: { "Content-Type": "text/html" } });
      } };
      export default { fetch(request, env, ctx) {
        return (env.JOURNEY_BETA ? beta : production).fetch(request, { ...env, ASSETS }, ctx);
      } };
    ` }, bundle: true, write: false, format: "esm", external: ["node:crypto"] });
  const settings = {
    PRIVATE_APP_ENABLED: "true", PUBLIC_APP_ORIGIN: origin, PUBLIC_READER_ENABLED: "true", PUBLIC_READER_OTP_KEY: "1a".repeat(32),
    ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience, FOUNDER_EMAIL: founder,
    AUTH_SES_ACCESS_KEY_ID: "A".repeat(20), AUTH_SES_SECRET_ACCESS_KEY: "B".repeat(40),
    AUTH_SES_REGION: "eu-north-1", AUTH_SES_FROM_EMAIL: "team@example.test",
  };
  const codes = new Map();
  const stripeCalls = [];
  const modelCalls = [];
  function fixture(bindings) {
    let outboundError;
    async function providers(request) {
      assert.equal(request.headers.get("Cookie"), null);
      assert.equal(request.headers.get("Cf-Access-Jwt-Assertion"), null);
      assert.equal(request.method, "POST");
      switch (request.url) {
        case "https://email.eu-north-1.amazonaws.com/v2/email/outbound-emails": {
          assert.match(request.headers.get("Authorization"), /^AWS4-HMAC-SHA256 /);
          const message = await request.json();
          const code = message.Content.Simple.Body.Text.Data.match(/code is (\d{6})\./)?.[1];
          assert.ok(code);
          codes.set(message.Destination.ToAddresses[0], code);
          return Response.json({ MessageId: "synthetic-email" });
        }
        case "https://api.stripe.com/v1/checkout/sessions": {
          assert.equal(bindings.JOURNEY_BETA, true);
          assert.equal(request.headers.get("Authorization"), "Bearer " + stripeSecret);
          assert.equal(request.headers.get("Stripe-Version"), STRIPE_API_VERSION);
          const form = new URLSearchParams(await request.text());
          const order = form.get("client_reference_id");
          assert.equal(form.get("mode"), "subscription");
          assert.equal(form.get("line_items[0][price_data][unit_amount]"), "999");
          assert.equal(form.get("line_items[0][price_data][recurring][interval]"), "month");
          assert.equal(form.get("subscription_data[metadata][satinlore_checkout]"), order);
          assert.equal(form.get("success_url"), `${origin}/beta/billing?order=${order}`);
          assert.equal(form.get("cancel_url"), `${origin}/beta/billing?order=${order}&cancelled=1`);
          stripeCalls.push(order);
          return Response.json({ object: "checkout.session", mode: "subscription", client_reference_id: order,
            amount_total: 999, currency: "usd", livemode: false, url: stripeCheckoutUrl });
        }
        case "https://api.openai.com/v1/responses": {
          assert.equal(bindings.JOURNEY_BETA, true);
          assert.equal(request.headers.get("Authorization"), "Bearer " + modelSecret);
          const body = await request.json();
          assert.equal(body.model, "gpt-6-luna");
          assert.equal(body.store, false);
          assert.deepEqual(JSON.parse(body.input), { cues });
          modelCalls.push(body);
          return Response.json({ status: "completed", usage: { input_tokens: 80, output_tokens: 22,
            total_tokens: 102, input_tokens_details: { cached_tokens: 30 } },
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ labels }) }] }] });
        }
        default:
          assert.fail("Unexpected outbound request: " + request.url);
      }
    }
    const mf = new Miniflare({
      modules: [{ type: "ESModule", path: "beta-preview-journey-fixture.mjs", contents: compiled.outputFiles[0].text }],
      compatibilityDate: "2026-05-22", compatibilityFlags: ["nodejs_compat"], cf: false, port: 0, inspectorPort: 0,
      bindings: { ...settings, ...bindings },
      durableObjects: {
        PUBLIC_READER_AUTH: { className: "PublicReaderAuth", useSQLite: true },
        READER_ACCOUNTS: { className: "ReaderAccount", useSQLite: true },
        SCENE_ANALYSIS_BUDGET: { className: "SceneAnalysisBudget", useSQLite: true },
        LAUNCH_USAGE: { className: "LaunchUsage", useSQLite: true },
        COMMERCE: { className: "SatinLoreCommerce", useSQLite: true },
      },
      async outboundService(request) {
        try {
          return await providers(request);
        } catch (error) {
          outboundError = error;
          throw error;
        }
      },
    });
    t.after(() => mf.dispose());
    return async (path, { assertion, cookie, body, source = origin, headers = {} } = {}) => {
      const response = await mf.dispatchFetch(origin + path, {
        method: body === undefined ? "GET" : "POST", redirect: "manual",
        headers: { ...(assertion ? { "Cf-Access-Jwt-Assertion": assertion } : {}), ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { ...(source ? { Origin: source } : {}), "Content-Type": "application/json" }),
          "CF-Connecting-IP": "192.0.2.14", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.ifError(outboundError);
      return response;
    };
  }
  const betaRequest = fixture({
    JOURNEY_BETA: true, APP_BETA_ACCESS_AUD: betaAudience, BETA_TESTER_EMAILS: tester,
    PUBLIC_READER_OTP_KEY: "2b".repeat(32), LAUNCH_PAYMENT_PROVIDER: "stripe", STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: stripeSecret, STRIPE_WEBHOOK_SECRET: webhookSecret,
    LAUNCH_BILLING_ENABLED: "true", LAUNCH_BILLING_POSTBACK_ENABLED: "true",
    LAUNCH_AI_COST_METERING_ENABLED: "true", LAUNCH_AI_APP_MONTHLY_CAP_NANO_USD: "2000000000",
    BETA_OPENAI_ENABLED: "true", BETA_OPENAI_API_KEY: modelSecret,
  });
  const productionRequest = fixture({});
  function accessToken(aud, email) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: "https://" + teamDomain, aud, sub: "synthetic-access-subject", email, type: "app", iat: now, exp: now + 600 })
      .setProtectedHeader({ alg: "RS256", kid: key.kid }).sign(privateKey);
  }
  const betaAssertion = await accessToken(betaAudience, tester);
  const productionAssertion = await accessToken(audience, founder);
  const beta = (path, options) => betaRequest(path, { assertion: betaAssertion, ...options });

  assert.equal((await betaRequest("/beta/")).status, 403);
  assert.equal((await betaRequest("/beta/", { assertion: productionAssertion })).status, 403);
  assert.equal((await beta("/api/auth/login", { body: { email: tester, password } })).status, 404);
  const mount = await beta("/beta");
  assert.ok([301, 302, 303, 307, 308].includes(mount.status));
  assert.equal(new URL(mount.headers.get("Location"), origin).pathname, "/beta/");
  const page = await beta("/beta/");
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.match(page.headers.get("X-Robots-Tag"), /noindex/);
  const html = await page.text();
  assert.match(html, /name="satinlore-base-path" content="\/beta"/);
  assert.match(html, /src="\/beta\/static\/app\.mjs"/);
  assert.match(html, /href="\/beta\/billing"/);
  assert.equal((await beta("/beta/static/app.mjs")).status, 200);
  const signup = await beta("/beta/signup?next=billing");
  assert.equal(signup.status, 200);
  assert.match(await signup.text(), /src="\/beta\/static\/signup\.mjs"/);
  assert.equal((await beta("/beta/static/signup.mjs")).status, 200);

  const stageAuth = (path, body, options) => beta("/beta/api/auth/" + path, { body, ...options });
  const liveAuth = (path, body) => productionRequest("/api/auth/" + path, { body });
  const credentials = email => ({ email, password, remember: true });
  assert.equal((await stageAuth("register", { email: tester, password, adult: true }, { source: "https://outside.example.test" })).status, 403);
  assert.equal(codes.size, 0);
  async function enroll(auth, email) {
    const { challenge } = await readJson(auth("register", { email, password, adult: true }), 202);
    assert.match(challenge, /^[a-f0-9]{64}$/);
    assert.match(codes.get(email), /^\d{6}$/);
    assert.equal((await auth("login", credentials(email))).status, 401);
    assert.deepEqual(await readJson(auth("verify", { challenge, code: codes.get(email) })), { verified: true });
    const login = await auth("login", credentials(email));
    assert.equal((await readJson(login)).authenticated, true);
    return login.headers.get("Set-Cookie");
  }
  const betaCookieHeader = await enroll(stageAuth, tester);
  assert.match(betaCookieHeader, /^__Secure-satinlore-beta-reader=[a-f0-9]{64}; Path=\/beta; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const betaCookie = betaCookieHeader.split(";")[0];
  const liveCookieHeader = await enroll(liveAuth, productionReader);
  assert.match(liveCookieHeader, /^__Host-satinlore-reader=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const liveCookie = liveCookieHeader.split(";")[0];
  const guest = { authenticated: false, expiresAt: null };
  assert.equal((await liveAuth("login", credentials(tester))).status, 401);
  assert.equal((await stageAuth("login", credentials(productionReader))).status, 401);
  assert.deepEqual(await readJson(productionRequest("/api/access", { cookie: betaCookie })), guest);
  assert.deepEqual(await readJson(beta("/beta/api/access", { cookie: liveCookie })), guest);
  assert.equal((await betaRequest("/beta/api/account", { cookie: betaCookie })).status, 403);
  assert.equal((await readJson(beta("/beta/api/account", { cookie: liveCookie + "; " + betaCookie }))).registered, true);
  assert.equal((await readJson(productionRequest("/api/account", { cookie: liveCookie }))).registered, true);

  const billing = path => "/beta/api/billing/" + path;
  const use = (path, options) => beta(path, { cookie: betaCookie, ...options });
  const usage = () => readJson(use("/beta/api/account/usage"));
  const { plans, provider } = await readJson(use(billing("plans")));
  assert.equal(provider, "stripe");
  const monthly = plans.find(plan => plan.kind === "monthly");
  assert.equal(monthly.amountMinor, 999);
  assert.equal(monthly.credits, 2_000_000_000);
  const purchase = await readJson(use(billing("checkout"), { body: { planId: monthly.id, idempotencyKey: randomUUID(),
    expectedAmountMinor: monthly.amountMinor, expectedCurrency: monthly.currency, expectedCredits: monthly.credits,
    expectedKind: monthly.kind, expectedRebillAmountMinor: monthly.rebillAmountMinor } }));
  assert.equal(purchase.checkoutUrl, stripeCheckoutUrl);
  const order = purchase.checkout.id;
  assert.deepEqual(stripeCalls, [order]);
  assert.equal((await usage()).subscription.granted, 0);

  const start = Math.floor(Date.now() / 1000);
  const metadata = { satinlore_reader: "v1", satinlore_checkout: order };
  const invoice = { id: "evt_SandboxMonth", object: "event", api_version: STRIPE_API_VERSION, livemode: false, created: start,
    type: "invoice.payment_succeeded", data: { object: { object: "invoice", id: "in_SandboxMonth", billing_reason: "subscription_create",
      status: "paid", paid: true, paid_out_of_band: false, collection_method: "charge_automatically", amount_paid: 999, currency: "usd",
      subscription: "sub_SandboxMonth", payment_intent: "pi_SandboxMonth", subscription_details: { metadata },
      lines: { has_more: false, data: [{ type: "subscription", proration: false, amount: 999, currency: "usd",
        period: { start, end: start + 30 * 86400 } }] } } } };
  const webhook = (event, signed = true) => {
    const digest = createHmac("sha256", webhookSecret).update(start + "." + JSON.stringify(event)).digest("hex");
    return betaRequest(billing("stripe/webhook"), { body: event, source: null,
      ...(signed ? { headers: { "Stripe-Signature": `t=${start},v1=${digest}` } } : {}) });
  };
  assert.equal((await webhook(invoice, false)).status, 400);
  assert.equal((await webhook({ ...invoice, livemode: true })).status, 400);
  assert.equal((await usage()).subscription.granted, 0);
  assert.equal((await webhook(invoice)).status, 204);
  assert.equal((await webhook({ ...invoice, id: "evt_SandboxMonthReplay" })).status, 204);
  const funded = await usage();
  assert.equal(funded.available, true);
  assert.equal(funded.subscription.granted, 2_000_000_000);
  assert.equal(funded.subscription.used, 0);
  const analysis = await readJson(use("/beta/api/scene-analysis", { body: { cues } }));
  assert.deepEqual(analysis.labels, labels);
  assert.equal(modelCalls.length, 1);
  const spent = await usage();
  assert.equal(spent.subscription.used, 16_300);
  assert.equal(spent.subscription.remaining, 2_000_000_000 - 16_300);
  assert.equal(spent.subscription.reserved, 0);
});
