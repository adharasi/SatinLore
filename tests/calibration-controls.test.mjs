import test from "node:test";
import assert from "node:assert/strict";
import {CombinedReadingFeel, ReadingFeel, normalizeChannelCalibration, clampCalibration} from "../app/static/reader/calibration.mjs";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {AsyncPlaybackController} from "../app/static/playback/async-controller.mjs";
import {MockDevice} from "../app/static/devices/mock.mjs";
import {ProfileSimulator} from "../app/static/devices/profile-simulator.mjs";
import {ScenarioTransport} from "../app/static/simulation/transport.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";
import {ReaderDeviceController} from "../app/static/devices/reader-device.mjs";

function synchronous() {
  let time=0,sequence=0;const timers=new Map();
  const clock={now:()=>time,setTimer:(fn,ms)=>{timers.set(++sequence,{fn,at:time+ms});return sequence;},clearTimer:id=>timers.delete(id),advance(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;}};
  const device=new MockDevice(clock.now),controller=new PlaybackController({...clock,device});
  return{clock,device,controller};
}

test("calibration separates zero recovery from a nonzero minimum and clamps a saved range to the live cap",()=>{
  const value=normalizeChannelCalibration({minimum:2,background:3,preferred:8,maximum:12,recovery:0,gain:1.2,rhythm:"dynamic"});
  assert.deepEqual(clampCalibration(value,5),{minimum:2,background:3,preferred:5,maximum:5,recovery:0,gain:1.2,rhythm:"dynamic"});
  assert.throws(()=>normalizeChannelCalibration({...value,background:1}),RangeError);
  assert.throws(()=>normalizeChannelCalibration({...value,gain:1.25}),RangeError);
  assert.throws(()=>normalizeChannelCalibration({...value,token:"private"}),TypeError);
});

test("quiet defaults distinguish off, continuous and gentle simulator pulses without bypassing deliberate zeros", () => {
  const {controller, clock, device} = synchronous();
  const ordinary = {phase: "quiet", rhythm: "steady", quiet: false};
  const boundary = {...ordinary, quiet: true};
  controller.connect();
  controller.setStory([0, 0], [ordinary, boundary]);
  controller.start();
  assert.equal(device.snapshot().strength, 0);
  controller.pause();
  controller.setFeel({mode: "continuous", background: 1});
  controller.start();
  clock.advance(4000);
  assert.equal(device.snapshot().strength, 1);
  controller.pause();
  controller.setFeel({quietEdging: true});
  controller.start();
  clock.advance(1000);
  assert.equal(device.snapshot().strength, 1);
  clock.advance(1000);
  assert.equal(device.snapshot().strength, 0);
  clock.advance(4000);
  assert.equal(device.snapshot().strength, 1);
  controller.setPosition(1);
  assert.equal(device.snapshot().strength, 0);
  controller.setPosition(0);
  controller.setLevel(0, 0);
  clock.advance(3000);
  assert.equal(device.snapshot().strength, 0);
  controller.pause();
  controller.setManualZeros([]);
  clock.advance(6000);
  assert.equal(device.snapshot().strength, 0);
  const feel = new ReadingFeel();
  feel.configure({mode: "continuous", quietEdging: true, background: 1});
  assert.equal(feel.desired({base: 0, scene: ordinary, now: 2000}), 1, "The live policy keeps the existing steady background.");
  feel.configure({minimum: 1, background: 2});
  assert.equal(feel.desired({base: 0, scene: ordinary, now: 2000, simulatorStagePatterns: true}), 1,
    "A gentle pulse leaves the personal minimum in place.");
});

test("Nocturne's automatic climax follows each movement's rhythm without overriding a correction", () => {
  const feel = new ReadingFeel();
  feel.configure({preferred: 5});
  const peak = {phase: "peak", rhythm: "dynamic", quiet: false, automaticPeak: true};
  const levels = (rhythm, scene = peak) => {
    feel.configure({rhythm});
    return [0, 2000, 4000, 6000, 8000].map(now =>
      feel.desired({base: 5, ceiling: 8, scene, now, simulatorStagePatterns: true}));
  };
  assert.deepEqual(levels("steady"), [7, 7, 7, 7, 7]);
  assert.deepEqual(levels("gentle"), [5, 6, 7, 7, 5]);
  assert.deepEqual(levels("dynamic"), [5, 7, 4, 6, 3]);
  assert.deepEqual(levels("scene"), [5, 6, 7, 7, 3]);
  assert.deepEqual(levels("scene", {...peak, pattern: "accents"}), [5, 3, 7, 3, 5]);
  assert.deepEqual(levels("gentle", {...peak, manual: true}), [5, 5, 4, 4, 5]);
});

