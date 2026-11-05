import test from "node:test";
import assert from "node:assert/strict";
import {groupScenes, scoreParagraph, SUGGESTION_LEVELS} from "../app/static/reader/scoring.mjs";

test("neutral and unmatched text defaults to zero, including isolated or repeated cues", () => {
  for (const text of ["", "An ordinary walk through the park.", "Un après-midi tranquille.",
    "A kiss.", "Kiss kiss kiss kiss.", "A passion for gardening and tender carrots."]) {
    assert.equal(scoreParagraph(text).level, 0);
  }
  assert.throws(() => scoreParagraph(null), TypeError);
});

test("five suggestion bands are deterministic and repeated words cannot inflate intensity", () => {
  const samples = ["A quiet afternoon.", "A tender kiss.", "A tender kiss expressed affection.",
    "A romantic and tender kiss expressed affection.", "A romantic embrace, a tender kiss and affection."];
  assert.deepEqual(samples.map(text => scoreParagraph(text).band), [0, 1, 2, 3, 4]);
  assert.deepEqual(samples.map(text => scoreParagraph(text).level), SUGGESTION_LEVELS);
  assert.deepEqual(scoreParagraph("A TENDER KISS."), scoreParagraph("A tender kiss."));
  assert.equal(scoreParagraph("Tender tender kiss kiss kiss.").level, 1);
  assert.equal(scoreParagraph(samples.at(-1).repeat(50)).level, 5);
});

test("negated and metalinguistic contexts remain zero despite matching vocabulary", () => {
  for (const text of ["There was no tender kiss.", "They didn't share a romantic embrace.",
    "They don’t want a tender kiss.", "The phrase 'a tender kiss' appeared in the dictionary.",
    "The review mentioned a romantic embrace and affection.", "They stopped before a tender kiss."]) {
    assert.equal(scoreParagraph(text).level, 0);
  }
});

test("cue matching uses whole words and canonical concepts", () => {
  assert.equal(scoreParagraph("A tender airkiss.").level, 0);
  assert.equal(scoreParagraph("They kissed and embraced affectionately.").band, 2);
  assert.equal(scoreParagraph("A kiss, kisses, kissed, kissing: tender.").band, 1);
});

function sceneRows(...paragraphs) {
  return paragraphs.map(paragraph => {
    const {text, override = null} = typeof paragraph === "string" ? {text: paragraph} : paragraph;
    const {band, level, reason} = scoreParagraph(text);
    return {text, override, band, suggestedLevel: level, reason};
  });
}

test("one brief contextual paragraph eases down without breaking the matching scene", () => {
  const rows = sceneRows("A tender and romantic kiss expressed affection.",
    "Rain brushed against the window.", "A gentle, tender romantic embrace expressed affection.");
  const result = groupScenes(rows);
  assert.deepEqual(result.map(paragraph => paragraph.sceneId), [1, 1, 1]);
  assert.deepEqual(result.map(paragraph => paragraph.level), [3, 2, 3]);
  assert.equal(result[1].rhythm, "gentle");
  assert.equal(rows[1].suggestedLevel, 0);
  assert.equal(Object.hasOwn(result[1], "text"), false);
});

test("low scene continuity remains steady and several missing matches stay quiet", () => {
  const cue = "A tender kiss.";
  const bridge = "Rain brushed against the window.";
  assert.deepEqual(groupScenes(sceneRows(cue, bridge, cue)).map(p => [p.level, p.rhythm]),
    [[1, "steady"], [1, "steady"], [1, "steady"]]);
  assert.deepEqual(groupScenes(sceneRows(cue, bridge, bridge, cue)).map(p => p.sceneId), [1, 1, 1, 1]);
  assert.deepEqual(groupScenes(sceneRows(cue, bridge, bridge, bridge, cue)).map(p => p.sceneId), [1, null, null, null, 2]);
  assert.deepEqual(groupScenes(sceneRows(bridge, cue, bridge)).map(p => p.level), [0, 1, 0]);
});

