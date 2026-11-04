// Product names and movements are bounded by the vendor compatibility audit
// in docs/lovense-compatibility.md. A runtime report may narrow any profile.
const labels = Object.freeze({vibrate: "Vibration", rotate: "Rotation", fingering: "Flexing", thrusting: "Thrusting", oscillate: "Oscillation"});
function profile(id, label, shape, {
  physicalChannels = ["vibrate"], socketChannels = [], reportedChannels = [], physicalNotes = "", pickerLabel = label,
} = {}) {
  const simChannels = [...physicalChannels, ...socketChannels, ...reportedChannels];
  return Object.freeze({
    id, model: id, label, shape, physicalNotes, pickerLabel,
    physicalChannels: Object.freeze(physicalChannels),
    socketChannels: Object.freeze(socketChannels),
    reportedChannels: Object.freeze(reportedChannels),
    simChannels: Object.freeze(simChannels),
    channels: Object.freeze(simChannels.map(id => Object.freeze({id, label: labels[id]}))),
  });
}

export const TOY_PROFILES = Object.freeze([
  profile("lush", "Lush", "egg", {pickerLabel: "Lush 1–4"}),
  profile("flexer", "Flexer", "dual", {physicalChannels: ["vibrate", "fingering"]}),
  profile("nora", "Nora", "rabbit", {physicalChannels: ["vibrate", "rotate"], pickerLabel: "Nora / Nora 2"}),
  profile("domi", "Domi", "wand", {pickerLabel: "Domi / Domi 2"}),
  profile("velvo", "Velvo", "rabbit", {reportedChannels: ["rotate"],
    physicalNotes: "Rotation is available when the extended Lovense connection lists it."}),
  profile("spinel", "Spinel", "shaft", {reportedChannels: ["thrusting"],
    physicalNotes: "Thrusting is available when the extended Lovense connection lists it."}),
  profile("dolce", "Dolce", "dual", {physicalNotes: "Vibration runs together across both motors."}),
  profile("hush", "Hush", "plug", {pickerLabel: "Hush / Hush 2"}),
  profile("osci3", "Osci 3", "rabbit", {socketChannels: ["oscillate"],
    physicalNotes: "The extended Lovense connection can also control oscillation."}),
  profile("ambi", "Ambi", "egg"),
  profile("calor", "Calor", "shaft"),
  profile("diamo", "Diamo", "plug"),
  profile("edge", "Edge", "dual", {pickerLabel: "Edge / Edge 2"}),
  profile("exomoon", "Exomoon", "shaft"),
  profile("ferri", "Ferri", "egg"),
  profile("gemini", "Gemini", "dual"),
  profile("glint", "Glint", "plug"),
  profile("gravity", "Gravity", "shaft", {physicalChannels: ["vibrate", "thrusting"]}),
  profile("gush", "Gush", "plug"),
  profile("gush2", "Gush 2", "plug", {pickerLabel: "Gush 2 / Gush 2 Motion", reportedChannels: ["oscillate"],
    physicalNotes: "Oscillation is available when the extended Lovense connection lists it."}),
  profile("hyphy", "Hyphy", "wand"),
  profile("lapis", "Lapis", "dual"),
  profile("lushanal", "Lush Anal", "plug"),
  profile("lushmini", "Lush Mini", "egg"),
  profile("max", "Max", "shaft", {pickerLabel: "Max / Max 2", physicalNotes: "SatinLore controls vibration on this model."}),
  profile("minixmachine", "Lovense Mini Sex Machine", "shaft", {physicalChannels: [], reportedChannels: ["thrusting"],
    physicalNotes: "The extended Lovense connection must list thrusting before you can use it live."}),
  profile("mission", "Mission", "shaft", {pickerLabel: "Mission / Mission 2"}),
  profile("osci", "Osci / Osci 2", "rabbit"),
  profile("ridge", "Ridge", "shaft", {reportedChannels: ["rotate"],
    physicalNotes: "Rotation is available when the extended Lovense connection lists it."}),
  profile("solace", "Solace", "shaft", {physicalChannels: [], reportedChannels: ["thrusting"],
    physicalNotes: "The extended Lovense connection must list thrusting before you can use it live."}),
  profile("solacepro", "Solace Pro", "shaft", {physicalChannels: [], reportedChannels: ["thrusting"],
    physicalNotes: "The extended Lovense connection must list thrusting before you can use it live."}),
  profile("vulse", "Vulse", "egg", {reportedChannels: ["thrusting"],
    physicalNotes: "Thrusting is available when the extended Lovense connection lists it."}),
  profile("xmachine", "Lovense Sex Machine", "shaft", {physicalChannels: ["thrusting"]}),
]);

