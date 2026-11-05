import {TOY_PROFILES, getToyProfile} from "../devices/toy-profiles.mjs";
import {createCalibrationView} from "./calibration-view.mjs";
import {CONTROLLED_BETA_STORIES} from "./beta-stories.mjs";

// The application adapter owns device connection and safety checks.
// Practice opens a session-only story through the application's normal loader;
// it never starts playback or persists controls on the reader's behalf.
export const PRACTICE_STORY = Object.freeze({
  title: "Find your rhythm",
  text: [
    "The reading room was quiet. Sunlight crossed the floor and the first pages waited on the table. Begin here with a quiet section: the preview should be still, even after you press Start.",
    "The station clock moved towards the hour. Beyond the window a train approached, slowly at first, its lights appearing through the evening haze. Scroll to this section and watch the preview begin to move.",
    "The train gathered speed. The landscape changed from fields to woodland and back again, its rhythm growing stronger. Try the + and − level buttons and move the maximum. The preview shows how the toy would move.",
    "The carriage slowed beside a small platform. A traveller folded a letter and looked towards the door. Read this part more slowly. Stop scrolling for a moment, then move back to the previous section if you want to compare the change.",
    "A whistle sounded and the journey continued. Lights flickered past the window, then faded into the distance. Try a quicker scroll, then Pause or Stop. Restart only when you are ready; changing a control while paused will not start playback.",
    "At the final station everything became quiet again. The book rested beside the window. When the controls feel comfortable, finish setup and open a story of your own.",
  ].join("\n\n"),
  corrections: Object.freeze([0, 2, 4, 1, 3, 0]),
});

// All connection callbacks stay in the application adapter. This view receives
// status snapshots; model choice alone never authorises a command or a toy ID.
export const SETUP_MODELS = Object.freeze(TOY_PROFILES.map(({id, label, pickerLabel}) => Object.freeze({id, label, pickerLabel}))
  .sort((first, second) => first.pickerLabel.localeCompare(second.pickerLabel, "en")));
export const SETUP_STORIES = Object.freeze([Object.freeze({...PRACTICE_STORY, betaId: "control-check-v1", controlled: true,
  description: "Check scrolling, section levels, limits and Stop with a known sequence."}), ...CONTROLLED_BETA_STORIES]
  .map(story => Object.freeze({...story, authoredLevels: true, quietZeros: true})));
const CHANNEL_LABELS = Object.freeze(Object.fromEntries(TOY_PROFILES.flatMap(profile => profile.channels.map(channel => [channel.id, channel.label]))));
function qrSource(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["lovense.com", "lovense-api.com"].some(host => url.hostname === host || url.hostname.endsWith("." + host)) ? url.href : null;
  } catch { return null; }
}

