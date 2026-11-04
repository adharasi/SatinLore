// Deliberately structured beta research, never a DOM, screen or input recorder.
// Only fixed event names and bounded numeric controls can leave this module.
import {normalizeReadingMark} from "./reading-feedback.mjs";

export const BETA_RECORDING_HOST = "beta.satinlore.com";
export const BETA_CONSENT_VERSION = "beta-controls-2026-11-02-v1";
export const BETA_RECORDING_MAX_DURATION = 3600000;
const PATH = "/api/beta/recordings";
const TOYS = new Set(["none", "lush", "flexer", "nora", "domi", "velvo", "spinel", "dolce", "hush", "osci3"]);
const CHANNELS = new Set(["vibrate", "fingering", "rotate", "thrusting", "oscillate"]);
const STEPS = new Set(["account", "choose", "connect", "features", "calibration", "playground", "practice", "story", "presets", "complete"]);
const CONTROLS = new Set(["minimum", "background", "preferred", "maximum", "recovery", "gain", "rhythm", "continuity", "strength", "section-level", "action", "mode", "start", "pause", "stop", "hold", "easeoff", "follow", "test"]);
const VALUES = new Set(["story", "continuous", "steady", "gentle", "dynamic", "scene", "off", "on", "simulator", "live", ...CHANNELS]);
const STATES = new Set(["paused", "playing", "testing", "stopped", "connected", "disconnected", "error"]);
const QUESTIONS = new Set(["comfort", "background", "preferred", "intensity", "sync", "overall", "pleasure"]);
const RATING_FIELDS = new Set(["minimum", "background", "preferred", "maximum", "recovery"]);
const FIXTURES = new Set(["practice", "harbour", "garden", "personal"]);
const LIFE = new Set(["hidden", "visible", "connected", "disconnected", "error", "unload", "paused", "resumed"]);
const PANELS = new Set(["library", "reader", "settings", "setup", "sidebar", "help"]);
const POINTER = new Set(["click", "move", "touch", "scroll"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const own = (o, k) => Object.hasOwn(o, k);
const exact = (o, keys) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const number = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const clamp = (n, low, high, fallback) => Number.isFinite(n) ? Math.max(low, Math.min(high, Math.round(n))) : fallback;

/** Reject extra keys instead of quietly projecting away private context. */
export function normalizeBetaEvent(value, elapsed = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !integer(elapsed, 0, BETA_RECORDING_MAX_DURATION)) return null;
  const type = value.type, t = elapsed;
  if (type === "device" && exact(value, ["type", "toy", "mode", "channels"]) && TOYS.has(value.toy) &&
      ["simulator", "live"].includes(value.mode) && (!own(value, "channels") || Array.isArray(value.channels) &&
      value.channels.length <= 5 && value.channels.every(channel => CHANNELS.has(channel)) && new Set(value.channels).size === value.channels.length)) {
    return {t, type, toy: value.toy, mode: value.mode, ...(own(value, "channels") ? {channels: [...value.channels]} : {})};
  }
  if (type === "step" && exact(value, ["type", "step"]) && STEPS.has(value.step)) return {t, type, step: value.step};
  if (type === "control" && exact(value, ["type", "control", "channel", "value"]) && CONTROLS.has(value.control) &&
      (!own(value, "channel") || CHANNELS.has(value.channel)) &&
      (!own(value, "value") || number(value.value, 0, 20) || VALUES.has(value.value))) {
    return {t, type, control: value.control, ...(own(value, "channel") ? {channel: value.channel} : {}), ...(own(value, "value") ? {value: value.value} : {})};
  }
  if (type === "output" && exact(value, ["type", "channels", "state"]) && STATES.has(value.state) &&
      exact(value.channels, [...CHANNELS]) && Object.keys(value.channels).length > 0 &&
      Object.values(value.channels).every(n => number(n, 0, 20))) return {t, type, channels: {...value.channels}, state: value.state};
  if (type === "rating" && exact(value, ["type", "question", "value", "channel", "field"]) && QUESTIONS.has(value.question) &&
      integer(value.value, 1, 5) && (!own(value, "channel") || CHANNELS.has(value.channel)) &&
      (!own(value, "field") || RATING_FIELDS.has(value.field))) {
    return {t, type, question: value.question, value: value.value,
      ...(own(value, "channel") ? {channel: value.channel} : {}), ...(own(value, "field") ? {field: value.field} : {})};
  }
  if (type === "reading-feedback" && exact(value, ["type", "issue", "position"])) {
    const mark = normalizeReadingMark(value.issue, value.position);
    return mark ? {t, type, ...mark} : null;
  }
  if (type === "preset" && exact(value, ["type", "event", "scope"]) && ["save", "apply", "delete"].includes(value.event) &&
      ["account", "story"].includes(value.scope)) return {t, type, event: value.event, scope: value.scope};
  if (type === "story" && exact(value, ["type", "fixture", "position"]) && FIXTURES.has(value.fixture) &&
      (!own(value, "position") || integer(value.position, 0, 10000))) return {t, type, fixture: value.fixture, ...(own(value, "position") ? {position: value.position} : {})};
  if (type === "lifecycle" && exact(value, ["type", "event"]) && LIFE.has(value.event)) return {t, type, event: value.event};
  if (type === "view" && exact(value, ["type", "panel", "width"]) && PANELS.has(value.panel) &&
      (!own(value, "width") || integer(value.width, 320, 7680))) return {t, type, panel: value.panel, ...(own(value, "width") ? {width: value.width} : {})};
  if (type === "pointer" && exact(value, ["type", "kind", "x", "y"]) && POINTER.has(value.kind) &&
      integer(value.y, 0, 10000) && (!own(value, "x") || integer(value.x, 0, 10000))) return {t, type, kind: value.kind, ...(own(value, "x") ? {x: value.x} : {}), y: value.y};
  return null;
}

export function createBetaRecorder({hostname = globalThis.location?.hostname,
  fetchImpl = globalThis.fetch?.bind(globalThis), window = globalThis.window, document = globalThis.document,
  now = () => Date.now(), uuid = () => globalThis.crypto.randomUUID(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), onState = () => {}} = {}) {
  const enabled = hostname === BETA_RECORDING_HOST;
  const listeners = new Set([onState]);
  let status = enabled ? "choice" : "disabled", message = "", sid = null, seq = 0, startedAt = 0;
  let count = 0, sent = 0, lastEventTime = 0, duration = BETA_RECORDING_MAX_DURATION, maxEvents = 20000, maxBatch = 100;
  let queue = [], timer = null, operation = null, starting = null, stopping = null, pendingStart = null, disposed = false;
  let version = 0, invalidated = false, lastPointer = -Infinity, lastScrollAt = -Infinity, lastOutput = "", lastOutputAt = -Infinity;
  let retainedUntil = null, expiresAt = null, canRetryDelete = false, consented = false;
  let history = [], historyStatus = "idle", historyMessage = "", historyOperation = null, historyVersion = 0;
  const snapshot = () => ({enabled, status, recording: status === "recording", consented,
    count, sent, elapsedMs: startedAt ? Math.max(0, Math.min(duration, now() - startedAt)) : 0,
    retainedUntil, expiresAt, canWithdraw: !!sid, canRetryDelete, message,
    historyStatus, historyMessage, history: history.filter(row => row.sid !== sid).map((row, index) => ({index,
      startedAt: row.startedAt, retainedUntil: row.retainedUntil, state: row.state, eventCount: row.eventCount}))});
  const emit = () => { const s = snapshot(); for (const listener of listeners) { try { listener(s); } catch {} } return s; };
  const cancelTimer = () => { if (timer !== null) clearTimer(timer); timer = null; };
  async function request(body, {keepalive = false, path = PATH, method = "POST"} = {}) {
    if (!enabled || disposed && body?.action !== "stop") throw Error("Beta recording is unavailable.");
    if (typeof fetchImpl !== "function") throw Error("Beta recording is unavailable.");
    const controller = new AbortController();
    const timeout = setTimer(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(path, {method, credentials: "same-origin",
        ...(method === "POST" ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {}), signal: controller.signal, keepalive});
      const text = await response.text();
      if (text.length > (method === "GET" ? 65536 : 8192)) throw Error("Beta recording returned an invalid response.");
      let data; try { data = JSON.parse(text); } catch { throw Error("Beta recording returned an invalid response."); }
      if (!response.ok) {
        const error = Error("Beta recording could not be saved."); error.status = response.status; throw error;
      }
      return data;
    } finally { clearTimer(timeout); }
  }
  const schedule = () => {
    cancelTimer();
    if (!disposed && status === "recording") timer = setTimer(() => { timer = null; void flush(); }, 1500);
  };
  async function flush() {
    if (operation) return operation;
    if (!sid || invalidated || !queue.length) { schedule(); return true; }
    const generation = version, currentSid = sid;
    const batch = queue.slice(0, maxBatch);
    const body = {action: "append", sid: currentSid, seq: seq + 1, events: batch};
    operation = (async () => {
      let result = null;
      // Retrying exactly the same sequence/body cannot duplicate a batch.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (generation !== version || invalidated) return false;
        try { result = await request(body); break; }
        catch (error) { if ([400, 401, 403, 404, 409, 410, 413, 429].includes(error.status)) break; }
      }
      if (generation !== version || invalidated) return false;
      if (!result?.ok) {
        status = "error"; message = "Recording paused because saving failed. Your toy controls still work. You can stop or delete this recording.";
        cancelTimer(); emit(); return false;
      }
      seq = body.seq; sent += batch.length; queue.splice(0, batch.length); emit(); return true;
    })().finally(() => { operation = null; if (status === "recording") schedule(); });
    return operation;
  }
  async function start({mode = "simulator", toy = "none"} = {}) {
    if (!enabled || disposed || sid || status === "recording" || status === "paused") return false;
    if (starting) return starting;
    if (!["simulator", "live"].includes(mode) || !TOYS.has(toy)) return false;
    consented = true; invalidated = false; status = "starting"; message = "Starting the optional beta recording…"; emit();
    if (!pendingStart) {
      const id = uuid(); if (!UUID.test(id)) { status = "error"; message = "Recording could not start in this browser."; emit(); return false; }
      pendingStart = {action: "start", consentVersion: BETA_CONSENT_VERSION, idempotencyKey: id,
        mode, toy, viewport: {w: clamp(window?.innerWidth, 320, 7680, 1360), h: clamp(window?.innerHeight, 240, 4320, 940)}};
    }
    const generation = ++version;
    starting = (async () => {
      try {
        const value = await request(pendingStart);
        if (generation !== version || disposed) return false;
        if (!value?.ok || !UUID.test(value.sid) || value.seq !== 0 || !integer(value.maxDurationMs, 1000, BETA_RECORDING_MAX_DURATION) ||
            !integer(value.maxEvents, 1, 20000) || !integer(value.maxBatchEvents, 1, 100)) throw Error("Invalid recording response.");
        sid = value.sid; seq = 0; duration = value.maxDurationMs; maxEvents = value.maxEvents; maxBatch = value.maxBatchEvents;
        startedAt = now(); queue = []; count = 0; sent = 0; lastEventTime = 0; lastOutput = ""; lastOutputAt = -Infinity;
        retainedUntil = Number.isSafeInteger(value.retainedUntil) ? value.retainedUntil : null;
        expiresAt = Number.isSafeInteger(value.expiresAt) ? value.expiresAt : null;
        status = "recording"; message = "Recording setup, controls and navigation.";
        pendingStart = null; canRetryDelete = false; attach(); schedule(); emit(); return true;
      } catch {
        if (generation !== version || disposed) return false;
        status = "error"; message = "Recording did not start. You can retry or continue without it."; emit(); return false;
      }
    })().finally(() => { starting = null; });
    return starting;
  }
  function record(value) {
    if (disposed || status !== "recording" || !sid || invalidated) return false;
    const elapsed = Math.max(lastEventTime, 0, Math.floor(now() - startedAt));
    if (elapsed > duration || count >= maxEvents) {
      status = "paused"; message = "This recording reached its session limit. Stop it to finish. Your testing can continue without recording."; cancelTimer(); void flush(); emit(); return false;
    }
    const event = normalizeBetaEvent(value, elapsed);
    if (!event) return false;
    if (event.type === "pointer") {
      if (event.kind === "move" && elapsed - lastPointer < 500) return false;
      if (event.kind === "scroll" && elapsed - lastScrollAt < 250) return false;
      if (event.kind === "move") lastPointer = elapsed;
      if (event.kind === "scroll") lastScrollAt = elapsed;
    }
    if (event.type === "output") {
      const signature = JSON.stringify({channels: event.channels, state: event.state});
      if (signature === lastOutput && elapsed - lastOutputAt < 1000) return false;
      lastOutput = signature; lastOutputAt = elapsed;
    }
    queue.push(event); lastEventTime = elapsed; count++; emit();
    if (queue.length >= maxBatch) void flush();
    return true;
  }
  function pause() {
    if (status !== "recording") return false;
    record({type: "lifecycle", event: "paused"}); status = "paused"; cancelTimer();
    message = "Recording paused. Your toy controls still work; this gap will not be recorded.";
    void flush(); emit(); return true;
  }
  function resume() {
    if (status !== "paused" || invalidated || !sid || now() - startedAt > duration || count >= maxEvents) return false;
    status = "recording"; message = "Recording setup, controls and navigation.";
    record({type: "lifecycle", event: "resumed"}); schedule(); emit(); return true;
  }
  async function stop() {
    if (stopping) return stopping;
    if (!sid || invalidated) return false;
    status = "stopping"; cancelTimer(); message = "Finishing the recording…"; emit();
    const generation = version;
    stopping = (async () => {
      let complete = true;
      while (queue.length && !invalidated && generation === version) { if (!await flush()) { complete = false; break; } }
      if (invalidated || generation !== version) return false;
      try {
        const value = await request({action: "stop", sid}, {keepalive: true});
        if (invalidated || generation !== version) return false;
        if (!value?.ok) throw Error("Stop not confirmed.");
        status = "stopped"; message = complete ? "Recording finished and saved for the SatinLore Team’s review." : "Recording finished. Some activity could not be saved.";
        detach(); emit(); return true;
      } catch {
        if (invalidated || generation !== version) return false;
        status = "error"; message = "Recording is stopped on this page, but the server has not confirmed it. Retry Stop or delete the recording.";
        detach(); emit(); return false;
      }
    })().finally(() => { stopping = null; });
    return stopping;
  }
  async function withdraw() {
    if (!enabled || !sid || disposed) return false;
    cancelTimer(); detach(); ++version; invalidated = true; queue = [];
    status = "withdrawing"; message = "Recording stopped. Requesting deletion…"; canRetryDelete = true; emit();
    const currentSid = sid;
    try {
      const value = await request({action: "withdraw", sid: currentSid});
      if (!value?.ok) throw Error("Deletion not confirmed.");
      ++historyVersion; history = history.filter(row => row.sid !== currentSid);
      sid = null; status = "withdrawn"; consented = false; canRetryDelete = false; pendingStart = null;
      message = "This beta recording was deleted. Continue testing without recording, or choose to record a new session.";
      emit(); return true;
    } catch {
      status = "error"; message = "Recording is stopped here. Deletion is not confirmed yet; retry Delete recording when connected."; emit(); return false;
    }
  }
  function decline() {
    if (sid || starting) return false;
    status = "declined"; consented = false; pendingStart = null;
    message = "Testing without recording. You can change this choice here."; emit(); return true;
  }
  async function loadHistory() {
    if (!enabled || disposed) return false;
    if (historyOperation) return historyOperation;
    const generation = historyVersion;
    historyStatus = "loading"; historyMessage = "Loading your recordings…"; emit();
    historyOperation = (async () => {
      try {
        const value = await request(undefined, {method: "GET", path: `${PATH}?limit=100`});
        if (!value?.ok || !Array.isArray(value.sessions) || value.sessions.length > 100) throw Error("Invalid recording list.");
        const rows = value.sessions.map(row => {
          if (!row || !UUID.test(row.sid) || !Number.isSafeInteger(row.startedAt) || !Number.isSafeInteger(row.retainedUntil) ||
              !["active", "finished", "stopped"].includes(row.state) || !integer(row.eventCount, 0, 20000)) throw Error("Invalid recording summary.");
          return {sid: row.sid, startedAt: row.startedAt, retainedUntil: row.retainedUntil, state: row.state, eventCount: row.eventCount};
        });
        if (disposed || generation !== historyVersion) return false;
        history = rows; historyStatus = "ready"; historyMessage = "Your retained recordings. Earlier sessions remain available to the SatinLore Team for up to 30 days.";
        emit(); return true;
      } catch {
        if (disposed || generation !== historyVersion) return false;
        historyStatus = "error"; historyMessage = "Your recording list could not be loaded. Try My recordings again."; emit(); return false;
      }
    })().finally(() => { historyOperation = null; });
    return historyOperation;
  }
  function prepareNew() {
    if (!enabled || disposed || status !== "stopped" || !sid) return false;
    history = [{sid, startedAt, retainedUntil, state: "stopped", eventCount: sent}, ...history.filter(row => row.sid !== sid)].slice(0, 100);
    ++version; sid = null; seq = 0; queue = []; startedAt = 0; count = 0; sent = 0; retainedUntil = null; expiresAt = null;
    pendingStart = null; consented = false; invalidated = false; canRetryDelete = false; status = "choice";
    message = "Choose whether to record a new session. Earlier recordings are kept separately; open My recordings to delete them.";
    emit(); return true;
  }
  async function deletePrevious(index) {
    if (!enabled || disposed || !Number.isInteger(index) || index < 0) return false;
    const row = history.filter(item => item.sid !== sid)[index];
    if (!row) return false;
    ++historyVersion;
    historyMessage = "Deleting the selected earlier recording…"; emit();
    try {
      const value = await request({action: "withdraw", sid: row.sid});
      if (!value?.ok) throw Error("Deletion not confirmed.");
      history = history.filter(item => item.sid !== row.sid); historyStatus = "ready"; historyMessage = "The selected earlier recording was deleted."; emit(); return true;
    } catch {
      historyStatus = "ready"; historyMessage = "Deletion was not confirmed. Retry Delete for the selected recording."; emit(); return false;
    }
  }
  function point(event, kind) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const width = Math.max(1, window?.innerWidth || 1360), height = Math.max(1, window?.innerHeight || 940);
    record({type: "pointer", kind, x: clamp(event.clientX / width * 10000, 0, 10000, 0), y: clamp(event.clientY / height * 10000, 0, 10000, 0)});
  }
  const click = event => point(event, "click"), move = event => point(event, "move");
  const scroll = () => {
    const root = document?.documentElement;
    const extent = Math.max(1, (root?.scrollHeight || 1) - (window?.innerHeight || 1));
    record({type: "pointer", kind: "scroll", y: clamp((window?.scrollY || 0) / extent * 10000, 0, 10000, 0)});
  };
  const visibility = () => { record({type: "lifecycle", event: document?.hidden ? "hidden" : "visible"}); void flush(); };
  const unload = () => { record({type: "lifecycle", event: "unload"}); void stop(); };
  let attached = false;
  function attach() {
    if (attached) return; attached = true;
    document?.addEventListener?.("click", click, {passive: true});
    document?.addEventListener?.("pointermove", move, {passive: true});
    document?.addEventListener?.("visibilitychange", visibility);
    window?.addEventListener?.("scroll", scroll, {passive: true});
    window?.addEventListener?.("pagehide", unload);
  }
  function detach() {
    if (!attached) return; attached = false;
    document?.removeEventListener?.("click", click);
    document?.removeEventListener?.("pointermove", move);
    document?.removeEventListener?.("visibilitychange", visibility);
    window?.removeEventListener?.("scroll", scroll);
    window?.removeEventListener?.("pagehide", unload);
  }
  return {start, record, pause, resume, stop, withdraw, decline, flush, snapshot, prepareNew, loadHistory, deletePrevious,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    destroy() { if (disposed) return; cancelTimer(); detach(); disposed = true; ++version; invalidated = true; queue = []; listeners.clear(); },
  };
}

