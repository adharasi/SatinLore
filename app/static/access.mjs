// Hosted-only defence in depth. The Worker independently enforces Access on every request.
// No story content, identity or session token is sent or retained here.
const CHECK_FAILED = "Sign-in could not be checked. Playback is paused.";
const SESSION_EXPIRED = "Your sign-in has expired. Playback is paused.";

export class HostedAccessGuard {
  constructor({request = options => fetch("/api/access", options), now = () => Date.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = id => clearTimeout(id),
    onChange = () => {}, onLost = () => {}, interval = 60000, timeout = 8000} = {}) {
    this.request = request; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.onChange = onChange; this.onLost = onLost; this.interval = interval; this.timeout = timeout;
    this.active = false; this.visible = true; this.allowed = false; this.expiresAt = 0;
    this.state = "idle"; this.generation = 0; this.pollTimer = null; this.expiryTimer = null;
    this.abort = null; this.pending = null; this.requestTimer = null;
  }
  snapshot() { return {state: this.state, allowed: this.isAuthorized(), expiresAt: this.expiresAt}; }
  isAuthorized() { return this.active && this.visible && this.allowed && this.now() < this.expiresAt; }
  notify() { this.onChange(this.snapshot()); }
  clearSchedules() {
    this.clearTimer(this.pollTimer); this.clearTimer(this.expiryTimer);
    this.pollTimer = this.expiryTimer = null;
  }
  schedulePoll() {
    this.clearTimer(this.pollTimer);
    if (this.active && this.visible) this.pollTimer = this.setTimer(() => { this.pollTimer = null; void this.check(); }, this.interval);
  }
  scheduleExpiry() {
    this.clearTimer(this.expiryTimer);
    const remaining = this.expiresAt - this.now();
    if (!this.active || !this.visible || !this.allowed) return;
    if (remaining <= 0) { this.lose(SESSION_EXPIRED); return; }
    this.expiryTimer = this.setTimer(() => { this.expiryTimer = null; this.scheduleExpiry(); }, Math.min(remaining, 2147483647));
  }
  lose(reason = CHECK_FAILED) {
    ++this.generation; this.abort?.abort(); this.abort = null; this.pending = null;
    this.clearTimer(this.requestTimer); this.requestTimer = null;
    this.allowed = false; this.expiresAt = 0; this.state = "blocked";
    this.clearSchedules(); this.notify(); this.onLost(reason); this.schedulePoll();
  }
  start({visible = true} = {}) {
    this.active = true; this.visible = visible;
    if (!visible) { this.state = "paused"; this.notify(); return Promise.resolve(false); }
    return this.check();
  }
  suspend() {
    this.visible = false; this.allowed = false;
    ++this.generation; this.abort?.abort(); this.abort = null; this.pending = null;
    this.clearTimer(this.requestTimer); this.requestTimer = null;
    this.clearSchedules(); this.state = "paused"; this.notify();
  }
  resume() { this.active = true; this.visible = true; return this.check(); }
  destroy() { this.active = false; this.suspend(); }
  check({fresh = false} = {}) {
    if (!this.active || !this.visible) return Promise.resolve(false);
    if (this.pending && !fresh) return this.pending;
    if (this.pending) {
      ++this.generation; this.abort?.abort(); this.abort = null; this.pending = null;
      this.clearTimer(this.requestTimer); this.requestTimer = null;
    }
    const generation = ++this.generation;
    const abort = new AbortController(); this.abort = abort;
    const wasAuthorized = this.isAuthorized();
    this.state = "checking";
    if (!wasAuthorized) this.allowed = false;
    this.notify();
    const timeout = this.setTimer(() => abort.abort(), this.timeout);
    this.requestTimer = timeout;
    const current = () => generation === this.generation && this.active && this.visible;
    const task = (async () => {
      try {
        const result = await this.request({method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", headers: {"X-Requested-With": "XMLHttpRequest"}, signal: abort.signal});
        if (!current()) return false;
        if (!result.ok || result.redirected) throw new Error("access");
        const data = await result.json();
        if (!current()) return false;
        if (!data || data.authenticated !== true || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= this.now()) throw new Error("access");
        this.expiresAt = data.expiresAt; this.allowed = true; this.state = "verified";
        this.scheduleExpiry(); this.schedulePoll(); this.notify();
        return this.isAuthorized();
      } catch {
        if (current()) this.lose(CHECK_FAILED);
        return false;
      } finally {
        this.clearTimer(timeout);
        if (this.requestTimer === timeout) this.requestTimer = null;
        if (generation === this.generation) { this.abort = null; this.pending = null; }
      }
    })();
    // A request function can fail synchronously (before its first await). Do not
    // overwrite lose()'s cleared pending state with that already-failed task.
    this.pending = current() ? task : null;
    return task;
  }
}
