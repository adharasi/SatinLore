import { READING_FEEDBACK_LABELS } from "./reader/reading-feedback.mjs";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CHANNELS = ["vibrate", "fingering", "rotate", "thrusting", "oscillate"];
const LABELS = { vibrate: "Vibration", fingering: "Flexing", rotate: "Rotation", thrusting: "Thrusting", oscillate: "Oscillation", lush: "Lush", flexer: "Flexer", nora: "Nora", domi: "Domi", velvo: "Velvo", spinel: "Spinel", dolce: "Dolce", hush: "Hush", osci3: "Osci 3", none: "Toy not selected", account: "Account", choose: "Choose your toy", connect: "Connection", features: "Explore the features", calibration: "Find your settings", playground: "Explore controls", practice: "Guided reading", story: "Story reading", complete: "Session complete", presets: "Saved presets", minimum: "Minimum", background: "Background", preferred: "Preferred level", maximum: "Maximum", recovery: "Ease off level", gain: "Story strength", rhythm: "Rhythm", continuity: "Continuity", strength: "Strength", "section-level": "Section level", action: "Movement", mode: "Mode", start: "Start", pause: "Pause", stop: "Stop", hold: "Hold", easeoff: "Ease off", follow: "Follow story", test: "Short test", comfort: "Comfort", intensity: "Intensity", sync: "Story timing", overall: "Overall", pleasure: "Pleasure" };
const COLORS = { vibrate: "#934e79", fingering: "#3a8490", rotate: "#a56b35", thrusting: "#6561a8", oscillate: "#487a54" };
const label = value => LABELS[value] || String(value).replaceAll("-", " ");
function ratingText(event) {
  const context = [event.channel ? label(event.channel) : null, event.field ? label(event.field) : null].filter(Boolean).join(" · ");
  const intensity = event.question === "intensity" ? ({ 1: "Too light", 3: "Good", 5: "Too much" })[event.value] : null;
  return `${context ? context + " · " : ""}${label(event.question)} · ${intensity ? intensity + " (" + event.value + "/5)" : event.value + "/5"}`;
}
export const replayTime = value => `${Math.floor(Math.max(0, value) / 60000)}:${String(Math.floor(Math.max(0, value) / 1000) % 60).padStart(2, "0")}`;
export function betaReplayState(recording, at) {
  const state = { toy: recording.session.toy, mode: recording.session.mode, step: "account", output: {}, status: "No output event yet.", settings: {}, rating: null, story: null, index: -1 };
  for (let index = 0; index < recording.events.length; index++) {
    const event = recording.events[index]; if (event.t > at) break; state.index = index;
    if (event.type === "device") { state.toy = event.toy; state.mode = event.mode; state.output = {}; }
    else if (event.type === "step") state.step = event.step;
    else if (event.type === "output") { state.output = { ...event.channels }; state.status = event.state; }
    else if (event.type === "control") {
      const key = `${event.channel ? label(event.channel) + " · " : ""}${label(event.control)}`;
      delete state.settings[key]; state.settings[key] = event.value === undefined ? "Chosen" : typeof event.value === "number" ? String(event.value) : label(event.value);
    }
    else if (event.type === "rating") state.rating = ratingText(event);
    else if (event.type === "reading-feedback") state.rating = betaEventDescription(event);
    else if (event.type === "preset") { delete state.settings.Preset; state.settings.Preset = `${({ save: "Saved", apply: "Applied", delete: "Deleted" })[event.event]} ${event.scope} preset`; }
    else if (event.type === "story") state.story = event.fixture === "personal" ? "Personal story · text masked" : `${label(event.fixture)} practice${event.position === undefined ? "" : ` · ${Math.round(event.position / 100)}%`}`;
    else if (event.type === "view") state.panel = event.panel;
  }
  return state;
}
export function betaEventDescription(event) {
  switch (event.type) {
    case "device": return `${label(event.toy)} · ${event.mode === "live" ? "Live connection" : "Simulator"}${event.channels?.length ? " · " + event.channels.map(label).join(", ") : ""}`;
    case "step": return label(event.step);
    case "control": return `${label(event.control)}${event.channel ? " · " + label(event.channel) : ""}${event.value === undefined ? "" : " · " + (typeof event.value === "number" ? event.value : label(event.value))}`;
    case "output": return `${label(event.state)} · ${Object.entries(event.channels).map(([channel, value]) => `${label(channel)} ${value}/20`).join(", ") || "No active channel"}`;
    case "rating": return ratingText(event);
    case "reading-feedback": return `Reading feedback · Section ${event.position + 1} · ${READING_FEEDBACK_LABELS[event.issue]}`;
    case "preset": return `${({ save: "Saved", apply: "Applied", delete: "Deleted" })[event.event]} ${event.scope === "story" ? "story" : "account"} preset · name and ID excluded`;
    case "story": return event.fixture === "personal" ? "Personal story · text excluded" : `Practice ${label(event.fixture)}${event.position === undefined ? "" : " · " + Math.round(event.position / 100) + "%"}`;
    case "lifecycle": return `Session ${label(event.event)}`;
    case "view": return `Opened ${label(event.panel)}`;
    case "pointer": return `${label(event.kind)} · normalized page position ${Math.round(event.y / 100)}%`;
    default: return "Recorded interaction";
  }
}
export function betaGraphPaths(events, duration) {
  const width = 842, left = 42, top = 15, height = 172, result = {};
  for (const channel of CHANNELS) {
    let level = 0, path = `M${left},${top + height}`;
    for (const event of events) if (event.type === "output" && Object.hasOwn(event.channels, channel)) {
      const x = left + Math.max(0, Math.min(1, event.t / Math.max(1, duration))) * width;
      path += `H${x.toFixed(2)}V${(top + height - event.channels[channel] / 20 * height).toFixed(2)}`; level = event.channels[channel];
    }
    if (events.some(event => event.type === "output" && Object.hasOwn(event.channels, channel))) result[channel] = path + `H${left + width}`;
  }
  return result;
}

