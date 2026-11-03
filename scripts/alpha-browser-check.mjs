// CI acceptance for the hosted Alpha. Test identities, credentials and notes are synthetic.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { chromium } from "playwright";
import { createPrivateAppWorker } from "../deploy/cloudflare/worker.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = "https://app.satinlore.com";
const API = "/alpha/api/alpha";
const EVIDENCE = path.join(ROOT, "artifacts", "frontend");
const passwords = Object.fromEntries(["Dilan", "Sadie"].map(name => [name, randomBytes(32).toString("base64url")]));
const verifiers = Object.fromEntries(Object.entries(passwords).map(([name, password]) => [
  `ALPHA_${name.toUpperCase()}_VERIFIER`, createHash("sha256").update(password).digest("hex"),
]));
const setupNote = "Synthetic check: both test buttons were easy to find.";
const annotationNote = "Synthetic observation at the marked point.";
const calls = [];
const diagnosticPages = [], recentPageErrors = [];
let browser, mf, phase = "preparing fixtures", pageErrors = 0, outsideRequests = 0, routeErrors = 0;

const begin = label => { phase = label; console.log(`Alpha browser phase: ${label}.`); };
const watchdog = setTimeout(() => { console.error(`Alpha browser check timed out during ${phase}.`); process.exit(1); }, 240_000);
watchdog.unref();
const mime = name => ({ ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[path.extname(name)] || "text/html";

function scrub(value, limit = 400) {
  let text = String(value ?? "");
  for (const known of [...Object.values(passwords), ...Object.values(verifiers), setupNote, annotationNote]) {
    text = text.replaceAll(known, "[fixture value]");
  }
  return text.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "[session]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[token]")
    .replace(/([?&][a-z0-9_-]+=)[^&\s"']+/gi, "$1[redacted]")
    .slice(0, limit);
}

async function pageState(page) {
  try {
    const snapshot = await page.evaluate(() => {
      const selectors = {
        stage: "#alpha-study-kicker", setup: "#alpha-device-status", connection: "#alpha-connection-badge",
        record: "#alpha-record-label", playback: "#alpha-dock-state", feedback: "#alpha-feedback-status",
        admin: "#alpha-review-status",
      };
      const labels = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key,
        document.querySelector(selector)?.textContent?.trim().slice(0, 240) || "",
      ]));
      const connect = document.querySelector("#alpha-device-connect");
      return { pathname: location.pathname, labels, connectDisabled: connect?.disabled ?? null };
    });
    return { ...snapshot, pathname: scrub(snapshot.pathname),
      labels: Object.fromEntries(Object.entries(snapshot.labels).map(([key, value]) => [key, scrub(value, 240)])) };
  } catch { return { unavailable: true }; }
}

async function get(page, pathname) {
  return page.evaluate(async url => {
    const response = await fetch(url, { cache: "no-store" });
    return { status: response.status, data: await response.json().catch(() => null) };
  }, pathname);
}

async function login(page, name) {
  try {
    await page.locator("#alpha-username").fill(name);
    await page.locator("#alpha-password").fill(passwords[name]);
    const result = page.waitForResponse(response => new URL(response.url()).pathname === `${API}/login`);
    await page.locator("#alpha-login-form button[type=submit]").click();
    assert.equal((await result).status(), 200);
    await page.locator("#alpha-welcome").waitFor({ state: "visible" });
  } catch {
    throw new Error(`Synthetic ${name} could not sign in through the Alpha form.`);
  }
}

async function checkViewport(page, width) {
  await page.setViewportSize({ width, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    `The Alpha page must fit a ${width}px viewport without horizontal scrolling.`);
}

async function captureNeutral(page, filename) {
  await mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, filename), animations: "disabled" });
}

