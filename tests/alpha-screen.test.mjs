import assert from "node:assert/strict";
import test from "node:test";
import {captureAlphaScreen} from "../app/static/alpha-screen.mjs";
import {ALPHA_SCREEN_LABELS} from "../app/static/alpha-screen-schema.mjs";
import {MOVEMENT_IDS} from "../app/static/devices/toy-profiles.mjs";
import {normalizeAlphaEvent} from "../deploy/cloudflare/alpha-contract.mjs";

test("Alpha screen frames support every movement and keep settings and device details masked", t => {
  const originals = {document: globalThis.document, window: globalThis.window};
  const elements = new Map(), frames = [];
  let screen = null;
  const document = Object.assign(new EventTarget(), {
    hidden: false, querySelector: selector => elements.get(selector),
  });
  Object.assign(globalThis, {document, window: {innerWidth: 1000, innerHeight: 1000}});
  t.after(() => Object.assign(globalThis, originals));

  const element = {
    checked: true,
    get value() { assert.fail("A masked replay must not read form values."); },
    get textContent() { assert.fail("A masked replay must not read displayed text."); },
    get src() { assert.fail("A masked replay must not read pairing images."); },
    getBoundingClientRect() { return {left: 10, top: 20, right: 110, bottom: 45}; },
  };
  const capture = captureAlphaScreen({currentScreen: () => screen, record: frame => frames.push(frame)});

  elements.set("#alpha-simulator-model", element);
  capture.frame({force: true});
  assert.equal(frames.length, 0, "The welcome screen precedes the recording choice.");

  for (const channel of MOVEMENT_IDS) {
    elements.clear();
    const verification = `#alpha-verification-movements [data-channel="${channel}"]`;
    const card = `#alpha-movement-cards [data-channel="${channel}"]`;
    const controls = [
      [`verify-${channel}`, verification + " button"],
      [`check-${channel}`, verification + " input"],
      [`${channel}-toggle`, card + " [data-movement-toggle]"],
      ...["level", "maximum", "minimum", "recovery", "rhythm", "range"].map(setting =>
        [`${channel}-${setting}`, `${card} [data-setting="${setting}"]`]),
    ];
    for (const [, selector] of controls) elements.set(selector, element);
    screen = "controls";
    capture.frame({force: true});
    const frame = normalizeAlphaEvent({t: 0, ...frames.at(-1)});
    assert.deepEqual(frame.items.map(item => item.id), controls.map(([id]) => id));
    assert.ok(frame.items.every(item => typeof ALPHA_SCREEN_LABELS[item.id] === "string"));
  }

  elements.clear();
  const fields = ["vibrationMaximum", "flexingMaximum", "rotationMaximum", "thrustingMaximum", "oscillationMaximum", "pumpingMaximum", "suctionMaximum"];
  for (const id of fields) elements.set(`#alpha-feedback-form [name="${id}"]`, element);
  elements.set("#alpha-device-select", element);
  elements.set("#alpha-device-qr", element);
  screen = "feedback";
  capture.frame({force: true});
  const frame = normalizeAlphaEvent({t: 0, ...frames.at(-1)});
  assert.deepEqual(new Set(frame.items.map(item => item.id)), new Set(["picker", "qr", ...fields]));
  assert.ok(frame.items.every(item => item.state === "masked"));
});
