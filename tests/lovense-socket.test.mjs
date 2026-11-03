import test from "node:test";
import assert from "node:assert/strict";
import {LovenseSocket,SOCKET_AUTH_URL,socketAddress,remoteCommandAddress} from "../app/static/devices/lovense-socket.mjs";
import {LovenseCheck} from "../app/static/devices/lovense.mjs";

const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({authentication,metadata,socketPath="/fixture/socket"}={}){
  const outgoing=[],requests=[],listeners=new Map();let time=0;
  const socket={connected:false,on(name,callback){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback);},
    emit(name,value){outgoing.push({name,value});},connect(){queueMicrotask(()=>{this.connected=true;incoming("connect");});},
    disconnect(){this.connected=false;},removeAllListeners(){listeners.clear();}};
  const incoming=(name,value)=>{for(const callback of listeners.get(name)||[])callback(value);};
  const fetcher=async(url,options)=>{requests.push({url,options});return url===SOCKET_AUTH_URL?authentication?authentication():Response.json({code:0,data:{socketIoUrl:"https://apps.lovense-api.com",socketIoPath:socketPath}}):metadata?metadata():Response.json({code:200,data:{toys:"{}"}});};
  const sdk=new LovenseSocket({platform:"SatinLore neutral fixture",authToken:"private-user-token"},{fetcher,now:()=>time,randomId:()=>"synthetic-ack",socketFactory:(url,options)=>{assert.equal(url,"https://apps.lovense-api.com/");assert.equal(options.path,socketPath);assert.deepEqual(options.transports,["websocket"]);assert.equal(options.reconnection,false);assert.equal(options.autoConnect,false);return socket;}});
  const toys=(list,extras={})=>incoming("basicapi_update_device_info_tc",JSON.stringify({online:true,toyList:list,...extras}));
  const raw=(model,id=model)=>({id,toyType:model,connected:true,battery:71});
  return{sdk,socket,incoming,outgoing,requests,toys,raw,advance(ms){time+=ms;}};
}

test("socket authorization sends only the per-user credential and pins secure vendor endpoints",async()=>{
  const f=fixture();await f.sdk.prepared;
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,SOCKET_AUTH_URL);
  assert.deepEqual(JSON.parse(f.requests[0].options.body),{platform:"SatinLore neutral fixture",authToken:"private-user-token"});
  assert.equal(f.requests[0].options.credentials,"omit");assert.equal(f.requests[0].options.redirect,"error");
  for(const url of ["http://apps.lovense-api.com","https://evil.test","https://lovense.com.evil.test","https://private@api.lovense-api.com","javascript:alert(1)"])assert.equal(socketAddress(url),null);
  assert.equal(remoteCommandAddress("192-168-1-5.lovense.club",30010),"https://192-168-1-5.lovense.club:30010/command");
  for(const [host,port]of [["evil.test",30010],["8-8-8-8.lovense.club",30010],["192-168-1-5.lovense.club",443],["192-168-1-999.lovense.club",30010]])assert.equal(remoteCommandAddress(host,port),null);
  f.sdk.destroy();
});

