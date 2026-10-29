import test from "node:test";
import assert from "node:assert/strict";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {MockDevice} from "../app/static/devices/mock.mjs";

class Clock {
  time = 0;
  nextId = 0;
  timers = new Map();
  now = () => this.time;
  setTimer = (callback, delay) => {
    const id = ++this.nextId;
    this.timers.set(id, {callback, at: this.time + delay});
    return id;
  };
  clearTimer = id => this.timers.delete(id);
  advance(ms) {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.timers].filter(([, value]) => value.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, value] = due;
      this.timers.delete(id);
      this.time = Math.max(this.time, value.at);
      value.callback();
    }
    this.time = end;
  }
}

class RecordedDevice extends MockDevice {
  constructor(clock) { super(clock.now); this.now = clock.now; this.commands = []; }
  command(strength, seconds) {
    super.command(strength, seconds);
    this.commands.push({strength, seconds, at: this.now()});
  }
}

function setup(options = {}) {
  const clock = new Clock();
  const device = new RecordedDevice(clock);
  const updates = [];
  const controller = new PlaybackController({device, now: clock.now,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    onChange: snapshot => updates.push(snapshot), ...options});
  return {clock, device, updates, controller};
}

test("Start requires a connection, loaded paragraphs and visible page", () => {
  const {controller, device, updates} = setup();
  assert.equal(updates.length, 0, "Constructor must not render before its owner is ready.");
  assert.equal(controller.start(), false);
  controller.connect();
  assert.equal(controller.start(), false);
  controller.setStory([3]);
  controller.setVisible(false);
  assert.equal(controller.start(), false);
  controller.setVisible(true);
  assert.equal(controller.snapshot().running, false);
  assert.equal(device.commands.length, 0);
  assert.equal(controller.start(), true);
  assert.deepEqual(device.commands, [{strength: 3, seconds: 2, at: 0}]);
});

test("Rapid positions coalesce to the newest level with finite one-second dispatch", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([2, 5, 1, 4]); controller.start();
  clock.advance(100); controller.setPosition(1);
  clock.advance(100); controller.setPosition(2);
  assert.equal(controller.snapshot().output, 0, "A reduction stops the old output immediately.");
  clock.advance(100); controller.setPosition(3);
  clock.advance(699);
  assert.equal(device.commands.length, 1);
  clock.advance(1);
  assert.deepEqual(device.commands, [
    {strength: 2, seconds: 2, at: 0}, {strength: 4, seconds: 2, at: 1000},
  ]);
  assert.equal(controller.snapshot().position, 3);
});

test("Ceiling reductions and zero corrections Stop now and never replay stale intensity", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([20]); controller.start();
  assert.equal(controller.snapshot().output, 5);
  clock.advance(100); controller.setCeiling(3);
  assert.equal(device.snapshot().strength, 0);
  clock.advance(900);
  assert.equal(controller.snapshot().output, 3);
  controller.setLevel(0, 0);
  assert.equal(device.snapshot().strength, 0);
  clock.advance(2000);
  assert.equal(device.commands.length, 2);
  controller.setLevel(0, 10);
  controller.setCeiling(2);
  clock.advance(1000);
  assert.equal(device.commands.at(-1).strength, 2);
});

test("Stop invalidates already queued callbacks and a rapid restart keeps the cadence", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([4]); controller.start();
  const stale = [...clock.timers.values()].map(value => value.callback);
  clock.advance(100); controller.pause();
  for (const callback of stale) callback();
  assert.equal(device.commands.length, 1);
  assert.equal(controller.snapshot().output, 0);
  controller.start();
  clock.advance(899);
  assert.equal(device.commands.length, 1);
  clock.advance(1);
  assert.equal(device.commands.length, 2);
  assert.equal(device.commands[1].at, 1000);
});

