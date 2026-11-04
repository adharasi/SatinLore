import test from "node:test";
import assert from "node:assert/strict";
import {ReaderDeviceController} from "../app/static/devices/reader-device.mjs";
import {DEFAULT_CHANNEL_CALIBRATION} from "../app/static/reader/calibration.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";
import {ReaderModel} from "../app/static/reader/model.mjs";

const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
class VectorBridge {
  constructor(){this.listeners=new Set();this.toys=[];this.selected=null;this.calls=[];this.stops=[];this.supportsCombined=true;this.ceiling=5;this.physical={};}
  snapshot(){return{liveConfigured:true,connectionState:this.selected?"paused":"discovered",toys:this.discover(),selectedId:this.selected,qrUrl:null,connectionMessage:"Synthetic bridge"};}
  notify(){this.onChange?.(this.snapshot());}
  async begin(){this.toys=[{id:"physical-fixture",label:"Flexer",model:"flexer",capabilities:["vibrate","fingering"],supportsCombined:this.supportsCombined,controlTransport:this.supportsCombined?"standard-socket-v1":"basic-js"}];this.notify();return true;}
  discover(){return this.toys.map(toy=>({...toy,name:toy.label,vibration:true}));}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  async connect(frame){this.selected=frame.deviceId;this.notify();return{...frame,connected:true};}
  async command(frame){this.calls.push({frame:{...frame},channel:this.channel});this.physical={[this.channel]:frame.level};return{...frame};}
  commandVector(frame,levels,ceilings){
    this.calls.push({frame:{...frame},levels:{...levels},ceilings:{...ceilings}});this.physical={...levels};
    if(this.gate)return this.gate.then(()=>({...frame,levels:{...levels}}));
    return Promise.resolve({...frame,levels:this.wrongVector?{vibrate:levels.fingering,fingering:levels.vibrate}:{...levels}});
  }
  async stop(frame){this.stops.push({...frame});this.physical={vibrate:0,fingering:0};return{...frame,level:0};}
  async disconnect(frame){return{...frame};}
  setChannel(value){this.channel=value;}
  setCeiling(value){this.ceiling=value;}
  async enablePersonalRange({deviceId,channels,confirmedStopped}){this.rangeRequest={deviceId,channels,confirmedStopped};return true;}
  dispose(){this.selected=null;this.toys=[];this.notify();}
  destroy(){this.dispose();}
}
function fixture(){const clock=new SimulationClock(),bridge=new VectorBridge(),controller=new ReaderDeviceController({bridge,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer});return{clock,bridge,c:controller};}
const settings=value=>({...DEFAULT_CHANNEL_CALIBRATION,...value});
async function select(f,mode="lovense"){
  f.c.setStory([5,0,3]);await f.c.beginConnection({mode,model:"flexer"});await f.c.selectDevice(mode==="lovense"?"physical-fixture":"sim-flexer");
}
async function check(f,channel){const pulse=f.c.test({channel,level:1});await settle();await f.clock.advance(2000);assert.equal(await pulse,true);assert.equal(f.c.confirmTest(),true);}
const vectorCalls=f=>f.bridge.calls.filter(call=>call.levels);

