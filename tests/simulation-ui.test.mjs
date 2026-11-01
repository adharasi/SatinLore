import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SimulationClock } from "../app/static/simulation/clock.mjs";
import { ScenarioTransport } from "../app/static/simulation/transport.mjs";
import { SIMULATION_SCENARIOS, simulationScenario } from "../app/static/simulation/scenarios.mjs";
import { AsyncPlaybackController } from "../app/static/playback/async-controller.mjs";

// Run the real lab event wiring with a small neutral DOM surface; no browser,
// vendor transport, account, story text or network is used by this regression.
class Element {
  constructor() { this.listeners = new Map(); this.dataset = {}; this.children = []; this.open = false; this.value = ""; this.classList = { toggle() {} }; }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, event = {}) { return Promise.all((this.listeners.get(type) || []).map(callback => callback({ target: this, preventDefault() {}, ...event }))); }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = values; }
  setAttribute() {}
  closest() { return this; }
  showModal() { this.open = true; }
  close() { this.open = false; void this.fire("close"); }
}
function lab() {
  const html = readFileSync(new URL("../app/static/simulation.html", import.meta.url), "utf8");
  const ids = new Map(), elements = [];
  for (const [, attrs] of html.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)) {
    const node = new Element(), id = attrs.match(/\bid="([^"]+)"/)?.[1];
    if (id) ids.set(id, node);
    for (const [, name, value] of attrs.matchAll(/\bdata-([\w-]+)(?:="([^"]*)")?/g)) node.dataset[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value ?? "";
    elements.push(node);
  }
  let guard;
  class Access {
    constructor(options) { this.options = options; guard = this; }
    async start() { this.options.onChange({ allowed: true }); return true; }
    check() { return new Promise(resolve => { this.finish = () => { this.options.onChange({ allowed: true }); resolve(true); }; }); }
    suspend() {}
    resume() { return this.start(); }
    destroy() {}
  }
  const document = {
    hidden: false, getElementById: id => ids.get(id),
    querySelector: () => ({ content: "true" }),
    querySelectorAll: selector => { const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return elements.filter(node => Object.hasOwn(node.dataset, key)); },
    createElement: () => new Element(), createDocumentFragment: () => new Element(), addEventListener() {},
  };
  const context = vm.createContext({ document, window: { addEventListener() {} }, setInterval: () => 1, clearInterval() {},
    SimulationClock, ScenarioTransport, SIMULATION_SCENARIOS, simulationScenario, AsyncPlaybackController, HostedAccessGuard: Access });
  const source = readFileSync(new URL("../app/static/simulation.mjs", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
  vm.runInContext(source + "\nglobalThis.testLabCurrent = () => current;", context);
  return { ids, elements, guard, current: () => context.testLabCurrent() };
}
async function connected() {
  const f = lab();
  f.ids.get("lab-device").value = "sim-a"; await f.ids.get("lab-device").fire("change");
  await f.ids.get("lab-connect").fire("click"); await f.current().clock.advance(200);
  assert.equal(f.current().controller.snapshot().state, "READY_PAUSED");
  return f;
}

test("F3 lab native Escape, closed dialog, Stop and scenario reset cancel a Start awaiting fresh access", async () => {
  for (const cancel of [
    f => f.ids.get("lab-start-dialog").fire("cancel"),
    f => f.ids.get("lab-start-dialog").close(),
    f => f.ids.get("lab-stop").fire("click"),
    f => f.ids.get("reset-scenario").fire("click"),
    f => f.elements.find(node => node.dataset.close === "lab-start-dialog").fire("click"),
  ]) {
    const f = await connected(), old = f.current();
    await f.ids.get("lab-start").fire("click"); assert.equal(f.ids.get("lab-start-dialog").open, true);
    const confirming = f.ids.get("lab-confirm-start").fire("click");
    assert.equal(typeof f.guard.finish, "function");
    await cancel(f); f.guard.finish(); await confirming; await f.current().clock.advance(200);
    assert.equal(f.ids.get("lab-start-dialog").open, false);
    assert.equal(f.current().controller.snapshot().running, false);
    assert.equal(old.transport.requests.filter(frame => frame.kind === "command").length, 0);
    assert.equal(f.current().transport.requests.filter(frame => frame.kind === "command").length, 0);
  }
});

test("F3 lab native Escape invalidates a higher-ceiling confirmation", async () => {
  const f = await connected(); f.ids.get("lab-ceiling").value = "15";
  await f.ids.get("apply-ceiling").fire("click"); assert.equal(f.ids.get("lab-ceiling-dialog").open, true);
  await f.ids.get("lab-ceiling-dialog").fire("cancel");
  await f.ids.get("lab-confirm-ceiling").fire("click"); await f.current().clock.advance(200);
  assert.equal(f.current().controller.snapshot().ceiling, 5);
  assert.equal(f.current().controller.snapshot().running, false);
});

test("F3 lab confirmation that stays open can Start after a fresh access success", async () => {
  const f = await connected(); await f.ids.get("lab-start").fire("click");
  const confirming = f.ids.get("lab-confirm-start").fire("click"); f.guard.finish(); await confirming;
  await f.current().clock.advance(100);
  assert.equal(f.current().controller.snapshot().running, true);
  assert.equal(f.current().transport.requests.filter(frame => frame.kind === "command").length, 1);
});
