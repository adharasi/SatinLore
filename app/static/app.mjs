import {ReaderDeviceController} from "./devices/reader-device.mjs";
import {channelLabel} from "./devices/toy-profiles.mjs";
import {TextImporter} from "./reader/import.mjs";
import {createStoryId} from "./reader/identity.mjs";
import {ReaderModel} from "./reader/model.mjs";
import {StoryStore, MAX_STORY_DESCRIPTION, MAX_STORY_TITLE} from "./reader/storage.mjs";
import {isReadingJump, selectReadingParagraph} from "./reader/position.mjs";
import {HostedAccessGuard} from "./access.mjs";
import {selectLibraryStories, storyMetadata, renderStoryTabs} from "./reader/library-view.mjs";
import {BackupImporter, serializeBackup, downloadBackup} from "./reader/backup.mjs";
import {ReaderPreferences} from "./reader/preferences.mjs";
import {FolderStore, selectFolderStories} from "./reader/folders.mjs";
import {WebStoryImporter, identifyStoryUrl, readStoryFile} from "./reader/web-import.mjs";
import {createSimulatorView} from "./reader/simulator-view.mjs";
import {createSetupFlow} from "./reader/setup-flow.mjs";
import {PRACTICE_STORIES} from "./reader/practice-stories.mjs";
import {ReaderAccountClient, mountAccountWorkspace} from "./reader/account-workspace.mjs";
import {AccountLibrary} from "./reader/account-library.mjs";
import {DEFAULT_EXPERIENCE, validateExperience} from "./reader/experience-preferences.mjs";
import {mountExperienceDialog} from "./reader/experience-dialog.mjs";
import {mountPublicAccount} from "./reader/public-account.mjs";
import {createBetaRecorder, mountBetaRecording} from "./reader/beta-recording.mjs";
import {mountReadingFeedback} from "./reader/reading-feedback.mjs";
import {clampCalibration, DEFAULT_SIMULATOR_MAXIMUM, sceneStagePatternLabel, selectPeakPreset} from "./reader/calibration.mjs";
import {nocturneAvailable, nocturneCandidates, requestNocturne} from "./reader/nocturne.mjs";
import {storyToyRecommendation} from "./reader/toy-recommendations.mjs";

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
let publicAccount = null, publicSignedIn = false;
let peakChoice = {peakPattern: "auto", edging: false};
let savingPeakChoice = false;
let recordedDevice = "", recordedStory = "", recordedStep = "", feelChannelSignature = "", feelEditingChannel = null, combinationSignature = "";
let connection = {mode: "simulator", model: "lush", toys: [], selectedId: null};
const backupImporter = new BackupImporter();
const preferences = new ReaderPreferences();
const stories = [];
let libraryQuery = "";
let librarySort = "updated";
let backupBusy = false;
let settingsTab = "reader";
let openedFirstStory = false;
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
let scrollWindow = {start: 0, last: 0, at: 0};
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
const publicMode = document.querySelector('meta[name="satinlore-public-auth"]')?.content === "true";
const accountLibrary = publicMode ? new AccountLibrary() : null;
const sessionChangeKey = "satinlore.public-session-change";
let pendingAccountLibrary = null, localLibraryReady = Promise.resolve();
let accountPreferences = null;
let accountExperience = null, guestExperience = null;
const offeredExperience = new Set();
const currentExperience = () => accountExperience ?? guestExperience ?? DEFAULT_EXPERIENCE;
const experienceDialog = mountExperienceDialog({document,
  openDialog: opener => openDialog("experience-dialog", opener),
  closeDialog: options => closeDialog("experience-dialog", options),
  save: savePlaybackPreferences,
  finish: ({initial, saved, continuation}) => {
    if (continuation) continuation();
    else if (initial && saved) setupFlow?.open({mode: "lovense"});
  },
});
const hostedMode = publicMode || document.querySelector('meta[name="satinlore-hosted-access"]')?.content === "true";
let nocturneReady = null, checkingNocturne = false, nocturneOperation = null;
let nextStoryModel = "loom";
let recommendationModel = null, recommendationGeneration = null;
let hostedAccess = null;
let hostedAccessReady = !hostedMode;
const hasVerifiedAccess = () => !hostedMode || Boolean(hostedAccessReady && hostedAccess?.isAuthorized());
const canStartHere = () => publicMode && latest.mode !== "lovense" || hasVerifiedAccess();
let latest = {state: "DISCONNECTED", connected: false, running: false, output: 0,
  ceiling: DEFAULT_SIMULATOR_MAXIMUM, levelAdjustment: 0, baseLevel: 0, target: 0, position: 0, reason: "Open a story to begin."};

