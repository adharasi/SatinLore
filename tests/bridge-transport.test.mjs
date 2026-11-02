import test from "node:test";
import assert from "node:assert/strict";
import {BridgeTransport} from "../app/static/devices/bridge-transport.mjs";

const settle = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
const toy = (id = "toy-one") => ({id, label: "Lush simulator fixture", model: "lush", capabilities: ["vibrate"], battery: 60});
const operation = (kind, extra = {}) => ({kind, deviceId: "toy-one", operationId: "fixture-operation", generation: 1, ...extra});

/** Executes the real parent transport against a neutral DOM/port boundary. No SDK, network or hardware. */
function fixture({autoLoad = true, autoToys = true, autoResults = true, locks = true, lockAvailable = true, onChange = () => {}} = {}) {
  let time = 1_000_000, timerId = 0, held = 0, statusGate = null, sessionGate = null;
  const timers = new Map(), requests = [], frames = [], channels = [], handshakes = [], outgoing = [];
  const docEvents = new Map(), winEvents = new Map();
  const deliver = (message, channel = channels.at(-1)) => channel?.port1.onmessage?.({data: message});
  const document = {
    hidden: false,
    addEventListener(type, callback) {docEvents.set(type, callback);},
    removeEventListener(type) {docEvents.delete(type);},
    createElement(tag) {
      assert.equal(tag, "iframe");
      const events = new Map(), attributes = new Map();
      const frame = {events, attributes, removed: false,
        setAttribute(name, value) {attributes.set(name, value);},
        addEventListener(type, callback) {events.set(type, callback);},
        remove() {this.removed = true;},
        contentWindow: {postMessage(message, target, ports) {
          handshakes.push({message, target, ports});
          queueMicrotask(() => deliver({type: "bridge-ready"}));
        }},
      };
      return frame;
    },
    body: {append(frame) {frames.push(frame); if (autoLoad) queueMicrotask(() => frame.events.get("load")?.());}},
  };
  const window = {addEventListener(type, callback) {winEvents.set(type, callback);}, removeEventListener(type) {winEvents.delete(type);}};
  class Channel {
    constructor() {
      const channel = this;
      this.port2 = {};
      this.port1 = {closed: false, onmessage: null, start() {}, close() {this.closed = true;}, postMessage(message) {
        outgoing.push(message);
        if (message.type === "init") {
          queueMicrotask(() => deliver({type: "qr", url: "https://apps.lovense-api.com/fixture.jpg"}, channel));
          if (autoToys) queueMicrotask(() => deliver({type: "toys", toys: [toy()]}, channel));
        } else if (message.type === "select") queueMicrotask(() => deliver({type: "selected", id: message.id}, channel));
        else if (message.type === "dispose") queueMicrotask(() => deliver({type: "closed"}, channel));
        else if (autoResults && ["command", "stop"].includes(message.type)) {
          queueMicrotask(() => deliver({type: "result", requestId: message.requestId, ok: true, status: "submitted"}, channel));
        }
      }};
      channels.push(this);
    }
  }
  const timing = {
    now: () => time,
    setTimer(callback, delay) {timers.set(++timerId, {callback, at: time + delay}); return timerId;},
    clearTimer(id) {timers.delete(id);},
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      time = end; await settle();
    },
  };
  const navigator = {locks: locks ? {async request(name, options, callback) {
    assert.equal(name, "satinlore-device-check"); assert.equal(options.ifAvailable, true);
    if (!lockAvailable) return callback(null);
    held++;
    try {return await callback({name});} finally {held--;}
  }} : undefined};
  const credentials = () => ({uid: "synthetic-user", platform: "SatinLore test", authToken: "synthetic-not-a-vendor-token", expires_at: (time + 60_000) / 1000});
  const request = async (path, options = {}) => {
    requests.push({path, options});
    if (path === "/api/lovense/status") return statusGate ? await statusGate : Response.json({available: true});
    assert.equal(path, "/api/lovense/session");
    return sessionGate ? await sessionGate : Response.json(credentials());
  };
  const bridge = new BridgeTransport({document, window, navigator, Channel, request, ...timing, onChange});
  return {bridge, document, frames, channels, requests, outgoing, handshakes, timers, deliver, ...timing,
    held: () => held, credentials,
    statusGate(value) {statusGate = value;}, sessionGate(value) {sessionGate = value;},
    async hidden() {document.hidden = true; docEvents.get("visibilitychange")?.(); await settle();},
    async finish() {bridge.destroy(); await settle(); await timing.advance(250);},
  };
}

