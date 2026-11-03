import {AlphaTimeline} from "./alpha-timeline.mjs";
import {createAlphaDevice} from "./alpha-device.mjs";
import {mountAlphaCapture} from "./alpha-capture.mjs";

const $ = id => document.getElementById(id);
const API = "/alpha/api/alpha";
const MOVEMENTS = {
  vibrate: {label: "Vibration", description: "Flexer’s vibration motor"},
  fingering: {label: "Flexing", description: "Flexer’s moving tip"},
};
const MARKS = {good: "Good moment", tooMuch: "Too much", change: "Wanted a change", climax: "Peak", finished: "Finished"};
const STAGES = {
  connect: ["PHASE 01 · DEVICE SETUP", "Connect your Flexer", "Select your device and check its response before exploring."],
  controls: ["PHASE 02 · EXPLORE", "Find your settings", "Try the movements at your own pace. You can hold, lower or stop the output whenever you choose."],
  feedback: ["PHASE 03 · REFLECT", "What would you choose again?", "Review your session and tell us what worked for you."],
};

let account = null;
let session = null;
let timeline = null;
let device = null;
let deviceState = null;
let deviceGeneration = 0;
let stage = "connect";
let busy = false;
let detail = null;
let clipPhase = "idle";
let clipOffsetMs = 0;
let previousChannels = "";
let previousToys = "";
let lastSaveAttempt = 0;
let startAttempt = null;
let selectedLiveDevice = false;

function note(id, message, error = false) {
  const element = $(id);
  if (element.textContent !== message) element.textContent = message;
  element.dataset.error = String(error);
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(milliseconds) {
  return new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"}).format(milliseconds);
}

function focusHeading(id) {
  $(id).focus({preventScroll: true});
  window.scrollTo({top: 0, behavior: "instant"});
}

async function request(path, {method = "GET", body, signal, headers = {}, timeout = 10_000} = {}) {
  const deadline = AbortSignal.timeout(timeout);
  const response = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store", redirect: "error",
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    headers: {"X-Requested-With": "XMLHttpRequest", ...headers}, body,
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== "object") {
    const error = new Error(typeof value?.error === "string" ? value.error.slice(0, 180) : "The request could not be confirmed.");
    error.status = response.status;
    throw error;
  }
  return value;
}

function get(path, signal) { return request(`${API}${path}`, {signal}); }
function post(path, value, signal) {
  return request(`${API}${path}`, {method: "POST", body: JSON.stringify(value), signal, headers: {"Content-Type": "application/json"}});
}

function sessionPath(id = session?.id) { return `/sessions/${encodeURIComponent(id)}`; }
function emit(event) { return timeline?.record(event) === true; }

const clip = mountAlphaCapture($("alpha-clip-panel"), {
  async upload({blob, durationMs, signal}) {
    if (!account || !session?.id || !session.finished) throw new Error("Finish the session before sharing the clip.");
    const current = session;
    const result = await request(`${API}${sessionPath(current.id)}/clip`, {
      method: "POST", body: blob, signal, timeout: 30_000,
      headers: {
        "Content-Type": "video/webm", "X-Alpha-Clip-Consent": account.clipConsentVersion,
        "X-Alpha-Clip-Duration-Ms": String(durationMs), "X-Alpha-Clip-Offset-Ms": String(clipOffsetMs),
      },
    });
    if (current !== session || !result.clip) throw new Error("The clip save could not be confirmed.");
  },
  onChange(value) {
    if (value.phase === "recording" && clipPhase !== "recording") {
      clipOffsetMs = timeline?.elapsed() ?? 0;
      emit({type: "lifecycle", event: "screen-started"});
    }
    if (value.phase !== "recording" && clipPhase === "recording") emit({type: "lifecycle", event: "screen-ended"});
    clipPhase = value.phase;
  },
});

function setAccount(value) {
  account = value?.authenticated === true ? value : null;
  $("alpha-founder-link").hidden = !account?.isFounder;
  $("alpha-logout").hidden = !account;
  $("alpha-login").hidden = Boolean(account);
  $("alpha-welcome").hidden = !account || Boolean(session);
  $("alpha-study").hidden = !account || !session;
  if (account) {
    $("alpha-welcome-title").textContent = `Welcome, ${account.username}.`;
    if (account.isFounder && new URL(location.href).searchParams.get("next") === "admin") location.replace("/admin");
  }
  note("alpha-global-status", "");
  updateWelcome();
}

