// Software setup only. Device transport remains disconnected from the reader.
// Practice opens a session-only story through the application's normal loader;
// it never starts playback or persists controls on the reader's behalf.
export const PRACTICE_STORY = Object.freeze({
  title: "Find your rhythm",
  text: [
    "The reading room was quiet. Sunlight crossed the floor and the first pages waited on the table. Begin here with a quiet section: the preview should be still, even after you press Start.",
    "The station clock moved towards the hour. Beyond the window a train approached, slowly at first, its lights appearing through the evening haze. Scroll to this section and watch the preview begin to move.",
    "The train gathered speed. The landscape changed from fields to woodland and back again, its rhythm growing stronger. Try the strength buttons and move the maximum. The preview follows the output shown in the controls.",
    "The carriage slowed beside a small platform. A traveller folded a letter and looked towards the door. Read this part more slowly. Stop scrolling for a moment, then move back to the previous section if you want to compare the change.",
    "A whistle sounded and the journey continued. Lights flickered past the window, then faded into the distance. Try a quicker scroll, then Pause or Stop. Restart only when you are ready; changing a control while paused will not start playback.",
    "At the final station everything became quiet again. The book rested beside the window. When the controls feel comfortable, finish setup and open a story of your own.",
  ].join("\n\n"),
  corrections: Object.freeze([0, 2, 4, 1, 3, 0]),
});