test("explicit breaks, uncertain wording and deliberate zero prevent scene continuity", () => {
  const cue = "A tender kiss.";
  for (const boundary of ["* * *", "Chapter IV — Morning", "They needed a break.",
    "The next morning brought rain.", "There was no tender kiss.", "A dictionary defined a romantic kiss.",
    "They pulled away.", "They stopped."]) {
    const result = groupScenes(sceneRows(cue, boundary, cue));
    assert.deepEqual(result.map(p => p.sceneId), [1, null, 2]);
    assert.equal(result[1].level, 0);
    assert.equal(result[1].quiet, true);
  }
  const result = groupScenes(sceneRows({text: cue, override: 0}, "Rain brushed the window.", cue));
  assert.deepEqual(result.map(p => p.sceneId), [null, null, 1]);
  assert.equal(result[0].level, 1, "Manual override remains separate from the suggestion.");
});

test("an isolated contact cue or substantial neutral passage cannot borrow movement", () => {
  const cue = "A tender kiss.";
  for (const uncertain of ["A kiss.", "Rain brushed the window. ".repeat(12)]) {
    const result = groupScenes(sceneRows(cue, uncertain, cue));
    assert.deepEqual(result.map(p => p.level), [1, 0, 1]);
  }
});

test("pace and stronger cue matches produce distinct bounded rhythm suggestions", () => {
  const result = groupScenes(sceneRows("A tender kiss.", "A slow, tender kiss expressed affection.",
    "A quick romantic and tender kiss expressed affection.", "A romantic embrace, a tender kiss and affection."));
  assert.deepEqual(result.map(p => p.rhythm), ["steady", "gentle", "dynamic", "dynamic"]);
  assert.deepEqual(result.map(p => p.level), [1, 2, 3, 5]);
  assert.ok(result[3].advisory);
});

test("matched scenes expose only distinct, explicitly described movements", () => {
  const cue = "A tender kiss.";
  const descriptions = "The device vibrated, flexed, rotated, thrust, and oscillated together.";
  const result = groupScenes(sceneRows(`${cue} ${descriptions}`, cue, `${cue} A microvibration.`));
  assert.deepEqual(result.map(p => p.movements), [
    ["vibrate", "fingering", "rotate", "thrusting", "oscillate"], [], [],
  ]);
  assert.deepEqual(result.map(p => p.level), [1, 1, 1]);
  assert.deepEqual(groupScenes(sceneRows("A passion for rotating models.", descriptions)).map(p => [p.level, p.movements]),
    [[0, []], [0, []]]);
});

test("concurrent, sequential, negated, and reported motion yield distinct choices", () => {
  const result = groupScenes(sceneRows(
    "They shared a tender kiss. The device vibrated and flexed together.",
    "They shared a tender kiss. The vibration continued as her fingers flexed.",
    "They shared a tender kiss. While the vibration continued, her fingers flexed.",
    "They shared a tender kiss. The device vibrated, then flexed.",
    "They shared a tender kiss. The device vibrated. Her fingers flexed.",
    "They shared a tender kiss. Her fingers flexed after the vibration stopped.",
    "They shared a tender kiss. The device vibrated but did not flex.",
    "They shared a tender kiss. The device vibrated without flexing.",
    "They shared a tender kiss. The device vibrated and did not flex.",
    "They shared a tender kiss. ‘The device vibrated and flexed,’ she read.",
    'They shared a tender kiss. "The device vibrated and flexed," she read.',
    "They shared a tender kiss. The fan vibrated and her fingers flexed."
  ));
  assert.deepEqual(result.map(p => p.movements), [
    ["vibrate", "fingering"], ["vibrate", "fingering"], ["vibrate", "fingering"],
    ["fingering"], ["fingering"], ["fingering"], ["vibrate"], ["vibrate"], ["vibrate"], [], [], ["fingering"],
  ]);
});

test("gentle manner must describe the contact, and reported dialogue cannot anchor a scene", () => {
  assert.equal(scoreParagraph("They kissed gently.").level, 1);
  assert.equal(scoreParagraph("He kissed her gently.").level, 1);
  assert.equal(scoreParagraph("They kissed each other softly.").level, 1);
  assert.equal(scoreParagraph("They shared a gentle kiss.").level, 1);
  assert.equal(scoreParagraph("They kissed while the rain fell softly.").level, 0);
  assert.equal(scoreParagraph("They shared a tender kiss without consent.").level, 0);
  assert.equal(scoreParagraph("“They shared a tender kiss,” she read from the script.").level, 0);
  assert.equal(scoreParagraph("“Wait for the kettle,” she whispered. Then they shared a tender kiss.").level, 1);
});

