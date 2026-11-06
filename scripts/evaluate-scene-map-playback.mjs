// Private offline replay through the reader's actual synchronous controller.
// Reading position is injected deterministically and the device is software-only.
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {ProfileSimulator} from "../app/static/devices/profile-simulator.mjs";
import {COMMAND_SECONDS, PlaybackController} from "../app/static/playback/controller.mjs";
import {DEFAULT_CHANNEL_CALIBRATION} from "../app/static/reader/calibration.mjs";
import {DEFAULT_EXPERIENCE} from "../app/static/reader/experience-preferences.mjs";
import {compileSceneMap} from "../app/static/reader/scene-map.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";
import {loadCorpus} from "./evaluate-nocturne-corpus.mjs";

export const PLAYBACK_PACES = Object.freeze([120, 240, 420]);
export const PLAYBACK_ARMS = Object.freeze(["loom", "background", "scene-paragraph", "scene-unit"]);
const sampleMs = 100;
const heartbeatMs = 1000;
const minimumEpisodeMs = 3000;
const activityMs = 60_000;
const {maximum: defaultMaximum, rhythm, peakPattern} = DEFAULT_EXPERIENCE;
const {background} = DEFAULT_CHANNEL_CALIBRATION;
const quietProfile = quiet => ({quiet, phase: "quiet", rhythm: "steady", sceneId: null});
const ratio = (value, total) => total ? value / total : null;

