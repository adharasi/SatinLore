import {writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {MockDevice} from "../app/static/devices/mock.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";
import {DEFAULT_EXPERIENCE} from "../app/static/reader/experience-preferences.mjs";
import {DEFAULT_CHANNEL_CALIBRATION} from "../app/static/reader/calibration.mjs";

// Neutral, reproducible controller inputs only. No private text or reader data.
// The fixture deliberately includes transitions that require authoritative zero.
const durationMs = 170_000;
const frameMs = 100;
export const CONTINUITY_EVENTS = Object.freeze([
  {atMs: 0, action: "start"},
  {atMs: 60_000, action: "activity"},
  {atMs: 68_100, action: "section", index: 1},
  {atMs: 70_100, action: "section", index: 2},
  {atMs: 80_100, action: "section", index: 3},
  {atMs: 95_100, action: "section", index: 4},
  {atMs: 105_100, action: "seek-start"},
  {atMs: 107_100, action: "section", index: 0},
  {atMs: 110_100, action: "seek-end"},
  {atMs: 120_100, action: "manual-zero"},
  {atMs: 130_100, action: "clear-manual-zero"},
  {atMs: 140_100, action: "pause"},
  {atMs: 150_100, action: "start"},
  {atMs: 155_100, action: "lower-cap", value: 2},
  {atMs: 160_100, action: "lower-cap", value: 0},
  {atMs: 165_100, action: "pause"},
]);

const variants = [
  {name: "story-following", preferences: {...DEFAULT_EXPERIENCE, quiet: "off", rhythm: "scene", peakPattern: "auto"}},
  {name: "continuous-story-rhythm", preferences: {...DEFAULT_EXPERIENCE, quiet: "continuous", rhythm: "scene", peakPattern: "auto"}},
  {name: "continuous-steady-rhythm", preferences: {...DEFAULT_EXPERIENCE, quiet: "continuous", rhythm: "steady", peakPattern: "steady"}},
  {name: "first-use-defaults", preferences: {...DEFAULT_EXPERIENCE}},
];

function profilesFor(preferences) {
  const peak = preferences.peakPattern === "auto" ? {automaticPeak: true} : {peakPreset: preferences.peakPattern};
  return [
    {sceneId: 1, phase: "sustain", rhythm: "gentle", quiet: false, pattern: "wave"},
    {sceneId: 1, phase: "sustain", rhythm: "steady", quiet: false, pattern: "wave"},
    {sceneId: 1, phase: "quiet", rhythm: "steady", quiet: false},
    {sceneId: 1, phase: "peak", rhythm: "dynamic", quiet: false, ...peak},
    {sceneId: 2, phase: "quiet", rhythm: "steady", quiet: true},
  ];
}

function summarize(frames, commands, boundaries) {
  const active = frames.filter(frame => frame.running);
  const unexpectedZero = active.filter(frame => frame.target > 0 && frame.output === 0);
  let longestGapMs = 0, gapMs = 0;
  for (const frame of frames) {
    gapMs = frame.running && frame.target > 0 && frame.output === 0 ? gapMs + frameMs : 0;
    longestGapMs = Math.max(longestGapMs, gapMs);
  }
  return {
    observedMs: frames.length * frameMs,
    playingMs: active.length * frameMs,
    zeroOutputWhilePlayingMs: active.filter(frame => frame.output === 0).length * frameMs,
    meanOutputWhilePlaying: Number((active.reduce((sum, frame) => sum + frame.output, 0) / Math.max(1, active.length)).toFixed(4)),
    positiveTargetButZeroOutputMs: unexpectedZero.length * frameMs,
    longestPositiveTargetGapMs: longestGapMs,
    timeAtNonzeroCapMs: active.filter(frame => frame.cap > 0 && frame.output === frame.cap).length * frameMs,
    uniqueDispatchedLevels: [...new Set(commands.filter(command => command.type === "command").map(command => command.level))].sort((a, b) => a - b),
    nonzeroCommands: commands.filter(command => command.type === "command" && command.level > 0).length,
    stopPackets: commands.filter(command => command.type === "stop").length,
    phaseResetsDuringPlayback: frames.filter((frame, index) => index && frame.running && frames[index - 1].running &&
      frame.stageStartedAt !== frames[index - 1].stageStartedAt).length,
    maximumObserved: Math.max(0, ...frames.map(frame => frame.output)),
    capViolations: frames.filter(frame => frame.output > frame.cap).length,
    boundaryChanges: boundaries,
  };
}

export async function runPlaybackContinuityTrace({name, preferences}) {
  const clock = new SimulationClock();
  const commands = [], frames = [], boundaries = [];
  const simulated = new MockDevice(clock.now);
  // Wrap the transport boundary so lazy simulator expiry during snapshot reads
  // cannot be mistaken for an explicitly dispatched Stop packet.
  const device = {
    connect: () => simulated.connect(), disconnect: () => simulated.disconnect(), snapshot: () => simulated.snapshot(),
    command: (level, seconds) => {
      commands.push({atMs: clock.now(), type: "command", level, seconds});
      return simulated.command(level, seconds);
    },
    stop: () => {
      commands.push({atMs: clock.now(), type: "stop", level: 0});
      return simulated.stop();
    },
  };
  const controller = new PlaybackController({device, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer});
  controller.connect();
  controller.setStory([3, 2, 0, 5, 0], profilesFor(preferences));
  controller.setFeel({...DEFAULT_CHANNEL_CALIBRATION, maximum: preferences.maximum,
    mode: preferences.quiet === "off" ? "story" : "continuous", quietEdging: false, rhythm: preferences.rhythm});
  controller.setCeilingFromControl(preferences.maximum);
  commands.length = 0;
  let eventIndex = 0;
  for (let atMs = 0; atMs < durationMs; atMs += frameMs) {
    await clock.advance(atMs - clock.now());
    while (CONTINUITY_EVENTS[eventIndex]?.atMs === atMs) {
      const event = CONTINUITY_EVENTS[eventIndex++];
      const before = controller.snapshot();
      const beforeStageStartedAt = controller.feel.startedAt;
      if (event.action === "start") controller.start();
      else if (event.action === "activity") controller.activity();
      else if (event.action === "section") { controller.activity(); controller.setPosition(event.index); }
      else if (event.action === "seek-start") controller.setReadingSeeking(true);
      else if (event.action === "seek-end") controller.setReadingSeeking(false);
      else if (event.action === "manual-zero") controller.setManualZeros([controller.position]);
      else if (event.action === "clear-manual-zero") controller.setManualZeros([]);
      else if (event.action === "lower-cap") controller.setCeilingFromControl(event.value);
      else if (event.action === "pause") controller.pause("Neutral trace pause.");
      const after = controller.snapshot();
      boundaries.push({atMs, action: event.action, beforeTarget: before.target, afterTarget: after.target,
        targetChange: after.target - before.target, beforeOutput: before.output, afterOutput: after.output,
        outputChange: after.output - before.output, beforeStageStartedAt, afterStageStartedAt: controller.feel.startedAt});
    }
    const snapshot = controller.snapshot();
    frames.push({atMs, running: snapshot.running, section: snapshot.position, target: snapshot.target,
      output: device.snapshot().strength, cap: snapshot.ceiling, stageStartedAt: controller.feel.startedAt});
  }
  return {name, preferences, metrics: summarize(frames, commands, boundaries), frames, commands};
}

export async function runPlaybackContinuityComparison() {
  const results = [];
  for (const variant of variants) results.push(await runPlaybackContinuityTrace(variant));
  return {
    schemaVersion: 1,
    scope: "Deterministic synchronous simulator dispatch; no hardware or preference evidence.",
    intervalMs: frameMs,
    events: CONTINUITY_EVENTS,
    conditions: {sameSourceLevels: true, sameCalibration: true, sameInitialMaximum: true,
      matchedMeanOutput: false, notes: "Output means differ; this is a reliability comparison, not an enjoyment experiment."},
    results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runPlaybackContinuityComparison();
  const path = process.argv[2];
  if (path) await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report.results.map(({name, metrics}) => ({name, ...metrics})), null, 2)}\n`);
}
