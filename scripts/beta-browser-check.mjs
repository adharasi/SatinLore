// CI-only real UI, real Worker authorization and real Durable Object storage.
// All identities, preferences and content are synthetic. No vendor calls or hardware.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Miniflare } from "miniflare";
import { createLocalJWKSet, generateKeyPair, exportJWK, SignJWT } from "jose";
import { createPrivateAppWorker } from "../deploy/cloudflare/worker.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = "https://app.satinlore.com", BETA = "https://beta.satinlore.com";
const privateCanary = "PRIVATE_READER_CANARY_20261102";
const privateName = "PRIVATE_PRESET_CANARY_20261102";
const apiRequests = [], apiResponses = [], unexpected = [], errors = [], diagnosticPages = [];
let browser, mf, phase = "initializing";
const log = value => { phase = value; console.log(`Beta browser phase: ${value}.`); };
const watchdog = setTimeout(() => { console.error(`Beta browser check exceeded five minutes during ${phase}.`); process.exit(1); }, 300000);
watchdog.unref();
const mime = name => name.endsWith(".mjs") || name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".svg") ? "image/svg+xml" : "text/html";

async function range(page, id, value) {
  await page.locator("#" + id).evaluate((node, next) => { node.value = String(next); node.dispatchEvent(new Event("input", { bubbles: true })); }, value);
}
async function output(page, expected) {
  await page.waitForFunction(value => document.querySelector("#output").textContent === `${value} / 20`, expected);
}
async function stopped(page) { await page.locator("#stop").click(); await output(page, 0); }
async function sidebar(page) {
  if (await page.locator("#settings-panel").isHidden()) await page.getByRole("button", { name: "Reading controls", exact: true }).click();
}
async function closeSidebar(page) {
  if (await page.locator("#settings-panel").isVisible()) await page.locator("#close-settings").click();
}
async function disclosure(page, selector) {
  const details = page.locator(selector);
  if (!await details.evaluate(node => node.open)) await details.locator("summary").click();
}
async function start(page) {
  await page.locator("#start").click(); await page.locator("#start-dialog").waitFor({ state: "visible" });
  await page.locator("#confirm-start").click(); await page.locator("#start-dialog").waitFor({ state: "hidden" });
}
async function chooseFlexer(page, { tested = true } = {}) {
  if (await page.locator("#setup-dialog").isHidden()) await page.locator("#choose-toy").click();
  await page.locator("#setup-model").selectOption("flexer");
  await page.locator("#setup-mode-simulator").click(); await page.locator("#setup-primary").click();
  await page.locator("#setup-selection").waitFor({ state: "visible" });
  assert.equal(await page.locator("#setup-devices").inputValue(), "");
  await page.locator("#setup-devices").selectOption("sim-flexer"); await page.locator("#setup-primary").click();
  await page.locator("#setup-test-panel").waitFor({ state: "visible" });
  if (!tested) return;
  await page.locator("#setup-channel").selectOption("vibrate");
  await range(page, "setup-test-level", 1); await page.locator("#setup-test").click();
  await page.waitForFunction(() => !document.querySelector("#setup-response-checked").disabled);
  await page.locator("#setup-response-checked").check(); await page.locator("#setup-primary").click();
  await page.locator("#calibration-view").waitFor({ state: "visible" });
}
async function exploreCalibration(page) {
  const movements = [
    { channel: "vibrate", values: [1, 2, 3, 5, 0] },
    { channel: "fingering", values: [1, 1, 2, 4, 0] },
  ];
  for (const movement of movements) {
    assert.equal(await page.locator("#calibration-channel").inputValue(), movement.channel);
    if (movement.channel === "fingering") assert.match(await page.locator("#calibration-feature-copy").textContent(), /Flexer|flexing|vibration/i);
    await page.locator("#calibration-next").click();
    for (let index = 0; index < movement.values.length; index++) {
      await range(page, "calibration-level", movement.values[index]);
      assert.match(await page.locator("#calibration-status").textContent(), /Nothing starts|Draft updated/i);
      if (index === 1) {
        await page.locator("#calibration-test").click();
        await page.waitForFunction(() => !document.querySelector("#calibration-stopped").disabled);
        await page.locator("#calibration-stopped").check();
        await page.locator("#calibration-rating-good").click();
      }
      await page.locator("#calibration-next").click();
    }
    await page.locator("#calibration-summary").waitFor({ state: "visible" });
    await page.locator("#calibration-continuity").selectOption("continuous");
    await page.locator("#calibration-apply").click();
    await page.waitForFunction(() => /Levels applied/.test(document.querySelector("#calibration-status").textContent));
    await output(page, 0);
    await page.locator("#calibration-next").click();
  }
  // Flexer offers an optional combination after its two individual movements.
  // These checks compare one action at a time; explicitly keep that selection.
  await page.locator("#calibration-together").waitFor({ state: "visible" });
  assert.equal(await page.locator("#calibration-skip-movement").textContent(), "Keep one movement");
  await page.locator("#calibration-skip-movement").click();
  await page.locator("#setup-practice-picker").waitFor({ state: "visible" });
  await page.locator("#calibration-view").waitFor({ state: "hidden" });
  await page.locator("#setup-practice-story").selectOption("evening-train-v1");
  await page.locator("#setup-primary").click();
  await page.locator("#setup-coach").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#analysis-status").dataset.state === "ready");
  assert.equal(await page.locator("#story-title").textContent(), "The evening train");
  await output(page, 0);
}
async function savePreset(page, name, scope) {
  await sidebar(page); await disclosure(page, "#preset-mount details");
  await page.locator("#account-preset-name").fill(name); await page.locator("#account-preset-scope").selectOption(scope);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/presets" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save current settings", exact: true }).click();
  const response = await saved; assert.equal(response.status(), 200);
  const state = await response.json(); assert.equal(state.playback, "paused");
  await page.waitForFunction(value => Array.from(document.querySelectorAll("#account-preset-picker option")).some(option => option.textContent.startsWith(value)), name);
  await output(page, 0); return state.presets.find(preset => preset.name === name);
}
async function requestInPage(page, method, pathname, body) {
  return page.evaluate(async ({ method, pathname, body }) => {
    const response = await fetch(pathname, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, value: await response.json() };
  }, { method, pathname, body });
}