const currentStory = () => stories.find(story => story.id === activeId) ?? null;
const playbackIdentity = () => JSON.stringify([latest.mode || "simulator",connection.selectedId || latest.selectedDeviceId || "",latest.activeChannels || [latest.channel || "vibrate"],latest.calibration?.channels || {}]);
const isNarrow = () => window.matchMedia("(max-width: 1099px)").matches;
function text(id, value) {
  const node = $(id);
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}
function show(message) { text("message", message); }
function recordAllowedEvent(event) { try { return betaRecorder?.record(event) === true; } catch { return false; } }
const readingFeedback = mountReadingFeedback({mount: $("reading-feedback"), record: recordAllowedEvent});
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
function readerProfiles(story) {
  return story.controlled ? undefined : story.model.effectiveProfiles({nocturne: story.sceneModel === "nocturne", ...peakChoice});
}
function syncReaderMapping(story) {
  controller.updateLevels(story.model.effectiveLevels(), readerProfiles(story));
  syncManualZeros(story);
}
function applyReadingDefaults(values) {
  const previous = peakChoice;
  peakChoice = {peakPattern: values?.peakPattern ?? "auto", edging: values?.edging === true};
  cancelStart();
  controller.setReadingDefaults(values);
  const story = currentStory();
  if (story?.sceneModel === "nocturne" && !story.controlled &&
      (previous.peakPattern !== peakChoice.peakPattern || previous.edging !== peakChoice.edging)) {
    pause("Peak pattern changed. Choose Start when ready.");
    syncReaderMapping(story);
  }
  display(controller.snapshot());
}
function renderNocturnePeakSettings(story) {
  $("nocturne-peak-settings").hidden = !story || story.controlled || story.sceneModel !== "nocturne";
  $("nocturne-peak-pattern").value = peakChoice.peakPattern;
  $("nocturne-peak-pattern").disabled = Boolean(savingPeakChoice || libraryMutation || story?.deleting);
}
function selectedSettings(state = latest,channel = feelEditingChannel || state.channel) {
  const stored = state.calibration?.channels?.[channel] || {minimum:0,background:1,preferred:3,maximum:5,recovery:0,gain:1,rhythm:"steady"};
  const source=state.feel?.channels?.[channel] || (channel===state.channel ? state.feel : {}) || {};
  const keys=["minimum","background","preferred","recovery","gain","rhythm"];
  const feel=Object.fromEntries(keys.filter(key=>Object.hasOwn(source,key)).map(key=>[key,source[key]]));
  // Active policy is authoritative; an unapplied calibration draft cannot narrow
  // the displayed limit while leaving the actual output policy unchanged.
  const maximum=source.maximum??stored.maximum;
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
  $("feel-mode").value=feel.mode === "continuous" && feel.quietEdging ? "edging" : feel.mode;
  const editRange=state.mode!=="lovense"?20:(state.personalRangeChannels || []).includes(feelEditingChannel)?20:5;
  for(const key of ["minimum","background","preferred","recovery","maximum"]){$("feel-"+key).value=settings[key];$("feel-"+key).max=key==="maximum"?editRange:settings.maximum;text("feel-"+key+"-value",settings[key]);}
  $("feel-rhythm").value=settings.rhythm;
  const output=state.channelOutputs?.[feelEditingChannel]??state.output;
  if($("manual-level")){$("manual-level").value=typeof output==="number"?output:0;$("manual-level").max=Math.min(settings.maximum,state.ceiling);$("manual-level").disabled=!state.running||typeof output!=="number";text("manual-level-value",typeof output==="number"?output:"Unknown");}
  for(const id of ["feel-hold","feel-easeoff","feel-follow"])$(id).disabled=!state.running;
  for(const id of ["mark-good","mark-uncomfortable"])if($(id))$(id).disabled=!state.running||betaRecorder?.snapshot().recording!==true;
  const quietStatus = feel.mode !== "continuous" ? "" : feel.quietEdging && state.mode === "simulator" ? " · gentle pulses in quiet passages" : " · light background in quiet passages";
  text("feel-status",feel.playbackMode==="hold"?"Holding your chosen level":feel.playbackMode==="ease-off"?"Eased off · automatic increases are held":"Following the story"+quietStatus);
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
  const preferredMovement = $("scene-preferred-movement");
  if (preferredMovement) {
    const active = channels.filter(channel => state.activeChannels?.includes(channel.id));
    $("scene-movement-settings").hidden = !feel.combined;
    if (feel.combined) {
      if (preferredMovement.children.length !== active.length ||
          active.some((channel, index) => preferredMovement.children[index]?.value !== channel.id)) {
        preferredMovement.replaceChildren(...active.map(channel => {
          const option = document.createElement("option");
          option.value = channel.id;
          option.textContent = channel.label;
          return option;
        }));
      }
      preferredMovement.value = feel.preferredMovement;
      $("scene-auto-movement").checked = feel.automaticMovement;
    }
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
function saveState(story) {
  if (!story) return {state: "session", label: "Session only"};
  if (story.saveError) return {state: "error", label: story.saveError};
  if (story.saving) return {state: "saving", label: story.accountOwner ? "Saving to your account…" : "Saving story…"};
  if (!story.saved) return {state: "session", label: "Session only · not saved"};
  if (story.dirty) return {state: "dirty", label: "Unsaved changes · retry Save"};
  return {state: "saved", label: story.accountOwner ? "Saved to your account" : "Saved on this browser"};
}

function renderFolders() {
  if (!$("folder-filter") || !$("story-folder")) return;
  const story = currentStory();
  const signature = JSON.stringify([folders, folderFilter, story?.id, story?.folderId, story?.accountOwner, story?.deleting, libraryLoading, libraryMutation]);
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
  $("story-folder").disabled = !story || libraryMutation || story.deleting || Boolean(story.accountOwner);
  $("create-folder").disabled = libraryLoading || libraryMutation;
  $("folder-filter").disabled = libraryLoading || libraryMutation;
  for (const id of ["rename-folder", "delete-folder"]) $(id).disabled = libraryLoading || libraryMutation || !folders.some(folder => folder.id === folderFilter);
}

async function changeFolder(action, name) {
  if (libraryLoading || libraryMutation) return;
  const folder = folders.find(value => value.id === folderFilter);
  if (action !== "create" && !folder) return;
  pause("Updating your shelves.");
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
    text("folder-status", action === "delete" ? "Shelf removed. Its stories are in Unfiled." : "Shelf saved on this browser.");
  } catch (error) { text("folder-status", error.message || "Could not update this shelf. Your stories are unchanged."); }
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
  const focused = document.activeElement?.dataset;
  let nextFocus;
  for (const story of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-item";
    button.dataset.storyId = story.id;
    button.disabled = libraryMutation || story.deleting;
    const title = document.createElement("span");
    title.className = "story-item-title";
    title.textContent = story.title;
    const meta = document.createElement("span");
    meta.className = "story-meta";
    meta.textContent = `${story.accountOwner ? "Saved to account" : story.saved ? "Saved here" : "Session only"} · ${story.position + 1} / ${story.model.paragraphs.length}`;
    button.append(title);
    button.addEventListener("click", () => selectStory(story.id));
    if (focused?.storyId === story.id) nextFocus = button;
    if (story.id !== activeId) {
      if (story.favorite) {
        const badge = document.createElement("span");
        badge.className = "story-favorite-badge";
        badge.textContent = "♥";
        badge.setAttribute("aria-label", "Favourite");
        title.append(badge);
      }
      button.append(meta);
      fragment.append(button);
      continue;
    }
    button.setAttribute("aria-current", "true");
    const card = document.createElement("div");
    card.className = "story-card";
    const heading = document.createElement("div");
    heading.className = "story-card-heading";
    const footer = document.createElement("div");
    footer.className = "story-card-footer";
    const controls = document.createElement("div");
    controls.className = "story-card-controls";
    const action = (name, label, onClick, pressed) => {
      const control = storyCardAction(story, name, label, onClick, pressed);
      if (focused?.storyActionId === story.id && focused.storyAction === name) nextFocus = control;
      return control;
    };
    heading.append(button, action("edit", "Edit story settings", opener => openStoryDetails(story, opener)),
      action("favorite", "Favourite story", () => { story.favorite = !story.favorite; markDirty(story); renderLibrary(); }, story.favorite));
    controls.append(action("duplicate", "Duplicate story", () => duplicateStory(story)),
      action("download", "Download story", () => exportStories([storyRecord(story)], "satinlore-story-backup.json", "story-action-status")),
      action("delete", "Delete story", () => deleteStory(story)));
    footer.append(meta, controls);
    card.append(heading);
    if (story.description) {
      const description = document.createElement("p");
      description.className = "story-card-description";
      description.textContent = story.description;
      card.append(description);
    }
    card.append(footer);
    fragment.append(card);
  }
  $("story-list").replaceChildren(fragment);
  if (!$("library-panel").hidden && (focused?.storyId || focused?.storyActionId)) {
    (nextFocus && !nextFocus.disabled ? nextFocus : $("library-search")).focus({preventScroll: true});
  }
  text("library-results", libraryQuery && !visible.length ? "No story titles match your search." :
    `${visible.length} of ${stories.length} ${stories.length === 1 ? "story" : "stories"}`);
  const nextTabs = JSON.stringify(stories.map(story => [story.id, story.title, story.lastOpenedAt, story.deleting]).concat([[activeId, libraryMutation]]));
  if (tabSignature !== nextTabs) {
    tabSignature = nextTabs;
    renderStoryTabs($("story-tabs"), stories, {activeId, disabled: libraryMutation,
      onSelect: id => selectStory(id, {focusReader: true})});
  }
  text("library-status", libraryLoading ? "Opening your local library…" : libraryError || (stories.length ?
    (publicMode ? "Save a story to your account to read it across devices. Session-only stories clear on reload." :
      "Saved stories stay on this browser. Session-only stories clear on reload.") : "No stories yet. Add one to start reading."));
  $("delete-all").disabled = libraryLoading || libraryMutation || (!stories.some(story => !story.accountOwner) && !folders.length && !libraryError);
}

const storyCardIcons = {
  edit: ["m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20ZM14 8l3 3", "✎"],
  favorite: ["M12 20.5 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.7.6-.7a4.8 4.8 0 0 1 6.8 6.8Z", "♡"],
  duplicate: ["M8 8h12v12H8zM16 8V4H4v12h4", "⧉"],
  download: ["M4 16v4h16v-4M12 4v11m-4-4 4 4 4-4", "↓"],
  delete: ["M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5", "×"],
};
function storyCardAction(story, name, label, onClick, pressed) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "story-card-button";
  button.dataset.storyAction = name;
  button.dataset.storyActionId = story.id;
  button.title = label;
  button.setAttribute("aria-label", label);
  if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
  button.disabled = libraryMutation || story.deleting;
  const [path, fallback] = storyCardIcons[name];
  if (document.createElementNS) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    button.append(svg);
  } else button.textContent = fallback;
  button.addEventListener("click", () => {
    if (story === currentStory() && !libraryMutation && !story.deleting) onClick(button);
  });
  return button;
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
  const pattern = story?.sceneModel === "nocturne" ? story.model.nocturneLabels.get(latest.position) : undefined;
  const preset = story?.sceneModel === "nocturne" ? selectPeakPreset(paragraph?.phase, pattern, peakChoice.peakPattern, peakChoice.edging) : undefined;
  const stagePattern = latest.mode === "simulator" && (selectedSettings().rhythm === "scene" || preset) ? sceneStagePatternLabel(paragraph?.phase, pattern, preset) : null;
  const rhythm = stagePattern ?? {steady: "Steady", gentle: "Gentle variation", dynamic: "More variation"}[paragraph?.rhythm];
  const endedMovements = paragraph?.endedMovements?.length ? `${paragraph.endedMovements.map(channelLabel).join(" + ")} paused in this scene` : null;
  const movements = paragraph?.movements?.length ? `Movement cue: ${paragraph.movements.map(channelLabel).join(" + ")}` :
    endedMovements ? null : "Default movement";
  const stage = {build: "Building", sustain: "Sustaining", peak: "Peak", recover: "Easing off"}[paragraph?.phase];
  text("level-source", !paragraph ? "No section selected." : paragraph.override !== null ? "Using your correction." :
    paragraph.sceneId && rhythm ?
      [`Scene ${paragraph.sceneId}`, stage, rhythm, movements, endedMovements, paragraph.advisory].filter(Boolean).join(" · ") :
      paragraph.advisory || (paragraph.quiet ? "Quiet section" : "Using the local suggestion."));
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
  readingFeedback.update(story, state);
  for (const id of ["new-story", "empty-new-story", "library-import-file", "upload-story-trigger"]) $(id).disabled = libraryLoading || libraryMutation;
  if ($("story-actions")) $("story-actions").hidden = !story;
  if (story && !synchronizing && story.position !== state.position) {
    story.position = state.position;
    story.furthest = Math.max(story.furthest, state.position);
    markDirty(story);
    renderLibrary();
  }
  text("status", ({DISCONNECTED: "Disconnected", READY_PAUSED: "Connected · paused",
    PLAYING: state.mode === "lovense" ? "Toy playback" : "Simulator running", CONNECTING: "Connecting…", STOPPING: "Stopping…", ERROR_PAUSED: "Error · paused"})[state.state] || "Paused");
  text("device-label", state.deviceLabel ?? "Lush simulator");
  text("connection-badge", state.mode === "lovense" ? "LIVE · BETA" : "SIMULATED");
  text("output-label", state.mode === "lovense" ? "Level sent to toy" : "Simulator level");
  $("transport").setAttribute("aria-label", state.mode === "lovense" ? "Toy playback controls" : "Simulator playback controls");
  text("output", state.outputKnown === false ? "Unconfirmed" : `${state.output ?? 0} / 20`);
  text("target-output", `${state.target ?? 0} / 20`);
  $("meter").value = state.output ?? 0;
  text("capValue", state.ceiling);
  $("cap").value = state.ceiling;
  $("cap").max = String(state.maxCeiling??(state.mode === "lovense" ? 5 : 20));
  text("ceiling-help", state.mode === "lovense" ? `This movement's available range is 0–${state.maxCeiling??5}. Reductions apply immediately. A higher maximum pauses until you choose Start; there is no extra popup.` : "Changes apply immediately within the simulator. Adjusting the maximum does not start playback.");
  $("cap").setAttribute("aria-valuetext", `${state.ceiling} out of 20 confirmed maximum`);
  const levelLocked = !story?.model.analysisReady || !state.connected || state.testing || libraryMutation || story.deleting;
  $("level-down").disabled = levelLocked || !state.levelDown;
  $("level-up").disabled = levelLocked || !state.levelUp;
  const reconnect = state.state === "ERROR_PAUSED";
  $("connect").disabled = state.connected && !reconnect;
  $("connect").hidden = state.connected && !reconnect;
  text("connect", reconnect ? "Reconnect" : "Connect");
  $("connect").setAttribute("aria-label", state.mode === "lovense" ? "Reconnect toy" : reconnect ? "Reconnect simulator" : "Connect simulator");
  $("connect").title = state.mode === "lovense" ? "Reconnect toy" : reconnect ? "Reconnect simulator" : "Connect simulator";
  $("disconnect").hidden = !state.connected || reconnect;
  $("disconnect").disabled = !state.connected && !pendingStart;
  $("start").disabled = !navigator.locks || !canStartHere() || !story?.model.analysisReady || importing || !!nocturneOperation || !state.connected || state.running ||
    pendingStart || state.state === "ERROR_PAUSED" || state.testing || state.mode === "lovense" && state.canStart === false || story?.deleting;
  let readiness;
  if (pendingStart) readiness = "Preparing this Start. Stop cancels it immediately.";
  else if (state.testing) readiness = "Wait for the two-second connection test to finish, then choose Start.";
  else if (state.running) readiness = "Playback is running. Pause or Stop before starting again.";
  else if (state.state === "ERROR_PAUSED") readiness = "Reconnect, then confirm Start again.";
  else if (state.outputKnown === false) readiness = "Output is unconfirmed. Check your toy and reconnect before starting.";
  else if (!canStartHere()) readiness = hostedAccess?.snapshot().state === "checking" ? "Checking sign-in. Start will be available when the check passes." :
    publicMode ? "Sign in to connect a physical toy. You can still try a simulator." : "Check your sign-in before starting. Your story is still readable.";
  else if (importing) readiness = "Opening your text. Start will be available after analysis and connection.";
  else if (libraryMutation || story?.deleting) readiness = "Finishing the library change. Playback stays paused.";
  else if (!story) readiness = "Add a story, or choose Set up a toy for a guided test read.";
  else if (!story.model.analysisReady) readiness = story.model.analysisStatus === "error" ? "Analysis needs attention. Open Advanced in Reading controls and choose Analyse again." : "Preparing story suggestions. You can keep reading while you wait.";
  else if (nocturneOperation) readiness = "Nocturne is reviewing scene cues. Start is available when it finishes.";
  else if (!state.connected) readiness = "Connect the simulator or set up a toy, then choose Start.";
  else if (!navigator.locks) readiness = "Start needs browser Web Locks. Use a current browser over HTTPS or localhost; reading still works here.";
  else if (state.mode === "lovense" && state.canStart === false) readiness = state.reason || "Complete Toy setup and confirm the short connection test before Start.";
  else readiness = `Ready. Start asks you to confirm maximum ${state.ceiling}/20. Stop keeps your story and connection ready.`;
  text("start-help", readiness);
  if ($("retry-access")) {
    $("retry-access").hidden = !hostedMode || canStartHere();
    $("retry-access").disabled = pendingStart || hostedAccess?.snapshot().state === "checking";
    if (publicMode) text("retry-access", "Sign in");
  }
  $("pause").disabled = !state.running && !pendingStart;
  $("previous").disabled = libraryMutation || !story || story.deleting || state.position === 0;
  $("next").disabled = libraryMutation || !story || story.deleting || state.position >= story.model.paragraphs.length - 1;
  $("sync-here").hidden = !story;
  $("sync-here").disabled = libraryMutation || !story || story.deleting;
  for (const id of ["save-story", "session-only", "rename-story", "delete-story", "reanalyze"]) {
    $(id).disabled = libraryMutation || !story || story.deleting || story.saving;
  }
  $("save-story").hidden = Boolean(story?.accountOwner);
  $("save-account-story").hidden = !publicMode || Boolean(story?.controlled);
  $("save-account-story").disabled = libraryMutation || !story || story.deleting || story.saving;
  text("save-account-story", story?.accountOwner ? "Save account changes" : story?.saved ? "Copy to my account" : "Save to my account");
  for (const id of ["export-library", "import-backup-trigger", "import-backup"]) if ($(id)) $(id).disabled = libraryLoading || libraryMutation || backupBusy || !stories.some(value => !value.accountOwner) && id === "export-library";
  if ($("export-story")) $("export-story").disabled = libraryMutation || !story || story.deleting || backupBusy;
  $("session-only").disabled ||= !story?.saved;
  text("story-title", story?.title ?? "Your reading space");
  text("header-story-title", story?.title ?? "Add a story to begin");
  text("position", state.readingSeeking ? "Finding your place…" : story ? `Section ${state.position + 1} of ${story.model.paragraphs.length}` : "");
  const metadata = storyMetadata(story);
  text("story-word-count", story ? `${metadata.words.toLocaleString()} words` : "");
  text("story-progress", story ? `${metadata.progressPercent}% · ${metadata.positionLabel}` : "");
  const analysis = story?.model.analysisStatus ?? "pending";
  $("analysis-status").dataset.state = analysis;
  text("analysis-status", !story ? "" : analysis === "ready" ? "Scene patterns ready · review is optional" :
    analysis === "error" ? "Suggestions need attention. You can keep reading or retry analysis." : "Analysing quietly on this page… You can read now.");
  renderToyRecommendation(story);
  renderStoryModel(story);
  renderNocturnePeakSettings(story);
  const saved = saveState(story);
  $("save-status").dataset.state = saved.state;
  text("save-status", saved.label);
  text("library-save-status", saved.label);
  $("empty-workspace").hidden = Boolean(story);
  $("reading-workspace").hidden = !story;
  const nextNode = story ? paragraphNodes[state.position] ?? null : null;
  if (activeNode !== nextNode) {
    if (activeNode) { activeNode.classList.remove("active"); activeNode.removeAttribute("aria-current"); activeNode.removeAttribute("data-playing"); }
    activeNode = nextNode;
    if (activeNode) { activeNode.classList.add("active"); activeNode.setAttribute("aria-current", "true"); }
  }
  if (activeNode) activeNode.dataset.playing = String(state.running && !state.readingSeeking);
  updateCurrentCorrection(story);
  simulatorView?.update(state);
  setupFlow?.update({...connection, ...state, canStart: !$("start").disabled, readiness: $("start-help").textContent});
  renderFolders();
}

