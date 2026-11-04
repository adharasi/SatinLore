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

test("Start names the chosen movement and a changed device invalidates the old confirmation", async t => {
  const app = await ready(t);
  await app.read('controller.beginConnection({mode:"simulator",model:"nora"})');
  await app.read('controller.selectDevice("sim-nora")');
  const pulse = app.read('controller.test({channel:"rotate",level:1})');
  await app.settle(); await app.advance(2000); assert.equal(await pulse, true);
  await app.click("start");
  assert.match(app.nodes.get("start-summary").textContent, /Nora simulator · Rotation/);
  await app.read('controller.beginConnection({mode:"simulator",model:"domi"})');
  await app.read('controller.selectDevice("sim-domi")');
  await app.click("confirm-start"); await app.settle();
  assert.equal(app.read("latest.running"), false, "A confirmation for Nora must not authorise Domi.");
  assert.equal(app.read("latest.output"), 0);
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
  app.nodes.get("level").value = "3";
  await app.nodes.get("level").dispatch("input");
  const cap = app.nodes.get("cap"), original = cap.setAttribute;
  cap.setAttribute = () => { throw Error("Synthetic render failure"); };
  await app.click("level-up"); await app.settle();
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

test("section levels change by one before and during playback without a maximum popup", async t => {
  const app = workspace(); t.after(() => app.destroy()); await app.settle();
  assert.equal(app.nodes.get("level-up").disabled, true);
  await app.add(); await app.click("connect");
  assert.equal(app.read("latest.ceiling"), 10);
  app.nodes.get("cap").value = "5"; await app.nodes.get("cap").dispatch("input");
  app.nodes.get("level").value = "3"; await app.nodes.get("level").dispatch("input");
  await app.click("level-up");
  assert.equal(app.read("latest.target"), 4);
  assert.equal(app.read("latest.output"), 0);
  await start(app);
  await app.click("level-up");
  assert.equal(app.read("latest.target"), 5);
  assert.equal(app.nodes.get("level-up").disabled, true);
  assert.equal(app.read("currentStory().model.paragraphs[0].override"), 3);
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

test("Sync here selects the visible paragraph without starting paused playback", async t => {
  const app = await ready(t);
  app.nodes.get("follow-scroll").checked = false;
  app.read("scrollY = 80");
  await app.click("sync-here");
  assert.equal(app.read("latest.position"), 1);
  assert.equal(app.read("activeNode.getAttribute('aria-current')"), "true");
  assert.equal(app.read("activeNode.dataset.playing"), "false");
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("latest.output"), 0);
});

test("scroll jumps mute the old output and settle only on the final paragraph; Stop cancels recovery", async t => {
  const app = workspace(); t.after(() => app.destroy());
  await app.settle();
  await app.add(Array.from({length: 12}, () => "They shared a tender kiss.").join("\n\n"));
  await app.click("connect");
  app.read("controller.setLevel(0, 5); controller.setLevel(6, 5)");
  await start(app);
  assert.equal(app.read("latest.output"), 5);
  assert.equal(app.read("activeNode.dataset.playing"), "true");
  await app.advance(600);
  assert.equal(app.read("latest.output"), 5, "Dwelling at the same location keeps the current section.");
  app.read('scrollY = 820; window.dispatchEvent({type:"scroll"})');
  assert.equal(app.read("latest.readingSeeking"), true);
  assert.equal(app.read("latest.output"), 0);
  await app.advance(100);
  app.read('scrollY = 1040; window.dispatchEvent({type:"scroll"})');
  assert.equal(app.read("latest.position"), 0, "Intermediate paragraphs are skipped.");
  await app.advance(180);
  assert.equal(app.read("latest.position"), 6);
  assert.equal(app.read("latest.readingSeeking"), false);
  await app.advance(1000);
  assert.ok(app.read("latest.output") > 0 && app.read("latest.output") < 5, "The destination level returns in steps.");
  app.read('scrollY = 0; window.dispatchEvent({type:"scroll"})');
  assert.equal(app.read("latest.readingSeeking"), true);
  await app.click("stop");
  await app.advance(2000);
  assert.equal(app.read("latest.readingSeeking"), false);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("latest.output"), 0);
});

test("a jump past the story stays quiet until a destination is visible and invalidates a pending Start", async t => {
  const app = await ready(t);
  app.read("controller.setLevel(0, 5)");
  await app.click("start");
  assert.equal(app.nodes.get("start-dialog").open, true);
  app.read('scrollY = 1000; window.dispatchEvent({type:"scroll"})');
  assert.equal(app.nodes.get("start-dialog").open, false);
  assert.equal(app.read("latest.running"), false);
  await app.advance(180);
  app.read('scrollY = 0; window.dispatchEvent({type:"scroll"})');
  await app.advance(180);
  await start(app);
  app.read('scrollY = 1000; window.dispatchEvent({type:"scroll"})');
  await app.advance(1200);
  assert.equal(app.read("latest.readingSeeking"), true, "There is no new paragraph in view.");
  assert.equal(app.read("latest.output"), 0);
  app.read('scrollY = 80; window.dispatchEvent({type:"scroll"})');
  await app.advance(180);
  assert.equal(app.read("latest.position"), 1);
  assert.equal(app.read("latest.readingSeeking"), false);
});

test("global Settings opens paused and both Close controls return to the reader", async t => {
  const app = await ready(t);
  await start(app); await app.click("open-app-settings");
  assert.equal(app.nodes.get("app-settings-dialog").open, true);
  assert.equal(app.read("latest.running"), false);
  await app.click("app-settings-close");
  assert.equal(app.nodes.get("app-settings-dialog").open, false);
  assert.equal(app.read("latest.output"), 0);
  assert.equal(app.nodes.get("start").disabled, false);
  await app.click("open-app-settings"); await app.click("close-app-settings");
  assert.equal(app.nodes.get("app-settings-dialog").open, false);
  assert.equal(app.document.activeElement, app.nodes.get("open-app-settings"));
});

test("the header theme switch pauses playback, preserves position and synchronises the gear choice", async t => {
  const app = await ready(t); app.bootAppearance();
  await app.click("next");
  const position = app.read("latest.position");
  await start(app); await app.click("toggle-dark-mode");
  assert.equal(app.document.documentElement.dataset.theme, "dark");
  assert.equal(app.nodes.get("reading-appearance").value, "dark");
  assert.equal(app.nodes.get("toggle-dark-mode").getAttribute("aria-checked"), "true");
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("latest.output"), 0);
  assert.equal(app.read("latest.position"), position);
  assert.equal(app.preferenceValues.get("satinlore.appearance"), "dark");
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

test("actual reading feel controls preserve an opt-in background, recovery, explicit zero and Stop", async t => {
  const app = await ready(t);
  assert.equal(app.nodes.get("feel-hold").disabled, true);
  app.nodes.get("feel-mode").value = "continuous";
  await app.nodes.get("feel-mode").dispatch("change");
  for (const [key, value] of [["background", 2], ["recovery", 1]]) {
    app.nodes.get(`feel-${key}`).value = String(value);
    await app.nodes.get(`feel-${key}`).dispatch("input");
  }
  assert.equal(app.read("latest.running"), false, "Choosing a background must not start playback.");
  await start(app);
  await app.click("next"); await app.advance(1000);
  assert.equal(app.read("latest.baseLevel"), 0);
  assert.equal(app.read("latest.output"), 2, "An analysed quiet paragraph can use the opted-in background.");
  app.nodes.get("manual-level").value = "4";
  await app.nodes.get("manual-level").dispatch("input"); await app.advance(1000);
  assert.equal(app.read("latest.output"), 4);
  assert.equal(app.read("latest.feel.playbackMode"), "hold");
  await app.click("feel-easeoff"); await app.advance(1000);
  assert.equal(app.read("latest.output"), 1);
  assert.equal(app.read("latest.feel.playbackMode"), "ease-off");
  await app.click("feel-follow"); await app.advance(1000);
  assert.equal(app.read("latest.output"), 2);
  app.nodes.get("level").value = "0";
  await app.nodes.get("level").dispatch("input"); await app.advance(1000);
  assert.equal(app.read("latest.output"), 0, "A deliberate paragraph zero overrides the background.");
  await app.click("stop"); await app.click("feel-follow"); await app.advance(1000);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("latest.output"), 0);
  assert.equal(app.nodes.get("feel-follow").disabled, true);
  assert.equal(app.nodes.get("start").disabled, false);
  assert.deepEqual(app.errors, []);
});

test("Start and manual exploration show active movement limits rather than an unapplied calibration draft", async t => {
  const app = await ready(t);
  app.nodes.get("level").value = "9";
  await app.nodes.get("level").dispatch("input");
  app.nodes.get("cap").value = "9";
  await app.nodes.get("cap").dispatch("input");
  const activeMaximum = app.read("latest.feel.maximum");
  app.read('controller.setCalibration("vibrate", {minimum:0,background:1,preferred:3,maximum:5,recovery:0,gain:1,rhythm:"steady"})');
  assert.equal(app.read("latest.feel.maximum"), activeMaximum, "An unapplied draft must not change the active movement policy.");
  assert.equal(app.read("selectedSettings().maximum"), activeMaximum, "The sidebar must describe the active policy, not the draft's smaller maximum.");
  await app.click("start");
  assert.match(app.nodes.get("start-summary").textContent, /Vibration · up to 9\/20/);
  await app.click("confirm-start"); await app.settle();
  assert.equal(app.read("latest.output"), 9);
  assert.equal(Number(app.nodes.get("manual-level").max), 9);
  app.nodes.get("feel-maximum").value = "4";
  await app.nodes.get("feel-maximum").dispatch("input"); await app.advance(1000);
  assert.equal(app.read("latest.feel.maximum"), 4, "A deliberate movement edit still lowers the actual policy.");
  assert.equal(app.read("selectedSettings().maximum"), 4);
  assert.equal(app.read("latest.output"), 4);
  assert.deepEqual(app.errors, []);
});
