// User-selected control preferences only. No story text, identity, transport token
// or playback arming is part of this schema. Persistence is a separate explicit action.
export const CALIBRATION_VERSION = 1;
export const RHYTHMS = Object.freeze(["steady", "gentle", "dynamic", "scene"]);
export const DEFAULT_CHANNEL_CALIBRATION = Object.freeze({
  minimum: 0, background: 1, preferred: 3, maximum: 5, recovery: 0, gain: 1, rhythm: "steady",
});
const fields = Object.keys(DEFAULT_CHANNEL_CALIBRATION);
const whole = value => Number.isInteger(value) && value >= 0 && value <= 20;
export function normalizeSceneProfiles(profiles, length) {
  if (profiles === undefined) return [];
  if (!Array.isArray(profiles) || profiles.length !== length) throw new RangeError("Use the current paragraph patterns.");
  return Array.from(profiles, profile => {
    if (!profile || !["steady", "gentle", "dynamic"].includes(profile.rhythm) ||
        typeof profile.quiet !== "boolean") throw new RangeError("Use a supported paragraph pattern.");
    return {rhythm: profile.rhythm, quiet: profile.quiet};
  });
}

const gain = value => Number.isFinite(value) && value >= 0 && value <= 2 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;

export function normalizeChannelCalibration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new TypeError("Use the available movement settings.");
  const result = {...DEFAULT_CHANNEL_CALIBRATION, ...value};
  if (!["minimum", "background", "preferred", "maximum", "recovery"].every(key => whole(result[key])) ||
      result.minimum > result.maximum || result.background < result.minimum || result.background > result.maximum ||
      result.preferred < result.minimum || result.preferred > result.maximum || result.recovery > result.maximum ||
      !gain(result.gain) || !RHYTHMS.includes(result.rhythm)) throw new RangeError("Keep background and preferred levels within the minimum and maximum; recovery can be zero.");
  return result;
}

export function clampCalibration(value, maximum = 20) {
  if (!whole(maximum)) throw new RangeError("Use an available movement maximum.");
  const checked = normalizeChannelCalibration(value), cap = Math.min(checked.maximum, maximum);
  return {...checked, maximum: cap, minimum: Math.min(checked.minimum, cap), background: Math.min(checked.background, cap),
    preferred: Math.min(checked.preferred, cap), recovery: Math.min(checked.recovery, cap)};
}

/** Shared output policy. All callers must still enforce their armed/visible/connection state. */
export class ReadingFeel {
  constructor({rhythm = "steady"} = {}) {
    this.settings = {mode: "story", minimum: 0, background: 1, preferred: 3, maximum:20, recovery: 0, gain: 1, rhythm};
    this.reset();
  }
  snapshot() { return {...this.settings, playbackMode: this.playbackMode, heldLevel: this.heldLevel,returningToStory:this.ramping}; }
  reset() { this.playbackMode = "story"; this.heldLevel = null; this.startedAt = 0;this.followLevel=null; }
  start(now = 0) { this.startedAt = now;this.followLevel=null; }
  configure(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(this.settings, key))) throw new TypeError("Use the available reading controls.");
    const next = {...this.settings, ...value};
    if (!["story", "continuous"].includes(next.mode) || !["minimum", "background", "preferred", "maximum", "recovery"].every(key => whole(next[key])) || !gain(next.gain) || !RHYTHMS.includes(next.rhythm)) throw new RangeError("Check the reading control values.");
    this.settings = next;
    return this.snapshot();
  }
  hold(value) { if (!whole(value)) throw new RangeError("Choose a whole-number hold level from 0 to 20."); this.playbackMode = "hold"; this.heldLevel = value;this.followLevel=null; }
  easeOff(value, current) { if (!whole(value)) throw new RangeError("Choose a whole-number recovery level from 0 to 20."); this.playbackMode = "ease-off"; this.heldLevel = Math.min(value, Math.max(0, current));this.followLevel=null; }
  followStory(from) {if(this.playbackMode!=="story")this.followLevel=whole(from)?from:null;this.playbackMode = "story"; this.heldLevel = null;}
  get ramping(){return this.followLevel!==null;}
  advanceFollow(from,ceiling=20){if(this.followLevel!==null && whole(from)){this.followLevel=Math.min(20,from+2);if(this.followLevel>=Math.min(ceiling,this.settings.maximum))this.followLevel=null;}}
  capReturn(value){return this.followLevel===null?value:Math.min(value,this.followLevel);}
  desired({base = 0, strength = 1, ceiling = 5, manualZero = false, scene, now = 0} = {}) {
    // Deliberate zero and zero gain/strength always outrank any preferred floor.
    if (!whole(base) || !whole(ceiling) || !Number.isFinite(strength) || strength > 2 || manualZero || (base === 0 && scene?.quiet) || strength <= 0 || this.settings.gain === 0 || ceiling === 0) return 0;
    ceiling=Math.min(ceiling,this.settings.maximum);
    if (this.playbackMode !== "story") return Math.min(ceiling, this.heldLevel ?? 0);
    const {mode, minimum, background, rhythm} = this.settings;
    if (base === 0) return this.capReturn(mode === "continuous" ? Math.min(ceiling, Math.max(minimum, background)) : 0);
    const phase = Math.floor(Math.max(0, now - this.startedAt) / 2000) % 4;
    const variation = rhythm === "scene" ? scene?.rhythm : rhythm;
    const modulation = variation === "gentle" ? [1, 1, .8, .8][phase] : variation === "dynamic" ? [1, .6, 1, .35][phase] : 1;
    const scaled = base * strength * this.settings.gain;
    // A softer beat must not round an otherwise active scene down to a stop.
    const target = Math.max(rhythm === "scene" && scaled >= 1 ? 1 : 0, Math.floor(scaled * modulation));
    return this.capReturn(Math.min(ceiling, Math.max(minimum, target)));
  }
}

