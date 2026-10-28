import {MockDevice} from "./devices/mock.mjs";
import {TextImporter} from "./reader/import.mjs";
import {ReaderModel} from "./reader/model.mjs";
import {selectReadingParagraph} from "./reader/position.mjs";
import {PlaybackController} from "./playback/controller.mjs";

const $ = id => document.getElementById(id);
let model = new ReaderModel();
const importer = new TextImporter();
let view = "add";
let busy = false;
let importEpoch = 0;
let paragraphNodes = [];
let reviewNodes = [];
let activeNode = null;
let positionTimer = null;
let positionEpoch = 0;
let programmaticScrollTop = null;
let startEpoch = 0;
let pendingStart = false;
let pendingLease = null;
let playingLease = null;
let latest = {state: "DISCONNECTED", connected: false, running: false, output: 0,
  ceiling: 5, position: 0, reason: "Add a story to begin."};

function text(id, value) {
  const node = $(id);
  const next = String(value);
  if (node && node.textContent !== next) node.textContent = next;
}
function show(message) { text("message", message); }
function cancelPosition() { ++positionEpoch; clearTimeout(positionTimer); positionTimer = null; }
function releasePlayback() { playingLease?.(); playingLease = null; }
function cancelStart() { ++startEpoch; pendingStart = false; pendingLease?.(); pendingLease = null; }
function setBusy(value) {
  busy = value;
  $("view-add").setAttribute("aria-busy", String(value));
  $("load").disabled = value;
  $("file").disabled = value;
  text("import-status", value ? "Reading and analysing your text on this page…" : "");
  display();
}
function cancelImport() {
  ++importEpoch;
  importer.invalidate();
  $("file").value = "";
  if (busy) setBusy(false);
}
function updateReview(index) {
  const paragraph = model.paragraphs[index];
  const nodes = reviewNodes[index];
  if (!paragraph || !nodes) return;
  const level = paragraph.override ?? paragraph.suggestedLevel;
  nodes.input.value = level;
  nodes.input.setAttribute("aria-valuetext", `${level} out of 20`);
  nodes.output.textContent = `${level} / 20`;
  nodes.source.textContent = paragraph.override === null ? "Using suggestion" : "Your correction";
  nodes.reset.disabled = paragraph.override === null;
}

