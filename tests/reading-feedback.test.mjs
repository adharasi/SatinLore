import test from "node:test";
import assert from "node:assert/strict";
import {mountReadingFeedback, normalizeReadingMark} from "../app/static/reader/reading-feedback.mjs";

function fixture() {
  class Element {
    constructor() { this.hidden = false; this.open = false; this.children = []; this.dataset = {}; }
    addEventListener(name, callback) { this[name] = callback; }
    replaceChildren(...children) { this.children = children; }
    focus() { this.focused = true; }
    remove() {}
  }
  const select = new Element(), list = new Element(), status = new Element();
  const download = new Element(), sharing = new Element(), button = new Element(), mount = new Element(), shortcut = new Element();
  const offered = {select, ul: list, '[role="status"]': status, "#download-reading-feedback": download, "#reading-feedback-sharing": sharing};
  button.dataset.readingIssue = "wrong-moment";
  mount.querySelector = selector => offered[selector];
  mount.querySelectorAll = () => [button];
  const reports = [], files = [];
  const feedback = mountReadingFeedback({mount, shortcut,
    document: {createElement: tag => tag === "a" ? {click() {}, remove() {}} : new Element(), body: {append() {}}},
    record: event => { reports.push(event); return true; },
    urls: {createObjectURL(blob) { files.push(blob); return "blob:local"; }, revokeObjectURL() {}}, schedule() {},
  });
  return {feedback, mount, shortcut, button, select, status, list, download, sharing, reports, files};
}

test("post-playback feedback is optional and offers only sections played in the current story", async () => {
  const h = fixture(), first = {title: "PRIVATE_TITLE", text: "PRIVATE_TEXT"}, second = {};
  h.feedback.update(first, {position: 1, running: false});
  assert.equal(h.mount.hidden, true);
  h.feedback.update(first, {position: 1, running: true});
  assert.equal(h.mount.hidden, true);
  h.feedback.update(first, {position: 3, running: true});
  h.feedback.update(first, {position: 4, running: false});
  assert.equal(h.mount.hidden, false);
  assert.equal(h.mount.open, false);
  assert.deepEqual(h.select.children.map(option => option.value), ["1", "3"]);
  assert.equal(h.select.value, "3");
  h.button.click();
  assert.deepEqual(h.reports, []);
  h.mount.open = true;
  h.select.value = "4";
  h.button.click();
  assert.deepEqual(h.reports, []);
  h.select.value = "1";
  h.feedback.sharing(true);
  h.button.click();
  assert.deepEqual(h.reports, [{type: "reading-feedback", issue: "wrong-moment", position: 1}]);
  assert.match(h.status.textContent, /queued/);
  h.button.click();
  assert.equal(h.reports.length, 1);
  assert.deepEqual(h.list.children.map(item => item.textContent), ["Section 2 · Wrong moment"]);
  h.download.click();
  assert.deepEqual(JSON.parse(await h.files[0].text()), {
    format: "satinlore-reading-feedback-v1", marks: [{issue: "wrong-moment", section: 2}],
  });
  h.feedback.update(second, {position: 0, running: false});
  assert.equal(h.mount.hidden, true);
  h.feedback.update(first, {position: 3, running: false});
  assert.equal(h.mount.open, false);
  assert.equal(h.list.children.length, 1);
  h.feedback.sharing(false);
  h.mount.open = true;
  h.select.value = "3";
  h.button.click();
  assert.match(h.status.textContent, /for this visit/);
  assert.equal(h.reports.length, 1);
});

test("feedback reasons and section indices have a closed contract", () => {
  assert.deepEqual(normalizeReadingMark("too-strong", 0), {issue: "too-strong", position: 0});
  assert.deepEqual(normalizeReadingMark("too-weak", 0), {issue: "too-weak", position: 0});
  assert.deepEqual(normalizeReadingMark("missed-movement", 0), {issue: "missed-movement", position: 0});
  assert.deepEqual(normalizeReadingMark("wrong-movement", 1999), {issue: "wrong-movement", position: 1999});
  for (const [issue, position] of [["constructor", 0], ["CUSTOM TEXT", 0], ["wrong-moment", -1], ["wrong-moment", 2000], ["wrong-moment", "1"], ["wrong-moment", 1.5]]) {
    assert.equal(normalizeReadingMark(issue, position), null);
  }
});

test("section feedback shortcut selects the current played section after playback pauses", () => {
  const h = fixture(), story = {};
  h.feedback.update(story, {position: 0, running: false});
  assert.equal(h.shortcut.hidden, true);
  h.feedback.update(story, {position: 0, running: true});
  h.feedback.update(story, {position: 1, running: true, readingSeeking: true});
  h.feedback.update(story, {position: 2, running: true});
  assert.equal(h.shortcut.hidden, false);
  assert.equal(h.feedback.open(0), false, "Opening requires paused playback.");
  h.feedback.update(story, {position: 0, running: false});
  assert.deepEqual(h.select.children.map(option => option.value), ["0", "2"], "A muted seek is not a played section.");
  assert.equal(h.feedback.open(0), true);
  assert.equal(h.select.value, "0");
  assert.equal(h.select.focused, true);
  assert.equal(h.mount.open, true);
  assert.equal(h.feedback.open(4), true);
  assert.equal(h.select.value, "2", "An unplayed current section falls back to the last played section.");
  assert.deepEqual(h.reports, []);
  h.feedback.update(story, {position: 0, running: false, testing: true});
  assert.equal(h.shortcut.hidden, true);
  assert.equal(h.feedback.open(0), false);
});
