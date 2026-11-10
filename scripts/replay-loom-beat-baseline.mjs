import {createHash} from "node:crypto";
import {chmod, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {traceCurrentReaderCorpus} from "./lib/current-reader-diagnostics.mjs";

const d2Ids = Array.from({length: 10}, (_, index) => `d2-${String(index + 1).padStart(2, "0")}`);
const digest = value => createHash("sha256").update(value).digest("hex");
const pinned = new Set(d2Ids);
const paths = process.argv.slice(2).map(path => resolve(path));

async function run() {
  if (paths.length !== 3 || new Set(paths).size !== paths.length) throw new TypeError("Invalid arguments.");
  const [sourceBytes, paragraphBytes] = await Promise.all(paths.slice(0, 2).map(path => readFile(path)));
  const source = JSON.parse(sourceBytes), paragraphs = JSON.parse(paragraphBytes);
  const select = input => ({...input, works: input.works.filter(work => pinned.has(work.id))});
  const selected = select(source), sidecar = select(paragraphs);
  if (selected.works.length !== pinned.size || selected.works.some(work => work.family !== "storyDump2") ||
      !d2Ids.every(id => selected.works.some(work => work.id === id))) throw new TypeError("Expected the ten pinned D2 works.");

  const {loom, summary} = traceCurrentReaderCorpus(selected, sidecar, {runId: "d2-loom-beat-baseline"});
  const sources = new Map(selected.works.map(work => [work.id, new Map(work.units.map(unit => [unit.id, unit]))]));
  const summaries = new Map(summary.rows.map(work => [work.id, work]));
  const works = loom.works.map(work => {
    const sourceUnits = sources.get(work.id), counts = summaries.get(work.id);
    return {id: work.id, sourceSha256: work.sourceSha256, indexSha256: work.indexSha256,
      readerEditionSha256: work.readerEditionSha256, textUnits: counts.targets, structuralUnits: counts.structuralUnits,
      projectedPositiveUnits: counts.projectedPositiveTargets,
      units: work.units.map(row => {
        const unit = sourceUnits.get(row.id);
        return {id: row.id, unitSha256: row.unitSha256, paragraph: row.paragraph,
          startUtf16InParagraph: unit.start, endUtf16InParagraph: unit.end, status: row.status,
          cue: row.applied.causal.activation === "cue", phase: row.local.phase,
          rawCue: row.proposed.causal.activation === "cue", local: row.local,
          ...(row.failureCode ? {failureCode: row.failureCode} : {})};
      })};
  });
  const codeFiles = ["app/static/reader/model.mjs", "app/static/reader/scoring.mjs",
    "app/static/reader/scene-map.mjs", "app/static/reader/import.mjs", "scripts/lib/current-reader-diagnostics.mjs",
    "scripts/replay-loom-beat-baseline.mjs"];
  const codeSha256 = Object.fromEntries(await Promise.all(codeFiles.map(async file =>
    [file, digest(await readFile(new URL(`../${file}`, import.meta.url)))])));
  const output = {schema: 1, measurement: "offline-loom-paragraph-projection", externalCalls: 0,
    sourceProseIncluded: false, referenceUsedForPrediction: false, analysisVersion: summary.analysisVersion,
    predictionVersion: loom.predictionVersion, sourcePackSha256: digest(sourceBytes), paragraphSidecarSha256: digest(paragraphBytes),
    runtime: {node: process.versions.node, icu: process.versions.icu}, codeSha256, supportedPredictionFields: ["cue", "phase"],
    phaseProjection: "native-loom-paragraph-phase", limits: ["cue-and-phase-are-paragraph-projections", "no-provider-or-playback-measurement"],
    counts: {works: summary.works, textUnits: summary.targets, structuralUnits: summary.structuralUnits,
      projectedPositiveUnits: summary.projectedPositiveTargets}, works};
  await writeFile(paths[2], JSON.stringify(output) + "\n", {mode: 0o600});
  await chmod(paths[2], 0o600);
  console.log(JSON.stringify({measurement: output.measurement, analysisVersion: output.analysisVersion, ...output.counts}));
}

try { await run(); }
catch {
  console.error("Loom baseline failed. Use PRIVATE_SOURCE_PACK PRIVATE_PARAGRAPH_SIDECAR OUTPUT_JSON with the original D2 pins.");
  process.exitCode = 1;
}
