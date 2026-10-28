import {MockDevice} from "./devices/mock.mjs";
import {TextImporter} from "./reader/import.mjs";
import {ReaderModel} from "./reader/model.mjs";
import {selectReadingParagraph} from "./reader/position.mjs";
import {PlaybackController} from "./playback/controller.mjs";

const $ = id => document.getElementById(id);
const model = new ReaderModel();
const importer = new TextImporter();
let paragraphNodes = [];
let activeNode = null;
let positionTimer = null;
let positionEpoch = 0;
let programmaticScrollTop = null;
let startEpoch = 0;
let pendingStart = false;
let pendingLease = null;
let playingLease = null;
let latest = {state: "DISCONNECTED", connected: false, running: false, output: 0,
  ceiling: 5, position: 0, reason: "Load text and connect the simulator."};

function text(id, value) {
  const next = String(value);
  if ($(id).textContent !== next) $(id).textContent = next;
}
function show(message) { text("message", message); }
function cancelPosition() { ++positionEpoch; clearTimeout(positionTimer); positionTimer = null; }
function releasePlayback() { playingLease?.(); playingLease = null; }
function cancelStart() { ++startEpoch; pendingStart = false; pendingLease?.(); pendingLease = null; }

function display(state = latest) {
  latest = state;
  const current = model.paragraphs[state.position];
  const value = current ? current.override ?? current.suggestedLevel : 0;
  text("status", ({DISCONNECTED: "Disconnected", READY_PAUSED: "Connected · paused",
    PLAYING: "Playing simulation", ERROR_PAUSED: "Error · paused"})[state.state] || "Paused");
  text("output", `${state.output} / 20`);
  $("meter").value = state.output;
  text("capValue", state.ceiling);
  text("position", current ? `Paragraph ${state.position + 1} of ${model.paragraphs.length}` : "No text loaded");
  $("level").value = value;
  text("levelValue", value);
  text("suggested-level", `${current?.suggestedLevel ?? 0} / 20`);
  text("level-source", !current ? "No paragraph selected." : current.override === null ? "Using the experimental suggestion." : "Using your manual correction.");
  text("effective-level", `${Math.min(value, state.ceiling)} / 20`);
  $("level").disabled = !current;
  $("reset-level").disabled = !current || current.override === null;
  $("previous").disabled = !current || state.position === 0;
  $("next").disabled = !current || state.position >= model.paragraphs.length - 1;
  $("connect").disabled = state.connected && state.state !== "ERROR_PAUSED";
  text("connect", state.state === "ERROR_PAUSED" ? "Reconnect simulator" : "Connect simulator");
  $("disconnect").disabled = !state.connected && !pendingStart;
  $("start").disabled = !state.connected || !current || state.running || pendingStart;
  const nextNode = paragraphNodes[state.position] || null;
  if (activeNode !== nextNode) {
    if (activeNode) { activeNode.classList.remove("active"); activeNode.removeAttribute("aria-current"); }
    activeNode = nextNode;
    if (activeNode) { activeNode.classList.add("active"); activeNode.setAttribute("aria-current", "true"); }
  }
}

const controller = new PlaybackController({device: new MockDevice(), onChange: state => {
  const stopped = latest.running && !state.running;
  if (!state.running) releasePlayback();
  if (stopped) { cancelPosition(); cancelStart(); }
  display(state);
  show(state.reason);
}});

function pause(reason) {
  cancelStart();
  cancelPosition();
  controller.pause(reason);
  releasePlayback();
  display();
}

function renderStory() {
  const fragment = document.createDocumentFragment();
  paragraphNodes = model.paragraphs.map((paragraph, index) => {
    const node = document.createElement("p");
    node.className = "story-paragraph";
    node.dataset.index = String(index);
    node.dataset.paragraphId = paragraph.id;
    node.textContent = paragraph.text;
    fragment.append(node);
    return node;
  });
  if (!paragraphNodes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-reader";
    empty.textContent = "Load text to begin.";
    fragment.append(empty);
  }
  activeNode = null;
  $("paragraph").replaceChildren(fragment);
  $("reader").scrollTop = 0;
  programmaticScrollTop = 0;
}

function scrollToCurrent() {
  const node = paragraphNodes[latest.position];
  if (!node) return;
  cancelPosition();
  const panel = $("reader");
  const top = panel.getBoundingClientRect().top + panel.clientTop;
  const paragraphTop = node.getBoundingClientRect().top;
  panel.scrollTop = Math.max(0, panel.scrollTop + paragraphTop - top - panel.clientHeight * .35 + 12);
  programmaticScrollTop = panel.scrollTop;
}

function followPosition() {
  if (!$("follow-scroll").checked || !model.paragraphs.length || document.hidden) return;
  const panel = $("reader");
  const box = panel.getBoundingClientRect();
  const top = box.top + panel.clientTop;
  const bottom = top + panel.clientHeight;
  const rectangles = paragraphNodes.map(node => {
    const rect = node.getBoundingClientRect();
    return {id: node.dataset.paragraphId, top: rect.top, bottom: rect.bottom};
  }).filter(rect => rect.bottom >= top && rect.top <= bottom);
  const currentId = model.paragraphs[latest.position]?.id ?? null;
  const id = selectReadingParagraph(rectangles, top + panel.clientHeight * .35, currentId);
  if (!id || id === currentId) return;
  const index = model.paragraphs.findIndex(paragraph => paragraph.id === id);
  if (index >= 0) controller.setPosition(index);
}

