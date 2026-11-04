// Original, independently annotated rehearsal passages. Keep expectations fixed
// when comparing analysis revisions. No private text or hardware is needed.
const section = (name, text, phase, {movements = [], shape, label, blocked = false, boundary = false, manualZero = false} = {}) =>
  ({name, text, expected: {phase, movements, shape, label, blocked, boundary, manualZero}});

export const MODEL_EVALUATION_STORIES = [
  {name: "Conservatory", toy: "flexer", sections: [
    section("Approach", "They drew closer. She held her breath.", "build"),
    section("Steady movement", "Their slow tender kiss expressed affection. The device vibrated steadily.", "sustain", {movements: ["vibrate"], shape: "sustained", label: "steady"}),
    section("Short overlapping accents", "Their passionate, tender kiss and romantic embrace expressed affection. The device vibrated in short bursts while her fingers flexed.", "peak", {movements: ["vibrate", "fingering"], shape: "accented", label: "accents"}),
    section("Ease down", "They slowed and relaxed.", "recover", {movements: ["vibrate", "fingering"]}),
    section("New scene", "The following morning, the conservatory was open for tours.", "quiet", {boundary: true}),
    section("Light and rain", "A drop of rain caught the light on the glass.", "quiet"),
  ]},
  {name: "Lantern room", toy: "nora", sections: [
    section("Warm-up", "They shared a tender kiss.", "build"),
    section("Variable movement", "They shared another tender, romantic kiss. The device buzzed in stronger and softer pulses.", "sustain", {movements: ["vibrate"], shape: "alternating", label: "wave"}),
    section("Unspecified shape", "Their tender, romantic kiss continued. The toy rotated.", "sustain", {movements: ["rotate"], shape: "unspecified", label: "abstain"}),
    section("Sustained peak", "Their passionate, tender kiss and romantic embrace expressed affection. The device vibrated in one long wave.", "peak", {movements: ["vibrate"], shape: "sustained", label: "crest"}),
    section("Pause requested", "She said, “Stop.” The room was still.", "quiet", {blocked: true, boundary: true}),
    section("Manual zero", "They shared a tender, romantic kiss. The device vibrated steadily.", "sustain", {movements: ["vibrate"], shape: "sustained", manualZero: true}),
  ]},
  {name: "Workshop notes", toy: "nora", sections: [
    section("Indirect report", "She tells him that the toy vibrated steadily as they shared a tender kiss.", "quiet", {blocked: true}),
    section("Counterfactual", "If they shared a tender kiss, the toy might vibrate in short bursts.", "quiet", {blocked: true}),
    section("Unrealised intention", "They were going to share a tender kiss, but the phone rang.", "quiet", {blocked: true}),
    section("Clear restart", "They shared a tender, romantic kiss. The device vibrated steadily.", "sustain", {movements: ["vibrate"], shape: "sustained", label: "steady"}),
    section("Nearby source", "They shared a tender, romantic kiss. The rotation from the bedside fan continued.", "sustain", {shape: "unspecified", label: "abstain"}),
    section("Sensitive words", "The leaflet used the term under-age. They shared a tender kiss.", "quiet", {blocked: true, boundary: true}),
    section("Negated second movement", "They shared a tender, romantic kiss. The toy vibrated steadily but did not rotate.", "sustain", {movements: ["vibrate"], shape: "unspecified", blocked: true}),
  ]},
  {name: "At the station", toy: "lush", sections: [
    section("Foreign-language contact", "Ils s'embrassèrent avec tendresse.", "build"),
    section("Soft start", "They shared a tender kiss.", "build"),
    section("Ordinary room detail", "Rain tapped softly on the window.", "sustain", {shape: "unspecified", label: "abstain"}),
    section("Actual action with a quote", "“The device buzzed in short bursts,” she read aloud. They shared a tender, romantic kiss.", "sustain", {shape: "unspecified", blocked: true}),
    section("Unsupported motion", "They shared a tender, romantic kiss. The device rotated.", "sustain", {movements: ["rotate"], shape: "unspecified", label: "abstain"}),
    section("Section break", "***", "quiet", {boundary: true}),
  ]},
];
