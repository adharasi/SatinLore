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
  await app.click("new-story");
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
  assert.equal(app.nodes.get("new-story-dialog").open, true);
  app.nodes.get("source").focus();
  await app.key({key: "X", altKey: true, shiftKey: true});
  assert.equal(app.nodes.get("new-story-dialog").open, false);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("pendingStart"), false);
});
