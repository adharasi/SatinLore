import assert from "node:assert/strict";
import test from "node:test";
import {safeGeneratedQrImage} from "../app/static/devices/pairing-image.mjs";
import {renderPairingImage} from "../app/static/devices/qr-renderer.mjs";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAAAA";

test("only bounded base64 PNGs with the expected dimensions qualify as generated pairing images", () => {
  assert.equal(safeGeneratedQrImage(image), image);
  for (const invalid of [null, image + "\n", image + "A", image + "," + image, image + "A".repeat(32768),
    image.replace("png", "svg+xml"), image.replace("AAAQAAAAEA", "AAAACAAAAA"), "https://lovense.com/fixture.jpg"]) {
    assert.equal(safeGeneratedQrImage(invalid), null);
  }
});

test("the renderer draws a bounded square with a quiet border and declines unsupported data", () => {
  const rectangles = [];
  const context = {fillRect(...rect) { rectangles.push({colour: this.fillStyle, rect}); }};
  const canvas = {getContext(type) { assert.equal(type, "2d"); return context; },
    toDataURL(type) { assert.equal(type, "image/png"); return image; }};
  const document = {createElement(tag) { assert.equal(tag, "canvas"); return canvas; }};
  assert.equal(renderPairingImage("Synthetic pairing fixture", document), image);
  assert.deepEqual([canvas.width, canvas.height], [256, 256]);
  assert.deepEqual(rectangles[0], {colour: "#fff", rect: [0, 0, 256, 256]});
  assert.ok(rectangles.length > 100);
  for (const {colour, rect: [x, y, width, height]} of rectangles.slice(1)) {
    assert.equal(colour, "#000");
    assert.equal(width, height);
    assert.ok(x >= width * 4 && y >= height * 4 && x + width * 5 <= 256 && y + height * 5 <= 256);
  }
  for (const invalid of ["", "data\n", "é", null, "x".repeat(513)]) assert.equal(renderPairingImage(invalid, document), null);
  assert.equal(renderPairingImage("fallback", {createElement() { throw Error("unavailable"); }}), null);
});
