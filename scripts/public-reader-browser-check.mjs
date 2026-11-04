// Chromium smoke test against the packaged reader with a synthetic same-origin service.
// No real emails, provider credentials, external requests or physical toys.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {chromium, expect} from "playwright/test";

const origin = "https://app.satinlore.com";
const mime = {html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", svg: "image/svg+xml"};
const browser = await chromium.launch({headless: true,
  ...(process.env.SATINLORE_CHROMIUM_EXECUTABLE_PATH ? {executablePath: process.env.SATINLORE_CHROMIUM_EXECUTABLE_PATH} : {}),
});
const email = "reader@example.test", code = "123456", challenge = "a".repeat(64);
const signedIn = {authenticated: true, expiresAt: Date.now() + 600_000}, guest = {authenticated: false, expiresAt: null};
const sessionCookie = "__Host-satinlore-reader=fixture; Path=/; Secure; HttpOnly; SameSite=Lax";
const errors = [];

async function browserPage(width) {
  const context = await browser.newContext({viewport: {width, height: 900}, reducedMotion: "reduce"});
  const posts = [], feedback = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { errors.push(`Unexpected external request to ${url.origin}`); return route.abort(); }
    const authenticated = (await request.headerValue("cookie"))?.includes("__Host-satinlore-reader=fixture");
    const path = url.pathname;
    if (path === "/api/access") return route.fulfill({json: authenticated ? signedIn : guest});
    if (request.method() === "POST") posts.push({path, body: request.postDataJSON()});
    if (path === "/api/auth/request") return route.fulfill({status: 202, json: {challenge, expiresIn: 600, resendAfter: 60}});
    if (path === "/api/auth/verify") {
      if (request.postDataJSON().code !== code) return route.fulfill({status: 401, json: {error: "That code didn’t match."}});
      return route.fulfill({headers: {"Set-Cookie": sessionCookie}, json: signedIn});
    }
    if (path === "/api/auth/logout") return route.fulfill({headers: {"Set-Cookie": sessionCookie + "; Max-Age=0"}, json: guest});
    if (path === "/api/account" && authenticated) return route.fulfill({json: {registered: true, revision: 1, presets: []}});
    if (path === "/api/scene-analysis" && authenticated) {
      if (request.method() === "GET") return route.fulfill({json: {available: true}});
      const labels = request.postDataJSON().cues.map(({id, phase}) => ({id, label: phase === "peak" ? "crest" : "abstain"}));
      return route.fulfill({json: {labels}});
    }
    if (path === "/api/feedback" && authenticated) {
      if (request.method() === "GET") return route.fulfill({json: {feedback}});
      const {category, message, rating} = request.postDataJSON();
      const row = {id: "00000000-0000-4000-8000-000000000001", category, message, rating, createdAt: Date.now(), expiresAt: Date.now() + 86400000};
      feedback.push({...row, status: "new"});
      return route.fulfill({json: {...row, ok: true, duplicate: false}});
    }
    if (path.startsWith("/api/")) return route.fulfill({status: 401, json: {error: "Sign in first."}});
    const file = ({"/": "index.html", "/support": "feedback.html", "/help": "help.html"})[path] ?? path.slice(1);
    if (!/^(?:(?:index|feedback|help)\.html|static\/[A-Za-z0-9_.\/-]+)$/.test(file) || file.includes("..")) return route.fulfill({status: 404});
    let body = await readFile(new URL("../dist/private-app/" + file, import.meta.url), "utf8");
    if (file.endsWith(".html")) body = body.replace("</head>", '<meta name="satinlore-public-auth" content="true"></head>');
    return route.fulfill({contentType: mime[file.split(".").at(-1)], body});
  });
  return {context, page: await context.newPage(), posts};
}

async function verifyEmail(page, {wrongFirst = false} = {}) {
  await expect(page.locator("#public-account-dialog")).toBeVisible();
  await page.locator("#public-email").fill(email);
  await page.locator("#public-adult").check();
  await page.locator("#public-send-code").click();
  if (wrongFirst) {
    await page.locator("#public-code").fill("000000");
    await page.locator("#public-verify-code").click();
    await expect(page.locator("#public-account-status")).toContainText("didn’t match");
  }
  await page.locator("#public-code").fill(code);
  await page.locator("#public-verify-code").click();
}

