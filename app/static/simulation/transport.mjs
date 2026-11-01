const DEFAULT_DEVICES = [
  { id: "sim-a", name: "Simulated vibration A", vibration: true },
  { id: "sim-b", name: "Simulated vibration B", vibration: true },
];
const fail = message => new Error(message);
/** No SDK, network, story data or physical hardware. All observable effects live on this clock. */
export class ScenarioTransport {
  constructor({ clock, options = {}, onEvent = () => {} }) {
    this.clock = clock; this.options = options; this.onEvent = onEvent;
    this.devices = (options.devices || DEFAULT_DEVICES).map(device => ({ ...device }));
    this.links = new Set(); this.outputs = new Map(); this.requests = []; this.events = [];
    this.counts = { connect: 0, command: 0, stop: 0, disconnect: 0 }; this.listeners = new Set(); this.disposed = false;
  }
  discover() { return this.devices.map(device => ({ ...device })); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(type, frame) {
    const event = { at: this.clock.now(), type, kind: frame.kind, deviceId: frame.deviceId, operationId: frame.operationId, generation: frame.generation, ...(frame.level === undefined ? {} : { level: frame.level }) };
    this.events.push(event); if (this.events.length > 200) this.events.shift();
    this.onEvent(event);
  }
  output(deviceId) {
    const value = this.outputs.get(deviceId);
    return value && this.clock.now() < value.expiresAt ? value.level : 0;
  }
  drop(deviceId) {
    this.links.delete(deviceId);
    for (const listener of this.listeners) listener({ type: "disconnect", deviceId });
  }
  connect(frame, options) { return this.perform("connect", frame, options); }
  command(frame, options) { return this.perform("command", frame, options); }
  stop(frame, options) { return this.perform("stop", frame, options); }
  disconnect(frame, options) { return this.perform("disconnect", frame, options); }
  perform(kind, frame, { signal } = {}) {
    if (this.disposed) return Promise.reject(fail("Simulation disposed."));
    if (!frame || frame.kind !== kind || !this.devices.some(device => device.id === frame.deviceId) || typeof frame.operationId !== "string" || !Number.isSafeInteger(frame.generation)) return Promise.reject(fail("An explicit device and request identity are required."));
    if (kind === "command" && (!this.devices.find(device => device.id === frame.deviceId)?.vibration || !Number.isInteger(frame.level) || frame.level < 1 || frame.level > 20 || frame.durationMs !== 2000)) return Promise.reject(fail("Commands require a supported target and a bounded two-second duration."));
    if (kind === "stop" && !this.links.has(frame.deviceId)) return Promise.reject(fail("Simulated Stop cannot be confirmed while disconnected."));
    const index = this.counts[kind]++;
    const behavior = { delay: 80, ...(this.options[kind] || {}), ...(this.options[kind + "Plan"]?.[index] || {}) };
    this.requests.push({ ...frame, at: this.clock.now() }); this.emit("requested", frame);
    return new Promise((resolve, reject) => {
      let done = false, applied = false;
      const timers = [];
      const finish = (error, value) => {
        if (done) return; done = true;
        for (const timer of timers) this.clock.clearTimer(timer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value);
      };
      const abort = () => {
        this.emit("cancel-requested", frame);
        if (!behavior.ignoreAbort) finish(fail("Simulation request cancelled."));
      };
      const apply = () => {
        if (done || this.disposed || behavior.reject || applied) return;
        applied = true;
        if (kind === "connect") this.links.add(frame.deviceId);
        if (kind === "disconnect") this.links.delete(frame.deviceId);
        if (kind === "stop" || kind === "disconnect") this.outputs.set(frame.deviceId, { level: 0, expiresAt: this.clock.now() });
        if (kind === "command") {
          if (!this.links.has(frame.deviceId)) { finish(fail("Simulated connection lost.")); return; }
          this.outputs.set(frame.deviceId, { level: frame.level, expiresAt: this.clock.now() + frame.durationMs });
          if (this.options.disconnectAfterCommand !== undefined && index === 0) this.clock.setTimer(() => { if (!this.disposed) this.drop(frame.deviceId); }, this.options.disconnectAfterCommand);
        }
        this.emit("applied", frame);
      };
      if (signal?.aborted && !behavior.ignoreAbort) { finish(fail("Simulation request cancelled.")); return; }
      signal?.addEventListener("abort", abort, { once: true });
      timers.push(this.clock.setTimer(apply, behavior.applyDelay ?? 0));
      if (!behavior.never) timers.push(this.clock.setTimer(() => {
        if (this.disposed) { finish(fail("Simulation disposed.")); return; }
        if (behavior.reject) { this.emit("rejected", frame); finish(fail("Simulated transport failure.")); return; }
        apply();
        if (done) return;
        this.emit("acknowledged", frame);
        finish(null, { kind, deviceId: frame.deviceId, operationId: behavior.wrongId ? "old-request" : frame.operationId,
          generation: frame.generation, level: kind === "command" ? frame.level : 0, connected: kind !== "disconnect" });
      }, Math.max(behavior.delay, behavior.applyDelay ?? 0)));
    });
  }
  dispose() { this.disposed = true; this.listeners.clear(); this.links.clear(); this.outputs.clear(); }
}