function controlRecovery(state) {
  latest = state; cancelStart(); releasePlayback();
  if (activeNode) activeNode.dataset.playing = "false";
  for (const id of ["start", "pause"]) if ($(id)) $(id).disabled = true;
  if ($("connect")) { $("connect").disabled = false; $("connect").hidden = false; text("connect", "Reconnect"); }
  if ($("stop")) $("stop").disabled = false;
  text("status", "Controls need reconnecting"); text("output", state.mode === "lovense" ? "Unconfirmed" : "0 / 20");
  text("start-help", "The controls could not update. Stop was requested. Check your toy and reconnect before continuing.");
  show("The controls could not update. Reconnect; your story remains readable.");
}
const controller = new ReaderDeviceController({document, window, navigator, storyRhythms: true, allowGuestSimulation: publicMode,
  authorize: async () => !hostedMode || Boolean(await hostedAccess?.check({fresh: true}) && hasVerifiedAccess()),
  onSetupChange: state => { connection = state; setupFlow?.update({...latest, ...state, canStart: !$("start").disabled, readiness: $("start-help").textContent}); },
  onInterfaceError: controlRecovery, onChange: state => {
  const stopped = latest.running && !state.running;
  if (!state.running) releasePlayback();
  if (stopped) { cancelPosition(); cancelStart(); }
  display(state);
  show(state.reason);
}});
function pause(reason) {
  cancelNocturne();
  cancelStart(); cancelPosition();
  controller.pause(reason);
  releasePlayback();
  try { display(controller.snapshot()); } catch { controlRecovery(controller.snapshot()); }
}

function renderToyRecommendation(story) {
  const model = !story?.controlled && story?.model.analysisStatus === "ready" ? story.model : null;
  const generation = model?.analysisGeneration ?? null;
  if (model === recommendationModel && generation === recommendationGeneration) return;
  recommendationModel = model;
  recommendationGeneration = generation;
  $("story-toy-recommendations").hidden = !model;
  text("story-toy-recommendations-summary", model ? storyToyRecommendation(model.paragraphs) : "");
}

function renderStoryModel(story) {
  const analysedStory = story && !story.controlled;
  const selected = analysedStory ? story.sceneModel : nextStoryModel;
  const busy = Boolean(nocturneOperation);
  const signInNeeded = publicMode && !hasVerifiedAccess();
  $("scene-model").value = selected;
  $("scene-model").disabled = Boolean(story?.deleting || libraryMutation);
  text("scene-model-help", story?.controlled ? "This calibration story keeps its fixed levels. Choose a model for your next story, or open a model practice story to try it now." :
    analysedStory ? "Both models follow the scene’s pacing. Nocturne adds more ways to shape the peaks." :
    "Choose a model for your next story. Nocturne adds more ways to shape the peaks.");
  $("model-practice-shortcut").hidden = !story?.controlled;
  $("model-practice-shortcut").disabled = libraryMutation || story?.deleting;
  $("nocturne-panel").hidden = selected !== "nocturne" || !analysedStory;
  $("nocturne-sign-in").hidden = !signInNeeded;
  $("nocturne-run").hidden = signInNeeded;
  $("nocturne-run").disabled = !hostedMode || !story?.model.analysisReady || !hasVerifiedAccess() || busy || checkingNocturne || libraryMutation;
  text("nocturne-run", nocturneReady === false ? "Check availability" : "Analyse with Nocturne");
  text("nocturne-status", !hostedMode ? "Nocturne is available in the hosted SatinLore app." :
    signInNeeded ? "Sign in to compare Nocturne. Loom is ready as a guest." : checkingNocturne ? "Checking Nocturne availability…" : busy ? "Nocturne is reviewing eligible cues. Playback is paused." :
    story?.nocturneMessage || (nocturneReady === false ? "Nocturne is unavailable right now. Loom is ready." : "Choose Analyse with Nocturne when you’re ready."));
}

async function checkNocturne() {
  if (!hostedMode || !hasVerifiedAccess() || checkingNocturne) return;
  checkingNocturne = true; display();
  const available = await nocturneAvailable();
  nocturneReady = hasVerifiedAccess() ? available : null;
  checkingNocturne = false; display();
}

function cancelNocturne() {
  const operation = nocturneOperation;
  if (!operation) return;
  nocturneOperation = null;
  operation.abort.abort();
  operation.story.nocturneMessage = "Nocturne stopped. Loom patterns are ready.";
}

