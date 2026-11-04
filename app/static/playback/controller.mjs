import {DEFAULT_SIMULATOR_MAXIMUM, normalizeSceneProfiles, ReadingFeel, scenePatternChanged, sceneStagePatternLabel, stepSectionLevel} from "../reader/calibration.mjs";
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
  constructor({device, onChange = () => {}, onInterfaceError = () => {}, getMovement = () => undefined, now = () => performance.now(),
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
    this.onInterfaceError = onInterfaceError;
    this.getMovement = getMovement;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.inactivityMs = inactivityMs;
    this.heartbeatMs = heartbeatMs;
    this.feel = new ReadingFeel(); this.manualZeros = new Set();
    this.levels = [];
    this.sceneProfiles = [];
    this.position = 0;
    this.ceiling = DEFAULT_SIMULATOR_MAXIMUM;
    this.strengthTenths = 10;
    this.levelAdjustment = 0;
    this.readingSeeking = false;
    this.connected = false;
    this.visible = true;
    this.output = 0; this.outputLevels = null;
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
    const now = this.now();
    const target = this._intent(this.levelAdjustment, now).level;
    return {state: this.state, connected: this.connected, running: this.state === "PLAYING",
      output: this.output, ceiling: this.ceiling, strength: this.strengthTenths / 10,
      levelAdjustment: this.levelAdjustment, levelDown: target > 0 && this._intent(-20, now).level < target,
      levelUp: target < this.ceiling && this._intent(20, now).level > target,
      baseLevel: this.levels[this.position] ?? 0, target, outputLevels:this.outputLevels?{...this.outputLevels}:null,
      position: this.position, readingSeeking: this.readingSeeking, reason: this.reason, feel: this.feel.snapshot()};
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
    catch {
      this._halt("The interface could not update. Reconnect the simulator.", "ERROR_PAUSED", false);
      // A separate minimal recovery surface must not recursively call the broken
      // renderer. Never expose the exception or any story text to that surface.
      try { this.onInterfaceError(this.snapshot()); } catch { /* Output is already stopped. */ }
    }
    return this.snapshot();
  }

  _clearTimers() {
    ++this.epoch;
    if (this.tickTimer !== null) this.clearTimer(this.tickTimer);
    if (this.idleTimer !== null) this.clearTimer(this.idleTimer);
    this.tickTimer = this.idleTimer = null;
  }

  _stopDevice() {
    this.output = 0;this.outputLevels=this.feel.vector?Object.fromEntries(Object.keys(this.feel.channels).map(id=>[id,0])):null;
    try { this._invoke("stop"); return true; }
    catch { return false; }
  }

  _halt(reason, state = this.connected ? "READY_PAUSED" : "DISCONNECTED", notify = true) {
    this._clearTimers();
    this.feel.reset();
    this.readingSeeking = false;
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

  setStory(levels, profiles) {
    this.pause("Story changed. Press Start to continue.");
    if (!Array.isArray(levels)) throw new TypeError("Paragraph levels must be an array.");
    const checked = Array.from(levels,validLevel);
    this.sceneProfiles = normalizeSceneProfiles(profiles, checked.length);
    this.levels = checked;
    this.manualZeros.clear();
    this.position = 0;
    this.strengthTenths = 10;
    this.levelAdjustment = 0;
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
    const next = this._position(index);
    if (next !== this.position) {
      this.levelAdjustment = 0;
      if (this.state === "PLAYING" && !this.readingSeeking && (scenePatternChanged(this.sceneProfiles[this.position], this.sceneProfiles[next], this.feel.automaticMovement, true) ||
          this.sceneProfiles[next]?.phase && this.levels[this.position] !== this.levels[next])) {
        this.feel.reanchor(this.now(), this.feel.vector ? this.outputLevels : this.output);
      }
    }
    this.position = next;
    return this._desiredChanged();
  }

  setReadingSeeking(active) {
    const seeking = active === true && this.state === "PLAYING";
    if (seeking === this.readingSeeking) return this.snapshot();
    this.readingSeeking = seeking;
    if (seeking) this.seekStartPosition = this.position;
    else if (this.state === "PLAYING") {
      const profile = this.sceneProfiles[this.position];
      const sameStage = this.position === this.seekStartPosition && !profile?.manual && !!sceneStagePatternLabel(profile?.phase);
      this.feel.reanchor(this.now(), undefined, sameStage, !!profile?.peakPreset);
    }
    return this._desiredChanged();
  }

  setLevel(index, value, {manual = true} = {}) {
    this._position(index);
    try { validLevel(value); }
    catch (error) { this.pause("Invalid paragraph intensity."); throw error; }
    this.levels[index] = value;
    if (this.sceneProfiles[index]?.phase) this.sceneProfiles[index].manual = manual;
    if (index === this.position) this.levelAdjustment = 0;
    if (manual && value === 0) this.manualZeros.add(index); else this.manualZeros.delete(index);
    return this._desiredChanged();
  }

  updateLevels(levels, profiles) {
    let checked, sceneProfiles;
    try {
      if (!Array.isArray(levels)) throw new TypeError("Paragraph levels must be an array.");
      if (levels.length !== this.levels.length) throw new RangeError("Use the current story's paragraph mapping.");
      // Array.from visits missing elements too, so a sparse array cannot bypass validation.
      checked = Array.from(levels, validLevel);
      sceneProfiles = normalizeSceneProfiles(profiles, checked.length);
    } catch (error) {
      this.pause("Invalid paragraph mapping.");
      throw error;
    }
    this.sceneProfiles = sceneProfiles;
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

  // The reader's synchronous simulator accepts a deliberate range-control change
  // without opening another dialog. This never connects or starts a session;
  // while playing, increases wait for the existing bounded dispatch cadence.
  // Do not reuse this simulator-only policy in a physical transport adapter.
  setCeilingFromControl(value) {
    try { validLevel(value); }
    catch (error) { this.pause("Invalid intensity ceiling."); throw error; }
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

  adjustLevel(direction) {
    if (!this.levels.length) return this.snapshot();
    const now = this.now();
    this.levelAdjustment = stepSectionLevel(this.levelAdjustment, direction, offset => this._intent(offset, now).level);
    return this._desiredChanged();
  }

  _desiredChanged() {
    // Reductions never wait behind the next dispatch. Resume only on its normal cadence.
    const intent=this._intent();
    const reduced=this.outputLevels&&intent.levels&&Object.keys(this.outputLevels).some(id=>this.outputLevels[id]>(intent.levels[id]??0));
    if (this.state === "PLAYING" && (intent.level < this.output || reduced) && !this._stopDevice()) return this._fail();
    return this._notify();
  }

  _intent(levelAdjustment = this.levelAdjustment, now = this.now()) {
    const context={base:this.levels[this.position] ?? 0,strength:this.strengthTenths / 10,
      ceiling:this.ceiling,manualZero:this.readingSeeking || this.manualZeros.has(this.position),scene:this.sceneProfiles[this.position],
      movement:this.getMovement(),levelAdjustment,now,simulatorStagePatterns:true,preview:this.state !== "PLAYING"};
    const levels=this.feel.vector?.(context);
    return levels?{level:Math.max(0,...Object.values(levels)),levels,ceilings:this.feel.ceilings(this.ceiling)}:{level:this.feel.desired(context)};
  }
  _desired() {return this._intent().level;}

  setFeel(value) {
    try {this.feel.configure(value);} catch(error) {this.pause("Invalid reading controls.");throw error;}
    return this._desiredChanged();
  }
  hold(value = this.output) {
    if(this.state !== "PLAYING") return false;
    try{if(this.feel.holdLevels && arguments.length===0)this.feel.holdLevels(this.outputLevels);else this.feel.hold(value);}catch(error){this.pause("Invalid Hold level.");throw error;}this._desiredChanged();return true;
  }
  holdChannels(value) {
    if(this.state!=="PLAYING" || !this.feel.holdLevels)return false;
    try{this.feel.holdLevels(value);}catch(error){this.pause("Invalid movement levels.");throw error;}
    this._desiredChanged();return true;
  }
  easeOff(value = this.feel.settings.recovery) {
    if(this.state !== "PLAYING") return false;
    try{if(this.feel.easeOffLevels)this.feel.easeOffLevels(this.outputLevels,arguments.length?value:undefined);else this.feel.easeOff(value,Math.min(this.output,this._desired()));}catch(error){this.pause("Invalid recovery level.");throw error;}this._desiredChanged();return true;
  }
  followStory() {this.feel.followStory(this.state==="PLAYING"?(this.feel.vector?this.outputLevels:this.output):undefined);return this._desiredChanged();}
  setManualZeros(indices) {
    if(!Array.isArray(indices) || indices.some(index => !Number.isInteger(index) || index<0 || index>=this.levels.length)) {this.pause("Invalid paragraph corrections.");throw new RangeError("Use existing paragraph indices.");}
    this.manualZeros=new Set(indices);return this._desiredChanged();
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
    this.feel.start(this.now());
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
      if(now-this.lastDispatchAt>=this.heartbeatMs)this.feel.advanceFollow?.(this.feel.vector?this.outputLevels:this.output,this.ceiling);
      const intent=this._intent(),strength = intent.level;
      if (strength === 0) {
        if (!this._stopDevice()) throw new Error();
      } else if (now - this.lastDispatchAt >= this.heartbeatMs) {
        if(intent.levels)this._invoke("commandVector",intent.levels,COMMAND_SECONDS);else this._invoke("command", strength, COMMAND_SECONDS);
        this.outputLevels=intent.levels?{...intent.levels}:null;
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
