// Real browser/CSP integration with an ephemeral DB and a fake vendor SDK.
// Never uses developer credentials, external APIs or physical devices.
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {chromium} from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const directory = await mkdtemp(path.join(tmpdir(), "satinlore-browser-"));
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const environment = {...process.env,
  SATINLORE_ENV: "test", SATINLORE_DEVICE_MODE: "simulator",
  LOVENSE_DEVELOPER_TOKEN: "", LOVENSE_PLATFORM_NAME: "",
  SATINLORE_APP_ORIGIN: origin,
  SATINLORE_BROWSER_TEST_ORIGIN: origin,
  SATINLORE_BROWSER_TEST_DB: path.join(directory, "test.sqlite3"),
};
// The temporary token is not written to the repository or output.
const invite = execFileSync(python, ["-c", [
  "from pathlib import Path", "import os", "from app.db.store import Store",
  "print(Store(Path(os.environ['SATINLORE_BROWSER_TEST_DB'])).create_invite())",
].join(";")], {cwd: root, env: environment, encoding: "utf8"}).trim();

const fakeSdk = `
globalThis.LovenseBasicSdk = class {
  constructor() {
    this.handlers = {}; this.commands = []; this.stops = []; this.online = true;
    globalThis.__fakeSdk = this;
    setTimeout(() => this.handlers.ready?.(this), 0);
  }
  on(name, callback) { this.handlers[name] = callback; }
  getAppStatus() { return this.online; }
  getOnlineToys() { return [
    {id:'toy-a', toyType:'lush', hVersion:'3', connected:true},
    {id:'toy-b', toyType:'lush', hVersion:'4', connected:true},
  ]; }
  async getQrcode() { return {qrcodeUrl:'https://apps.lovense-api.com/UploadFiles/qr/test.svg'}; }
  sendToyCommand(command) { this.commands.push(command); }
  stopToyAction(id) { this.stops.push(id); }
  destroy() { this.destroyed = true; }
};`;

