import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { BILLING_ADMIN_API, BILLING_API, BILLING_POSTBACK, flexPaySignature } from "../deploy/cloudflare/launch-billing.mjs";
import { LAUNCH_USAGE_PATH } from "../deploy/cloudflare/launch-usage.mjs";
import { createPrivateAppWorker, LaunchUsage, PublicReaderAuth, ReaderAccount, SatinLoreCommerce } from "../deploy/cloudflare/worker.mjs";

const origin = "https://app.satinlore.com";
const beta = "https://beta.satinlore.com";
const fakeHost = "https://satinlore-test.workers.dev";
const plan = { id: "test-pack", name: "Test token pack", currency: "USD", amountMinor: 1000, credits: 2000 };
const settings = {
  PRIVATE_APP_ENABLED: "true",
  PUBLIC_APP_ORIGIN: origin,
  PUBLIC_READER_ENABLED: "true",
  PUBLIC_READER_OTP_KEY: "1c".repeat(32),
  AUTH_SES_ACCESS_KEY_ID: "A".repeat(20),
  AUTH_SES_SECRET_ACCESS_KEY: "B".repeat(40),
  AUTH_SES_REGION: "eu-north-1",
  AUTH_SES_FROM_EMAIL: "team@example.test",
  ACCESS_TEAM_DOMAIN: "test-billing.cloudflareaccess.com",
  ACCESS_AUD: "1".repeat(64),
  FOUNDER_EMAIL: "founder@example.test",
  BETA_TESTER_EMAILS: "tester@example.test",
  LAUNCH_AI_USAGE_ENABLED: "true",
  LAUNCH_AI_MONTHLY_TOKEN_CAP: "10000",
  LAUNCH_AI_TRIAL_TOKENS: "100",
  LAUNCH_BILLING_ENABLED: "true",
  LAUNCH_BILLING_POSTBACK_ENABLED: "true",
  LAUNCH_BILLING_ADMIN_ENABLED: "true",
  LAUNCH_PLAN_CATALOG: JSON.stringify([plan]),
  VEROTEL_SHOP_ID: "97347",
  VEROTEL_SIGNATURE_KEY: "fictional-verotel-unit-test-key",
  OPENAI_API_KEY: "sk-proj-fixture-openai-key",
};
const digest = value => createHash("sha256").update(value).digest("hex");
const { privateKey, publicKey } = await generateKeyPair("RS256");
const keyResolver = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "billing-fixture", alg: "RS256" }] });

async function accessAssertion(email) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ type: "app", email }).setIssuer(`https://${settings.ACCESS_TEAM_DOMAIN}`)
    .setAudience(settings.ACCESS_AUD).setSubject(email).setIssuedAt(now).setExpirationTime(now + 600)
    .setProtectedHeader({ alg: "RS256", kid: "billing-fixture" }).sign(privateKey);
}