function updateWelcome() {
  const disabled = busy || !account || !$("alpha-adult").checked;
  $("alpha-consent-start").disabled = disabled || !account?.consentVersion;
  $("alpha-unrecorded-start").disabled = disabled;
  $("alpha-history-open").disabled = busy;
}

async function checkAccess() {
  const current = account;
  if (!current || document.hidden || Date.now() >= current.expiresAt) return false;
  try {
    const value = await request("/alpha/api/access");
    return current === account && !document.hidden && value.authenticated === true && value.expiresAt > Date.now();
  } catch { return false; }
}

function teardownDevice() {
  ++deviceGeneration;
  device?.destroy();
  device = deviceState = null;
  previousChannels = previousToys = "";
  selectedLiveDevice = false;
  $("alpha-device-qr-image").removeAttribute("src");
  $("alpha-verification-movements").replaceChildren();
  $("alpha-movement-cards").replaceChildren();
}

function resetStudy() {
  clip.setReady(false);
  clip.setShareEnabled(false);
  clip.discard();
  teardownDevice();
  timeline?.destroy();
  timeline = session = detail = null;
  $("alpha-clip-panel").hidden = true;
  $("alpha-stop-warning").hidden = true;
  $("alpha-feedback-form").reset();
  $("alpha-annotation-form").reset();
  $("alpha-withdraw").close();
  $("alpha-history").close();
  for (const id of ["alpha-start-status", "alpha-mark-status", "alpha-feedback-status", "alpha-annotation-status"]) note(id, "");
  setAccount(account);
}

function showStage(next, {focus = true, record = true} = {}) {
  if (next !== "controls") {
    clip.stop();
    clip.setStartEnabled(false);
    if (next === "connect") {
      clip.setReady(false);
      $("alpha-clip-panel").hidden = true;
    }
  }
  stage = next;
  if (record) emit({type: "step", step: next});
  for (const key of Object.keys(STAGES)) $("alpha-progress-" + key).removeAttribute("aria-current");
  $("alpha-progress-" + next).setAttribute("aria-current", "step");
  const [kicker, title, description] = STAGES[next];
  $("alpha-study-kicker").textContent = kicker;
  $("alpha-study-title").textContent = title;
  $("alpha-study-intro").textContent = description;
  $("alpha-device-panel").hidden = next === "feedback";
  $("alpha-marks").hidden = next !== "controls";
  $("alpha-peak").hidden = next !== "controls";
  $("alpha-study-actions").hidden = next === "feedback";
  $("alpha-feedback").hidden = next !== "feedback";
  if (next === "controls") {
    $("alpha-clip-panel").hidden = !session?.id;
    clip.setReady(Boolean(session?.id));
    clip.setStartEnabled(timeline?.state === "recording");
  }
  renderDevice();
  renderRecord();
  updateFeedbackAccess();
  if (focus) focusHeading("alpha-study-title");
}

async function startStudy(recorded) {
  if (busy || !account || !$("alpha-adult").checked) return;
  const mode = document.querySelector("input[name='alpha-mode']:checked").value;
  busy = true;
  updateWelcome();
  const currentAccount = account;
  try {
    let remote = null;
    if (recorded) {
      note("alpha-start-status", "Opening your recording…");
      if (!startAttempt || startAttempt.mode !== mode || startAttempt.account !== account) {
        startAttempt = {mode, account, key: crypto.randomUUID()};
      }
      remote = await post("/sessions", {mode, consentVersion: account.consentVersion, idempotencyKey: startAttempt.key});
      if (typeof remote.id !== "string" || !Number.isSafeInteger(remote.seq) || !Number.isSafeInteger(remote.expiresAt)) {
        throw new Error("Recording could not be confirmed.");
      }
      startAttempt = null;
    }
    if (account !== currentAccount) return;
    session = {id: remote?.id ?? null, mode, finished: false, finishing: false};
    if (remote) {
      timeline = new AlphaTimeline({session: remote, append: (id, body, signal) => post(`${sessionPath(id)}/events`, body, signal), onChange: renderRecord});
      emit({type: "step", step: "welcome"});
    }
    const generation = ++deviceGeneration;
    device = createAlphaDevice({
      authorize: checkAccess,
      onChange(value) {
        if (generation !== deviceGeneration) return;
        const wasSelected = Boolean(deviceState?.selectedId);
        deviceState = value;
        if (value.selectedId && !wasSelected && stage === "connect") emit({type: "step", step: "verify"});
        if (stage === "controls" && !value.selectedId) showStage("connect");
        else renderDevice();
      },
      onEvent(event) { if (generation === deviceGeneration) emit(event); },
    });
    deviceState = device.snapshot();
    setAccount(account);
    showStage("connect");
  } catch (error) {
    resetStudy();
    note("alpha-start-status", error.message || "Could not start the session. Try again.", true);
  } finally {
    busy = false;
    updateWelcome();
    renderDevice();
    renderRecord();
  }
}

