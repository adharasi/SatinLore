// Exercise the launch journeys through Chromium, the real Worker and ephemeral SQLite.
// The browser and Worker only receive synthetic email, payment and model responses.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {exportJWK, generateKeyPair, SignJWT} from "jose";
import {Miniflare} from "miniflare";
import {chromium, expect} from "playwright/test";
import {flexPaySignature} from "../deploy/cloudflare/launch-billing.mjs";

const app = "https://app.satinlore.com", checkout = "https://secure.verotel.com";
const issuer = "https://launch-fixture.cloudflareaccess.com", audience = "f".repeat(64);
const signatureKey = "local-test-flexpay-signature";
const email = "reader@example.test", founderEmail = "founder@example.test";
const password = "fictional test credentials for launch";
const nextPassword = "changed test credentials for launch";
const {privateKey, publicKey} = await generateKeyPair("RS256");
const jwk = {...await exportJWK(publicKey), kid: "launch-fixture", alg: "RS256"};
const founder = await new SignJWT({email: founderEmail, type: "app"}).setProtectedHeader({alg: "RS256", kid: jwk.kid})
  .setIssuer(issuer).setAudience(audience).setSubject("fixture-founder").setIssuedAt().setExpirationTime("1h").sign(privateKey);
const packagePath = new URL("../dist/private-app/", import.meta.url);
const assetType = {html: "text/html", mjs: "text/javascript", js: "text/javascript", css: "text/css", svg: "image/svg+xml"};
const codes = [];
let modelCalls = 0, checkoutUrl;
const compiled = await build({stdin: {resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "launch-fixture.mjs", contents: `
  import {createLocalJWKSet} from "jose";
  import {createPrivateAppWorker} from "./deploy/cloudflare/worker.mjs";
  export {PublicReaderAuth, ReaderAccount, SatinLoreCommerce, LaunchUsage, SceneAnalysisBudget} from "./deploy/cloudflare/worker.mjs";
  export default createPrivateAppWorker({keyResolver: createLocalJWKSet({keys:[${JSON.stringify(jwk)}]})});`},
  bundle: true, format: "esm", write: false, external: ["node:crypto"]});
const stores = {PUBLIC_READER_AUTH: "PublicReaderAuth", READER_ACCOUNTS: "ReaderAccount",
  COMMERCE: "SatinLoreCommerce", LAUNCH_USAGE: "LaunchUsage", SCENE_ANALYSIS_BUDGET: "SceneAnalysisBudget"};
const mf = new Miniflare({
  modules: [{type: "ESModule", path: "launch-fixture.mjs", contents: compiled.outputFiles[0].text}],
  compatibilityDate: "2026-05-22", compatibilityFlags: ["nodejs_compat"], cf: false, port: 0, inspectorPort: 0,
  bindings: {
    PRIVATE_APP_ENABLED: "true", PUBLIC_APP_ORIGIN: app, PUBLIC_READER_ENABLED: "true", PUBLIC_READER_OTP_KEY: "ba".repeat(32),
    AUTH_SES_REGION: "eu-north-1", AUTH_SES_FROM_EMAIL: "team@example.test",
    AUTH_SES_ACCESS_KEY_ID: "A".repeat(20), AUTH_SES_SECRET_ACCESS_KEY: "B".repeat(40),
    FOUNDER_EMAIL: founderEmail, ACCESS_TEAM_DOMAIN: new URL(issuer).host, ACCESS_AUD: audience,
    LAUNCH_BILLING_ENABLED: "true", LAUNCH_BILLING_ADMIN_ENABLED: "true", LAUNCH_BILLING_POSTBACK_ENABLED: "true",
    LAUNCH_AI_USAGE_ENABLED: "true", LAUNCH_AI_MONTHLY_TOKEN_CAP: "40000", LAUNCH_AI_TRIAL_TOKENS: "0",
    VEROTEL_SHOP_ID: "81234", VEROTEL_SIGNATURE_KEY: signatureKey, OPENAI_API_KEY: "sk-proj-fixture-openai-key",
    LAUNCH_PLAN_CATALOG: JSON.stringify([
      {id: "fixture-pack", name: "Fixture credits", currency: "GBP", amountMinor: 1000, credits: 30000},
    ]),
  },
  durableObjects: Object.fromEntries(Object.entries(stores).map(([name, className]) => [name, {className, useSQLite: true}])),
  serviceBindings: {ASSETS: async request => {
    const path = new URL(request.url).pathname.slice(1);
    if (!/^[a-zA-Z0-9_.\/-]+$/u.test(path) || path.includes("..")) return new Response(null, {status: 404});
    try { return new Response(await readFile(new URL(path, packagePath)), {headers: {"Content-Type": assetType[path.split(".").at(-1)]}}); }
    catch { return new Response(null, {status: 404}); }
  }},
  async outboundService(request) {
    if (request.url === "https://email.eu-north-1.amazonaws.com/v2/email/outbound-emails") {
      const body = await request.json();
      assert.deepEqual(body.Destination.ToAddresses, [email]);
      const code = body.Content.Simple.Body.Text.Data.match(/\b\d{6}\b/u)?.[0];
      assert.ok(code);
      codes.push(code);
      return Response.json({MessageId: "fixture-email"});
    }
    if (request.url === "https://api.openai.com/v1/responses") {
      modelCalls++;
      const {model, store, input} = await request.json();
      assert.equal(model, "gpt-6-luna"); assert.equal(store, false);
      assert.equal(JSON.parse(input).cues[0].id, 2);
      return Response.json({status: "completed", usage: {input_tokens: 50, output_tokens: 20, total_tokens: 70},
        output: [{type: "message", role: "assistant", content: [{type: "output_text", text: JSON.stringify({labels: [{id: 2, label: "accents"}]})}]}]});
    }
    throw new Error("Unexpected external fixture request.");
  },
});

