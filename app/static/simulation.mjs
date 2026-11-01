import { SimulationClock } from "./simulation/clock.mjs";
import { ScenarioTransport } from "./simulation/transport.mjs";
import { SIMULATION_SCENARIOS, simulationScenario } from "./simulation/scenarios.mjs";
import { AsyncPlaybackController } from "./playback/async-controller.mjs";
import { HostedAccessGuard } from "./access.mjs";

const $ = id => document.getElementById(id);
const hosted = document.querySelector('meta[name="satinlore-hosted-access"]')?.content === "true";
let current = null, trace = [], timer = null, advancing = false, startIntent = null, ceilingIntent = null, mapping = 0;
let accessAllowed = !hosted, simulatedHidden = false;
const write = (id, value) => { $(id).textContent = String(value); };
function record(event) {
  trace.push(event); if (trace.length > 120) trace.shift();
  const fragment = document.createDocumentFragment();
  for (const row of trace.slice().reverse()) {
    const li = document.createElement("li");
    li.textContent = `${(row.at / 1000).toFixed(3)} s · ${row.type} · ${row.kind || "state"} · ${row.deviceId || "—"} · ${row.operationId || "—"} · generation ${row.generation ?? "—"}${row.level === undefined ? "" : ` · ${row.level}/20`}`;
    fragment.append(li);
  }
  $("lab-trace").replaceChildren(fragment);
}
function render() {
  if (!current) return;
  const { controller, clock, transport } = current, state = controller.snapshot();
  write("lab-time", `${(clock.now() / 1000).toFixed(3)} s`); write("lab-state", state.state); write("lab-reason", state.reason);
  write("lab-target", `${state.target} / 20`); write("lab-output", state.outputKnown ? `${state.output} / 20` : "Unknown");
  write("lab-fixture-output", `${transport.output(state.selectedDeviceId)} / 20`); write("lab-stale", state.staleReplies);
  write("lab-dock-status", state.state === "PLAYING" ? `Playing · ${state.target}/20 target` : state.state.replaceAll("_", " ").toLowerCase());
  $("lab-uncertainty").hidden = state.outputKnown; $("lab-state").closest("section").classList.toggle("is-unknown", !state.outputKnown);
  $("lab-start").disabled = !accessAllowed || !state.canStart;
  $("lab-connect").disabled = !state.selectedDeviceId || !accessAllowed || state.state === "CONNECTING" || simulatedHidden;
  $("lab-cancel").disabled = state.state !== "CONNECTING";
  $("lab-disconnect").disabled = !state.selectedDeviceId;
  $("lab-hide").setAttribute("aria-pressed", String(simulatedHidden)); write("lab-hide", simulatedHidden ? "Return simulated tab" : "Hide simulated tab");
}
function sections() {
  const fragment = document.createDocumentFragment();
  current.controller.levels.forEach((value, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = `Section ${index + 1} · ${value}/20`; fragment.append(option); });
  $("lab-section").replaceChildren(fragment); $("lab-section").value = String(current.controller.snapshot().position);
  $("lab-level").value = String(current.controller.levels[current.controller.snapshot().position]);
}
function closeDialogs() { startIntent = ceilingIntent = null; for (const id of ["lab-start-dialog", "lab-ceiling-dialog"]) if ($(id).open) $(id).close(); }
function clockOff() { clearInterval(timer); timer = null; $("lab-clock-run").setAttribute("aria-pressed", "false"); write("lab-clock-run", "Run virtual time"); }
function reset() {
  clockOff(); closeDialogs();
  current?.controller.destroy(); current?.transport.dispose(); current?.clock.clear();
  const scenario = simulationScenario($("scenario").value), clock = new SimulationClock();
  trace = []; $("lab-trace").replaceChildren(); simulatedHidden = false; mapping = 0;
  const transport = new ScenarioTransport({ clock, options: scenario.options, onEvent: record });
  const controller = new AsyncPlaybackController({ transport, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onChange: render, onEvent: record });
  current = { clock, controller, transport }; controller.authorized = accessAllowed; controller.setStory([2, 3, 4, 0, 20]);
  write("scenario-description", scenario.description);
  const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Choose a device explicitly";
  $("lab-device").replaceChildren(placeholder);
  for (const device of controller.devices()) {
    const option = document.createElement("option"); option.value = device.id; option.textContent = device.name + (device.vibration ? "" : " · unsupported"); option.disabled = !device.vibration; $("lab-device").append(option);
  }
  write("device-description", controller.devices().length ? "Nothing is selected. Choose one eligible simulated device." : "No simulated devices were discovered.");
  $("lab-strength").value = "1"; $("lab-ceiling").value = "5"; sections(); render();
}
async function advance(milliseconds) {
  if (advancing || !current) return;
  advancing = true; const owner = current;
  try { await owner.clock.advance(milliseconds); }
  catch { clockOff(); void owner.controller.pause("The fixture could not advance. Reset the scenario."); }
  finally { advancing = false; render(); }
}
function stop() { closeDialogs(); void current.controller.stop(); }
function action(fn) { try { fn(); } catch (error) { write("lab-reason", error instanceof Error ? error.message : "Reset the scenario and try again."); } }
for (const item of SIMULATION_SCENARIOS) { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; $("scenario").append(option); }
$("scenario").addEventListener("change", reset); $("reset-scenario").addEventListener("click", reset);
$("lab-device").addEventListener("change", () => action(() => { closeDialogs(); if (!$("lab-device").value) { current.controller.clearSelection(); write("device-description", "No device is selected."); return; } current.controller.selectDevice($("lab-device").value); write("device-description", `Selected: ${current.controller.devices().find(device => device.id === $("lab-device").value)?.name}. No physical device is connected.`); }));
$("lab-connect").addEventListener("click", () => { closeDialogs(); void current.controller.connect(); });
$("lab-disconnect").addEventListener("click", () => { closeDialogs(); void current.controller.disconnect(); });
$("lab-cancel").addEventListener("click", stop); $("lab-stop").addEventListener("click", stop); $("lab-pause").addEventListener("click", () => { closeDialogs(); void current.controller.pause(); });
for (const button of document.querySelectorAll("[data-lab-stop]")) button.addEventListener("click", stop);
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => { closeDialogs(); void current.controller.pause("Confirmation cancelled. Playback stays paused."); });
for (const id of ["lab-start-dialog", "lab-ceiling-dialog"]) {
  $(id).addEventListener("cancel", event => { event.preventDefault(); closeDialogs(); void current.controller.pause("Confirmation cancelled. Playback stays paused."); });
  $(id).addEventListener("close", () => { if (startIntent || ceilingIntent) { startIntent = ceilingIntent = null; void current.controller.pause("Confirmation closed. Playback stays paused."); } });
}
for (const button of document.querySelectorAll("[data-advance]")) button.addEventListener("click", () => void advance(Number(button.dataset.advance)));
$("lab-clock-run").addEventListener("click", () => { if (timer) { clockOff(); return; } timer = setInterval(() => void advance(100), 100); $("lab-clock-run").setAttribute("aria-pressed", "true"); write("lab-clock-run", "Pause virtual clock"); });
$("lab-section").addEventListener("change", () => action(() => { current.controller.setPosition(Number($("lab-section").value)); current.controller.activity(); $("lab-level").value = String(current.controller.levels[current.controller.snapshot().position]); }));
$("apply-level").addEventListener("click", () => action(() => { current.controller.setLevel(current.controller.snapshot().position, Number($("lab-level").value)); sections(); }));
$("apply-strength").addEventListener("click", () => action(() => current.controller.setStrength(Number($("lab-strength").value))));
$("apply-ceiling").addEventListener("click", () => action(() => { const value = Number($("lab-ceiling").value); if (value <= current.controller.snapshot().ceiling) { current.controller.setCeiling(value); return; } ceilingIntent = current.controller.prepareCeiling(value); write("lab-ceiling-summary", `Change the simulated maximum from ${ceilingIntent.expected}/20 to ${value}/20?`); $("lab-ceiling-dialog").showModal(); }));
$("lab-confirm-ceiling").addEventListener("click", () => { const intent = ceilingIntent; closeDialogs(); action(() => current.controller.confirmCeiling(intent)); });
$("lab-story").addEventListener("click", () => { closeDialogs(); mapping = 1 - mapping; current.controller.setStory(mapping ? [1, 0, 5] : [2, 3, 4, 0, 20]); $("lab-strength").value = "1"; sections(); });
$("lab-activity").addEventListener("click", () => current.controller.activity());
$("lab-hide").addEventListener("click", () => { closeDialogs(); simulatedHidden = !simulatedHidden; current.controller.setVisible(!simulatedHidden && !document.hidden); });
$("lab-start").addEventListener("click", () => { startIntent = current.controller.prepareStart(); if (!startIntent) return; write("lab-start-summary", `${current.controller.devices().find(device => device.id === startIntent.deviceId)?.name} · maximum ${startIntent.ceiling}/20 · strength ${startIntent.strength.toFixed(1)}× · current target ${startIntent.target}/20.`); $("lab-start-dialog").showModal(); });
$("lab-confirm-start").addEventListener("click", async () => {
  const owner = current, intent = startIntent;
  $("lab-confirm-start").disabled = true;
  try { if (hosted && !await guard.check({ fresh: true })) return; if (owner !== current || intent !== startIntent || !$("lab-start-dialog").open) return; closeDialogs(); owner.controller.start(intent); }
  finally { $("lab-confirm-start").disabled = false; }
});
$("clear-trace").addEventListener("click", () => { trace = []; $("lab-trace").replaceChildren(); });
const guard = hosted ? new HostedAccessGuard({ onChange: state => { accessAllowed = state.allowed; current?.controller.setAuthorized(accessAllowed); write("lab-access", state.allowed ? "Founder sign-in checked. This is still a simulation, with no physical output." : "Checking founder sign-in. Start remains unavailable until access is verified."); }, onLost: reason => { closeDialogs(); current?.controller.setAuthorized(false); write("lab-access", `${reason} Reload this page to sign in again. No story data is held by this lab.`); } }) : null;
document.addEventListener("visibilitychange", () => { closeDialogs(); if (document.hidden) { clockOff(); current.controller.setVisible(false); guard?.suspend(); } else { current.controller.setVisible(!simulatedHidden); if (guard) void guard.resume(); } });
window.addEventListener("pagehide", () => { clockOff(); current?.controller.destroy(); guard?.destroy(); });
reset(); if (guard) void guard.start({ visible: !document.hidden });