test("indirect reports and unrealised plans stay quiet, while later actions can start a beat", () => {
  const result = groupScenes(sceneRows(
    "She tells him that the toy vibrated steadily as they shared a tender kiss.",
    "They were going to share a tender kiss, but the phone rang.",
    "They were going to leave. Then they shared a tender kiss. The device vibrated steadily.",
  ));
  assert.deepEqual(result.map(({phase, level, movements}) => ({phase, level, movements})), [
    {phase: "quiet", level: 0, movements: []}, {phase: "quiet", level: 0, movements: []},
    {phase: "build", level: 1, movements: ["vibrate"]},
  ]);
  assert.ok(result.slice(0, 2).every(section => section.quiet && section.cloudExcluded));
});

test("a short contact or named continuation carries only within an established scene", () => {
  const pair = "They shared a tender kiss. The device vibrated and flexed together.";
  const result = groupScenes(sceneRows("They kissed.", pair, "They kissed.",
    pair, "Vibration and flexing continued.", "He pulled away from her.", "The vibration continued."));
  assert.deepEqual(result.map(p => p.level), [0, 1, 1, 1, 1, 0, 0]);
  assert.deepEqual(result.map(p => p.movements), [
    [], ["vibrate", "fingering"], ["vibrate", "fingering"], ["vibrate", "fingering"], ["vibrate", "fingering"], [], [],
  ]);
  assert.equal(result[5].quiet, true);
});

test("named recovery eases the relevant movement within a scene", () => {
  const result = groupScenes(sceneRows("They shared a tender kiss. The device vibrated and flexed together.",
    "The flexing slowed.", "They set the device down."));
  assert.deepEqual(result.map(p => p.phase), ["build", "recover", "quiet"]);
  assert.deepEqual(result.map(p => p.movements), [["vibrate", "fingering"], ["fingering"], []]);
});

test("an explicit movement stop clears earlier output, while another current action can still qualify", () => {
  const result = groupScenes(sceneRows(
    "They shared a tender kiss. The device vibrated and flexed. The vibration stopped.",
    "They shared a tender kiss. The vibration stopped while her fingers kept flexing.",
    "They shared a tender kiss. The device stopped vibrating.",
    "They shared a tender kiss. The device moved side to side."
  ));
  assert.deepEqual(result.map(p => [p.level, p.quiet, p.movements]), [
    [0, true, []], [1, false, ["fingering"]], [0, true, []], [1, false, ["oscillate"]],
  ]);
});

test("pulse and buzz need a grounded device, including immediately referenced motion", () => {
  const cue = "They shared a tender kiss.";
  const descriptions = [
    "She held the device. It pulsed gently and flexed.",
    "The device rested against her palm. It buzzed while its arm rotated.",
    "The device sat beside the phone. It pulsed while her fingers flexed.",
    "The toy manual lay on the nightstand. It pulsed and flexed.",
    "The toy’s battery was flat. It pulsed and flexed.",
    "The toy lay across a brass metronome. It pulsed and flexed.",
    "Her heart pulsed as the toy rotated.",
    "The device oscillated as the light pulsed.",
  ];
  const result = groupScenes(sceneRows(...descriptions.map(text => `${cue} ${text}`)));
  assert.deepEqual(result.map(row => row.movements), [
    ["vibrate", "fingering"], ["vibrate", "rotate"], ["fingering"], [], [], [], ["rotate"], ["oscillate"],
  ]);
});

test("movement references span at most one anchored paragraph and stop at reported motion", () => {
  const anchor = "They shared a tender kiss. The toy flexed.";
  const result = groupScenes(sceneRows(anchor, "It buzzed gently.", "It pulsed gently.",
    anchor, "Last summer, the device vibrated and flexed on every test.", anchor,
    "“The toy vibrated and flexed,” she read aloud.", anchor,
    "The vibration continued. “The toy flexed,” she read aloud."));
  assert.deepEqual(result.map(row => row.movements), [
    ["fingering"], ["vibrate"], [], ["fingering"], [], ["fingering"], [], ["fingering"], ["vibrate"],
  ]);
  assert.deepEqual(result.map(row => row.level), [1, 1, 0, 1, 0, 1, 0, 1, 1]);
});

