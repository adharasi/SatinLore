import assert from "node:assert/strict";
import test from "node:test";
import {planStory} from "../app/static/reader/beat-continuity.mjs";

const clearGate = "No blocking event recorded";
const localReason = "Available local evidence";
const inherited = "Carry the established profile through a brief gap. Keep its block and clock.";
const carry = "Same beat continues through a quiet connector. Keep the existing rhythm.";
const fade = "Uncertain continuity eases over a reading-distance budget.";
const quiet = "The intensity has faded. Continued playback needs evidence that the beat is still in focus.";
const floor = "The beat still continues. Keep its rhythm at a low floor.";

function row(id, pattern, {words = 1, paragraph = 0, reason = localReason, gate = clearGate, ...facts} = {}) {
  return {id, words, paragraph, profile: {id, pattern, reason, gate}, ...facts};
}

function fact(knownAt, fields) {
  return {knownAt, evidence: [knownAt], reason: "Reviewed continuity", ...fields};
}

function link(knownAt, priorAnchor) {
  return fact(knownAt, {start: knownAt, priorAnchor, evidence: [priorAnchor, knownAt]});
}

test("matches the Python v6 profile and trace through hold, fade, parking and an explicit return", () => {
  const units = [
    row(0, "Crest", {words: 10}),
    row(1, "Divider", {words: 0}),
    row(2, "Baseline", {words: 12}),
    row(3, "Baseline", {words: 20}),
    row(4, "Baseline", {words: 17}),
    row(5, "Baseline", {words: 23}),
    row(6, "Baseline"),
    row(7, "Baseline", {scope: link(7, 0)}),
  ];
  // Captured from Python v6 on these same neutral synthetic inputs.
  const expected = [
    ["Crest", true, "Enter beat", 0, [0], 0, 0, 0, 0, localReason],
    ["Divider", false, "Divider", null, [], 0, 0, 0, 10, localReason],
    ["Deep sustain", true, "Carry beat", 0, [0], 32, 48, 0, 10, carry],
    ["Undertone", true, "Carry beat", 0, [0], 20, 36, 0, 22, carry],
    ["Taper", true, "Fade beat", 0, [0], 0, 16, 0, 42, fade],
    ["Baseline", false, "Quiet pending evidence", null, [], 0, 0, 0, 59, quiet],
    ["Baseline", false, "Quiet pending evidence", null, [], 0, 0, 0, 82, quiet],
    ["Undertone", true, "Hold low floor", 7, [0, 7], 0, 0, 1, 83, floor],
  ].map(([pattern, active, decision, knownAt, evidence, holdWords, fadeWords, floorWords, wordOffset, reason], id) => {
    const beat = active ? "TEST:beat:0" : null;
    const profile = {id, pattern, reason, gate: clearGate};
    if (pattern !== "Divider") profile.block = beat;
    return [profile, {scene: "TEST:scene:0", beat, decision, knownAt, evidence, holdWords, fadeWords, floorWords, wordOffset, reason}];
  });
  const inputCopy = structuredClone(units);
  assert.deepEqual(planStory("TEST", units), expected);
  assert.deepEqual(units, inputCopy);
  for (let length = 0; length < units.length; length++) {
    assert.deepEqual(planStory("TEST", units.slice(0, length)), expected.slice(0, length));
  }
});

test("cuts and protective decisions discard earlier anchors even when the evidence cites them", () => {
  const cases = [
    [{boundary: fact(1, {kind: "cut"}), low: fact(1)}, "Independent low after cut", "TEST:beat:1", "TEST:scene:1"],
    [{manualZero: true, low: fact(1)}, "Manual zero", null, "TEST:scene:0"],
    [{protective: true, low: fact(1)}, "Eligibility gate", null, "TEST:scene:0"],
    [{gate: "Review eligibility", low: fact(1)}, "Eligibility gate", null, "TEST:scene:0"],
    [{neutral: fact(1), low: fact(1)}, "Neutral context", null, "TEST:scene:0"],
  ];
  for (const [facts, decision, beat, scene] of cases) {
    const result = planStory("TEST", [
      row(0, "Gradual build"),
      row(1, "Baseline", facts),
      row(2, "Baseline", {words: 75}),
      row(3, "Baseline", {scope: link(3, 0), connector: true}),
    ]);
    assert.equal(result[1][1].decision, decision);
    assert.equal(result[1][1].beat, beat);
    assert.equal(result[1][1].scene, scene);
    assert.equal(result[3][0].pattern, "Baseline");
    assert.equal(result[3][1].beat, null);
  }
});