test("Hide, reconnect and story replacement remain paused until explicit Start", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([4, 2]); controller.start();
  controller.setVisible(false); controller.setVisible(true);
  clock.advance(5000);
  assert.equal(controller.snapshot().state, "READY_PAUSED");
  assert.equal(device.commands.length, 1);
  controller.start(); controller.disconnect(); controller.connect();
  clock.advance(5000);
  assert.equal(controller.snapshot().output, 0);
  assert.equal(controller.snapshot().running, false);
  controller.start(); controller.setStory([1]);
  clock.advance(5000);
  assert.equal(controller.snapshot().running, false);
  assert.equal(controller.snapshot().position, 0);
  controller.setStory([]);
  assert.equal(controller.start(), false);
});

test("Heartbeats, position, strength and ceiling changes do not reset inactivity", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([4, 3]); controller.start();
  clock.advance(119_000);
  controller.setPosition(1); controller.setCeiling(2); controller.setStrength(0.8);
  clock.advance(999);
  assert.equal(controller.snapshot().running, true);
  clock.advance(1);
  assert.equal(controller.snapshot().running, false);
  assert.equal(device.snapshot().strength, 0);
  assert.equal(clock.timers.size, 0);
});

test("Explicit activity moves only the inactivity deadline and never starts paused output", () => {
  const {controller, clock} = setup();
  controller.connect(); controller.setStory([3]); controller.start();
  clock.advance(119_000); controller.activity();
  clock.advance(119_999);
  assert.equal(controller.snapshot().running, true);
  clock.advance(1);
  assert.equal(controller.snapshot().running, false);
  controller.activity();
  clock.advance(1000);
  assert.equal(controller.snapshot().running, false);
});

test("A stalled event loop pauses instead of resuming commands after finite expiry", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([3]); controller.start();
  clock.time = 3000; // Advance wall-clock without servicing the queued heartbeat.
  clock.advance(0);
  assert.equal(controller.snapshot().running, false);
  assert.match(controller.snapshot().reason, /timing/);
  assert.equal(device.commands.length, 1);
  assert.equal(device.snapshot().strength, 0);
});

test("Unexpected adapter disconnect is detected before another nonzero command", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([3]); controller.start();
  device.disconnect(); clock.advance(1000);
  assert.equal(controller.snapshot().state, "DISCONNECTED");
  assert.equal(controller.snapshot().connected, false);
  assert.equal(device.commands.length, 1);
});

test("Dispatch failures fail closed and require reconnecting", () => {
  const {controller, clock, device} = setup();
  const command = device.command.bind(device);
  device.command = (...arguments_) => { command(...arguments_); throw new Error("fixture transport failure"); };
  controller.connect(); controller.setStory([3]);
  assert.equal(controller.start(), false);
  assert.equal(controller.snapshot().state, "ERROR_PAUSED");
  assert.equal(device.snapshot().strength, 0);
  controller.pause();
  controller.setStory([2]);
  controller.setVisible(false); controller.setVisible(true);
  assert.equal(controller.snapshot().state, "ERROR_PAUSED", "Stop, new stories and tab return cannot bypass reconnect recovery.");
  assert.equal(controller.start(), false);
  clock.advance(5000);
  assert.equal(device.commands.length, 1);
  device.command = command;
  controller.connect();
  assert.equal(controller.start(), true);
});

test("Promise-returning adapters cannot queue asynchronous resume", async () => {
  const {controller, clock, device} = setup();
  let resolve;
  device.command = () => new Promise(done => { resolve = done; });
  controller.connect(); controller.setStory([3]);
  assert.equal(controller.start(), false);
  assert.equal(controller.snapshot().state, "ERROR_PAUSED");
  resolve(); await Promise.resolve();
  clock.advance(5000);
  assert.equal(controller.snapshot().running, false);
  assert.equal(device.snapshot().strength, 0);
});

test("Invalid inputs cannot bypass bounds or keep a rejected change playing", () => {
  const {controller, device} = setup();
  controller.connect(); controller.setStory([3]); controller.start();
  assert.throws(() => controller.setCeiling(NaN), RangeError);
  assert.equal(controller.snapshot().running, false);
  assert.equal(device.snapshot().strength, 0);
  assert.throws(() => controller.setLevel(0, 21), RangeError);
  assert.throws(() => controller.setPosition(-1), RangeError);
  assert.throws(() => controller.setStory([1, Infinity]), RangeError);
  assert.equal(controller.snapshot().output, 0);
  assert.throws(() => new PlaybackController({device, heartbeatMs: 500}), RangeError);
});

