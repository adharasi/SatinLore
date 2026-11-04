import test from "node:test";
import assert from "node:assert/strict";
import {ReaderDeviceController} from "../app/static/devices/reader-device.mjs";
import {getToyProfile,TOY_PROFILES} from "../app/static/devices/toy-profiles.mjs";

const settle = async () => {for(let index=0;index<12;index++)await Promise.resolve();};
function clock(){let time=0,sequence=0;const timers=new Map();return{now:()=>time,setTimer:(fn,delay)=>{timers.set(++sequence,{fn,at:time+delay});return sequence;},clearTimer:id=>timers.delete(id),async advance(ms){const target=time+ms;while(true){const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}time=target;await settle();},timers};}
class FakeBridge {
  constructor(){this.listeners=new Set();this.toys=[];this.selected=null;this.available=true;this.qrUrl=null;this.channel="vibrate";this.ceiling=5;this.calls=[];this.stops=[];this.model="lush";this.commands=[];}
  snapshot(){return{liveConfigured:this.available,connectionState:this.selected?"paused":"discovered",toys:this.discover(),selectedId:this.selected,qrUrl:this.qrUrl,connectionMessage:this.available?"Ready":"Not configured"};}
  notify(){this.onChange?.(this.snapshot());}
  async begin(){if(!this.available){this.notify();return false;}this.toys=[{id:"physical-toy",label:getToyProfile(this.model).label,model:this.model,capabilities:[...getToyProfile(this.model).physicalChannels]}];this.notify();return true;}
  discover(){return this.toys.map(toy=>({...toy,name:toy.label,vibration:true}));}
  subscribe(callback){this.listeners.add(callback);return()=>this.listeners.delete(callback);}
  async connect(frame){this.selected=frame.deviceId;this.notify();return{...frame,connected:true};}
  command(frame){this.commands.push({...frame,channel:this.channel,ceiling:this.ceiling,at:this.now?.()});return this.commandGate||Promise.resolve({...frame});}
  async stop(frame){this.stops.push({...frame});if(this.failStop)throw Error("Synthetic Stop failure");return{...frame,level:0};}
  async disconnect(frame){return{...frame};}
  setChannel(channel){this.channel=channel;}
  setCeiling(value){this.ceiling=value;}
  refresh(){return this.snapshot();}
  dispose(){const previous=this.selected;this.selected=null;this.toys=[];if(previous)for(const callback of this.listeners)callback({type:"disconnect",deviceId:previous});this.notify();}
  destroy(){this.dispose();}
}
function fixture({bridge=new FakeBridge(),onChange=()=>{}}={}){const timing=clock();bridge.now=timing.now;const controller=new ReaderDeviceController({...timing,bridge,onChange});return{controller,bridge,...timing};}

test("a successful sign-in check clears the temporary expiry message without starting output",()=>{
  const app=fixture(),c=app.controller;
  c.setAuthorized(false);assert.match(c.snapshot().reason,/Sign-in expired/);
  c.setAuthorized(true);assert.doesNotMatch(c.snapshot().reason,/expired/);assert.equal(c.snapshot().connected,false);assert.equal(c.snapshot().running,false);
  c.setStory([3]);c.connect();c.start();c.setAuthorized(false);assert.equal(c.snapshot().output,0);
  c.setAuthorized(true);assert.match(c.snapshot().reason,/Sign-in checked/);assert.equal(c.snapshot().running,false);assert.equal(c.snapshot().output,0);
  c.destroy();
});

test("all profiles require explicit rehearsal selection and keep chosen channel output finite",async()=>{
  for(const profile of TOY_PROFILES){
    const app=fixture();const c=app.controller;c.setStory([3,0,5]);
    const setup=await c.beginConnection({mode:"simulator",model:profile.id});
    assert.equal(setup.connected,false);assert.equal(setup.selectedId,null);assert.equal(c.start(),false);
    assert.equal(setup.ceiling,10);
    assert.ok(profile.simChannels.every(channel=>setup.calibration.channels[channel].maximum===10));
    await c.selectDevice(`sim-${profile.id}`);assert.equal(c.snapshot().connected,true);assert.equal(c.snapshot().running,false);
    for(const channel of profile.simChannels){const result=c.test({channel,level:1});await settle();assert.equal(c.snapshot().testing,true);assert.equal(c.snapshot().channelOutputs[channel],1);assert.equal(c.start(),false);await app.advance(2000);assert.equal(await result,true);assert.equal(c.snapshot().output,0);assert.equal(c.snapshot().lastTest,undefined);assert.equal(c.setupSnapshot().lastTest.channel,channel);}
    assert.equal(c.start(),true);assert.equal(c.snapshot().output,3);c.pause();assert.equal(c.snapshot().output,0);c.destroy();
  }
});

