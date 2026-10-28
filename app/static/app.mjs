import {MockDevice} from "./devices/mock.mjs";
import {TextImporter, splitText} from "./reader/import.mjs";

const $ = id => document.getElementById(id);
const device = new MockDevice();
const importer = new TextImporter();
let paragraphs = [];
let levels = [];
let current = 0;
let running = false;
let heartbeat = null;

function show(message) { $("message").textContent = message; }
function display() {
  const state = device.snapshot();
  $("status").textContent = !state.connected ? "Disconnected" : running ? "Playing simulation" : "Connected · paused";
  $("output").textContent = `${state.strength} / 20`;
  $("meter").value = state.strength;
  $("position").textContent = paragraphs.length ? `Paragraph ${current + 1} of ${paragraphs.length}` : "No text loaded";
  $("paragraph").textContent = paragraphs[current] || "Paste or import a TXT file to begin.";
  $("level").value = levels[current] ?? 0;
  $("levelValue").textContent = levels[current] ?? 0;
  $("capValue").textContent = $("cap").value;
}
function stop(message = "Stopped. Press Start to resume.") {
  running = false;
  clearInterval(heartbeat);
  heartbeat = null;
  device.stop();
  show(message);
  display();
}
function send() {
  if (!running || document.hidden) return;
  try {
    device.command(Math.min(levels[current] ?? 0, Number($("cap").value)), 2);
    display();
  } catch (error) { stop(error.message); }
}
function loadText(text) {
  const next = splitText(text);
  if (!next.length) throw new Error("Add some text first.");
  stop();
  paragraphs = next;
  levels = next.map(() => 0);
  current = 0;
  show("Text loaded locally. Assign a level to each paragraph; automatic analysis is not implemented yet.");
  display();
}
$("connect").addEventListener("click", () => {
  stop();
  device.connect();
  show("Simulator connected. No physical device is connected.");
  display();
});
$("disconnect").addEventListener("click", () => { stop("Disconnected. Reconnecting will remain paused."); device.disconnect(); display(); });
$("start").addEventListener("click", () => {
  if (!device.connected) return show("Connect the simulator first.");
  if (!paragraphs.length) return show("Load text first.");
  if (document.hidden) return;
  clearInterval(heartbeat);
  running = true;
  show("Simulation active. Use Next to follow your reading position.");
  send();
  if (running) heartbeat = setInterval(send, 1000);
});
$("stop").addEventListener("click", () => stop());
$("load").addEventListener("click", () => {
  importer.invalidate();
  stop("Preparing text.");
  try { loadText($("source").value); } catch (error) { show(error.message); }
});
$("file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  stop("Reading the selected file.");
  try {
    const text = await importer.read(file);
    if (text === null) return;
    loadText(text);
    $("source").value = text;
  } catch (error) {
    show(error instanceof TypeError ? "Choose a valid UTF-8 text file." : error.message);
  }
});
for (const [id, delta] of [["previous", -1], ["next", 1]]) {
  $(id).addEventListener("click", () => {
    current = Math.max(0, Math.min(paragraphs.length - 1, current + delta));
    send(); display();
  });
}
$("level").addEventListener("input", () => {
  if (paragraphs.length) levels[current] = Number($("level").value);
  send(); display();
});
$("cap").addEventListener("input", () => { send(); display(); });
$("clear").addEventListener("click", () => {
  importer.invalidate();
  stop("Text cleared from this page.");
  paragraphs = []; levels = []; current = 0;
  $("source").value = ""; $("file").value = "";
  display();
});
document.addEventListener("visibilitychange", () => { if (document.hidden) stop("Paused when the tab became hidden. Press Start to resume."); });
window.addEventListener("pagehide", () => { importer.invalidate(); stop(); });
display();