test("a stopped channel stays excluded through the next scene detail and needs a fresh cue", () => {
  const result = groupScenes(sceneRows(
    "They shared a tender kiss. The toy buzzed as it flexed.",
    "The toy stopped buzzing while it kept flexing.",
    "A floorboard creaked in the hall.",
    "They kissed gently. The toy buzzed as its arm flexed.",
    "They shared a tender kiss. The toy flexed, then it stopped flexing. Its light pulsed.",
    "They shared a tender kiss. The toy flexed. Then it stopped flexing.",
    "They shared a tender kiss. The toy vibrated and flexed. The vibration and flexing stopped.",
    "The device went still. Its indicator light pulsed."
  ));
  assert.deepEqual(result.map(row => row.movements), [
    ["vibrate", "fingering"], ["fingering"], ["fingering"], ["vibrate", "fingering"], [], [], [], [],
  ]);
  assert.deepEqual(result.map(row => row.endedMovements), [
    [], ["vibrate"], ["vibrate"], [], ["fingering"], ["fingering"], ["vibrate", "fingering"],
    ["vibrate", "fingering", "rotate", "thrusting", "oscillate"],
  ]);
  assert.deepEqual(result.map(row => row.quiet), [false, false, false, false, true, true, true, true]);
});

test("short context retains a scene's movement, while quiet boundaries clear it", () => {
  const flex = "A tender kiss. The motion flexed.";
  const vibration = "A tender kiss. The soft vibration continued.";
  const result = groupScenes(sceneRows(flex, "Rain brushed against the window.", vibration,
    "They needed a break. A tender kiss. The motion flexed.", vibration));
  assert.deepEqual(result.map(p => p.movements), [["fingering"], ["fingering"], ["vibrate"], [], ["vibrate"]]);
  assert.notEqual(result[0].movements, result[1].movements);
  assert.deepEqual(result.map(p => p.sceneId), [1, 1, 1, null, 2]);
  assert.equal(result[3].quiet, true);
});

test("sensitive wording receives an advisory zero and no story text in the result", () => {
  const sample = "A forced romantic embrace and a tender kiss. A vibration.";
  const result = groupScenes(sceneRows("A tender kiss.", sample, "A tender kiss."));
  assert.equal(result[1].level, 0);
  assert.equal(result[1].quiet, true);
  assert.deepEqual(result[1].movements, []);
  assert.ok(result[1].advisory);
  assert.equal(JSON.stringify(result).includes(sample), false);
});


test("only the relevant clause contributes contact, context, and movement", () => {
  const paragraphs = groupScenes(sceneRows(
    "She imagined a tender kiss.",
    "He didn't want to leave. They shared a tender kiss.",
    "The fan rotated as they shared a tender kiss.",
    "They shared a tender kiss as the motion flexed.",
    "He passionately hated the commute. They kissed.",
    "They remembered a romantic embrace, but they shared a tender kiss.",
    "They shared a tender kiss. She asked him to stop."
  ));
  assert.deepEqual(paragraphs.map(p => p.level), [0, 1, 1, 1, 0, 1, 0]);
  assert.deepEqual(paragraphs.map(p => p.movements), [[], [], [], ["fingering"], [], [], []]);
  assert.equal(paragraphs[0].quiet, true);
  assert.equal(paragraphs[6].quiet, true);
});

test("a scene can build, sustain, peak, and recover before becoming quiet", () => {
  const anticipation = "They drew closer. She held her breath.";
  const sustain = "Their slow tender kiss expressed affection.";
  const peak = "Their passionate, tender kiss and romantic embrace expressed affection.";
  const recovery = "They slowed and relaxed.";
  const result = groupScenes(sceneRows(anticipation, sustain, peak, recovery, "***", anticipation, "The lights went out."));
  assert.deepEqual(result.map(p => p.phase), ["build", "sustain", "peak", "recover", "quiet", "quiet", "quiet"]);
  assert.deepEqual(result.map(p => p.level), [1, 2, 5, 1, 0, 0, 0]);
  assert.deepEqual(result.map(p => p.sceneId), [1, 1, 1, 1, null, null, null]);
  assert.equal(result[4].quiet, true);
});

test("repetition and unrelated pacing cannot create peaks or a faster rhythm", () => {
  const dense = "Their passionate, tender kiss and romantic embrace expressed affection.";
  const result = groupScenes(sceneRows(dense, dense, dense, "The fan quickly rotated while they shared a tender romantic kiss full of affection."));
  assert.deepEqual(result.map(p => p.level), [3, 3, 3, 3]);
  assert.deepEqual(result.map(p => p.rhythm), ["steady", "steady", "steady", "steady"]);
  assert.deepEqual(result[3].movements, []);
});

