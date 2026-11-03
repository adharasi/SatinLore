import {ReaderDeviceController} from "./devices/reader-device.mjs";
import {TextImporter} from "./reader/import.mjs";
import {createStoryId} from "./reader/identity.mjs";
import {ReaderModel} from "./reader/model.mjs";
import {StoryStore} from "./reader/storage.mjs";
import {selectReadingParagraph} from "./reader/position.mjs";
import {HostedAccessGuard} from "./access.mjs";
import {selectLibraryStories, storyMetadata, renderStoryTabs} from "./reader/library-view.mjs";
import {BackupImporter, serializeBackup, downloadBackup} from "./reader/backup.mjs";
import {ReaderPreferences} from "./reader/preferences.mjs";
import {FolderStore, selectFolderStories} from "./reader/folders.mjs";
import {WebStoryImporter, identifyStoryUrl, readStoryFile} from "./reader/web-import.mjs";
import {createSimulatorView} from "./reader/simulator-view.mjs";
import {createSetupFlow, PRACTICE_STORY} from "./reader/setup-flow.mjs";
import {ReaderAccountClient, mountAccountWorkspace} from "./reader/account-workspace.mjs";
import {createBetaRecorder, mountBetaRecording} from "./reader/beta-recording.mjs";
import {clampCalibration} from "./reader/calibration.mjs";

const $ = id => document.getElementById(id);
const importer = new TextImporter();
const store = new StoryStore();
const folderStore = new FolderStore({store});
const webImporter = new WebStoryImporter();
let folders = [];
let folderFilter = "all";
let folderSignature = "";
let simulatorView = null;
let setupFlow = null;
let accountClient = null, accountWorkspace = null, betaRecorder = null;
let recordedDevice = "", recordedStory = "", recordedStep = "", feelChannelSignature = "", feelEditingChannel = null, combinationSignature = "";
let connection = {mode: "simulator", model: "lush", toys: [], selectedId: null};
const backupImporter = new BackupImporter();
const preferences = new ReaderPreferences();
const stories = [];
let libraryQuery = "";
let librarySort = "updated";
let backupBusy = false;
let settingsTab = "reader";
let tabSignature = "";
let activeId = null;
let paragraphNodes = [];
let activeNode = null;
let reviewNodes = new Map();
let revealUpcoming = false;
let importing = false;
let linkBusy = false;
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
const hostedMode = document.querySelector('meta[name="satinlore-hosted-access"]')?.content === "true";
let hostedAccess = null;
let hostedAccessReady = !hostedMode;
const canStartHere = () => !hostedMode || Boolean(hostedAccessReady && hostedAccess?.isAuthorized());
let latest = {state: "DISCONNECTED", connected: false, running: false, output: 0,
  ceiling: 5, strength: 1, baseLevel: 0, target: 0, position: 0, reason: "Open a story to begin."};

