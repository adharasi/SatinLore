import {normalizeSceneProfiles, ReadingFeel} from "../reader/calibration.mjs";
/** Experimental async contract for the deterministic lab only; not a qualified hardware adapter. */
export const ASYNC_COMMAND_MS = 2000;
const level = value => {
  if (!Number.isInteger(value) || value < 0 || value > 20) throw new RangeError("Use a whole-number level from 0 to 20.");
  return value;
};

export class AsyncPlaybackController {
  constructor({ transport, now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), onChange = () => {}, onEvent = () => {}, connectTimeout = 3000, requestTimeout = 1800, inactivityMs = 120000, heartbeatMs = 1000 }) {
    if (!transport || !["discover", "connect", "command", "stop", "disconnect"].every(key => typeof transport[key] === "function")) throw new TypeError("A targeted asynchronous transport is required.");
    if (![connectTimeout, requestTimeout, inactivityMs].every(value => Number.isFinite(value) && value > 0) || requestTimeout >= ASYNC_COMMAND_MS) throw new RangeError("Use positive timeouts; command acknowledgement must be bounded below two seconds.");
    if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1000 || heartbeatMs > 1500) throw new RangeError("Use a 1000–1500 ms finite renewal cadence.");
    Object.assign(this, { transport, now, setTimer, clearTimer, onChange, onEvent, connectTimeout, requestTimeout, inactivityMs, heartbeatMs });
    this.state = "DISCONNECTED"; this.connected = false; this.selected = null; this.visible = true; this.authorized = true;
    this.feel = new ReadingFeel(); this.manualZeros = new Set();
    this.levels = []; this.sceneProfiles = []; this.position = 0; this.ceiling = 5; this.strengthTenths = 10; this.output = 0;this.outputLevels=null;
    this.generation = 0; this.sequence = 0; this.revision = 0; this.staleReplies = 0; this.reason = "Choose a simulated device explicitly.";
    this.requests = new Map(); this.stopTasks = new Map(); this.uncertain = new Set(); this.errorLatch = false;
    this.commandSettlements = new Map(); this.needsFreshStop = new Set();
    this.tickTimer = null; this.idleTimer = null; this.lastDispatch = -Infinity; this.lastTick = 0; this.lastActivity = 0; this.disposed = false;
    this.unsubscribe = transport.subscribe?.(event => { if (event.type === "disconnect" && event.deviceId === this.selected) { this.uncertain.add(event.deviceId); this.output = null; this.connected = false; void this.pause("Connection lost. Reconnect, then confirm a new Start."); } });
  }
  snapshot() {
    return { state: this.state, running: this.state === "PLAYING", connected: this.connected, selectedDeviceId: this.selected,
      canStart: this.state === "READY_PAUSED" && this.connected && !!this.selected && this.visible && this.authorized && !!this.levels.length && !this.errorLatch && !this.uncertain.size,
      output: this.output,outputLevels:this.outputLevels?{...this.outputLevels}:null, outputKnown: this.output !== null, target: this.desired(), ceiling: this.ceiling, strength: this.strengthTenths / 10,
      position: this.position, generation: this.generation, staleReplies: this.staleReplies, uncertainTargets: [...this.uncertain],
      feel: this.feel.snapshot(),
      pending: [...this.requests.values()].filter(value => !value.rawSettled).map(value => ({ ...value.frame })), reason: this.reason };
  }
  intent() {
    const context={base:this.levels[this.position] ?? 0,strength:this.strengthTenths / 10,
      ceiling:this.ceiling,manualZero:this.manualZeros.has(this.position),scene:this.sceneProfiles[this.position],now:this.now()};
    const levels=this.feel.vector?.(context);
    return levels?{level:Math.max(0,...Object.values(levels)),levels,ceilings:this.feel.ceilings(this.ceiling)}:{level:this.feel.desired(context)};
  }
  desired() {return this.intent().level;}
  vectorReduction(prior,next=this.intent().levels){return !!prior && !!next && Object.keys(prior).some(id=>prior[id]>(next[id]??0));}
  setFeel(value) {
    try {this.feel.configure(value);} catch(error) {void this.pause("Invalid reading controls.");throw error;}
    return this.changed();
  }
  hold(value = this.output) {
    if(this.state !== "PLAYING") return false;
    if(value===null){void this.pause("Output is unknown. Stopped instead of holding an unconfirmed level.");return false;}
    try{if(this.feel.holdLevels&&arguments.length===0)this.feel.holdLevels(this.outputLevels);else this.feel.hold(value);}catch(error){void this.pause("Invalid Hold level.");throw error;}this.changed();return true;
  }
  holdChannels(value) {
    if(this.state!=="PLAYING" || !this.feel.holdLevels)return false;
    try{this.feel.holdLevels(value);}catch(error){void this.pause("Invalid movement levels.");throw error;}
    this.changed();return true;
  }
  easeOff(value = this.feel.settings.recovery) {
    if(this.state !== "PLAYING") return false;
    if(this.output===null){void this.pause("Output is unknown. Stopped instead of guessing a recovery level.");return false;}
    try{if(this.feel.easeOffLevels)this.feel.easeOffLevels(this.outputLevels,arguments.length?value:undefined);else this.feel.easeOff(value,Math.min(this.output,this.desired()));}catch(error){void this.pause("Invalid recovery level.");throw error;}this.changed();return true;
  }
  followStory() {
    if(this.state==="PLAYING"&&this.output===null){void this.pause("Output is unknown. Stopped before returning to the story.");return this.snapshot();}
    this.feel.followStory(this.state==="PLAYING"?(this.feel.vector?this.outputLevels:this.output):undefined);return this.changed();
  }
  setManualZeros(indices) {
    if(!Array.isArray(indices) || indices.some(index => !Number.isInteger(index) || index<0 || index>=this.levels.length)) {void this.pause("Invalid paragraph corrections.");throw new RangeError("Use existing paragraph indices.");}
    this.manualZeros=new Set(indices);return this.changed();
  }
  notify() {
    if (this.disposed) return this.snapshot();
    try { this.onChange(this.snapshot()); }
    catch { if (!this.notifierFailed) { this.notifierFailed = true; this.errorLatch = true; void this.pause("The interface failed. Reconnect before continuing."); } }
    return this.snapshot();
  }
  event(type, frame) { try { this.onEvent({ at: this.now(), type, ...frame }); } catch { /* Diagnostic events cannot control output. */ } }
  clearSchedules() { this.clearTimer(this.tickTimer); this.clearTimer(this.idleTimer); this.tickTimer = this.idleTimer = null; }
  invalidate() {
    ++this.generation; ++this.revision; this.startIntent = null; this.ceilingIntent = null; this.clearSchedules();
    for (const request of [...this.requests.values()]) if (request.frame.kind !== "stop" && !request.finished) request.cancel();
    return this.generation;
  }
  outstanding(deviceId) { return [...this.requests.values()].some(value => value.frame.kind === "command" && value.frame.deviceId === deviceId && !value.rawSettled); }
  request(kind, deviceId, extra = {}) {
    if (!["connect", "command", "stop", "disconnect"].includes(kind) || typeof deviceId !== "string" || !deviceId) return Promise.reject(new TypeError("Use a targeted transport operation."));
    if (kind === "command" && (!Number.isInteger(extra.level) || extra.level < 1 || extra.level > this.ceiling || extra.durationMs !== ASYNC_COMMAND_MS)) return Promise.reject(new RangeError("Use the confirmed ceiling and a finite two-second command."));
    const vector=kind === "command" && extra.levels;
    if(vector && (!this.transport.commandVector || !extra.ceilings || Array.isArray(vector) || Object.keys(vector).length<2 || Object.keys(vector).length>5 ||
        Object.keys(vector).length!==Object.keys(extra.ceilings).length || Object.keys(vector).some(id=>!["vibrate","fingering","rotate","thrusting","oscillate"].includes(id)||!Number.isInteger(vector[id])||vector[id]<0||vector[id]>this.ceiling||!Number.isInteger(extra.ceilings[id])||extra.ceilings[id]<0||extra.ceilings[id]>this.ceiling||vector[id]>extra.ceilings[id]) ||
        Math.max(...Object.values(vector))!==extra.level))return Promise.reject(new RangeError("Use individually bounded, supported movement controls."));
    const frame = { kind, deviceId, operationId: `request-${++this.sequence}`, generation: this.generation,
      ...(kind === "command" ? { level: extra.level, durationMs: ASYNC_COMMAND_MS } : {}) };
    const abort = new AbortController();
    let resolveBounded, rejectBounded;
    const promise = new Promise((resolve, reject) => { resolveBounded = resolve; rejectBounded = reject; });
    const record = { frame,...(vector?{levels:{...vector},ceilings:{...extra.ceilings}}:{}), rawSettled: false, finished: false, cancel: null };
    let timeout;
    const finish = (error, ack) => {
      if (record.finished) return;
      record.finished = true; this.clearTimer(timeout);
      error ? rejectBounded(error) : resolveBounded(ack);
    };
    record.cancel = () => { finish(new Error("Request cancelled.")); abort.abort(); };
    this.requests.set(frame.operationId, record);
    timeout = this.setTimer(() => { finish(new Error("Request timed out.")); abort.abort(); }, kind === "connect" ? this.connectTimeout : this.requestTimeout);
    const settle = (error, ack) => {
      const wasFinished = record.finished;
      record.rawSettled = true; this.requests.delete(frame.operationId);
      if (kind === "command") this.commandSettlements.set(deviceId, (this.commandSettlements.get(deviceId) || 0) + 1);
      if (wasFinished) {
        this.staleReplies++; this.event("stale-completion-ignored", frame);
        // A delayed physical effect may follow an earlier Stop. Only another acknowledged,
        // targeted Stop after all old nonzero requests settle can clear that uncertainty.
        if (!this.disposed && kind === "command" && this.uncertain.has(deviceId)) {
          this.needsFreshStop.add(deviceId);
          if (!this.outstanding(deviceId) && !this.stopTasks.has(deviceId)) { this.needsFreshStop.delete(deviceId); void this.issueStop(deviceId); }
        }
        this.notify(); return;
      }
      if (!error && (!ack || ack.kind !== kind || ack.deviceId !== deviceId || ack.operationId !== frame.operationId || ack.generation !== frame.generation || (kind === "command" && ack.level !== frame.level) || (kind === "stop" && ack.level !== 0) || (kind === "connect" && ack.connected !== true))) error = new Error("Mismatched acknowledgement.");
      if(!error && vector && (!ack.levels || Array.isArray(ack.levels) || Object.keys(ack.levels).length!==Object.keys(vector).length || Object.keys(vector).some(id=>ack.levels[id]!==vector[id])))error=new Error("Mismatched movement acknowledgement.");
      this.event(error ? "request-failed" : "request-confirmed", {...frame,...(vector?{levels:{...vector}}:{})});
      finish(error, ack);
    };
    try { Promise.resolve(vector?this.transport.commandVector(frame,record.levels,record.ceilings,{signal:abort.signal}):this.transport[kind](frame, { signal: abort.signal })).then(ack => settle(null, ack), error => settle(error)); }
    catch (error) { settle(error); }
    return promise;
  }
  issueStop(deviceId) {
    if (!deviceId || this.disposed) return Promise.resolve(false);
    if (this.stopTasks.has(deviceId)) return this.stopTasks.get(deviceId);
    this.uncertain.add(deviceId); this.output = null;
    const settledAtDispatch = this.commandSettlements.get(deviceId) || 0;
    const task = this.request("stop", deviceId).then(() => {
      if (this.outstanding(deviceId)) return false;
      // Even when both replies settle in one microtask turn, an older command may
      // have applied after this Stop. A Stop dispatched BEFORE that settlement
      // cannot certify the final zero: issue a distinct post-settlement Stop.
      if (settledAtDispatch !== (this.commandSettlements.get(deviceId) || 0)) { this.needsFreshStop.add(deviceId); return false; }
      this.uncertain.delete(deviceId);
      this.needsFreshStop.delete(deviceId);
      if (!this.uncertain.size) {this.output = 0;this.outputLevels=this.feel.vector?Object.fromEntries(Object.keys(this.feel.channels).map(id=>[id,0])):null;}
      return true;
    }, () => { this.errorLatch = true; return false; }).finally(() => {
      this.stopTasks.delete(deviceId); this.notify();
      if (!this.disposed && this.needsFreshStop.has(deviceId) && !this.outstanding(deviceId)) { this.needsFreshStop.delete(deviceId); void this.issueStop(deviceId); }
    });
    this.stopTasks.set(deviceId, task);
    return task;
  }
  devices() { return this.transport.discover().map(value => ({ id: value.id, name: value.name, vibration: value.vibration === true })); }
  selectDevice(deviceId) {
    const device = this.transport.discover().find(value => value.id === deviceId && (value.vibration === true ||
      Array.isArray(value.capabilities) && value.capabilities.some(channel => ["vibrate", "rotate", "fingering", "thrusting", "oscillate"].includes(channel))));
    if (!device) { void this.pause("Choose a supported device."); throw new RangeError("Choose a device with an available movement."); }
    if (deviceId === this.selected) return this.notify();
    void this.disconnect("Selection changed. Connect the selected device explicitly.");
    this.selected = deviceId; this.output = this.uncertain.size ? null : 0;
    return this.notify();
  }
  clearSelection() { void this.disconnect("No device selected."); this.selected = null; return this.notify(); }
  async connect() {
    if (!this.selected || !this.visible || !this.authorized || this.disposed) { this.reason = "Choose an eligible device in an active, authorised tab."; this.notify(); return false; }
    const deviceId = this.selected, wasConnected = this.connected;
    const generation = this.invalidate(); this.connected = false; this.state = "CONNECTING"; this.reason = "Connecting the selected simulated device."; this.notify();
    try {
      // A different unresolved device must be made safe before switching. The selected
      // device may need its link re-established before a fresh Stop can be acknowledged.
      for (const target of this.uncertain) if (target !== deviceId && !await this.issueStop(target)) throw new Error("Unresolved output.");
      if (wasConnected) await this.issueStop(deviceId);
      if (generation !== this.generation) return false;
      await this.request("connect", deviceId);
      if (generation !== this.generation || !this.visible || !this.authorized) return false;
      this.connected = true;
      if (!await this.issueStop(deviceId)) throw new Error("A zero-output acknowledgement is required.");
      if (generation !== this.generation) return false;
      this.errorLatch = false; this.state = "READY_PAUSED"; this.reason = "Connected and paused. Confirm Start when ready."; this.notify(); return true;
    } catch {
      if (generation !== this.generation) return false;
      this.connected = false; this.errorLatch = true; this.state = "ERROR_PAUSED"; this.reason = "Connection failed, timed out or left output uncertain. Reset or reconnect explicitly.";
      this.notify(); return false;
    }
  }
  async pause(reason = "Paused. Confirm a new Start to continue.") {
    const generation = this.invalidate(), deviceId = this.selected;
    this.feel.reset();
    this.state = deviceId && (this.connected || this.uncertain.has(deviceId) || this.outstanding(deviceId)) ? "STOPPING" : "DISCONNECTED";
    this.reason = reason; this.notify();
    const targets = new Set([...this.uncertain, ...(deviceId && (this.connected || this.outstanding(deviceId)) ? [deviceId] : [])]);
    let stopped = true;
    for (const target of targets) if (!await this.issueStop(target)) stopped = false;
    if (generation !== this.generation || this.disposed) return false;
    if (!stopped || this.uncertain.size || this.errorLatch) {
      this.errorLatch = true; this.state = "ERROR_PAUSED";
      this.reason = this.uncertain.size ? "Output is unknown. Stop was not confirmed after all old commands. Reconnect or reset the fixture." : "Stopped, but an earlier transport error requires an explicit reconnect.";
    } else this.state = this.connected ? "READY_PAUSED" : "DISCONNECTED";
    this.notify(); return stopped && !this.uncertain.size;
  }
  stop() { return this.pause("Stopped. Confirm a new Start to continue."); }
  async disconnect(reason = "Disconnected. Reconnect explicitly.") {
    const deviceId = this.selected;
    if (deviceId && (this.connected || this.outstanding(deviceId))) { this.uncertain.add(deviceId); this.output = null; }
    this.connected = false;
    const pending = this.pause(reason), generation = this.generation;
    await pending;
    if (generation !== this.generation || this.disposed) return;
    if (deviceId) { try { await this.request("disconnect", deviceId); } catch { this.errorLatch = true; } }
    if (generation !== this.generation || this.disposed) return;
    this.state = this.errorLatch ? "ERROR_PAUSED" : "DISCONNECTED"; this.reason = reason; this.notify();
  }
  setStory(values, profiles) {
    let checked, sceneProfiles;
    try {
      if (!Array.isArray(values) || values.length > 2000) throw new RangeError("Use at most 2000 section levels.");
      checked = Array.from(values, level);
      sceneProfiles = normalizeSceneProfiles(profiles, checked.length);
    }
    catch (error) { void this.pause("Invalid mapping. Playback is paused."); throw error; }
    void this.pause("Story changed. Confirm a new Start.");
    this.levels = checked; this.sceneProfiles = sceneProfiles; this.manualZeros.clear(); this.position = 0; this.strengthTenths = 10; return this.notify();
  }
  changed() {
    ++this.revision; this.startIntent = null;
    const target = this.desired();
    const excessivePending = [...this.requests.values()].some(value => !value.rawSettled && value.frame.kind === "command" && (value.frame.level > target || this.vectorReduction(value.levels)));
    if (this.state === "PLAYING" && (excessivePending || this.vectorReduction(this.outputLevels) || (this.output !== null && this.output > target))) void this.reduce();
    return this.notify();
  }
  setPosition(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) { void this.pause("Invalid position."); throw new RangeError("Choose an existing section."); }
    this.position = index; return this.changed();
  }
  setLevel(index, value, {manual = true} = {}) {
    try { level(value); if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) throw new RangeError("Choose an existing section."); }
    catch (error) { void this.pause("Invalid section level."); throw error; }
    this.levels[index] = value;
    if(manual && value === 0)this.manualZeros.add(index);else this.manualZeros.delete(index);
    return this.changed();
  }
  setStrength(value) {
    if (!Number.isFinite(value) || value < 0 || value > 2 || Math.abs(Math.round(value * 10) - value * 10) > 1e-9) { void this.pause("Invalid session strength."); throw new RangeError("Use strength 0–2 in steps of 0.1."); }
    this.strengthTenths = Math.round(value * 10); return this.changed();
  }
  setCeiling(value) {
    try { level(value); if (value > this.ceiling) throw new RangeError("A higher ceiling needs confirmation."); }
    catch (error) { void this.pause("Review the ceiling before continuing."); throw error; }
    this.ceiling = value; return this.changed();
  }
  // Only the reader's deliberate inline maximum gesture uses this method.
  // The separate laboratory confirmation contract below is unchanged.
  setCeilingFromControl(value) {level(value);this.ceiling=value;return this.changed();}
  prepareCeiling(value) {
    level(value); void this.pause("Confirm the higher ceiling. Playback stays paused.");
    const intent = { value, expected: this.ceiling, generation: this.generation };
    this.ceilingIntent = intent; return Object.freeze(intent);
  }
  confirmCeiling(intent) {
    if (!intent || intent !== this.ceilingIntent || intent.expected !== this.ceiling || intent.generation !== this.generation) return false;
    this.ceilingIntent = null; this.ceiling = level(intent.value); this.changed(); return true;
  }
  prepareStart() {
    if (!this.connected || !this.selected || !this.visible || !this.authorized || !this.levels.length || this.errorLatch || this.uncertain.size || this.state !== "READY_PAUSED") return null;
    const intent = { generation: this.generation, revision: this.revision, deviceId: this.selected, ceiling: this.ceiling, strength: this.strengthTenths / 10, target: this.desired() };
    this.startIntent = intent; return Object.freeze(intent);
  }
  start(intent) {
    if (!intent || intent !== this.startIntent || intent.generation !== this.generation || intent.revision !== this.revision || this.state !== "READY_PAUSED" || !this.connected || !this.visible || !this.authorized || this.errorLatch || this.uncertain.size) return false;
    this.startIntent = null; this.feel.start(this.now()); this.state = "PLAYING"; this.lastActivity = this.lastTick = this.now(); this.reason = "Simulation is playing. Every nonzero request lasts two seconds.";
    this.armIdle(); this.tick(); return true;
  }
  async reduce() {
    const generation = this.invalidate(); this.state = "PLAYING"; this.reason = "Stopping the old level before applying a reduction.";
    if (!await this.issueStop(this.selected)) {
      if (generation === this.generation) { this.errorLatch = true; void this.pause("A reduction could not confirm Stop."); }
      return;
    }
    if (generation !== this.generation || this.state !== "PLAYING" || this.errorLatch || !this.visible || !this.authorized) return;
    // A confirmed Stop is a fresh zero-output boundary, not a stalled renewal.
    // Preserve the inactivity deadline and finite dispatch cadence separately.
    this.lastTick=this.now();this.armIdle(); this.schedule(); this.notify();
  }
  schedule() {
    if (this.state !== "PLAYING") return;
    const generation = this.generation;
    const waiting = this.outstanding(this.selected) || this.stopTasks.has(this.selected) || this.desired() === 0;
    this.tickTimer = this.setTimer(() => { if (generation === this.generation) this.tick(); }, waiting ? this.heartbeatMs : Math.max(1, this.heartbeatMs - (this.now() - this.lastDispatch)));
  }
  tick() {
    if (this.state !== "PLAYING") return;
    if (!this.visible || !this.authorized || this.now() - this.lastActivity >= this.inactivityMs || this.now() - this.lastTick >= 2000) { void this.pause("Playback was interrupted or idle. Confirm a new Start."); return; }
    this.lastTick = this.now();
    const excessivePending=[...this.requests.values()].some(value=>!value.rawSettled && value.frame.kind==="command" && this.vectorReduction(value.levels));
    if(excessivePending || this.vectorReduction(this.outputLevels) || this.output!==null && this.output>this.desired()){void this.reduce();return;}
    if (!this.outstanding(this.selected) && !this.stopTasks.has(this.selected) && !this.uncertain.size && this.now() - this.lastDispatch >= this.heartbeatMs && (this.desired() > 0 || this.feel.ramping)) {
      this.feel.advanceFollow?.(this.feel.vector?this.outputLevels:this.output,this.ceiling);
      const generation = this.generation, deviceId = this.selected, intent=this.intent(),target = intent.level;
      if(target===0){this.schedule();this.notify();return;}
      this.lastDispatch = this.now(); this.output = null;this.outputLevels=null;
      void this.request("command", deviceId, { level: target, durationMs: ASYNC_COMMAND_MS,...(intent.levels?{levels:intent.levels,ceilings:intent.ceilings}:{}) }).then(() => {
        if (generation !== this.generation || this.state !== "PLAYING") return;
        if (target > this.desired() || this.vectorReduction(intent.levels)) { void this.reduce(); return; }
        this.output = target;this.outputLevels=intent.levels?{...intent.levels}:null; this.notify();
      }, () => { if (generation === this.generation) { this.errorLatch = true; void this.pause("The command failed or timed out. Reconnect explicitly."); } });
    }
    this.schedule(); this.notify();
  }
  armIdle() {
    this.clearTimer(this.idleTimer); const generation = this.generation;
    if (this.state === "PLAYING") this.idleTimer = this.setTimer(() => { if (generation === this.generation) void this.pause("Paused after inactivity. Confirm a new Start."); }, Math.max(0, this.lastActivity + this.inactivityMs - this.now()));
  }
  activity() { this.lastActivity = this.now(); this.armIdle(); }
  setVisible(value) { this.visible = value === true; if (!this.visible) void this.pause("Tab hidden. Returning stays paused."); else this.notify(); }
  setAuthorized(value) { this.authorized = value === true; if (!this.authorized) void this.pause("Sign-in could not be checked. Playback stays paused."); else this.notify(); }
  destroy() { void this.pause("Simulation ended."); this.disposed = true; this.clearSchedules(); this.unsubscribe?.(); }
}
