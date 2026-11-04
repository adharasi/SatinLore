import test from "node:test";
import assert from "node:assert/strict";
import {createCalibrationView, calibrationFeature, calibrationDraft, CALIBRATION_FIELDS} from "../app/static/reader/calibration-view.mjs";
import {createSetupFlow, SETUP_STORIES} from "../app/static/reader/setup-flow.mjs";
import {setupDOM} from "./helpers/setup-dom.mjs";

const context = overrides => ({model: "flexer", mode: "simulator", connected: true, selectedId: "sim-flexer",
  channels: ["vibrate", "fingering"], ceiling: 5, output: 0, supportsCombined: true, ...overrides});

function viewHarness(options = {}) {
  const dom = setupDOM(), changes = [], events = [], tests = [], applied = [], complete = [], stops = [];
  const view = createCalibrationView({...dom, mount: dom.make("div"), onChange: value => changes.push(value),
    onEvent: value => events.push(value), onStop: () => stops.push(true),
    onTest: value => {tests.push(value); return true;}, onConfirmTest: () => true,
    onApply: value => {applied.push(value); return true;},
    onApplyChannels: value => {applied.push(value); return true;},
    onComplete: value => complete.push(value), ...options});
  const node = id => dom.nodes.get(id);
  const click = id => node(id).click();
  const input = async (id, value, event = "input") => {
    node(id).value = String(value);
    await node(id).dispatch(event);
  };
  const check = async (id, value = true) => {
    node(id).checked = value;
    await node(id).dispatch("change");
  };
  return {...dom, view, changes, events, tests, applied, complete, stops, node, click, input, check};
}

test("one panel shows every offered movement and defaults supported combinations on without applying or testing", async () => {
  const app = viewHarness();
  app.view.open(context({channels: ["vibrate", "unknown", "fingering", "fingering"]}));
  assert.deepEqual(app.view.snapshot().selectedChannels, ["vibrate", "fingering"]);
  assert.equal(app.node("calibration-movements").children.length, 2);
  for (const channel of ["vibrate", "fingering"]) {
    assert.equal(app.node("calibration-use-" + channel).checked, true);
    assert.ok(CALIBRATION_FIELDS.every(({key}) => app.node("calibration-" + key + "-" + channel)));
  }
  assert.equal(calibrationFeature("unknown"), null);
  await app.input("calibration-minimum-vibrate", 2);
  await app.input("calibration-maximum-fingering", 3);
  assert.equal(app.view.snapshot().settings.vibrate.minimum, 2);
  assert.equal(app.view.snapshot().settings.fingering.maximum, 3);
  assert.equal(app.tests.length, 0);
  assert.equal(app.changes.length, 0);
  assert.equal(app.applied.length, 0);
  await app.input("calibration-continuity", "continuous", "change");
  const stopped = app.stops.length;
  await app.click("calibration-apply");
  assert.deepEqual(app.applied[0].channels, ["vibrate", "fingering"]);
  assert.equal(app.applied[0].settings.vibrate.minimum, 2);
  assert.equal(app.applied[0].settings.fingering.maximum, 3);
  assert.equal(app.applied[0].mode, "continuous");
  assert.ok(app.stops.length > stopped);
  assert.equal(app.tests.length, 0);
  assert.equal(app.view.snapshot().active, false);
});

test("a live combination cannot apply until every selected movement has a separate physical response check", async () => {
  const app = viewHarness();
  app.view.open(context({mode: "lovense", verifiedChannels: ["vibrate"]}));
  assert.deepEqual(app.view.snapshot().selectedChannels, ["vibrate", "fingering"]);
  assert.deepEqual(app.view.snapshot().checkedMovements, ["vibrate"]);
  assert.equal(app.node("calibration-apply").disabled, true);
  assert.match(app.node("calibration-apply-note").textContent, /Check each selected movement/);
  await app.click("calibration-apply");
  assert.equal(app.applied.length, 0);
  await app.click("calibration-test-fingering");
  assert.deepEqual(app.tests, [{channel: "fingering", level: 1}]);
  assert.equal(app.node("calibration-apply").disabled, true);
  await app.check("calibration-confirm-fingering");
  assert.equal(app.node("calibration-apply").disabled, false);
  await app.click("calibration-apply");
  assert.deepEqual(app.applied[0].channels, ["vibrate", "fingering"]);
});

