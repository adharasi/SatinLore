// Browser-level checks use neutral fixtures and the local simulator only.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const evidence = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/frontend");

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

async function view(page, name) {
  await page.waitForFunction(value => document.body.dataset.view === value &&
    !document.querySelector(`#view-${value}`).hidden, name);
}

async function add(page, text) {
  await page.locator("#step-add").click();
  await page.locator("#source").fill(text);
  await page.locator("#load").click();
  await view(page, "review");
}

async function read(page) {
  await page.locator("#begin-reading").click();
  await view(page, "read");
  await page.locator("#adjustments").evaluate(element => { element.open = true; });
  await page.clock.runFor(50);
}

async function load(page, text) {
  await add(page, text);
  await read(page);
  await current(page, 0);
}

async function scrollTo(page, index) {
  await page.evaluate(value => {
    const paragraph = document.querySelector(`.story-paragraph[data-index="${value}"]`);
    const dock = document.querySelector("#transport").getBoundingClientRect();
    const top = (visualViewport?.offsetTop || 0) + 16;
    let bottom = Math.min(innerHeight, (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight)) - 16;
    if (innerWidth < 1100) bottom = Math.min(bottom, dock.top - 16);
    bottom = Math.max(top + 48, bottom);
    window.scrollBy(0, paragraph.getBoundingClientRect().top - (top + (bottom - top) * .35) + 30);
  }, index);
}

async function assertFits(page, label) {
  const overflow = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth + 1,
    elements: Array.from(document.querySelectorAll("body *")).filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && (box.left < -1 || box.right > innerWidth + 1);
    }).slice(0, 12).map(element => ({tag: element.tagName, id: element.id, width: Math.round(element.getBoundingClientRect().width)})),
  }));
  assert.ok(overflow.fits, `${label}: no horizontal page overflow. ${JSON.stringify(overflow.elements)}`);
  assert.ok(await page.locator("#stop").evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.width >= 44 && box.height >= 44 && box.top >= 0 && box.bottom <= innerHeight + 1 &&
      box.left >= 0 && box.right <= innerWidth + 1;
  }), `${label}: Stop must be reachable with a 44px target.`);
}

async function appearanceChecks(page, context, origin) {
  await page.emulateMedia({colorScheme: "dark"});
  await page.goto(origin);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", "System follows OS on first visit.");
  assert.equal(await page.locator("#appearance").inputValue(), "system");
  assert.equal(await page.evaluate(() => localStorage.length), 0, "Default appearance does not write storage.");
  await page.locator("#appearance").selectOption("light");
  await page.emulateMedia({colorScheme: "light"});
  await page.emulateMedia({colorScheme: "dark"});
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light", "Explicit preference wins over OS.");
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.equal(await page.locator("#appearance").inputValue(), "light");
  await page.locator("#appearance").selectOption("system");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.emulateMedia({colorScheme: "light"});
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.locator("#appearance").selectOption("light");

  const restricted = await context.newPage();
  const failures = [];
  restricted.on("pageerror", error => failures.push(error.message));
  await restricted.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {get() { throw new DOMException("Storage blocked", "SecurityError"); }});
  });
  await restricted.emulateMedia({colorScheme: "dark"});
  await restricted.goto(origin);
  assert.equal(await restricted.locator("html").getAttribute("data-theme"), "dark");
  await restricted.locator("#appearance").selectOption("light");
  assert.equal(await restricted.locator("html").getAttribute("data-theme"), "light", "Blocked storage must not block an in-memory choice.");
  await restricted.locator("#source").fill("An ordinary walk.");
  await restricted.locator("#load").click();
  await view(restricted, "review");
  assert.deepEqual(failures, []);
  await restricted.close();
  await page.bringToFront();
}

