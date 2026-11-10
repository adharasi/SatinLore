import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {combineNeutralReports, runLunaProtocolNeutral} from "../scripts/lib/luna-protocol-neutral.mjs";
import {wholeStoryAnnotationFixtures} from "./whole-story-annotation-fixtures.mjs";

const cli = fileURLToPath(new URL("../scripts/run-luna-protocol-neutral.mjs", import.meta.url));
const now = () => 100;

test("default CLI plans the 33 neutral targets without a provider even if a key is present", () => {
  const output = execFileSync(process.execPath, [cli], {encoding: "utf8",
    env: {...process.env, OPENAI_API_KEY: "unused-fixture-key"}});
  const report = JSON.parse(output);
  assert.equal(report.measurement, "offline-planning");
  assert.equal(report.independentCorpusBenchmark, false);
  assert.match(report.referenceScope, /development fixtures.*independent/u);
  assert.match(report.appliedCueDefinition, /no direct-cue reference/u);
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
    assert.equal(stage.targetDiagnostics.submittedTargets, 0);
    assert.deepEqual(stage.targetDiagnostics.targetDispositions, {"no-attempt-record": 33});
  }
  assert.equal(report.discovery.exactTypedTransitions.missed, 7);
  assert.equal(report.transition.exactTypedTransitions.missed, 7);
  assert.equal(report.applied.exactTypedTransitions.missed, 7);
  assert.equal(report.applied.exactCues.missed, 10);
  assert.equal(report.applied.observedCueTargets, 0);
  assert.equal(report.reader.exactCues.missed, 10);
  assert.equal(report.reader.observedCueTargets, 0);
  assert.equal(report.cueRecovery.attemptedTargets, 0);
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
    assert.equal(stop.prefix.labels.transition, "hard-stop");
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

test("applied scores retain stage origins, gated cue changes, and the boundary-only denominator", async () => {
  const provider = async ({mode, targetIds}) => ({status: "ok", facts: targetIds.map(unitId => {
    const cue = mode === "verify" && unitId === 0;
    const typed = mode === "transition";
    const transition = typed && unitId === 0 ? "reported-entry" : typed && unitId === 1 ? "onset" : "none";
    return {unitId, status: cue || transition !== "none" ? "verified" : "neutral",
      depiction: cue ? "romantic" : typed ? "unknown" : "neutral",
      frame: transition === "reported-entry" ? "reported" : "current",
      narrativePhase: cue ? "onset" : typed ? "unknown" : "quiet", transition,
      action: cue ? "contact" : typed ? "unknown" : "none", fact: transition === "reported-entry" ? "cut" : "none",
      scopeId: null, priorAnchor: null, evidenceIds: cue || transition !== "none" ? [unitId] : []};
  }), usage: {inputTokens: 11, outputTokens: 3}});
  const report = await runLunaProtocolNeutral({mode: "mock", provider, now});
  assert.equal(report.prefix.exactCues.extra, 4);
  assert.equal(report.applied.exactCues.extra, 0);
  assert.equal(report.applied.cueChanges["removed-false-positive"], 4);
  assert.equal(report.applied.targets, 33);
  assert.equal(report.applied.phase, undefined);
  assert.equal(report.transition.exactTypedTransitions.extra, 8);
  assert.equal(report.transition.boundary.exact.extra, 4);
  assert.deepEqual(report.transition.boundary.excludedNonBoundaryPredictions, {onset: 4});
  assert.equal(report.applied.exactTypedTransitions.extra, 8);
  assert.equal(report.applied.boundary.exact.extra, 4);
  assert.equal(report.applied.transitionOrigins["transition-pass"], 8);
  assert.deepEqual(report.diagnostics[0].units[0].applied, {status: "verified", cue: false,
    transition: "reported-entry", transitionOrigin: "transition-pass", cuePrefixTransition: "none",
    readerCue: false, cueChange: "removed-false-positive", readerCueChange: "removed-false-positive",
    transitionChange: "unchanged", mismatches: ["extra-transition"]});
  assert.ok(report.diagnostics[0].units[0].pipelineFlags.includes("cue-frame-ineligible"));
  assert.equal(report.transition.usage.inputTokens, 363);
});

test("complementary fixture shards combine exact scores and usage in canonical order", async () => {
  const options = {mode: "mock", arm: "complete", maxAttempts: 48, now};
  const left = await runLunaProtocolNeutral({...options, fixtureIds: ["old-letter", "first-dance"], transitionLimit: 19});
  const right = await runLunaProtocolNeutral({...options, fixtureIds: ["practice-drill", "reading-room"], transitionLimit: 14});
  const combined = combineNeutralReports([right, left]);
  const whole = await runLunaProtocolNeutral({mode: "mock", arm: "complete", now});
  assert.deepEqual(left.fixtureIds, ["first-dance", "old-letter"]);
  assert.deepEqual(right.fixtureIds, ["reading-room", "practice-drill"]);
  assert.deepEqual(combined.fixtureIds, whole.fixtureIds);
  assert.equal(combined.fixtureRosterSha256, whole.fixtureRosterSha256);
  assert.equal(combined.planning.referenceTargets, 33);
  assert.equal(combined.planning.transitionAttempts, 33);
  assert.equal(combined.budget.attempts, 70);
  assert.equal(combined.prefix.usage.attempts, 33);
  assert.equal(combined.prefix.usage.durationsMs.length, 33);
  assert.deepEqual(combined.prefix.exactCues, whole.prefix.exactCues);
  assert.deepEqual(combined.prefix.targetDiagnostics, whole.prefix.targetDiagnostics);
  assert.deepEqual(combined.transition.boundary, whole.transition.boundary);
  assert.deepEqual(combined.applied.exactCues, whole.applied.exactCues);
  assert.deepEqual(combined.applied.exactTypedTransitions, whole.applied.exactTypedTransitions);
  assert.deepEqual(combined.reader.exactCues, whole.reader.exactCues);
  assert.deepEqual(combined.reader.cueChanges, whole.reader.cueChanges);
  assert.equal(combined.cueRecovery.targets, 33);
  assert.equal(combined.cueRecovery.usage.attempts, 0);
  assert.throws(() => combineNeutralReports([left, left]), /complementary reports/u);
  assert.throws(() => combineNeutralReports([left, {...right, rubricVersion: "other"}]), /complementary reports/u);
  assert.throws(() => combineNeutralReports([left, {...right, transition: undefined}]), /complementary reports/u);
  await assert.rejects(() => runLunaProtocolNeutral({...options, fixtureIds: ["first-dance", "first-dance"]}),
    /Invalid neutral benchmark options/u);
});

test("targeted cue checks preserve primary scores and separate direct and reader effects", async () => {
  const provider = async ({mode, targetIds}) => ({status: "ok", facts: targetIds.map(unitId => {
    const proposed = mode === "discovery" && [2, 3, 4, 5].includes(unitId);
    const recovered = mode === "cue-check";
    const known = mode === "verify" && unitId === 4;
    const active = proposed || recovered || known;
    const uncertain = mode === "verify" && unitId === 3;
    const typed = mode === "transition";
    const low = active && unitId === 2;
    return {unitId, status: proposed ? "candidate" : active ? "verified" : uncertain ? "uncertain" : "neutral",
      depiction: active ? "romantic" : typed || uncertain ? "unknown" : "neutral",
      frame: uncertain ? "uncertain" : "current",
      narrativePhase: active ? low ? "build" : "onset" : typed || uncertain ? "unknown" : "quiet",
      transition: "none",
      action: active ? low ? "anticipation" : "contact" : typed || uncertain ? "unknown" : "none",
      fact: low ? "low" : "none", scopeId: null, priorAnchor: null, evidenceIds: active ? [unitId] : []};
  }), usage: {inputTokens: 4, outputTokens: 2}});
  const report = await runLunaProtocolNeutral({mode: "mock", provider, now, arm: "complete",
    fixtureIds: ["first-dance"], maxCueChecks: 2});
  const units = report.diagnostics[0].units;
  assert.equal(report.planning.cueCheckTargetLimit, 2);
  assert.equal(report.planning.cueCheckAttempts, 2);
  assert.equal(report.prefix.exactCues.matched, 1);
  assert.equal(report.applied.exactCues.matched, 2);
  assert.equal(report.reader.exactCues.matched, 3);
  assert.equal(report.cueRecovery.scheduledTargets, 11);
  assert.equal(report.cueRecovery.selectedTargets, 3);
  assert.equal(report.cueRecovery.attemptedTargets, 2);
  assert.equal(report.cueRecovery.returnedTargets, 2);
  assert.equal(report.cueRecovery.recoveredReferenceCues, 2);
  assert.equal(report.cueRecovery.recoveredReferenceNonCues, 0);
  assert.equal(report.cueRecovery.directCuesAfterRecovery, 1);
  assert.equal(report.cueRecovery.readerCuesAfterRecovery, 2);
  assert.equal(report.cueRecovery.usage.inputTokens, 8);
  assert.equal(units[2].prefix.status, "neutral");
  assert.equal(units[2].prefix.cue, false);
  assert.equal(units[2].cueRecovery.action, "anticipation");
  assert.deepEqual(units[2].cueRecovery.citedIds, [2]);
  assert.equal(units[2].applied.cue, false);
  assert.equal(units[2].applied.readerCue, true);
  assert.equal(units[2].applied.readerCueChange, "recovered-match");
  assert.deepEqual(units[2].applied.mismatches, []);
  assert.equal(units[3].prefix.status, "uncertain");
  assert.equal(units[3].cueRecovery.recovered, true);
  assert.equal(units[3].applied.cue, true);
  assert.equal(units[3].applied.readerCueChange, "recovered-by-coverage");
  assert.deepEqual(report.prefix.targetDiagnostics.works[0].unobservedSubmittedTargetIds, [3]);
  assert.equal(units[4].cueRecovery.status, "not-needed");
  assert.equal(units[4].cueRecovery.selected, false);
  assert.equal(units[4].cueRecovery.submittedIds, null);
  assert.equal(units[5].cueRecovery.status, "budget-deferred");
  assert.equal(units[5].cueRecovery.selected, true);

  const options = {mode: "mock", provider, now, arm: "complete", maxCueChecks: 2, maxAttempts: 48};
  const left = await runLunaProtocolNeutral({...options, fixtureIds: ["first-dance", "old-letter"], transitionLimit: 19});
  const right = await runLunaProtocolNeutral({...options, fixtureIds: ["reading-room", "practice-drill"], transitionLimit: 14});
  const combined = combineNeutralReports([left, right]);
  assert.equal(combined.cueRecovery.attemptedTargets, 8);
  assert.equal(combined.cueRecovery.usage.attempts, 8);
  assert.equal(combined.cueRecovery.usage.inputTokens, 32);
  assert.equal(combined.cueRecovery.recoveredTargets, 8);
  assert.equal(combined.reader.targets, 33);
});

test("a repaired neutral row stays missing in primary scores and is applied separately", async () => {
  const provider = async ({mode, targetIds}) => ({status: "ok", facts: targetIds.map(unitId => ({
    unitId, status: "neutral", depiction: mode === "transition" ? "unknown" : "neutral", frame: "current",
    narrativePhase: mode === "transition" ? "unknown" : "quiet", transition: "none",
    action: mode === "verify" && unitId === 0 ? "contact" : mode === "transition" ? "unknown" : "none",
    fact: "none", scopeId: null, priorAnchor: null, evidenceIds: [],
  }))});
  const report = await runLunaProtocolNeutral({mode: "mock", provider, now, arm: "complete",
    fixtureIds: ["first-dance"], maxCueChecks: 1});
  const row = report.diagnostics[0].units[0];
  assert.equal(row.prefix.targetDisposition, "rejected");
  assert.equal(row.prefix.cue, null);
  assert.equal(row.cueRecovery.primaryFailure, "status-effect");
  assert.equal(row.cueRecovery.contractRepaired, true);
  assert.equal(row.cueRecovery.recovered, false);
  assert.equal(row.applied.readerCue, false);
  assert.equal(report.cueRecovery.contractRepairedTargets, 1);
});

test("elapsed-time gap is reported as compiler recovery rather than a model boundary", async () => {
  const provider = async ({mode, targetIds}) => ({status: "ok", facts: targetIds.map(unitId => {
    const enactment = mode === "verify" && unitId === 1;
    return {unitId, status: enactment ? "verified" : "neutral", depiction: enactment ? "romantic" :
      mode === "transition" ? "unknown" : "neutral", frame: "current", narrativePhase: enactment ? "onset" :
      mode === "transition" ? "unknown" : "quiet", transition: "none", action: enactment ? "contact" :
      mode === "transition" ? "unknown" : "none", fact: "none", scopeId: null, priorAnchor: null,
    evidenceIds: enactment ? [unitId] : []};
  })});
  const report = await runLunaProtocolNeutral({mode: "mock", provider, now, arm: "complete", fixtureIds: ["reading-room"]});
  const row = report.diagnostics[0].units[2];
  assert.equal(row.transition.transition, "none");
  assert.equal(row.applied.transition, "uncertain-continuity");
  assert.equal(row.applied.transitionOrigin, "compiler-continuity-guard");
  assert.equal(row.applied.transitionChange, "recovered-match");
  assert.equal(row.compiler.continuityGuard, "elapsed-time-gap");
  assert.equal(row.compiler.pattern, "Baseline");
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
  assert.equal(row.discovery.targetDisposition, "no-fact-returned");
  assert.deepEqual(row.discovery.submittedIds, [0, 1, 2, 3]);
  assert.equal(row.discovery.citedIds, null);
  assert.equal(row.discovery.labels, null);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test("partial discovery keeps accepted rows and exposes unresolved targets separately", async () => {
  let partial = true;
  const provider = async ({mode, targetIds}) => {
    const drop = mode === "discovery" && partial;
    if (drop) partial = false;
    return {status: drop ? "partial" : "ok", facts: targetIds.slice(drop ? 1 : 0).map(unitId => ({
      unitId, status: "neutral", depiction: mode === "transition" ? "unknown" : "neutral",
      frame: "current", narrativePhase: mode === "transition" ? "unknown" : "quiet",
      transition: "none", action: mode === "transition" ? "unknown" : "none",
      fact: "none", scopeId: null, priorAnchor: null, evidenceIds: [],
    })), usage: {inputTokens: 1, outputTokens: 0}};
  };
  const report = await runLunaProtocolNeutral({mode: "mock", provider, now});
  const [missing, retained] = report.diagnostics[0].units;
  assert.equal(report.discovery.observedCueTargets, 32);
  assert.equal(report.prefix.observedCueTargets, 33);
  assert.equal(missing.discovery.status, "missing");
  assert.equal(missing.discovery.requestStatus, "partial");
  assert.equal(missing.discovery.contractRejection, "missing-target");
  assert.equal(missing.discovery.targetDisposition, "rejected");
  assert.equal(retained.discovery.status, "neutral");
  assert.equal(retained.discovery.requestStatus, "partial");
  assert.equal(retained.discovery.targetDisposition, "returned");
  assert.equal(report.discovery.targetDiagnostics.rejectedTargets, 1);
  assert.deepEqual(report.discovery.targetDiagnostics.rejections, {"missing-target": 1});
  assert.deepEqual(report.discovery.targetDiagnostics.works[0].unobservedSubmittedTargetIds, [0]);
  assert.deepEqual(report.discovery.targetDiagnostics.works[0].rejectedTargets, [{id: 0, reason: "missing-target"}]);
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
  const suppressed = report.diagnostics[1].units[0].discovery;
  assert.equal(suppressed.targetDisposition, "not-dispatched");
  assert.equal(suppressed.requestFailure, "http-auth");
  assert.equal(suppressed.submittedIds, null);
});