test("account maximum is a simulator default while real commands remain gentle and re-pairing preserves a deliberate zero", async t => {
  const f = fixture(), {c, bridge, clock} = f;
  t.after(() => c.destroy());
  c.setReadingDefaults({quiet: "edging", maximum: 16, rhythm: "dynamic"});
  assert.equal(c.snapshot().ceiling, 16);
  assert.equal(c.snapshot().feel.rhythm, "dynamic");
  assert.equal(c.snapshot().running, false);
  await select(f);
  assert.equal(c.snapshot().ceiling, 5);
  assert.equal(bridge.ceiling, 5);
  assert.equal(bridge.rangeRequest, undefined);
  await check(f, "vibrate");
  assert.equal(c.start(), true);
  await settle();
  c.setReadingDefaults({quiet: "continuous", maximum: 20, rhythm: "gentle"});
  await settle();
  assert.equal(c.snapshot().running, false);
  assert.equal(c.snapshot().ceiling, 5);
  assert.ok(bridge.calls.every(({frame}) => frame.level <= 5 && frame.durationMs === 2000));
  c.setCeilingFromControl(0);
  await select(f);
  assert.equal(c.snapshot().ceiling, 0);
  const calls = bridge.calls.length;
  assert.equal(await c.quickTest(), false);
  assert.equal(bridge.calls.length, calls);
  await select(f, "simulator");
  assert.equal(c.snapshot().ceiling, 20, "The independently configured simulator cap remains available.");
  c.setCeilingFromControl(0);
  await select(f, "simulator");
  assert.equal(c.snapshot().ceiling, 0);
  assert.equal(await c.quickTest(), false);
  await clock.advance(4000);
  assert.equal(c.snapshot().output, 0);
});

test("a maximum of one keeps defaults valid for simulator and physical setup", async t => {
  const f = fixture(), {c} = f;
  t.after(() => c.destroy());
  c.setReadingDefaults({quiet: "continuous", maximum: 1, rhythm: "scene"});
  await select(f, "simulator");
  assert.equal(c.snapshot().calibration.channels.vibrate.preferred, 1);
  assert.equal(c.snapshot().ceiling, 1);
  await c.applyChannels(["vibrate", "fingering"], {mode: "continuous", preserveCeiling: true});
  assert.equal(c.snapshot().ceiling, 1);
  await select(f);
  await check(f, "vibrate");
  assert.equal(c.snapshot().calibration.channels.vibrate.preferred, 1);
  assert.equal(c.snapshot().ceiling, 1);
});

test("simulator exposes independent simultaneous levels and a held vector respects zero/maximum and finite expiry",async()=>{
  const f=fixture();await select(f,"simulator");const {c}=f;
  c.setCalibration("vibrate",settings({maximum:4,preferred:4}));c.setCalibration("fingering",settings({maximum:2,preferred:2,gain:.5}));
  await c.applyChannels(["vibrate","fingering"],{mode:"continuous"});assert.equal(c.snapshot().running,false);assert.deepEqual(c.snapshot().activeChannels,["vibrate","fingering"]);
  c.start();assert.deepEqual(c.snapshot().channelOutputs,{vibrate:4,fingering:2});
  c.holdChannels({vibrate:1,fingering:2});assert.equal(c.snapshot().output,0,"Reducing either channel stops the old vector immediately.");
  await f.clock.advance(1000);assert.deepEqual(c.snapshot().channelOutputs,{vibrate:1,fingering:2});
  c.setPosition(1);await f.clock.advance(1000);assert.deepEqual(c.snapshot().channelOutputs,{vibrate:1,fingering:2});
  c.setLevel(1,0);await f.clock.advance(1000);assert.deepEqual(c.snapshot().channelOutputs,{vibrate:0,fingering:0});
  c.setManualZeros([]);c.setCeilingFromControl(0);await f.clock.advance(1000);assert.deepEqual(c.snapshot().channelOutputs,{vibrate:0,fingering:0});
  c.pause();assert.equal(c.holdChannels({vibrate:2,fingering:2}),false);c.destroy();
});

test("combined live Start requires each action's completed individual check and the documented transport flag",async()=>{
  const f=fixture();await select(f);await check(f,"vibrate");
  await f.c.applyChannels(["vibrate","fingering"]);assert.equal(f.c.start(),false);assert.deepEqual(f.c.snapshot().verifiedChannels,["vibrate"]);
  await check(f,"fingering");await f.c.applyChannels(["vibrate","fingering"]);assert.equal(f.c.start(),true);await settle();
  assert.equal(vectorCalls(f).length,1);f.c.destroy();
  const basic=fixture();basic.bridge.supportsCombined=false;await select(basic);assert.equal(basic.c.snapshot().supportsCombined,false);
  await assert.rejects(basic.c.applyChannels(["vibrate","fingering"]),/does not expose/);basic.c.destroy();
});

