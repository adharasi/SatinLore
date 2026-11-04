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

test("one brief contextual paragraph holds the preceding level and rhythm within a matching scene", () => {
  const rows = sceneRows("A tender and romantic kiss expressed affection.",
    "Rain brushed against the window.", "A gentle romantic embrace expressed affection.");
  const result = groupScenes(rows);
  assert.deepEqual(result.map(paragraph => paragraph.sceneId), [1, 1, 1]);
  assert.equal(result[1].level, result[0].level);
  assert.equal(result[1].rhythm, result[0].rhythm);
  assert.equal(rows[1].suggestedLevel, 0);
  assert.equal(Object.hasOwn(result[1], "text"), false);
});

test("low scene continuity remains steady and several missing matches stay quiet", () => {
  const cue = "A tender kiss.";
  const bridge = "Rain brushed against the window.";
  assert.deepEqual(groupScenes(sceneRows(cue, bridge, cue)).map(p => [p.level, p.rhythm]),
    [[1, "steady"], [1, "steady"], [1, "steady"]]);
  assert.deepEqual(groupScenes(sceneRows(cue, bridge, bridge, cue)).map(p => p.sceneId), [1, null, null, 2]);
  assert.deepEqual(groupScenes(sceneRows(bridge, cue, bridge)).map(p => p.level), [0, 1, 0]);
});

test("explicit breaks, uncertain wording and deliberate zero prevent scene continuity", () => {
  const cue = "A tender kiss.";
  for (const boundary of ["* * *", "Chapter IV — Morning", "They needed a break.",
    "The next morning brought rain.", "There was no tender kiss.", "A dictionary defined a romantic kiss."]) {
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

test("sensitive wording receives an advisory zero and no story text in the result", () => {
  const sample = "A forced romantic embrace and a tender kiss.";
  const result = groupScenes(sceneRows("A tender kiss.", sample, "A tender kiss."));
  assert.equal(result[1].level, 0);
  assert.equal(result[1].quiet, true);
  assert.ok(result[1].advisory);
  assert.equal(JSON.stringify(result).includes(sample), false);
});
