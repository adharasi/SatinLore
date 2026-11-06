import {ALPHA_TOY_PROFILES, channelLabel, channelMaximum} from "./devices/toy-profiles.mjs";
import {simulatorToyOutline} from "./reader/simulator-view.mjs";

const CHANNELS = [...new Set(ALPHA_TOY_PROFILES.flatMap(profile => profile.simChannels))];
const SVG = "http://www.w3.org/2000/svg";
const WINDOW_MS = 8000;
const MAX_SAMPLES = 160;
const validLevel = (value, channel) => Number.isInteger(value) && value >= 0 && value <= channelMaximum(channel);

export function alphaPreviewLevels(snapshot) {
  if (!snapshot?.selectedId) return {};
  const submitted = snapshot.mode !== "live" || snapshot.outputKnown === true;
  const available = snapshot.channels ?? [];
  return Object.fromEntries(CHANNELS.filter(channel => available.includes(channel)).map(channel => [
    channel, submitted && validLevel(snapshot.output?.[channel], channel) ? snapshot.output[channel] : null
  ]));
}

/** Draw the recorded level as steps. Unknown intervals start a new path. */
export function alphaPreviewPath(samples, channel, now) {
  const start = now - WINDOW_MS;
  const x = time => ((Math.max(start, Math.min(now, time)) - start) * 240 / WINDOW_MS).toFixed(1);
  let path = "", continuous = false;
  for (const [index, sample] of samples.entries()) {
    const end = samples[index + 1]?.at ?? now;
    if (end <= start || sample.at > now) continue;
    const value = sample.levels[channel];
    if (!validLevel(value, channel)) {
      continuous = false;
      continue;
    }
    const y = (36 - value * 32 / channelMaximum(channel)).toFixed(1);
    path += (continuous ? `V${y}` : `M${x(sample.at)},${y}`) + `H${x(end)}`;
    continuous = true;
  }
  return path;
}

/** This preview has no connection, dispatch, recording or persistence path. */
export function createAlphaMovementView(mount, {
  document = mount.ownerDocument,
  now = () => performance.now(),
  setTick = setInterval, clearTick = clearInterval
} = {}) {
  const container = mount.querySelector("#alpha-preview-channels");
  const template = document.getElementById("alpha-preview-row-template");
  const graph = mount.querySelector(".alpha-preview-trace");
  const flexer = mount.querySelector("[data-preview-flexer]");
  const other = mount.querySelector("[data-preview-other]");
  const shell = other.querySelector(".alpha-preview-shell");
  const rows = CHANNELS.map(channel => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.previewChannel = channel;
    const label = channelLabel(channel);
    row.querySelector("[data-preview-label]").textContent = label;
    const meter = row.querySelector("meter");
    meter.max = channelMaximum(channel);
    meter.setAttribute("aria-label", `${label} level`);
    const trace = document.createElementNS(SVG, "path");
    trace.dataset.previewTrace = channel;
    container.append(row);
    graph.append(trace);
    return {
      channel, row, output: row.querySelector("output"), meter,
      gap: row.querySelector(".alpha-preview-gap"), trace
    };
  });
  const source = mount.querySelector("#alpha-preview-source");
  const motion = document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let current = null, samples = [], tick = null, model = null;

  function render() {
    const levels = alphaPreviewLevels(current);
    const visible = !document.hidden && Object.keys(levels).length > 0;
    mount.hidden = !visible;
    const simulator = current?.mode === "simulator";
    const active = visible && (current.running || current.testing);
    const animate = active && simulator && !motion?.matches;
    mount.dataset.vibrating = String(animate && levels.vibrate > 0);
    mount.dataset.flexing = String(animate && levels.fingering > 0);
    mount.dataset.turning = String(animate && (levels.rotate > 0 || levels.oscillate > 0));
    mount.dataset.thrusting = String(animate && levels.thrusting > 0);
    mount.dataset.pulsing = String(animate && (levels.pump > 0 || levels.suction > 0));
    if (animate) {
      mount.style.setProperty("--alpha-preview-shake", `${levels.vibrate > 0 ? .3 + levels.vibrate * .1 : 0}px`);
      mount.style.setProperty("--alpha-preview-bend", `${levels.fingering > 0 ? 1 + levels.fingering * .32 : 0}deg`);
      mount.style.setProperty("--alpha-preview-turn", `${(levels.rotate || levels.oscillate || 0) * .45}deg`);
      mount.style.setProperty("--alpha-preview-travel", `${(levels.thrusting || 0) * .45}px`);
      mount.style.setProperty("--alpha-preview-pulse", String(1 + Math.max((levels.pump || 0) / channelMaximum("pump"), (levels.suction || 0) / channelMaximum("suction")) * .12));
    }
    if (visible) {
      const nextModel = current.model ?? current.toys?.find(toy => toy.id === current.selectedId)?.model;
      if (model !== nextModel) {
        model = nextModel;
        flexer.toggleAttribute("hidden", model !== "flexer");
        other.toggleAttribute("hidden", model === "flexer");
        shell.setAttribute("d", simulatorToyOutline(model));
      }
      const status = simulator ? "Simulated levels" :
        Object.values(levels).includes(null) ? "Command status unconfirmed" : "Levels sent to device";
      if (source.textContent !== status) source.textContent = status;
      const at = now();
      const last = samples.at(-1);
      if (!last || CHANNELS.some(channel => last.levels[channel] !== levels[channel])) {
        samples.push({at, levels});
      }
      while (samples.length > MAX_SAMPLES || samples.length > 1 && samples[1].at <= at - WINDOW_MS) samples.shift();
      for (const item of rows) {
        const level = levels[item.channel];
        item.row.hidden = level === undefined;
        const known = validLevel(level, item.channel);
        const label = known ? `${level} / ${item.meter.max}` : "Unknown";
        if (item.output.textContent !== label) item.output.textContent = label;
        item.meter.hidden = !known;
        item.gap.hidden = known;
        if (known) item.meter.value = level;
        item.trace.setAttribute("d", level === undefined ? "" : alphaPreviewPath(samples, item.channel, at));
      }
    }
    if (active && !motion?.matches) tick ??= setTick(render, 200);
    else if (tick !== null) {
      clearTick(tick);
      tick = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    samples = [];
    if (document.hidden) current = null;
    render();
  });
  motion?.addEventListener?.("change", render);
  return {
    update(snapshot) {
      if (snapshot?.selectedId !== current?.selectedId || snapshot?.mode !== current?.mode) samples = [];
      current = snapshot;
      render();
    }
  };
}