test("an analysed overlap reaches one checked toy as one bounded combined command", async t => {
  const f = fixture();
  const {c, clock, bridge} = f;
  t.after(() => c.destroy());
  const model = new ReaderModel();
  model.load([
    "They shared a tender romantic kiss full of affection. The device vibrated and flexed together.",
    "Later that evening, they went to sleep.",
  ].join("\n\n"));
  assert.deepEqual(model.effectiveProfiles()[0].movements, ["vibrate", "fingering"]);
  await select(f);
  c.setStory(model.effectiveLevels(), model.effectiveProfiles());
  await check(f, "vibrate");
  c.setCalibration("vibrate", settings({maximum: 4, preferred: 4}));
  c.setCalibration("fingering", settings({maximum: 2, preferred: 2}));
  await c.applyChannels(["vibrate", "fingering"]);
  c.setSceneMovement(true, "vibrate");
  assert.equal(c.start(), false, "Both movement checks are required before a scene can use both.");
  assert.equal(vectorCalls(f).length, 0);
  await check(f, "fingering");
  await c.applyChannels(["vibrate", "fingering"]);
  assert.equal(vectorCalls(f).length, 0, "Applying the combination leaves playback paused.");
  assert.equal(c.start(), true);
  await settle();
  const [sent] = vectorCalls(f);
  assert.deepEqual(sent.levels, {vibrate: 4, fingering: 2});
  assert.deepEqual(sent.ceilings, {vibrate: 4, fingering: 2});
  assert.equal(sent.frame.deviceId, "physical-fixture");
  assert.equal(sent.frame.durationMs, 2000);
  c.setPosition(1);
  await settle();
  assert.deepEqual(bridge.physical, {vibrate: 0, fingering: 0});
  assert.equal(bridge.stops.at(-1).deviceId, "physical-fixture");
  await clock.advance(2300);
  assert.equal(vectorCalls(f).length, 1, "The quiet boundary cannot renew the combination.");
});

test("a named stop beats fixed movement and continuous background, while the other automatic movement can continue", async t => {
  const f = fixture();
  const {c, clock} = f;
  t.after(() => c.destroy());
  await select(f, "simulator");
  const profiles = [
    {rhythm: "steady", quiet: false, phase: "sustain", sceneId: 1, movements: ["vibrate", "fingering"]},
    {rhythm: "steady", quiet: false, phase: "sustain", sceneId: 1, movements: ["fingering"], endedMovements: ["vibrate"]},
  ];
  c.setStory([3, 3], profiles);
  c.setFeel({mode: "continuous", minimum: 2, background: 2});
  assert.equal(c.start(), true);
  assert.ok(c.snapshot().output > 0);
  c.setPosition(1);
  assert.equal(c.snapshot().output, 0);
  await clock.advance(2100);
  assert.equal(c.snapshot().output, 0);

  await c.applyChannels(["vibrate", "fingering"], {mode: "continuous"});
  assert.equal(c.start(), true);
  assert.deepEqual(c.snapshot().channelOutputs, {vibrate: 0, fingering: 0});
  c.setSceneMovement(true, "vibrate");
  await clock.advance(1100);
  assert.deepEqual(c.snapshot().channelOutputs, {vibrate: 0, fingering: 3});
  c.stop();
  assert.equal(c.snapshot().output, 0);
});

