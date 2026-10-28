// Simulator only. A future real adapter must preserve explicit start and bounded commands.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class MockDevice {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.connected = false;
    this.strength = 0;
    this.deadline = 0;
  }
  connect() {
    this.stop();
    this.connected = true;
  }
  disconnect() {
    this.stop();
    this.connected = false;
  }
  command(strength, seconds = 2) {
    if (!this.connected) throw new Error("Connect the simulator first.");
    if (!Number.isFinite(strength) || !Number.isFinite(seconds)) throw new Error("Invalid command.");
    if (seconds <= 1 || seconds > 3) throw new Error("Use a finite duration greater than 1 and at most 3 seconds.");
    this.strength = clamp(Math.round(strength), 0, 20);
    this.deadline = this.clock() + seconds * 1000;
  }
  stop() {
    this.strength = 0;
    this.deadline = 0;
  }
  snapshot() {
    if (this.clock() >= this.deadline) this.stop();
    return {connected: this.connected, strength: this.strength};
  }
}
