import {readFile, writeFile, chmod} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {evaluateCueDiagnostics} from "./lib/cue-diagnostics.mjs";
import {buildCorpusDiagnosticTrace} from "./lib/corpus-diagnostic-trace.mjs";

export async function main(args) {
  const options = {};
  if (args.length % 2) throw new TypeError("Invalid arguments.");
  for (let index = 0; index < args.length; index += 2) {
    const field = {"--reference": "reference", "--trace": "trace", "--checkpoint": "checkpoint", "--role": "role",
      "--scope": "scope", "--output": "output", "--errors": "errors"}[args[index]];
    if (!field || options[field] !== undefined || !args[index + 1]) throw new TypeError("Invalid arguments.");
    options[field] = args[index + 1];
  }
  if (!options.reference || Boolean(options.trace) === Boolean(options.checkpoint) || !options.output ||
      ![undefined, "causal", "retrospective"].includes(options.scope) ||
      options.role && (!options.checkpoint || !["detector", "transition"].includes(options.role))) {
    throw new TypeError("Invalid arguments.");
  }
  const paths = [options.reference, options.trace ?? options.checkpoint, options.output, options.errors].filter(Boolean).map(path => resolve(path));
  if (new Set(paths).size !== paths.length) throw new TypeError("Diagnostic input and output paths must differ.");
  const [reference, input] = await Promise.all(paths.slice(0, 2).map(async path => JSON.parse(await readFile(path, "utf8"))));
  const trace = options.trace ? input : buildCorpusDiagnosticTrace({reference, checkpoint: input, role: options.role});
  const result = evaluateCueDiagnostics({reference, trace, scope: options.scope});
  await writeFile(options.output, JSON.stringify(result, null, 2) + "\n", {mode: 0o600});
  await chmod(options.output, 0o600);
  if (options.errors) {
    const errors = result.rows.filter(row => ["missed", "extra"].includes(row.cueResult) ||
      ["missed", "extra", "wrong-type"].includes(row.transitionResult) ||
      result.depiction.measured && (row.depictionResult.graphicMiss || row.depictionResult.explicitOrGraphicMiss));
    await writeFile(options.errors, errors.map(row => JSON.stringify(row)).join("\n") + (errors.length ? "\n" : ""), {mode: 0o600});
    await chmod(options.errors, 0o600);
  }
  return {measurement: result.measurement, datasetId: result.datasetId, runId: result.runId,
    scope: result.scope, summary: result.summary, errorRows: result.indexes.missedCues.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch {
    console.error("Cue diagnostics failed. Check source hashes, reference version and trace schema. Use --reference FILE (--trace FILE | --checkpoint FILE) --scope causal|retrospective --output FILE.");
    process.exitCode = 1;
  }
}
