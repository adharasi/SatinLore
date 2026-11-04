import assert from "node:assert/strict";
import test from "node:test";
import {createAlphaDevice} from "../app/static/alpha-device.mjs";

async function settle() {
  for (let index = 0; index < 25; index++) await Promise.resolve();
}

function fixture(options = {}) {
  const timers = new Map(), document = new EventTarget(), window = new EventTarget(), events = [];
  let time = 0, serial = 0;
  document.hidden = false;
  const device = createAlphaDevice({document, window, authorize: async () => true,
    onEvent: event => events.push(event), now: () => time,
    setTimer(fn, delay) {timers.set(++serial, {fn, at: time + delay}); return serial;},
    clearTimer(id) {timers.delete(id);}, ...options});
  async function advance(delay) {
    const end = time + delay;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await settle();
    }
    time = end;
    await settle();
  }
  async function checkMovement(channel) {
    const pending = device.test(channel);
    await settle();
    assert.equal(device.snapshot().testing, true);
    assert.equal(device.confirmTest(channel), false);
    await advance(2000);
    assert.equal(await pending, true);
    assert.equal(device.confirmTest(channel), true);
  }
  return {device, document, events, advance, checkMovement};
}

class FakeBridge {
  constructor(capabilities = ["vibrate", "fingering"]) {
    this.listeners = new Set();
    this.toys = [];
    this.selected = null;
    this.commands = [];
    this.stops = [];
    this.grants = [];
    this.capabilities = capabilities;
  }
  snapshot() {
    return {liveConfigured: true, toys: this.toys, selectedId: this.selected,
      connectionState: this.selected ? "paused" : "discovered", connectionMessage: "Test fixture"};
  }
  notify() {this.onChange?.(this.snapshot());}
  async begin() {
    this.toys = [{id: "one-flexer", label: "Flexer", model: "flexer", capabilities: this.capabilities,
      controlTransport: "standard-socket-v1", supportsCombined: true},
    {id: "another-toy", label: "Nora", model: "nora", capabilities: ["vibrate", "rotate"]}];
    this.notify();
    return true;
  }
  subscribe(fn) {this.listeners.add(fn); return () => this.listeners.delete(fn);}
  discover() {return this.toys.map(toy => ({...toy, name: toy.label, vibration: toy.capabilities.includes("vibrate")}));}
  async connect(frame) {this.selected = frame.deviceId; this.notify(); return {...frame, connected: true};}
  async command(frame) {this.commands.push({...frame, channel: this.channel}); return {...frame};}
  async commandVector(frame, levels) {this.commands.push({...frame, levels}); return {...frame, levels};}
  async stop(frame) {this.stops.push({...frame}); return {...frame, level: 0};}
  async disconnect(frame) {return {...frame};}
  setChannel(channel) {this.channel = channel;}
  setCeiling(value) {this.ceiling = value;}
  async enablePersonalRange(value) {this.grants.push(value); return true;}
  dispose() {
    const deviceId = this.selected;
    this.selected = null;
    this.toys = [];
    if (deviceId) for (const fn of this.listeners) fn({type: "disconnect", deviceId});
    this.notify();
  }
  destroy() {this.dispose();}
}

test("Alpha rehearsal checks each movement and preserves independent level and zero controls", async t => {
  const app = fixture(), device = app.device;
  t.after(() => device.destroy());
  assert.equal(await device.connect("simulator"), true);
  assert.equal(await device.start(), false);
  await device.select("sim-flexer");
  await app.checkMovement("vibrate");
  assert.equal(await device.choose(["vibrate", "fingering"]), false);
  await app.checkMovement("fingering");
  assert.equal(await device.choose(["vibrate", "fingering"]), true);
  assert.equal(device.snapshot().settings.vibrate.maximum, 20);
  assert.equal(device.snapshot().settings.fingering.maximum, 20);
  assert.equal(device.snapshot().settings.vibrate.level, 1);
  device.set("vibrate", "level", 4);
  device.set("fingering", "level", 2);
  device.set("vibrate", "minimum", 3);
  assert.deepEqual(device.snapshot().output, {vibrate: 0, fingering: 0});
  assert.equal(device.hold(), false);
  assert.equal(await device.start(), true);
  await app.advance(1100);
  assert.deepEqual(device.snapshot().output, {vibrate: 4, fingering: 2});
  assert.equal(device.hold(), true);
  device.set("vibrate", "level", 0);
  await app.advance(1100);
  assert.deepEqual(device.snapshot().output, {vibrate: 0, fingering: 2});
  assert.equal(device.easeOff(), true);
  await app.advance(1100);
  assert.deepEqual(device.snapshot().output, {vibrate: 0, fingering: 0});
  device.stop();
  assert.equal(device.resume(), false);
  assert.equal(device.snapshot().running, false);
  assert.ok(app.events.some(event => event.type === "output" && event.stage === "simulated" && event.channels.fingering === 2));
  assert.ok(!JSON.stringify(app.events).includes("sim-flexer"));
});