test("parent transport is idle until requested and uses an opaque exact-frame port without automatic selection", async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0); assert.equal(f.frames.length, 0);
  assert.equal(await f.bridge.begin(), true); await settle();
  assert.deepEqual(f.requests.map(value => value.path), ["/api/lovense/status", "/api/lovense/session"]);
  const request = f.requests[1];
  assert.equal(request.options.method, "POST"); assert.equal(request.options.body, "{}");
  assert.deepEqual(Object.keys(request.options.headers), ["Content-Type"]);
  assert.equal(f.frames[0].attributes.get("sandbox"), "allow-scripts");
  assert.equal(f.frames[0].src, "/device-bridge");
  assert.deepEqual(f.handshakes[0].message, {type: "satinlore:bridge"});
  assert.equal(f.handshakes[0].ports[0], f.channels[0].port2);
  assert.equal(f.bridge.selected, null);
  assert.equal(f.bridge.credentials, null, "Credentials are discarded after their one port transfer.");
  assert.equal(f.bridge.discover()[0].id, "toy-one");
  assert.equal(f.outgoing.some(value => value.type === "command"), false);
  await f.finish(); assert.equal(f.held(), 0);
});

test("cancelled status and credential responses cannot reopen a frame or leak a hardware lease", async () => {
  for (const stage of ["status", "session"]) {
    const f = fixture(); let resolve;
    const gate = new Promise(yes => {resolve = yes;});
    f[`${stage}Gate`](gate);
    const pending = f.bridge.begin(); await settle();
    assert.equal(f.requests.at(-1).path, `/api/lovense/${stage}`);
    f.bridge.dispose("User cancelled.");
    resolve(Response.json(stage === "status" ? {available: true} : f.credentials()));
    assert.equal(await pending, false); await settle();
    assert.equal(f.frames.length, 0); assert.equal(f.bridge.selected, null);
    assert.equal(f.bridge.credentials, null); assert.equal(f.held(), 0);
    assert.equal(f.bridge.snapshot().connectionState, "disconnected");
    await f.finish();
  }
});

test("unsupported locking and competing connection tabs cannot obtain a vendor session", async () => {
  for (const options of [{locks: false}, {lockAvailable: false}]) {
    const f = fixture(options);
    assert.equal(await f.bridge.begin(), false);
    assert.equal(f.requests.length, 1); assert.equal(f.frames.length, 0); assert.equal(f.held(), 0);
    await f.finish();
  }
});

test("parent discovery rejects malformed identifiers and capabilities without inventing vibration support", async () => {
  const f = fixture({autoToys: false}); await f.bridge.begin(); await settle();
  f.deliver({type: "toys", toys: [
    {...toy(), id: undefined}, {...toy(), id: null}, {...toy(), id: 123},
    {...toy(), capabilities: undefined}, {...toy(), capabilities: []},
    {...toy(), capabilities: ["unknown"]}, toy("accepted"), toy("accepted"),
  ]});
  assert.deepEqual(f.bridge.discover().map(value => value.id), ["accepted"]);
  for (const id of [undefined, null, 123, "unknown"]) await assert.rejects(f.bridge.connect(operation("connect", {deviceId: id})), /discovered/);
  await assert.rejects(f.bridge.stop(operation("stop", {deviceId: undefined})), /targeted/);
  assert.equal(f.outgoing.some(value => value.type === "select"), false);
  await f.finish();
});