test("UI update failure cancels output without recursively calling the broken callback", () => {
  let reject = false;
  let calls = 0;
  const {controller, device, clock} = setup({onChange: () => { ++calls; if (reject) throw new Error(); }});
  controller.connect(); controller.setStory([3]);
  reject = true;
  const before = calls;
  assert.equal(controller.start(), false);
  assert.equal(calls, before + 1);
  assert.equal(controller.snapshot().state, "ERROR_PAUSED");
  assert.equal(device.snapshot().strength, 0);
  assert.equal(clock.timers.size, 0);
});

test("Session strength scales the selected base without rewriting it and rounds down before the ceiling", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([3, 4]);
  controller.setStrength(1.5);
  assert.equal(controller.snapshot().baseLevel, 3);
  assert.equal(controller.snapshot().target, 4, "3 × 1.5 rounds down to 4, never up to 5.");
  assert.equal(controller.snapshot().running, false, "Adjusting strength is not Start.");
  controller.start();
  assert.equal(device.commands[0].strength, 4);
  controller.setPosition(1);
  assert.equal(controller.snapshot().target, 5, "The ceiling caps a scaled base of 6.");
  clock.advance(1000);
  assert.equal(device.commands.at(-1).strength, 5);
  controller.setLevel(1, 9); // An intentional paragraph correction, separate from scaling.
  controller.setStrength(0.5);
  assert.equal(controller.snapshot().output, 0, "A lower scaled target stops old output immediately.");
  assert.equal(controller.snapshot().baseLevel, 9, "Scaling does not rewrite the correction.");
  assert.equal(controller.snapshot().target, 4);
  clock.advance(1000);
  assert.equal(device.commands.at(-1).strength, 4);
  controller.setStrength(1);
  assert.equal(controller.snapshot().baseLevel, 9);
  assert.equal(controller.snapshot().target, 5);
});

test("Strength zero and section zero cannot produce nonzero commands at any strength", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([4, 0]); controller.start();
  controller.setStrength(0);
  assert.equal(controller.snapshot().target, 0);
  assert.equal(device.snapshot().strength, 0);
  clock.advance(2000);
  assert.equal(device.commands.length, 1);
  controller.setPosition(1); controller.setStrength(2);
  clock.advance(2000);
  assert.equal(controller.snapshot().baseLevel, 0);
  assert.equal(controller.snapshot().target, 0);
  assert.equal(device.commands.length, 1, "A manual or automatic zero has the same zero base contract.");
});

test("Strength survives paragraph changes, Pause, Stop and reconnect, but resets for a new story", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([3, 2]); controller.setStrength(1.7); controller.start();
  controller.setPosition(1); controller.pause("Stopped."); controller.disconnect(); controller.connect();
  assert.equal(controller.snapshot().strength, 1.7);
  clock.advance(5000);
  assert.equal(controller.snapshot().running, false);
  assert.equal(device.commands.length, 1);
  controller.setStory([4]);
  assert.equal(controller.snapshot().strength, 1);
  assert.equal(controller.snapshot().target, 4);
  assert.equal(controller.snapshot().running, false);
  controller.setStrength(2); controller.setStory([]);
  assert.equal(controller.snapshot().strength, 1);
});

