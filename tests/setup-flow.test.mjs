import test from "node:test";
import assert from "node:assert/strict";
import {createSetupFlow, PRACTICE_STORY, SETUP_MODELS} from "../app/static/reader/setup-flow.mjs";
import {setupDOM} from "./helpers/setup-dom.mjs";

function harness(options = {}) {
  const dom = setupDOM(), calls = [], requests = [], coachMount = dom.make("div");
  const flow = createSetupFlow({...dom, coachMount,
    onConnect(request) {
      calls.push("connect"); requests.push(request);
      const toy = {id: "sim-" + request.model, label: request.model, model: request.model, capabilities: ["vibrate"]};
      flow.update({mode: request.mode, model: request.model, connectionState: "discovered", connected: true, running: false, output: 0,
        position: 0, levelAdjustment: 0, ceiling: 5, toys: [toy], selectedId: null});
      return true;
    },
    onSelectDevice(id) { calls.push("select"); flow.update({selectedId: id}); return true; },
    onTest(request) { calls.push({test: request}); return true; },
    onPractice(story) { calls.push(story); return true; },
    onStart() { calls.push("start"); }, onStop() { calls.push("stop"); },
    onFinish(result) { calls.push(result); }, ...options});
  const click = id => dom.nodes.get(id).click();
  const selectDevice = async (id = "sim-lush") => {
    dom.nodes.get("setup-devices").value = id; await dom.nodes.get("setup-devices").dispatch("change");
    await click("setup-primary");
  };
  const checkedTest = async () => {
    await click("setup-test");
    dom.nodes.get("setup-response-checked").checked = true;
    await dom.nodes.get("setup-response-checked").dispatch("change");
    await click("setup-primary");
  };
  const preparePractice = async () => {
    flow.open(); await click("setup-primary"); await selectDevice(); await checkedTest();
  };
  const openPractice = async () => { await preparePractice(); await click("setup-primary"); };
  return {...dom, flow, calls, requests, coachMount, click, selectDevice, checkedTest, preparePractice, openPractice};
}

test("guided setup requires deliberate connection, device selection, test confirmation, practice and Start", async () => {
  const app = harness(); app.flow.open();
  assert.deepEqual(app.calls, ["stop"]);
  assert.equal(app.nodes.get("setup-dialog").open, true);
  assert.equal(app.flow.snapshot().phase, "connect");
  await app.click("setup-primary");
  assert.deepEqual(app.requests, [{mode: "simulator", model: "lush"}]);
  assert.equal(app.flow.snapshot().phase, "select");
  assert.equal(app.nodes.get("setup-primary").disabled, true, "Detection never chooses a toy automatically.");
  assert.equal(app.calls.includes("start"), false);
  await app.selectDevice();
  assert.equal(app.flow.snapshot().phase, "test");
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  await app.click("setup-test");
  assert.equal(app.nodes.get("setup-primary").disabled, true, "An accepted request is not physical confirmation.");
  app.nodes.get("setup-response-checked").checked = true;
  await app.nodes.get("setup-response-checked").dispatch("change");
  await app.click("setup-primary"); assert.equal(app.flow.snapshot().phase, "practice");
  await app.click("setup-primary");
  assert.equal(app.calls.at(-1), PRACTICE_STORY);
  assert.equal(app.calls.includes("start"), false);
  assert.equal(app.nodes.get("setup-dialog").open, false);
  assert.equal(app.nodes.get("setup-coach").hidden, false);
  assert.equal(app.flow.snapshot().phase, "reading");
  await app.click("setup-start");
  assert.equal(app.calls.at(-1), "start");
  assert.deepEqual(PRACTICE_STORY.corrections, [0, 2, 4, 1, 3, 0]);
  assert.equal(PRACTICE_STORY.text.split("\n\n").length, PRACTICE_STORY.corrections.length);
});

test("every requested model can rehearse detection, explicit selection and bounded testing", async () => {
  assert.deepEqual(SETUP_MODELS.map(model => model.id), ["lush", "flexer", "nora", "domi", "velvo", "spinel", "dolce", "hush", "osci3"]);
  for (const model of SETUP_MODELS) {
    const app = harness(); app.flow.open({model: model.id}); await app.click("setup-primary");
    await app.selectDevice("sim-" + model.id); await app.checkedTest();
    assert.equal(app.flow.snapshot().phase, "practice", model.id);
    assert.deepEqual(app.calls.find(value => value?.test), {test: {channel: "vibrate", level: 1}});
    assert.equal(app.calls.includes("start"), false);
  }
});

