import {channelMaximum, MOVEMENT_IDS} from "../devices/toy-profiles.mjs";

// User-selected control preferences only. No story text, identity, transport token
// or playback arming is part of this schema. Persistence is a separate explicit action.
export const CALIBRATION_VERSION = 1;
export const DEFAULT_SIMULATOR_MAXIMUM = 10;
export const RHYTHMS = Object.freeze(["steady", "gentle", "dynamic", "scene"]);
export const DEFAULT_CHANNEL_CALIBRATION = Object.freeze({
  minimum: 0, background: 1, preferred: 3, maximum: 5, recovery: 0, gain: 1, rhythm: "steady",
});
const fields = Object.keys(DEFAULT_CHANNEL_CALIBRATION);
const whole = value => Number.isInteger(value) && value >= 0 && value <= 20;
const movementIds = ["vibrate", "fingering", "rotate", "thrusting", "oscillate"];
const scenePhases = ["quiet", "build", "sustain", "peak", "recover"];
export const NOCTURNE_LABELS = Object.freeze({
  build: Object.freeze(["build", "abstain"]),
  sustain: Object.freeze(["steady", "wave", "abstain"]),
  peak: Object.freeze(["crest", "accents", "abstain"]),
  recover: Object.freeze(["taper", "abstain"]),
});
const stagePatterns = {
  build: {label: "Slow build", levels: [.65, .85, 1]},
  peak: {label: "Peak accents", levels: [.75, 1, .65, .9, .55]},
  recover: {label: "Gradual taper", levels: [1, .75, .5, .35]},
};
const nocturnePatterns = {
  crest: {label: "Sustained crest", levels: [.75, .9, 1, 1, .55]},
  wave: {label: "Rolling wave", levels: [.8, 1, .75, .9], repeat: true},
  steady: {label: "Steady hold", levels: [1]},
};
const peakPresets = {
  steady: nocturnePatterns.steady,
  crest: nocturnePatterns.crest,
  accents: {label: "Peak pulses", levels: [.85, .55, 1, .55, .85, .7]},
  ease: {label: "Build and ease", levels: [.55, .8, .5, .95, .6, 1, .45]},
};
const gentleCrest = {label: "Gentle crest", levels: [.85, .95, 1, 1, .85]};
const edgingPattern = {label: "Build and ease", levels: [.65, .85, 1, .55, .85, .95, .65]};
const describedPatterns = {
  accented: {label: "Short pulses", levels: [1, .65, 1, .65, .85], accents: [0, 2], repeat: true},
  alternating: {label: "Alternating rhythm", levels: [.7, 1, .7, 1], accents: [1, 3], repeat: true},
  sustained: nocturnePatterns.steady,
};
const sceneShapes = Object.keys(describedPatterns);
const scenePattern = (phase, pattern, peakPreset) => peakPresets[peakPreset] ?? nocturnePatterns[pattern] ?? stagePatterns[phase];
export const sceneStagePatternLabel = (phase, pattern, peakPreset) => scenePattern(phase, pattern, peakPreset)?.label;

function simulatorScenePattern(scene, rhythm) {
  if (!scene || scene.manual) return undefined;
  if (scene.peakPreset) return peakPresets[scene.peakPreset];
  if (scene.automaticPeak) {
    if (rhythm === "steady") return nocturnePatterns.steady;
    if (rhythm === "gentle") return gentleCrest;
    if (rhythm === "dynamic") return stagePatterns.peak;
    return scene.pattern === "accents" ? peakPresets.accents : peakPresets.crest;
  }
  if (scene.edging && rhythm !== "steady") return edgingPattern;
  if (rhythm === "scene" && scene.phase !== "peak" && scene.phase !== "recover" && scene.shape) {
    return nocturnePatterns[scene.pattern] ?? describedPatterns[scene.shape];
  }
  return rhythm === "scene" ? scenePattern(scene.phase, scene.pattern) : undefined;
}
export const simulatorScenePatternLabel = (scene, rhythm) => simulatorScenePattern(scene, rhythm)?.label;
export const repeatingSimulatorScenePattern = (scene, rhythm) =>
  scene?.phase === "sustain" && simulatorScenePattern(scene, rhythm)?.repeat === true;