/** Standalone research choice; this component never controls the toy or account. */
export function mountBetaRecording({mount, recorder, document = mount?.ownerDocument ?? globalThis.document,
  context = () => ({mode: "simulator", toy: "none"})} = {}) {
  if (!mount || !recorder || !document?.createElement || !recorder.snapshot().enabled) return {destroy() {}};
  const make = (tag, name, text) => { const el = document.createElement(tag); if (name) el.className = name; if (text) el.textContent = text; return el; };
  const wrap = make("section", "beta-recording"); wrap.id = "beta-recording"; wrap.setAttribute("aria-labelledby", "beta-recording-heading");
  const top = make("div", "beta-recording-top"), title = make("strong", "", "Beta session review"); title.id = "beta-recording-heading";
  const badge = make("span", "beta-recording-badge", "Your choice"); badge.setAttribute("aria-live", "polite"); top.append(title, badge);
  const choice = make("div", "beta-recording-choice");
  choice.append(make("p", "", "Help the SatinLore Team understand what works. You can share a replay of the setup steps, pointer positions, toy control levels, requested output and any ratings or reading feedback you choose to give."),
    make("p", "", "These control choices and ratings can reveal intimate preferences. Only the SatinLore Team can review them, for up to 30 days. Private story text, typing, pairing details, camera and sound are excluded. This is a structured activity replay, not a screen video."),
    make("p", "", "Recording is optional. Pause or stop at any time, or delete this session. Your account, toy controls and testing access work without it."));
  const accepted = make("input"); accepted.type = "checkbox"; accepted.id = "beta-recording-agree";
  const label = make("label", "beta-recording-agree"); label.setAttribute("for", accepted.id); label.append(accepted, make("span", "", "I agree to share this session for beta research."));
  choice.append(label);
  const buttons = make("div", "beta-recording-actions");
  const action = (id, text, className = "") => { const b = make("button", className, text); b.id = id; b.type = "button"; buttons.append(b); return b; };
  const startButton = action("beta-recording-start", "Start recording", "primary"), declineButton = action("beta-recording-decline", "Continue without recording");
  const pauseButton = action("beta-recording-pause", "Pause recording"), stopButton = action("beta-recording-stop", "Stop recording");
  const deleteButton = action("beta-recording-delete", "Delete recording", "stop");
  const changeButton = action("beta-recording-change", "Change recording choice");
  const newButton = action("beta-recording-new", "New recording");
  const historyButton = action("beta-recording-history", "My recordings");
  historyButton.setAttribute("aria-expanded", "false"); historyButton.setAttribute("aria-controls", "beta-recording-history-panel");
  const status = make("p", "beta-recording-status"); status.id = "beta-recording-status"; status.setAttribute("role", "status");
  const note = make("details", "beta-recording-note");
  note.append(make("summary", "", "Recording details"),
    make("p", "", "Beta setup, navigation, requested levels and feedback you choose to give are shared. A reading feedback mark contains a section number and one of three fixed reasons. Private text and pairing details are excluded. The SatinLore Team can review a session for up to 30 days. Each recording is limited to one hour; you can begin another afterwards."),
    make("p", "", "Stopping recording does not stop your toy. Use the reader’s Stop control for that."));
  const historyPanel = make("section", "beta-recording-history"); historyPanel.id = "beta-recording-history-panel"; historyPanel.hidden = true;
  const historyStatus = make("p", "beta-recording-note"); historyStatus.setAttribute("role", "status");
  const historyList = make("ol", "beta-recording-history-list"); historyPanel.append(historyStatus, historyList);
  wrap.append(top, choice, buttons, status, note, historyPanel); mount.replaceChildren(wrap);
  let choiceExpanded = false, previousStatus = "choice";
  accepted.addEventListener("change", () => { startButton.disabled = !accepted.checked; });
  startButton.addEventListener("click", async () => { if (!accepted.checked) return; const value = context(); await recorder.start(value); });
  declineButton.addEventListener("click", () => { accepted.checked = false; choiceExpanded = false; recorder.decline(); });
  pauseButton.addEventListener("click", () => recorder.snapshot().status === "paused" ? recorder.resume() : recorder.pause());
  stopButton.addEventListener("click", () => void recorder.stop());
  deleteButton.addEventListener("click", () => { accepted.checked = false; choiceExpanded = false; void recorder.withdraw(); });
  newButton.addEventListener("click", () => { accepted.checked = false; choiceExpanded = true; recorder.prepareNew(); });
  changeButton.addEventListener("click", () => { choiceExpanded = !choiceExpanded; render(recorder.snapshot()); });
  historyButton.addEventListener("click", () => {
    historyPanel.hidden = !historyPanel.hidden; historyButton.setAttribute("aria-expanded", String(!historyPanel.hidden));
    if (!historyPanel.hidden) void recorder.loadHistory();
  });
  function render(state) {
    const active = ["recording", "paused", "stopping"].includes(state.status);
    if (previousStatus !== state.status && ["declined", "withdrawn"].includes(state.status)) choiceExpanded = false;
    previousStatus = state.status;
    const optionalCollapsed = ["declined", "withdrawn"].includes(state.status);
    choice.hidden = active || state.canWithdraw || optionalCollapsed && !choiceExpanded;
    wrap.dataset.state = state.status;
    badge.textContent = state.recording ? "● Recording" : state.status === "paused" ? "Paused" : state.status === "stopping" ? "Saving" : state.status === "withdrawing" ? "Deleting" : "Not recording";
    startButton.hidden = state.canWithdraw || state.status === "starting" || choice.hidden;
    startButton.disabled = !accepted.checked || state.status === "starting";
    startButton.textContent = state.status === "error" && !state.canWithdraw ? "Retry recording" : "Start recording";
    declineButton.hidden = state.canWithdraw || state.status === "starting" || choice.hidden;
    pauseButton.hidden = !["recording", "paused"].includes(state.status); pauseButton.textContent = state.status === "paused" ? "Resume recording" : "Pause recording";
    stopButton.hidden = !state.canWithdraw || ["stopped", "withdrawing"].includes(state.status); stopButton.disabled = state.status === "stopping";
    deleteButton.hidden = !state.canWithdraw; deleteButton.disabled = state.status === "withdrawing";
    changeButton.hidden = !optionalCollapsed;
    changeButton.textContent = choiceExpanded ? "Hide recording choice" : "Change recording choice";
    changeButton.setAttribute("aria-expanded", String(choiceExpanded));
    newButton.hidden = state.status !== "stopped";
    status.textContent = state.message || "Choose whether to share this session. No activity is recorded before you agree.";
    note.hidden = !state.canWithdraw;
    historyStatus.textContent = state.historyMessage || "Your retained recordings appear here.";
    historyList.replaceChildren();
    for (const row of state.history || []) {
      const item = make("li"), line = make("span", "", `Recording ${row.index + 1} · ${new Date(row.startedAt).toLocaleString()} · ${row.eventCount} events`);
      const remove = make("button", "stop", `Delete recording ${row.index + 1}`); remove.type = "button";
      remove.addEventListener("click", () => { remove.disabled = true; void recorder.deletePrevious(row.index); });
      item.append(line, remove); historyList.append(item);
    }
    if (state.historyStatus === "ready" && !state.history?.length) historyList.append(make("li", "beta-recording-empty", "No earlier recordings are retained for this account."));
  }
  const unsubscribe = recorder.subscribe(render);
  return {destroy() { unsubscribe(); mount.replaceChildren(); }};
}