try {
  log("preparing isolated signed identities and durable storage");
  mf = new Miniflare({ modulesRoot: ROOT, modules: [
    { type: "ESModule", path: path.join(ROOT, "beta-browser-fixture.mjs"), contents: `
      export { ReaderAccount } from './deploy/cloudflare/accounts.mjs';
      export { BetaRecordings } from './deploy/cloudflare/beta-recordings.mjs';
      export { PrivateFeedback } from './deploy/cloudflare/feedback.mjs';
      // Test-only storage forwarding. Production selects these namespaces after
      // signed Access verification, never through request-controlled headers.
      export default {fetch(request, env){
        const headers = new Headers(request.headers), binding = headers.get('X-Fixture-Binding'), key = headers.get('X-Fixture-Key');
        if(!['READER_ACCOUNTS','BETA_RECORDINGS','PRIVATE_FEEDBACK'].includes(binding) || !key) return new Response('Fixture only',{status:404});
        headers.delete('X-Fixture-Binding'); headers.delete('X-Fixture-Key');
        return env[binding].get(env[binding].idFromName(key)).fetch(new Request(request.url, {
          method:request.method, headers, ...(request.method === 'POST' ? {body:request.body} : {})
        }));
      }};` },
    ...await Promise.all(["accounts", "beta-recordings", "feedback"].map(async name => ({ type: "ESModule", path: path.join(ROOT, `deploy/cloudflare/${name}.mjs`), contents: await readFile(path.join(ROOT, `deploy/cloudflare/${name}.mjs`), "utf8") }))),
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0, durableObjects: {
    READER_ACCOUNTS: { className: "ReaderAccount", useSQLite: true }, BETA_RECORDINGS: { className: "BetaRecordings", useSQLite: true }, PRIVATE_FEEDBACK: { className: "PrivateFeedback", useSQLite: true },
  } });
  const storageNamespace = binding => ({ idFromName: name => name, get: key => ({ async fetch(request) {
    const headers = new Headers(request.headers); headers.set("X-Fixture-Binding", binding); headers.set("X-Fixture-Key", key);
    return mf.dispatchFetch(request.url, { method: request.method, headers: Object.fromEntries(headers),
      ...(request.method === "POST" ? { body: await request.text() } : {}),
    });
  } }) });
  const env = {
    PRIVATE_APP_ENABLED: "true", PUBLIC_APP_ORIGIN: APP, ACCESS_TEAM_DOMAIN: "synthetic.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64),
    FOUNDER_EMAIL: "synthetic-founder@example.test", BETA_TESTER_EMAILS: "synthetic-reader@example.test",
    LOVENSE_DEVELOPER_TOKEN: "synthetic-never-sent-to-vendor", LOVENSE_PLATFORM: "Synthetic fixture", LOVENSE_UID_SECRET: "b".repeat(64),
    READER_ACCOUNTS: storageNamespace("READER_ACCOUNTS"), BETA_RECORDINGS: storageNamespace("BETA_RECORDINGS"), PRIVATE_FEEDBACK: storageNamespace("PRIVATE_FEEDBACK"),
    ASSETS: { async fetch(request) {
      const pathname = new URL(request.url).pathname;
      try { return new Response(await readFile(path.join(ROOT, "dist/private-app", pathname.slice(1)), "utf8"), { headers: { "Content-Type": mime(pathname) } }); }
      catch { return new Response("Fixture asset missing", { status: 404 }); }
    } },
  };
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "synthetic-beta-browser", alg: "RS256" };
  const keyResolver = createLocalJWKSet({ keys: [jwk] });
  const worker = createPrivateAppWorker({ keyResolver, lovenseFetcher: async () => { assert.fail("The simulator must not issue a vendor token."); } });
  async function token(founder = false) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: "https://" + env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, sub: founder ? "synthetic-founder" : "synthetic-reader",
      email: founder ? env.FOUNDER_EMAIL : env.BETA_TESTER_EMAILS, type: "app", iat: now, exp: now + 3600,
    }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
  }
  browser = await chromium.launch({ headless: true });
  async function context(founder = false) {
    const signed = await token(founder), ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.route("**/*", async route => {
      const source = route.request(), url = new URL(source.url());
      if (![APP, BETA].includes(url.origin)) { unexpected.push(url.origin); return route.abort(); }
      // headers() is Playwright's provisional list and omits browser security
      // headers. Forward the actual Origin/Fetch Metadata used by the Worker.
      const headers = new Headers(await source.allHeaders()); headers.set("Cf-Access-Jwt-Assertion", signed);
      if (url.pathname.startsWith("/api/")) apiRequests.push({ path: url.pathname, origin: url.origin, method: source.method(), body: source.postData() || "" });
      const response = await worker.fetch(new Request(source.url(), { method: source.method(), headers,
        ...(["GET", "HEAD"].includes(source.method()) ? {} : { body: source.postDataBuffer() }),
      }), env);
      if (url.pathname.startsWith("/api/")) apiResponses.push({path:url.pathname,method:source.method(),status:response.status,
        origin:headers.get("Origin")===url.origin?"same-origin":headers.has("Origin")?"other":"missing",fetchSite:headers.get("Sec-Fetch-Site")});
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    ctx.on("page", page => { diagnosticPages.push(page); page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message)); });
    return ctx;
  }

  log("creating a private account and exploring Flexer movements");
  const appContext = await context(), page = await appContext.newPage(); await page.goto(APP + "/");
  await page.locator("#account-adult").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Create my private account", exact: true }).click();
  assert.equal((await requestInPage(page, "GET", "/api/account")).value.registered, false, "Registration needs the adult checkbox.");
  await page.locator("#account-adult").check();
  const accountCreated=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/account"&&response.request().method()==="POST");
  await page.getByRole("button", { name: "Create my private account", exact: true }).click();
  const accountResponse=await accountCreated, accountState=await accountResponse.json();
  assert.equal(accountResponse.status(),201,`Account creation failed: ${JSON.stringify({status:accountResponse.status(),error:accountState.error??null})}`);
  assert.equal(accountState.registered,true,"The durable account acknowledgement must confirm registration.");
  await page.locator("#account-welcome").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#beta-recording").count(), 0, "Normal app never offers beta recording.");
  assert.equal((await requestInPage(page, "POST", "/api/beta/recordings", {})).status, 404);
  await chooseFlexer(page); await exploreCalibration(page);
  log("checking continuity Hold Ease off and zero maximum");
  await sidebar(page); await page.locator("#follow-scroll").uncheck();
  await page.locator("#feel-mode").selectOption("continuous");
  await disclosure(page, ".feel-adjustments details:has(#feel-minimum)"); await range(page, "feel-minimum", 1); await range(page, "feel-background", 1);
  await range(page, "feel-recovery", 0); await closeSidebar(page);
  await start(page); await output(page, 1);
  await sidebar(page); await page.locator("#feel-hold").click(); await page.locator("#next").click(); await output(page, 1);
  assert.match(await page.locator("#feel-status").textContent(), /hold/i);
  await page.locator("#feel-easeoff").click(); await output(page, 0);
  await page.locator("#next").click(); await output(page, 0);
  await page.locator("#feel-follow").click(); await page.waitForFunction(() => document.querySelector("#output").textContent !== "0 / 20");
  await range(page, "cap", 0); await output(page, 0);
  assert.equal(await page.locator("#ceiling-dialog").isVisible(), false);
  await stopped(page); await range(page, "cap", 4); await output(page, 0);
  const globalPreset = await savePreset(page, "Synthetic global settings", "account");
  const storyPreset = await savePreset(page, "Synthetic story settings", "story");
  assert.equal(globalPreset.toy, "flexer"); assert.equal(storyPreset.scope, "story");
  assert.ok(/^[a-f\d-]{36}$/.test(storyPreset.storyId));
  await page.locator("#settings-story-tab").click(); await page.locator("#save-story").click();
  await page.locator("#confirm-save").click(); await page.waitForFunction(() => document.querySelector("#save-status").dataset.state === "saved");
  await page.reload(); await output(page, 0);
  assert.equal(await page.locator("#account-welcome").isHidden(), true, "The account survives reload.");
  await chooseFlexer(page, { tested: false }); await page.locator("#setup-close").click();
  await sidebar(page); await page.locator("#account-preset-picker").selectOption(globalPreset.id);
  await page.getByRole("button", { name: "Apply preset", exact: true }).click(); await output(page, 0);
  await page.locator("#account-preset-picker").selectOption(storyPreset.id);
  await page.getByRole("button", { name: "Apply preset", exact: true }).click(); await output(page, 0);
  assert.equal(await page.locator("#pause").isDisabled(), true, "Loading either preset cannot arm playback.");

  log("checking beta consent masking and durable session recording");
  const betaContext = await context(), beta = await betaContext.newPage(); await beta.goto(BETA + "/");
  await beta.locator("#beta-recording").waitFor({ state: "visible" });
  assert.equal(apiRequests.some(value => value.origin === BETA && value.path === "/api/beta/recordings" && value.method === "POST"), false, "No beta recording starts before consent.");
  await beta.locator("#beta-recording-decline").click();
  assert.equal(apiRequests.some(value => value.origin === BETA && value.path === "/api/beta/recordings" && value.method === "POST"), false);
  await beta.locator("#beta-recording-agree").check(); await beta.locator("#beta-recording-start").click();
  await beta.waitForFunction(() => document.querySelector("#beta-recording").dataset.state === "recording");
  await beta.locator("#draft-story").fill(privateCanary);
  await chooseFlexer(beta); await beta.locator("#setup-close").click();
  await sidebar(beta); await disclosure(beta, "#preset-mount details");
  await beta.locator("#account-preset-name").fill(privateName); // Never saved, never a recording field.
  await disclosure(beta, ".feel-adjustments details:has(#feel-minimum)"); await range(beta, "feel-background", 2);
  await beta.locator("#beta-recording-pause").click();
  await beta.waitForFunction(() => document.querySelector("#beta-recording").dataset.state === "paused");
  await beta.locator("#beta-recording-pause").click();
  await beta.waitForFunction(() => document.querySelector("#beta-recording").dataset.state === "recording");
  await beta.locator("#beta-recording-stop").click();
  await beta.waitForFunction(() => document.querySelector("#beta-recording").dataset.state === "stopped");
  const recorded = await requestInPage(beta, "GET", "/api/beta/recordings");
  assert.equal(recorded.status, 200); assert.equal(recorded.value.sessions.length, 1);
  const sid = recorded.value.sessions[0].sid;
  const detail = await requestInPage(beta, "GET", "/api/beta/recordings/" + sid);
  assert.equal(detail.status, 200); assert.ok(detail.value.events.length > 0);
  assert.ok(detail.value.events.some(event => event.type === "output" && Object.values(event.channels).some(level => level > 0)), "The consented timeline retains a real simulated test's nonzero output.");
  const privateCapture = JSON.stringify(apiRequests.filter(value => /\/api\/(?:beta|lovense)\//.test(value.path)));
  assert.ok(!privateCapture.includes(privateCanary) && !privateCapture.includes(privateName), "Private text or preset input entered a recording/control request.");
  assert.equal((await requestInPage(beta, "GET", "/api/admin/beta-recordings")).status, 403, "A tester cannot inspect other participants.");

  log("checking founder filters replay seeking and deletion");
  const adminContext = await context(true), admin = await adminContext.newPage();
  await admin.goto(BETA + "/admin");
  await admin.waitForFunction(() => document.querySelectorAll(".session-button").length > 0);
  await admin.locator("#review-mode").selectOption("simulator"); await admin.locator("#review-toy").selectOption("flexer");
  await admin.waitForFunction(() => document.querySelectorAll(".session-button").length === 1);
  await admin.locator(".session-button").click(); await admin.locator("#review-player").waitFor({ state: "visible" });
  await admin.locator("#review-play").click(); await admin.waitForFunction(() => document.querySelector("#review-play").textContent === "Pause");
  await admin.locator("#review-play").click(); await admin.locator("#review-speed").selectOption("2");
  await admin.locator("#review-position").press("End"); assert.match(await admin.locator("#review-title").textContent(), /Flexer/);
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.ok(await admin.locator("body").evaluate(node => node.scrollWidth <= node.ownerDocument.documentElement.clientWidth + 1), "Beta admin fits a phone width.");
  await beta.locator("#beta-recording-delete").click();
  await beta.waitForFunction(() => document.querySelector("#beta-recording").dataset.state === "withdrawn");
  const removed = await requestInPage(beta, "GET", "/api/beta/recordings/" + sid); assert.equal(removed.status, 404);
  assert.equal((await requestInPage(admin, "GET", "/api/admin/beta-recordings/" + sid)).status, 404);
  assert.deepEqual(unexpected, [], "Unexpected external services were blocked.");
  assert.deepEqual(errors, [], "Reader/admin produced a browser runtime error.");
  await Promise.all([appContext.close(), betaContext.close(), adminContext.close()]);
  console.log("Beta browser checks passed: signed account registration, per-movement calibration, saved account/story presets, paused reload, continuity/Hold/Ease off/zero, beta-only consent, real durable timelines, masked private inputs, founder-only replay/filter/seek, withdrawal and phone admin layout. No real identity, vendor API, hardware or private story used.");
} catch(error) {
  // Deliberately omit tokens, headers, request bodies, stories and preset names.
  const pages=[];
  for(const page of diagnosticPages.filter(page=>!page.isClosed()).slice(-3)){
    try{pages.push(await page.evaluate(()=>({path:location.pathname,states:Object.fromEntries([
      ["account","#account-welcome [role=status]"],["setup","#setup-status"],["calibration","#calibration-status"],["recording","#beta-recording-status"],
    ].map(([name,selector])=>[name,document.querySelector(selector)?.textContent?.slice(0,240)??null]))})));}catch{/* A closed page needs no further diagnosis. */}
  }
  console.error("Beta browser bounded diagnostics:",JSON.stringify({phase,api:apiResponses.slice(-16),pages,pageErrors:errors.slice(-5).map(value=>value.slice(0,240))}));
  throw error;
} finally {
  clearTimeout(watchdog); await browser?.close(); await mf?.dispose();
}