const currentStory = () => stories.find(story => story.id === activeId) ?? null;
const playbackIdentity = () => JSON.stringify([latest.mode || "simulator",connection.selectedId || latest.selectedDeviceId || "",latest.activeChannels || [latest.channel || "vibrate"],latest.calibration?.channels || {}]);
const isNarrow = () => window.matchMedia("(max-width: 1099px)").matches;
function text(id, value) {
  const node = $(id);
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}
function show(message) { text("message", message); }
function recordAllowedEvent(event) { try { betaRecorder?.record(event); } catch { /* Optional research never owns output. */ } }
function recordCalibrationEvent(event) {
  const channel = ["vibrate", "fingering", "rotate", "thrusting", "oscillate"].includes(event.channel) ? event.channel : undefined;
  const field = ["minimum", "background", "preferred", "maximum", "recovery"].includes(event.field) ? event.field : undefined;
  if (event.type === "calibration_rating") {
    recordAllowedEvent({type:"control",control:field || "test",channel,value:event.value});
    recordAllowedEvent({type:"rating",question:"intensity",value:({light:1,good:3,strong:5})[event.rating],channel,...(field?{field}:{})});
  } else if (event.type === "calibration_adjust") recordAllowedEvent({type:"control",control:field,channel,value:event.value});
  else if (event.type === "calibration_test") recordAllowedEvent({type:"control",control:"test",channel,value:event.value});
  else if (event.type === "calibration_mode") recordAllowedEvent({type:"control",control:"continuity",value:event.mode});
  else if (event.type === "calibration_rhythm") recordAllowedEvent({type:"control",control:"rhythm",channel,value:event.rhythm});
  else if (event.type === "calibration_gain") recordAllowedEvent({type:"control",control:"gain",channel,value:event.value});
  else recordAllowedEvent({type:"step",step:"calibration"});
}
function syncManualZeros(story) {
  if (!story || story !== currentStory()) return;
  controller.setManualZeros(story.model.paragraphs.flatMap((p,index) => !p.analysed || p.override === 0 &&
    (!story.controlled || story.explicitCorrections.has(index)) ? [index] : []));
}
function syncReaderMapping(story) { controller.updateLevels(story.model.effectiveLevels()); syncManualZeros(story); }
function selectedSettings(state = latest,channel = feelEditingChannel || state.channel) {
  const stored = state.calibration?.channels?.[channel] || {minimum:0,background:1,preferred:3,maximum:5,recovery:0,gain:1,rhythm:"steady"};
  const source=state.feel?.channels?.[channel] || (channel===state.channel ? state.feel : {}) || {};
  const keys=["minimum","background","preferred","recovery","gain","rhythm"];
  const feel=Object.fromEntries(keys.filter(key=>Object.hasOwn(source,key)).map(key=>[key,source[key]]));
  const maximum=Math.min(stored.maximum,source.maximum??stored.maximum);
  const range=state.mode!=="lovense"?20:(state.personalRangeChannels || []).includes(channel)?20:5;
  return clampCalibration({...stored,...feel,maximum:20},Math.min(maximum,range));
}
function updateFeelControls(state) {
  if (!$("feel-mode")) return;
  const channels = state.channels || [], signature=JSON.stringify(channels);
  if(signature!==feelChannelSignature){feelChannelSignature=signature;$("feel-channel").replaceChildren(...channels.map(c=>{const option=document.createElement("option");option.value=c.id;option.textContent=c.label;return option;}));}
  if(!channels.some(c=>c.id===feelEditingChannel))feelEditingChannel=state.channel || channels[0]?.id;
  $("feel-channel").value=feelEditingChannel || "vibrate";
  $("feel-channel").disabled=state.testing || !channels.length;
  text("available-features", channels.length ? `Available for ${state.deviceLabel || "this toy"}: ${channels.map(c=>c.label).join(" · ")}.` : "Select a connected toy to see its available movements.");
  const settings=selectedSettings(state), feel=state.feel || {mode:"story",playbackMode:"story"};
  $("feel-mode").value=feel.mode;
  const editRange=state.mode!=="lovense"?20:(state.personalRangeChannels || []).includes(feelEditingChannel)?20:5;
  for(const key of ["minimum","background","preferred","recovery","maximum"]){$("feel-"+key).value=settings[key];$("feel-"+key).max=key==="maximum"?editRange:settings.maximum;text("feel-"+key+"-value",settings[key]);}
  $("feel-rhythm").value=settings.rhythm;
  const output=state.channelOutputs?.[feelEditingChannel]??state.output;
  if($("manual-level")){$("manual-level").value=typeof output==="number"?output:0;$("manual-level").max=Math.min(settings.maximum,state.ceiling);$("manual-level").disabled=!state.running||typeof output!=="number";text("manual-level-value",typeof output==="number"?output:"Unknown");}
  for(const id of ["feel-hold","feel-easeoff","feel-follow"])$(id).disabled=!state.running;
  for(const id of ["mark-good","mark-uncomfortable"])if($(id))$(id).disabled=!state.running||betaRecorder?.snapshot().recording!==true;
  text("feel-status",feel.playbackMode==="hold"?"Holding your chosen level":feel.playbackMode==="ease-off"?"Eased off · automatic increases are held":"Following the story"+(feel.mode==="continuous"?" · background enabled":""));
  if($("enable-personal-range")){
    const granted=(state.personalRangeChannels || []).includes(feelEditingChannel);
    $("enable-personal-range").hidden=state.mode!=="lovense"||granted;
    $("enable-personal-range").disabled=state.running||state.testing||state.outputKnown===false||!state.connected||!(state.verifiedChannels || []).includes(feelEditingChannel);
    text("personal-range-status",state.mode!=="lovense"?"Simulator range: 0–20. Nothing moves outside this screen.":granted?"Personal range enabled for this movement in this connection. Your chosen maximum still applies.":"The gentle check stays within 5/20. After checking this movement and Stop, you can enable a personal range up to 20. It resets on interruption.");
  }
  if($("combination-controls")){
    $("combination-controls").hidden=!state.supportsCombined||channels.length<2;
    const active=state.activeChannels || [state.channel], sig=JSON.stringify([channels,active]);
    if(sig!==combinationSignature){combinationSignature=sig;$("combination-choices").replaceChildren(...channels.map(channel=>{const label=document.createElement("label"),input=document.createElement("input");label.className="check-label";input.type="checkbox";input.value=channel.id;input.checked=active.includes(channel.id);label.append(input,document.createTextNode(channel.label));return label;}));}
    $("apply-combined").disabled=state.testing||!state.connected;
  }
}
function recordControlSnapshot(state) {
  const channels=(state.channels || []).map(c=>c.id), mode=state.mode==="lovense"?"live":"simulator";
  const device=JSON.stringify([state.model,mode,channels]);
  if(device!==recordedDevice){recordedDevice=device;recordAllowedEvent({type:"device",toy:state.model || "none",mode,channels});}
  const outputs=Object.fromEntries(Object.entries(state.channelOutputs || {[state.channel || "vibrate"]:state.output}).filter(([,value])=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=20));
  recordAllowedEvent({type:"output",channels:outputs,state:state.testing?"testing":state.state==="ERROR_PAUSED"?"error":!state.connected?"disconnected":state.running?"playing":"paused"});
  const story=currentStory(), fixture=story?.betaId==="evening-train-v1"?"harbour":story?.betaId==="rain-at-window-v1"?"garden":story?.controlled?"practice":"personal";
  const location=story?`${fixture}:${state.position}`:"";
  if(location && location!==recordedStory){recordedStory=location;recordAllowedEvent({type:"story",fixture,position:state.position});}
  const phase=setupFlow?.snapshot().phase, step=({choose:"choose",connecting:"connect",select:"connect",test:"features",calibrate:"calibration",practice:"practice",reading:"story",complete:"complete"})[phase];
  if(step&&step!==recordedStep){recordedStep=step;recordAllowedEvent({type:"step",step});}
}
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
  for (const id of ["open-draft", "import-url"]) if ($(id)) $(id).disabled = value;
  if ($("draft-story")) $("draft-story").readOnly = value;
  if ($("draft-title")) $("draft-title").readOnly = value;
}
function cancelImport() {
  const cancelledBackup = backupBusy;
  const cancelledLink = linkBusy; linkBusy = false;
  ++importEpoch;
  importer.invalidate();
  webImporter.invalidate();
  backupImporter.invalidate(); backupBusy = false;
  $("file").value = "";
  if ($("import-backup")) $("import-backup").value = "";
  setImporting(false);
  if (cancelledLink) text("url-import-status", "Link import cancelled. Your stories are unchanged.");
  if (cancelledBackup) text("library-transfer-status", "Backup opening cancelled. Existing stories are unchanged.");
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

function renderFolders() {
  if (!$("folder-filter") || !$("story-folder")) return;
  const story = currentStory();
  const signature = JSON.stringify([folders, folderFilter, story?.id, story?.folderId, story?.deleting, libraryLoading, libraryMutation]);
  if (signature === folderSignature) return;
  folderSignature = signature;
  const option = (value, label) => {
    const node = document.createElement("option"); node.value = value; node.textContent = label; return node;
  };
  $("folder-filter").replaceChildren(option("all", "All stories"), option("unfiled", "Unfiled"),
    ...folders.map(folder => option(folder.id, folder.name)));
  $("folder-filter").value = folderFilter;
  $("story-folder").replaceChildren(option("", "Unfiled"), ...folders.map(folder => option(folder.id, folder.name)));
  $("story-folder").value = story?.folderId ?? "";
  $("story-folder").disabled = !story || libraryMutation || story.deleting;
  $("create-folder").disabled = libraryLoading || libraryMutation;
  $("folder-filter").disabled = libraryLoading || libraryMutation;
  for (const id of ["rename-folder", "delete-folder"]) $(id).disabled = libraryLoading || libraryMutation || !folders.some(folder => folder.id === folderFilter);
}

async function changeFolder(action, name) {
  if (libraryLoading || libraryMutation) return;
  const folder = folders.find(value => value.id === folderFilter);
  if (action !== "create" && !folder) return;
  pause("Updating your folders.");
  libraryMutation = true;
  stories.forEach(story => { clearTimeout(story.saveTimer); story.saveTimer = null; });
  display(); renderLibrary();
  try {
    await Promise.all(stories.map(story => story.saveChain.catch(() => {})));
    if (action === "create") {
      const created = await folderStore.create(name); folders.push(created); folderFilter = created.id;
    } else if (action === "rename") {
      const renamed = await folderStore.rename(folder.id, name, {expectedRevision: folder.revision});
      folders = folders.map(value => value.id === folder.id ? renamed : value);
    } else {
      const result = await folderStore.delete(folder.id, {expectedRevision: folder.revision});
      folders = folders.filter(value => value.id !== folder.id);
      for (const story of stories) {
        if (story.folderId === folder.id) story.folderId = null;
        const record = result.stories?.find(value => value.id === story.id);
        if (record) { story.revision = record.revision; story.updatedAt = record.updatedAt; }
      }
      folderFilter = "unfiled";
    }
    text("folder-status", action === "delete" ? "Folder removed. Its stories are in Unfiled." : "Folder updated on this browser.");
  } catch (error) { text("folder-status", error.message || "Could not update this folder. Your stories are unchanged."); }
  finally {
    libraryMutation = false; display(); renderLibrary();
    // A pending autosave cleared above must not lose the user's latest changes.
    for (const story of stories) if (story.saved && story.dirty && !story.saveError) void persistStory(story);
  }
}

function renderLibrary() {
  renderFolders();
  const fragment = document.createDocumentFragment();
  const visible = selectLibraryStories(selectFolderStories(stories, folderFilter), {query: libraryQuery, sort: librarySort});
  for (const story of visible) {
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
  text("library-results", libraryQuery && !visible.length ? "No story titles match your search." :
    `${visible.length} of ${stories.length} ${stories.length === 1 ? "story" : "stories"}`);
  const nextTabs = JSON.stringify(stories.map(story => [story.id, story.title, story.lastOpenedAt, story.deleting]).concat([[activeId, libraryMutation]]));
  if (tabSignature !== nextTabs) {
    tabSignature = nextTabs;
    renderStoryTabs($("story-tabs"), stories, {activeId, disabled: libraryMutation,
      onSelect: id => selectStory(id, {focusReader: true})});
  }
  text("library-status", libraryLoading ? "Opening your local library…" : libraryError || (stories.length ?
    "Saved stories stay on this browser. Session-only stories clear on reload." : "No stories yet. Add one to start reading."));
  $("delete-all").disabled = libraryLoading || libraryMutation || (!stories.length && !folders.length && !libraryError);
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
  updateFeelControls(state);
  accountWorkspace?.update();
  recordControlSnapshot(state);
  const story = currentStory();
  for (const id of ["new-story", "empty-new-story"]) $(id).disabled = libraryLoading || libraryMutation;
  if ($("story-actions")) $("story-actions").hidden = !story;
  if (story && !synchronizing && story.position !== state.position) {
    story.position = state.position;
    story.furthest = Math.max(story.furthest, state.position);
    markDirty(story);
    renderLibrary();
  }
  text("status", ({DISCONNECTED: "Disconnected", READY_PAUSED: "Connected · paused",
    PLAYING: state.mode === "lovense" ? "Sending commands" : "Playing simulation", CONNECTING: "Connecting…", STOPPING: "Stopping…", ERROR_PAUSED: "Error · paused"})[state.state] || "Paused");
  text("device-label", state.deviceLabel ?? "Lush simulator");
  text("connection-badge", state.mode === "lovense" ? "LIVE · BETA" : "SIMULATED");
  text("output-label", state.mode === "lovense" ? "Requested" : "Output");
  $("transport").setAttribute("aria-label", state.mode === "lovense" ? "Toy playback controls" : "Simulator playback controls");
  text("output", state.outputKnown === false ? "Unconfirmed" : `${state.output ?? 0} / 20`);
  text("target-output", `${state.target ?? 0} / 20`);
  $("meter").value = state.output ?? 0;
  text("capValue", state.ceiling);
  $("cap").value = state.ceiling;
  $("cap").max = String(state.maxCeiling??(state.mode === "lovense" ? 5 : 20));
  text("ceiling-help", state.mode === "lovense" ? `This movement's available range is 0–${state.maxCeiling??5}. Reductions apply immediately. A higher maximum pauses until you choose Start; there is no extra popup.` : "Changes apply immediately within the simulator. Adjusting the maximum does not start playback.");
  $("cap").setAttribute("aria-valuetext", `${state.ceiling} out of 20 confirmed maximum`);
  text("strength-value", formatStrength());
  $("strength-minus").disabled = libraryMutation || story?.deleting || state.strength <= 0;
  $("strength-plus").disabled = libraryMutation || story?.deleting || state.strength >= 2;
  $("strength-reset").disabled = libraryMutation || story?.deleting || state.strength === 1;
  const reconnect = state.state === "ERROR_PAUSED";
  $("connect").disabled = state.connected && !reconnect;
  $("connect").hidden = state.connected && !reconnect;
  text("connect", reconnect ? "Reconnect" : "Connect");
  $("connect").setAttribute("aria-label", state.mode === "lovense" ? "Reconnect toy" : reconnect ? "Reconnect simulator" : "Connect simulator");
  $("connect").title = state.mode === "lovense" ? "Reconnect toy" : reconnect ? "Reconnect simulator" : "Connect simulator";
  $("disconnect").hidden = !state.connected || reconnect;
  $("disconnect").disabled = !state.connected && !pendingStart;
  $("start").disabled = !navigator.locks || !canStartHere() || !story?.model.analysisReady || importing || !state.connected || state.running ||
    pendingStart || state.state === "ERROR_PAUSED" || state.testing || state.mode === "lovense" && state.canStart === false || story?.deleting;
  let readiness;
  if (pendingStart) readiness = "Preparing this Start. Stop cancels it immediately.";
  else if (state.testing) readiness = "Wait for the two-second connection test to finish, then choose Start.";
  else if (state.running) readiness = "Playback is running. Pause or Stop before starting again.";
  else if (state.state === "ERROR_PAUSED") readiness = "Reconnect, then confirm Start again.";
  else if (state.outputKnown === false) readiness = "Output is unconfirmed. Check your toy and reconnect before starting.";
  else if (!canStartHere()) readiness = hostedAccess?.snapshot().state === "checking" ? "Checking sign-in. Start will be available when the check passes." : "Check your sign-in before starting. Your story is still readable.";
  else if (importing) readiness = "Opening your text. Start will be available after analysis and connection.";
  else if (libraryMutation || story?.deleting) readiness = "Finishing the library change. Playback stays paused.";
  else if (!story) readiness = "Add a story, or choose Set up a toy for a guided test read.";
  else if (!story.model.analysisReady) readiness = story.model.analysisStatus === "error" ? "Analysis needs attention. Open Story settings and choose Analyse again." : "Preparing story suggestions. You can keep reading while you wait.";
  else if (!state.connected) readiness = "Connect the simulator or set up a toy, then choose Start.";
  else if (!navigator.locks) readiness = "Start needs browser Web Locks. Use a current browser over HTTPS or localhost; reading still works here.";
  else if (state.mode === "lovense" && state.canStart === false) readiness = state.reason || "Complete Toy setup and confirm the short connection test before Start.";
  else readiness = `Ready. Start asks you to confirm maximum ${state.ceiling}/20. Stop keeps your story and connection ready.`;
  text("start-help", readiness);
  if ($("retry-access")) {
    $("retry-access").hidden = !hostedMode || canStartHere();
    $("retry-access").disabled = pendingStart || hostedAccess?.snapshot().state === "checking";
  }
  $("pause").disabled = !state.running && !pendingStart;
  $("previous").disabled = libraryMutation || !story || story.deleting || state.position === 0;
  $("next").disabled = libraryMutation || !story || story.deleting || state.position >= story.model.paragraphs.length - 1;
  for (const id of ["save-story", "session-only", "rename-story", "delete-story", "reanalyze"]) {
    $(id).disabled = libraryMutation || !story || story.deleting || story.saving;
  }
  for (const id of ["export-library", "import-backup-trigger", "import-backup"]) if ($(id)) $(id).disabled = libraryLoading || libraryMutation || backupBusy || !stories.length && id === "export-library";
  if ($("export-story")) $("export-story").disabled = libraryMutation || !story || story.deleting || backupBusy;
  $("session-only").disabled ||= !story?.saved;
  text("story-title", story?.title ?? "Your reading space");
  text("header-story-title", story?.title ?? "Add a story to begin");
  text("position", story ? `Section ${state.position + 1} of ${story.model.paragraphs.length}` : "");
  const metadata = storyMetadata(story);
  text("story-word-count", story ? `${metadata.words.toLocaleString()} words` : "");
  text("story-progress", story ? `${metadata.progressPercent}% · ${metadata.positionLabel}` : "");
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
  simulatorView?.update(state);
  setupFlow?.update({...connection, ...state, canStart: !$("start").disabled, readiness: $("start-help").textContent});
  renderFolders();
}

function controlRecovery(state) {
  latest = state; cancelStart(); releasePlayback();
  for (const id of ["start", "pause"]) if ($(id)) $(id).disabled = true;
  if ($("connect")) { $("connect").disabled = false; $("connect").hidden = false; text("connect", "Reconnect"); }
  if ($("stop")) $("stop").disabled = false;
  text("status", "Controls need reconnecting"); text("output", state.mode === "lovense" ? "Unconfirmed" : "0 / 20");
  text("start-help", "The controls could not update. Stop was requested. Check your toy and reconnect before continuing.");
  show("The controls could not update. Reconnect; your story remains readable.");
}
const controller = new ReaderDeviceController({document, window, navigator,
  authorize: async () => !hostedMode || Boolean(await hostedAccess?.check({fresh: true}) && canStartHere()),
  onSetupChange: state => { connection = state; setupFlow?.update({...latest, ...state, canStart: !$("start").disabled, readiness: $("start-help").textContent}); },
  onInterfaceError: controlRecovery, onChange: state => {
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
  try { display(controller.snapshot()); } catch { controlRecovery(controller.snapshot()); }
}

function storyRecord(story) {
  return {id: story.id, title: story.title, text: story.model.paragraphs.map(paragraph => paragraph.text).join("\n\n"),
    corrections: story.model.paragraphs.map(paragraph => paragraph.override), position: story.position,
    analysisVersion: story.model.analysisVersion, ...(story.folderId ? {folderId: story.folderId} : {})};
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
      story.updatedAt = saved.updatedAt ?? Date.now();
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
function makeStory({id = createStoryId(), title = "Untitled story", text: source, corrections = [],
  position = 0, revision = null, updatedAt = Date.now(), folderId = null, betaId = null, controlled = false}) {
  const model = new ReaderModel();
  model.load(source, {deferAnalysis: true, documentId: id});
  corrections.forEach((level, index) => { if (level !== null) model.setOverride(index, level); });
  const safePosition = Math.max(0, Math.min(model.paragraphs.length - 1, position));
  return {id, title, model, folderId, betaId, controlled, explicitCorrections:new Set(), position: safePosition, furthest: safePosition, saved: revision !== null, revision,
    dirty: false, saving: false, saveError: "", changeVersion: 0, saveTimer: null, saveChain: Promise.resolve(),
    deleting: false, analysisPromise: null, updatedAt, lastOpenedAt: 0};
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
  story.explicitCorrections.add(index);
  controller.setLevel(index, story.model.effectiveLevels()[index]);
  syncManualZeros(story);
  markDirty(story);
  const nodes = reviewNodes.get(index); if (nodes) updateReviewRow(story, index, nodes);
  display();
}
function resetLevel(index) {
  const story = currentStory(); if (!story || story.deleting || libraryMutation) return;
  story.model.resetOverride(index);
  story.explicitCorrections.delete(index);
  controller.setLevel(index, story.model.effectiveLevels()[index]);
  syncManualZeros(story);
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
  if (story === currentStory()) syncReaderMapping(story);
  display();
  try {
    const complete = await task;
    if (story !== currentStory() || operation !== selectionEpoch || !stories.includes(story)) return;
    if (!complete) { display(); return; }
    // Analysis can populate a mapping, never arm or start playback.
    syncReaderMapping(story);
    markDirty(story);
    renderReview();
    display();
  } catch {
    if (story !== currentStory() || operation !== selectionEpoch) return;
    pause("Suggestions need attention. You can keep reading and retry analysis.");
    syncReaderMapping(story);
    display();
  } finally {
    if (story.analysisPromise === task) story.analysisPromise = null;
    if (story === currentStory() && story.model.analysisStatus === "pending" && !story.analysisPromise && !story.deleting) void analyse(story);
  }
}
function selectStory(id, {focusReader = isNarrow()} = {}) {
  const story = stories.find(value => value.id === id);
  if (!story || story.deleting || libraryMutation) return;
  if (setupFlow?.snapshot().phase === "reading") setupFlow.cancel();
  cancelImport();
  story.lastOpenedAt = Date.now();
  if (story.id === activeId) {
    pause("Story remains open. Confirm Start when ready.");
    if (isNarrow()) setPanel("library", false, {restore: false});
    scrollToCurrent();
    if (focusReader) $("story-title").focus({preventScroll: true});
    renderLibrary();
    return;
  }
  closeDialogs();
  pause("Story opened. Confirm Start when you want simulated playback.");
  const previous = currentStory();
  if (previous && previous !== story) previous.model.cancelAnalysis();
  ++selectionEpoch;
  activeId = id;
  revealUpcoming = false;
  $("review-settings").open = false;
  selectSettingsTab("reader");
  renderStory();
  synchronizing = true;
  const position = story.position;
  controller.setStory(story.model.effectiveLevels());
  syncManualZeros(story);
  controller.setPosition(position);
  synchronizing = false;
  if (isNarrow()) setPanel("library", false, {restore: false});
  display(); renderLibrary();
  scrollToCurrent();
  if (focusReader) $("story-title").focus({preventScroll: true});
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
  if (!story || document.hidden || anyDialog() ||
      (isNarrow() && (!$("settings-panel").hidden || !$("library-panel").hidden)) || !$("follow-scroll").checked) return;
  // Short stories can fit entirely above the reading anchor. At the document
  // top, a layout change or Start is not evidence that the reader moved on.
  if (scrollY + (window.visualViewport?.offsetTop ?? 0) <= 1 && story.position === 0) return;
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
  if(open)recordAllowedEvent({type:"view",panel:name === "settings" ? "sidebar" : "library"});
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
  if (!dialog) return;
  if (dialog.open) dialog.close();
  if (restore) {
    const opener = dialogOpeners.get(id);
    if (opener?.isConnected && !opener.disabled) opener.focus({preventScroll: true});
  }
  dialogOpeners.delete(id);
}
function closeDialogs() {
  for (const id of ["new-story-dialog", "start-dialog", "ceiling-dialog", "save-dialog", "app-settings-dialog"]) closeDialog(id, {restore: false});
  startIntent = ceilingIntent = saveIntent = null;
}
function stopEverything() {
  const setup = setupFlow?.snapshot();
  if (setup?.active && setup.phase !== "reading") setupFlow.cancel();
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
    const story = makeStory({title, text: source, folderId: folders.some(folder => folder.id === folderFilter) ? folderFilter : null});
    stories.push(story);
    closeDialog("new-story-dialog", {restore: false});
    $("source").value = ""; $("story-title-input").value = "";
    selectStory(story.id, {focusReader: true});
    show("Your story is open. Read now; suggestions are prepared quietly on this page.");
  } catch (error) {
    if (operation !== importEpoch) return;
    text("import-status", error instanceof TypeError ? "Could not open this story. Your other stories are unchanged. Please try again." : error.message);
  } finally {
    if (operation === importEpoch) { setImporting(false); $("file").value = ""; display(); }
  }
}

function openDraft() {
  if (libraryLoading || libraryMutation) return;
  if (setupFlow?.snapshot().active) setupFlow.cancel();
  cancelImport(); closeDialogs(); pause("New story. Write or paste below.");
  currentStory()?.model.cancelAnalysis(); ++selectionEpoch; activeId = null;
  renderStory(); controller.setStory([]); display(); renderLibrary();
  if (isNarrow()) setPanel("library", false, {restore: false});
  $("draft-story")?.focus({preventScroll: true});
  window.scrollTo({top: 0, behavior: "instant"});
}

function addPreparedStory(record, {folderId = null} = {}) {
  if (stories.length >= 20) throw new Error("Your library holds up to 20 stories. Remove one before adding another.");
  const title = record.title?.trim() || "Untitled story";
  if (title.length > 120) throw new Error("Choose a title up to 120 characters.");
  const story = makeStory({...record, title, folderId});
  stories.push(story); selectStory(story.id, {focusReader: true});
  return story;
}

async function openDraftText() {
  if (libraryLoading || libraryMutation || importing) return;
  const source = $("draft-story").value;
  if (!source.trim()) { text("draft-status", "Write or paste your story first."); $("draft-story").focus(); return; }
  cancelImport(); pause("Opening your story.");
  try {
    addPreparedStory({title: $("draft-title").value, text: source},
      {folderId: folders.some(folder => folder.id === folderFilter) ? folderFilter : null});
    $("draft-story").value = ""; $("draft-title").value = ""; text("draft-status", "");
    show("Your story is ready. Saved only if you choose to keep it on this browser.");
  } catch (error) { text("draft-status", error.message || "Could not open your story. Your writing is still here."); }
}

function showImportPanel() {
  if (anyDialog()) closeDialogs();
  setPanel("settings", true, {restore: false}); selectSettingsTab("reader");
  $("story-url")?.focus({preventScroll: true});
}

async function importStoryUrl() {
  if (libraryLoading || libraryMutation || importing) return;
  for (const id of ["open-source-link", "paste-source-trigger"]) if ($(id)) $(id).hidden = true;
  let plan;
  try { plan = identifyStoryUrl($("story-url").value); }
  catch (error) { text("url-import-status", error.message); return; }
  const link = $("open-source-link");
  if (link) { link.href = plan.url; link.textContent = `Open ${plan.name}`; link.hidden = false; }
  if ($("paste-source-trigger")) $("paste-source-trigger").hidden = plan.automatic;
  if (!plan.automatic) {
    text("url-import-status", plan.guidance);
    // Keep the source openable without automatically opening a new tab.
    return;
  }
  cancelImport(); pause("Importing the story you selected.");
  const operation = importEpoch;
  linkBusy = true; setImporting(true); text("url-import-status", "Opening this public AO3 page…");
  try {
    const record = await webImporter.read(plan.url);
    if (!record || operation !== importEpoch || document.hidden || libraryMutation) return;
    addPreparedStory(record, {folderId: folders.some(folder => folder.id === folderFilter) ? folderFilter : null});
    text("url-import-status", `${record.scope || "Story"} imported. You can read now.`);
    $("story-url").value = "";
    if (isNarrow()) setPanel("settings", false, {restore: false});
  } catch (error) {
    if (operation === importEpoch) text("url-import-status", error.message || "This page could not be imported. Open the source and paste text you have permission to use.");
  } finally { if (operation === importEpoch) { linkBusy = false; setImporting(false); display(); } }
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
  if (!canStartHere() || !intent || story?.id !== intent.id || !story.model.analysisReady || document.hidden ||
      latest.ceiling !== intent.ceiling || latest.strength !== intent.strength || playbackIdentity() !== intent.device || !latest.connected) return;
  const operation = ++startEpoch;
  pendingStart = true; display();
  let release = null;
  try {
    if (hostedMode) {
      const allowed = await hostedAccess.check({fresh: true});
      if (!allowed || !canStartHere() || operation !== startEpoch || document.hidden || currentStory() !== story ||
          !story.model.analysisReady || latest.ceiling !== intent.ceiling || latest.strength !== intent.strength || playbackIdentity() !== intent.device || !latest.connected) return;
    }
    release = await acquirePlayback();
    if (!canStartHere() || operation !== startEpoch || document.hidden || currentStory() !== story || !story.model.analysisReady ||
        latest.ceiling !== intent.ceiling || latest.strength !== intent.strength || playbackIdentity() !== intent.device) { release?.(); return; }
    if (!release) {
      show(navigator.locks ? "Another tab is playing. Pause it first." :
        "Playback needs a browser with Web Locks support. You can still read and correct levels.");
      return;
    }
    pendingLease = release;
    playingLease = release;
    pendingLease = null;
    if (!controller.start()) { release(); if (playingLease === release) playingLease = null; }
  } catch {
    release?.();
    if (operation === startEpoch) controller.pause("Playback could not start. Reconnect and try again.");
  } finally {
    if (operation === startEpoch) { pendingStart = false; display(); }
  }
}
async function removeStory(story, {keepSession = false} = {}) {
  if (!story || story.deleting || libraryMutation) return;
  cancelImport();
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

function openNewStory() {
  if (libraryMutation || libraryLoading) return;
  if (setupFlow?.snapshot().active) setupFlow.cancel();
  cancelImport(); text("import-status", ""); openDialog("new-story-dialog"); $("story-title-input").focus();
}
function selectSettingsTab(name, {focus = false} = {}) {
  settingsTab = name === "story" ? "story" : "reader";
  for (const value of ["reader", "story"]) {
    const tab = $(`settings-${value}-tab`), panel = $(`${value}-settings`);
    if (tab) { tab.setAttribute("aria-selected", String(settingsTab === value)); tab.tabIndex = settingsTab === value ? 0 : -1; }
    if (panel) panel.hidden = settingsTab !== value;
  }
  if (focus) $(`settings-${settingsTab}-tab`)?.focus({preventScroll: true});
  if (settingsTab === "story") renderReview();
}
function savePreferences(patch) {
  const result = preferences.update(patch);
  text("reader-preferences-note", result.message);
  if (!result.saved) show(result.message);
}
async function restoreBackup(file) {
  if (libraryMutation || libraryLoading) return;
  cancelImport(); pause("Opening a local backup. Playback stays paused.");
  const operation = importEpoch;
  backupBusy = true; setImporting(true); display();
  text("library-transfer-status", "Opening and checking the backup on this browser…");
  try {
    const records = await backupImporter.read(file, {existingIds: stories.map(story => story.id)});
    if (!records || operation !== importEpoch || document.hidden || libraryMutation) return;
    // Validate the complete combined workspace before changing anything.
    serializeBackup([...stories.map(storyRecord), ...records]);
    const additions = records.map(record => makeStory(record));
    if (operation !== importEpoch || document.hidden || libraryMutation) return;
    stories.push(...additions);
    selectStory(additions[0].id, {focusReader: true});
    text("library-transfer-status", `${additions.length} ${additions.length === 1 ? "story restored" : "stories restored"} for this session. Save on this browser only if you want to keep each one here.`);
    show("Backup opened locally. Restored stories are session-only and playback remains paused.");
  } catch (error) {
    if (operation === importEpoch) text("library-transfer-status", error.message || "Could not open this backup. Your existing stories are unchanged.");
  } finally {
    if (operation === importEpoch) { backupBusy = false; setImporting(false); if ($("import-backup")) $("import-backup").value = ""; display(); }
  }
}
function exportStories(records, filename) {
  pause("Paused while you export a local backup.");
  try { text("library-transfer-status", downloadBackup(records, {filename}).message); }
  catch (error) { text("library-transfer-status", error.message); }
}
$("new-story").addEventListener("click", openDraft);
$("empty-new-story").addEventListener("click", openNewStory);
$("open-draft")?.addEventListener("click", () => void openDraftText());
$("draft-story")?.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void openDraftText(); } });
$("empty-link-import")?.addEventListener("click", showImportPanel);
$("upload-story-trigger")?.addEventListener("click", () => { openNewStory(); $("file").click(); });
$("paste-source-trigger")?.addEventListener("click", () => { openDraft(); if (isNarrow()) setPanel("settings", false, {restore: false}); $("draft-story").focus(); });
$("import-url")?.addEventListener("click", () => void importStoryUrl());
$("story-url")?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void importStoryUrl(); } });
$("open-app-settings")?.addEventListener("click", () => openDialog("app-settings-dialog"));
for (const id of ["close-app-settings", "app-settings-close"]) $(id)?.addEventListener("click", () => closeDialog("app-settings-dialog"));
for (const id of ["open-setup", "empty-setup", "choose-toy"]) $(id)?.addEventListener("click", () => {recordAllowedEvent({type:"step",step:"choose"});setupFlow?.open();});
$("open-calibration")?.addEventListener("click",()=>{recordAllowedEvent({type:"step",step:"calibration"});setupFlow?.openCalibration();});
$("open-account-welcome")?.addEventListener("click",()=>{closeDialog("app-settings-dialog");if(accountClient?.snapshot().registered){setPanel("settings",true);$("account-preset-picker")?.focus();}else accountWorkspace?.focus();});
$("feel-channel")?.addEventListener("change",async()=>{
  const channel=$("feel-channel").value, mode=latest.feel?.mode || "story";
  feelEditingChannel=channel;
  if((latest.activeChannels || []).length>1&&(latest.activeChannels || []).includes(channel)){updateFeelControls(latest);return;}
  try{cancelStart();if(await controller.applyCalibration(channel))controller.setFeel({mode});recordAllowedEvent({type:"control",control:"action",value:channel});}
  catch(error){show(error.message||"The movement could not be changed.");}display();
});
$("feel-mode")?.addEventListener("change",()=>{cancelStart();controller.setFeel({mode:$("feel-mode").value});recordAllowedEvent({type:"control",control:"continuity",value:$("feel-mode").value});});
for(const key of ["minimum","background","preferred","recovery","maximum"])$("feel-"+key)?.addEventListener("input",()=>{
  try{
    cancelStart();const value=Number($("feel-"+key).value), settings={...selectedSettings(),[key]:value};
    settings.minimum=Math.min(settings.minimum,settings.maximum);
    settings.background=Math.max(settings.minimum,Math.min(settings.maximum,settings.background));
    settings.preferred=Math.max(settings.minimum,Math.min(settings.maximum,settings.preferred));
    settings.recovery=Math.min(settings.recovery,settings.maximum);
    controller.setChannelFeel(feelEditingChannel || latest.channel,settings);
    recordAllowedEvent({type:"control",control:key,channel:feelEditingChannel || latest.channel,value});
  }catch(error){show(error.message||"Check the movement settings.");display();}
});
$("feel-rhythm")?.addEventListener("change",()=>{try{const settings={...selectedSettings(),rhythm:$("feel-rhythm").value};controller.setChannelFeel(feelEditingChannel || latest.channel,settings);recordAllowedEvent({type:"control",control:"rhythm",channel:feelEditingChannel || latest.channel,value:settings.rhythm});}catch(error){show(error.message);} });
$("enable-personal-range")?.addEventListener("click",async()=>{try{pause("Paused while you choose this movement's personal range.");await controller.enablePersonalRange({channel:feelEditingChannel || latest.channel});display(controller.snapshot());}catch(error){show(error.message||"Complete the gentle movement and Stop check first.");}});
$("manual-level")?.addEventListener("input",()=>{try{const channel=feelEditingChannel || latest.channel,value=Number($("manual-level").value);if((latest.activeChannels || []).length>1){const levels={...latest.channelOutputs,[channel]:value};controller.holdChannels(levels);}else controller.hold(value);recordAllowedEvent({type:"control",control:"hold",channel,value});display(controller.snapshot());}catch(error){show(error.message||"Check the current output before changing it.");}});
for(const[id,value]of[["mark-good",5],["mark-uncomfortable",1]])$(id)?.addEventListener("click",()=>{
  if(betaRecorder?.snapshot().recording!==true)return;
  recordAllowedEvent({type:"rating",question:"comfort",value,channel:feelEditingChannel || latest.channel});
  text("beta-feedback-status","Marked in this beta recording. Your controls are unchanged.");
});
$("apply-combined")?.addEventListener("click",async()=>{try{const channels=Array.from($("combination-choices").querySelectorAll('input:checked')).map(input=>input.value);if(!channels.length)throw Error("Choose at least one movement.");const mode=latest.feel?.mode||"story";pause("Applying movement choices.");if(channels.length===1){await controller.applyCalibration(channels[0]);controller.setFeel({mode});}else await controller.applyChannels(channels,{mode});display(controller.snapshot());}catch(error){show(error.message||"The movements could not be combined.");}});
$("control-playground")?.addEventListener("click",()=>{setupFlow?.cancel();addPreparedStory({...PRACTICE_STORY,controlled:true,betaId:"control-check-v1"});setPanel("settings",true);show("Choose Start, then try Hold, Ease off and the movement settings. Everything opens paused.");});
for(const[id,action]of[["feel-hold","hold"],["feel-easeoff","easeoff"],["feel-follow","follow"]])$(id)?.addEventListener("click",()=>{
  cancelStart();if(action==="hold")controller.hold();else if(action==="easeoff")controller.easeOff();else controller.followStory();
  recordAllowedEvent({type:"control",control:action,channel:latest.channel});display(controller.snapshot());
});
$("folder-filter")?.addEventListener("change", event => { folderFilter = event.target.value; renderLibrary(); });
$("create-folder")?.addEventListener("click", () => { pause("Choose a folder name."); const name = prompt("Folder name"); if (name?.trim()) void changeFolder("create", name.trim()); });
$("rename-folder")?.addEventListener("click", () => { const folder = folders.find(value => value.id === folderFilter); if (!folder) return; pause("Rename this folder."); const name = prompt("Folder name", folder.name); if (name?.trim()) void changeFolder("rename", name.trim()); });
$("delete-folder")?.addEventListener("click", () => { const folder = folders.find(value => value.id === folderFilter); if (!folder) return; pause("Choose whether to remove this folder."); if (confirm(`Remove the folder “${folder.name}”? Its stories will move to Unfiled.`)) void changeFolder("delete"); });
$("story-folder")?.addEventListener("change", event => { const story = currentStory(); if (!story || libraryMutation || story.deleting) return; story.folderId = folders.some(folder => folder.id === event.target.value) ? event.target.value : null; markDirty(story); renderLibrary(); display(); });
$("library-search")?.addEventListener("input", event => { libraryQuery = event.target.value; renderLibrary(); });
$("library-sort")?.addEventListener("change", event => { librarySort = event.target.value; renderLibrary(); });
$("import-backup-trigger")?.addEventListener("click", () => $("import-backup").click());
$("import-backup")?.addEventListener("change", event => { const file = event.target.files?.[0]; if (file) void restoreBackup(file); });
$("export-library")?.addEventListener("click", () => { if (stories.length) exportStories(stories.map(storyRecord), "satinlore-library-backup.json"); });
$("export-story")?.addEventListener("click", () => { const story = currentStory(); if (story) exportStories([storyRecord(story)], "satinlore-story-backup.json"); });
for (const name of ["reader", "story"]) {
  $(`settings-${name}-tab`)?.addEventListener("click", () => { pause("Settings changed. Confirm Start to continue."); selectSettingsTab(name); });
  $(`settings-${name}-tab`)?.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? "reader" : event.key === "End" ? "story" : name === "reader" ? "story" : "reader";
    $(`settings-${target}-tab`)?.focus({preventScroll: true});
  });
}
$("retry-access")?.addEventListener("click", () => { pause("Checking sign-in. Playback stays paused."); void hostedAccess?.check({fresh: true}); });
$("load").addEventListener("click", () => {
  const source = $("source").value;
  if (!source.trim()) { text("import-status", "Paste your story or choose a file."); $("source").focus(); return; }
  void prepareText(() => source);
});
$("file").addEventListener("change", event => { const file = event.target.files[0]; if (file) void prepareText(async () => { const record = await readStoryFile(file); if (record.title && !$("story-title-input").value.trim()) $("story-title-input").value = record.title; return record.text; }); });
$("cancel-import").addEventListener("click", () => { cancelImport(); closeDialog("new-story-dialog"); });
for (const id of ["stop", "start-stop", "ceiling-stop", "save-stop", "import-stop"]) $(id)?.addEventListener("click", stopEverything);
for (const id of ["new-story-dialog", "start-dialog", "ceiling-dialog", "save-dialog", "app-settings-dialog"]) $(id).addEventListener("cancel", event => {
  event.preventDefault(); cancelImport(); cancelStart(); ceilingIntent = saveIntent = null; closeDialog(id); display();
});
$("start").addEventListener("click", () => {
  const story = currentStory();
  if (!canStartHere() || !story?.model.analysisReady || !latest.connected || latest.running || pendingStart || document.hidden) return;
  cancelPosition(); followPosition();
  openDialog("start-dialog");
  startIntent = {id: story.id, ceiling: latest.ceiling, strength: latest.strength, device: playbackIdentity()};
  const movement = (latest.activeChannels || [latest.channel || "vibrate"]).map(channel=>`${latest.channels?.find(item=>item.id===channel)?.label || channel} · up to ${Math.min(latest.ceiling,selectedSettings(latest,channel).maximum)}/20`).join(" + ");
  text("start-summary", `${latest.deviceLabel ?? "Lush simulator"} · ${movement} · maximum ${latest.ceiling}/20 · session strength ${formatStrength()}.${latest.mode === "lovense" ? " Physical beta: commands expire after two seconds; output is not measured." : " Your story stays on this browser."}`);
  text("confirm-start", `Start with maximum ${latest.ceiling}/20`);
});
$("confirm-start").addEventListener("click", () => void confirmStart());
$("cancel-start").addEventListener("click", () => { cancelStart(); closeDialog("start-dialog"); display(); });
$("pause").addEventListener("click", () => pause("Paused. Confirm Start to continue."));
$("connect").addEventListener("click", () => { pause("Preparing connection."); if (latest.mode === "lovense") setupFlow?.open(); else controller.connect(); });
$("disconnect").addEventListener("click", () => { pause("Disconnecting."); controller.disconnect(); });
$("cap").addEventListener("input", () => {
  const value = Number($("cap").value);
  if (!Number.isInteger(value) || value < 0 || value > 20) { display(); return; }
  cancelStart();
  controller.setCeilingFromControl(value);
  if((latest.activeChannels||[latest.channel]).length===1&&value>selectedSettings(latest,latest.channel).maximum)controller.setChannelFeel(latest.channel,{maximum:value});
  recordAllowedEvent({type:"control",control:"maximum",channel:latest.channel,value});
});
$("confirm-ceiling").addEventListener("click", () => {
  const intent = ceilingIntent; ceilingIntent = null; closeDialog("ceiling-dialog");
  if (intent && intent.storyId === activeId && !document.hidden) controller.confirmCeiling(intent.value, intent.expectedCeiling);
  display();
});
$("cancel-ceiling").addEventListener("click", () => { ceilingIntent = null; closeDialog("ceiling-dialog"); display(); });
for (const [id, delta] of [["strength-minus", -1], ["strength-plus", 1]]) $(id).addEventListener("click", () => {
  if (libraryMutation || currentStory()?.deleting) return;
  cancelStart();
  controller.setStrength(Math.max(0, Math.min(20, Math.round(latest.strength * 10) + delta)) / 10);
  recordAllowedEvent({type:"control",control:"strength",value:latest.strength});
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
  syncReaderMapping(story);
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
    stories.length = 0; folders = []; folderFilter = "all"; activeId = null; libraryError = "";
    $("source").value = ""; $("story-title-input").value = ""; $("file").value = "";
    if ($("draft-story")) $("draft-story").value = "";
    if ($("draft-title")) $("draft-title").value = "";
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
$("follow-scroll").addEventListener("change", () => { reflow("Reading mode changed. Confirm Start to continue."); savePreferences({follow: $("follow-scroll").checked}); });
$("font-size").addEventListener("change", () => {
  $("reader").className = `reader-size-${$("font-size").value}`; reflow("Reading size changed. Confirm Start to continue.");
  savePreferences({fontSize: $("font-size").value});
});
$("reading-width").addEventListener("change", () => {
  document.body.dataset.readingWidth = $("reading-width").value; reflow("Reading width changed. Confirm Start to continue.");
  savePreferences({width: $("reading-width").value});
});
$("reading-spacing").addEventListener("change", () => {
  $("reader").dataset.spacing = $("reading-spacing").value; reflow("Reading spacing changed. Confirm Start to continue.");
  savePreferences({spacing: $("reading-spacing").value});
});
window.addEventListener("satinlore:appearance", () => reflow("Appearance changed. Confirm Start to continue."));
window.addEventListener("resize", () => reflow("Reading layout changed. Confirm Start to continue."));
window.addEventListener("scroll", () => {
  if (programmaticScrollTop !== null && Math.abs(scrollY - programmaticScrollTop) < 1) { programmaticScrollTop = null; return; }
  programmaticScrollTop = null; settlePosition();
}, {passive: true});
document.addEventListener("keydown", event => {
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (event.altKey && event.shiftKey && key === "x") { event.preventDefault(); stopEverything(); return; }
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName) || event.target?.isContentEditable;
  if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && !typing && !anyDialog()) {
    const action = {n: openDraft, l: () => togglePanel("library"), ",": () => togglePanel("settings"), f: () => $("focus-mode").click()}[key];
    if (action) { event.preventDefault(); action(); return; }
  }
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
  if (document.hidden) {
    if (setupFlow?.snapshot().active) setupFlow.cancel();
    cancelImport(); pause("Paused when this tab became hidden. Confirm Start to continue."); closeDialogs();
    hostedAccess?.suspend();
  } else if (hostedAccess) void hostedAccess.resume();
  controller.setVisible(!document.hidden);
});
window.addEventListener("pagehide", () => { if (setupFlow?.snapshot().active) setupFlow.cancel(); cancelImport(); pause("Page closed."); closeDialogs(); hostedAccess?.suspend(); });
window.addEventListener("pageshow", () => { if (hostedAccess && !document.hidden) void hostedAccess.resume(); });
window.addEventListener("storage", event => {
  if (event.key !== "satinlore.library.v1" && event.key !== null) return;
  pause("The local library changed in another tab. Saved copies will not be overwritten silently.");
  libraryError = "The library changed in another tab. Reload to see its saved stories; session-only text remains in this tab until reload.";
  renderLibrary();
});