test("skipping a pending Connect stops and invalidates its late successful continuation", async () => {
  let settle;
  const app = harness({onConnect: () => new Promise(resolve => { settle = resolve; })});
  app.flow.open(); const pending = app.click("setup-primary");
  assert.equal(app.flow.snapshot().busy, true);
  assert.equal(app.nodes.get("setup-stop").disabled, false);
  await app.click("setup-skip"); settle(true); await pending;
  assert.equal(app.flow.snapshot().phase, "closed");
  assert.equal(app.nodes.get("setup-dialog").open, false);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
  assert.deepEqual(app.calls, ["stop", "stop"]);
});

test("Stop during practice loading cancels progression and leaves an explicit retry", async () => {
  let settle, count = 0;
  const app = harness({onPractice() { count++; return count === 1 ? new Promise(resolve => { settle = resolve; }) : true; }});
  await app.preparePractice();
  const pending = app.click("setup-primary");
  await app.click("setup-stop"); settle(true); await pending;
  assert.equal(app.flow.snapshot().phase, "practice");
  assert.equal(app.flow.snapshot().busy, false);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
  await app.click("setup-primary"); assert.equal(app.flow.snapshot().phase, "reading");
});

test("native Escape cancellation stops and restores the opener", async () => {
  const app = harness(), opener = app.make("button"); opener.focus(); app.flow.open();
  await app.nodes.get("setup-dialog").dispatch("cancel");
  assert.equal(app.flow.snapshot().active, false);
  assert.equal(app.document.activeElement, opener);
  assert.deepEqual(app.calls, ["stop", "stop"]);
});

test("the practice checklist observes control changes and restart; Finish always stops first", async () => {
  const app = harness(); await app.openPractice();
  app.flow.update({connected: true, running: true, output: 2, position: 0, levelAdjustment: 0, ceiling: 5});
  app.flow.update({connected: true, running: true, output: 4, position: 2, levelAdjustment: 1, ceiling: 6});
  assert.equal(app.flow.snapshot().checks.restart, false);
  app.flow.update({connected: true, running: false, output: 0, position: 2, levelAdjustment: 1, ceiling: 6});
  app.flow.update({connected: true, running: true, output: 4, position: 2, levelAdjustment: 1, ceiling: 6});
  assert.deepEqual(app.flow.snapshot().checks, {started: true, position: true, level: true, maximum: true, restart: true});
  await app.click("setup-finish");
  assert.deepEqual(app.calls.slice(-2), ["stop", {completed: true}]);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
});

test("an unfinished practice can be left without completion; failed loading stays recoverable", async () => {
  const app = harness({onPractice: () => false}); await app.preparePractice(); await app.click("setup-primary");
  assert.equal(app.flow.snapshot().phase, "practice");
  assert.match(app.nodes.get("setup-status").textContent, /could not open/);
  assert.equal(app.nodes.get("setup-primary").disabled, false);
  app.flow.finish();
  assert.deepEqual(app.calls.slice(-2), ["stop", {completed: false}]);
  app.flow.destroy(); assert.equal(app.nodes.get("setup-dialog").isConnected, false);
});

test("global Stop can cancel pending setup through the public cancel method", async () => {
  let settle;
  const app = harness({onConnect: () => new Promise(resolve => { settle = resolve; })});
  app.flow.open(); const pending = app.click("setup-primary"); app.flow.cancel(); settle(true); await pending;
  assert.equal(app.flow.snapshot().active, false);
  assert.equal(app.nodes.get("setup-dialog").open, false);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
  assert.equal(app.calls.at(-1), "stop");
});

test("the coach mirrors unavailable Start readiness and recovers without automatic output", async () => {
  let app;
  app = harness({onPractice() {
    app.flow.update({connected: true, running: false, output: 0, position: 0, levelAdjustment: 0,
      ceiling: 5, canStart: false, readiness: "Start needs browser Web Locks."}); return true;
  }});
  await app.openPractice();
  assert.equal(app.nodes.get("setup-start").disabled, true);
  assert.equal(app.nodes.get("setup-coach-status").textContent, "Start needs browser Web Locks.");
  assert.equal(app.document.activeElement, app.nodes.get("setup-coach-heading"));
  assert.equal(app.nodes.get("setup-coach-heading").getAttribute("tabindex"), "-1");
  await app.click("setup-start"); assert.equal(app.calls.includes("start"), false);
  app.flow.update({connected: true, running: false, output: 0, position: 0, levelAdjustment: 0, ceiling: 5, canStart: true});
  assert.equal(app.nodes.get("setup-start").disabled, false);
  assert.equal(app.nodes.get("setup-coach-status").textContent, "");
  assert.equal(app.calls.includes("start"), false);
  await app.click("setup-start"); assert.equal(app.calls.at(-1), "start");
  app.flow.update({connected: true, running: false, output: 0, position: 0, canStart: false});
  assert.match(app.nodes.get("setup-coach-status").textContent, /Check the playback message/);
});

