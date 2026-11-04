// This view observes output; it never dispatches a command. Live hardware has no
// measured feedback, so its requested levels never animate as physical motion.
import {getToyProfile} from "../devices/toy-profiles.mjs";

const SVG = "http://www.w3.org/2000/svg";
const MAX_POINTS = 72;
const CHANNELS = {vibrate: "Vibration", rotate: "Rotation", fingering: "Flexing", thrusting: "Thrusting", oscillate: "Oscillation"};
const SHAPES = {
  lush: "M140 45C111 45 109 75 112 96C115 118 126 132 140 132C154 132 165 118 168 96C171 75 169 45 140 45ZM141 131C140 153 160 162 176 143L184 126L177 123C165 144 154 146 150 132Z",
  flexer: "M133 39C112 37 105 56 108 80L114 121C117 144 132 155 148 149C161 145 170 133 174 117L183 82C186 69 179 58 169 59C157 60 154 71 154 82L153 116C152 124 148 128 144 126L150 71C153 51 147 40 133 39Z",
  nora: "M131 28C114 28 111 42 112 62L117 136C118 153 129 162 142 159C158 157 164 146 161 129L156 96L169 86C178 79 177 66 166 63C157 62 153 69 151 75L150 51C149 35 144 28 131 28Z",
  domi: "M140 23C114 23 96 43 100 67C103 85 115 97 132 100L120 151C118 161 125 168 134 168C143 168 146 162 148 153L156 98C177 91 184 76 181 57C178 36 162 23 140 23Z",
  velvo: "M132 28C115 28 111 44 113 63L118 135C119 152 129 161 143 159C158 157 165 146 162 130L157 99L171 90C182 82 181 68 171 65C159 62 155 74 153 79L151 51C150 35 143 28 132 28Z",
  spinel: "M139 24C122 24 114 36 114 53L117 132L107 143L108 153L169 153L170 143L159 132L163 53C163 35 154 24 139 24Z",
  dolce: "M114 40C101 44 100 57 104 73L118 127C123 145 137 153 152 147C166 142 173 128 176 110L183 67C186 50 178 40 167 42C155 44 153 53 154 67L155 111C155 122 151 128 145 125C140 124 138 117 137 109L134 62C133 45 125 37 114 40Z",
  hush: "M139 32C131 32 127 42 122 58L110 97C104 117 118 129 132 131L132 141L111 145C103 147 104 157 112 158L167 158C176 157 177 147 169 145L148 141L148 131C162 128 176 117 170 97L157 58C152 42 147 32 139 32Z",
  osci3: "M126 27C111 30 108 46 112 65L123 136C125 153 137 162 150 156C165 150 165 136 160 122L153 99L168 94C182 89 185 77 177 69C168 62 158 69 152 77L148 50C145 33 138 25 126 27Z",
};
const FAMILY_SHAPES = {egg: SHAPES.lush, dual: SHAPES.flexer, rabbit: SHAPES.nora,
  wand: SHAPES.domi, shaft: SHAPES.spinel, plug: SHAPES.hush};

// Project only known, currently active movements. Neither an arbitrary report
// key nor an inactive movement is permission to display a commanded channel.
export function simulatorChannelReadings(snapshot = {}) {
  const channel = Object.hasOwn(CHANNELS, snapshot.channel) ? snapshot.channel : "vibrate";
  const active = Array.isArray(snapshot.activeChannels) ? snapshot.activeChannels : [channel];
  const available = Array.isArray(snapshot.channels) ? new Set(snapshot.channels.map(item => typeof item === "string" ? item : item?.id)) : null;
  const ids = [...new Set(active.filter(id => Object.hasOwn(CHANNELS, id) && (!available || available.has(id))))].slice(0, 5);
  const connected = snapshot.connected === true, running = connected && (snapshot.running === true || snapshot.testing === true);
  const live = snapshot.mode === "lovense";
  const outputs = snapshot.channelOutputs && typeof snapshot.channelOutputs === "object" && !Array.isArray(snapshot.channelOutputs) ? snapshot.channelOutputs : null;
  return ids.map(id => {
    const value = outputs ? outputs[id] : ids.length === 1 ? snapshot.output : undefined;
    const valid = Number.isInteger(value) && value >= 0 && value <= 20;
    const unknown = live && (snapshot.outputKnown === false || running && !valid);
    return {id, label: CHANNELS[id], unknown, output: unknown ? null : running && valid ? value : 0};
  });
}