test("the async bridge stops the selected movement and cannot renew it through background after a named stop", async t => {
  const f = fixture();
  const {c, clock, bridge} = f;
  t.after(() => c.destroy());
  await select(f);
  c.setStory([3, 3], [
    {rhythm: "steady", quiet: false, phase: "sustain", sceneId: 1, movements: ["vibrate", "fingering"]},
    {rhythm: "steady", quiet: false, phase: "sustain", sceneId: 1, movements: ["fingering"], endedMovements: ["vibrate"]},
  ]);
  await settle();
  await check(f, "vibrate");
  c.setFeel({mode: "continuous", minimum: 2, background: 2});
  assert.equal(c.start(), true);
  await settle();
  assert.equal(bridge.physical.vibrate, 3);
  const callsBeforeStop = bridge.calls.length;
  const before = bridge.stops.length;
  c.setPosition(1);
  await settle();
  assert.ok(bridge.stops.length > before);
  assert.equal(bridge.stops.at(-1).deviceId, "physical-fixture");
  assert.equal(bridge.physical.vibrate, 0);
  await clock.advance(2300);
  assert.equal(bridge.calls.length, callsBeforeStop);
});

test("a live vector remains singly targeted, finite and bounded by each calibration and the global ceiling",async()=>{
  const f=fixture();await select(f);await check(f,"vibrate");await check(f,"fingering");
  f.c.setCalibration("vibrate",settings({maximum:20,preferred:12,background:8}));
  f.c.setCalibration("fingering",settings({maximum:2,preferred:2}));
  await f.c.applyChannels(["vibrate","fingering"]);assert.equal(f.c.snapshot().ceiling,5);f.c.start();await settle();
  const sent=vectorCalls(f)[0];assert.deepEqual(sent.levels,{vibrate:5,fingering:2});assert.deepEqual(sent.ceilings,{vibrate:5,fingering:2});
  assert.equal(sent.frame.deviceId,"physical-fixture");assert.equal(sent.frame.durationMs,2000);assert.equal(sent.frame.level,5);
  f.c.setCeilingFromControl(0);await settle();assert.deepEqual(f.bridge.physical,{vibrate:0,fingering:0});
  await f.clock.advance(2500);assert.equal(vectorCalls(f).length,1);f.c.destroy();
});

test("a per-channel reduction invalidates a vector even when the scalar peak is unchanged",async()=>{
  const f=fixture();await select(f);await check(f,"vibrate");await check(f,"fingering");
  await f.c.applyChannels(["vibrate","fingering"]);f.c.start();await settle();
  f.c.holdChannels({vibrate:5,fingering:1});await settle();await f.clock.advance(1100);await settle();
  const before=f.bridge.stops.length;f.c.holdChannels({vibrate:1,fingering:5});await settle();
  assert.ok(f.bridge.stops.length>before);assert.deepEqual(f.bridge.physical,{vibrate:0,fingering:0});
  await f.clock.advance(1100);assert.deepEqual(vectorCalls(f).at(-1).levels,{vibrate:1,fingering:5});f.c.destroy();
});

test("same-peak acknowledgements with swapped channel values fail closed",async()=>{
  const f=fixture();await select(f);await check(f,"vibrate");await check(f,"fingering");
  f.c.setCalibration("fingering",settings({maximum:2,preferred:2}));await f.c.applyChannels(["vibrate","fingering"]);
  f.bridge.wrongVector=true;f.c.start();await settle();assert.equal(f.c.snapshot().running,false);assert.equal(f.c.snapshot().state,"ERROR_PAUSED");
  assert.ok(f.bridge.stops.length);await f.clock.advance(2500);assert.equal(vectorCalls(f).length,1);f.c.destroy();
});

test("Ease off applies each selected action's recovery and never lets a background floor increase it",async()=>{
  const f=fixture();await select(f,"simulator");
  f.c.setCalibration("vibrate",settings({minimum:2,background:3,preferred:4,recovery:1}));
  f.c.setCalibration("fingering",settings({minimum:1,background:2,preferred:3,recovery:0}));
  await f.c.applyChannels(["vibrate","fingering"],{mode:"continuous"});f.c.start();f.c.easeOff();await f.clock.advance(1000);
  assert.deepEqual(f.c.snapshot().channelOutputs,{vibrate:1,fingering:0});f.c.setPosition(1);await f.clock.advance(1000);
  assert.deepEqual(f.c.snapshot().channelOutputs,{vibrate:1,fingering:0});f.c.followStory();await f.clock.advance(1000);
  assert.deepEqual(f.c.snapshot().channelOutputs,{vibrate:3,fingering:2});f.c.destroy();
});

