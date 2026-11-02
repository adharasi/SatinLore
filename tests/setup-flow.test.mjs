import test from "node:test";
import assert from "node:assert/strict";
import {createSetupFlow, PRACTICE_STORY} from "../app/static/reader/setup-flow.mjs";
import {setupDOM} from "./helpers/setup-dom.mjs";

function harness(options = {}) {
  const dom = setupDOM(), calls = [], coachMount = dom.make("div");
  const flow = createSetupFlow({...dom, coachMount,
    onConnect() { calls.push("connect"); flow.update({connected: true, running: false, output: 0, position: 0, strength: 1, ceiling: 5}); return true; },
    onPractice(story) { calls.push(story); return true; },
    onStart() { calls.push("start"); }, onStop() { calls.push("stop"); },
    onFinish(result) { calls.push(result); }, ...options});
  return {...dom, flow, calls, coachMount};
}

test("guided setup requires deliberate Connect, practice open and Start without automatic output", async () => {
  const app = harness(); app.flow.open();
  assert.deepEqual(app.calls, ["stop"]);
  assert.equal(app.nodes.get("setup-dialog").open, true);
  assert.equal(app.flow.snapshot().phase, "connect");
  await app.nodes.get("setup-primary").click();
  assert.deepEqual(app.calls, ["stop", "connect"]);
  assert.equal(app.flow.snapshot().phase, "practice");
  await app.nodes.get("setup-primary").click();
  assert.equal(app.calls.at(-1), PRACTICE_STORY);
  assert.equal(app.calls.includes("start"), false);
  assert.equal(app.nodes.get("setup-dialog").open, false);
  assert.equal(app.nodes.get("setup-coach").hidden, false);
  assert.equal(app.flow.snapshot().phase, "reading");
  await app.nodes.get("setup-start").click();
  assert.equal(app.calls.at(-1), "start");
  assert.deepEqual(PRACTICE_STORY.corrections, [0, 2, 4, 1, 3, 0]);
  assert.equal(PRACTICE_STORY.text.split("\n\n").length, PRACTICE_STORY.corrections.length);
});

test("skipping a pending Connect stops and invalidates its late successful continuation", async () => {
  let settle;
  const app = harness({onConnect: () => new Promise(resolve => { settle = resolve; })});
  app.flow.open(); const pending = app.nodes.get("setup-primary").click();
  assert.equal(app.flow.snapshot().busy, true);
  assert.equal(app.nodes.get("setup-stop").disabled, false);
  await app.nodes.get("setup-skip").click(); settle(true); await pending;
  assert.equal(app.flow.snapshot().phase, "closed");
  assert.equal(app.nodes.get("setup-dialog").open, false);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
  assert.deepEqual(app.calls, ["stop", "stop"]);
});

test("Stop during practice loading cancels pending progression and allows an explicit retry", async () => {
  let settle, count = 0;
  const app = harness({onPractice() { count++; return count === 1 ? new Promise(resolve => { settle = resolve; }) : true; }});
  app.flow.open(); await app.nodes.get("setup-primary").click();
  const pending = app.nodes.get("setup-primary").click();
  await app.nodes.get("setup-stop").click(); settle(true); await pending;
  assert.equal(app.flow.snapshot().phase, "practice");
  assert.equal(app.flow.snapshot().busy, false);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
  await app.nodes.get("setup-primary").click();
  assert.equal(app.flow.snapshot().phase, "reading");
});

test("native Escape cancellation stops and restores the opener while preserving all other stories", async () => {
  const app = harness(), opener = app.make("button"); opener.focus(); app.flow.open();
  await app.nodes.get("setup-dialog").dispatch("cancel");
  assert.equal(app.flow.snapshot().active, false);
  assert.equal(app.document.activeElement, opener);
  assert.deepEqual(app.calls, ["stop", "stop"]);
});

test("the practice checklist observes control changes and restart, and Finish always stops first", async () => {
  const app = harness(); app.flow.open();
  await app.nodes.get("setup-primary").click(); await app.nodes.get("setup-primary").click();
  app.flow.update({connected: true, running: true, output: 2, position: 0, strength: 1, ceiling: 5});
  app.flow.update({connected: true, running: true, output: 4, position: 2, strength: 1.2, ceiling: 6});
  assert.equal(app.flow.snapshot().checks.restart, false);
  app.flow.update({connected: true, running: false, output: 0, position: 2, strength: 1.2, ceiling: 6});
  app.flow.update({connected: true, running: true, output: 4, position: 2, strength: 1.2, ceiling: 6});
  assert.deepEqual(app.flow.snapshot().checks, {started: true, position: true, strength: true, maximum: true, restart: true});
  await app.nodes.get("setup-finish").click();
  assert.deepEqual(app.calls.slice(-2), ["stop", {completed: true}]);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
});

test("an unfinished practice can be left without claiming completion and a failed load stays recoverable", async () => {
  const app = harness({onPractice: () => false}); app.flow.open();
  await app.nodes.get("setup-primary").click(); await app.nodes.get("setup-primary").click();
  assert.equal(app.flow.snapshot().phase, "practice");
  assert.match(app.nodes.get("setup-status").textContent, /could not open/);
  assert.equal(app.nodes.get("setup-primary").disabled, false);
  app.flow.finish();
  assert.deepEqual(app.calls.slice(-2), ["stop", {completed: false}]);
  app.flow.destroy(); assert.equal(app.nodes.get("setup-dialog").isConnected, false);
});

test("the application's global Stop can cancel a pending setup through the public cancel method", async () => {
  let settle;
  const app = harness({onConnect: () => new Promise(resolve => { settle = resolve; })});
  app.flow.open(); const pending = app.nodes.get("setup-primary").click();
  app.flow.cancel(); settle(true); await pending;
  assert.equal(app.flow.snapshot().active, false);
  assert.equal(app.nodes.get("setup-dialog").open, false);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
  assert.equal(app.calls.at(-1), "stop");
});

test("the coach mirrors unavailable Start readiness immediately and recovers without starting automatically", async () => {
  let app;
  app = harness({onPractice() {
    app.flow.update({connected: true, running: false, output: 0, position: 0, strength: 1,
      ceiling: 5, canStart: false, readiness: "Start needs browser Web Locks."});
    return true;
  }});
  app.flow.open(); await app.nodes.get("setup-primary").click(); await app.nodes.get("setup-primary").click();
  assert.equal(app.nodes.get("setup-start").disabled, true, "Initial readiness is applied as soon as the practice coach opens.");
  assert.equal(app.nodes.get("setup-coach-status").textContent, "Start needs browser Web Locks.");
  assert.equal(app.document.activeElement, app.nodes.get("setup-coach-heading"));
  assert.equal(app.nodes.get("setup-coach-heading").getAttribute("tabindex"), "-1");
  await app.nodes.get("setup-start").click();
  assert.equal(app.calls.includes("start"), false);
  app.flow.update({connected: true, running: false, output: 0, position: 0, strength: 1, ceiling: 5, canStart: true});
  assert.equal(app.nodes.get("setup-start").disabled, false);
  assert.equal(app.nodes.get("setup-coach-status").textContent, "");
  assert.equal(app.calls.includes("start"), false);
  await app.nodes.get("setup-start").click(); assert.equal(app.calls.at(-1), "start");
  app.flow.update({connected: true, running: false, output: 0, position: 0, canStart: false});
  assert.match(app.nodes.get("setup-coach-status").textContent, /Check the playback message/);
});