test("the default fetch path preserves the browser receiver for authorization and capability enrichment",async()=>{
  const original=globalThis.fetch,requests=[];
  const handlers=new Map();
  const socket={connected:false,on(name,callback){handlers.set(name,callback);},connect(){queueMicrotask(()=>{this.connected=true;handlers.get("connect")();});},removeAllListeners(){handlers.clear();},disconnect(){this.connected=false;}};
  globalThis.fetch=function(url,options){
    assert.equal(this,globalThis,"Browser fetch must retain its Window/global receiver.");requests.push({url,options});
    return Promise.resolve(Response.json(url===SOCKET_AUTH_URL?{code:0,data:{socketIoUrl:"https://apps.lovense-api.com",socketIoPath:"/socket.io"}}:{code:200,data:{toys:"{}"}}));
  };
  let sdk;
  try{
    sdk=new LovenseSocket({platform:"neutral fixture",authToken:"synthetic-user-token"},{socketFactory:()=>socket});await sdk.prepared;
    await sdk.enrichCapabilities("https://192-168-1-5.lovense.club:30010/command",sdk.metadataEpoch);
    assert.equal(requests.length,2);assert.equal(requests[0].url,SOCKET_AUTH_URL);
  }finally{sdk?.destroy();globalThis.fetch=original;}
});
test("Socket.IO dot paths are accepted while encoded paths traversal and query or fragment suffixes are rejected",async()=>{
  for(const socketPath of ["/socket.io","/lovense/socket.io"]){
    const f=fixture({socketPath});await f.sdk.prepared;assert.equal(f.socket.connected,true);f.sdk.destroy();
  }
  for(const socketPath of ["/../socket.io","/socket%2eio","/socket.io?token=x","/socket.io#fragment"]){
    const f=fixture({socketPath});await assert.rejects(f.sdk.prepared,/could not be prepared/);assert.equal(f.socket.connected,false);
  }
});
test("QR responses are correlated and discovery strips unrelated fields before reaching the controller",async()=>{
  const f=fixture();await f.sdk.prepared;const qr=f.sdk.getQrcode();
  assert.deepEqual(f.outgoing.at(-1),{name:"basicapi_get_qrcode_ts",value:{ackId:"synthetic-ack"}});
  f.incoming("basicapi_get_qrcode_tc",JSON.stringify({code:0,data:{ackId:"stale",qrcodeUrl:"https://apps.lovense-api.com/old.jpg"}}));
  assert.ok(f.sdk.pendingQr);
  f.incoming("basicapi_get_qrcode_tc",JSON.stringify({code:0,data:{ackId:"synthetic-ack",qrcodeUrl:"https://apps.lovense-api.com/neutral.jpg"}}));
  assert.deepEqual(await qr,{qrcodeUrl:"https://apps.lovense-api.com/neutral.jpg"});
  f.toys([{...f.raw("flexer"),nickname:"PRIVATE LABEL",authToken:"NEVER RETAIN"}]);
  assert.doesNotMatch(JSON.stringify(f.sdk.getOnlineToys()),/PRIVATE LABEL|NEVER RETAIN/);
  f.sdk.destroy();
});
test("extended Function relay sends one finite selected-device vector and targeted Stop without undocumented motor names",async()=>{
  const f=fixture();await f.sdk.prepared;f.toys([f.raw("flexer"),f.raw("osci3")]);
  const result=f.sdk.sendToyCommand({vibrate:2,fingering:4,time:2,toyId:"flexer"});
  assert.deepEqual(result,{status:"submitted"});
  assert.deepEqual(f.outgoing.at(-1),{name:"basicapi_send_toy_command_ts",value:{command:"Function",action:"Fingering:4,Vibrate:2",timeSec:2,toy:"flexer",stopPrevious:1,apiVer:1}});
  assert.throws(()=>f.sdk.sendToyCommand({vibrate:2,time:2,toyId:"flexer"}),/next device tick/);
  f.advance(1000);f.sdk.sendToyCommand({oscillate:3,time:2,toyId:"osci3"});
  assert.equal(f.outgoing.at(-1).value.action,"Oscillate:3");assert.equal(f.outgoing.at(-1).value.timeSec,2);
  f.sdk.stopToyAction("osci3");assert.deepEqual(f.outgoing.at(-1).value,{command:"Function",action:"Stop",timeSec:0,toy:"osci3",stopPrevious:1,apiVer:1});
  for(const command of [{vibrate:6,time:2,toyId:"flexer"},{vibrate:1,time:0,toyId:"flexer"},{vibrate:1,time:2},{vibrate1:2,time:2,toyId:"osci3"},{heat:1,time:2,toyId:"osci3"},{rotate:1,time:2,toyId:"flexer"}])assert.throws(()=>f.sdk.sendToyCommand(command));
  assert.equal(f.sdk.stopToyAction("never-discovered"),false);f.sdk.destroy();
});
test("fresh capability metadata restricts commands and stale enrichment cannot revive a lost connection",async()=>{
  let release;
  const f=fixture({metadata:()=>new Promise(resolve=>{release=resolve;})});await f.sdk.prepared;
  f.toys([f.raw("velvo")],{domain:"192-168-1-5.lovense.club",httpsPort:30010});await settle();
  assert.throws(()=>f.sdk.sendToyCommand({rotate:1,time:2,toyId:"velvo"}),/unavailable/);
  f.incoming("disconnect");assert.deepEqual(f.sdk.getOnlineToys(),[]);
  release(Response.json({code:200,data:{toys:JSON.stringify({velvo:{id:"velvo",fullFunctionNames:["Vibrate","Rotate"]}})}}));await settle();
  assert.deepEqual(f.sdk.getOnlineToys(),[]);assert.throws(()=>f.sdk.sendToyCommand({rotate:1,time:2,toyId:"velvo"}));f.sdk.destroy();
});
test("the real controller independently validates vector ceilings and stops on capability loss",async()=>{
  const f=fixture();await f.sdk.prepared;
  const events=[],controller=new LovenseCheck({sdkFactory:()=>f.sdk,emit:event=>events.push(event),now:()=>0});
  controller.connect({uid:"synthetic",platform:"fixture",authToken:"private",expires_at:1000});await settle();
  const qr=controller.sdk.pendingQr;assert.ok(qr);
  f.incoming("basicapi_get_qrcode_tc",{code:0,data:{ackId:qr.ackId,qrcodeUrl:"https://apps.lovense-api.com/neutral.jpg"}});await settle();
  f.toys([f.raw("flexer")]);controller.select("flexer");
  const sent=await controller.commandVector({vibrate:2,fingering:4},{vibrate:2,fingering:3});
  assert.deepEqual(sent,{status:"submitted",level:3,levels:{vibrate:2,fingering:3}});
  assert.deepEqual(f.outgoing.at(-1).value.action,"Fingering:3,Vibrate:2");
  f.toys([{...f.raw("flexer"),fullFunctionNames:["Vibrate"]}]);
  assert.equal(controller.selected,null);assert.equal(f.outgoing.at(-1).value.action,"Stop");
  controller.disconnect();
});
test("invalid bootstrap and destroyed pairing never establish a second hidden connection",async()=>{
  const f=fixture({authentication:()=>Response.json({code:0,data:{socketIoUrl:"https://evil.test",socketIoPath:"/socket"}})});
  await assert.rejects(f.sdk.prepared,/could not be prepared/);assert.equal(f.sdk.destroyed,true);assert.equal(f.socket.connected,false);
  const active=fixture();await active.sdk.prepared;const qr=active.sdk.getQrcode();const denied=assert.rejects(qr,/cancelled/);active.sdk.destroy();await denied;
  active.incoming("basicapi_update_device_info_tc",{online:true,toyList:[active.raw("flexer")]});assert.deepEqual(active.sdk.getOnlineToys(),[]);
});

