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