async function runNocturne() {
  const story = currentStory();
  if (!hostedMode || !hasVerifiedAccess() || document.hidden || !story?.model.analysisReady || story.sceneModel !== "nocturne" || nocturneOperation) return;
  if (nocturneReady !== true) { await checkNocturne(); return; }
  pause("Nocturne analysis pauses playback. Confirm Start after review.");
  story.model.nocturneLabels.clear();
  syncReaderMapping(story);
  const {cues, excluded, limited} = nocturneCandidates(story.model.paragraphs);
  const kept = [excluded ? `${excluded} ${excluded === 1 ? "section stayed" : "sections stayed"} with Loom because of content or context.` : "",
    limited ? `${limited} additional ${limited === 1 ? "section used" : "sections used"} Loom.` : ""].filter(Boolean).join(" ");
  if (!cues.length) {
    story.nocturneMessage = `Loom is ready. This story has no eligible Nocturne cues. ${kept}`.trim();
    display(); return;
  }
  const operation = {story, abort: new AbortController(), generation: story.model.analysisGeneration};
  nocturneOperation = operation; display();
  try {
    const {labels, code} = await requestNocturne(cues, {signal: operation.abort.signal});
    if (nocturneOperation !== operation || story !== currentStory() || story.model.analysisGeneration !== operation.generation ||
        story.sceneModel !== "nocturne" || document.hidden || !hasVerifiedAccess()) return;
    if (labels?.size) {
      story.model.nocturneLabels = labels;
      syncReaderMapping(story);
      story.nocturneMessage = `Nocturne applied to ${labels.size} ${labels.size === 1 ? "section" : "sections"}. ${kept}`.trim();
    } else {
      const messages = {
        refused: "Nocturne couldn’t process these cues.",
        rate_limited: publicMode ? "Nocturne has reached its current usage limit." : "Nocturne’s beta limit has been reached.",
        budget_unavailable: "Nocturne’s usage counter is unavailable. Check the Worker’s scene-analysis budget binding.",
        provider_key_rejected: "OpenAI rejected the project key. Check the Worker’s OPENAI_API_KEY secret.",
        provider_model_access: "OpenAI denied model access. Check the API project’s GPT-6 Luna and Responses permissions.",
        provider_billing_limit: "OpenAI reported a quota or billing limit. Check API credits and the project spend limit.",
        provider_rate_limit: "OpenAI reported a rate limit. Check the API project limits before trying again.",
        provider_cache_option: "OpenAI rejected Nocturne’s prompt-cache option.",
        provider_request_rejected: "OpenAI rejected Nocturne’s request format. Check the Responses API contract.",
        provider_timeout: "Nocturne’s request to OpenAI timed out.",
        provider_connection: "Nocturne couldn’t connect to OpenAI. Check the Worker’s outbound request and service status.",
        provider_service_error: "OpenAI returned a service error. Check the provider status before trying again.",
        provider_response_invalid: "OpenAI returned a result that didn’t match Nocturne’s scene-label format.",
      };
      const reason = Object.hasOwn(messages, code) ? messages[code] :
        labels ? "Nocturne left these cues as they were." : "Nocturne is temporarily unavailable.";
      story.nocturneMessage = `${reason} Loom patterns are ready. ${kept}`.trim();
    }
  } catch {
    if (nocturneOperation === operation) {
      story.model.nocturneLabels.clear();
      syncReaderMapping(story);
      story.nocturneMessage = `Nocturne couldn’t finish. Loom patterns are ready. ${kept}`.trim();
    }
  } finally {
    if (nocturneOperation === operation) { nocturneOperation = null; display(); }
  }
}

function storyRecord(story) {
  return {id: story.id, title: story.title, text: story.model.paragraphs.map(paragraph => paragraph.text).join("\n\n"),
    corrections: story.model.paragraphs.map(paragraph => paragraph.override), position: story.position,
    analysisVersion: story.model.analysisVersion, description: story.description, favorite: story.favorite,
    ...(story.folderId ? {folderId: story.folderId} : {})};
}
const accountStoryChanges = ({position, corrections, title, description, favorite}) =>
  ({position, corrections, title, description, favorite});