test("two brief details ease down through an active scene without crossing a hard boundary", () => {
  const lead = "They shared a tender romantic kiss full of affection.";
  const result = groupScenes(sceneRows(lead, "Rain brushed the window.", "The lamps cast long shadows.", lead, "***", lead));
  assert.deepEqual(result.map(p => p.level), [3, 2, 1, 3, 0, 3]);
  assert.deepEqual(result.map(p => p.sceneId), [1, 1, 1, 1, null, 2]);
});


test("speculation extends through coordination and can end at a clear change", () => {
  assert.equal(scoreParagraph("She imagined their tender kiss and their romantic embrace lasted.").level, 0);
  assert.equal(scoreParagraph("He didn't want to leave, and they shared a tender kiss.").level, 1);
  assert.equal(scoreParagraph("She imagined a tender kiss but they shared a romantic embrace.").level, 1);
  assert.equal(scoreParagraph('She said, "A tender kiss would be nice."').level, 0);
  assert.equal(scoreParagraph("They shared a tender kiss. She asked him to stop.").level, 0);
});


test("a character moving an object and detached past action do not choose a movement", () => {
  const result = groupScenes(sceneRows("Her hand rotated the door knob as they shared a tender kiss.",
    "Her hand rotated slowly while they shared a tender kiss.",
    "Last summer they shared a tender kiss.",
    "Last summer they shared a tender kiss. Today they kissed tenderly."));
  assert.deepEqual(result.map(p => [p.level, p.movements]), [[1, []], [1, ["rotate"]], [0, []], [1, []]]);
});

test("first-person and named-character contact anchors do not require cue adjectives", () => {
  for (const text of ["Her lips brushed mine.", "I pressed my lips to hers.", "Our mouths came together.",
    "Mara’s lips met his at the kitchen door.", "He leaned in and kissed her.", "She kissed me back."]) {
    assert.equal(scoreParagraph(text).level, 1, text);
  }
  for (const text of ["He leaned in and kissed her forehead.", "He leaned in and kissed her on the cheek.",
    "I pressed my lips to the rim of the glass.", "Her lips touched the edge of her cup.", "She imagined his mouth found hers.",
    "He left before their lips met.", "He leaned in and kissed his daughter goodnight.",
    "‘Their lips met,’ he read from the script.", "I didn't press my lips to hers."]) {
    assert.equal(scoreParagraph(text).level, 0, text);
  }
});

test("unadorned romantic prose builds, continues through a room detail, rises and eases off", () => {
  const result = groupScenes(sceneRows(
    "At the kitchen doorway, Mara looked back.",
    "She slipped her arm through his and drew him close.",
    "He rested a hand at her waist.",
    "Their lips met for a long moment.",
    "She kissed him again, then took his hand.",
    "The window was still open. The rain had softened to a faint ticking on the ledge.",
    "His arms tightened around her as she held him close.",
    "Their kiss deepened.",
    "Finally they eased apart.",
    "The following morning, there was a queue outside the bakery."
  ));
  assert.deepEqual(result.map(({phase, level}) => [phase, level]), [
    ["quiet", 0], ["build", 1], ["build", 1], ["sustain", 1], ["sustain", 1], ["sustain", 1],
    ["sustain", 1], ["sustain", 2], ["recover", 1], ["quiet", 0],
  ]);
  assert.deepEqual(result.map(({sceneId}) => sceneId), [null, 1, 1, 1, 1, 1, 1, 1, 1, null]);
  assert.ok(result.every(({movements}) => movements.length === 0));
});

test("ongoing contact carries selected movements and a fresh rhythm stays local to the current scene", () => {
  const result = groupScenes(sceneRows(
    "Their lips met. The device vibrated and flexed together.",
    "His arms were still around her when she glanced over at the window, where the condensation was slowly trickling down and gathering in a small puddle on the sill.",
    "Her fingers flexed in short bursts.",
    "They eased apart.",
    "Chapter II",
    "Her fingers flexed in short bursts.",
    "His arms were still around her."
  ));
  assert.deepEqual(result.map(({phase, shape, movements}) => [phase, shape, movements]), [
    ["build", "unspecified", ["vibrate", "fingering"]], ["sustain", "unspecified", ["vibrate", "fingering"]],
    ["sustain", "accented", ["fingering"]], ["recover", "unspecified", ["fingering"]],
    ["quiet", "unspecified", []], ["quiet", "unspecified", []], ["quiet", "unspecified", []],
  ]);
});

