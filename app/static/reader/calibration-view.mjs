/** Progressive, local calibration UI. It never connects, starts or saves an account preset itself. */
export const CALIBRATION_FIELDS = Object.freeze([
  {key: "minimum", label: "Your minimum", hint: "The lowest level you want in Continuous background mode. Zero keeps quiet passages available.", action: "Try this minimum"},
  {key: "background", label: "A background level", hint: "Choose a gentle level you would like behind a quieter part of a story.", action: "Try this background"},
  {key: "preferred", label: "A level you like", hint: "Find a level you would want to return to. It does not need to be the strongest one.", action: "Try this level"},
  {key: "maximum", label: "Your upper limit", hint: "Choose the strongest level you want this movement to reach. You can lower it at any time.", action: "Try this limit"},
  {key: "recovery", label: "Your Ease off level", hint: "Ease off reduces output to this level and holds it until you choose Follow story. Zero means stop output.", action: "Try Ease off level"},
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
    rhythm: ["steady", "gentle", "dynamic"].includes(value.rhythm) ? value.rhythm : "steady"};
}

/** Uses only confirmed discovered channels supplied by the application. */
export function createCalibrationView({document = globalThis.document, mount,
  onTest = () => false, onConfirmTest = () => false, onStop = () => {},
  onChange = () => {}, onApply = () => false, onApplyChannels = null, onEnablePersonalRange = null,
  onModeChange = () => {}, onEvent = () => {}, onComplete = () => {}} = {}) {
  if (!document?.createElement || !mount) return {open() {}, update() {}, close() {}, destroy() {}, snapshot: () => ({active: false})};
  const make = (tag, id, text = "", cls = "") => {
    const el = document.createElement(tag); if (id) el.id = id; if (text) el.textContent = text; if (cls) el.className = cls; return el;
  };
  const button = (id, text, cls = "") => { const el = make("button", id, text, cls); el.setAttribute("type", "button"); return el; };
  const field = (labelText, control) => {
    const wrap = make("div", null, "", "setup-field"), label = make("label", null, labelText);
    label.setAttribute("for", control.id); wrap.append(label, control); return wrap;
  };
  const option = (value, label) => { const el = make("option", null, label); el.value = value; return el; };
  const shell = make("section", "calibration-view", "", "calibration-view"); shell.hidden = true;
  shell.setAttribute("aria-labelledby", "calibration-heading"); shell.dataset.betaControl = "calibration";
  const progress = make("p", "calibration-progress", "", "setup-step-label");
  const heading = make("h3", "calibration-heading", "Explore your toy"); heading.setAttribute("tabindex", "-1");
  const intro = make("p", "calibration-intro");
  const capabilities = make("div", "calibration-capabilities", "", "calibration-capabilities");
  const movement = make("select", "calibration-channel");
  const movementField = field("Movement to explore", movement);
  const feature = make("div", "calibration-feature", "", "calibration-feature");
  const glyph = make("span", "calibration-feature-glyph", "", "calibration-feature-glyph"); glyph.setAttribute("aria-hidden", "true");
  const featureText = make("div"), featureTitle = make("strong", "calibration-feature-title"), featureCopy = make("p", "calibration-feature-copy");
  featureText.append(featureTitle, featureCopy); feature.append(glyph, featureText);
  const liveOutput = make("output", "calibration-live-output", "", "calibration-live-output"); liveOutput.setAttribute("aria-live", "polite");
  const liveMeter = make("div", "calibration-live-meter", "", "calibration-live-meter"); liveMeter.setAttribute("aria-hidden", "true");
  const liveFill = make("span"); liveMeter.append(liveFill);
  const personalRange = make("section", "calibration-personal-range", "", "calibration-personal-range");
  const personalRangeHeading = make("strong", "calibration-personal-range-heading", "Begin gently. Choose your range.");
  const personalRangeCopy = make("p", "calibration-personal-range-copy", "", "note");
  const enableRange = button("calibration-enable-personal-range", "Enable personal range");
  personalRange.append(personalRangeHeading, personalRangeCopy, enableRange);
  const levels = make("section", "calibration-levels", "", "calibration-levels");
  const levelName = make("h4", "calibration-level-name");
  const levelHelp = make("p", "calibration-level-help", "", "note");
  const slider = make("input", "calibration-level");
  for (const [k,v] of Object.entries({type: "range", min: 0, max: 5, step: 1})) slider.setAttribute(k, String(v));
  slider.value = "0";
  const readout = make("output", "calibration-level-value"); readout.setAttribute("for", slider.id);
  const preview = make("div", "calibration-level-preview", "", "calibration-level-preview"); preview.setAttribute("aria-hidden", "true");
  const previewBars = Array.from({length: 20}, () => make("span")); preview.append(...previewBars);
  const pulse = button("calibration-test", "Try this level", "primary");
  const check = make("input", "calibration-stopped"); check.setAttribute("type", "checkbox");
  const checkLabel = make("label", null, "", "setup-confirmation"); checkLabel.setAttribute("for", check.id);
  checkLabel.append(check, make("span", null, "I checked the response and the output has stopped."));
  const ratings = make("div", "calibration-ratings", "", "calibration-ratings"); ratings.setAttribute("role", "group"); ratings.setAttribute("aria-label", "How this test felt");
  const ratingButtons = new Map();
  for (const [id, label] of [["light", "Too light"], ["good", "Good for me"], ["strong", "Too much"]]) {
    const el = button("calibration-rating-" + id, label); ratings.append(el); ratingButtons.set(id, el);
  }
  const feedbackHelp = make("p", null, "Ratings are optional. You can skip any level or movement. No outcome is required.", "note");
  levels.append(levelName, levelHelp, field("Level", slider), readout, preview, pulse, checkLabel, ratings, feedbackHelp);
  const summary = make("section", "calibration-summary", "", "calibration-summary");
  const summaryList = make("dl", "calibration-summary-list", "", "calibration-summary-list");
  const rhythm = make("select", "calibration-rhythm");
  for (const [value,label] of [["steady","Steady"],["gentle","Gentle changes"],["dynamic","More variation"]]) rhythm.append(option(value,label));
  const gain = make("input", "calibration-gain");
  for (const [key,value] of Object.entries({type:"range",min:0,max:2,step:.1})) gain.setAttribute(key,String(value)); gain.value = "1";
  const gainValue = make("output", "calibration-gain-value"); gainValue.setAttribute("for", gain.id);
  const continuity = make("select", "calibration-continuity");
  continuity.append(option("story", "Story dynamics · quiet passages can be still"), option("continuous", "Continuous background · keep my chosen minimum"));
  const apply = button("calibration-apply", "Use these levels", "primary");
  summary.append(make("p", null, "These levels belong to this movement. Applying them keeps output paused. Save a named preset from the reading controls to keep them on your account."),
    summaryList, field("While following the story", continuity), field("Story variation", rhythm), field("Story strength", gain), gainValue, apply);
  const together = make("section", "calibration-together", "", "calibration-together");
  const togetherHelp = make("p", "calibration-together-help");
  const togetherChoices = make("div", "calibration-together-choices", "", "calibration-together-choices");
  const togetherApply = button("calibration-together-apply", "Use these movements together", "primary");
  together.append(togetherHelp, togetherChoices, make("p", null, "Each movement keeps its own levels. Applying the combination stays paused; the next story still needs a separate Start.", "note"), togetherApply);
  const controls = make("div", null, "", "calibration-navigation");
  const previous = button("calibration-previous", "Previous"), next = button("calibration-next", "Set my levels", "primary"), skip = button("calibration-skip-movement", "Skip this movement");
  controls.append(previous, skip, next);
  const status = make("p", "calibration-status", "", "note"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  shell.append(progress, heading, intro, capabilities, movementField, feature, liveOutput, liveMeter, personalRange, levels, summary, together, status, controls); mount.append(shell);

  let active = false, context = {}, channelIndex = 0, fieldIndex = 0, stage = "features", busy = false, epoch = 0, tested = false, accepted = false, draft = {}, records = {}, applied = new Set(), destroyed = false, readingMode = "story", checkedMovements = new Set(), combinedChoices = new Set();
  const available = () => Array.isArray(context.channels) ? [...new Set(context.channels.filter(name => FEATURES[name]))] : [];
  const channel = () => available()[channelIndex] || "";
  const offeredFeature = name => FEATURES[name] ? {...FEATURES[name], label: name === "oscillate" && context.mode === "simulator" ? "Oscillation · simulator" : FEATURES[name].label} : null;
  const canCombine = () => context.supportsCombined === true && available().length > 1 && typeof onApplyChannels === "function";
  const rangeEnabled = () => context.mode === "simulator" || Array.isArray(context.personalRangeChannels) && context.personalRangeChannels.includes(channel());
  const limit = () => context.mode !== "lovense" || context.maxCeiling === 20 && rangeEnabled() ? 20 : 5;
  const testLimit = () => Math.min(limit(), level(context.ceiling, 5));
  const ready = () => context.connected === true && typeof context.selectedId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(context.selectedId) && Boolean(channel()) && !["error", "expired", "disconnected"].includes(context.connectionState);
  const safeStop = () => { try { onStop(); } catch { /* Parent owns transport recovery. */ } };
  const emit = (type, extra = {}) => { try { onEvent({type, channel: channel(), ...extra}); } catch { /* Optional research never owns controls. */ } };
  const resetTest = () => { tested = false; accepted = false; check.checked = false; };
  const changed = () => {
    records[channel()] = copy(draft);
    try { onChange({model: context.model, channel: channel(), settings: copy(draft), apply: false}); } catch { /* A local draft remains usable when account save is unavailable. */ }
  };
  const selectChannel = index => {
    ++epoch; safeStop(); channelIndex = Math.max(0, Math.min(available().length - 1, index));
    fieldIndex = 0; stage = "features"; busy = false; draft = calibrationDraft(records[channel()], limit()); resetTest(); status.textContent = ""; render();
  };
  function render() {
    shell.hidden = !active;
    if (!active || destroyed) return;
    const names = available(), currentFeature = offeredFeature(channel());
    progress.textContent = names.length ? "Movement " + (channelIndex + 1) + " of " + names.length + (stage === "levels" ? " · Level " + (fieldIndex + 1) + " of " + CALIBRATION_FIELDS.length : "") : "Choose a connected toy first";
    heading.textContent = stage === "features" ? "What your toy can do." : stage === "levels" ? "Find your " + (currentFeature?.label.toLowerCase() || "movement") + " levels." : stage === "together" ? "Put movements together." : "Your movement settings.";
    intro.textContent = context.mode === "simulator" ? "SIMULATOR · Watch the movement and output on screen. These choices are a rehearsal, not a physical calibration." :
      "Explore one movement at a time. Each test is a short request; you decide what feels right and can stop or skip at any time.";
    capabilities.hidden = stage !== "features"; capabilities.replaceChildren();
    for (const name of names) {
      const item = make("div", null, "", "calibration-capability");
      const icon = make("span", null, FEATURES[name].icon); icon.setAttribute("aria-hidden", "true");
      item.append(icon, make("strong", null, offeredFeature(name).label), make("p", null, FEATURES[name].example)); capabilities.append(item);
    }
    movement.replaceChildren(...names.map(name => option(name, offeredFeature(name).label))); movement.value = channel(); movement.disabled = busy || names.length < 2;
    feature.hidden = stage === "together";
    glyph.textContent = currentFeature?.icon || "—"; featureTitle.textContent = currentFeature?.label || "No movement available";
    featureCopy.textContent = currentFeature?.description || "Connect and explicitly select a supported toy to continue.";
    const actualOutput = Number.isInteger(context.output) && context.output >= 0 && context.output <= 20 ? context.output : null;
    liveOutput.textContent = (context.mode === "simulator" ? "Simulated output: " : "Requested output: ") + (actualOutput === null ? "unknown · check the device" : actualOutput + " / 20");
    glyph.dataset.running = String(context.mode === "simulator" && actualOutput > 0); glyph.dataset.movement = channel();
    liveFill.style.width = String(actualOutput === null ? 0 : actualOutput * 5) + "%";
    liveMeter.dataset.unknown = String(actualOutput === null);
    personalRange.hidden = context.mode !== "lovense" || stage === "together";
    personalRangeHeading.textContent = rangeEnabled() ? "Personal range enabled for this movement." : "Begin gently. Choose your range.";
    personalRangeCopy.textContent = rangeEnabled() ? "This connection can use your chosen levels up to 20/20. Your maximum is still " + level(context.ceiling, 5) + "/20. Applying settings stays paused, and saved presets never enable a range on a new connection." :
      "The first check stays at 5/20 or below. After testing this movement and checking its Stop, you can enable levels up to 20/20 for this connection. Nothing starts, and your maximum stays as chosen.";
    enableRange.textContent = rangeEnabled() ? "Personal range enabled" : "Enable personal range";
    enableRange.disabled = busy || !ready() || context.output !== 0 || !checkedMovements.has(channel()) || rangeEnabled() || typeof onEnablePersonalRange !== "function";
    levels.hidden = stage !== "levels"; summary.hidden = stage !== "summary"; together.hidden = stage !== "together";
    const f = CALIBRATION_FIELDS[fieldIndex];
    levelName.textContent = f.label; levelHelp.textContent = f.hint;
    slider.max = String(limit()); slider.value = String(draft[f.key]); slider.disabled = busy || !ready();
    readout.textContent = String(draft[f.key]) + " / 20 · current test ceiling " + testLimit() + (context.mode === "lovense" ? " · session range " + limit() : "");
    for (let i = 0; i < previewBars.length; i++) previewBars[i].dataset.on = String(i < draft[f.key]);
    pulse.textContent = draft[f.key] === 0 ? "Confirm zero output" : f.action + " · 2 seconds";
    pulse.disabled = busy || !ready() || draft[f.key] > testLimit();
    check.disabled = busy || !tested || context.output !== 0; check.checked = accepted;
    for (const el of ratingButtons.values()) el.disabled = busy || !accepted;
    previous.hidden = stage === "features"; previous.disabled = busy;
    skip.disabled = busy; next.disabled = busy || !names.length;
    next.textContent = stage === "features" ? "Set my levels" : stage === "levels" ? (fieldIndex < CALIBRATION_FIELDS.length - 1 ? "Next level" : "Review these levels") : stage === "together" ? "Continue to story tests" : channelIndex < names.length - 1 ? "Explore next movement" : canCombine() ? "Explore movements together" : "Continue to story tests";
    skip.textContent = stage === "together" ? "Keep one movement" : "Skip this movement";
    apply.disabled = busy || !ready(); apply.textContent = applied.has(channel()) ? "Apply these levels again" : "Use these levels";
    summaryList.replaceChildren();
    for (const f of CALIBRATION_FIELDS) summaryList.append(make("dt", null, f.label), make("dd", null, String(draft[f.key]) + " / 20"));
    rhythm.value = draft.rhythm; rhythm.disabled = busy; gain.value = String(draft.gain); gain.disabled = busy; gainValue.textContent = draft.gain.toFixed(1) + "×";
    continuity.value = readingMode; continuity.disabled = busy;
    togetherChoices.replaceChildren();
    for (const name of names) {
      const checkbox = make("input", "calibration-combine-" + name); checkbox.setAttribute("type", "checkbox");
      checkbox.checked = combinedChoices.has(name); checkbox.disabled = busy || !checkedMovements.has(name);
      const choice = make("label", null, "", "setup-confirmation"); choice.setAttribute("for", checkbox.id);
      choice.append(checkbox, make("span", null, offeredFeature(name).label + (checkedMovements.has(name) ? " · checked individually" : " · test and confirm this movement first")));
      checkbox.addEventListener("change", () => {
        if (busy || !checkedMovements.has(name)) return;
        if (checkbox.checked) combinedChoices.add(name); else combinedChoices.delete(name);
        render();
      });
      togetherChoices.append(choice);
    }
    togetherHelp.textContent = "Your connected toy exposes more than one movement. Choose the movements you want together after checking each one separately. This step is optional.";
    togetherApply.disabled = busy || !ready() || !canCombine() || combinedChoices.size < 2 || [...combinedChoices].some(name => !checkedMovements.has(name));
  }
  const completeOrNext = () => {
    safeStop();
    if (channelIndex < available().length - 1) { selectChannel(channelIndex + 1); return; }
    if (stage !== "together" && canCombine()) { stage = "together"; status.textContent = ""; render(); return; }
    ++epoch; active = false; render();
    try { onComplete({settings: copy(records), applied: [...applied], readingMode}); } catch { /* Parent owns next step. */ }
  };
  next.addEventListener("click", () => {
    if (busy || !active || !channel()) return;
    safeStop(); resetTest();
    if (stage === "features") stage = "levels";
    else if (stage === "levels" && fieldIndex < CALIBRATION_FIELDS.length - 1) fieldIndex++;
    else if (stage === "levels") stage = "summary";
    else { completeOrNext(); return; }
    status.textContent = ""; render(); heading.focus?.({preventScroll: true});
  });
  previous.addEventListener("click", () => {
    if (busy || !active) return;
    ++epoch; safeStop(); resetTest(); status.textContent = "";
    if (stage === "together") stage = "summary";
    else if (stage === "summary") { stage = "levels"; fieldIndex = CALIBRATION_FIELDS.length - 1; }
    else if (fieldIndex > 0) fieldIndex--;
    else stage = "features";
    render();
  });
  skip.addEventListener("click", () => { if (busy || !active) return; emit("calibration_skip"); completeOrNext(); });
  movement.addEventListener("change", () => { if (!busy && available().includes(movement.value)) selectChannel(available().indexOf(movement.value)); });
  slider.addEventListener("input", () => {
    if (busy || !active || !ready()) return;
    const value = Number(slider.value); if (!Number.isInteger(value) || value < 0 || value > limit()) return;
    safeStop(); resetTest(); draft[CALIBRATION_FIELDS[fieldIndex].key] = value;
    if (CALIBRATION_FIELDS[fieldIndex].key === "minimum") {
      draft.background = Math.max(value, draft.background); draft.preferred = Math.max(value, draft.preferred);
    }
    if (["background", "preferred"].includes(CALIBRATION_FIELDS[fieldIndex].key)) draft.minimum = Math.min(value, draft.minimum);
    draft = calibrationDraft(draft, limit()); changed(); emit("calibration_adjust", {field: CALIBRATION_FIELDS[fieldIndex].key, value}); status.textContent = "Draft updated. Nothing starts when you move a slider."; render();
  });
  pulse.addEventListener("click", async () => {
    if (busy || !active || !ready() || draft[CALIBRATION_FIELDS[fieldIndex].key] > testLimit()) return;
    const value = draft[CALIBRATION_FIELDS[fieldIndex].key], action = channel(), id = context.selectedId, activeEpoch = ++epoch;
    if (value > 0) { checkedMovements.delete(action); combinedChoices.delete(action); }
    safeStop(); busy = true; resetTest(); status.textContent = value === 0 ? "Stop requested. Check that output is zero." : "Testing " + FEATURES[action].label.toLowerCase() + " for two seconds…"; render();
    try {
      const result = value === 0 ? (safeStop(), true) : await onTest({channel: action, level: value});
      if (!active || activeEpoch !== epoch || id !== context.selectedId || action !== channel()) return;
      if (result && typeof result === "object") context = {...context, ...result};
      if (!(result === true || result && typeof result === "object") || !ready()) throw new Error();
      tested = true; emit("calibration_test", {field: CALIBRATION_FIELDS[fieldIndex].key, value});
      status.textContent = context.mode === "simulator" ? "Test ended. Check the simulated output, then confirm it is stopped." : "Test and Stop requested. Check the physical response and that the toy stopped.";
    } catch { if (activeEpoch === epoch) status.textContent = "The test did not complete. Stop, check the connection and retry."; }
    finally { if (activeEpoch === epoch) { busy = false; render(); } }
  });
  check.addEventListener("change", () => {
    if (!active || busy || !tested || context.output !== 0 || !check.checked) { accepted = false; render(); return; }
    const zero = draft[CALIBRATION_FIELDS[fieldIndex].key] === 0;
    try { accepted = zero || onConfirmTest() === true; } catch { accepted = false; }
    if (accepted && !zero) checkedMovements.add(channel());
    status.textContent = accepted ? "Checked. Add an optional rating or continue." : "The test is no longer current. Repeat it and check the response."; render();
  });
  for (const [rating, el] of ratingButtons) el.addEventListener("click", () => {
    if (!active || busy || !accepted) return;
    emit("calibration_rating", {field: CALIBRATION_FIELDS[fieldIndex].key, value: draft[CALIBRATION_FIELDS[fieldIndex].key], rating}); status.textContent = "Selected for this test. Shared only when beta recording is on. You can adjust the level or continue.";
  });
  continuity.addEventListener("change", () => {
    if (!active || busy || !["story", "continuous"].includes(continuity.value)) return;
    readingMode = continuity.value; try { onModeChange(readingMode); } catch { /* Explicit user choice remains a local draft. */ }
    emit("calibration_mode", {mode: readingMode}); render();
  });
  rhythm.addEventListener("change", () => { if (!active || busy || !["steady","gentle","dynamic"].includes(rhythm.value)) return; draft.rhythm = rhythm.value; changed(); emit("calibration_rhythm", {rhythm: draft.rhythm}); render(); });
  gain.addEventListener("input", () => { const value = Number(gain.value); if (!active || busy || !Number.isFinite(value) || value < 0 || value > 2) return; draft.gain = Math.round(value * 10) / 10; changed(); emit("calibration_gain", {value: draft.gain}); render(); });
  apply.addEventListener("click", async () => {
    if (!active || busy || !ready()) return;
    const activeEpoch = ++epoch, action = channel(), id = context.selectedId; busy = true; safeStop(); render();
    try {
      const result = await onApply({model: context.model, channel: action, settings: copy(draft)});
      if (!active || activeEpoch !== epoch || id !== context.selectedId || channel() !== action) return;
      if (result === false) throw new Error();
      records[action] = copy(draft); applied.add(action); emit("calibration_apply"); status.textContent = "Levels applied. Output is paused. Save a named preset from the reading controls to keep them.";
    } catch { if (activeEpoch === epoch) status.textContent = "These levels were not applied. Your draft is still here; try again."; }
    finally { if (activeEpoch === epoch) { busy = false; render(); } }
  });
  togetherApply.addEventListener("click", async () => {
    const chosen = available().filter(name => combinedChoices.has(name));
    if (!active || busy || !ready() || !canCombine() || chosen.length < 2 || chosen.some(name => !checkedMovements.has(name))) return;
    const activeEpoch = ++epoch, id = context.selectedId; busy = true; safeStop(); render();
    try {
      const settings = Object.fromEntries(chosen.map(name => [name, calibrationDraft(records[name], limit())]));
      const result = await onApplyChannels({model: context.model, channels: chosen, settings, mode: readingMode});
      if (!active || activeEpoch !== epoch || id !== context.selectedId) return;
      if (result === false) throw new Error();
      emit("calibration_combine", {channels: chosen}); status.textContent = "Combination applied. Output is paused. The test story will still need your Start.";
    } catch { if (activeEpoch === epoch) status.textContent = "The combination was not applied. You can keep testing one movement at a time."; }
    finally { if (activeEpoch === epoch) { busy = false; render(); } }
  });
  enableRange.addEventListener("click", async () => {
    if (!active || busy || !ready() || context.output !== 0 || !checkedMovements.has(channel()) || rangeEnabled() || typeof onEnablePersonalRange !== "function") return;
    const action = channel(), id = context.selectedId, activeEpoch = ++epoch; busy = true; safeStop(); render();
    try {
      const result = await onEnablePersonalRange({channel: action});
      if (!active || activeEpoch !== epoch || id !== context.selectedId || action !== channel()) return;
      if (result && typeof result === "object") context = {...context, ...result};
      if (result === false || !ready() || context.output !== 0 || !rangeEnabled() || context.maxCeiling !== 20) throw new Error();
      emit("calibration_range_enabled");
      status.textContent = "Personal range enabled. Your maximum has not changed and output is paused. Choose and apply your upper limit when ready.";
    } catch { if (activeEpoch === epoch) status.textContent = "Personal range was not enabled. Repeat the gentle test, check that it stopped, then try again."; }
    finally { if (activeEpoch === epoch) { busy = false; render(); } }
  });
  return {
    open(value = {}) {
      if (destroyed) return;
      ++epoch; safeStop(); context = {...value}; channelIndex = 0; fieldIndex = 0; stage = "features"; busy = false; active = true;
      records = value.settings && typeof value.settings === "object" && !Array.isArray(value.settings) ? copy(value.settings) : {};
      checkedMovements = new Set(Array.isArray(value.verifiedChannels) ? value.verifiedChannels.filter(name => available().includes(name)) : []); combinedChoices = new Set();
      readingMode = value.readingMode === "continuous" || value.feel?.mode === "continuous" ? "continuous" : "story";
      applied = new Set(); draft = calibrationDraft(records[channel()], limit()); resetTest(); status.textContent = ""; render(); heading.focus?.({preventScroll: true});
    },
    update(value = {}) {
      const oldId = context.selectedId, oldChannel = channel(), previouslyReady = ready(); context = {...context, ...value};
      if (active && (oldId !== context.selectedId || oldChannel !== channel() || previouslyReady && !ready())) {
        ++epoch; checkedMovements.clear(); combinedChoices.clear(); safeStop(); busy = false; resetTest(); status.textContent = "Connection changed. Reconnect and select the toy before testing again.";
      }
      if (active && Array.isArray(value.verifiedChannels)) checkedMovements = new Set(value.verifiedChannels.filter(name => available().includes(name)));
      if (active) { draft = calibrationDraft(draft, limit()); render(); }
    },
    close() { ++epoch; const wasActive = active; active = false; busy = false; resetTest(); if (wasActive) safeStop(); render(); },
    interrupt(message = "Stopped. Repeat a test only when ready.") { ++epoch; busy = false; resetTest(); if (active) { safeStop(); status.textContent = message; render(); } },
    snapshot() { return {active, stage, channel: channel(), field: CALIBRATION_FIELDS[fieldIndex].key, busy, tested, accepted, settings: copy(records), draft: copy(draft), readingMode, checkedMovements: [...checkedMovements], combinedChoices: [...combinedChoices]}; },
    destroy() { if (destroyed) return; this.close(); destroyed = true; shell.remove?.(); },
  };
}
