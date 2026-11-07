import assert from "node:assert/strict";
import {resolveObjectURL} from "node:buffer";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {corpusStudyClient} from "../deploy/cloudflare/corpus-study-client.mjs";
import {validateCorpusBatch} from "../deploy/cloudflare/corpus-study.mjs";

const {prepareSource, buildTasks, buildEvidencePairTasks, validateEvidencePairResume, resumeDisposition, planRecord, digest, VERSION} =
  corpusStudyClient({testOnly: true});

async function fixture() {
  const sentences = ["The catalogue opened.", "The desk lamp was on.", "A shelf held a card.", "A new chapter began.",
    "The chair faced the desk.", "A caretaker opened the window.", "Another window was closed.", "A folder lay flat.",
    "The visitor took a seat.", "The desk was empty.", "A page turned.", "The bell chimed."];
  const units = sentences.map((text, id) => ({
    id, text, paragraph: id, start: 0, end: text.length, structuralBoundary: id === 3,
    admission: id === 1 ? "blocked" : id === 2 ? "review" : "approved",
  }));
  const work = {id: "neutral", family: "neutral-fixture", sourceSha256: "a".repeat(64), units};
  work.indexSha256 = await digest(await Promise.all(units.map(async u => ({
    id: u.id, paragraph: u.paragraph, start: u.start, end: u.end, sha256: await digest(u.text), structuralBoundary: u.structuralBoundary,
  }))));
  const sourceText = JSON.stringify({
    schema: 1, referenceVersion: "v7", userConsented: true, sourceTransmissionPurpose: "neutral-editorial-classification-only", works: [work],
  });
  const prepared = await prepareSource(sourceText);
  const pair = {workId: work.id, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256, targetId: 10, baselineContextIds: [8, 9], addedContextIds: [0, 4]};
  const plan = {schema: 1, kind: "satinlore-evidence-pair-plan", sourceBundleSha256: prepared.sourceBundleSha256, pairs: [pair]};
  return {prepared, plan, pair, sourceText};
}

