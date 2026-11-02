import test from "node:test";
import assert from "node:assert/strict";
import {workspace} from "./helpers/workspace.mjs";

async function ready(t, options) {
  const app = workspace(options); t.after(() => app.destroy());
  await app.settle(); await app.add(); await app.settle();
  assert.equal(app.read("currentStory().model.analysisReady"), true);
  await app.click("connect");
  return app;
}
async function start(app) {
  assert.equal(app.nodes.get("start").disabled, false, app.nodes.get("message").textContent);
  await app.click("start");
  assert.equal(app.nodes.get("start-dialog").open, true);
  await app.click("confirm-start"); await app.settle();
}

test("actual workspace connects, stops, starts again and reconnects without stale pending state", async t => {
  const app = await ready(t);
  assert.equal(app.read("latest.connected"), true);
  assert.equal(app.nodes.get("start").disabled, false);
  await start(app);
  assert.equal(app.read("latest.running"), true);
  await app.click("stop"); await app.settle();
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("start").disabled, false);
  assert.equal(app.lockHeld(), false);
  await start(app);
  assert.equal(app.read("latest.running"), true);
  await app.click("disconnect"); await app.settle();
  assert.equal(app.read("latest.connected"), false);
  assert.equal(app.nodes.get("connect").disabled, false);
  await app.click("connect"); await app.settle();
  assert.equal(app.read("latest.connected"), true);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("start").disabled, false);
  assert.deepEqual(app.errors, []);
});

test("starting a short story at the page top preserves its selected first section and manual correction", async t => {
  const app = await ready(t);
  app.nodes.get("level").value = "3";
  await app.nodes.get("level").dispatch("input");
  assert.equal(app.read("scrollY"), 0);
  assert.equal(app.read("latest.position"), 0);
  assert.equal(app.read("currentStory().model.paragraphs[0].override"), 3);
  await app.click("toggle-settings");
  app.nodes.get("font-size").value = "large";
  await app.nodes.get("font-size").dispatch("change");
  await app.click("close-settings");
  await start(app);
  assert.equal(app.read("latest.position"), 0, "The viewport anchor must not infer progress to the second short paragraph without scrolling.");
  assert.equal(app.read("latest.output"), 3, "Playback must use the selected first section's deliberate correction.");
});

test("the short-story top guard preserves manual Next/Previous and normal scrolling", async t => {
  const app = await ready(t);
  await app.click("next");
  assert.equal(app.read("latest.position"), 1);
  await app.click("previous");
  assert.equal(app.read("latest.position"), 0);
  app.read("followPosition()");
  assert.equal(app.read("latest.position"), 0);
  app.read("scrollY = 80; followPosition()");
  assert.equal(app.read("latest.position"), 1, "A scrolled reading view still uses the settled viewport anchor.");
  await app.click("previous");
  app.read("scrollY = 0; window.visualViewport = {offsetTop: 80, height: 920}; followPosition()");
  assert.equal(app.read("latest.position"), 1, "A panned visual viewport is not mistaken for the document top.");
});

test("Stop during confirmation leaves a fresh Start available", async t => {
  const app = await ready(t);
  await app.click("start");
  await app.click("start-stop"); await app.settle();
  assert.equal(app.nodes.get("start-dialog").open, false);
  assert.equal(app.read("pendingStart"), false);
  assert.equal(app.nodes.get("start").disabled, false);
  await start(app);
  assert.equal(app.read("latest.running"), true);
});

test("Stop while a Web Lock is pending releases a late lease and permits a fresh Start", async t => {
  const app = await ready(t);
  let release;
  app.holdLock(new Promise(resolve => { release = resolve; }));
  await start(app);
  assert.equal(app.read("pendingStart"), true);
  await app.click("stop");
  release(); await app.settle();
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("pendingStart"), false);
  assert.equal(app.lockHeld(), false);
  assert.equal(app.nodes.get("start").disabled, false);
  await start(app);
  assert.equal(app.read("latest.running"), true);
});

