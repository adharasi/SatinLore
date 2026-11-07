import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { corpusStudyClient } from "../deploy/cloudflare/corpus-study-client.mjs";
import { buildCorpusDiagnosticTrace } from "./lib/corpus-diagnostic-trace.mjs";
import { evaluateCueDiagnostics } from "./lib/cue-diagnostics.mjs";
import { privateOutput } from "./lib/private-study-output.mjs";

const usage = "Usage: node scripts/prepare-evidence-pairs.mjs --source APPROVED_SOURCE.json --reference FROZEN_REFERENCE.json " +
  "--checkpoint DETECTOR_CHECKPOINT.json --plan PRIVATE_PLAN.json --cohort PRIVATE_COHORT.json [--limit 12-150]";
const { prepareSource, buildEvidencePairTasks, digest, VERSION } = corpusStudyClient({ testOnly: true });
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const sourceOrder = (a, b) => a - b;
const keyFor = (work, id) => `${work}:${id}`;
const blockedEligibility = value => value?.status === "protected" || value?.adult === "minor" ||
  ["absent", "withdrawn"].includes(value?.consent) || value?.capacity === "absent";
const protectedReference = row => row && (["causal", "retrospective"].some(scope =>
  row[scope]?.activation === "protected" || blockedEligibility(row.scopeEligibility?.[scope])) || blockedEligibility(row.eligibility));

function balanceByWork(cases) {
  const groups = new Map();
  for (const item of cases) {
    const group = groups.get(item.pair.workId) ?? [];
    group.push(item);
    groups.set(item.pair.workId, group);
  }
  const balanced = [];
  const largest = Math.max(0, ...[...groups.values()].map(group => group.length));
  for (let i = 0; i < largest; i++) for (const group of groups.values()) if (group[i]) balanced.push(group[i]);
  return balanced;
}

function validateBinding(prepared, reference, checkpoint) {
  const { referenceSha256, ...referenceFields } = reference;
  const manifest = checkpoint.manifest;
  if (!reference.frozenSnapshot || reference.sourceProseIncluded !== false || reference.rubricVersion !== VERSION ||
      !hash(referenceSha256) || sha(JSON.stringify(referenceFields)) !== referenceSha256 ||
      checkpoint.kind !== "satinlore-corpus-study-checkpoint" || checkpoint.referenceVersion !== VERSION ||
      checkpoint.sourceBundleSha256 !== prepared.sourceBundleSha256 ||
      JSON.stringify(checkpoint.selectedRoles) !== '["detector"]' || checkpoint.evidencePairPlan ||
      !Array.isArray(manifest) || !manifest.length || !manifest.every(hash) ||
      new Set(manifest).size !== manifest.length || sha(JSON.stringify(manifest)) !== checkpoint.manifestHash ||
      !Array.isArray(checkpoint.plannedBatches) || !Array.isArray(checkpoint.batches) ||
      !Array.isArray(checkpoint.attempts) || !Array.isArray(checkpoint.workRoster) ||
      !Array.isArray(checkpoint.blockedUnitKeys) || !Array.isArray(checkpoint.heldUnitKeys) ||
      ![...checkpoint.blockedUnitKeys, ...checkpoint.heldUnitKeys].every(hash)) throw new TypeError("unbound inputs");

  const pinned = new Set(manifest);
  const sameManifest = rows => rows.length === pinned.size &&
    new Set(rows.map(row => row.batchId)).size === pinned.size &&
    rows.every(row => row.role === "detector" && pinned.has(row.batchId));
  if (!sameManifest(checkpoint.plannedBatches) || !sameManifest(checkpoint.batches) || !sameManifest(checkpoint.attempts) ||
      checkpoint.attempts.some(row => row.runId !== checkpoint.runId || row.state === "sending")) {
    throw new TypeError("unfinished detector checkpoint");
  }
  const roster = new Map(checkpoint.workRoster.map(work => [work.workId, work]));
  const refs = new Map(reference.works.map(work => [work.id, work]));
  if (prepared.works.length !== roster.size || prepared.works.length !== refs.size ||
      prepared.works.some(work => {
        const source = roster.get(work.id), ref = refs.get(work.id);
        return source?.sourceSha256 !== work.sourceSha256 || source?.indexSha256 !== work.indexSha256 ||
          source?.sourceUnitSha256 !== work.sourceUnitSha256 || ref?.sourceSha256 !== work.sourceSha256 ||
          ref?.indexSha256 !== work.indexSha256 || ref?.sourceUnitSha256 !== work.sourceUnitSha256;
      })) throw new TypeError("source identity mismatch");
}

