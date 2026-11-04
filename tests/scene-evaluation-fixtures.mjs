// Neutral original material used by the simulator read-through and regression.
export const READING_PASSAGES = Object.freeze([
  "They drew closer. She held her breath.",
  "He didn’t want to leave. They shared a tender kiss.",
  "Rain tapped on the glass.",
  "A clock ticked in the hall.",
  "The fan rotated as they shared a tender romantic kiss. Their affectionate embrace grew quicker.",
  "They slowed and relaxed.",
  "Later that evening, she imagined a tender kiss.",
  "They washed the dishes and closed the curtains.",
]);

export const CUE_EDGE_CASES = Object.freeze([
  {label: "imagined action", text: "She imagined a tender kiss.", level: 0, movements: []},
  {label: "unrelated negation", text: READING_PASSAGES[1], level: 1, movements: []},
  {label: "unrelated rotating object", text: "The fan rotated as they shared a tender kiss.", level: 1, movements: []},
  {label: "anticipation without a nearby scene", text: READING_PASSAGES[0], level: 0, movements: []},
  {label: "explicit boundary", text: "Later that evening, they shared a tender kiss.", level: 0, movements: []},
  {label: "unrelated physical activity", text: "A chair rotated as she moved it across the room.", level: 0, movements: []},
]);

// Original passages. Each expectation describes the story, independently of
// device support and of the particular intensity a reader has calibrated.
const active = (...movements) => ({active: true, movements});
const still = {active: false, movements: []};
const stopped = {...still, quiet: true};
const tenderKiss = "They shared a tender kiss.";
const observation = (label, text, expected) => ({label, text, expected});

export const MOVEMENT_READINGS = Object.freeze({
  flexer: [
    observation("anticipation", "They drew closer. She held her breath.", active()),
    observation("contact with a gentle adverb", "They kissed gently.", active()),
    observation("vibration and flexing overlap", `${tenderKiss} The device vibrated and flexed.`, active("vibrate", "fingering")),
    observation("vibration ends before flexing", `${tenderKiss} The device vibrated, then flexed.`, active("fingering")),
    observation("spoken stop", "She told him to stop.", stopped),
    observation("quoted demonstration", "“The device vibrated and flexed,” she said, recalling the demonstration.", still),
    observation("one movement continues through another", "Their affectionate embrace continued. The vibration continued as her fingers flexed.", active("vibrate", "fingering")),
    observation("time jump", "Later that evening, they made tea.", stopped),
  ],
  nora: [
    observation("vibration and rotation overlap", `${tenderKiss} The device vibrated and rotated.`, active("vibrate", "rotate")),
    observation("fan and device in separate clauses", `${tenderKiss} A fan rotated while the device vibrated.`, active("vibrate")),
    observation("rotation follows vibration", `${tenderKiss} The device vibrated, then its arm rotated.`, active("rotate")),
    observation("rotation was hypothetical", `${tenderKiss} She imagined the device rotating.`, active()),
  ],
  spinel: [
    observation("thrusting", `${tenderKiss} The thrusting motion continued.`, active("thrusting")),
    observation("vibration and thrusting overlap", `${tenderKiss} The device vibrated and began thrusting.`, active("vibrate", "thrusting")),
    observation("movement in a quoted account", `${tenderKiss} She said, “The device vibrated and began thrusting.”`, active()),
  ],
  osci3: [
    observation("oscillation", `${tenderKiss} The device oscillated.`, active("oscillate")),
    observation("vibration and oscillation overlap", `${tenderKiss} The device vibrated and oscillated.`, active("vibrate", "oscillate")),
    observation("side-to-side phrasing", `${tenderKiss} The movement side to side continued.`, active("oscillate")),
  ],
});

const extraReadings = [
  {
    label: "movement wording and unrelated context",
    paragraphs: [
      observation("independent movements are not layered", `${tenderKiss} The device vibrated. Her fingers flexed.`, active("fingering")),
      observation("negated flexing", `${tenderKiss} The device vibrated but did not flex.`, active("vibrate")),
      observation("phone in a separate sentence", `${tenderKiss} Her phone vibrated.`, active()),
      observation("unrelated gentle action", "She closed the door gently. They looked at the view.", still),
      observation("remembered kiss", "Last summer they shared a tender kiss.", still),
      observation("quoted possibility", "She said, 'They might share a tender kiss.'", still),
      observation("quote read from a script", "“They shared a tender kiss,” she read from the script.", still),
      observation("action after unrelated dialogue", "“Wait for the kettle,” she whispered. Then they shared a tender kiss.", active()),
      observation("negation in an unrelated sentence", READING_PASSAGES[1], active()),
      observation("movement with no matching scene", "The device vibrated and rotated during a routine equipment check.", still),
    ],
  },
  {
    label: "continuity followed by a longer digression",
    paragraphs: [
      observation("action starts", tenderKiss, active()),
      observation("room detail one", "Rain brushed the window.", still),
      observation("room detail two", "A clock ticked.", still),
      observation("room detail three", "A lamp lit the hallway.", still),
      observation("action after the gap", "They shared an affectionate embrace.", active()),
      observation("quiet scene separator", "***", stopped),
      observation("unrelated rotation after the separator", "The fan rotated.", still),
    ],
  },
  {
    label: "continuity stops at a boundary",
    paragraphs: [
      observation("gentle onset", tenderKiss, active()),
      observation("narrative detail between active passages", "Rain brushed the window.", active()),
      observation("return to the action", "They shared an affectionate embrace.", active()),
      observation("clear pause", "They slowed to a stop.", stopped),
      observation("quiet detail after the pause", "A clock ticked.", still),
      observation("new scene starts", tenderKiss, active()),
      observation("the participants separate", "He pulled away from her.", stopped),
      observation("another new scene starts", "They shared an affectionate embrace.", active()),
    ],
  },
];

export const SCENE_EVALUATION_STORIES = Object.freeze([
  ...Object.entries(MOVEMENT_READINGS).map(([label, paragraphs]) => ({label, paragraphs})),
  ...extraReadings,
]);

export function evaluateSceneStory(ReaderModel, {label, paragraphs}) {
  const analysed = new ReaderModel().load(paragraphs.map(({text}) => text).join("\n\n"));
  return paragraphs.map(({label: passage, expected}, index) => {
    const {suggestedLevel, movements, quiet} = analysed[index];
    return {
      label: `${label} / ${passage}`, expected,
      observed: {active: suggestedLevel > 0, movements, ...(Object.hasOwn(expected, "quiet") ? {quiet} : {})},
      suggestedLevel,
    };
  });
}
