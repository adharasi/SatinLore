import {readFileSync} from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";
import {setTimeout as nextTurn} from "node:timers/promises";
import {MockDevice} from "../../app/static/devices/mock.mjs";
import {TextImporter} from "../../app/static/reader/import.mjs";
import {createStoryId} from "../../app/static/reader/identity.mjs";
import {ReaderModel} from "../../app/static/reader/model.mjs";
import {isReadingJump, selectReadingParagraph} from "../../app/static/reader/position.mjs";
import {PlaybackController} from "../../app/static/playback/controller.mjs";
import {ReaderDeviceController} from "../../app/static/devices/reader-device.mjs";
import {HostedAccessGuard} from "../../app/static/access.mjs";
import {selectLibraryStories, storyMetadata, renderStoryTabs} from "../../app/static/reader/library-view.mjs";
import {BackupImporter, serializeBackup} from "../../app/static/reader/backup.mjs";
import {ReaderPreferences} from "../../app/static/reader/preferences.mjs";
import {StoryStore, MAX_STORY_DESCRIPTION, MAX_STORY_TITLE} from "../../app/static/reader/storage.mjs";
import {FolderStore, selectFolderStories} from "../../app/static/reader/folders.mjs";
import {WebStoryImporter, identifyStoryUrl, readStoryFile} from "../../app/static/reader/web-import.mjs";
import {PRACTICE_STORIES} from "../../app/static/reader/practice-stories.mjs";
import {ReaderAccountClient, mountAccountWorkspace} from "../../app/static/reader/account-workspace.mjs";
import {mountPublicAccount} from "../../app/static/reader/public-account.mjs";
import {createBetaRecorder, mountBetaRecording} from "../../app/static/reader/beta-recording.mjs";
import {clampCalibration, DEFAULT_SIMULATOR_MAXIMUM, sceneStagePatternLabel} from "../../app/static/reader/calibration.mjs";
import {nocturneCandidates, nocturneAvailable, requestNocturne} from "../../app/static/reader/nocturne.mjs";

