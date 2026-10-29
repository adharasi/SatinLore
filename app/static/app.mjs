import {MockDevice} from "./devices/mock.mjs";
import {TextImporter} from "./reader/import.mjs";
import {ReaderModel} from "./reader/model.mjs";
import {StoryStore} from "./reader/storage.mjs";
import {selectReadingParagraph} from "./reader/position.mjs";
import {PlaybackController} from "./playback/controller.mjs";

const $ = id => document.getElementById(id);
const importer = new TextImporter();
const store = new StoryStore();
const stories = [];
let activeId = null;
let paragraphNodes = [];
let activeNode = null;
let reviewNodes = new Map();
let revealUpcoming = false;
let importing = false;
let importEpoch = 0;
let selectionEpoch = 0;
let positionTimer = null;
let positionEpoch = 0;
let programmaticScrollTop = null;
let synchronizing = false;
let startEpoch = 0;
let pendingStart = false;
let playingLease = null;
let pendingLease = null;
let startIntent = null;
let ceilingIntent = null;
let saveIntent = null;
let libraryError = "";
let libraryLoading = true;
let libraryMutation = false;
let focusArrangement = null;
const dialogOpeners = new Map();
let latest = {state: "DISCONNECTED", connected: false, running: false, output: 0,
  ceiling: 5, strength: 1, baseLevel: 0, target: 0, position: 0, reason: "Open a story to begin."};

const currentStory = () => stories.find(story => story.id === activeId) ?? null;
const isNarrow = () => window.matchMedia("(max-width: 1099px)").matches;
function text(id, value) {
  const node = $(id);
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}
function show(message) { text("message", message); }
function cancelPosition() { ++positionEpoch; clearTimeout(positionTimer); positionTimer = null; }
function releasePlayback() { playingLease?.(); playingLease = null; }
function cancelStart() {
  ++startEpoch;
  pendingStart = false;
  pendingLease?.(); pendingLease = null;
  startIntent = null;
}
function setImporting(value) {
  importing = value;
  $("new-story-dialog").setAttribute("aria-busy", String(value));
  $("load").disabled = value;
  $("file").disabled = value;
}
function cancelImport() {
  ++importEpoch;
  importer.invalidate();
  $("file").value = "";
  setImporting(false);
}
function formatStrength(value = latest.strength ?? 1) { return `${value.toFixed(1)}×`; }
function saveState(story) {
  if (!story) return {state: "session", label: "Session only"};
  if (story.saveError) return {state: "error", label: story.saveError};
  if (story.saving) return {state: "saving", label: "Saving on this browser…"};
  if (!story.saved) return {state: "session", label: "Session only · not saved"};
  if (story.dirty) return {state: "dirty", label: "Unsaved changes · retry Save"};
  return {state: "saved", label: "Saved on this browser"};
}

function renderLibrary() {
  const fragment = document.createDocumentFragment();
  for (const story of stories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-item";
    button.dataset.storyId = story.id;
    button.disabled = libraryMutation || story.deleting;
    if (story.id === activeId) button.setAttribute("aria-current", "true");
    const title = document.createElement("span");
    title.className = "story-item-title";
    title.textContent = story.title;
    const meta = document.createElement("span");
    meta.className = "story-meta";
    meta.textContent = `${story.saved ? "Saved here" : "Session only"} · ${story.position + 1} / ${story.model.paragraphs.length}`;
    button.append(title, meta);
    button.addEventListener("click", () => selectStory(story.id));
    fragment.append(button);
  }
  $("story-list").replaceChildren(fragment);
  text("library-status", libraryLoading ? "Opening your local library…" : libraryError || (stories.length ?
    "Saved stories stay on this browser. Session-only stories clear on reload." : "Your reading space is ready for a story."));
  $("delete-all").disabled = libraryLoading || libraryMutation || (!stories.length && !libraryError);
}

function updateCurrentCorrection(story) {
  const paragraph = story?.model.paragraphs[latest.position];
  const base = paragraph ? paragraph.override ?? paragraph.suggestedLevel : 0;
  text("suggested-level", `${paragraph?.suggestedLevel ?? 0} / 20`);
  text("levelValue", base);
  $("level").value = base;
  $("level").setAttribute("aria-valuetext", `${base} out of 20`);
  $("level").disabled = !paragraph || libraryMutation || story?.deleting;
  $("reset-level").disabled = !paragraph || paragraph.override === null || libraryMutation || story?.deleting;
  text("level-source", !paragraph ? "No section selected." : paragraph.override === null ?
    "Using the experimental suggestion." : "Using your correction.");
  text("effective-level", `${latest.target ?? 0} / 20`);
  text("correction-position", paragraph ? `Current section ${latest.position + 1} of ${story.model.paragraphs.length}` : "No section selected");
  const nodes = reviewNodes.get(latest.position);
  if (nodes) updateReviewRow(story, latest.position, nodes);
}

