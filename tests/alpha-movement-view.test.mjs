import test from "node:test";
import assert from "node:assert/strict";
import { alphaPreviewLevels, alphaPreviewPath } from "../app/static/alpha-movement-view.mjs";

test("the Alpha preview only displays reported movement capabilities and distinguishes unconfirmed live output", () => {
  const state = {
    selectedId: "fixture", mode: "live", channels: ["vibrate", "rotate"],
    output: {vibrate: 5, fingering: 20, rotate: 12}
  };
  assert.deepEqual(alphaPreviewLevels(state), {vibrate: null, rotate: null});
  assert.deepEqual(alphaPreviewLevels({...state, outputKnown: true}), {vibrate: 5, rotate: 12});
  assert.deepEqual(alphaPreviewLevels({...state, selectedId: null}), {});
});

test("the simulator preview uses each movement's own scale and ignores unsupported data", () => {
  const state = {
    selectedId: "sim-max", mode: "simulator", channels: ["pump", "unrecognized"],
    output: {pump: 3, suction: 14, unrecognized: 20}
  };
  assert.deepEqual(alphaPreviewLevels(state), {pump: 3});
  assert.deepEqual(alphaPreviewLevels({...state, output: {pump: 4}}), {pump: null});
  assert.equal(alphaPreviewPath([{at: 1000, levels: {pump: 3}}], "pump", 8000), "M30.0,4.0H240.0");
  assert.deepEqual(alphaPreviewLevels({...state, channels: ["suction", "oscillate"],
    output: {suction: 8, oscillate: 2}}), {suction: 8, oscillate: 2});
});

test("an unknown movement interval splits the trace instead of drawing zero or joining levels", () => {
  const samples = [
    {at: 1000, levels: {vibrate: 5, fingering: 0}},
    {at: 2000, levels: {vibrate: null, fingering: 0}},
    {at: 3000, levels: {vibrate: 4, fingering: 8}}
  ];
  assert.equal(alphaPreviewPath(samples, "vibrate", 8000), "M30.0,28.0H60.0M90.0,29.6H240.0");
  assert.equal(alphaPreviewPath(samples, "fingering", 8000), "M30.0,36.0H60.0V36.0H90.0V23.2H240.0");
});
