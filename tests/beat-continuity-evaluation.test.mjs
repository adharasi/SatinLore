import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {buildReferenceCorpus, scoreBeatContinuityCorpus} from "../scripts/lib/beat-continuity-evaluation.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

function fixture() {
  const id = "sample-01", sourceSha256 = hash("fixture");
  const units = Array.from({length: 6}, (_, id) => ({id, paragraph: Math.floor(id / 2), text: `Unit ${id}.`,
    structuralBoundary: id === 5}));
  const source = {works: [{id, sourceSha256, units}]};
  const approved = {works: [{id, sourceSha256, units: units.map(unit => {
    const {id, text, structuralBoundary} = unit;
    const active = id < 4;
    return {id, unitSha256: hash(text), sourceRole: structuralBoundary ? "structural" : "prose",
      v9Depiction: id === 0 ? "overt sexual" : active ? "suggestive" : "neutral",
      v9Frame: active ? "current" : "neutral",
      v9Phase: active ? "build" : structuralBoundary ? "structural" : "quiet",
      v9Effect: id === 3 ? "hard-stop" : id === 1 ? "ease" : "none",
      v9Event: id === 1 ? "natural-end" : "none", v9EventKnownAt: id,
      causalActivation: [0, 2, 3].includes(id) ? "cue" : id === 4 ? "review" : "context",
      v9Pattern: {pattern: id === 5 ? "Divider" : id === 3 ? "Stop" : active ? "Gradual build" : "Baseline",
        phase_used: active ? "build" : structuralBoundary ? "structural" : "quiet",
        gate: id === 3 ? "Blocked" : "No blocking event recorded"},
      continuity: {scene: "scene-1", beat: id < 3 ? "beat-1" : null,
        knownAt: id, evidence: [id], decision: id === 3 ? "Eligibility gate" : "Test"}};
  })}]};
  const options = {storyIds: [id]};
  const reference = buildReferenceCorpus(source, approved, options);
  const candidate = (rows, dimensions) => ({dimensions, works: [{id, sourceSha256, units: rows.map(row => (
    {unitSha256: hash(units[row.id].text), ...row}))}]});
  return {source, approved, options, reference, candidate};
}

test("binds reference and prediction rows to the same source edition and unit hashes", () => {
  const {source, approved, options, reference, candidate} = fixture();
  const modifiedSource = structuredClone(source);
  modifiedSource.works[0].units[1].text = "Different sentence.";
  assert.throws(() => buildReferenceCorpus(modifiedSource, approved, options), /Source identity differs at sample-01:1/);
  const stale = candidate([{id: 0, unitSha256: hash("stale"), cue: true}]);
  assert.throws(() => scoreBeatContinuityCorpus(reference, stale), /Candidate identity differs at sample-01:0/);
  const wrongEdition = candidate([]);
  wrongEdition.works[0].sourceSha256 = hash("another edition");
  assert.throws(() => scoreBeatContinuityCorpus(reference, wrongEdition), /Candidate edition differs/);
  assert.throws(() => scoreBeatContinuityCorpus(reference, candidate([{id: 0}, {id: 0}])), /unit identity/);
});

test("distinguishes unavailable recognition from neutral fallback and separate protection metrics", () => {
  const {reference, candidate} = fixture();
  const results = scoreBeatContinuityCorpus(reference, candidate([
    {id: 0, status: "withheld", playbackStatus: "computed", depiction: "neutral", pattern: "Baseline"},
    {id: 1, status: "neutral", cue: false, depiction: "neutral", pattern: "Baseline", outputLevel: 0},
    {id: 2, status: "unverified", cue: true},
    {id: 3, cue: true, pattern: "Undertone", outputLevel: 1},
    {id: 5, status: "structural", pattern: "Divider"},
  ]), {includeDiscrepancies: true});
  const {summary} = results;
  assert.deepEqual(summary.status, {withheld: 1, neutral: 1, unverified: 1, verified: 1, missing: 1});
  assert.equal(summary.labels.depiction.observed, 1);
  assert.equal(summary.labels.pattern.observed, 3);
  assert.deepEqual(summary.structuralPattern, {reference: 1, observed: 1, exact: 1});
  assert.deepEqual(summary.cues.effective, {matched: 0, missed: 2, extra: 1, precision: 0, recall: 0});
  assert.equal(summary.cues.legacyRawAnchorComparison.matched, 1);
  assert.equal(summary.cues.observedKnownRows, 2);
  assert.equal(summary.protection.positiveOutputOnProtectedReference, 1);
  assert.equal(summary.protection.newActiveProfilesOnProtectedReference, 1);
  assert.equal(results.discrepancyCounts["cue:missed-withheld"], 1);
  assert.equal(results.discrepancyCounts["cue:missed-unverified"], 1);
  assert.equal(results.discrepancyCounts["hard-profile:missed"], 1);
  assert.equal(JSON.stringify(results).includes("Unit 0."), false);
});

test("scores causal IDs, adjacent links, short baseline dips, and one-to-one event placement", () => {
  const {reference, candidate} = fixture();
  const {summary} = scoreBeatContinuityCorpus(reference, candidate([
    {id: 0, knownAt: 1, evidenceIds: [1], beatId: "opaque", pattern: "Gradual build", transition: "ease"},
    {id: 1, knownAt: 1, evidenceIds: [1], beatId: "opaque", pattern: "Baseline", transition: "none"},
    {id: 2, knownAt: 2, evidenceIds: [2], beatId: "opaque", pattern: "Gradual build", transition: "ease"},
    {id: 3, knownAt: 3, evidenceIds: [3], beatId: null, pattern: "Stop", transition: "hard-stop"},
  ]));
  assert.equal(summary.causalTraceViolations, 1);
  assert.equal(summary.trace.knownAt.exact, 3);
  assert.equal(summary.trace.evidenceIds.exact, 3);
  assert.equal(summary.continuity.beat.matched, 2);
  assert.equal(summary.continuity.beat.extra, 0);
  assert.deepEqual(summary.continuity.shortBaselineDips, {reference: 0, observed: 1, matched: 0, comparableWindows: 1});
  assert.deepEqual(summary.typedTransitions.exact, {matched: 1, missed: 1, extra: 2, precision: 1 / 3, recall: 1 / 2});
  assert.deepEqual(summary.typedTransitions.withinOneParagraph, {matched: 2, missed: 0, extra: 1, precision: 2 / 3, recall: 1});
  assert.equal(reference.works[0].units[0].depiction, "overt-sexual");
  assert.equal(reference.works[0].units[1].transition, "ease");
});