function renderRecord() {
  const capture = timeline?.status();
  const open = Boolean(session?.id) && !session.finished;
  const label = session?.finished && session?.id ? "Timeline saved" :
    capture?.state === "recording" ? "Recording timeline" : capture?.state === "paused" ? "Recording paused" :
      capture?.state === "closing" ? "Saving timeline" : "Timeline off";
  $("alpha-record-strip").dataset.state = capture?.state ?? "off";
  note("alpha-record-label", label);
  note("alpha-record-note", capture?.error || (session?.id ? "You can delete your recording from this session." : "Practice session. Your responses stay on this page."));
  $("alpha-record-pause").hidden = !open || capture?.state !== "recording";
  $("alpha-record-resume").hidden = !open || capture?.state !== "paused";
  $("alpha-record-retry").hidden = !open || !(capture?.error || session.finishing);
  $("alpha-record-retry").disabled = busy;
  $("alpha-record-withdraw").hidden = !session?.id;
  $("alpha-record-withdraw").disabled = busy;
  $("alpha-peak").disabled = busy;
}

function buildDeviceRows(channels) {
  const verify = $("alpha-verification-movements");
  const cards = $("alpha-movement-cards");
  verify.replaceChildren();
  cards.replaceChildren();
  for (const channel of channels) {
    const movement = MOVEMENTS[channel];
    if (!movement) continue;
    const verification = $("alpha-verify-template").content.firstElementChild.cloneNode(true);
    verification.dataset.channel = channel;
    verification.querySelector("h4").textContent = movement.label;
    const test = verification.querySelector("button");
    test.textContent = `Test ${movement.label.toLowerCase()}`;
    test.addEventListener("click", () => deviceAction(() => device.test(channel)));
    verification.querySelector("input").addEventListener("change", event => {
      if (event.target.checked) device.confirmTest(channel);
      renderDevice();
    });
    verify.append(verification);

    const card = $("alpha-movement-template").content.firstElementChild.cloneNode(true);
    card.dataset.channel = channel;
    card.querySelector("h4").textContent = movement.label;
    card.querySelector(".alpha-movement-heading .note").textContent = movement.description;
    const toggle = card.querySelector("input[type=checkbox]");
    toggle.setAttribute("aria-label", `Use ${movement.label.toLowerCase()}`);
    toggle.addEventListener("change", () => {
      const active = deviceState.activeChannels;
      const chosen = toggle.checked ? [...new Set([...active, channel])] : active.filter(value => value !== channel);
      const next = deviceState.supportsCombined ? chosen : [channel];
      if (next.length) deviceAction(() => device.choose(next));
      else renderDevice();
    });
    for (const control of card.querySelectorAll("[data-setting]")) {
      const setting = control.dataset.setting;
      const label = control.closest("label");
      if (label) control.setAttribute("aria-label", `${movement.label} ${label.firstChild.textContent.trim().toLowerCase()}`);
      if (setting === "range") {
        control.addEventListener("click", () => deviceAction(() => device.enableRange(channel)));
        continue;
      }
      control.addEventListener(control.type === "range" ? "input" : "change", () => {
        device.set(channel, setting, control.type === "range" ? Number(control.value) : control.value);
        renderDevice();
      });
    }
    cards.append(card);
  }
}