test("Hold captures the known vector instead of assigning its scalar peak to every action",async()=>{
  const f=fixture();await select(f,"simulator");f.c.setCalibration("fingering",settings({maximum:2,preferred:2}));
  await f.c.applyChannels(["vibrate","fingering"]);f.c.start();assert.deepEqual(f.c.snapshot().channelOutputs,{vibrate:5,fingering:2});
  f.c.hold();f.c.setPosition(1);await f.clock.advance(1000);assert.deepEqual(f.c.snapshot().channelOutputs,{vibrate:5,fingering:2});f.c.destroy();
});

test("personal range needs a stopped observed gentle test and never raises the chosen ceiling by itself",async()=>{
  const f=fixture();await select(f);assert.equal(f.c.snapshot().maxCeiling,5);
  assert.equal(await f.c.enablePersonalRange(),false);assert.throws(()=>f.c.setCeilingFromControl(6),/maximum/);
  await check(f,"vibrate");assert.equal(await f.c.enablePersonalRange(),true);
  assert.equal(f.c.snapshot().maxCeiling,20);assert.equal(f.c.snapshot().ceiling,5);assert.equal(f.c.snapshot().running,false);
  f.c.setCeilingFromControl(14);f.c.start();await settle();assert.equal(f.bridge.calls.at(-1).frame.level,5,"The current story still determines output within the higher ceiling.");
  f.c.hold(14);await f.clock.advance(1100);assert.equal(f.bridge.calls.at(-1).frame.level,14);assert.equal(f.bridge.calls.at(-1).frame.durationMs,2000);
  assert.equal(await f.c.enablePersonalRange(),false,"Permission cannot be granted while playback is active.");
  f.c.setVisible(false);await settle();f.c.setVisible(true);assert.equal(f.c.snapshot().maxCeiling,5);assert.equal(f.c.snapshot().personalRangeEnabled,false);assert.equal(f.c.start(),false);f.c.destroy();
});

test("saved high settings do not unlock a range; permissions are per action and reset on reconnect",async()=>{
  const f=fixture();await select(f);await check(f,"vibrate");
  f.c.setCalibration("vibrate",settings({maximum:20,preferred:12,background:8}));await f.c.applyCalibration("vibrate");
  assert.equal(f.c.snapshot().ceiling,5);assert.equal(f.c.snapshot().maxCeiling,5);
  await f.c.enablePersonalRange();await f.c.applyCalibration("vibrate");assert.equal(f.c.snapshot().ceiling,20);
  await f.c.setChannel("fingering");assert.equal(f.c.snapshot().ceiling,5);assert.equal(f.c.snapshot().maxCeiling,5);
  assert.equal(await f.c.enablePersonalRange(),false);await check(f,"fingering");await f.c.applyChannels(["vibrate","fingering"]);
  assert.equal(f.c.snapshot().maxCeiling,5);assert.equal(await f.c.enablePersonalRange(),true);assert.equal(f.c.snapshot().maxCeiling,20);
  assert.deepEqual(new Set(f.bridge.rangeRequest.channels),new Set(["vibrate","fingering"]));
  await f.c.beginConnection({mode:"lovense",model:"flexer"});await f.c.selectDevice("physical-fixture");
  assert.equal(f.c.snapshot().maxCeiling,5);assert.deepEqual(f.c.snapshot().personalRangeChannels,[]);assert.equal(f.c.start(),false);f.c.destroy();
});

