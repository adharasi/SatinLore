import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {CORPUS_COMPACT_PROMPTS, REFERENCE_RUBRIC_VERSION} from "../deploy/cloudflare/corpus-study-contract.mjs";
import {evaluateEvidencePairs, main} from "../scripts/evaluate-evidence-pairs.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const digest = value => hash(JSON.stringify(value));
const sourceBundleSha256 = hash("fixture bundle");
const sourceSha256 = hash("fixture work");
const indexSha256 = hash("fixture index");
const workId = "fixture";
const runId = "fixture-run";

function row(targetId, activation, transition = "none") {
  const cue = activation === "cue", uncertain = activation === "review";
  const evidenceIds = cue || transition !== "none" ? [targetId] : [];
  const label = {depiction: "neutral", frame: "current", interaction: cue ? "depicted" : "none", activation,
    phase: cue ? "sustain" : uncertain ? "unknown" : "quiet", transition, evidenceIds,
    knowledgeAtId: evidenceIds.at(-1) ?? null};
  return {id: targetId, unitSha256: hash(String(targetId)), status: uncertain ? "uncertain" : "classified", failureCode: null,
    causal: label, retrospective: label, eligibility: {status: cue ? "eligible" : "uncertain", adult: cue ? "adult" : "not_applicable",
      consent: cue ? "present" : "not_applicable", capacity: cue ? "present" : "not_applicable", evidenceIds: cue ? [0] : []},
    confidence: 80, reasonCodes: []};
}

function fixture() {
  const cases = [
    {targetId: 10, expected: "cue", stratum: "missing-anchor", expectedTransition: "stop"},
    {targetId: 11, expected: "cue", stratum: "anchor-complete", expectedTransition: "none"},
    {targetId: 12, expected: "no-cue", stratum: "negative-control", expectedTransition: "none"},
    {targetId: 13, expected: "protected", stratum: "protected-control"},
    {targetId: 14, expected: "protected", stratum: "protected-control"},
  ].map(entry => ({...entry, workId}));
  const cohort = {schema: 1, kind: "satinlore-evidence-pair-cohort", sourceBundleSha256,
    referenceSha256: hash("fixture reference"), cases};
  const plan = {schema: 1, kind: "satinlore-evidence-pair-plan", sourceBundleSha256,
    pairs: cases.map(({targetId}) => ({workId, sourceSha256, indexSha256, targetId,
      baselineContextIds: [0, 1], addedContextIds: [2], baselineBatchId: hash(`b-${targetId}`), enrichedBatchId: hash(`e-${targetId}`)}))};
  cohort.planSha256 = digest(plan);
  const plannedBatches = plan.pairs.flatMap(pair => [false, true].map(enriched => ({
    workId, role: "detector", batchId: enriched ? pair.enrichedBatchId : pair.baselineBatchId,
    targetIds: [pair.targetId], contextIds: enriched ? [0, 1, 2] : [0, 1]})));
  const manifest = plannedBatches.map(batch => batch.batchId);
  const activations = ["review", "cue", "cue", "context", "context", "cue", "protected", "held", "protected", "cue"];
  const batches = plannedBatches.map((batch, i) => {
    const binding = {...batch, schema: 1, runId, referenceVersion: REFERENCE_RUBRIC_VERSION, sourceSha256, indexSha256};
    if (activations[i] === "held") return {...binding, measurement: "client-disposition", status: "settlement_unknown", rows: []};
    return {...binding, measurement: "live-provider", dispatched: true, status: "parsed",
      model: "gpt-6-luna", returnedModel: "gpt-6-luna", promptSha256: hash(CORPUS_COMPACT_PROMPTS.detector),
      predictionVersion: "source-first-detector-v7", budget: {settlementConfirmed: true},
      elapsedMs: 100 + i, usage: {inputTokens: 40, outputTokens: 8},
      rows: [row(batch.targetIds[0], activations[i], [1, 5].includes(i) ? "stop" : "none")]};
  });
  const checkpoint = {schema: 1, kind: "satinlore-corpus-study-checkpoint", runId, referenceVersion: REFERENCE_RUBRIC_VERSION,
    sourceBundleSha256, evidencePairPlan: {...plan, planSha256: digest(plan)}, selectedRoles: ["detector"],
    workRoster: [{workId, sourceSha256, indexSha256}], plannedBatches, manifest, manifestHash: digest(manifest), batches,
    attempts: batches.map(({batchId, status}) => ({batchId, workId, role: "detector", runId,
      state: status === "settlement_unknown" ? "held" : "complete"}))};
  return {cohort, checkpoint};
}

