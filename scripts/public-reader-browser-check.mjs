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
const password = "river lantern paper clock", replacementPassword = "mint rooftop window tile";
const signedIn = {authenticated: true, expiresAt: Date.now() + 600_000}, guest = {authenticated: false, expiresAt: null};
const sessionCookie = "__Host-satinlore-reader=fixture; Path=/; Secure; HttpOnly; SameSite=Lax";
const errors = [];

const testOwner = "00000000-0000-4000-8000-000000000001";

async function browserPage(width, account = {pendingPassword: "", savedPassword: "", revision: 0, stories: [], preferences: null}) {
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
    if (path === "/api/auth/register") {
      account.pendingPassword = request.postDataJSON().password;
      return route.fulfill({status: 202, json: {challenge, expiresIn: 600, resendAfter: 60}});
    }
    if (path === "/api/auth/forgot") return route.fulfill({status: 202, json: {challenge, expiresIn: 600, resendAfter: 60}});
    if (path === "/api/auth/verify") {
      if (request.postDataJSON().code !== code) return route.fulfill({status: 401, json: {error: "That code didn’t match."}});
      account.savedPassword = account.pendingPassword;
      return route.fulfill({json: {verified: true}});
    }
    if (path === "/api/auth/reset") {
      if (request.postDataJSON().code !== code) return route.fulfill({status: 401, json: {error: "That code didn’t match."}});
      account.savedPassword = request.postDataJSON().password;
      return route.fulfill({headers: {"Set-Cookie": sessionCookie + "; Max-Age=0"}, json: {reset: true}});
    }
    if (path === "/api/auth/login") {
      const form = request.postDataJSON();
      if (form.email !== email || !account.savedPassword || form.password !== account.savedPassword) {
        return route.fulfill({status: 401, json: {error: "The email or password is incorrect."}});
      }
      return route.fulfill({headers: {"Set-Cookie": sessionCookie + (form.remember ? "; Max-Age=2592000" : "")}, json: signedIn});
    }
    if (path === "/api/auth/logout") return route.fulfill({headers: {"Set-Cookie": sessionCookie + "; Max-Age=0"}, json: guest});
    if (path === "/api/account" && authenticated) return route.fulfill({json: {registered: true, revision: 1, presets: []}});
    if (path === "/api/account/library" && authenticated) {
      if (request.method() === "GET") return route.fulfill({json: {owner: testOwner, revision: account.revision, stories: account.stories, preferences: account.preferences}});
      const body = request.postDataJSON();
      assert.equal(body.expectedOwner, testOwner);
      if (body.action === "savePreferences") {
        assert.equal(body.expectedRevision, account.preferences?.revision ?? null);
        account.preferences = {...body.preferences, revision: (account.preferences?.revision ?? 0) + 1};
        return route.fulfill({json: {preferences: account.preferences}});
      }
      assert.equal(body.expectedRevision, account.revision);
      if (body.action === "saveStory") {
        const story = {...body.story, revision: 1, updatedAt: Date.now()};
        account.stories.push(story);
        return route.fulfill({json: {revision: ++account.revision, story}});
      }
      if (body.action === "updateStory") {
        const story = account.stories.find(item => item.id === body.id);
        assert.ok(story);
        assert.equal("text" in body.changes, false, "The story's text does not get sent again when reading progress changes.");
        Object.assign(story, body.changes, {revision: story.revision + 1, updatedAt: Date.now()});
        return route.fulfill({json: {revision: ++account.revision, updatedAt: story.updatedAt, storyRevision: story.revision}});
      }
      if (body.action === "deleteStory") {
        account.stories = account.stories.filter(story => story.id !== body.id);
        return route.fulfill({json: {revision: ++account.revision, deleted: true}});
      }
      return route.fulfill({status: 400, json: {error: "Unsupported account action."}});
    }
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
  return {context, page: await context.newPage(), posts, account};
}

