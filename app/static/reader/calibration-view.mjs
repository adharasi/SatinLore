import {DEFAULT_SIMULATOR_MAXIMUM, RHYTHMS} from "./calibration.mjs";

/** Drafts and explicit short checks for the movements on the selected toy. */
export const CALIBRATION_FIELDS = Object.freeze([
  {key: "maximum", label: "Maximum", hint: "The strongest level this movement can reach."},
  {key: "minimum", label: "Minimum", hint: "The floor when you use a background level."},
  {key: "background", label: "Background", hint: "The level for quieter parts of a story."},
  {key: "preferred", label: "Preferred level", hint: "A level you would like to return to."},
  {key: "recovery", label: "Ease off", hint: "The level when you choose Ease off. Zero stops output."},
]);

const FEATURES = Object.freeze({
  vibrate: {label: "Vibration", icon: "≋", description: "Change the vibration level and choose how much it varies with the story.", example: "A steady background, soft pulses or stronger changes."},
  fingering: {label: "Fingering / flexing", icon: "↶", description: "Flexer's moving arm creates a flexing motion. You can tune its level separately from vibration.", example: "Find a flexing level you like, then compare it with vibration."},
  rotate: {label: "Rotation", icon: "↻", description: "Change the level of the rotating movement exposed by this connection.", example: "Compare a slower level with a stronger one, one short test at a time."},
  thrusting: {label: "Thrusting", icon: "↕", description: "Change the level of the thrusting movement exposed by this connection.", example: "Test this movement separately from vibration. Stroke and heating are not controlled here."},
  oscillate: {label: "Oscillation", icon: "↔", description: "Change the level of the oscillating movement exposed by this connection.", example: "Try oscillation on its own before comparing it with vibration."},
});
const copy = value => JSON.parse(JSON.stringify(value));
const level = (value, fallback = 0) => Number.isInteger(value) && value >= 0 && value <= 20 ? value : fallback;

export function calibrationFeature(channel) { return FEATURES[channel] || null; }
export function calibrationDraft(value = {}, limit = 5) {
  const maximum = Math.min(level(limit, 5), level(value.maximum, Math.min(5, level(limit, 5))));
  const minimum = Math.min(maximum, level(value.minimum));
  return {minimum, background: Math.min(maximum, Math.max(minimum, level(value.background, Math.min(1, maximum)))),
    preferred: Math.min(maximum, Math.max(minimum, level(value.preferred, Math.min(2, maximum)))), maximum,
    recovery: Math.min(maximum, level(value.recovery)),
    gain: typeof value.gain === "number" && Number.isFinite(value.gain) && value.gain >= 0 && value.gain <= 2 ? Math.round(value.gain * 10) / 10 : 1,
    rhythm: RHYTHMS.includes(value.rhythm) ? value.rhythm : "steady"};
}

