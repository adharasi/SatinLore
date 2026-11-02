// This view observes the simulator. It never dispatches a command or predicts a
// device's physical behaviour. Motion and the trace use reported output only.
const SVG = "http://www.w3.org/2000/svg";
const MAX_POINTS = 72;

export function simulatorReading(snapshot = {}) {
  const connected = snapshot.connected === true;
  const running = connected && snapshot.running === true;
  const valid = Number.isInteger(snapshot.output) && snapshot.output >= 0 && snapshot.output <= 20;
  const output = running && valid ? snapshot.output : 0;
  return {connected, running, output,
    position: Number.isInteger(snapshot.position) && snapshot.position >= 0 ? snapshot.position : 0,
    label: !connected ? "Not connected" : !running ? "Paused" : output ? "Playing" : "Playing · quiet section"};
}

export class SimulatorTrace {
  constructor({limit = MAX_POINTS, interval = 100} = {}) {
    if (!Number.isInteger(limit) || limit < 2 || limit > 120 || !Number.isFinite(interval) || interval < 50) {
      throw new RangeError("Use a bounded simulator trace.");
    }
    this.limit = limit; this.interval = interval;
    this.values = Array(limit).fill(0); this.lastAt = -Infinity; this.lastValue = 0;
  }
  sample(value, at) {
    if (!Number.isInteger(value) || value < 0 || value > 20 || !Number.isFinite(at)) return false;
    // An output change is represented immediately, even between regular samples.
    if (at < this.lastAt || (at - this.lastAt < this.interval && value === this.lastValue)) return false;
    this.values.push(value); this.values.splice(0, this.values.length - this.limit);
    this.lastAt = at; this.lastValue = value; return true;
  }
  path() {
    return this.values.map((value, index) => `${index ? "L" : "M"}${(index * 264 / (this.limit - 1) + 8).toFixed(1)},${(53 - value * 2).toFixed(1)}`).join(" ");
  }
}

export function createSimulatorView(mount, {document = mount?.ownerDocument ?? globalThis.document,
  window = globalThis.window, now = () => globalThis.performance.now()} = {}) {
  if (!mount || !document?.createElementNS) return {update() {}, destroy() {}};
  const make = (tag, attributes = {}) => {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const el = (tag, className, value) => {
    const node = document.createElement(tag); node.className = className;
    if (value) node.textContent = value; return node;
  };
  const frame = el("section", "simulator-view");
  frame.setAttribute("aria-label", "Live simulator preview");
  const heading = el("div", "simulator-view-heading");
  const title = el("strong", "", "Simulator");
  const badge = el("span", "simulator-view-badge", "No toy connected");
  heading.append(title, badge);
  const graphic = make("svg", {viewBox: "0 0 280 190", "aria-hidden": "true", focusable: "false", class: "simulator-device"});
  const floor = make("ellipse", {cx: 140, cy: 161, rx: 45, ry: 8, class: "simulator-shadow"});
  const rings = [0, 1, 2].map(index => make("ellipse", {cx: 140, cy: 98, rx: 43 + index * 18, ry: 54 + index * 13,
    class: "simulator-ring", opacity: 0}));
  const moving = make("g", {class: "simulator-device-body"});
  const body = make("rect", {x: 113, y: 42, width: 54, height: 104, rx: 27, class: "simulator-shell"});
  const shine = make("path", {d: "M128 63 Q128 53 139 53", class: "simulator-shine", fill: "none", "stroke-linecap": "round"});
  const seam = make("path", {d: "M114 119 Q140 130 166 119", class: "simulator-seam", fill: "none"});
  const light = make("circle", {cx: 140, cy: 135, r: 3.5, class: "simulator-led"});
  moving.append(body, shine, seam, light); graphic.append(floor, ...rings, moving);
  const readout = el("div", "simulator-readout");
  const state = el("span", "simulator-state", "Not connected");
  const level = el("output", "simulator-level", "0 / 20");
  // Avoid live announcements on animation frames; the main transport owns status.
  readout.append(state, level);
  const trace = new SimulatorTrace();
  const graph = make("svg", {viewBox: "0 0 280 64", class: "simulator-trace", role: "img", "aria-label": "Recent simulated output"});
  const grid = make("path", {d: "M8 13H272 M8 33H272 M8 53H272", class: "simulator-trace-grid", fill: "none"});
  const line = make("path", {d: trace.path(), class: "simulator-trace-line", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round"});
  graph.append(grid, line);
  const note = el("p", "note simulator-view-note", "A visual preview of simulated output. No physical toy is connected.");
  frame.append(heading, graphic, readout, graph, note); mount.replaceChildren(frame);

  const motion = window?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let current = simulatorReading(), animation = null, disposed = false;
  const visible = () => !document.hidden && mount.isConnected !== false && (!mount.getClientRects || mount.getClientRects().length > 0);
  const stopFrame = () => {
    if (animation !== null) window?.cancelAnimationFrame?.(animation);
    animation = null;
  };
  const draw = at => {
    const amount = current.output / 20;
    const active = current.running && amount > 0 && visible();
    const animate = active && !motion?.matches;
    const shake = animate ? Math.sin(at * (.018 + amount * .04)) * amount * 2.8 : 0;
    moving.setAttribute("transform", `translate(${shake.toFixed(2)} 0)`);
    rings.forEach((ring, index) => {
      const phase = animate ? (at / (1800 - amount * 700) + index / 3) % 1 : index / 3;
      ring.setAttribute("opacity", active ? ((1 - phase) * amount * .46 + .04).toFixed(3) : "0");
      ring.setAttribute("transform", `translate(140 98) scale(${(1 + phase * .12).toFixed(3)}) translate(-140 -98)`);
    });
    if (trace.sample(current.output, at)) line.setAttribute("d", trace.path());
    if (animate && window?.requestAnimationFrame) animation = window.requestAnimationFrame(tick);
  };
  const tick = at => { animation = null; if (!disposed) draw(at); };
  const refresh = () => { stopFrame(); if (!disposed) draw(now()); };
  const visibility = () => refresh();
  document.addEventListener?.("visibilitychange", visibility);
  motion?.addEventListener?.("change", refresh);

  return {
    update(snapshot) {
      if (disposed) return;
      current = simulatorReading(snapshot);
      frame.dataset.running = String(current.running && current.output > 0);
      frame.dataset.connected = String(current.connected);
      state.textContent = current.label; level.textContent = `${current.output} / 20`;
      badge.textContent = current.connected ? `Section ${current.position + 1}` : "No toy connected";
      graphic.setAttribute("data-output", String(current.output));
      refresh();
    },
    destroy() {
      disposed = true; stopFrame();
      document.removeEventListener?.("visibilitychange", visibility);
      motion?.removeEventListener?.("change", refresh);
      mount.replaceChildren();
    },
  };
}