try {
  const desktop = await browserPage(1440), {page, posts} = desktop;
  await page.goto(origin);
  await expect(page.locator("#public-account")).toHaveAccessibleName("Sign in");
  await expect(page.locator("#public-account-dialog")).not.toBeVisible();
  await page.locator("#draft-title").fill("Synthetic browser story");
  await page.locator("#draft-story").fill(["They drew closer. She held her breath.",
    "Their slow tender kiss expressed affection.", "Their passionate, tender kiss and romantic embrace expressed affection.",
    "They slowed and relaxed."].join("\n\n"));
  await page.locator("#open-draft").click();
  await expect(page.locator("#scene-model")).toBeEnabled();
  await expect(page.locator("#scene-model")).toHaveValue("loom");
  await page.locator("#connect").click();
  await page.locator("#start").click();
  await page.locator("#confirm-start").click();
  await expect(page.locator("#status")).toHaveText("Simulator running");
  await page.locator("#stop").click();
  await page.locator("#scene-model").selectOption("nocturne");
  await expect(page.locator("#nocturne-sign-in")).toBeVisible();
  await page.locator("#choose-toy").click();
  await page.locator("#setup-model").selectOption("flexer");
  await page.locator("#setup-mode-lovense").click();
  await expect(page.locator("#setup-primary")).toHaveText("Sign in to connect Flexer");
  await page.locator("#setup-primary").click();
  await verifyEmail(page, {wrongFirst: true});
  await expect(page.locator("#setup-model")).toHaveValue("flexer");
  await expect(page.locator("#setup-primary")).toHaveText("Connect Flexer");
  await expect(page.locator("#setup-qr")).not.toBeVisible();
  await page.locator("#setup-close").click();
  await expect(page.locator("#public-account")).toHaveAccessibleName("Account, signed in");
  await page.locator("#nocturne-run").click();
  await expect(page.locator("#nocturne-status")).toContainText("Nocturne applied");
  assert.deepEqual(Object.keys(posts.find(entry => entry.path === "/api/scene-analysis").body), ["cues"]);
  assert.deepEqual(posts.filter(entry => entry.path === "/api/auth/verify").at(-1).body, {challenge, code, adult: true});
  const [feedback] = await Promise.all([desktop.context.waitForEvent("page"), page.getByRole("link", {name: /Send feedback/}).first().click()]);
  await expect(feedback.locator("#feedback-send")).toBeEnabled();
  await feedback.locator("#feedback-message").fill("Synthetic feedback for the launch smoke test.");
  await feedback.locator("#feedback-send").click();
  await expect(feedback.locator("#feedback-send-status")).toContainText("Your feedback is saved");
  await expect(feedback.locator("#feedback-list")).toContainText("Received");
  await feedback.close();
  await page.locator("#public-account").click();
  await page.locator("#public-sign-out").click();
  await expect(page.locator("#public-account-status")).toContainText("You’re signed out");
  await expect(page.locator("#public-email")).toHaveValue("");
  await page.locator("#public-account-close").click();
  await expect(page.locator("#story-title")).toHaveText("Synthetic browser story");
  await expect(page.locator("#nocturne-sign-in")).toBeVisible();
  await desktop.context.close();

  const mobile = await browserPage(320);
  await mobile.page.goto(origin + "/support");
  await mobile.page.getByRole("link", {name: /sign in/i}).click();
  const headerFits = await mobile.page.locator("#workspace-header").evaluate(node => node.scrollWidth <= node.clientWidth);
  assert.equal(headerFits, true, "Reader controls fit a 320px viewport.");
  await expect(mobile.page.locator("#public-account-label")).toBeVisible();
  await expect(mobile.page.locator(".header-feedback-link span")).toBeVisible();
  await verifyEmail(mobile.page);
  await mobile.page.waitForURL(origin + "/support");
  await expect(mobile.page.locator("#feedback-send")).toBeEnabled();
  await mobile.page.goto(origin + "/help");
  await expect(mobile.page.locator("#help-signout")).not.toBeVisible();
  await expect(mobile.page.locator("#public-guides")).toHaveAttribute("href", "https://satinlore.com/docs");
  await mobile.context.close();
  assert.deepEqual(errors, []);
  console.log("Public reader Chromium smoke passed: guest simulator, Nocturne, sign-in, toy resume, feedback, sign-out, and 320px help flow.");
} finally { await browser.close(); }
