import { ALPHA_SCREEN_LABELS, ALPHA_SCREEN_STAGES } from "./alpha-screen-schema.mjs";

const API = "/alpha/api/alpha";
const ADMIN = `${API}/admin/sessions`;
const ID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const TESTERS = new Set(["Dilan", "Sadie"]);
const EVENT_PAGE = 50;
const REPLAY_SCREENS = new Set(ALPHA_SCREEN_STAGES);
const REPLAY_STEPS = new Set([...REPLAY_SCREENS, "welcome", "complete"]);
const CHANNELS = [
  { key: "vibrate", alias: "vibration", label: "Vibration", className: "alpha-chart-vibrate" },
  { key: "fingering", alias: "flexing", label: "Flexing", className: "alpha-chart-flex" }
];
const LABELS = {
  good: "Good moment", tooMuch: "Too much", change: "Wanted a change", finished: "Finished", climax: "Marked climax",
  yes: "Yes", no: "No", depends: "Depends", vibration: "Vibration", flexing: "Flexing", vibrate: "Vibration",
  fingering: "Flexing", both: "Both", neither: "Neither", live: "Physical toy", simulator: "Simulator",
  unknown: "Unknown output", submitted: "Submitted to bridge", acknowledged: "Acknowledged by software",
  clamped: "Limits applied", requested: "Requested", observed: "Tester observed", easeOff: "Ease off",
  verification: "Hardware check", verify: "Hardware check", step: "Setup step", output: "Output",
  vibrationMaximum: "Vibration maximum", flexingMaximum: "Flexing maximum", failed: "Failed",
  welcome: "Welcome", connect: "Connect", controls: "Control lab", feedback: "Feedback", complete: "Session complete",
  start: "Start", stop: "Stop", hold: "Hold", easeoff: "Ease off", minimum: "Minimum", rhythm: "Rhythm",
  "screen-started": "Screen capture started", "screen-ended": "Screen capture ended"
};
const FEEDBACK = [
  ["minimum", "Preferred a constant minimum"],
  ["vibrationMaximum", "Preferred vibration maximum", 20],
  ["flexingMaximum", "Preferred flexing maximum", 20],
  ["preferredMovement", "Preferred movement"],
  ["enjoyment", "Enjoyment", 10], ["comfort", "Comfort", 10],
  ["easeOfUse", "Ease of control", 10], ["connectionEase", "Ease of connection", 10],
  ["bestMoment", "What felt best"], ["setupFeedback", "Setup feedback"],
  ["improvements", "Suggested improvements"], ["overallNotes", "Other notes"]
];
const svgNS = "http://www.w3.org/2000/svg";
const human = value => Object.hasOwn(LABELS, value) ? LABELS[value] : String(value).replace(/[_-]+/g, " ");
const isNumber = value => Number.isFinite(value);
const time = value => {
  const seconds = Math.floor(Math.max(0, value || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const date = value => isNumber(value) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value) : "Unknown date";
const getLevels = event => Object.fromEntries(CHANNELS.map(({ key, alias }) => {
  const value = event.channels?.[key] ?? event[alias];
  return [key, Number.isInteger(value) && value >= 0 && value <= 20 ? value : null];
}));
const isOutput = event => event.type === "output";
const isMarker = event => event.type === "mark";
const hasKnownOutput = event => isOutput(event) && event.state !== "unknown" && !["unknown", "failed"].includes(event.stage);
const isDiscontinuity = event => ["disconnect", "disconnected", "lost", "failed", "error", "expired", "closed", "hidden", "recording-paused"].some(value =>
  [event.event, event.status, event.state].includes(value)
) && ["connection", "lifecycle", "device"].includes(event.type);
function eventGroup(event) {
  if (event.type === "mark") return "moment";
  if (["control", "output", "command"].includes(event.type)) return event.type === "control" ? "control" : "command";
  return "connection";
}
function valueText(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value ? human(value) : "";
}
function eventDescription(event) {
  if (isMarker(event)) return human(event.mark ?? "Marked moment");
  if (event.type === "verification") {
    return `${human(event.mode)} check · ${human(event.channel)} · Response ${event.response ? "observed" : "unconfirmed"} · Stop ${event.stopped ? "observed" : "unconfirmed"}`;
  }
  if (event.type === "verify") return `Hardware check · ${human(event.movement)} · ${human(event.outcome)}`;
  if (event.type === "device") return `Device selected · ${human(event.mode)} · ${event.channels.map(human).join(", ")}`;
  if (event.type === "output" || event.type === "command") {
    const levels = getLevels(event);
    const states = CHANNELS.map(({ key, label }) => {
      const value = levels[key];
      return value === null ? "" : `${label} ${value}/20`;
    }).filter(Boolean);
    return [
      human(event.stage ?? event.state ?? event.type), ...states,
      isNumber(event.durationMs) ? `${event.durationMs / 1000}s command` : "",
      isNumber(event.commandId) ? `Request ${event.commandId}` : ""
    ].filter(Boolean).join(" · ");
  }
  return [event.control ?? event.step ?? event.event ?? event.stage ?? event.type, event.channel, event.state, event.value]
    .map(valueText).filter(Boolean).join(" · ");
}
function validSession(session) {
  return session && ID.test(session.id) && TESTERS.has(session.username) &&
    ["live", "simulator"].includes(session.mode) && isNumber(session.createdAt);
}
function durationOf(data) {
  const clipEnd = isNumber(data.clip?.offsetMs) && isNumber(data.clip?.durationMs) ?
    data.clip.offsetMs + data.clip.durationMs : 0;
  return Math.max(clipEnd, data.events.at(-1)?.t ?? 0, ...data.annotations.map(note => note.t));
}
function screenVisits(events, duration) {
  const visits = [];
  let visit;
  for (const event of events) {
    const screen = event.type === "step" && REPLAY_STEPS.has(event.step) ? event.step :
      event.type === "screen" && REPLAY_SCREENS.has(event.screen) ? event.screen : null;
    if (screen && screen !== visit?.screen) {
      if (visit) visit.end = event.t;
      visit = REPLAY_SCREENS.has(screen) ? { screen, start: event.t, end: duration, frames: [], pointers: [] } : null;
      if (visit) visits.push(visit);
    }
    if (!visit) continue;
    if (event.type === "screen" && Array.isArray(event.items) && event.viewport?.w > 0 && event.viewport?.h > 0) visit.frames.push(event);
    if (event.type === "pointer" && normalized(event.x) && normalized(event.y)) visit.pointers.push(event);
  }
  return visits;
}
const normalized = value => Number.isInteger(value) && value >= 0 && value <= 1000;
const percent = value => `${value / 10}%`;
const isReplayEvent = event => event.type === "screen" || event.type === "pointer";
// Replay the recorded software envelope. Live requests count after submission
// and expire at their own lease. Simulator samples last until state changes.
export function deriveAlphaMovementPattern(events, durationMs, mode) {
  const traceEnd = Math.min(durationMs, events.at(-1)?.t ?? 0);
  const channels = {};
  const positive = [];
  for (const { key } of CHANNELS) {
    const segments = [];
    let previous = null, latestRequest = 0;
    function close(at) {
      if (!previous) return;
      const { startMs, level } = previous;
      const endMs = Math.min(at, previous.endMs, durationMs);
      if (endMs <= startMs) return;
      const last = segments.at(-1);
      if (last?.level === level && last.endMs === startMs) last.endMs = endMs;
      else segments.push({ startMs, endMs, level });
    }
    for (const event of events) {
      if (event.t > durationMs) break;
      if (isDiscontinuity(event) || event.type === "device") {
        close(event.t);
        previous = null;
        continue;
      }
      if (!isOutput(event)) continue;
      if (event.commandId < latestRequest) continue;
      latestRequest = Math.max(latestRequest, event.commandId ?? 0);
      if (event.stage === "requested") continue;
      close(event.t);
      const level = hasKnownOutput(event) ? getLevels(event)[key] : null;
      const live = (event.mode ?? mode) === "live" || event.stage === "submitted";
      previous = level === null || live && level > 0 && !(event.durationMs > 0) ? null : {
        startMs: event.t, level, endMs: live && level > 0 ? event.t + event.durationMs : durationMs
      };
    }
    close(traceEnd);
    let activeMs = 0, levelMilliseconds = 0, peakLevel = null;
    for (const segment of segments) {
      peakLevel = Math.max(peakLevel ?? 0, segment.level);
      if (segment.level === 0) continue;
      const elapsed = segment.endMs - segment.startMs;
      positive.push(segment);
      activeMs += elapsed;
      levelMilliseconds += elapsed * segment.level;
    }
    channels[key] = { activeMs, levelSeconds: levelMilliseconds / 1000, peakLevel, segments };
  }
  let activeMs = 0, through = 0;
  for (const { startMs, endMs } of positive.sort((a, b) => a.startMs - b.startMs)) {
    activeMs += Math.max(0, endMs - Math.max(through, startMs));
    through = Math.max(through, endMs);
  }
  return {
    format: "satinlore-alpha-movement-pattern-v1", durationMs, activeMs,
    levelSeconds: channels.vibrate.levelSeconds + channels.fingering.levelSeconds, channels
  };
}
const seconds = value => (value / 1000).toFixed(1) + " s";

export function initializeAlphaAdmin() {
  const $ = id => document.getElementById(`alpha-review-${id}`);
  if (!$("workspace")) return;
  const el = (tag, content, className) => {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  const svg = (tag, attrs) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  const status = (message, error = false) => {
    $("status").textContent = message;
    $("status").dataset.error = String(error);
  };
  const clip = $("clip");
  let sessions = [], current = null, duration = 0, at = 0;
  let listRequest, detailRequest, generation = 0;
  let viewEvents = [], eventStart = 0, seekSync = true, deleteTarget = null, deleting = false;
  let pattern = null;
  let visits = [], visitIndex = -1, replayAnimation = null, drawnFrame = null;
  const themeKey = "satinlore.alpha.appearance";
  function setTheme(theme, save = false) {
    document.documentElement.dataset.theme = theme;
    $("theme").setAttribute("aria-checked", String(theme === "dark"));
    if (save) try { localStorage.setItem(themeKey, theme); } catch { /* Private browsing may block storage. */ }
  }
  try { setTheme(localStorage.getItem(themeKey) === "light" ? "light" : "dark"); } catch { setTheme("dark"); }
  $("theme").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true));

  function clearClip() {
    clip.pause();
    if (clip.hasAttribute("src")) {
      clip.removeAttribute("src");
      clip.load();
    }
    clip.hidden = true;
    $("load-clip").hidden = true;
  }
  function clearDetail() {
    current = null;
    viewEvents = [];
    pattern = null;
    stopReplay();
    visits = [];
    visitIndex = -1;
    drawnFrame = null;
    clearClip();
    $("detail").hidden = true;
    $("empty").hidden = false;
    for (const id of ["events", "feedback", "annotations", "markers", "levels", "chart", "pattern-summary", "replay-screen", "replay-items"]) $(id).replaceChildren();
    $("replay-controls").hidden = $("replay-view").hidden = $("replay-pointer").hidden = true;
    $("replay-note").textContent = "";
    for (const id of ["alpha-detail-meta", "alpha-detail-title", "alpha-detail-subtitle", "alpha-review-clip-note"]) {
      document.getElementById(id).textContent = "";
    }
  }
  function accessLost() {
    generation++;
    detailRequest?.abort();
    listRequest?.abort();
    clearDetail();
    sessions = [];
    $("list").replaceChildren();
    $("workspace").hidden = true;
    $("account").hidden = true;
    $("signout").hidden = true;
    $("login").hidden = false;
    status("Founder sign-in is required to review Alpha sessions.", true);
  }
  async function api(path, { signal, body } = {}) {
    const timeout = AbortSignal.timeout(10000);
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store", credentials: "same-origin", redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    });
    if (response.status === 401 || response.status === 403) {
      accessLost();
      throw Error("Founder sign-in is required to review Alpha sessions.");
    }
    if (!response.ok) throw Error(response.status === 404 ? "This session is unavailable." : "The Alpha service could not complete this request. Please retry.");
    if (response.status === 204) return {};
    const data = await response.json();
    if (!data || typeof data !== "object" || data.ok === false) throw Error("The Alpha response could not be confirmed.");
    return data;
  }
  function showSessions() {
    const tester = $("user").value;
    const rows = sessions.filter(session => !tester || session.username === tester);
    $("count").textContent = `${rows.length} session${rows.length === 1 ? "" : "s"} loaded`;
    $("list").replaceChildren(...rows.map(session => {
      const item = el("li");
      const button = el("button");
      button.type = "button";
      button.setAttribute("aria-current", String(current?.session.id === session.id));
      button.append(
        el("strong", `${session.username} · ${human(session.mode)}`),
        el("span", date(session.createdAt)),
        el("span", [session.state === "active" ? "In progress" : "Finished", `${session.eventCount ?? 0} records`, session.hasFeedback ? "Feedback" : "", session.hasClip ? "Clip" : ""].filter(Boolean).join(" · "))
      );
      button.addEventListener("click", () => void openSession(session.id, button));
      item.append(button);
      return item;
    }));
  }
  async function loadSessions() {
    listRequest?.abort();
    listRequest = new AbortController();
    const signal = listRequest.signal;
    const params = new URLSearchParams();
    if ($("user").value) params.set("username", $("user").value);
    generation++;
    detailRequest?.abort();
    clearDetail();
    sessions = [];
    showSessions();
    $("refresh").disabled = true;
    status("Loading Alpha sessions…");
    try {
      const data = await api(params.size ? `${ADMIN}?${params}` : ADMIN, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(data.sessions) || !data.sessions.every(validSession)) throw Error("The session list could not be confirmed.");
      sessions = data.sessions;
      showSessions();
      status($("list").children.length ? "Choose a session to review." : "No Alpha sessions match this filter.");
    } catch (error) {
      if (!signal.aborted) status(error.message, true);
    } finally {
      if (!signal.aborted) $("refresh").disabled = false;
    }
  }
  const xFor = t => 34 + Math.max(0, Math.min(1, t / Math.max(1, duration))) * 590;
  const yFor = level => 116 - level * 4.9;
  function drawChart() {
    const nodes = [];
    for (const level of [0, 5, 10, 15, 20]) {
      const y = yFor(level);
      nodes.push(svg("line", { class: "alpha-chart-grid", x1: 34, x2: 624, y1: y, y2: y }));
      const label = svg("text", { class: "alpha-chart-text", x: 26, y: y + 3, "text-anchor": "end" });
      label.textContent = level;
      nodes.push(label);
    }
    for (const { key, className } of CHANNELS) {
      const path = pattern.channels[key].segments.map(({ startMs, endMs, level }) =>
        `M${xFor(startMs).toFixed(2)},${yFor(level).toFixed(2)}H${xFor(endMs).toFixed(2)}`
      ).join("");
      if (path) nodes.push(svg("path", { class: className, d: path }));
    }
    for (const marker of current.events.filter(isMarker)) {
      const x = xFor(marker.t);
      nodes.push(svg("line", { class: "alpha-chart-marker", x1: x, x2: x, y1: 12, y2: 123 }));
    }
    nodes.push(svg("line", { class: "alpha-chart-playhead", "data-playhead": "", x1: 34, x2: 34, y1: 12, y2: 123 }));
    for (const [position, label, anchor] of [[34, "0:00", "start"], [624, time(duration), "end"]]) {
      const tick = svg("text", { class: "alpha-chart-text", x: position, y: 138, "text-anchor": anchor });
      tick.textContent = label;
      nodes.push(tick);
    }
    $("chart").replaceChildren(...nodes);
  }
  function clipOffset() {
    return isNumber(current?.clip?.offsetMs) ? current.clip.offsetMs : null;
  }
  function stopReplay() {
    if (replayAnimation !== null) cancelAnimationFrame(replayAnimation);
    replayAnimation = null;
    $("replay-play").textContent = "Play screen";
    $("pattern-play").textContent = "Play movement";
  }
  function showScreenFrame(frame) {
    if (frame === drawnFrame) return;
    drawnFrame = frame;
    $("replay-view").hidden = !frame;
    if (!frame) {
      $("replay-items").replaceChildren();
      return;
    }
    $("replay-view").style.setProperty("--replay-ratio", Math.max(.3, Math.min(4, frame.viewport.w / frame.viewport.h)));
    $("replay-items").replaceChildren(...frame.items.filter(item =>
      item && Object.hasOwn(ALPHA_SCREEN_LABELS, item.id) && [item.x, item.y, item.w, item.h].every(normalized)
    ).map(item => {
      const node = el("span", ALPHA_SCREEN_LABELS[item.id], "alpha-replay-item");
      node.dataset.state = item.state ?? "";
      Object.assign(node.style, { left: percent(item.x), top: percent(item.y), width: percent(item.w), height: percent(item.h) });
      return node;
    }));
  }
  function drawScreenReplay(keepVisit) {
    let visit = visits[visitIndex];
    if (visit && !keepVisit && (at < visit.start || at >= visit.end)) {
      const index = visits.findLastIndex(entry => entry.start <= at && at <= entry.end);
      if (index !== -1) {
        visitIndex = index;
        visit = visits[index];
        $("replay-screen").value = String(index);
      }
    }
    const position = visit ? Math.max(visit.start, Math.min(visit.end, at)) : 0;
    const frame = visit?.frames.findLast(entry => entry.t <= position) ?? null;
    const pointer = frame && visit.pointers.findLast(entry => entry.t <= position && position - entry.t <= 1500);
    showScreenFrame(frame);
    $("replay-pointer").hidden = !pointer;
    if (pointer) {
      $("replay-pointer").style.left = percent(pointer.x);
      $("replay-pointer").style.top = percent(pointer.y);
      $("replay-pointer").dataset.click = String(pointer.action === "click" && position - pointer.t <= 450);
    }
    const elapsed = visit ? position - visit.start : 0;
    const length = visit ? visit.end - visit.start : 0;
    $("replay-play").disabled = !visit?.frames.length || !length;
    $("replay-position").disabled = !length;
    $("replay-position").max = String(Math.max(1, length));
    $("replay-position").value = String(elapsed);
    $("replay-position").setAttribute("aria-valuetext", `${time(elapsed)} of ${time(length)}`);
    $("replay-time").textContent = `${time(elapsed)} / ${time(length)}`;
    $("replay-note").textContent = frame ? "" : visit?.frames.length ? "The first screen view appears shortly after this visit begins." :
      visit ? "No screen views were saved for this visit." : "No screen visits were saved for this session.";
  }
  function loadScreenVisits() {
    visits = screenVisits(current.events, duration);
    const firstRecorded = visits.findIndex(visit => visit.frames.length);
    visitIndex = visits.length ? Math.max(0, firstRecorded) : -1;
    $("replay-controls").hidden = !visits.length;
    $("replay-screen").replaceChildren(...visits.map((visit, index) => {
      const option = el("option", `${human(visit.screen)} · ${time(visit.start)}–${time(visit.end)}`);
      option.value = String(index);
      return option;
    }));
    $("replay-screen").value = String(visitIndex);
  }
  function setPosition(position, moveClip = false, keepVisit = false) {
    if (!current) return;
    if (moveClip) stopReplay();
    at = Math.max(0, Math.min(duration, Number(position) || 0));
    $("position").value = String(at);
    $("position").setAttribute("aria-valuetext", `${time(at)} of ${time(duration)}`);
    $("time").textContent = `${time(at)} / ${time(duration)}`;
    const playhead = $("chart").querySelector("[data-playhead]");
    playhead?.setAttribute("x1", xFor(at));
    playhead?.setAttribute("x2", xFor(at));
    $("levels").replaceChildren(...CHANNELS.map(({ key, label }) => {
      const segment = pattern.channels[key].segments.findLast(entry => entry.startMs <= at && at < entry.endMs);
      return el("span", `${label} · ${segment ? `${segment.level}/20` : "No known level"}`);
    }));
    if (moveClip) {
      const index = Math.max(0, viewEvents.findLastIndex(event => event.t <= at));
      if (index < eventStart || index >= eventStart + EVENT_PAGE) {
        eventStart = Math.floor(index / EVENT_PAGE) * EVENT_PAGE;
        displayEvents();
      }
    }
    for (const item of $("events").children) item.dataset.current = String(Number(item.dataset.time) === at);
    drawScreenReplay(keepVisit);
    const offset = clipOffset();
    if (moveClip && offset !== null && clip.readyState && isNumber(clip.duration)) {
      const target = (at - offset) / 1000;
      if (target >= 0 && target <= clip.duration && Math.abs(clip.currentTime - target) > .1) {
        seekSync = false;
        clip.currentTime = target;
      }
    }
  }
  function seekButton(position, title) {
    const button = el("button", title);
    button.type = "button";
    button.addEventListener("click", () => setPosition(position, true));
    return button;
  }
  function displayEvents() {
    const entries = viewEvents.slice(eventStart, eventStart + EVENT_PAGE);
    $("events").replaceChildren(...entries.map(event => {
      const item = el("li");
      item.dataset.time = String(event.t);
      item.dataset.current = String(event.t === at);
      item.append(seekButton(event.t, time(event.t)), el("p", eventDescription(event)));
      return item;
    }));
    $("event-count").textContent = entries.length ?
      `${eventStart + 1}–${eventStart + entries.length} of ${viewEvents.length} actions` : "No actions match this view.";
    $("events-before").disabled = eventStart === 0;
    $("events-after").disabled = eventStart + EVENT_PAGE >= viewEvents.length;
  }
  function filterEvents() {
    const group = $("event-type").value;
    viewEvents = current?.events.filter(event => !isReplayEvent(event) && (!group || eventGroup(event) === group)) ?? [];
    eventStart = 0;
    displayEvents();
  }
  function displayFeedback() {
    const feedback = current.feedback;
    const grid = el("dl", undefined, "alpha-feedback-grid");
    for (const [key, name, scale] of FEEDBACK) {
      const value = feedback?.[key];
      if (typeof value === "number" && scale) grid.append(el("dt", name), el("dd", `${value}/${scale}`));
      if (typeof value === "string" && value.trim()) {
        grid.append(el("dt", name), el("dd", key === "minimum" || key === "preferredMovement" ? human(value) : value));
      }
    }
    $("feedback").replaceChildren(grid.children.length ? grid : el("p", "No feedback was shared.", "note"));
  }
  function displayNotes() {
    const markers = current.events.filter(isMarker);
    $("markers").replaceChildren(...(markers.length ?
      markers.map(marker => seekButton(marker.t, `${time(marker.t)} · ${eventDescription(marker)}`)) :
      [el("p", "No moments were marked.", "note")]));
    $("annotations").replaceChildren(...(current.annotations.length ? current.annotations.map(note => {
      const item = el("li");
      item.append(seekButton(note.t, time(note.t)), el("p", note.text));
      return item;
    }) : [el("li", "No annotations were shared.")]));
  }
  async function openSession(id, button) {
    if (!ID.test(id)) return;
    detailRequest?.abort();
    detailRequest = new AbortController();
    const signal = detailRequest.signal, version = ++generation;
    clearDetail();
    status("Loading the selected session…");
    try {
      const data = await api(`${ADMIN}/${id}`, { signal });
      if (version !== generation || signal.aborted) return;
      if (!validSession(data.session) || data.session.id !== id || !Array.isArray(data.events) || !Array.isArray(data.annotations) ||
          !data.events.every(event => isNumber(event?.t) && event.t >= 0 && typeof event.type === "string" &&
            (event.type !== "device" || Array.isArray(event.channels))) ||
          !data.annotations.every(note => isNumber(note?.t) && note.t >= 0 && typeof note.text === "string")) {
        throw Error("The selected session could not be confirmed.");
      }
      data.events.sort((a, b) => a.t - b.t);
      current = data;
      at = 0;
      duration = durationOf(data);
      loadScreenVisits();
      pattern = deriveAlphaMovementPattern(data.events, duration, data.session.mode);
      const rows = [
        ["Total movement", pattern.activeMs, pattern.levelSeconds],
        ...CHANNELS.map(({ key, label }) => [label, pattern.channels[key].activeMs, pattern.channels[key].levelSeconds, pattern.channels[key].peakLevel])
      ];
      $("pattern-summary").replaceChildren(...rows.map(([label, activeMs, amount, peak]) => {
        const row = el("div");
        const details = [seconds(activeMs) + " active", amount.toFixed(1) + " level × seconds"];
        if (peak !== undefined) details.push(peak === null ? "No recorded level" : peak + "/20 peak");
        row.append(el("dt", label), el("dd", details.join(" · ")));
        return row;
      }));
      $("pattern-play").disabled = !CHANNELS.some(({ key }) => pattern.channels[key].segments.length);
      $("empty").hidden = true;
      $("detail").hidden = false;
      document.getElementById("alpha-detail-meta").textContent = `${data.session.username} · ${date(data.session.createdAt)}`;
      document.getElementById("alpha-detail-title").textContent = `Flexer · ${human(data.session.mode)}`;
      document.getElementById("alpha-detail-subtitle").textContent =
        `${data.events.filter(event => !isReplayEvent(event)).length} actions · ${time(duration)} elapsed${isNumber(data.session.retainedUntil) ? ` · Retained until ${date(data.session.retainedUntil)}` : ""}`;
      $("position").max = String(Math.max(1, duration));
      $("position").disabled = !duration;
      $("event-type").value = "";
      $("clip-note").textContent = data.clip ? clipOffset() === null ?
        "The tester shared a controls-only clip. Its timeline offset is unavailable." :
        `The tester shared a controls-only clip starting at ${time(clipOffset())}.` : "No screen clip was shared.";
      $("load-clip").hidden = !data.clip;
      drawChart();
      filterEvents();
      setPosition(visits[visitIndex]?.start ?? 0, false, true);
      displayFeedback();
      displayNotes();
      for (const listButton of $("list").querySelectorAll("button")) listButton.setAttribute("aria-current", String(listButton === button));
      status(`Loaded ${data.session.username}’s session.`);
      document.getElementById("alpha-detail-title").focus();
    } catch (error) {
      if (version === generation && !signal.aborted) status(error.message, true);
    }
  }
  $("position").addEventListener("input", () => setPosition($("position").value, true));
  $("replay-screen").addEventListener("change", () => {
    visitIndex = Number($("replay-screen").value);
    clip.pause();
    if (visits[visitIndex]) setPosition(visits[visitIndex].start, true, true);
  });
  $("replay-position").addEventListener("input", () => {
    const visit = visits[visitIndex];
    if (!visit) return;
    clip.pause();
    setPosition(visit.start + Number($("replay-position").value), true, true);
  });
  $("replay-play").addEventListener("click", () => {
    if (replayAnimation !== null) {
      stopReplay();
      return;
    }
    const visit = visits[visitIndex];
    if (!visit?.frames.length || visit.end <= visit.start) return;
    clip.pause();
    const start = at < visit.start || at >= visit.end ? visit.start : at;
    const started = performance.now();
    const tick = now => {
      const position = Math.min(visit.end, Math.round(start + Math.max(0, now - started)));
      if (position === visit.end || position - at >= 40 || position < at) setPosition(position, false, true);
      if (position >= visit.end) stopReplay();
      else replayAnimation = requestAnimationFrame(tick);
    };
    $("replay-play").textContent = "Pause screen";
    replayAnimation = requestAnimationFrame(tick);
  });
  $("pattern-play").addEventListener("click", () => {
    if (replayAnimation !== null) {
      const wasPlayingMovement = $("pattern-play").textContent === "Pause movement";
      stopReplay();
      if (wasPlayingMovement) return;
    }
    if (!pattern || !duration) return;
    clip.pause();
    const start = at >= duration ? 0 : at;
    const started = performance.now();
    const tick = now => {
      const position = Math.min(duration, Math.round(start + Math.max(0, now - started)));
      if (position === duration || position - at >= 40 || position < at) setPosition(position);
      if (position >= duration) stopReplay();
      else replayAnimation = requestAnimationFrame(tick);
    };
    $("pattern-play").textContent = "Pause movement";
    replayAnimation = requestAnimationFrame(tick);
  });
  $("event-type").addEventListener("change", filterEvents);
  $("events-before").addEventListener("click", () => { eventStart = Math.max(0, eventStart - EVENT_PAGE); displayEvents(); });
  $("events-after").addEventListener("click", () => { if (eventStart + EVENT_PAGE < viewEvents.length) eventStart += EVENT_PAGE; displayEvents(); });
  $("refresh").addEventListener("click", () => void loadSessions());
  $("user").addEventListener("change", () => void loadSessions());
  $("load-clip").addEventListener("click", () => {
    if (!current?.clip) return;
    stopReplay();
    clip.src = `${ADMIN}/${current.session.id}/clip`;
    seekSync = true;
    clip.hidden = false;
    $("load-clip").hidden = true;
    clip.load();
  });
  clip.addEventListener("play", stopReplay);
  clip.addEventListener("timeupdate", () => {
    const offset = clipOffset();
    if (offset !== null && seekSync && clip.hasAttribute("src")) setPosition(offset + clip.currentTime * 1000);
  });
  clip.addEventListener("seeked", () => { seekSync = true; });
  clip.addEventListener("error", () => {
    if (!clip.hasAttribute("src") || !current?.clip) return;
    clearClip();
    $("clip-note").textContent = "This clip could not be opened. It may have expired, or the format may be unavailable in this browser.";
    $("load-clip").hidden = false;
  });
  $("export").addEventListener("click", () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...current, movementPattern: pattern }, null, 2)], { type: "application/json" }));
    const link = el("a");
    link.href = url;
    link.download = `satinlore-alpha-${current.session.id}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const dialog = $("delete-dialog"), check = $("delete-confirm"), remove = $("delete");
  function closeDelete() { if (!deleting) dialog.close(); }
  $("delete-open").addEventListener("click", () => {
    if (!current) return;
    stopReplay();
    clip.pause();
    deleteTarget = current.session.id;
    $("delete-target").textContent = `${current.session.username} · ${date(current.session.createdAt)}`;
    check.checked = false;
    remove.disabled = true;
    $("delete-error").hidden = true;
    dialog.showModal();
  });
  check.addEventListener("change", () => { remove.disabled = !check.checked || deleting; });
  $("delete-cancel").addEventListener("click", closeDelete);
  dialog.addEventListener("cancel", event => { if (deleting) event.preventDefault(); });
  dialog.addEventListener("close", () => { deleteTarget = null; });
  remove.addEventListener("click", async () => {
    if (!deleteTarget || !check.checked || deleting) return;
    deleting = true;
    remove.disabled = $("delete-cancel").disabled = true;
    $("delete-error").hidden = true;
    try {
      await api(`${ADMIN}/${deleteTarget}/withdraw`, { body: { confirm: true } });
      dialog.close();
      clearDetail();
      await loadSessions();
      if (!$("workspace").hidden) {
        status("Session deleted.");
        $("refresh").focus();
      }
    } catch (error) {
      if ($("workspace").hidden) dialog.close();
      else {
        $("delete-error").textContent = error.message;
        $("delete-error").hidden = false;
      }
    } finally {
      deleting = false;
      remove.disabled = !check.checked;
      $("delete-cancel").disabled = false;
    }
  });
  $("signout").addEventListener("click", async () => {
    $("signout").disabled = true;
    stopReplay();
    clip.pause();
    try {
      await api(`${API}/logout`, { body: {} });
      accessLost();
      status("You signed out of Alpha.");
    } catch (error) { status(error.message, true); }
    finally { $("signout").disabled = false; }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    stopReplay();
    clip.pause();
  });
  window.addEventListener("pagehide", () => { detailRequest?.abort(); listRequest?.abort(); clearDetail(); });
  window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
  void (async () => {
    try {
      const account = await api(`${API}/auth`);
      if (account.authenticated !== true || account.isFounder !== true || account.username !== "Dilan") {
        accessLost();
        return;
      }
      $("account").textContent = "Signed in as Dilan · Founder access";
      $("account").hidden = $("signout").hidden = $("workspace").hidden = false;
      await loadSessions();
    } catch (error) { status(error.message, true); }
  })();
}
if (typeof document !== "undefined") initializeAlphaAdmin();