test("weak paragraph transitions release once and ordinary connectors cannot restart a quiet beat", () => {
  const result = planStory("TEST", [
    row(0, "Undertone"),
    row(1, "Baseline", {paragraph: 1}),
    row(2, "Baseline", {paragraph: 1, connector: true, words: 60}),
    row(3, "Baseline", {connector: true, words: 24}),
    row(4, "Baseline", {connector: true}),
  ]);
  assert.deepEqual(result.slice(1).map(([profile, trace]) => [
    profile.pattern, trace.decision, trace.holdWords, trace.fadeWords, trace.floorWords,
  ]), [
    ["Taper", "Fade beat", 0, 16, 0],
    ["Undertone", "Hold low floor", 0, 15, 55],
    ["Baseline", "Quiet pending evidence", 0, 0, 0],
    ["Baseline", "Local profile", 0, 0, 0],
  ]);
});

test("an exhausted release does not classify a long unlinked quiet unit as a taper", () => {
  const start = row(0, "Onset rise", {words: 4});
  const release = row(1, "Taper", {words: 15, ease: fact(1)});
  const quietUnit = row(2, "Baseline", {words: 19});
  const [profile, trace] = planStory("TEST", [start, release, quietUnit])[2];
  assert.equal(profile.pattern, "Baseline");
  assert.equal(trace.beat, null);
  assert.equal(trace.decision, "Quiet after release");
  assert.equal(trace.fadeWords, 1);
  for (const linked of [row(2, "Baseline", {words: 19, scope: link(2, 0)}),
    row(2, "Baseline", {words: 19, connector: true}), row(2, "Baseline", {words: 6})]) {
    const [retained, evidence] = planStory("TEST", [start, release, linked])[2];
    assert.equal(retained.pattern, "Taper");
    assert.equal(evidence.beat, "TEST:beat:0");
  }
});

test("provisional auxiliary low uses bounded carry and only an exact scoped target can establish its floor", () => {
  const units = [
    row(0, "Baseline", {low: fact(0, {provisional: true})}),
    row(1, "Baseline", {words: 19, connector: true}),
    row(2, "Baseline", {words: 15, connector: true}),
    row(3, "Baseline", {words: 24, connector: true}),
    row(4, "Baseline", {connector: true}),
    row(5, "Baseline", {scope: link(5, 0)}),
    row(6, "Baseline", {scope: {...link(6, 0), confirmsProvisional: true}}),
    row(7, "Baseline"),
  ];
  const result = planStory("TEST", units);
  assert.deepEqual(result.map(([profile, trace]) => [profile.pattern, trace.holdWords, trace.fadeWords, trace.floorWords]), [
    ["Undertone", 0, 0, 1], ["Undertone", 16, 32, 0], ["Taper", 0, 13, 0], ["Baseline", 0, 0, 0],
    ["Baseline", 0, 0, 0], ["Baseline", 0, 0, 0], ["Undertone", 32, 48, 48], ["Undertone", 32, 48, 0],
  ]);
  assert.equal(result[6][1].beat, "TEST:beat:0");
  assert.equal(result[6][1].knownAt, 6);
  assert.deepEqual(result[6][1].evidence, [0, 6]);
  const blocked = planStory("TEST", [units[0], row(1, "Stop"),
    row(2, "Baseline", {scope: {...link(2, 0), confirmsProvisional: true}})]);
  assert.equal(blocked[2][0].pattern, "Baseline");
  assert.equal(blocked[2][1].beat, null);
});

test("independent recovery has a bounded floor across inherited taper", () => {
  const result = planStory("TEST", [
    row(0, "Gradual build", {words: 8}),
    row(1, "Recovery", {words: 21}),
    row(2, "Taper", {reason: inherited, connector: true, scope: link(2, 1), words: 12}),
    row(3, "Recovery", {reason: inherited, words: 12}),
    row(4, "Recovery", {reason: inherited}),
  ]);
  assert.deepEqual(result.map(([profile]) => profile.pattern),
    ["Gradual build", "Recovery", "Recovery", "Recovery", "Baseline"]);
  assert.deepEqual(result.slice(1).map(([, trace]) => [trace.beat, trace.fadeWords, trace.floorWords]), [
    ["TEST:beat:0", 16, 16], ["TEST:beat:0", 0, 12], ["TEST:beat:0", 0, 12], [null, 0, 0],
  ]);
});