test("an established embrace carries a bounded dialogue exchange but ends at departure or unrelated action", () => {
  const hold = "I laid my head on her shoulder. She clasped me close.";
  const dialogue = ["“Are you warm enough?” she whispered.", "“I am now,” I answered."];
  const result = groupScenes(sceneRows(
    hold, ...dialogue, "I moved my arms around her neck.", ...dialogue,
    "“I must go.”", "“I'll see you again.”",
    hold, ...dialogue, "I placed my hands on the glass.", ...dialogue,
    hold, ...dialogue, "“Will you be at the inn?”", "“In an hour.”"
  ));
  assert.deepEqual(result.map(({level}) => level), [1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0]);
  assert.equal(scoreParagraph("She laid her head on her sister's shoulder. Her sister held her close.").level, 0);
  assert.equal(scoreParagraph("He held her close as he opened the medicine cabinet.").level, 0);
});

test("gentle first contact stays in the build and a described increase raises the level", () => {
  const result = groupScenes(sceneRows("I leaned in. My breath caught.", "We kissed softly.", "Our tender kiss deepened."));
  assert.deepEqual(result.map(({phase, level}) => [phase, level]), [["build", 1], ["build", 1], ["sustain", 2]]);
});

test("web paste spacing is normalized for scoring and long ambient references stay quiet", () => {
  assert.equal(scoreParagraph("Their\u00a0lips\tmet.").level, 1);
  const result = groupScenes(sceneRows(`There was not a phone${" ".repeat(480_000)}buzzing.`, "phone vibration ".repeat(31_000)));
  assert.deepEqual(result.map(({level, movements}) => [level, movements]), [[0, []], [0, []]]);
});

test("a plain narrated action can borrow nearby personal affection across a clause or sentence", () => {
  for (const text of ["I felt a rush of tenderness for him. I kissed him.",
    "They embraced. There was affection in their eyes.",
    "He kissed her, and she looked at him with tenderness.",
    "Her smile softened with affection. She put her arms around him."]) {
    assert.equal(scoreParagraph(text).level, 1, text);
    assert.deepEqual(groupScenes(sceneRows(text))[0].movements, []);
  }
  for (const text of ["We kissed.", "Her voice was full of affection. She embraced her new role.",
    "He passionately hated the commute. They kissed.", "There was affection in his eyes. He kissed her forehead.",
    "There was affection in his eyes. I read that they kissed.", "He thought they kissed. There was affection in his eyes.",
    "They might have kissed. Her eyes softened with affection.", "Her eyes softened with affection. Then she sat down. They kissed.",
    "Her eyes softened with affection, but they kissed.", "Her eyes softened with affection. ‘They kissed,’ she read.",
    "He kissed her. She imagined there was tenderness in his eyes."]) {
    assert.equal(scoreParagraph(text).level, 0, text);
  }
});

test("paired present affection and directed gestures recover a low local cue without selecting a movement", () => {
  const examples = [
    "He reached for her hand. He was falling for her.",
    "Mara was attracted to him, and held his gaze.",
    "She held him close. He loved it when she held him.",
    "“You look lovely,” she said. He blushed.",
    "A twenty-one-year-old woman took his hand. She felt attracted to him.",
  ];
  for (const text of examples) {
    const [result] = groupScenes(sceneRows(text));
    assert.deepEqual([result.level, result.phase, result.currentCue, result.movements], [1, "build", true, []], text);
  }
  const [compliment, response] = groupScenes(sceneRows("“You look lovely,” she said.", "His cheeks turned pink."));
  assert.deepEqual([compliment, response].map(p => [p.level, p.phase, p.currentCue, p.sceneId]),
    [[1, "build", true, 1], [1, "sustain", true, 1]]);
});

