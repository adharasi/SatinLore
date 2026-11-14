// Source-free evaluator controls, using the actual controller and simulator.
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {parseArgs} from "node:util";
import {replay} from "./replay-luna-protocol-simulator.mjs";
import {sha256} from "./lib/approved-beat-corpus.mjs";

export async function auditBoundaryControls(simulate = replay) {
  const results = [];
  for (const [id, pattern, playbackGate, hardBoundary] of [
    ["missed-profile-reset", "Sustain wave", "reset", false],
    ["missed-event-cut", "Taper", "active", true],
    ["compiled-reset", "Reset", "reset", true],
    ["active-control", "Sustain wave", "active", false],
  ]) {
    const work = {id, units: ["Onset rise", pattern].map((pattern, id) =>
      ({id, applied: {readerCue: true}, compiler: {pattern, beatAnchor: 0}}))};
    const pin = {id, units: [{behavior: {playbackGate: "active"}}, {behavior: {playbackGate}, hardBoundary}]};
    for (const wpm of [120, 240, 420]) for (const maximum of [10, 1, 0]) {
      const samples = [];
      const metrics = await simulate(work, pin, [8, 8], wpm, maximum, false, row => {
        if (row.index === 1) samples.push(row);
      });
      results.push({id, wpm, maximum, samples: samples.length,
        maximumTarget: Math.max(...samples.map(row => row.target)),
        maximumOutput: Math.max(...samples.map(row => row.output)),
        targetTraceSha256: sha256(JSON.stringify(samples.map(row => row.target))),
        outputTraceSha256: sha256(JSON.stringify(samples.map(row => row.output))),
        auditedHardTargets: metrics.authoritativeQuietTargets,
        hardViolations: metrics.authoritativeQuietViolations,
        hardTargetViolations: metrics.authoritativeQuietTargetViolations ?? null,
        hardOutputViolations: metrics.authoritativeQuietOutputViolations ?? null,
        commandViolations: metrics.commandViolations, pauseViolation: metrics.pauseViolation,
        capViolationMs: metrics.capViolationMs});
    }
  }
  return {schema: 1, measurement: "offline-neutral-evaluator-controls", sourceProseIncluded: false, externalCalls: 0,
    scope: "Deliberately incorrect compiler projections test detection, not recognition or a runtime repair.", results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values: {baseline}} = parseArgs({options: {baseline: {type: "string"}}});
  const simulate = baseline && (await import(pathToFileURL(resolve(baseline, "scripts/replay-luna-protocol-simulator.mjs")))).replay;
  process.stdout.write(`${JSON.stringify(await auditBoundaryControls(simulate), null, 2)}\n`);
}