export function simulatorReading(snapshot = {}) {
  const connected = snapshot.connected === true;
  const running = connected && (snapshot.running === true || snapshot.testing === true);
  const valid = Number.isInteger(snapshot.output) && snapshot.output >= 0 && snapshot.output <= 20;
  const output = running && valid ? snapshot.output : 0;
  const live = snapshot.mode === "lovense";
  const unknown = live && snapshot.outputKnown === false;
  const model = getToyProfile(snapshot.model) || getToyProfile("lush");
  const channel = Object.hasOwn(CHANNELS, snapshot.channel) ? snapshot.channel : model.simChannels[0];
  return {connected, running, output, live, unknown, model: model.id, channel, channelReadings: simulatorChannelReadings({...snapshot, channel}),
    position: Number.isInteger(snapshot.position) && snapshot.position >= 0 ? snapshot.position : 0,
    label: unknown ? "Output unconfirmed" : !connected ? "Not connected" : !running ? "Paused" : snapshot.testing ? "Two-second test" : output ? live ? "Command requested" : "Playing" : "Playing · quiet section"};
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
  const body = make("path", {d: SHAPES.lush, class: "simulator-shell"});
  const shine = make("path", {d: "M128 63 Q128 53 139 53", class: "simulator-shine", fill: "none", "stroke-linecap": "round"});
  const seam = make("path", {d: "M114 119 Q140 130 166 119", class: "simulator-seam", fill: "none"});
  const light = make("circle", {cx: 140, cy: 135, r: 3.5, class: "simulator-led"});
  moving.append(body, shine, seam, light); graphic.append(floor, ...rings, moving);
  const readout = el("div", "simulator-readout");
  const state = el("span", "simulator-state", "Not connected");
  const level = el("output", "simulator-level", "0 / 20");
  // Avoid live announcements on animation frames; the main transport owns status.
  readout.append(state, level);
  const channelMeters = el("div", "simulator-channel-readings");
  channelMeters.setAttribute("aria-label", "Levels for each active movement");
  let channelRows = new Map();
  const renderChannels = () => {
    const ids = current.channelReadings.map(item => item.id);
    if (ids.join(",") !== [...channelRows.keys()].join(",")) {
      channelRows = new Map(); const rows = [];
      for (const item of current.channelReadings) {
        const row = el("div", "simulator-channel-row"); row.dataset.channel = item.id;
        const top = el("div", "simulator-channel-label"), label = el("span", "", item.label), value = el("output", "", "0 / 20");
        top.append(label, value);
        const meter = el("div", "simulator-channel-meter"), fill = el("span", "simulator-channel-fill"), motion = el("span", "simulator-channel-motion");
        fill.setAttribute("aria-hidden", "true"); motion.setAttribute("aria-hidden", "true");
        meter.append(fill, motion); row.append(top, meter); rows.push(row);
        channelRows.set(item.id, {row, value, meter, fill, motion});
      }
      channelMeters.replaceChildren(...rows);
    }
    channelMeters.hidden = !ids.length;
    for (const item of current.channelReadings) {
      const view = channelRows.get(item.id);
      view.value.textContent = item.unknown ? "Unknown" : `${item.output} / 20`;
      view.row.dataset.unknown = String(item.unknown);
      view.meter.setAttribute("role", item.unknown ? "img" : "meter");
      view.meter.setAttribute("aria-label", item.unknown ? `${item.label} requested output unconfirmed` : `${item.label} ${current.live ? "requested level" : "simulated level"}`);
      if (item.unknown) {
        view.meter.removeAttribute?.("aria-valuenow");
        view.meter.setAttribute("aria-valuetext", "Requested output unconfirmed; not a physical measurement");
      } else {
        view.meter.setAttribute("aria-valuemin", "0"); view.meter.setAttribute("aria-valuemax", "20");
        view.meter.setAttribute("aria-valuenow", String(item.output));
        view.meter.setAttribute("aria-valuetext", `${item.output} of 20, ${current.live ? "requested, not measured" : "simulated"}`);
      }
      view.fill.style.width = `${(item.output || 0) * 5}%`;
    }
  };
  const trace = new SimulatorTrace();
  const graph = make("svg", {viewBox: "0 0 280 64", class: "simulator-trace", role: "img", "aria-label": "Recent simulated output"});
  const grid = make("path", {d: "M8 13H272 M8 33H272 M8 53H272", class: "simulator-trace-grid", fill: "none"});
  const line = make("path", {d: trace.path(), class: "simulator-trace-line", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round"});
  graph.append(grid, line);
  const note = el("p", "note simulator-view-note", "A visual preview of simulated output. No physical toy is connected.");
  frame.append(heading, graphic, readout, channelMeters, graph, note); mount.replaceChildren(frame);

  const motion = window?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let current = simulatorReading(), animation = null, disposed = false;
  const visible = () => !document.hidden && mount.isConnected !== false && (!mount.getClientRects || mount.getClientRects().length > 0);
  const stopFrame = () => {
    if (animation !== null) window?.cancelAnimationFrame?.(animation);
    animation = null;
  };
  const draw = at => {
    const amount = current.output / 20;
    const active = !current.live && current.running && (amount > 0 || current.channelReadings.some(item => item.output > 0)) && visible();
    const animate = active && !motion?.matches;
    const shake = animate ? Math.sin(at * (.018 + amount * .04)) * amount * 2.8 : 0;
    const thrust = animate && current.channel === "thrusting" ? Math.sin(at * .012) * amount * 20 :
      animate && current.channel === "oscillate" ? Math.sin(at * .045) * amount * 7 : 0;
    const rotate = animate && ["rotate", "fingering"].includes(current.channel) ? Math.sin(at * .009) * amount * 18 : 0;
    moving.setAttribute("transform", current.channel === "vibrate" ? `translate(${shake.toFixed(2)} 0)` : `translate(0 ${thrust.toFixed(2)}) rotate(${rotate.toFixed(2)} 140 140)`);
    rings.forEach((ring, index) => {
      const phase = animate ? (at / (1800 - amount * 700) + index / 3) % 1 : index / 3;
      ring.setAttribute("opacity", active ? ((1 - phase) * amount * .46 + .04).toFixed(3) : "0");
      ring.setAttribute("transform", `translate(140 98) scale(${(1 + phase * .12).toFixed(3)}) translate(-140 -98)`);
    });
    current.channelReadings.forEach((item, index) => {
      const view = channelRows.get(item.id); if (!view) return;
      const moving = animate && !item.unknown && item.output > 0;
      view.row.dataset.moving = String(moving);
      // Independent dots illustrate each simulated movement's current pace.
      // They never animate requested live hardware output or an unknown level.
      const phase = moving ? (Math.sin(at * (.004 + item.output * .0012 + index * .0006)) + 1) / 2 : 0;
      view.motion.style.left = `${(phase * 94).toFixed(2)}%`;
      view.motion.hidden = !moving;
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
      const profile = getToyProfile(current.model);
      title.textContent = `${profile.label} · ${current.live ? "live connection" : "simulator"}`;
      body.setAttribute("d", SHAPES[profile.id] || FAMILY_SHAPES[profile.shape]);
      frame.dataset.model = current.model;
      frame.dataset.mode = current.live ? "lovense" : "simulator";
      frame.dataset.running = String(current.running && current.output > 0);
      frame.dataset.connected = String(current.connected);
      state.textContent = current.label; level.textContent = current.unknown ? "Unknown" : `${current.output} / 20`;
      badge.textContent = current.connected ? current.channelReadings.length > 1 ? `${current.channelReadings.length} movements` : CHANNELS[current.channel] : "Not connected";
      graph.setAttribute("aria-label", current.live ? "Recent requested levels, not measured output" : "Recent simulated output");
      note.textContent = current.live ? "Requested commands only; this graphic cannot measure your toy. Use its physical button if output does not stop." : `${current.channelReadings.map(item => item.label).join(" + ") || CHANNELS[current.channel]} preview · no physical toy is connected. Illustrative movement, not a hardware measurement.`;
      graphic.setAttribute("data-output", String(current.output));
      renderChannels();
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