test("weak, uncertain and non-present signals cannot recover an affectionate cue", () => {
  const examples = [
    "She smiled at him. They had both passed the exam.",
    "Their eyes met. Her breath caught at the noise outside.",
    "He held her hand while the medic worked.",
    "He was falling for her. The dishes were on the table.",
    "He held her hand. He was not attracted to her.",
    "I was in love with him, and I smiled at her.",
    "He was attracted to her and held his hand over the flame.",
    "If he held her hand, he might fall in love with her.",
    "Years ago, he held her hand. He was falling for her.",
    "She pictured how he held her hand. She was falling for him.",
    "Mara said she was falling for him. She reached for his hand.",
    "“You look lovely,” he read from the script. She blushed.",
    "“You look lovely,” his sister said. He blushed.",
    "“You look lovely,” she said. She blushed.",
    "“You look lovely,” she said. He blushed after dropping the baton.",
    "He held her hand. He was falling for her. She asked him to stop.",
  ];
  for (const text of examples) {
    const [result] = groupScenes(sceneRows(text));
    assert.equal(result.level, 0, text);
    assert.equal(result.currentCue, undefined, text);
  }
  const interrupted = groupScenes(sceneRows("“You look lovely,” she said.", "***", "He blushed."));
  assert.deepEqual(interrupted.map(p => p.level), [0, 0, 0]);
  const corrected = groupScenes(sceneRows({text: "“You look lovely,” she said.", override: 0}, "He blushed."));
  assert.deepEqual(corrected.map(p => p.level), [0, 0]);
  const unrelated = groupScenes(sceneRows("“I love you,” she said.", "The witness blushed as the courtroom quieted.",
    "“You look lovely,” he said.", "She blushed with embarrassment after dropping the baton.",
    "“You look lovely,” she said.", "She blushed."));
  assert.deepEqual(unrelated.map(p => p.level), [0, 0, 0, 0, 0, 0]);
  const [sensitive] = groupScenes(sceneRows("A fifteen-year-old took his hand. She was falling for him."));
  assert.deepEqual([sensitive.level, sensitive.quiet, sensitive.cloudExcluded, sensitive.currentCue], [0, true, true, undefined]);
});

test("figurative and modal contact cannot start an automatic cue", () => {
  const figurative = "She sent him tender words and kisses across the distance.";
  const modal = "She would draw him closer in her trembling embrace, and her lips in soft kisses brushed his cheek.";
  const enacted = "She would send a message. Then she kissed him gently.";
  for (const text of [figurative, "He blew her a tender kiss from the platform.", modal, modal.replace("closer in", "closer\nin")]) {
    assert.equal(scoreParagraph(text).level, 0);
    assert.equal(groupScenes(sceneRows(text))[0].level, 0);
  }
  assert.equal(groupScenes(sceneRows(enacted))[0].level, 1);
});

test("a recalled scene blocks fresh relational cues until an explicit return or scene break", () => {
  const entry = "She could still remember that evening.";
  const detail = "The lanterns were glowing beside the gate.";
  const contact = "Mara was attracted to him, and held his gaze.";
  for (const reset of ["Back in the present, she unfolded the note.", "***"]) {
    const result = groupScenes(sceneRows(entry, detail, contact, reset, contact));
    assert.deepEqual(result.map(p => p.level), [0, 0, 0, 0, 1]);
    assert.equal(result[2].currentCue, undefined);
    assert.equal(result[4].currentCue, true);
  }
  const result = groupScenes(sceneRows("She remembered to lock the door.", detail, contact));
  assert.equal(result[2].level, 1);
});

test("grounded existing contact is marked for contrast without changing its level or movements", () => {
  const contact = "They kissed gently.";
  const [described] = groupScenes(sceneRows(contact));
  assert.deepEqual([described.level, described.currentCue, described.movements], [1, true, []]);
  const [vague] = groupScenes(sceneRows("A tender kiss."));
  assert.deepEqual([vague.level, vague.currentCue, vague.movements], [1, undefined, []]);
  const [_, continuing] = groupScenes(sceneRows(`${contact} The device flexed.`, "He kissed her again tenderly."));
  assert.deepEqual([continuing.level, continuing.currentCue, continuing.movements], [1, true, ["fingering"]]);
});

test("a typographic single-quoted refusal takes priority over contact", () => {
  const text = "‘No.’ She kissed him gently.";
  assert.equal(groupScenes(sceneRows(text))[0].level, 0);
  const reply = "‘No, certainly not sad.’ They kissed gently.";
  assert.equal(groupScenes(sceneRows(reply))[0].level, 1);
});
