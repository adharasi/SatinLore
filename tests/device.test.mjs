import test from "node:test";
import assert from "node:assert/strict";
import {MockDevice} from "../app/static/devices/mock.mjs";

test("commands require connection and expire without a stop message", () => {
  let now = 0;
  const device = new MockDevice(() => now);
  assert.throws(() => device.command(5, 2));
  device.connect(); device.command(5, 2);
  assert.equal(device.snapshot().strength, 5);
  now = 2001;
  assert.equal(device.snapshot().strength, 0);
});
test("disconnect and reconnect never resume a previous command", () => {
  const device = new MockDevice(() => 0);
  device.connect(); device.command(5, 2); device.disconnect(); device.connect();
  assert.equal(device.snapshot().strength, 0);
});
test("reject invalid and indefinite durations; clamp output", () => {
  const device = new MockDevice(() => 0); device.connect();
  for (const duration of [0, 1, -1, 10, NaN, Infinity]) assert.throws(() => device.command(5, duration));
  assert.throws(() => device.command(NaN, 2));
  device.command(99, 2); assert.equal(device.snapshot().strength, 20);
  device.command(-99, 2); assert.equal(device.snapshot().strength, 0);
});
test("stop clears the current command immediately", () => {
  const device = new MockDevice(() => 0);
  device.connect(); device.command(8, 2); device.stop();
  assert.equal(device.snapshot().strength, 0);
});