function display(state = latest) {
  latest = state;
  const current = model.paragraphs[state.position];
  const value = current ? current.override ?? current.suggestedLevel : 0;
  text("status", ({DISCONNECTED: "Disconnected", READY_PAUSED: "Connected · paused",
    PLAYING: "Playing simulation", ERROR_PAUSED: "Error · paused"})[state.state] || "Paused");
  text("output", `${state.output} / 20`);
  $("meter").value = state.output;
  text("capValue", state.ceiling);
  $("cap").setAttribute("aria-valuetext", `${state.ceiling} out of 20`);
  const positionLabel = current ? `Paragraph ${state.position + 1} of ${model.paragraphs.length}` : "No text loaded";
  text("position", positionLabel);
  text("correction-position", positionLabel);
  $("level").value = value;
  $("level").setAttribute("aria-valuetext", `${value} out of 20`);
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
  $("start").disabled = view !== "read" || busy || !state.connected || !current || state.running || pendingStart;
  $("pause").disabled = !state.running && !pendingStart;
  $("step-review").disabled = !current;
  $("step-read").disabled = !current;
  $("begin-reading").disabled = !current || busy;
  text("review-summary", current ? `${model.paragraphs.length} paragraphs · ready for your review` : "Add a story to review its suggestions.");
  const nextNode = paragraphNodes[state.position] || null;
  if (activeNode !== nextNode) {
    if (activeNode) { activeNode.classList.remove("active"); activeNode.removeAttribute("aria-current"); }
    activeNode = nextNode;
    if (activeNode) { activeNode.classList.add("active"); activeNode.setAttribute("aria-current", "true"); }
  }
  updateReview(state.position);
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

// The document is the only reading scroller. The anchor stays above the phone dock.
function readingBounds() {
  const visual = window.visualViewport;
  const top = (visual?.offsetTop ?? 0) + 16;
  let bottom = Math.min(window.innerHeight, (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight)) - 16;
  if (window.matchMedia("(max-width: 1099px)").matches) {
    const dock = $("transport").getBoundingClientRect();
    bottom = Math.min(bottom, dock.top - 16);
  }
  bottom = Math.max(top + 48, bottom);
  return {top, bottom, anchor: top + (bottom - top) * .35};
}
function scrollToCurrent() {
  if (view !== "read") return;
  const node = paragraphNodes[latest.position];
  if (!node) return;
  cancelPosition();
  window.scrollTo({top: Math.max(0, window.scrollY + node.getBoundingClientRect().top - readingBounds().anchor + 12), behavior: "instant"});
  programmaticScrollTop = window.scrollY;
}
function followPosition() {
  if (view !== "read" || $("adjustments").open || !$("follow-scroll").checked || !model.paragraphs.length || document.hidden) return;
  const {top, bottom, anchor} = readingBounds();
  const rectangles = paragraphNodes.map(node => {
    const rect = node.getBoundingClientRect();
    return {id: node.dataset.paragraphId, top: rect.top, bottom: rect.bottom};
  }).filter(rect => rect.bottom >= top && rect.top <= bottom);
  const currentId = model.paragraphs[latest.position]?.id ?? null;
  const id = selectReadingParagraph(rectangles, anchor, currentId);
  if (!id || id === currentId) return;
  const index = model.paragraphs.findIndex(paragraph => paragraph.id === id);
  if (index >= 0) controller.setPosition(index);
}
function settlePosition() {
  cancelPosition();
  if (view !== "read" || !$("follow-scroll").checked || document.hidden) return;
  const operation = positionEpoch;
  const documentId = model.documentId;
  positionTimer = setTimeout(() => {
    positionTimer = null;
    if (operation === positionEpoch && documentId === model.documentId) followPosition();
  }, 180);
}
function showView(next, {focus = true, invalidate = true} = {}) {
  if (!["add", "review", "read"].includes(next)) return;
  if (next !== "add" && !model.paragraphs.length) next = "add";
  if (invalidate) cancelImport();
  pause("Paused while you prepare your story. Press Start in Read when ready.");
  view = next;
  $("adjustments").open = false;
  document.body.dataset.view = next;
  for (const name of ["add", "review", "read"]) {
    $(`view-${name}`).hidden = name !== next;
    if (name === next) $(`step-${name}`).setAttribute("aria-current", "step");
    else $(`step-${name}`).removeAttribute("aria-current");
  }
  display();
  if (focus) {
    const heading = $(`view-${next}`).querySelector("h1, h2");
    if (heading) { heading.tabIndex = -1; heading.focus({preventScroll: true}); }
  }
  if (next === "read") scrollToCurrent();
  else { window.scrollTo({top: 0, behavior: "instant"}); programmaticScrollTop = null; }
}

function changeLevel(index, level) {
  model.setOverride(index, level);
  controller.setLevel(index, model.effectiveLevels()[index]);
  updateReview(index);
}
function resetLevel(index) {
  model.resetOverride(index);
  controller.setLevel(index, model.effectiveLevels()[index]);
  updateReview(index);
}
function renderStory() {
  const reading = document.createDocumentFragment();
  const review = document.createDocumentFragment();
  reviewNodes = [];
  paragraphNodes = model.paragraphs.map((paragraph, index) => {
    const node = document.createElement("p");
    node.className = "story-paragraph";
    node.dataset.index = String(index);
    node.dataset.paragraphId = paragraph.id;
    node.textContent = paragraph.text;
    reading.append(node);

    const article = document.createElement("article");
    article.className = "review-card";
    article.dataset.reviewIndex = String(index);
    const heading = document.createElement("h3");
    heading.textContent = `Paragraph ${index + 1}`;
    const content = document.createElement("p");
    content.className = "review-copy";
    content.textContent = paragraph.text;
    const suggestion = document.createElement("p");
    suggestion.className = "review-suggestion";
    suggestion.textContent = `Experimental suggestion: ${paragraph.suggestedLevel} / 20`;
    const editor = document.createElement("div");
    editor.className = "review-editor";
    const label = document.createElement("label");
    label.htmlFor = `review-override-${index}`;
    label.textContent = "Your level ";
    const output = document.createElement("output");
    output.id = `review-value-${index}`;
    output.htmlFor = label.htmlFor;
    label.append(output);
    const input = document.createElement("input");
    input.id = label.htmlFor;
    input.type = "range";
    input.min = "0"; input.max = "20"; input.step = "1";
    const source = document.createElement("span");
    source.id = `review-source-${index}`;
    source.className = "note";
    input.setAttribute("aria-describedby", source.id);
    input.addEventListener("input", () => changeLevel(index, Number(input.value)));
    const reset = document.createElement("button");
    reset.id = `review-reset-${index}`;
    reset.type = "button";
    reset.textContent = "Use suggestion";
    reset.addEventListener("click", () => resetLevel(index));
    editor.append(label, input, source, reset);
    article.append(heading, content, suggestion, editor);
    review.append(article);
    reviewNodes.push({input, output, source, reset});
    return node;
  });
  if (!paragraphNodes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-reader";
    empty.textContent = "Add a story to begin.";
    reading.append(empty);
  }
  activeNode = null;
  $("paragraph").replaceChildren(reading);
  $("review-list").replaceChildren(review);
  model.paragraphs.forEach((_, index) => updateReview(index));
}

async function prepareText(read) {
  cancelImport();
  pause("Preparing text.");
  const operation = importEpoch;
  setBusy(true);
  try {
    // Give the loading state a rendering opportunity before bounded local parsing.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (operation !== importEpoch || document.hidden || view !== "add") return;
    const value = await read();
    if (value === null || operation !== importEpoch || document.hidden || view !== "add") return;
    const candidate = new ReaderModel();
    candidate.load(value); // Validate before asking; the existing model stays untouched.
    if (model.paragraphs.length && !window.confirm("Replace this story and its manual corrections? The new text will be analysed again. Choose Cancel to keep your current story and corrections.")) {
      show("Replacement cancelled. Your story and corrections are unchanged.");
      text("import-status", "Replacement cancelled. Your story and corrections are unchanged.");
      return;
    }
    if (operation !== importEpoch || document.hidden || view !== "add") return;
    model = candidate;
    renderStory();
    controller.setStory(model.effectiveLevels());
    $("source").value = value;
    setBusy(false);
    showView("review", {invalidate: false});
    show("Text analysed on this page. Review the suggestions, then open Read.");
  } catch (error) {
    if (operation !== importEpoch) return;
    const message = error instanceof TypeError ? "Choose a valid UTF-8 text file." : error.message;
    show(message);
    setBusy(false);
    text("import-status", message);
  } finally {
    if (operation === importEpoch) {
      if (busy) { busy = false; $("view-add").setAttribute("aria-busy", "false"); $("load").disabled = false; $("file").disabled = false; display(); }
      $("file").value = "";
    }
  }
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

for (const name of ["add", "review", "read"]) $(`step-${name}`).addEventListener("click", () => showView(name));
$("begin-reading").addEventListener("click", () => showView("read"));
$("connect").addEventListener("click", () => { pause("Preparing simulator."); controller.connect(); });
$("disconnect").addEventListener("click", () => { pause("Disconnecting simulator."); controller.disconnect(); });
$("stop").addEventListener("click", () => pause("Stopped. Press Start to continue."));
$("pause").addEventListener("click", () => pause("Paused. Press Start to continue."));
$("start").addEventListener("click", async () => {
  if (view !== "read" || busy || pendingStart || latest.running || !latest.connected || !model.paragraphs.length || document.hidden) return;
  cancelPosition();
  followPosition();
  const operation = ++startEpoch;
  pendingStart = true;
  display();
  let release = null;
  try {
    release = await acquirePlayback();
    if (operation !== startEpoch || view !== "read" || document.hidden) { release?.(); return; }
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
  const value = $("source").value;
  void prepareText(() => value);
});
$("file").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) void prepareText(() => importer.read(file));
});
$("clear").addEventListener("click", () => {
  cancelImport();
  pause("Clearing text.");
  model.clear();
  renderStory();
  controller.setStory([]);
  $("source").value = "";
  $("file").value = "";
  showView("add");
  show("Text and corrections cleared from this page.");
});
for (const [id, delta] of [["previous", -1], ["next", 1]]) {
  $(id).addEventListener("click", () => {
    if (!model.paragraphs.length || view !== "read") return;
    cancelPosition();
    controller.setPosition(Math.max(0, Math.min(model.paragraphs.length - 1, latest.position + delta)));
    scrollToCurrent();
  });
}
$("level").addEventListener("input", () => {
  if (model.paragraphs.length) changeLevel(latest.position, Number($("level").value));
});
$("reset-level").addEventListener("click", () => {
  if (model.paragraphs.length) resetLevel(latest.position);
});
$("cap").addEventListener("input", () => controller.setCeiling(Number($("cap").value)));
window.addEventListener("scroll", () => {
  if (programmaticScrollTop !== null && Math.abs(window.scrollY - programmaticScrollTop) < 1) {
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
function reflow(reason) {
  if (view !== "read" || !model.paragraphs.length) return;
  pause(reason);
  scrollToCurrent();
}
$("font-size").addEventListener("change", () => {
  $("reader").className = `reader-size-${$("font-size").value}`;
  reflow("Reading size changed. Press Start to continue.");
});
window.addEventListener("resize", () => reflow("Reading layout changed. Press Start to continue."));
window.addEventListener("satinlore:appearance", () => reflow("Appearance changed. Press Start to continue."));
$("adjustments").addEventListener("toggle", () => {
  if (view !== "read" || !model.paragraphs.length) return;
  pause("Reading adjustments changed. Press Start to continue.");
  if (!$("adjustments").open) scrollToCurrent();
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !$("adjustments").open) return;
  event.preventDefault();
  $("adjustments").open = false;
  $("adjustments").querySelector("summary").focus({preventScroll: true});
});
function reserveDockSpace() {
  const height = window.matchMedia("(max-width: 1099px)").matches ? $("transport").getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty("--dock-space", `${Math.ceil(height) + 24}px`);
}
if (typeof ResizeObserver !== "undefined") new ResizeObserver(reserveDockSpace).observe($("transport"));
window.addEventListener("resize", reserveDockSpace);
reserveDockSpace();

// Only actual interaction renews the idle deadline; heartbeat/layout updates do not.
for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  document.addEventListener(eventName, event => { if (event.isTrusted) controller.activity(); }, {passive: true});
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelImport();
    pause("Paused when this tab became hidden. Press Start to continue.");
  }
  controller.setVisible(!document.hidden);
});
window.addEventListener("pagehide", () => { cancelImport(); pause("Page closed."); });
controller.setVisible(!document.hidden);
display(controller.snapshot());
