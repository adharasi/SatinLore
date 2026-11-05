// Real Chromium and the packaged reader, with a synthetic same-origin service.
// No private stories, provider credentials, external calls or physical devices.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {chromium} from "playwright";

const origin = "https://app.satinlore.test";
const apiPath = "/api/scene-analysis";
const canary = "PRIVATE_SCENE_FIXTURE_CANARY";
const title = "Private browser story " + canary;
const source = [
  "They drew closer. She held her breath.",
  "Their slow tender kiss expressed affection.",
  "Their passionate, tender kiss and romantic embrace expressed affection.",
  "They slowed and relaxed.",
  "An underage warning card remained folded on the sill. " + canary,
  "***",
].join("\n\n");
const mime = {html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", svg: "image/svg+xml"};
const browser = await chromium.launch({headless: true,
  ...(process.env.SATINLORE_CHROMIUM_EXECUTABLE_PATH ? {executablePath: process.env.SATINLORE_CHROMIUM_EXECUTABLE_PATH} : {}),
});
const external = [], errors = [], posts = [];
let leaked = false;
let configured = true;
let providerResult = "success";
let releasePending;

async function openReaderSettings(page) {
  if (await page.locator("#settings-panel").isHidden()) await page.locator("#toggle-settings").click();
  const tab = page.locator("#settings-reader-tab");
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
  await page.locator("#reader-settings").waitFor({state: "visible"});
}

async function selectPeakPattern(page, value) {
  const selector = page.locator("#nocturne-peak-pattern");
  await selector.waitFor({state: "visible"});
  await selector.selectOption(value);
  await page.waitForFunction(expected => {
    const node = document.querySelector("#nocturne-peak-pattern");
    return node?.value === expected && !node.disabled;
  }, value);
}

async function testPage() {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: "reduce"});
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.clock.install();
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    leaked ||= request.url().includes(canary) || !!request.postData()?.includes(canary);
    if (url.origin !== origin) {
      external.push(url.origin);
      return route.abort();
    }
    if (url.pathname === "/api/access") return route.fulfill({json: {authenticated: true, expiresAt: Date.now() + 600_000}});
    if (url.pathname === "/api/account") return route.fulfill({json: {registered: true, revision: 1, presets: []}});
    if (url.pathname === "/api/lovense/status") return route.fulfill({json: {available: false}});
    if (url.pathname === apiPath && request.method() === "GET") return route.fulfill({json: {available: configured}});
    if (url.pathname === apiPath && request.method() === "POST") {
      const body = request.postDataJSON();
      posts.push(body);
      if (providerResult === "refused") return route.fulfill({status: 422, json: {code: "refused", error: canary}});
      const labels = body.cues.map(({id, phase}) => ({id, label: phase === "peak" ? "crest" : "abstain"}));
      if (providerResult === "pending") {
        await new Promise(resolve => { releasePending = resolve; });
        return route.fulfill({json: {labels}}).catch(() => {}); // The reader cancels this request.
      }
      return route.fulfill({json: {labels}});
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^(?:index\.html|static\/[A-Za-z0-9_.\/-]+)$/.test(file) || file.includes("..")) {
      return route.fulfill({status: 404, body: "Fixture route missing"});
    }
    const path = new URL("../dist/private-app/" + file, import.meta.url);
    return route.fulfill({contentType: mime[file.split(".").at(-1)], body: await readFile(path)});
  });
  await page.goto(origin + "/");
  await page.locator("#draft-title").fill(title);
  await page.locator("#draft-story").fill(source);
  await page.locator("#open-draft").click();
  await page.waitForFunction(() => document.querySelector("#analysis-status")?.dataset.state === "ready");
  await openReaderSettings(page);
  const model = page.locator("#scene-model");
  await model.waitFor({state: "visible"});
  return {context, page, model};
}

async function checkPeakMeter(page, expected) {
  await page.locator("#start").click();
  await page.locator("#confirm-start").click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Simulator running");
  // Start may wait for the previous heartbeat slot. Anchor the sample to a
  // confirmed first step and allow the next heartbeat to publish the target.
  await page.waitForFunction(() => document.querySelector("#output")?.textContent === "5 / 20");
  await page.clock.runFor(3500);
  await page.waitForFunction(level => document.querySelector("#output")?.textContent === `${level} / 20`, expected, {timeout: 2500});
  await page.locator("#stop").click();
  assert.equal(await page.locator("#output").textContent(), "0 / 20");
}

