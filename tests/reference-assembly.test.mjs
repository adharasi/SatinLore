import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {assembleFullCorpusReference, auditPriorReference} from "../scripts/lib/reference-assembly.mjs";
import {REFERENCE_RUBRIC_VERSION} from "../deploy/cloudflare/corpus-study-contract.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const sourceSha256 = sha("fixture edition"), indexSha256 = sha("fixture index");
const work = {id: "fixture-01", family: "fixture", sourceSha256, indexSha256, units: [
  {id: 0, paragraph: 0, start: 0, end: 33, text: "Two adult friends entered a room.", structuralBoundary: false},
  {id: 1, paragraph: 1, start: 0, end: 25, text: "They shared a warm smile.", structuralBoundary: false},
  {id: 2, paragraph: 2, start: 0, end: 3, text: "***", structuralBoundary: true},
]};
const corpus = {works: [work]};
const cue = (id = 1, evidenceIds = [id]) => ({depiction: "romantic", frame: "imagined", interaction: "depicted",
  activation: "cue", phase: "build", transition: "none", evidenceIds, knowledgeAtId: evidenceIds.at(-1)});
const quiet = id => ({...cue(id), frame: "current", interaction: "mentioned", activation: "context", phase: "quiet"});
const eligibility = evidenceIds => ({status: "eligible", adult: "adult", consent: "present", capacity: "present", evidenceIds});
function label(id = 1, causal = cue(id), retrospective = cue(id)) {
  return {id, unitSha256: sha(work.units[id].text), status: "classified", causal, retrospective,
    eligibility: eligibility([0]), confidence: 90, reasonCodes: ["grounded-current"]};
}
function batch(role, row) {
  return {batchId: `fixture-${role}-${row.id}`, workId: work.id, sourceSha256, indexSha256,
    referenceVersion: REFERENCE_RUBRIC_VERSION, role, model: "fixture-model", promptSha256: sha(role),
    status: "parsed", targetIds: [row.id], contextIds: [1 - row.id], rows: [row]};
}
function assemble(...batches) {return assembleFullCorpusReference({corpus, checkpoints: [{batches}]});}

test("agreement on a noncurrent cue resolves despite different evidence IDs", () => {
  const a = label(), b = label(1, cue(1, [0, 1]), cue(1, [0, 1]));
  const {reference, adjudicationSelection} = assemble(batch("referenceA", a), batch("referenceB", b),
    {role: "detector", rows: [{activation: "context"}]});
  const [missing, annotated] = reference.works[0].labels;
  assert.equal(reference.datasetId, "full-corpus-v7");
  assert.equal(missing.scopeStatus.retrospective, "not_submitted");
  assert.equal(missing.retrospective.activation, "review");
  assert.equal(annotated.scopeStatus.retrospective, "resolved");
  assert.equal(annotated.retrospective.activation, "cue");
  assert.equal(annotated.retrospective.frame, "imagined");
  assert.equal(reference.works[0].nonTargetUnits[0].status, "not_target");
  assert.equal(reference.ignoredRoles.detector, 1);
  assert.equal(adjudicationSelection.targetCount, 0);
  assert.equal(JSON.stringify(reference).includes(work.units[0].text), false);
});

test("blind selection contains only coordinates, and C can confirm a valid first view", () => {
  const a = batch("referenceA", label()), b = batch("referenceB", label(1, quiet(1), quiet(1)));
  const {reference, adjudicationSelection} = assemble(a, b);
  assert.equal(reference.works[0].labels[1].scopeStatus.causal, "pending");
  assert.equal(reference.works[0].labels[1].causal.depiction, "romantic");
  assert.equal(reference.works[0].labels[1].causal.activation, "review");
  assert.deepEqual(adjudicationSelection.jobs[0].targetIds, [1]);
  assert.equal(JSON.stringify(adjudicationSelection).includes("romantic"), false);
  const final = assemble(a, b, batch("adjudicator", label()));
  assert.equal(final.reference.works[0].labels[1].reviewStatus, "model-assisted-adjudicated");
  assert.equal(final.reference.works[0].labels[1].retrospective.activation, "cue");
  assert.equal(final.adjudicationSelection.targetCount, 0);
});

