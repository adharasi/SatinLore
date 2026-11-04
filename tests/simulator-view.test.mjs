import test from "node:test";
import assert from "node:assert/strict";
import {simulatorReading, simulatorChannelReadings, SimulatorTrace, createSimulatorView} from "../app/static/reader/simulator-view.mjs";
import {TOY_PROFILES} from "../app/static/devices/toy-profiles.mjs";
import {setupDOM} from "./helpers/setup-dom.mjs";

test("the visual never substitutes target output for actual reported output", () => {
  assert.equal(simulatorReading({connected: true, running: true, output: 2, target: 20}).output, 2);
  for (const output of [undefined, NaN, Infinity, "20", -1, 21, 2.5]) {
    assert.equal(simulatorReading({connected: true, running: true, output, target: 20}).output, 0);
  }
  assert.equal(simulatorReading({connected: true, running: false, output: 20}).output, 0);
  assert.equal(simulatorReading({connected: false, running: true, output: 20}).output, 0);
});

test("the trace is bounded, samples output changes immediately and rejects invalid/backward samples", () => {
  const trace = new SimulatorTrace({limit: 5, interval: 100});
  assert.equal(trace.sample(3, 0), true);
  assert.equal(trace.sample(3, 50), false);
  assert.equal(trace.sample(0, 50), true, "Stop appears before the next regular sample.");
  assert.equal(trace.sample(2, 49), false);
  assert.equal(trace.sample(21, 150), false);
  for (let at = 150; at < 10150; at += 100) trace.sample(4, at);
  assert.deepEqual(trace.values, [4, 4, 4, 4, 4]);
  assert.equal((trace.path().match(/[ML]/g) || []).length, 5);
});

test("the actual view animates only nonzero playing output and Stop immediately cancels it", () => {
  const dom = setupDOM(), mount = dom.make("div");
  const view = createSimulatorView(mount, dom);
  const frame = mount.children[0], graphic = frame.children[1], readout = frame.children[2];
  view.update({connected: true, running: true, output: 4, target: 20, position: 2});
  assert.equal(graphic.getAttribute("data-output"), "4");
  assert.equal(readout.children[1].textContent, "4 / 20");
  assert.equal(dom.frames.size, 1);
  dom.advance(100);
  assert.equal(dom.frames.size, 1);
  view.update({connected: true, running: false, output: 4});
  assert.equal(dom.frames.size, 0);
  assert.equal(graphic.getAttribute("data-output"), "0");
  assert.equal(readout.children[0].textContent, "Paused");
  assert.equal(graphic.children.at(-1).getAttribute("transform"), "translate(0.00 0)");
  view.destroy(); assert.deepEqual(mount.children, []);
});

test("reduced motion, hidden documents and hidden mounts suspend motion without losing truthful levels", () => {
  const dom = setupDOM(), mount = dom.make("div");
  const view = createSimulatorView(mount, dom);
  dom.reduced(true);
  view.update({connected: true, running: true, output: 8});
  assert.equal(dom.frames.size, 0);
  assert.equal(mount.children[0].children[2].children[1].textContent, "8 / 20");
  dom.reduced(false); assert.equal(dom.frames.size, 1);
  dom.hide(true); assert.equal(dom.frames.size, 0);
  dom.hide(false); assert.equal(dom.frames.size, 1);
  mount.visible = false; dom.advance(100); assert.equal(dom.frames.size, 0);
  view.destroy(); dom.hide(false); assert.equal(dom.frames.size, 0);
});

test("the original nine toy profiles retain distinct silhouettes and truthful simulated movement labels", () => {
  const dom = setupDOM(), mount = dom.make("div"), view = createSimulatorView(mount, dom);
  const silhouettes = new Set();
  for (const model of ["lush", "flexer", "nora", "domi", "velvo", "spinel", "dolce", "hush", "osci3"]) {
    view.update({mode: "simulator", model, channel: model === "spinel" ? "thrusting" : "vibrate", connected: true, running: true, output: 3});
    const frame = mount.children[0], graphic = frame.children[1];
    assert.equal(frame.dataset.model, model);
    assert.match(frame.children[0].children[0].textContent, /simulator/);
    silhouettes.add(graphic.children.at(-1).children[0].getAttribute("d"));
  }
  assert.equal(silhouettes.size, 9);
  view.destroy();
});