export function initializeBetaAdmin() {
  const $ = id => document.getElementById(id); if (!$("review-sessions")) return;
  let sessions = [], nextCursor = null, current = null, at = 0, playing = false, speed = 1, lastFrame = 0, frame = 0, listGeneration = 0, detailGeneration = 0, busy = false, deleteSid = null;
  const status = (message, error = false) => { $("review-status").textContent = message; $("review-status").dataset.error = String(error); };
  const element = (name, text, className) => { const node = document.createElement(name); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  async function api(path, body) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal: abort.signal, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? "Founder sign-in is required to review beta recordings." : response.status === 404 ? "That beta recording is unavailable." : "The recording service could not confirm this request. Please retry.");
      const data = await response.json(); if (data?.ok !== true) throw Error("The recording response could not be confirmed."); return data;
    } finally { clearTimeout(timer); }
  }
  const duration = () => Math.max(0, current?.events.at(-1)?.t || 0);
  function pause() { playing = false; cancelAnimationFrame(frame); document.body.dataset.playing = "false"; $("review-play").textContent = "Play"; }
  function eventsView(index) {
    const values = current.events.map((event, i) => ({ event, i })).filter(({ event }) => event.type !== "pointer" && event.type !== "output");
    const focus = Math.max(0, values.findLastIndex(value => value.i <= index)), start = Math.max(0, focus - 8), visible = values.slice(start, start + 20);
    $("review-events").replaceChildren(...visible.map(({ event, i }) => {
      const item = element("li"); item.dataset.current = String(i === values[focus]?.i);
      const time = element("time", replayTime(event.t)), text = element("span", betaEventDescription(event));
      item.append(time, text); return item;
    }));
  }
  function render() {
    if (!current) return;
    const state = betaReplayState(current, at), maximum = Math.max(0, ...Object.values(state.output));
    $("replay-toy").textContent = label(state.toy); $("replay-step").textContent = label(state.step);
    $("replay-mode").textContent = state.mode === "live" ? "Live request timeline" : "Simulator timeline";
    $("replay-state").textContent = `${state.mode === "live" ? "Requested output" : "Simulated output"} · ${label(state.status)}`;
    $("replay-story").textContent = state.story || "Story text is excluded.";
    $("replay-rating").textContent = state.rating || "No rating at this point.";
    document.querySelector(".toy-visual").style.setProperty("--toy-level", String(maximum / 20)); document.body.dataset.output = String(maximum > 0);
    $("replay-channels").replaceChildren(...Object.entries(state.output).map(([channel, value]) => {
      const row = element("div", undefined, "channel-row"), caption = element("div"), bar = element("div", undefined, "channel-bar"), fill = element("i");
      row.style.setProperty("--channel-color", COLORS[channel] || COLORS.vibrate); caption.append(element("span", label(channel)), element("span", `${value}/20`)); fill.style.width = `${value / 20 * 100}%`; bar.append(fill); row.append(caption, bar); return row;
    }));
    const settings = Object.entries(state.settings).slice(-7), nodes = [];
    for (const [name, value] of settings) nodes.push(element("dt", name), element("dd", value));
    if (!nodes.length) nodes.push(element("dt", "No adjustment yet.")); $("replay-settings").replaceChildren(...nodes);
    $("review-time").textContent = `${replayTime(at)} / ${replayTime(duration())}`; $("review-position").value = String(at);
    $("review-position").setAttribute("aria-valuetext", `${replayTime(at)} of ${replayTime(duration())}`);
    const playhead = $("review-graph").querySelector("[data-playhead]"); if (playhead) { const x = String(42 + at / Math.max(1, duration()) * 842); playhead.setAttribute("x1", x); playhead.setAttribute("x2", x); }
    eventsView(state.index);
  }
  function graph() {
    const svg = $("review-graph"), ns = "http://www.w3.org/2000/svg", make = (tag, attributes) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); return node; };
    const nodes = [];
    for (const level of [0, 5, 10, 15, 20]) { const y = 187 - level / 20 * 172; nodes.push(make("line", { x1: 42, x2: 884, y1: y, y2: y, stroke: "#aa9ba6", "stroke-width": .5, opacity: .4 })); const text = make("text", { x: 30, y: y + 4, "text-anchor": "end", "font-size": 10, fill: "#8b7985" }); text.textContent = String(level); nodes.push(text); }
    const paths = betaGraphPaths(current.events, duration());
    for (const [channel, d] of Object.entries(paths)) nodes.push(make("path", { d, stroke: COLORS[channel], "stroke-width": 2, fill: "none" }));
    for (const event of current.events.filter(value => value.type === "rating" || value.type === "reading-feedback")) { const dot = make("circle", { cx: 42 + event.t / Math.max(1, duration()) * 842, cy: 201, r: 3, fill: "#875c79" }), title = make("title", {}); title.textContent = betaEventDescription(event); dot.append(title); nodes.push(dot); }
    nodes.push(make("line", { "data-playhead": "", x1: 42, x2: 42, y1: 10, y2: 207, stroke: "#523248", "stroke-width": 1.5 }));
    const begin = make("text", { x: 42, y: 217, "font-size": 10, fill: "#8b7985" }); begin.textContent = "0:00";
    const end = make("text", { x: 884, y: 217, "text-anchor": "end", "font-size": 10, fill: "#8b7985" }); end.textContent = replayTime(duration()); nodes.push(begin, end); svg.replaceChildren(...nodes);
    $("graph-legend").replaceChildren(...Object.keys(paths).map(channel => { const item = element("span", label(channel)); item.style.setProperty("--channel-color", COLORS[channel]); return item; }));
  }
  async function open(sid) {
    pause(); const generation = ++detailGeneration; status("Loading the selected recording…");
    try {
      const data = await api(`/api/admin/beta-recordings/${sid}`); if (generation !== detailGeneration) return;
      if (data.format !== "beta-control-timeline-v1" || !Array.isArray(data.events) || data.events.length > 20000 || data.session?.sid !== sid) throw Error("The recording format could not be confirmed.");
      current = data; at = 0; $("review-empty").hidden = true; $("review-player").hidden = false;
      $("review-meta").textContent = `Tester ${data.session.participant} · ${new Date(data.session.startedAt).toLocaleString()}`;
      $("review-title").textContent = `${label(data.session.toy)} · ${data.session.mode === "live" ? "Live connection" : "Simulator"}`;
      $("review-retention").textContent = `${data.events.length} recorded events · Kept until ${new Date(data.session.retainedUntil).toLocaleDateString()}`;
      $("review-position").max = String(Math.max(1, duration())); $("review-play").disabled = !duration(); graph(); render(); showSessions(); status("Recording loaded. No commands can be sent from this replay.");
    } catch (error) { if (generation === detailGeneration) status(error.message, true); }
  }
  function showSessions() {
    $("review-count").textContent = `${sessions.length} loaded recording${sessions.length === 1 ? "" : "s"}`;
    $("review-sessions").replaceChildren(...sessions.map(session => {
      const button = element("button", undefined, "session-button"); button.type = "button"; button.setAttribute("aria-pressed", String(current?.session.sid === session.sid));
      button.append(element("strong", label(session.toy)), element("span", `${session.mode === "live" ? "Live" : "Simulator"} · ${new Date(session.startedAt).toLocaleString()}`), element("span", `${replayTime(session.durationMs)} · ${session.eventCount} events · Tester ${session.participant}`)); button.addEventListener("click", () => void open(session.sid)); return button;
    }));
    $("review-more").hidden = !nextCursor || sessions.length >= 500;
  }
  async function load(more = false) {
    const generation = ++listGeneration; if (!more) { pause(); ++detailGeneration; current = null; $("review-empty").hidden = false; $("review-player").hidden = true; }
    status("Loading opted-in beta recordings…");
    const params = new URLSearchParams({ limit: "50" }); if ($("review-mode").value) params.set("mode", $("review-mode").value); if ($("review-toy").value) params.set("toy", $("review-toy").value); if (more && nextCursor) params.set("before", nextCursor);
    try {
      const data = await api("/api/admin/beta-recordings?" + params); if (generation !== listGeneration) return;
      if (!Array.isArray(data.sessions) || data.sessions.some(row => !UUID.test(row.sid) || typeof row.participant !== "string" || row.participant.length > 12)) throw Error("The session list could not be confirmed.");
      sessions = more ? [...sessions, ...data.sessions] : data.sessions; nextCursor = data.nextCursor; showSessions(); status(sessions.length ? "Choose a session to inspect the control timeline." : "No recordings match these filters yet.");
    } catch (error) { if (generation === listGeneration) status(error.message, true); }
  }
  function tick(time) { if (!playing) return; if (!lastFrame) lastFrame = time; at = Math.min(duration(), at + (time - lastFrame) * speed); lastFrame = time; render(); if (at >= duration()) pause(); else frame = requestAnimationFrame(tick); }
  $("review-play").addEventListener("click", () => { if (!current || !duration()) return; if (playing) pause(); else { if (at >= duration()) at = 0; playing = true; lastFrame = 0; document.body.dataset.playing = "true"; $("review-play").textContent = "Pause"; frame = requestAnimationFrame(tick); } });
  $("review-speed").addEventListener("change", () => { speed = Number($("review-speed").value); });
  $("review-position").addEventListener("input", () => { pause(); at = Number($("review-position").value); render(); });
  $("review-refresh").addEventListener("click", () => void load()); $("review-more").addEventListener("click", () => void load(true)); for (const id of ["review-mode", "review-toy"]) $(id).addEventListener("change", () => void load());
  $("review-export").addEventListener("click", () => { if (!current) return; const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = element("a"); link.href = url; link.download = `satinlore-beta-${current.session.sid}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  const closeDelete = () => { if (!busy) { $("review-delete-dialog").close(); deleteSid = null; } };
  $("review-delete-open").addEventListener("click", () => { if (!current) return; pause(); deleteSid = current.session.sid; $("review-delete-target").textContent = `${label(current.session.toy)} · ${new Date(current.session.startedAt).toLocaleString()}`; $("review-delete-confirm").checked = false; $("review-delete").disabled = true; $("review-delete-dialog").showModal(); });
  $("review-delete-confirm").addEventListener("change", () => { $("review-delete").disabled = !$("review-delete-confirm").checked || busy; });
  $("review-delete-close").addEventListener("click", closeDelete); $("review-delete-cancel").addEventListener("click", closeDelete);
  $("review-delete-dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  $("review-delete").addEventListener("click", async () => {
    if (!deleteSid || !$("review-delete-confirm").checked || busy) return; const chosenSid = deleteSid; busy = true; $("review-delete").disabled = true;
    try { await api("/api/admin/beta-recordings/delete", { sid: chosenSid, confirm: true }); $("review-delete-dialog").close(); deleteSid = null; current = null; await load(); status("The selected beta timeline was deleted."); }
    catch (error) { status(error.message, true); } finally { busy = false; $("review-delete").disabled = !$("review-delete-confirm").checked; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  void load();
}
if (typeof document !== "undefined") initializeBetaAdmin();
