import {readFile} from "node:fs/promises";
import {parseArgs} from "node:util";
import {combineNeutralReports} from "./lib/luna-protocol-neutral.mjs";

const incompatible = "Use complementary complete and windowed reports with the same fixture pins, rubric and measurement.";
const usage = "Use --complete path twice and --windowed path twice.";
const observedCue = value => typeof value === "boolean" ? value : undefined;

function exact(rows, arm, negative) {
  const matched = rows.filter(row => row.expected !== negative && row[arm] === row.expected).length;
  const extra = rows.filter(row => row[arm] !== undefined && row[arm] !== negative && row[arm] !== row.expected).length;
  const positives = rows.filter(row => row.expected !== negative).length;
  return {targets: rows.length, positives, observed: rows.filter(row => row[arm] !== undefined).length,
    matched, missed: positives - matched, extra};
}

function pairMetric(works, expectedValue, predictedValue, negative) {
  const rows = works.flatMap(({id, complete, windowed}) => complete.map((row, i) => ({id, unit: row.id,
    expected: expectedValue(row), complete: predictedValue(row), windowed: predictedValue(windowed[i])})));
  const common = rows.filter(row => row.complete !== undefined && row.windowed !== undefined);
  const pair = sample => Object.fromEntries(["complete", "windowed"].map(arm => [arm, exact(sample, arm, negative)]));
  return {allTargets: pair(rows), commonObserved: pair(common),
    differences: rows.filter(row => row.complete !== row.windowed).map(row => ({...row,
      complete: row.complete ?? null, windowed: row.windowed ?? null}))};
}

export function compareNeutralArms(completeReports, windowedReports) {
  const complete = combineNeutralReports(completeReports);
  const windowed = combineNeutralReports(windowedReports);
  const keys = ["fixtureDigest", "fixtureRosterSha256", "rubricVersion", "segmentationVersion", "verificationContext", "measurement", "model",
    "behaviorReferenceVersion", "behaviorReferenceDigest"];
  if (complete.arm !== "complete" || windowed.arm !== "windowed" || keys.some(key => complete[key] !== windowed[key])) {
    throw new TypeError(incompatible);
  }
  const works = complete.diagnostics.map(({id, units}, i) => ({id, complete: units, windowed: windowed.diagnostics[i].units}));
  const boundaries = new Set(complete.boundaryDefinition.types);
  const boundary = value => !value || value === "unknown" ? undefined : boundaries.has(value) ? value : "none";
  const cue = select => pairMetric(works, row => row.expected.cue, row => observedCue(select(row)), false);
  const measureBoundary = select => pairMetric(works, row => boundary(row.expected.transition), row => boundary(select(row)), "none");
  const behavior = complete.behaviorReferenceDigest ? Object.fromEntries(["narrativeBuildup", "directEnacted", "continuation"]
    .map(field => [field, Object.fromEntries(["prefix", "applied"].map(stage => [stage,
      pairMetric(works, row => row.expected.behavior[field] && (stage !== "applied" || row.expected.behavior.playbackGate === "active"),
        row => observedCue(row.behavior[stage][field]), false)]))])) : null;
  return {...Object.fromEntries(keys.map(key => [key, complete[key]])), fixtureIds: complete.fixtureIds,
    sourceProseIncluded: false, independentCorpusBenchmark: false,
    comparison: {
      discoveryCue: cue(row => row.discovery.cue), primaryCue: cue(row => row.prefix.cue),
      appliedReaderCue: cue(row => row.applied.readerCue), typedBoundary: measureBoundary(row => row.transition.transition),
      appliedBoundary: measureBoundary(row => row.applied.transition),
      ...(behavior ? {behavior, playbackGate: pairMetric(works, () => true,
        row => observedCue(row.behavior.playbackGate.matches), false)} : {}),
    },
    arms: {complete, windowed}};
}

async function main() {
  const {values} = parseArgs({options: {complete: {type: "string", multiple: true}, windowed: {type: "string", multiple: true}}});
  if (values.complete?.length !== 2 || values.windowed?.length !== 2) throw new Error(usage);
  const read = paths => Promise.all(paths.map(async path => JSON.parse(await readFile(path, "utf8"))));
  const [complete, windowed] = await Promise.all([read(values.complete), read(values.windowed)]);
  console.log(JSON.stringify(compareNeutralArms(complete, windowed), null, 2));
}

if (import.meta.main) {
  try { await main(); }
  catch (error) {
    console.error([usage, incompatible].includes(error.message) ? error.message : "The neutral arm reports could not be compared.");
    process.exitCode = 1;
  }
}
