import {ALPHA_SCREEN_ITEM_LIMIT, ALPHA_SCREEN_LABELS, ALPHA_SCREEN_MAXIMUM_FIELDS} from "./alpha-screen-schema.mjs";
import {MOVEMENT_IDS} from "./devices/toy-profiles.mjs";

const ids = {
  theme: "theme", title: "study-title", intro: "study-intro", progress: "progress-connect",
  collection: "record-strip", device: "device-title", badge: "connection-badge", status: "device-status",
  connect: "device-connect", refresh: "device-refresh", qr: "device-qr", picker: "device-select",
  select: "device-select-confirm", verify: "verification-note", continue: "verify-continue",
  disconnect: "device-disconnect", guide: "controls-guidance", start: "device-start", hold: "device-hold",
  ease: "device-ease", resume: "device-resume", back: "back-to-checks", peak: "peak", stop: "device-stop",
  finish: "finish", save: "feedback-save", home: "back-to-start", moments: "review-moments",
  time: "review-time", annotation: "annotation",
};

const selectors = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, "#alpha-" + id]));
selectors.instructions = "#alpha-live-instructions:not([hidden]), #alpha-simulator-instructions:not([hidden])";
selectors["save-note"] = "#alpha-annotation-form button[type=submit]";
for (const mark of ["good", "tooMuch", "change"]) selectors["mark-" + mark] = `[data-alpha-mark="${mark}"]`;
for (const channel of MOVEMENT_IDS) {
  const verification = `#alpha-verification-movements [data-channel="${channel}"]`;
  const card = `#alpha-movement-cards [data-channel="${channel}"]`;
  selectors["verify-" + channel] = verification + " button";
  selectors["check-" + channel] = verification + " input";
  selectors[channel + "-toggle"] = card + " [data-movement-toggle]";
  for (const setting of ["level", "maximum", "minimum", "recovery", "rhythm", "range"]) {
    selectors[`${channel}-${setting}`] = `${card} [data-setting="${setting}"]`;
  }
}
for (const key of Object.keys(ALPHA_SCREEN_LABELS)) {
  selectors[key] ??= `#alpha-feedback-form [name="${key}"]`;
}

const mask = new Set(["qr", "picker", "minimum", "preferredMovement", ...ALPHA_SCREEN_MAXIMUM_FIELDS,
  "enjoyment", "comfort", "connectionEase", "easeOfUse", "bestMoment", "setupFeedback",
  "improvements", "overallNotes", "annotation"]);
const bound = (value, size) => Math.round(Math.max(0, Math.min(1, value / size)) * 1000);

function snapshot(screen) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!width || !height) return null;
  const items = [];
  for (const [id, selector] of Object.entries(selectors)) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const x = bound(rect.left, width);
    const y = bound(rect.top, height);
    const w = bound(rect.right, width) - x;
    const h = bound(rect.bottom, height) - y;
    if (!w || !h) continue;
    const state = mask.has(id) ? "masked" : element.disabled ? "disabled" : element.checked ? "checked" : undefined;
    items.push({id, x, y, w, h, ...(state ? {state} : {})});
    if (items.length === ALPHA_SCREEN_ITEM_LIMIT) break;
  }
  return {type: "screen", screen, viewport: {w: Math.min(width, 10_000), h: Math.min(height, 10_000)}, items};
}

// Replay uses an allowlist of UI positions and control states. It never reads
// displayed text, input values, device names, pairing images or the login page.
export function captureAlphaScreen({currentScreen, record}) {
  let previous = "";
  let previousScreen = null;
  let lastFrame = 0;
  let lastPointer = 0;
  function reset() {
    previous = "";
    previousScreen = null;
  }
  function frame({force = false} = {}) {
    const screen = currentScreen();
    if (!screen || document.hidden) { reset(); return; }
    const now = performance.now();
    if (!force && screen === previousScreen && now - lastFrame < 250) return;
    const value = snapshot(screen);
    if (!value) return;
    const key = JSON.stringify(value);
    if (key !== previous && record(value)) {
      previous = key;
      previousScreen = screen;
      lastFrame = now;
    }
  }
  function pointer(event, action) {
    if (!currentScreen() || document.hidden || !event.isTrusted || !event.target.closest?.("#alpha-study")) return;
    const now = performance.now();
    if (action === "move" && now - lastPointer < 333) return;
    lastPointer = now;
    if (action === "click") frame();
    record({type: "pointer", x: bound(event.clientX, window.innerWidth), y: bound(event.clientY, window.innerHeight), action});
  }
  document.addEventListener("pointermove", event => pointer(event, "move"), {passive: true});
  document.addEventListener("click", event => pointer(event, "click"), {capture: true});
  return {frame, reset};
}