function display(state = latest) {
  latest = state;
  const story = currentStory();
  for (const id of ["new-story", "empty-new-story"]) $(id).disabled = libraryLoading || libraryMutation;
  if ($("story-actions")) $("story-actions").hidden = !story;
  if (story && !synchronizing && story.position !== state.position) {
    story.position = state.position;
    story.furthest = Math.max(story.furthest, state.position);
    markDirty(story);
  }
  text("status", ({DISCONNECTED: "Disconnected", READY_PAUSED: "Connected · paused",
    PLAYING: "Playing simulation", ERROR_PAUSED: "Error · paused"})[state.state] || "Paused");
  text("output", `${state.output} / 20`);
  text("target-output", `${state.target ?? 0} / 20`);
  $("meter").value = state.output;
  text("capValue", state.ceiling);
  $("cap").value = state.ceiling;
  $("cap").setAttribute("aria-valuetext", `${state.ceiling} out of 20 confirmed maximum`);
  text("strength-value", formatStrength());
  $("strength-minus").disabled = libraryMutation || !story || story.deleting || state.strength <= 0;
  $("strength-plus").disabled = libraryMutation || !story || story.deleting || state.strength >= 2;
  $("strength-reset").disabled = libraryMutation || !story || story.deleting || state.strength === 1;
  $("connect").disabled = state.connected && state.state !== "ERROR_PAUSED";
  text("connect", state.state === "ERROR_PAUSED" ? "Reconnect simulator" : "Connect simulator");
  $("disconnect").disabled = !state.connected && !pendingStart;
  $("start").disabled = !story?.model.analysisReady || importing || !state.connected || state.running ||
    pendingStart || state.state === "ERROR_PAUSED" || story?.deleting;
  $("pause").disabled = !state.running && !pendingStart;
  $("previous").disabled = libraryMutation || !story || story.deleting || state.position === 0;
  $("next").disabled = libraryMutation || !story || story.deleting || state.position >= story.model.paragraphs.length - 1;
  for (const id of ["save-story", "session-only", "rename-story", "delete-story", "reanalyze"]) {
    $(id).disabled = libraryMutation || !story || story.deleting || story.saving;
  }
  $("session-only").disabled ||= !story?.saved;
  text("story-title", story?.title ?? "Your reading space");
  text("header-story-title", story?.title ?? "A little space to get lost");
  text("position", story ? `Section ${state.position + 1} of ${story.model.paragraphs.length}` : "");
  const analysis = story?.model.analysisStatus ?? "pending";
  $("analysis-status").dataset.state = analysis;
  text("analysis-status", !story ? "" : analysis === "ready" ? "Suggestions ready · review is optional" :
    analysis === "error" ? "Suggestions need attention. You can keep reading or retry analysis." : "Analysing quietly on this page… You can read now.");
  const saved = saveState(story);
  $("save-status").dataset.state = saved.state;
  text("save-status", saved.label);
  text("library-save-status", saved.label);
  $("empty-workspace").hidden = Boolean(story);
  $("reading-workspace").hidden = !story;
  const nextNode = story ? paragraphNodes[state.position] ?? null : null;
  if (activeNode !== nextNode) {
    if (activeNode) { activeNode.classList.remove("active"); activeNode.removeAttribute("aria-current"); }
    activeNode = nextNode;
    if (activeNode) { activeNode.classList.add("active"); activeNode.setAttribute("aria-current", "true"); }
  }
  updateCurrentCorrection(story);
}

const controller = new PlaybackController({device: new MockDevice(), onChange: state => {
  const stopped = latest.running && !state.running;
  if (!state.running) releasePlayback();
  if (stopped) { cancelPosition(); cancelStart(); }
  display(state);
  show(state.reason);
}});
function pause(reason) {
  cancelStart(); cancelPosition();
  controller.pause(reason);
  releasePlayback();
  display();
}

