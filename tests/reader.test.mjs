import test from "node:test";
import assert from "node:assert/strict";
import {ReaderModel, MAX_PARAGRAPHS} from "../app/static/reader/model.mjs";

test("loaded paragraphs have stable local identities even when text repeats", () => {
  const model = new ReaderModel();
  const paragraphs = model.load("A quiet afternoon.\r\n\r\nA quiet afternoon.\r\rA tender kiss.");
  assert.equal(paragraphs.length, 3);
  assert.equal(new Set(paragraphs.map(paragraph => paragraph.id)).size, 3);
  const ids = paragraphs.map(paragraph => paragraph.id);
  model.setOverride(0, 2);
  assert.deepEqual(model.paragraphs.map(paragraph => paragraph.id), ids);
  assert.deepEqual(model.effectiveLevels(), [2, 0, 1]);
});

test("zero corrections override suggestions and reset restores the unchanged prediction", () => {
  const model = new ReaderModel();
  model.load("A tender kiss.");
  model.setOverride(0, 0);
  assert.deepEqual(model.effectiveLevels(), [0]);
  assert.equal(model.paragraphs[0].suggestedLevel, 1);
  model.resetOverride(0);
  assert.equal(model.paragraphs[0].override, null);
  assert.deepEqual(model.effectiveLevels(), [1]);
});

test("replacement and clearing remove old corrections without persisting text", () => {
  const model = new ReaderModel();
  model.load("A tender kiss.");
  const originalId = model.documentId;
  model.setOverride(0, 20);
  model.load("A tender kiss.");
  assert.notEqual(model.documentId, originalId);
  assert.deepEqual(model.effectiveLevels(), [1]);
  assert.equal(model.paragraphs[0].override, null);
  model.clear();
  assert.equal(model.documentId, null);
  assert.deepEqual(model.paragraphs, []);
  assert.deepEqual(model.effectiveLevels(), []);
});

test("failed replacement leaves current document intact and corrections reject invalid input", () => {
  const model = new ReaderModel();
  model.load("<img src=x onerror=alert(1)>\n\nA quiet afternoon.");
  const originalId = model.documentId;
  assert.match(model.paragraphs[0].text, /^<img/);
  assert.throws(() => model.load("  \n\n "), /Add some text/);
  assert.throws(() => model.load("é".repeat(250001)), /500 KB/);
  assert.equal(model.documentId, originalId);
  assert.equal(model.paragraphs.length, 2);
  for (const level of [-1, 21, 1.5, Infinity, NaN, "2"]) assert.throws(() => model.setOverride(0, level), RangeError);
  for (const index of [-1, 2, 0.1, NaN]) assert.throws(() => model.setOverride(index, 1), RangeError);
  assert.throws(() => model.resetOverride(2), RangeError);
});

test("paragraph count is bounded before scoring or replacing the current document", () => {
  const model = new ReaderModel();
  model.load(Array(MAX_PARAGRAPHS).fill("A").join("\n\n"));
  const originalId = model.documentId;
  assert.equal(model.paragraphs.length, MAX_PARAGRAPHS);
  assert.throws(() => model.load(Array(MAX_PARAGRAPHS + 1).fill("A").join("\n\n")), /2,000 paragraphs/);
  assert.equal(model.documentId, originalId);
  assert.equal(model.paragraphs.length, MAX_PARAGRAPHS);
});

test("deferred analysis opens readable text with zero output and preserves corrections", async () => {
  const model = new ReaderModel();
  model.load("A tender kiss.\n\nA quiet afternoon.", {deferAnalysis: true, documentId: "saved-1"});
  model.setOverride(0, 0);
  model.setOverride(1, 4);
  assert.equal(model.analysisStatus, "pending");
  assert.equal(model.paragraphs[0].text, "A tender kiss.");
  assert.deepEqual(model.effectiveLevels(), [0, 0]);
  let yielded = 0;
  assert.equal(await model.analyse({batchSize: 1, yieldTask: async () => { yielded++; }}), true);
  assert.ok(yielded >= 2);
  assert.equal(model.analysisReady, true);
  assert.deepEqual(model.effectiveLevels(), [0, 4]);
  assert.equal(model.paragraphs[0].suggestedLevel, 1);
  assert.equal(await model.analyse({yieldTask: async () => {}}), true);
  assert.deepEqual(model.effectiveLevels(), [0, 4], "Reanalysis cannot erase deliberate corrections.");
});

test("cancelled and superseded analysis cannot revive a different story", async () => {
  const model = new ReaderModel();
  model.load("A tender kiss.", {deferAnalysis: true});
  let resume;
  const work = model.analyse({yieldTask: () => new Promise(resolve => { resume = resolve; })});
  assert.equal(model.analysisStatus, "analysing");
  model.cancelAnalysis();
  resume();
  assert.equal(await work, false);
  assert.equal(model.analysisStatus, "pending");
  assert.deepEqual(model.effectiveLevels(), [0]);
  const stale = model.analyse({yieldTask: () => new Promise(resolve => { resume = resolve; })});
  model.load("The neutral new story.", {deferAnalysis: true});
  resume();
  assert.equal(await stale, false);
  assert.equal(model.paragraphs[0].text, "The neutral new story.");
  assert.equal(model.analysisStatus, "pending");
  assert.equal(await model.analyse({yieldTask: async () => {}}), true);
  assert.deepEqual(model.effectiveLevels(), [0]);
});

test("analysis failure or invalid mapping fails closed and remains recoverable", async () => {
  const model = new ReaderModel();
  model.load("A tender kiss.");
  model.setOverride(0, 8);
  for (const score of [() => { throw Error("private error must not escape"); }, () => ({band: 2, level: 10, reason: "Invalid"})]) {
    assert.equal(await model.analyse({score, yieldTask: async () => {}}), false);
    assert.equal(model.analysisStatus, "error");
    assert.equal(model.analysisReady, false);
    assert.deepEqual(model.effectiveLevels(), [0]);
    assert.equal(model.paragraphs[0].override, 8);
  }
  assert.equal(await model.analyse({yieldTask: async () => {}}), true);
  assert.deepEqual(model.effectiveLevels(), [8]);
});

test("aborted analysis clears partial results without losing manual zero", async () => {
  const model = new ReaderModel();
  const controller = new AbortController();
  model.load("A tender kiss.\n\nA tender kiss.", {deferAnalysis: true});
  model.setOverride(1, 0);
  let calls = 0;
  const result = await model.analyse({signal: controller.signal, batchSize: 1, yieldTask: async () => {
    if (++calls === 2) controller.abort();
  }});
  assert.equal(result, false);
  assert.equal(model.analysisStatus, "pending");
  assert.deepEqual(model.effectiveLevels(), [0, 0]);
  assert.equal(model.paragraphs[1].override, 0);
});
