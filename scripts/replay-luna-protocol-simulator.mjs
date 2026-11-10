import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {ProfileSimulator} from "../app/static/devices/profile-simulator.mjs";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {DEFAULT_CHANNEL_CALIBRATION} from "../app/static/reader/calibration.mjs";
import {DEFAULT_EXPERIENCE} from "../app/static/reader/experience-preferences.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";
import {wholeStoryAnnotationFixtures} from "../tests/whole-story-annotation-fixtures.mjs";
import {getNeutralProtocolReference, runLunaProtocolNeutral} from "./lib/luna-protocol-neutral.mjs";
import {buildWholeStoryIndex} from "./lib/whole-story-context-planning.mjs";

const sampleMs = 100;
const heartbeatMs = 1000;
const minimumContrastDwellMs = 3000;
const hard = new Set(["Stop", "Reset", "Divider"]);
const stages = {
  Baseline: [0, "quiet"], Hold: [0, "quiet"], Stop: [0, "quiet"], Reset: [0, "quiet"], Divider: [0, "quiet"],
  Undertone: [1, "sustain", "steady"], "Gradual build": [2, "build"], "Deepening build": [3, "build"],
  "Onset rise": [3, "build"], "Rebuild rise": [3, "build"], "Sustain wave": [3, "sustain", "wave"],
  "Deep sustain": [4, "sustain", "wave"], "Crest approach": [4, "build"], Crest: [5, "peak"],
  Taper: [2, "recover"], Recovery: [1, "recover"],
};
const referencePatterns = {build: "Gradual build", onset: "Onset rise", rebuild: "Rebuild rise", sustain: "Sustain wave"};
const caps = {default: DEFAULT_EXPERIENCE.maximum, tight: DEFAULT_CHANNEL_CALIBRATION.background, zero: 0};
const invalidReport = "Use a source-free report pinned to the neutral fixtures.";

