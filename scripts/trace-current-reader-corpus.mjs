import {readFile, writeFile, chmod} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {traceCurrentReaderCorpus} from "./lib/current-reader-diagnostics.mjs";

const args = process.argv.slice(2);
if (args.length < 3 || args.length % 2 !== 1) throw new Error("Use node scripts/trace-current-reader-corpus.mjs PRIVATE_PACK PARAGRAPH_SIDECAR OUTPUT_STEM [--reference-version VERSION] [--dataset-id ID] [--run-id ID].");
const names = {"--reference-version": "referenceVersion", "--dataset-id": "datasetId", "--run-id": "runId"};
const options = {};
for (let index = 3; index < args.length; index += 2) {
  const name = names[args[index]];
  if (!name || Object.hasOwn(options, name)) throw new Error("Use each declared trace option once.");
  options[name] = args[index + 1];
}
const [pack, paragraphs] = await Promise.all(args.slice(0, 2).map(async path => JSON.parse(await readFile(resolve(path), "utf8"))));
const result = traceCurrentReaderCorpus(pack, paragraphs, options);
const digest = value => createHash("sha256").update(value).digest("hex");
const files = ["app/static/reader/model.mjs", "app/static/reader/scoring.mjs", "app/static/reader/nocturne.mjs",
  "app/static/reader/nocturne-context-contract.mjs", "app/static/reader/scene-map.mjs", "app/static/reader/import.mjs",
  "scripts/lib/current-reader-diagnostics.mjs", "scripts/trace-current-reader-corpus.mjs"];
const sourceCodeSha256 = Object.fromEntries(await Promise.all(files.map(async file =>
  [file, digest(await readFile(new URL(`../${file}`, import.meta.url)))])));
const provenance = {runtime: {node: process.versions.node, icu: process.versions.icu}, sourceCodeSha256,
  inputSha256: {privatePack: digest(await readFile(resolve(args[0]))), paragraphSidecar: digest(await readFile(resolve(args[1])))}};
for (const [name, value] of Object.entries(result)) {
  value.provenance = provenance;
  const path = `${resolve(args[2])}.${name}.json`;
  await writeFile(path, JSON.stringify(value) + "\n", {mode: 0o600});
  await chmod(path, 0o600);
}
console.log(JSON.stringify({measurement: result.summary.measurement, works: result.summary.works,
  targets: result.summary.targets, projectedPositiveTargets: result.summary.projectedPositiveTargets,
  contextSelectedTargets: result.summary.contextSelectedTargets, cueSelectedTargets: result.summary.cueSelectedTargets,
  externalCalls: 0}));