const validMovements = value => value === undefined || Array.isArray(value) && value.length <= movementIds.length &&
  Array.from(value).every(id => movementIds.includes(id)) && new Set(value).size === value.length;
export function normalizeSceneProfiles(profiles, length) {
  if (profiles === undefined) return [];
  if (!Array.isArray(profiles) || profiles.length !== length) throw new RangeError("Use the current paragraph patterns.");
  return Array.from(profiles, profile => {
    if (!profile || !["steady", "gentle", "dynamic"].includes(profile.rhythm) ||
        typeof profile.quiet !== "boolean") throw new RangeError("Use a supported paragraph pattern.");
    const {movements, endedMovements} = profile;
    if (!validMovements(movements) || !validMovements(endedMovements) ||
        movements?.some(id => endedMovements?.includes(id))) {
      throw new RangeError("Use supported scene movements.");
    }
    const {phase, sceneId, manual, pattern, peakPreset, automaticPeak, edging, shape, currentCue, simulatorSceneId, verifiedRelease} = profile;
    if (phase !== undefined && !scenePhases.includes(phase) ||
        sceneId != null && (!Number.isInteger(sceneId) || sceneId < 1) ||
        manual !== undefined && typeof manual !== "boolean" ||
        pattern !== undefined && (profile.quiet || pattern === "abstain" || !NOCTURNE_LABELS[phase]?.includes(pattern)) ||
        peakPreset !== undefined && (profile.quiet || phase !== "peak" || !Object.hasOwn(peakPresets, peakPreset)) ||
        automaticPeak !== undefined && (automaticPeak !== true || profile.quiet || phase !== "peak" || peakPreset !== undefined) ||
        edging !== undefined && (edging !== true || profile.quiet || (phase !== "build" && phase !== "sustain")) ||
        shape !== undefined && (profile.quiet || !["build", "sustain"].includes(phase) || !sceneShapes.includes(shape)) ||
        currentCue !== undefined && (currentCue !== true || profile.quiet || !["build", "sustain", "peak"].includes(phase)) ||
        simulatorSceneId !== undefined && (currentCue !== true || !Number.isInteger(simulatorSceneId) || simulatorSceneId < 1) ||
        verifiedRelease !== undefined && (verifiedRelease !== true || profile.quiet || manual || phase !== "recover")) throw new RangeError("Use a supported scene stage.");
    return {rhythm: profile.rhythm, quiet: profile.quiet, ...(movements === undefined ? {} : {movements: [...movements]}),
      ...(endedMovements === undefined ? {} : {endedMovements: [...endedMovements]}),
      ...(pattern === undefined ? {} : {pattern}),
      ...(peakPreset === undefined ? {} : {peakPreset}),
      ...(automaticPeak === undefined ? {} : {automaticPeak}),
      ...(edging === undefined ? {} : {edging}),
      ...(shape === undefined ? {} : {shape}),
      ...(currentCue === undefined ? {} : {currentCue}),
      ...(verifiedRelease === undefined ? {} : {verifiedRelease}),
      ...(simulatorSceneId === undefined ? {} : {simulatorSceneId}),
      ...(phase === undefined ? {} : {phase, sceneId: sceneId ?? null, manual: manual ?? false})};
  });
}