test("inline edits affect only the chosen combined action and its own maximum",async()=>{
  const f=fixture();await select(f,"simulator");await f.c.applyChannels(["vibrate","fingering"],{mode:"continuous"});f.c.start();
  f.c.setChannelFeel("fingering",{maximum:2,minimum:1,background:2,recovery:0,rhythm:"dynamic"});
  assert.equal(f.c.snapshot().running,true);assert.equal(f.c.snapshot().feel.channels.vibrate.maximum,10);
  assert.equal(f.c.snapshot().feel.channels.vibrate.rhythm,"steady");assert.equal(f.c.snapshot().feel.channels.fingering.maximum,2);
  await f.clock.advance(1000);assert.deepEqual(f.c.snapshot().channelOutputs,{vibrate:5,fingering:2});
  assert.equal(f.c.snapshot().ceiling,10,"A movement maximum is independent of the global ceiling.");
  f.c.setPosition(1);await f.clock.advance(1000);assert.deepEqual(f.c.snapshot().channelOutputs,{vibrate:1,fingering:2});f.c.destroy();
});

test("Follow story returns from recovery by at most two levels per renewal and Stop still wins",async()=>{
  const f=fixture();await select(f,"simulator");f.c.setCeilingFromControl(20);f.c.setStory([20]);f.c.start();f.c.easeOff(0);
  await f.clock.advance(1000);assert.equal(f.c.snapshot().output,0);f.c.followStory();
  for(const expected of [2,4,6,8]){await f.clock.advance(1000);assert.equal(f.c.snapshot().output,expected);}
  f.c.pause();await f.clock.advance(2500);assert.equal(f.c.snapshot().output,0);assert.equal(f.c.snapshot().running,false);f.c.destroy();
});

test("a delayed old vector gets a compensating Stop and never restarts after the user's Stop",async()=>{
  const f=fixture();await select(f);await check(f,"vibrate");await check(f,"fingering");await f.c.applyChannels(["vibrate","fingering"]);
  let complete;
  f.bridge.commandVector=(frame,levels,ceilings)=>{
    f.bridge.calls.push({frame:{...frame},levels:{...levels},ceilings:{...ceilings}});
    return new Promise(resolve=>{complete=()=>{f.bridge.physical={...levels};resolve({...frame,levels:{...levels}});};});
  };
  f.c.start();await settle();assert.equal(f.c.snapshot().output,null);
  f.c.stop();await settle();const before=f.bridge.stops.length;complete();await settle();
  assert.ok(f.bridge.stops.length>before);assert.deepEqual(f.bridge.physical,{vibrate:0,fingering:0});
  assert.equal(f.c.snapshot().running,false);await f.clock.advance(2500);assert.equal(vectorCalls(f).length,1);f.c.destroy();
});

test("return ramp is bounded by prior output even when a low passage delayed the return",async()=>{
  const f=fixture();await select(f,"simulator");f.c.setStory([1,20]);f.c.setCeilingFromControl(20);f.c.start();f.c.easeOff(0);
  await f.clock.advance(1000);f.c.followStory();await f.clock.advance(1000);assert.equal(f.c.snapshot().output,1);
  await f.clock.advance(3000);assert.equal(f.c.snapshot().output,1);f.c.setPosition(1);await f.clock.advance(1000);
  assert.equal(f.c.snapshot().output,3);await f.clock.advance(1000);assert.equal(f.c.snapshot().output,5);f.c.destroy();
});

test("choosing another discovered toy clears old combined actions and personal range before any Start",async()=>{
  const f=fixture();await select(f);await check(f,"vibrate");await check(f,"fingering");
  await f.c.applyChannels(["vibrate","fingering"]);await f.c.enablePersonalRange();f.c.setCeilingFromControl(18);
  f.bridge.toys.push({id:"second-fixture",label:"Nora",model:"nora",capabilities:["vibrate","rotate"],supportsCombined:true,controlTransport:"standard-socket-v1"});f.bridge.notify();
  await f.c.selectDevice("second-fixture");assert.deepEqual(f.c.snapshot().activeChannels,["vibrate"]);
  assert.equal(f.c.snapshot().ceiling,5);assert.equal(f.c.snapshot().maxCeiling,5);assert.deepEqual(f.c.snapshot().personalRangeChannels,[]);
  assert.equal(f.c.snapshot().running,false);assert.equal(f.c.start(),false);f.c.destroy();
});
