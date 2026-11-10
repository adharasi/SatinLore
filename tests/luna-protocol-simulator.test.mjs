import assert from "node:assert/strict";
import test from "node:test";
import {runLunaProtocolSimulator} from "../scripts/replay-luna-protocol-simulator.mjs";
import {runLunaProtocolNeutral} from "../scripts/lib/luna-protocol-neutral.mjs";

test("neutral sentence projections dispatch finite simulator output and preserve authoritative zeros", async () => {
  const report = await runLunaProtocolSimulator();
  assert.equal(report.sourceProseIncluded, false);
  assert.equal(report.device, "lush");
  assert.equal(report.results.length, 18);
  for (const {calibration, summary} of report.results) {
    assert.equal(summary.capViolationMs, 0);
    assert.equal(summary.commandViolations, 0);
    assert.equal(summary.pauseViolation, 0);
    assert.ok(summary.authoritativeQuietTargets >= 3);
    assert.equal(summary.authoritativeQuietViolations, 0);
    if (calibration !== "default") assert.equal(summary.contrastEpisodes, 0);
    if (calibration === "zero") assert.equal(summary.dispatchCount, 0);
  }
  const isolated = report.results.find(row => row.lane === "reference-projection" && row.wpm === 240 && row.calibration === "default");
  assert.ok(isolated.summary.contrastEpisodes > 0);
  assert.equal(isolated.summary.contrastRate, 1);
  assert.ok(isolated.summary.p95FirstDispatchMs <= 1000);
  const fast = report.results.find(row => row.lane === "reference-projection" && row.wpm === 420 && row.calibration === "default");
  assert.ok(fast.summary.contrastEpisodes > 0);
  assert.equal(fast.summary.contrastRate, 1);
});

test("simulator replay rejects reports without exact neutral fixture and compiler pins", async () => {
  const report = await runLunaProtocolNeutral({mode: "mock", fixtureIds: ["first-dance"]});
  for (const invalid of [
    {...report, sourceProseIncluded: true},
    {...report, fixtureDigest: "0".repeat(64)},
    {...report, diagnostics: [{...report.diagnostics[0], units: report.diagnostics[0].units.slice(1)}]},
  ]) await assert.rejects(runLunaProtocolSimulator({reports: [invalid]}), /source-free report/u);
  await assert.rejects(runLunaProtocolSimulator({reports: [report, report]}), /source-free report/u);
});
