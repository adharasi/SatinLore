import assert from "node:assert/strict";
import test from "node:test";
import {runPlaybackContinuityComparison} from "../scripts/playback-continuity-trace.mjs";

test("the neutral dispatched trace preserves zeros, finite commands, caps and explicit restart in every condition", async () => {
  const report = await runPlaybackContinuityComparison();
  assert.equal(report.conditions.matchedMeanOutput, false);
  for (const {name, frames, commands, metrics} of report.results) {
    const during = (start, end) => frames.filter(frame => frame.atMs >= start && frame.atMs < end);
    assert.equal(metrics.capViolations, 0, name);
    assert.ok(commands.filter(command => command.type === "command").every(command => command.seconds === 2), name);
    for (const [start, end] of [[95_100, 110_100], [120_100, 130_100], [140_100, 150_100], [160_100, 170_000]]) {
      assert.ok(during(start, end).every(frame => frame.output === 0), `${name} authoritative zero at ${start}`);
    }
    assert.ok(during(140_100, 150_100).every(frame => !frame.running), `${name} pause remains paused`);
    assert.ok(during(155_100, 160_100).every(frame => frame.output <= 2), `${name} lower cap wins immediately`);
    assert.ok(during(0, 70_000).every(frame => frame.running), `${name} long dwell does not expire early`);
    assert.ok(metrics.uniqueDispatchedLevels.length > 0, name);
    assert.ok(metrics.longestPositiveTargetGapMs <= 1000, `${name} bounded dispatch resumes on its normal cadence`);
  }
  const previous = report.results.find(result => result.name === "story-following");
  const defaults = report.results.find(result => result.name === "first-use-defaults");
  assert.ok(new Set(defaults.frames.filter(frame => frame.atMs < 68_000).map(frame => frame.output)).size > 1,
    "First-use scene rhythm preserves the source carrier's variation outside peaks.");
  assert.deepEqual([...new Set(defaults.frames.filter(frame => frame.atMs >= 84_000 && frame.atMs < 95_000)
    .map(frame => frame.output))], [7], "The default peak remains steady after the bounded return ramp.");
  const compatibleBoundary = previous.metrics.boundaryChanges.find(boundary => boundary.atMs === 68_100);
  assert.equal(compatibleBoundary.beforeStageStartedAt, compatibleBoundary.afterStageStartedAt,
    "Compatible repeating paragraphs retain their carrier phase despite a different local rhythm label.");
  const connector = result => result.frames.filter(frame => frame.atMs >= 71_000 && frame.atMs < 80_000);
  assert.ok(connector(previous).every(frame => frame.output === 0));
  assert.ok(connector(defaults).every(frame => frame.output === 1));
  assert.ok(defaults.metrics.zeroOutputWhilePlayingMs < previous.metrics.zeroOutputWhilePlayingMs);
  assert.ok(defaults.metrics.positiveTargetButZeroOutputMs > 0,
    "A lower positive target still invokes the existing immediate Stop before the next normal dispatch.");
});