try {
  const {context, page, model} = await testPage();
  assert.equal(await model.inputValue(), "loom", "Loom starts as the local default.");
  assert.equal(posts.length, 0, "Opening a story must not send a classification request.");
  const run = page.locator("#nocturne-run"), status = page.locator("#nocturne-status");
  await model.selectOption("nocturne");
  await page.waitForFunction(() => {
    const run = document.querySelector("#nocturne-run");
    return run && !run.hidden && !run.disabled;
  });
  assert.equal(posts.length, 0, "Selecting the model alone must not send story cues.");
  const classified = page.waitForResponse(response => new URL(response.url()).pathname === apiPath && response.request().method() === "POST");
  await run.click();
  assert.equal((await classified).status(), 200);
  assert.equal(posts.length, 1);
  const sent = posts[0];
  assert.deepEqual(Object.keys(sent), ["cues"]);
  assert.ok(sent.cues.some(cue => cue.id === 2 && cue.phase === "peak"), "The grounded peak is eligible.");
  assert.ok(sent.cues.every(cue => cue.id !== 4), "A protected local passage is excluded.");
  for (const cue of sent.cues) {
    assert.deepEqual(Object.keys(cue).sort(), ["id", "movementCount", "next", "phase", "previous", "rhythm", "shape"]);
  }
  assert.ok(!JSON.stringify(sent).includes(canary), "The request contains no title or passage text.");
  await page.waitForFunction(() => /Nocturne applied/i.test(document.querySelector("#nocturne-status")?.textContent));
  assert.match(await page.locator("#output").textContent(), /^0\s*\/\s*20$/);
  await page.locator("#next").click();
  await page.locator("#next").click();
  await page.waitForFunction(() => /Sustained crest/i.test(document.querySelector("#level-source")?.textContent));
  await page.locator("#connect").click();
  assert.equal(await page.locator("#capValue").textContent(), "10");
  await checkPeakMeter(page, 7);

  assert.equal(await page.locator(".story-paragraph.active").getAttribute("data-index"), "2");
  await openReaderSettings(page);
  await page.locator("#open-nocturne-patterns").click();
  await page.locator("#story-settings").waitFor({state: "visible"});
  await selectPeakPattern(page, "steady");
  await page.waitForFunction(() => /Steady hold/i.test(document.querySelector("#nocturne-current-pattern")?.textContent));
  assert.equal(await page.locator(".story-paragraph.active").getAttribute("data-index"), "2", "Opening pattern controls preserves the selected peak.");
  assert.match(await page.locator("#level-source").textContent(), /Peak.*Steady hold/i);
  assert.equal(await page.locator("#output").textContent(), "0 / 20", "Choosing a profile stays paused.");
  await page.locator("#start").click();
  await page.locator("#confirm-start").click();
  await page.clock.runFor(1000);
  await page.waitForFunction(() => document.querySelector("#output")?.textContent === "7 / 20");
  await page.clock.runFor(12000);
  assert.equal(await page.locator("#output").textContent(), "7 / 20", "Steady hold retains the calibrated simulator level.");
  await page.locator("#stop").click();
  assert.equal(await page.locator("#output").textContent(), "0 / 20");
  await selectPeakPattern(page, "auto");

  // Switching back to Loom restores the local stage even after a valid response.
  await openReaderSettings(page);
  await model.selectOption("loom");
  assert.equal(posts.length, 1);
  assert.equal(await model.inputValue(), "loom");
  assert.match(await page.locator("#level-source").textContent(), /Peak accents/i);
  await checkPeakMeter(page, 4);

  providerResult = "refused";
  await model.selectOption("nocturne");
  const declined = page.waitForResponse(response => new URL(response.url()).pathname === apiPath && response.request().method() === "POST");
  await run.click();
  assert.equal((await declined).status(), 422);
  await page.waitForFunction(() => /loom/i.test(document.querySelector("#nocturne-status")?.textContent));
  assert.ok(!(await status.textContent()).includes(canary), "The UI does not echo upstream error text.");
  assert.equal(await page.locator("#analysis-status").getAttribute("data-state"), "ready", "Refusal retains the local mapping.");
  assert.match(await page.locator("#output").textContent(), /^0\s*\/\s*20$/);

  providerResult = "pending";
  const pending = page.waitForRequest(request => new URL(request.url()).pathname === apiPath && request.method() === "POST");
  await run.click();
  await pending;
  assert.ok(await run.isDisabled(), "The in-flight request cannot be duplicated.");
  await page.locator("#stop").click();
  releasePending?.();
  await model.selectOption("loom");
  assert.equal(await model.inputValue(), "loom");
  assert.equal(await page.locator("#analysis-status").getAttribute("data-state"), "ready");
  assert.match(await page.locator("#level-source").textContent(), /Peak accents/i);
  await context.close();

  configured = false;
  const offline = await testPage();
  const before = posts.length;
  await offline.model.selectOption("nocturne");
  await offline.page.waitForFunction(() => /unavailable|not configured|isn.t enabled|not enabled/i.test(document.querySelector("#nocturne-status")?.textContent));
  assert.equal(await offline.page.locator("#nocturne-run").textContent(), "Check availability");
  await offline.page.locator("#nocturne-run").click();
  await offline.page.waitForFunction(() => /unavailable/i.test(document.querySelector("#nocturne-status")?.textContent));
  assert.equal(await offline.page.locator("#analysis-status").getAttribute("data-state"), "ready");
  assert.equal(posts.length, before);
  await offline.context.close();

  assert.deepEqual(errors, [], "No reader runtime errors.");
  assert.deepEqual(external, [], "No external browser calls.");
  assert.equal(leaked, false, "No browser request contains the story canary.");
  console.log(`Nocturne browser checks passed in Chromium ${browser.version()}: explicit opt-in, cue-only requests, protected exclusions, 7/20 Nocturne versus 4/20 Loom peak at four seconds with the same settings, explicit steady selection/hold, refusal fallback, Stop, and unavailable state.`);
} finally {
  releasePending?.();
  await browser.close();
}
