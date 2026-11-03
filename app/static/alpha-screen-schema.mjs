export const ALPHA_SCREEN_ITEM_LIMIT = 60;
export const ALPHA_SCREEN_STAGES = Object.freeze(["connect", "verify", "controls", "feedback"]);
export const ALPHA_SCREEN_STATES = Object.freeze(["plain", "disabled", "checked", "masked"]);

export const ALPHA_SCREEN_LABELS = Object.freeze({
  theme: "Dark mode", title: "Study heading", intro: "Page instructions", progress: "Study steps",
  collection: "Data collection", device: "Flexer", badge: "Connection status", status: "Device message",
  instructions: "Pairing instructions", connect: "Connect", refresh: "Refresh device list",
  qr: "Private pairing code", picker: "Choose a device", select: "Use this Flexer",
  verify: "Check each movement", "verify-vibrate": "Test vibration", "verify-fingering": "Test flexing",
  "check-vibrate": "Vibration and stop confirmed", "check-fingering": "Flexing and stop confirmed",
  continue: "Continue to controls", disconnect: "Disconnect", guide: "What to try",
  "vibrate-toggle": "Use vibration", "fingering-toggle": "Use flexing",
  "vibrate-level": "Vibration level", "fingering-level": "Flexing level",
  "vibrate-maximum": "Vibration maximum", "fingering-maximum": "Flexing maximum",
  "vibrate-minimum": "Vibration minimum", "fingering-minimum": "Flexing minimum",
  "vibrate-recovery": "Vibration ease-off level", "fingering-recovery": "Flexing ease-off level",
  "vibrate-rhythm": "Vibration rhythm", "fingering-rhythm": "Flexing rhythm",
  "vibrate-range": "Enable vibration range", "fingering-range": "Enable flexing range",
  start: "Start", hold: "Hold", ease: "Ease off", resume: "Resume levels", back: "Back to checks",
  "mark-good": "Good moment", "mark-tooMuch": "Too much", "mark-change": "Wanted a change",
  peak: "Mark a peak", stop: "Stop", finish: "Finish & stop",
  minimum: "Continuous stimulation", preferredMovement: "Preferred movement",
  vibrationMaximum: "Preferred vibration maximum", flexingMaximum: "Preferred flexing maximum",
  enjoyment: "Enjoyment", comfort: "Comfort", connectionEase: "Connection ease", easeOfUse: "Controls ease",
  bestMoment: "Best moment", setupFeedback: "Setup feedback", improvements: "Improvements",
  overallNotes: "Other notes", save: "Save feedback", home: "Back to study home",
  moments: "Marked moments", time: "Note timestamp", annotation: "Timestamped note", "save-note": "Save note",
});