function renderDevice() {
  if (!session || !deviceState || stage === "feedback") return;
  const d = deviceState;
  const mode = session.mode;
  const simulator = mode === "simulator";
  const connected = Boolean(d.selectedId);
  if (!simulator && connected) selectedLiveDevice = true;
  const connecting = d.connectionState === "connecting";
  const awaiting = Boolean(d.qrUrl) || (d.toys?.length ?? 0) > 0;
  const ready = connected && !d.busy && !d.testing;
  const verifying = stage === "connect" && connected;
  const exploring = stage === "controls" && connected;
  const channels = d.channels ?? [];
  const checked = d.verifiedChannels ?? [];
  const active = d.activeChannels ?? [];
  const ranged = d.personalRangeChannels ?? [];
  $("alpha-device-mode").textContent = simulator ? "FLEXER SIMULATOR" : "FLEXER · LOVENSE REMOTE";
  $("alpha-device-title").textContent = verifying ? "Check your device" : exploring ? "Your movements" : simulator ? "Connect the simulator" : "Connect your toy";
  $("alpha-connection-badge").textContent = connected ? "Device selected" : connecting ? "Connecting" : awaiting ? "Choose your device" : "Disconnected";
  note("alpha-device-status", d.connectionMessage || "");
  $("alpha-pairing").hidden = verifying || exploring;
  $("alpha-live-instructions").hidden = simulator;
  $("alpha-simulator-instructions").hidden = !simulator;
  $("alpha-device-connect").disabled = busy || connecting || d.busy;
  $("alpha-device-connect").textContent = connecting ? "Connecting…" : awaiting ? "Restart connection" : "Connect";
  $("alpha-device-refresh").hidden = simulator || !awaiting;
  $("alpha-device-refresh").disabled = busy || connecting || d.busy;
  const qr = !simulator && stage === "connect" && !connected ? d.qrUrl : null;
  $("alpha-device-qr").hidden = !qr;
  const image = $("alpha-device-qr-image");
  if (!qr) image.removeAttribute("src");
  else if (image.getAttribute("src") !== qr) image.src = qr;

  const toys = d.toys ?? [];
  $("alpha-device-select-wrap").hidden = !toys.length || connected;
  const picker = $("alpha-device-select");
  const signature = JSON.stringify(toys.map(({id, label}) => [id, label]));
  if (signature !== previousToys) {
    const selected = picker.value;
    picker.replaceChildren(new Option("Choose a device", ""), ...toys.map(({id, label}) => new Option(label, id)));
    picker.value = toys.some(toy => toy.id === selected) ? selected : "";
    previousToys = signature;
  }
  picker.disabled = busy || connecting || d.busy;
  $("alpha-device-select-confirm").disabled = picker.disabled || !picker.value;
  $("alpha-verification").hidden = !verifying;
  $("alpha-controls").hidden = !exploring;
  $("alpha-verification-note").textContent = simulator ? "Watch each simulated movement return to zero before confirming." : "Keep the device out of use for this check. Watch the movement and make sure it stops before confirming.";
  $("alpha-verify-continue").disabled = busy || !ready || !checked.length;
  $("alpha-device-disconnect").disabled = busy;

  const channelSignature = channels.join(",");
  if (channelSignature !== previousChannels) {
    previousChannels = channelSignature;
    buildDeviceRows(channels);
  }
  for (const row of $("alpha-verification-movements").children) {
    const channel = row.dataset.channel;
    const passed = checked.includes(channel);
    const last = d.lastTest?.channel === channel;
    row.querySelector("p").textContent = passed ? "Response and stop checked" : last ? "Confirm what you observed below." : "A short level-1 check.";
    row.querySelector("button").disabled = busy || !ready;
    row.querySelector("label").hidden = !passed && (!last || !ready);
    const confirmation = row.querySelector("input");
    confirmation.checked = passed;
    confirmation.disabled = passed || busy || !ready;
  }

  const output = d.output ?? {};
  for (const card of $("alpha-movement-cards").children) {
    const channel = card.dataset.channel;
    const settings = d.settings?.[channel];
    if (!settings) continue;
    const selected = active.includes(channel);
    const toggle = card.querySelector("input[type=checkbox]");
    toggle.checked = selected;
    toggle.disabled = busy || !ready || !checked.includes(channel) || (selected && active.length === 1);
    card.querySelector(".alpha-output span").textContent = simulator ? "Simulated output" : "Requested output";
    card.querySelector(".alpha-output output").textContent = output[channel] === null || output[channel] === undefined ? "Unconfirmed" : `${output[channel]} / 20`;
    for (const control of card.querySelectorAll("[data-setting]")) {
      const field = control.dataset.setting;
      if (field === "range") {
        control.hidden = simulator || !checked.includes(channel) || ranged.includes(channel);
        control.disabled = busy || !ready || d.running;
        continue;
      }
      if (control.type === "range") {
        control.max = String(field === "maximum" ? d.maximums[channel] : settings.maximum);
        control.closest("label").querySelector("output").value = String(settings[field]);
      }
      control.value = String(settings[field]);
      control.disabled = busy || !ready || !checked.includes(channel);
    }
  }

  $("alpha-device-start").disabled = busy || !d.canStart;
  for (const id of ["alpha-device-hold", "alpha-device-ease", "alpha-device-resume"]) $(id).disabled = busy || !ready || !d.running || !d.outputKnown;
  $("alpha-back-to-checks").disabled = busy || d.testing;
  $("alpha-finish").disabled = busy;
  const unknown = selectedLiveDevice && !d.outputKnown;
  const state = d.testing ? "Checking movement" : unknown ? "Output unconfirmed" : d.running ? "Output active" : "Output paused";
  note("alpha-dock-state", state);
  note("alpha-dock-note", unknown ? "Check the device and use its own Stop if needed." : d.running ? "Stop is always available." : "Start when you’re ready.");
  note("alpha-playback-status", d.reason || "Change your settings while paused, then press Start.");
  if (session.id) clip.setStartEnabled(exploring && timeline?.state === "recording");
}

