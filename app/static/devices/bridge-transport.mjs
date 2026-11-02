// A URL validator only: vendor SDK/control code stays inside the opaque bridge.
function safeQrUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try { const url = new URL(value); const allowed = ["lovense-api.com", "lovense.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed ? url.href : null;
  } catch { return null; }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CHANNELS = new Set(["vibrate", "rotate", "fingering", "thrusting"]);
const validId = value => typeof value === "string" && ID.test(value);
const validLevel = value => Number.isInteger(value) && value >= 0 && value <= 5;

/** Owns an opaque sandbox and its private MessagePort; never receives story data. */
export class BridgeTransport {
  constructor({document = globalThis.document, window = globalThis.window, navigator = globalThis.navigator,
    Channel = globalThis.MessageChannel, request = (path, options = {}) => fetch(path, {
      credentials: "same-origin", cache: "no-store", redirect: "error", ...options,
    }), now = Date.now, setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer), onChange = () => {}} = {}) {
    Object.assign(this, {document, window, navigator, Channel, request, now, setTimer, clearTimer, onChange});
    this.listeners = new Set(); this.pending = new Map(); this.toys = []; this.selected = null;
    this.epoch = 0; this.serial = 0; this.frame = null; this.port = null; this.release = null;
    this.credentials = null; this.qrUrl = null; this.available = null; this.state = "disconnected";
    this.message = ""; this.channel = "vibrate"; this.ceiling = 5; this.ready = false; this.expiresAt = 0;
    this.visibility = () => { if (this.document.hidden) this.dispose("Connection closed when the tab became hidden. Reconnect explicitly."); };
    this.leaving = () => this.dispose("Connection closed.");
    this.document?.addEventListener("visibilitychange", this.visibility);
    this.window?.addEventListener("pagehide", this.leaving);
  }
  snapshot() { return {liveConfigured: this.available, connectionState: this.state, toys: this.discover(),
    selectedId: this.selected, qrUrl: this.qrUrl, connectionMessage: this.message}; }
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
      this.message = this.available ? "Lovense connection is available." : "Lovense setup is not configured on this server. You can rehearse with the simulator.";
    } catch { if (operation !== this.epoch) return false; this.available = false; this.message = "Lovense setup could not be checked. You can rehearse with the simulator."; }
    this.notify(); return this.available;
  }
  async acquire() {
    if (!this.navigator?.locks?.request) throw new Error("Use a browser with Web Locks support to connect a physical toy.");
    return new Promise((resolve, reject) => {
      this.navigator.locks.request("satinlore-device-check", {ifAvailable: true}, async lock => {
        if (!lock) { reject(new Error("Another tab has the toy connection. Disconnect it first.")); return; }
        await new Promise(release => { let done = false; resolve(() => { if (!done) {done = true; release();} }); });
      }).catch(() => reject(new Error("The toy connection lock could not be obtained.")));
    });
  }
  async begin() {
    this.notifierFailed = false;
    this.dispose();
    if (this.notifierFailed) return false;
    const operation = this.epoch;
    this.state = "connecting"; this.message = "Preparing a private connection…"; this.notify();
    if(this.notifierFailed)return false;
    try {
      if (this.document?.hidden || !await this.status()) throw new Error(this.message);
      if (operation !== this.epoch) return false;
      const release = await this.acquire();
      if (operation !== this.epoch || this.document?.hidden) { release(); return false; }
      this.release = release;
      const response = await this.request("/api/lovense/session", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"});
      if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? "Sign in again before pairing a toy." : "The private Lovense connection could not be prepared.");
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
      frame.src = "/device-bridge"; frame.hidden = true; this.frame = frame;
      this.opening = {resolve, reject};
      this.openTimer = this.setTimer(() => { if (operation === this.epoch) this.dispose("Pairing timed out. Try connecting again."); }, 30000);
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
      this.state = "waiting"; this.message = "Pair your toy in Lovense Remote, then scan the code.";
      this.opening?.resolve(true); this.opening = null; this.notify();
    } else if (message.type === "qr") {
      const url = safeQrUrl(message.url);
      if (!url) { this.dispose("The pairing code was invalid. Reconnect."); return; }
      this.qrUrl = url; this.clearTimer(this.openTimer); this.notify();
    } else if (message.type === "toys" && Array.isArray(message.toys)) {
      const seen = new Set();
      const toys = message.toys.slice(0,50).filter(toy => toy && validId(toy.id) && typeof toy.label === "string" && toy.label.length <= 100 && Array.isArray(toy.capabilities) && toy.capabilities.includes("vibrate") && !seen.has(toy.id) && seen.add(toy.id)).map(toy => ({
        id: toy.id, label: toy.label, model: typeof toy.model === "string" ? toy.model.slice(0,32) : "",
        capabilities: toy.capabilities.filter(value => CHANNELS.has(value)),
        ...(Number.isFinite(toy.battery) ? {battery: Math.max(0,Math.min(100,toy.battery))} : {}),
      }));
      const previous = this.selected;
      this.toys = toys;
      if (previous && (!toys.some(toy => toy.id === previous) || Object.hasOwn(message,"selected") && message.selected === null)) { this.selected = null; this.emit({type: "disconnect", deviceId: previous}); }
      this.state = toys.length ? "discovered" : "waiting";
      this.notify();
    } else if (message.type === "selected" && validId(message.id) && this.toys.some(toy => toy.id === message.id)) {
      this.selected = message.id; this.state = "paused";
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
      if (message.state === "disconnected") { this.dispose("The Lovense connection ended. Reconnect explicitly."); return; }
      if (message.state === "waiting") this.state = "waiting";
      this.notify();
    } else if (message.type === "closed") this.dispose("The Lovense connection closed. Reconnect explicitly.");
    else if (message.type === "error") { this.message = "The device request failed. Check Lovense Remote and reconnect."; if(validId(this.selected))this.emit({type: "disconnect", deviceId: this.selected}); this.notify(); }
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
    if (!toy || frame.deviceId !== this.selected || signal?.aborted || !validLevel(frame.level) || frame.level < 1 || frame.level > this.ceiling || frame.durationMs !== 2000 || !toy.capabilities.includes(this.channel)) throw new Error("Use the selected toy, supported channel and a finite low-level command.");
    await this.send("command",{toyId:frame.deviceId,level:frame.level,ceiling:this.ceiling,channel:this.channel,seconds:2});
    return {...frame};
  }
  async stop(frame) {
    if (!validId(frame?.deviceId)) throw new Error("A targeted Stop is required.");
    await this.send("stop",{toyId:frame.deviceId}); return {...frame,level:0};
  }
  async disconnect(frame) { return {...frame}; }
  refresh() { if (this.port && this.ready) this.port.postMessage({type:"refresh"}); return this.snapshot(); }
  setCeiling(value) { if (!validLevel(value)) throw new Error("Use a physical maximum from 0 to 5."); this.ceiling = value; }
  setChannel(channel) { if (!CHANNELS.has(channel)) throw new Error("Choose a supported channel."); this.channel = channel; }
  dispose(message = "Disconnected. Reconnect explicitly.") {
    ++this.epoch;
    const id = this.selected, frame = this.frame, port = this.port, release = this.release;
    this.frame = this.port = this.release = null; this.credentials = null; this.selected = null; this.toys = []; this.qrUrl = null;
    this.ready = false; this.expiresAt = 0; this.state = "disconnected"; this.message = message;
    this.clearTimer(this.openTimer); this.clearTimer(this.expiryTimer);
    this.opening?.reject(new Error(message)); this.opening = null;
    for (const pending of this.pending.values()) {this.clearTimer(pending.timer);pending.reject(new Error(message));}
    this.pending.clear();
    if (port) {
      try { port.postMessage({type:"dispose"}); } catch {}
      let removed = false;
      const remove = () => {if(removed)return; removed=true; try{port.close();}catch{} frame?.remove(); release?.();};
      port.onmessage = event => {if(event.data?.type === "closed")remove();};
      this.setTimer(remove,250);
    } else { frame?.remove(); release?.(); }
    if (id) this.emit({type:"disconnect",deviceId:id});
    this.notify();
  }
  destroy() { this.dispose(); this.document?.removeEventListener("visibilitychange",this.visibility);this.window?.removeEventListener("pagehide",this.leaving);this.listeners.clear(); }
}
