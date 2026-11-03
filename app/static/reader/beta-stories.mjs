/** Original, non-explicit, controlled reading fixtures. Levels are authored test values, not an algorithm result. */
const story = (id, title, description, paragraphs, corrections) => Object.freeze({
  betaId: id, title, description, text: paragraphs.join("\n\n"), corrections: Object.freeze(corrections), controlled: true,
});

export const CONTROLLED_BETA_STORIES = Object.freeze([
  story("evening-train-v1", "The evening train", "Compare a steady background with changing story levels.", [
    "The last train stood beside the platform. Mara found a quiet carriage, set her book on the table and watched the rain gather on the glass. The journey had not begun.",
    "A familiar voice called her name from the doorway. Alex held up the scarf she had left behind. She smiled, and the space opposite her suddenly seemed less empty.",
    "The doors closed and the carriage began to move. They talked as the lights of the station slipped away, each new turn of the conversation bringing them a little closer.",
    "The train hurried into open country. A flash of lightning lit the window, the carriage rocked, and for a breath neither of them remembered what they had meant to say.",
    "Then the rhythm settled. Alex's hand rested beside hers on the table. There was no need to fill every quiet moment, and Mara let the silence last.",
    "Their stop appeared through the rain. They stepped onto the platform together, still talking, with the scarf looped over Mara's arm and an unhurried evening ahead.",
  ], [0, 1, 2, 4, 2, 0]),
  story("rain-at-window-v1", "Rain at the window", "Try Hold, Ease off and a gradual return to the story.", [
    "The apartment was quiet except for rain against the window. A lamp lit the corner of the sofa, and a half-finished book waited beneath it.",
    "Sam arrived carrying two warm mugs. They set them down without turning on the overhead light and sat close enough that the blanket could cover them both.",
    "A favorite song came from the room next door. They laughed at the same remembered line, then grew quiet again, listening to its familiar rise and fall.",
    "The rain became a sudden rush. The windows reflected the room back at them, bright and close, while the rest of the city seemed to disappear.",
    "Sam reached for a mug and the moment softened. They returned to the book, sharing a page and taking their time over the words.",
    "By the time the rain eased, neither had moved to turn on another light. The evening had found its own pace, and they were content to leave it there.",
  ], [0, 1, 3, 5, 1, 0]),
]);

export function controlledStory(id) { return CONTROLLED_BETA_STORIES.find(value => value.betaId === id) || null; }