function storyRecord(story) {
  return {id: story.id, title: story.title, text: story.model.paragraphs.map(paragraph => paragraph.text).join("\n\n"),
    corrections: story.model.paragraphs.map(paragraph => paragraph.override), position: story.position,
    analysisVersion: story.model.analysisVersion};
}
function markDirty(story) {
  ++story.changeVersion;
  if (!story.saved || story.deleting) return;
  story.dirty = true;
  clearTimeout(story.saveTimer);
  story.saveTimer = setTimeout(() => {
    story.saveTimer = null;
    void persistStory(story);
  }, 350);
}
function persistStory(story, {explicit = false} = {}) {
  if (libraryMutation || story.deleting || !stories.includes(story) || (!story.saved && !explicit)) return Promise.resolve(false);
  clearTimeout(story.saveTimer); story.saveTimer = null;
  const task = async () => {
    if (libraryMutation || story.deleting || !stories.includes(story) || (!story.saved && !explicit)) return false;
    const version = story.changeVersion;
    story.saving = true;
    story.saveError = "";
    if (story.id === activeId) display();
    try {
      const saved = await store.saveStory(storyRecord(story), {expectedRevision: story.revision});
      story.saved = true;
      story.revision = saved.revision;
      story.dirty = story.changeVersion !== version;
      if (explicit) show("Saved on this browser. There is no cloud backup or sync.");
      if (story.dirty && !story.deleting) markDirty(story);
      return true;
    } catch (error) {
      story.saveError = error.message || "Could not save. Your story is still readable in this tab.";
      story.dirty = story.saved;
      show(story.saveError);
      return false;
    } finally {
      story.saving = false;
      if (story.id === activeId) display();
      renderLibrary();
    }
  };
  story.saveChain = story.saveChain.catch(() => {}).then(task);
  return story.saveChain;
}
function makeStory({id = crypto.randomUUID(), title = "Untitled story", text: source, corrections = [],
  position = 0, revision = null}) {
  const model = new ReaderModel();
  model.load(source, {deferAnalysis: true, documentId: id});
  corrections.forEach((level, index) => { if (level !== null) model.setOverride(index, level); });
  const safePosition = Math.max(0, Math.min(model.paragraphs.length - 1, position));
  return {id, title, model, position: safePosition, furthest: safePosition, saved: revision !== null, revision,
    dirty: false, saving: false, saveError: "", changeVersion: 0, saveTimer: null, saveChain: Promise.resolve(),
    deleting: false, analysisPromise: null};
}