test("a connection with no combined support uses one explicitly chosen movement", async () => {
  const app = viewHarness();
  app.view.open(context({supportsCombined: false, channel: "fingering"}));
  assert.deepEqual(app.view.snapshot().selectedChannels, ["fingering"]);
  assert.equal(app.node("calibration-use-vibrate").getAttribute("type"), "radio");
  await app.check("calibration-use-vibrate");
  assert.deepEqual(app.view.snapshot().selectedChannels, ["vibrate"]);
  await app.click("calibration-apply");
  assert.equal(app.applied[0].channel, "vibrate");
});

test("ratings and live participation require accepted response and stopped output", async () => {
  let confirmed = false;
  const app = viewHarness({onConfirmTest: () => confirmed});
  app.view.open(context({mode: "lovense"}));
  await app.click("calibration-rating-good-vibrate");
  assert.equal(app.events.some(event => event.type === "calibration_rating"), false);
  await app.click("calibration-test-vibrate");
  for (const output of [1, null, undefined]) {
    app.view.update({output});
    assert.equal(app.node("calibration-confirm-vibrate").disabled, true);
    await app.check("calibration-confirm-vibrate");
    assert.equal(app.view.snapshot().lastTest.confirmed, false);
  }
  app.view.update({output: 0, outputKnown: false});
  assert.equal(app.node("calibration-confirm-vibrate").disabled, true);
  app.view.update({outputKnown: true});
  await app.check("calibration-confirm-vibrate");
  assert.equal(app.view.snapshot().lastTest.confirmed, false);
  confirmed = true;
  await app.check("calibration-confirm-vibrate");
  await app.click("calibration-rating-good-vibrate");
  assert.equal(app.events.at(-1).rating, "good");
  assert.equal(app.events.at(-1).value, 1);
  assert.deepEqual(app.view.snapshot().checkedMovements, ["vibrate"]);
});

test("Stop and connection loss discard delayed tests without qualifying another device", async () => {
  let resolve;
  const app = viewHarness({onTest: () => new Promise(done => {resolve = done;})});
  app.view.open(context());
  const stopped = app.click("calibration-test-vibrate");
  assert.equal(app.view.snapshot().busy, true);
  app.view.interrupt();
  resolve(true);
  await stopped;
  assert.equal(app.view.snapshot().lastTest, null);
  assert.equal(app.node("calibration-confirm-vibrate").disabled, true);

  const disconnected = app.click("calibration-test-fingering");
  app.view.update({connected: false, connectionState: "disconnected", verifiedChannels: []});
  resolve(true);
  await disconnected;
  assert.equal(app.view.snapshot().busy, false);
  assert.equal(app.view.snapshot().lastTest, null);
  assert.equal(app.node("calibration-test-fingering").disabled, true);
  assert.deepEqual(app.view.snapshot().checkedMovements, []);
});

test("a failed application keeps all local drafts and lets the reader retry", async () => {
  const app = viewHarness({onApplyChannels: () => false});
  app.view.open(context());
  await app.input("calibration-minimum-vibrate", 2);
  await app.click("calibration-apply");
  assert.match(app.node("calibration-status").textContent, /could not be applied/);
  assert.equal(app.view.snapshot().active, true);
  assert.equal(app.view.snapshot().settings.vibrate.minimum, 2);
  assert.equal(app.complete.length, 0);
});