let browser;
const errors = [];
const excludedOrigins = [];
async function context({isFounder = false, width = 1180} = {}) {
  const browserContext = await browser.newContext({viewport: {width, height: 860}, locale: "en-GB", reducedMotion: "reduce"});
  await browserContext.route("**/*", async route => {
    const incoming = route.request(), url = new URL(incoming.url());
    if (url.origin === checkout && url.pathname === "/startorder") {
      checkoutUrl = url;
      return route.fulfill({contentType: "text/html", body: "<title>Fixture checkout</title><h1>Fixture checkout</h1>"});
    }
    if (url.origin !== app) { excludedOrigins.push(url.origin); return route.abort(); }
    const headers = await incoming.allHeaders();
    headers["CF-Connecting-IP"] = "192.0.2.42";
    if (isFounder) headers["Cf-Access-Jwt-Assertion"] = founder;
    const body = incoming.postDataBuffer();
    const response = await mf.dispatchFetch(incoming.url(), {method: incoming.method(), headers, ...(body ? {body} : {})});
    return route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
  });
  const page = await browserContext.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return {page, browserContext};
}

async function postback(fields) {
  const params = {shopID: "81234", type: "purchase", referenceID: checkoutUrl.searchParams.get("referenceID"),
    saleID: "4422", transactionID: "4423", priceAmount: "8.00", priceCurrency: "GBP", ...fields};
  params.signature = await flexPaySignature(signatureKey, params);
  return mf.dispatchFetch(`${app}/api/billing/verotel/postback?${new URLSearchParams(params)}`);
}
const sceneRequest = page => page.evaluate(async () => (await fetch("/api/scene-analysis", {method: "POST", headers: {"Content-Type": "application/json"},
  body: JSON.stringify({cues: [{id: 2, phase: "peak", rhythm: "dynamic", previous: "sustain", next: "recover", movementCount: 2, shape: "accented"}]})})).status);