if (hostedMode) {
  // Local hardware checks stay available only in the local application.
  for (const link of document.querySelectorAll('a[href="/device-check"]')) link.hidden = true;
  const accessStatus = $("access-status");
  hostedAccess = new HostedAccessGuard({
    onChange: state => {
      hostedAccessReady = state.allowed;
      controller.setAuthorized?.(state.allowed);
      if (accessStatus && state.allowed) { accessStatus.hidden = true; accessStatus.replaceChildren(); }
      else if (accessStatus && state.state === "checking" && !state.allowed) {
        accessStatus.hidden = false; accessStatus.textContent = "Checking your private preview access…";
      }
      display();
    },
    onLost: reason => {
      pause(reason);
      closeDialog("start-dialog");
      if (accessStatus) {
        const explanation = document.createElement("span");
        explanation.textContent = `${reason} Your story is still readable. Save session-only stories before reloading to sign in. `;
        const retry = document.createElement("button"); retry.type = "button"; retry.className = "quiet-control";
        retry.textContent = "Check sign-in again";
        retry.addEventListener("click", () => void hostedAccess.check());
        const login = document.createElement("a"); login.href = "/"; login.textContent = "Reload to sign in";
        accessStatus.replaceChildren(explanation, retry, document.createTextNode(" "), login);
        accessStatus.hidden = false;
      }
    },
  });
  void hostedAccess.start({visible: !document.hidden});
}

