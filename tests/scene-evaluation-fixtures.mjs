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

// Original review stories for the fifth revision. Label the current
// paragraph's beat, including an explicit overlap only when the text supports it.
export const CONTEXT_MOVEMENT_STORIES = Object.freeze([
  {
    label: "the guest room (Flexer)",
    paragraphs: [
      observation("anticipation", "They drew closer. Her breath caught.", active()),
      observation("grounded pulse overlapping flexing",
        "They kissed gently. She adjusted the toy. It pulsed in short bursts while her fingers flexed.", active("vibrate", "fingering")),
      observation("a continuing movement while another ends",
        "Their affectionate embrace continued. The vibration stopped while the device kept flexing.", active("fingering")),
      observation("one device explicitly continues a movement after another stops",
        "They kissed gently. The toy stopped vibrating while it kept flexing.", active("fingering")),
      observation("the last movement ends",
        "The device stopped flexing.", stopped),
      observation("sound after the stop",
        "The pipes ticked in the guest-room wall.", still),
      observation("a fresh grounded movement",
        "They shared a tender kiss. The device pulsed and flexed again.", active("vibrate", "fingering")),
      observation("the whole device goes still", "The device went still.", stopped),
      observation("the evening ends", "Later that evening they opened the window.", stopped),
    ],
  },
  {
    label: "the night train (Nora)",
    paragraphs: [
      observation("ordinary motion",
        "The carriage vibrated as the night train left the tunnel. She unfolded the paper schedule.", still),
      observation("literal vibration and rotation",
        "Their affectionate embrace continued. The toy vibrated and rotated.", active("vibrate", "rotate")),
      observation("rotation outlasts vibration",
        "They kissed tenderly. The toy vibrated, then it rotated.", active("rotate")),
      observation("an external object competes for the pronoun",
        "They shared a tender kiss. The device sat beside the phone. It pulsed in the dark.", active()),
      observation("the phone cannot add movement",
        "They shared an affectionate embrace. The phone pulsed while the toy rotated.", active("rotate")),
      observation("the heart cannot add movement",
        "They shared a tender kiss. Her heart pulsed as the toy rotated.", active("rotate")),
      observation("a non-present movement cannot add rotation",
        "They shared a tender kiss. She remembered how the device felt. It might pulse and rotate again.", active()),
      observation("the train arrives",
        "Hours later the train slowed at the platform.", stopped),
    ],
  },
  {
    label: "the borrowed lamp (Spinel)",
    paragraphs: [
      observation("a machine without story context",
        "The device pulsed and began thrusting during the engineer’s inspection.", still),
      observation("a line of dialogue cannot ground an actor",
        "They kissed softly. “Set the toy over there,” he said. It pulsed and began thrusting.", active()),
      observation("a named device pulse overlapping thrusting",
        "They shared a tender kiss. The toy pulsed and began thrusting.", active("vibrate", "thrusting")),
      observation("sequential pulses do not overlap",
        "They shared an affectionate embrace. The toy pulsed, then it began thrusting.", active("thrusting")),
      observation("a shared subject with a negated second movement",
        "They kissed gently. The toy pulsed but did not thrust.", active("vibrate")),
      observation("an ordinary room detail between matched passages",
        "A narrow stripe of lamplight crossed the floor.", active("vibrate")),
      observation("actual motion after unrelated dialogue",
        "“The lamp is too bright,” she said. They shared a tender kiss. She adjusted the toy. It pulsed and began thrusting.", active("vibrate", "thrusting")),
      observation("explicit stop", "She told him to stop.", stopped),
    ],
  },
  {
    label: "the hallway (Osci 3)",
    paragraphs: [
      observation("an indicator light at the start of the story",
        "The light pulsed three times while she waited in the hallway.", still),
      observation("a named device establishes the scene",
        "They shared a tender kiss. The toy vibrated and oscillated.", active("vibrate", "oscillate")),
      observation("a grounded reference in the next paragraph",
        "It pulsed gently and oscillated.", active("vibrate", "oscillate")),
      observation("a buzz from a named external object",
        "They shared a tender kiss. The device oscillated as the phone buzzed.", active("oscillate")),
      observation("a device buzzing while it oscillates",
        "They shared a tender kiss. The device buzzed and oscillated.", active("vibrate", "oscillate")),
      observation("a reported pulse cannot add a second movement",
        "They shared a tender kiss. The toy oscillated. He said that it pulsed earlier.", active("oscillate")),
      observation("named oscillation ends", "The toy stopped oscillating.", stopped),
      observation("the next day", "The following morning, the hallway was quiet.", stopped),
      observation("an ungrounded reference after the boundary", "It pulsed once and oscillated.", still),
    ],
  },
  {
    label: "after the gathering",
    paragraphs: [
      observation("writing about past contact",
        "She wrote about their tender kiss in her journal.", still),
      observation("planning a moment that has not happened",
        "She planned a tender kiss for later.", still),
      observation("a gentle, active scene with an unambiguous actor",
        "They shared a tender kiss. The device vibrated.", active("vibrate")),
      observation("one short continuation with an identifiable actor",
        "It pulsed twice and flexed.", active("vibrate", "fingering")),
      observation("a new object becomes the clear actor",
        "A brass metronome sat on the shelf. It vibrated against the wood.", still),
      observation("the named device stops", "The toy stopped.", stopped),
      observation("a reference cannot cross an explicit stop",
        "It pulsed once in the dark.", still),
      observation("a manual cannot establish the device as the actor",
        "They kissed gently. The toy manual was on the nightstand. It pulsed and flexed.", active()),
      observation("a possessive cannot establish the device as the actor",
        "They kissed gently. The toy’s battery was flat. It pulsed and flexed.", active()),
      observation("a spatial phrase can introduce a competing actor",
        "They kissed gently. The toy lay across a brass metronome. It pulsed and flexed.", active()),
      observation("manual handling without an automatic movement cue",
        "They kissed softly. He rotated the toy in his palm.", active()),
      observation("phone motion far from a confirmed scene",
        "The phone buzzed in his coat pocket. He put it on the charger.", still),
      observation("scene separator", "***", stopped),
    ],
  },
]);