let browser;
let server;
let serverErrors = "";
let page;
const errors = [];
const policyErrors = [];
const responseStatuses = [];
try {
  server = spawn(python, ["-m", "uvicorn", "browser_server:app", "--app-dir", "tests",
    "--host", "127.0.0.1", "--port", String(port), "--no-access-log"],
  {cwd: root, env: environment, stdio: ["ignore", "ignore", "pipe"]});
  server.stderr.on("data", chunk => { serverErrors = (serverErrors + chunk).slice(-4000); });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server failed: ${serverErrors}`);
    try {
      const response = await fetch(`${origin}/api/health`, {signal: AbortSignal.timeout(500)});
      if (response.ok) { ready = true; break; }
    } catch { /* Await the local process, never an external service. */ }
    await delay(100);
  }
  assert.ok(ready, "Local test server did not become ready.");
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext();
  const externalRequests = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.href === "https://api.lovense-api.com/basic-sdk/core.min.js") {
      return route.fulfill({contentType: "text/javascript", body: fakeSdk});
    }
    if (url.href === "https://apps.lovense-api.com/UploadFiles/qr/test.svg") {
      return route.fulfill({contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'});
    }
    externalRequests.push(url.origin);
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("response", response => {
    const url = new URL(response.url());
    responseStatuses.push({path: url.pathname, status: response.status()});
  });
  page.on("requestfailed", request => {
    responseStatuses.push({path: new URL(request.url()).pathname, error: request.failure()?.errorText});
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (/content security policy|blocked by cors/i.test(message.text())) policyErrors.push(message.text());
  });
  const story = "An ordinary walk.\n\nA quiet afternoon.";
  const transmittedStories = [];
  page.on("request", request => {
    if ((request.postData() || "").includes("An ordinary walk")) transmittedStories.push(request.url());
  });
  await page.goto(origin);
  await page.locator("#source").fill(story);
  await page.locator("#load").click();
  await page.locator("#connect").click();
  for (const [id, value] of [["level", "10"], ["cap", "3"]]) {
    await page.locator(`#${id}`).evaluate((element, next) => {
      element.value = next;
      element.dispatchEvent(new Event("input", {bubbles: true}));
    }, value);
  }
  await page.locator("#start").click();
  await page.waitForFunction(() => document.querySelector("#output").textContent === "3 / 20");
  await page.locator("#stop").click();
  assert.equal(await page.locator("#output").textContent(), "0 / 20");
  await page.reload();
  assert.equal(await page.locator("#source").inputValue(), "");
  assert.deepEqual(transmittedStories, []);

  await page.goto(`${origin}/device-check`);
  await page.locator("#invite-token").fill(invite);
  await page.locator("#redeem").click();
  await page.waitForFunction(() => !document.querySelector("#connect-real").disabled);
  const cookie = (await context.cookies(`${origin}/api/me`)).find(value => value.name === "satinlore_session");
  assert.ok(cookie?.httpOnly && cookie.sameSite === "Strict");
  assert.equal(await page.locator("#invite-token").inputValue(), "");
  await page.locator("#connect-real").click();
  await page.waitForFunction(() => document.querySelector("#toy-select").options.length === 3);
  const frame = page.frames().find(value => value.url() === `${origin}/device-bridge`);
  assert.ok(frame, "Sandbox did not load.");
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
  assert.equal(await frame.evaluate(() => {
    try { return Boolean(parent.document.body); } catch { return false; }
  }), false, "Vendor frame must not read the parent's DOM.");
  assert.equal(await page.locator("#test-pulse").isDisabled(), true, "One device must be explicitly selected.");
  await page.locator("#toy-select").selectOption("toy-a");
  await page.waitForFunction(() => !document.querySelector("#test-pulse").disabled);
  await page.locator("#test-pulse").click();
  // The bridge is deliberately hidden; requestAnimationFrame polling is paused there.
  await frame.waitForFunction(() => globalThis.__fakeSdk.commands.length === 1, null, {polling: 50});
  assert.deepEqual(await frame.evaluate(() => globalThis.__fakeSdk.commands[0]), {vibrate: 1, time: 2, toyId: "toy-a"});
  await page.locator("#stop-real").click();
  await frame.waitForFunction(() => globalThis.__fakeSdk.stops.includes("toy-a"), null, {polling: 50});

  // Stop during the authentication round trip must invalidate the queued pulse.
  await delay(2100); // Wait outside the previous pulse's enforced two-second window.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`${origin}/api/me`, async route => {
    await gate; await route.continue();
  });
  const interceptReady = page.waitForRequest(`${origin}/api/me`);
  await page.locator("#test-pulse").click();
  await interceptReady;
  await page.locator("#stop-real").click();
  const reply = page.waitForResponse(`${origin}/api/me`);
  release(); await reply;
  await delay(150);
  assert.equal(await frame.evaluate(() => globalThis.__fakeSdk.commands.length), 1, "Stop must cancel a pending test.");
  await page.unroute(`${origin}/api/me`);

  await page.locator("#disconnect-real").click();
  await page.waitForFunction(() => document.querySelectorAll("iframe").length === 0);
  await page.locator("#connect-real").click();
  await page.waitForFunction(() => document.querySelector("#toy-select").options.length === 3);
  assert.equal(await page.locator("#toy-select").inputValue(), "");
  assert.equal(await page.locator("#test-pulse").isDisabled(), true, "Reconnect cannot resume or reuse selection.");

  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile layout must fit the viewport.");
  await page.locator("#logout").click();
  await page.waitForFunction(() => !document.querySelector("#invite-form").hidden);
  await page.waitForFunction(() => document.querySelectorAll("iframe").length === 0);
  assert.equal((await context.request.get(`${origin}/api/me`)).status(), 401);
  assert.deepEqual(externalRequests, [], "Unexpected external requests were blocked.");
  assert.deepEqual(errors, [], "Browser runtime errors.");
  assert.deepEqual(policyErrors, [], "Unexpected CSP or CORS errors.");
  console.log("Browser checks passed: local reader, invitation session, sandbox isolation, selected finite command, Stop cancellation, reconnect, logout and mobile layout. Vendor SDK/HTTP mocked; hardware unverified.");
} catch (error) {
  // Fixture-only diagnostics: no DOM snapshot, token, cookie, body or QR payload.
  console.error(JSON.stringify({errors, policyErrors, responseStatuses,
    status: await page?.locator("#connection-status").textContent({timeout: 500}).catch(() => null),
    message: await page?.locator("#message").textContent({timeout: 500}).catch(() => null),
  }));
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([once(server, "exit"), delay(5000)]);
  }
  await rm(directory, {recursive: true, force: true});
}
