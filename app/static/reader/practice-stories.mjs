import {SETUP_STORIES} from "./setup-flow.mjs";

// Original, non-explicit stories for comparing actual analysis. The notes give
// readers a target to check without inserting overrides into the story.
const analysed = (id, title, description, paragraphs, checkpoints) => Object.freeze({
  id, title, description, text: paragraphs.join("\n\n"), checkpoints: Object.freeze(checkpoints),
});

export const ANALYSED_PRACTICE_STORIES = Object.freeze([
  analysed("after-the-screening", "After the screening", "Compare a sustained crest with Loom’s accents.", [
    "The cinema had emptied. A loose poster tapped against the lobby glass.",
    "They drew closer under the marquee. She held her breath.",
    "They shared a tender kiss beside the ticket booth. The toy vibrated steadily.",
    "Warmth filled their passionate, tender kiss and romantic embrace, a crescendo of affection. The toy vibrated in one long wave.",
    "They slowed and relaxed, listening to the rain.",
    "***",
    "The next morning they returned to collect the posters.",
  ], [
    "Sections 1–3 move from quiet to build-up and steady movement.",
    "Section 4 peaks. Compare Loom’s accents with the sustained crest Nocturne can choose.",
    "Section 5 tapers. Sections 6–7 stay quiet after the break.",
  ]),
  analysed("rooftop-greenhouse", "The rooftop greenhouse", "Compare a rolling wave, a short burst and a taper.", [
    "They shared a tender kiss by the greenhouse. The toy vibrated steadily.",
    "Their slow, tender kiss expressed affection as they shared the warmth of the greenhouse. The toy buzzed in stronger and softer pulses.",
    "Their passionate, tender kiss and romantic embrace built to a crescendo of affection. The toy vibrated in short bursts.",
    "They slowed and relaxed beneath the dark windows.",
    "***",
  ], [
    "Section 2 sustains movement. Look for a rolling wave when Nocturne selects it.",
    "Section 3 calls for accents rather than a sustained crest.",
    "Sections 4–5 ease back and then go quiet.",
  ]),
  analysed("workshop-after-hours", "The workshop after hours", "Check overlapping movements and a stop that applies to one movement only.", [
    "The fan rotated above the bench as they shared a tender kiss. The toy vibrated steadily.",
    "They shared a tender kiss. The toy vibrated while the toy flexed.",
    "They shared a tender kiss. The toy stopped vibrating while it kept flexing.",
    "They shared a tender kiss. The toy flexed steadily.",
    "***",
  ], [
    "For this story, use the Flexer simulator with both movements enabled and story movement switching on.",
    "Section 1 uses vibration. Section 2 adds flexing. Sections 3–4 continue flexing after vibration stops.",
    "Section 5 ends both movements.",
  ]),
  analysed("radio-studio", "The radio studio", "Distinguish quoted, almost and reported events from the current action.", [
    "“The toy vibrated in short bursts,” she read from the radio script.",
    "They almost shared a tender kiss, then took separate seats.",
    "They shared a tender kiss by the studio window. The toy vibrated steadily.",
    "She said that the toy rotated and the toy flexed.",
    "They shared a tender kiss. The toy vibrated steadily.",
    "They shared another tender kiss. The toy vibrated in one long wave.",
    "The following week, she came back for her umbrella.",
  ], [
    "Sections 1–2 stay quiet. The first current movement starts in section 3.",
    "Section 4 stays quiet during a reported event. Sections 5–6 resume current movement.",
    "Section 7 stays quiet after the time jump.",
  ]),
]);

export const PRACTICE_STORIES = Object.freeze([
  ...SETUP_STORIES.map(story => Object.freeze({...story, id: story.betaId})),
  ...ANALYSED_PRACTICE_STORIES,
]);