test("socket bootstrap distinguishes a rejected pairing token from a browser network failure", async () => {
  for (const [authentication, expected] of [
    [() => Response.json({code: 400, message: "private vendor error", data: {authToken: "private pairing token"}}),
      {stage: "socket-response", status: 200, code: 400}],
    [() => { throw new Error("private browser error"); }, {stage: "socket-request"}],
  ]) {
    const f = fixture({authentication});
    await assert.rejects(f.sdk.prepared, error => {
      assert.deepEqual(error.pairing, expected);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.equal(f.socket.connected, false);
  }
});

test("socket output above five needs per-action session permission and connection loss clears it",async()=>{
  const f=fixture();await f.sdk.prepared;f.toys([f.raw("flexer")]);
  assert.throws(()=>f.sdk.sendToyCommand({vibrate:6,time:2,toyId:"flexer"}));
  f.sdk.enablePersonalRange("flexer",["vibrate"]);
  f.sdk.sendToyCommand({vibrate:18,fingering:4,time:2,toyId:"flexer"});
  assert.equal(f.outgoing.at(-1).value.action,"Fingering:4,Vibrate:18");
  f.advance(1000);assert.throws(()=>f.sdk.sendToyCommand({fingering:6,time:2,toyId:"flexer"}));
  f.incoming("basicapi_update_app_status_tc",false);f.toys([f.raw("flexer")]);
  assert.throws(()=>f.sdk.sendToyCommand({vibrate:6,time:2,toyId:"flexer"}));f.sdk.destroy();
});

test("wrapped Boolean status is explicit and unknown status clears connection capabilities and personal permission",async()=>{
  for(const raw of [{data:false},{data:{status:"online"}},{unrecognized:true},"unsupported-status"]){
    const f=fixture();await f.sdk.prepared;f.toys([f.raw("flexer")]);f.sdk.enablePersonalRange("flexer",["vibrate"]);
    assert.equal(f.sdk.getAppStatus(),true);assert.equal(f.sdk.personalRanges.size,1);
    f.incoming("basicapi_update_app_status_tc",raw);
    assert.equal(f.sdk.getAppStatus(),false);assert.deepEqual(f.sdk.getOnlineToys(),[]);assert.equal(f.sdk.personalRanges.size,0);
    f.toys([f.raw("flexer")]);assert.throws(()=>f.sdk.sendToyCommand({vibrate:6,time:2,toyId:"flexer"}));f.sdk.destroy();
  }
  const f=fixture();await f.sdk.prepared;f.incoming("basicapi_update_app_online_tc",{data:true});
  assert.equal(f.sdk.getAppStatus(),true);assert.deepEqual(f.sdk.getOnlineToys(),[],"An online Boolean cannot fabricate device discovery.");f.sdk.destroy();
});
