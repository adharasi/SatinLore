import assert from "node:assert/strict";
import {isDeepStrictEqual} from "node:util";
import {ProfileSimulator} from "../app/static/devices/profile-simulator.mjs";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {CombinedReadingFeel, sceneStagePatternLabel} from "../app/static/reader/calibration.mjs";
import {ANALYSIS_VERSION, ReaderModel} from "../app/static/reader/model.mjs";
import {nocturneCandidates, requestNocturne} from "../app/static/reader/nocturne.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";
import {handleSceneAnalysis} from "../deploy/cloudflare/scene-analysis.mjs";
import {MODEL_EVALUATION_STORIES} from "../tests/reader-model-evaluation-fixtures.mjs";

const live = process.argv[2] === "--live-provider";
if (process.argv.length !== (live ? 3 : 2)) throw new Error("Use node scripts/evaluate-reader-models.mjs [--live-provider].");
const providerKey = live ? process.env.OPENAI_API_KEY : "sk-proj-fixture-secret-for-evaluation";
if (!providerKey) throw new Error("Set an authorized OpenAI project key in the process environment to run live provider evaluation.");

const origin = "https://app.satinlore.test";
const cueFields = ["id", "movementCount", "next", "phase", "previous", "rhythm", "shape"];
const maximum = 10;
const timestamps = [0, 2000, 4000, 6000, 8000];

// The deterministic mock reads the same abstract cues as Luna. It never
// receives the annotated answers, and does not estimate Luna's accuracy.
function mockLabel({phase, shape}) {
  if (shape === "unspecified") return "abstain";
  if (phase === "peak") return shape === "sustained" ? "crest" : "accents";
  if (phase === "sustain") return shape === "alternating" || shape === "accented" ? "wave" : "steady";
  return "abstain";
}

async function classify(cues) {
  if (!cues.length) return {labels: new Map(), code: null, calls: 0};
  const session = {subject: "fixture-reader", expiresAt: Date.now() + 60_000};
  const config = {origin, issuer: "https://fixture.cloudflareaccess.com"};
  const env = {OPENAI_API_KEY: providerKey, SCENE_ANALYSIS_BUDGET: {
    idFromName: name => name,
    get: () => ({fetch: async () => new Response(null, {status: 204})}),
  }};
  let calls = 0;
  let boundaryExact = false;
  const result = await requestNocturne(cues, {request: (path, options) => handleSceneAnalysis(new Request(origin + path, {
    ...options, headers: {...options.headers, Origin: origin},
  }), env, {config, session, reverify: async () => session, analysisFetcher: (url, request) => {
    calls++;
    const body = JSON.parse(request.body);
    const input = JSON.parse(body.input);
    boundaryExact = isDeepStrictEqual(input, {cues}) &&
      isDeepStrictEqual(Object.keys(body).sort(), ["input", "instructions", "max_output_tokens", "model", "prompt_cache_options", "reasoning", "store", "text"]) &&
      body.store === false && body.model === "gpt-6-luna" && body.text.format.strict === true &&
      body.max_output_tokens === 600 && request.redirect === "error" &&
      url === "https://api.openai.com/v1/responses" && cues.length <= 16 &&
      cues.every(cue => isDeepStrictEqual(Object.keys(cue).sort(), cueFields));
    if (!boundaryExact) throw new Error("Unexpected outbound cue boundary.");
    if (live) return fetch(url, request);
    const labels = input.cues.map(cue => ({id: cue.id, label: mockLabel(cue)}));
    return Response.json({status: "completed", output: [{type: "message", role: "assistant", content: [
      {type: "output_text", text: JSON.stringify({labels})},
    ]}]});
  }})});
  assert.ok(boundaryExact || calls === 0 && live, "Only the expected stateless cue payload can leave the evaluator.");
  return {...result, calls};
}

async function trace(toy, levels, profiles, position, manualZeros) {
  const clock = new SimulationClock();
  const device = new ProfileSimulator({model: toy, now: clock.now});
  const {simChannels} = device.profile;
  const commands = [];
  const command = device.command.bind(device), commandVector = device.commandVector.bind(device);
  device.command = (level, seconds) => {
    commands.push({at: clock.now(), levels: {vibrate: level}, seconds});
    command(level, seconds);
  };
  device.commandVector = (vector, seconds) => {
    commands.push({at: clock.now(), levels: {...vector}, seconds});
    commandVector(vector, seconds);
  };
  const playback = new PlaybackController({device, now: clock.now, setTimer: clock.setTimer,
    clearTimer: clock.clearTimer, getMovement: () => "vibrate"});
  if (simChannels.length > 1) {
    playback.feel = new CombinedReadingFeel(Object.fromEntries(simChannels.map(channel => [channel, {maximum, rhythm: "scene"}])),
      {automaticMovement: true, preferredMovement: "vibrate"});
  } else playback.setFeel({rhythm: "scene"});
  playback.connect();
  playback.setStory(levels, profiles);
  playback.setCeilingFromControl(maximum);
  playback.setManualZeros(manualZeros);
  playback.setPosition(position);
  assert.equal(device.snapshot().strength, 0);
  assert.equal(commands.length, 0);
  assert.equal(playback.start(), true);
  const samples = [device.snapshot().channels];
  for (let index = 1; index < timestamps.length; index++) {
    await clock.advance(timestamps[index] - timestamps[index - 1]);
    assert.ok(playback.snapshot().running, "The simulator must remain armed throughout the sampled section.");
    samples.push(device.snapshot().channels);
  }
  playback.pause();
  assert.equal(device.snapshot().strength, 0);
  const commandCount = commands.length;
  await clock.advance(3000);
  assert.equal(commands.length, commandCount, "Stop prevents renewed output.");
  for (const [index, frame] of commands.entries()) {
    assert.equal(frame.seconds, 2);
    assert.ok(index === 0 || frame.at - commands[index - 1].at >= 1000);
    assert.ok(Object.entries(frame.levels).every(([id, level]) => simChannels.includes(id) && level >= 0 && level <= maximum));
  }
  const movements = simChannels.filter(channel => samples.some(sample => sample[channel] > 0));
  return {movements, samples, commandCount};
}