test("Alpha enables the full range for checked live movements without starting the Flexer", async t => {
  const bridge = new FakeBridge(), app = fixture({bridge}), device = app.device;
  t.after(() => device.destroy());
  assert.equal(await device.connect("live"), true);
  assert.deepEqual(device.snapshot().toys, [{id: "one-flexer", label: "Flexer"}]);
  assert.throws(() => device.select("another-toy"), /discovered Flexer/);
  await device.select("one-flexer");
  assert.equal(await device.choose(["vibrate"]), false);
  assert.deepEqual(bridge.grants, []);
  await app.checkMovement("vibrate");
  assert.equal(await device.choose(["vibrate", "fingering"]), false);
  assert.deepEqual(bridge.grants, []);
  await app.checkMovement("fingering");
  assert.equal(await device.choose(["vibrate", "fingering"]), true);
  assert.deepEqual(bridge.grants.map(value => value.channels), [["vibrate"], ["fingering"]]);
  assert.equal(device.snapshot().running, false);
  assert.equal(device.snapshot().settings.vibrate.maximum, 20);
  assert.equal(device.snapshot().settings.fingering.maximum, 20);
  assert.deepEqual(bridge.commands.map(frame => frame.level), [1, 1], "Only gentle checks are sent before Start.");
  device.set("vibrate", "level", 20);
  device.set("fingering", "level", 2);
  assert.equal(bridge.commands.length, 2, "Draft edits did not transmit a movement.");
  assert.equal(await device.start(), true);
  await settle();
  assert.deepEqual(bridge.commands.at(-1).levels, {vibrate: 20, fingering: 2});
  assert.ok(bridge.commands.every(frame => frame.deviceId === "one-flexer" && frame.durationMs === 2000));
  app.document.hidden = true;
  app.document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  app.document.hidden = false;
  app.document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(device.snapshot().personalRangeChannels, []);
  assert.equal(await device.start(), false);
  assert.equal(device.snapshot().running, false);
  assert.ok(bridge.stops.every(frame => frame.deviceId === "one-flexer"));
});

test("Alpha stays paused if a range grant fails and retries only the missing grant", async t => {
  const bridge = new FakeBridge(), {device, checkMovement} = fixture({bridge});
  t.after(() => device.destroy());
  let failFlexing = true;
  bridge.enablePersonalRange = async request => {
    bridge.grants.push(request.channels[0]);
    return request.channels[0] !== "fingering" || !failFlexing;
  };
  await device.connect("live");
  await device.select("one-flexer");
  await checkMovement("vibrate");
  await checkMovement("fingering");
  await assert.rejects(device.choose(["vibrate", "fingering"]), /range could not be confirmed/);
  assert.equal(await device.start(), false);
  assert.equal(bridge.commands.length, 2);
  failFlexing = false;
  assert.equal(await device.choose(["vibrate", "fingering"]), true);
  assert.deepEqual(bridge.grants, ["vibrate", "fingering", "fingering"]);
  assert.equal(device.snapshot().settings.vibrate.maximum, 20);
  assert.equal(device.snapshot().running, false);
});

test("lowering a personal maximum also lowers the continuous minimum and rejects any increase above it", async t => {
  const app = fixture(), {device} = app;
  t.after(() => device.destroy());
  await device.connect("simulator");
  await device.select("sim-flexer");
  await app.checkMovement("vibrate");
  await device.choose(["vibrate"]);
  device.set("vibrate", "minimum", 4);
  device.set("vibrate", "maximum", 2);
  assert.equal(device.snapshot().settings.vibrate.minimum, 2);
  assert.throws(() => device.set("vibrate", "minimum", 3), /at or below your personal maximum/);
  assert.equal(device.snapshot().settings.vibrate.minimum, 2);
  device.set("vibrate", "maximum", 0);
  assert.equal(device.snapshot().settings.vibrate.minimum, 0);
});

test("Stop cancels pending authorization without sending a new movement", async t => {
  let resolve, deferred = false;
  const app = fixture({authorize: () => deferred ? new Promise(done => {resolve = done;}) : Promise.resolve(true)});
  const device = app.device;
  t.after(() => device.destroy());
  await device.connect("simulator");
  await device.select("sim-flexer");
  await app.checkMovement("vibrate");
  await device.choose(["vibrate"]);
  deferred = true;
  const starting = device.start();
  await settle();
  device.stop();
  resolve(true);
  assert.equal(await starting, false);
  assert.equal(device.snapshot().running, false);
  assert.deepEqual(device.snapshot().output, {vibrate: 0, fingering: 0});
});

test("a Flexer reporting only flexing can qualify and start only that movement", async t => {
  const bridge = new FakeBridge(["fingering"]), app = fixture({bridge}), device = app.device;
  t.after(() => device.destroy());
  await device.connect("live");
  assert.equal(await device.select("one-flexer"), true);
  assert.deepEqual(device.snapshot().channels, ["fingering"]);
  assert.equal(device.snapshot().supportsCombined, false);
  assert.throws(() => device.test("vibrate"), /available Flexer movement/);
  await app.checkMovement("fingering");
  assert.equal(await device.choose(["fingering"]), true);
  assert.equal(await device.start(), true);
  await settle();
  assert.equal(bridge.commands.at(-1).channel, "fingering");
});