function renderStory() {
  const story = currentStory();
  const fragment = document.createDocumentFragment();
  paragraphNodes = (story?.model.paragraphs ?? []).map((paragraph, index) => {
    const node = document.createElement("p");
    node.className = "story-paragraph";
    node.dataset.index = String(index);
    node.dataset.paragraphId = paragraph.id;
    node.textContent = paragraph.text;
    fragment.append(node);
    return node;
  });
  activeNode = null;
  $("paragraph").replaceChildren(fragment);
  reviewNodes = new Map();
  $("review-list").replaceChildren();
}
function updateReviewRow(story, index, nodes) {
  const paragraph = story.model.paragraphs[index];
  const base = paragraph.override ?? paragraph.suggestedLevel;
  nodes.input.value = base;
  nodes.output.textContent = `${base} / 20`;
  nodes.input.setAttribute("aria-valuetext", `${base} out of 20`);
  nodes.source.textContent = paragraph.override === null ? "Using suggestion" : "Your correction";
  nodes.suggestion.textContent = `Experimental suggestion: ${paragraph.suggestedLevel} / 20`;
  nodes.reset.disabled = paragraph.override === null;
}
function renderReview() {
  const story = currentStory();
  reviewNodes = new Map();
  const fragment = document.createDocumentFragment();
  if (!story || !$("review-settings").open) { $("review-list").replaceChildren(); return; }
  const last = revealUpcoming ? story.model.paragraphs.length - 1 : Math.max(story.position, story.furthest);
  for (let index = 0; index <= last; index++) {
    const paragraph = story.model.paragraphs[index];
    const card = document.createElement("article"); card.className = "review-card";
    card.dataset.reviewIndex = String(index);
    const heading = document.createElement("h3"); heading.textContent = `Section ${index + 1}${index === story.position ? " · current" : ""}`;
    const content = document.createElement("p"); content.className = "review-copy"; content.textContent = paragraph.text;
    const suggestion = document.createElement("p"); suggestion.className = "review-suggestion";
    const label = document.createElement("label"); label.htmlFor = `review-override-${index}`; label.textContent = "Your level ";
    const output = document.createElement("output"); output.id = `review-value-${index}`; label.append(output);
    const input = document.createElement("input"); input.id = label.htmlFor; input.type = "range";
    input.min = "0"; input.max = "20"; input.step = "1";
    const source = document.createElement("span"); source.className = "note";
    const reset = document.createElement("button"); reset.id = `review-reset-${index}`; reset.type = "button"; reset.textContent = "Use suggestion";
    input.addEventListener("input", () => { if (story === currentStory()) changeLevel(index, Number(input.value)); });
    reset.addEventListener("click", () => { if (story === currentStory()) resetLevel(index); });
    card.append(heading, content, suggestion, label, input, source, reset); fragment.append(card);
    const nodes = {input, output, source, suggestion, reset}; reviewNodes.set(index, nodes); updateReviewRow(story, index, nodes);
  }
  $("review-list").replaceChildren(fragment);
  $("show-upcoming").hidden = last === story.model.paragraphs.length - 1;
  $("show-upcoming").disabled = false;
}
function changeLevel(index, value) {
  const story = currentStory(); if (!story || story.deleting || libraryMutation) return;
  story.model.setOverride(index, value);
  controller.setLevel(index, story.model.effectiveLevels()[index]);
  markDirty(story);
  const nodes = reviewNodes.get(index); if (nodes) updateReviewRow(story, index, nodes);
  display();
}
function resetLevel(index) {
  const story = currentStory(); if (!story || story.deleting || libraryMutation) return;
  story.model.resetOverride(index);
  controller.setLevel(index, story.model.effectiveLevels()[index]);
  markDirty(story);
  const nodes = reviewNodes.get(index); if (nodes) updateReviewRow(story, index, nodes);
  display();
}
async function analyse(story, {force = false} = {}) {
  if (!story || (!force && story.model.analysisReady) || story.analysisPromise) return;
  const operation = selectionEpoch;
  const task = story.model.analyse({onProgress: () => {
    if (story === currentStory() && operation === selectionEpoch) display();
  }});
  story.analysisPromise = task;
  if (story === currentStory()) controller.updateLevels(story.model.effectiveLevels());
  display();
  try {
    const complete = await task;
    if (story !== currentStory() || operation !== selectionEpoch || !stories.includes(story)) return;
    if (!complete) { display(); return; }
    // Analysis can populate a mapping, never arm or start playback.
    controller.updateLevels(story.model.effectiveLevels());
    markDirty(story);
    renderReview();
    display();
  } catch {
    if (story !== currentStory() || operation !== selectionEpoch) return;
    pause("Suggestions need attention. You can keep reading and retry analysis.");
    controller.updateLevels(story.model.effectiveLevels());
    display();
  } finally {
    if (story.analysisPromise === task) story.analysisPromise = null;
    if (story === currentStory() && story.model.analysisStatus === "pending" && !story.analysisPromise && !story.deleting) void analyse(story);
  }
}
function selectStory(id) {
  const story = stories.find(value => value.id === id);
  if (!story || story.deleting || libraryMutation) return;
  if (story.id === activeId) {
    pause("Story remains open. Confirm Start when ready.");
    if (isNarrow()) setPanel("library", false, {restore: false});
    scrollToCurrent();
    return;
  }
  cancelImport(); closeDialogs();
  pause("Story opened. Confirm Start when you want simulated playback.");
  const previous = currentStory();
  if (previous && previous !== story) previous.model.cancelAnalysis();
  ++selectionEpoch;
  activeId = id;
  revealUpcoming = false;
  $("review-settings").open = false;
  renderStory();
  synchronizing = true;
  const position = story.position;
  controller.setStory(story.model.effectiveLevels());
  controller.setPosition(position);
  synchronizing = false;
  if (isNarrow()) setPanel("library", false, {restore: false});
  display(); renderLibrary();
  scrollToCurrent();
  void analyse(story);
}

