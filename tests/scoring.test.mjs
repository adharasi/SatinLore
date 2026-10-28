import test from "node:test";
import assert from "node:assert/strict";
import {scoreParagraph, SUGGESTION_LEVELS} from "../app/static/reader/scoring.mjs";

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