function contiguousPrefix(work, excluded, reference) {
  const prefixes = new Map();
  let segment = [];
  let previousId = null;
  for (const unit of work.units) {
    if (previousId !== null && unit.id !== previousId + 1) segment = [];
    previousId = unit.id;
    const row = reference.get(unit.id);
    if (unit.structuralBoundary || unit.admission !== "approved" || excluded.has(unit.unitKey) ||
        row && row.unitSha256 !== unit.unitSha256 || protectedReference(row)) {
      segment = [];
      continue;
    }
    prefixes.set(unit.id, { segment, end: segment.length });
    segment.push(unit.id);
  }
  return prefixes;
}

function makeCase(work, row, prefix, stratum) {
  if (!prefix) return null;
  const targetId = row.unitId;
  const preceding = prefix.segment.slice(0, prefix.end);
  const available = new Set(preceding);
  const narrative = row.expected.evidenceIds.filter(id => id !== targetId);
  const eligibility = row.expectedEligibility?.evidenceIds.filter(id => id !== targetId) ?? [];
  const additions = stratum === "missing-anchor" ? row.eligibilityEvidenceCoverage.missingRequiredIds : [];
  const required = [...new Set([...narrative, ...eligibility])];
  if (additions.length > 3 || required.some(id => !available.has(id)) || additions.some(id => !available.has(id))) return null;
  const addSet = new Set(additions);
  const common = new Set(required.filter(id => !addSet.has(id)));
  if (common.size > 5) return null;
  for (let i = preceding.length - 1; i >= 0 && common.size < 5; i--) {
    if (!addSet.has(preceding[i])) common.add(preceding[i]);
  }
  if (common.size !== 5) return null;
  const addedContextIds = [...additions];
  if (!addedContextIds.length) {
    // More earlier context on controls. No reference eligibility anchor differs.
    const extra = preceding.findLast(id => !common.has(id));
    if (extra === undefined) return null;
    addedContextIds.push(extra);
  }
  const expected = stratum === "negative-control" ? "no-cue" : "cue";
  return {
    pair: { workId: work.id, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256,
      targetId, baselineContextIds: [...common].sort(sourceOrder), addedContextIds: addedContextIds.sort(sourceOrder) },
    reference: { workId: work.id, targetId, expected, stratum,
      ...(row.transitionReferenceResolved ? { expectedTransition: row.expected.transition } : {}) },
  };
}

