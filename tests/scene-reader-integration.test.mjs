import test from "node:test";
import assert from "node:assert/strict";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {normalizeSceneProfiles, ReadingFeel, scenePatternChanged} from "../app/static/reader/calibration.mjs";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {MockDevice} from "../app/static/devices/mock.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";

const story = [
  "Their tender romantic kiss expressed affection. The motion flexed.",
  "Rain tapped softly on the window.",
  "They shared a tender romantic embrace full of affection.",
].join("\n\n");

test("immediate and deferred analysis produce the same local scene mapping and preserve corrections", async () => {
  const immediate = new ReaderModel();
  immediate.load(story);
  assert.ok(immediate.effectiveLevels()[0] > 0);
  assert.deepEqual(immediate.effectiveLevels(), [3, 2, 3], "A brief sensory detail eases down within the scene.");
  assert.equal(immediate.effectiveProfiles()[1].rhythm, "gentle");
  const profiles = immediate.effectiveProfiles();
  assert.deepEqual(profiles.map(profile => profile.movements), [["fingering"], ["fingering"], []]);
  assert.deepEqual(profiles.map(profile => [profile.sceneId, profile.phase]), [[1, "sustain"], [1, "sustain"], [1, "sustain"]]);
  profiles[0].movements.push("rotate");
  assert.deepEqual(immediate.effectiveProfiles()[0].movements, ["fingering"]);
  assert.equal(immediate.paragraphs[0].sceneId, immediate.paragraphs[2].sceneId);
  const deferred = new ReaderModel();
  deferred.load(story, {deferAnalysis: true});
  deferred.setOverride(1, 0);
  assert.equal(deferred.effectiveProfiles(), undefined);
  assert.equal(await deferred.analyse({yieldTask: async () => {}, batchSize: 1}), true);
  assert.equal(deferred.effectiveProfiles()[1].manual, true);
  assert.equal(deferred.effectiveLevels()[1], 0);
  deferred.resetOverride(1);
  assert.deepEqual(deferred.effectiveProfiles(), immediate.effectiveProfiles());
  assert.deepEqual(deferred.effectiveLevels(), immediate.effectiveLevels());
});

test("failed or cancelled analysis cannot leave a scene profile active", async () => {
  const model = new ReaderModel();
  model.load(story);
  assert.ok(model.effectiveProfiles());
  const success = await model.analyse({yieldTask: async () => {}, score: () => ({band: 100, level: 20})});
  assert.equal(success, false);
  assert.equal(model.analysisStatus, "error");
  assert.equal(model.effectiveProfiles(), undefined);
  assert.deepEqual(model.effectiveLevels(), [0, 0, 0]);
  const stopped = new AbortController();
  stopped.abort();
  assert.equal(await model.analyse({yieldTask: async () => {}, signal: stopped.signal}), false);
  assert.equal(model.effectiveProfiles(), undefined);
});

test("a scene profile owns its movement arrays and rejects contradictory or unsupported ends", () => {
  const profile = {rhythm: "gentle", quiet: false, movements: ["fingering"], endedMovements: ["vibrate"]};
  const [normalized] = normalizeSceneProfiles([profile], 1);
  assert.deepEqual(normalized, profile);
  profile.endedMovements.push("rotate");
  assert.deepEqual(normalized.endedMovements, ["vibrate"]);
  for (const endedMovements of [["fingering"], ["heat"], ["vibrate", "vibrate"], "vibrate"]) {
    assert.throws(() => normalizeSceneProfiles([{...profile, endedMovements}], 1), /supported scene movements/);
  }
});

test("Nocturne picks a local simulator shape without changing levels, movements or live variation", async () => {
  const model = new ReaderModel();
  model.load([
    "They kissed gently.",
    "Their passionate, tender kiss and romantic embrace expressed affection.",
  ].join("\n\n"));
  assert.equal(model.paragraph(1).phase, "peak");
  const before = model.effectiveLevels();
  const loom = model.effectiveProfiles()[1];
  model.nocturneLabels.set(1, "crest");
  const [profile] = normalizeSceneProfiles([model.effectiveProfiles({nocturne: true})[1]], 1);
  assert.deepEqual(profile, {...loom, pattern: "crest"});
  assert.equal(model.effectiveProfiles({nocturne: true, peakPattern: "auto"})[1].automaticPeak, true);
  assert.equal(model.effectiveProfiles({nocturne: true, peakPattern: "auto", edging: true})[1].peakPreset, undefined);
  assert.equal(model.effectiveProfiles({nocturne: true, peakPattern: "accents", edging: true})[1].peakPreset, "accents");
  assert.equal(model.effectiveProfiles({nocturne: true, peakPattern: "steady"})[1].peakPreset, "steady");
  assert.equal(model.effectiveProfiles({peakPattern: "ease", edging: true})[1].peakPreset, undefined);
  assert.deepEqual(model.effectiveLevels(), before);
  assert.deepEqual(model.effectiveProfiles()[1], loom);
  assert.equal(scenePatternChanged(loom, profile, false, true), true);
  assert.equal(scenePatternChanged(loom, profile), false);

  const feel = new ReadingFeel({rhythm: "scene"});
  feel.configure({preferred: 7, maximum: 10});
  const context = {base: before[1], ceiling: 10, now: 6000};
  assert.equal(feel.desired({...context, scene: profile, simulatorStagePatterns: true}), 9);
  assert.equal(feel.desired({...context, scene: loom, simulatorStagePatterns: true}), 8);
  assert.equal(feel.desired({...context, scene: profile}), feel.desired({...context, scene: loom}));
  assert.equal(feel.desired({...context, scene: profile, simulatorStagePatterns: true, manualZero: true}), 0);
  assert.throws(() => normalizeSceneProfiles([{...profile, phase: "sustain"}], 1), /supported scene stage/);
  assert.throws(() => normalizeSceneProfiles([{...profile, peakPreset: "unknown"}], 1), /supported scene stage/);
  await model.analyse({yieldTask: async () => {}});
  assert.equal(model.effectiveProfiles({nocturne: true})[1].pattern, undefined);
});

