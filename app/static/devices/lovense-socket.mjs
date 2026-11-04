import io from "socket.io-client";
import {supportedToys} from "./toy-profiles.mjs";

// Official Standard Socket API. This module is bundled only into the opaque
// connection frame. It accepts no story text, account identity or developer key.
export const SOCKET_AUTH_URL = "https://api.lovense-api.com/api/basicApi/getSocketUrl";
export const SOCKET_TRANSPORT = "standard-socket-v1";
const ACTIONS = Object.freeze({vibrate:"Vibrate",rotate:"Rotate",fingering:"Fingering",thrusting:"Thrusting",oscillate:"Oscillate"});
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const plain = value => value && typeof value === "object" && !Array.isArray(value);
const level = value => Number.isInteger(value) && value >= 0 && value <= 20;
const vendorCode = value => Number.isSafeInteger(value) && Math.abs(value) <= 999999 ? value : undefined;
function envelope(raw) {
  if (typeof raw === "string") {
    if (raw.length > 65_536) throw Error();
    return JSON.parse(raw);
  }
  if (!plain(raw) || JSON.stringify(raw).length > 65_536) throw Error();
  return raw;
}
function data(raw) { const value = envelope(raw); return plain(value.data) ? value.data : value; }
export function socketAddress(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const allowed = ["lovense.com","lovense-api.com","lovense.club"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    if (!allowed || !["https:","wss:"].includes(url.protocol) || url.username || url.password || url.hash) return null;
    return url.href;
  } catch { return null; }
}
export function remoteCommandAddress(domain, port) {
  if (typeof domain !== "string" || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  const match = /^(\d{1,3})[-.](\d{1,3})[-.](\d{1,3})[-.](\d{1,3})\.lovense\.club$/.exec(domain);
  if (!match) return null;
  const ip = match.slice(1).map(Number);
  if (ip.some(value => value > 255) || !(ip[0] === 10 || ip[0] === 192 && ip[1] === 168 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31 || ip.join(".") === "127.0.0.1")) return null;
  return `https://${domain}:${port}/command`;
}
async function boundedJson(response, maximum = 65_536) {
  if (response.status !== 200 || !response.body) throw Error();
  const reader = response.body.getReader(), chunks = []; let size = 0;
  const timer = setTimeout(() => { void reader.cancel().catch(()=>{}); }, 8000);
  try {
    for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) {await reader.cancel();throw Error();} chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  } finally { clearTimeout(timer); }
}