test("a simulator keeps its chosen maximum when returning from a bounded physical connection",async()=>{
  const {controller:c}=fixture();c.setStory([20,0]);
  await c.beginConnection({mode:"simulator",model:"lush"});await c.selectDevice("sim-lush");
  assert.equal(c.snapshot().ceiling,10);assert.equal(c.snapshot().feel.maximum,10);assert.equal(c.snapshot().output,0);
  c.setCeilingFromControl(8);c.setChannelFeel("vibrate",{maximum:8});c.setManualZeros([1]);
  await c.beginConnection({mode:"lovense",model:"lush"});await c.selectDevice("physical-toy");
  assert.equal(c.snapshot().ceiling,5);assert.equal(c.snapshot().calibration.channels.vibrate.maximum,5);
  assert.equal(c.snapshot().personalRangeEnabled,false);assert.equal(c.start(),false);
  c.setCeilingFromControl(0);
  await c.beginConnection({mode:"simulator",model:"lush"});await c.selectDevice("sim-lush");
  assert.equal(c.snapshot().ceiling,8);assert.equal(c.snapshot().running,false);
  await c.applyCalibration("vibrate");assert.equal(c.snapshot().ceiling,8);
  c.setFeel({mode:"continuous",background:2});c.setPosition(1);c.start();assert.equal(c.snapshot().output,0);
  await c.beginConnection({mode:"lovense",model:"lush"});await c.selectDevice("physical-toy");
  assert.equal(c.snapshot().ceiling,0);assert.equal(c.snapshot().running,false);
  c.destroy();
});

test("zero ceiling blocks setup output, profile switches preserve current mapping and position paused",async()=>{
  const app=fixture(),c=app.controller;c.setStory([1,4,0]);c.setPosition(1);c.setCeilingFromControl(0);
  await c.beginConnection({mode:"simulator",model:"nora"});await c.selectDevice("sim-nora");
  await assert.rejects(c.test({channel:"rotate",level:1}),/maximum/);assert.equal(c.snapshot().output,0);
  assert.equal(c.snapshot().ceiling,0);assert.equal(c.snapshot().position,1);assert.equal(c.snapshot().baseLevel,4);
  c.setCeilingFromControl(5);await c.beginConnection({mode:"lovense",model:"lush"});await c.selectDevice("physical-toy");
  c.updateLevels([1,2,3]);c.setPosition(2);
  await c.beginConnection({mode:"simulator",model:"hush"});await c.selectDevice("sim-hush");
  assert.equal(c.snapshot().baseLevel,3);assert.equal(c.snapshot().position,2);assert.equal(c.snapshot().running,false);c.destroy();
});

test("Stop cancels an in-flight physical setup request; its late completion gets another targeted Stop",async()=>{
  const app=fixture(),c=app.controller;c.setStory([4]);
  await c.beginConnection({mode:"lovense",model:"lush"});await c.selectDevice("physical-toy");
  let resolve;app.bridge.commandGate=new Promise(yes=>{resolve=yes;});
  const pending=c.test({channel:"vibrate",level:1});await settle();assert.equal(c.snapshot().testing,true);assert.equal(c.snapshot().output,null);assert.equal(c.snapshot().outputKnown,false);
  c.pause("User stopped.");await settle();assert.equal(c.start(),false,"An old setup command is still unresolved.");
  resolve();await settle();assert.equal(await pending,false);assert.equal(c.snapshot().testing,false);
  assert.ok(app.bridge.stops.length>=2);assert.ok(app.bridge.stops.every(frame=>frame.deviceId==="physical-toy"));
  assert.equal(c.snapshot().running,false);c.destroy();
});

test("the quick check uses each simulator movement and activates all together after confirmation", async () => {
  const app = fixture(), c = app.controller, movements = [];
  c.setStory([3]);
  await c.beginConnection({mode: "simulator", model: "flexer"});
  await c.selectDevice("sim-flexer");
  c.setCeilingFromControl(3);
  const pending = c.quickTest({onMovement: ({channel}) => movements.push(channel)});
  await app.advance(2000);
  assert.equal(c.snapshot().output, 0, "Separate movements have an observable stop before the next one.");
  assert.equal(c.start(), false);
  await app.advance(2300);
  assert.equal(await pending, true);
  assert.deepEqual(movements, ["vibrate", "fingering"]);
  assert.deepEqual(c.snapshot().verifiedChannels, []);
  assert.equal(c.start(), false);
  assert.ok(await c.confirmQuickTest());
  assert.deepEqual(c.snapshot().activeChannels, movements);
  assert.deepEqual(c.snapshot().verifiedChannels, movements);
  assert.equal(c.snapshot().feel.automaticMovement, true);
  assert.equal(c.snapshot().feel.preferredMovement, "vibrate");
  assert.equal(c.snapshot().ceiling, 3);
  assert.equal(c.snapshot().running, false);
  assert.equal(c.snapshot().output, 0);
  c.destroy();
});