export function createSetupFlow({document = globalThis.document, window = globalThis.window,
  coachMount = null, onConnect = () => false, onSelectDevice = () => false,
  onRefresh = () => {}, onTest = () => false, onConfirmTest = () => true, onDisconnect = () => {}, onSimulateFailure = () => {},
  onPractice = () => false, onStart = () => {}, onStop = () => {}, onFinish = () => {},
  canConnectLive = () => true, onLiveSignIn = () => {},
  quickSetup = false, onQuickTest = () => false, onConfirmQuickTest = () => false, onOpenAdvanced = () => {},
  enableCalibration = false, onCalibrationChange = () => {}, onApplyCalibration = () => false,
  onApplyChannels = null, onEnablePersonalRange = null, onCalibrationModeChange = () => {}, onResearchEvent = () => {}} = {}) {
  if (!document?.body || !document.createElement) return {open() {}, update() {}, finish() {}, cancel() {}, destroy() {}, snapshot: () => ({active: false, checks: {}})};
  const make = (tag, {id, className, value, attrs = {}} = {}) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    if (value) node.textContent = value;
    for (const [name, content] of Object.entries(attrs)) node.setAttribute(name, String(content));
    return node;
  };
  const button = (id, value, className = "") => make("button", {id, value, className, attrs: {type: "button"}});
  const option = (value, label) => { const node = make("option", {value: label}); node.value = value; return node; };
  const field = (label, control, help = null) => {
    const wrap = make("div", {className: "setup-field"});
    wrap.append(make("label", {value: label, attrs: {for: control.id}}), control);
    if (help) wrap.append(make("p", {className: "note", value: help}));
    return wrap;
  };
  const dialog = make("dialog", {id: "setup-dialog", className: "setup-dialog", attrs: {"aria-labelledby": "setup-heading"}});
  const header = make("div", {className: "setup-dialog-heading"});
  const headingBlock = make("div");
  const step = make("span", {id: "setup-step-label", className: "setup-step-label", value: "01 / Choose your toy"});
  const heading = make("h2", {id: "setup-heading", value: "Set up your toy"});
  headingBlock.append(step, heading);
  const close = button("setup-close", "×", "icon-button"); close.setAttribute("aria-label", "Close setup");
  header.append(headingBlock, close);
  const intro = make("p", {id: "setup-intro", value: "Connect a toy through Lovense Remote or try the controls with a simulator."});
  const chooser = make("section", {id: "setup-choices", className: "setup-choices"});
  const model = make("select", {id: "setup-model"});
  for (const toy of SETUP_MODELS) model.append(option(toy.id, toy.pickerLabel));
  model.value = "lush";
  const modeGroup = make("div", {className: "setup-mode-options", attrs: {role: "group", "aria-label": "Connection type"}});
  const simMode = button("setup-mode-simulator", "Try a simulator", "setup-mode");
  const liveMode = button("setup-mode-lovense", "Connect my toy", "setup-mode");
  simMode.append(make("span", {className: "setup-mode-note", value: "Try the controls on this screen without a physical toy."}));
  liveMode.append(make("span", {className: "setup-mode-note", value: "Use Lovense Remote on your phone and open this page on another screen."}));
  modeGroup.append(simMode, liveMode);
  chooser.append(field("Which toy?", model), modeGroup);
  const connection = make("section", {id: "setup-pairing", className: "setup-pairing"});
  const connectionBadge = make("span", {id: "setup-connection-badge", className: "setup-connection-badge"});
  const instructions = make("ol", {id: "setup-instructions", className: "setup-instructions"});
  const qr = make("img", {id: "setup-qr", className: "setup-qr", attrs: {alt: "Private Lovense pairing QR code", referrerpolicy: "no-referrer"}});
  const qrPlaceholder = make("div", {id: "setup-qr-placeholder", className: "setup-qr-placeholder"});
  const pairingNote = make("p", {id: "setup-pairing-note", className: "note"});
  connection.append(connectionBadge, instructions, qr, qrPlaceholder, pairingNote);
  const selection = make("section", {id: "setup-selection", className: "setup-selection"});
  const device = make("select", {id: "setup-devices"});
  const discoveryNote = make("p", {id: "setup-discovery-note", className: "note"});
  selection.append(field("Choose the toy to use", device), discoveryNote);
  const pairStage = make("div", {id: "setup-pair-stage"});
  const pairSummary = make("p", {id: "setup-pair-summary", className: "note"});
  pairStage.append(chooser, pairSummary, connection, selection);
  const testPanel = make("section", {id: "setup-test-panel", className: "setup-test-panel"});
  const channel = make("select", {id: "setup-channel"});
  const testLevel = make("input", {id: "setup-test-level", attrs: {type: "range", min: 1, max: 5, step: 1, value: 1}}); testLevel.value = "1";
  const testReadout = make("output", {id: "setup-test-level-value", value: "1 / 20", attrs: {for: "setup-test-level"}});
  const liveLevel = make("output", {id: "setup-live-output", value: "Level 0 / 20", attrs: {"aria-live": "polite"}});
  const testButton = button("setup-test", "Test for 2 seconds", "primary");
  const confirmation = make("input", {id: "setup-response-checked", attrs: {type: "checkbox"}});
  const confirmationLabel = make("label", {className: "setup-confirmation", attrs: {for: "setup-response-checked"}});
  const confirmationText = make("span");
  confirmationLabel.append(confirmation, confirmationText);
  const testNote = make("p", {id: "setup-test-note", className: "note"});
  const testMaximumNote = make("p", {id: "setup-test-maximum", className: "note setup-test-maximum"});
  const capabilityNote = make("p", {id: "setup-capability-note", className: "note setup-capability-note"});
  const testControls = make("div", {className: "setup-test-controls"});
  const movementField = field("Test one movement", channel), levelField = field("Test level", testLevel);
  testControls.append(movementField, levelField, testReadout, testButton);
  if (quickSetup) {
    movementField.hidden = levelField.hidden = testReadout.hidden = true;
    testControls.className += " setup-test-controls-quick";
    testButton.textContent = "Run quick test";
  }
  testPanel.append(testMaximumNote, testControls, liveLevel, testNote, capabilityNote, confirmationLabel);
  const rehearsal = make("div", {id: "setup-rehearsal-tools", className: "setup-rehearsal-tools"});
  rehearsal.append(make("strong", {value: "Rehearsal tools"}), make("p", {className: "note", value: "Try a lost connection. Output stops and reconnecting never restarts it."}));
  const simFailure = button("setup-sim-failure", "Simulate disconnect");
  const simError = button("setup-sim-error", "Simulate connection error");
  const retry = button("setup-retry", "Reconnect");
  rehearsal.append(simFailure, simError, retry);
  const calibrationMount = make("div", {id: "setup-calibration-mount"}); calibrationMount.hidden = true;
  const practicePicker = make("section", {id: "setup-practice-picker", className: "setup-practice-picker"});
  const practiceStory = make("select", {id: "setup-practice-story"});
  for (const story of SETUP_STORIES) practiceStory.append(option(story.betaId, story.title));
  practiceStory.value = SETUP_STORIES[0].betaId;
  const practiceDescription = make("p", {id: "setup-practice-description", className: "note"});
  practicePicker.append(field("Choose a controlled test story", practiceStory), practiceDescription,
    make("p", {className: "note", value: "These original, non-explicit stories use known levels so you can compare controls before trying your own text. Every story opens paused."}));
  const status = make("p", {id: "setup-status", className: "note setup-status", attrs: {role: "status", "aria-live": "polite"}});
  const actions = make("div", {className: "setup-dialog-actions"});
  const stop = button("setup-stop", "Stop", "stop");
  const back = button("setup-back", "Back");
  const skip = button("setup-skip", "Skip for now");
  const primary = button("setup-primary", "Connect simulator", "primary");
  actions.append(stop, back, skip, primary);
  dialog.append(header, intro, pairStage, testPanel, calibrationMount, practicePicker, rehearsal, status, actions);
  document.body.append(dialog);

  const coach = make("section", {id: "setup-coach", className: "setup-coach" + (coachMount ? "" : " setup-coach-floating"),
    attrs: {"aria-labelledby": "setup-coach-heading"}});
  coach.hidden = true;
  const coachHeading = make("h3", {id: "setup-coach-heading", value: "Find what feels right.", attrs: {tabindex: "-1"}});
  coach.append(make("span", {className: "setup-step-label", value: "05 / Your test read"}), coachHeading,
    make("p", {value: "Start the practice story, then try the level buttons, maximum and scrolling. The levels are deliberately set for practice, not analysed from this text."}));
  const checks = {started: false, position: false, level: false, maximum: false, restart: false};
  const checklist = make("ul", {className: "setup-checklist"}), checkNodes = new Map();
  for (const [name, label] of [["started", "Start the test read"], ["position", "Move through the story"],
    ["level", "Try the + and − level buttons"], ["maximum", "Adjust the maximum"], ["restart", "Stop or pause, then restart"]]) {
    const item = make("li", {value: label}); item.dataset.done = "false"; checkNodes.set(name, item); checklist.append(item);
  }
  const coachActions = make("div", {className: "setup-coach-actions"});
  const start = button("setup-start", "Start", "primary"), coachStop = button("setup-coach-stop", "Stop", "stop");
  const finishButton = button("setup-finish", "Done — open my story");
  coachActions.append(start, coachStop, finishButton);
  const coachStatus = make("p", {id: "setup-coach-status", className: "setup-coach-status", attrs: {role: "status", "aria-live": "polite"}});
  coach.append(checklist, coachActions, coachStatus); (coachMount || document.body).append(coach);

  let current = {}, phase = "closed", epoch = 0, busy = false, disposed = false, opener = null;
  let mode = "simulator", preferredModel = "lush", tested = false, initial = null, pausedAfterStart = false;
  const label = () => SETUP_MODELS.find(toy => toy.id === preferredModel)?.label || "Toy";
  const stopped = () => { try { onStop(); } catch { /* The application owns error recovery. */ } };
  const focusBack = () => { if (opener?.isConnected !== false) opener?.focus?.(); };
  const closeDialog = () => { if (dialog.open) dialog.close(); };
  const safeSnapshot = result => { if (result && typeof result === "object" && !Array.isArray(result)) current = {...current, ...result}; };
  const onlineToys = () => Array.isArray(current.toys) ? current.toys.filter(toy => toy && typeof toy.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(toy.id)).slice(0, 50) : [];
  const selected = () => onlineToys().find(toy => toy.id === current.selectedId);
  const channels = () => {
    const value = selected()?.capabilities || current.channels || ["vibrate"];
    return Array.isArray(value) ? value.map(item => typeof item === "string" ? item : item?.id).filter(name => Object.hasOwn(CHANNEL_LABELS, name)) : [];
  };
  const effectiveConnected = () => current.connected === true;
  const testOutputStopped = () => current.output === 0 && current.outputKnown !== false;
  const needsReconnect = () => ["error", "disconnected", "expired"].includes(current.connectionState);
  const discovered = () => !needsReconnect() && onlineToys().length > 0;
  const testMaximum = () => Number.isInteger(current.ceiling) && current.ceiling >= 0 && current.ceiling <= 20 ? Math.min(5, current.ceiling) : 0;
  const calibration = createCalibrationView({document, mount: calibrationMount, onTest, onConfirmTest,
    onStop: stopped, onChange: onCalibrationChange, onApply: onApplyCalibration, onApplyChannels, onEnablePersonalRange,
    onModeChange: onCalibrationModeChange, onEvent: onResearchEvent,
    onComplete(result) {
      if (disposed || phase !== "calibrate") return;
      stopped(); phase = "practice";
      status.textContent = result.applied.length ? "Settings applied. Choose a story to try them with. It will open paused." : "Choose a practice story. It will open paused.";
      render();
    }});
  const calibrationContext = () => ({...current, mode, model: selected()?.model || preferredModel, channels: channels(),
    settings: current.calibration?.channels || current.calibration || {}, readingMode: current.feel?.mode});
  const openCalibration = () => {
    if (disposed) return false;
    ++epoch; stopped(); busy = false; coach.hidden = true;
    dialog.setAttribute("aria-busy", "false");
    if (!effectiveConnected() || !selected()) { phase = "connect"; render(); if (!dialog.open) dialog.showModal(); return false; }
    phase = "calibrate"; status.textContent = "";
    if (!dialog.open) dialog.showModal();
    calibration.open(calibrationContext()); render(); return true;
  };
  const refreshCoachReadiness = () => {
    const running = effectiveConnected() && current.running === true;
    start.disabled = running || !effectiveConnected() || current.canStart === false;
    if (!effectiveConnected()) coachStatus.textContent = "Disconnected. Reconnect from the playback controls, then Start when ready.";
    else if (!running && current.canStart === false) coachStatus.textContent =
      typeof current.readiness === "string" && current.readiness.trim() ? current.readiness.trim().slice(0, 240) : "Check the playback message to see when Start is ready.";
    else if (Object.values(checks).every(Boolean)) coachStatus.textContent = "All tried. Your next story will open paused.";
    else coachStatus.textContent = "";
  };
  const setBusy = value => { busy = value; render(); dialog.setAttribute("aria-busy", String(value)); };
  const resetChecks = () => {
    for (const name of Object.keys(checks)) checks[name] = false;
    initial = null; pausedAfterStart = false; coachStatus.textContent = "";
    for (const node of checkNodes.values()) node.dataset.done = "false";
  };
  const resetTest = () => { tested = false; confirmation.checked = false; testLevel.value = "1"; testReadout.textContent = "1 / 20"; };
  const leave = ({completed = false, openStory = false} = {}) => {
    if (disposed) return;
    ++epoch; phase = "closed"; setBusy(false); stopped(); closeDialog(); coach.hidden = true;
    calibration.close();
    // QR credentials are never retained by a closed dialog.
    current.qrUrl = null; qr.removeAttribute?.("src");
    if (openStory) { try { onFinish({completed}); } catch { /* Caller owns navigation. */ } } else focusBack();
  };
  const chooseMode = value => {
    if (busy || mode === value) return;
    stopped(); mode = value; resetTest(); status.textContent = ""; render();
  };
  const prepareDeviceList = () => {
    const previous = device.value || "";
    device.replaceChildren(option("", "Choose one toy…"));
    for (const toy of onlineToys()) device.append(option(toy.id, String(toy.label || toy.model || "Connected toy").slice(0, 80)));
    device.value = onlineToys().some(toy => toy.id === previous) ? previous : "";
    discoveryNote.textContent = mode === "simulator" ? "Select the simulator to practise a movement check." :
      "Choose the toy you connected in Lovense Remote. The next step shows the movements available on that toy.";
  };
  function render() {
    dialog.dataset.phase = phase;
    pairStage.hidden = !["connect", "pair", "select"].includes(phase);
    pairSummary.hidden = !quickSetup || !["pair", "select"].includes(phase);
    if (!pairSummary.hidden) pairSummary.textContent = label() + (mode === "simulator" ? " · Simulator" : " · Lovense Remote");
    chooser.hidden = phase !== "connect"; connection.hidden = phase !== "pair"; selection.hidden = phase !== "select";
    testPanel.hidden = phase !== "test"; rehearsal.hidden = quickSetup || mode !== "simulator" || !["pair", "select", "test", "calibrate"].includes(phase);
    calibrationMount.hidden = phase !== "calibrate";
    practicePicker.hidden = phase !== "practice" || !enableCalibration;
    primary.hidden = phase === "calibrate";
    skip.hidden = phase === "calibrate";
    back.hidden = ["connect", "closed", "reading"].includes(phase);
    model.disabled = busy; simMode.disabled = busy; liveMode.disabled = busy;
    simMode.setAttribute("aria-pressed", String(mode === "simulator")); liveMode.setAttribute("aria-pressed", String(mode === "lovense"));
    const maximum = testMaximum();
    device.disabled = busy; channel.disabled = busy; testLevel.disabled = busy || maximum === 0;
    testLevel.max = String(Math.max(1, maximum));
    if (maximum > 0 && Number(testLevel.value) > maximum) { testLevel.value = String(maximum); testReadout.textContent = String(maximum) + " / 20"; tested = false; confirmation.checked = false; }
    testButton.disabled = busy || maximum === 0 || !effectiveConnected() || !selected() || !channels().length;
    simFailure.disabled = busy || !effectiveConnected() || needsReconnect(); simError.disabled = busy || !effectiveConnected() || needsReconnect(); retry.disabled = busy;
    primary.disabled = busy || (phase === "select" && !device.value) || (phase === "test" &&
      (!tested || !confirmation.checked || !effectiveConnected() || !selected() || !testOutputStopped() || maximum === 0));
    confirmation.disabled = busy || !tested || !testOutputStopped() || maximum === 0;
    const simulator = mode === "simulator";
    if (phase !== "pair" || simulator) {
      qr.hidden = true;
      qr.removeAttribute?.("src");
    }
    if (phase === "connect") {
      step.textContent = quickSetup ? "Step 1 of 3 · Pair" : "01 / Choose your toy";
      heading.textContent = quickSetup ? "Pair your toy" : "Set up your toy";
      intro.textContent = "Connect a toy through Lovense Remote or try the controls with a simulator.";
      primary.textContent = simulator ? "Connect " + label() + " simulator" : canConnectLive() ? "Connect " + label() : "Sign in to connect " + label();
    } else if (phase === "pair") {
      step.textContent = quickSetup ? "Step 1 of 3 · Pair" : "02 / Connect";
      heading.textContent = quickSetup ? "Pair your toy" : simulator ? "Connect the simulator" : "Pair your toy in Lovense Remote";
      intro.textContent = simulator ? "Reconnect to practise selecting a toy, checking a movement and trying the reader controls." :
        "Keep this page open on one screen while you use Lovense Remote on your phone.";
      const source = simulator ? null : qrSource(current.qrUrl);
      connectionBadge.textContent = simulator ? "SIMULATED · " + label() :
        current.liveConfigured === false ? "CONNECTION UNAVAILABLE" : source ? "SCAN THE CODE" : "GETTING YOUR CODE";
      instructions.replaceChildren();
      for (const text of simulator ? ["Choose the simulator when it appears in the device list.", "Run a short movement check, then try the practice read."] :
        ["Turn on your toy and enable Bluetooth on your phone.", "Open Lovense Remote and check that the toy shows as connected.", "Open the QR scanner in Lovense Remote and scan the code on this page.", "Keep Lovense Remote open. When your toy appears here, select it."]) instructions.append(make("li", {value: text}));
      qr.hidden = !source;
      if (source) qr.src = source;
      else qr.removeAttribute?.("src");
      qrPlaceholder.hidden = Boolean(source); qrPlaceholder.textContent = simulator ? "SIMULATION · No QR scan needed" :
        current.liveConfigured === false ? "Live connection is not configured yet." : "Waiting for your private pairing code…";
      pairingNote.textContent = current.liveConfigured === false && !simulator ?
        "The site owner needs to finish the Lovense setup. You can go back and try a simulator." :
        simulator ? "Choose Reconnect to load the simulator again." : "Keep the code private. If the toy does not appear after scanning, choose Refresh device list.";
      primary.textContent = needsReconnect() ? "Reconnect" : "Refresh device list";
      primary.disabled = busy || (!simulator && current.liveConfigured === false);
    } else if (phase === "select") {
      step.textContent = quickSetup ? "Step 1 of 3 · Pair" : "03 / Choose your toy";
      heading.textContent = quickSetup ? "Pair your toy" : "Choose the toy to use";
      intro.textContent = simulator ? "Select the simulator to continue." : "Select one connected toy. It stays paused until you run the movement check.";
      primary.textContent = "Use this toy";
    } else if (phase === "test") {
      step.textContent = quickSetup ? "Step 2 of 3 · Quick test" : "04 / Check a movement";
      heading.textContent = quickSetup ? "Check your toy’s movements" : "Try a two-second test";
      intro.textContent = quickSetup ? "Run one quick test to check each available movement at level 1. Each movement runs for two seconds, with a short pause between checks." :
        "Start at level 1. Watch or feel for two seconds of movement, then check that it stops before you continue.";
      testMaximumNote.textContent = maximum === 0 ? "Testing is off at maximum 0. Close setup, adjust Maximum in the playback bar, then reopen setup." :
        quickSetup ? "Movements: " + channels().map(name => CHANNEL_LABELS[name]).join(", ") + "." :
          "Current maximum: " + current.ceiling + "/20. This short test can use levels 1 to " + maximum + ".";
      testNote.textContent = simulator ? "Watch the simulated level return to zero before confirming." :
        "Place your toy where you can see or feel it move. Keep Lovense Remote or the toy’s Stop control within reach.";
      const movement = CHANNEL_LABELS[channel.value]?.toLowerCase() || "the selected movement";
      confirmationText.textContent = quickSetup ? (simulator ? "I saw the level change for each movement and return to zero." :
        "I saw or felt each movement and checked it stopped.") : simulator ? "I saw the simulated level return to zero." :
          "I saw or felt " + movement + " and checked that the toy stopped.";
      if (quickSetup) testButton.textContent = tested ? "Run the test again" : "Run quick test";
      capabilityNote.textContent = quickSetup ? (channels().length > 1 && current.supportsCombined !== true ?
        "This connection uses one movement at a time. The test checks each one so you can choose among them in Advanced controls." : "") :
        getToyProfile(selected()?.model || preferredModel)?.physicalNotes || "";
      capabilityNote.hidden = !capabilityNote.textContent;
      primary.textContent = quickSetup ? "Open advanced controls" : enableCalibration ? "Set my movement preferences" : "Continue to practice";
    } else if (phase === "practice") {
      step.textContent = "05 / A short practice read"; heading.textContent = "Make it feel like you.";
      intro.textContent = "Try scrolling, the level buttons, maximum and Stop with a short neutral story before importing your own.";
      primary.textContent = "Open practice story";
      const choice = SETUP_STORIES.find(story => story.betaId === practiceStory.value) || SETUP_STORIES[0];
      practiceDescription.textContent = choice.description;
    } else if (phase === "calibrate") {
      step.textContent = "04 / Movement preferences"; heading.textContent = "Set your movement preferences";
      intro.textContent = "Choose the movements to use and adjust each one on this page.";
    }
    const output = Number.isInteger(current.output) && current.outputKnown !== false ?
      Math.min(20, Math.max(0, current.output)) + " / 20" : "unconfirmed";
    liveLevel.textContent = (simulator ? "Simulator level " : "Test level ") + output;
  }
  const enterPairOrSelect = () => {
    phase = discovered() ? "select" : "pair";
    if (phase === "select") prepareDeviceList();
    render();
  };
  const connect = async () => {
    if (mode === "lovense" && !canConnectLive()) {
      const options = {mode, model: preferredModel};
      leave(); onLiveSignIn(options); return;
    }
    const activeEpoch = ++epoch; device.value = ""; setBusy(true); status.textContent = mode === "simulator" ? "Connecting simulator…" : "Preparing a private Lovense connection…";
    try {
      const result = await onConnect({mode, model: preferredModel});
      if (activeEpoch !== epoch || disposed || !dialog.open) return;
      if (result === false) throw new Error();
      safeSnapshot(result); resetTest(); status.textContent = ""; enterPairOrSelect();
    } catch {
      if (activeEpoch !== epoch || disposed) return;
      status.textContent = mode === "simulator" ? "The simulator could not connect. Try again or keep reading." :
        "The connection could not start. Check sign-in and Lovense setup, then try again. You can use a simulator while this is resolved.";
      if (mode === "lovense" && current.liveConfigured === false) phase = "pair";
    } finally { if (activeEpoch === epoch && !disposed) setBusy(false); }
  };
  primary.addEventListener("click", async () => {
    if (busy || disposed) return;
    if (phase === "connect") { await connect(); return; }
    if (phase === "pair") {
      if (needsReconnect()) { await connect(); return; }
      const activeEpoch = ++epoch; setBusy(true); status.textContent = "Checking connection…";
      try {
        const result = await onRefresh();
        if (activeEpoch !== epoch || disposed || !dialog.open) return;
        safeSnapshot(result); enterPairOrSelect();
        status.textContent = phase === "select" ? "Toy found. Select it to continue." : "Your toy hasn’t appeared yet. Check Lovense Remote, then refresh this list.";
      } catch { if (activeEpoch === epoch) status.textContent = "Could not refresh. Check Lovense Remote and try again."; }
      finally { if (activeEpoch === epoch && !disposed) setBusy(false); }
      return;
    }
    if (phase === "select") {
      const id = device.value;
      if (!onlineToys().some(toy => toy.id === id)) return;
      const activeEpoch = ++epoch; setBusy(true); stopped();
      try {
        const result = await onSelectDevice(id);
        if (activeEpoch !== epoch || disposed || !dialog.open) return;
        safeSnapshot(result);
        if (result === false || current.selectedId !== id || !effectiveConnected()) throw new Error();
        if (enableCalibration && !quickSetup) { openCalibration(); return; }
        resetTest(); channel.replaceChildren(...channels().map(name => option(name, CHANNEL_LABELS[name])));
        channel.value = channels()[0] || ""; phase = "test"; status.textContent = "Ready for the movement check.";
      } catch { if (activeEpoch === epoch) status.textContent = "Selection did not complete. Refresh the connection and choose a toy again."; }
      finally { if (activeEpoch === epoch && !disposed) setBusy(false); }
      return;
    }
    if (phase === "test") {
      if (!tested || !confirmation.checked || !effectiveConnected() || !selected() || !testOutputStopped() || testMaximum() === 0) return;
      if (quickSetup) {
        const activeEpoch = ++epoch;
        setBusy(true);
        try {
          const confirmed = await onConfirmQuickTest();
          if (activeEpoch !== epoch || disposed || !dialog.open) return;
          if (!confirmed) throw new Error();
          leave(); onOpenAdvanced();
        } catch {
          if (activeEpoch !== epoch || disposed) return;
          resetTest(); status.textContent = "The movement check could not be confirmed. Run the quick test again.";
        } finally { if (activeEpoch === epoch && !disposed) setBusy(false); }
        return;
      }
      let confirmed = false;
      try { confirmed = onConfirmTest() === true; } catch { /* Connection may have changed while confirming. */ }
      if (!confirmed) {
        tested = false; confirmation.checked = false;
        status.textContent = "The test confirmation is no longer current. Select the toy and repeat its test before continuing."; render(); return;
      }
      stopped();
      phase = "practice"; status.textContent = "The test read opens paused. Start only when ready."; render(); return;
    }
    if (phase !== "practice") return;
    const activeEpoch = ++epoch; setBusy(true); status.textContent = "Opening practice story…";
    try {
      const story = enableCalibration ? SETUP_STORIES.find(story => story.betaId === practiceStory.value) || SETUP_STORIES[0] : PRACTICE_STORY;
      const result = await onPractice(story);
      if (activeEpoch !== epoch || disposed || !dialog.open) return;
      if (result === false) throw new Error();
      resetChecks(); phase = "reading"; initial = {position: current.position, levelAdjustment: current.levelAdjustment, ceiling: current.ceiling};
      closeDialog(); coach.hidden = false; refreshCoachReadiness(); coachHeading.focus({preventScroll: true});
    } catch { if (activeEpoch === epoch && !disposed) status.textContent = "The practice story could not open. Your other stories are unchanged. Try again."; }
    finally { if (activeEpoch === epoch && !disposed) setBusy(false); }
  });
  testButton.addEventListener("click", async () => {
    if (busy || phase !== "test" || !selected() || !quickSetup && !channels().includes(channel.value)) return;
    const level = quickSetup ? 1 : Number(testLevel.value);
    if (!Number.isInteger(level) || level < 1 || level > testMaximum()) return;
    if (quickSetup && tested) stopped();
    const activeEpoch = ++epoch; setBusy(true); tested = false; confirmation.checked = false;
    status.textContent = mode === "simulator" ? "Running the simulated test…" : "Running the short test. Watch for movement and check that it stops.";
    try {
      const result = quickSetup ? await onQuickTest({onMovement({channel: name, index, total}) {
        if (activeEpoch === epoch) status.textContent = `Checking ${CHANNEL_LABELS[name]} (${index + 1} of ${total})…`;
      }}) : await onTest({channel: channel.value, level});
      if (activeEpoch !== epoch || disposed || phase !== "test") return;
      safeSnapshot(result);
      if (result === false || !effectiveConnected() || !selected()) throw new Error();
      tested = true;
      status.textContent = quickSetup ? "Test complete. Confirm each movement worked and stopped, or run the test again." :
        mode === "simulator" ? "Test complete. Check the simulated level and confirm below." :
          "Test complete. Confirm below once you have checked the movement and the physical stop.";
    } catch { if (activeEpoch === epoch && !disposed) status.textContent = "The test was not confirmed. Stop, check the connection and retry. Nothing will restart automatically."; }
    finally { if (activeEpoch === epoch && !disposed) setBusy(false); }
  });
  testLevel.addEventListener("input", () => {
    if (busy) return;
    tested = false; confirmation.checked = false;
    testReadout.textContent = String(testLevel.value) + " / 20"; render();
  });
  confirmation.addEventListener("change", render); device.addEventListener("change", render);
  channel.addEventListener("change", () => { stopped(); resetTest(); render(); });
  model.addEventListener("change", () => {
    if (busy || !SETUP_MODELS.some(toy => toy.id === model.value)) return;
    stopped(); preferredModel = model.value; resetTest(); render();
  });
  simMode.addEventListener("click", () => chooseMode("simulator")); liveMode.addEventListener("click", () => chooseMode("lovense"));
  back.addEventListener("click", () => { ++epoch; phase = "connect"; calibration.close(); stopped(); resetTest(); setBusy(false); status.textContent = ""; });
  practiceStory.addEventListener("change", () => { if (!busy) render(); });
  retry.addEventListener("click", connect);
  const simulate = async kind => {
    if (busy || mode !== "simulator") return;
    const activeEpoch = ++epoch; stopped(); resetTest();
    try {
      const result = await onSimulateFailure(kind);
      if (activeEpoch !== epoch || disposed || !dialog.open) return;
      safeSnapshot(result);
    } catch { if (activeEpoch !== epoch || disposed || !dialog.open) return; }
    phase = "pair"; status.textContent = "Simulated connection interrupted. Reconnect, select the toy again and restart deliberately."; render();
  };
  simFailure.addEventListener("click", () => simulate("disconnect"));
  simError.addEventListener("click", () => simulate("error"));
  close.addEventListener("click", () => leave()); skip.addEventListener("click", () => leave());
  stop.addEventListener("click", () => { ++epoch; if (quickSetup) resetTest(); setBusy(false); stopped(); if (phase === "calibrate") calibration.interrupt(); status.textContent = "Stopped. You can continue setup when ready."; });
  coachStop.addEventListener("click", () => { stopped(); coachStatus.textContent = "Stopped. Start again when you are ready."; });
  start.addEventListener("click", () => {
    if (phase !== "reading" || disposed) return;
    try { onStart(); } catch { coachStatus.textContent = "Start is not ready yet. Check the message beside the playback controls."; }
  });
  finishButton.addEventListener("click", () => leave({completed: Object.values(checks).every(Boolean), openStory: true}));
  dialog.addEventListener("cancel", event => { event.preventDefault(); leave(); });
  dialog.addEventListener("close", () => { if (!["closed", "reading"].includes(phase)) leave(); });

  return {
    open(options = {}) {
      if (disposed) return;
      ++epoch; stopped(); coach.hidden = true; opener = document.activeElement;
      calibration.close();
      if (options.mode === "simulator" || options.mode === "lovense") mode = options.mode;
      if (SETUP_MODELS.some(toy => toy.id === options.model)) preferredModel = options.model;
      model.value = preferredModel; resetChecks(); resetTest(); phase = "connect"; setBusy(false); status.textContent = "";
      if (!dialog.open) dialog.showModal(); model.focus();
    },
    update(snapshot = {}) {
      const previousConnected = effectiveConnected(), previousSelectedId = current.selectedId; current = {...current, ...snapshot};
      if (Object.hasOwn(snapshot, "canStart") && !Object.hasOwn(snapshot, "readiness")) current.readiness = "";
      if (disposed) return;
      if (["pair", "select"].includes(phase) && discovered()) {
        if (phase === "pair") phase = "select"; prepareDeviceList();
      }
      if (["select", "test", "calibrate", "practice"].includes(phase) && (previousConnected && !effectiveConnected() || needsReconnect())) {
        ++epoch; busy = false; phase = "pair"; calibration.close(); device.value = ""; stopped(); resetTest(); status.textContent = "Connection lost. Reconnect and select your toy again. Playback stays paused.";
      }
      if (["test", "calibrate", "practice"].includes(phase) && previousSelectedId && (current.selectedId !== previousSelectedId || !selected())) {
        ++epoch; busy = false; phase = discovered() ? "select" : "pair";
        calibration.close();
        device.value = ""; stopped(); resetTest(); if (phase === "select") prepareDeviceList();
        status.textContent = "The selected toy changed. Choose a connected toy and repeat its test before continuing.";
      }
      render();
      if (phase === "calibrate") calibration.update(calibrationContext());
      if (phase !== "reading") return;
      if (!initial) initial = {position: current.position, levelAdjustment: current.levelAdjustment, ceiling: current.ceiling};
      const running = effectiveConnected() && current.running === true;
      if (running) { checks.started = true; if (pausedAfterStart) checks.restart = true; } else if (checks.started) pausedAfterStart = true;
      if (Number.isInteger(current.position) && current.position !== initial.position) checks.position = true;
      if (Number.isInteger(current.levelAdjustment) && current.levelAdjustment !== initial.levelAdjustment) checks.level = true;
      if (Number.isInteger(current.ceiling) && current.ceiling !== initial.ceiling) checks.maximum = true;
      for (const [name, node] of checkNodes) {
        node.dataset.done = String(checks[name]); node.setAttribute("aria-label", node.textContent + (checks[name] ? ": tried" : ": not tried yet"));
      }
      refreshCoachReadiness();
    },
    finish() { leave({completed: Object.values(checks).every(Boolean), openStory: true}); },
    openCalibration,
    calibrationSnapshot() { return calibration.snapshot(); },
    cancel() { leave(); },
    snapshot() { return {active: phase !== "closed", phase, busy, mode, model: preferredModel, selectedId: current.selectedId || null, tested, checks: {...checks}}; },
    destroy() { if (disposed) return; leave(); disposed = true; calibration.destroy(); dialog.remove?.(); coach.remove?.(); },
  };
}
