import test from "node:test";
import assert from "node:assert/strict";
import { deriveAlphaMovementPattern } from "../app/static/alpha-admin.mjs";

const output = (t, vibrate, fingering, extra = {}) => ({ t, type: "output", channels: { vibrate, fingering }, ...extra });

test("movement totals count overlapping simulator channels only once", () => {
  const pattern = deriveAlphaMovementPattern([
    output(0, 3, 0), output(1000, 3, 4), output(2000, 0, 4), output(3000, 0, 0),
    { t: 4000, type: "mark", mark: "finished" },
  ], 4000, "simulator");
  assert.equal(pattern.activeMs, 3000);
  assert.equal(pattern.levelSeconds, 14);
  assert.deepEqual(pattern.channels.vibrate.segments[0], { startMs: 0, endMs: 2000, level: 3 });
  assert.equal(pattern.channels.fingering.activeMs, 2000);
  assert.equal(pattern.channels.fingering.peakLevel, 4);
});

test("live patterns omit stale, expired and failed commands", () => {
  const pattern = deriveAlphaMovementPattern([
    output(0, 3, 0, { stage: "submitted", durationMs: 1000, commandId: 1 }),
    output(1500, 5, 0, { stage: "requested", durationMs: 1000, commandId: 2 }),
    output(1600, 5, 0, { stage: "failed", durationMs: 1000, commandId: 2 }),
    output(1700, 3, 0, { stage: "submitted", durationMs: 1000, commandId: 1 }),
    { t: 3000, type: "mark", mark: "finished" },
  ], 3000, "live");
  assert.equal(pattern.activeMs, 1000);
  assert.equal(pattern.channels.vibrate.peakLevel, 3);
  assert.deepEqual(pattern.channels.vibrate.segments, [{ startMs: 0, endMs: 1000, level: 3 }]);
});

test("catalogue patterns replay only recorded movements and keep their individual scales", () => {
  const pattern = deriveAlphaMovementPattern([
    { t: 0, type: "device", channels: ["vibrate", "rotate"], model: "nora" },
    { t: 0, type: "output", channels: { rotate: 8 } },
    { t: 1000, type: "output", channels: { vibrate: 4, rotate: 8 } },
    { t: 2000, type: "device", channels: ["vibrate", "pump"], model: "max" },
    { t: 2000, type: "output", channels: { pump: 3 } },
    { t: 3000, type: "output", channels: { pump: 0 } },
    { t: 4000, type: "mark", mark: "finished" },
  ], 4000, "simulator");
  assert.deepEqual(Object.keys(pattern.channels), ["vibrate", "rotate", "pump"]);
  assert.equal(pattern.activeMs, 3000);
  assert.equal(pattern.levelSeconds, 23);
  assert.equal(pattern.channels.pump.peakLevel, 3);
  assert.deepEqual(pattern.channels.rotate.segments, [{ startMs: 0, endMs: 2000, level: 8 }]);
});

test("earlier Flexer recordings still replay their vibration and flexing fields", () => {
  const pattern = deriveAlphaMovementPattern([
    { t: 0, type: "output", state: "playing", vibration: 3, flexing: 2 },
    { t: 1000, type: "output", state: "stopped", vibration: 0, flexing: 0 },
  ], 1000, "simulator");
  assert.deepEqual(Object.keys(pattern.channels), ["vibrate", "fingering"]);
  assert.equal(pattern.activeMs, 1000);
  assert.equal(pattern.levelSeconds, 5);
});
