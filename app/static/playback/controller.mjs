// Continuous reading playback for the synchronous simulator only.
// A real asynchronous transport needs a separately qualified controller/adapter.
export const COMMAND_SECONDS = 2;
export const MIN_STRENGTH = 0;
export const MAX_STRENGTH = 2;
export const STRENGTH_STEP = 0.1;

function validLevel(value) {
  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new RangeError("Choose a whole-number intensity between 0 and 20.");
  }
  return value;
}

function strengthTenths(value) {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      value < MIN_STRENGTH || value > MAX_STRENGTH) {
    throw new RangeError("Choose a strength from 0.0× to 2.0× in steps of 0.1×.");
  }
  const tenths = Math.round(value * 10);
  if (Math.abs(value * 10 - tenths) > 1e-9) {
    throw new RangeError("Choose a strength from 0.0× to 2.0× in steps of 0.1×.");
  }
  return tenths;
}

export class PlaybackController {
  constructor({device, onChange = () => {}, now = () => performance.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer), inactivityMs = 120_000, heartbeatMs = 1000}) {
    if (!device || !["connect", "disconnect", "command", "stop", "snapshot"].every(name => typeof device[name] === "function")) {
      throw new TypeError("A synchronous simulator adapter is required.");
    }
    if (!Number.isFinite(inactivityMs) || inactivityMs <= 0 ||
        !Number.isFinite(heartbeatMs) || heartbeatMs < 1000 || heartbeatMs >= 2000) {
      throw new RangeError("Use a positive inactivity timeout and a 1000–1999 ms heartbeat.");
    }
    this.device = device;
    this.onChange = onChange;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.inactivityMs = inactivityMs;
    this.heartbeatMs = heartbeatMs;
    this.levels = [];
    this.position = 0;
    this.ceiling = 5;
    this.strengthTenths = 10;
    this.connected = false;
    this.visible = true;
    this.output = 0;
    this.state = "DISCONNECTED";
    this.reason = "Connect the simulator to begin.";
    this.epoch = 0;
    this.tickTimer = null;
    this.idleTimer = null;
    this.lastActivityAt = 0;
    this.lastTickAt = 0;
    this.lastDispatchAt = -Infinity;
  }

  snapshot() {
    return {state: this.state, connected: this.connected, running: this.state === "PLAYING",
      output: this.output, ceiling: this.ceiling, strength: this.strengthTenths / 10,
      baseLevel: this.levels[this.position] ?? 0, target: this._desired(),
      position: this.position, reason: this.reason};
  }

  _invoke(method, ...arguments_) {
    const result = this.device[method](...arguments_);
    if (result && typeof result.then === "function") {
      // Do not attach a continuation that could resume or dispatch another command.
      Promise.resolve(result).catch(() => {});
      throw new TypeError("Asynchronous adapters are not supported by this simulator controller.");
    }
    return result;
  }

  _notify() {
    try { this.onChange(this.snapshot()); }
    catch { this._halt("The interface could not update. Reconnect the simulator.", "ERROR_PAUSED", false); }
    return this.snapshot();
  }

  _clearTimers() {
    ++this.epoch;
    if (this.tickTimer !== null) this.clearTimer(this.tickTimer);
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    this.tickTimer = this.idleTimer = null;
  }

  _stopDevice() {
    this.output = 0;
    try { this._invoke("stop"); return true; }
    catch { return false; }
  }

  _halt(reason, state = this.connected ? "READY_PAUSED" : "DISCONNECTED", notify = true) {
    this._clearTimers();
    this.state = state;
    this.reason = reason;
    if (!this._stopDevice()) {
      this.state = "ERROR_PAUSED";
      this.reason = "Simulator Stop failed. Reconnect before continuing.";
    }
    return notify ? this._notify() : this.snapshot();
  }

  _fail() {
    return this._halt("The simulator request failed. Reconnect before continuing.", "ERROR_PAUSED");
  }

  connect() {
    this._halt("Connecting simulator.", "DISCONNECTED", false);
    this.connected = false;
    try {
      this._invoke("connect");
      if (this._invoke("snapshot")?.connected !== true) throw new Error();
      this.connected = true;
      this.state = "READY_PAUSED";
      this.reason = "Simulator connected. Press Start when ready.";
      this._notify();
      return this.state === "READY_PAUSED";
    } catch { this._fail(); return false; }
  }

  disconnect() {
    this._halt("Simulator disconnected.", "DISCONNECTED", false);
    this.connected = false;
    try { this._invoke("disconnect"); }
    catch { this.state = "ERROR_PAUSED"; this.reason = "The simulator could not disconnect cleanly."; }
    return this._notify();
  }

  setStory(levels) {
    this.pause("Story changed. Press Start to continue.");
    if (!Array.isArray(levels)) throw new TypeError("Paragraph levels must be an array.");
    const checked = levels.map(validLevel);
    this.levels = checked;
    this.position = 0;
    this.strengthTenths = 10;
    if (!checked.length && this.state !== "ERROR_PAUSED") this.reason = "Load text to begin.";
    return this._notify();
  }

  _position(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) {
      this.pause("The requested paragraph is unavailable.");
      throw new RangeError("Choose an existing paragraph.");
    }
    return index;
  }

  setPosition(index) {
    this.position = this._position(index);
    return this._desiredChanged();
  }

  setLevel(index, value) {
    this._position(index);
    try { validLevel(value); }
    catch (error) { this.pause("Invalid paragraph intensity."); throw error; }
    this.levels[index] = value;
    return this._desiredChanged();
  }

  updateLevels(levels) {
    let checked;
    try {
      if (!Array.isArray(levels)) throw new TypeError("Paragraph levels must be an array.");
      if (levels.length !== this.levels.length) throw new RangeError("Use the current story's paragraph mapping.");
      // Array.from visits missing elements too, so a sparse array cannot bypass validation.
      checked = Array.from(levels, validLevel);
    } catch (error) {
      this.pause("Invalid paragraph mapping.");
      throw error;
    }
    // Commit the complete mapping once. Background analysis must not reset the
    // reading position, session strength, ceiling or explicit playback state.
    this.levels = checked;
    return this._desiredChanged();
  }

  setCeiling(value) {
    try { validLevel(value); }
    catch (error) { this.pause("Invalid intensity ceiling."); throw error; }
    if (value > this.ceiling) {
      this.pause("Confirm a higher maximum before applying it.");
      throw new RangeError("Raising the maximum requires explicit confirmation.");
    }
    this.ceiling = value;
    return this._desiredChanged();
  }

  // Called only by the owner's deliberate confirmation action. Requiring the
  // previously displayed ceiling prevents a stale dialog from undoing a reduction.
  confirmCeiling(value, expectedCeiling) {
    try { validLevel(value); validLevel(expectedCeiling); }
    catch (error) { this.pause("Invalid intensity ceiling confirmation."); throw error; }
    if (expectedCeiling !== this.ceiling) {
      this.pause("The maximum changed. Review it before confirming again.");
      return false;
    }
    this.ceiling = value;
    this._desiredChanged();
    return true;
  }

  setStrength(value) {
    let tenths;
    try { tenths = strengthTenths(value); }
    catch (error) { this.pause("Invalid session strength."); throw error; }
    this.strengthTenths = tenths;
    return this._desiredChanged();
  }

  _desiredChanged() {
    // Reductions never wait behind the next dispatch. Resume only on its normal cadence.
    if (this.state === "PLAYING" && this._desired() < this.output && !this._stopDevice()) return this._fail();
    return this._notify();
  }

  _desired() {
    // Integer tenths avoid hidden floating-point steps. Round down on the device
    // scale so rounding never increases a chosen strength. Never rewrite the base.
    const scaled = Math.floor((this.levels[this.position] ?? 0) * this.strengthTenths / 10);
    return Math.min(scaled, this.ceiling);
  }

  start() {
    if (this.state === "PLAYING") return true;
    if (!this.connected || !this.levels.length || !this.visible || this.state === "ERROR_PAUSED") {
      this.reason = !this.connected ? "Connect the simulator first." : !this.levels.length ? "Load text first." :
        !this.visible ? "Return to this tab before pressing Start." : "Reconnect the simulator before starting again.";
      this._notify();
      return false;
    }
    this._clearTimers();
    this.state = "PLAYING";
    this.reason = "Simulation follows the current paragraph.";
    this.lastActivityAt = this.lastTickAt = this.now();
    this._armIdle();
    const remaining = this.heartbeatMs - (this.now() - this.lastDispatchAt);
    if (remaining <= 0) this._tick();
    else { this._scheduleTick(remaining); this._notify(); }
    return this.state === "PLAYING";
  }

  _scheduleTick(delay = this.heartbeatMs) {
    if (this.state !== "PLAYING") return;
    const epoch = this.epoch;
    this.tickTimer = this.setTimer(() => {
      if (epoch !== this.epoch || this.state !== "PLAYING") return;
      this.tickTimer = null;
      this._tick();
    }, delay);
  }

  _armIdle() {
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    if (this.state !== "PLAYING") return;
    const epoch = this.epoch;
    const deadline = this.lastActivityAt + this.inactivityMs;
    this.idleTimer = this.setTimer(() => {
      if (epoch !== this.epoch || this.state !== "PLAYING" || deadline !== this.lastActivityAt + this.inactivityMs) return;
      this.idleTimer = null;
      this.pause("Paused after two minutes without reading activity. Press Start to continue.");
    }, Math.max(0, deadline - this.now()));
  }

  _tick() {
    if (this.state !== "PLAYING") return;
    const now = this.now();
    if (!this.visible) { this.pause("Paused when this tab became hidden. Press Start to continue."); return; }
    if (now - this.lastActivityAt >= this.inactivityMs) { this.pause("Paused after inactivity. Press Start to continue."); return; }
    if (now - this.lastTickAt >= COMMAND_SECONDS * 1000) {
      this.pause("Playback timing was interrupted. Press Start to continue.");
      return;
    }
    this.lastTickAt = now;
    try {
      if (this._invoke("snapshot")?.connected !== true) {
        this.connected = false;
        this._halt("Simulator disconnected. Reconnect explicitly.", "DISCONNECTED");
        return;
      }
      const strength = this._desired();
      if (strength === 0) {
        if (!this._stopDevice()) throw new Error();
      } else if (now - this.lastDispatchAt >= this.heartbeatMs) {
        this._invoke("command", strength, COMMAND_SECONDS);
        this.lastDispatchAt = now;
        this.output = strength;
      }
      this._notify();
      this._scheduleTick();
    } catch { this._fail(); }
  }

  pause(reason = "Paused. Press Start to continue.") {
    if (this.state === "ERROR_PAUSED") {
      return this._halt("Reconnect the simulator before continuing.", "ERROR_PAUSED");
    }
    return this._halt(reason);
  }

  activity() {
    this.lastActivityAt = this.now();
    this._armIdle();
  }

  setVisible(visible) {
    this.visible = visible === true;
    if (!this.visible) return this.pause("Paused when this tab became hidden. Press Start to continue.");
    return this._notify();
  }
}