test("a novel third-view semantic answer remains pending, regardless of confidence", () => {
  const a = batch("referenceA", label()), b = batch("referenceB", label(1, quiet(1), quiet(1)));
  const third = {...cue(), frame: "remembered"};
  const c = batch("adjudicator", {...label(1, third, third), confidence: 100});
  const {reference} = assemble(a, b, c);
  const row = reference.works[0].labels[1];
  assert.equal(row.scopeStatus.retrospective, "pending");
  assert.equal(row.retrospective.activation, "review");
  assert.equal(row.depictionStatus.retrospective, "resolved");
  assert.equal(row.adjudication.scopes.retrospective.semantic.method, "unresolved-third-view");
});

test("later eligibility cannot backfill a causal cue, while valid retrospective evidence survives", () => {
  const causal = {...cue(0), depiction: "graphic"}, retrospective = {...cue(0, [0, 1]), depiction: "graphic"};
  const row = {...label(0, causal, retrospective), status: "partial", eligibility: eligibility([1]),
    scopeStatus: {causal: "invalid", retrospective: "classified", eligibility: "valid"},
    proposed: {causal, retrospective, eligibility: eligibility([1])}};
  const {reference} = assemble(batch("referenceA", row), batch("referenceB", row));
  const target = reference.works[0].labels[0];
  assert.equal(target.scopeStatus.causal, "pending");
  assert.equal(target.causal.activation, "review");
  assert.equal(target.causal.depiction, "graphic");
  assert.ok(target.causal.evidenceIds.every(id => id <= target.id));
  assert.equal(target.scopeStatus.retrospective, "resolved");
  assert.equal(target.retrospective.activation, "cue");
  assert.deepEqual(target.scopeEligibility.retrospective.evidenceIds, [1]);
});

test("unit hash mismatch is excluded, and source hash mismatch fails closed", () => {
  const bad = batch("referenceB", {...label(), unitSha256: sha("wrong target")});
  const {reference} = assemble(batch("referenceA", label()), bad);
  assert.equal(reference.works[0].labels[1].scopeStatus.retrospective, "failed");
  assert.throws(() => assemble({...bad, sourceSha256: sha("wrong edition")}), /does not match/u);
});

test("blocked or unsent plans retain coverage reasons without pretending to be model output", () => {
  const plans = ["referenceA", "referenceB"].map(role => ({batchId: `plan-${role}`, workId: work.id, role,
    targetIds: [1], contextIds: [0]}));
  const {reference} = assembleFullCorpusReference({corpus, checkpoints: [{batches: [], plannedBatches: plans,
    attempts: [{batchId: "plan-referenceA", state: "blocked"}]}]});
  const target = reference.works[0].labels[1];
  assert.equal(target.scopeStatus.retrospective, "not_submitted");
  assert.equal(target.retrospective.activation, "review");
  assert.equal(target.provenance.referenceA.missingReason, "refusal-overlap-blocked");
  assert.equal(target.provenance.referenceB.missingReason, "not-dispatched");
  assert.ok(reference.requests.every(request => !request.returned));
});

test("prior audit is read-only and checks old target digests where present", () => {
  const {reference} = assemble(batch("referenceA", label()), batch("referenceB", label()));
  const seal = reference.referenceSha256;
  const prior = {works: [{sourceSha256, labels: [{id: 1, activation: "context"},
    {id: 0, activation: "cue", sentenceSha256: sha("wrong") }]}]};
  const result = auditPriorReference(reference, prior);
  assert.equal(result.matchedUnitCount, 1);
  assert.equal(result.unmatchedUnitCount, 1);
  assert.equal(result.changedFields["retrospective.activation"], 1);
  assert.equal(reference.referenceSha256, seal);
  assert.equal(reference.works[0].labels[1].retrospective.activation, "cue");
});

function overlayFixture() {
  const source = structuredClone(corpus);
  for (const unit of source.works[0].units) unit.admission = unit.structuralBoundary ? "blocked" : "approved";
  const masked = structuredClone(source);
  masked.works[0].units[0].admission = "blocked";
  const sourceBundleSha256 = sha(JSON.stringify(source));
  const overlaySha256 = sha(JSON.stringify(masked));
  const holdKey = sha(JSON.stringify([sourceSha256, indexSha256, 0, sha(work.units[0].text)]));
  const firstViews = {sourceBundleSha256, heldUnitKeys: [holdKey], batches: [
    batch("referenceA", label(0)), batch("referenceB", label(0)),
    batch("referenceA", label()), batch("referenceB", label(1, quiet(1), quiet(1))),
  ]};
  const makeThirdView = (row, contextIds) => {
    const result = {...batch("adjudicator", row), contextIds};
    const units = [row.id, ...contextIds].sort((a, b) => a - b).map(id => {
      const unit = work.units[id];
      return {id, paragraph: unit.paragraph, unitSha256: sha(unit.text), text: unit.text, target: id === row.id, structuralBoundary: unit.structuralBoundary};
    });
    result.batchId = sha(JSON.stringify({schema: 1, workId: work.id, sourceSha256, indexSha256,
      referenceVersion: REFERENCE_RUBRIC_VERSION, role: "adjudicator", units}));
    return result;
  };
  const run = (extra = [], overlayCorpus = masked) => assembleFullCorpusReference({corpus: source, sourceBundleSha256,
    checkpoints: [firstViews, ...extra], admissionOverlay: {corpus: overlayCorpus, sourceBundleSha256: sha(JSON.stringify(overlayCorpus))}});
  return {source, masked, sourceBundleSha256, overlaySha256, firstViews, makeThirdView, run};
}