async function deviceAction(action) {
  if (!device) return false;
  try { return await action(); }
  catch { note("alpha-device-status", "That action could not be confirmed. Check the device and try again.", true); return false; }
}

function updateFeedbackAccess() {
  const enabled = Boolean(session?.id && session.finished);
  for (const element of $("alpha-feedback-form").querySelectorAll("input,select,textarea")) element.disabled = !enabled || busy;
  $("alpha-feedback-save").disabled = !enabled || busy;
  $("alpha-review").hidden = !enabled;
  if (!session?.id && stage === "feedback") note("alpha-feedback-status", "Practice only. Start a recorded session if you want to send feedback.");
}

function setFeedback(feedback) {
  for (const control of $("alpha-feedback-form").elements) {
    if (control.name) control.value = feedback?.[control.name] ?? "";
  }
}

function showDetail(value) {
  detail = value;
  setFeedback(value.feedback);
  const range = $("alpha-review-time");
  range.max = String(value.session.lastEventAt ?? 0);
  range.value = String(value.session.lastEventAt ?? 0);
  const marks = $("alpha-review-moments");
  marks.replaceChildren();
  const events = (value.events ?? []).filter(event => event.type === "mark");
  for (const event of events) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.time = String(event.t);
    button.textContent = `${formatTime(event.t)} · ${MARKS[event.mark] ?? "Moment"}`;
    button.addEventListener("click", () => { range.value = String(event.t); renderReviewTime(); });
    marks.append(button);
  }
  if (!events.length) marks.textContent = "No moments marked. Use the time slider to choose a point.";
  renderReviewTime();
  renderAnnotations();
}

function renderReviewTime() {
  const t = Number($("alpha-review-time").value);
  $("alpha-review-time-label").value = formatTime(t);
  const label = number => Number.isInteger(number) ? `${number}/20` : "unconfirmed";
  const outputs = (detail?.events ?? []).filter(event => event.type === "output" && event.t <= t);
  const latest = outputs.at(-1);
  const values = latest?.channels;
  note("alpha-review-state", values ? `${latest.stage === "simulated" ? "Simulated" : "Latest recorded request"} · vibration ${label(values.vibrate)} · flexing ${label(values.fingering)}` : "No output recorded at this time.");
  for (const button of $("alpha-review-moments").querySelectorAll("button")) button.setAttribute("aria-pressed", String(Number(button.dataset.time) === t));
}

