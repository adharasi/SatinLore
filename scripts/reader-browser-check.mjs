// Browser-level workspace checks use neutral fixtures and simulated output only.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const evidence = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/frontend");
const libraryKey = "satinlore.library.v1";
const neutralStory = Array.from({length: 8}, (_, index) =>
  `Section ${index + 1}. ` + "An ordinary walk passed the library, garden and station. ".repeat(7)).join("\n\n");

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", {bubbles: true}));
  }, value);
}
async function output(page, level) {
  await page.waitForFunction(value => document.querySelector("#output").textContent === `${value} / 20`, level);
}
async function current(page, index) {
  await page.waitForFunction(value => document.querySelector(".story-paragraph.active")?.dataset.index === String(value), index);
}
async function analysed(page) {
  await page.waitForFunction(() => document.querySelector("#analysis-status").dataset.state === "ready");
}
async function openSettings(page) {
  if (await page.locator("#settings-panel").isHidden()) await page.locator("#toggle-settings").click();
  await page.locator("#reading-appearance").waitFor({state: "visible"});
}
async function closeSettings(page) {
  if (await page.locator("#settings-panel").isVisible()) await page.locator("#close-settings").click();
}
async function openReview(page) {
  await openSettings(page);
  if (!await page.locator("#review-settings").evaluate(element => element.open)) {
    await page.locator("#review-settings > summary").click();
  }
  await page.waitForFunction(() => document.querySelectorAll("#review-list [data-review-index]").length > 0);
}
async function openLibrary(page) {
  if (await page.locator("#library-panel").isHidden()) await page.locator("#toggle-library").click();
}
async function newDialog(page) {
  if (await page.locator("#empty-new-story").isVisible()) await page.locator("#empty-new-story").click();
  else { await openLibrary(page); await page.locator("#new-story").click(); }
  await page.locator("#new-story-dialog").waitFor({state: "visible"});
}
async function add(page, text, title = "A quiet afternoon", waitForAnalysis = true) {
  await newDialog(page);
  await page.locator("#story-title-input").fill(title);
  await page.locator("#source").fill(text);
  await page.locator("#load").click();
  await page.locator("#new-story-dialog").waitFor({state: "hidden"});
  await page.locator("#reading-workspace").waitFor({state: "visible"});
  assert.equal(await page.locator("#story-title").textContent(), title);
  assert.equal(await page.locator("#settings-panel").isHidden(), true, "A new story opens directly into reading with settings closed.");
  if (waitForAnalysis) await analysed(page);
}
async function selectStory(page, title) {
  await closeSettings(page);
  await openLibrary(page);
  await page.locator("#story-list button[data-story-id]").filter({hasText: title}).click();
  await page.waitForFunction(value => document.querySelector("#story-title").textContent === value, title);
  await analysed(page);
}
async function start(page, confirm = true) {
  await page.locator("#start").click();
  await page.locator("#start-dialog").waitFor({state: "visible"});
  assert.match(await page.locator("#start-summary").textContent(), /Simulator/);
  const cap = (await page.locator("#capValue").textContent()).trim();
  assert.match(await page.locator("#confirm-start").textContent(), new RegExp(`maximum ${cap}\\s*\\/\\s*20`, "i"));
  if (confirm) {
    await page.locator("#confirm-start").click();
    await page.locator("#start-dialog").waitFor({state: "hidden"});
  }
}
async function save(page) {
  await openLibrary(page);
  await page.locator("#save-story").click();
  await page.locator("#save-dialog").waitFor({state: "visible"});
  await page.locator("#confirm-save").click();
  await page.waitForFunction(() => document.querySelector("#save-status").dataset.state === "saved");
}
async function scrollTo(page, index) {
  await page.evaluate(value => {
    const paragraph = document.querySelector(`.story-paragraph[data-index="${value}"]`);
    const dock = document.querySelector("#transport").getBoundingClientRect();
    const header = document.querySelector(".workspace-header").getBoundingClientRect();
    const top = Math.max((visualViewport?.offsetTop || 0) + 16, header.bottom + 16);
    const bottom = Math.max(top + 48, Math.min(innerHeight - 16, dock.top - 16));
    window.scrollBy(0, paragraph.getBoundingClientRect().top - (top + (bottom - top) * .35) + 30);
  }, index);
}
async function assertFits(page, label, stopSelector = "#stop") {
  const overflow = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth + 1,
    elements: Array.from(document.querySelectorAll("body *")).filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && (box.left < -1 || box.right > innerWidth + 1);
    }).slice(0, 12).map(element => ({tag: element.tagName, id: element.id, width: Math.round(element.getBoundingClientRect().width)})),
  }));
  assert.ok(overflow.fits, `${label}: no horizontal page overflow. ${JSON.stringify(overflow.elements)}`);
  assert.ok(await page.locator(stopSelector).evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.width >= 44 && box.height >= 44 && box.top >= 0 && box.bottom <= innerHeight + 1 &&
      box.left >= 0 && box.right <= innerWidth + 1;
  }), `${label}: Stop must be reachable with a 44px target.`);
}
async function appearanceChecks(page) {
  await page.emulateMedia({colorScheme: "dark"});
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.evaluate(() => localStorage.length), 0, "Default appearance and library do not write storage.");
  await openSettings(page);
  assert.equal(await page.locator("#reading-appearance").inputValue(), "system");
  await page.locator("#reading-appearance").selectOption("light");
  await page.emulateMedia({colorScheme: "light"});
  await page.emulateMedia({colorScheme: "dark"});
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light", "Explicit preference wins over OS.");
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await openSettings(page);
  await page.locator("#reading-appearance").selectOption("system");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.emulateMedia({colorScheme: "light"});
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.locator("#reading-appearance").selectOption("light");
  await closeSettings(page);
}