test("a repeating sustain keeps its phase across compatible model paragraphs and resets at scene changes", async () => {
  const model = new ReaderModel();
  model.load(story);
  for (const index of [0, 1, 2]) model.nocturneLabels.set(index, "wave");
  const clock = new SimulationClock();
  const device = new MockDevice(clock.now);
  const controller = new PlaybackController({device, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer});
  controller.connect();
  controller.setStory(model.effectiveLevels(), model.effectiveProfiles({nocturne: true}));
  controller.setCeilingFromControl(8);
  controller.setFeel({rhythm: "scene", preferred: 6, maximum: 8});
  controller.start();
  assert.equal(device.snapshot().strength, 4);
  await clock.advance(2000);
  assert.equal(device.snapshot().strength, 6);
  controller.setPosition(1);
  assert.equal(controller.snapshot().target, 4, "An amplitude change keeps the wave's second step.");
  assert.equal(device.snapshot().strength, 0, "The existing immediate reduction Stop still applies.");
  await clock.advance(1000);
  assert.equal(device.snapshot().strength, 2, "The existing gradual return from Stop still applies.");
  await clock.advance(1000);
  controller.setPosition(2);
  await clock.advance(6000);
  assert.equal(device.snapshot().strength, 6, "The next cycle reaches its second step without replaying the opening.");

  const profiles = model.effectiveProfiles({nocturne: true});
  profiles[0].sceneId = 2;
  controller.updateLevels(model.effectiveLevels(), profiles);
  controller.setPosition(0);
  assert.equal(controller.snapshot().target, 4, "A new scene restarts the first step.");
  controller.pause();
  await clock.advance(3000);
  assert.equal(device.snapshot().strength, 0);
  controller.start();
  await clock.advance(1000);
  assert.equal(device.snapshot().strength, 4, "An explicit restart begins at the first step.");
  controller.pause();
});

test("Nocturne maps edging to active buildup while keeping climax and quiet boundaries separate", () => {
  const model = new ReaderModel();
  model.load([
    "Rain tapped the library window.",
    "Their tender kiss and romantic embrace built gradually.",
    "Their passionate, tender kiss and romantic embrace expressed affection.",
    "Hours later, the library opened.",
  ].join("\n\n"));
  const preferences = {nocturne: true, edging: true, peakPattern: "auto"};
  const profiles = normalizeSceneProfiles(model.effectiveProfiles(preferences), 4);
  assert.deepEqual(profiles.map(profile => profile.phase), ["quiet", "sustain", "peak", "quiet"]);
  assert.deepEqual(profiles.map(profile => profile.quiet), [false, false, false, true]);
  assert.deepEqual(profiles.map(profile => profile.edging), [undefined, true, undefined, undefined]);
  assert.deepEqual(profiles.map(profile => profile.automaticPeak), [undefined, undefined, true, undefined]);
  assert.equal(model.effectiveProfile(1, {...preferences, edgePattern: "off"}).edging, undefined);
  assert.equal(model.effectiveProfile(1, {...preferences, edging: false}).edging, undefined);
  assert.equal(model.effectiveProfile(1, {...preferences, edging: false, edgePattern: "ease"}).edging, true);
  assert.equal(model.effectiveProfile(1, {...preferences, nocturne: false}).edging, undefined);
  assert.throws(() => normalizeSceneProfiles([{...profiles[2], edging: true}], 1), /supported scene stage/);
  assert.throws(() => normalizeSceneProfiles([{...profiles[3], automaticPeak: true}], 1), /supported scene stage/);

  model.load([
    "Their tender kiss and romantic embrace built gradually.",
    "Their passionate, tender kiss in short bursts and romantic embrace expressed affection.",
  ].join("\n\n"));
  assert.equal(model.effectiveProfile(1, preferences).pattern, "accents", "A clear local cue works before a hosted analysis.");
  model.nocturneLabels.set(1, "crest");
  assert.equal(model.effectiveProfile(1, preferences).pattern, "crest", "A valid hosted label can refine the local pattern.");
});