test("paired plans keep the original target and differ only in earlier detector context", async () => {
  const {prepared, plan, pair} = await fixture();
  const {tasks: [baseline, enriched], pairs} = await buildEvidencePairTasks(prepared, plan);
  assert.deepEqual(pairs, [{...pair, baselineBatchId: baseline.batchHash, enrichedBatchId: enriched.batchHash}]);
  assert.doesNotMatch(JSON.stringify(pairs), /catalogue|chair|page turned/);
  assert.notEqual(baseline.batchHash, enriched.batchHash);
  assert.deepEqual(planRecord(baseline).contextIds, [8, 9]);
  assert.deepEqual(planRecord(enriched).contextIds, [0, 4, 8, 9]);
  assert.equal(baseline.unitKeys.at(-1), enriched.unitKeys.at(-1));
  for (const task of [baseline, enriched]) {
    assert.deepEqual(await validateCorpusBatch(task.batch), task.batch);
    assert.equal(await digest(task.batch), task.batchHash);
    assert.deepEqual(task.batch.units.filter(u => u.target).map(u => u.id), [10]);
  }
  assert.deepEqual(await buildEvidencePairTasks(prepared, plan), {tasks: [baseline, enriched], pairs});
  const ordinary = await buildTasks(prepared, ["detector"]);
  assert.deepEqual(ordinary[0].batch.units.filter(u => u.target).map(u => u.id), [0, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(await validateCorpusBatch(ordinary[0].batch), ordinary[0].batch);
});

test("paired planning rejects source drift, mixed fields, invalid anchors and duplicate targets", async () => {
  const {prepared, plan, pair} = await fixture();
  const invalidPairs = [
    {...pair, privateLabel: "cue"},
    {...pair, workId: "missing"},
    {...pair, indexSha256: "b".repeat(64)},
    {...pair, targetId: 1, baselineContextIds: [], addedContextIds: [0]},
    {...pair, addedContextIds: []},
    {...pair, addedContextIds: [8]},
    {...pair, addedContextIds: [0, 0]},
    {...pair, addedContextIds: [4, 0]},
    {...pair, addedContextIds: [1]},
    {...pair, addedContextIds: [2]},
    {...pair, addedContextIds: [3]},
    {...pair, addedContextIds: [10]},
    {...pair, addedContextIds: [11]},
    {...pair, addedContextIds: [99]},
    {...pair, baselineContextIds: [0, 4, 5, 6, 7, 8, 9], addedContextIds: [1, 2]},
  ];
  for (const candidate of invalidPairs) await assert.rejects(buildEvidencePairTasks(prepared, {...plan, pairs: [candidate]}), /invalid_evidence_pair/);
  for (const candidate of [{...plan, sourceBundleSha256: "c".repeat(64)}, {...plan, labels: {}}, {...plan, pairs: []},
    {...plan, pairs: [pair, pair]}, {...plan, pairs: Array(151).fill(pair)}]) {
    await assert.rejects(buildEvidencePairTasks(prepared, candidate), /invalid_evidence_pair/);
  }
});

test("paired checkpoints resume only the exact source-free plan and run", async () => {
  const {prepared, plan} = await fixture();
  const {tasks, pairs} = await buildEvidencePairTasks(prepared, plan);
  const manifest = tasks.map(task => task.batchHash), manifestHash = await digest(manifest), metadata = {...plan, pairs};
  const evidencePairPlan = {...metadata, planSha256: await digest(metadata)};
  const checkpoint = {
    schema: 1, kind: "satinlore-corpus-study-checkpoint", sourceBundleSha256: prepared.sourceBundleSha256,
    runId: "neutral-run", referenceVersion: VERSION, manifest, manifestHash, selectedRoles: ["detector"],
    plannedBatches: tasks.map(planRecord), attempts: [], batches: [], blockedUnitKeys: [], evidencePairPlan,
  };
  const validate = (...checkpoints) => validateEvidencePairResume(checkpoints.map(c => resumeDisposition(c, prepared)), evidencePairPlan, tasks, manifest, manifestHash);
  await validate(checkpoint);
  await assert.rejects(validate({...checkpoint, evidencePairPlan: {...evidencePairPlan, pairs: []}}), /evidence_pair_checkpoint_mismatch/);
  await assert.rejects(validate({...checkpoint, plannedBatches: [...checkpoint.plannedBatches].reverse()}), /evidence_pair_checkpoint_mismatch/);
  await assert.rejects(validate({...checkpoint, attempts: [{runId: "other", batchId: manifest[0]}]}), /evidence_pair_checkpoint_mismatch/);
  await assert.rejects(validate(checkpoint, {...checkpoint, runId: "other"}), /evidence_pair_checkpoint_mismatch/);
  await assert.rejects(validateEvidencePairResume([resumeDisposition(checkpoint, prepared)], null, tasks, manifest, manifestHash), /evidence_pair_checkpoint_mismatch/);
  const {evidencePairPlan: _pair, ...ordinary} = checkpoint;
  await assert.rejects(validate(ordinary), /evidence_pair_checkpoint_mismatch/);
  await validateEvidencePairResume([resumeDisposition(ordinary, prepared)], null, tasks, manifest, manifestHash);
});

test("an unknown baseline response holds the overlapping enrichment and exports its disposition", async t => {
  const {prepared, plan, sourceText} = await fixture();
  const {pairs: [pair]} = await buildEvidencePairTasks(prepared, plan);
  const elements = new Map(["source", "checkpoint", "adjudication", "evidence-pairs", "referenceA", "referenceB", "detector",
    "transition", "adjudicator", "consent", "concurrency", "prepare", "start", "reconcile", "pause", "download", "progress", "summary"]
    .map(name => [name, {addEventListener(type, handler) {this[type] = handler;}}]));
  const el = name => elements.get(name);
  el("source").files = [new File([sourceText], "source.json")];
  el("evidence-pairs").files = [new File([JSON.stringify(plan)], "pairs.json")];
  el("detector").checked = true;
  el("consent").checked = true;
  el("concurrency").value = 6;
  let downloaded;
  const globals = {document: {getElementById: el, createElement: () => ({click() {downloaded = resolveObjectURL(this.href);}})},
    window: {addEventListener() {}}};
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {value, configurable: true});
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const posted = [];
  t.mock.method(globalThis, "fetch", async (path, options) => {
    posted.push({path, body: JSON.parse(options.body)});
    return path.endsWith("/register") ? Response.json({registered: true}) : new Response("Temporary service error", {status: 503});
  });
  async function waitFor(pattern) {
    for (let i = 0; i < 200; i++) {
      if (pattern.test(el("progress").textContent)) return;
      await delay(5);
    }
    assert.match(el("progress").textContent, pattern);
  }
  corpusStudyClient();
  el("prepare").click();
  await waitFor(/Prepared 1 evidence pair \(2 batches\)/);
  assert.equal(posted.length, 0);
  el("start").click();
  await waitFor(/Paused after in-flight calls completed/);
  el("start").click();
  await waitFor(/Selected passes finished/);
  assert.deepEqual(posted.map(p => p.path.split("/").at(-1)), ["register", "batch"]);
  assert.deepEqual(posted[0].body.manifest, [pair.baselineBatchId, pair.enrichedBatchId]);
  assert.deepEqual(Object.keys(posted[1].body), ["runId", "batchHash", "batch", "sourceConsent"]);
  assert.equal(posted[1].body.batchHash, pair.baselineBatchId);
  el("download").click();
  const exported = await downloaded.text(), checkpoint = JSON.parse(exported);
  assert.deepEqual(checkpoint.evidencePairPlan.pairs, [pair]);
  assert.deepEqual(checkpoint.attempts.map(a => a.state), ["unknown", "held"]);
  assert.deepEqual(checkpoint.batches.map(b => b.status), ["unknown", "settlement_unknown"]);
  assert.doesNotMatch(exported, /catalogue|chair|page turned|Temporary service error/);
});