export function scenePatternChanged(previous, next, automaticMovement = false, simulatorStagePatterns = false) {
  const previousSceneId = simulatorStagePatterns ? previous?.simulatorSceneId ?? previous?.sceneId : previous?.sceneId;
  const nextSceneId = simulatorStagePatterns ? next?.simulatorSceneId ?? next?.sceneId : next?.sceneId;
  const sameRepeatingPattern = simulatorStagePatterns && repeatingSimulatorScenePattern(previous, "scene") &&
    repeatingSimulatorScenePattern(next, "scene") && simulatorScenePattern(previous, "scene") === simulatorScenePattern(next, "scene");
  return !!next?.phase && (nextSceneId !== previousSceneId || next.phase !== previous?.phase ||
    next.rhythm !== previous?.rhythm && !sameRepeatingPattern || simulatorStagePatterns && (next.pattern !== previous?.pattern ||
      next.peakPreset !== previous?.peakPreset || next.automaticPeak !== previous?.automaticPeak || next.edging !== previous?.edging ||
      next.shape !== previous?.shape || next.manual !== previous?.manual || next.quiet !== previous?.quiet) ||
    (next.endedMovements || []).join(",") !== (previous?.endedMovements || []).join(",") ||
    automaticMovement && (next.movements || []).join(",") !== (previous?.movements || []).join(","));
}