test("real pairing waits for detected toys, validates QR origin and never invents connection success", async () => {
  const app = harness({onConnect: () => ({connected: false, toys: [], qrUrl: "https://evil.example/code.png", liveConfigured: true})});
  app.flow.open({mode: "lovense", model: "nora"}); await app.click("setup-primary");
  assert.equal(app.flow.snapshot().phase, "pair");
  assert.equal(app.nodes.get("setup-qr").hidden, true);
  assert.match(app.nodes.get("setup-qr-placeholder").textContent, /Waiting/);
  assert.match(app.nodes.get("setup-instructions").children[1].textContent, /Lovense Remote/);
  assert.equal(app.calls.includes("select"), false); assert.equal(app.calls.includes("start"), false);
  app.flow.update({qrUrl: "https://api.lovense-api.com/private-code.png"});
  assert.equal(app.nodes.get("setup-qr").hidden, false);
  app.flow.update({connected: true, toys: [{id: "real-nora", label: "Nora", capabilities: ["vibrate", "rotate"]}]});
  assert.equal(app.flow.snapshot().phase, "select");
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  await app.selectDevice("real-nora");
  assert.deepEqual(app.nodes.get("setup-channel").children.map(option => option.value), ["vibrate", "rotate"]);
  await app.click("setup-close");
  assert.equal(app.flow.snapshot().active, false);
});

test("missing live credentials presents a simulator alternative instead of a usable fake pairing code", async () => {
  const app = harness({onConnect: () => ({liveConfigured: false, connected: false, toys: []})});
  app.flow.open({mode: "lovense"}); await app.click("setup-primary");
  assert.equal(app.flow.snapshot().phase, "pair");
  assert.match(app.nodes.get("setup-qr-placeholder").textContent, /not configured/);
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  assert.match(app.nodes.get("setup-pairing-note").textContent, /site owner/);
  await app.click("setup-back"); await app.click("setup-mode-simulator");
  assert.equal(app.flow.snapshot().mode, "simulator");
  assert.equal(app.nodes.get("setup-primary").disabled, false);
});

test("test controls reject stale selection, unreported channels, bad levels and failed requests", async () => {
  const app = harness({onTest: () => false}); app.flow.open(); await app.click("setup-primary"); await app.selectDevice();
  app.nodes.get("setup-test-level").value = "6"; await app.click("setup-test");
  assert.equal(app.flow.snapshot().tested, false);
  app.nodes.get("setup-test-level").value = "1"; app.nodes.get("setup-channel").value = "rotate"; await app.click("setup-test");
  assert.equal(app.flow.snapshot().tested, false);
  app.nodes.get("setup-channel").value = "vibrate"; await app.click("setup-test");
  assert.equal(app.flow.snapshot().tested, false);
  assert.match(app.nodes.get("setup-status").textContent, /not confirmed/);
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  app.flow.update({connected: false, selectedId: null, toys: []});
  assert.equal(app.flow.snapshot().phase, "pair");
  assert.equal(app.calls.includes("start"), false);
});

test("rehearsal disconnect and reconnect repeat explicit selection and testing without resuming", async () => {
  let app;
  app = harness({onSimulateFailure() { app.flow.update({connected: false, selectedId: null, toys: [], output: 0}); return true; }});
  app.flow.open({model: "flexer"}); await app.click("setup-primary"); await app.selectDevice("sim-flexer");
  await app.click("setup-test"); assert.equal(app.flow.snapshot().tested, true);
  await app.click("setup-sim-failure");
  assert.equal(app.flow.snapshot().phase, "pair"); assert.equal(app.flow.snapshot().tested, false);
  assert.match(app.nodes.get("setup-status").textContent, /connection lost/i);
  await app.click("setup-retry"); assert.equal(app.flow.snapshot().phase, "select");
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  assert.equal(app.calls.includes("start"), false);
});

