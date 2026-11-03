import {getToyProfile} from "./toy-profiles.mjs";

// Deterministic software output. It cannot certify a physical model's motion,
// strength, transport timing, stopping behaviour or firmware compatibility.
export class ProfileSimulator {
  constructor(options = {}) {
    if (typeof options === "function") options = {now: options};
    this.now = options.now || options.clock || (() => performance.now());
    this.connected = false; this.strength = 0; this.activeChannels = {}; this.deadline = 0;
    this.failure = null;
    this.setModel(options.model || "lush");
    this.setChannel(options.channel || "vibrate");
  }
  get profile() { return getToyProfile(this.model); }
  setModel(model) {
    if (!getToyProfile(model)) throw new Error("Choose a supported toy model.");
    this.disconnect(); this.model = model; this.channel = "vibrate";
  }
  setChannel(channel) {
    if (!this.profile?.simChannels.includes(channel)) throw new Error("Choose an available movement.");
    this.stop(); this.channel = channel;
  }
  connect() { this.stop(); this.connected = true; }
  disconnect() { this.stop(); this.connected = false; }
  command(level, seconds = 2) {
    if (!this.connected) throw new Error("Connect the simulator first.");
    if (!Number.isInteger(level) || level < 0 || level > 20 || !Number.isFinite(seconds) || seconds <= 1 || seconds > 2) {
      throw new Error("Use a bounded level and a finite command of at most two seconds.");
    }
    if (this.failure === "command") {
      this.failure = null; this.stop(); throw new Error("Simulated command failure. Stop and try again.");
    }
    if (level === 0) { this.stop(); return; }
    this.activeChannels = {[this.channel]:level};
    this.strength = level; this.deadline = this.now() + seconds * 1000;
  }
  commandVector(levels,seconds=2) {
    if(!this.connected)throw new Error("Connect the simulator first.");
    if(!levels || typeof levels!=="object" || Array.isArray(levels) || !Object.keys(levels).length ||
        Object.keys(levels).some(id=>!this.profile.simChannels.includes(id)||!Number.isInteger(levels[id])||levels[id]<0||levels[id]>20) ||
        !Number.isFinite(seconds)||seconds<=1||seconds>2)throw new Error("Use available simulator movements and a finite two-second vector.");
    if(this.failure==="command"){this.failure=null;this.stop();throw new Error("Simulated command failure.");}
    const maximum=Math.max(...Object.values(levels));
    if(!maximum){this.stop();return;}
    this.activeChannels={...levels};this.strength=maximum;this.deadline=this.now()+seconds*1000;
  }
  stop() { this.strength = 0; this.activeChannels = {}; this.deadline = 0; }
  injectFailure(kind) {
    if (!["disconnect", "command", "none"].includes(kind)) throw new Error("Choose a known simulator scenario.");
    this.failure = kind === "none" ? null : kind;
    if (kind === "disconnect") { this.failure = null; this.disconnect(); }
  }
  snapshot() {
    if (this.now() >= this.deadline) this.stop();
    return {connected: this.connected, strength: this.strength, model: this.model, channel: this.channel,
      channels: Object.fromEntries(this.profile.simChannels.map(channel => [channel, this.activeChannels[channel] || 0])),
      simulated: true};
  }
}