function renderAnnotations() {
  const list = $("alpha-annotations");
  list.replaceChildren();
  for (const annotation of detail?.annotations ?? []) {
    const li = document.createElement("li");
    const label = document.createElement("strong");
    const text = document.createElement("p");
    label.textContent = `Approx. ${formatTime(annotation.t)}`;
    text.textContent = annotation.text;
    li.append(label, text);
    list.append(li);
  }
}

async function completeSave() {
  if (!session?.id || session.finished || busy) return;
  const current = session;
  busy = true;
  renderRecord();
  note("alpha-feedback-status", "Saving the timeline…");
  try {
    const saved = !timeline || await timeline.flush();
    if (!saved && Date.now() < timeline.expiresAt) throw new Error("The timeline has pending events. Use Retry saving to continue.");
    const response = await post(`${sessionPath(current.id)}/finish`, {});
    if (current !== session) return;
    if (response.session?.id !== current.id || response.session?.state !== "finished") throw new Error("Session completion could not be confirmed.");
    current.finished = true;
    timeline?.destroy();
    timeline = null;
    clip.setShareEnabled(true);
    note("alpha-feedback-status", saved ? "Timeline saved. Add any feedback you’d like to share." : "The recording window ended before every event was saved. You can still add feedback to the retained timeline.");
    try { showDetail(await get(sessionPath(current.id))); }
    catch { note("alpha-annotation-status", "The timeline preview could not load. You can reopen it from My sessions.", true); }
  } catch (error) {
    if (current === session) note("alpha-feedback-status", error.message, true);
  } finally {
    busy = false;
    renderRecord();
    updateFeedbackAccess();
  }
}

async function finishStudy() {
  if (!session || busy) return;
  const current = session;
  busy = true;
  renderDevice();
  clip.stop();
  clip.setStartEnabled(false);
  emit({type: "mark", mark: "finished"});
  const liveDevice = session.mode === "live" && selectedLiveDevice;
  await deviceAction(() => (device.stopAndWait ?? device.stop)());
  if (current !== session) return;
  showStage("feedback");
  if (liveDevice) {
    note("alpha-stop-warning", "Check that your Flexer has stopped before continuing. If output continues, stop it in Lovense Remote or on the device.", true);
    $("alpha-stop-warning").hidden = false;
  }
  timeline?.close();
  current.finishing = true;
  teardownDevice();
  busy = false;
  if (current.id) await completeSave();
  else updateFeedbackAccess();
}

async function listHistory() {
  if (busy || !account) return;
  const dialog = $("alpha-history");
  const list = $("alpha-history-list");
  list.replaceChildren();
  note("alpha-history-status", "Loading your sessions…");
  dialog.showModal();
  try {
    const {sessions} = await get("/sessions");
    for (const row of sessions) {
      const li = document.createElement("li");
      const copy = document.createElement("div");
      const label = document.createElement("strong");
      const info = document.createElement("p");
      const button = document.createElement("button");
      label.textContent = row.mode === "simulator" ? "Simulator session" : "Flexer session";
      info.className = "note";
      info.textContent = `${formatDate(row.createdAt)} · ${row.state === "finished" ? "Complete" : "Unfinished"}`;
      button.type = "button";
      button.textContent = "Open session";
      button.addEventListener("click", () => openPastSession(row));
      copy.append(label, info);
      li.append(copy, button);
      list.append(li);
    }
    note("alpha-history-status", sessions.length ? "Your retained recordings and reflections." : "There are no recorded sessions yet.");
  } catch (error) { note("alpha-history-status", error.message, true); }
}

async function openPastSession(row) {
  if (busy) return;
  busy = true;
  try {
    const data = await get(sessionPath(row.id));
    session = {id: row.id, mode: row.mode, finished: data.session.state === "finished", finishing: false};
    $("alpha-history").close();
    setAccount(account);
    showStage("feedback", {record: false});
    showDetail(data);
  } catch (error) { note("alpha-history-status", error.message, true); }
  finally { busy = false; updateFeedbackAccess(); }
  if (session && !session.finished) await completeSave();
}

