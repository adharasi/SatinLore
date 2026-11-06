import {AlphaTimeline} from "./alpha-timeline.mjs";
import {createAlphaDevice} from "./alpha-device.mjs";
import {captureAlphaScreen} from "./alpha-screen.mjs";
import {createAlphaMovementView} from "./alpha-movement-view.mjs";
import {ALPHA_TOY_PROFILES, channelLabel, channelMaximum, getToyProfile} from "./devices/toy-profiles.mjs";

const $ = id => document.getElementById(id);
const API = "/alpha/api/alpha";
const MOVEMENTS = {
  vibrate: {feedback: "vibration", description: "Adjust the strength and rhythm of the vibration.", check: "It vibrated briefly, then stopped."},
  fingering: {feedback: "flexing", description: "Adjust how strongly the tip flexes.", check: "The tip flexed briefly, then stopped."},
  rotate: {feedback: "rotation", description: "Adjust how fast the moving part turns.", check: "It turned briefly, then stopped."},
  thrusting: {feedback: "thrusting", description: "Adjust the pace of the forward-and-back movement.", check: "It moved forward and back briefly, then stopped."},
  oscillate: {feedback: "oscillation", description: "Adjust the pace of the side-to-side movement.", check: "It moved side to side briefly, then stopped."},
  pump: {feedback: "pumping", description: "Try the simulator’s three pump levels.", check: "The pump level rose briefly, then returned to zero."},
  suction: {feedback: "suction", description: "Adjust the strength and rhythm of the suction.", check: "The suction started briefly, then stopped."},
};
const MARKS = {good: "Good moment", tooMuch: "Too much", change: "Wanted a change", climax: "Climax", finished: "Finished"};
const STAGES = {
  connect: ["PHASE 01 · DEVICE SETUP", "Connect your toy", "Pair your Lovense toy, then check each movement you’d like to try."],
  controls: ["PHASE 02 · EXPLORE", "Find your settings", "Explore the levels and rhythms for the movements you checked."],
  feedback: ["PHASE 03 · REFLECT", "What would you choose again?", "Tell us what felt right and where setup or controls could be easier."],
};

let account = null;
let session = null;
let timeline = null;
let device = null;
let deviceState = null;
let deviceGeneration = 0;
let stage = "connect";
let busy = false;
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

function focusHeading(id) {
  $(id).focus({preventScroll: true});
  window.scrollTo({top: 0, behavior: "instant"});
}

