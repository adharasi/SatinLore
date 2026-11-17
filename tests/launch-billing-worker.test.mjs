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
const plan = { id: "starter-top-up", name: "Starter Top-up", kind: "one-time", currency: "USD", amountMinor: 499, credits: 1_000_000_000 };
const monthly = { id: "monthly", name: "SatinLore Monthly", kind: "monthly", currency: "USD", amountMinor: 999,
  rebillAmountMinor: 999, credits: 2_000_000_000 };
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
  LAUNCH_AI_COST_METERING_ENABLED: "true",
  LAUNCH_AI_MONTHLY_CAP_NANO_USD: "10000000000",
  LAUNCH_AI_TRIAL_NANO_USD: "50000000",
  LAUNCH_BILLING_ENABLED: "true",
  LAUNCH_BILLING_POSTBACK_ENABLED: "true",
  LAUNCH_BILLING_ADMIN_ENABLED: "true",
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

function fixture(t, { sessionLifetime = 60_000 } = {}) {
  const auth = sqliteNamespace(t, PublicReaderAuth);
  const db = auth.get("public-reader-auth:v1").db;
  function addSession(label, expiresAt = Date.now() + sessionLifetime) {
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
  function request(path, { body, cookie, host = origin, source = origin, assertion, headers = {}, flags = {},
    method = body === undefined ? "GET" : "POST", } = {}) {
    return worker.fetch(new Request(host + path, {
      method,
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

function checkoutForm(extra = {}, selected = plan) {
  return { planId: selected.id, idempotencyKey: randomUUID(), expectedAmountMinor: selected.amountMinor,
    expectedCurrency: selected.currency, expectedCredits: selected.credits, expectedKind: selected.kind,
    ...(selected.kind === "monthly" ? { expectedRebillAmountMinor: selected.rebillAmountMinor } : {}), ...extra };
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

test("signup and login aliases carry only safe app billing intent into the reader", async t => {
  const { request } = fixture(t);
  const order = randomUUID();
  const register = await request(`/signup?ref=partner-test&order=${order}&next=https%3A%2F%2Fexample.test`);
  assert.equal(register.status, 303);
  assert.equal(register.headers.get("Location"), "/?signin=1&mode=register&ref=PARTNER-TEST&next=billing");
  assert.equal(register.headers.get("Cache-Control"), "no-store");
  const signIn = await request(`/login?order=${order}&ref=bad%2Fcode&next=%2F%2Fexample.test`);
  assert.equal(signIn.status, 303);
  assert.equal(signIn.headers.get("Location"), `/?signin=1&order=${order}&next=billing`);
  assert.equal((await request("/login?next=billing", { method: "HEAD" })).headers.get("Location"), "/?signin=1&next=billing");
  assert.equal((await request("/login?next=https%3A%2F%2Fexample.test&order=wrong")).headers.get("Location"), "/?signin=1");
  assert.equal((await request("/signup", { body: {} })).status, 404);
  assert.equal((await request("/signup", { host: beta })).status, 404);
  assert.equal((await request("/login", { flags: { PUBLIC_READER_ENABLED: "false" } })).status, 404);
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
  assert.deepEqual((await json(request(plans, { cookie: owner }))).plans, [monthly, plan,
    { id: "plus-top-up", name: "Plus Top-up", kind: "one-time", currency: "USD", amountMinor: 949, credits: 2_000_000_000 },
    { id: "stock-up", name: "Stock-up", kind: "one-time", currency: "USD", amountMinor: 1799, credits: 4_000_000_000 },
  ]);
  for (const flag of ["LAUNCH_BILLING_ENABLED", "LAUNCH_BILLING_POSTBACK_ENABLED", "LAUNCH_AI_COST_METERING_ENABLED"]) {
    await json(request(plans, { cookie: owner, flags: { [flag]: "false" } }), 503);
  }
  await json(request(plans, { cookie: owner, flags: { OPENAI_API_KEY: undefined } }), 503);
  await json(request(plans, { assertion, host: beta }), 404);
  await json(request(plans, { assertion, host: fakeHost }), 403);
  assert.equal((await request("/billing", { host: beta, assertion })).status, 404);
  assert.equal((await request("/billing.html", { cookie: owner, flags: {
    LAUNCH_BILLING_ENABLED: "false", LAUNCH_AI_COST_METERING_ENABLED: "false",
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
  assert.equal(quote.amountMinor, 375);
  assert.equal(quote.unit, "nano_usd");
  assert.equal((await json(request(BILLING_ADMIN_API, { assertion }))).promotions[0].claimed, 0);
  const orderForm = checkoutForm({ ...params, expectedAmountMinor: quote.amountMinor });
  await json(request(promotionPath, { assertion, body: { ...promotion, discountBps: 1000 } }));
  await json(request(checkoutPath, { cookie: owner, body: orderForm }), 409);
  assert.equal((await json(request(BILLING_ADMIN_API, { assertion }))).promotions[0].claimed, 0);

  orderForm.expectedAmountMinor = 450;
  const placed = await json(request(checkoutPath, { cookie: owner, body: orderForm }));
  assert.equal(placed.checkout.status, "pending");
  const seller = new URL(placed.checkoutUrl);
  assert.equal(`${seller.origin}${seller.pathname}`, "https://secure.verotel.com/startorder");
  const { signature, ...signed } = Object.fromEntries(seller.searchParams);
  assert.deepEqual(signed, {
    description: plan.name, priceAmount: "4.50", priceCurrency: "USD", referenceID: placed.checkout.id,
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
    priceAmount: "4.99", priceCurrency: "USD", paymentMethod: "CC" };
  const sale = { ...returned, transactionID: "23456" };
  assert.equal((await request(postback(returned))).status, 400);
  assert.equal((await request(postback(sale, "0".repeat(64)))).status, 400);
  assert.equal((await request(postback({ ...sale, shopID: "9911" }))).status, 400);
  assert.equal((await request(postback({ ...sale, priceCurrency: "GBP" }))).status, 409);
  assert.equal((await request(postback({ ...sale, priceAmount: "4.98" }))).status, 409);
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

test("monthly checkout grants one paid period at a time and waits for Verotel to confirm cancellation", async t => {
  const day = 86_400_000;
  const endOfFirstPeriod = Date.parse("2027-02-01");
  const endOfRenewedPeriod = Date.parse("2027-03-01");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-01-01T12:00:00Z") });
  const { request, owner, other } = fixture(t, { sessionLifetime: 90 * day });
  const quotePath = `${BILLING_API}/quote`;
  const checkoutPath = `${BILLING_API}/checkout`;
  const subscriptionPath = `${BILLING_API}/subscription`;
  const cancelPath = `${BILLING_API}/cancel-subscription`;
  const subscription = async (cookie = owner, flags) => (await json(request(subscriptionPath, { cookie, flags }))).subscription;
  const usage = async (cookie = owner) => json(request(LAUNCH_USAGE_PATH, { cookie }));
  async function accept(params) {
    const result = await request(postback(params));
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "OK");
  }

  await json(request(subscriptionPath), 401);
  assert.equal(await subscription(), null);
  await json(request(`${subscriptionPath}?id=${randomUUID()}`, { cookie: owner }), 400);
  const { quote } = await json(request(quotePath, { cookie: owner, body: { planId: monthly.id } }));
  assert.deepEqual(quote, { planId: monthly.id, kind: "monthly", currency: "USD", amountMinor: 999,
    regularAmountMinor: 999, rebillAmountMinor: 999, credits: 2_000_000_000, unit: "nano_usd",
    promotionCode: null, affiliateCode: null });
  await json(request(quotePath, { cookie: owner, body: { planId: monthly.id, promo: "FIXTURE" } }), 409);
  await json(request(checkoutPath, { cookie: owner, body: checkoutForm({ expectedRebillAmountMinor: 998 }, monthly) }), 409);
  const orderForm = checkoutForm({}, monthly);
  const placed = await json(request(checkoutPath, { cookie: owner, body: orderForm }));
  assert.deepEqual(await json(request(checkoutPath, { cookie: owner, body: orderForm })), placed);
  await json(request(checkoutPath, { cookie: owner, body: checkoutForm({}, monthly) }), 409);
  const { checkout: otherOrder } = await json(request(checkoutPath, { cookie: other, body: checkoutForm({}, monthly) }));
  const { id, expiresAt } = placed.checkout;
  const hosted = new URL(placed.checkoutUrl);
  assert.equal(`${hosted.origin}${hosted.pathname}`, "https://secure.verotel.com/startorder");
  const { signature: checkoutSignature, ...checkoutParams } = Object.fromEntries(hosted.searchParams);
  assert.deepEqual(checkoutParams, { name: monthly.name, type: "subscription", subscriptionType: "recurring", period: "P1M",
    priceAmount: "9.99", priceCurrency: "USD", referenceID: id, shopID: settings.VEROTEL_SHOP_ID, version: "4",
    successURL: `${origin}/billing?order=${id}`, declineURL: `${origin}/billing?cancelled=1` });
  assert.equal(checkoutSignature, independentSignature(checkoutParams));

  const pending = await usage();
  assert.equal(pending.unit, "nano_usd");
  assert.equal(pending.month.limit, 10_000_000_000);
  assert.equal(pending.credits.trial, 50_000_000);
  assert.equal(pending.credits.purchased, 0);
  assert.equal(pending.subscription.remaining, 0);
  const merchant = { shopID: settings.VEROTEL_SHOP_ID, type: "subscription", subscriptionType: "recurring", referenceID: id, saleID: "32101" };
  const returned = { ...merchant, event: "initial", period: "P1M", nextChargeOn: "2027-02-01", priceAmount: "9.99", priceCurrency: "USD" };
  const initial = { ...returned, transactionID: "32102", paymentMethod: "CC", CCBrand: "VISA" };
  assert.equal((await request(postback(returned))).status, 400);
  assert.equal((await request(postback({ ...initial, period: "P1Y" }))).status, 400);

  // A verified sale can arrive after its checkout hold has expired.
  t.mock.timers.setTime(expiresAt + 1000);
  assert.equal((await subscription()).status, "expired");
  await accept(initial);
  await accept(initial);
  assert.equal((await request(postback({ ...initial, referenceID: otherOrder.id }))).status, 409);
  assert.deepEqual(await subscription(), { id, status: "active", planId: monthly.id, currency: "USD", rebillAmountMinor: 999,
    paidThrough: endOfFirstPeriod, renews: true });
  assert.equal((await subscription(other)).status, "expired");
  assert.equal((await usage()).subscription.remaining, 2_000_000_000);
  assert.equal((await usage(other)).subscription.remaining, 0);

  // An extend callback can represent a retry, with no successful charge.
  await accept({ ...merchant, event: "extend", nextChargeOn: "2027-02-05" });
  assert.equal((await subscription()).paidThrough, endOfFirstPeriod);
  assert.equal((await usage()).subscription.remaining, 2_000_000_000);
  t.mock.timers.setTime(endOfFirstPeriod + day);
  assert.equal((await subscription()).status, "past-due");
  assert.equal((await usage()).subscription.remaining, 0);
  const { cancelUrl: pastDueCancelUrl } = await json(request(cancelPath, { cookie: owner, body: { id, confirm: true } }));
  assert.equal((await subscription()).renews, true);
  assert.equal((await subscription()).status, "past-due");

  const rebill = { ...merchant, event: "rebill", transactionID: "32103", amount: "9.99", currency: "USD",
    nextChargeOn: "2027-03-01", subscriptionPhase: "normal", paymentMethod: "CC" };
  assert.equal((await request(postback({ ...rebill, amount: "9.98" }))).status, 409);
  await accept(rebill);
  await accept(rebill);
  assert.equal((await subscription()).paidThrough, endOfRenewedPeriod);
  assert.equal((await usage()).subscription.remaining, 2_000_000_000);
  assert.equal((await usage()).credits.purchased, 0);

  await json(request(cancelPath, { cookie: other, body: { id, confirm: true } }), 404);
  await json(request(cancelPath, { cookie: owner, source: beta, body: { id, confirm: true } }), 403);
  await json(request(cancelPath, { cookie: owner, body: { id, confirm: false } }), 400);
  const pausedSales = { LAUNCH_BILLING_ENABLED: "false" };
  const { cancelUrl } = await json(request(cancelPath, { cookie: owner, flags: pausedSales, body: { id, confirm: true } }));
  assert.equal(cancelUrl, pastDueCancelUrl);
  const cancel = new URL(cancelUrl);
  assert.equal(`${cancel.origin}${cancel.pathname}`, "https://secure.verotel.com/cancel-subscription");
  const { signature: cancelSignature, ...cancelParams } = Object.fromEntries(cancel.searchParams);
  assert.deepEqual(cancelParams, { saleID: merchant.saleID, shopID: merchant.shopID, version: "4" });
  assert.equal(cancelSignature, independentSignature(cancelParams));
  assert.equal((await subscription(owner, pausedSales)).renews, true);
  const cancellation = { ...merchant, event: "cancel", expiresOn: "2027-03-01", cancelledBy: "user" };
  assert.equal((await request(postback(cancellation, "0".repeat(64)))).status, 400);
  assert.equal((await subscription()).status, "active");
  await accept(cancellation);
  await accept(cancellation);
  assert.deepEqual(await subscription(), { id, status: "cancelled", planId: monthly.id, currency: "USD", rebillAmountMinor: 999,
    paidThrough: endOfRenewedPeriod, renews: false });
  assert.equal((await usage()).subscription.remaining, 2_000_000_000);

  const refund = { ...merchant, event: "credit", transactionID: "32104", parentID: rebill.transactionID,
    priceAmount: "9.99", priceCurrency: "USD", subscriptionPhase: "terminated" };
  assert.equal((await request(postback({ ...refund, referenceID: otherOrder.id }))).status, 409);
  await accept(refund);
  await accept(refund);
  await accept(rebill);
  assert.equal((await subscription()).status, "expired");
  assert.equal((await usage()).subscription.remaining, 0);
  assert.equal((await usage(other)).subscription.remaining, 0);
});
