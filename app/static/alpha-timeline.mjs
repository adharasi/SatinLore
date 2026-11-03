const LIMIT_MS = 60 * 60 * 1000;
const MAX_PENDING = 1000;
const BATCH_SIZE = 100;
const MAX_EVENTS = 20_000;

/** One session's bounded, in-memory queue. Retried batches keep the exact sequence and payload. */
export class AlphaTimeline {
  constructor({session, append, onChange = () => {}, now = () => performance.now()}) {
    this.id = session.id;
    this.expiresAt = session.expiresAt;
    this.sequence = session.seq;
    this.append = append;
    this.onChange = onChange;
    this.now = now;
    this.started = now();
    this.queue = [];
    this.pending = null;
    this.state = "recording";
    this.error = "";
    this.sending = null;
    this.destroyed = false;
    this.abort = new AbortController();
    this.lastTime = 0;
    this.savedCount = 0;
  }

  elapsed() { return Math.min(LIMIT_MS, Math.max(this.lastTime, Math.floor(this.now() - this.started))); }

  status() {
    return {state: this.state, error: this.error, pending: this.queue.length, savedCount: this.savedCount};
  }

  notify() { if (!this.destroyed) this.onChange(this.status()); }

  record(event) {
    if (this.destroyed || this.state !== "recording" || Date.now() >= this.expiresAt) return false;
    if (this.savedCount + this.queue.length >= MAX_EVENTS) {
      this.state = "paused";
      this.error = "The timeline reached its event limit. You can finish and add feedback.";
      this.notify();
      return false;
    }
    if (this.queue.length >= MAX_PENDING) {
      this.state = "paused";
      this.error = "Recording paused while the pending timeline is saved.";
      this.notify();
      return false;
    }
    this.lastTime = this.elapsed();
    this.queue.push({...structuredClone(event), t: this.lastTime});
    this.notify();
    return true;
  }

  pause() {
    if (this.state !== "recording") return;
    this.record({type: "lifecycle", event: "recording-paused"});
    this.state = "paused";
    this.notify();
  }

  resume() {
    if (this.state !== "paused" || this.destroyed || this.queue.length >= MAX_PENDING ||
        this.savedCount + this.queue.length >= MAX_EVENTS || Date.now() >= this.expiresAt) return;
    this.state = "recording";
    this.record({type: "lifecycle", event: "recording-resumed"});
    this.notify();
  }

  close() {
    if (this.state === "recording") this.record({type: "step", step: "complete"});
    this.state = "closing";
    this.notify();
  }

  flush() {
    if (this.destroyed) return Promise.resolve(false);
    if (this.sending) return this.sending;
    this.sending = this.sendPending().finally(() => { this.sending = null; });
    return this.sending;
  }

  async sendPending() {
    while (this.queue.length && !this.destroyed) {
      if (!this.pending) this.pending = {seq: this.sequence + 1, events: this.queue.slice(0, BATCH_SIZE)};
      const batch = this.pending;
      try {
        const acknowledgement = await this.append(this.id, batch, this.abort.signal);
        if (this.destroyed) return false;
        if (acknowledgement?.id !== this.id || acknowledgement.seq !== batch.seq) throw new Error("Invalid acknowledgement");
        this.queue.splice(0, batch.events.length);
        this.sequence = batch.seq;
        this.pending = null;
        this.savedCount = acknowledgement.eventCount;
        this.error = "";
      } catch {
        if (!this.destroyed) {
          this.error = "The timeline has unsaved changes. Retry when your connection is ready.";
          this.notify();
        }
        return false;
      }
      this.notify();
    }
    return !this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.abort.abort();
    this.queue = [];
    this.pending = null;
  }
}