test("Unconfirmed ceiling increases fail closed and stale confirmation cannot undo a reduction", () => {
  const {controller, clock, device} = setup();
  controller.connect(); controller.setStory([20]); controller.start();
  assert.throws(() => controller.setCeiling(8), /confirmation/);
  assert.equal(controller.snapshot().ceiling, 5);
  assert.equal(controller.snapshot().running, false);
  assert.equal(device.snapshot().strength, 0);
  controller.setCeiling(2);
  assert.equal(controller.confirmCeiling(8, 5), false, "An old dialog cannot restore a superseded maximum.");
  assert.equal(controller.snapshot().ceiling, 2);
  assert.equal(controller.confirmCeiling(8, 2), true);
  assert.equal(controller.snapshot().ceiling, 8);
  assert.equal(controller.snapshot().target, 8);
  assert.equal(controller.snapshot().running, false, "Confirmation alone does not start playback.");
  clock.advance(1000);
  assert.equal(device.commands.length, 1);
  controller.start();
  assert.equal(device.commands.at(-1).strength, 8);
  controller.setCeiling(0);
  assert.equal(device.snapshot().strength, 0);
  controller.setStrength(2);
  clock.advance(1000);
  assert.equal(controller.snapshot().target, 0);
  assert.equal(device.commands.length, 2);
});

test("Invalid strength and ceiling confirmations stop output without changing accepted limits", () => {
  const {controller, device} = setup();
  controller.connect(); controller.setStory([3]);
  for (const value of [-0.1, 2.1, 1.05, NaN, Infinity, "1", null, 1n]) {
    controller.start();
    assert.throws(() => controller.setStrength(value), RangeError);
    assert.equal(controller.snapshot().strength, 1);
    assert.equal(controller.snapshot().running, false);
    assert.equal(device.snapshot().strength, 0);
  }
  controller.setStrength(0.1 + 0.2);
  assert.equal(controller.snapshot().strength, 0.3, "Normal decimal arithmetic canonicalizes to integer tenths.");
  for (const [value, expected] of [[21, 5], [7, undefined], [7, NaN], [Infinity, 5]]) {
    assert.throws(() => controller.confirmCeiling(value, expected), RangeError);
    assert.equal(controller.snapshot().ceiling, 5);
    assert.equal(controller.snapshot().running, false);
  }
});

test("Bulk mapping updates preserve position, strength and ceiling with one notification and no Start", () => {
  const {controller, updates, device} = setup();
  controller.connect(); controller.setStory([3, 4]); controller.setPosition(1);
  controller.setStrength(1.5); controller.setCeiling(2);
  const notifications = updates.length;
  controller.updateLevels([9, 5]);
  assert.equal(updates.length, notifications + 1);
  assert.deepEqual(controller.levels, [9, 5]);
  const state = controller.snapshot();
  assert.equal(state.position, 1);
  assert.equal(state.strength, 1.5);
  assert.equal(state.ceiling, 2);
  assert.equal(state.baseLevel, 5);
  assert.equal(state.target, 2);
  assert.equal(state.running, false);
  assert.equal(device.commands.length, 0);
});

test("Bulk mapping reductions Stop immediately and continue only on the existing cadence", () => {
  const {controller, clock, updates, device} = setup();
  controller.connect(); controller.setStory([4, 2]); controller.start();
  clock.advance(100);
  const notifications = updates.length;
  controller.updateLevels([1, 3]);
  assert.equal(updates.length, notifications + 1);
  assert.equal(controller.snapshot().running, true);
  assert.equal(device.snapshot().strength, 0);
  clock.advance(899);
  assert.equal(device.commands.length, 1);
  clock.advance(1);
  assert.deepEqual(device.commands.at(-1), {strength: 1, seconds: 2, at: 1000});
});

test("Invalid bulk mappings pause without partially replacing the current levels", () => {
  const {controller, device} = setup();
  controller.connect(); controller.setStory([3, 4, 5]); controller.setPosition(1);
  controller.setStrength(1.2);
  const sparse = [1, 2, 3]; delete sparse[1];
  for (const mapping of [[1, NaN, 2], [1, 2], sparse, null]) {
    controller.start();
    assert.throws(() => controller.updateLevels(mapping));
    assert.deepEqual(controller.levels, [3, 4, 5]);
    assert.equal(controller.snapshot().position, 1);
    assert.equal(controller.snapshot().strength, 1.2);
    assert.equal(controller.snapshot().running, false);
    assert.equal(device.snapshot().strength, 0);
  }
});