test("an admission overlay preserves original coordinates, denominators, and prior resolved labels", () => {
  const fixture = overlayFixture();
  const before = fixture.run();
  assert.equal(before.reference.counts.targets, 2);
  assert.equal(before.reference.admissionOverlay.verifiedWithheldUnits, 1);
  assert.equal(before.adjudicationSelection.sourceBundleSha256, fixture.overlaySha256);
  assert.deepEqual(before.adjudicationSelection.jobs[0].targetIds, [1]);
  const oldCue = before.reference.works[0].labels[0];
  assert.equal(oldCue.sourceAdmission, "approved");
  assert.equal(oldCue.admissionOverlayStatus, "blocked");
  assert.equal(oldCue.scopeStatus.retrospective, "resolved");
  assert.equal(oldCue.retrospective.activation, "cue");
  assert.equal(oldCue.unitSha256, sha(work.units[0].text));

  const third = fixture.makeThirdView({...label(), eligibility: eligibility([1])}, []);
  const after = fixture.run([{sourceBundleSha256: fixture.overlaySha256, batches: [third]}]);
  const selected = after.reference.works[0].labels[1];
  assert.equal(selected.reviewStatus, "model-assisted-adjudicated");
  assert.equal(selected.retrospective.activation, "cue");
  assert.equal(after.reference.requests[selected.provenance.adjudicator.requestIndex].admissionOverlaySourceBundleSha256, fixture.overlaySha256);
  assert.equal(after.reference.counts.targets, before.reference.counts.targets);
  assert.equal(after.adjudicationSelection.targetCount, 0);
  assert.doesNotMatch(JSON.stringify(after), /Two adult friends entered a room/u);
});

test("withheld disagreements stay pending and are omitted from third-view selection", () => {
  const fixture = overlayFixture();
  fixture.firstViews.batches[1] = batch("referenceB", label(0, quiet(0), quiet(0)));
  const {reference, adjudicationSelection} = fixture.run();
  assert.equal(reference.works[0].labels[0].scopeStatus.retrospective, "pending");
  assert.equal(reference.counts.adjudicationWithheldTargets, 1);
  assert.deepEqual(adjudicationSelection.jobs[0].targetIds, [1]);
});

test("an admission overlay rejects withheld targets, withheld context, and mismatched window digests", () => {
  const fixture = overlayFixture();
  const forOverlay = batches => [{sourceBundleSha256: fixture.overlaySha256, batches}];
  const heldTarget = fixture.makeThirdView(label(0), [1]);
  const heldContext = fixture.makeThirdView(label(), [0]);
  assert.throws(() => fixture.run(forOverlay([heldTarget])), /outside the admission overlay/u);
  assert.throws(() => fixture.run(forOverlay([heldContext])), /outside the admission overlay/u);
  assert.throws(() => fixture.run(forOverlay([{...heldContext, contextIds: []}])), /window digest/u);
  assert.throws(() => fixture.run([{sourceBundleSha256: fixture.sourceBundleSha256, batches: [heldContext]}]), /must use the admission overlay/u);
});

test("an admission overlay rejects source edits, expanded admission, and incomplete holds", () => {
  const fixture = overlayFixture();
  const changedText = structuredClone(fixture.masked);
  changedText.works[0].units[1].text = "Edited source.";
  assert.throws(() => fixture.run([], changedText), /changed source units or text/u);
  const expanded = structuredClone(fixture.masked);
  expanded.works[0].units[2].admission = "approved";
  assert.throws(() => fixture.run([], expanded), /only block previously approved units/u);
  const incomplete = structuredClone(fixture.source);
  incomplete.works[0].units[1].admission = "blocked";
  assert.throws(() => fixture.run([], incomplete), /leaves a held or refused source unit available/u);
});