export function sceneUnitWordCount(unit) {
  return Math.max(1, (unit.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length);
}

function profileFor(unit, hardQuiet) {
  if (hardQuiet || !unit.emphasis) return {level: 0, profile: quietProfile(hardQuiet)};
  const {phase, emphasis, sceneId} = unit;
  return {level: emphasis, profile: {quiet: false, rhythm: "steady", phase, sceneId: sceneId + 1,
    ...(phase === "recover" ? {} : {currentCue: true}), ...(phase === "peak" ? {peakPreset: peakPattern} : {})}};
}

function mappingFor({model, units, labels}, candidate, arm, onTimeUnits) {
  const levels = model.effectiveLevels(), profiles = model.effectiveProfiles();
  const localQuiet = labels.map((label, index) => profiles[index].quiet || label.protected === true || label.contextEligible === false);
  if (arm === "loom") return {levels, profiles, positions: units.map(unit => unit.paragraph)};
  if (arm === "background") return {levels: levels.map(() => 0), profiles: localQuiet.map(quietProfile), positions: units.map(unit => unit.paragraph)};

  const unitMaps = candidate.map(unit => {
    const ready = onTimeUnits === undefined || onTimeUnits.has(unit.id);
    // Reference-only boundaries are not a control input to the timed arm.
    // A provider boundary can take effect only if its candidate arrived.
    const hardQuiet = localQuiet[unit.paragraph] || unit.boundary === "structural" || (ready && unit.boundary === "model");
    if (!ready && !hardQuiet) {
      return {level: levels[unit.paragraph], profile: profiles[unit.paragraph]};
    }
    return profileFor(unit, hardQuiet);
  });
  if (arm === "scene-unit") return {levels: unitMaps.map(row => row.level), profiles: unitMaps.map(row => row.profile), positions: units.map((_, index) => index)};

  // A paragraph-only cursor cannot stop part way through a mixed paragraph.
  // Give a known boundary priority and otherwise choose the earliest cue.
  const paragraphMaps = levels.map((_, index) => ({level: 0, profile: quietProfile(localQuiet[index])}));
  for (const [index, {paragraph}] of units.entries()) {
    const mapped = unitMaps[index], previous = paragraphMaps[paragraph];
    if (mapped.profile.quiet || (!previous.profile.quiet && previous.level === 0 && mapped.level > 0)) paragraphMaps[paragraph] = mapped;
  }
  return {levels: paragraphMaps.map(row => row.level), profiles: paragraphMaps.map(row => row.profile), positions: units.map(unit => unit.paragraph)};
}

function timelineFor(units, reference, pace) {
  const episodes = [], timeline = [];
  let words = 0, time = 0, episode;
  for (const [index, unit] of units.entries()) {
    const expected = reference[index], start = time;
    words += sceneUnitWordCount(unit);
    time = Math.round(words * 60_000 / pace);
    if (expected.emphasis > 0) {
      if (!episode || episode.sceneId !== expected.sceneId) {
        episode = {sceneId: expected.sceneId, start, end: time, contrastMs: 0, contrastRunMs: 0,
          longestContrastMs: 0, dispatchDelayMs: null};
        episodes.push(episode);
      }
      episode.end = time;
    } else episode = undefined;
    timeline.push({end: time, episode, boundary: Boolean(expected.boundary), positive: expected.emphasis > 0});
  }
  return {timeline, episodes, duration: time};
}

const summedFields = ["readingMs", "unexpectedPausedMs", "aboveBackgroundCueMs", "referenceCueMs", "noncueMs", "noncueAboveBackgroundMs",
  "boundaryUnits", "boundaryNonzeroUnits", "boundaryNonzeroMs", "boundaryAboveBackgroundMs", "positiveTargetMs", "positiveTargetZeroMs",
  "hardQuietViolationMs", "hardQuietViolationCommands", "capViolationMs", "capViolationCommands", "durationViolationCommands",
  "cadenceViolationCommands", "nonzeroCommands", "stopFailures", "phaseResets", "lateCueUnits"];

export async function replayPassage(passage, {pace = 240, arm = "scene-unit", onTimeUnits, candidateMap, maximum = defaultMaximum} = {}) {
  if (passage.scope !== "exact" || !PLAYBACK_PACES.includes(pace) || !PLAYBACK_ARMS.includes(arm) ||
      (onTimeUnits !== undefined && (!(onTimeUnits instanceof Set) || arm !== "scene-unit")) ||
      !Number.isInteger(maximum) || maximum < 1 || maximum > 20) throw new TypeError("Use an exact reference and a supported simulator replay configuration.");
  const {units, reference: map} = passage;
  const reference = compileSceneMap(map, units);
  const {timeline, episodes, duration} = timelineFor(units, reference, pace);
  const candidate = candidateMap === undefined ? reference : compileSceneMap(candidateMap, units);
  const mapping = mappingFor(passage, candidate, arm, onTimeUnits);
  const clock = new SimulationClock();
  const device = new ProfileSimulator({model: "lush", now: clock.now});
  const controller = new PlaybackController({device, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, heartbeatMs});
  const stats = {...Object.fromEntries(summedFields.map(key => [key, 0])), maximumOutput: 0, longestPositiveTargetGapMs: 0};
  stats.boundaryUnits = timeline.filter(row => row.boundary).length;
  stats.lateCueUnits = onTimeUnits === undefined ? 0 : reference.filter(row => row.emphasis > 0 && !onTimeUnits.has(row.id)).length;
  const threshold = Math.min(background, maximum);
  const boundaryNonzero = new Set();
  let cursor = 0, lastCommand = -Infinity, gap = 0;
  const command = device.command.bind(device);
  device.command = (level, seconds) => {
    if (level > 0) {
      const now = clock.now(), position = mapping.positions[cursor], episode = timeline[cursor].episode;
      stats.nonzeroCommands++;
      if (level > maximum) stats.capViolationCommands++;
      if (seconds !== COMMAND_SECONDS) stats.durationViolationCommands++;
      if (now - lastCommand < heartbeatMs) stats.cadenceViolationCommands++;
      if (mapping.profiles[position].quiet) stats.hardQuietViolationCommands++;
      if (level > threshold && episode && now < episode.end && episode.dispatchDelayMs === null) episode.dispatchDelayMs = now - episode.start;
      lastCommand = now;
    }
    return command(level, seconds);
  };

  if (!controller.connect()) throw new Error("Could not connect the software simulator.");
  controller.setStory(mapping.levels, mapping.profiles);
  controller.setFeel({...DEFAULT_CHANNEL_CALIBRATION, maximum, mode: "continuous", quietEdging: false, rhythm});
  controller.setCeilingFromControl(maximum);
  controller.setPosition(mapping.positions[0]);
  if (device.snapshot().strength !== 0 || stats.nonzeroCommands || !controller.start()) throw new Error("Simulator start did not remain explicit.");

  let now = 0, nextActivity = activityMs;
  while (now < duration) {
    const row = timeline[cursor], position = mapping.positions[cursor];
    const {target, running} = controller.snapshot(), output = device.snapshot().strength;
    const next = Math.min(row.end, nextActivity, (Math.floor(now / sampleMs) + 1) * sampleMs);
    const elapsed = next - now;
    stats.readingMs += elapsed;
    if (!running) stats.unexpectedPausedMs += elapsed;
    if (output > maximum) stats.capViolationMs += elapsed;
    if (mapping.profiles[position].quiet && output > 0) stats.hardQuietViolationMs += elapsed;
    stats.maximumOutput = Math.max(stats.maximumOutput, output);
    if (target > 0 && running) stats.positiveTargetMs += elapsed;
    if (target > 0 && running && output === 0) {
      stats.positiveTargetZeroMs += elapsed;
      gap += elapsed;
      stats.longestPositiveTargetGapMs = Math.max(stats.longestPositiveTargetGapMs, gap);
    } else gap = 0;
    if (row.boundary && output > 0) {
      boundaryNonzero.add(cursor);
      stats.boundaryNonzeroMs += elapsed;
      if (output > threshold) stats.boundaryAboveBackgroundMs += elapsed;
    }
    if (row.positive) {
      stats.referenceCueMs += elapsed;
      const episode = row.episode;
      if (output > threshold) {
        stats.aboveBackgroundCueMs += elapsed;
        episode.contrastMs += elapsed;
        episode.contrastRunMs += elapsed;
        episode.longestContrastMs = Math.max(episode.longestContrastMs, episode.contrastRunMs);
      } else episode.contrastRunMs = 0;
    } else {
      stats.noncueMs += elapsed;
      if (output > threshold) stats.noncueAboveBackgroundMs += elapsed;
    }

    await clock.advance(elapsed);
    now = next;
    if (now === row.end && cursor + 1 < timeline.length) {
      const started = controller.feel.startedAt;
      cursor++;
      controller.activity();
      controller.setPosition(mapping.positions[cursor]);
      if (controller.feel.startedAt !== started) stats.phaseResets++;
      nextActivity = now + activityMs;
    } else if (now === nextActivity) {
      controller.activity();
      nextActivity = now + activityMs;
    }
  }
  controller.pause("Replay ended.");
  const before = stats.nonzeroCommands, stopped = device.snapshot().strength === 0 && !controller.snapshot().running;
  await clock.advance(3000);
  stats.stopFailures = Number(!stopped || device.snapshot().strength !== 0 || controller.snapshot().running || stats.nonzeroCommands !== before);
  stats.boundaryNonzeroUnits = boundaryNonzero.size;
  return {stats, episodes: episodes.map(episode => ({eligible: maximum > threshold && episode.end - episode.start >= minimumEpisodeMs,
    contrastMs: episode.contrastMs, dispatchDelayMs: episode.dispatchDelayMs,
    sustainedContrast: episode.longestContrastMs >= heartbeatMs && episode.dispatchDelayMs !== null}))};
}

export function summarizePlayback(replays) {
  const totals = Object.fromEntries(summedFields.map(key => [key, 0]));
  let maximumOutput = 0, longestPositiveTargetGapMs = 0;
  const episodes = replays.flatMap(replay => replay.episodes);
  const eligible = episodes.filter(episode => episode.eligible);
  const sustained = eligible.filter(episode => episode.sustainedContrast);
  const delays = sustained.map(episode => episode.dispatchDelayMs).sort((a, b) => a - b);
  for (const {stats} of replays) {
    for (const key of summedFields) totals[key] += stats[key];
    maximumOutput = Math.max(maximumOutput, stats.maximumOutput);
    longestPositiveTargetGapMs = Math.max(longestPositiveTargetGapMs, stats.longestPositiveTargetGapMs);
  }
  return {excerpts: replays.length, ...totals, maximumOutput, longestPositiveTargetGapMs,
    episodes: episodes.length, eligibleEpisodes: eligible.length, sustainedContrastEpisodes: sustained.length,
    sustainedContrastEpisodeRate: ratio(sustained.length, eligible.length),
    contrastCueTimeRate: ratio(totals.aboveBackgroundCueMs, totals.referenceCueMs),
    positiveTargetGapRate: ratio(totals.positiveTargetZeroMs, totals.positiveTargetMs),
    p95DispatchDelayMsAmongSustainedEpisodes: delays.length ? delays[Math.ceil(delays.length * .95) - 1] : null};
}

export async function evaluateSceneMapPlayback(manifestPath) {
  const {passages} = await loadCorpus(manifestPath);
  const exact = passages.filter(passage => passage.scope === "exact");
  if (!exact.length) throw new Error("The corpus contains no exact scene references.");
  const results = [];
  for (const pace of PLAYBACK_PACES) for (const arm of PLAYBACK_ARMS) {
    const replays = [];
    for (const passage of exact) replays.push(await replayPassage(passage, {pace, arm}));
    results.push({pace, arm, ...summarizePlayback(replays)});
  }
  return {interpretation: "Software dispatch with a word-paced cursor and supplied references. Scene-unit assumes exact sentence position. No provider or physical device ran.",
    exactExcerpts: exact.length, projectedExcerptsSkipped: passages.length - exact.length,
    settings: {simulator: "lush", background, maximum: defaultMaximum, heartbeatMs, sampleMs, minimumEpisodeMs}, results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Use node scripts/evaluate-scene-map-playback.mjs MANIFEST.");
    console.log(JSON.stringify(await evaluateSceneMapPlayback(process.argv[2]), null, 2));
  } catch {
    console.error("Private replay failed. Supply one pinned corpus manifest with exact scene references.");
    process.exitCode = 1;
  }
}
