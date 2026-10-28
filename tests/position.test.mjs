import test from "node:test";
import assert from "node:assert/strict";
import {selectReadingParagraph} from "../app/static/reader/position.mjs";

const rects = [{id: "a", top: 0, bottom: 100}, {id: "b", top: 112, bottom: 220}, {id: "c", top: 232, bottom: 350}];

test("anchor selects its paragraph and hysteresis suppresses boundary jitter", () => {
  assert.equal(selectReadingParagraph(rects, 50, null), "a");
  assert.equal(selectReadingParagraph(rects, 120, "a"), "a");
  assert.equal(selectReadingParagraph(rects, 126, "a"), "b");
  assert.equal(selectReadingParagraph(rects, 100, "b"), "b");
  assert.equal(selectReadingParagraph(rects, 80, "b"), "a");
});

test("rapid jumps select the latest rectangle without traversing intervening paragraphs", () => {
  assert.equal(selectReadingParagraph(rects, 300, "a"), "c");
  assert.equal(selectReadingParagraph(rects, 30, "c"), "a");
  assert.equal(selectReadingParagraph([{id: "long", top: -500, bottom: 900}], 120, "long"), "long");
});

test("gaps choose a nearby paragraph but offscreen and malformed geometry cannot select one", () => {
  assert.equal(selectReadingParagraph(rects, 108, null), "b");
  assert.equal(selectReadingParagraph(rects, 1000, "c"), null);
  assert.equal(selectReadingParagraph([], 100, "a"), null);
  assert.equal(selectReadingParagraph(null, 100, "a"), null);
  assert.equal(selectReadingParagraph(rects, NaN, "a"), null);
  assert.equal(selectReadingParagraph([{id: "bad", top: 0, bottom: 0}, {id: "bad2", top: NaN, bottom: 20}], 10, null), null);
  assert.equal(selectReadingParagraph(rects, 50, "a", -1), null);
});

test("layout changes use fresh rectangles and do not restore an absent selection", () => {
  assert.equal(selectReadingParagraph([{id: "b", top: 0, bottom: 500}], 120, "a"), "b");
  assert.equal(selectReadingParagraph([{id: "b", top: 800, bottom: 1000}], 120, "a"), null);
});
