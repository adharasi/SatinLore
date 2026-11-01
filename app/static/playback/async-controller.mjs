/** Experimental async contract for the deterministic lab only; not a qualified hardware adapter. */
export const ASYNC_COMMAND_MS = 2000;
const level = value => {
  if (!Number.isInteger(value) || value < 0 || value > 20) throw new RangeError("Use a whole-number level from 0 to 20.");
  return value;
};

export class AsyncPlaybackController {
  constructor({ transport, now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), onChange = () => {}, onEvent = () => {}, connectTimeout = 3000, requestTimeout = 1800, inactivityMs = 120000 }) {
    if (!transport || !["discover", "connect", "command", "stop", "disconnect"].every(key => typeof transport[key] === "function")) throw new TypeError("A targeted asynchronous transport is required.");
    if (![connectTimeout, requestTimeout, inactivityMs].every(value => Number.isFinite(value) && value > 0) || requestTimeout >= ASYNC_COMMAND_MS) throw new RangeError("Use positive timeouts; command acknowledgement must be bounded below two seconds.");
    Object.assign(this, { transport, now, setTimer, clearTimer, onChange, onEvent, connectTimeout, requestTimeout, inactivityMs });
    this.state = "DISCONNECTED"; this.connected = false; this.selected = null; this.visible = true; this.authorized = true;
    this.levels = []; this.position = 0; this.ceiling = 5; this.strengthTenths = 10; this.output = 0;
    this.generation = 0; this.sequence = 0; this.revision = 0; this.staleReplies = 0; this.reason = "Choose a simulated device explicitly.";
    this.requests = new Map(); this.stopTasks = new Map(); this.uncertain = new Set(); this.errorLatch = false;
    this.commandSettlements = new Map(); this.needsFreshStop = new Set();
    this.tickTimer = null; this.idleTimer = null; this.lastDispatch = -Infinity; this.lastTick = 0; this.lastActivity = 0; this.disposed = false;
    this.unsubscribe = transport.subscribe?.(event => { if (event.type === "disconnect" && event.deviceId === this.selected) { this.uncertain.add(event.deviceId); this.output = null; this.connected = false; void this.pause("Connection lost. Reconnect, then confirm a new Start."); } });
  }
  snapshot() {
    return { state: this.state, running: this.state === "PLAYING", connected: this.connected, selectedDeviceId: this.selected,
      canStart: this.state === "READY_PAUSED" && this.connected && !!this.selected && this.visible && this.authorized && !!this.levels.length && !this.errorLatch && !this.uncertain.size,
      output: this.output, outputKnown: this.output !== null, target: this.desired(), ceiling: this.ceiling, strength: this.strengthTenths / 10,
      position: this.position, generation: this.generation, staleReplies: this.staleReplies, uncertainTargets: [...this.uncertain],
      pending: [...this.requests.values()].filter(value => !value.rawSettled).map(value => ({ ...value.frame })), reason: this.reason };
  }
  desired() { return Math.min(this.ceiling, Math.floor((this.levels[this.position] ?? 0) * this.strengthTenths / 10)); }
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
    const frame = { kind, deviceId, operationId: `request-${++this.sequence}`, generation: this.generation,
      ...(kind === "command" ? { level: extra.level, durationMs: ASYNC_COMMAND_MS } : {}) };
    const abort = new AbortController();
    let resolveBounded, rejectBounded;
    const promise = new Promise((resolve, reject) => { resolveBounded = resolve; rejectBounded = reject; });
    const record = { frame, rawSettled: false, finished: false, cancel: null };
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
      this.event(error ? "request-failed" : "request-confirmed", frame);
      finish(error, ack);
    };
    try { Promise.resolve(this.transport[kind](frame, { signal: abort.signal })).then(ack => settle(null, ack), error => settle(error)); }
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
      if (!this.uncertain.size) this.output = 0;
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
    const device = this.devices().find(value => value.id === deviceId && value.vibration);
    if (!device) { void this.pause("Choose a supported simulated device."); throw new RangeError("Choose a device with vibration capability."); }
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
  setStory(values) {
    let checked;
    try { if (!Array.isArray(values) || values.length > 2000) throw new RangeError("Use at most 2000 section levels."); checked = Array.from(values, level); }
    catch (error) { void this.pause("Invalid mapping. Playback is paused."); throw error; }
    void this.pause("Story changed. Confirm a new Start.");
    this.levels = checked; this.position = 0; this.strengthTenths = 10; return this.notify();
  }
  changed() {
    ++this.revision; this.startIntent = null;
    const target = this.desired();
    const excessivePending = [...this.requests.values()].some(value => !value.rawSettled && value.frame.kind === "command" && value.frame.level > target);
    if (this.state === "PLAYING" && (excessivePending || (this.output !== null && this.output > target))) void this.reduce();
    return this.notify();
  }
  setPosition(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) { void this.pause("Invalid position."); throw new RangeError("Choose an existing section."); }
    this.position = index; return this.changed();
  }
  setLevel(index, value) {
    try { level(value); if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) throw new RangeError("Choose an existing section."); }
    catch (error) { void this.pause("Invalid section level."); throw error; }
    this.levels[index] = value; return this.changed();
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
    this.startIntent = null; this.state = "PLAYING"; this.lastActivity = this.lastTick = this.now(); this.reason = "Simulation is playing. Every nonzero request lasts two seconds.";
    this.armIdle(); this.tick(); return true;
  }
  async reduce() {
    const generation = this.invalidate(); this.state = "PLAYING"; this.reason = "Stopping the old level before applying a reduction.";
    if (!await this.issueStop(this.selected)) {
      if (generation === this.generation) { this.errorLatch = true; void this.pause("A reduction could not confirm Stop."); }
      return;
    }
    if (generation !== this.generation || this.state !== "PLAYING" || this.errorLatch || !this.visible || !this.authorized) return;
    this.armIdle(); this.schedule(); this.notify();
  }
  schedule() {
    if (this.state !== "PLAYING") return;
    const generation = this.generation;
    const waiting = this.outstanding(this.selected) || this.stopTasks.has(this.selected) || this.desired() === 0;
    this.tickTimer = this.setTimer(() => { if (generation === this.generation) this.tick(); }, waiting ? 1000 : Math.max(1, 1000 - (this.now() - this.lastDispatch)));
  }
  tick() {
    if (this.state !== "PLAYING") return;
    if (!this.visible || !this.authorized || this.now() - this.lastActivity >= this.inactivityMs || this.now() - this.lastTick >= 2000) { void this.pause("Playback was interrupted or idle. Confirm a new Start."); return; }
    this.lastTick = this.now();
    if (!this.outstanding(this.selected) && !this.stopTasks.has(this.selected) && !this.uncertain.size && this.now() - this.lastDispatch >= 1000 && this.desired() > 0) {
      const generation = this.generation, deviceId = this.selected, target = this.desired();
      this.lastDispatch = this.now(); this.output = null;
      void this.request("command", deviceId, { level: target, durationMs: ASYNC_COMMAND_MS }).then(() => {
        if (generation !== this.generation || this.state !== "PLAYING") return;
        if (target > this.desired()) { void this.reduce(); return; }
        this.output = target; this.notify();
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