test("the additional models use their own names and a representative shape, including thrust-only models", () => {
  const dom = setupDOM(), mount = dom.make("div"), view = createSimulatorView(mount, dom);
  for (const profile of TOY_PROFILES) {
    const snapshot = {mode: "simulator", model: profile.id, connected: true, running: true, output: 3};
    view.update(snapshot);
    const frame = mount.children[0];
    assert.equal(frame.dataset.model, profile.id);
    assert.equal(frame.children[0].children[0].textContent, `${profile.label} · simulator`);
    assert.ok(frame.children[1].children.at(-1).children[0].getAttribute("d").startsWith("M"));
    assert.equal(simulatorReading(snapshot).channel, profile.simChannels[0]);
  }
  view.destroy();
});

test("live requested output never animates or masquerades as measured hardware feedback", () => {
  const dom = setupDOM(), mount = dom.make("div"), view = createSimulatorView(mount, dom);
  view.update({mode: "lovense", model: "nora", channel: "rotate", connected: true, running: true, output: 4, outputKnown: true});
  assert.equal(dom.frames.size, 0);
  const frame = mount.children[0];
  assert.equal(frame.children[2].children[0].textContent, "Command requested");
  assert.match(frame.children.at(-1).textContent, /cannot measure/);
  view.update({mode: "lovense", model: "nora", connected: true, running: false, output: null, outputKnown: false});
  assert.equal(frame.children[2].children[1].textContent, "Unknown");
  assert.equal(frame.children[2].children[0].textContent, "Output unconfirmed");
  assert.equal(dom.frames.size, 0);
  view.destroy();
});

test("Osci 3 oscillation animates only in simulation and respects reduced motion and Stop", () => {
  const dom = setupDOM(), mount = dom.make("div"), view = createSimulatorView(mount, dom);
  view.update({mode: "simulator", model: "osci3", channel: "oscillate", connected: true, running: true, output: 4});
  const frame = mount.children[0], moving = frame.children[1].children.at(-1);
  dom.advance(100);
  assert.notEqual(moving.getAttribute("transform"), "translate(0 0.00) rotate(0.00 140 140)");
  assert.match(frame.children.at(-1).textContent, /Oscillation preview · no physical toy/);
  dom.reduced(true);
  assert.equal(dom.frames.size, 0);
  assert.equal(moving.getAttribute("transform"), "translate(0 0.00) rotate(0.00 140 140)");
  view.update({mode: "simulator", model: "osci3", channel: "oscillate", connected: true, running: false, output: 4});
  assert.equal(frame.children[2].children[1].textContent, "0 / 20");
  view.destroy();
});

test("independent movement readings use each active qualified channel rather than the aggregate peak", () => {
  const snapshot = {mode: "simulator", model: "flexer", channel: "vibrate", connected: true, running: true, output: 5,
    activeChannels: ["vibrate", "fingering", "rotate", "untrusted"], channels: [{id: "vibrate"}, {id: "fingering"}],
    channelOutputs: {vibrate: 3, fingering: 1, rotate: 20, untrusted: 20}};
  assert.deepEqual(simulatorChannelReadings(snapshot), [
    {id: "vibrate", label: "Vibration", output: 3, unknown: false},
    {id: "fingering", label: "Flexing", output: 1, unknown: false},
  ]);
  assert.deepEqual(simulatorChannelReadings({...snapshot, running: false}).map(row => row.output), [0, 0]);
  assert.deepEqual(simulatorChannelReadings({...snapshot, connected: false}).map(row => row.output), [0, 0]);
  assert.deepEqual(simulatorChannelReadings({...snapshot, activeChannels: []}), []);
  assert.equal(simulatorChannelReadings({...snapshot, mode: "lovense", channelOutputs: {vibrate: 3, fingering: null}})[1].unknown, true);
});

