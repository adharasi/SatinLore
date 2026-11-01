import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { setTimeout as nextTurn } from "node:timers/promises";
import { HostedAccessGuard } from "../app/static/access.mjs";
import { createStoryId } from "../app/static/reader/identity.mjs";

// Actual page bindings with only DOM/network/timer boundaries replaced. These
// are functional checks; browser layout and hardware are not exercised here.
function feedbackPage(t, { unavailable = false } = {}) {
  const nodes = new Map(), writes = [];
  let access = async () => Response.json({ authenticated: true, expiresAt: Date.now() + 3600000 });
  let write = async () => Response.json({ ok: true, id: crypto.randomUUID(), duplicate: false, createdAt: Date.now(), expiresAt: Date.now() + 2592000000 }, { status: 201 });
  class Element {
    constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.disabled = false; this.checked = false; this.hidden = false; this.value = ""; this.textContent = ""; this.dataset = {}; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.resetCount = 0; }
    addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
    dispatch(name) { return Promise.all((this.listeners.get(name) || []).map(callback => callback({ target: this, preventDefault() {} }))); }
    click() { return this.disabled ? Promise.resolve() : this.dispatch("click"); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { document.activeElement = this; }
    reset() { ++this.resetCount; nodes.get("feedback-message").value = ""; nodes.get("feedback-rating").value = ""; nodes.get("feedback-category").value = "bug"; }
  }
  for (const match of readFileSync(new URL("../app/static/feedback.html", import.meta.url), "utf8").matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) nodes.set(match[3], new Element(match[1]));
  nodes.get("feedback-category").value = "bug";
  const document = { hidden: false, activeElement: null, getElementById: id => nodes.get(id) || null, addEventListener() {}, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }), createDocumentFragment: () => new Element("fragment") };
  const fetcher = async (path, options) => {
    if (path === "/api/access") return access();
    if (options.method === "POST") { writes.push({ path, body: JSON.parse(options.body) }); return write(path, options); }
    return unavailable ? Response.json({ error: "Synthetic unavailable service" }, { status: 503 }) : Response.json({ feedback: [] });
  };
  class Guard extends HostedAccessGuard { constructor(options) { super({ ...options, request: opts => fetcher("/api/access", opts), setTimer: () => 1, clearTimer() {} }); } }
  const source = readFileSync(new URL("../app/static/feedback.mjs", import.meta.url), "utf8")
    .replace(/^import .+;\s*$/gm, "").replace(/^export /gm, "")
    .replace('if (typeof document !== "undefined") initializeFeedbackPage();', "");
  const context = vm.createContext({ document, window: { addEventListener() {} }, fetch: fetcher, HostedAccessGuard: Guard, createStoryId, TextEncoder, AbortController, setTimeout: () => 1, clearTimeout() {}, console });
  vm.runInContext(source + "\nglobalThis.pageFixture = initializeFeedbackPage();", context);
  t.after(() => context.pageFixture.guard.destroy());
  return { nodes, writes, access: callback => { access = callback; }, write: callback => { write = callback; }, async settle() { await nextTurn(0); await nextTurn(0); } };
}

test("the real feedback form locks its draft while saving and resets only after a valid acknowledgement", async t => {
  const page = feedbackPage(t); await page.settle();
  let release;
  page.write(() => new Promise(resolve => { release = resolve; }));
  page.nodes.get("feedback-message").value = "A neutral UI feedback fixture.";
  const pending = page.nodes.get("feedback-form").dispatch("submit"); await page.settle();
  for (const id of ["feedback-category", "feedback-rating", "feedback-message"]) assert.equal(page.nodes.get(id).disabled, true);
  assert.equal(page.nodes.get("feedback-form").resetCount, 0);
  release(Response.json({ ok: true, id: crypto.randomUUID(), duplicate: false, createdAt: 1000, expiresAt: 2000 }, { status: 201 }));
  await pending;
  assert.equal(page.nodes.get("feedback-form").resetCount, 1);
  assert.match(page.nodes.get("feedback-send-status").textContent, /feedback is saved/);
  assert.equal(page.nodes.get("feedback-message").disabled, false);
});
test("a failed real form request preserves the draft and never renders saved feedback", async t => {
  const page = feedbackPage(t); await page.settle();
  page.write(async () => Response.json({ error: "Private database details" }, { status: 503 }));
  page.nodes.get("feedback-message").value = "A neutral unsaved note.";
  await page.nodes.get("feedback-form").dispatch("submit");
  assert.equal(page.nodes.get("feedback-form").resetCount, 0);
  assert.equal(page.nodes.get("feedback-message").value, "A neutral unsaved note.");
  assert.match(page.nodes.get("feedback-send-status").textContent, /could not confirm/);
  assert.doesNotMatch(page.nodes.get("feedback-send-status").textContent, /Private database|is saved/);
});
test("native Escape cancels deletion consent and a pending fresh authorization before any mutation", async t => {
  const page = feedbackPage(t); await page.settle();
  await page.nodes.get("feedback-delete-open").click();
  page.nodes.get("feedback-delete-confirm").checked = true;
  await page.nodes.get("feedback-delete-confirm").dispatch("change");
  let release;
  page.access(() => new Promise(resolve => { release = resolve; }));
  const pending = page.nodes.get("feedback-delete").click(); await page.settle();
  await page.nodes.get("feedback-delete-dialog").dispatch("cancel");
  release(Response.json({ authenticated: true, expiresAt: Date.now() + 3600000 }));
  await pending;
  assert.equal(page.nodes.get("feedback-delete-confirm").checked, false);
  assert.equal(page.writes.length, 0);
  assert.match(page.nodes.get("feedback-data-status").textContent, /Deletion has not been confirmed/);
});
test("an unavailable real feedback service keeps send, export and delete disabled", async t => {
  const page = feedbackPage(t, { unavailable: true }); await page.settle();
  for (const id of ["feedback-send", "feedback-download", "feedback-delete-open"]) assert.equal(page.nodes.get(id).disabled, true);
  assert.match(page.nodes.get("feedback-history-status").textContent, /could not confirm/);
  assert.equal(page.writes.length, 0);
});