// Original cases for ambiguity and scene-boundary regression. A nearby
// grounded movement can continue while a different source is described.
export const AMBIGUITY_STORIES = Object.freeze([
  {
    label: "the station platform",
    paragraphs: [
      observation("expected contact", "She expected a tender kiss at the station.", still),
      observation("interrupted intention", "She was about to share a tender kiss, but the train whistle blew.", still),
      observation("a quiet interlude", "A fresh breeze moved the curtains.", still),
      observation("almost applies to the effect", "Their tender kiss nearly made her drop the book.", active()),
      observation("a named person's intention", "Mara intended to share a tender kiss before dinner.", still),
      observation("steady actual movement", "They shared a tender kiss and the toy buzzed steadily.", active("vibrate")),
      observation("next-week time jump", "The following week they met on the platform.", stopped),
    ],
  },
  {
    label: "the reading room",
    paragraphs: [
      observation("quoted time marker", "“Hours later,” she read aloud. They shared a tender kiss.", active()),
      observation("quoted rest", "“They fell asleep,” he read from the book. They shared an affectionate embrace.", active()),
      observation("reported coordination", "She said that the toy vibrated and the toy flexed. They shared a tender kiss.", active()),
      observation("reported overlap", "He whispered that the toy pulsed while the device rotated. They shared a tender kiss.", active()),
      observation("affirmative movement after unrelated dialogue", "“Wait for the kettle,” she said. They shared a tender kiss. The toy buzzed and flexed.", active("vibrate", "fingering")),
      observation("grounded stop", "The toy went still.", stopped),
      observation("new afternoon", "The next afternoon they turned on the kettle.", stopped),
    ],
  },
  {
    label: "the house with the blue windows",
    paragraphs: [
      observation("vibration from a named competing source", "They shared a tender kiss. The vibration continued from her phone.", active()),
      observation("rotation from a named competing source", "Their affectionate embrace continued. The rotation continued in the ceiling fan.", active()),
      observation("a toy near a window", "They shared a tender kiss. The toy rotated near the window.", active("rotate")),
      observation("competing movement during a room detail", "The vibration continued from a phone.", active("rotate")),
      observation("grounded short bursts", "They shared a tender kiss. The toy vibrated in short bursts.", active("vibrate")),
      observation("a stop followed by a lamp pulse", "The vibration stopped. The light pulsed.", stopped),
      observation("intended movement and present contact", "She intended to watch the toy rotate. They shared a tender kiss.", active()),
      observation("affirmative sequential movement", "They shared a tender kiss. The toy vibrated, then rotated.", active("rotate")),
    ],
  },
  {
    label: "the apartment above the orchestra",
    paragraphs: [
      observation("almost contact", "Mara nearly kissed him tenderly, but the lift arrived.", still),
      observation("considered contact", "A stranger considered a tender kiss while the orchestra played.", still),
      observation("a named actor begins motion", "They shared a tender kiss. The toy buzzed near the lamp.", active("vibrate")),
      observation("a stronger crest with overlapping movements", "Their passionate, tender kiss and romantic embrace expressed affection. The toy vibrated in short bursts while her fingers flexed.", active("vibrate", "fingering")),
      observation("recovery continues both movements", "They slowed and relaxed.", active("vibrate", "fingering")),
      observation("following-evening time jump", "The following evening they opened the windows.", stopped),
      observation("new overlap after the boundary", "They shared a tender kiss. The toy buzzed and oscillated.", active("vibrate", "oscillate")),
    ],
  },
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