function sqliteNamespace(t, DurableClass) {
  const objects = new Map();
  const get = id => {
    if (objects.has(id)) return objects.get(id);
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    let alarm = null;
    const storage = {
      sql: { exec(query, ...bindings) {
        const statement = db.prepare(query);
        if (!statement.columns().length) {
          statement.run(...bindings);
          return { toArray: () => [] };
        }
        return { toArray: () => statement.all(...bindings), one: () => statement.get(...bindings) };
      } },
      transactionSync(callback) {
        db.exec("BEGIN");
        try {
          const result = callback();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      getAlarm: async () => alarm,
      setAlarm: async value => { alarm = value; },
    };
    const instance = new DurableClass({ storage });
    const entry = { db, fetch: request => instance.fetch(request) };
    objects.set(id, entry);
    return entry;
  };
  return { idFromName: id => id, get };
}

function fixture(t) {
  const auth = sqliteNamespace(t, PublicReaderAuth);
  const db = auth.get("public-reader-auth:v1").db;
  function addSession(label, expiresAt = Date.now() + 60_000) {
    const token = digest(`cookie:${label}`);
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(digest(token), `email-v1:${digest(`subject:${label}`)}`, expiresAt);
    return `__Host-satinlore-reader=${token}`;
  }
  const owner = addSession(settings.FOUNDER_EMAIL);
  const other = addSession("other@example.test");
  const expired = addSession("expired@example.test", Date.now() - 1000);
  const env = {
    ...settings,
    PUBLIC_READER_AUTH: auth,
    READER_ACCOUNTS: sqliteNamespace(t, ReaderAccount),
    COMMERCE: sqliteNamespace(t, SatinLoreCommerce),
    LAUNCH_USAGE: sqliteNamespace(t, LaunchUsage),
    SCENE_ANALYSIS_BUDGET: {idFromName() { assert.fail("The billing fixture does not consume AI quota."); }, get() {}},
    ASSETS: { async fetch(request) {
      assert.equal(request.headers.get("Cookie"), null);
      assert.equal(request.headers.get("Cf-Access-Jwt-Assertion"), null);
      return new Response(new URL(request.url).pathname);
    } },
  };
  const worker = createPrivateAppWorker({ keyResolver,
    emailFetcher: () => assert.fail("The fixture does not send email."),
    analysisFetcher: () => assert.fail("The fixture does not call the analysis provider."),
  });
  function request(path, { body, cookie, host = origin, source = origin, assertion, headers = {}, flags = {} } = {}) {
    return worker.fetch(new Request(host + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { Origin: source, "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(assertion ? { "Cf-Access-Jwt-Assertion": assertion } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { ...env, ...flags });
  }
  return { request, owner, other, expired };
}

async function json(response, status = 200) {
  const result = await response;
  const body = await result.json();
  assert.equal(result.status, status, JSON.stringify(body));
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  return body;
}

function quoteForm(extra = {}) {
  return { planId: plan.id, ...extra };
}

function checkoutForm(extra = {}) {
  return { ...quoteForm(), idempotencyKey: randomUUID(), expectedAmountMinor: plan.amountMinor,
    expectedCurrency: plan.currency, expectedCredits: plan.credits, ...extra };
}

function independentSignature(params) {
  const fields = Object.keys(params).sort().filter(key => params[key] !== "").map(key => `${key}=${params[key]}`);
  return digest([settings.VEROTEL_SIGNATURE_KEY, ...fields].join(":"));
}

function postback(params, signature = independentSignature(params)) {
  return `${BILLING_POSTBACK}?${new URLSearchParams({ ...params, signature })}`;
}

test("FlexPay 4 checkout signature matches Verotel's published example", async () => {
  // Public test vector: https://controlcenter.verotel.com/flexpay-doc/purchase.html#signature-calculation
  assert.equal(await flexPaySignature("BddJxtUBkDgFB9kj7Zwguxde4gAqha", {
    version: "4", type: "purchase", shopID: "64233", priceCurrency: "USD", priceAmount: "9.99",
    description: "Super video download", custom1: "xxyyzz", custom2: "",
  }), "ccaf2357fe330654322a1b0f3f92984b3fe2a1462d6fc5082650a00c5ada2f2a");
});

test("billing requires the configured app host, launch flags and an unexpired reader session", async t => {
  const { request, owner, expired } = fixture(t);
  const assertion = await accessAssertion(settings.FOUNDER_EMAIL);
  const plans = `${BILLING_API}/plans`;
  for (const [path, body] of [[plans], [`${BILLING_API}/quote`, quoteForm()], [`${BILLING_API}/checkout`, checkoutForm()],
    [`${BILLING_API}/order?id=${randomUUID()}`]]) {
    for (const cookie of [undefined, expired, `${owner}; ${owner}`]) await json(request(path, { body, cookie }), 401);
    await json(request(path, { body, assertion }), 401);
  }
  assert.deepEqual((await json(request(plans, { cookie: owner }))).plans, [plan]);
  for (const flag of ["LAUNCH_BILLING_ENABLED", "LAUNCH_BILLING_POSTBACK_ENABLED", "LAUNCH_AI_USAGE_ENABLED"]) {
    await json(request(plans, { cookie: owner, flags: { [flag]: "false" } }), 503);
  }
  await json(request(plans, { assertion, host: beta }), 404);
  await json(request(plans, { assertion, host: fakeHost }), 403);
  assert.equal((await request("/billing", { host: beta, assertion })).status, 404);
  assert.equal((await request("/billing.html", { cookie: owner, flags: {
    LAUNCH_BILLING_ENABLED: "false", LAUNCH_AI_USAGE_ENABLED: "false",
  } })).status, 404);
  assert.equal((await request(BILLING_POSTBACK, { host: beta })).status, 404);
  assert.equal((await request(BILLING_POSTBACK, { flags: { LAUNCH_BILLING_POSTBACK_ENABLED: "false" } })).status, 404);
});

test("only founder Access can manage a promotion and checkout rechecks an owner’s quote", async t => {
  const { request, owner, other } = fixture(t);
  const assertion = await accessAssertion(settings.FOUNDER_EMAIL);
  const tester = await accessAssertion(settings.BETA_TESTER_EMAILS);
  const promotionPath = `${BILLING_ADMIN_API}/promotion`;
  const checkoutPath = `${BILLING_API}/checkout`;
  const quotePath = `${BILLING_API}/quote`;
  const now = Date.now();
  const promotion = { code: "FIXTURE", discountBps: 2500, enabled: true, maxRedemptions: 1,
    validFrom: now - 1000, validUntil: now + 60_000, planId: plan.id };
  await json(request(BILLING_ADMIN_API, { cookie: owner }), 403);
  await json(request(BILLING_ADMIN_API, { assertion: tester }), 403);
  await json(request(BILLING_ADMIN_API, { assertion, host: beta }), 404);
  await json(request(BILLING_ADMIN_API, { assertion, flags: { LAUNCH_BILLING_ADMIN_ENABLED: "false" } }), 404);
  assert.equal((await request("/billing-admin", { cookie: owner })).status, 403);
  assert.equal(await (await request("/billing-admin", { assertion })).text(), "/billing-admin.html");
  await json(request(promotionPath, { cookie: owner, body: promotion }), 403);
  await json(request(promotionPath, { assertion, source: beta, body: promotion }), 403);
  await json(request(promotionPath, { assertion, body: promotion }));

  const params = { promo: " fixture " };
  await json(request(quotePath, { cookie: owner, body: quoteForm(params), headers: { "Sec-Fetch-Site": "same-site" } }), 403);
  await json(request(quotePath, { cookie: owner, body: quoteForm({ ...params, expectedAmountMinor: 1 }) }), 400);
  const { quote } = await json(request(quotePath, { cookie: owner, body: quoteForm(params) }));
  assert.equal(quote.amountMinor, 750);
  assert.equal((await json(request(BILLING_ADMIN_API, { assertion }))).promotions[0].claimed, 0);
  const orderForm = checkoutForm({ ...params, expectedAmountMinor: quote.amountMinor });
  await json(request(promotionPath, { assertion, body: { ...promotion, discountBps: 1000 } }));
  await json(request(checkoutPath, { cookie: owner, body: orderForm }), 409);
  assert.equal((await json(request(BILLING_ADMIN_API, { assertion }))).promotions[0].claimed, 0);

  orderForm.expectedAmountMinor = 900;
  const placed = await json(request(checkoutPath, { cookie: owner, body: orderForm }));
  assert.equal(placed.checkout.status, "pending");
  const seller = new URL(placed.checkoutUrl);
  assert.equal(`${seller.origin}${seller.pathname}`, "https://secure.verotel.com/startorder");
  const { signature, ...signed } = Object.fromEntries(seller.searchParams);
  assert.deepEqual(signed, {
    description: plan.name, priceAmount: "9.00", priceCurrency: "USD", referenceID: placed.checkout.id,
    shopID: settings.VEROTEL_SHOP_ID, type: "purchase", version: "4",
    successURL: `${origin}/billing?order=${placed.checkout.id}`, declineURL: `${origin}/billing?cancelled=1`,
  });
  assert.equal(signature, independentSignature(signed));
  assert.deepEqual(await json(request(checkoutPath, { cookie: owner, body: orderForm })), placed);
  const statusPath = `${BILLING_API}/order?id=${placed.checkout.id}`;
  assert.deepEqual((await json(request(statusPath, { cookie: owner }))).checkout, placed.checkout);
  await json(request(statusPath, { cookie: other }), 404);
  await json(request(`${statusPath}&id=${placed.checkout.id}`, { cookie: owner }), 400);
});

test("only the correct signed Verotel postback credits the owner, with duplicate and refund reconciliation", async t => {
  const { request, owner, other } = fixture(t);
  const createOrder = async cookie => (await json(request(`${BILLING_API}/checkout`, { cookie, body: checkoutForm() }))).checkout;
  const [first, second] = await Promise.all([createOrder(owner), createOrder(other)]);
  const status = async ({ id }, cookie = owner) => (await json(request(`${BILLING_API}/order?id=${id}`, { cookie }))).checkout;
  const purchased = async cookie => (await json(request(LAUNCH_USAGE_PATH, { cookie }))).credits.purchased;
  const returned = { shopID: settings.VEROTEL_SHOP_ID, type: "purchase", referenceID: first.id, saleID: "12345",
    priceAmount: "10.00", priceCurrency: "USD", paymentMethod: "CC" };
  const sale = { ...returned, transactionID: "23456" };
  assert.equal((await request(postback(returned))).status, 400);
  assert.equal((await request(postback(sale, "0".repeat(64)))).status, 400);
  assert.equal((await request(postback({ ...sale, shopID: "9911" }))).status, 400);
  assert.equal((await request(postback({ ...sale, priceCurrency: "GBP" }))).status, 409);
  assert.equal((await request(postback({ ...sale, priceAmount: "9.99" }))).status, 409);
  assert.equal((await request(`${postback(sale)}&referenceID=${second.id}`)).status, 400);
  assert.equal((await status(first)).status, "pending");
  assert.equal(await purchased(owner), 0);

  // Existing orders still reconcile while the sales UI is paused.
  const paid = await request(postback(sale), { flags: { LAUNCH_BILLING_ENABLED: "false" } });
  assert.equal(paid.status, 200);
  assert.match(paid.headers.get("Content-Type"), /^text\/plain\b/);
  assert.equal(await paid.text(), "OK");
  const duplicate = await request(postback(sale));
  assert.equal(duplicate.status, 200);
  assert.equal(await duplicate.text(), "OK");
  assert.equal((await status(first)).grantedCredits, plan.credits);
  assert.equal(await purchased(owner), plan.credits);
  assert.equal((await request(postback({ ...sale, referenceID: second.id }))).status, 409);
  assert.equal((await status(second, other)).status, "pending");
  assert.equal(await purchased(other), 0);

  const credit = { ...sale, event: "credit", transactionID: "34567", parentID: sale.transactionID };
  assert.equal((await request(postback({ ...credit, parentID: "99991" }))).status, 409);
  assert.equal(await purchased(owner), plan.credits);
  for (const params of [credit, credit, sale]) {
    const result = await request(postback(params));
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "OK");
  }
  const reversed = await status(first);
  assert.equal(reversed.status, "refunded");
  assert.equal(reversed.refundedMinor, plan.amountMinor);
  assert.equal(reversed.grantedCredits, 0);
  assert.equal(await purchased(owner), 0);
});