async function captureLayouts(page) {
  await mkdir(evidence, {recursive: true});
  await openSettings(page);
  await page.locator("#follow-scroll").uncheck();
  await page.locator("#font-size").selectOption("normal");
  await page.locator("#reading-width").selectOption("wide");
  await closeSettings(page);
  await page.locator("#previous").evaluate(element => { while (!element.disabled) element.click(); });
  for (const [name, size] of [["desktop", {width: 1440, height: 1000}], ["phone", {width: 390, height: 844}]]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(100);
    for (const theme of ["light", "dark"]) {
      await openSettings(page);
      await page.locator("#reading-appearance").selectOption(theme);
      await closeSettings(page);
      if (name === "desktop") await openLibrary(page);
      else if (await page.locator("#library-panel").isVisible()) await page.locator("#close-library").click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertFits(page, `${name}/${theme}`);
      await page.screenshot({path: path.join(evidence, `${name}-${theme}.png`), animations: "disabled"});
    }
  }
  await page.setViewportSize({width: 320, height: 844});
  await page.waitForTimeout(100);
  await page.clock.runFor(100);
  await assertFits(page, "320px reflow");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const end = await page.locator(".story-paragraph").last().evaluate(element => ({
    bottom: element.getBoundingClientRect().bottom,
    dockTop: document.querySelector("#transport").getBoundingClientRect().top,
  }));
  assert.ok(end.bottom <= end.dockTop + 1, `The final line must be reachable above the dock: ${JSON.stringify(end)}`);
  await openLibrary(page); await assertFits(page, "320px library drawer");
  await page.locator("#close-library").click();
  await openSettings(page); await assertFits(page, "320px settings sheet");
  await closeSettings(page);
  for (const size of [{width: 844, height: 390}, {width: 390, height: 844}, {width: 320, height: 844}]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(100);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.clock.runFor(100);
    await assertFits(page, `${size.width}×${size.height} at 200% text`);
    await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.waitForTimeout(100);
  await openReview(page);
  await page.locator("#reading-appearance").selectOption("dark");
  await page.screenshot({path: path.join(evidence, "settings-dark.png"), animations: "disabled"});
  await closeSettings(page);
  await start(page, false);
  await assertFits(page, "Start confirmation", "#start-stop");
  await page.screenshot({path: path.join(evidence, "start-confirmation.png"), animations: "disabled"});
  await page.locator("#cancel-start").click();
}

async function analysisChecks(page) {
  // Inject scheduling/failure into the real local model without adding a
  // production test endpoint or exposing story content to a server.
  await page.evaluate(async () => {
    const {ReaderModel} = await import("/static/reader/model.mjs");
    const original = ReaderModel.prototype.analyse;
    globalThis.__restoreAnalysis = () => { ReaderModel.prototype.analyse = original; };
    ReaderModel.prototype.analyse = function (options = {}) {
      if (this.paragraphs[0]?.text.startsWith("DELAYED_ANALYSIS")) {
        return original.call(this, {...options, yieldTask: () => new Promise(resolve => { globalThis.__finishAnalysis = resolve; })});
      }
      if (this.paragraphs[0]?.text.startsWith("FAILED_ANALYSIS")) {
        return original.call(this, {...options, score: () => { throw new Error("Fixture analysis failure"); }});
      }
      return original.call(this, options);
    };
  });
  await add(page, "DELAYED_ANALYSIS. A tender embrace.", "Pending analysis", false);
  await page.waitForFunction(() => typeof globalThis.__finishAnalysis === "function");
  assert.match(await page.locator(".story-paragraph").textContent(), /A tender embrace/);
  await page.locator("#connect").click();
  assert.equal(await page.locator("#start").isDisabled(), true, "Silent reading remains available while mapping is pending.");
  await openLibrary(page);
  await page.locator("#story-list button[data-story-id]").filter({hasText: "Pending analysis"}).click();
  await page.evaluate(() => globalThis.__finishAnalysis()); await analysed(page);
  await start(page); await output(page, 1); await page.locator("#stop").click();
  await add(page, "DELAYED_ANALYSIS. An ordinary walk.", "Stale analysis", false);
  await page.waitForFunction(() => document.querySelector("#analysis-status").dataset.state === "analysing");
  await add(page, "A new story replaces the active session.", "Newer story");
  await page.evaluate(() => globalThis.__finishAnalysis());
  await page.clock.runFor(100);
  assert.equal(await page.locator("#story-title").textContent(), "Newer story", "Late analysis cannot change the active story.");
  await output(page, 0);
  await add(page, "FAILED_ANALYSIS. Still readable.", "Failed analysis", false);
  await page.waitForFunction(() => document.querySelector("#analysis-status").dataset.state === "error");
  assert.equal(await page.locator("#start").isDisabled(), true);
  assert.equal(await page.locator(".story-paragraph").textContent(), "FAILED_ANALYSIS. Still readable.");
  await output(page, 0);
  await page.evaluate(() => globalThis.__restoreAnalysis());
  await openReview(page); await page.locator("#reanalyze").click(); await analysed(page); await closeSettings(page);
  await output(page, 0);
}

async function storageFailureChecks(context, origin) {
  const restricted = await context.newPage();
  const errors = [];
  restricted.on("pageerror", error => errors.push(error.message));
  await restricted.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {get() { throw new DOMException("Storage blocked", "SecurityError"); }});
  });
  await restricted.goto(origin);
  await add(restricted, "An ordinary walk.", "Storage unavailable");
  await openLibrary(restricted); await restricted.locator("#save-story").click();
  await restricted.locator("#confirm-save").click();
  await restricted.waitForFunction(() => document.querySelector("#save-status").dataset.state === "error");
  assert.equal(await restricted.locator(".story-paragraph").textContent(), "An ordinary walk.");
  await openSettings(restricted);
  await restricted.locator("#reading-appearance").selectOption("dark");
  assert.equal(await restricted.locator("html").getAttribute("data-theme"), "dark");
  assert.deepEqual(errors, [], "Storage denial must be handled without runtime errors.");
  await restricted.close();
}

