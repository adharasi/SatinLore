/** A manually advanced monotonic clock; neither test speed nor wall time changes a scenario. */
export class SimulationClock {
  constructor() { this.time = 0; this.next = 0; this.timers = new Map(); }
  now = () => this.time;
  setTimer = (callback, delay = 0) => {
    if (typeof callback !== "function" || !Number.isFinite(delay) || delay < 0) throw new TypeError("Invalid simulation timer.");
    const id = ++this.next;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimer = id => this.timers.delete(id);
  async advance(milliseconds = 0) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 180000) throw new RangeError("Advance 0–180000 milliseconds.");
    const end = this.time + milliseconds;
    for (let count = 0; count < 10000; count++) {
      // Let Promise continuations schedule their next deterministic event.
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const due = [...this.timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) { this.time = end; for (let i = 0; i < 8; i++) await Promise.resolve(); return; }
      const [id, timer] = due; this.timers.delete(id);
      this.time = Math.max(this.time, timer.at); timer.callback();
    }
    throw new Error("Simulation produced too many events.");
  }
  clear() { this.timers.clear(); }
}
