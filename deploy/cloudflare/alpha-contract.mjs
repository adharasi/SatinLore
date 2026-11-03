export const ALPHA_ORIGIN = "https://app.satinlore.com";
export const ALPHA_CONSENT = "alpha-controls-2026-11-03-v1";
export const ALPHA_CLIP_CONSENT = "alpha-clip-2026-11-03-v1";
export const ALPHA_COOKIE = "__Host-satinlore_alpha";
export const AUTH_MS = 8 * 3600000;
export const STUDY_MS = 3600000;
export const RETENTION_MS = 30 * 86400000;
export const CLIP_RETENTION_MS = 7 * 86400000;
export const CLIP_LIMIT = 8 * 1024 * 1024;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const USERNAMES = ["Dilan", "Sadie"];
export const MODES = ["simulator", "live"];
const CHANNELS = ["vibrate", "fingering"];
const encoder = new TextEncoder();

export class AlphaError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
export const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const bytes = value => encoder.encode(value).length;
export const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
export const digest = async value => hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
export function check(condition, message = "Use the supported alpha study fields.", status = 400) {
  if (!condition) throw new AlphaError(message, status);
}

export function exact(value, allowed, required = allowed) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
}

export async function readBody(request, limit, timeoutMs = 10000) {
  const declared = request.headers.get("Content-Length");
  check(declared === null || /^\d+$/.test(declared) && Number(declared) <= limit, "This upload is too large.", 413);
  const reader = request.body?.getReader();
  check(reader, "The request is empty.");
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, timeoutMs);
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      check(!timedOut, "The upload timed out. Try again.", 408);
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        throw new AlphaError("This upload is too large.", 413);
      }
      chunks.push(value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally { clearTimeout(timeout); }
}

export async function readJson(request, limit = 98304) {
  check(/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || ""), "Use the alpha interface for this action.", 415);
  const body = await readBody(request, limit);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new AlphaError("Check the alpha request format."); }
}

function researchText(value, limit) {
  check(typeof value === "string" && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), "Keep each note short and leave out contact details and credentials.");
  return value.trim();
}

const feedbackChoices = {
  minimum: ["yes", "no", "depends"], preferredMovement: ["vibration", "flexing", "both", "neither"],
};
const feedbackNumbers = { vibrationMaximum: 20, flexingMaximum: 20, enjoyment: 10, comfort: 10, easeOfUse: 10, connectionEase: 10 };
const feedbackText = ["bestMoment", "setupFeedback", "improvements", "overallNotes"];
export function normalizeFeedback(value) {
  check(exact(value, [...Object.keys(feedbackChoices), ...Object.keys(feedbackNumbers), ...feedbackText], []) && Object.keys(value).length > 0);
  const result = {};
  for (const [key, options] of Object.entries(feedbackChoices)) {
    if (Object.hasOwn(value, key)) { check(options.includes(value[key])); result[key] = value[key]; }
  }
  for (const [key, maximum] of Object.entries(feedbackNumbers)) {
    if (Object.hasOwn(value, key)) { check(integer(value[key], 0, maximum)); result[key] = value[key]; }
  }
  for (const key of feedbackText) {
    if (Object.hasOwn(value, key)) result[key] = researchText(value[key], 2000);
  }
  return result;
}

export function normalizeAnnotation(value) {
  check(exact(value, ["t", "text"], ["t", "text"]) && integer(value.t, 0, STUDY_MS));
  const text = researchText(value.text, 2000);
  check(text.length > 0, "Enter a note before saving it.");
  return { t: value.t, text };
}