async function evaluate(story) {
  const model = new ReaderModel();
  const paragraphs = model.load(story.sections.map(section => section.text).join("\n\n"));
  const manualZeros = story.sections.flatMap((section, index) => section.expected.manualZero ? [index] : []);
  for (const index of manualZeros) model.setOverride(index, 0);
  const {cues, excluded, limited} = nocturneCandidates(paragraphs);
  const {labels, code, calls} = await classify(cues);
  if (!live) assert.ok(labels instanceof Map);
  model.nocturneLabels = labels ?? new Map();
  const levels = model.effectiveLevels();
  const loomProfiles = model.effectiveProfiles();
  const nocturneProfiles = model.effectiveProfiles({nocturne: true});
  assert.deepEqual(nocturneProfiles.map(({pattern, ...profile}) => profile), loomProfiles);
  const simChannels = new ProfileSimulator({model: story.toy}).profile.simChannels;
  const sections = [];
  for (const [index, {name, expected}] of story.sections.entries()) {
    const {phase, suggestedLevel, movements, quiet, cloudExcluded, shape} = paragraphs[index];
    const cue = cues.find(candidate => candidate.id === index);
    const loom = await trace(story.toy, levels, loomProfiles, index, manualZeros);
    const nocturne = await trace(story.toy, levels, nocturneProfiles, index, manualZeros);
    const intendedActive = expected.phase !== "quiet" && !expected.manualZero;
    const supported = simChannels.filter(channel => expected.movements.includes(channel));
    const expectedOutput = intendedActive ? supported.length ? supported : ["vibrate"] : [];
    const label = cue && labels ? labels.get(index) ?? "abstain" : null;
    assert.deepEqual(nocturne.movements, loom.movements, "Nocturne cannot add or change the active movements.");
    if (expected.manualZero) assert.deepEqual([loom.commandCount, nocturne.commandCount], [0, 0]);
    if (expected.boundary) assert.deepEqual([loom.commandCount, nocturne.commandCount], [0, 0]);
    sections.push({name, expected: {...expected, output: expectedOutput}, observed: {phase, suggestedLevel, movements, quiet,
      shape, cloudExcluded, cue, label, loom, nocturne},
    matched: {phase: expected.phase === phase, activation: intendedActive === (loom.movements.length > 0),
      movementCue: isDeepStrictEqual(movements, expected.movements), output: isDeepStrictEqual(loom.movements, expectedOutput),
      shape: expected.shape === undefined ? null : shape === expected.shape,
      eligibility: Boolean(cue) === (expected.label !== undefined), label: expected.label === undefined || label === null ? null : expected.label === label,
      blockedFromProvider: expected.blocked ? !cue : null},
    pattern: {loom: sceneStagePatternLabel(phase) ?? null, nocturne: sceneStagePatternLabel(phase, nocturneProfiles[index].pattern) ?? null,
      outputChanged: !isDeepStrictEqual(loom.samples, nocturne.samples)}});
  }
  return {name: story.name, toy: story.toy, candidates: cues.length, excluded, limited, providerCalls: calls, providerCode: code, sections};
}

const stories = [];
for (const story of MODEL_EVALUATION_STORIES) stories.push(await evaluate(story));
const sections = stories.flatMap(story => story.sections);
const metrics = Object.fromEntries(Object.keys(sections[0].matched).map(metric => {
  const measured = sections.filter(section => section.matched[metric] !== null);
  return [metric, {correct: measured.filter(section => section.matched[metric]).length, total: measured.length}];
}));
const activation = {
  falseOns: sections.filter(section => !section.expected.output.length && section.observed.loom.movements.length).length,
  misses: sections.filter(section => section.expected.output.length && !section.observed.loom.movements.length).length,
  changedByNocturne: sections.filter(section => section.pattern.outputChanged).length,
  phaseOrMovementChangedByNocturne: 0,
};
const phases = Object.fromEntries(["quiet", "build", "sustain", "peak", "recover"].map(phase => {
  const cases = sections.filter(section => section.expected.phase === phase);
  return [phase, {correct: cases.filter(section => section.matched.phase).length, total: cases.length}];
}));
console.log(JSON.stringify({analysisVersion: ANALYSIS_VERSION, provider: live ? "live Luna through local Worker handler" : "deterministic mock",
  sampleMs: timestamps, maximum, sectionCount: sections.length, metrics, phases, activation, stories}, null, 2));
