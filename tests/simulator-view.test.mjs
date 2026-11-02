import test from "node:test";
import assert from "node:assert/strict";
import {simulatorReading, SimulatorTrace, createSimulatorView} from "../app/static/reader/simulator-view.mjs";
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
