import test from "node:test";
import assert from "node:assert/strict";
import {LovenseCheck, safeQrUrl, supportedToys} from "../app/static/devices/lovense.mjs";

const toy = (id = "toy-a", version = "3") => ({id, name: "Untrusted vendor label", toyType: "lush", hVersion: version, connected: true});
const session = {uid: "user-a", platform: "SatinLore tests", authToken: "fake-token", expires_at: 100};

function harness({qr} = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const events = [];
  const instances = [];
  const controller = new LovenseCheck({
    now: () => now,
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, {callback, at: now + delay}); return id; },
    clearTimer: id => timers.delete(id),
    emit: event => events.push(event),
    sdkFactory: options => {
      const sdk = {
        options, handlers: {}, online: true, toys: [toy()], commands: [], stops: [], destroyed: false,
        on(name, callback) { this.handlers[name] = callback; },
        getAppStatus() { return this.online; },
        getOnlineToys() { return this.toys; },
        getQrcode() { return qr || Promise.resolve({qrcodeUrl: "https://apps.lovense-api.com/qr/test.jpg"}); },
        sendToyCommand(command) { this.commands.push(command); },
        stopToyAction(id) { this.stops.push(id); },
        destroy() { this.destroyed = true; },
        event(name, ...values) { this.handlers[name]?.(...values); },
      };
      instances.push(sdk);
      return sdk;
    },
  });
  const connect = (value = session) => {
    controller.connect(value);
    const sdk = instances.at(-1);
    sdk.event("ready");
    return sdk;
  };
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  }
  return {controller, events, instances, connect, advance};
}

test("hardware check requires explicit selection and targets one finite bounded pulse", () => {
  const {controller, connect, advance} = harness();
  const sdk = connect();
  assert.equal(sdk.commands.length, 0);
  assert.throws(() => controller.test(1, 5), /select/);
  controller.select("toy-a");
  controller.test(5, 2);
  assert.deepEqual(sdk.commands, [{vibrate: 2, time: 2, toyId: "toy-a"}]);
  advance(2000);
  assert.equal(sdk.stops.at(-1), "toy-a");
  assert.ok(sdk.stops.every(id => id === "toy-a"));
  assert.equal(sdk.options.debug, false);
});

test("invalid levels, wrong selections and unsupported models cannot dispatch", () => {
  const {controller, connect} = harness();
  const sdk = connect();
  assert.throws(() => controller.select("wrong-toy"));
  controller.select("toy-a");
  for (const value of [NaN, Infinity, -1, 0, 6, 1.5, "2"]) assert.throws(() => controller.test(value, 5));
  assert.throws(() => controller.test(1, NaN));
  assert.throws(() => controller.test(1, 6));
  controller.test(5, 0);
  assert.deepEqual(sdk.commands, []);
  assert.deepEqual(supportedToys([toy(), toy(), toy("toy-b", "2"), {...toy("toy-c"), connected: false}, {...toy("toy-d"), toyType: "other"}]),
    [{id: "toy-a", label: "Lush 3"}]);
});

test("changing selection stops the previous toy and never broadcasts", () => {
  const {controller, connect} = harness();
  const sdk = connect();
  sdk.toys = [toy(), toy("toy-b", "4")];
  sdk.event("toyInfoChange");
  controller.select("toy-a");
  controller.test(1, 5);
  controller.select("toy-b");
  assert.equal(sdk.stops.at(-1), "toy-a");
  controller.stop();
  assert.equal(sdk.stops.at(-1), "toy-b");
  assert.ok(sdk.stops.every(Boolean));
});

test("disconnect and reconnect clear selection and never resume output", () => {
  const {controller, connect} = harness();
  const sdk = connect();
  controller.select("toy-a");
  controller.test(1, 5);
  sdk.online = false;
  sdk.event("appStatusChange", false);
  assert.equal(controller.selected, null);
  assert.equal(sdk.stops.at(-1), "toy-a");
  sdk.online = true;
  sdk.event("appStatusChange", true);
  assert.equal(sdk.commands.length, 1);
  assert.throws(() => controller.test(1, 5), /select/);
});

test("stale connection lists do not authorise output and missing toys clear selection", () => {
  const {controller, connect} = harness();
  const sdk = connect();
  controller.select("toy-a");
  sdk.toys = [];
  assert.throws(() => controller.test(1, 5), /disconnected/);
  assert.equal(controller.selected, null);
  assert.equal(sdk.commands.length, 0);
  sdk.toys = [toy()];
  sdk.event("toyOnlineChange", true);
  controller.select("toy-a");
  sdk.toys = [];
  sdk.event("toyInfoChange");
  assert.equal(controller.selected, null);
});

test("session expiry destroys SDK and cannot be bypassed by another test", () => {
  const {controller, connect, advance} = harness();
  const sdk = connect({...session, expires_at: 1});
  controller.select("toy-a");
  controller.test(1, 5);
  advance(1000);
  assert.equal(sdk.destroyed, true);
  assert.equal(sdk.stops.at(-1), "toy-a");
  assert.throws(() => controller.test(1, 5));
  assert.throws(() => controller.connect({...session, expires_at: 0}));
});

test("destroy discards a delayed QR result and callbacks from an old SDK", async () => {
  let resolveQr;
  const qr = new Promise(resolve => { resolveQr = resolve; });
  const {controller, connect, events} = harness({qr});
  const sdk = connect();
  controller.select("toy-a");
  controller.disconnect();
  const count = events.length;
  resolveQr({qrcodeUrl: "https://apps.lovense-api.com/qr/private.jpg"});
  sdk.event("appStatusChange", true);
  sdk.event("toyInfoChange");
  await Promise.resolve();
  assert.equal(events.length, count);
  assert.equal(sdk.destroyed, true);
  assert.ok(!events.some(event => event.type === "qr"));
});

test("a new connection destroys the old SDK and errors stop only the selected toy", () => {
  const {controller, connect} = harness();
  const first = connect();
  controller.select("toy-a");
  const second = connect();
  assert.equal(first.destroyed, true);
  assert.deepEqual(first.stops, ["toy-a"]);
  controller.select("toy-a");
  second.event("sdkError", {message: "private payload must not escape"});
  assert.equal(second.destroyed, true);
  assert.equal(controller.selected, null);
  assert.deepEqual(second.stops, ["toy-a"]);
});

test("rapid repeated clicks cannot extend a pulse into a queued command stream", () => {
  const {controller, connect, advance} = harness();
  const sdk = connect();
  controller.select("toy-a");
  controller.test(1, 5);
  assert.throws(() => controller.test(1, 5), /Wait/);
  controller.stop();
  assert.throws(() => controller.test(1, 5), /Wait/);
  advance(2000);
  controller.test(1, 5);
  assert.equal(sdk.commands.length, 2);
});

test("pairing images are limited to HTTPS vendor domains", () => {
  assert.equal(safeQrUrl("https://apps.lovense-api.com/qr/test.jpg"), "https://apps.lovense-api.com/qr/test.jpg");
  for (const url of ["javascript:alert(1)", "data:image/png;base64,a", "http://apps.lovense-api.com/a", "https://lovense-api.com.evil.test/a", "https://evil.test/a", "https://user@api.lovense-api.com/a", "https://api.lovense-api.com:8443/a"]) assert.equal(safeQrUrl(url), null);
});
