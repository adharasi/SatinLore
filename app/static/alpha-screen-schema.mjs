import {MOVEMENT_IDS, channelLabel} from "./devices/toy-profiles.mjs";

export const ALPHA_SCREEN_ITEM_LIMIT = 60;
export const ALPHA_SCREEN_STAGES = Object.freeze(["connect", "verify", "controls", "feedback"]);
export const ALPHA_SCREEN_STATES = Object.freeze(["plain", "disabled", "checked", "masked"]);

const movementLabels = Object.fromEntries(MOVEMENT_IDS.flatMap(channel => {
  const label = channelLabel(channel), action = label.toLowerCase();
  return [
    [`verify-${channel}`, `Test ${action}`],
    [`check-${channel}`, `${label} and stop confirmed`],
    [`${channel}-toggle`, `Use ${action}`],
    [`${channel}-level`, `${label} level`],
    [`${channel}-maximum`, `${label} maximum`],
    [`${channel}-minimum`, `${label} minimum`],
    [`${channel}-recovery`, `${label} ease-off level`],
    [`${channel}-rhythm`, `${label} rhythm`],
    [`${channel}-range`, `Enable ${action} range`],
  ];
}));
const preferredMaximumLabels = {
  vibrationMaximum: "Preferred vibration maximum", flexingMaximum: "Preferred flexing maximum",
  rotationMaximum: "Preferred rotation maximum", thrustingMaximum: "Preferred thrusting maximum",
  oscillationMaximum: "Preferred oscillation maximum", pumpingMaximum: "Preferred pumping maximum",
  suctionMaximum: "Preferred suction maximum",
};
export const ALPHA_SCREEN_MAXIMUM_FIELDS = Object.freeze(Object.keys(preferredMaximumLabels));

export const ALPHA_SCREEN_LABELS = Object.freeze({
  theme: "Dark mode", title: "Study heading", intro: "Page instructions", progress: "Study steps",
  collection: "Data collection", device: "Selected device", badge: "Connection status", status: "Device message",
  instructions: "Pairing instructions", connect: "Connect", refresh: "Refresh device list",
  qr: "Private pairing code", picker: "Choose a device", select: "Use this device",
  verify: "Check each movement",
  continue: "Continue to controls", disconnect: "Disconnect", guide: "What to try",
  ...movementLabels,
  start: "Start", hold: "Hold", ease: "Ease off", resume: "Resume levels", back: "Back to checks",
  "mark-good": "Good moment", "mark-tooMuch": "Too much", "mark-change": "Wanted a change",
  peak: "Mark a peak", stop: "Stop", finish: "Finish & stop",
  minimum: "Continuous stimulation", preferredMovement: "Preferred movement",
  ...preferredMaximumLabels,
  enjoyment: "Enjoyment", comfort: "Comfort", connectionEase: "Connection ease", easeOfUse: "Controls ease",
  bestMoment: "Best moment", setupFeedback: "Setup feedback", improvements: "Improvements",
  overallNotes: "Other notes", save: "Save feedback", home: "Back to study home",
  moments: "Marked moments", time: "Note timestamp", annotation: "Timestamped note", "save-note": "Save note",
});