export class LovenseSocket {
  constructor(options, {fetcher = (...args) => globalThis.fetch(...args), socketFactory = io, now = Date.now,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer), randomId = () => crypto.randomUUID(), preserveFlexerRenewals = false} = {}) {
    Object.assign(this,{fetcher,socketFactory,now,setTimer,clearTimer,randomId});
    this.platform = options?.platform;
    this.controlTransport = SOCKET_TRANSPORT;
    this.handlers = new Map(); this.toys = []; this.knownIds = new Set();
    this.destroyed = false; this.socket = null; this.online = false; this.ready = false;
    this.qr = null; this.pendingQr = null; this.metadataEpoch = 0; this.lastCommand = -Infinity;
    this.preserveFlexerRenewals = preserveFlexerRenewals === true;
    this.lastFunction = null;
    this.personalRanges = new Map();
    this.prepared = this.prepare(options);
    // A caller may subscribe before awaiting readiness. Errors remain generic.
    this.prepared.catch(() => {});
  }
  on(name, callback) {
    if (typeof callback !== "function") return;
    if (!this.handlers.has(name)) this.handlers.set(name,new Set());
    this.handlers.get(name).add(callback);
    if (name === "ready" && this.ready) queueMicrotask(()=>{if(!this.destroyed)callback(this);});
  }
  emit(name, ...args) { if (!this.destroyed) for (const callback of this.handlers.get(name) || []) callback(...args); }
  async prepare(options) {
    const pairing = {stage: "socket-request"};
    try {
      if (!plain(options) || typeof options.platform !== "string" || !options.platform || options.platform.length > 128 ||
          typeof options.authToken !== "string" || !options.authToken || options.authToken.length > 8192) throw Error();
      const response = await this.fetcher(SOCKET_AUTH_URL,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({platform:options.platform,authToken:options.authToken}),credentials:"omit",redirect:"error",signal:AbortSignal.timeout(8000)});
      pairing.stage = "socket-response";
      pairing.status = response.status;
      const value = await boundedJson(response,16_384);
      pairing.code = vendorCode(value?.code);
      if (this.destroyed || value?.code !== 0) throw Error();
      pairing.stage = "socket-address";
      const address = socketAddress(value?.data?.socketIoUrl), path = value?.data?.socketIoPath;
      if (!address || typeof path !== "string" || !/^\/[A-Za-z0-9/_.-]{1,255}$/.test(path) || path.includes("..")) throw Error();
      pairing.stage = "socket-connect";
      const socket = this.socketFactory(address,{path,transports:["websocket"],forceNew:true,reconnection:false,autoConnect:false,timeout:8000});
      this.socket = socket;
      socket.on("basicapi_update_device_info_tc",raw=>this.deviceInfo(raw));
      socket.on("basicapi_get_qrcode_tc",raw=>this.qrInfo(raw));
      for (const name of ["basicapi_update_app_status_tc","basicapi_update_app_online_tc"]) socket.on(name,raw=>this.appStatus(raw));
      socket.on("disconnect",()=>this.connectionLost());
      await new Promise((resolve,reject)=>{
        const timer = this.setTimer(()=>{this.clearTimer(timer);reject(Error());},8500);
        this.prepareTimer = timer; this.prepareReject = reject;
        socket.on("connect",()=>{this.clearTimer(timer);this.prepareTimer=null;this.prepareReject=null;if(this.destroyed)return reject(Error());this.ready=true;this.emit("ready",this);resolve();});
        socket.on("connect_error",()=>{this.clearTimer(timer);this.prepareTimer=null;this.prepareReject=null;if(this.ready){this.connectionLost();this.emit("sdkError");}reject(Error());});
        socket.on("error",()=>{if(this.ready)this.emit("sdkError");});
        socket.connect();
      });
      return this;
    } catch {
      this.destroy();
      throw Object.assign(Error("The extended Lovense connection could not be prepared."), {pairing});
    }
  }
  getAppStatus() {return !this.destroyed && this.online && this.socket?.connected === true;}
  getOnlineToys() {return this.getAppStatus() ? this.toys.map(toy=>({...toy})) : [];}
  getToys() {return this.getOnlineToys();}
  getQrcode() {
    if (this.destroyed || !this.ready || !this.socket?.connected) return Promise.reject(Error("Reconnect before requesting a pairing code."));
    if (this.qr) return Promise.resolve({...this.qr});
    if (this.pendingQr) return this.pendingQr.promise;
    const ackId = this.randomId();
    let resolve,reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
    const timer = this.setTimer(()=>{if(this.pendingQr?.ackId===ackId){this.pendingQr=null;reject(Error("The pairing code timed out."));}},10000);
    this.pendingQr={ackId,promise,resolve,reject,timer};
    this.socket.emit("basicapi_get_qrcode_ts",{ackId}); return promise;
  }
  qrInfo(raw) {
    if (this.destroyed || !this.pendingQr) return;
    try {
      const value=envelope(raw), result=data(raw), pending=this.pendingQr;
      if (result.ackId !== pending.ackId) return;
      this.clearTimer(pending.timer);this.pendingQr=null;
      if (value.code !== 0 || typeof result.qrcodeUrl !== "string" || result.qrcodeUrl.length > 4096) {
        pending.reject(Object.assign(Error("The pairing code could not be loaded."), {
          pairing: {stage: "qr-code", code: vendorCode(value.code)},
        }));
        return;
      }
      this.qr={qrcodeUrl:result.qrcodeUrl};pending.resolve({...this.qr});
    } catch {this.emit("sdkError");}
  }
  appStatus(raw) {
    if(this.destroyed)return;
    try {
      const parsed = typeof raw === "boolean" ? raw : envelope(raw);
      const value = plain(parsed) && typeof parsed.data === "boolean" ? parsed.data : plain(parsed) && plain(parsed.data) ? parsed.data : parsed;
      const online = typeof value === "boolean" ? value : value.online ?? value.status;
      if (online === false || online === 0) this.connectionLost();
      else if (online === true || online === 1) {this.online=true;this.emit("appStatusChange",true);}
      else this.connectionLost();
    } catch {this.connectionLost();}
  }
  deviceInfo(raw) {
    if(this.destroyed)return;
    try {
      const value=data(raw);
      if(value.online !== true || !Array.isArray(value.toyList) || value.toyList.length > 50) {this.connectionLost();return;}
      this.online=true;this.toys=value.toyList.filter(toy=>plain(toy)&&typeof toy.id==="string"&&ID.test(toy.id)&&toy.connected===true).map(toy=>{
        const safe={id:toy.id,name:toy.name,toyType:toy.toyType,hVersion:toy.hVersion,fVersion:toy.fVersion,battery:toy.battery,connected:true};
        for(const field of ["fullFunctionNames","shortFunctionNames"])if(Object.hasOwn(toy,field))safe[field]=toy[field];
        if(this.knownIds.size<50)this.knownIds.add(toy.id);return safe;
      });
      this.emit("appStatusChange",true);this.emit("toyInfoChange");
      const address=remoteCommandAddress(value.domain,Number(value.httpsPort));
      const epoch=++this.metadataEpoch;
      if(address)void this.enrichCapabilities(address,epoch);
    } catch {this.connectionLost();}
  }
  async enrichCapabilities(address,epoch) {
    // Read only the advertised Remote endpoint after deliberate pairing. If LAN
    // access/CORS is unavailable, retain conservative documented model support.
    try {
      const response=await this.fetcher(address,{method:"POST",headers:{"Content-Type":"application/json","X-platform":this.platform},body:'{"command":"GetToys"}',
        credentials:"omit",redirect:"error",signal:AbortSignal.timeout(1500)});
      const value=await boundedJson(response),raw=value?.data?.toys;
      if(this.destroyed||epoch!==this.metadataEpoch||![0,200].includes(value.code))return;
      const parsed=typeof raw==="string"?JSON.parse(raw):raw;
      if(!plain(parsed)||Object.keys(parsed).length>50)return;
      this.toys=this.toys.map(toy=>{
        const metadata=parsed[toy.id];if(!plain(metadata)||metadata.id!==toy.id)return toy;
        const next={...toy};for(const field of ["fullFunctionNames","shortFunctionNames"])if(Object.hasOwn(metadata,field))next[field]=metadata[field];return next;
      });
      this.emit("toyInfoChange");
    } catch { /* Capability enrichment is optional; never infer absent channels. */ }
  }
  connectionLost() {
    if(this.destroyed)return;
    this.online=false;this.toys=[];++this.metadataEpoch;this.clearPersonalRange();
    this.emit("appStatusChange",false);this.emit("toyInfoChange");
  }
  sendToyCommand(command) {
    if(!plain(command)||!ID.test(command.toyId||"")||command.time!==2||!this.getAppStatus())throw Error("Use a selected toy and a two-second command.");
    const keys=Object.keys(command).filter(key=>!["toyId","time"].includes(key));
    const toy=supportedToys(this.toys,{transport:SOCKET_TRANSPORT}).find(toy=>toy.id===command.toyId);
    if(!toy||!keys.length||keys.length>5||keys.some(key=>!Object.hasOwn(ACTIONS,key)||!toy.capabilities.includes(key)||!level(command[key])||command[key]>5&&!this.personalRanges.get(toy.id)?.has(key)))throw Error("The requested movement is unavailable or outside its enabled range.");
    if(keys.every(key=>command[key]===0))return this.stopToyAction(command.toyId);
    const now = this.now();
    if (now - this.lastCommand < 1000) throw Error("Wait for the next device tick.");
    const action = keys.sort().map(key => `${ACTIONS[key]}:${command[key]}`).join(",");
    const previous = this.lastFunction;
    // A still-active identical Alpha Flexer renewal can keep the same movement
    // running. Any change replaces the old command, including any higher level.
    const preserve = this.preserveFlexerRenewals && toy.model === "flexer" && previous?.toyId === toy.id &&
      previous.action === action && now < previous.expiresAt;
    this.lastCommand = now;
    this.socket.emit("basicapi_send_toy_command_ts",{command:"Function",action,timeSec:2,toy:toy.id,stopPrevious:preserve?0:1,apiVer:1});
    this.lastFunction = {toyId: toy.id, action, expiresAt: now + 2000};
    // Socket relay documents submission, not a physical acknowledgement.
    return {status:"submitted"};
  }
  stopToyAction(id) {
    this.lastFunction = null;
    if(this.destroyed||!this.socket?.connected||!ID.test(id||"")||!this.knownIds.has(id))return false;
    this.socket.emit("basicapi_send_toy_command_ts",{command:"Function",action:"Stop",timeSec:0,toy:id,stopPrevious:1,apiVer:1});
    return {status:"submitted"};
  }
  enablePersonalRange(id,channels) {
    const toy=supportedToys(this.toys,{transport:SOCKET_TRANSPORT}).find(toy=>toy.id===id);
    if(!this.getAppStatus()||!toy||!Array.isArray(channels)||!channels.length||channels.some(channel=>!toy.capabilities.includes(channel)))throw Error("The selected movement is unavailable.");
    this.personalRanges.set(id,new Set(channels));
  }
  clearPersonalRange(){this.personalRanges.clear();this.lastFunction=null;}
  destroy() {
    if(this.destroyed)return;
    this.destroyed=true;this.online=false;this.ready=false;++this.metadataEpoch;
    if(this.prepareTimer)this.clearTimer(this.prepareTimer);
    this.prepareReject?.(Error("Pairing was cancelled."));this.prepareReject=null;
    if(this.pendingQr){this.clearTimer(this.pendingQr.timer);this.pendingQr.reject(Error("Pairing was cancelled."));this.pendingQr=null;}
    this.qr=null;this.toys=[];this.knownIds.clear();this.clearPersonalRange();
    const socket=this.socket;this.socket=null;
    try{socket?.removeAllListeners();socket?.disconnect();}catch{}
    this.handlers.clear();
  }
}