test("parent commands require explicit selection, the current ceiling and finite selected-channel requests", async () => {
  const f = fixture(); await f.bridge.begin(); await settle();
  const command = operation("command", {level: 2, durationMs: 2000});
  await assert.rejects(f.bridge.command(command), /selected/);
  await f.bridge.connect(operation("connect"));
  f.bridge.setCeiling(2);
  for (const change of [{level: 3}, {level: 0}, {level: NaN}, {level: 1.5}, {durationMs: 0}, {durationMs: 2001}, {deviceId: "other-toy"}]) {
    await assert.rejects(f.bridge.command({...command, ...change}), /selected/);
  }
  await f.bridge.command(command);
  const sent = f.outgoing.find(value => value.type === "command");
  assert.deepEqual(Object.keys(sent).sort(), ["type", "requestId", "toyId", "level", "ceiling", "channel", "seconds"].sort());
  assert.equal(sent.toyId, "toy-one"); assert.equal(sent.level, 2); assert.equal(sent.ceiling, 2); assert.equal(sent.seconds, 2);
  f.bridge.setCeiling(0); await assert.rejects(f.bridge.command(command), /selected/);
  f.bridge.setChannel("rotate"); await assert.rejects(f.bridge.command({...command, level: 1}), /selected/);
  assert.throws(() => f.bridge.setChannel("heat")); assert.throws(() => f.bridge.setCeiling(6));
  assert.equal(f.outgoing.filter(value => value.type === "command").length, 1);
  await f.finish();
});

test("targeted Stop bypasses a pending command and a timed-out request cannot be revived by a late result", async () => {
  const f = fixture({autoResults: false}); await f.bridge.begin(); await settle(); await f.bridge.connect(operation("connect"));
  const command = f.bridge.command(operation("command", {level: 1, durationMs: 2000}));
  const timedOut = assert.rejects(command, /timed out/);
  const commandMessage = f.outgoing.at(-1);
  const stopping = f.bridge.stop(operation("stop"));
  const stopMessage = f.outgoing.at(-1);
  assert.equal(stopMessage.type, "stop"); assert.equal(stopMessage.toyId, "toy-one");
  f.deliver({type: "result", requestId: stopMessage.requestId, ok: true, status: "submitted"});
  assert.equal((await stopping).level, 0);
  await f.advance(1700); await timedOut;
  assert.equal(f.bridge.pending.size, 0);
  f.deliver({type: "result", requestId: commandMessage.requestId, ok: true, status: "submitted"});
  assert.equal(f.bridge.pending.size, 0); assert.equal(f.outgoing.filter(value => value.type === "command").length, 1);
  await f.finish();
});

test("hidden tabs, credential expiry, invalid QR images and frame reloads tear down the port and lease", async () => {
  for (const reason of ["hidden", "expired", "qr", "reload"]) {
    const f = fixture(); await f.bridge.begin(); await settle(); await f.bridge.connect(operation("connect"));
    if (reason === "hidden") await f.hidden();
    if (reason === "expired") await f.advance(60_000);
    if (reason === "qr") f.deliver({type: "qr", url: "https://attacker.example.test/private.jpg"});
    if (reason === "reload") f.frames[0].events.get("load")();
    await settle(); await f.advance(250);
    assert.equal(f.bridge.port, null); assert.equal(f.bridge.credentials, null); assert.equal(f.bridge.selected, null);
    assert.equal(f.frames[0].removed, true); assert.equal(f.held(), 0);
    await assert.rejects(f.bridge.command(operation("command", {level: 1, durationMs: 2000})));
    await f.finish();
  }
});

test("an interface failure cannot recurse or continue pairing, and a deliberate retry can recover", async () => {
  let broken = true;
  const f = fixture({onChange: () => {if (broken) throw Error("Synthetic renderer failure");}});
  assert.equal(await f.bridge.begin(), false);
  assert.equal(f.frames.length, 0); assert.equal(f.held(), 0);
  broken = false;
  assert.equal(await f.bridge.begin(), true); await settle();
  assert.equal(f.bridge.snapshot().connectionState, "discovered");
  await f.finish();
});


test("explicit SDK selection revocation clears a still-discovered toy and notifies the reader",async()=>{
  const f=fixture();const events=[];f.bridge.subscribe(event=>events.push(event));await f.bridge.begin();await settle();await f.bridge.connect(operation("connect"));assert.equal(f.bridge.selected,"toy-one");
  f.deliver({type:"toys",toys:[toy()],selected:null});assert.equal(f.bridge.selected,null);assert.deepEqual(events.at(-1),{type:"disconnect",deviceId:"toy-one"});
  await assert.rejects(f.bridge.command(operation("command",{level:1,durationMs:2000})),/selected toy/);assert.equal(f.bridge.discover().length,1);await f.finish();
});