async function signOut() {
  if (busy || !account) return;
  busy = true;
  $("alpha-logout").disabled = true;
  clip.setReady(false);
  const liveDevice = session?.mode === "live" && selectedLiveDevice;
  await deviceAction(() => (device.stopAndWait ?? device.stop)());
  timeline?.pause();
  const saved = !timeline?.status().pending || await Promise.race([
    timeline.flush(), new Promise(resolve => setTimeout(() => resolve(false), 1500)),
  ]);
  try {
    await post("/logout", {});
    account = null;
    resetStudy();
    note("alpha-login-status", saved ? "Signed out." : "Signed out. Some pending timeline changes could not be confirmed.");
    if (liveDevice) note("alpha-global-status", "Check that your Flexer has stopped. Use Lovense Remote or the device if needed.", true);
    focusHeading("alpha-login-title");
  } catch (error) { note("alpha-global-status", "Sign-out was not confirmed. Output is paused. Try signing out again.", true); }
  finally { busy = false; $("alpha-logout").disabled = false; updateWelcome(); renderDevice(); }
}

$("alpha-theme").addEventListener("click", () => {
  if (deviceState?.running || deviceState?.testing) void deviceAction(() => device.stop());
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("alpha-theme").setAttribute("aria-checked", String(dark));
});

$("alpha-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  const password = $("alpha-password");
  try {
    note("alpha-login-status", "Signing in…");
    const result = await post("/login", {username: $("alpha-username").value.trim(), password: password.value});
    password.value = "";
    const value = result.authenticated === true && result.consentVersion ? result : await get("/auth");
    if (value.authenticated !== true) throw new Error("Sign-in could not be confirmed.");
    setAccount(value);
    form.reset();
    $("alpha-adult").checked = false;
    focusHeading("alpha-welcome-title");
  } catch (error) { password.value = ""; note("alpha-login-status", error.message, true); }
  finally { busy = false; submit.disabled = false; updateWelcome(); }
});

$("alpha-adult").addEventListener("change", updateWelcome);
$("alpha-consent-start").addEventListener("click", () => void startStudy(true));
$("alpha-unrecorded-start").addEventListener("click", () => void startStudy(false));
$("alpha-logout").addEventListener("click", () => void signOut());
$("alpha-history-open").addEventListener("click", () => void listHistory());
$("alpha-history-close").addEventListener("click", () => $("alpha-history").close());
$("alpha-record-pause").addEventListener("click", () => {
  clip.stop();
  clip.setStartEnabled(false);
  timeline?.pause();
});
$("alpha-record-resume").addEventListener("click", () => { timeline?.resume(); renderDevice(); });
$("alpha-record-retry").addEventListener("click", () => session?.finishing ? void completeSave() : void timeline?.flush());
$("alpha-record-withdraw").addEventListener("click", () => {
  clip.stop();
  clip.setStartEnabled(false);
  void deviceAction(() => device.stop());
  note("alpha-withdraw-status", "");
  $("alpha-withdraw").showModal();
});
$("alpha-withdraw-cancel").addEventListener("click", () => { $("alpha-withdraw").close(); renderDevice(); });
$("alpha-withdraw-confirm").addEventListener("click", async () => {
  if (busy || !session?.id) return;
  busy = true;
  $("alpha-withdraw-confirm").disabled = true;
  const current = session;
  clip.setReady(false);
  timeline?.pause();
  try {
    const value = await post(`${sessionPath(current.id)}/withdraw`, {confirm: true});
    if (!value.ok) throw new Error("Deletion could not be confirmed.");
    resetStudy();
    note("alpha-global-status", "Study session deleted.");
    focusHeading("alpha-welcome-title");
  } catch (error) { note("alpha-withdraw-status", error.message, true); }
  finally { busy = false; $("alpha-withdraw-confirm").disabled = false; updateWelcome(); }
});

