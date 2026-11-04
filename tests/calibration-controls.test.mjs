import test from "node:test";
import assert from "node:assert/strict";
import {ReadingFeel, normalizeChannelCalibration, clampCalibration} from "../app/static/reader/calibration.mjs";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {AsyncPlaybackController} from "../app/static/playback/async-controller.mjs";
import {MockDevice} from "../app/static/devices/mock.mjs";
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

test("a continuous background is opt-in and explicit paragraph zero, strength zero and maximum zero outrank it",()=>{
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