const loadedPreferences = preferences.load();
const initialPreferences = loadedPreferences.preferences;
$("reading-width").value = initialPreferences.width;
$("font-size").value = initialPreferences.fontSize;
$("reading-spacing").value = initialPreferences.spacing;
$("follow-scroll").checked = initialPreferences.follow;
$("reader").className = `reader-size-${initialPreferences.fontSize}`;
$("reader").dataset.spacing = initialPreferences.spacing;
text("reader-preferences-note", loadedPreferences.message);
// These presentation modules consume snapshots; they never dispatch device commands.
if (document.createElementNS) {
  simulatorView = createSimulatorView($("simulator-visual"), {document, window});
  setupFlow = createSetupFlow({document, window, coachMount: $("setup-coach-mount"),
    enableCalibration: true,
    onCalibrationChange: ({channel,settings}) => controller.setCalibration(channel,settings),
    onApplyCalibration: ({channel,settings}) => controller.applyCalibration(channel,settings),
    onCalibrationModeChange: mode => controller.setFeel({mode}),
    onEnablePersonalRange: options => controller.enablePersonalRange(options),
    onApplyChannels: async ({channels,settings,mode}) => {
      for(const channel of channels)controller.setCalibration(channel,settings[channel]);
      return controller.applyChannels(channels,{mode});
    },
    onResearchEvent: recordCalibrationEvent,
    onConnect: options => { cancelImport(); pause("Preparing your connection."); return controller.beginConnection(options); },
    onSelectDevice: id => controller.selectDevice(id),
    onTest: options => {recordAllowedEvent({type:"control",control:"test",channel:options.channel,value:options.level});return controller.test(options);},
    onConfirmTest: () => controller.confirmTest(),
    onRefresh: () => controller.refresh(),
    onDisconnect: () => { pause("Disconnected from setup."); return controller.disconnect(); },
    onSimulateFailure: kind => controller.simulateFailure(kind),
    onPractice: record => {
      try {
        addPreparedStory(record);
        window.scrollTo({top: 0, behavior: "instant"});
        setPanel("settings", true, {restore: false}); selectSettingsTab("reader");
        return true;
      } catch (error) { show(error.message || "The practice story could not open."); return false; }
    },
    onStart: () => $("start").click(),
    onStop: () => { cancelImport(); pause("Setup paused. Start when you are ready."); },
    onFinish: () => { openDraft(); setPanel("settings", true, {restore: false}); selectSettingsTab("reader"); },
  });
  connection = controller.setupSnapshot();
  accountClient = new ReaderAccountClient({hosted:hostedMode});
  accountWorkspace = mountAccountWorkspace({client:accountClient,document,welcomeMount:$("account-welcome"),settingsMount:$("account-settings-mount"),presetMount:$("preset-mount"),
    getContext:()=>{
      const state=controller.snapshot(),channels={...state.calibration.channels};
      for(const channel of state.activeChannels || [state.channel])if(channels[channel])channels[channel]=selectedSettings(state,channel);
      return {model:state.model,mode:state.feel?.mode||"story",channels,activeChannels:state.activeChannels||[state.channel],ceiling:state.ceiling,storyId:currentStory()?.id||null};
    },
    onStop:()=>pause("Account settings changed. Start when ready."),
    onRegistered:()=>{closeDialog("app-settings-dialog");recordAllowedEvent({type:"step",step:"account"});setupFlow.open();},
    onApply:async preset=>{
      if(preset.toy!==latest.model)throw Error("Choose this preset's toy before applying it.");
      const available=new Set(controller.channels().map(c=>c.id));
      const channels=Object.keys(preset.channels).filter(channel=>available.has(channel));
      if(!channels.length)throw Error("This connection does not expose a movement saved in this preset.");
      for(const channel of channels)controller.setCalibration(channel,preset.channels[channel]);
      const selected=channels.includes(latest.channel)?latest.channel:channels[0];
      const wanted=(preset.activeChannels || [selected]).filter(channel=>available.has(channel));
      const applied=wanted.length>1&&latest.supportsCombined?await controller.applyChannels(wanted,{mode:preset.mode}):await controller.applyCalibration(selected);
      if(!applied)throw Error("The movement could not be applied. Reconnect and test it first.");
      controller.setFeel({mode:preset.mode});display(controller.snapshot());
      if(Number.isInteger(preset.ceiling))controller.setCeilingFromControl(Math.min(preset.ceiling,controller.snapshot().maxCeiling??5));
      if(channels.length!==Object.keys(preset.channels).length)show("Applied available movements only. Unavailable saved movements remain disabled.");
    },onResearchEvent:recordAllowedEvent,
  });
  void accountClient.load();
  betaRecorder=createBetaRecorder({hostname:window.location?.hostname});
  $("beta-feedback-controls").hidden=!betaRecorder.snapshot().enabled;
  mountBetaRecording({mount:$("beta-recording-mount"),recorder:betaRecorder,document,
    context:()=>({mode:latest.mode==="lovense"?"live":"simulator",toy:latest.model||"none"})});
  let wasRecording=false;
  betaRecorder.subscribe(state=>{const began=state.recording&&!wasRecording;wasRecording=state.recording;for(const id of ["mark-good","mark-uncomfortable"])$(id).disabled=!latest.running||!state.recording;if(began){recordedDevice=recordedStory=recordedStep="";recordControlSnapshot(latest);}});
  const setupDialog=$("setup-dialog"),recordingNode=$("beta-recording");
  if(setupDialog&&recordingNode&&typeof MutationObserver!=="undefined")new MutationObserver(()=>{
    if(setupDialog.open)setupDialog.prepend(recordingNode);else $("beta-recording-mount").append(recordingNode);
  }).observe(setupDialog,{attributes:true,attributeFilter:["open"]});
}
selectSettingsTab("reader");
setPanel("library", !isNarrow(), {restore: false});
setPanel("settings", false, {restore: false});
document.body.dataset.readingWidth = initialPreferences.width;
reserveDockSpace();
controller.setVisible(!document.hidden);
display(controller.snapshot());
renderLibrary();
void (async () => {
  try {
    const folderResult = await folderStore.loadAll();
    folders = folderResult.folders;
    if (folderResult.errors?.length) text("folder-status", folderResult.errors.join(" "));
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