export async function prepareEvidencePairs({ sourceText, reference, checkpoint, limit = 150 }) {
  if (!Number.isInteger(limit) || limit < 12 || limit > 150) throw new TypeError("invalid limit");
  const prepared = await prepareSource(sourceText);
  validateBinding(prepared, reference, checkpoint);
  const trace = buildCorpusDiagnosticTrace({ reference, checkpoint });
  const diagnostics = evaluateCueDiagnostics({ reference, trace, scope: "causal" });
  const excluded = new Set([...checkpoint.heldUnitKeys, ...checkpoint.blockedUnitKeys]);
  const refs = new Map(reference.works.map(work => [work.id, new Map(work.labels.map(row => [row.id, row]))]));
  const works = new Map(prepared.works.map(work => [work.id, work]));
  const prefixes = new Map(prepared.works.map(work => [work.id, contiguousPrefix(work, excluded, refs.get(work.id))]));
  const strata = { "missing-anchor": [], "anchor-complete": [], "negative-control": [] };
  const considered = Object.fromEntries(Object.keys(strata).map(stratum => [stratum, 0]));
  for (const row of diagnostics.rows) {
    if (!row.referenceResolved || row.eligibilityEvidenceCoverage.basis !== "provider-attempt-window") continue;
    let stratum;
    if (row.cueResult === "missed" && ["model-negative", "model-uncertain"].includes(row.diagnosis?.reason) &&
        row.expectedEligibility?.status === "eligible") {
      stratum = row.eligibilityEvidenceCoverage.missingRequiredIds.length ? "missing-anchor" : "anchor-complete";
    } else if (row.cueResult === "correct-negative" && row.expected.activation === "context" &&
        row.expected.depiction === "neutral" && row.expected.interaction === "none") stratum = "negative-control";
    if (!stratum) continue;
    considered[stratum]++;
    const item = makeCase(works.get(row.workId), row, prefixes.get(row.workId).get(row.unitId), stratum);
    if (item) strata[stratum].push(item);
  }
  const maxPositive = Math.floor(limit * 0.85);
  const missing = balanceByWork(strata["missing-anchor"]), complete = balanceByWork(strata["anchor-complete"]);
  const missingCount = Math.min(missing.length, Math.max(Math.ceil(maxPositive / 2), maxPositive - complete.length));
  const positives = [...missing.slice(0, missingCount), ...complete.slice(0, maxPositive - missingCount)];
  // Interleave different works so a pilot's first completed batches cover more than one work.
  const positiveWorks = new Set(positives.map(item => item.pair.workId));
  const controls = balanceByWork(strata["negative-control"]).sort((a, b) =>
    Number(positiveWorks.has(b.pair.workId)) - Number(positiveWorks.has(a.pair.workId))).slice(0, limit - positives.length);
  const selected = balanceByWork([...positives, ...controls]);
  if (!selected.length) throw new TypeError("no matched cases");

  const sourceBundleSha256 = prepared.sourceBundleSha256;
  const plan = { schema: 1, kind: "satinlore-evidence-pair-plan", sourceBundleSha256, pairs: selected.map(item => item.pair) };
  const checked = await buildEvidencePairTasks(prepared, plan);
  if (checked.tasks.length !== selected.length * 2 || checked.tasks.some(task => task.unitKeys.some(key => excluded.has(key)))) {
    throw new TypeError("plan crosses a prior transport hold");
  }
  const planSha256 = await digest({ ...plan, pairs: checked.pairs });
  const cohort = { schema: 1, kind: "satinlore-evidence-pair-cohort", sourceBundleSha256, planSha256,
    referenceSha256: reference.referenceSha256, cases: selected.map(item => item.reference) };
  const summary = {
    cases: selected.length, plannedCalls: checked.tasks.length, sourceProseIncluded: false,
    measurement: "offline-pair-plan-preflight",
    strata: Object.fromEntries(Object.entries(strata).map(([stratum, cases]) => {
      const chosen = selected.filter(item => item.reference.stratum === stratum);
      return [stratum, { considered: considered[stratum], feasible: cases.length, selected: chosen.length,
        selectedWorks: new Set(chosen.map(item => item.pair.workId)).size }];
    })),
    planSha256,
  };
  return { plan, cohort, summary };
}

async function readBounded(path, maxBytes) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new TypeError("invalid input size");
    const bytes = Buffer.alloc(info.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) throw new TypeError("input changed during read");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, bytesRead));
  } finally { await file.close(); }
}

async function main(args) {
  const flags = new Set(["--source", "--reference", "--checkpoint", "--plan", "--cohort", "--limit"]);
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = args.slice(i, i + 2);
    if (!flags.has(flag) || !value || value.startsWith("--") || options.has(flag)) throw new TypeError("invalid arguments");
    options.set(flag, value);
  }
  if (["--source", "--reference", "--checkpoint", "--plan", "--cohort"].some(key => !options.has(key))) throw new TypeError("invalid arguments");
  const [planPath, cohortPath] = await Promise.all(["--plan", "--cohort"].map(key => privateOutput(options.get(key))));
  if (planPath === cohortPath) throw new TypeError("separate output files required");
  const mib = 1024 * 1024;
  const [sourceText, reference, checkpoint] = await Promise.all([
    readBounded(options.get("--source"), 8 * mib),
    readBounded(options.get("--reference"), 256 * mib).then(JSON.parse),
    readBounded(options.get("--checkpoint"), 64 * mib).then(JSON.parse),
  ]);
  const result = await prepareEvidencePairs({ sourceText, reference, checkpoint, limit: Number(options.get("--limit") ?? "150") });
  const created = [];
  try {
    for (const [path, value] of [[planPath, result.plan], [cohortPath, result.cohort]]) {
      const file = await open(path, "wx", 0o600);
      created.push(path);
      try { await file.writeFile(JSON.stringify(value) + "\n"); } finally { await file.close(); }
    }
  } catch (error) {
    await Promise.allSettled(created.map(path => unlink(path)));
    throw error;
  }
  console.log(JSON.stringify(result.summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)); }
  catch {
    console.error("Could not prepare an exact paired plan. Check completed checkpoint, source and reference identity, and fresh private output paths.\n" + usage);
    process.exitCode = 1;
  }
}