test("the physical quick check is targeted and cancelling between movements blocks confirmation", async () => {
  const app = fixture(), c = app.controller;
  app.bridge.model = "flexer";
  c.setStory([8]);
  await c.beginConnection({mode: "lovense", model: "flexer"});
  await c.selectDevice("physical-toy");
  c.setCeilingFromControl(2);
  const cancelled = c.quickTest();
  await settle(); await app.advance(2000);
  c.stop(); await app.advance(500);
  assert.equal(await cancelled, false);
  assert.equal(await c.confirmQuickTest(), false);
  assert.equal(c.confirmTest(), false);
  assert.equal(app.bridge.commands.length, 1);
  assert.equal(c.start(), false);

  const retried = c.quickTest();
  await settle(); await app.advance(4300);
  assert.equal(await retried, true);
  assert.equal(c.start(), false);
  assert.ok(await c.confirmQuickTest());
  assert.deepEqual(app.bridge.commands.map(frame => [frame.channel, frame.level, frame.deviceId, frame.durationMs]),
    [["vibrate", 1, "physical-toy", 2000], ["vibrate", 1, "physical-toy", 2000], ["fingering", 1, "physical-toy", 2000]]);
  assert.deepEqual(c.snapshot().verifiedChannels, ["vibrate", "fingering"]);
  assert.equal(c.snapshot().activeChannels.length, 1, "A connection without combined support retains a single active movement.");
  assert.equal(c.snapshot().maxCeiling, 5);
  assert.equal(c.snapshot().ceiling, 2);
  assert.equal(c.snapshot().personalRangeEnabled, false);
  assert.equal(c.snapshot().running, false);
  c.destroy();
});

test("unconfirmed physical Stop never produces a successful setup result",async()=>{
  const app=fixture(),c=app.controller;c.setStory([2]);await c.beginConnection({mode:"lovense",model:"lush"});await c.selectDevice("physical-toy");
  const pending=c.test({channel:"vibrate",level:1});await settle();app.bridge.failStop=true;await app.advance(2000);
  assert.equal(await pending,false);assert.equal(c.setupSnapshot().lastTest,null);assert.equal(c.start(),false);assert.match(c.setupSnapshot().connectionMessage,/Stop could not be confirmed/);c.destroy();
});

test("physical reader enforces maximum five, sends finite targeted commands and stays paused after hiding",async()=>{
  const app=fixture(),c=app.controller;c.setStory([20,0]);c.setCeilingFromControl(12);
  await c.beginConnection({mode:"lovense",model:"lush"});await c.selectDevice("physical-toy");
  assert.equal(c.snapshot().ceiling,5);assert.equal(c.start(),false,"Physical Start requires the low-level check and observation checkpoint.");
  const checked=c.test({channel:"vibrate",level:1});await settle();await app.advance(2000);assert.equal(await checked,true);assert.equal(c.start(),false,"A submitted test is not the user observation checkpoint.");assert.equal(c.confirmTest(),true);
  assert.throws(()=>c.setCeilingFromControl(6),/maximum/);await settle();
  assert.equal(c.start(),true);await settle();assert.equal(app.bridge.commands.at(-1).deviceId,"physical-toy");assert.equal(app.bridge.commands.at(-1).level,5);assert.equal(app.bridge.commands.at(-1).durationMs,2000);
  const before=app.bridge.commands.length;await app.advance(1099);assert.equal(app.bridge.commands.length,before);await app.advance(1);assert.equal(app.bridge.commands.length,before+1);assert.equal(app.bridge.commands.at(-1).at-app.bridge.commands.at(-2).at,1100);
  c.setCeilingFromControl(0);await settle();assert.equal(c.snapshot().target,0);assert.ok(app.bridge.stops.length>0);
  c.setVisible(false);await settle();c.setVisible(true);assert.equal(c.snapshot().running,false);assert.equal(c.start(),false);c.destroy();
});

test("missing live configuration leaves no selected toy or output and rehearsal still works",async()=>{
  const bridge=new FakeBridge();bridge.available=false;const app=fixture({bridge}),c=app.controller;c.setStory([4]);
  assert.equal(await c.beginConnection({mode:"lovense",model:"lush"}),false);assert.equal(c.setupSnapshot().liveConfigured,false);assert.equal(c.setupSnapshot().selectedId,null);assert.equal(c.start(),false);
  await c.beginConnection({mode:"simulator",model:"domi"});await c.selectDevice("sim-domi");assert.equal(c.start(),true);assert.equal(c.snapshot().output,4);c.destroy();
});