test("Stop during hosted Start revalidation cannot be undone by its late response", async t => {
  const app = await ready(t, {hosted: true});
  let resolve;
  app.access(() => new Promise(yes => { resolve = yes; }));
  await start(app);
  assert.equal(app.read("pendingStart"), true);
  await app.click("stop");
  resolve(Response.json({authenticated: true, expiresAt: app.now() + 3600000}));
  await app.settle();
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("pendingStart"), false);
  assert.equal(app.lockHeld(), false);
  assert.equal(app.nodes.get("start").disabled, false);
  app.access(async () => Response.json({authenticated: true, expiresAt: app.now() + 3600000}));
  await start(app);
  assert.equal(app.read("latest.running"), true);
});

test("a denied hosted Start offers a nearby retry that recovers readiness without automatic playback", async t => {
  const app = await ready(t, {hosted: true});
  app.access(async () => new Response("", {status: 403}));
  await start(app);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("start").disabled, true);
  assert.match(app.nodes.get("start-help").textContent, /sign-in/);
  assert.equal(app.nodes.get("retry-access").hidden, false);
  app.access(async () => Response.json({authenticated: true, expiresAt: app.now() + 3600000}));
  await app.click("retry-access"); await app.settle();
  assert.equal(app.nodes.get("start").disabled, false);
  assert.equal(app.read("latest.running"), false);
  await start(app);
  assert.equal(app.read("latest.running"), true);
});

test("a synchronous access error recovers through the nearby retry rather than leaving Start stuck", async t => {
  const app = await ready(t, {hosted: true});
  app.access(() => { throw Error("Synthetic access error"); });
  await start(app);
  assert.equal(app.read("pendingStart"), false);
  assert.equal(app.nodes.get("start").disabled, true);
  app.access(async () => Response.json({authenticated: true, expiresAt: app.now() + 3600000}));
  await app.click("retry-access"); await app.settle();
  assert.equal(app.nodes.get("start").disabled, false);
  assert.equal(app.read("latest.running"), false);
});

test("a periodic access denial stops active playback and successful recheck stays paused", async t => {
  const app = await ready(t, {hosted: true});
  await start(app);
  assert.equal(app.read("latest.running"), true);
  app.access(async () => new Response("", {status: 403}));
  await app.advance(60000);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("latest.output"), 0);
  assert.equal(app.lockHeld(), false);
  assert.equal(app.read("pendingStart"), false);
  assert.equal(app.nodes.get("start").disabled, true);
  app.access(async () => Response.json({authenticated: true, expiresAt: app.now() + 3600000}));
  await app.click("retry-access"); await app.settle();
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("start").disabled, false);
});

test("Stop cancels a pending import without damaging the existing ready story", async t => {
  const app = await ready(t);
  const original = app.read("activeId");
  await app.click("empty-new-story");
  app.nodes.get("source").value = "A different synthetic story.";
  await app.click("load");
  await app.click("import-stop"); await app.advance(0);
  assert.equal(app.read("activeId"), original);
  assert.equal(app.read("stories.length"), 1);
  assert.equal(app.read("importing"), false);
  assert.equal(app.nodes.get("start").disabled, false);
});

test("missing Web Locks explains why Start is unavailable while reading stays usable", async t => {
  const app = await ready(t, {locks: false});
  assert.equal(app.nodes.get("start").disabled, true);
  assert.match(app.nodes.get("start-help").textContent, /Web Locks.*HTTPS or localhost/);
  assert.equal(app.read("currentStory().model.analysisReady"), true);
  assert.equal(app.nodes.get("stop").disabled, false);
});

test("a rendering failure leaves explicit reconnect and Stop available instead of a silent dead end", async t => {
  const app = await ready(t);
  const cap = app.nodes.get("cap"), original = cap.setAttribute;
  cap.setAttribute = () => { throw Error("Synthetic render failure"); };
  await app.click("strength-plus"); await app.settle();
  assert.equal(app.read("controller.snapshot().state"), "ERROR_PAUSED");
  assert.equal(app.nodes.get("connect").disabled, false);
  assert.equal(app.nodes.get("connect").hidden, false);
  assert.equal(app.nodes.get("stop").disabled, false);
  assert.match(app.nodes.get("start-help").textContent, /controls could not update/);
  assert.doesNotMatch(app.nodes.get("message").textContent, /Synthetic render failure/);
  cap.setAttribute = original;
  await app.click("connect"); await app.settle();
  assert.equal(app.read("latest.connected"), true);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("start").disabled, false);
});