function markDirty(story) {
  ++story.changeVersion;
  if (!story.saved || story.deleting) return;
  story.dirty = true;
  clearTimeout(story.saveTimer);
  story.saveTimer = setTimeout(() => {
    story.saveTimer = null;
    void persistStory(story);
  }, story.accountOwner ? 1_000 : 350);
}
function persistStory(story, {explicit = false, accountOwner = story.accountOwner} = {}) {
  if (libraryMutation || story.deleting || !stories.includes(story) || (!story.saved && !explicit)) return Promise.resolve(false);
  clearTimeout(story.saveTimer); story.saveTimer = null;
  const task = async () => {
    if (libraryMutation || story.deleting || !stories.includes(story) || (!story.saved && !explicit)) return false;
    if (accountOwner && accountLibrary.owner !== accountOwner) return false;
    const version = story.changeVersion;
    story.saving = true;
    story.saveError = "";
    if (story.id === activeId) display();
    try {
      let saved;
      if (accountOwner && !story.accountOwner) {
        // A browser copy retains its own ID and storage lifecycle after upload.
        const copyId = story.saved ? createStoryId() : story.id;
        const record = {...storyRecord(story), id: copyId};
        saved = await accountLibrary.saveStory(accountOwner, record);
        if (!publicSignedIn || accountLibrary.owner !== accountOwner || !stories.includes(story)) return false;
        if (story.saved) {
          const accountStory = makeStory({...saved, accountOwner});
          stories.push(accountStory);
          if (story.id === activeId) selectStory(accountStory.id, {focusReader: true});
          show("A copy was saved to your account. The browser copy is still here.");
          return true;
        }
        story.accountOwner = accountOwner;
        story.accountId = saved.id;
        story.folderId = null;
        story.lastAccountChanges = JSON.stringify(accountStoryChanges(record));
      } else if (accountOwner) {
        const record = storyRecord(story);
        const changes = JSON.stringify(accountStoryChanges(record));
        if (changes !== story.lastAccountChanges) {
          saved = await accountLibrary.updateStory(accountOwner, {...record, id: story.accountId});
          if (!publicSignedIn || accountLibrary.owner !== accountOwner || !stories.includes(story)) return false;
          story.lastAccountChanges = changes;
        } else saved = {revision: story.revision, updatedAt: story.updatedAt};
      } else {
        saved = await store.saveStory(storyRecord(story), {expectedRevision: story.revision});
      }
      story.saved = true;
      story.revision = saved.revision;
      story.updatedAt = saved.updatedAt ?? Date.now();
      story.dirty = story.changeVersion !== version;
      if (explicit) show(accountOwner ? "Saved to your account." : "Saved on this browser. This copy is available here.");
      if (story.dirty && !story.deleting) markDirty(story);
      return true;
    } catch (error) {
      if (accountOwner && (!publicSignedIn || accountLibrary.owner !== accountOwner || !stories.includes(story))) return false;
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
  position = 0, revision = null, updatedAt = Date.now(), folderId = null, betaId = null, controlled = false,
  description = "", favorite = false, accountOwner = null, accountId = accountOwner ? id : null}) {
  const model = new ReaderModel();
  model.load(source, {deferAnalysis: true, documentId: id});
  corrections.forEach((level, index) => { if (level !== null) model.setOverride(index, level); });
  const safePosition = Math.max(0, Math.min(model.paragraphs.length - 1, position));
  return {id, title, description, favorite, model, folderId, betaId, controlled, accountOwner, accountId,
    lastAccountChanges: accountOwner ? JSON.stringify(accountStoryChanges({position: safePosition, corrections, title, description, favorite})) : null,
    explicitCorrections:new Set(), position: safePosition, furthest: safePosition, saved: revision !== null, revision,
    dirty: false, saving: false, saveError: "", changeVersion: 0, saveTimer: null, saveChain: Promise.resolve(),
    deleting: false, analysisPromise: null, sceneModel: controlled ? "loom" : nextStoryModel, nocturneMessage: "", updatedAt, lastOpenedAt: 0};
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
  nodes.suggestion.textContent = `Suggested level: ${paragraph.suggestedLevel} / 20`;
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
  cancelNocturne();
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
  cancelNocturne();
  story.model.resetOverride(index);
  story.explicitCorrections.delete(index);
  controller.setLevel(index, story.model.effectiveLevels()[index], {manual: false});
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
  if (!openedFirstStory && !focusArrangement) setPanel("settings", true, {restore: false});
  openedFirstStory = true;
  revealUpcoming = false;
  $("review-settings").open = false;
  selectSettingsTab("reader");
  renderStory();
  synchronizing = true;
  const position = story.position;
  controller.setStory(story.model.effectiveLevels(), readerProfiles(story));
  syncManualZeros(story);
  controller.setPosition(position);
  synchronizing = false;
  if (isNarrow()) setPanel("library", false, {restore: false});
  display(); renderLibrary();
  scrollToCurrent();
  if (focusReader) $("story-title").focus({preventScroll: true});
  if (story.sceneModel === "nocturne" && nocturneReady !== true) void checkNocturne();
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
function readingIsVisible() {
  return !document.hidden && !anyDialog() && (!isNarrow() || ($("settings-panel").hidden && $("library-panel").hidden));
}
function readingScrollTop() { return scrollY + (window.visualViewport?.offsetTop ?? 0); }
function resetScrollWindow() {
  const top = readingScrollTop();
  scrollWindow = {start: top, last: top, at: performance.now()};
}
function scrollToCurrent() {
  const node = paragraphNodes[latest.position]; if (!node || anyDialog()) return;
  cancelPosition();
  window.scrollTo({top: Math.max(0, scrollY + node.getBoundingClientRect().top - readingBounds().anchor + 12), behavior: "instant"});
  programmaticScrollTop = scrollY;
  resetScrollWindow();
}
function followPosition({explicit = false} = {}) {
  const story = currentStory();
  if (!story || !readingIsVisible() || (!explicit && !$("follow-scroll").checked)) return false;
  // Short stories can fit entirely above the reading anchor. At the document
  // top, a layout change or Start is not evidence that the reader moved on.
  if (readingScrollTop() <= 1 && story.position === 0) return true;
  const {top, bottom, anchor} = readingBounds();
  const rectangles = paragraphNodes.map(node => {
    const rect = node.getBoundingClientRect(); return {id: node.dataset.paragraphId, top: rect.top, bottom: rect.bottom};
  }).filter(rect => rect.bottom >= top && rect.top <= bottom);
  const currentId = story.model.paragraphs[latest.position]?.id;
  const id = selectReadingParagraph(rectangles, anchor, explicit ? null : currentId);
  if (!id) return false;
  const index = story.model.paragraphs.findIndex(paragraph => paragraph.id === id);
  if (index < 0) return false;
  if (id !== currentId) {
    if (explicit && latest.running && latest.feel?.playbackMode === "story") controller.setReadingSeeking(true);
    controller.setPosition(index);
  }
  return true;
}
function completeReadingSeek() {
  resetScrollWindow();
  if (latest.readingSeeking) controller.setReadingSeeking(false);
}
function settlePosition() {
  cancelPosition();
  if (!currentStory() || document.hidden) return;
  const now = performance.now(), currentTop = readingScrollTop();
  // Compare travel within a short window so slow reading scrolls can stay active.
  if (now - scrollWindow.at > 320) scrollWindow = {start: scrollWindow.last, last: currentTop, at: now};
  else scrollWindow.last = currentTop;
  const {top, bottom} = readingBounds();
  if (isReadingJump(scrollWindow.start, currentTop, bottom - top)) {
    if (pendingStart || startIntent) {
      cancelStart();
      closeDialog("start-dialog");
      display();
    }
    if (readingIsVisible() && $("follow-scroll").checked && latest.running && latest.feel?.playbackMode === "story" && !latest.readingSeeking) {
      controller.setReadingSeeking(true);
    }
  }
  const operation = positionEpoch, storyId = activeId;
  positionTimer = setTimeout(() => {
    positionTimer = null;
    if (operation === positionEpoch && activeId === storyId) {
      if (followPosition()) completeReadingSeek();
      else if (!latest.readingSeeking) resetScrollWindow();
    }
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
  experienceDialog.close({restore: false});
  for (const id of ["new-story-dialog", "start-dialog", "ceiling-dialog", "save-dialog", "app-settings-dialog", "story-details-dialog", "practice-story-dialog"]) closeDialog(id, {restore: false});
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
  if (stories.filter(story => !story.accountOwner).length >= 20) throw new Error("This browser library holds up to 20 stories. Remove one before adding another.");
  const title = record.title?.trim() || "Untitled story";
  if (title.length > 120) throw new Error("Choose a title up to 120 characters.");
  const story = makeStory({...record, title, folderId});
  stories.push(story); selectStory(story.id, {focusReader: true});
  return story;
}

function duplicateStory(story) {
  const {title, text: source, description, corrections} = storyRecord(story);
  const suffix = " (copy)";
  try {
    addPreparedStory({title: title.slice(0, MAX_STORY_TITLE - suffix.length).replace(/[\uD800-\uDBFF]$/u, "").trimEnd() + suffix, text: source,
      description, corrections}, {folderId: story.folderId});
    text("story-action-status", "Copy opened for this visit. Choose Save on this browser to keep it.");
  } catch (error) { text("story-action-status", error.message); }
}

function openStoryDetails(story, opener) {
  if (!story || story.deleting || libraryMutation) return;
  $("story-details-title").value = story.title;
  $("story-details-description").value = story.description;
  const options = [null, ...folders].map(folder => {
    const option = document.createElement("option");
    option.value = folder?.id ?? "";
    option.textContent = folder?.name ?? "Unfiled";
    return option;
  });
  $("story-details-shelf").replaceChildren(...options);
  $("story-details-shelf").value = story.folderId ?? "";
  $("story-details-shelf").disabled = Boolean(story.accountOwner);
  text("story-details-status", "");
  openDialog("story-details-dialog", opener);
  $("story-details-title").focus({preventScroll: true});
}

function deleteStory(story) {
  if (!story || story.deleting || libraryMutation) return;
  pause("Paused before deleting a story.");
  if (confirm("Delete this story, including its saved text, corrections and reading position?")) void removeStory(story);
}

function selectedPracticeStory() {
  return PRACTICE_STORIES.find(story => story.id === $("practice-story-choice").value);
}
function updatePracticeChoice() {
  const story = selectedPracticeStory();
  text("practice-story-description", story?.description ?? "");
  const notes = (story?.checkpoints ?? ["Follow the story’s instructions and compare what you see with the simulator output."]).map(checkpoint => {
    const item = document.createElement("li"); item.textContent = checkpoint; return item;
  });
  $("practice-story-checkpoints").replaceChildren(...notes);
  $("practice-story-open").disabled = !story;
  text("practice-story-status", "");
}
function openPracticePicker({models = false} = {}) {
  if (libraryLoading || libraryMutation || $("practice-story-dialog").open) return;
  setupFlow?.cancel();
  cancelImport();
  const picker = $("practice-story-choice");
  const selected = (models ? PRACTICE_STORIES.find(story => !story.controlled)?.id : picker.value) || PRACTICE_STORIES[0].id;
  picker.replaceChildren(...[[true, "Controls with known levels"], [false, "Compare story models"]].map(([controlled, label]) => {
    const group = document.createElement("optgroup"); group.label = label;
    for (const story of PRACTICE_STORIES.filter(story => Boolean(story.controlled) === controlled)) {
      const option = document.createElement("option"); option.value = story.id; option.textContent = story.title;
      group.append(option);
    }
    return group;
  }));
  picker.value = selected;
  updatePracticeChoice();
  openDialog("practice-story-dialog");
  picker.focus();
}
function openSelectedPracticeStory() {
  if (libraryLoading || libraryMutation || !$("practice-story-dialog").open) return;
  const story = selectedPracticeStory();
  if (!story) return;
  const {title, text: source, description, corrections, betaId, controlled} = story;
  const firstStory = !openedFirstStory;
  try {
    addPreparedStory({title, text: source, description, corrections, betaId, controlled});
    closeDialog("practice-story-dialog", {restore: false});
    if (!firstStory && isNarrow()) setPanel("settings", false, {restore: false});
    show(controlled ? "This practice story uses known levels. Choose Start when you’re ready." :
      "Loom analyses this practice story. To compare rhythms, choose Nocturne under Story model. Start when you’re ready.");
  } catch (error) {
    text("practice-story-status", error.message || "The practice story could not open. Try again.");
  }
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
  $("story-url")?.focus();
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
    const firstStory = !openedFirstStory;
    addPreparedStory(record, {folderId: folders.some(folder => folder.id === folderFilter) ? folderFilter : null});
    text("url-import-status", `${record.scope || "Story"} imported. You can read now.`);
    $("story-url").value = "";
    if (isNarrow() && !firstStory) setPanel("settings", false, {restore: false});
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
      latest.ceiling !== intent.ceiling || latest.levelAdjustment !== intent.levelAdjustment || playbackIdentity() !== intent.device || !latest.connected) return;
  const operation = ++startEpoch;
  pendingStart = true; display();
  let release = null;
  try {
    if (hostedMode && (!publicMode || latest.mode === "lovense")) {
      const allowed = await hostedAccess.check({fresh: true});
      if (!allowed || !canStartHere() || operation !== startEpoch || document.hidden || currentStory() !== story ||
          !story.model.analysisReady || latest.ceiling !== intent.ceiling || latest.levelAdjustment !== intent.levelAdjustment || playbackIdentity() !== intent.device || !latest.connected) return;
    }
    release = await acquirePlayback();
    if (!canStartHere() || operation !== startEpoch || document.hidden || currentStory() !== story || !story.model.analysisReady ||
        latest.ceiling !== intent.ceiling || latest.levelAdjustment !== intent.levelAdjustment || playbackIdentity() !== intent.device) { release?.(); return; }
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
  const owner = story.accountOwner;
  cancelImport();
  pause("Paused while saved data is removed.");
  story.deleting = true;
  clearTimeout(story.saveTimer); story.saveTimer = null;
  display();
  await story.saveChain.catch(() => {});
  try {
    if (owner && (!stories.includes(story) || accountLibrary.owner !== owner)) return;
    if (owner) await accountLibrary.deleteStory(owner, story.accountId);
    else if (story.saved || story.revision !== null) await store.deleteStory(story.id, {expectedRevision: story.revision});
    if (!stories.includes(story)) return;
    if (keepSession) {
      story.saved = false; story.revision = null; story.dirty = false; story.saveError = "";
      story.accountOwner = story.accountId = story.lastAccountChanges = null;
      show(owner ? "Session only. The saved copy was removed from your account." : "Session only. The saved copy was removed from this browser.");
    } else {
      story.model.cancelAnalysis();
      stories.splice(stories.indexOf(story), 1);
      if (story.id === activeId) {
        activeId = null;
        ++selectionEpoch;
        if (stories.length) selectStory(stories[0].id, {focusReader: true});
        else { renderStory(); controller.setStory([]); display(); $("draft-story").focus({preventScroll: true}); }
      }
      show("Story and its saved corrections and progress deleted.");
    }
  } catch (error) {
    if (owner && (!stories.includes(story) || accountLibrary.owner !== owner)) return;
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
  const nextTab = name === "story" ? "story" : "reader";
  if (nextTab !== settingsTab) $("settings-scroll").scrollTop = 0;
  settingsTab = nextTab;
  for (const value of ["reader", "story"]) {
    const tab = $(`settings-${value}-tab`), panel = $(`${value}-settings`);
    if (tab) { tab.setAttribute("aria-selected", String(settingsTab === value)); tab.tabIndex = settingsTab === value ? 0 : -1; }
    if (panel) panel.hidden = settingsTab !== value;
  }
  if (focus) $(`settings-${settingsTab}-tab`)?.focus({preventScroll: true});
  if (settingsTab === "story") renderReview();
}
function savePreferences(patch) {
  if (publicSignedIn) { void saveAccountPreferences(patch); return; }
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
    serializeBackup([...stories.filter(story => !story.accountOwner).map(storyRecord), ...records]);
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
function exportStories(records, filename, status = "library-transfer-status") {
  pause("Paused while you export a local backup.");
  try { text(status, downloadBackup(records, {filename}).message); }
  catch (error) { text(status, error.message); }
}
$("new-story").addEventListener("click", openDraft);
$("empty-new-story").addEventListener("click", openNewStory);
$("open-draft")?.addEventListener("click", () => void openDraftText());
$("draft-story")?.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void openDraftText(); } });
$("empty-link-import")?.addEventListener("click", showImportPanel);
for (const id of ["library-import-file", "upload-story-trigger"]) $(id)?.addEventListener("click", () => {
  if (libraryMutation || libraryLoading) return;
  openNewStory();
  $("file").click();
});
$("paste-source-trigger")?.addEventListener("click", () => { openDraft(); if (isNarrow()) setPanel("settings", false, {restore: false}); $("draft-story").focus(); });
$("import-url")?.addEventListener("click", () => void importStoryUrl());
$("story-url")?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void importStoryUrl(); } });
$("open-app-settings")?.addEventListener("click", () => openDialog("app-settings-dialog"));
for (const id of ["close-app-settings", "app-settings-close"]) $(id)?.addEventListener("click", () => closeDialog("app-settings-dialog"));
$("open-experience").addEventListener("click", () => experienceDialog.open({values: currentExperience(), account: publicSignedIn,
  opener: $("open-experience"), canStop: latest.connected}));
