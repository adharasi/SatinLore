import test from "node:test";
import assert from "node:assert/strict";
import {TOY_PROFILES,getToyProfile,normaliseToy,supportedToys} from "../app/static/devices/toy-profiles.mjs";
import {ProfileSimulator} from "../app/static/devices/profile-simulator.mjs";

const raw = (model, extra = {}) => ({id: `toy-${model}`, toyType:model, connected:true, ...extra});

test("the nine requested model profiles have distinct bounded simulator identities", () => {
  assert.deepEqual(TOY_PROFILES.map(item=>item.id), ["lush","flexer","nora","domi","velvo","spinel","dolce","hush","osci3"]);
  for(const profile of TOY_PROFILES) {
    assert.equal(getToyProfile(profile.id),profile);
    assert.ok(Object.isFrozen(profile));
    assert.ok(profile.simChannels.includes("vibrate"));
    assert.deepEqual(profile.channels.map(item=>item.id),profile.simChannels);
    assert.equal(normaliseToy(raw(profile.id)).model,profile.id);
  }
  assert.equal(getToyProfile("not-a-toy"),null);
});

test("model generations and names normalise without retaining nicknames or untrusted labels", () => {
  assert.equal(normaliseToy(raw("Domi2",{hVersion:"2",nickname:"private canary"})).label,"Domi 2");
  assert.equal(normaliseToy({id:"one",name:"Lush 4",connected:true}).model,"lush");
  assert.equal(normaliseToy(raw("Nora_2")).model,"nora");
  assert.equal(JSON.stringify(normaliseToy(raw("hush",{name:"private canary",nickname:"private canary"}))).includes("private canary"),false);
  for(const value of [raw("unknown"),raw("nora",{id:"../private"}),raw("nora",{connected:1}),raw("nora",{connected:false}),raw("unknown",{name:"Nora"}),raw("nora",{id:""}),null]) assert.equal(normaliseToy(value),null);
});

test("manufacturer function reports restrict and cannot silently broaden capabilities", () => {
  assert.deepEqual(normaliseToy(raw("nora")).capabilities,["vibrate","rotate"]);
  assert.deepEqual(normaliseToy(raw("flexer")).capabilities,["vibrate","fingering"]);
  assert.deepEqual(normaliseToy(raw("nora",{fullFunctionNames:["Vibrate"]})).capabilities,["vibrate"]);
  assert.equal(normaliseToy(raw("nora",{fullFunctionNames:[]})),null);
  assert.equal(normaliseToy(raw("nora",{fullFunctionNames:"Vibrate"})),null);
  assert.deepEqual(normaliseToy(raw("hush",{fullFunctionNames:["Vibrate","Rotate","Heating"]})).capabilities,["vibrate"]);
  assert.deepEqual(normaliseToy(raw("flexer",{shortFunctionNames:["v","f"]})).capabilities,["vibrate","fingering"]);
});

test("newer model motions need explicit reports and independent Dolce motors are not fabricated", () => {
  assert.deepEqual(normaliseToy(raw("velvo")).capabilities,["vibrate"]);
  assert.deepEqual(normaliseToy(raw("spinel")).capabilities,["vibrate"]);
  assert.deepEqual(normaliseToy(raw("velvo",{shortFunctionNames:["v","r"]})).capabilities,["vibrate","rotate"]);
  assert.deepEqual(normaliseToy(raw("spinel",{fullFunctionNames:["Vibrate","Thrusting","Heating"]})).capabilities,["vibrate","thrusting"]);
  assert.deepEqual(normaliseToy(raw("dolce",{fullFunctionNames:["Vibrate","Vibrate1","Vibrate2"]})).capabilities,["vibrate"]);
});