export const getToyProfile = id => TOY_PROFILES.find(item => item.id === id) || null;
export const channelLabel = id => labels[id] || "Unavailable";

const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const functionNames = Object.freeze({v: "vibrate", vibrate: "vibrate", r: "rotate", rotate: "rotate", f: "fingering", fingering: "fingering", t: "thrusting", thrusting: "thrusting", o:"oscillate",oscillate:"oscillate"});

const variants = Object.freeze({
  lush: ["Lush 1", "Lush 2", "Lush 3", "Lush 4"],
  domi: ["Domi 1", "Domi 2"],
  nora: ["Nora 1", "Nora 2"],
  hush: ["Hush 1", "Hush 2"],
  edge: ["Edge 1", "Edge 2"],
  max: ["Max 1", "Max 2"],
  mission: ["Mission 1", "Mission 2"],
  osci: ["Osci 1", "Osci 2"],
  osci3: ["Osci 3"],
  gush: ["Gush 1"],
  gush2: ["Gush 2", "Gush 2 Motion"],
  xmachine: ["Sex Machine", "Lovense Sex Machine"],
  minixmachine: ["Mini Sex Machine", "Lovense Mini Sex Machine"],
});
const modelKey = name => name.toLowerCase().replace(/[ _-]/g, "");
const models = new Map(TOY_PROFILES.map(item => [item.id, {model: item.id, label: item.label}]));
for (const [model, names] of Object.entries(variants)) {
  for (const label of names) models.set(modelKey(label), {model, label});
}

function modelIdentity(value, hardwareVersion) {
  if (typeof value !== "string" || value.length > 64) return null;
  const key = modelKey(value), identity = models.get(key);
  if (!identity) return null;
  const version = typeof hardwareVersion === "string" || typeof hardwareVersion === "number" ? String(hardwareVersion) : "";
  // Only a known generation of a base model may use the hardware version.
  if (key === identity.model && /^[2-4]$/.test(version)) return models.get(key + version) || identity;
  return identity;
}

function report(toy) {
  const lists = [toy.fullFunctionNames, toy.shortFunctionNames].filter(value => value !== undefined);
  if (!lists.length) return null;
  // A present but malformed/empty report must not become permission to fall back.
  if (lists.some(value => !Array.isArray(value) || value.length > 30)) return new Set();
  return new Set(lists.flat().filter(value => typeof value === "string" && value.length <= 30)
    .map(value => functionNames[value.toLowerCase()]).filter(Boolean));
}

export function normaliseToy(toy, {transport = "basic-sdk"} = {}) {
  if (!toy || typeof toy !== "object" || Array.isArray(toy) || !validId(toy.id) || toy.connected !== true) return null;
  // toyType is authoritative when supplied; do not promote an arbitrary nickname.
  const identity = modelIdentity(toy.toyType === undefined ? toy.name : toy.toyType, toy.hVersion);
  if (!identity) return null;
  const {model, label} = identity, current = getToyProfile(model);
  const reported = report(toy);
  const extended = transport === "standard-socket-v1";
  const documented = [...current.physicalChannels, ...(extended ? current.socketChannels : [])];
  const capabilities = reported === null ? documented :
    [...documented, ...(extended ? current.reportedChannels : [])].filter(channel => reported.has(channel));
  if (!capabilities.length) return null;
  return {id: toy.id, label, model, capabilities,
    ...(extended ? {controlTransport:"standard-socket-v1",supportsCombined:true} : {}),
    capabilitySource: reported === null ? "documented-model" : "reported",
    battery: Number.isInteger(toy.battery) && toy.battery >= 0 && toy.battery <= 100 ? toy.battery : null};
}

export const normalizeToy = normaliseToy;

export function supportedToys(value, options) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 50).map(toy=>normaliseToy(toy,options)).filter(toy => {
    if (!toy || seen.has(toy.id)) return false;
    seen.add(toy.id); return true;
  });
}
