import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {runLunaProtocolNeutral} from "../scripts/lib/luna-protocol-neutral.mjs";
import {wholeStoryAnnotationFixtures} from "./whole-story-annotation-fixtures.mjs";

const cli = fileURLToPath(new URL("../scripts/run-luna-protocol-neutral.mjs", import.meta.url));
const now = () => 100;

test("default CLI plans the 33 neutral targets without a provider even if a key is present", () => {
  const output = execFileSync(process.execPath, [cli], {encoding: "utf8",
    env: {...process.env, OPENAI_API_KEY: "unused-fixture-key"}});
  const report = JSON.parse(output);
  assert.equal(report.measurement, "offline-planning");
  assert.equal(report.independentCorpusBenchmark, false);
  assert.equal(report.sourceProseIncluded, false);
  assert.equal(report.externalCalls, 0);
  assert.equal(report.planning.referenceTargets, 33);
  assert.equal(report.planning.admittedTargets, 33);
  assert.equal(report.planning.plannedTargets, 33);
  assert.equal(report.planning.plannedDiscoveryWindows, 10);
  assert.equal(report.budget.attempts, 0);
  for (const stage of [report.discovery, report.prefix]) {
    assert.equal(stage.returnedTargets, 0);
    assert.equal(stage.observedTargets, 0);
    assert.equal(stage.exactCues.missed, 10);
  }
  assert.equal(report.discovery.exactTypedTransitions.missed, 7);
  assert.equal(report.transition.exactTypedTransitions.missed, 7);
  assert.equal(report.prefix.exactTypedTransitions, undefined);
  assert.equal(report.transition.exactCues, undefined);
  assert.equal(report.diagnostics.flatMap(work => work.units).length, 33);
  assert.equal(report.diagnostics[0].units[0].discovery.submittedIds, null);
  assert.deepEqual(report.diagnostics[0].units[0].transition.reasons, ["disposition:not-requested"]);
  for (const fixture of wholeStoryAnnotationFixtures) {
    for (const paragraph of fixture.paragraphs) assert.equal(output.includes(paragraph), false);
  }
});

test("reference mock exercises all pinned cues and typed events in each arm", async () => {
  for (const arm of ["windowed", "complete"]) {
    const report = await runLunaProtocolNeutral({mode: "mock", arm, now});
    assert.equal(report.arm, arm);
    assert.equal(report.measurement, "offline-reference-mock");
    assert.equal(report.externalCalls, 0);
    assert.equal(report.planning.discoveryAttempts, arm === "windowed" ? 10 : 4);
    assert.equal(report.planning.prefixAttempts, 33);
    assert.equal(report.planning.transitionAttempts, 33);
    for (const stage of [report.discovery, report.prefix]) {
      assert.equal(stage.returnedTargets, 33);
      assert.equal(stage.observedTargets, 33);
      assert.deepEqual(stage.exactCues, {matched: 10, missed: 0, extra: 0, precision: 1, recall: 1});
    }
    for (const stage of [report.discovery, report.transition]) {
      assert.equal(stage.returnedTargets, 33);
      assert.deepEqual(stage.exactTypedTransitions, {matched: 7, missed: 0, extra: 0, precision: 1, recall: 1});
    }
    const stop = report.diagnostics[0].units[7];
    assert.equal(stop.expected.transition, "hard-stop");
    assert.equal(stop.transition.transition, "hard-stop");
    assert.equal(stop.prefix.transition, undefined);
    assert.deepEqual(stop.transition.citedIds, [7]);
    assert.ok(stop.transition.submittedIds.includes(7));
    assert.equal(report.prefix.usage.measuredUsage, 33);
  }
});