try {
  // Forward Worker-generated internal requests to real SQLite Durable Objects.
  // The fixture's routing headers never originate from browser traffic.
  mf = new Miniflare({
    modulesRoot: ROOT,
    modules: [
      { type: "ESModule", path: path.join(ROOT, "alpha-browser-fixture.mjs"), contents: `
        export { AlphaStudy } from './deploy/cloudflare/alpha-study.mjs';
        export default {fetch(request, env) {
          const headers = new Headers(request.headers);
          const key = headers.get('X-Fixture-Key');
          if (!key) return new Response('Fixture only', {status:404});
          headers.delete('X-Fixture-Key');
          return env.ALPHA_STUDY.get(env.ALPHA_STUDY.idFromName(key)).fetch(new Request(request, {headers}));
        }};` },
      ...await Promise.all(["alpha-study", "alpha-contract"].map(async name => {
        const modulePath = path.join(ROOT, "deploy/cloudflare", `${name}.mjs`);
        return { type: "ESModule", path: modulePath, contents: await readFile(modulePath, "utf8") };
      })),
      { type: "ESModule", path: path.join(ROOT, "app/static/alpha-screen-schema.mjs"),
        contents: await readFile(path.join(ROOT, "app/static/alpha-screen-schema.mjs"), "utf8") },
    ],
    compatibilityDate: "2026-05-22",
    cf: false,
    port: 0,
    inspectorPort: 0,
    durableObjects: { ALPHA_STUDY: { className: "AlphaStudy", useSQLite: true } },
    bindings: verifiers,
  });
  const env = {
    PRIVATE_APP_ENABLED: "true", PUBLIC_APP_ORIGIN: APP,
    ACCESS_TEAM_DOMAIN: "synthetic.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64),
    FOUNDER_EMAIL: "synthetic-founder@example.test", ...verifiers,
    ALPHA_STUDY: {
      idFromName: name => name,
      get: key => ({ async fetch(request) {
        const headers = new Headers(request.headers);
        headers.set("X-Fixture-Key", key);
        return mf.dispatchFetch(request.url, {
          method: request.method, headers: Object.fromEntries(headers),
          ...(request.body ? { body: new Uint8Array(await request.arrayBuffer()) } : {}),
        });
      } }),
    },
    ASSETS: { async fetch(request) {
      const name = new URL(request.url).pathname;
      try {
        const body = await readFile(path.join(ROOT, "dist/private-app", name.slice(1)));
        return new Response(body, { headers: { "Content-Type": mime(name) } });
      } catch { return new Response("Missing fixture asset", { status: 404 }); }
    } },
  };
  const worker = createPrivateAppWorker({ lovenseFetcher: async () => { throw Error("Simulator unexpectedly requested a live connection."); } });
  browser = await chromium.launch({ headless: true });

  async function openContext() {
    // Fresh fixture contexts have no worker registrations. Playwright's block
    // option reads navigator.serviceWorker inside the opaque sandbox and throws.
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async route => {
      const source = route.request(), url = new URL(source.url()), method = source.method();
      if (url.origin !== APP) { outsideRequests++; await route.abort(); return; }
      try {
        const headers = new Headers(await source.allHeaders());
        const payload = source.postDataBuffer();
        const response = await worker.fetch(new Request(url, { method, headers, ...(payload ? { body: payload } : {}) }), env);
        if (url.pathname.startsWith("/alpha/api/")) calls.push({ path: url.pathname, method, status: response.status });
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      } catch {
        routeErrors++;
        await route.fulfill({ status: 500, body: "Alpha fixture request failed" });
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    diagnosticPages.push(page);
    page.on("pageerror", error => {
      pageErrors++;
      if (recentPageErrors.length === 6) recentPageErrors.shift();
      recentPageErrors.push({ name: scrub(error.name, 40), message: scrub(error.message) });
    });
    return { context, page };
  }

  begin("isolating Alpha sign-in and checking theme controls");
  const { context: tester, page } = await openContext();
  assert.equal((await page.goto(`${APP}/alpha`)).status(), 200);
  await page.locator("#alpha-login").waitFor({ state: "visible" });
  assert.equal((await get(page, `${API}/auth`)).data.authenticated, false);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.locator("#alpha-theme").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.equal(await page.locator("#alpha-theme").getAttribute("aria-checked"), "false");
  await page.locator("#alpha-theme").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await checkViewport(page, 390);
  await login(page, "Sadie");
  for (const selector of ["#alpha-founder-link", "#alpha-history-open", "#alpha-clip-panel", "#alpha-record-pause", "#alpha-record-resume"]) {
    assert.equal(await page.locator(selector).count(), 0, `The tester interface omits ${selector}.`);
  }
  assert.equal((await get(page, `${API}/auth`)).data.username, "Sadie");
  assert.equal((await get(page, `${API}/admin/sessions`)).status, 403);
  const bridgeNavigation = page.waitForResponse(response => new URL(response.url()).pathname === "/alpha/device-bridge");
  const bridgeReady = page.evaluate(() => new Promise(resolve => {
    const frame = document.createElement("iframe");
    const channel = new MessageChannel();
    const finish = ready => {
      clearTimeout(timer);
      channel.port1.close();
      frame.remove();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 8_000);
    channel.port1.onmessage = event => finish(event.data?.type === "bridge-ready");
    frame.addEventListener("load", () => frame.contentWindow.postMessage({type: "satinlore:bridge"}, "*", [channel.port2]), {once: true});
    frame.setAttribute("sandbox", "allow-scripts");
    frame.src = "/alpha/device-bridge";
    frame.hidden = true;
    document.body.append(frame);
  }));
  const [bridgeResponse, ready] = await Promise.all([bridgeNavigation, bridgeReady]);
  assert.equal(bridgeResponse.status(), 200, "The real browser's sandboxed bridge navigation receives its Alpha session.");
  assert.equal(ready, true, "The packaged bridge runs under its hashed CSP and acknowledges the private parent port.");
  assert.equal(await page.locator("#alpha-consent-start").isDisabled(), true, "The study requires an adult acknowledgement.");
  assert.ok(!calls.some(call => call.path === `${API}/sessions` && call.method === "POST"), "Sign-in must not start recording.");

  begin("recording a consented simulated Flexer session");
  await page.locator("#alpha-adult").check();
  await page.locator('input[name="alpha-mode"][value="simulator"]').check();
  const sessionStarted = page.waitForResponse(response => new URL(response.url()).pathname === `${API}/sessions` && response.request().method() === "POST");
  await page.locator("#alpha-consent-start").click();
  const startResponse = await sessionStarted;
  assert.equal(startResponse.status(), 201);
  const { id: sessionId } = await startResponse.json();
  await page.locator('#alpha-record-strip[data-state="recording"]').waitFor({ state: "visible" });
  await page.locator("#alpha-device-connect").click();
  const select = page.locator("#alpha-device-select");
  await select.waitFor({ state: "visible" });
  const candidate = select.locator('option:not([value=""])').first();
  await candidate.waitFor({ state: "attached" });
  assert.equal(await select.inputValue(), "", "Device selection must be explicit.");
  assert.match(await candidate.textContent(), /Flexer/i);
  await select.selectOption(await candidate.getAttribute("value"));
  await page.locator("#alpha-device-select-confirm").click();
  for (const channel of ["vibrate", "fingering"]) {
    const row = page.locator(`.alpha-verify-movement[data-channel="${channel}"]`);
    await row.locator("button").click();
    await row.locator('input[type="checkbox"]').check();
  }
  await page.locator("#alpha-verify-continue").click();
  await page.locator("#alpha-controls").waitFor({ state: "visible" });
  assert.equal(await page.locator("#alpha-movement-cards .alpha-movement").count(), 2);
  await checkViewport(page, 390);
  await captureNeutral(page, "alpha-control-lab-mobile.png");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await captureNeutral(page, "alpha-control-lab.png");
  const vibration = page.locator('#alpha-movement-cards .alpha-movement[data-channel="vibrate"]');
  await vibration.locator(".alpha-movement-detail > summary").click();
  const minimum = vibration.locator('input[data-setting="minimum"]');
  const maximum = vibration.locator('input[data-setting="maximum"]');
  await minimum.press("End");
  const oldMaximum = Number(await maximum.inputValue());
  assert.equal(Number(await minimum.inputValue()), oldMaximum);
  await maximum.press("ArrowLeft");
  assert.equal(Number(await maximum.inputValue()), oldMaximum - 1);
  assert.equal(Number(await minimum.inputValue()), oldMaximum - 1, "Lowering a movement maximum also lowers its continuous minimum.");

  await page.locator("#alpha-back-to-checks").click();
  await page.locator("#alpha-verification").waitFor({ state: "visible" });
  await page.locator("#alpha-verify-continue").click();
  await page.locator("#alpha-controls").waitFor({ state: "visible" });
  await page.locator('#alpha-movement-cards input[data-setting="level"]').first().press("ArrowRight");
  await page.locator("#alpha-device-start").click();
  await page.locator('[data-alpha-mark="good"]').click();
  await page.locator('[data-alpha-mark="climax"]').click();
  await page.locator("#alpha-finish").click();
  await page.locator("#alpha-feedback-form").waitFor({ state: "visible" });
  assert.ok(!calls.some(call => call.path === `${API}/sessions/${sessionId}/finish`), "Stopping the device leaves the study open for feedback capture.");
  await page.locator('#alpha-record-strip[data-state="recording"]').waitFor({ state: "visible" });
  const form = page.locator("#alpha-feedback-form");
  const feedbackField = name => form.locator(`[name="${name}"]`);
  async function expectRequiredField(name) {
    await page.locator("#alpha-feedback-save").click();
    assert.equal(await feedbackField(name).evaluate(field => document.activeElement === field), true, `${name} receives focus when it is required.`);
    assert.equal(await feedbackField(name).getAttribute("aria-invalid"), "true");
    assert.ok(!calls.some(call => call.path === `${API}/sessions/${sessionId}/feedback`), "An incomplete feedback form stays local.");
  }
  await expectRequiredField("minimum");
  await form.locator('[name="minimum"]').selectOption("depends");
  await expectRequiredField("connectionEase");
  await feedbackField("connectionEase").fill("7");
  await expectRequiredField("easeOfUse");
  await form.locator('[name="vibrationMaximum"]').fill("4");
  await form.locator('[name="flexingMaximum"]').fill("3");
  await form.locator('[name="easeOfUse"]').fill("8");
  await form.locator('[name="setupFeedback"]').fill(setupNote);
  const feedbackSaved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/feedback") && response.request().method() === "POST");
  await page.locator("#alpha-feedback-save").click();
  assert.ok((await feedbackSaved).ok(), "The study API must acknowledge feedback.");
  await page.waitForFunction(() => document.querySelector("#alpha-feedback-status").textContent.startsWith("Feedback saved"));
  await page.locator("#alpha-review-moments button").filter({ hasText: /climax/i }).click();
  await page.locator("#alpha-annotation").fill(annotationNote);
  await page.locator("#alpha-annotation-peak").click();
  const annotationSaved = page.waitForResponse(response => /\/annotations?$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
  await page.locator('#alpha-annotation-form button[type="submit"]').click();
  assert.ok((await annotationSaved).ok(), "The study API must acknowledge the annotation.");
  await page.waitForFunction(() => document.querySelector("#alpha-annotation-status").textContent.includes("saved"));
  assert.equal((await get(page, `${API}/sessions`)).status, 403);
  assert.equal((await get(page, `${API}/sessions/${sessionId}`)).status, 403);
  const sessionFinished = page.waitForResponse(response => new URL(response.url()).pathname === `${API}/sessions/${sessionId}/finish`);
  await page.locator("#alpha-back-to-start").click();
  assert.ok((await sessionFinished).ok(), "Leaving the study closes the recorded session.");
  await page.locator("#alpha-welcome").waitFor({ state: "visible" });
  assert.equal((await page.goto(`${APP}/admin`)).status(), 403, "Sadie cannot load the founder document.");

  begin("reviewing the study under the separate founder identity");
  const { context: founder, page: admin } = await openContext();
  await admin.goto(`${APP}/alpha`);
  await login(admin, "Dilan");
  assert.equal(await admin.locator("#alpha-founder-link").count(), 0);
  assert.equal((await admin.goto(`${APP}/admin`)).status(), 200);
  const rows = admin.locator("#alpha-review-list button");
  await rows.first().waitFor({ state: "visible" });
  assert.equal(await rows.count(), 1);
  await admin.locator("#alpha-review-user").selectOption("Dilan");
  await admin.waitForFunction(() => document.querySelector("#alpha-review-status").textContent.includes("No Alpha sessions"));
  assert.equal(await rows.count(), 0);
  await admin.locator("#alpha-review-user").selectOption("Sadie");
  await rows.first().click();
  await admin.locator("#alpha-review-detail").waitFor({ state: "visible" });
  assert.match(await admin.locator("#alpha-detail-meta").textContent(), /Sadie/);
  const persisted = await get(admin, `${API}/admin/sessions/${sessionId}`);
  assert.equal(persisted.status, 200);
  const detail = persisted.data;
  assert.equal(detail.session.username, "Sadie");
  assert.equal(detail.session.mode, "simulator");
  assert.equal(detail.session.state, "finished");
  assert.ok(detail.events.some(event => event.type === "output" && Object.values(event.channels || {}).some(level => level > 0)), "Capture includes nonzero requested or simulated output.");
  assert.ok(detail.events.some(event => event.type === "mark" && event.mark === "climax"), "A tester's optional moment marker survives finishing.");
  assert.equal(detail.feedback.minimum, "depends");
  assert.equal(detail.feedback.vibrationMaximum, 4);
  assert.equal(detail.feedback.flexingMaximum, 3);
  assert.equal(detail.feedback.connectionEase, 7);
  assert.equal(detail.feedback.easeOfUse, 8);
  assert.equal(detail.annotations.length, 1);
  assert.ok(detail.annotations[0].text.includes("I climaxed around this time."), "The optional retrospective note stays associated with the chosen timestamp.");
  const captured = detail.events.filter(event => event.type === "screen" || event.type === "pointer");
  const screens = new Set(captured.filter(event => event.type === "screen").map(event => event.screen));
  assert.deepEqual([...screens].sort(), ["connect", "controls", "feedback", "verify"]);
  assert.ok(captured.some(event => event.type === "pointer" && event.action === "click"), "Replay includes a safe click event.");
  const captureJson = JSON.stringify(captured);
  assert.ok(![setupNote, annotationNote, ...Object.values(passwords)].some(value => captureJson.includes(value)),
    "Screen replay omits typed notes and credentials.");

  const replay = admin.locator("#alpha-review-replay-screen");
  const controlVisits = replay.locator("option").filter({ hasText: /control lab/i });
  assert.equal(await controlVisits.count(), 2, "Returning to the controls creates a distinct screen visit.");
  await replay.selectOption(await controlVisits.first().getAttribute("value"));
  await admin.locator("#alpha-review-replay-position").press("End");
  await admin.locator("#alpha-review-replay-view").waitFor({ state: "visible" });
  assert.ok(await admin.locator("#alpha-review-replay-items .alpha-replay-item").count(), "A selected visit reconstructs the study screen.");
  assert.ok((await admin.locator("#alpha-review-feedback").textContent()).includes(setupNote), "Founder sees the saved setup feedback.");
  assert.ok((await admin.locator("#alpha-review-annotations").textContent()).includes(annotationNote), "Founder sees the timestamped annotation.");
  await admin.locator("#alpha-review-markers button").filter({ hasText: /climax|peak/i }).click();
  await checkViewport(admin, 390);
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await captureNeutral(admin, "alpha-founder-review.png");

  const reader = await tester.newPage();
  assert.equal((await reader.goto(`${APP}/`)).status(), 403, "An Alpha cookie cannot grant access to the ordinary reader.");
  assert.equal(outsideRequests, 0, "The simulator path requires no outside requests.");
  assert.equal(routeErrors, 0, "Fixture requests completed without internal routing errors.");
  assert.equal(pageErrors, 0, "Alpha browser pages ran without unhandled errors.");
  await Promise.all([tester.close(), founder.close()]);
  console.log("Alpha browser checks passed: separate accounts, study consent, simulated Flexer setup, limit clamping, markers, masked screen visits, required feedback, annotations and founder review.");
} catch (error) {
  const pages = await Promise.all(diagnosticPages.filter(page => !page.isClosed()).slice(-2).map(pageState));
  const recentCalls = calls.slice(-24).map(call => ({ ...call, path: scrub(call.path) }));
  console.error("Alpha browser diagnostics:", JSON.stringify({ phase, calls: recentCalls, pages, pageErrors, recentPageErrors, outsideRequests, routeErrors }));
  throw new Error(scrub(error?.message || "Alpha acceptance failed.", 1400));
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  await mf?.dispose();
}