$("alpha-device-connect").addEventListener("click", () => deviceAction(() => device.connect(session.mode)));
$("alpha-device-refresh").addEventListener("click", () => deviceAction(() => device.refresh()));
$("alpha-device-select").addEventListener("change", renderDevice);
$("alpha-device-select-confirm").addEventListener("click", () => deviceAction(() => device.select($("alpha-device-select").value)));
$("alpha-device-disconnect").addEventListener("click", () => deviceAction(() => device.disconnect()));
$("alpha-verify-continue").addEventListener("click", async () => {
  if (!device || !deviceState.verifiedChannels.length) return;
  const selected = deviceState.supportsCombined ? deviceState.verifiedChannels : deviceState.verifiedChannels.slice(0, 1);
  if (await deviceAction(() => device.choose(selected)) !== false && deviceState?.activeChannels.length) showStage("controls");
});
$("alpha-back-to-checks").addEventListener("click", async () => {
  clip.stop();
  await deviceAction(() => device.stop());
  if (session) showStage("connect");
});
for (const [id, action] of Object.entries({
  "alpha-device-start": "start", "alpha-device-hold": "hold", "alpha-device-ease": "easeOff",
  "alpha-device-resume": "resume", "alpha-device-stop": "stop",
})) $(id).addEventListener("click", () => deviceAction(() => device[action]()));
$("alpha-finish").addEventListener("click", () => void finishStudy());
for (const button of document.querySelectorAll("[data-alpha-mark]")) button.addEventListener("click", () => {
  if (busy) return;
  const mark = button.dataset.alphaMark;
  const captured = emit({type: "mark", mark});
  const message = captured ? `${MARKS[mark]} marked at ${formatTime(timeline.elapsed())}.` : "Recording is off or paused.";
  note("alpha-mark-status", message);
  if (mark === "climax") note("alpha-dock-note", message);
});

$("alpha-feedback-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !session?.id || !session.finished) return;
  const values = {};
  for (const input of event.currentTarget.elements) {
    if (input.name && input.value.trim()) values[input.name] = input.type === "number" ? Number(input.value) : input.value.trim();
  }
  const current = session;
  busy = true;
  updateFeedbackAccess();
  try {
    const value = await post(`${sessionPath(current.id)}/feedback`, values);
    if (!value.feedback) throw new Error("Feedback save could not be confirmed.");
    note("alpha-feedback-status", "Feedback saved. Thank you for sharing what worked for you.");
  } catch (error) { note("alpha-feedback-status", error.message, true); }
  finally { busy = false; updateFeedbackAccess(); }
});

$("alpha-review-time").addEventListener("input", renderReviewTime);
$("alpha-annotation-peak").addEventListener("click", () => {
  const field = $("alpha-annotation");
  const text = "I reached my desired result here.";
  if (!field.value.includes(text)) field.value = `${field.value.trim()}\n${text}`.trim().slice(0, field.maxLength);
  field.focus();
});
$("alpha-annotation-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !session?.finished || !detail) return;
  const text = $("alpha-annotation").value.trim();
  if (!text) return;
  const button = event.currentTarget.querySelector("button[type=submit]");
  busy = true;
  button.disabled = true;
  try {
    const value = await post(`${sessionPath()}/annotations`, {t: Number($("alpha-review-time").value), text});
    if (!value.annotation) throw new Error("Note save could not be confirmed.");
    const annotations = detail.annotations ??= [];
    if (!annotations.some(annotation => annotation.id === value.annotation.id)) annotations.push(value.annotation);
    $("alpha-annotation").value = "";
    renderAnnotations();
    note("alpha-annotation-status", "Timestamped note saved.");
  } catch (error) { note("alpha-annotation-status", error.message, true); }
  finally { busy = false; button.disabled = false; }
});

$("alpha-back-to-start").addEventListener("click", () => {
  if (busy) return;
  if (session?.id && !session.finished) {
    note("alpha-feedback-status", "Your timeline has unsaved changes. Retry saving or delete this session before starting another.", true);
    return;
  }
  resetStudy();
  focusHeading("alpha-welcome-title");
});

document.addEventListener("visibilitychange", () => {
  emit({type: "lifecycle", event: document.hidden ? "hidden" : "visible"});
  if (document.hidden) clip.stop();
});

setInterval(() => {
  if (account && Date.now() >= account.expiresAt && !busy) {
    account = null;
    resetStudy();
    note("alpha-login-status", "Your sign-in expired. Sign in again to continue.", true);
    return;
  }
  if (!timeline || session?.finishing) return;
  if (Date.now() >= timeline.expiresAt && !busy) { void finishStudy(); return; }
  if (timeline.status().pending && Date.now() - lastSaveAttempt >= (timeline.error ? 8_000 : 1_000)) {
    lastSaveAttempt = Date.now();
    void timeline.flush();
  }
}, 500);

get("/auth").then(setAccount).catch(error => {
  setAccount(null);
  note("alpha-login-status", error.message, true);
});