$("experience-stop").addEventListener("click", stopEverything);
for (const id of ["open-setup", "empty-setup", "choose-toy"]) $(id)?.addEventListener("click", () => {recordAllowedEvent({type:"step",step:"choose"});setupFlow?.open();});
$("open-calibration")?.addEventListener("click",()=>{recordAllowedEvent({type:"step",step:"calibration"});setupFlow?.openCalibration();});
$("open-account-welcome")?.addEventListener("click",()=>{closeDialog("app-settings-dialog");if(publicMode){publicAccount?.open($("open-app-settings"));return;}if(accountClient?.snapshot().registered){setPanel("settings",true);selectSettingsTab("story");$("account-preset-picker")?.focus();}else accountWorkspace?.focus();});
$("feel-channel")?.addEventListener("change",async()=>{
  const channel=$("feel-channel").value, mode=latest.feel?.mode || "story", quietEdging=latest.feel?.quietEdging === true;
  feelEditingChannel=channel;
  if((latest.activeChannels || []).length>1&&(latest.activeChannels || []).includes(channel)){updateFeelControls(latest);return;}
  try{cancelStart();if(await controller.applyCalibration(channel))controller.setFeel({mode,quietEdging});recordAllowedEvent({type:"control",control:"action",value:channel});}
  catch(error){show(error.message||"The movement could not be changed.");}display();
});
$("feel-mode")?.addEventListener("change",()=>{const quietEdging=$("feel-mode").value==="edging",mode=quietEdging?"continuous":$("feel-mode").value;cancelStart();controller.setFeel({mode,quietEdging});recordAllowedEvent({type:"control",control:"continuity",value:mode});});
$("nocturne-peak-pattern").addEventListener("change", async () => {
  const choice = $("nocturne-peak-pattern").value;
  if (savingPeakChoice || currentStory()?.sceneModel !== "nocturne" || !["auto", "crest", "accents", "ease"].includes(choice)) return;
  savingPeakChoice = true;
  $("nocturne-peak-pattern").disabled = true;
  text("nocturne-peak-status", "Saving your peak pattern…");
  try {
    const saved = await savePlaybackPreferences({peakPattern: choice});
    text("nocturne-peak-status", saved ? publicSignedIn ? "Saved to your account." : "Set for this visit." : "Could not save your peak pattern. Try again.");
  } catch { text("nocturne-peak-status", "Could not save your peak pattern. Try again."); }
  finally { savingPeakChoice = false; renderNocturnePeakSettings(currentStory()); }
});
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
for (const id of ["scene-preferred-movement", "scene-auto-movement"]) {
  $(id)?.addEventListener("change", () => {
    cancelStart();
    controller.setSceneMovement($("scene-auto-movement").checked, $("scene-preferred-movement").value);
  });
}
$("enable-personal-range")?.addEventListener("click",async()=>{try{pause("Paused while you choose this movement's personal range.");await controller.enablePersonalRange({channel:feelEditingChannel || latest.channel});display(controller.snapshot());}catch(error){show(error.message||"Complete the gentle movement and Stop check first.");}});
$("manual-level")?.addEventListener("input",()=>{try{const channel=feelEditingChannel || latest.channel,value=Number($("manual-level").value);if((latest.activeChannels || []).length>1){const levels={...latest.channelOutputs,[channel]:value};controller.holdChannels(levels);}else controller.hold(value);recordAllowedEvent({type:"control",control:"hold",channel,value});display(controller.snapshot());}catch(error){show(error.message||"Check the current level before changing it.");}});
for(const[id,value]of[["mark-good",5],["mark-uncomfortable",1]])$(id)?.addEventListener("click",()=>{
  if(betaRecorder?.snapshot().recording!==true)return;
  recordAllowedEvent({type:"rating",question:"comfort",value,channel:feelEditingChannel || latest.channel});
  text("beta-feedback-status","Marked in this beta recording. Your controls are unchanged.");
});
$("apply-combined")?.addEventListener("click",async()=>{try{const channels=Array.from($("combination-choices").querySelectorAll('input:checked')).map(input=>input.value);if(!channels.length)throw Error("Choose at least one movement.");const mode=latest.feel?.mode||"story";pause("Applying movement choices.");if(channels.length===1){await controller.applyCalibration(channels[0]);controller.setFeel({mode});}else await controller.applyChannels(channels,{mode});display(controller.snapshot());}catch(error){show(error.message||"The movements could not be combined.");}});
$("control-playground")?.addEventListener("click", openPracticePicker);
$("model-practice-shortcut")?.addEventListener("click", () => openPracticePicker({models: true}));
$("practice-story-choice").addEventListener("change", updatePracticeChoice);
$("practice-story-open").addEventListener("click", openSelectedPracticeStory);
$("practice-story-close").addEventListener("click", () => closeDialog("practice-story-dialog"));
$("practice-story-stop").addEventListener("click", stopEverything);
$("practice-story-dialog").addEventListener("cancel", event => { event.preventDefault(); closeDialog("practice-story-dialog"); });
for(const[id,action]of[["feel-hold","hold"],["feel-easeoff","easeoff"],["feel-follow","follow"]])$(id)?.addEventListener("click",()=>{
  cancelStart();if(action==="hold")controller.hold();else if(action==="easeoff")controller.easeOff();else controller.followStory();
  recordAllowedEvent({type:"control",control:action,channel:latest.channel});display(controller.snapshot());
});
$("folder-filter")?.addEventListener("change", event => { folderFilter = event.target.value; renderLibrary(); });
$("create-folder")?.addEventListener("click", () => { pause("Choose a shelf name."); const name = prompt("Shelf name"); if (name?.trim()) void changeFolder("create", name.trim()); });
$("rename-folder")?.addEventListener("click", () => { const folder = folders.find(value => value.id === folderFilter); if (!folder) return; pause("Rename this shelf."); const name = prompt("Shelf name", folder.name); if (name?.trim()) void changeFolder("rename", name.trim()); });
$("delete-folder")?.addEventListener("click", () => { const folder = folders.find(value => value.id === folderFilter); if (!folder) return; pause("Choose whether to remove this shelf."); if (confirm(`Remove the shelf “${folder.name}”? Its stories will move to Unfiled.`)) void changeFolder("delete"); });
$("story-folder")?.addEventListener("change", event => { const story = currentStory(); if (!story || libraryMutation || story.deleting) return; story.folderId = folders.some(folder => folder.id === event.target.value) ? event.target.value : null; markDirty(story); renderLibrary(); display(); });
$("library-search")?.addEventListener("input", event => { libraryQuery = event.target.value; renderLibrary(); });
$("library-sort")?.addEventListener("change", event => { librarySort = event.target.value; renderLibrary(); });
$("import-backup-trigger")?.addEventListener("click", () => $("import-backup").click());
$("import-backup")?.addEventListener("change", event => { const file = event.target.files?.[0]; if (file) void restoreBackup(file); });
$("export-library")?.addEventListener("click", () => {
  const local = stories.filter(story => !story.accountOwner);
  if (local.length) exportStories(local.map(storyRecord), "satinlore-library-backup.json");
});
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
$("retry-access")?.addEventListener("click", () => {
  if (publicMode) { publicAccount?.open($("retry-access")); return; }
  pause("Checking sign-in. Playback stays paused."); void hostedAccess?.check({fresh: true});
});
$("scene-model").addEventListener("change", event => {
  const story = currentStory();
  const choice = event.target.value;
  if (story?.deleting || libraryMutation || !["loom", "nocturne"].includes(choice)) return;
  nextStoryModel = choice;
  if (!story || story.controlled) { renderStoryModel(story); return; }
  if (story.sceneModel === choice) return;
  pause("Story model changed. Confirm Start when ready.");
  story.sceneModel = choice;
  syncReaderMapping(story);
  if (choice === "nocturne" && nocturneReady !== true) void checkNocturne();
  display();
});
$("nocturne-run").addEventListener("click", () => void runNocturne());
$("nocturne-sign-in").addEventListener("click", () => publicAccount?.open($("nocturne-sign-in"), () => $("scene-model").focus()));
$("load").addEventListener("click", () => {
  const source = $("source").value;
  if (!source.trim()) { text("import-status", "Paste your story or choose a file."); $("source").focus(); return; }
  void prepareText(() => source);
});
$("file").addEventListener("change", event => { const file = event.target.files[0]; if (file) void prepareText(async () => { const record = await readStoryFile(file); if (record.title && !$("story-title-input").value.trim()) $("story-title-input").value = record.title; return record.text; }); });
$("cancel-import").addEventListener("click", () => { cancelImport(); closeDialog("new-story-dialog"); });
for (const id of ["stop", "start-stop", "ceiling-stop", "save-stop", "import-stop", "story-details-stop"]) $(id)?.addEventListener("click", stopEverything);
for (const id of ["new-story-dialog", "start-dialog", "ceiling-dialog", "save-dialog", "app-settings-dialog", "story-details-dialog"]) $(id).addEventListener("cancel", event => {
  event.preventDefault(); cancelImport(); cancelStart(); ceilingIntent = saveIntent = null; closeDialog(id); display();
});
$("start").addEventListener("click", () => {
  const story = currentStory();
  if (!canStartHere() || !story?.model.analysisReady || !latest.connected || latest.running || pendingStart || nocturneOperation || document.hidden) return;
  cancelPosition(); followPosition();
  resetScrollWindow();
  openDialog("start-dialog");
  startIntent = {id: story.id, ceiling: latest.ceiling, levelAdjustment: latest.levelAdjustment, device: playbackIdentity()};
  const movement = (latest.activeChannels || [latest.channel || "vibrate"]).map(channel=>`${latest.channels?.find(item=>item.id===channel)?.label || channel} · up to ${Math.min(latest.ceiling,selectedSettings(latest,channel).maximum)}/20`).join(" + ");
  text("start-summary", `${latest.deviceLabel ?? "Lush simulator"} · ${movement} · maximum ${latest.ceiling}/20 · current level ${latest.target}/20.${latest.mode === "lovense" ? " Physical beta: commands expire after two seconds; output is not measured." : " Your story stays on this browser."}`);
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
for (const [id, delta] of [["level-down", -1], ["level-up", 1]]) $(id).addEventListener("click", () => {
  if ($(id).disabled) return;
  cancelStart();
  const next = controller.adjustLevel(delta);
  recordAllowedEvent({type:"control",control:"section-level",value:next.target});
});
for (const [id, delta] of [["previous", -1], ["next", 1]]) $(id).addEventListener("click", () => {
  const story = currentStory(); if (!story || story.deleting || libraryMutation) return;
  cancelPosition();
  controller.setPosition(Math.max(0, Math.min(story.model.paragraphs.length - 1, latest.position + delta)));
  completeReadingSeek();
  scrollToCurrent();
  if ($("review-settings").open) renderReview();
});
$("sync-here").addEventListener("click", () => {
  if ($("sync-here").disabled) return;
  if (!readingIsVisible()) {
    show("Close the side panel, then try Sync here.");
    return;
  }
  cancelPosition();
  cancelStart();
  if (followPosition({explicit: true})) {
    completeReadingSeek();
    display();
  } else {
    show("Scroll until a story section is visible, then try Sync here.");
  }
});
$("level").addEventListener("input", () => changeLevel(latest.position, Number($("level").value)));
$("reset-level").addEventListener("click", () => resetLevel(latest.position));
$("review-settings").addEventListener("toggle", () => { pause("Review is optional. Confirm Start to continue."); renderReview(); });
$("show-upcoming").addEventListener("click", () => { revealUpcoming = true; renderReview(); });
$("reanalyze").addEventListener("click", () => {
  const story = currentStory(); if (!story) return;
  pause("Refreshing suggestions. Your manual corrections are kept.");
  story.nocturneMessage = "";
  story.model.cancelAnalysis();
  story.analysisPromise = null;
  ++selectionEpoch;
  syncReaderMapping(story);
  void analyse(story, {force: true});
});
function confirmSaveStory(story, {accountOwner = null} = {}) {
  const toAccount = Boolean(accountOwner);
  text("save-heading", toAccount ? (story.saved ? "Copy to your account?" : "Save to your account?") : "Save on this browser?");
  text("save-description", toAccount ? "Save this story and your reading position so you can open them when you sign in on another device." : "Your story and reading position will be here when you return.");
  text("save-privacy", toAccount ? "SatinLore stores your story text when you choose this option. Only save material you have permission to keep in your account." : "Anyone using this browser profile may be able to see them. Clearing browser data can remove them.");
  text("confirm-save", toAccount ? "Save to my account" : "Save on this browser");
  openDialog("save-dialog"); saveIntent = {id: story.id, accountOwner};
}
$("save-story").addEventListener("click", () => {
  const story = currentStory(); if (!story) return;
  if (story.saved) { void persistStory(story, {explicit: true}); return; }
  confirmSaveStory(story);
});
$("save-account-story").addEventListener("click", async () => {
  const story = currentStory();
  if (!publicMode || !story || story.controlled || story.deleting) return;
  if (story.accountOwner) { void persistStory(story, {explicit: true}); return; }
  if (!publicSignedIn) {
    publicAccount?.open($("save-account-story"), () => { if (story === currentStory()) $("save-account-story").click(); });
    return;
  }
  const owner = await loadAccountLibrary();
  if (owner && publicSignedIn && story === currentStory() && !story.saving) confirmSaveStory(story, {accountOwner: owner});
});
$("confirm-save").addEventListener("click", () => {
  const story = currentStory(), intent = saveIntent; saveIntent = null; closeDialog("save-dialog");
  if (story && intent && story.id === intent.id) void persistStory(story, {explicit: true, accountOwner: intent.accountOwner});
});
$("cancel-save").addEventListener("click", () => { saveIntent = null; closeDialog("save-dialog"); });
$("session-only").addEventListener("click", () => {
  const story = currentStory(); if (!story?.saved) return;
  pause("Paused while you choose how to keep this story.");
  const destination = story.accountOwner ? "your account" : "this browser";
  if (confirm(`Remove this story's saved copy from ${destination} and keep it only for this tab session?`)) void removeStory(story, {keepSession: true});
});
$("rename-story").addEventListener("click", () => openStoryDetails(currentStory(), $("rename-story")));
for (const id of ["story-details-close", "story-details-cancel"]) $(id).addEventListener("click", () => closeDialog("story-details-dialog"));
$("story-details-form").addEventListener("submit", event => {
  event.preventDefault();
  const story = currentStory();
  if (!$("story-details-dialog").open || !story || story.deleting || libraryMutation) return;
  const title = $("story-details-title").value.trim();
  const description = $("story-details-description").value.trim();
  if (!title || title.length > MAX_STORY_TITLE) {
    text("story-details-status", `Use a title between 1 and ${MAX_STORY_TITLE} characters.`);
    $("story-details-title").focus();
    return;
  }
  if (description.length > MAX_STORY_DESCRIPTION) {
    text("story-details-status", `Use a description up to ${MAX_STORY_DESCRIPTION} characters.`);
    $("story-details-description").focus();
    return;
  }
  const folderId = !story.accountOwner ? folders.find(folder => folder.id === $("story-details-shelf").value)?.id ?? null : null;
  Object.assign(story, {title, description, folderId});
  markDirty(story);
  closeDialog("story-details-dialog");
  display(); renderLibrary();
  text("story-action-status", story.saved ? "Story settings updated." : "Story settings updated for this visit.");
});
$("delete-story").addEventListener("click", () => deleteStory(currentStory()));
$("delete-all").addEventListener("click", async () => {
  if (libraryMutation || libraryLoading) return;
  pause("Paused before clearing the local library.");
  if (!confirm("Delete stories saved on this browser and session-only stories? Account stories and appearance are kept. This cannot be undone.")) return;
  libraryMutation = true;
  cancelImport(); closeDialogs(); ++selectionEpoch;
  const local = stories.filter(story => !story.accountOwner);
  local.forEach(story => { story.deleting = true; clearTimeout(story.saveTimer); story.model.cancelAnalysis(); });
  display(); renderLibrary();
  await Promise.all(local.map(story => story.saveChain.catch(() => {})));
  try {
    await store.deleteAll();
    const retained = stories.filter(story => story.accountOwner);
    stories.splice(0, stories.length, ...retained);
    folders = []; folderFilter = "all"; libraryError = "";
    $("source").value = ""; $("story-title-input").value = ""; $("file").value = "";
    if ($("draft-story")) $("draft-story").value = "";
    if ($("draft-title")) $("draft-title").value = "";
    if (!currentStory()) { activeId = null; renderStory(); controller.setStory([]); }
    show("All local stories, corrections and progress deleted. Appearance was kept.");
  } catch (error) {
    local.forEach(story => { story.deleting = false; });
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
window.addEventListener("satinlore:appearance", event => {
  reflow("Appearance changed. Confirm Start to continue.");
  if (event.detail?.user && publicSignedIn) void saveAccountPreferences({appearance: event.detail.preference});
});
window.addEventListener("resize", () => {
  const library = $("library-panel");
  if (isNarrow() && !library.hidden && !$("settings-panel").hidden) {
    setPanel("library", false, {restore: library.contains?.(document.activeElement) === true});
  }
  reflow("Reading layout changed. Confirm Start to continue.");
});
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
  if (publicMode && event.key === sessionChangeKey) {
    if (latest.mode === "lovense") controller.disconnect();
    updatePublicSession(false);
    void hostedAccess.check({fresh: true});
    return;
  }
  if (event.key !== "satinlore.library.v1" && event.key !== null) return;
  pause("The local library changed in another tab. Saved copies will not be overwritten silently.");
  libraryError = "The library changed in another tab. Reload to see its saved stories; session-only text remains in this tab until reload.";
  renderLibrary();
});

function applyReaderPreferences({width, fontSize, spacing, follow}) {
  $("reading-width").value = document.body.dataset.readingWidth = width;
  $("font-size").value = fontSize;
  $("reader").className = `reader-size-${fontSize}`;
  $("reading-spacing").value = $("reader").dataset.spacing = spacing;
  $("follow-scroll").checked = follow;
}

function accountAppearance(active, preference) {
  window.dispatchEvent(new CustomEvent("satinlore:account-appearance", {detail: {active, preference}}));
}

function loadAccountLibrary() {
  if (!publicSignedIn) return Promise.resolve(null);
  if (pendingAccountLibrary) return pendingAccountLibrary;
  if (accountLibrary.owner) return Promise.resolve(accountLibrary.owner);
  const task = (async () => {
    try {
      const snapshot = await accountLibrary.open();
      await localLibraryReady;
      if (!publicSignedIn || pendingAccountLibrary !== task || snapshot.owner !== accountLibrary.owner) return null;
      for (const record of snapshot.stories) {
        const id = stories.some(story => story.id === record.id) ? createStoryId() : record.id;
        stories.push(makeStory({...record, id, accountId: record.id, accountOwner: snapshot.owner}));
      }
      accountPreferences = snapshot.preferences ?? {...preferences.values, appearance: document.documentElement.dataset.appearance || "dark"};
      applyReaderPreferences(accountPreferences);
      accountAppearance(true, accountPreferences.appearance);
      accountExperience = snapshot.preferences?.experience ?? null;
      if (accountExperience) applyReadingDefaults(accountExperience);
      text("reader-preferences-note", snapshot.preferences ? "Your saved account settings are in use." : "Changes to these settings will be saved to your account.");
      if (!activeId && stories.length) selectStory(stories[0].id);
      else { display(); renderLibrary(); }
      return snapshot.owner;
    } catch {
      if (pendingAccountLibrary === task && publicSignedIn) show("Your account library could not be opened. Try saving again or reload to reopen it.");
      return null;
    } finally {
      if (pendingAccountLibrary === task) pendingAccountLibrary = null;
    }
  })();
  pendingAccountLibrary = task;
  return task;
}

async function saveAccountPreferences(patch) {
  const owner = await loadAccountLibrary();
  if (!owner || !publicSignedIn || owner !== accountLibrary.owner || !accountPreferences) return false;
  const {revision, ...next} = {...accountPreferences, ...patch};
  accountPreferences = next;
  applyReaderPreferences(next);
  if (patch.appearance !== undefined) accountAppearance(true, patch.appearance);
  try {
    const result = await accountLibrary.savePreferences(owner, next);
    if (!publicSignedIn || owner !== accountLibrary.owner) return false;
    if (accountPreferences === next) accountPreferences = result.preferences;
    if (patch.experience) {
      accountExperience = validateExperience(result.preferences.experience);
      applyReadingDefaults(accountExperience);
    }
    text("reader-preferences-note", "Reading preferences saved to your account.");
    return true;
  } catch (error) {
    if (publicSignedIn && owner === accountLibrary.owner) {
      if (patch.experience && accountPreferences === next) {
        if (accountExperience) accountPreferences.experience = accountExperience;
        else delete accountPreferences.experience;
      }
      text("reader-preferences-note", error.message || "Your account settings could not be saved.");
    }
    return false;
  }
}

async function savePlaybackPreferences(patch) {
  const experience = validateExperience({...currentExperience(), ...patch});
  if (publicSignedIn) return saveAccountPreferences({experience});
  guestExperience = experience;
  applyReadingDefaults(guestExperience);
  return true;
}

async function offerExperience(continuation = null) {
  if (window.location?.search === "?sign-in=feedback") { continuation?.(); return; }
  const owner = await loadAccountLibrary();
  if (!owner || !publicSignedIn || owner !== accountLibrary.owner || accountExperience || offeredExperience.has(owner) ||
      document.hidden || anyDialog()) { continuation?.(); return; }
  offeredExperience.add(owner);
  experienceDialog.open({values: currentExperience(), account: true, initial: true, continuation, opener: $("public-account"), canStop: latest.connected});
}

function clearAccountLibrary() {
  accountLibrary.clear(); pendingAccountLibrary = null; accountPreferences = null;
  experienceDialog.close({restore: false});
  if (accountExperience) {
    accountExperience = null;
    applyReadingDefaults(guestExperience);
  }
  for (const story of stories.filter(value => value.accountOwner)) {
    clearTimeout(story.saveTimer);
    story.model.cancelAnalysis();
    stories.splice(stories.indexOf(story), 1);
  }
  saveIntent = null;
  closeDialog("save-dialog");
  if (activeId && !currentStory()) {
    pause("Your account stories are hidden while you’re signed out.");
    closeDialogs(); ++selectionEpoch;
    activeId = null;
    $("story-details-title").value = $("story-details-description").value = "";
    renderStory(); controller.setStory([]);
    if (stories.length) selectStory(stories[0].id);
  }
  applyReaderPreferences(preferences.load().preferences);
  accountAppearance(false);
  text("reader-preferences-note", "Reading preferences are saved on this browser while you’re signed out.");
  display(); renderLibrary();
}

function announceSessionChange() {
  try { window.localStorage.setItem(sessionChangeKey, createStoryId()); }
  catch { /* The authenticated guard and owner check still isolate writes. */ }
}

function updatePublicSession(signedIn) {
  if (publicSignedIn === signedIn) return;
  publicSignedIn = signedIn;
  publicAccount?.update(signedIn);
  text("open-account-welcome", signedIn ? "Manage sign-in" : "Sign in");
  if (signedIn) {
    void accountClient?.load();
    accountAppearance(true);
    void loadAccountLibrary();
    if (currentStory()?.sceneModel === "nocturne") void checkNocturne();
  } else {
    nocturneReady = null;
    accountClient?.clear();
    clearAccountLibrary();
  }
}

if (publicMode) {
  text("open-account-welcome", "Sign in");
  text("account-storage-description", "Save stories and reading settings to your account to use them on other devices. Choose which stories to save.");
  publicAccount = mountPublicAccount({document,
    openDialog: opener => openDialog("public-account-dialog", opener),
    closeDialog: () => closeDialog("public-account-dialog"),
    onVerified: async () => {
      announceSessionChange();
      return hostedAccess.check({fresh: true});
    },
    onSignedIn: offerExperience,
    onSignOut: async request => {
      pause("Signing out. Start when you’re ready.");
      if (latest.mode === "lovense") controller.disconnect();
      hostedAccess.suspend();
      try {
        const value = await request();
        if (value?.authenticated !== false) throw Error();
        updatePublicSession(false);
        announceSessionChange();
      } finally {
        if (!document.hidden) await hostedAccess.resume();
      }
    },
  });
}

if (hostedMode) {
  // Local hardware checks stay available only in the local application.
  for (const link of document.querySelectorAll('a[href="/device-check"]')) link.hidden = true;
  const accessStatus = $("access-status");
  hostedAccess = new HostedAccessGuard({
    allowGuest: publicMode,
    onChange: state => {
      hostedAccessReady = state.allowed;
      controller.setAuthorized?.(state.allowed);
      if (publicMode && (state.allowed || ["guest", "blocked"].includes(state.state))) updatePublicSession(state.allowed);
      if (accessStatus && state.allowed) { accessStatus.hidden = true; accessStatus.replaceChildren(); }
      else if (!publicMode && accessStatus && state.state === "checking" && !state.allowed) {
        accessStatus.hidden = false; accessStatus.textContent = "Checking your private preview access…";
      }
      display();
    },
    onLost: reason => {
      if (publicMode) {
        if (latest.mode === "lovense" || nocturneOperation) {
          pause("Sign in again to reconnect a toy or use Nocturne. You can still read and try a simulator.");
          closeDialog("start-dialog");
        }
        return;
      }
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
  const accessCheck = hostedAccess.start({visible: !document.hidden});
  if (publicMode && window.location?.search === "?sign-in=feedback") {
    const openFeedback = () => window.location.assign("/support");
    void accessCheck.then(allowed => allowed ? openFeedback() : publicAccount?.open($("public-account"), openFeedback));
  } else if (publicMode) void accessCheck.then(allowed => { if (allowed) return offerExperience(); });
}

const loadedPreferences = preferences.load();
const initialPreferences = loadedPreferences.preferences;
applyReaderPreferences(initialPreferences);
text("reader-preferences-note", loadedPreferences.message);
// These presentation modules consume snapshots; they never dispatch device commands.
if (document.createElementNS) {
  simulatorView = createSimulatorView($("simulator-visual"), {document, window});
  setupFlow = createSetupFlow({document, window, coachMount: $("setup-coach-mount"),
    enableCalibration: true,
    quickSetup: publicMode || window.location?.hostname === "app.satinlore.com",
    onQuickTest: options => controller.quickTest(options),
    onConfirmQuickTest: () => controller.confirmQuickTest(),
    onOpenAdvanced: () => {
      setPanel("settings", true, {restore: false}); selectSettingsTab("story", {focus: true});
      show(currentStory() ? "Toy checked. Start when you’re ready." : "Toy checked. Add or open a story when you’re ready.");
    },
    canConnectLive: () => !publicMode || hasVerifiedAccess(),
    onLiveSignIn: options => publicAccount?.open($("choose-toy"), () => setupFlow?.open(options)),
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
  if (publicMode && !publicSignedIn) accountClient.clear();
  accountWorkspace = mountAccountWorkspace({client:accountClient,document,welcomeMount:$("account-welcome"),settingsMount:$("account-settings-mount"),presetMount:$("preset-mount"),
    publicMode, onSignIn: () => publicAccount?.open($("public-account")),
    onDeleted: () => {
      if (publicMode) {
        hostedAccess.suspend();
        updatePublicSession(false);
        announceSessionChange();
        if (!document.hidden) void hostedAccess.resume();
        show("Account data removed. Stories saved in this browser are still here.");
      }
    },
    getContext:()=>{
      const state=controller.snapshot(),channels={...state.calibration.channels};
      for(const channel of state.activeChannels || [state.channel])if(channels[channel])channels[channel]=selectedSettings(state,channel);
      const story = currentStory();
      return {model:state.model,mode:state.feel?.mode||"story",channels,activeChannels:state.activeChannels||[state.channel],ceiling:state.ceiling,storyId:story?.accountId || story?.id || null};
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
  if (!publicMode || publicSignedIn) void accountClient.load();
  betaRecorder=createBetaRecorder({hostname:window.location?.hostname});
  $("beta-feedback-controls").hidden=!betaRecorder.snapshot().enabled;
  mountBetaRecording({mount:$("beta-recording-mount"),recorder:betaRecorder,document,
    context:()=>({mode:latest.mode==="lovense"?"live":"simulator",toy:latest.model||"none"})});
  let wasRecording=false;
  betaRecorder.subscribe(state=>{const began=state.recording&&!wasRecording;wasRecording=state.recording;readingFeedback.sharing(state.recording);for(const id of ["mark-good","mark-uncomfortable"])$(id).disabled=!latest.running||!state.recording;if(began){recordedDevice=recordedStory=recordedStep="";recordControlSnapshot(latest);}});
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
localLibraryReady = (async () => {
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