// Execute the actual application bindings with only DOM, storage, clock, access
// and Web Locks boundaries replaced. This is not a browser or layout check.
export function workspace({hosted = false, locks = true, publicAuth = false, authRequest} = {}) {
  let time = 1000000, timerId = 0, context, narrow = false, document;
  const timers = new Map(), nodes = new Map(), errors = [], documentListeners = new Map(), windowListeners = new Map();
  const preferenceValues = new Map(), downloads = [];
  const setTimer = (callback, delay) => { timers.set(++timerId, {callback, at: time + delay}); return timerId; };
  const clearTimer = id => timers.delete(id);
  const now = () => time;
  let accessRequest = () => Promise.resolve(Response.json(publicAuth ? {authenticated: false, expiresAt: null} : {authenticated: true, expiresAt: time + 3600000}));
  let accessCalls = 0, lockHeld = false, lockGate = null;
  const classList = () => {
    const values = new Set(); return {add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value)};
  };
  class Element {
    constructor(tag = "div", id = "") {
      this.tagName = tag.toUpperCase(); this.id = id; this.value = ""; this.textContent = "";
      this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this.isConnected = true;
      this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.children = [];
      this.classList = classList(); this.style = {setProperty() {}};
      this.ownerDocument = document;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(value => value !== callback)); }
    dispatch(name, event = {}) {
      const input = {target: this, preventDefault() {}, isTrusted: false, ...event};
      return Promise.all((this.listeners.get(name) || []).map(callback => callback(input)));
    }
    click() { if (this.disabled) return Promise.resolve(false); this.focus(); return this.dispatch("click"); }
    focus() { document.activeElement = this; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    getBoundingClientRect() {
      if (this.id === "transport") return {top: 800, bottom: 950, height: 150};
      if (this.id === "workspace-header") return {top: 0, bottom: 80, height: 80};
      const top = 120 + Number(this.dataset.index || 0) * 200 - (context?.scrollY || 0);
      return {top, bottom: top + 180, height: 180};
    }
    querySelector() { return null; }
    querySelectorAll(selector) {
      const children = this.children.flatMap(child => child.tagName === "FRAGMENT" ? child.children : [child]);
      return selector === '[role="tab"]' ? children.filter(child => child.getAttribute?.("role") === "tab") : [];
    }
    scrollIntoView() {}
  }
  const html = readFileSync(new URL("../../app/static/index.html", import.meta.url), "utf8");
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const element = new Element(match[1], match[3]);
    element.hidden = /\shidden(?:\s|$)/.test(match[2]);
    element.disabled = /\sdisabled(?:\s|$)/.test(match[2]);
    element.checked = /\schecked(?:\s|$)/.test(match[2]);
    element.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || "";
    nodes.set(element.id, element);
  }
  for (const [id, value] of [["font-size", "normal"], ["reading-width", "wide"], ["reading-spacing", "normal"]]) nodes.get(id).value = value;
  nodes.get("follow-scroll").checked = true;
  const root = new Element("html"), body = new Element("body");
  document = {
    hidden: false, body, documentElement: root, activeElement: body,
    getElementById: id => nodes.get(id) || null,
    createElement: tag => new Element(tag), createTextNode: text => ({textContent: text}),
    createDocumentFragment: () => new Element("fragment"),
    querySelector(selector) {
      if (selector === 'meta[name="satinlore-hosted-access"]') return hosted ? {content: "true"} : null;
      if (selector === 'meta[name="satinlore-public-auth"]') return publicAuth ? {content: "true"} : null;
      if (selector === "dialog[open]") return [...nodes.values()].find(node => node.tagName === "DIALOG" && node.open) || null;
      if (selector === ".workspace-header") return nodes.get("workspace-header");
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(name, callback) { if (!documentListeners.has(name)) documentListeners.set(name, []); documentListeners.get(name).push(callback); },
  };
  for (const node of [...nodes.values(), root, body]) node.ownerDocument = document;
  const window = {
    matchMedia: query => ({matches: query.includes("prefers-color-scheme") ? false : narrow, addEventListener() {}}),
    addEventListener(name, callback) { if (!windowListeners.has(name)) windowListeners.set(name, []); windowListeners.get(name).push(callback); },
    removeEventListener() {},
    dispatchEvent(event) { for (const callback of windowListeners.get(event.type) || []) callback(event); },
    localStorage: {getItem: key => preferenceValues.get(key) ?? null, setItem: (key,value) => preferenceValues.set(key,value)},
    scrollTo({top}) { context.scrollY = top; },
    visualViewport: null,
  };
  const navigator = {locks: locks ? {async request(name, options, callback) {
    if (lockGate) await lockGate;
    if (lockHeld) return callback(null);
    lockHeld = true;
    try { return await callback({name}); } finally { lockHeld = false; }
  }} : undefined};
  class TestDevice extends MockDevice { constructor() { super(now); } }
  class TestController extends ReaderDeviceController {
    constructor(options) {
      const onChange = options.onChange;
      super({...options, now, setTimer, clearTimer, onChange(state) {
        try { return onChange(state); } catch (error) { errors.push(error); throw error; }
      }});
    }
  }
  class TestGuard extends HostedAccessGuard {
    constructor(options) { super({...options, now, setTimer, clearTimer, request: opts => { accessCalls++; return accessRequest(opts); }}); }
  }
  const libraryValues = new Map();
  class MemoryStore extends StoryStore {
    constructor() { super({storage: {getItem: key => libraryValues.get(key) ?? null, setItem: (key,value) => libraryValues.set(key,value), removeItem: key => libraryValues.delete(key)}, withLock: task => task(), now}); }
  }
  class TestPreferences extends ReaderPreferences {
    constructor() { super({storage: {getItem: key => preferenceValues.get(key) ?? null, setItem: (key, value) => preferenceValues.set(key, value)}}); }
  }
  const source = readFileSync(new URL("../../app/static/app.mjs", import.meta.url), "utf8").replace(/^import .+;\s*$/gm, "");
  context = vm.createContext({document, window, navigator, crypto: webcrypto,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    MockDevice: TestDevice, TextImporter, createStoryId, ReaderModel, StoryStore: MemoryStore, MAX_STORY_DESCRIPTION, MAX_STORY_TITLE,
    isReadingJump, selectReadingParagraph, PlaybackController, ReaderDeviceController: TestController, HostedAccessGuard: TestGuard,
    selectLibraryStories, storyMetadata, renderStoryTabs, BackupImporter, serializeBackup,
    downloadBackup: (records, options) => { downloads.push({records, options}); return {message: "Backup download started."}; },
    ReaderPreferences: TestPreferences, FolderStore, selectFolderStories,
    WebStoryImporter, identifyStoryUrl, readStoryFile, PRACTICE_STORIES,
    ReaderAccountClient, mountAccountWorkspace, createBetaRecorder, mountBetaRecording, clampCalibration, sceneStagePatternLabel,
    mountPublicAccount: options => mountPublicAccount({...options, ...(authRequest ? {request: authRequest} : {}), setTimer, clearTimer}),
    DEFAULT_SIMULATOR_MAXIMUM, nocturneCandidates, nocturneAvailable, requestNocturne,
    createSimulatorView: () => null, createSetupFlow: () => null, mountReadingFeedback: () => ({update() {}, sharing() {}}),
    performance: {now}, setTimeout: setTimer, clearTimeout: clearTimer,
    innerHeight: 1000, scrollY: 0, console, confirm: () => true, prompt: () => null,
  });
  vm.runInContext(source, context, {filename: "app.mjs"});
  async function settle() { for (let index = 0; index < 3; index++) await nextTurn(0); }
  async function advance(delay) {
    const target = time + delay;
    while (true) {
      const next = [...timers].filter(([, value]) => value.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
    }
    time = target; await settle();
  }
  return {
    nodes, document, errors, settle, advance, now, preferenceValues, downloads, libraryValues,
    read: expression => vm.runInContext(expression, context),
    bootAppearance() {
      vm.runInContext(readFileSync(new URL("../../app/static/appearance.js", import.meta.url), "utf8"), context);
      for (const callback of documentListeners.get("DOMContentLoaded") || []) callback();
    },
    async add(source = "A tender kiss.\n\nA quiet second paragraph.") {
      await nodes.get("empty-new-story").click();
      nodes.get("source").value = source; nodes.get("story-title-input").value = "Synthetic story";
      await nodes.get("load").click(); await advance(0); await settle();
    },
    click: id => nodes.get(id).click(),
    access: callback => { accessRequest = callback; },
    accessCalls: () => accessCalls,
    lockHeld: () => lockHeld,
    holdLock: promise => { lockGate = promise; },
    async visibility(hidden) { document.hidden = hidden; for (const callback of documentListeners.get("visibilitychange") || []) callback(); await settle(); },
    async resize(value) { narrow = value; for (const callback of windowListeners.get("resize") || []) callback(); await settle(); },
    async key(event) { for (const callback of documentListeners.get("keydown") || []) callback({target: document.activeElement, preventDefault() {}, ...event}); await settle(); },
    destroy() { vm.runInContext("hostedAccess?.destroy(); pause('Test ended.');", context); timers.clear(); },
  };
}