function fixtureTimings() {
  return new Map(wholeStoryAnnotationFixtures.map(({id, paragraphs}) => [id,
    buildWholeStoryIndex(paragraphs.join("\n\n")).units.map(({text}) =>
      text.match(/[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu)?.length ?? 0)]));
}

function validateWork(work, pins) {
  const pin = pins.find(({id}) => id === work?.id);
  if (!pin || pin.sourceSha256 !== work.sourceSha256 || !Array.isArray(work.units) || work.units.length !== pin.units.length ||
      work.units.some((row, i) => row?.id !== pin.units[i].id || row.unitSha256 !== pin.units[i].unitSha256 ||
        !Object.hasOwn(stages, row.compiler?.pattern) || (row.compiler.beatAnchor != null &&
          (!Number.isInteger(row.compiler.beatAnchor) || row.compiler.beatAnchor < 0 || row.compiler.beatAnchor > row.id)))) {
    throw new TypeError(invalidReport);
  }
  return pin;
}

function project(work, pin, isolated) {
  let previousBeat = null;
  return work.units.map((row, index) => {
    const {behavior: {playbackGate}, narrativePhase} = pin.units[index];
    const pattern = isolated ? playbackGate === "active" ? referencePatterns[narrativePhase] :
      playbackGate === "hard-stop" ? "Stop" : playbackGate === "reset" ? "Reset" : "Baseline" : row.compiler.pattern;
    const [level, phase, rendererPattern] = stages[pattern];
    const currentCue = (isolated ? playbackGate === "active" : row.applied?.readerCue === true) &&
      ["build", "sustain", "peak"].includes(phase);
    // Older diagnostic reports lacked the compiler's anchor. For those reports,
    // contiguous active units share a projection clock until a quiet boundary.
    const beat = level ? (!isolated ? row.compiler.beatAnchor : null) ?? previousBeat ?? row.id : null;
    previousBeat = beat;
    return {level, playbackGate, profile: {phase, quiet: hard.has(pattern), rhythm: "steady", sceneId: beat === null ? null : beat + 1,
      ...(rendererPattern ? {pattern: rendererPattern} : {}), ...(phase === "peak" ? {peakPreset: DEFAULT_EXPERIENCE.peakPattern} : {}),
      ...(currentCue ? {currentCue: true, simulatorSceneId: beat + 1} : {})}};
  });
}

async function replay(work, pin, timings, wpm, maximum, isolated) {
  const clock = new SimulationClock();
  const simulator = new ProfileSimulator({model: "lush", now: clock.now});
  const dispatches = [];
  const command = simulator.command.bind(simulator);
  simulator.command = (level, seconds) => {
    command(level, seconds);
    dispatches.push({at: clock.now(), level, seconds});
  };
  const playback = new PlaybackController({device: simulator, now: clock.now, setTimer: clock.setTimer,
    clearTimer: clock.clearTimer, getMovement: () => "vibrate", heartbeatMs});
  const projection = project(work, pin, isolated);
  const background = Math.min(maximum, DEFAULT_CHANNEL_CALIBRATION.background);
  playback.connect();
  playback.setStory(projection.map(row => row.level), projection.map(row => row.profile));
  playback.setFeel({...DEFAULT_CHANNEL_CALIBRATION, mode: "continuous", rhythm: DEFAULT_EXPERIENCE.rhythm, maximum,
    background, preferred: Math.min(maximum, DEFAULT_CHANNEL_CALIBRATION.preferred)});
  playback.setCeilingFromControl(maximum);
  playback.start();
  const counts = {observedMs: 0, positiveTargetMs: 0, positiveTargetZeroMs: 0, capViolationMs: 0,
    authoritativeQuietTargets: 0, authoritativeQuietViolations: 0, quietAboveBackgroundMs: 0};
  const episodes = [], firstDispatchDelaysMs = [];
  let episode = null;
  for (const [index, {playbackGate}] of projection.entries()) {
    const start = clock.now();
    const dwellMs = Math.max(sampleMs, Math.round(timings[index] * 60_000 / wpm / sampleMs) * sampleMs);
    const dispatchStart = index === 0 ? 0 : dispatches.length;
    const authoritativeQuiet = playbackGate === "hard-stop" || playbackGate === "reset";
    let quietViolation = false, positiveTarget = false;
    playback.activity();
    playback.setPosition(index);
    if (playbackGate !== "active") episode = null;
    else if (episode === null) {
      episode = {unitIds: [], dwellMs: 0, contrastMs: 0, longestContrastMs: 0};
      episodes.push(episode);
    }
    if (episode) episode.unitIds.push(index);
    for (let elapsed = 0; elapsed < dwellMs; elapsed += sampleMs) {
      const output = simulator.snapshot().strength;
      const target = playback.snapshot().target;
      positiveTarget ||= target > 0;
      counts.observedMs += sampleMs;
      if (target > 0) counts.positiveTargetMs += sampleMs;
      if (target > 0 && output === 0) counts.positiveTargetZeroMs += sampleMs;
      if (output > maximum) counts.capViolationMs += sampleMs;
      if (playbackGate === "quiet" && output > background) counts.quietAboveBackgroundMs += sampleMs;
      if (authoritativeQuiet && output > 0) quietViolation = true;
      if (episode) {
        episode.dwellMs += sampleMs;
        episode.contrastMs = output > background ? episode.contrastMs + sampleMs : 0;
        episode.longestContrastMs = Math.max(episode.longestContrastMs, episode.contrastMs);
      }
      await clock.advance(sampleMs);
    }
    if (authoritativeQuiet) counts.authoritativeQuietTargets++;
    if (quietViolation) counts.authoritativeQuietViolations++;
    if (positiveTarget) {
      const dispatch = dispatches[dispatchStart];
      firstDispatchDelaysMs.push(dispatch && dispatch.at < start + dwellMs ? dispatch.at - start : null);
    }
  }
  playback.pause();
  const dispatchCount = dispatches.length;
  await clock.advance(3000);
  const qualified = episodes.filter(episode => maximum > background && episode.dwellMs >= minimumContrastDwellMs);
  return {id: pin.id, ...counts, contrastEpisodes: qualified.length,
    contrastedEpisodes: qualified.filter(episode => episode.longestContrastMs >= heartbeatMs).length,
    missedContrastEpisodes: qualified.filter(episode => episode.longestContrastMs < heartbeatMs).map(episode => episode.unitIds),
    firstDispatchDelaysMs, dispatchCount,
    commandViolations: dispatches.filter(({level, seconds}, i) => level > maximum || seconds !== 2 ||
      (i > 0 && dispatches[i].at - dispatches[i - 1].at < heartbeatMs)).length,
    pauseViolation: Number(simulator.snapshot().strength !== 0 || dispatches.length !== dispatchCount)};
}

function summarize(works) {
  const fields = ["observedMs", "positiveTargetMs", "positiveTargetZeroMs", "capViolationMs", "authoritativeQuietTargets",
    "authoritativeQuietViolations", "quietAboveBackgroundMs", "contrastEpisodes", "contrastedEpisodes", "dispatchCount",
    "commandViolations", "pauseViolation"];
  const counts = Object.fromEntries(fields.map(key => [key, works.reduce((sum, row) => sum + row[key], 0)]));
  const delays = works.flatMap(({firstDispatchDelaysMs}) => firstDispatchDelaysMs);
  const observedDelays = delays.filter(value => value !== null).sort((a, b) => a - b);
  return {...counts, contrastRate: counts.contrastEpisodes ? counts.contrastedEpisodes / counts.contrastEpisodes : null,
    positiveTargetZeroRate: counts.positiveTargetMs ? counts.positiveTargetZeroMs / counts.positiveTargetMs : null,
    observedDispatches: observedDelays.length, missingDispatches: delays.length - observedDelays.length,
    p95FirstDispatchMs: observedDelays[Math.ceil(observedDelays.length * .95) - 1] ?? null};
}

export async function runLunaProtocolSimulator({reports} = {}) {
  reports ??= [await runLunaProtocolNeutral({mode: "mock", arm: "complete"})];
  const reference = getNeutralProtocolReference();
  if (!Array.isArray(reports) || !reports.length) throw new TypeError(invalidReport);
  const timings = fixtureTimings(), results = [];
  for (const report of reports) {
    if (report?.sourceProseIncluded !== false || report.fixtureDigest !== reference.fixtureDigest ||
        !["complete", "windowed"].includes(report.arm) || !/^nocturne-luna-protocol-v\d+$/u.test(report.rubricVersion) ||
        !["offline-reference-mock", "offline-injected-mock", "live-neutral-provider"].includes(report.measurement) ||
        !Array.isArray(report.diagnostics) || !report.diagnostics.length ||
        new Set(report.diagnostics.map(work => work?.id)).size !== report.diagnostics.length) throw new TypeError(invalidReport);
    const pins = report.diagnostics.map(work => validateWork(work, reference.works));
    for (const isolated of [true, false]) for (const wpm of [120, 240, 420]) for (const [calibration, maximum] of Object.entries(caps)) {
      const works = [];
      for (const [i, work] of report.diagnostics.entries()) {
        works.push(await replay(work, pins[i], timings.get(work.id), wpm, maximum, isolated));
      }
      results.push({arm: report.arm, measurement: report.measurement, rubricVersion: report.rubricVersion,
        fixtureIds: pins.map(({id}) => id), lane: isolated ? "reference-projection" : "shadow-projection",
        wpm, calibration, maximum, summary: summarize(works), works});
    }
  }
  return {schemaVersion: 1, sourceProseIncluded: false, device: "lush", sampleMs, heartbeatMs, minimumContrastDwellMs,
    scope: "Research projection of fixed sentence profiles through the production synchronous simulator. No reader UI, physical transport or preference evidence.",
    behaviorReferenceVersion: reference.behaviorReferenceVersion, results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values: {report}} = parseArgs({options: {report: {type: "string", multiple: true}}});
    const reports = report && await Promise.all(report.map(async path => JSON.parse(await readFile(path, "utf8"))));
    process.stdout.write(`${JSON.stringify(await runLunaProtocolSimulator({reports}), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof TypeError && error.message === invalidReport ? invalidReport : "The simulator replay could not run."}\n`);
    process.exitCode = 1;
  }
}
