import {safeQrUrl, safeGeneratedQrImage} from "./pairing-image.mjs";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CHANNELS = new Set(["vibrate", "rotate", "fingering", "thrusting", "oscillate"]);
const ALPHA_CHANNELS = new Set([...CHANNELS, "suction"]);
const validId = value => typeof value === "string" && ID.test(value);
const validLevel = value => Number.isInteger(value) && value >= 0 && value <= 5;
const personalLevel = value => Number.isInteger(value) && value >= 0 && value <= 20;
const PAIRING_FAILED = "Lovense could not show a pairing code. Try connecting again.";
function pairingMessage({stage, status, code}) {
  const vendorCode = Number.isSafeInteger(code) && code !== 0 && Math.abs(code) <= 999999 ? ` (code ${code})` : "";
  const httpStatus = Number.isInteger(status) && status >= 300 && status <= 599 ? ` (HTTP ${status})` : "";
  switch (stage) {
    case "socket-request": return "The browser could not reach Lovense’s connection service. Try connecting again.";
    case "socket-response": return code === 400 ?
      "Lovense rejected the Website Name or pairing token (code 400). Ask the study owner to check the Lovense setup." :
      `Lovense did not authorise the socket connection${vendorCode || httpStatus}. Try connecting again.`;
    case "socket-address": return "Lovense returned socket details that the app could not use. Try connecting again.";
    case "socket-connect": return "Lovense authorised the session, but the browser could not open the socket. Try connecting again.";
    case "qr-code": return `Lovense could not show a pairing code${vendorCode}. Try connecting again.`;
    default: return "";
  }
}