async function request(path, {method = "GET", body, signal, headers = {}, timeout = 10_000, keepalive = false} = {}) {
  const deadline = AbortSignal.timeout(timeout);
  const response = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store", redirect: "error", keepalive,
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
function post(path, value, signal, keepalive = false) {
  return request(`${API}${path}`, {method: "POST", body: JSON.stringify(value), signal, keepalive, headers: {"Content-Type": "application/json"}});
}

function sessionPath(id = session?.id) { return `/sessions/${encodeURIComponent(id)}`; }
function emit(event) { return timeline?.record(event) === true; }

function currentScreen() {
  if (timeline?.state !== "recording" || !session || $("alpha-study").hidden) return null;
  return stage === "connect" && deviceState?.selectedId ? "verify" : stage;
}

const screenCapture = captureAlphaScreen({currentScreen, record: emit});
const movementPreview = createAlphaMovementView($("alpha-movement-preview"));

function setAccount(value) {
  account = value?.authenticated === true ? value : null;
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

const selectedMode = () => document.querySelector("input[name='alpha-mode']:checked").value;
const alphaProfile = model => getToyProfile(model, {alpha: true});
const simulatorProfile = () => alphaProfile($("alpha-simulator-model").value);

function updateWelcome() {
  const simulator = selectedMode() === "simulator";
  const profile = simulator ? simulatorProfile() : null;
  $("alpha-simulator-picker").hidden = !simulator;
  $("alpha-simulator-model").disabled = busy || !simulator;
  $("alpha-simulator-model-note").textContent = profile ? profile.simChannels.map(channelLabel).join(" · ") : "";
  for (const radio of $("alpha-mode").querySelectorAll("input")) radio.disabled = busy;
  const disabled = busy || !account || !$("alpha-adult").checked || simulator && !profile;
  $("alpha-consent-start").disabled = disabled || !account?.consentVersion;
  $("alpha-unrecorded-start").disabled = disabled;
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
  movementPreview.update(null);
  previousChannels = previousToys = "";
  selectedLiveDevice = false;
  $("alpha-device-qr-image").removeAttribute("src");
  $("alpha-verification-movements").replaceChildren();
  $("alpha-movement-cards").replaceChildren();
}

function resetStudy() {
  teardownDevice();
  timeline?.destroy();
  timeline = session = null;
  screenCapture.reset();
  $("alpha-stop-warning").hidden = true;
  $("alpha-feedback-form").reset();
  $("alpha-annotation-form").reset();
  clearFeedbackErrors();
  for (const id of ["alpha-start-status", "alpha-mark-status", "alpha-feedback-status", "alpha-annotation-status"]) note(id, "");
  setAccount(account);
}

function showStage(next, {focus = true} = {}) {
  stage = next;
  emit({type: "step", step: next === "connect" && deviceState?.selectedId ? "verify" : next});
  for (const key of Object.keys(STAGES)) $("alpha-progress-" + key).removeAttribute("aria-current");
  $("alpha-progress-" + next).setAttribute("aria-current", "step");
  const [kicker, title, description] = STAGES[next];
  $("alpha-study-kicker").textContent = kicker;
  const simulator = next === "connect" && session?.mode === "simulator";
  $("alpha-study-title").textContent = simulator ? `Connect the ${alphaProfile(session.model)?.label ?? "device"} simulator` : title;
  $("alpha-study-intro").textContent = simulator ? "Select the simulator and check each movement you’d like to try." : description;
  $("alpha-device-panel").hidden = next === "feedback";
  $("alpha-marks").hidden = next !== "controls";
  $("alpha-peak").hidden = next !== "controls";
  $("alpha-study-actions").hidden = next === "feedback";
  $("alpha-feedback").hidden = next !== "feedback";
  if (next === "feedback") renderFeedbackMovements();
  renderDevice();
  renderRecord();
  updateFeedbackAccess();
  if (focus) focusHeading("alpha-study-title");
  screenCapture.frame();
}

async function startStudy(recorded) {
  if (busy || !account || !$("alpha-adult").checked) return;
  const mode = selectedMode();
  const model = mode === "simulator" ? simulatorProfile()?.id : null;
  if (mode === "simulator" && !model) return;
  busy = true;
  updateWelcome();
  const currentAccount = account;
  try {
    let remote = null;
    if (recorded) {
      note("alpha-start-status", "Starting your study session…");
      if (!startAttempt || startAttempt.mode !== mode || startAttempt.model !== model || startAttempt.account !== account) {
        startAttempt = {mode, model, account, key: crypto.randomUUID()};
      }
      remote = await post("/sessions", {mode, ...(model ? {model} : {}), consentVersion: account.consentVersion, idempotencyKey: startAttempt.key});
      if (typeof remote.id !== "string" || !Number.isSafeInteger(remote.seq) || !Number.isSafeInteger(remote.expiresAt)) {
        throw new Error("Data collection could not be started.");
      }
      startAttempt = null;
    }
    if (account !== currentAccount) return;
    session = {id: remote?.id ?? null, mode, model, reviewedDevice: null, finished: false, sealing: false, marks: [], annotations: [], controlDuration: 0};
    if (remote) {
      timeline = new AlphaTimeline({session: remote, append: (id, body, signal) => post(`${sessionPath(id)}/events`, body, signal, true), onChange: renderRecord});
      emit({type: "step", step: "welcome"});
    }
    const generation = ++deviceGeneration;
    device = createAlphaDevice({
      ...(model ? {model} : {}),
      authorize: checkAccess,
      onChange(value) {
        if (generation !== deviceGeneration) return;
        const wasSelected = Boolean(deviceState?.selectedId);
        deviceState = value;
        if (value.selectedId) {
          const prior = session.reviewedDevice?.id === value.selectedId ? session.reviewedDevice.channels : [];
          session.reviewedDevice = {
            id: value.selectedId,
            channels: [...new Set([...prior, ...(value.verifiedChannels ?? [])])],
            supportsCombined: value.supportsCombined === true,
          };
        }
        if (Boolean(value.selectedId) !== wasSelected && stage === "connect") emit({type: "step", step: value.selectedId ? "verify" : "connect"});
        if (stage === "controls" && !value.selectedId) showStage("connect");
        else renderDevice();
        screenCapture.frame();
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
  const label = session?.finished && session?.id ? "Session data saved" :
    capture?.state === "recording" ? "Collecting study data" :
      capture?.state === "closing" ? "Saving session data" : capture?.limitReached ? "Data limit reached" :
        session?.id ? "Data collection interrupted" : "Practice without data collection";
  $("alpha-record-strip").dataset.state = capture?.state ?? "off";
  note("alpha-record-label", label);
  note("alpha-record-note", capture?.error || (session?.id ? "Only the research team can review this session." : "Your actions and answers stay on this page."));
  $("alpha-record-retry").hidden = !session?.id || session.finished || !(session.sealing || capture?.error && !capture.limitReached);
  $("alpha-record-retry").disabled = busy;
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
    const name = channelLabel(channel);
    const verification = $("alpha-verify-template").content.firstElementChild.cloneNode(true);
    verification.dataset.channel = channel;
    verification.querySelector("h4").textContent = name;
    verification.querySelector("[data-check-description]").textContent = movement.check;
    const test = verification.querySelector("button");
    test.textContent = `Test ${name.toLowerCase()}`;
    test.addEventListener("click", () => deviceAction(() => device.test(channel)));
    verification.querySelector("input").addEventListener("change", event => {
      if (event.target.checked) device.confirmTest(channel);
      renderDevice();
    });
    verify.append(verification);

    const card = $("alpha-movement-template").content.firstElementChild.cloneNode(true);
    card.dataset.channel = channel;
    card.querySelector("h4").textContent = name;
    card.querySelector(".alpha-movement-heading .note").textContent = movement.description;
    const toggle = card.querySelector("[data-movement-toggle]");
    toggle.setAttribute("aria-label", `Use ${name.toLowerCase()}`);
    toggle.addEventListener("change", async () => {
      const active = deviceState.activeChannels;
      const chosen = toggle.checked ? [...new Set([...active, channel])] : active.filter(value => value !== channel);
      const next = deviceState.supportsCombined ? chosen : [channel];
      if (next.length) await deviceAction(() => device.choose(next));
      renderDevice();
    });
    for (const control of card.querySelectorAll("[data-setting]")) {
      const setting = control.dataset.setting;
      const label = control.closest("label");
      if (label) control.setAttribute("aria-label", `${name} ${label.firstChild.textContent.trim().toLowerCase()}`);
      control.addEventListener(control.type === "range" ? "input" : "change", () => {
        device.set(channel, setting, control.type === "range" ? Number(control.value) : control.value);
        renderDevice();
      });
    }
    cards.append(card);
  }
}

function renderDevice() {
  if (!session || !deviceState || stage === "feedback") {
    movementPreview.update(null);
    return;
  }
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
  movementPreview.update(verifying ? d : exploring ? {...d, channels: checked} : null);
  const selectedToy = d.toys?.find(toy => toy.id === d.selectedId);
  const profile = connected || simulator ? alphaProfile(d.model ?? selectedToy?.model ?? session.model) : null;
  const deviceLabel = (connected ? d.deviceLabel ?? selectedToy?.label : null) ?? profile?.label;
  $("alpha-device-mode").textContent = [deviceLabel, simulator ? "Simulator" : "Lovense Remote"].filter(Boolean).join(" · ").toUpperCase();
  $("alpha-device-title").textContent = verifying ? "Check your device" : exploring ? "Your movements" : simulator ? "Connect the simulator" : "Connect your toy";
  $("alpha-connection-badge").textContent = connected ? "Device selected" : connecting ? "Connecting" : d.toys?.length ? "Choose a device" : d.qrUrl ? "Scan the code" : "Disconnected";
  note("alpha-device-status", d.connectionMessage || "");
  $("alpha-pairing").hidden = verifying || exploring;
  $("alpha-live-instructions").hidden = simulator;
  $("alpha-simulator-instructions").hidden = !simulator;
  $("alpha-device-connect").disabled = busy || connecting || d.busy;
  $("alpha-device-connect").textContent = connecting ? "Connecting…" : awaiting ? "Start pairing again" : "Connect";
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
  $("alpha-verification-note").textContent = simulator ? "Watch each movement start and stop on screen before you tick the box." : "Set your toy down. Test one movement at a time, and tick the box only if it moved briefly and then stopped.";
  const capabilityNote = !simulator && connected ? profile?.physicalNotes || "This connection controls only the movements shown below." : "";
  $("alpha-capability-note").hidden = !capabilityNote;
  note("alpha-capability-note", capabilityNote);
  $("alpha-combined-guide").hidden = !d.supportsCombined || checked.length < 2;
  $("alpha-controls-guidance").textContent = checked.length > 1 && !d.supportsCombined ?
    "This connection runs one movement at a time. Choose a movement, set a low level, then press Start." :
    "Set a low starting level for each movement you want to try, then press Start.";
  $("alpha-verify-continue").disabled = busy || !ready || !checked.length;
  $("alpha-device-disconnect").disabled = busy;

  const channelSignature = channels.join(",");
  if (channelSignature !== previousChannels) {
    previousChannels = channelSignature;
    buildDeviceRows(channels);
  }
  $("alpha-verification-movements").dataset.count = String(channels.length);
  $("alpha-movement-cards").dataset.count = String(checked.length);
  for (const row of $("alpha-verification-movements").children) {
    const channel = row.dataset.channel;
    const passed = checked.includes(channel);
    const last = d.lastTest?.channel === channel;
    row.querySelector("p").textContent = passed ? "Ready to use on the next page." : last ? "Tick the box if the movement started and stopped." : "This runs briefly at a low level.";
    row.querySelector("button").disabled = busy || !ready;
    row.querySelector("label").hidden = !passed && (!last || !ready);
    const confirmation = row.querySelector("input");
    confirmation.checked = passed;
    confirmation.disabled = passed || busy || !ready;
  }

  const output = d.output ?? {};
  for (const card of $("alpha-movement-cards").children) {
    const channel = card.dataset.channel;
    card.hidden = !checked.includes(channel);
    const settings = d.settings?.[channel];
    if (!settings) continue;
    const selected = active.includes(channel);
    const toggle = card.querySelector("[data-movement-toggle]");
    toggle.type = d.supportsCombined ? "checkbox" : "radio";
    toggle.name = d.supportsCombined ? "" : "alpha-active-movement";
    toggle.closest("label").hidden = checked.length < 2;
    toggle.checked = selected;
    toggle.disabled = busy || !ready || !checked.includes(channel) || (d.supportsCombined && selected && active.length === 1);
    card.querySelector(".alpha-output span").textContent = simulator ? "Simulator level" : "Level sent to device";
    const maximum = channelMaximum(channel);
    card.querySelector(".alpha-output output").textContent = output[channel] === null || output[channel] === undefined ? "Not confirmed" : `${output[channel]} / ${maximum}`;
    for (const control of card.querySelectorAll("[data-setting]")) {
      const field = control.dataset.setting;
      if (control.type === "range") {
        control.max = String(field === "maximum" ? maximum : settings.maximum);
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
  const state = d.testing ? "Checking movement" : unknown ? "Check your toy" : d.running ? "Movements active" : "Movements paused";
  note("alpha-dock-state", state);
  note("alpha-dock-note", unknown ? "Check the device and use its own Stop if needed." : d.running ? "Stop is always available." : "Start when you’re ready.");
  note("alpha-playback-status", d.reason || "Change your settings while paused, then press Start.");
}

async function deviceAction(action) {
  if (!device) return false;
  try { return await action(); }
  catch {
    note("alpha-device-status", session?.mode === "simulator" ? "Reconnect the simulator and try again." :
      "Check your toy and try again. If it keeps moving, stop it in Lovense Remote or on the device.", true);
    return false;
  }
}

function renderFeedbackMovements() {
  const reviewed = session?.reviewedDevice;
  const channels = (reviewed?.channels ?? []).filter(channel => Object.hasOwn(MOVEMENTS, channel));
  const preferred = $("alpha-feedback-form").elements.namedItem("preferredMovement");
  const options = [new Option("Skip", ""), ...channels.map(channel => new Option(channelLabel(channel), MOVEMENTS[channel].feedback))];
  if (reviewed?.supportsCombined && channels.length > 1) options.push(new Option("Movements together", "together"));
  options.push(new Option("None of these", "neither"));
  preferred.replaceChildren(...options);
  preferred.closest(".alpha-field").hidden = !channels.length;
  const fields = channels.map(channel => {
    const label = channelLabel(channel).toLowerCase();
    const field = $("alpha-feedback-maximum-template").content.firstElementChild.cloneNode(true);
    const input = field.querySelector("input");
    input.name = MOVEMENTS[channel].feedback + "Maximum";
    input.max = String(channelMaximum(channel));
    input.placeholder = `0–${input.max}`;
    field.querySelector(".alpha-field-name").textContent = `Preferred ${label} maximum`;
    field.querySelector("summary").setAttribute("aria-label", `About preferred ${label} maximum`);
    field.querySelector(".alpha-tip p").textContent = `What’s the highest ${label} level you’d be comfortable using again? You can skip this question.`;
    return field;
  });
  $("alpha-feedback-maximums").replaceChildren(...fields);
}

function updateFeedbackAccess() {
  const enabled = Boolean(session?.id);
  for (const element of $("alpha-feedback-form").querySelectorAll("input,select,textarea")) element.disabled = !enabled || busy;
  $("alpha-feedback-save").disabled = !enabled || busy;
  $("alpha-review").hidden = !enabled;
  if (!enabled && stage === "feedback") note("alpha-feedback-status", "This was a practice session. To share feedback, allow data collection when you start a session.");
}

const requiredFeedback = {minimum: "Continuous stimulation", connectionEase: "Connecting the device", easeOfUse: "Using the controls"};

function clearFieldError(control) {
  control.removeAttribute("aria-invalid");
  document.getElementById(`alpha-error-${control.name}`)?.remove();
  const descriptions = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== `alpha-error-${control.name}`);
  if (descriptions.length) control.setAttribute("aria-describedby", descriptions.join(" "));
  else control.removeAttribute("aria-describedby");
}

function clearFeedbackErrors() {
  for (const control of $("alpha-feedback-form").querySelectorAll("[aria-invalid]")) clearFieldError(control);
}

function feedbackValues(form) {
  const values = {};
  const invalid = [];
  clearFeedbackErrors();
  for (const input of form.elements) {
    if (!input.name || input.disabled || input.closest("[hidden]")) continue;
    const raw = input.value.trim();
    const name = requiredFeedback[input.name] ?? input.labels?.[0]?.textContent.trim() ?? input.name;
    let message = "";
    if (input.validity.badInput || (raw && !input.validity.valid)) {
      message = input.type === "number" ? `Enter a whole number from ${input.min} to ${input.max}.` : "Check this answer.";
    } else if (!raw && input.required) {
      message = input.type === "number" ? `Enter a rating from ${input.min} to ${input.max}.` : "Choose an answer.";
    }
    if (message) {
      input.setAttribute("aria-invalid", "true");
      const error = document.createElement("span");
      error.className = "alpha-field-error";
      error.id = `alpha-error-${input.name}`;
      error.textContent = message;
      input.after(error);
      input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
      invalid.push({input, name});
    } else if (raw) values[input.name] = input.type === "number" ? Number(raw) : raw;
  }
  if (!invalid.length) return values;
  note("alpha-feedback-status", `Check these answers: ${invalid.map(field => field.name).join(", ")}.`, true);
  invalid[0].input.focus();
  return null;
}

function prepareAnnotations() {
  const range = $("alpha-review-time");
  const capture = timeline?.status();
  const latest = capture?.limitReached ? Math.min(capture.lastSavedTime, session.controlDuration) : session.controlDuration;
  range.max = range.value = String(latest);
  const marks = $("alpha-review-moments");
  marks.replaceChildren();
  for (const event of session.marks) {
    if (event.t > latest) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.time = String(event.t);
    button.textContent = `${formatTime(event.t)} · ${MARKS[event.mark] ?? "Moment"}`;
    button.addEventListener("click", () => { range.value = String(event.t); renderReviewTime(); });
    marks.append(button);
  }
  if (!marks.childElementCount) marks.textContent = "Use the time slider to choose a point.";
  renderReviewTime();
  renderAnnotations();
}

function renderReviewTime() {
  const t = Number($("alpha-review-time").value);
  $("alpha-review-time-label").value = formatTime(t);
  for (const button of $("alpha-review-moments").querySelectorAll("button")) button.setAttribute("aria-pressed", String(Number(button.dataset.time) === t));
}

function renderAnnotations() {
  const list = $("alpha-annotations");
  list.replaceChildren();
  for (const annotation of session?.annotations ?? []) {
    const li = document.createElement("li");
    const label = document.createElement("strong");
    const text = document.createElement("p");
    label.textContent = `Approx. ${formatTime(annotation.t)}`;
    text.textContent = annotation.text;
    li.append(label, text);
    list.append(li);
  }
}

async function flushStudy() {
  const current = timeline;
  if (!current) return true;
  const saved = await current.flush();
  if (saved && current === timeline && !session?.sealing) current.resume();
  return saved;
}

async function completeSave() {
  if (!session?.id || session.finished) return true;
  if (busy) return false;
  const current = session;
  busy = true;
  updateFeedbackAccess();
  note("alpha-feedback-status", "Saving your session…");
  try {
    current.sealing = true;
    screenCapture.frame({force: true});
    timeline?.close();
    const saved = await flushStudy();
    if (!saved && !timeline.status().limitReached && Date.now() < timeline.expiresAt) throw new Error("Some changes are still waiting to save. Choose Retry saving.");
    const response = await post(`${sessionPath(current.id)}/finish`, {});
    if (current !== session) return false;
    if (response.session?.id !== current.id || response.session?.state !== "finished") throw new Error("We couldn’t confirm the session was saved.");
    current.finished = true;
    current.partial = !saved;
    timeline?.destroy();
    timeline = null;
    note("alpha-feedback-status", saved ? "Session saved." : "The session ended before every change could be saved.");
    return true;
  } catch (error) {
    if (current === session) note("alpha-feedback-status", error.message, true);
    return false;
  } finally {
    busy = false;
    renderRecord();
    updateFeedbackAccess();
  }
}

async function finishStudy() {
  if (!session || busy || stage === "feedback") return;
  const current = session;
  busy = true;
  renderDevice();
  emit({type: "mark", mark: "finished"});
  const liveDevice = current.mode === "live" && selectedLiveDevice;
  await deviceAction(() => (device.stopAndWait ?? device.stop)());
  if (current !== session) return;
  current.controlDuration = timeline?.lastTime ?? 0;
  if (liveDevice) {
    note("alpha-stop-warning", "Check that your toy has stopped. If it is still moving, stop it in Lovense Remote or on the device.", true);
    $("alpha-stop-warning").hidden = false;
  }
  teardownDevice();
  busy = false;
  showStage("feedback");
  prepareAnnotations();
}

async function signOut() {
  if (busy || !account) return;
  busy = true;
  $("alpha-logout").disabled = true;
  const liveDevice = session?.mode === "live" && selectedLiveDevice;
  await deviceAction(() => (device.stopAndWait ?? device.stop)());
  screenCapture.frame({force: true});
  timeline?.close();
  const saved = !timeline?.status().pending || await Promise.race([
    timeline.flush(), new Promise(resolve => setTimeout(() => resolve(false), 1500)),
  ]);
  try {
    if (saved && session?.id && !session.finished) await post(`${sessionPath()}/finish`, {}).catch(() => {});
    await post("/logout", {});
    account = null;
    resetStudy();
    note("alpha-login-status", saved ? "Signed out." : "Signed out. Some pending session changes could not be confirmed.");
    if (liveDevice) note("alpha-global-status", "Check that your toy has stopped. Use Lovense Remote or the device if needed.", true);
    focusHeading("alpha-login-title");
  } catch (error) { note("alpha-global-status", "Sign-out was not confirmed. Movements are paused. Try signing out again.", true); }
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
$("alpha-mode").addEventListener("change", updateWelcome);
$("alpha-simulator-model").replaceChildren(...ALPHA_TOY_PROFILES.map(profile => new Option(profile.pickerLabel, profile.id)));
$("alpha-simulator-model").value = "flexer";
$("alpha-simulator-model").addEventListener("change", updateWelcome);
$("alpha-consent-start").addEventListener("click", () => void startStudy(true));
$("alpha-unrecorded-start").addEventListener("click", () => void startStudy(false));
$("alpha-logout").addEventListener("click", () => void signOut());
$("alpha-record-retry").addEventListener("click", () => session?.sealing ? void completeSave() : void flushStudy());

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
  const time = timeline?.lastTime ?? 0;
  if (captured) session.marks.push({mark, t: time});
  const message = captured ? `${MARKS[mark]} marked at ${formatTime(time)}.` : session?.id ? "This moment could not be saved." : "Practice only. This moment won’t be saved.";
  note("alpha-mark-status", message);
  if (mark === "climax") note("alpha-dock-note", message);
});

$("alpha-feedback-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !session?.id) return;
  const values = feedbackValues(event.currentTarget);
  if (!values) return;
  busy = true;
  updateFeedbackAccess();
  try {
    const value = await post(`${sessionPath()}/feedback`, values);
    if (!value.feedback) throw new Error("Feedback save could not be confirmed.");
    note("alpha-feedback-status", "Feedback saved. Thank you for sharing what worked for you.");
  } catch (error) { note("alpha-feedback-status", error.message, true); }
  finally { busy = false; updateFeedbackAccess(); }
});

$("alpha-feedback-form").addEventListener("input", event => {
  if (event.target.hasAttribute("aria-invalid")) clearFieldError(event.target);
});

$("alpha-review-time").addEventListener("input", renderReviewTime);
$("alpha-annotation-peak").addEventListener("click", () => {
  const field = $("alpha-annotation");
  const text = "I climaxed around this time.";
  if (!field.value.includes(text)) field.value = `${field.value.trim()}\n${text}`.trim().slice(0, field.maxLength);
  field.focus();
});
$("alpha-annotation-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !session?.id) return;
  const text = $("alpha-annotation").value.trim();
  if (!text) { note("alpha-annotation-status", "Write a note before saving.", true); return; }
  const button = event.currentTarget.querySelector("button[type=submit]");
  busy = true;
  button.disabled = true;
  try {
    const saved = await flushStudy();
    const capture = timeline?.status();
    if (!saved && !capture?.limitReached) throw new Error("Your session data is still saving. Try saving the note again.");
    if (capture?.limitReached && Number($("alpha-review-time").value) > capture.lastSavedTime) {
      prepareAnnotations();
      throw new Error("Choose a time from the saved part of the session, then save the note again.");
    }
    const value = await post(`${sessionPath()}/annotations`, {t: Number($("alpha-review-time").value), text});
    if (!value.annotation) throw new Error("Note save could not be confirmed.");
    const annotations = session.annotations;
    if (!annotations.some(annotation => annotation.id === value.annotation.id)) annotations.push(value.annotation);
    $("alpha-annotation").value = "";
    renderAnnotations();
    note("alpha-annotation-status", "Timestamped note saved.");
  } catch (error) { note("alpha-annotation-status", error.message, true); }
  finally { busy = false; button.disabled = false; }
});

$("alpha-back-to-start").addEventListener("click", async () => {
  if (busy || !await completeSave()) return;
  const partial = session?.partial;
  resetStudy();
  if (partial) note("alpha-global-status", "Part of the session was saved before data collection ended.");
  focusHeading("alpha-welcome-title");
});

document.addEventListener("visibilitychange", () => {
  emit({type: "lifecycle", event: document.hidden ? "hidden" : "visible"});
  screenCapture.frame();
  if (document.hidden && timeline?.status().pending) void flushStudy();
});
window.addEventListener("pagehide", () => {
  if (timeline?.status().pending) void flushStudy();
});

setInterval(() => {
  if (account && Date.now() >= account.expiresAt && !busy) {
    account = null;
    resetStudy();
    note("alpha-login-status", "Your sign-in expired. Sign in again to continue.", true);
    return;
  }
  if (!timeline || session?.sealing) return;
  if (Date.now() >= timeline.expiresAt && !busy) {
    void (async () => {
      await finishStudy();
      await completeSave();
    })();
    return;
  }
  screenCapture.frame();
  if (timeline.status().pending && Date.now() - lastSaveAttempt >= (timeline.error ? 8_000 : 1_000)) {
    lastSaveAttempt = Date.now();
    void flushStudy();
  }
}, 500);

get("/auth").then(setAccount).catch(error => {
  setAccount(null);
  note("alpha-login-status", error.message, true);
});
