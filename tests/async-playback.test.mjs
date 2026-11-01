import test from "node:test";
import assert from "node:assert/strict";
import { AsyncPlaybackController } from "../app/static/playback/async-controller.mjs";
import { ScenarioTransport } from "../app/static/simulation/transport.mjs";
import { SimulationClock } from "../app/static/simulation/clock.mjs";
import { SIMULATION_SCENARIOS } from "../app/static/simulation/scenarios.mjs";

function fixture(options = {}) {
  const clock = new SimulationClock(), transport = new ScenarioTransport({ clock, options });
  const controller = new AsyncPlaybackController({ transport, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { clock, transport, controller };
}
async function ready(f) {
  f.controller.selectDevice("sim-a"); f.controller.setStory([2, 3, 4, 0, 20]);
  const pending = f.controller.connect(); await f.clock.advance(200);
  assert.equal(await pending, true); assert.equal(f.controller.snapshot().state, "READY_PAUSED");
}
function start(f) { const intent = f.controller.prepareStart(); assert.ok(intent); assert.equal(f.controller.start(intent), true); }
const commands = f => f.transport.requests.filter(value => value.kind === "command");

test("F3 discovery never auto-selects, unsupported/empty selections fail closed, and Start requires a current confirmation", async () => {
  const f = fixture(); assert.equal(f.controller.devices().length, 2);
  assert.equal(f.controller.prepareStart(), null); assert.equal(await f.controller.connect(), false);
  assert.equal(f.transport.requests.length, 0);
  await ready(f); assert.equal(f.controller.start({}), false);
  const stale = f.controller.prepareStart(); f.controller.setPosition(1);
  assert.equal(f.controller.start(stale), false); start(f);
  await f.clock.advance(80); assert.equal(f.controller.snapshot().output, 3);
  assert.ok(f.transport.requests.every(frame => frame.deviceId === "sim-a"));
  for (const devices of [[], [{ id: "unsupported", name: "Simulated light", vibration: false }]]) {
    const empty = fixture({ devices }); assert.throws(() => empty.controller.selectDevice(devices[0]?.id || "sim-a"), RangeError);
    assert.equal(await empty.controller.connect(), false); assert.equal(empty.transport.requests.length, 0);
  }
});

test("F3 finite asynchronous dispatch coalesces pending desired levels without a backlog", async () => {
  const f = fixture({ command: { delay: 700 } }); await ready(f); start(f);
  f.controller.setPosition(1); f.controller.setPosition(2);
  await f.clock.advance(999); assert.equal(commands(f).length, 1);
  await f.clock.advance(1); assert.equal(commands(f).length, 2);
  assert.deepEqual(commands(f).map(frame => frame.level), [2, 4]);
  assert.ok(commands(f).every(frame => frame.durationMs === 2000 && frame.deviceId === "sim-a"));
  assert.equal(commands(f)[1].at - commands(f)[0].at, 1000);
  await f.clock.advance(700); assert.equal(f.controller.snapshot().output, 4);
});

test("F3 cancelled/late connection and failed/timed-out connection never arm playback", async () => {
  for (const options of [{ connect: { delay: 2200 } }, { connect: { delay: 5000, ignoreAbort: true } }, { connect: { delay: 500, reject: true } }]) {
    const f = fixture(options); f.controller.selectDevice("sim-a"); f.controller.setStory([4]);
    const connection = f.controller.connect(); await f.clock.advance(100);
    if (options.connect.delay === 2200) { void f.controller.stop(); }
    await f.clock.advance(6000); assert.equal(await connection, false);
    assert.equal(f.controller.snapshot().running, false); assert.equal(f.controller.snapshot().connected, false);
    assert.equal(f.controller.prepareStart(), null); assert.equal(commands(f).length, 0);
    if (options.connect.ignoreAbort) assert.ok(f.controller.snapshot().staleReplies > 0);
  }
});

test("F3 Stop wins over a late command and compensating Stop clears uncertainty without restarting", async () => {
  const f = fixture({ commandPlan: [{ delay: 1700, applyDelay: 1400, ignoreAbort: true }] });
  await ready(f); start(f); await f.clock.advance(100);
  const stopping = f.controller.stop(); await f.clock.advance(100);
  assert.equal(await stopping, false); assert.equal(f.controller.snapshot().output, null);
  assert.equal(f.controller.snapshot().state, "ERROR_PAUSED");
  await f.clock.advance(1600);
  assert.ok(f.controller.snapshot().staleReplies > 0); assert.equal(f.transport.output("sim-a"), 0);
  assert.equal(f.controller.snapshot().output, 0); assert.equal(f.controller.snapshot().state, "ERROR_PAUSED");
  assert.equal(commands(f).length, 1); assert.equal(f.controller.prepareStart(), null);
  const reconnect = f.controller.connect(); await f.clock.advance(300); assert.equal(await reconnect, true);
  await f.clock.advance(3000); assert.equal(commands(f).length, 1); assert.equal(f.controller.snapshot().running, false);
});

test("F3 mismatched out-of-order acknowledgement pauses rather than trusting another request", async () => {
  const f = fixture({ commandPlan: [{ wrongId: true, delay: 350 }] }); await ready(f); start(f);
  await f.clock.advance(500);
  assert.equal(f.controller.snapshot().state, "ERROR_PAUSED"); assert.equal(f.controller.snapshot().running, false);
  assert.equal(f.transport.output("sim-a"), 0); assert.equal(commands(f).length, 1);
  await f.clock.advance(4000); assert.equal(commands(f).length, 1);
});

test("F3 failed Stop never becomes a false zero or clears its error through Pause, hide or a new mapping", async () => {
  const f = fixture({ stopPlan: [{}, { reject: true }, { reject: true }, { reject: true }, { reject: true }] }); await ready(f); start(f); await f.clock.advance(80);
  const stopping = f.controller.stop(); await f.clock.advance(100); assert.equal(await stopping, false);
  assert.equal(f.controller.snapshot().output, null); assert.equal(f.controller.snapshot().state, "ERROR_PAUSED");
  void f.controller.pause(); await f.clock.advance(100);
  f.controller.setVisible(false); f.controller.setVisible(true); await f.clock.advance(100);
  f.controller.setStory([0]); await f.clock.advance(3000);
  assert.equal(f.transport.output("sim-a"), 0, "The fixture's finite command expired independently.");
  assert.equal(f.controller.snapshot().state, "ERROR_PAUSED"); assert.equal(f.controller.snapshot().output, null);
  assert.equal(f.controller.prepareStart(), null); assert.equal(commands(f).length, 1);
});

test("F3 acknowledgement timeout retains unknown output when an old command never settles", async () => {
  const f = fixture({ commandPlan: [{ never: true, ignoreAbort: true }] }); await ready(f); start(f);
  await f.clock.advance(2000);
  assert.equal(f.controller.snapshot().state, "ERROR_PAUSED"); assert.equal(f.controller.snapshot().output, null);
  await f.clock.advance(5000); assert.equal(f.transport.output("sim-a"), 0);
  assert.equal(f.controller.snapshot().output, null); assert.equal(commands(f).length, 1);
  const reconnect = f.controller.connect(); await f.clock.advance(300); assert.equal(await reconnect, false);
  assert.equal(f.controller.prepareStart(), null);
});

test("F3 story/device changes and stale replies cannot update the new context or replay commands", async () => {
  const f = fixture({ commandPlan: [{ delay: 1600, ignoreAbort: true }] }); await ready(f); start(f);
  await f.clock.advance(100); f.controller.setStory([0]);
  f.controller.selectDevice("sim-b"); await f.clock.advance(1900);
  assert.equal(f.controller.snapshot().selectedDeviceId, "sim-b"); assert.equal(f.controller.snapshot().target, 0);
  assert.equal(f.controller.snapshot().running, false); assert.equal(commands(f).length, 1);
  assert.equal(f.transport.output("sim-a"), 0);
});

test("F3 zero, strength and lower ceilings cannot be bypassed; raising needs a fresh separate confirmation", async () => {
  const f = fixture(); await ready(f); f.controller.setPosition(4); start(f); await f.clock.advance(80);
  assert.equal(f.controller.snapshot().output, 5);
  f.controller.setCeiling(2); await f.clock.advance(100); assert.equal(f.transport.output("sim-a"), 0);
  await f.clock.advance(1000); assert.ok(commands(f).slice(1).every(frame => frame.level <= 2));
  f.controller.setLevel(4, 0); await f.clock.advance(1500); const count = commands(f).length;
  f.controller.setStrength(2); await f.clock.advance(2000); assert.equal(commands(f).length, count);
  assert.equal(f.controller.snapshot().target, 0);
  assert.throws(() => f.controller.setCeiling(20), RangeError); await f.clock.advance(100);
  const stale = f.controller.prepareCeiling(15); f.controller.setCeiling(1); assert.equal(f.controller.confirmCeiling(stale), false);
  const fresh = f.controller.prepareCeiling(10); assert.equal(f.controller.confirmCeiling(fresh), true);
  await f.clock.advance(100); assert.equal(f.controller.snapshot().ceiling, 10); assert.equal(f.controller.snapshot().running, false);
});

test("F3 hide, lost authorisation, disconnect and inactivity stay paused after recovery", async () => {
  for (const interrupt of [f => f.controller.setVisible(false), f => f.controller.setAuthorized(false), f => f.transport.drop("sim-a")]) {
    const f = fixture(); await ready(f); start(f); await f.clock.advance(80); interrupt(f); await f.clock.advance(100);
    f.controller.setVisible(true); f.controller.setAuthorized(true); await f.clock.advance(4000);
    assert.equal(f.controller.snapshot().running, false); assert.equal(commands(f).length, 1);
  }
  const f = fixture(); await ready(f); start(f); await f.clock.advance(120000);
  assert.equal(f.controller.snapshot().running, false);
  f.controller.activity(); await f.clock.advance(1000); assert.equal(f.controller.snapshot().running, false);
});

test("F3 deterministic fixture reset has no SDK, network or story-text request fields", async () => {
  assert.ok(SIMULATION_SCENARIOS.length >= 10);
  const f = fixture(); await ready(f); start(f); await f.clock.advance(100);
  for (const frame of f.transport.requests) assert.ok(Object.keys(frame).every(key => ["kind", "deviceId", "operationId", "generation", "level", "durationMs", "at"].includes(key)));
  f.controller.destroy(); f.transport.dispose(); f.clock.clear(); await f.clock.advance(5000);
  assert.equal(f.transport.output("sim-a"), 0); assert.equal(f.controller.snapshot().running, false);
});

test("F3 a dropped link leaves output unknown and explicit reconnection obtains a fresh zero without auto-resume", async () => {
  const f = fixture({ disconnectAfterCommand: 500 }); await ready(f); start(f); await f.clock.advance(600);
  assert.equal(f.controller.snapshot().connected, false); assert.equal(f.controller.snapshot().output, null);
  assert.equal(f.controller.snapshot().state, "ERROR_PAUSED");
  const connecting = f.controller.connect(); await f.clock.advance(300);
  assert.equal(await connecting, true); assert.equal(f.controller.snapshot().output, 0);
  assert.equal(f.controller.snapshot().state, "READY_PAUSED"); assert.equal(commands(f).length, 1);
  await f.clock.advance(3000); assert.equal(commands(f).length, 1);
});

test("F3 a stalled timer, invalid mapping and stale Start confirmation cannot issue more output", async () => {
  const f = fixture(); await ready(f); start(f); await f.clock.advance(80);
  f.clock.time += 3000; await f.clock.advance(0); await f.clock.advance(100);
  assert.equal(f.controller.snapshot().running, false); assert.equal(commands(f).length, 1);
  assert.throws(() => f.controller.setStory([1, , 3]), RangeError);
  assert.throws(() => f.controller.setStrength(2.1), RangeError);
  assert.equal(f.controller.snapshot().running, false);
  f.controller.clearSelection(); await f.clock.advance(200);
  assert.equal(f.controller.snapshot().selectedDeviceId, null); assert.equal(await f.controller.connect(), false);
});

test("F3 same-turn Stop and older command completion require a NEW post-completion Stop before reporting zero", async () => {
  const clock = new SimulationClock(), stops = [];
  let command, physical = 0;
  const ack = frame => ({ ...frame, level: frame.kind === "command" ? frame.level : 0, connected: true });
  const transport = {
    discover: () => [{ id: "sim-a", name: "Simulated A", vibration: true }],
    connect: frame => Promise.resolve(ack(frame)), disconnect: frame => Promise.resolve(ack(frame)),
    command: frame => new Promise(resolve => { command = { frame, resolve }; }),
    stop: frame => {
      if (!stops.length) { stops.push({ frame }); return Promise.resolve(ack(frame)); }
      return new Promise(resolve => stops.push({ frame, resolve }));
    },
  };
  const controller = new AsyncPlaybackController({ transport, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  controller.selectDevice("sim-a"); controller.setStory([5]);
  assert.equal(await controller.connect(), true);
  assert.equal(controller.start(controller.prepareStart()), true);
  const stopped = controller.stop();
  // Stop applies first, then the abort-ignoring old command applies. Both replies
  // resolve before JavaScript yields; reusing this old Stop would assert a false zero.
  physical = 0; stops[1].resolve(ack(stops[1].frame));
  physical = 5; command.resolve(ack(command.frame));
  await clock.advance(0);
  assert.equal(await stopped, false);
  assert.equal(physical, 5); assert.equal(controller.snapshot().output, null);
  assert.equal(controller.snapshot().state, "ERROR_PAUSED");
  assert.equal(stops.length, 3); assert.notEqual(stops[2].frame.operationId, stops[1].frame.operationId);
  physical = 0; stops[2].resolve(ack(stops[2].frame)); await clock.advance(0);
  assert.equal(controller.snapshot().output, 0); assert.equal(physical, 0);
  assert.equal(controller.snapshot().state, "ERROR_PAUSED", "A fresh acknowledged zero does not auto-arm recovery.");
});