// A capped beat can hide part of an adjustment. Skip that flat portion so
// each click still changes the current target by one whole level.
export function stepSectionLevel(offset, direction, targetAt) {
  if (direction !== -1 && direction !== 1) throw new RangeError("Adjust the level by one step.");
  const target = targetAt(offset) + direction;
  for (let next = offset + direction; Math.abs(next) <= 20; next += direction) {
    if (targetAt(next) === target) return next;
  }
  return offset;
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
  constructor({rhythm = "steady", maximum = 20} = {}) {
    this.settings = {mode: "story", quietEdging: false, minimum: 0, background: 1, preferred: 3, maximum, recovery: 0, gain: 1, rhythm};
    this.reset();
  }
  snapshot() { return {...this.settings, playbackMode: this.playbackMode, heldLevel: this.heldLevel,returningToStory:this.ramping}; }
  reset() { this.playbackMode = "story"; this.heldLevel = null; this.startedAt = 0;this.followLevel=null; }
  start(now = 0) { this.startedAt = now;this.followLevel=null; }
  reanchor(now, level = 0, keepStageTime = false, forceStageTime = false) {
    if (this.playbackMode !== "story") return;
    if (!keepStageTime || this.settings.rhythm !== "scene" && !forceStageTime) this.startedAt = now;
    this.followLevel = whole(level) ? level : 0;
  }
  configure(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(this.settings, key))) throw new TypeError("Use the available reading controls.");
    const next = {...this.settings, ...value};
    if (!["story", "continuous"].includes(next.mode) || typeof next.quietEdging !== "boolean" || !["minimum", "background", "preferred", "maximum", "recovery"].every(key => whole(next[key])) || !gain(next.gain) || !RHYTHMS.includes(next.rhythm)) throw new RangeError("Check the reading control values.");
    this.settings = next;
    return this.snapshot();
  }
  hold(value) { if (!whole(value)) throw new RangeError("Choose a whole-number hold level from 0 to 20."); this.playbackMode = "hold"; this.heldLevel = value;this.followLevel=null; }
  easeOff(value, current) { if (!whole(value)) throw new RangeError("Choose a whole-number recovery level from 0 to 20."); this.playbackMode = "ease-off"; this.heldLevel = Math.min(value, Math.max(0, current));this.followLevel=null; }
  followStory(from) {if(this.playbackMode!=="story")this.followLevel=whole(from)?from:null;this.playbackMode = "story"; this.heldLevel = null;}
  get ramping(){return this.followLevel!==null;}
  advanceFollow(from,ceiling=20){if(this.followLevel!==null && whole(from)){this.followLevel=Math.min(20,from+2);if(this.followLevel>=Math.min(ceiling,this.settings.maximum))this.followLevel=null;}}
  capReturn(value){return this.followLevel===null?value:Math.min(value,this.followLevel);}
  desired({base = 0, strength = 1, ceiling = 5, manualZero = false, scene, movement, levelAdjustment = 0,
    now = 0, simulatorStagePatterns = false, preview = false} = {}) {
    // Deliberate zero and zero gain/strength always outrank any preferred floor.
    if (!whole(base) || !whole(ceiling) || !Number.isFinite(strength) || strength > 2 || manualZero || (base === 0 && scene?.quiet) || strength <= 0 || this.settings.gain === 0 || ceiling === 0) return 0;
    ceiling=Math.min(ceiling,this.settings.maximum);
    if (this.playbackMode !== "story") return Math.min(ceiling, this.heldLevel ?? 0);
    if (scene?.endedMovements?.includes(movement)) return 0;
    const {mode, quietEdging, minimum, background, rhythm} = this.settings;
    const adjust = target => this.capReturn(Math.max(0, Math.min(ceiling, target + levelAdjustment)));
    const step = Math.floor(Math.max(0, now - this.startedAt) / 2000);
    if (base === 0) {
      const level = mode === "continuous" ? Math.min(ceiling, Math.max(minimum, background)) : 0;
      if (mode === "continuous" && quietEdging && simulatorStagePatterns) {
        const floor = Math.min(ceiling, minimum);
        return adjust(step % 4 === 1 || step % 4 === 2 ? floor : Math.max(floor, Math.min(2, level)));
      }
      return adjust(level);
    }
    const phase = step % 4;
    const variation = rhythm === "scene" ? scene?.rhythm : rhythm;
    const stage = simulatorStagePatterns ? simulatorScenePattern(scene, rhythm) : undefined;
    const stageStep = !stage || preview ? 0 : repeatingSimulatorScenePattern(scene, rhythm) ?
      step % stage.levels.length : Math.min(step, stage.levels.length - 1);
    // Sustained waves and described rhythms repeat; other stages play once and hold.
    const modulation = stage ? stage.levels[stageStep] :
      variation === "gentle" ? [1, 1, .8, .8][phase] : variation === "dynamic" ? [1, .6, 1, .35][phase] : 1;
    // A temporary ceiling limits the final level without shrinking the
    // calibrated scale. Otherwise a low cue can round to zero at a cap of 1.
    const preferred = this.settings.preferred;
    const peak = preferred + Math.ceil(Math.max(0, ceiling - preferred) / 2);
    const calibrated = scene?.phase && !scene.manual ?
      (base <= 3 ? base * preferred / 3 : preferred + (peak - preferred) * Math.min(1, (base - 3) / 2)) : base;
    const scaled = calibrated * strength * this.settings.gain;
    const amplitude = stage ? Math.min(ceiling, scaled) : scaled;
    // Keep an automatic active beat above zero after integer quantization.
    const floor = scaled >= 1 && (rhythm === "scene" || stage || scene?.phase && !scene.manual) ? 1 : 0;
    // An explicit pulse at level 1 would otherwise be indistinguishable from a hold.
    const accent = floor && amplitude < 2 && stage?.accents?.includes(stageStep) ? 2 : 0;
    const target = Math.max(minimum, floor, accent, Math.floor(amplitude * modulation));
    // Keep a verified build perceptible while its rising stages quantize to
    // background. Other waveforms retain their deliberate low steps.
    const backgroundLevel = Math.max(minimum, background);
    // At a ceiling that already equals or falls below the continuous background,
    // a verified local taper cannot express its contrast without an artificial dip.
    if (simulatorStagePatterns && mode === "continuous" && !quietEdging && scene?.verifiedRelease === true &&
        !scene.quiet && !scene.manual && strength >= 1 && this.settings.gain >= 1 && ceiling <= backgroundLevel) return adjust(ceiling);
    const unmodulated = Math.max(minimum, Math.floor(amplitude));
    const collapsed = target === backgroundLevel && (unmodulated === backgroundLevel || stage === stagePatterns.build);
    const contrast = simulatorStagePatterns && mode === "continuous" && !quietEdging && scene?.currentCue === true &&
      !scene.quiet && !scene.manual && !scene.edging && strength >= 1 && this.settings.gain >= 1 && !stage?.accents &&
      collapsed && backgroundLevel < Math.min(ceiling, preferred);
    return adjust(Math.min(ceiling, target + (contrast ? 1 : 0)));
  }
}

