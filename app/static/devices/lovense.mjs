// SDK adapter for a deliberately separate, single-pulse hardware check.
// These checks constrain requests; only physical tests can verify device behaviour.
export const TEST_SECONDS = 2;
export const MAX_TEST_LEVEL = 5;

export function safeQrUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const allowed = ["lovense-api.com", "lovense.com"].some(domain =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed ? url.href : null;
  } catch { return null; }
}

export function supportedToys(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 50).filter(toy => {
    if (!toy || typeof toy.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(toy.id) ||
        toy.toyType !== "lush" || !["3", "4"].includes(String(toy.hVersion)) || toy.connected !== true || seen.has(toy.id)) return false;
    seen.add(toy.id);
    return true;
  }).map(toy => ({id: toy.id, label: `Lush ${toy.hVersion}`}));
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
  }

  later(callback, delay) {
    const generation = this.generation;
    const timer = this.setTimer(() => {
      this.timers.delete(timer);
      if (generation === this.generation) callback();
    }, delay);
    this.timers.add(timer);
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
    if (this.selected && !toys.some(toy => toy.id === this.selected)) this.stop(true);
    this.toys = toys;
    this.emit({type: "toys", toys, selected: this.selected});
    this.emit({type: "state", state: "paused"});
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
        !this.toys.some(toy => toy.id === id)) throw new Error("Select one connected Lush 3 or Lush 4.");
    this.selected = id;
    this.emit({type: "selected", id});
  }

  test(level, ceiling) {
    if (!this.active() || !this.ready || !this.connected || !this.selected) {
      throw new Error("Connect and select one device before testing.");
    }
    if (!Number.isInteger(level) || !Number.isInteger(ceiling) || level < 1 || level > MAX_TEST_LEVEL ||
        ceiling < 0 || ceiling > MAX_TEST_LEVEL) throw new Error("Choose an output between 1 and 5.");
    // Re-read current state: a stale list must never authorise a disconnected toy.
    const toys = supportedToys(this.sdk.getOnlineToys());
    if (this.sdk.getAppStatus() !== true || !toys.some(toy => toy.id === this.selected)) {
      this.connectionLost();
      throw new Error("The selected device is disconnected.");
    }
    if (this.now() - this.lastPulseAt < TEST_SECONDS * 1000) {
      throw new Error("Wait for this two-second test to finish before starting another.");
    }
    const strength = Math.min(level, ceiling);
    if (strength === 0) { this.stop(); return; }
    const id = this.selected;
    this.lastPulseAt = this.now();
    const result = this.sdk.sendToyCommand({vibrate: strength, time: TEST_SECONDS, toyId: id});
    const generation = this.generation;
    Promise.resolve(result).catch(() => { if (this.active(generation)) this.fail(); });
    this.emit({type: "state", state: "testing", level: strength});
    this.later(() => {
      // Send a second, targeted Stop as best effort; finite expiry remains essential.
      if (this.selected === id) this.stop();
    }, TEST_SECONDS * 1000);
  }

  stop(clearSelection = false) {
    const id = this.selected;
    if (clearSelection) this.selected = null;
    if (this.sdk && id) {
      try {
        Promise.resolve(this.sdk.stopToyAction(id)).catch(() => {});
      } catch { /* The finite command is the fallback after transport failure. */ }
    }
    this.emit({type: "state", state: this.connected ? "paused" : "waiting"});
  }

  fail(message = "The device connection failed. Disconnect and try again.") {
    this.disconnect(message);
  }

  disconnect(message = null) {
    this.stop(true);
    ++this.generation;
    for (const timer of this.timers) this.clearTimer(timer);
    this.timers.clear();
    const sdk = this.sdk;
    this.sdk = null;
    this.ready = false;
    this.connected = false;
    this.toys = [];
    this.expiresAt = 0;
    if (sdk) { try { sdk.destroy(); } catch { /* Already disconnected. */ } }
    this.emit({type: "toys", toys: [], selected: null});
    this.emit({type: "state", state: "disconnected", ...(message ? {message} : {})});
  }
}
