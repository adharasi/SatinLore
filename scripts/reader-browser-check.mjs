// Browser-level reader checks. Only neutral fixtures and the local simulator.
import assert from "node:assert/strict";

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

async function load(page, text) {
  await page.locator("#source").fill(text);
  await page.locator("#load").click();
  await current(page, 0);
}

async function scrollTo(page, index) {
  await page.evaluate(value => {
    const panel = document.querySelector("#reader");
    const paragraph = document.querySelector(`.story-paragraph[data-index="${value}"]`);
    panel.scrollTop += paragraph.getBoundingClientRect().top - panel.getBoundingClientRect().top -
      panel.clientTop - panel.clientHeight * .35 + 30;
  }, index);
}

export async function checkReader(page, context, origin) {
  // Install before app code creates timers. Fast-forwarding later tests inactivity.
  await page.clock.install();
  const requests = [];
  const monitor = request => {
    const candidate = request.url() + (request.postData() || "");
    if (/READER_PRIVATE_CANARY|A%20tender%20embrace|A tender embrace/.test(candidate)) requests.push(request.url());
  };
  page.on("request", monitor);
  await page.goto(origin);
  await load(page, "A tender embrace.\n\nAn ordinary walk.");
  assert.equal(await page.locator("#suggested-level").textContent(), "1 / 20");
  await setRange(page, "level", 0);
  assert.match(await page.locator("#level-source").textContent(), /manual/);
  await page.locator("#next").click();
  await current(page, 1);
  await page.locator("#previous").click();
  await current(page, 0);
  assert.equal(await page.locator("#level").inputValue(), "0", "An intentional zero override must survive navigation.");
  await page.locator("#reset-level").click();
  assert.equal(await page.locator("#level").inputValue(), "1");

  const story = Array.from({length: 8}, (_, index) =>
    `READER_PRIVATE_CANARY ${index + 1}. ` + "An ordinary walk passed the library, garden and station. ".repeat(7)).join("\n\n");
  await load(page, story);
  assert.equal(await page.locator("#level").inputValue(), "0", "New text must not inherit old corrections.");
  await page.locator("#connect").click();
  await page.locator("#follow-scroll").uncheck();
  await setRange(page, "level", 10);
  await setRange(page, "cap", 3);
  await page.locator("#start").click();
  await output(page, 3);
  await setRange(page, "cap", 1);
  await output(page, 0);
  await page.clock.runFor(1100);
  await output(page, 1);
  await page.locator("#stop").click();
  await output(page, 0);
  await page.clock.runFor(1100);
  await output(page, 0);

  await page.locator("#follow-scroll").check();
  await page.clock.runFor(300);
  await scrollTo(page, 2);
  await page.clock.runFor(300);
  await current(page, 2);
  await scrollTo(page, 3);
  await scrollTo(page, 6);
  await page.clock.runFor(300);
  await current(page, 6);
  await setRange(page, "level", 3);
  await setRange(page, "cap", 5);
  await page.locator("#start").click();
  await output(page, 3);
  await page.locator("#font-size").selectOption("large");
  await output(page, 0);
  assert.match(await page.locator("#status").textContent(), /paused/);
  await page.locator("#start").click();
  await output(page, 3);
  await page.setViewportSize({width: 390, height: 844});
  await output(page, 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Reader must fit a mobile viewport.");
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

  // The lock is held without a playing tab, avoiding headless focus differences.
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
  await page.locator("#stop").click();

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
  assert.deepEqual(await page.evaluate(() => ({local: localStorage.length, session: sessionStorage.length})), {local: 0, session: 0});
  assert.deepEqual(requests, [], "Reader text must not appear in network requests.");
  await load(page, story);
  await page.reload();
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.equal(await page.locator(".story-paragraph").count(), 0);
  page.off("request", monitor);
  console.log("Reader browser checks passed: suggestions/corrections, scrolling, ceilings, Stop, reflow, inactivity, lock contention/cancellation, import cancellation, literal text and memory-only privacy.");
}