test("each simulated channel has its own truthful meter and movement freezes independently at zero", () => {
  const dom = setupDOM(), mount = dom.make("div"), view = createSimulatorView(mount, dom);
  const snapshot = {mode: "simulator", model: "flexer", channel: "vibrate", connected: true, running: true, output: 3,
    activeChannels: ["vibrate", "fingering"], channels: ["vibrate", "fingering"], channelOutputs: {vibrate: 3, fingering: 1}};
  view.update(snapshot);
  const meters = mount.children[0].children[3], vibration = meters.children[0], fingering = meters.children[1];
  assert.equal(vibration.children[0].children[0].textContent, "Vibration");
  assert.equal(vibration.children[0].children[1].textContent, "3 / 20");
  assert.equal(fingering.children[0].children[1].textContent, "1 / 20");
  assert.equal(vibration.children[1].getAttribute("aria-valuenow"), "3");
  assert.equal(fingering.children[1].getAttribute("aria-valuenow"), "1");
  dom.advance(100);
  assert.notEqual(vibration.children[1].children[1].style.left, fingering.children[1].children[1].style.left);
  view.update({...snapshot, channelOutputs: {vibrate: 3, fingering: 0}});
  assert.equal(vibration.dataset.moving, "true");
  assert.equal(fingering.dataset.moving, "false");
  assert.equal(fingering.children[1].children[0].style.width, "0%");
  assert.equal(fingering.children[1].children[1].hidden, true);
  view.update({...snapshot, output: 0, channelOutputs: {vibrate: 0, fingering: 0}});
  assert.equal(dom.frames.size, 0);
  assert.equal(vibration.dataset.moving, "false");
  view.destroy();
});

test("live per-channel unknowns remain unknown and requested hardware levels never animate", () => {
  const dom = setupDOM(), mount = dom.make("div"), view = createSimulatorView(mount, dom);
  const snapshot = {mode: "lovense", model: "flexer", channel: "vibrate", connected: true, running: true, output: 3, outputKnown: true,
    activeChannels: ["vibrate", "fingering"], channelOutputs: {vibrate: 3, fingering: null}};
  view.update(snapshot);
  const rows = mount.children[0].children[3].children;
  assert.equal(rows[0].children[0].children[1].textContent, "3 / 20");
  assert.equal(rows[1].children[0].children[1].textContent, "Unknown");
  assert.equal(rows[1].children[1].getAttribute("role"), "img");
  assert.match(rows[1].children[1].getAttribute("aria-valuetext"), /unconfirmed/);
  assert.equal(rows[0].dataset.moving, "false"); assert.equal(rows[1].dataset.moving, "false");
  assert.equal(dom.frames.size, 0);
  view.update({...snapshot, running: false, outputKnown: false});
  assert.equal(rows[0].children[0].children[1].textContent, "Unknown");
  view.destroy();
});

test("reduced motion and hidden state suppress individual simulator movement while retaining levels", () => {
  const dom = setupDOM(), mount = dom.make("div"), view = createSimulatorView(mount, dom);
  const snapshot = {mode: "simulator", model: "nora", channel: "vibrate", connected: true, running: true, output: 4,
    activeChannels: ["vibrate", "rotate"], channelOutputs: {vibrate: 4, rotate: 2}};
  view.update(snapshot); dom.reduced(true);
  const rows = mount.children[0].children[3].children;
  assert.equal(dom.frames.size, 0);
  assert.equal(rows[0].dataset.moving, "false"); assert.equal(rows[1].dataset.moving, "false");
  assert.equal(rows[1].children[0].children[1].textContent, "2 / 20");
  dom.reduced(false); assert.equal(dom.frames.size, 1);
  dom.hide(true); assert.equal(dom.frames.size, 0);
  assert.equal(rows[1].dataset.moving, "false");
  view.destroy();
});