test("scores matched prefix recovery, regression and protected controls while preserving held outcomes and identity", async t => {
  const input = fixture();
  const result = evaluateEvidencePairs(input), {summary} = result;
  assert.equal(result.sourceProseIncluded, false);
  assert.equal(summary.plannedPairs, 5);
  assert.equal(summary.completePairs, 4);
  assert.equal(summary.bothClassified, 3);
  assert.equal(summary.cueGains, 1);
  assert.equal(summary.cueRegressions, 1);
  assert.equal(summary.falseCueIntroductions, 2);
  assert.equal(summary.effective.enriched.protectedFalseCues, 1);
  assert.equal(summary.effective.enriched.protectedCases, 2);
  assert.equal(summary.effective.enriched.clearNegativeFalseCueRate, 1);
  assert.equal(summary.pairedComplete.enriched.protectedCases, 1);
  assert.equal(summary.effective.enriched.transitions.matched, 1);
  assert.equal(summary.effective.enriched.transitions.extra, 1);
  assert.equal(summary.effective.enriched.states["settlement-hold"], 1);
  assert.equal(summary.effective.enriched.observedCalls, 4);
  assert.equal(summary.effective.enriched.inputTokens, 160);
  assert.equal(result.byStratum["missing-anchor"].cueGains, 1);

  const badIdentity = structuredClone(input);
  badIdentity.checkpoint.batches[0].runId = "other-run";
  assert.throws(() => evaluateEvidencePairs(badIdentity), /binding/);
  const badContext = structuredClone(input);
  badContext.checkpoint.plannedBatches[0].contextIds = [0, 20];
  assert.throws(() => evaluateEvidencePairs(badContext), /binding/);
  const badHash = structuredClone(input);
  badHash.checkpoint.batches[1].rows[0].unitSha256 = hash("another unit");
  assert.throws(() => evaluateEvidencePairs(badHash), /binding/);
  const badCohort = structuredClone(input);
  badCohort.cohort.planSha256 = hash("another plan");
  assert.throws(() => evaluateEvidencePairs(badCohort), /binding/);

  const malformed = structuredClone(input);
  malformed.checkpoint.batches[1].rows[0].eligibility.status = "uncertain";
  const rejectedCue = evaluateEvidencePairs(malformed);
  assert.equal(rejectedCue.rows[0].enriched.state, "malformed");
  assert.equal(rejectedCue.rows[0].enriched.activation, null);
  assert.equal(rejectedCue.rows[0].enriched.transition, "stop");
  assert.equal(rejectedCue.summary.cueGains, 0);

  const privateDir = await mkdtemp(join(tmpdir(), "satinlore-evidence-pair-"));
  t.after(() => rm(privateDir, {recursive: true, force: true}));
  const cohortPath = join(privateDir, "cohort.json"), checkpointPath = join(privateDir, "checkpoint.json");
  await Promise.all([writeFile(cohortPath, JSON.stringify(input.cohort)), writeFile(checkpointPath, JSON.stringify(input.checkpoint))]);
  const outputArgs = ["--cohort", cohortPath, "--checkpoint", checkpointPath, "--output"];
  const gitOutput = fileURLToPath(new URL("./.private-evidence-test-output.json", import.meta.url));
  await assert.rejects(main([...outputArgs, gitOutput]), /outside Git/);
  const privateFile = join(privateDir, "report.json");
  assert.deepEqual(await main([...outputArgs, privateFile]), {plannedPairs: 5, completePairs: 4});
  if (process.platform !== "win32") assert.equal((await stat(privateFile)).mode & 0o777, 0o600);
  await assert.rejects(main([...outputArgs, privateFile]), {code: "EEXIST"});
});