try {
  browser = await chromium.launch({headless: true, ...(process.env.SATINLORE_CHROMIUM_EXECUTABLE_PATH ?
    {executablePath: process.env.SATINLORE_CHROMIUM_EXECUTABLE_PATH} : {})});
  const admin = await context({isFounder: true});
  await admin.page.goto(`${app}/billing-admin`);
  await expect(admin.page.locator("#admin-status")).toHaveText("");
  const time = offset => new Date(Date.now() + offset).toISOString().slice(0, 16);
  await admin.page.locator("#promo-code").fill("FIXTURE20");
  await admin.page.locator("#promo-discount").fill("20");
  await admin.page.locator("#promo-limit").fill("2");
  await admin.page.locator("#promo-start").fill(time(-3_600_000));
  await admin.page.locator("#promo-end").fill(time(3_600_000));
  await admin.page.getByRole("button", {name: "Save promotion"}).click();
  await expect(admin.page.locator("#promotions-list")).toContainText("FIXTURE20");
  await admin.page.locator("#affiliate-code").fill("FIXTURE-PARTNER");
  await admin.page.locator("#affiliate-rate").fill("20");
  await admin.page.getByRole("button", {name: "Save affiliate"}).click();
  await expect(admin.page.locator("#affiliates-list")).toContainText("FIXTURE-PARTNER");
  const link = await admin.page.locator("#affiliates-list a").getAttribute("href");

  const reader = await context({width: 390});
  const page = reader.page;
  await page.goto(app + link);
  await page.getByRole("link", {name: "Sign in or create an account"}).click();
  await page.locator("#public-show-register").click();
  await page.locator("#public-register-email").fill(email);
  await page.locator("#public-register-password").fill(password);
  await page.locator("#public-adult").check();
  await page.locator("#public-register").click();
  await expect(page.locator("#public-code")).toBeVisible();
  assert.equal(codes.length, 1);
  await page.locator("#public-code").fill(codes[0]);
  await page.locator("#public-verify-code").click();
  await expect(page.locator("#public-account-status")).toContainText("Email verified");
  await page.locator("#public-password").fill(password);
  await page.locator("#public-login").click();
  await page.waitForURL(`${app}${link}`);
  await expect(page.locator("#credit-remaining")).toHaveText("0");
  assert.equal(await sceneRequest(page), 429);
  assert.equal(modelCalls, 0);

  await page.locator("#promotion").fill("fixture20");
  await page.getByRole("button", {name: "Check price"}).click();
  await expect(page.locator("#quote-status")).toContainText("£8.00");
  await page.getByRole("button", {name: "Continue to secure checkout"}).click();
  await expect(page.getByRole("heading", {name: "Fixture checkout"})).toBeVisible();
  assert.equal(checkoutUrl.searchParams.get("priceAmount"), "8.00");
  const orderUrl = checkoutUrl.searchParams.get("successURL");
  await page.goto(orderUrl);
  await expect(page.locator("#order-status")).toContainText("Waiting for payment confirmation");
  await expect(page.locator("#credit-remaining")).toHaveText("0");
  for (let attempt = 0; attempt < 2; attempt++) assert.equal(await (await postback()).text(), "OK");
  await page.getByRole("button", {name: "Refresh usage"}).click();
  await expect(page.locator("#order-status")).toContainText("Payment confirmed");
  await expect(page.locator("#credit-remaining")).toHaveText("30,000");
  assert.equal(await sceneRequest(page), 200);
  assert.equal(modelCalls, 1);
  await page.getByRole("button", {name: "Refresh usage"}).click();
  await expect(page.locator("#month-used")).toHaveText("70");
  await expect(page.locator("#credit-remaining")).toHaveText("29,930");

  await admin.page.getByRole("button", {name: "Refresh records"}).click();
  await expect(admin.page.locator("#orders-list")).toContainText("FIXTURE-PARTNER: £1.60 commission");
  assert.equal(await (await postback({event: "credit", transactionID: "4424", parentID: "4423"})).text(), "OK");
  await page.getByRole("button", {name: "Refresh usage"}).click();
  await expect(page.locator("#order-status")).toContainText("refunded");
  await expect(page.locator("#credit-remaining")).toHaveText("0");
  assert.equal(await sceneRequest(page), 429);
  assert.equal(modelCalls, 1);
  await admin.page.getByRole("button", {name: "Refresh records"}).click();
  await expect(admin.page.locator("#orders-list")).toContainText("FIXTURE-PARTNER: £0.00 commission");
  await page.getByRole("link", {name: "Back to the reader"}).click();
  await expect(page.locator("#public-account")).toBeVisible();
  const onboarding = page.locator("#experience-dialog");
  await expect(onboarding).toBeVisible();
  await page.locator("#experience-later").click();
  await page.locator("#public-account").click();
  await page.locator("#public-show-change-password").click();
  await page.locator("#public-current-password").fill(password);
  await page.locator("#public-new-password").fill(nextPassword);
  await page.locator("#public-change-password").click();
  await expect(page.locator("#public-account-status")).toContainText(/password changed/i);
  assert.deepEqual(errors, []);
  assert.deepEqual(excludedOrigins, []);
  console.log(`Launch browser checks passed in Chromium ${browser.version()}: signup, verified sign-in, affiliate return, promo price, checkout, duplicate settlement, quota, refund, commission and password change. No real provider requests.`);
} finally {
  await browser?.close();
  await mf.dispose();
}
