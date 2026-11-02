// Public, bounded profiles; never a substitute for discovering a real toy.
// Reviewed 2 November 2026 against the official Standard JS SDK, Standard API
// and native toy-command matrix. In particular, JS does not document separate
// Dolce motors or heating. Extra Velvo/Spinel motions require a runtime report.
// Osci 3 oscillation is documented for native/HTTP APIs, not this browser SDK.
const labels = Object.freeze({vibrate: "Vibration", rotate: "Rotation", fingering: "Flexing", thrusting: "Thrusting", oscillate: "Oscillation · simulator only"});
const profile = (id, label, shape, physicalChannels, reportedChannels = [], physicalNotes = "", simulationOnlyChannels = []) => Object.freeze({
  id, model: id, label, shape,
  physicalChannels: Object.freeze(physicalChannels),
  reportedChannels: Object.freeze(reportedChannels),
  simulationOnlyChannels: Object.freeze(simulationOnlyChannels),
  simChannels: Object.freeze([...physicalChannels, ...reportedChannels, ...simulationOnlyChannels]),
  channels: Object.freeze([...physicalChannels, ...reportedChannels, ...simulationOnlyChannels].map(id => Object.freeze({id, label: labels[id]}))),
  physicalNotes,
});

export const TOY_PROFILES = Object.freeze([
  profile("lush", "Lush", "egg", ["vibrate"]),
  profile("flexer", "Flexer", "dual", ["vibrate", "fingering"]),
  profile("nora", "Nora", "rabbit", ["vibrate", "rotate"]),
  profile("domi", "Domi", "wand", ["vibrate"]),
  profile("velvo", "Velvo", "rabbit", ["vibrate"], ["rotate"], "Rotation is offered only when your connection reports it. Rolling beads have no separate control here."),
  profile("spinel", "Spinel", "shaft", ["vibrate"], ["thrusting"], "Thrusting is offered only when your connection reports it. Heating is not controlled by SatinLore."),
  profile("dolce", "Dolce", "dual", ["vibrate"], [], "This connection uses general vibration, without separate controls for the two motors."),
  profile("hush", "Hush", "plug", ["vibrate"]),
  profile("osci3", "Osci 3", "rabbit", ["vibrate"], [], "Live testing uses vibration. Oscillation can be rehearsed in the simulator; this connection does not yet control it, heating or separate motors.", ["oscillate"]),
]);

export const getToyProfile = id => TOY_PROFILES.find(item => item.id === id) || null;
export const channelLabel = id => labels[id] || "Unavailable";

const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const functionNames = Object.freeze({v: "vibrate", vibrate: "vibrate", r: "rotate", rotate: "rotate", f: "fingering", fingering: "fingering", t: "thrusting", thrusting: "thrusting"});

function modelId(value, hardwareVersion) {
  if (typeof value !== "string" || value.length > 64) return null;
  const text = value.toLowerCase().replace(/[ _-]/g, "");
  if (text === "osci3" || text === "osci" && String(hardwareVersion) === "3") return "osci3";
  // Never promote Osci/Osci 2 or an unknown future model to the Osci 3 profile.
  return TOY_PROFILES.find(item => item.id !== "osci3" && new RegExp(`^${item.id}(?:[1-9][0-9]?)?$`).test(text))?.id || null;
}

function report(toy) {
  const lists = [toy.fullFunctionNames, toy.shortFunctionNames].filter(value => value !== undefined);
  if (!lists.length) return null;
  // A present but malformed/empty report must not become permission to fall back.
  if (lists.some(value => !Array.isArray(value) || value.length > 30)) return new Set();
  return new Set(lists.flat().filter(value => typeof value === "string" && value.length <= 30)
    .map(value => functionNames[value.toLowerCase()]).filter(Boolean));
}

export function normaliseToy(toy) {
  if (!toy || typeof toy !== "object" || Array.isArray(toy) || !validId(toy.id) || toy.connected !== true) return null;
  // toyType is authoritative when supplied; do not promote an arbitrary nickname.
  const model = modelId(toy.toyType === undefined ? toy.name : toy.toyType, toy.hVersion);
  const current = getToyProfile(model);
  if (!current) return null;
  const reported = report(toy);
  const capabilities = reported === null ? [...current.physicalChannels] :
    [...current.physicalChannels, ...current.reportedChannels].filter(channel => reported.has(channel));
  if (!capabilities.length) return null;
  const version = /^([1-9][0-9]?)$/.exec(String(toy.hVersion || ""))?.[1];
  const label = `${current.label}${version && model !== "osci3" ? ` ${version}` : ""}`;
  return {id: toy.id, label, model, capabilities,
    capabilitySource: reported === null ? "documented-model" : "reported",
    battery: Number.isInteger(toy.battery) && toy.battery >= 0 && toy.battery <= 100 ? toy.battery : null};
}

export const normalizeToy = normaliseToy;

export function supportedToys(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 50).map(normaliseToy).filter(toy => {
    if (!toy || seen.has(toy.id)) return false;
    seen.add(toy.id); return true;
  });
}