test("Osci 3 is identified separately from older Osci models and keeps unsupported SDK motion simulation-only", () => {
  for (const alias of ["osci3", "Osci 3", "Osci_3", "osci-3"]) {
    const toy = normaliseToy(raw(alias, {id: "test-osci3"}));
    assert.equal(toy.model, "osci3");
    assert.equal(toy.label, "Osci 3");
    assert.deepEqual(toy.capabilities, ["vibrate"]);
  }
  assert.equal(normaliseToy(raw("osci", {hVersion: "3"})).model, "osci3");
  assert.equal(normaliseToy({id: "one", name: "Osci 3", connected: true}).model, "osci3");
  assert.equal(normaliseToy(raw("osci3", {hVersion: "1"})).label, "Osci 3", "A hardware revision must not duplicate the model's generation number.");
  for (const alias of ["osci", "osci2", "Osci 2", "osci4", "osci34", "osic3"]) assert.equal(normaliseToy(raw(alias)), null);
  assert.equal(normaliseToy(raw("osci", {hVersion: "2"})), null);
  const profile = getToyProfile("osci3");
  assert.deepEqual(profile.simChannels, ["vibrate", "oscillate"]);
  assert.deepEqual(profile.simulationOnlyChannels, ["oscillate"]);
  assert.equal(profile.channels.find(channel => channel.id === "oscillate").label, "Oscillation");
  assert.deepEqual(normaliseToy({id:"osci-socket",toyType:"osci3",connected:true},{transport:"standard-socket-v1"}).capabilities,["vibrate","oscillate"]);
  assert.deepEqual(normaliseToy({id:"osci-basic",toyType:"osci3",connected:true,controlTransport:"standard-socket-v1"}).capabilities,["vibrate"],"A vendor field cannot authorize an extended transport.");
  assert.deepEqual(normaliseToy(raw("osci3", {fullFunctionNames: ["Vibrate", "Oscillate", "Vibrate1", "Vibrate2", "Heating"]})).capabilities, ["vibrate"]);
  assert.equal(normaliseToy(raw("osci3", {fullFunctionNames: ["Oscillate"]})), null, "An advertised physical function cannot authorise an undocumented browser-SDK command.");
});

test("discovery is deduplicated, bounded and contains only validated battery information", () => {
  const toys=supportedToys([raw("lush"),raw("lush"),raw("domi",{battery:91}),raw("hush",{battery:-1}),...Array.from({length:60},(_,index)=>raw("lush",{id:`extra-${index}`}))]);
  assert.equal(toys.length,49);
  assert.equal(toys[1].battery,91);assert.equal(toys[2].battery,null);
  assert.equal(toys.some(item=>item.id==="extra-59"),false);
  assert.deepEqual(supportedToys({id:"not-an-array"}),[]);
});

test("every profile simulator expires output and exposes only its active channel", () => {
  for(const profile of TOY_PROFILES) for(const channel of profile.simChannels) {
    let now=0;const sim=new ProfileSimulator({model:profile.id,channel,now:()=>now});
    assert.throws(()=>sim.command(1),/Connect/);sim.connect();sim.command(4);
    assert.equal(sim.snapshot().strength,4);assert.equal(sim.snapshot().channels[channel],4);
    assert.equal(Object.values(sim.snapshot().channels).filter(Boolean).length,1);
    assert.equal(sim.snapshot().simulated,true);
    now=2000;assert.equal(sim.snapshot().strength,0);
    assert.ok(Object.values(sim.snapshot().channels).every(value=>value===0));
    sim.command(3);sim.stop();assert.equal(sim.snapshot().strength,0);
  }
});

test("model and channel changes stop output, and selecting a model disconnects", () => {
  const sim=new ProfileSimulator({model:"nora",now:()=>0});sim.connect();sim.command(3);sim.setChannel("rotate");
  assert.equal(sim.snapshot().connected,true);assert.equal(sim.snapshot().strength,0);
  sim.command(2);assert.equal(sim.snapshot().channels.rotate,2);
  sim.setModel("spinel");assert.equal(sim.snapshot().connected,false);assert.equal(sim.snapshot().strength,0);
  assert.equal(sim.snapshot().channel,"vibrate");
  assert.throws(()=>sim.setChannel("heat"));assert.throws(()=>sim.setModel("other"));
});

test("simulator failure injection is bounded and reconnection never restores output", () => {
  const sim=new ProfileSimulator({model:"flexer",now:()=>0});sim.connect();sim.command(3);
  sim.injectFailure("disconnect");assert.equal(sim.snapshot().connected,false);assert.equal(sim.snapshot().strength,0);
  sim.connect();assert.equal(sim.snapshot().strength,0);
  sim.injectFailure("command");assert.throws(()=>sim.command(2),/Simulated/);assert.equal(sim.snapshot().strength,0);
  sim.command(2);assert.equal(sim.snapshot().strength,2);
  sim.injectFailure("none");assert.throws(()=>sim.injectFailure("arbitrary"));
  for(const level of [-1,21,NaN,Infinity,1.5,"2"]) assert.throws(()=>sim.command(level));
  for(const seconds of [0,1,2.1,Infinity,NaN]) assert.throws(()=>sim.command(1,seconds));
  sim.command(0);assert.equal(sim.snapshot().strength,0);
});