async function registerAndSignIn(page, {wrongFirst = false, remember = false} = {}) {
  await expect(page.locator("#public-account-dialog")).toBeVisible();
  await page.locator("#public-show-register").click();
  await page.locator("#public-register-email").fill(email);
  await page.locator("#public-register-password").fill(password);
  await page.locator("#public-adult").check();
  await page.locator("#public-register").click();
  if (wrongFirst) {
    await page.locator("#public-code").fill("000000");
    await page.locator("#public-verify-code").click();
    await expect(page.locator("#public-account-status")).toContainText("didn’t match");
  }
  await page.locator("#public-code").fill(code);
  await page.locator("#public-verify-code").click();
  await expect(page.locator("#public-account-status")).toContainText("Email verified");
  await expect(page.locator("#public-email")).toHaveValue(email);
  await expect(page.locator("#public-register-password")).toHaveValue("");
  await page.locator("#public-password").fill(password);
  await page.locator("#public-remember").setChecked(remember);
  await page.locator("#public-login").click();
}

async function setMaximum(page, maximum) {
  const slider = page.locator("#experience-maximum");
  await slider.press("Home");
  for (let level = 1; level < maximum; level++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue(String(maximum));
}

async function completeExperience(page) {
  await expect(page.locator("#experience-dialog")).toBeVisible();
  await page.locator("#experience-quiet").selectOption("continuous");
  await page.locator("#experience-edging").selectOption("yes");
  await setMaximum(page, 7);
  await page.locator("#experience-rhythm").selectOption("gentle");
  await page.locator("#experience-save").click();
  await expect(page.locator("#experience-dialog")).toBeHidden();
}

async function checkQuickSimulatorSetup(page) {
  await page.locator("#setup-mode-simulator").click();
  await page.locator("#setup-primary").click();
  const devices = page.locator("#setup-devices");
  const flexer = devices.locator("option").filter({hasText: /Flexer/i});
  await expect(devices).toBeVisible();
  await expect(flexer).toHaveCount(1);
  await devices.selectOption(await flexer.getAttribute("value"));
  await page.locator("#setup-primary").click();
  const test = page.locator("#setup-test");
  const confirmation = page.locator("#setup-response-checked");
  await expect(page.locator("#setup-step-label")).toContainText(/quick test/i);
  await expect(page.locator("#setup-test-maximum")).toContainText(/vibration.+flexing/i);
  await expect(page.locator("#setup-test-level")).toBeHidden();
  await expect(confirmation).toBeDisabled();
  await test.click();
  await expect(confirmation).toBeEnabled({timeout: 15_000});
  await confirmation.check();
  await page.locator("#setup-primary").click();
  await expect(page.locator("#setup-dialog")).toBeHidden();
  await expect(page.locator("#settings-story-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('#combination-choices input[value="vibrate"]')).toBeChecked();
  await expect(page.locator('#combination-choices input[value="fingering"]')).toBeChecked();
  await expect(page.locator("#output")).toHaveText("0 / 20");
}

try {
  const desktop = await browserPage(1440), {page, posts} = desktop;
  await page.goto(origin);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#public-account")).toHaveAccessibleName("Sign in");
  await expect(page.locator("#public-account-dialog")).not.toBeVisible();
  await page.locator("#toggle-settings").click();
  await expect(page.locator("#scene-model")).toBeEnabled();
  await expect(page.locator('#scene-model option[value="loom"]')).toHaveText("Loom");
  await page.locator("#scene-model").selectOption("nocturne");
  await expect(page.locator("#scene-model")).toHaveValue("nocturne");
  await expect(page.locator("#nocturne-panel")).toBeHidden();
  await page.locator("#scene-model").selectOption("loom");
  await page.locator("#draft-title").fill("Synthetic browser story");
  await page.locator("#draft-story").fill(["They drew closer. She held her breath.",
    "Their tender romantic kiss expressed affection. The toy flexed.", "Their passionate, tender kiss and romantic embrace expressed affection.",
    "They slowed and relaxed."].join("\n\n"));
  await page.locator("#open-draft").click();
  await expect(page.locator("#scene-model")).toBeEnabled();
  await expect(page.locator("#scene-model")).toHaveValue("loom");
  const recommendations = page.locator("#story-toy-recommendations-summary");
  await expect(recommendations).toBeVisible();
  await expect(recommendations).toContainText("Flexer");
  await expect(recommendations).toContainText(/fingering/i);
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
  await registerAndSignIn(page, {wrongFirst: true, remember: true});
  await completeExperience(page);
  await expect.poll(() => desktop.account.preferences?.experience).toEqual({
    quiet: "continuous", edging: true, maximum: 7, rhythm: "gentle", peakPattern: "auto",
  });
  await expect(page.locator("#setup-model")).toHaveValue("flexer");
  await expect(page.locator("#setup-step-label")).toContainText(/step 1 of 3.+pair/i);
  await expect(page.locator("#setup-primary")).toHaveText("Connect Flexer");
  await expect(page.locator("#setup-qr")).not.toBeVisible();
  await checkQuickSimulatorSetup(page);
  await expect(page.locator("#cap")).toHaveValue("7");
  await expect(page.locator("#nocturne-peak-pattern")).toHaveValue("auto");
  await page.locator("#nocturne-peak-pattern").selectOption("accents");
  await expect.poll(() => desktop.account.preferences?.experience?.peakPattern).toBe("accents");
  await page.locator("#settings-reader-tab").click();
  await expect(page.locator("#feel-mode")).toHaveValue("continuous");
  await expect(page.locator("#public-account")).toHaveAccessibleName("Account, signed in");
  await page.locator("#nocturne-run").click();
  await expect(page.locator("#nocturne-status")).toContainText("Nocturne applied");
  assert.deepEqual(Object.keys(posts.find(entry => entry.path === "/api/scene-analysis").body), ["cues"]);
  assert.deepEqual(posts.find(entry => entry.path === "/api/auth/register").body, {email, password, adult: true});
  assert.deepEqual(posts.filter(entry => entry.path === "/api/auth/verify").at(-1).body, {challenge, code});
  assert.deepEqual(posts.find(entry => entry.path === "/api/auth/login").body, {email, password, remember: true});
  assert.ok((await desktop.context.cookies(origin)).find(cookie => cookie.name === "__Host-satinlore-reader")?.expires > Date.now() / 1000);
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
  await page.locator("#public-show-forgot").click();
  await page.locator("#public-forgot-email").fill(email);
  await page.locator("#public-forgot").click();
  await page.locator("#public-reset-code").fill(code);
  await page.locator("#public-reset-password").fill(replacementPassword);
  await page.locator("#public-reset").click();
  await expect(page.locator("#public-account-status")).toContainText("Password changed");
  await expect(page.locator("#public-account")).toHaveAccessibleName("Sign in");
  await page.locator("#public-password").fill(password);
  await page.locator("#public-login").click();
  await expect(page.locator("#public-account-status")).toContainText("incorrect");
  await page.locator("#public-account-close").click();
  await expect(page.locator("#story-title")).toHaveText("Synthetic browser story");
  await expect(page.locator("#nocturne-sign-in")).toBeVisible();
  assert.equal(posts.some(entry => entry.path === "/api/account/library" && entry.body.action === "saveStory"), false, "Reading, signing in and onboarding never save stories to an account automatically.");

  await page.locator("#save-account-story").click();
  await page.locator("#public-email").fill(email);
  await page.locator("#public-password").fill(replacementPassword);
  await page.locator("#public-login").click();
  await expect(page.locator("#save-dialog")).toBeVisible();
  await expect(page.locator("#save-heading")).toHaveText("Save to your account?");
  assert.equal(posts.some(entry => entry.path === "/api/account/library" && entry.body.action === "saveStory"), false, "An account save still needs explicit confirmation after login.");
  await page.locator("#confirm-save").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to your account");
  await page.locator("#next").click();
  await expect.poll(() => desktop.account.stories[0].position).toBe(1);
  await page.locator("#toggle-dark-mode").click();
  await expect.poll(() => desktop.account.preferences?.appearance).toBe("light");
  await page.locator("#font-size").selectOption("large");
  await expect.poll(() => desktop.account.preferences?.fontSize).toBe("large");
  assert.equal(await page.evaluate(() => localStorage.getItem("satinlore.library.v1")), null, "Account-only stories never enter browser storage.");
  assert.equal(await page.evaluate(() => localStorage.getItem("satinlore.appearance")), null, "Account-only appearance never overwrites the guest preference.");

  await page.reload();
  await expect(page.locator("#story-title")).toHaveText("Synthetic browser story");
  await expect(page.locator("#position")).toHaveText("Section 2 of 4");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const second = await browserPage(1440, desktop.account);
  await second.page.goto(origin);
  await expect(second.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(second.page.locator("#story-list")).toBeEmpty();
  await second.page.locator("#public-account").click();
  await second.page.locator("#public-email").fill(email);
  await second.page.locator("#public-password").fill(replacementPassword);
  await second.page.locator("#public-login").click();
  await expect(second.page.locator("#story-title")).toHaveText("Synthetic browser story");
  await expect(second.page.locator("#position")).toHaveText("Section 2 of 4");
  await expect(second.page.locator("#font-size")).toHaveValue("large");
  await expect(second.page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(second.page.locator("#experience-dialog")).toBeHidden();
  await second.page.locator("#open-app-settings").click();
  await second.page.locator("#open-experience").click();
  await expect(second.page.locator("#experience-dialog")).toBeVisible();
  await expect(second.page.locator("#experience-quiet")).toHaveValue("continuous");
  await expect(second.page.locator("#experience-edging")).toHaveValue("yes");
  await expect(second.page.locator("#experience-maximum")).toHaveValue("7");
  await expect(second.page.locator("#experience-rhythm")).toHaveValue("gentle");
  await second.page.locator("#experience-quiet").selectOption("edging");
  await second.page.locator("#experience-rhythm").selectOption("steady");
  await second.page.locator("#experience-save").click();
  await expect(second.page.locator("#experience-dialog")).toBeHidden();
  await expect(second.page.locator("#setup-dialog")).toBeHidden();
  await expect.poll(() => second.account.preferences?.experience).toEqual({
    quiet: "edging", edging: true, maximum: 7, rhythm: "steady", peakPattern: "accents",
  });
  if (await second.page.locator("#app-settings-dialog").isVisible()) await second.page.locator("#close-app-settings").click();
  const sibling = await second.context.newPage();
  await sibling.goto(origin);
  await expect(sibling.locator("#story-title")).toHaveText("Synthetic browser story");
  await second.page.locator("#public-account").click();
  await second.page.locator("#public-sign-out").click();
  await expect(second.page.locator("#story-list")).toBeEmpty();
  await expect(second.page.locator("#paragraph")).toBeEmpty();
  await expect(second.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(sibling.locator("#story-list")).toBeEmpty();
  await expect(sibling.locator("#paragraph")).toBeEmpty();
  await second.context.close();

  await page.locator("#settings-story-tab").click();
  await page.once("dialog", dialog => dialog.accept());
  await page.locator("#delete-story").click();
  await expect(page.locator("#story-list")).toBeEmpty();
  assert.deepEqual(desktop.account.stories, []);
  await desktop.context.close();

  const mobile = await browserPage(320);
  await mobile.page.goto(origin + "/support");
  await mobile.page.getByRole("link", {name: /sign in/i}).click();
  const headerFits = await mobile.page.locator("#workspace-header").evaluate(node => node.scrollWidth <= node.clientWidth);
  assert.equal(headerFits, true, "Reader controls fit a 320px viewport.");
  await expect(mobile.page.locator("#public-account-label")).toBeVisible();
  await expect(mobile.page.locator(".header-feedback-link span")).toBeVisible();
  await registerAndSignIn(mobile.page);
  await mobile.page.waitForURL(origin + "/support");
  await expect(mobile.page.locator("#feedback-send")).toBeEnabled();
  await mobile.page.goto(origin);
  const onboarding = mobile.page.locator("#experience-dialog");
  await expect(onboarding).toBeVisible();
  assert.equal(await onboarding.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true, "Onboarding fits a 320px viewport.");
  await completeExperience(mobile.page);
  await expect(mobile.page.locator("#setup-step-label")).toContainText(/step 1 of 3.+pair/i);
  await expect(mobile.page.locator("#setup-mode-lovense")).toHaveAttribute("aria-pressed", "true");
  await mobile.page.locator("#setup-close").click();
  await mobile.page.goto(origin + "/help");
  await expect(mobile.page.locator("#help-signout")).not.toBeVisible();
  await expect(mobile.page.locator("#public-guides")).toHaveCount(0);
  await mobile.context.close();
  assert.deepEqual(errors, []);
  console.log("Public reader Chromium smoke passed: model selection, movement-based toy recommendations, guest simulator, email verification and password recovery, onboarding, three-step simulator setup, saved Nocturne controls, feedback, cross-context story and preference sync, sign-out, and 320px onboarding.");
} finally { await browser.close(); }