function readingBounds() {
  const visual = window.visualViewport;
  const header = $("workspace-header") ?? document.querySelector(".workspace-header");
  const top = Math.max((visual?.offsetTop ?? 0) + 16, header?.getBoundingClientRect().bottom + 12 || 16);
  const viewportBottom = Math.min(innerHeight, (visual?.offsetTop ?? 0) + (visual?.height ?? innerHeight));
  const bottom = Math.max(top + 48, Math.min(viewportBottom - 16, $("transport").getBoundingClientRect().top - 16));
  return {top, bottom, anchor: top + (bottom - top) * .35};
}
function anyDialog() { return document.querySelector("dialog[open]") !== null; }
function scrollToCurrent() {
  const node = paragraphNodes[latest.position]; if (!node || anyDialog()) return;
  cancelPosition();
  window.scrollTo({top: Math.max(0, scrollY + node.getBoundingClientRect().top - readingBounds().anchor + 12), behavior: "instant"});
  programmaticScrollTop = scrollY;
}
function followPosition() {
  const story = currentStory();
  if (!story || document.hidden || anyDialog() || !$("settings-panel").hidden ||
      (isNarrow() && !$("library-panel").hidden) || !$("follow-scroll").checked) return;
  const {top, bottom, anchor} = readingBounds();
  const rectangles = paragraphNodes.map(node => {
    const rect = node.getBoundingClientRect(); return {id: node.dataset.paragraphId, top: rect.top, bottom: rect.bottom};
  }).filter(rect => rect.bottom >= top && rect.top <= bottom);
  const currentId = story.model.paragraphs[latest.position]?.id;
  const id = selectReadingParagraph(rectangles, anchor, currentId);
  if (!id || id === currentId) return;
  const index = story.model.paragraphs.findIndex(paragraph => paragraph.id === id);
  if (index >= 0) controller.setPosition(index);
}
function settlePosition() {
  cancelPosition();
  if (!currentStory() || document.hidden) return;
  const operation = positionEpoch, storyId = activeId;
  positionTimer = setTimeout(() => {
    positionTimer = null;
    if (operation === positionEpoch && activeId === storyId) followPosition();
  }, 180);
}
function reflow(reason) {
  pause(reason);
  reserveDockSpace();
  scrollToCurrent();
}
function setPanel(name, open, {restore = true} = {}) {
  const panel = $(`${name}-panel`), toggle = $(`toggle-${name}`);
  panel.hidden = !open;
  document.body.dataset[name === "library" ? "libraryOpen" : "settingsOpen"] = String(open);
  toggle.setAttribute("aria-expanded", String(open));
  if (open && isNarrow()) {
    const other = name === "library" ? "settings" : "library";
    $(`${other}-panel`).hidden = true;
    document.body.dataset[other === "library" ? "libraryOpen" : "settingsOpen"] = "false";
    $(`toggle-${other}`).setAttribute("aria-expanded", "false");
  }
  if (restore && !open) toggle.focus({preventScroll: true});
}
function togglePanel(name) {
  pause("Reading layout changed. Confirm Start to continue.");
  if (focusArrangement) { focusArrangement = null; document.body.dataset.focus = "false"; $("focus-mode").setAttribute("aria-pressed", "false"); text("focus-mode", "Focus"); }
  const open = $(`${name}-panel`).hidden;
  setPanel(name, open);
  if (name === "settings" && open) renderReview();
  scrollToCurrent();
  if (open) $(`close-${name}`).focus({preventScroll: true});
}
function openDialog(id, opener = document.activeElement) {
  pause("Paused while you make a choice.");
  dialogOpeners.set(id, opener);
  $(id).showModal();
}
function closeDialog(id, {restore = true} = {}) {
  const dialog = $(id);
  if (dialog.open) dialog.close();
  if (restore) {
    const opener = dialogOpeners.get(id);
    if (opener?.isConnected && !opener.disabled) opener.focus({preventScroll: true});
  }
  dialogOpeners.delete(id);
}
function closeDialogs() {
  for (const id of ["new-story-dialog", "start-dialog", "ceiling-dialog", "save-dialog"]) closeDialog(id, {restore: false});
  startIntent = ceilingIntent = saveIntent = null;
}
function stopEverything() {
  cancelImport();
  pause("Stopped. Confirm Start to continue.");
  closeDialogs();
  $("stop").focus({preventScroll: true});
}