async function captureLayouts(page) {
  await mkdir(evidence, {recursive: true});
  await page.locator("#follow-scroll").uncheck();
  await page.locator("#font-size").selectOption("normal");
  await page.locator("#adjustments").evaluate(element => { element.open = false; });
  await page.locator("#previous").evaluate(element => { while (!element.disabled) element.click(); });
  for (const [name, size] of [["desktop", {width: 1440, height: 1000}], ["phone", {width: 390, height: 844}]]) {
    await page.setViewportSize(size);
    await page.clock.runFor(100);
    for (const theme of ["light", "dark"]) {
      await page.locator("#appearance").selectOption(theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertFits(page, `${name}/${theme}`);
      await page.screenshot({path: path.join(evidence, `${name}-${theme}.png`), animations: "disabled"});
    }
  }
  await page.setViewportSize({width: 320, height: 844});
  // Viewport resize notifications originate outside the installed JS clock.
  // Allow the browser's actual resize/reflow task before scrolling to the end.
  await page.waitForTimeout(100);
  await page.clock.runFor(100);
  await assertFits(page, "320px reflow");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const lastLine = await page.locator(".story-paragraph").last().evaluate(element => ({
    bottom: element.getBoundingClientRect().bottom,
    dockTop: document.querySelector("#transport").getBoundingClientRect().top,
    scroll: scrollY, height: document.documentElement.scrollHeight,
  }));
  assert.ok(lastLine.bottom <= lastLine.dockTop, `The final line must be reachable above the phone dock: ${JSON.stringify(lastLine)}`);
  await page.setViewportSize({width: 844, height: 390});
  await page.clock.runFor(100);
  await assertFits(page, "Landscape");
  await page.setViewportSize({width: 390, height: 844});
  await page.clock.runFor(100);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.clock.runFor(100);
  await assertFits(page, "200% text");
  await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
  await page.setViewportSize({width: 1440, height: 1000});
  await page.clock.runFor(100);
  await page.locator("#step-review").click();
  await page.locator("#appearance").selectOption("dark");
  await page.screenshot({path: path.join(evidence, "review-dark.png"), animations: "disabled"});
  await page.locator("#step-add").click();
  await page.locator("#appearance").selectOption("light");
  await page.screenshot({path: path.join(evidence, "add-story-light.png"), animations: "disabled"});
  await page.locator("#step-read").click();
  await page.locator("#adjustments").evaluate(element => { element.open = true; });
}

export async function checkReader(page, context, origin) {
  // Install before app code creates timers. Inactivity advances virtually.
  await page.clock.install();
  let acceptReplacement = true;
  page.on("dialog", dialog => acceptReplacement ? dialog.accept() : dialog.dismiss());
  const requests = [];
  const monitor = request => {
    const candidate = request.url() + (request.postData() || "");
    if (/READER_PRIVATE_CANARY|A%20tender%20embrace|A tender embrace/.test(candidate)) requests.push(request.url());
  };
  page.on("request", monitor);
  await appearanceChecks(page, context, origin);
  await add(page, "A tender embrace.\n\nAn ordinary walk.");
  assert.equal(await page.locator("#start").isDisabled(), true, "Review cannot start playback.");
  await setRange(page, "review-override-0", 0);
  assert.match(await page.locator("#review-source-0").textContent(), /manual|your/i);
  await read(page);
  assert.equal(await page.locator("#suggested-level").textContent(), "1 / 20");
  assert.equal(await page.locator("#level").inputValue(), "0");
  await page.locator("#next").click();
  await current(page, 1);
  await page.locator("#previous").click();
  await current(page, 0);
  assert.equal(await page.locator("#level").inputValue(), "0", "An intentional zero override must survive navigation.");
  await page.locator("#reset-level").click();
  assert.equal(await page.locator("#level").inputValue(), "1");
  await setRange(page, "level", 0);
  await page.locator("#step-add").click();
  await page.locator("#source").fill("A replacement that should not be installed.");
  acceptReplacement = false;
  await page.locator("#load").click();
  await page.waitForFunction(() => document.querySelector("#import-status").textContent.includes("Replacement cancelled"));
  await view(page, "add");
  await page.locator("#step-read").click();
  assert.equal(await page.locator("#level").inputValue(), "0", "Cancel replacement preserves manual zero.");
  assert.equal(await page.locator(".story-paragraph").first().textContent(), "A tender embrace.");
  acceptReplacement = true;

  const story = Array.from({length: 8}, (_, index) =>
    `Section ${index + 1}. ` + "An ordinary walk passed the library, garden and station. ".repeat(7)).join("\n\n");
  await load(page, story);
  assert.equal(await page.locator("#level").inputValue(), "0", "New text must not inherit old corrections.");
  await page.locator("#connect").click();
  await page.locator("#follow-scroll").uncheck();
  await setRange(page, "level", 10);
  await setRange(page, "cap", 3);
  await page.locator("#start").click();
  await output(page, 3);
  await setRange(page, "cap", 0);
  await output(page, 0);
  await page.clock.runFor(1100);
  await output(page, 0);
  await setRange(page, "cap", 1);
  await page.clock.runFor(1100);
  await output(page, 1);
  await page.locator("#pause").click();
  await output(page, 0);
  await page.locator("#start").click();
  await output(page, 1);
  await page.locator("#stop").click();
  await output(page, 0);
  await page.clock.runFor(1100);
  await output(page, 0);

  await page.locator("#start").click();
  await output(page, 1);
  // Deterministically exercise the DOM visibility handler; physical phone
  // background/foreground behaviour remains a manual browser check.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await output(page, 0);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1100);
  await output(page, 0);

  await page.locator("#follow-scroll").check();
  await page.locator("#adjustments summary").click();
  await page.clock.runFor(300);
  await scrollTo(page, 2);
  await page.clock.runFor(300);
  await current(page, 2);
  await scrollTo(page, 3);
  await scrollTo(page, 6);
  await page.clock.runFor(300);
  await current(page, 6);
  await page.locator("#adjustments summary").click();
  await page.clock.runFor(50);
  await current(page, 6);
  await page.locator("#level").focus();
  await page.locator("#level").press("Home");
  assert.equal(await page.locator("#level").inputValue(), "0", "Opening settings mid-story edits the current paragraph.");
  await page.locator("#adjustments summary").click();
  await page.clock.runFor(50);
  await current(page, 6);
  await page.locator("#next").click();
  await current(page, 7);
  await page.locator("#previous").click();
  await current(page, 6);
  await page.locator("#adjustments summary").click();
  await page.clock.runFor(50);
  assert.equal(await page.locator("#level").inputValue(), "0");
  await setRange(page, "level", 3);
  await setRange(page, "cap", 5);
  await page.locator("#start").click();
  await output(page, 3);
  await page.locator("#font-size").selectOption("large");
  await output(page, 0);
  await current(page, 6);
  assert.match(await page.locator("#status").textContent(), /paused/);
  await page.locator("#start").click();
  await output(page, 3);
  await page.locator("#reading-appearance").selectOption("dark");
  assert.equal(await page.locator("#appearance").inputValue(), "dark");
  await output(page, 0);
  await current(page, 6);
  await page.locator("#start").click();
  await output(page, 3);
  await page.setViewportSize({width: 390, height: 844});
  await output(page, 0);
  await current(page, 6);
  await assertFits(page, "Phone");
  await page.locator("#reader").focus();
  assert.equal(await page.locator("#reader").evaluate(element => element === document.activeElement), true);
  await page.setViewportSize({width: 1280, height: 900});
  await page.locator("#start").click();
  await output(page, 3);
  await page.clock.fastForward(120_100);
  await output(page, 0);
  assert.match(await page.locator("#message").textContent(), /inactivity|two minutes/i);
  await page.clock.runFor(1100);
  await output(page, 0);

  // Synthetic ownership avoids headless visibility differences between pages.
  const holder = await context.newPage();
  await holder.goto(origin);
  await holder.evaluate(() => {
    navigator.locks.request("satinlore-simulator-playback", async () => {
      await new Promise(release => { globalThis.__releaseReaderLock = release; });
    });
  });
  await holder.waitForFunction(() => typeof globalThis.__releaseReaderLock === "function");
  await page.bringToFront();
  await page.locator("#start").click();
  await page.waitForFunction(() => document.querySelector("#message").textContent.includes("Another tab"));
  await output(page, 0);
  await holder.evaluate(() => globalThis.__releaseReaderLock());
  await holder.close();
  await page.locator("#start").click();
  await output(page, 3);
  await page.locator("#step-review").click();
  await output(page, 0);
  assert.equal(await page.locator("#start").isDisabled(), true);
  await read(page);
  await output(page, 0);

  // A delayed lock callback must not begin playback after Stop.
  await page.evaluate(() => {
    const original = navigator.locks.request.bind(navigator.locks);
    globalThis.__restoreReaderLock = () => { navigator.locks.request = original; };
    navigator.locks.request = (name, options, callback) => original(name, options, lock =>
      new Promise(resolve => { globalThis.__finishReaderLock = () => resolve(callback(lock)); }));
  });
  await page.locator("#start").click();
  await page.waitForFunction(() => typeof globalThis.__finishReaderLock === "function");
  await page.locator("#stop").click();
  await page.evaluate(() => { globalThis.__finishReaderLock(); globalThis.__restoreReaderLock(); });
  await page.clock.runFor(1100);
  await output(page, 0);

  await captureLayouts(page);
  await scrollTo(page, 4);
  await page.locator("#clear").click();
  await page.clock.runFor(300);
  assert.equal(await page.locator(".story-paragraph").count(), 0);
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator("#start").isDisabled(), true);

  const literal = '<img src="invalid" onerror="globalThis.__storyExecuted=true">';
  await load(page, literal);
  assert.equal(await page.locator("#paragraph img").count(), 0);
  assert.equal(await page.locator(".story-paragraph").textContent(), literal);
  assert.equal(await page.evaluate(() => globalThis.__storyExecuted), undefined);
  await page.locator("#step-add").click();
  await page.locator("#file").setInputFiles({name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from([0xff])});
  await page.waitForFunction(() => document.querySelector("#message").textContent.includes("UTF-8"));

  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "delayed.txt") return original.call(this);
      return new Promise(resolve => {
        globalThis.__finishReaderImport = () => original.call(this).then(resolve);
      });
    };
  });
  await page.locator("#file").setInputFiles({name: "delayed.txt", mimeType: "text/plain", buffer: Buffer.from("An ordinary walk.")});
  await page.waitForFunction(() => typeof globalThis.__finishReaderImport === "function");
  await page.locator("#clear").click();
  await page.evaluate(() => globalThis.__finishReaderImport());
  await page.clock.runFor(300);
  assert.equal(await page.locator(".story-paragraph").count(), 0, "Clear must invalidate the delayed import.");
  assert.deepEqual(await page.evaluate(() => ({local: Object.keys(localStorage), session: sessionStorage.length})),
    {local: ["satinlore.appearance"], session: 0}, "Only the explicit appearance preference may be persisted.");
  await load(page, `READER_PRIVATE_CANARY\n\n${story}`);
  assert.deepEqual(requests, [], "Reader text must not appear in network requests.");
  await page.reload();
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator(".story-paragraph").count(), 0);
  await view(page, "add");
  page.off("request", monitor);
  console.log("Reader browser checks passed: themes/system/storage denial, Add/Review/Read, replacement cancellation, manual zero, document scrolling, ceilings/Pause/Stop, reflow, inactivity, lock cancellation, literal text and memory-only privacy. Neutral layout screenshots captured.");
}