const enumEvents = {
  step: ["step", ["welcome", "connect", "verify", "controls", "feedback", "complete"]],
  mark: ["mark", ["good", "tooMuch", "change", "finished", "climax"]],
  connection: ["state", ["connecting", "connected", "disconnected", "failed", "expired"]],
  lifecycle: ["event", ["hidden", "visible", "recording-paused", "recording-resumed", "screen-started", "screen-ended"]],
};
const controls = ["vibration", "flexing", "vibrationMaximum", "flexingMaximum", "minimum", "rhythm", "start", "stop", "hold", "easeOff", "pause", "test", "finish", "connect", "select", "range", "choose", "easeoff", "resume", "disconnect", "level", "maximum", "recovery"];
const controlValues = ["steady", "gentle", "dynamic", "vibrate", "fingering", "vibration", "flexing", "both", "simulator", "live", "on", "off"];
const valueLevel = value => value === null || integer(value, 0, 20);

export function normalizeAlphaEvent(value) {
  check(value && typeof value.type === "string" && integer(value.t, 0, STUDY_MS));
  const base = { t: value.t, type: value.type };
  const only = (allowed, required = allowed) => exact(value, ["t", "type", ...allowed], ["t", "type", ...required]);
  if (Object.hasOwn(enumEvents, value.type)) {
    const [key, options] = enumEvents[value.type];
    check(only([key]) && options.includes(value[key]));
    return { ...base, [key]: value[key] };
  }
  if (value.type === "control") {
    check(only(["control", "channel", "value"], ["control"]) && controls.includes(value.control));
    if (Object.hasOwn(value, "channel")) check(CHANNELS.includes(value.channel));
    if (Object.hasOwn(value, "value")) check(integer(value.value, 0, 20) || typeof value.value === "boolean" || controlValues.includes(value.value));
    return { ...base, control: value.control, ...(value.channel === undefined ? {} : { channel: value.channel }), ...(value.value === undefined ? {} : { value: value.value }) };
  }
  if (value.type === "output" && Object.hasOwn(value, "channels")) {
    check(only(["mode", "stage", "channels", "durationMs", "commandId"], ["mode", "stage", "channels"]) && MODES.includes(value.mode) &&
      ["requested", "submitted", "simulated", "failed", "unknown"].includes(value.stage));
    check(exact(value.channels, CHANNELS, []) && Object.values(value.channels).every(valueLevel));
    check(value.durationMs === undefined || integer(value.durationMs, 0, 2000));
    check(value.commandId === undefined || integer(value.commandId, 1, 1000000));
    return { ...base, mode: value.mode, stage: value.stage, channels: value.channels,
      ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }), ...(value.commandId === undefined ? {} : { commandId: value.commandId }) };
  }
  if (value.type === "output") {
    check(only(["vibration", "flexing", "state"], ["state"]) && ["paused", "playing", "testing", "stopped", "unknown"].includes(value.state));
    check((value.vibration === undefined || valueLevel(value.vibration)) && (value.flexing === undefined || valueLevel(value.flexing)));
    return { ...base, state: value.state, ...(value.vibration === undefined ? {} : { vibration: value.vibration }), ...(value.flexing === undefined ? {} : { flexing: value.flexing }) };
  }
  if (value.type === "device") {
    check(only(["mode", "channels"]) && MODES.includes(value.mode) && Array.isArray(value.channels) && value.channels.length <= 2 &&
      new Set(value.channels).size === value.channels.length && value.channels.every(channel => CHANNELS.includes(channel)));
    return { ...base, mode: value.mode, channels: value.channels };
  }
  if (value.type === "verification") {
    check(only(["mode", "channel", "response", "stopped"]) && MODES.includes(value.mode) && CHANNELS.includes(value.channel) &&
      typeof value.response === "boolean" && typeof value.stopped === "boolean");
    return { ...base, mode: value.mode, channel: value.channel, response: value.response, stopped: value.stopped };
  }
  check(value.type === "verify" && only(["movement", "outcome"]) && ["vibration", "flexing", "both"].includes(value.movement) && ["passed", "failed", "uncertain"].includes(value.outcome));
  return { ...base, movement: value.movement, outcome: value.outcome };
}
