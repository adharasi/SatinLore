const CHANNELS = ["vibrate", "fingering"];
const WINDOW_MS = 8000;
const MAX_SAMPLES = 160;
const validLevel = value => Number.isInteger(value) && value >= 0 && value <= 20;

export function alphaPreviewLevels(snapshot) {
  if (!snapshot?.selectedId) return {};
  const submitted = snapshot.mode !== "live" || snapshot.outputKnown === true;
  const available = snapshot.channels ?? [];
  return Object.fromEntries(CHANNELS.filter(channel => available.includes(channel)).map(channel => [
    channel, submitted && validLevel(snapshot.output?.[channel]) ? snapshot.output[channel] : null
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
    if (!validLevel(value)) {
      continuous = false;
      continue;
    }
    const y = (36 - value * 1.6).toFixed(1);
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
  const rows = CHANNELS.map(channel => {
    const row = mount.querySelector(`[data-preview-channel="${channel}"]`);
    return {
      channel, row, output: row.querySelector("output"), meter: row.querySelector("meter"),
      gap: row.querySelector(".alpha-preview-gap"), trace: mount.querySelector(`[data-preview-trace="${channel}"]`)
    };
  });
  const source = mount.querySelector("#alpha-preview-source");
  const motion = document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  let current = null, samples = [], tick = null;

  function render() {
    const levels = alphaPreviewLevels(current);
    const visible = !document.hidden && Object.keys(levels).length > 0;
    mount.hidden = !visible;
    const simulator = current?.mode === "simulator";
    const active = visible && (current.running || current.testing);
    const animate = active && simulator && !motion?.matches;
    mount.dataset.vibrating = String(animate && levels.vibrate > 0);
    mount.dataset.flexing = String(animate && levels.fingering > 0);
    if (animate) {
      mount.style.setProperty("--alpha-preview-shake", `${levels.vibrate > 0 ? .3 + levels.vibrate * .1 : 0}px`);
      mount.style.setProperty("--alpha-preview-bend", `${levels.fingering > 0 ? 1 + levels.fingering * .32 : 0}deg`);
    }
    if (visible) {
      const status = simulator ? "Simulator output" :
        Object.values(levels).includes(null) ? "Command status unconfirmed" : "Commands sent to Flexer";
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
        const label = validLevel(level) ? `${level} / 20` : "Unknown";
        if (item.output.textContent !== label) item.output.textContent = label;
        item.meter.hidden = !validLevel(level);
        item.gap.hidden = validLevel(level);
        if (validLevel(level)) item.meter.value = level;
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