export async function checkReader(page, context, origin) {
  await page.clock.install();
  let promptReply = "Renamed afternoon";
  page.on("dialog", dialog => dialog.type() === "prompt" ? dialog.accept(promptReply) : dialog.accept());
  const requests = [];
  const monitor = request => {
    if (/READER_PRIVATE_CANARY|A%20tender%20embrace|A tender embrace/.test(request.url() + (request.postData() || ""))) {
      requests.push(new URL(request.url()).pathname);
    }
  };
  page.on("request", monitor);
  await page.goto(origin);
  await appearanceChecks(page);
  assert.equal(await page.locator("body").getAttribute("data-reading-width"), "wide");
  assert.equal(await page.locator("#settings-panel").isHidden(), true);
  await analysisChecks(page);
  await add(page, "A tender embrace.\n\nAn ordinary walk.", "First story");
  await output(page, 0);
  assert.equal(await page.locator("#review-settings").evaluate(element => element.open), false, "Review is optional and closed.");
  await openReview(page);
  assert.equal(await page.locator("#suggested-level").textContent(), "1 / 20");
  assert.equal(await page.locator("#review-list [data-review-index]").count(), 1, "Review does not expose future passages by default.");
  await page.locator("#show-upcoming").click();
  assert.equal(await page.locator("#review-list [data-review-index]").count(), 2);
  await setRange(page, "level", 0);
  await page.locator("#reanalyze").click();
  await analysed(page);
  assert.equal(await page.locator("#level").inputValue(), "0", "Reanalysis preserves manual zero.");
  await page.locator("#reset-level").click();
  assert.equal(await page.locator("#level").inputValue(), "1");
  await closeSettings(page);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ["satinlore.appearance"], "Import and analysis do not opt into persistence.");

  await add(page, neutralStory, "The afternoon walk");
  await openReview(page);
  await page.locator("#follow-scroll").uncheck();
  await setRange(page, "level", 3);
  await closeSettings(page);
  if (!await page.locator("#connect").isDisabled()) await page.locator("#connect").click();
  await start(page, false);
  await output(page, 0);
  await page.locator("#cancel-start").click();
  await output(page, 0);
  await start(page, false);
  await page.locator("#start-stop").click();
  await page.locator("#start-dialog").waitFor({state: "hidden"});
  await output(page, 0);
  await start(page);
  await output(page, 3);
  for (let i = 0; i < 5; i++) await page.locator("#strength-plus").click();
  assert.equal(await page.locator("#strength-value").textContent(), "1.5×");
  await page.clock.runFor(1100);
  await output(page, 4);
  assert.equal(await page.locator("#capValue").textContent(), "5");
  await page.locator("#strength-minus").click();
  await output(page, 4); // 3 × 1.4 still rounds down to 4.
  await page.locator("#strength-minus").click();
  await output(page, 0); // A lower resulting command stops the old one immediately.
  await page.clock.runFor(1100); await output(page, 3);
  await page.locator("#strength-reset").click();
  await page.clock.runFor(1100); await output(page, 3);
  await setRange(page, "cap", 0);
  await output(page, 0); await page.clock.runFor(1100); await output(page, 0);
  await setRange(page, "cap", 5);
  await page.locator("#ceiling-dialog").waitFor({state: "visible"});
  assert.equal(await page.locator("#capValue").textContent(), "0", "Proposed maximum is not active before confirmation.");
  await page.locator("#cancel-ceiling").click();
  assert.equal(await page.locator("#cap").inputValue(), "0");
  await setRange(page, "cap", 5);
  await page.locator("#confirm-ceiling").click();
  await output(page, 0);
  await start(page); await output(page, 3);
  await page.locator("#pause").click(); await output(page, 0);
  await page.locator("#strength-plus").click();
  await page.clock.runFor(1100); await output(page, 0);
  await start(page); await output(page, 3);
  await page.locator("#stop").click();
  assert.equal(await page.locator("#strength-value").textContent(), "1.1×", "Pause and Stop retain session strength.");
  await page.clock.runFor(1100); await output(page, 0);

  await openReview(page); await setRange(page, "level", 0); await closeSettings(page);
  for (let i = 0; i < 12; i++) if (!await page.locator("#strength-plus").isDisabled()) await page.locator("#strength-plus").click();
  assert.equal(await page.locator("#strength-value").textContent(), "2.0×");
  assert.equal(await page.locator("#strength-plus").isDisabled(), true);
  await start(page); await page.clock.runFor(1100); await output(page, 0);
  await openReview(page); await setRange(page, "level", 3); await closeSettings(page);
  await start(page); await page.clock.runFor(1100); await output(page, 5);
  assert.equal(await page.locator("#target-output").textContent(), "5 / 20", "Strength cannot exceed the confirmed maximum.");
  for (let i = 0; i < 20; i++) await page.locator("#strength-minus").click();
  assert.equal(await page.locator("#strength-value").textContent(), "0.0×");
  assert.equal(await page.locator("#strength-minus").isDisabled(), true);
  assert.equal(await page.locator("#capValue").textContent(), "5", "Strength changes do not alter the confirmed ceiling.");
  await page.clock.runFor(1100); await output(page, 0);
  await openReview(page);
  assert.equal(await page.locator("#level").inputValue(), "3", "Session strength never rewrites the paragraph correction.");
  await closeSettings(page);
  await page.locator("#strength-reset").click();

  await openSettings(page); await page.locator("#follow-scroll").check(); await closeSettings(page);
  await scrollTo(page, 2); await page.clock.runFor(300); await current(page, 2);
  await scrollTo(page, 3); await scrollTo(page, 6); await page.clock.runFor(300); await current(page, 6);
  await openReview(page); await current(page, 6);
  assert.equal(await page.locator("#review-list [data-review-index]").count(), 7, "Review includes current and read sections without revealing the last future section.");
  await page.locator("#level").focus(); await page.locator("#level").press("Home");
  assert.equal(await page.locator("#level").inputValue(), "0");
  await setRange(page, "level", 3);
  await page.locator("#reading-width").selectOption("full");
  await current(page, 6);
  assert.equal(await page.locator("body").getAttribute("data-reading-width"), "full");
  await page.locator("#font-size").selectOption("large");
  await page.locator("#reading-spacing").selectOption("relaxed");
  await page.locator("#reading-appearance").selectOption("dark");
  await current(page, 6); await output(page, 0);
  await closeSettings(page);
  await openLibrary(page);
  await page.locator("#focus-mode").click();
  assert.equal(await page.locator("#library-panel").isHidden(), true);
  assert.equal(await page.locator("#settings-panel").isHidden(), true);
  await current(page, 6);
  await page.locator("#focus-mode").click();
  assert.equal(await page.locator("#library-panel").isVisible(), true, "Exiting focus restores the prior library arrangement.");
  await current(page, 6);
  await page.locator("#next").click(); await current(page, 7);
  await page.locator("#previous").click(); await current(page, 6);
  await start(page); await output(page, 3);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await output(page, 0);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(1100); await output(page, 0);
  await start(page); await output(page, 3);
  await page.clock.fastForward(120_100); await output(page, 0);
  assert.match(await page.locator("#message").textContent(), /inactivity|two minutes/i);

  const holder = await context.newPage();
  await holder.goto(origin);
  await holder.evaluate(() => {
    navigator.locks.request("satinlore-simulator-playback", async () => {
      await new Promise(release => { globalThis.__releaseReaderLock = release; });
    });
  });
  await holder.waitForFunction(() => typeof globalThis.__releaseReaderLock === "function");
  await page.bringToFront(); await start(page);
  await page.waitForFunction(() => document.querySelector("#message").textContent.includes("Another tab"));
  await output(page, 0);
  await holder.evaluate(() => globalThis.__releaseReaderLock()); await holder.close();
  await page.evaluate(() => {
    const original = navigator.locks.request.bind(navigator.locks);
    globalThis.__restoreReaderLock = () => { navigator.locks.request = original; };
    navigator.locks.request = (name, options, callback) => name !== "satinlore-simulator-playback" ? original(name, options, callback) : original(name, options, lock =>
      new Promise(resolve => { globalThis.__finishReaderLock = () => resolve(callback(lock)); }));
  });
  await start(page);
  await page.waitForFunction(() => typeof globalThis.__finishReaderLock === "function");
  await page.locator("#stop").click();
  await page.evaluate(() => { globalThis.__finishReaderLock(); globalThis.__restoreReaderLock(); });
  await page.clock.runFor(1100); await output(page, 0);

  await captureLayouts(page);
  await openSettings(page); await page.locator("#follow-scroll").uncheck(); await closeSettings(page);
  await openLibrary(page); await page.locator("#rename-story").click();
  assert.equal(await page.locator("#story-title").textContent(), promptReply);
  await save(page);
  await page.locator("#next").evaluate(element => { if (!element.disabled) element.click(); });
  await page.clock.runFor(500);
  const savedPosition = Number(await page.locator(".story-paragraph.active").getAttribute("data-index"));
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).stories[0].position ===
    Number(document.querySelector(".story-paragraph.active").dataset.index), libraryKey);
  const savedId = await page.locator("#story-list button[data-story-id]").filter({hasText: promptReply}).getAttribute("data-story-id");
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).stories.length, libraryKey), 1);
  await start(page);
  await page.locator("#strength-plus").click();
  await selectStory(page, "First story");
  await output(page, 0);
  assert.equal(await page.locator("#strength-value").textContent(), "1.0×", "Story switching resets strength without starting output.");
  await selectStory(page, promptReply); await current(page, savedPosition);
  await add(page, "READER_PRIVATE_CANARY\n\nAn ordinary walk.", "Session only canary");
  assert.deepEqual(requests, [], "Story text must never appear in network requests.");
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).stories.length, libraryKey), 1);
  await page.reload(); await analysed(page); await current(page, savedPosition);
  assert.equal(await page.locator("#story-title").textContent(), promptReply);
  assert.equal(await page.locator("#strength-value").textContent(), "1.0×");
  await output(page, 0);
  assert.equal(await page.locator("#start").isDisabled(), true, "Restoration does not reconnect or arm playback.");
  assert.equal(await page.locator("#story-list button[data-story-id]").count(), 1, "Session-only stories disappear on reload.");
  assert.equal(await page.locator("#story-list button[data-story-id]").getAttribute("data-story-id"), savedId);
  await openReview(page); await setRange(page, "level", 0); await closeSettings(page);
  await page.clock.runFor(500);
  await page.reload(); await analysed(page); await openReview(page);
  assert.equal(await page.locator("#level").inputValue(), "0", "Saved manual zero survives reload and reanalysis.");
  assert.match(await page.locator("#level-source").textContent(), /manual|your/i, "Restored zero remains a correction rather than an unset value.");
  await closeSettings(page);
  await add(page, "A second saved story.", "Second saved story"); await save(page);
  await openLibrary(page); await page.locator("#delete-story").click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).stories.length === 1, libraryKey);
  await page.reload(); await analysed(page);
  assert.equal(await page.locator("#story-list button[data-story-id]").count(), 1);
  await openLibrary(page); await page.locator("#session-only").click();
  await page.waitForFunction(key => !localStorage.getItem(key) || JSON.parse(localStorage.getItem(key)).stories.length === 0, libraryKey);
  assert.equal(await page.locator(".story-paragraph").count(), 8, "Session only removes the saved copy but keeps text readable.");
  await save(page);
  await openLibrary(page); await page.locator("#delete-all").click();
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await page.reload(); assert.equal(await page.locator(".story-paragraph").count(), 0);

  await page.evaluate(key => localStorage.setItem(key, "{invalid"), libraryKey);
  await page.reload();
  assert.equal(await page.locator(".story-paragraph").count(), 0);
  await page.waitForFunction(() => /corrupt|unreadable|could not|cannot be read|invalid|damaged/i.test(document.querySelector("#library-status").textContent));
  await openLibrary(page); await page.locator("#delete-all").click();
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    globalThis.__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, libraryKey);
  await add(page, "Still readable after a failed save.", "Quota fixture");
  await openLibrary(page); await page.locator("#save-story").click(); await page.locator("#confirm-save").click();
  await page.waitForFunction(() => document.querySelector("#save-status").dataset.state === "error");
  assert.equal(await page.locator(".story-paragraph").textContent(), "Still readable after a failed save.");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), null);
  await page.evaluate(() => globalThis.__restoreStorage());
  await save(page);
  // Hold the real browser library lock to exercise the in-flight destructive
  // operation. New stories must not be accepted and then silently lost.
  await page.evaluate(() => {
    const original = navigator.locks.request.bind(navigator.locks);
    globalThis.__restoreDeleteLock = () => { navigator.locks.request = original; };
    navigator.locks.request = (name, ...args) => {
      if (name !== "satinlore-local-library") return original(name, ...args);
      const callback = args.at(-1);
      return original(name, async lock => {
        await new Promise(resolve => { globalThis.__finishDelete = resolve; });
        return callback(lock);
      });
    };
  });
  await openLibrary(page); await page.locator("#delete-all").click();
  await page.waitForFunction(() => typeof globalThis.__finishDelete === "function");
  assert.equal(await page.locator("#new-story").isDisabled(), true, "New stories are unavailable until Delete All completes.");
  assert.equal(await page.locator("#empty-new-story").isDisabled(), true);
  assert.equal(await page.locator("#story-list button[data-story-id]:not(:disabled)").count(), 0);
  await page.evaluate(() => { globalThis.__finishDelete(); globalThis.__restoreDeleteLock(); });
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await page.waitForFunction(() => !document.querySelector("#new-story").disabled);

  const literal = '<img src="invalid" onerror="globalThis.__storyExecuted=true">';
  await add(page, literal, "Literal text");
  assert.equal(await page.locator("#paragraph img").count(), 0);
  assert.equal(await page.locator(".story-paragraph").textContent(), literal);
  assert.equal(await page.evaluate(() => globalThis.__storyExecuted), undefined);
  await newDialog(page);
  await page.locator("#file").setInputFiles({name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from([0xff])});
  await page.waitForFunction(() => /UTF-8/.test(document.querySelector("#import-status").textContent));
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "delayed.txt") return original.call(this);
      return new Promise(resolve => { globalThis.__finishReaderImport = () => original.call(this).then(resolve); });
    };
  });
  await page.locator("#file").setInputFiles({name: "delayed.txt", mimeType: "text/plain", buffer: Buffer.from("A delayed story.")});
  await page.waitForFunction(() => typeof globalThis.__finishReaderImport === "function");
  await page.locator("#cancel-import").click();
  await page.evaluate(() => globalThis.__finishReaderImport());
  await page.clock.runFor(300);
  assert.equal(await page.locator("#story-title").textContent(), "Literal text", "Closing import invalidates its delayed completion.");
  await storageFailureChecks(context, origin);
  await page.bringToFront();
  assert.deepEqual(await page.evaluate(() => ({local: Object.keys(localStorage), session: sessionStorage.length})),
    {local: ["satinlore.appearance"], session: 0}, "Only allowlisted appearance remains after local deletion.");
  assert.deepEqual(requests, []);
  page.off("request", monitor);
  console.log("Reader browser checks passed: direct workspace, optional review, confirmed Start/ceiling, bounded session strength, sidebar/focus reflow, opt-in persistence and deletion, storage failures, interruption/locks, literal text and local-only privacy. Neutral workspace screenshots captured.");
}