/** Independently calibrated actions on one explicitly selected device. */
export class CombinedReadingFeel {
  constructor(channels, {mode = "story", automaticMovement = false, preferredMovement = Object.keys(channels || {})[0]} = {}) {
    if(!channels || typeof channels!=="object" || Array.isArray(channels) || Object.keys(channels).length<2 || Object.keys(channels).length>5 ||
        Object.keys(channels).some(key=>!MOVEMENT_IDS.includes(key)))throw new TypeError("Choose two or more available movements on one toy.");
    this.channels=Object.fromEntries(Object.entries(channels).map(([id,value])=>[id,{...clampCalibration(value, channelMaximum(id))}]));
    this.policies=Object.fromEntries(Object.entries(this.channels).map(([id,{maximum,...value}])=>{
      const policy=new ReadingFeel();policy.configure({mode,maximum,...value});return[id,policy];
    }));
    this.setSceneMovement(automaticMovement, preferredMovement);
  }
  get settings(){return Object.values(this.policies)[0].settings;}
  snapshot(){
    const primary=Object.values(this.policies)[0].snapshot();
    return {...primary,combined:true,automaticMovement:this.automaticMovement,preferredMovement:this.preferredMovement,
      returningToStory:this.ramping,channels:Object.fromEntries(Object.entries(this.policies).map(([id,policy])=>[id,{...policy.snapshot(),maximum:this.channels[id].maximum}]))};
  }
  reset(){for(const policy of Object.values(this.policies))policy.reset();}
  start(now){for(const policy of Object.values(this.policies))policy.start(now);}
  reanchor(now, levels, keepStageTime, forceStageTime) {
    for (const [id, policy] of Object.entries(this.policies)) policy.reanchor(now, levels?.[id], keepStageTime, forceStageTime);
  }
  setSceneMovement(automatic, preferred) {
    if (!Object.hasOwn(this.channels, preferred)) throw new RangeError("Choose an active default movement.");
    this.automaticMovement = automatic === true;
    this.preferredMovement = preferred;
  }
  configure(value){for(const [id,policy] of Object.entries(this.policies)){policy.configure(value);if(value.maximum!==undefined)this.channels[id].maximum=value.maximum;}return this.snapshot();}
  updateChannel(id,value){
    if(!Object.hasOwn(this.channels,id))throw new RangeError("Choose an active movement.");
    const checked=clampCalibration(value,channelMaximum(id));this.channels[id]=checked;
    this.policies[id].configure(checked);return this.snapshot();
  }
  followStory(from){for(const [id,policy] of Object.entries(this.policies))policy.followStory(from?.[id]);}
  get ramping(){return Object.values(this.policies).some(policy=>policy.ramping);}
  advanceFollow(from,ceiling=20){for(const [id,policy] of Object.entries(this.policies))policy.advanceFollow(from?.[id] ?? 0,Math.min(ceiling,this.channels[id].maximum));}
  ceilings(ceiling){return Object.fromEntries(Object.entries(this.channels).map(([id,value])=>[id,Math.min(ceiling,value.maximum)]));}
  vector(context) {
    const entries = Object.entries(this.policies);
    let selected;
    if (context.scene?.movements) {
      selected = this.automaticMovement || !context.scene.phase ?
        context.scene.movements.filter(id => Object.hasOwn(this.policies, id)) : [];
      if (!selected.length) selected = [context.scene.phase ? this.preferredMovement :
        Object.hasOwn(this.policies, "vibrate") ? "vibrate" : entries[0][0]];
    }
    return Object.fromEntries(entries.map(([id, policy]) => [
      id, selected && policy.playbackMode === "story" && !selected.includes(id) ? 0 : policy.desired({...context, movement: id})
    ]));
  }
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