export function createSetupFlow({document = globalThis.document, window = globalThis.window,
  coachMount = null, onConnect = () => false, onPractice = () => false,
  onStart = () => {}, onStop = () => {}, onFinish = () => {}} = {}) {
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
  const dialog = make("dialog", {id: "setup-dialog", className: "setup-dialog", attrs: {"aria-labelledby": "setup-heading"}});
  const header = make("div", {className: "setup-dialog-heading"});
  const headingBlock = make("div");
  const step = make("span", {className: "setup-step-label", value: "01 / Choose a connection"});
  const heading = make("h2", {id: "setup-heading", value: "Try the feeling, first."});
  headingBlock.append(step, heading);
  const close = button("setup-close", "×", "icon-button"); close.setAttribute("aria-label", "Close setup");
  header.append(headingBlock, close);
  const intro = make("p", {id: "setup-intro", value: "Get to know the controls with a short practice story."});
  const simulatorOption = make("div", {className: "setup-option"});
  simulatorOption.append(make("strong", {value: "Try the simulator"}),
    make("p", {className: "note", value: "See the output move on screen. You do not need a toy or an account."}));
  const realOption = make("div", {className: "setup-unavailable"});
  realOption.append(make("strong", {value: "Connect your toy · coming later"}),
    make("p", {className: "note", value: "Real toy connections are still in development. This setup uses a simulator."}));
  const status = make("p", {id: "setup-status", className: "note setup-status", attrs: {role: "status", "aria-live": "polite"}});
  const actions = make("div", {className: "setup-dialog-actions"});
  const stop = button("setup-stop", "Stop", "stop");
  const skip = button("setup-skip", "Skip for now");
  const primary = button("setup-primary", "Connect simulator", "primary");
  actions.append(stop, skip, primary); dialog.append(header, intro, simulatorOption, realOption, status, actions);
  document.body.append(dialog);

  const coach = make("section", {id: "setup-coach", className: `setup-coach${coachMount ? "" : " setup-coach-floating"}`,
    attrs: {"aria-labelledby": "setup-coach-heading"}});
  coach.hidden = true;
  const coachHeading = make("h3", {id: "setup-coach-heading", value: "Find what feels right.", attrs: {tabindex: "-1"}});
  coach.append(make("span", {className: "setup-step-label", value: "03 / Your test read"}),
    coachHeading,
    make("p", {value: "Start the practice story, then try the controls below. These are practice levels, not story analysis."}));
  const checks = {started: false, position: false, strength: false, maximum: false, restart: false};
  const checklist = make("ul", {className: "setup-checklist"});
  const checkNodes = new Map();
  for (const [name, label] of [["started", "Start the simulator"], ["position", "Move through the story"],
    ["strength", "Try + and − strength"], ["maximum", "Adjust the maximum"], ["restart", "Stop or pause, then restart"]]) {
    const item = make("li", {value: label}); item.dataset.done = "false";
    checkNodes.set(name, item); checklist.append(item);
  }
  const coachActions = make("div", {className: "setup-coach-actions"});
  const start = button("setup-start", "Start", "primary");
  const coachStop = button("setup-coach-stop", "Stop", "stop");
  const finishButton = button("setup-finish", "Done — open my story");
  coachActions.append(start, coachStop, finishButton);
  const coachStatus = make("p", {id: "setup-coach-status", className: "setup-coach-status", attrs: {role: "status", "aria-live": "polite"}});
  coach.append(checklist, coachActions, coachStatus); (coachMount || document.body).append(coach);

  let current = {}, phase = "closed", epoch = 0, busy = false, disposed = false, opener = null;
  let initial = null, pausedAfterStart = false;
  const refreshCoachReadiness = () => {
    const running = current.connected === true && current.running === true;
    start.disabled = running || current.connected !== true || current.canStart === false;
    if (current.connected !== true) coachStatus.textContent = "Simulator disconnected. Reconnect with the playback controls, then Start when ready.";
    else if (!running && current.canStart === false) coachStatus.textContent =
      typeof current.readiness === "string" && current.readiness.trim() ? current.readiness.trim().slice(0, 240) :
        "Check the playback message to see when Start is ready.";
    else if (Object.values(checks).every(Boolean)) coachStatus.textContent = "All tried. Your next story will open paused.";
    else coachStatus.textContent = "";
  };
  const stopped = () => { try { onStop(); } catch { /* The application owns error recovery. */ } };
  const focusBack = () => { if (opener?.isConnected !== false) opener?.focus?.(); };
  const closeDialog = () => { if (dialog.open) dialog.close(); };
  const setBusy = value => {
    busy = value; primary.disabled = value; dialog.setAttribute("aria-busy", String(value));
    // Stop, close and skip remain available while a callback is pending.
  };
  const resetChecks = () => {
    for (const name of Object.keys(checks)) checks[name] = false;
    initial = null; pausedAfterStart = false; coachStatus.textContent = "";
    for (const node of checkNodes.values()) node.dataset.done = "false";
  };
  const leave = ({completed = false, openStory = false} = {}) => {
    if (disposed) return;
    ++epoch; setBusy(false); phase = "closed"; stopped(); closeDialog(); coach.hidden = true;
    if (openStory) { try { onFinish({completed}); } catch { /* Caller owns navigation. */ } }
    else focusBack();
  };
  const connectStep = () => {
    phase = "connect";
    step.textContent = "01 / Choose a connection"; heading.textContent = "Try the feeling, first.";
    intro.textContent = "Get to know the controls with a short practice story.";
    simulatorOption.hidden = false; realOption.hidden = false;
    primary.textContent = current.connected ? "Use simulator" : "Connect simulator";
    status.textContent = "";
  };
  const practiceStep = () => {
    phase = "practice"; step.textContent = "02 / A short practice read";
    heading.textContent = "Make it feel like you.";
    intro.textContent = "The practice story changes pace so you can see the preview respond as you scroll. Try strength, maximum and Stop before opening your own story.";
    simulatorOption.hidden = true; realOption.hidden = true;
    primary.textContent = "Open practice story";
    status.textContent = "Simulator connected. Playback is paused.";
  };
  primary.addEventListener("click", async () => {
    if (busy || disposed) return;
    const activeEpoch = ++epoch, activePhase = phase;
    setBusy(true); status.textContent = activePhase === "connect" ? "Connecting simulator…" : "Opening practice story…";
    try {
      const result = await (activePhase === "connect" ? onConnect() : onPractice(PRACTICE_STORY));
      if (activeEpoch !== epoch || disposed || !dialog.open) return;
      if (result === false) throw new Error();
      if (activePhase === "connect") practiceStep();
      else {
        resetChecks(); phase = "reading"; initial = {position: current.position, strength: current.strength, ceiling: current.ceiling};
        closeDialog(); coach.hidden = false; refreshCoachReadiness(); coachHeading.focus({preventScroll: true});
      }
    } catch {
      if (activeEpoch !== epoch || disposed) return;
      status.textContent = activePhase === "connect" ? "The simulator could not connect. Try again or keep reading." :
        "The practice story could not open. Your other stories are unchanged. Try again.";
    } finally { if (activeEpoch === epoch && !disposed) setBusy(false); }
  });
  close.addEventListener("click", () => leave()); skip.addEventListener("click", () => leave());
  stop.addEventListener("click", () => { ++epoch; setBusy(false); stopped(); status.textContent = "Stopped. You can continue setup when ready."; });
  coachStop.addEventListener("click", () => { stopped(); coachStatus.textContent = "Stopped. Start again when you are ready."; });
  start.addEventListener("click", () => {
    if (phase !== "reading" || disposed) return;
    try { onStart(); } catch { coachStatus.textContent = "Start is not ready yet. Check the message beside the playback controls."; }
  });
  finishButton.addEventListener("click", () => leave({completed: Object.values(checks).every(Boolean), openStory: true}));
  dialog.addEventListener("cancel", event => { event.preventDefault(); leave(); });
  dialog.addEventListener("close", () => {
    // Native close not initiated by the flow must cancel pending asynchronous work.
    if (phase === "connect" || phase === "practice") leave();
  });

  return {
    open() {
      if (disposed) return;
      ++epoch; stopped(); setBusy(false); coach.hidden = true; opener = document.activeElement;
      resetChecks(); connectStep(); if (!dialog.open) dialog.showModal(); primary.focus();
    },
    update(snapshot = {}) {
      current = snapshot;
      if (phase !== "reading" || disposed) return;
      if (!initial) initial = {position: current.position, strength: current.strength, ceiling: current.ceiling};
      const running = current.connected === true && current.running === true;
      if (running) {
        checks.started = true;
        if (pausedAfterStart) checks.restart = true;
      } else if (checks.started) pausedAfterStart = true;
      if (Number.isInteger(current.position) && current.position !== initial.position) checks.position = true;
      if (Number.isFinite(current.strength) && current.strength !== initial.strength) checks.strength = true;
      if (Number.isInteger(current.ceiling) && current.ceiling !== initial.ceiling) checks.maximum = true;
      for (const [name, node] of checkNodes) {
        node.dataset.done = String(checks[name]);
        node.setAttribute("aria-label", `${node.textContent}${checks[name] ? ": tried" : ": not tried yet"}`);
      }
      refreshCoachReadiness();
    },
    finish() { leave({completed: Object.values(checks).every(Boolean), openStory: true}); },
    cancel() { leave(); },
    snapshot() { return {active: phase !== "closed", phase, busy, checks: {...checks}}; },
    destroy() {
      if (disposed) return;
      leave(); disposed = true; dialog.remove?.(); coach.remove?.();
    },
  };
}