function settlePosition() {
  cancelPosition();
  if (!$("follow-scroll").checked || document.hidden) return;
  const operation = positionEpoch;
  const documentId = model.documentId;
  positionTimer = setTimeout(() => {
    positionTimer = null;
    if (operation === positionEpoch && documentId === model.documentId) followPosition();
  }, 180);
}

function loadText(text) {
  model.load(text); // Validation leaves the current document intact on failure.
  renderStory();
  controller.setStory(model.effectiveLevels());
  scrollToCurrent();
  show("Text loaded locally. Review the suggestions, then press Start when ready.");
}

function acquirePlayback() {
  if (!navigator.locks) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.locks.request("satinlore-simulator-playback", {ifAvailable: true}, async lock => {
      if (!lock) { resolve(null); return; }
      await new Promise(unlock => {
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          unlock();
          if (pendingLease === release) pendingLease = null;
        };
        resolve(release);
      });
    }).catch(() => resolve(null));
  });
}

$("connect").addEventListener("click", () => { pause("Preparing simulator."); controller.connect(); });
$("disconnect").addEventListener("click", () => { pause("Disconnecting simulator."); controller.disconnect(); });
$("stop").addEventListener("click", () => pause("Stopped. Press Start to continue."));
$("start").addEventListener("click", async () => {
  if (pendingStart || latest.running || !latest.connected || !model.paragraphs.length || document.hidden) return;
  cancelPosition();
  followPosition();
  const operation = ++startEpoch;
  pendingStart = true;
  display();
  let release = null;
  try {
    release = await acquirePlayback();
    if (operation !== startEpoch || document.hidden) { release?.(); return; }
    if (!release) {
      show(navigator.locks ? "Another tab is playing the simulator. Pause it first." :
        "Playback needs a browser with Web Locks support. You can still read and correct levels.");
      return;
    }
    pendingLease = release;
    playingLease = release;
    pendingLease = null;
    if (!controller.start()) { release(); if (playingLease === release) playingLease = null; }
  } catch {
    release?.();
    if (operation === startEpoch) controller.pause("The simulator could not start. Reconnect and try again.");
  } finally {
    if (operation === startEpoch) { pendingStart = false; display(); }
  }
});

$("load").addEventListener("click", () => {
  importer.invalidate();
  pause("Preparing text.");
  try { loadText($("source").value); } catch (error) { show(error.message); }
});
$("file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  pause("Reading the selected file.");
  try {
    const text = await importer.read(file);
    if (text === null) return;
    loadText(text);
    $("source").value = text;
  } catch (error) {
    show(error instanceof TypeError ? "Choose a valid UTF-8 text file." : error.message);
  }
});
$("clear").addEventListener("click", () => {
  importer.invalidate();
  pause("Clearing text.");
  model.clear();
  renderStory();
  controller.setStory([]);
  $("source").value = "";
  $("file").value = "";
  show("Text and corrections cleared from this page.");
});

for (const [id, delta] of [["previous", -1], ["next", 1]]) {
  $(id).addEventListener("click", () => {
    if (!model.paragraphs.length) return;
    cancelPosition();
    controller.setPosition(Math.max(0, Math.min(model.paragraphs.length - 1, latest.position + delta)));
    scrollToCurrent();
  });
}
$("level").addEventListener("input", () => {
  if (!model.paragraphs.length) return;
  model.setOverride(latest.position, Number($("level").value));
  controller.setLevel(latest.position, model.effectiveLevels()[latest.position]);
});
$("reset-level").addEventListener("click", () => {
  if (!model.paragraphs.length) return;
  model.resetOverride(latest.position);
  controller.setLevel(latest.position, model.effectiveLevels()[latest.position]);
});
$("cap").addEventListener("input", () => controller.setCeiling(Number($("cap").value)));
$("reader").addEventListener("scroll", () => {
  const scrollTop = $("reader").scrollTop;
  if (programmaticScrollTop !== null && Math.abs(scrollTop - programmaticScrollTop) < 1) {
    programmaticScrollTop = null;
    return;
  }
  programmaticScrollTop = null;
  settlePosition();
}, {passive: true});
$("follow-scroll").addEventListener("change", () => {
  pause("Reading mode changed. Press Start to continue.");
  if ($("follow-scroll").checked) settlePosition();
});
$("font-size").addEventListener("change", () => {
  pause("Reading size changed. Press Start to continue.");
  $("reader").className = `reader-size-${$("font-size").value}`;
  scrollToCurrent();
});
window.addEventListener("resize", () => {
  if (!model.paragraphs.length) return;
  pause("Reading layout changed. Press Start to continue.");
  scrollToCurrent();
});

// Only actual interaction renews the idle deadline; heartbeat/layout updates do not.
for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  document.addEventListener(eventName, event => { if (event.isTrusted) controller.activity(); }, {passive: true});
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    importer.invalidate();
    pause("Paused when this tab became hidden. Press Start to continue.");
  }
  controller.setVisible(!document.hidden);
});
window.addEventListener("pagehide", () => { importer.invalidate(); pause("Page closed."); });
controller.setVisible(!document.hidden);
display(controller.snapshot());