test("simulated disconnect and command errors require explicit recovery without automatic resume",async()=>{
  const app=fixture(),c=app.controller;c.setStory([3]);c.connect();c.start();
  c.simulateFailure("disconnect");assert.equal(c.snapshot().connected,false);assert.equal(c.snapshot().output,0);
  await c.beginConnection({mode:"simulator",model:"flexer"});await c.selectDevice("sim-flexer");assert.equal(c.snapshot().running,false);
  c.simulateFailure("error");assert.equal(c.snapshot().state,"ERROR_PAUSED");assert.equal(c.start(),false);
  await c.beginConnection({mode:"simulator",model:"flexer"});await c.selectDevice("sim-flexer");assert.equal(c.start(),true);assert.equal(c.snapshot().running,true);c.destroy();
});

test("a failed renderer stops output and explicit reconnect resets the recovery latch",async()=>{
  let broken=false;const app=fixture({onChange:()=>{if(broken)throw Error("Synthetic render failure");}}),c=app.controller;c.setStory([3]);c.connect();c.start();broken=true;c.adjustLevel(1);
  assert.equal(c.snapshot().state,"ERROR_PAUSED");assert.equal(c.snapshot().output,0);broken=false;assert.equal(c.connect(),true);assert.equal(c.start(),true);c.destroy();
});

test("the first-run Nora guide tests rotation with no story and real facade/UI callbacks",async()=>{
  const {setupDOM}=await import("./helpers/setup-dom.mjs");const {createSetupFlow}=await import("../app/static/reader/setup-flow.mjs");
  const dom=setupDOM(),timing=clock();let flow,latest={},connection={};
  const c=new ReaderDeviceController({...timing,onChange:state=>{latest=state;flow?.update({...connection,...state});},onSetupChange:state=>{connection=state;flow?.update({...latest,...state});}});
  flow=createSetupFlow({...dom,onConnect:options=>{c.pause("Preparing connection.");return c.beginConnection(options);},onSelectDevice:id=>c.selectDevice(id),onTest:options=>c.test(options),onConfirmTest:()=>c.confirmTest(),onStop:()=>c.pause("Setup paused.")});
  connection=c.setupSnapshot();flow.update(connection);flow.open();dom.nodes.get("setup-model").value="nora";await dom.nodes.get("setup-model").dispatch("change");await dom.nodes.get("setup-primary").click();
  dom.nodes.get("setup-devices").value="sim-nora";await dom.nodes.get("setup-devices").dispatch("change");await dom.nodes.get("setup-primary").click();assert.equal(flow.snapshot().phase,"test");
  dom.nodes.get("setup-channel").value="rotate";await dom.nodes.get("setup-channel").dispatch("change");
  const pending=dom.nodes.get("setup-test").click();await settle();assert.equal(c.snapshot().output,1);assert.equal(c.snapshot().testing,true);assert.equal(flow.snapshot().busy,true);
  await timing.advance(2000);await pending;assert.equal(flow.snapshot().tested,true);assert.equal(c.snapshot().output,0);flow.destroy();c.destroy();
});

test("Stop during private connection preparation invalidates its late success",async()=>{
  const app=fixture(),c=app.controller;c.setStory([2]);let complete;
  app.bridge.begin=()=>new Promise(resolve=>{complete=resolve;});
  const pending=c.beginConnection({mode:"lovense",model:"lush"});await settle();
  c.pause("User stopped setup.");complete(true);await settle();
  assert.equal(await pending,false);assert.equal(c.snapshot().connected,false);assert.equal(c.start(),false);assert.equal(c.setupSnapshot().selectedId,null);c.destroy();
});

test("default setup timers call browser-style timer APIs without an illegal object receiver",async()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let serial=0;
  globalThis.setTimeout=function(callback,delay){assert.equal(this,undefined,"Browser timer APIs cannot receive the controller object as this.");timers.set(++serial,{callback,delay});return serial;};
  globalThis.clearTimeout=function(id){assert.equal(this,undefined);timers.delete(id);};
  let c;
  try{
    c=new ReaderDeviceController({now:()=>0});await c.beginConnection({mode:"simulator",model:"nora"});await c.selectDevice("sim-nora");
    const pending=c.test({channel:"rotate",level:1});await settle();assert.equal(c.snapshot().testing,true);
    const timer=[...timers.values()].find(value=>value.delay===2000);assert.ok(timer);timer.callback();assert.equal(await pending,true);
  }finally{c?.destroy();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