test("Nocturne edging backs off and rises again while an independent Steady movement holds", () => {
  const feel = new CombinedReadingFeel({
    vibrate: {preferred: 8, maximum: 8, rhythm: "gentle"},
    fingering: {preferred: 4, maximum: 4, rhythm: "steady"},
  }, {automaticMovement: true});
  const scene = {phase: "sustain", rhythm: "steady", quiet: false, edging: true, movements: ["vibrate", "fingering"]};
  const context = {base: 3, ceiling: 10, scene, simulatorStagePatterns: true};
  const samples = [0, 2000, 4000, 6000, 8000, 12000, 16000].map(now => feel.vector({...context, now}));
  assert.deepEqual(samples.map(sample => sample.vibrate), [5, 6, 8, 4, 6, 5, 5]);
  assert.deepEqual(samples.map(sample => sample.fingering), [4, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(feel.vector({...context, now: 6000, simulatorStagePatterns: false}), {vibrate: 6, fingering: 4});
  assert.deepEqual(feel.vector({...context, manualZero: true}), {vibrate: 0, fingering: 0});
  assert.deepEqual(feel.vector({...context, ceiling: 0}), {vibrate: 0, fingering: 0});
});

test("an explicit Nocturne peak shape applies in simulation despite ordinary rhythm, and stays out of live output", () => {
  const feel = new ReadingFeel();
  const peak = {phase: "peak", rhythm: "dynamic", quiet: false, peakPreset: "ease"};
  feel.configure({rhythm: "steady", preferred: 5});
  const outputs = (simulatorStagePatterns, scene = peak) => [0, 2000, 4000, 6000].map(now =>
    feel.desired({base: 5, ceiling: 8, scene, now, simulatorStagePatterns}));
  assert.deepEqual(outputs(true), [3, 5, 3, 6]);
  assert.deepEqual(outputs(false), [7, 7, 7, 7]);
  assert.deepEqual(outputs(true, {...peak, manual: true}), [5, 5, 5, 5]);
  assert.equal(feel.desired({base: 5, ceiling: 1, scene: peak, simulatorStagePatterns: true}), 1);
  assert.equal(feel.desired({base: 5, ceiling: 0, scene: peak, simulatorStagePatterns: true}), 0);
});

test("explicit paragraph zero, strength zero and maximum zero outrank a configured continuous background",()=>{
  const {controller:c,clock,device}=synchronous();c.connect();c.setStory([0,4]);
  c.start();assert.equal(device.snapshot().strength,0);
  c.setFeel({mode:"continuous",minimum:1,background:2});clock.advance(1000);assert.equal(device.snapshot().strength,2);
  c.setLevel(0,0);assert.equal(device.snapshot().strength,0);clock.advance(1000);assert.equal(device.snapshot().strength,0);
  c.setManualZeros([]);clock.advance(1000);assert.equal(device.snapshot().strength,2);
  c.setStrength(0);assert.equal(device.snapshot().strength,0);clock.advance(1000);assert.equal(device.snapshot().strength,0);
  c.setStrength(1);c.setCeilingFromControl(0);clock.advance(1000);assert.equal(device.snapshot().strength,0);
});

test("Hold follows the user's chosen value across paragraphs while Ease off cannot increase a quiet output",()=>{
  const {controller:c,clock,device}=synchronous();c.connect();c.setStory([4,1,0]);c.start();
  assert.equal(c.hold(3),true);clock.advance(1000);assert.equal(device.snapshot().strength,3);
  c.setPosition(1);clock.advance(1000);assert.equal(device.snapshot().strength,3);
  assert.equal(c.easeOff(1),true);clock.advance(1000);assert.equal(device.snapshot().strength,1);
  c.setPosition(0);clock.advance(1000);assert.equal(device.snapshot().strength,1);
  c.followStory();clock.advance(1000);assert.equal(device.snapshot().strength,3);clock.advance(1000);assert.equal(device.snapshot().strength,4);
  c.setPosition(2);assert.equal(device.snapshot().strength,0);
  c.easeOff(2);clock.advance(1000);assert.equal(device.snapshot().strength,0);
  assert.equal(c.snapshot().feel.playbackMode,"ease-off");
});

test("Stop, hidden return and changed stories cannot rearm a remembered Hold or floor",()=>{
  const {controller:c,clock,device}=synchronous();c.connect();c.setStory([4]);c.setFeel({mode:"continuous",background:2});c.start();c.hold(3);
  c.stop?.(); // PlaybackController's explicit Stop surface is pause.
  c.pause();assert.equal(c.snapshot().feel.playbackMode,"story");
  assert.equal(c.hold(4),false);assert.equal(c.easeOff(),false);c.followStory();clock.advance(2000);assert.equal(device.snapshot().strength,0);
  c.start();c.setVisible(false);c.setVisible(true);clock.advance(2000);assert.equal(device.snapshot().strength,0);assert.equal(c.snapshot().running,false);
  c.setStory([0]);clock.advance(2000);assert.equal(device.snapshot().strength,0);assert.equal(c.snapshot().running,false);
});

test("rhythm variants modulate only active story output and retain personal floors and ceilings",()=>{
  const feel=new ReadingFeel();feel.configure({mode:"continuous",minimum:2,background:2,rhythm:"dynamic"});feel.start(100);
  const levels=[0,2000,4000,6000].map(offset=>feel.desired({base:5,strength:1,ceiling:4,now:100+offset}));
  assert.deepEqual(levels,[4,3,4,2]);
  assert.equal(feel.desired({base:5,strength:1,ceiling:4,manualZero:true,now:2100}),0);
  feel.configure({gain:0});assert.equal(feel.desired({base:0,strength:1,ceiling:4}),0);
});

test("asynchronous Hold and recovery retain finite targeting, Stop wins, and inline maximum changes never restart",async()=>{
  const clock=new SimulationClock(),transport=new ScenarioTransport({clock}),c=new AsyncPlaybackController({transport,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  c.selectDevice("sim-a");c.setStory([0,5]);const connection=c.connect();await clock.advance(200);assert.equal(await connection,true);
  c.setFeel({mode:"continuous",background:2,recovery:0});const start=c.prepareStart();assert.ok(start);c.start(start);await clock.advance(100);assert.equal(c.snapshot().output,2);
  c.hold(4);await clock.advance(1000);assert.equal(c.snapshot().output,4);
  c.easeOff();await clock.advance(200);assert.equal(c.snapshot().output,0);c.setPosition(1);await clock.advance(1500);assert.equal(c.snapshot().output,0);
  c.followStory();await clock.advance(1100);assert.equal(c.snapshot().output,2);await clock.advance(1100);assert.equal(c.snapshot().output,4);await clock.advance(1100);assert.equal(c.snapshot().output,5);
  c.setCeilingFromControl(0);await clock.advance(100);assert.equal(c.snapshot().output,0);assert.equal(c.snapshot().running,true);
  c.setCeilingFromControl(5);await clock.advance(1100);assert.equal(c.snapshot().output,5);
  const stopped=c.pause();await clock.advance(100);await stopped;c.setFeel({mode:"continuous",background:5});c.followStory();await clock.advance(2100);assert.equal(c.snapshot().output,0);assert.equal(c.snapshot().running,false);
  assert.ok(transport.requests.filter(frame=>frame.kind==="command").every(frame=>frame.deviceId==="sim-a"&&frame.durationMs===2000&&frame.level<=5));
  c.destroy();
});

test("per-action calibration drafts do not change output and explicit Apply pauses before changing action",async()=>{
  let time=0;const c=new ReaderDeviceController({now:()=>time});
  c.setStory([4]);await c.beginConnection({mode:"simulator",model:"flexer"});await c.selectDevice("sim-flexer");c.start();
  c.setCalibration("fingering",{minimum:1,background:2,preferred:3,maximum:4,recovery:0,gain:1,rhythm:"gentle"});
  assert.equal(c.snapshot().channel,"vibrate");assert.equal(c.snapshot().running,true);assert.equal(c.snapshot().output,4);
  await c.applyCalibration("fingering");assert.equal(c.snapshot().channel,"fingering");assert.equal(c.snapshot().running,false);assert.equal(c.snapshot().output,0);
  assert.equal(c.snapshot().feel.rhythm,"gentle");assert.equal(c.snapshot().ceiling,4);
  assert.equal(c.calibrationSnapshot().channels.fingering.background,2);
  assert.throws(()=>c.setCalibration("rotate",{maximum:5}),/movement/);
  c.destroy();
});

test("same-story reconnect retains an explicit paragraph zero against a freshly enabled background",async()=>{
  const c=new ReaderDeviceController();c.setStory([0,4]);
  await c.beginConnection({mode:"simulator",model:"flexer"});await c.selectDevice("sim-flexer");c.setLevel(0,0);
  c.setFeel({mode:"continuous",background:2});c.start();assert.equal(c.snapshot().output,0);c.pause();
  await c.beginConnection({mode:"simulator",model:"flexer"});await c.selectDevice("sim-flexer");
  c.setFeel({mode:"continuous",background:2});c.start();assert.equal(c.snapshot().output,0);c.destroy();
});

test("Ease off cannot turn a pending increase into a smaller but still unwanted increase",()=>{
  const {controller:c,clock,device}=synchronous();c.connect();c.setStory([1,5]);c.start();
  c.setPosition(1);assert.equal(c.snapshot().target,5);assert.equal(c.snapshot().output,1);
  c.easeOff(2);clock.advance(1000);assert.equal(device.snapshot().strength,1);
});

test("unknown asynchronous output causes Ease off to request Stop instead of guessing a level",async()=>{
  const clock=new SimulationClock(),transport=new ScenarioTransport({clock,options:{command:{delay:700}}});
  const c=new AsyncPlaybackController({transport,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
  c.selectDevice("sim-a");c.setStory([5]);const connection=c.connect();await clock.advance(200);await connection;
  c.start(c.prepareStart());assert.equal(c.snapshot().output,null);assert.equal(c.easeOff(2),false);
  await clock.advance(1200);assert.equal(c.snapshot().running,false);assert.ok(transport.requests.some(frame=>frame.kind==="stop"));
  assert.equal(transport.requests.filter(frame=>frame.kind==="command").length,1);c.destroy();
});

test("scene rhythms apply within the user's gain, strength, maximum and quiet choices", () => {
  const feel = new ReadingFeel({rhythm: "scene"});
  const dynamic = {rhythm: "dynamic", quiet: false};
  assert.equal(feel.desired({base: 5, scene: dynamic, ceiling: 2, now: 0}), 2);
  assert.equal(feel.desired({base: 4, scene: dynamic, strength: 0.5, now: 6000}), 1);
  feel.configure({rhythm: "steady", mode: "continuous", minimum: 1, background: 2, gain: 0.5});
  assert.equal(feel.desired({base: 4, scene: dynamic, now: 6000}), 2);
  assert.equal(feel.desired({base: 0, scene: {rhythm: "steady", quiet: true}}), 0);
  assert.equal(feel.desired({base: 0, scene: {rhythm: "steady", quiet: false}}), 2);
  assert.equal(feel.desired({base: 4, scene: dynamic, manualZero: true}), 0);
});

test("an explicitly described light pulse has a distinct simulator rhythm without changing live movement", () => {
  const feel = new ReadingFeel({rhythm: "scene"});
  const scene = {phase: "sustain", rhythm: "steady", quiet: false, shape: "accented"};
  const trace = options => [0, 2000, 4000, 6000, 8000].map(now =>
    feel.desired({base: 1, scene, now, simulatorStagePatterns: true, ...options}));
  assert.deepEqual(trace({}), [2, 1, 2, 1, 1]);
  assert.deepEqual(trace({ceiling: 1}), [1, 1, 1, 1, 1]);
  assert.deepEqual(trace({ceiling: 0}), [0, 0, 0, 0, 0]);
  assert.deepEqual(trace({manualZero: true}), [0, 0, 0, 0, 0]);
  assert.deepEqual(trace({simulatorStagePatterns: false}), [1, 1, 1, 1, 1]);
  feel.configure({rhythm: "steady"});
  assert.deepEqual(trace({}), [1, 1, 1, 1, 1]);
  feel.configure({rhythm: "dynamic"});
  assert.deepEqual(trace({}), [1, 1, 1, 1, 1], "An automatic low beat must not cut out during variation.");
  feel.configure({gain: 0});
  assert.deepEqual(trace({}), [0, 0, 0, 0, 0]);
});

test("simulator stage rhythms rise, accent, and taper once within the chosen range", () => {
  const feel = new ReadingFeel({rhythm: "scene"});
  feel.configure({preferred: 9, maximum: 12});
  feel.start(100);
  const samples = (phase, base, more = {}) => [0, 2000, 4000, 6000, 8000, 16000].map(offset =>
    feel.desired({base, scene: {phase, rhythm: "dynamic"}, ceiling: 12, now: 100 + offset,
      simulatorStagePatterns: true, ...more}));
  assert.deepEqual(samples("build", 3), [5, 7, 9, 9, 9, 9]);
  assert.deepEqual(samples("peak", 5), [8, 11, 7, 9, 6, 6]);
  assert.deepEqual(samples("recover", 2), [6, 4, 3, 2, 2, 2]);
  assert.deepEqual(samples("peak", 5, {preview: true}), [8, 8, 8, 8, 8, 8]);
  assert.deepEqual(samples("peak", 5, {ceiling: 1}), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(samples("peak", 5, {ceiling: 0}), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(samples("peak", 5, {manualZero: true}), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(samples("peak", 5, {simulatorStagePatterns: false}), [11, 6, 11, 3, 11, 11]);
  assert.deepEqual(samples("peak", 5, {scene: {phase: "peak", rhythm: "dynamic", manual: true}}), [5, 3, 5, 1, 5, 5]);
  feel.configure({rhythm: "steady"});
  assert.deepEqual(samples("peak", 5), [11, 11, 11, 11, 11, 11]);
});

test("sustained simulator rhythms repeat through long dwell while other stages hold their final step", () => {
  const feel = new ReadingFeel({rhythm: "scene"});
  feel.configure({preferred: 6, maximum: 8, mode: "continuous", minimum: 1, background: 2});
  feel.start(100);
  const times = Array.from({length: 11}, (_, index) => 100 + index * 2000);
  const wave = {phase: "sustain", rhythm: "steady", quiet: false, pattern: "wave"};
  const trace = (scene, options = {}) => times.map(now =>
    feel.desired({base: 3, ceiling: 8, scene, now, simulatorStagePatterns: true, ...options}));
  assert.deepEqual(trace(wave), [4, 6, 4, 5, 4, 6, 4, 5, 4, 6, 4]);
  const pulses = {...wave, pattern: undefined, shape: "accented"};
  assert.deepEqual(trace(pulses), [6, 3, 6, 3, 5, 6, 3, 6, 3, 5, 6]);
  assert.deepEqual(trace({...pulses, shape: "alternating"}), [4, 6, 4, 6, 4, 6, 4, 6, 4, 6, 4]);
  assert.deepEqual(trace({...pulses, phase: "build"}), [6, 3, 6, 3, 5, 5, 5, 5, 5, 5, 5]);
  assert.deepEqual(trace(wave, {preview: true}), times.map(() => 4));
  assert.deepEqual(trace(wave, {ceiling: 1}), times.map(() => 1));
  assert.deepEqual(trace(wave, {manualZero: true}), times.map(() => 0));
  assert.deepEqual(trace(wave, {ceiling: 0}), times.map(() => 0));
  assert.deepEqual(trace({...wave, quiet: true}, {base: 0}), times.map(() => 0));
  assert.deepEqual(trace({...wave, endedMovements: ["vibrate"]}, {movement: "vibrate"}), times.map(() => 0));
  assert.deepEqual(trace({...wave, manual: true}), times.map(() => 3));
  assert.deepEqual(trace(wave, {simulatorStagePatterns: false}), times.map(() => 6));
});

test("the explicit steady simulator preset holds within bounds and cannot bypass corrections", () => {
  const feel = new ReadingFeel({rhythm: "dynamic"});
  feel.configure({preferred: 5});
  const scene = {phase: "peak", rhythm: "dynamic", quiet: false, peakPreset: "steady"};
  const trace = options => [0, 2000, 6000, 16000].map(now =>
    feel.desired({base: 5, ceiling: 8, scene, now, simulatorStagePatterns: true, ...options}));
  assert.deepEqual(trace({}), [7, 7, 7, 7]);
  assert.deepEqual(trace({preview: true}), [7, 7, 7, 7]);
  assert.deepEqual(trace({ceiling: 1}), [1, 1, 1, 1]);
  assert.deepEqual(trace({manualZero: true}), [0, 0, 0, 0]);
  assert.deepEqual(trace({ceiling: 0}), [0, 0, 0, 0]);
  assert.deepEqual(trace({scene: {...scene, manual: true}}), [5, 3, 1, 5]);
  assert.deepEqual(trace({simulatorStagePatterns: false}), [7, 4, 2, 7]);
});

test("a combined stage rhythm respects separate movement limits, floors, and a stopped channel", () => {
  const feel = new CombinedReadingFeel({
    vibrate: {preferred: 6, maximum: 8, rhythm: "scene"},
    fingering: {preferred: 4, maximum: 4, minimum: 2, background: 2, rhythm: "scene"},
  }, {automaticMovement: true});
  const context = {base: 5, ceiling: 8, strength: 2, simulatorStagePatterns: true,
    scene: {phase: "peak", movements: ["vibrate", "fingering"]}};
  assert.deepEqual(feel.vector({...context, now: 0}), {vibrate: 6, fingering: 3});
  assert.deepEqual(feel.vector({...context, now: 2000}), {vibrate: 8, fingering: 4});
  assert.deepEqual(feel.vector({...context, now: 12000}), {vibrate: 4, fingering: 2});
  const scene = {...context.scene, movements: ["fingering"], endedMovements: ["vibrate"]};
  assert.deepEqual(feel.vector({...context, now: 2000, scene}), {vibrate: 0, fingering: 4});
});

test("a seek within the same simulator peak does not replay its accents", () => {
  const {controller, clock, device} = synchronous();
  controller.connect();
  controller.setCeilingFromControl(5);
  controller.setStory([5], [{phase: "peak", sceneId: 1, rhythm: "dynamic", quiet: false}]);
  controller.setFeel({rhythm: "scene"});
  controller.start();
  assert.equal(device.snapshot().strength, 3);
  clock.advance(9000);
  assert.equal(device.snapshot().strength, 2);
  controller.setReadingSeeking(true);
  assert.equal(device.snapshot().strength, 0);
  controller.setReadingSeeking(false);
  clock.advance(2000);
  assert.equal(device.snapshot().strength, 2);
  controller.pause();
  clock.advance(4000);
  assert.equal(device.snapshot().strength, 0);
});

test("scene profiles follow the current paragraph and a malformed replacement pauses", () => {
  const {controller, clock} = synchronous();
  const profiles = [{rhythm: "dynamic", quiet: false}, {rhythm: "steady", quiet: true}];
  controller.connect();
  controller.setStory([4, 0], profiles);
  controller.setFeel({rhythm: "scene", mode: "continuous", background: 2});
  assert.equal(controller.snapshot().running, false);
  controller.start();
  clock.advance(6000);
  assert.equal(controller.snapshot().target, 1);
  controller.setPosition(1);
  assert.equal(controller.snapshot().target, 0);
  assert.throws(() => controller.updateLevels([4, 0], [{rhythm: "unknown", quiet: false}]), RangeError);
  assert.equal(controller.snapshot().running, false);
});

test("asynchronous playback shares scene quiet and pattern selection with the simulator", () => {
  const clock = new SimulationClock();
  const transport = new ScenarioTransport({clock});
  const controller = new AsyncPlaybackController({transport, now: () => 6000});
  controller.setStory([4, 0], [{rhythm: "dynamic", quiet: false}, {rhythm: "steady", quiet: true}]);
  controller.setFeel({rhythm: "scene", mode: "continuous", background: 2});
  assert.equal(controller.desired(), 1);
  controller.setPosition(1);
  assert.equal(controller.desired(), 0);
  assert.equal(controller.snapshot().running, false);
});

test("section steps move one level through caps and leave corrections and neighboring sections alone", () => {
  const {controller, device, clock} = synchronous();
  controller.connect();
  controller.setCeilingFromControl(5);
  controller.setStory([9, 2, 0]);
  controller.setManualZeros([2]);
  assert.equal(controller.snapshot().target, 5);
  controller.adjustLevel(-1);
  assert.equal(controller.snapshot().target, 4);
  assert.equal(device.snapshot().strength, 0);
  controller.start();
  assert.equal(device.snapshot().strength, 4);
  controller.adjustLevel(1);
  clock.advance(1000);
  assert.equal(device.snapshot().strength, 5);
  controller.adjustLevel(1);
  assert.equal(controller.snapshot().levelUp, false);
  controller.setPosition(1);
  assert.equal(controller.snapshot().target, 2);
  controller.setPosition(0);
  assert.equal(controller.snapshot().baseLevel, 9);
  controller.setPosition(2);
  controller.adjustLevel(1);
  assert.equal(controller.snapshot().target, 0);
  assert.equal(controller.snapshot().levelUp, false);
  controller.pause();
});

test("asynchronous section steps cannot start a paused connection or override a quiet scene", async () => {
  const clock = new SimulationClock();
  const transport = new ScenarioTransport({clock});
  const controller = new AsyncPlaybackController({transport, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer});
  controller.selectDevice("sim-a");
  controller.setStory([3, 0], [{rhythm: "steady", quiet: false}, {rhythm: "steady", quiet: true}]);
  const connecting = controller.connect();
  await clock.advance(200);
  assert.equal(await connecting, true);
  controller.adjustLevel(1);
  assert.equal(controller.snapshot().target, 4);
  assert.equal(transport.requests.some(request => request.kind === "command"), false);
  assert.equal(controller.start(controller.prepareStart()), true);
  await clock.advance(200);
  assert.equal(controller.snapshot().output, 4);
  controller.setPosition(1);
  controller.adjustLevel(1);
  await clock.advance(200);
  assert.equal(controller.snapshot().output, 0);
  assert.equal(controller.snapshot().levelUp, false);
  controller.destroy();
});

test("a combined simulator follows selected scene movements and never enables an unchecked movement", async t => {
  const {clock} = synchronous();
  const controller = new ReaderDeviceController(clock);
  t.after(() => controller.destroy());
  const profile = movements => ({rhythm: "steady", quiet: false, movements});
  controller.setStory([3, 3, 3], [profile(["fingering"]), profile(["oscillate"]), profile(["vibrate", "fingering"])]);
  await controller.beginConnection({mode: "simulator", model: "flexer"});
  await controller.selectDevice("sim-flexer");
  await controller.applyChannels(["vibrate", "fingering"]);
  controller.adjustLevel(1);
  controller.start();
  assert.deepEqual(controller.snapshot().channelOutputs, {vibrate: 0, fingering: 4});
  controller.pause();
  controller.setPosition(1);
  controller.start();
  clock.advance(1000);
  assert.deepEqual(controller.snapshot().channelOutputs, {vibrate: 3, fingering: 0});
  controller.pause();
  controller.setPosition(2);
  controller.start();
  clock.advance(1000);
  assert.deepEqual(controller.snapshot().channelOutputs, {vibrate: 3, fingering: 3});
});

test("automatic levels use the reader's calibration, while explicit corrections keep their own level", () => {
  const feel = new ReadingFeel();
  feel.configure({preferred: 6, maximum: 12});
  const scene = {phase: "sustain", quiet: false};
  assert.equal(feel.desired({base: 3, ceiling: 12, scene}), 6);
  assert.equal(feel.desired({base: 5, ceiling: 12, scene: {...scene, phase: "peak"}}), 9);
  assert.equal(feel.desired({base: 3, ceiling: 12, scene: {...scene, manual: true}}), 3);
  assert.equal(feel.desired({base: 5, ceiling: 4, scene}), 4);
  assert.equal(feel.desired({base: 5, ceiling: 12, scene, manualZero: true}), 0);
});

test("a lower session ceiling clamps a gentle cue instead of rounding it away", () => {
  const feel = new ReadingFeel();
  const scene = {phase: "build", quiet: false};
  assert.equal(feel.desired({base: 1, ceiling: 1, scene}), 1);
  assert.equal(feel.desired({base: 1, ceiling: 0, scene}), 0);
  assert.equal(feel.desired({base: 1, ceiling: 1, scene, manualZero: true}), 0);
});

test("simulator cue contrast uses one calibrated step and respects controls and rhythm", () => {
  const feel = new ReadingFeel({rhythm: "scene"});
  feel.configure({mode: "continuous", background: 1, preferred: 3, maximum: 10});
  const scene = {phase: "build", quiet: false, currentCue: true};
  const context = {base: 1, ceiling: 10, scene, movement: "vibrate", simulatorStagePatterns: true};
  assert.equal(feel.desired(context), 2);
  assert.equal(feel.desired({...context, simulatorStagePatterns: false}), 1);
  assert.equal(feel.desired({...context, ceiling: 1}), 1);
  assert.equal(feel.desired({...context, ceiling: 0}), 0);
  assert.equal(feel.desired({...context, manualZero: true}), 0);
  assert.equal(feel.desired({...context, scene: {...scene, manual: true}}), 1);
  assert.equal(feel.desired({...context, scene: {...scene, endedMovements: ["vibrate"]}}), 0);
  assert.equal(feel.desired({...context, base: 0, scene: {...scene, quiet: true}}), 0);
  assert.equal(feel.desired({...context, levelAdjustment: -1}), 1);
  assert.equal(feel.desired({...context, levelAdjustment: 1}), 3);
  assert.equal(feel.desired({...context, strength: 0}), 0);
  assert.equal(feel.desired({...context, strength: 0.5}), 0);
  feel.configure({gain: 0.5, minimum: 1});
  assert.equal(feel.desired(context), 1);
  feel.configure({gain: 1, preferred: 1});
  assert.equal(feel.desired(context), 1);
  feel.configure({preferred: 3, minimum: 0, quietEdging: true});
  assert.equal(feel.desired(context), 1);
  feel.configure({mode: "story", quietEdging: false});
  assert.equal(feel.desired(context), 1);
  feel.configure({mode: "continuous"});
  assert.equal(feel.desired({...context, scene: {...scene, edging: true}}), 1);
  assert.deepEqual([0, 2000, 4000].map(now => feel.desired({...context, scene: {...scene, shape: "accented"}, now})), [2, 1, 2]);
  assert.deepEqual([0, 2000, 4000].map(now => feel.desired({...context, base: 2, now})), [2, 2, 2]);
  assert.deepEqual([0, 2000, 4000].map(now => feel.desired({...context, base: 3, now})), [2, 2, 3]);
  assert.deepEqual([0, 2000, 4000].map(now => feel.desired({...context, base: 2, scene: {phase: "build", quiet: false}, now})), [1, 1, 2]);
  feel.hold(1);
  assert.equal(feel.desired(context), 1);
  feel.easeOff(0, 1);
  assert.equal(feel.desired(context), 0);
  feel.followStory(0);
  assert.equal(feel.desired(context), 0);
});

test("an adjacent verified simulator cue can ease without a zero between heartbeats", async () => {
  const clock = new SimulationClock();
  const device = new ProfileSimulator({now: clock.now});
  const controller = new PlaybackController({device, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer});
  const cue = {phase: "build", quiet: false, rhythm: "steady", currentCue: true, simulatorSceneId: 1};
  controller.connect();
  controller.setStory([3, 2, 0], [cue, cue, {phase: "quiet", quiet: true, rhythm: "steady"}]);
  controller.start();
  await clock.advance(300);
  assert.equal(device.snapshot().strength, 3);
  controller.setPosition(1);
  assert.equal(device.snapshot().strength, 2);
  assert.equal(controller.snapshot().output, 2);
  controller.setPosition(2);
  assert.equal(device.snapshot().strength, 0);
});

test("scene motion defaults to the selected movement, with opt-in switching and a safe fallback", async t => {
  const {clock} = synchronous();
  const controller = new ReaderDeviceController(clock);
  t.after(() => controller.destroy());
  const profile = movements => ({sceneId: 1, phase: "sustain", rhythm: "steady", quiet: false, movements});
  controller.setStory([3, 3], [profile(["fingering"]), profile(["oscillate"])]);
  await controller.beginConnection({mode: "simulator", model: "flexer"});
  await controller.selectDevice("sim-flexer");
  await controller.applyChannels(["vibrate", "fingering"]);
  controller.start();
  assert.deepEqual(controller.snapshot().channelOutputs, {vibrate: 3, fingering: 0});
  controller.setSceneMovement(true, "vibrate");
  clock.advance(1000);
  assert.deepEqual(controller.snapshot().channelOutputs, {vibrate: 0, fingering: 3});
  controller.setPosition(1);
  clock.advance(1000);
  assert.deepEqual(controller.snapshot().channelOutputs, {vibrate: 2, fingering: 0});
  clock.advance(1000);
  assert.deepEqual(controller.snapshot().channelOutputs, {vibrate: 3, fingering: 0});
});

test("seeking quiets the simulator, ramps back from zero and cannot undo Stop", () => {
  const {clock, controller, device} = synchronous();
  controller.setStory([4, 5]);
  controller.connect();
  controller.start();
  assert.equal(device.snapshot().strength, 4);
  controller.setReadingSeeking(true);
  assert.equal(device.snapshot().strength, 0);
  controller.setPosition(1);
  clock.advance(1000);
  assert.equal(device.snapshot().strength, 0);
  controller.setReadingSeeking(false);
  clock.advance(1000);
  assert.equal(device.snapshot().strength, 2);
  clock.advance(1000);
  assert.equal(device.snapshot().strength, 4);
  controller.setReadingSeeking(true);
  controller.pause();
  controller.setReadingSeeking(false);
  clock.advance(2000);
  assert.equal(device.snapshot().strength, 0);
  assert.equal(controller.snapshot().running, false);
});

test("a live seek stops the old intensity and can only resume the newest position", async t => {
  const clock = new SimulationClock(), transport = new ScenarioTransport({clock});
  const controller = new AsyncPlaybackController({transport, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer});
  t.after(() => controller.destroy());
  controller.selectDevice("sim-a");
  controller.setStory([4, 5, 3]);
  const connecting = controller.connect();
  await clock.advance(200);
  assert.equal(await connecting, true);
  assert.equal(controller.start(controller.prepareStart()), true);
  await clock.advance(200);
  assert.equal(controller.snapshot().output, 4);
  controller.setReadingSeeking(true);
  controller.setPosition(1);
  controller.setPosition(2);
  await clock.advance(300);
  assert.equal(controller.snapshot().output, 0);
  controller.setReadingSeeking(false);
  await clock.advance(1000);
  const commands = transport.requests.filter(request => request.kind === "command");
  assert.deepEqual(commands.map(command => command.level), [4, 2]);
  assert.ok(commands.every(command => command.deviceId === "sim-a" && command.durationMs === 2000));
});
