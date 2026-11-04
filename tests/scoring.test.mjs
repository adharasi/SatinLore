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
  const descriptions = ["The rhythm oscillated and moved side to side.", "The motion rotated.",
    "The movement thrust repeatedly.", "The motion flexed, then flexed again.", "The vibration continued."].join(" ");
  const result = groupScenes(sceneRows(`${cue} ${descriptions}`, cue, `${cue} A microvibration.`));
  assert.deepEqual(result.map(p => p.movements), [
    ["vibrate", "fingering", "rotate", "thrusting", "oscillate"], [], [],
  ]);
  assert.deepEqual(result.map(p => p.level), [1, 1, 1]);
  assert.deepEqual(groupScenes(sceneRows("A passion for rotating models.", descriptions)).map(p => [p.level, p.movements]),
    [[0, []], [0, []]]);
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