/** Selection expresses intent. A separate observed check qualifies each live movement. */
export function createCalibrationView({document = globalThis.document, mount,
  onTest = () => false, onConfirmTest = () => false, onStop = () => {},
  onChange = () => {}, onApply = () => false, onApplyChannels = null, onEnablePersonalRange = null,
  onModeChange = () => {}, onEvent = () => {}, onComplete = () => {}} = {}) {
  if (!document?.createElement || !mount) return {open() {}, update() {}, close() {}, interrupt() {}, destroy() {}, snapshot: () => ({active: false})};
  const make = (tag, id = "", text = "", className = "") => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (id, text, className = "") => {
    const node = make("button", id, text, className);
    node.setAttribute("type", "button");
    return node;
  };
  const option = (value, text) => {
    const node = make("option", "", text);
    node.value = value;
    return node;
  };
  const field = (text, control, readout) => {
    const wrap = make("div", "", "", "setup-field");
    const label = make("label", "", text);
    label.setAttribute("for", control.id);
    wrap.append(label, control);
    if (readout) wrap.append(readout);
    return wrap;
  };
  const range = (id, min, max, step = 1) => {
    const input = make("input", id);
    for (const [key, value] of Object.entries({type: "range", min, max, step})) input.setAttribute(key, String(value));
    return input;
  };
  const checkbox = (id, text) => {
    const input = make("input", id);
    input.setAttribute("type", "checkbox");
    const label = make("label", "", "", "setup-confirmation");
    label.setAttribute("for", id);
    label.append(input, make("span", "", text));
    return {input, label};
  };
  const output = input => {
    const node = make("output");
    node.setAttribute("for", input.id);
    return node;
  };
  const shell = make("section", "calibration-view", "", "calibration-view");
  shell.hidden = true;
  shell.setAttribute("aria-label", "Movement preferences");
  shell.dataset.betaControl = "calibration";
  const guidance = make("p", "calibration-guidance", "", "note");
  const continuity = make("select", "calibration-continuity");
  continuity.append(option("story", "Quiet passages can be still"), option("continuous", "Keep my background levels"));
  const liveOutput = make("output", "calibration-live-output", "", "calibration-live-output");
  liveOutput.setAttribute("aria-live", "polite");
  const cards = make("div", "calibration-movements", "", "calibration-movements");
  const status = make("p", "calibration-status", "", "note");
  status.setAttribute("role", "status");
  const apply = button("calibration-apply", "Use these settings", "primary");
  const skip = button("calibration-skip", "Skip for now");
  const applyNote = make("p", "calibration-apply-note", "", "note");
  apply.setAttribute("aria-describedby", applyNote.id);
  const actions = make("div", "", "", "calibration-navigation");
  actions.append(skip, apply);
  shell.append(guidance, field("During quieter passages", continuity), liveOutput, cards, status, applyNote, actions);
  mount.append(shell);

  let active = false, destroyed = false, context = {}, epoch = 0, busy = false;
  let drafts = {}, selected = new Set(), checked = new Set(), lastTest = null, readingMode = "story";
  let cardSignature = "", views = new Map();
  const available = () => Array.isArray(context.channels) ? [...new Set(context.channels.filter(name => Object.hasOwn(FEATURES, name)))] : [];
  const simulator = () => context.mode === "simulator";
  const canCombine = () => context.supportsCombined === true && available().length > 1 && typeof onApplyChannels === "function";
  const featureLabel = name => name === "oscillate" && simulator() ? "Oscillation · simulator" : FEATURES[name].label;
  const rangeGranted = name => context.personalRangeChannels?.includes?.(name) === true;
  const limit = name => simulator() || rangeGranted(name) ? 20 : 5;
  const initialDraft = (name, value) => calibrationDraft({
    maximum: simulator() ? level(context.ceiling, DEFAULT_SIMULATOR_MAXIMUM) : 5, ...value,
  }, limit(name));
  const draft = name => calibrationDraft(drafts[name], limit(name));
  const testLimit = name => Math.min(5, level(context.ceiling, 5), draft(name).maximum);
  const ready = () => context.connected === true && typeof context.selectedId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(context.selectedId) && !["error", "expired", "disconnected"].includes(context.connectionState);
  const stopped = () => context.output === 0 && context.outputKnown !== false && context.testing !== true;
  const stop = () => { try { onStop(); } catch { /* Parent owns transport recovery. */ } };
  const emit = (type, fields = {}) => { try { onEvent({type, ...fields}); } catch { /* Research is optional. */ } };
  const chosen = () => available().filter(name => selected.has(name));
  const checkedFrom = value => new Set(Array.isArray(value.verifiedChannels) ? value.verifiedChannels.filter(name => available().includes(name)) : []);
  const chooseDefaults = () => {
    const names = available();
    const primary = names.includes(context.channel) ? context.channel : names[0];
    return new Set(canCombine() ? names : primary ? [primary] : []);
  };
  const currentOperation = (token, id) => active && token === epoch && id === context.selectedId;
  const unchanged = (token, id) => currentOperation(token, id) && ready();

  function applyBlocker() {
    const names = chosen();
    if (!ready()) return "Connect and select a toy to use these settings.";
    if (!names.length) return "Choose at least one movement.";
    if (!simulator() && names.some(name => !checked.has(name))) return "Check each selected movement and confirm it stopped, or deselect it.";
    if (!simulator() && names.length > 1 && names.some(name => draft(name).maximum > 5) && names.some(name => !rangeGranted(name))) {
      return "For a combination above level 5, enable the range on each selected movement or lower its maximum.";
    }
    if (!stopped()) return "Wait until the movement stops.";
    return "";
  }

  function changeDraft(name, key, value) {
    if (!active || busy || !ready() || !available().includes(name)) return;
    const next = {...draft(name), [key]: value};
    if (["background", "preferred"].includes(key)) next.minimum = Math.min(next.minimum, value);
    drafts[name] = calibrationDraft(next, limit(name));
    if (key === "rhythm") emit("calibration_rhythm", {channel: name, rhythm: value});
    else if (key === "gain") emit("calibration_gain", {channel: name, value});
    else emit("calibration_adjust", {channel: name, field: key, value});
    status.textContent = "Draft updated. Nothing starts until you choose Start.";
    render();
  }

  function makeCard(name) {
    const section = make("section", "calibration-movement-" + name, "", "calibration-movement");
    const heading = make("h4", "calibration-title-" + name, featureLabel(name));
    section.setAttribute("aria-labelledby", heading.id);
    const use = checkbox("calibration-use-" + name, "Use " + FEATURES[name].label.toLowerCase() + " while reading");
    use.input.setAttribute("type", canCombine() ? "checkbox" : "radio");
    use.input.setAttribute("name", "calibration-movement");
    use.input.addEventListener("change", () => {
      if (!active || busy || !available().includes(name)) return;
      if (!canCombine()) selected = new Set([name]);
      else if (use.input.checked) selected.add(name);
      else selected.delete(name);
      status.textContent = "";
      render();
    });
    const sliders = make("div", "", "", "calibration-sliders");
    const fields = new Map();
    for (const {key, label, hint} of CALIBRATION_FIELDS) {
      const input = range("calibration-" + key + "-" + name, 0, 5);
      const value = output(input);
      const help = make("p", input.id + "-hint", hint, "note");
      const wrapper = field(label, input, value);
      input.setAttribute("aria-describedby", help.id);
      wrapper.append(help);
      input.addEventListener("input", () => {
        const raw = Number(input.value);
        const max = key === "maximum" ? limit(name) : draft(name).maximum;
        if (Number.isInteger(raw) && raw >= 0 && raw <= max) changeDraft(name, key, raw);
      });
      fields.set(key, {input, value});
      sliders.append(wrapper);
    }
    const rhythm = make("select", "calibration-rhythm-" + name);
    rhythm.append(option("scene", "Follow scene rhythm"), option("steady", "Steady"), option("gentle", "Gentle changes"), option("dynamic", "More variation"));
    rhythm.addEventListener("change", () => {
      if (RHYTHMS.includes(rhythm.value)) changeDraft(name, "rhythm", rhythm.value);
    });
    const gain = range("calibration-gain-" + name, 0, 2, .1);
    const gainValue = output(gain);
    gain.addEventListener("input", () => {
      const value = Number(gain.value);
      if (Number.isFinite(value) && value >= 0 && value <= 2) changeDraft(name, "gain", Math.round(value * 10) / 10);
    });
    sliders.append(field("Variation", rhythm), field("Story strength", gain, gainValue));

    const checkArea = make("div", "", "", "calibration-check");
    const checkStatus = make("p", "calibration-check-status-" + name, "", "note");
    const testLevel = range("calibration-test-level-" + name, 1, 5);
    testLevel.value = "1";
    const testReadout = output(testLevel);
    const testButton = button("calibration-test-" + name, "Test for 2 seconds");
    const confirmation = checkbox("calibration-confirm-" + name,
      simulator() ? "I saw the simulated level return to zero." : "I checked the movement and confirmed the toy stopped.");
    const enableRange = button("calibration-enable-range-" + name, "Enable this movement’s personal range");
    const ratings = make("div", "", "", "calibration-ratings");
    ratings.setAttribute("role", "group");
    ratings.setAttribute("aria-label", "Optional " + FEATURES[name].label.toLowerCase() + " rating");
    for (const [rating, label] of [["light", "Too light"], ["good", "Good for me"], ["strong", "Too much"]]) {
      const control = button("calibration-rating-" + rating + "-" + name, label);
      control.addEventListener("click", () => {
        if (!active || busy || lastTest?.name !== name || !lastTest.confirmed) return;
        emit("calibration_rating", {channel: name, field: "preferred", value: lastTest.level, rating});
        status.textContent = "Rating noted. It is shared only when beta recording is on.";
      });
      ratings.append(control);
    }
    testLevel.addEventListener("input", () => { if (!busy) render(); });
    testButton.addEventListener("click", () => runTest(name));
    confirmation.input.addEventListener("change", () => confirm(name));
    enableRange.addEventListener("click", () => grant(name));
    checkArea.append(checkStatus, field("Short test level", testLevel, testReadout), testButton, confirmation.label, ratings, enableRange);
    section.append(heading, make("p", "", FEATURES[name].description, "note"), use.label, sliders, checkArea);
    cards.append(section);
    return {use, fields, rhythm, gain, gainValue, checkStatus, testLevel, testReadout, testButton, confirmation, enableRange, ratings};
  }

  function render() {
    shell.hidden = !active;
    if (!active || destroyed) return;
    const names = available();
    const signature = JSON.stringify([names, canCombine(), simulator()]);
    if (signature !== cardSignature) {
      cardSignature = signature;
      cards.replaceChildren();
      views = new Map(names.map(name => [name, makeCard(name)]));
    }
    guidance.textContent = simulator() ? "Adjust each movement here and try a short simulated test if you like." :
      "Adjust each movement here. Run a short test and check the physical stop for each movement you want to use.";
    if (names.length > 1 && !canCombine()) guidance.textContent += " Choose one movement for this connection.";
    continuity.value = readingMode;
    continuity.disabled = busy || !ready();
    const known = context.outputKnown !== false && Number.isInteger(context.output) && context.output >= 0 && context.output <= 20;
    liveOutput.textContent = (simulator() ? "Simulated level: " : "Requested level: ") + (known ? context.output + " / 20" : "unconfirmed");
    for (const [name, view] of views) {
      const value = draft(name), max = testLimit(name), verified = checked.has(name), test = lastTest?.name === name ? lastTest : null;
      const disabled = busy || !ready();
      const needsGentleCheck = !simulator() && !verified;
      view.use.input.checked = selected.has(name);
      view.use.input.disabled = disabled;
      for (const [key, control] of view.fields) {
        control.input.max = String(key === "maximum" ? limit(name) : value.maximum);
        control.input.value = String(value[key]);
        control.input.disabled = disabled;
        control.value.textContent = value[key] + " / 20";
      }
      view.rhythm.value = value.rhythm;
      view.rhythm.disabled = disabled;
      view.gain.value = String(value.gain);
      view.gain.disabled = disabled;
      view.gainValue.textContent = value.gain.toFixed(1) + "×";
      view.checkStatus.textContent = max === 0 ? "A zero maximum blocks the short test." : simulator() ?
        "Optional test on the simulator." : verified ? "Movement checked. Short tests stay within levels 1 to 5." :
          "Run the level 1 check before using this movement.";
      view.testLevel.max = String(Math.max(1, max));
      view.testLevel.value = String(needsGentleCheck ? 1 : Math.min(Math.max(1, Number(view.testLevel.value) || 1), Math.max(1, max)));
      view.testLevel.disabled = disabled || max <= 1 || needsGentleCheck;
      view.testReadout.textContent = view.testLevel.value + " / 20";
      view.testButton.textContent = needsGentleCheck ? "Run gentle check" : "Test for 2 seconds";
      view.testButton.disabled = disabled || !stopped() || max === 0;
      view.confirmation.label.hidden = !test;
      view.confirmation.input.checked = test?.confirmed === true;
      view.confirmation.input.disabled = disabled || !test || test.confirmed || !stopped();
      view.ratings.hidden = !test?.confirmed;
      for (const control of view.ratings.children) control.disabled = disabled || !test?.confirmed;
      view.enableRange.hidden = simulator() || typeof onEnablePersonalRange !== "function";
      view.enableRange.disabled = disabled || !verified || !stopped() || rangeGranted(name);
      view.enableRange.textContent = rangeGranted(name) ? "Personal range enabled for this connection" : "Enable this movement’s personal range";
    }
    const blocker = applyBlocker();
    apply.disabled = busy || Boolean(blocker);
    applyNote.textContent = blocker || "Applying these settings keeps the toy paused.";
    skip.disabled = busy;
  }

  async function runTest(name) {
    if (!active || busy || !ready() || !stopped() || !views.has(name)) return;
    const value = !simulator() && !checked.has(name) ? 1 : Number(views.get(name).testLevel.value);
    if (!Number.isInteger(value) || value < 1 || value > testLimit(name)) return;
    const token = ++epoch, id = context.selectedId;
    busy = true;
    lastTest = null;
    stop();
    checked.delete(name);
    status.textContent = "Testing " + FEATURES[name].label.toLowerCase() + " for two seconds.";
    render();
    try {
      const result = await onTest({channel: name, level: value});
      if (!unchanged(token, id)) return;
      if (result && typeof result === "object") context = {...context, ...result};
      if (!result || !ready()) throw new Error();
      lastTest = {name, level: value, confirmed: false};
      emit("calibration_test", {channel: name, field: "preferred", value});
      status.textContent = simulator() ? "Check the simulated level, then confirm." : "Check the physical movement and stop, then confirm below.";
    } catch {
      if (currentOperation(token, id)) status.textContent = "The test did not complete. Check the device before trying again.";
    } finally {
      if (currentOperation(token, id)) { busy = false; render(); }
    }
  }

  function confirm(name) {
    if (!active || busy || !ready() || !stopped() || lastTest?.name !== name || lastTest.confirmed ||
        !views.get(name)?.confirmation.input.checked) { render(); return; }
    let confirmed = false;
    try { confirmed = onConfirmTest() === true; } catch { /* The parent may reject stale checks. */ }
    if (!active || lastTest?.name !== name || !ready()) return;
    if (confirmed) {
      lastTest.confirmed = true;
      checked.add(name);
    }
    status.textContent = confirmed ? "Movement checked. You can rate this test or continue." : "The check is out of date. Run the short test again.";
    render();
  }

  async function grant(name) {
    if (!active || busy || simulator() || !ready() || !stopped() || !checked.has(name) || rangeGranted(name) ||
        typeof onEnablePersonalRange !== "function") return;
    const token = ++epoch, id = context.selectedId;
    busy = true;
    stop();
    render();
    try {
      const result = await onEnablePersonalRange({channel: name});
      if (!unchanged(token, id)) return;
      if (result && typeof result === "object") context = {...context, ...result};
      if (!result || !stopped() || !rangeGranted(name)) throw new Error();
      emit("calibration_range_enabled", {channel: name});
      status.textContent = "Personal range enabled. Your chosen maximum is still " + draft(name).maximum + " / 20.";
    } catch {
      if (currentOperation(token, id)) status.textContent = "The range could not be enabled. Repeat the movement and stop check.";
    } finally {
      if (currentOperation(token, id)) { busy = false; render(); }
    }
  }

  function complete(applied) {
    ++epoch;
    active = false;
    busy = false;
    render();
    onComplete({settings: copy(drafts), applied, readingMode});
  }

  continuity.addEventListener("change", () => {
    if (!active || busy || !["story", "continuous"].includes(continuity.value)) return;
    readingMode = continuity.value;
    emit("calibration_mode", {mode: readingMode});
  });
  skip.addEventListener("click", () => {
    if (!active || busy) return;
    stop();
    emit("calibration_skip");
    complete([]);
  });
  apply.addEventListener("click", async () => {
    if (!active || busy || applyBlocker()) return;
    const names = chosen(), token = ++epoch, id = context.selectedId;
    const settings = Object.fromEntries(names.map(name => [name, draft(name)]));
    busy = true;
    stop();
    render();
    try {
      const result = names.length > 1 ? await onApplyChannels({model: context.model, channels: names, settings, mode: readingMode}) :
        await onApply({model: context.model, channel: names[0], settings: settings[names[0]]});
      if (!unchanged(token, id)) return;
      if (!result) throw new Error();
      if (names.length === 1) onModeChange(readingMode);
      for (const name of names) onChange({model: context.model, channel: name, settings: settings[name], apply: false});
      emit(names.length > 1 ? "calibration_combine" : "calibration_apply", names.length > 1 ? {channels: names} : {channel: names[0]});
      complete(names);
    } catch {
      if (currentOperation(token, id)) status.textContent = "Settings could not be applied. Your draft is still here.";
    } finally {
      if (currentOperation(token, id)) { busy = false; render(); }
    }
  });

  return {
    open(value = {}) {
      if (destroyed) return;
      ++epoch;
      active = false;
      stop();
      context = {...value};
      active = true;
      busy = false;
      lastTest = null;
      drafts = Object.fromEntries(available().map(name => [name, initialDraft(name, value.settings?.[name])]));
      checked = checkedFrom(value);
      selected = chooseDefaults();
      readingMode = value.readingMode === "continuous" || value.feel?.mode === "continuous" ? "continuous" : "story";
      status.textContent = "";
      render();
    },
    update(value = {}) {
      if (!active) return;
      const previousId = context.selectedId, previousMode = context.mode, previouslyReady = ready(), previous = available();
      const previouslyCombined = canCombine();
      context = {...context, ...value};
      const names = available();
      const changed = previousId !== context.selectedId || previousMode !== context.mode || previouslyReady && !ready() ||
        previouslyCombined !== canCombine() || previous.length !== names.length || previous.some(name => !names.includes(name));
      if (changed) {
        ++epoch;
        busy = false;
        lastTest = null;
        checked.clear();
        selected = chooseDefaults();
        if (previousId !== context.selectedId || previousMode !== context.mode) {
          drafts = Object.fromEntries(names.map(name => [name, initialDraft(name, context.settings?.[name])]));
        }
        stop();
        status.textContent = "Connection changed. Check the selected toy before continuing.";
      }
      if (Array.isArray(value.verifiedChannels)) checked = checkedFrom(value);
      render();
    },
    close() {
      ++epoch;
      const wasActive = active;
      active = false;
      busy = false;
      lastTest = null;
      if (wasActive) stop();
      render();
    },
    interrupt(message = "Stopped. Repeat a test only when ready.") {
      ++epoch;
      busy = false;
      lastTest = null;
      if (active) { stop(); status.textContent = message; render(); }
    },
    snapshot() {
      return {active, busy, settings: copy(drafts), readingMode, checkedMovements: [...checked],
        selectedChannels: chosen(), lastTest: lastTest ? {...lastTest} : null};
    },
    destroy() { if (!destroyed) { this.close(); destroyed = true; shell.remove?.(); } },
  };
}
