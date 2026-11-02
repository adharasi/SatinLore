import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app/static/appearance.js", import.meta.url), "utf8");
function boot({saved = null, dark = false, blocked = false} = {}) {
  const writes = [], events = [];
  const root = {dataset: {}, style: {}};
  const select = {value: "", addEventListener(_name, fn) { this.change = fn; }};
  const readerSelect = {value: "", addEventListener(_name, fn) { this.change = fn; }};
  const note = {textContent: ""};
  const toggle = {attributes: new Map(), addEventListener(_name, fn) { this.click = fn; },
    setAttribute(name, value) { this.attributes.set(name, value); }};
  const media = {matches: dark, addEventListener(_name, fn) { this.change = fn; }};
  let ready;
  const document = {documentElement: root,
    getElementById: id => id === "appearance" ? select : id === "reading-appearance" ? readerSelect : id === "toggle-dark-mode" ? toggle : id === "appearance-note" ? note : null,
    addEventListener(_name, fn) { ready = fn; }};
  const window = {matchMedia: () => media,
    localStorage: {getItem: () => { if (blocked) throw Error("unavailable"); return saved; },
      setItem: (key, value) => { if (blocked) throw Error("unavailable"); writes.push([key, value]); }},
    dispatchEvent: event => events.push(event)};
  vm.runInNewContext(source, {window, document, CustomEvent: class { constructor(name, options) {
    this.type = name; this.detail = options.detail;
  }}});
  return {root, select, readerSelect, toggle, note, writes, events, ready,
    choose(value) { select.change({target: {value}}); },
    os(value) { media.matches = value; media.change(); }};
}

test("appearance resolves System before DOM ready without writing storage", () => {
  const app = boot({dark: true});
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(app.root.style.colorScheme, "dark");
  assert.equal(app.root.dataset.appearance, "system");
  assert.deepEqual(app.writes, []);
  assert.equal(app.events.length, 0);
  app.ready(); app.os(false);
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.events.at(-1).type, "satinlore:appearance");
});
test("explicit choice persists only the allowlisted preference and ignores OS changes", () => {
  const app = boot({saved: "light", dark: true}); app.ready();
  assert.equal(app.select.value, "light");
  app.choose("dark"); app.os(false);
  assert.equal(app.readerSelect.value, "dark");
  assert.equal(app.root.dataset.theme, "dark");
  assert.deepEqual(app.writes, [["satinlore.appearance", "dark"]]);
  app.choose("system");
  assert.equal(app.root.dataset.theme, "light");
  app.os(true);
  assert.equal(app.root.dataset.theme, "dark");
  app.readerSelect.change({target: {value: "light"}});
  assert.equal(app.select.value, "light");
  assert.equal(app.root.dataset.theme, "light");
});
test("invalid stored and chosen preferences never enter the DOM or storage", () => {
  const app = boot({saved: "arbitrary content"}); app.ready(); app.choose("arbitrary content");
  assert.equal(app.root.dataset.appearance, "system");
  assert.deepEqual(app.writes, []);
});
test("unavailable storage leaves theme usable and reports session-only choice", () => {
  const app = boot({blocked: true}); app.ready(); app.choose("dark");
  assert.equal(app.root.dataset.theme, "dark");
  assert.match(app.note.textContent, /this visit/);
  assert.deepEqual(app.writes, []);
});

test("the header switch follows resolved System appearance and selects an explicit opposite theme", () => {
  const app = boot({dark: true}); app.ready();
  assert.equal(app.toggle.attributes.get("aria-checked"), "true");
  app.toggle.click();
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.root.dataset.appearance, "light");
  assert.equal(app.toggle.attributes.get("aria-checked"), "false");
  assert.equal(app.readerSelect.value, "light");
  app.os(true);
  assert.equal(app.root.dataset.theme, "light");
  app.toggle.click();
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(app.toggle.attributes.get("aria-checked"), "true");
  app.readerSelect.change({target: {value: "system"}});
  app.os(false);
  assert.equal(app.toggle.attributes.get("aria-checked"), "false");
  assert.equal(app.readerSelect.value, "system");
});
test("the header switch remains usable when preference storage is blocked", () => {
  const app = boot({blocked: true}); app.ready();
  app.toggle.click();
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(app.toggle.attributes.get("aria-checked"), "true");
  assert.match(app.note.textContent, /this visit/);
  assert.deepEqual(app.writes, []);
});