/** Owns an opaque sandbox and its private MessagePort; never receives story data. */
export class BridgeTransport {
  constructor({document = globalThis.document, window = globalThis.window, navigator = globalThis.navigator,
    Channel = globalThis.MessageChannel, request = (path, options = {}) => fetch(path, {
      credentials: "same-origin", cache: "no-store", redirect: "error", ...options,
    }), framePath = "/device-bridge", now = Date.now, setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer), onChange = () => {}} = {}) {
    if (!["/device-bridge", "/alpha/device-bridge"].includes(framePath)) throw new Error("Use the isolated SatinLore bridge.");
    Object.assign(this, {document, window, navigator, Channel, request, framePath, now, setTimer, clearTimer, onChange});
    this.channels = framePath === "/alpha/device-bridge" ? ALPHA_CHANNELS : CHANNELS;
    this.listeners = new Set(); this.pending = new Map(); this.toys = []; this.selected = null;
    this.epoch = 0; this.serial = 0; this.frame = null; this.port = null; this.release = null;
    this.releasing = null;
    this.credentials = null; this.qrUrl = null; this.available = null; this.state = "disconnected";
    this.pairingProblem = "";
    this.message = ""; this.channel = "vibrate"; this.ceiling = 5; this.ready = false; this.expiresAt = 0;
    this.configurationChecks = null;
    this.personalRangeChannels = new Set();
    this.visibility = () => { if (this.document.hidden) this.dispose("Connection closed when the tab became hidden. Reconnect explicitly."); };
    this.leaving = () => this.dispose("Connection closed.");
    this.document?.addEventListener("visibilitychange", this.visibility);
    this.window?.addEventListener("pagehide", this.leaving);
  }
  snapshot() { return {liveConfigured: this.available, connectionState: this.state, toys: this.discover(),
    selectedId: this.selected, qrUrl: this.qrUrl, connectionMessage: this.message,
    configurationChecks: this.configurationChecks ? {...this.configurationChecks} : null,
    personalRangeChannels:[...this.personalRangeChannels]}; }
  notify() { if (this.notifierFailed) return; try { this.onChange(this.snapshot()); } catch { this.notifierFailed = true; this.dispose("The connection display failed."); } }
  subscribe(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  emit(event) { for (const callback of this.listeners) { try { callback(event); } catch {} } }
  discover() { return this.toys.map(toy => ({...toy, capabilities: [...toy.capabilities], vibration: toy.capabilities.includes("vibrate"), name: toy.label})); }
  async status() {
    const operation = this.epoch;
    try {
      const response = await this.request("/api/lovense/status");
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (operation !== this.epoch) return false;
      this.available = value?.available === true;
      const fields = ["developerToken", "platform", "uidSecret", "storage"];
      this.configurationChecks = value?.checks && typeof value.checks === "object" && fields.every(key => ["ready", "missing", "invalid"].includes(value.checks[key])) ?
        Object.fromEntries(fields.map(key => [key, value.checks[key]])) : null;
      this.message = typeof value?.message === "string" && value.message.trim() && value.message.length <= 600 && !/[\u0000-\u001f\u007f]/.test(value.message) ? value.message :
        this.available ? "Lovense connection is available." : "Lovense setup is not configured on this server. You can rehearse with the simulator.";
    } catch { if (operation !== this.epoch) return false; this.available = false; this.configurationChecks = null; this.message = "Lovense setup could not be checked. You can rehearse with the simulator."; }
    this.notify(); return this.available;
  }
  async acquire() {
    if (!this.navigator?.locks?.request) throw new Error("Use a browser with Web Locks support to connect a physical toy.");
    return new Promise((resolve, reject) => {
      const lease = this.navigator.locks.request("satinlore-device-check", {ifAvailable: true}, async lock => {
        if (!lock) { reject(new Error("Another tab has the toy connection. Disconnect it first.")); return; }
        await new Promise(release => { resolve(() => {release(); return lease;}); });
      }).catch(() => reject(new Error("The toy connection lock could not be obtained.")));
    });
  }
  async begin() {
    this.notifierFailed = false;
    this.dispose(undefined, {notify: false});
    const operation = this.epoch;
    this.state = "connecting"; this.message = "Preparing a private connection…"; this.notify();
    if(this.notifierFailed)return false;
    try {
      if (this.releasing) await this.releasing;
      if (operation !== this.epoch) return false;
      if (this.document?.hidden || !await this.status()) throw new Error(this.message);
      if (operation !== this.epoch) return false;
      const release = await this.acquire();
      if (operation !== this.epoch || this.document?.hidden) { release(); return false; }
      this.release = release;
      const response = await this.request("/api/lovense/session", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"});
      if (!response.ok) {
        const message = {401: "Sign in again before pairing a toy.", 403: "Sign in again before pairing a toy.",
          429: "There have been several connection attempts. Wait a minute and try again.",
          502: "Lovense could not start the pairing session. Try again shortly."}[response.status];
        throw new Error(message || "The private Lovense connection could not be prepared. Try again shortly.");
      }
      const value = await response.json();
      if (operation !== this.epoch || this.document?.hidden) return false;
      if (!value || typeof value.uid !== "string" || !validId(value.uid) || typeof value.platform !== "string" || !value.platform || value.platform.length > 256 ||
          typeof value.authToken !== "string" || !value.authToken || value.authToken.length > 16384 || !Number.isFinite(value.expires_at) || value.expires_at * 1000 <= this.now()) throw new Error("The pairing session is invalid or expired.");
      this.expiresAt = value.expires_at * 1000; this.credentials = value;
      await this.openFrame(operation);
      return operation === this.epoch && this.ready;
    } catch (error) {
      if (operation === this.epoch) this.dispose(error.message || "The Lovense connection failed. Try again.");
      return false;
    }
  }
  openFrame(operation) {
    return new Promise((resolve, reject) => {
      const frame = this.document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts"); frame.title = "Isolated Lovense connection";
      frame.src = this.framePath; frame.hidden = true; this.frame = frame;
      this.opening = {resolve, reject};
      this.openTimer = this.setTimer(() => {
        if (operation === this.epoch) this.dispose(this.pairingProblem || "Pairing timed out. Try connecting again.");
      }, 30000);
      this.expiryTimer = this.setTimer(() => { if (operation === this.epoch) this.dispose("The pairing session expired. Sign in and reconnect."); }, Math.min(this.expiresAt - this.now(), 2147483647));
      frame.addEventListener("load", () => {
        if (operation !== this.epoch || this.frame !== frame) return;
        if (this.port) { this.dispose("The connection frame changed. Reconnect explicitly."); return; }
        const channel = new this.Channel(); this.port = channel.port1;
        this.port.onmessage = event => { if (operation === this.epoch && this.frame === frame) this.receive(event.data); };
        this.port.start();
        // Only this exact opaque-origin frame receives the transferred port.
        frame.contentWindow.postMessage({type: "satinlore:bridge"}, "*", [channel.port2]);
      });
      this.document.body.append(frame);
    });
  }
  receive(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    if (message.type === "bridge-ready") {
      if (this.ready || !this.credentials) return;
      this.ready = true;
      this.port.postMessage({type: "init", session: this.credentials}); this.credentials = null;
      this.message = "Getting a pairing code from Lovense…";
      this.opening?.resolve(true); this.opening = null; this.notify();
    } else if (message.type === "pairing-diagnostic") {
      if (this.state === "connecting") this.pairingProblem = pairingMessage(message) || this.pairingProblem;
    } else if (message.type === "qr") {
      const url = safeGeneratedQrImage(message.image) || safeQrUrl(message.url);
      if (!url) { this.dispose("The pairing code was invalid. Reconnect."); return; }
      this.qrUrl = url; this.pairingProblem = ""; this.clearTimer(this.openTimer);
      if (!this.toys.length) {this.state = "waiting"; this.message = "Scan this code in Lovense Remote.";}
      this.notify();
    } else if (message.type === "toys" && Array.isArray(message.toys)) {
      const seen = new Set();
      const toys = message.toys.slice(0,50).filter(toy => toy && validId(toy.id) && typeof toy.label === "string" && toy.label.length <= 100 && Array.isArray(toy.capabilities) && toy.capabilities.length<=5 && toy.capabilities.some(value=>this.channels.has(value)&&(value!=="oscillate"||toy.controlTransport==="standard-socket-v1")) && !seen.has(toy.id) && seen.add(toy.id)).map(toy => ({
        id: toy.id, label: toy.label, model: typeof toy.model === "string" ? toy.model.slice(0,32) : "",
        capabilities: [...new Set(toy.capabilities.filter(value => this.channels.has(value) && (value!=="oscillate"||toy.controlTransport==="standard-socket-v1")))],
        ...(toy.controlTransport==="standard-socket-v1" ? {controlTransport:"standard-socket-v1",supportsCombined:toy.supportsCombined===true} : {}),
        ...(Number.isFinite(toy.battery) ? {battery: Math.max(0,Math.min(100,toy.battery))} : {}),
      }));
      const previous = this.selected;
      this.toys = toys;
      if (previous && (!toys.some(toy => toy.id === previous) || Object.hasOwn(message,"selected") && message.selected === null)) { this.selected = null; this.personalRangeChannels.clear();this.ceiling=Math.min(5,this.ceiling);this.emit({type: "disconnect", deviceId: previous}); }
      if (this.selected) this.state = "paused";
      else if (toys.length) {this.state = "discovered"; this.message = "Choose your toy below.";}
      else if (this.qrUrl) {this.state = "waiting"; this.message = "Waiting for Lovense Remote. Make sure your toy is connected in the app.";}
      this.notify();
    } else if (message.type === "selected" && validId(message.id) && this.toys.some(toy => toy.id === message.id)) {
      this.selected = message.id; this.state = "paused"; this.message = "Toy selected. Try each movement at a low level.";
      for (const [key,pending] of this.pending) if (pending.kind === "select" && pending.toyId === message.id) { this.pending.delete(key); this.clearTimer(pending.timer); pending.resolve(true); }
      this.notify();
    } else if (message.type === "result" && typeof message.requestId === "string") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId); this.clearTimer(pending.timer);
      message.ok === true && message.status === "submitted" ? pending.resolve(message) : pending.reject(new Error("The device request was not confirmed by the connection."));
    } else if (message.type === "state") {
      if (["waiting", "connecting", "disconnected"].includes(message.state) && this.selected) {
        const id = this.selected; this.selected = null; this.emit({type: "disconnect", deviceId: id});
      }
      if (message.state === "disconnected") {
        this.dispose(this.state === "connecting" ? this.pairingProblem || PAIRING_FAILED : "The Lovense connection ended. Connect again.");
        return;
      }
      if (message.state === "waiting" && this.qrUrl) this.state = "waiting";
      this.notify();
    } else if (message.type === "closed") this.dispose("The Lovense connection closed. Reconnect explicitly.");
    else if (message.type === "error") {
      if (this.state === "connecting") {this.dispose(this.pairingProblem || PAIRING_FAILED); return;}
      this.message = "The device request failed. Check Lovense Remote and reconnect.";
      if (validId(this.selected)) this.emit({type: "disconnect", deviceId: this.selected});
      this.notify();
    }
  }
  send(type, extra = {}, {timeout = 1700} = {}) {
    if (!this.port || !this.ready || this.document?.hidden || this.now() >= this.expiresAt) return Promise.reject(new Error("Reconnect Lovense before sending a request."));
    const requestId = `bridge-${++this.serial}`;
    return new Promise((resolve, reject) => {
      const pending = {resolve, reject, kind: type, toyId: extra.toyId, timer: null};
      pending.timer = this.setTimer(() => { if (this.pending.delete(requestId)) reject(new Error("The device request timed out.")); }, timeout);
      this.pending.set(requestId, pending);
      try { this.port.postMessage({type, requestId, ...extra}); }
      catch { this.pending.delete(requestId); this.clearTimer(pending.timer); reject(new Error("The connection could not send this request.")); }
    });
  }
  async connect(frame, {signal} = {}) {
    if (!validId(frame?.deviceId) || !this.toys.some(toy => toy.id === frame.deviceId) || signal?.aborted) throw new Error("Select one discovered toy.");
    // Selection is deliberately requested by the user; never choose the first toy.
    this.personalRangeChannels.clear();this.ceiling=Math.min(this.ceiling,5);
    await new Promise((resolve,reject) => {
      const key = `select-${++this.serial}`, timer = this.setTimer(() => {this.pending.delete(key); reject(new Error("Device selection timed out."));},1700);
      this.pending.set(key,{resolve,reject,kind:"select",toyId:frame.deviceId,timer});
      this.port.postMessage({type:"select",id:frame.deviceId});
    });
    if (signal?.aborted) { void this.send("stop",{toyId:frame.deviceId}).catch(()=>{}); throw new Error("Selection cancelled."); }
    return {...frame,connected:true};
  }
  async command(frame, {signal} = {}) {
    const toy = this.toys.find(value => value.id === frame?.deviceId);
    if (!toy || frame.deviceId !== this.selected || signal?.aborted || !personalLevel(frame.level) || frame.level > this.maximumFor(this.channel) || frame.level < 1 || frame.level > this.ceiling || frame.durationMs !== 2000 || !toy.capabilities.includes(this.channel)) throw new Error("Use the selected toy, supported channel and a finite enabled-range command.");
    await this.send("command",{toyId:frame.deviceId,level:frame.level,ceiling:this.ceiling,channel:this.channel,seconds:2});
    return {...frame};
  }
  async commandVector(frame, levels, ceilings, {signal} = {}) {
    const toy=this.toys.find(value=>value.id===frame?.deviceId);
    const plain=value=>value&&typeof value==="object"&&!Array.isArray(value);
    if(!toy||toy.id!==this.selected||toy.controlTransport!=="standard-socket-v1"||toy.supportsCombined!==true||signal?.aborted||frame.durationMs!==2000||!plain(levels)||!plain(ceilings))throw Error("Independent movements need the selected extended connection.");
    const keys=Object.keys(levels);
    if(!keys.length||keys.length>5||Object.keys(ceilings).length!==keys.length||keys.some(key=>!Object.hasOwn(ceilings,key)||!toy.capabilities.includes(key)||!this.channels.has(key)||!personalLevel(levels[key])||!personalLevel(ceilings[key])||ceilings[key]>this.maximumFor(key)||levels[key]>ceilings[key]||levels[key]>this.ceiling)||frame.level!==Math.max(...Object.values(levels)))throw Error("Use each movement's current enabled limit.");
    if(keys.every(key=>levels[key]===0))await this.send("stop",{toyId:toy.id});
    else {
      const result=await this.send("command-vector",{toyId:toy.id,levels:{...levels},ceilings:{...ceilings},seconds:2});
      if(result.level!==frame.level||!plain(result.levels)||Object.keys(result.levels).length!==keys.length||keys.some(key=>result.levels[key]!==levels[key]))throw Error("The independent movement submission did not match the request.");
    }
    return {...frame,levels:{...levels}};
  }
  async stop(frame) {
    if (!validId(frame?.deviceId)) throw new Error("A targeted Stop is required.");
    await this.send("stop",{toyId:frame.deviceId}); return {...frame,level:0};
  }
  async disconnect(frame) { return {...frame}; }
  refresh() { if (this.port && this.ready) this.port.postMessage({type:"refresh"}); return this.snapshot(); }
  maximumFor(channel){return this.personalRangeChannels.has(channel)?20:5;}
  async enablePersonalRange({deviceId=this.selected,channels=[this.channel],confirmedStopped=false}={}){
    const toy=this.toys.find(value=>value.id===deviceId);
    if(!toy||deviceId!==this.selected||confirmedStopped!==true||!Array.isArray(channels)||!channels.length||channels.length>5||new Set(channels).size!==channels.length||channels.some(channel=>!toy.capabilities.includes(channel))||this.pending.size)throw Error("Complete and confirm a stopped gentle check first.");
    const result=await this.send("enable-personal-range",{toyId:deviceId,channels:[...channels],confirmedStopped:true});
    if(deviceId!==this.selected||!Array.isArray(result.channels)||result.channels.length>5||result.channels.some(channel=>!toy.capabilities.includes(channel))||channels.some(channel=>!result.channels.includes(channel)))throw Error("The personal-range permission could not be confirmed.");
    this.personalRangeChannels=new Set(result.channels);this.notify();return true;
  }
  setCeiling(value) { if (!personalLevel(value)||value>5&&!this.personalRangeChannels.size) throw new Error("Enable your personal range before choosing a maximum above 5."); this.ceiling = value; }
  setChannel(channel) { if (!this.channels.has(channel)) throw new Error("Choose a supported channel."); this.channel = channel; }
  dispose(message = "Disconnected. Reconnect explicitly.", {notify = true} = {}) {
    ++this.epoch;
    const id = this.selected, frame = this.frame, port = this.port, release = this.release;
    this.frame = this.port = this.release = null; this.credentials = null; this.selected = null; this.toys = []; this.qrUrl = null;
    this.personalRangeChannels.clear();this.ceiling=Math.min(this.ceiling,5);
    this.ready = false; this.expiresAt = 0; this.state = "disconnected"; this.message = message; this.pairingProblem = "";
    this.clearTimer(this.openTimer); this.clearTimer(this.expiryTimer);
    this.opening?.reject(new Error(message)); this.opening = null;
    for (const pending of this.pending.values()) {this.clearTimer(pending.timer);pending.reject(new Error(message));}
    this.pending.clear();
    if (port) {
      this.releasing = new Promise(resolve => {
        let removed = false;
        const remove = () => {
          if (removed) return;
          removed = true;
          try {port.close();} catch {}
          frame?.remove();
          resolve(release?.());
        };
        port.onmessage = event => {if(event.data?.type === "closed")remove();};
        try {port.postMessage({type:"dispose"});} catch {}
        this.setTimer(remove,250);
      });
    } else {
      frame?.remove();
      if (release) this.releasing = release();
    }
    if (id) this.emit({type:"disconnect",deviceId:id});
    if (notify) this.notify();
  }
  destroy() { this.dispose(); this.document?.removeEventListener("visibilitychange",this.visibility);this.window?.removeEventListener("pagehide",this.leaving);this.listeners.clear(); }
}