test("closing during a pending rehearsal failure cannot reopen or advance the dialog", async () => {
  let settle;
  const app = harness({onSimulateFailure: () => new Promise(resolve => { settle = resolve; })});
  app.flow.open(); await app.click("setup-primary");
  const pending = app.click("setup-sim-failure"); await app.click("setup-close"); settle(true); await pending;
  assert.equal(app.flow.snapshot().phase, "closed"); assert.equal(app.nodes.get("setup-dialog").open, false);
});

test("an accepted test cannot continue while output is active; selection loss invalidates confirmation", async () => {
  const app = harness({onTest: () => ({output: 1})}); app.flow.open(); await app.click("setup-primary"); await app.selectDevice();
  await app.click("setup-test");
  assert.equal(app.flow.snapshot().tested, true);
  assert.equal(app.nodes.get("setup-response-checked").disabled, true);
  app.nodes.get("setup-response-checked").checked = true;
  await app.nodes.get("setup-response-checked").dispatch("change");
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  app.flow.update({output: 0});
  assert.equal(app.nodes.get("setup-response-checked").disabled, false);
  assert.equal(app.nodes.get("setup-primary").disabled, false);
  app.flow.update({selectedId: null});
  assert.equal(app.flow.snapshot().phase, "select");
  assert.equal(app.flow.snapshot().tested, false);
  assert.equal(app.nodes.get("setup-devices").value, "");
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  assert.equal(app.calls.includes("start"), false);
});

test("live setup treats unknown output as unconfirmed and requires a fresh stopped check", async () => {
  const app = harness({onTest: () => ({output: null, outputKnown: false})});
  app.flow.open({mode: "lovense"});
  await app.click("setup-primary");
  await app.selectDevice();
  await app.click("setup-test");
  assert.equal(app.nodes.get("setup-live-output").textContent, "Requested output unconfirmed");
  assert.equal(app.nodes.get("setup-response-checked").disabled, true);
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  app.flow.update({output: 0, outputKnown: false});
  assert.equal(app.nodes.get("setup-live-output").textContent, "Requested output unconfirmed");
  assert.equal(app.nodes.get("setup-response-checked").disabled, true);
  app.flow.update({output: 0, outputKnown: true});
  assert.equal(app.nodes.get("setup-response-checked").disabled, false);
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  app.nodes.get("setup-response-checked").checked = true;
  await app.nodes.get("setup-response-checked").dispatch("change");
  await app.click("setup-primary");
  assert.equal(app.flow.snapshot().phase, "practice");
});

test("late test acknowledgement after Stop cannot enable confirmation or advance setup", async () => {
  let settle;
  const app = harness({onTest: () => new Promise(resolve => { settle = resolve; })});
  app.flow.open(); await app.click("setup-primary"); await app.selectDevice();
  const pending = app.click("setup-test");
  await app.click("setup-stop"); settle(true); await pending;
  assert.equal(app.flow.snapshot().phase, "test");
  assert.equal(app.flow.snapshot().tested, false);
  assert.equal(app.nodes.get("setup-response-checked").disabled, true);
  assert.equal(app.nodes.get("setup-primary").disabled, true);
});

test("late selection after Close does not display a test or open the practice coach", async () => {
  let settle;
  const app = harness({onSelectDevice: () => new Promise(resolve => { settle = resolve; })});
  app.flow.open(); await app.click("setup-primary");
  app.nodes.get("setup-devices").value = "sim-lush"; await app.nodes.get("setup-devices").dispatch("change");
  const pending = app.click("setup-primary");
  await app.click("setup-close"); settle({selectedId: "sim-lush"}); await pending;
  assert.equal(app.flow.snapshot().phase, "closed");
  assert.equal(app.nodes.get("setup-dialog").open, false);
  assert.equal(app.nodes.get("setup-coach").hidden, true);
  assert.equal(app.calls.includes("start"), false);
});