test("zero blocks test output and physical range grants remain independent and deliberate", async () => {
  const grants = [];
  const app = viewHarness({onEnablePersonalRange: value => {grants.push(value); return {personalRangeChannels: ["vibrate"]};}});
  app.view.open(context({mode: "lovense", ceiling: 0, verifiedChannels: ["vibrate"]}));
  assert.equal(app.node("calibration-test-vibrate").disabled, true);
  assert.equal(app.node("calibration-enable-range-fingering").disabled, true);
  await app.click("calibration-enable-range-vibrate");
  assert.deepEqual(grants, [{channel: "vibrate"}]);
  assert.equal(app.node("calibration-maximum-vibrate").max, "20");
  assert.equal(app.node("calibration-maximum-fingering").max, "5");
  assert.equal(app.view.snapshot().settings.vibrate.maximum, 5);
  assert.equal(app.node("calibration-test-vibrate").disabled, true);
  assert.equal(app.tests.length, 0);
  assert.equal(app.applied.length, 0);
  app.view.update({ceiling: 5, verifiedChannels: ["vibrate", "fingering"]});
  await app.input("calibration-maximum-vibrate", 10);
  assert.match(app.node("calibration-apply-note").textContent, /enable the range on each/);
  await app.check("calibration-use-fingering", false);
  assert.equal(app.node("calibration-apply").disabled, false);
  assert.equal(app.node("calibration-test-level-vibrate").max, "5");
  assert.deepEqual(calibrationDraft({minimum: 9, background: 2, preferred: 20, maximum: 4, recovery: 8, gain: 99, rhythm: "bad"}, 5),
    {minimum: 4, background: 4, preferred: 4, maximum: 4, recovery: 4, gain: 1, rhythm: "steady"});
});

test("extended setup opens the single calibration panel after selection and leads to a paused practice story", async () => {
  const dom = setupDOM(), calls = [], toy = {id: "sim-flexer", label: "Flexer", model: "flexer", capabilities: ["vibrate", "fingering"]};
  const flow = createSetupFlow({...dom, enableCalibration: true, onStop: () => calls.push("stop"),
    onConnect: () => ({mode: "simulator", connected: true, toys: [toy], selectedId: null, ceiling: 5, output: 0}),
    onSelectDevice: id => ({selectedId: id}), onTest: () => true, onConfirmTest: () => true,
    onPractice: story => {calls.push(story); return true;}, onStart: () => calls.push("start")});
  const click = id => dom.nodes.get(id).click();
  flow.open({model: "flexer"});
  await click("setup-primary");
  dom.nodes.get("setup-devices").value = "sim-flexer";
  await dom.nodes.get("setup-devices").dispatch("change");
  await click("setup-primary");
  assert.equal(flow.snapshot().phase, "calibrate");
  assert.equal(dom.nodes.get("setup-test-panel").hidden, true);
  assert.match(dom.nodes.get("calibration-title-fingering").textContent, /Fingering/);
  await click("calibration-skip");
  assert.equal(flow.snapshot().phase, "practice");
  dom.nodes.get("setup-practice-story").value = "rain-at-window-v1";
  await click("setup-primary");
  assert.equal(calls.at(-1).betaId, "rain-at-window-v1");
  assert.equal(calls.includes("start"), false);
  assert.equal(flow.snapshot().phase, "reading");
  flow.openCalibration();
  assert.equal(flow.snapshot().phase, "calibrate");
  flow.update({connected: false, connectionState: "disconnected"});
  assert.equal(flow.snapshot().phase, "pair");
  assert.equal(flow.calibrationSnapshot().active, false);
});

test("controlled story fixtures keep their authored levels and distinct quiet zeros", () => {
  assert.equal(SETUP_STORIES.length, 3);
  assert.equal(new Set(SETUP_STORIES.map(story => story.betaId)).size, 3);
  for (const story of SETUP_STORIES) {
    assert.equal(story.controlled, true);
    assert.equal(story.authoredLevels, true);
    assert.equal(story.quietZeros, true);
    assert.equal(story.text.split("\n\n").length, story.corrections.length);
  }
});

test("paused calibration retains saved preferences and labels live and simulated oscillation", () => {
  const app = viewHarness(), saved = {minimum: 2, background: 3, preferred: 8, maximum: 12, recovery: 1, gain: 1.3, rhythm: "scene"};
  app.view.open(context({mode: "lovense", model: "osci3", channels: ["oscillate"]}));
  assert.equal(app.node("calibration-title-oscillate").textContent, "Oscillation");
  app.view.open(context({mode: "simulator", model: "osci3", channels: ["oscillate"], ceiling: 0, settings: {oscillate: saved}}));
  assert.equal(app.node("calibration-title-oscillate").textContent, "Oscillation · simulator");
  assert.deepEqual(app.view.snapshot().settings.oscillate, saved);
  assert.equal(app.node("calibration-rhythm-oscillate").value, "scene");
  assert.equal(app.tests.length, 0);
  assert.equal(app.applied.length, 0);
});