async function prepareText(read) {
  if (libraryMutation || libraryLoading) return;
  cancelImport();
  pause("Opening text locally.");
  const operation = importEpoch;
  setImporting(true);
  text("import-status", "Opening your text on this page…");
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (operation !== importEpoch || document.hidden || libraryMutation || !$("new-story-dialog").open) return;
    const source = await read();
    if (source === null || operation !== importEpoch || document.hidden || libraryMutation || !$("new-story-dialog").open) return;
    const title = $("story-title-input").value.trim() || "Untitled story";
    if (title.length > 120) throw new Error("Use a title up to 120 characters.");
    if (stories.length >= 20) throw new Error("Keep up to 20 stories in this workspace. Delete one before adding another.");
    const story = makeStory({title, text: source});
    stories.push(story);
    closeDialog("new-story-dialog", {restore: false});
    $("source").value = ""; $("story-title-input").value = "";
    selectStory(story.id);
    show("Your story is open. Read now; suggestions are prepared quietly on this page.");
  } catch (error) {
    if (operation !== importEpoch) return;
    text("import-status", error instanceof TypeError ? "Choose a valid UTF-8 TXT file." : error.message);
  } finally {
    if (operation === importEpoch) { setImporting(false); $("file").value = ""; display(); }
  }
}
function acquirePlayback() {
  if (!navigator.locks) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.locks.request("satinlore-simulator-playback", {ifAvailable: true}, async lock => {
      if (!lock) { resolve(null); return; }
      await new Promise(unlock => {
        let released = false;
        resolve(() => { if (!released) { released = true; unlock(); } });
      });
    }).catch(() => resolve(null));
  });
}
async function confirmStart() {
  const intent = startIntent;
  closeDialog("start-dialog");
  startIntent = null;
  const story = currentStory();
  if (!intent || story?.id !== intent.id || !story.model.analysisReady || document.hidden ||
      latest.ceiling !== intent.ceiling || latest.strength !== intent.strength || !latest.connected) return;
  const operation = ++startEpoch;
  pendingStart = true; display();
  let release = null;
  try {
    release = await acquirePlayback();
    if (operation !== startEpoch || document.hidden || currentStory() !== story || !story.model.analysisReady ||
        latest.ceiling !== intent.ceiling || latest.strength !== intent.strength) { release?.(); return; }
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
}
async function removeStory(story, {keepSession = false} = {}) {
  if (!story || story.deleting || libraryMutation) return;
  pause("Paused while local data is removed.");
  story.deleting = true;
  clearTimeout(story.saveTimer); story.saveTimer = null;
  display();
  await story.saveChain.catch(() => {});
  try {
    if (story.saved || story.revision !== null) await store.deleteStory(story.id, {expectedRevision: story.revision});
    if (keepSession) {
      story.saved = false; story.revision = null; story.dirty = false; story.saveError = "";
      show("Session only. The saved copy was removed from this browser.");
    } else {
      story.model.cancelAnalysis();
      stories.splice(stories.indexOf(story), 1);
      if (story.id === activeId) {
        activeId = null;
        ++selectionEpoch;
        if (stories.length) selectStory(stories[0].id);
        else { renderStory(); controller.setStory([]); display(); }
      }
      show("Story and its saved corrections and progress deleted.");
    }
  } catch (error) {
    story.saveError = error.message || "Could not remove the saved story. It is still listed.";
    show(story.saveError);
  } finally { story.deleting = false; display(); renderLibrary(); }
}

for (const id of ["new-story", "empty-new-story"]) $(id).addEventListener("click", () => {
  if (libraryMutation || libraryLoading) return;
  cancelImport(); text("import-status", ""); openDialog("new-story-dialog"); $("story-title-input").focus();
});
$("load").addEventListener("click", () => { const source = $("source").value; void prepareText(() => source); });
$("file").addEventListener("change", event => { const file = event.target.files[0]; if (file) void prepareText(() => importer.read(file)); });
$("cancel-import").addEventListener("click", () => { cancelImport(); closeDialog("new-story-dialog"); });
for (const id of ["stop", "start-stop", "ceiling-stop", "save-stop", "import-stop"]) $(id).addEventListener("click", stopEverything);
for (const id of ["new-story-dialog", "start-dialog", "ceiling-dialog", "save-dialog"]) $(id).addEventListener("cancel", event => {
  event.preventDefault(); cancelImport(); cancelStart(); ceilingIntent = saveIntent = null; closeDialog(id); display();
});
$("start").addEventListener("click", () => {
  const story = currentStory();
  if (!story?.model.analysisReady || !latest.connected || latest.running || pendingStart || document.hidden) return;
  cancelPosition(); followPosition();
  openDialog("start-dialog");
  startIntent = {id: story.id, ceiling: latest.ceiling, strength: latest.strength};
  text("start-summary", `Simulator · maximum ${latest.ceiling}/20 · session strength ${formatStrength()}. Your story stays on this browser.`);
  text("confirm-start", `Start with maximum ${latest.ceiling}/20`);
});
$("confirm-start").addEventListener("click", () => void confirmStart());
$("cancel-start").addEventListener("click", () => { cancelStart(); closeDialog("start-dialog"); display(); });
$("pause").addEventListener("click", () => pause("Paused. Confirm Start to continue."));
$("connect").addEventListener("click", () => { pause("Preparing simulator."); controller.connect(); });
$("disconnect").addEventListener("click", () => { pause("Disconnecting simulator."); controller.disconnect(); });
$("cap").addEventListener("input", () => {
  const value = Number($("cap").value);
  if (!Number.isInteger(value) || value < 0 || value > 20) { display(); return; }
  cancelStart();
  if (value <= latest.ceiling) controller.setCeiling(value);
  else {
    const expectedCeiling = latest.ceiling;
    openDialog("ceiling-dialog");
    ceilingIntent = {value, expectedCeiling, storyId: activeId};
    text("ceiling-summary", `Raise the confirmed maximum from ${expectedCeiling}/20 to ${value}/20? Session strength remains ${formatStrength()}. Playback stays paused.`);
    text("confirm-ceiling", `Confirm maximum ${value}/20`);
    display();
  }
});
$("confirm-ceiling").addEventListener("click", () => {
  const intent = ceilingIntent; ceilingIntent = null; closeDialog("ceiling-dialog");
  if (intent && intent.storyId === activeId && !document.hidden) controller.confirmCeiling(intent.value, intent.expectedCeiling);
  display();
});
$("cancel-ceiling").addEventListener("click", () => { ceilingIntent = null; closeDialog("ceiling-dialog"); display(); });
for (const [id, delta] of [["strength-minus", -1], ["strength-plus", 1]]) $(id).addEventListener("click", () => {
  if (!currentStory()) return;
  cancelStart();
  controller.setStrength(Math.max(0, Math.min(20, Math.round(latest.strength * 10) + delta)) / 10);
});
$("strength-reset").addEventListener("click", () => { cancelStart(); controller.setStrength(1); });
for (const [id, delta] of [["previous", -1], ["next", 1]]) $(id).addEventListener("click", () => {
  const story = currentStory(); if (!story || story.deleting || libraryMutation) return;
  cancelPosition();
  controller.setPosition(Math.max(0, Math.min(story.model.paragraphs.length - 1, latest.position + delta)));
  scrollToCurrent();
  if ($("review-settings").open) renderReview();
});
$("level").addEventListener("input", () => changeLevel(latest.position, Number($("level").value)));
$("reset-level").addEventListener("click", () => resetLevel(latest.position));
$("review-settings").addEventListener("toggle", () => { pause("Review is optional. Confirm Start to continue."); renderReview(); });
$("show-upcoming").addEventListener("click", () => { revealUpcoming = true; renderReview(); });
$("reanalyze").addEventListener("click", () => {
  const story = currentStory(); if (!story) return;
  pause("Refreshing suggestions. Your manual corrections are kept.");
  story.model.cancelAnalysis();
  story.analysisPromise = null;
  ++selectionEpoch;
  controller.updateLevels(story.model.effectiveLevels());
  void analyse(story, {force: true});
});
$("save-story").addEventListener("click", () => {
  const story = currentStory(); if (!story) return;
  if (story.saved) { void persistStory(story, {explicit: true}); return; }
  openDialog("save-dialog"); saveIntent = story.id;
});
$("confirm-save").addEventListener("click", () => {
  const story = currentStory(), id = saveIntent; saveIntent = null; closeDialog("save-dialog");
  if (story?.id === id) void persistStory(story, {explicit: true});
});
$("cancel-save").addEventListener("click", () => { saveIntent = null; closeDialog("save-dialog"); });
$("session-only").addEventListener("click", () => {
  const story = currentStory(); if (!story?.saved) return;
  pause("Paused while you choose how to keep this story.");
  if (confirm("Remove this story's saved copy from this browser and keep it only for this tab session?")) void removeStory(story, {keepSession: true});
});
$("rename-story").addEventListener("click", () => {
  const story = currentStory(); if (!story) return;
  pause("Paused while you rename this story.");
  const title = prompt("Story title (up to 120 characters)", story.title);
  if (title === null) return;
  const value = title.trim();
  if (!value || value.length > 120) { show("Use a title between 1 and 120 characters."); return; }
  story.title = value; markDirty(story); display(); renderLibrary();
});
$("delete-story").addEventListener("click", () => {
  const story = currentStory(); if (!story) return;
  pause("Paused before deleting a story.");
  if (confirm("Delete this story, including its saved text, corrections and reading position?")) void removeStory(story);
});
$("delete-all").addEventListener("click", async () => {
  if (libraryMutation || libraryLoading) return;
  pause("Paused before clearing the local library.");
  if (!confirm("Delete all stories saved on this browser and all stories in this tab? Appearance is kept. This cannot be undone.")) return;
  libraryMutation = true;
  cancelImport(); closeDialogs(); ++selectionEpoch;
  stories.forEach(story => { story.deleting = true; clearTimeout(story.saveTimer); story.model.cancelAnalysis(); });
  display(); renderLibrary();
  await Promise.all(stories.map(story => story.saveChain.catch(() => {})));
  try {
    await store.deleteAll();
    stories.length = 0; activeId = null; libraryError = "";
    $("source").value = ""; $("story-title-input").value = ""; $("file").value = "";
    renderStory(); controller.setStory([]);
    show("All local stories, corrections and progress deleted. Appearance was kept.");
  } catch (error) {
    stories.forEach(story => { story.deleting = false; });
    libraryError = error.message || "Could not clear local storage. No deletion success is claimed.";
    show(libraryError);
  }
  libraryMutation = false;
  display(); renderLibrary();
  if (currentStory()) void analyse(currentStory());
});
for (const name of ["library", "settings"]) {
  $(`toggle-${name}`).addEventListener("click", () => togglePanel(name));
  $(`close-${name}`).addEventListener("click", () => {
    pause("Panel closed. Confirm Start to continue."); setPanel(name, false); scrollToCurrent();
  });
}
$("focus-mode").addEventListener("click", () => {
  pause("Focus layout changed. Confirm Start to continue.");
  if (focusArrangement) {
    setPanel("library", focusArrangement.library, {restore: false});
    setPanel("settings", focusArrangement.settings, {restore: false});
    focusArrangement = null;
  } else {
    focusArrangement = {library: !$("library-panel").hidden, settings: !$("settings-panel").hidden};
    setPanel("library", false, {restore: false}); setPanel("settings", false, {restore: false});
  }
  document.body.dataset.focus = String(Boolean(focusArrangement));
  $("focus-mode").setAttribute("aria-pressed", String(Boolean(focusArrangement)));
  text("focus-mode", focusArrangement ? "Exit focus" : "Focus"); scrollToCurrent();
});
$("follow-scroll").addEventListener("change", () => reflow("Reading mode changed. Confirm Start to continue."));
$("font-size").addEventListener("change", () => {
  $("reader").className = `reader-size-${$("font-size").value}`; reflow("Reading size changed. Confirm Start to continue.");
});
$("reading-width").addEventListener("change", () => {
  document.body.dataset.readingWidth = $("reading-width").value; reflow("Reading width changed. Confirm Start to continue.");
});
$("reading-spacing").addEventListener("change", () => {
  $("reader").dataset.spacing = $("reading-spacing").value; reflow("Reading spacing changed. Confirm Start to continue.");
});
window.addEventListener("satinlore:appearance", () => reflow("Appearance changed. Confirm Start to continue."));
window.addEventListener("resize", () => reflow("Reading layout changed. Confirm Start to continue."));
window.addEventListener("scroll", () => {
  if (programmaticScrollTop !== null && Math.abs(scrollY - programmaticScrollTop) < 1) { programmaticScrollTop = null; return; }
  programmaticScrollTop = null; settlePosition();
}, {passive: true});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || anyDialog()) return;
  if (!$("settings-panel").hidden) { event.preventDefault(); pause("Settings closed."); setPanel("settings", false); scrollToCurrent(); }
  else if (!$("library-panel").hidden) { event.preventDefault(); pause("Library closed."); setPanel("library", false); scrollToCurrent(); }
});
function reserveDockSpace() {
  document.documentElement.style.setProperty("--dock-space", `${Math.ceil($("transport").getBoundingClientRect().height) + 16}px`);
  const header = $("workspace-header") ?? document.querySelector(".workspace-header");
  if (header) document.documentElement.style.setProperty("--header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
}
if (typeof ResizeObserver !== "undefined") {
  const observer = new ResizeObserver(reserveDockSpace);
  observer.observe($("transport"));
  const header = $("workspace-header") ?? document.querySelector(".workspace-header"); if (header) observer.observe(header);
}
for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
  document.addEventListener(eventName, event => { if (event.isTrusted) controller.activity(); }, {passive: true});
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { cancelImport(); pause("Paused when this tab became hidden. Confirm Start to continue."); closeDialogs(); }
  controller.setVisible(!document.hidden);
});
window.addEventListener("pagehide", () => { cancelImport(); pause("Page closed."); closeDialogs(); });
window.addEventListener("storage", event => {
  if (event.key !== "satinlore.library.v1" && event.key !== null) return;
  pause("The local library changed in another tab. Saved copies will not be overwritten silently.");
  libraryError = "The library changed in another tab. Reload to see its saved stories; session-only text remains in this tab until reload.";
  renderLibrary();
});

setPanel("library", !isNarrow(), {restore: false});
setPanel("settings", false, {restore: false});
document.body.dataset.readingWidth = "wide";
reserveDockSpace();
controller.setVisible(!document.hidden);
display(controller.snapshot());
renderLibrary();
void (async () => {
  try {
    const result = await store.loadAll();
    for (const record of result.stories) {
      try { stories.push(makeStory(record)); }
      catch { libraryError = "A saved story could not be opened. Use Delete all to remove unreadable local data."; }
    }
    if (result.errors?.length) libraryError = result.errors.join(" ");
    if (result.unavailable) libraryError ||= "Local storage is unavailable. You can still read session-only stories.";
  } catch { libraryError = "Local storage is unavailable. You can still read session-only stories."; }
  libraryLoading = false;
  display(); renderLibrary();
  if (!activeId && stories.length) selectStory(stories[0].id);
})();