test("span end eases an existing beat and permits independent low evidence", () => {
  const boundary = fact(1, {kind: "span-end"});
  const result = planStory("TEST", [
    row(0, "Gradual build"),
    row(1, "Baseline", {boundary}),
    row(2, "Baseline", {scope: link(2, 0)}),
    row(3, "Deep sustain", {boundary: fact(3, {kind: "beat-end"})}),
    row(4, "Baseline", {scope: link(4, 0)}),
  ]);
  assert.deepEqual(result.map(([profile, trace]) => [profile.pattern, trace.decision, trace.beat]), [
    ["Gradual build", "Enter beat", "TEST:beat:0"],
    ["Taper", "Ease", "TEST:beat:0"],
    ["Taper", "Fade beat", "TEST:beat:0"],
    ["Taper", "End beat", "TEST:beat:0"],
    ["Baseline", "Local profile", null],
  ]);
  const quietBoundary = fact(0, {kind: "span-end"});
  assert.equal(planStory("TEST", [row(0, "Baseline", {boundary: quietBoundary})])[0][0].pattern, "Baseline");
  assert.equal(planStory("TEST", [row(0, "Baseline", {boundary: quietBoundary, low: fact(0)})])[0][0].pattern,
    "Undertone");
});

test("local recovery after a closed beat never creates a continuation anchor", () => {
  const result = planStory("TEST", [
    row(0, "Gradual build"),
    row(1, "Baseline", {boundary: fact(1, {kind: "beat-end"})}),
    row(2, "Baseline", {words: 8, low: fact(2, {evidence: [1, 2], profile: "Recovery", localOnly: true})}),
    row(3, "Baseline", {scope: link(3, 0), connector: true}),
    row(4, "Baseline", {scope: link(4, 2), connector: true}),
  ]);
  assert.deepEqual(result.map(([profile]) => profile.pattern), ["Gradual build", "Baseline", "Recovery", "Baseline", "Baseline"]);
  assert.equal(result[2][1].beat, null);
  assert.equal(result[2][1].floorWords, 8);
  assert.deepEqual(result[2][1].evidence, [1, 2]);
});

test("future overlays never seed carry and future citations never appear in a trace", () => {
  const result = planStory("TEST", [
    row(0, "Gradual build", {tension: {decision: "Apply overlay", knownAt: 2}}),
    row(1, "Baseline"),
    row(2, "Gradual build", {tension: {decision: "Apply overlay", knownAt: 2}}),
    row(3, "Baseline", {scope: fact(3, {start: 2, evidence: [2, 3, 5, 2]})}),
  ]);
  assert.equal(result[0][1].beat, null);
  assert.equal(result[1][0].pattern, "Baseline");
  assert.equal(result[3][1].beat, "TEST:beat:2");
  assert.equal(result[3][1].knownAt, 3);
  assert.deepEqual(result[3][1].evidence, [2, 3]);
});

test("invalid ordering, future facts and ungrounded links are rejected", () => {
  const start = row(0, "Baseline");
  assert.throws(() => planStory("TEST", [start, start]), /ordered unit IDs/);
  assert.throws(() => planStory("TEST", [row(0, "Baseline", {words: -1})]), /nonnegative word counts/);
  assert.throws(() => planStory("TEST", [start, row(1, "Baseline", {scope: fact(2)})]), /available at the current unit/);
  for (const scope of [fact(0, {priorAnchor: 1, evidence: [0, 1]}), fact(1, {priorAnchor: 0})]) {
    assert.throws(() => planStory("TEST", [start, row(1, "Baseline", {scope})]), /cite its independently available prior anchor/);
  }
  for (const low of [fact(0), fact(1, {profile: "Crest"}), fact(1, {profile: null})]) {
    assert.throws(() => planStory("TEST", [start, row(1, "Baseline", {low})]), /low profile at its evidence unit/);
  }
});
