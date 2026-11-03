import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {LovenseCheck} from "../app/static/devices/lovense.mjs";

const source=(await readFile(new URL("../app/static/device-bridge.mjs",import.meta.url),"utf8")).replace(/^import[^\n]+\n/,"");
function fixture({pendingCommand=false,pendingOpen=false,Check,sdk=function(){}}={}) {
  const calls=[],messages=[],windowEvents=new Map(),documentEvents=new Map();let controls,resolveCommand;
  class FakeCheck {
    constructor(options){controls=this;this.emit=options.emit;this.selected="toy-one";}
    connect(value){calls.push(["connect",value]);}
    select(id){this.selected=id;calls.push(["select",id]);}
    refresh(){calls.push(["refresh"]);}
    test(...args){calls.push(["test",...args]);}
    command(...args){calls.push(["command",...args]);return pendingCommand?new Promise(resolve=>{resolveCommand=resolve;}):Promise.resolve({status:"submitted",level:args[0],channel:args[2].channel});}
    stop(){calls.push(["stop"]);return Promise.resolve({status:"submitted"});}
    stopTarget(id){calls.push(["stopTarget",id]);return Promise.resolve({status:"submitted"});}
    openApp(){calls.push(["openApp"]);return pendingOpen?Promise.reject(new Error("synthetic private error")):Promise.resolve();}
    disconnect(){calls.push(["disconnect"]);}
  }
  const parent={},window={addEventListener:(type,handler)=>windowEvents.set(type,handler),removeEventListener:type=>windowEvents.delete(type)};
  const document={hidden:false,head:{append(script){calls.push(["loadSdk",script.src]);script.onload();}},createElement:()=>({}),addEventListener:(type,handler)=>documentEvents.set(type,handler)};
  const port={start(){},postMessage:value=>messages.push(value)};
  const globals={LovenseCheck:Check||FakeCheck,parent,window,document,location:{href:"https://app.satinlore.com/device-bridge"},URL,globalThis:{LovenseBasicSdk:sdk},Promise};
  runInNewContext(source,globals);
  const handshake=(changes={})=>windowEvents.get("message")?.({source:parent,origin:"https://app.satinlore.com",data:{type:"satinlore:bridge"},ports:[port],...changes});
  const send=data=>port.onmessage({data});
  const init=()=>send({type:"init",session:{uid:"synthetic",platform:"fixture",authToken:"synthetic-auth",expires_at:9999999999}});
  return {calls,messages,windowEvents,documentEvents,document,handshake,send,init,controls:()=>controls,resolve:value=>resolveCommand(value)};
}
const command=(changes={})=>({type:"command",requestId:"operation-1",toyId:"toy-one",level:2,ceiling:3,channel:"vibrate",seconds:2,...changes});

test("opaque bridge requires exact parent origin/source and a dedicated one-use channel before loading any vendor code", async()=>{
  const f=fixture();
  f.handshake({origin:"https://evil.example.test"});f.handshake({source:{}});f.handshake({data:{type:"satinlore:bridge",story:"never-read"}});f.handshake({ports:[]});
  assert.equal(f.messages.length,0);assert.equal(f.calls.length,0);
  f.handshake();assert.equal(f.messages[0].type,"bridge-ready");assert.equal(f.windowEvents.has("message"),false);
  await f.init();assert.equal(f.calls.filter(row=>row[0]==="loadSdk").length,1);assert.equal(f.calls.filter(row=>row[0]==="connect").length,1);
});
test("the real adapter keeps a fresh bridge open for pairing and discovers a Flexer after the scan", async () => {
  let sdk;
  class FakeSdk {
    constructor() {sdk = this; this.handlers = new Map(); this.online = false;}
    on(event, callback) {this.handlers.set(event, callback);}
    getAppStatus() {return this.online;}
    getQrcode() {return Promise.resolve({qrcodeUrl: "https://apps.lovense-api.com/fixture.jpg"});}
    getOnlineToys() {return [{id: "fixture-flexer", toyType: "flexer", connected: true, fullFunctionNames: ["Vibrate", "Fingering"]}];}
    destroy() {}
  }
  const f = fixture({Check: LovenseCheck, sdk: FakeSdk});
  f.handshake();
  try {
    await f.init();
    assert.deepEqual(f.messages.filter(message => message.type === "state").map(message => message.state), ["connecting"]);
    sdk.handlers.get("ready")();
    await Promise.resolve();
    assert.equal(f.messages.some(message => message.type === "state" && message.state === "waiting"), true);
    assert.equal(f.messages.some(message => message.type === "state" && message.state === "disconnected"), false);
    assert.equal(f.messages.some(message => message.type === "qr"), true);
    sdk.online = true;
    sdk.handlers.get("appStatusChange")(true);
    assert.deepEqual(f.messages.filter(message => message.type === "toys").at(-1).toys.map(toy => toy.model), ["flexer"]);
    assert.equal(f.messages.some(message => message.type === "selected"), false);
  } finally {
    await f.send({type: "dispose"});
  }
});
test("command boundary accepts only exact targeted finite numeric controls, never identity or story extras", async()=>{
  const f=fixture();f.handshake();await f.init();
  await f.send(command());assert.equal(f.calls.filter(row=>row[0]==="command").length,1);
  assert.equal(f.messages.at(-1).ok,true);assert.equal(f.messages.at(-1).status,"submitted");
  for(const changes of [{toyId:"toy-two"},{seconds:0},{seconds:60},{story:"private"},{uid:"another"},{requestId:"../unsafe"}]) await f.send(command(changes));
  assert.equal(f.calls.filter(row=>row[0]==="command").length,1);
  assert.equal(f.messages.some(message=>JSON.stringify(message).includes("private")),false);
  await f.send({type:"stop",requestId:"stop-1",toyId:"toy-one"});
  assert.deepEqual(f.calls.at(-1),["stopTarget","toy-one"]);assert.equal(f.messages.at(-1).ok,true);
});
test("Stop is not queued behind an unacknowledged command and closed bridges suppress late results",async()=>{
  const f=fixture({pendingCommand:true});f.handshake();await f.init();
  const pending=f.send(command());
  await f.send({type:"stop",requestId:"stop-2",toyId:"toy-one"});
  assert.equal(f.messages.at(-1).requestId,"stop-2");
  await f.send({type:"dispose"});assert.equal(f.messages.at(-1).type,"closed");
  f.resolve({status:"submitted",level:2,channel:"vibrate"});await pending;
  assert.equal(f.messages.some(message=>message.requestId==="operation-1"),false);
});
test("hide closes the bridge and failed app-launch promises are reported truthfully without private errors",async()=>{
  const f=fixture({pendingOpen:true});f.handshake();await f.init();
  await f.send({type:"open-app",requestId:"open-1"});assert.equal(f.messages.at(-1).ok,false);
  assert.equal(JSON.stringify(f.messages).includes("synthetic private error"),false);
  f.document.hidden=true;f.documentEvents.get("visibilitychange")();
  assert.equal(f.messages.at(-1).type,"closed");
  const before=f.calls.length;await f.send(command());assert.equal(f.calls.length,before);
});