test("layout shortcuts ignore typing and the Stop shortcut works inside a dialog", async t => {
  const app = await ready(t);
  app.nodes.get("library-search").focus();
  await app.key({key: "f", altKey: true});
  assert.equal(app.read("Boolean(focusArrangement)"), false);
  app.document.activeElement = app.document.body;
  await app.key({key: "f", altKey: true});
  assert.equal(app.read("Boolean(focusArrangement)"), true);
  await app.key({key: "n", altKey: true});
  assert.equal(app.read("activeId"), null);
  assert.equal(app.document.activeElement, app.nodes.get("draft-story"));
  await app.click("empty-new-story");
  assert.equal(app.nodes.get("new-story-dialog").open, true);
  app.nodes.get("source").focus();
  await app.key({key: "X", altKey: true, shiftKey: true});
  assert.equal(app.nodes.get("new-story-dialog").open, false);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("pendingStart"), false);
});


test("direct typing opens a session-only story and keeps the existing library", async t => {
  const app = await ready(t);
  await app.click("new-story");
  app.nodes.get("draft-title").value = "A new draft";
  app.nodes.get("draft-story").value = "The clock moved slowly.\n\nThe train arrived.";
  await app.click("open-draft"); await app.settle();
  assert.equal(app.read("stories.length"), 2);
  assert.equal(app.read("currentStory().title"), "A new draft");
  assert.equal(app.read("currentStory().saved"), false);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("draft-story").value, "");
});

test("strength works before and during playback and maximum gestures never open a popup", async t => {
  const app = workspace(); t.after(() => app.destroy()); await app.settle();
  assert.equal(app.nodes.get("strength-plus").disabled, false);
  await app.click("strength-plus");
  assert.equal(app.read("latest.strength"), 1.1);
  await app.add(); await app.click("connect");
  app.nodes.get("level").value = "4"; await app.nodes.get("level").dispatch("input");
  await start(app);
  await app.click("strength-plus");
  assert.equal(app.read("latest.strength"), 1.1);
  app.nodes.get("cap").value = "9"; await app.nodes.get("cap").dispatch("input");
  assert.equal(app.read("latest.ceiling"), 9);
  assert.equal(app.read("latest.running"), true);
  assert.equal(app.nodes.get("ceiling-dialog").open, false);
  assert.equal(app.nodes.get("start-dialog").open, false);
  app.nodes.get("cap").value = "0"; await app.nodes.get("cap").dispatch("input");
  assert.equal(app.read("latest.output"), 0);
  await app.click("stop");
  app.nodes.get("cap").value = "8"; await app.nodes.get("cap").dispatch("input");
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.nodes.get("start").disabled, false);
});

test("desktop reading follows scroll while the simulator sidebar is visible", async t => {
  const app = await ready(t);
  await app.click("toggle-settings");
  app.read("scrollY = 80; followPosition()");
  assert.equal(app.read("latest.position"), 1);
  await app.resize(true);
  app.read("controller.setPosition(0); scrollY = 80; followPosition()");
  assert.equal(app.read("latest.position"), 0, "A mobile drawer obscures the reading area.");
});

test("global Settings opens separately, exposes Stop and closes on cancellation", async t => {
  const app = await ready(t);
  await start(app); await app.click("open-app-settings");
  assert.equal(app.nodes.get("app-settings-dialog").open, true);
  assert.equal(app.read("latest.running"), false);
  await app.click("app-settings-stop");
  assert.equal(app.nodes.get("app-settings-dialog").open, false);
  assert.equal(app.read("latest.output"), 0);
  assert.equal(app.nodes.get("start").disabled, false);
});


test("global Stop keeps the test-read coach available for restart but cancels pending setup", async t => {
  const app = await ready(t);
  app.read('let setupCancelled = 0; let setupPhase = "reading"; setupFlow = {snapshot: () => ({active:true,phase:setupPhase}),cancel: () => {setupCancelled++;},update: () => {}}');
  await start(app); await app.click("stop");
  assert.equal(app.read("setupCancelled"), 0);
  assert.equal(app.read("latest.output"), 0);
  assert.equal(app.nodes.get("start").disabled, false);
  app.read('setupPhase = "connect"');
  await app.click("stop");
  assert.equal(app.read("setupCancelled"), 1);
});