test("test selection respects the current maximum including zero, and never silently raises it", async () => {
  const app = harness(); app.flow.open(); await app.click("setup-primary"); await app.selectDevice();
  app.flow.update({ceiling: 0});
  assert.equal(app.nodes.get("setup-test").disabled, true);
  assert.match(app.nodes.get("setup-test-maximum").textContent, /maximum 0/);
  assert.match(app.nodes.get("setup-test-maximum").textContent, /Close setup/);
  await app.click("setup-test"); assert.equal(app.calls.some(value => value?.test), false);
  app.flow.update({ceiling: 3}); app.nodes.get("setup-test-level").value = "4";
  await app.click("setup-test"); assert.equal(app.calls.some(value => value?.test), false);
  app.nodes.get("setup-test-level").value = "2"; await app.click("setup-test");
  assert.deepEqual(app.calls.find(value => value?.test), {test: {channel: "vibrate", level: 2}});
  assert.match(app.nodes.get("setup-test-maximum").textContent, /3\/20/);
});

test("discovered toys are selectable before the playback adapter is connected", async () => {
  let app;
  app = harness({
    onConnect() { return {connected: false, connectionState: "discovered", toys: [{id: "sim-nora", label: "Nora", model: "nora", capabilities: ["vibrate", "rotate"]}], selectedId: null, ceiling: 5}; },
    onSelectDevice(id) { return {selectedId: id, connected: true}; },
  });
  app.flow.open({model: "nora"}); await app.click("setup-primary");
  assert.equal(app.flow.snapshot().phase, "select");
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  await app.selectDevice("sim-nora");
  assert.equal(app.flow.snapshot().phase, "test");
  assert.equal(app.nodes.get("setup-test").disabled, false);
  assert.equal(app.calls.includes("start"), false);
});

test("changing the test level invalidates the old response confirmation without a popup", async () => {
  const app = harness(); app.flow.open(); await app.click("setup-primary"); await app.selectDevice();
  await app.click("setup-test"); app.nodes.get("setup-response-checked").checked = true;
  await app.nodes.get("setup-response-checked").dispatch("change");
  assert.equal(app.nodes.get("setup-primary").disabled, false);
  app.nodes.get("setup-test-level").value = "3"; await app.nodes.get("setup-test-level").dispatch("input");
  assert.equal(app.nodes.get("setup-test-level").value, "3");
  assert.equal(app.flow.snapshot().tested, false);
  assert.equal(app.nodes.get("setup-response-checked").checked, false);
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  await app.click("setup-test");
  assert.deepEqual(app.calls.filter(value => value?.test).at(-1), {test: {channel: "vibrate", level: 3}});
  app.flow.update({ceiling: 1});
  assert.equal(app.nodes.get("setup-test-level").value, "1");
  assert.equal(app.flow.snapshot().tested, false);
  assert.equal(app.nodes.get("setup-primary").disabled, true);
});

test("human confirmation is forwarded only after an eligible stopped test and can be refused", async () => {
  let confirmations = 0, accepted = false;
  const app = harness({onConfirmTest() { confirmations++; return accepted; }});
  app.flow.open(); await app.click("setup-primary"); await app.selectDevice();
  await app.click("setup-primary"); assert.equal(confirmations, 0);
  await app.click("setup-test"); await app.click("setup-primary"); assert.equal(confirmations, 0);
  app.nodes.get("setup-response-checked").checked = true; await app.nodes.get("setup-response-checked").dispatch("change");
  await app.click("setup-primary");
  assert.equal(confirmations, 1);
  assert.equal(app.flow.snapshot().phase, "test");
  assert.equal(app.flow.snapshot().tested, false);
  assert.match(app.nodes.get("setup-status").textContent, /no longer current/);
  accepted = true; await app.click("setup-test");
  app.nodes.get("setup-response-checked").checked = true; await app.nodes.get("setup-response-checked").dispatch("change");
  await app.click("setup-primary");
  assert.equal(confirmations, 2);
  assert.equal(app.flow.snapshot().phase, "practice");
  assert.equal(app.calls.includes("start"), false);
});

test("a simulated error cannot reuse stale discovery to bypass the required reconnect", async () => {
  let app;
  app = harness({onSimulateFailure() { return {connectionState: "error", connected: true}; }});
  app.flow.open(); await app.click("setup-primary"); await app.selectDevice();
  await app.click("setup-sim-error");
  assert.equal(app.flow.snapshot().phase, "pair");
  assert.equal(app.nodes.get("setup-primary").textContent, "Reconnect");
  app.flow.update({output: 0});
  assert.equal(app.flow.snapshot().phase, "pair", "Stale toys do not turn an error into discovery.");
  await app.click("setup-primary");
  assert.equal(app.requests.length, 2);
  assert.equal(app.flow.snapshot().phase, "select");
  assert.equal(app.nodes.get("setup-primary").disabled, true);
  assert.equal(app.calls.includes("start"), false);
});