test("discovery, cue-prefix, and transition-only results are scored independently", async () => {
  const provider = async ({mode, targetIds}) => ({status: "ok", facts: targetIds.map(unitId => {
    const proposal = mode === "discovery" && unitId === 0;
    const typed = mode === "transition" && unitId === 0;
    return {unitId, status: proposal ? "candidate" : typed ? "verified" : "neutral",
      depiction: proposal ? "romantic" : mode === "transition" ? "unknown" : "neutral",
      frame: "current", narrativePhase: proposal ? "build" : mode === "transition" ? "unknown" : "quiet",
      transition: proposal || typed ? "scene-cut" : "none",
      action: proposal ? "anticipation" : mode === "transition" ? "unknown" : "none",
      fact: typed ? "cut" : "none", scopeId: null, priorAnchor: null, evidenceIds: proposal || typed ? [unitId] : []};
  }), usage: {inputTokens: 0, outputTokens: 0}});
  const report = await runLunaProtocolNeutral({mode: "mock", provider, now});
  assert.equal(report.measurement, "offline-injected-mock");
  assert.equal(report.externalCalls, 0);
  assert.equal(report.discovery.exactCues.extra, 4);
  assert.equal(report.discovery.exactTypedTransitions.extra, 4);
  assert.equal(report.prefix.exactCues.extra, 0);
  assert.equal(report.prefix.exactTypedTransitions, undefined);
  assert.equal(report.transition.exactCues, undefined);
  assert.equal(report.transition.exactTypedTransitions.extra, 4);
  const row = report.diagnostics[0].units[0];
  assert.deepEqual(row.discovery.reasons, ["extra-cue", "phase-mismatch", "extra-transition"]);
  assert.deepEqual(row.prefix.reasons, []);
  assert.deepEqual(row.transition.reasons, ["extra-transition"]);
});

test("a capped transition stage retains the planned denominator and marks deferred rows", async () => {
  const report = await runLunaProtocolNeutral({mode: "mock", arm: "complete", now, transitionLimit: 15, maxAttempts: 52});
  assert.equal(report.budget.attempts, 52);
  assert.equal(report.planning.transitionAttempts, 15);
  assert.equal(report.transition.targets, 33);
  assert.equal(report.transition.observedTargets, 15);
  assert.equal(report.transition.dispositions["not-requested"], 18);
  assert.equal(report.diagnostics.flatMap(work => work.units).filter(row => row.transition.dispatched).length, 15);
  assert.equal(report.transition.exactTypedTransitions.matched + report.transition.exactTypedTransitions.missed, 7);
  const hardStop = report.diagnostics[0].units.find(row => row.expected.transition === "hard-stop");
  assert.equal(hardStop.compiler.pattern, "Stop");
  assert.equal(hardStop.compiler.appliedTransition, "hard-stop");
  assert.deepEqual(hardStop.compiler.evidenceIds, [hardStop.id]);
});

test("only fixed request diagnostics and permitted usage reach the neutral report", async () => {
  const secret = "synthetic private error content";
  const report = await runLunaProtocolNeutral({mode: "mock", now, provider: async () =>
    ({status: "failed", failureReason: "output-schema", message: secret,
      usage: {inputTokens: 11, outputTokens: 0, raw: secret}})});
  const row = report.diagnostics[0].units[0];
  assert.equal(row.discovery.requestFailure, "output-schema");
  assert.equal(row.discovery.requestStatus, "failed");
  assert.deepEqual(row.discovery.submittedIds, [0, 1, 2, 3]);
  assert.equal(row.discovery.citedIds, null);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("live command requires the key and cannot be combined with a mock", () => {
  const env = {...process.env, OPENAI_API_KEY: ""};
  const missingKey = spawnSync(process.execPath, [cli, "--live"], {encoding: "utf8", env});
  assert.equal(missingKey.status, 1);
  assert.match(missingKey.stderr, /authorized OPENAI_API_KEY/u);
  assert.equal(missingKey.stdout, "");
  const both = spawnSync(process.execPath, [cli, "--live", "--mock"], {encoding: "utf8", env});
  assert.equal(both.status, 1);
  assert.match(both.stderr, /Use node scripts\/run-luna-protocol-neutral\.mjs/u);
});

test("terminal provider authorization stops the remaining study without hiding the failed call", async () => {
  let calls = 0;
  const provider = async () => {
    calls++;
    return {status: "failed", failureReason: "http-auth"};
  };
  const report = await runLunaProtocolNeutral({mode: "mock", provider, now});
  assert.equal(calls, 1);
  assert.deepEqual(report.providerStops, {all: "http-auth"});
  assert.equal(report.planning.discoveryAttempts, 1);
  assert.equal(report.planning.prefixAttempts, 0);
  assert.equal(report.planning.transitionAttempts, 0);
  assert.equal(report.budget.unsettled, 1);
});
