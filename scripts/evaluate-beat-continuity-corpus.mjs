import {createHash} from "node:crypto";
import {chmod, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {parseArgs} from "node:util";
import {buildReferenceCorpus, scoreBeatContinuityCorpus} from "./lib/beat-continuity-evaluation.mjs";
import {buildLunaSampleReference, scoreLunaSample} from "./lib/luna-sample-evaluation.mjs";

const usage = "Usage: node scripts/evaluate-beat-continuity-corpus.mjs --source PRIVATE_SOURCE --reference APPROVED_LABELS --candidate name=PRIVATE_PREDICTIONS [--candidate name=PRIVATE_PREDICTIONS] [--target-roster FROZEN_SAMPLE [--loom PRIVATE_LOOM]] [--output PRIVATE_REPORT] [--discrepancies]";
const candidateName = /^[a-z][a-z0-9-]{0,47}$/;

async function readJson(file, name) {
  try {
    const bytes = await readFile(file);
    return {data: JSON.parse(bytes), sha256: createHash("sha256").update(bytes).digest("hex")};
  } catch {
    throw new TypeError(`Could not read valid JSON for ${name}.`);
  }
}

async function run() {
  const {values} = parseArgs({options: {
    source: {type: "string"}, reference: {type: "string"}, candidate: {type: "string", multiple: true},
    output: {type: "string"}, discrepancies: {type: "boolean"},
    "target-roster": {type: "string"}, loom: {type: "string"},
  }});
  if (!values.source || !values.reference || !values.candidate?.length || values.discrepancies && !values.output ||
      values.loom && !values["target-roster"]) {
    throw new TypeError(usage);
  }
  const files = new Map();
  for (const argument of values.candidate) {
    const separator = argument.indexOf("=");
    const name = argument.slice(0, separator);
    const file = argument.slice(separator + 1);
    if (separator < 1 || !candidateName.test(name) || !file || files.has(name)) throw new TypeError(usage);
    files.set(name, file);
  }
  const inputPaths = [values.source, values.reference, ...files.values(), values["target-roster"], values.loom]
    .filter(Boolean).map(path => resolve(path));
  const output = values.output ? resolve(values.output) : null;
  if (inputPaths.includes(output)) throw new TypeError("The report cannot overwrite an input.");
  const [source, approved, roster, loom, ...candidates] = await Promise.all([
    readJson(values.source, "source"), readJson(values.reference, "reference"),
    values["target-roster"] ? readJson(values["target-roster"], "target roster") : null,
    values.loom ? readJson(values.loom, "Loom baseline") : null,
    ...[...files].map(([name, file]) => readJson(file, name)),
  ]);
  const reference = roster ? buildLunaSampleReference(source.data, approved.data, roster.data) :
    buildReferenceCorpus(source.data, approved.data);
  const options = {includeDiscrepancies: values.discrepancies, loom: loom?.data};
  const score = roster ? scoreLunaSample : scoreBeatContinuityCorpus;
  const comparisons = Object.fromEntries([...files.keys()].map((name, i) => [name, {
    candidateSha256: candidates[i].sha256,
    ...score(reference, candidates[i].data, options),
  }]));
  const report = {schema: roster ? "satinlore-luna-sample-evaluation-v1" : "satinlore-beat-continuity-evaluation-v1",
    cohort: roster ? reference.map(work => work.id) : reference.cohort,
    ...(roster ? {rosterSha256: roster.sha256} : {}), ...(loom ? {loomSha256: loom.sha256} : {}),
    sourceSha256: source.sha256, referenceSha256: approved.sha256, sourceProseIncluded: false,
    scoringExternalCalls: 0, comparisons};
  if (output) {
    await writeFile(output, JSON.stringify(report) + "\n", {mode: 0o600});
    await chmod(output, 0o600);
  }
  const printable = output ? {...report, comparisons: Object.fromEntries(Object.entries(comparisons).map(
    ([name, result]) => [name, {measurement: result.measurement, dimensions: result.dimensions, summary: result.summary,
      discrepancyCounts: result.discrepancyCounts}]))} : report;
  console.log(JSON.stringify(printable, null, 2));
}

try { await run(); }
catch (error) {
  console.error(error instanceof TypeError ? error.message : "Beat continuity evaluation failed.");
  process.exitCode = 1;
}
