import {supportedToys} from "./toy-profiles.mjs";
export {supportedToys} from "./toy-profiles.mjs";

// Bounded SDK requests, not physical-device acknowledgements. The same adapter
// serves the isolated connection check and finite, explicitly armed reader loop.
export const TEST_SECONDS = 2;
export const MAX_TEST_LEVEL = 5;
export const COMMAND_ACK_TIMEOUT_MS = 1500;
const submittedResult = result => result !== false && (!result || typeof result !== "object" ||
  (result.result !== false && result.success !== false && (!("code" in result) || [0, 200, "0", "200"].includes(result.code))));
const stopResult = result => ({status: submittedResult(result) ? "submitted" : "unconfirmed"});

export function safeQrUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const allowed = ["lovense-api.com", "lovense.com"].some(domain =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed ? url.href : null;
  } catch { return null; }
}

export class LovenseCheck {
  constructor({sdkFactory, emit, now = Date.now,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer)}) {
    this.sdkFactory = sdkFactory;
    this.emit = emit;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.sdk = null;
    this.generation = 0;
    this.timers = new Set();
    this.ready = false;
    this.connected = false;
    this.selected = null;
    this.toys = [];
    this.expiresAt = 0;
    this.lastPulseAt = -Infinity;
    this.lastCommandAt = -Infinity;
    this.commandEpoch = 0;
    this.commandTimer = null;
    this.pendingCommand = null;
    this.knownIds = new Set();
    this.activeChannel = null;
  }

  later(callback, delay) {
    const generation = this.generation;
    const timer = this.setTimer(() => {
      this.timers.delete(timer);
      if (generation === this.generation) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
    return timer;
  }

  active(generation = this.generation) {
    return generation === this.generation && this.sdk !== null && this.now() < this.expiresAt;
  }

  connect(session) {
    this.disconnect();
    if (!session || typeof session.uid !== "string" || !session.uid || session.uid.length > 128 ||
        typeof session.platform !== "string" || !session.platform || session.platform.length > 256 ||
        typeof session.authToken !== "string" || !session.authToken || session.authToken.length > 16384 ||
        !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= this.now()) {
      throw new Error("The connection session is invalid or expired.");
    }
    this.expiresAt = session.expires_at * 1000;
    this.lastPulseAt = -Infinity;
    this.lastCommandAt = -Infinity;
    const generation = this.generation;
    try {
      const sdk = this.sdkFactory({uid: session.uid, platform: session.platform,
        authToken: session.authToken, appType: "remote", debug: false});
      this.sdk = sdk;
      const guarded = callback => (...args) => {
        if (!this.active(generation)) return;
        try { callback(...args); } catch { this.fail(); }
      };
      sdk.on("ready", guarded(() => {
        this.ready = true;
        this.refresh();
        Promise.resolve(sdk.getQrcode()).then(result => {
          if (!this.active(generation)) return;
          const url = safeQrUrl(result?.qrcodeUrl);
          if (url) this.emit({type: "qr", url});
          else this.fail("The pairing code could not be loaded. Disconnect and try again.");
        }).catch(() => { if (this.active(generation)) this.fail(); });
      }));
      sdk.on("sdkError", guarded(() => this.fail()));
      sdk.on("appStatusChange", guarded(status => {
        if (status !== true) this.connectionLost();
        else this.refresh();
      }));
      sdk.on("toyInfoChange", guarded(() => this.refresh()));
      sdk.on("toyOnlineChange", guarded(status => {
        if (status !== true) this.connectionLost();
        else this.refresh();
      }));
      this.emit({type: "state", state: "connecting"});
      this.later(() => this.disconnect("Session expired. Sign in again before connecting."),
        Math.min(this.expiresAt - this.now(), 2_147_483_647));
    } catch {
      this.disconnect();
      throw new Error("The device connection could not be started.");
    }
  }

  refresh() {
    if (!this.active() || !this.ready) return;
    const connected = this.sdk.getAppStatus() === true;
    if (!connected) { this.connectionLost(); return; }
    this.connected = true;
    const toys = supportedToys(this.sdk.getOnlineToys());
    if (this.selected && !toys.some(toy => toy.id === this.selected && (!this.activeChannel || toy.capabilities.includes(this.activeChannel)))) this.stop(true);
    this.toys = toys;
    for (const toy of toys) if (this.knownIds.size < 50) this.knownIds.add(toy.id);
    this.emit({type: "toys", toys, selected: this.selected});
    this.emit({type: "state", state: this.commandTimer !== null ? "testing" : "paused"});
  }

  connectionLost() {
    this.stop(true);
    this.connected = false;
    this.toys = [];
    this.emit({type: "toys", toys: [], selected: null});
    this.emit({type: "state", state: "waiting"});
  }

  select(id) {
    this.stop(true);
    if (!this.active() || !this.ready || !this.connected || typeof id !== "string" ||
        !this.toys.some(toy => toy.id === id)) throw new Error("Select one connected supported toy.");
    this.selected = id;
    this.emit({type: "selected", id});
  }

  validateOutput(level, ceiling, channel, seconds) {
    if (!this.active() || !this.ready || !this.connected || !this.selected) {
      throw new Error("Connect and select one device before testing.");
    }
    if (!Number.isInteger(level) || !Number.isInteger(ceiling) || level < 0 || level > MAX_TEST_LEVEL ||
        ceiling < 0 || ceiling > MAX_TEST_LEVEL || !Number.isFinite(seconds) || seconds <= 1 || seconds > TEST_SECONDS) {
      throw new Error("Choose an output from 0 to 5 and a finite duration of at most two seconds.");
    }
    // Re-read current state: a stale list must never authorise a disconnected toy.
    const toys = supportedToys(this.sdk.getOnlineToys());
    const toy = toys.find(toy => toy.id === this.selected);
    if (this.sdk.getAppStatus() !== true || !toy) {
      this.connectionLost();
      throw new Error("The selected device is disconnected.");
    }
    if (typeof channel !== "string" || !toy.capabilities.includes(channel)) throw new Error("That movement is not available on the selected connection.");
    return toy;
  }

  command(level, ceiling, {channel = "vibrate", seconds = TEST_SECONDS} = {}) {
    this.validateOutput(level, ceiling, channel, seconds);
    const strength = Math.min(level, ceiling);
    if (strength === 0) return this.stop().then(result => ({...result, level: 0, channel}));
    if (this.pendingCommand) throw new Error("Wait for the current device request or reconnect.");
    if (this.now() - this.lastCommandAt < 1000) throw new Error("Device requests are limited to one per second.");
    this.cancelCommandTimer();
    const epoch = ++this.commandEpoch, generation = this.generation, sdk = this.sdk, id = this.selected;
    this.lastCommandAt = this.now();
    this.activeChannel = channel;
    const request = {epoch, reject: null};
    this.pendingCommand = request;
    let sdkResult;
    try { sdkResult = sdk.sendToyCommand({[channel]: strength, time: seconds, toyId: id}); }
    catch {
      this.pendingCommand = null; this.fail();
      throw new Error("The device request failed. Reconnect before starting again.");
    }
    const expire = () => {
      this.emit({type: "state", state: "testing", level: strength, channel});
      this.commandTimer = this.later(() => {
        this.commandTimer = null;
        if (this.selected === id && this.commandEpoch === epoch) this.stop();
      }, seconds * 1000);
    };
    // The published SDK does not promise an acknowledgement return. A void
    // return is local submission only and must not be represented as hardware ACK.
    if (!sdkResult || typeof sdkResult.then !== "function") {
      this.pendingCommand = null;
      if (!submittedResult(sdkResult)) {
        this.fail(); throw new Error("The device request failed. Reconnect before starting again.");
      }
      expire();
      return Promise.resolve({status: "submitted", level: strength, channel});
    }
    const stale = () => !this.active(generation) || epoch !== this.commandEpoch || id !== this.selected;
    const stopOriginal = () => {
      try { Promise.resolve(sdk.stopToyAction(id)).catch(() => {}); } catch { /* Finite expiry remains the fallback. */ }
    };
    const submitted = Promise.resolve(sdkResult).then(result => {
      if (stale()) { stopOriginal(); throw new Error("The device request was cancelled."); }
      if (!submittedResult(result)) throw new Error();
      return {status: "submitted", level: strength, channel};
    }, () => {
      if (stale()) stopOriginal();
      throw new Error("The device request could not be confirmed.");
    });
    let timeout, timedOut = false;
    const cancelled = new Promise((_, reject) => {
      request.reject = reject;
      timeout = this.later(() => { timedOut = true; reject(new Error("The device request timed out.")); }, COMMAND_ACK_TIMEOUT_MS);
    });
    const completion = Promise.race([submitted, cancelled]).catch(error => {
      if (this.active(generation) && (epoch === this.commandEpoch || timedOut)) this.fail();
      throw new Error(error?.message === "The device request was cancelled." ? error.message : "The device request could not be confirmed. Reconnect before starting again.");
    }).finally(() => {
      if (timeout !== undefined) { this.clearTimer(timeout); this.timers.delete(timeout); }
      if (this.pendingCommand === request) this.pendingCommand = null;
    });
    expire();
    return completion;
  }

  test(level, ceiling, channel = "vibrate") {
    if (!Number.isInteger(level) || level < 1 || level > MAX_TEST_LEVEL) throw new Error("Choose an output between 1 and 5.");
    this.validateOutput(level, ceiling, channel, TEST_SECONDS);
    if (this.now() - this.lastPulseAt < TEST_SECONDS * 1000) {
      throw new Error("Wait for this two-second test to finish before starting another.");
    }
    if (Math.min(level, ceiling) === 0) { this.stop(); return; }
    this.lastPulseAt = this.now();
    // Legacy pulse callers do not await. Errors are still surfaced by fail/state.
    this.command(level, ceiling, {channel, seconds: TEST_SECONDS}).catch(() => {});
  }

  cancelCommandTimer() {
    if (this.commandTimer !== null) { this.clearTimer(this.commandTimer); this.timers.delete(this.commandTimer); this.commandTimer = null; }
  }

  stopTarget(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !this.knownIds.has(id)) return Promise.resolve({status: "unconfirmed"});
    if (this.selected === id) return this.stop();
    try {
      if (!this.sdk) return Promise.resolve({status: "unconfirmed"});
      return Promise.resolve(this.sdk.stopToyAction(id)).then(stopResult, () => ({status: "unconfirmed"}));
    } catch { return Promise.resolve({status: "unconfirmed"}); }
  }

  stop(clearSelection = false) {
    const id = this.selected;
    ++this.commandEpoch;
    this.cancelCommandTimer();
    this.activeChannel = null;
    if (clearSelection) this.selected = null;
    let result = Promise.resolve({status: "unconfirmed"});
    if (this.sdk && id) {
      try {
        result = Promise.resolve(this.sdk.stopToyAction(id)).then(stopResult, () => ({status: "unconfirmed"}));
      } catch { /* The finite command is the fallback after transport failure. */ }
    }
    this.emit({type: "state", state: this.connected ? "paused" : "waiting"});
    return result;
  }

  openApp() {
    if (!this.active() || !this.ready || typeof this.sdk.connectLovenseAPP !== "function") throw new Error("Wait for the pairing connection before opening Lovense Remote.");
    return Promise.resolve(this.sdk.connectLovenseAPP()).then(() => ({status: "submitted"}));
  }

  fail(message = "The device connection failed. Disconnect and try again.") {
    this.disconnect(message);
  }

  disconnect(message = null) {
    this.stop(true);
    this.pendingCommand?.reject?.(new Error("The device request was cancelled."));
    this.pendingCommand = null;
    ++this.generation;
    for (const timer of this.timers) this.clearTimer(timer);
    this.timers.clear();
    const sdk = this.sdk;
    this.sdk = null;
    this.ready = false;
    this.connected = false;
    this.toys = [];
    this.knownIds.clear();
    this.expiresAt = 0;
    if (sdk) { try { sdk.destroy(); } catch { /* Already disconnected. */ } }
    this.emit({type: "toys", toys: [], selected: null});
    this.emit({type: "state", state: "disconnected", ...(message ? {message} : {})});
  }
}