/** Independently calibrated actions on one explicitly selected device. */
export class CombinedReadingFeel {
  constructor(channels, {mode = "story"} = {}) {
    if(!channels || typeof channels!=="object" || Array.isArray(channels) || Object.keys(channels).length<2 || Object.keys(channels).length>5 ||
        Object.keys(channels).some(key=>!["vibrate","fingering","rotate","thrusting","oscillate"].includes(key)))throw new TypeError("Choose two or more available movements on one toy.");
    this.channels=Object.fromEntries(Object.entries(channels).map(([id,value])=>[id,{...normalizeChannelCalibration(value)}]));
    this.policies=Object.fromEntries(Object.entries(this.channels).map(([id,{maximum,...value}])=>{
      const policy=new ReadingFeel();policy.configure({mode,maximum,...value});return[id,policy];
    }));
  }
  get settings(){return Object.values(this.policies)[0].settings;}
  snapshot(){
    const primary=Object.values(this.policies)[0].snapshot();
    return {...primary,combined:true,returningToStory:this.ramping,channels:Object.fromEntries(Object.entries(this.policies).map(([id,policy])=>[id,{...policy.snapshot(),maximum:this.channels[id].maximum}]))};
  }
  reset(){for(const policy of Object.values(this.policies))policy.reset();}
  start(now){for(const policy of Object.values(this.policies))policy.start(now);}
  configure(value){for(const [id,policy] of Object.entries(this.policies)){policy.configure(value);if(value.maximum!==undefined)this.channels[id].maximum=value.maximum;}return this.snapshot();}
  updateChannel(id,value){
    if(!Object.hasOwn(this.channels,id))throw new RangeError("Choose an active movement.");
    const checked=normalizeChannelCalibration(value);this.channels[id]=checked;
    this.policies[id].configure(checked);return this.snapshot();
  }
  followStory(from){for(const [id,policy] of Object.entries(this.policies))policy.followStory(from?.[id]);}
  get ramping(){return Object.values(this.policies).some(policy=>policy.ramping);}
  advanceFollow(from,ceiling=20){for(const [id,policy] of Object.entries(this.policies))policy.advanceFollow(from?.[id],Math.min(ceiling,this.channels[id].maximum));}
  ceilings(ceiling){return Object.fromEntries(Object.entries(this.channels).map(([id,value])=>[id,Math.min(ceiling,value.maximum)]));}
  vector(context){return Object.fromEntries(Object.entries(this.policies).map(([id,policy])=>[id,policy.desired({...context,ceiling:Math.min(context.ceiling,this.channels[id].maximum)})]));}
  desired(context){return Math.max(0,...Object.values(this.vector(context)));}
  holdLevels(values){
    if(!values || typeof values!=="object" || Array.isArray(values) || Object.keys(values).length!==Object.keys(this.channels).length ||
        Object.keys(values).some(id=>!Object.hasOwn(this.channels,id) || !whole(values[id])))throw new RangeError("Choose a bounded level for every selected movement.");
    for(const [id,value] of Object.entries(values))this.policies[id].hold(Math.min(value,this.channels[id].maximum));
  }
  hold(value){this.holdLevels(Object.fromEntries(Object.keys(this.channels).map(id=>[id,value])));}
  easeOffLevels(current,value){
    if(!current || Object.keys(this.channels).some(id=>!whole(current[id])))throw new RangeError("Confirm the current outputs before reducing them.");
    if(value!==undefined && !whole(value))throw new RangeError("Choose a whole-number recovery level.");
    for(const [id,policy] of Object.entries(this.policies))policy.easeOff(value??policy.settings.recovery,current[id]);
  }
  easeOff(value,current){this.easeOffLevels(Object.fromEntries(Object.keys(this.channels).map(id=>[id,current])),value);}
}
