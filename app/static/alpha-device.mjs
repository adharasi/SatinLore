import {BridgeTransport} from "./devices/bridge-transport.mjs";
import {ReaderDeviceController} from "./devices/reader-device.mjs";
import {channelMaximum, getToyProfile, MOVEMENT_IDS} from "./devices/toy-profiles.mjs";

const RHYTHMS = ["steady", "gentle", "dynamic"];
const DEFAULT = Object.freeze({level: 1, minimum: 0, recovery: 0, rhythm: "steady"});
const wholeLevel = value => Number.isInteger(value) && value >= 0 && value <= 20;
const availableChannels = channels => [...new Set(channels.filter(channel => MOVEMENT_IDS.includes(channel)))];
const alphaProfile = id => getToyProfile(id, {alpha: true});
const supportedToy = toy => alphaProfile(toy.model) && availableChannels(toy.capabilities).length > 0;
const waitMessage = "Stop and finish the current check before changing the setup.";

class AlphaBridge extends BridgeTransport {
  constructor({onOperation, ...options}) {
    super({...options, framePath: "/alpha/device-bridge"});
    this.onOperation = onOperation;
    this.commandSerial = 0;
  }

  async observed(channels, durationMs, request) {
    const commandId = ++this.commandSerial;
    const event = {type: "output", mode: "live", channels, commandId, ...(durationMs ? {durationMs} : {})};
    this.onOperation({...event, stage: "requested"});
    try {
      const result = await request();
      this.onOperation({...event, stage: "submitted"});
      return result;
    } catch (error) {
      this.onOperation({...event, stage: "failed"});
      throw error;
    }
  }

  command(frame, options) {
    return this.observed({[this.channel]: frame.level}, frame.durationMs, () => super.command(frame, options));
  }

  commandVector(frame, levels, ceilings, options) {
    const channels = Object.fromEntries(availableChannels(Object.keys(levels)).map(id => [id, levels[id]]));
    return this.observed(channels, frame.durationMs, () => super.commandVector(frame, levels, ceilings, options));
  }

  stop(frame) {
    const available = availableChannels(this.toys.find(toy => toy.id === frame.deviceId)?.capabilities || []);
    if (!available.length) return super.stop(frame);
    const channels = Object.fromEntries(available.map(id => [id, 0]));
    return this.observed(channels, undefined, () => super.stop(frame));
  }
}

/** Story-free controls layered on the same bounded simulator and physical controller. */
export function createAlphaDevice({onChange = () => {}, onEvent = () => {}, model = "flexer",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  authorize = async () => (await fetchImpl("/alpha/api/access", {
    credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
  })).ok,
  document = globalThis.document, window = globalThis.window, navigator = globalThis.navigator,
  now = () => performance.now(), setTimer = (fn, delay) => setTimeout(fn, delay), clearTimer = id => clearTimeout(id),
  bridge = null, simulator = null} = {}) {
  let mode = "simulator", activeChannels = [], settings = freshSettings(), busy = false;
  let epoch = 0, authorized = true, destroyed = false, interfaceFailed = false, initialized = false;
  let authorizationTimer = null, lastDevice = "", lastSimulated = "", lastUnknown = false;
  let controller, lastLiveChannels = [];
  const emit = event => { try { onEvent(event); } catch { /* Research capture cannot affect device output. */ } };
  const control = (name, channel, value) => emit({type: "control", control: name,
    ...(channel ? {channel} : {}), ...(value !== undefined ? {value} : {})});
  const trackedBridge = bridge || new AlphaBridge({document, window, navigator, setTimer, clearTimer, onOperation: emit,
    request: (path, options) => fetchImpl(`/alpha${path}`, {
      credentials: "same-origin", cache: "no-store", redirect: "error", ...options,
    })});

  function freshSettings() {
    return Object.fromEntries(MOVEMENT_IDS.map(channel => [channel, {...DEFAULT, maximum: channelMaximum(channel)}]));
  }

  function snapshot() {
    const state = controller.setupSnapshot();
    const toys = state.toys.filter(supportedToy).map(({id, label, model}) => ({id, label, model}));
    const selected = state.connected ? toys.find(toy => toy.id === state.selectedId) : null;
    const channels = selected ? availableChannels(state.channels.map(({id}) => id)) : [];
    const verifiedChannels = availableChannels(state.verifiedChannels).filter(id => channels.includes(id));
    const chosen = activeChannels.filter(id => verifiedChannels.includes(id));
    const personalRangeChannels = selected ? availableChannels(state.personalRangeChannels) : [];
    const test = selected && state.lastTest ? {channel: state.lastTest.channel, simulated: state.lastTest.simulated} : null;
    const running = Boolean(selected && state.running);
    const output = Object.fromEntries(channels.map(channel => [channel,
      mode === "live" && !state.outputKnown ? null :
        wholeLevel(state.channelOutputs?.[channel]) ? state.channelOutputs[channel] : 0]));
    return {mode, model: selected?.model ?? null, deviceLabel: selected?.label ?? null,
      connectionState: state.connectionState, connectionMessage: state.connectionMessage,
      reason: running ? mode === "live" ? "Live controls active. Levels shown are requested." : "Simulator controls active." : state.reason,
      liveConfigured: state.liveConfigured, toys, selectedId: selected ? state.selectedId : null,
      qrUrl: mode === "live" && !selected ? state.qrUrl : null, channels, verifiedChannels, personalRangeChannels,
      activeChannels: chosen, supportsCombined: Boolean(selected && state.supportsCombined && channels.length > 1),
      testing: state.testing, lastTest: test, running, busy, output, outputKnown: state.outputKnown,
      playbackMode: state.feel.playbackMode, settings: Object.fromEntries(channels.map(id => [id, {...settings[id]}])),
      canStart: !busy && !interfaceFailed && authorized && Boolean(selected) && chosen.length > 0 && chosen.length === activeChannels.length &&
        sameChannels(chosen, state.activeChannels) && (chosen.length === 1 || state.supportsCombined) &&
        chosen.some(id => settings[id].level > 0 && settings[id].maximum > 0) && state.canStart};
  }

  function sameChannels(first, second) {
    return first.length === second.length && first.every(id => second.includes(id));
  }

  function notify() {
    if (!initialized || destroyed || interfaceFailed) return;
    const state = snapshot();
    const signature = `${mode}:${state.model ?? ""}:${state.channels.join(",")}`;
    if (signature !== lastDevice) {
      lastDevice = signature;
      emit({type: "device", mode, channels: state.channels, ...(state.model ? {model: state.model} : {})});
    }
    if (mode === "simulator" && state.selectedId) {
      const signature = JSON.stringify(state.output);
      if (signature !== lastSimulated) {
        lastSimulated = signature;
        emit({type: "output", mode, stage: "simulated", channels: state.output,
          ...(Object.values(state.output).some(level => level > 0) ? {durationMs: 2000} : {})});
      }
    } else {
      lastSimulated = "";
    }
    const unknown = mode === "live" && !state.outputKnown && !state.testing;
    if (mode === "live" && state.channels.length) lastLiveChannels = state.channels;
    if (unknown && !lastUnknown && lastLiveChannels.length) {
      emit({type: "output", mode, stage: "unknown", channels: Object.fromEntries(lastLiveChannels.map(id => [id, null]))});
    }
    lastUnknown = unknown;
    scheduleAuthorization(state);
    try { onChange(state); }
    catch {
      interfaceFailed = true;
      disconnect();
    }
  }

  function scheduleAuthorization(state) {
    if (!state.selectedId && !state.running && !state.testing || !authorized) {
      clearTimer(authorizationTimer);
      authorizationTimer = null;
      return;
    }
    if (authorizationTimer !== null) return;
    authorizationTimer = setTimer(async () => {
      authorizationTimer = null;
      await checkAuthorization(epoch);
      if (!destroyed) scheduleAuthorization(snapshot());
    }, 10000);
  }

  async function checkAuthorization(token) {
    let valid = false;
    try { valid = await authorize() === true; } catch {}
    if (token !== epoch || destroyed || document?.hidden || !authorized) return false;
    if (!valid) setAuthorized(false);
    return valid;
  }

  controller = new ReaderDeviceController({document, window, navigator, now, setTimer, clearTimer,
    authorize: () => checkAuthorization(epoch), bridge: trackedBridge, simulator, independentRhythms: true, alpha: true,
    onSetupChange: notify, onInterfaceError: () => { interfaceFailed = true; disconnect(); }});
  // A single fixed input lets the existing guarded controller apply independent
  // levels and its validated rhythm/hold/recovery policies without a story UI.
  controller.setStory([10]);
  initialized = true;

  function resetWork() { epoch++; busy = false; }

  async function action(run) {
    if (busy || controller.snapshot().testing) throw new Error(waitMessage);
    if (!authorized || destroyed || interfaceFailed || document?.hidden) return false;
    const token = ++epoch;
    busy = true;
    notify();
    try { return still(token) ? await run(token) : false; }
    finally { if (token === epoch) { busy = false; notify(); } }
  }

  const still = token => token === epoch && !destroyed && authorized && !document?.hidden;

  function connect(nextMode, simulatorModel = model) {
    if (!["simulator", "live"].includes(nextMode) || !alphaProfile(simulatorModel)) throw new Error("Choose a supported simulator or a physical Lovense toy.");
    return action(async token => {
      control("connect");
      activeChannels = [];
      settings = freshSettings();
      lastLiveChannels = [];
      mode = nextMode;
      notify();
      const result = await controller.beginConnection({mode: mode === "live" ? "lovense" : "simulator", model: simulatorModel});
      return still(token) && Boolean(result);
    });
  }

  function select(id) {
    if (!snapshot().toys.some(toy => toy.id === id)) throw new Error("Choose one discovered Lovense toy.");
    return action(async token => {
      control("select");
      activeChannels = [];
      settings = freshSettings();
      const result = await controller.selectDevice(id);
      return still(token) && Boolean(result);
    });
  }

  function test(channel) {
    if (!snapshot().channels.includes(channel)) throw new Error("Choose an available movement on this toy.");
    return action(async token => {
      if (!await checkAuthorization(token)) return false;
      control("test", channel, 1);
      activeChannels = [];
      // A zero selected limit prevents even the gentle check.
      if (settings[channel].maximum < 1) throw new Error("Set a limit of at least 1 for the short check.");
      controller.setCeilingFromControl(Math.min(settings[channel].maximum, 5));
      return await controller.test({channel, level: 1}) && still(token);
    });
  }

  function confirmTest(channel) {
    const state = snapshot();
    if (busy || !state.lastTest || state.lastTest.channel !== channel || state.testing) return false;
    const alreadyVerified = state.verifiedChannels.includes(channel);
    if (!controller.confirmTest() || !snapshot().verifiedChannels.includes(channel)) return false;
    if (!alreadyVerified) emit({type: "verification", channel, mode, response: true, stopped: true});
    return true;
  }

  function calibration(channel) {
    const {maximum, minimum, level, recovery, rhythm} = settings[channel];
    return {maximum, minimum, background: minimum, preferred: Math.max(minimum, level),
      recovery, rhythm, gain: level / 10};
  }

  async function applyChoice(channels, token) {
    const state = snapshot();
    if (!channels.every(id => state.verifiedChannels.includes(id)) || channels.length > 1 && !state.supportsCombined) return false;
    activeChannels = [];
    if (mode === "live") {
      if (!await checkAuthorization(token)) return false;
      // Alpha Continue grants the existing bridge range for checked movements.
      // The bridge still requires a stopped gentle check for each one.
      for (const channel of channels.filter(id => !state.personalRangeChannels.includes(id))) {
        const selected = await controller.setChannel(channel);
        if (!still(token)) return false;
        if (!selected) throw new Error("The checked movement is no longer available.");
        const granted = await controller.enablePersonalRange({channel});
        if (!still(token)) return false;
        if (!granted) throw new Error("The movement range could not be confirmed.");
      }
    }
    for (const channel of channels) controller.setCalibration(channel, calibration(channel));
    const result = channels.length > 1 ? await controller.applyChannels(channels) : await controller.applyCalibration(channels[0]);
    if (!result || !still(token)) return false;
    activeChannels = [...channels];
    return true;
  }

  function choose(channels) {
    if (!Array.isArray(channels) || !channels.length || channels.length > 5 || new Set(channels).size !== channels.length ||
        channels.some(channel => !snapshot().channels.includes(channel))) throw new Error("Choose an available movement on this toy.");
    return action(async token => {
      control("choose", channels.length === 1 ? channels[0] : undefined);
      return applyChoice(channels, token);
    });
  }

  function set(channel, field, value) {
    if (busy || controller.snapshot().testing) throw new Error(waitMessage);
    if (!snapshot().verifiedChannels.includes(channel) || field !== "maximum" && !Object.hasOwn(DEFAULT, field) ||
        (field === "rhythm" ? !RHYTHMS.includes(value) : !wholeLevel(value) || value > channelMaximum(channel))) {
      throw new Error("Choose a checked movement and a level within its range.");
    }
    const draft = settings[channel];
    if (field !== "maximum" && field !== "rhythm" && value > draft.maximum) {
      throw new Error(field === "minimum" ? "Keep the continuous minimum at or below your personal maximum." : "Keep the level within the chosen limit.");
    }
    if (field === "maximum" && value > draft.maximum && controller.snapshot().running) stop();
    settings[channel] = {...draft, [field]: value};
    if (field === "maximum") {
      for (const name of ["level", "minimum", "recovery"]) settings[channel][name] = Math.min(settings[channel][name], value);
    }
    control(field, channel, value);
    const effective = calibration(channel);
    if (activeChannels.includes(channel)) {
      const master = Math.max(...activeChannels.map(id => calibration(id).maximum));
      if (master > controller.snapshot().ceiling) controller.setCeilingFromControl(master);
      controller.setChannelFeel(channel, effective, {rhythmOnly: field === "rhythm"});
      if (master < controller.snapshot().ceiling) controller.setCeilingFromControl(master);
      controller.activity();
    } else {
      controller.setCalibration(channel, effective);
    }
    notify();
    return snapshot();
  }

  function start() {
    if (!snapshot().canStart) return Promise.resolve(false);
    return action(async token => {
      if (!await checkAuthorization(token) || !still(token)) return false;
      control("start");
      return Boolean(controller.start());
    });
  }

  function stop() {
    resetWork();
    controller.stop();
    control("stop");
    return snapshot();
  }

  async function stopAndWait() {
    if (mode !== "live" || !controller.real?.connected) return stop();
    // Finish and sign-out keep the bridge alive until the bounded Stop settles.
    resetWork();
    controller.cancelTest();
    control("stop");
    await controller.real.stop();
    return snapshot();
  }

  function playbackAction(name, run) {
    if (!snapshot().running) return false;
    control(name);
    controller.activity();
    return run();
  }

  function disconnect() {
    resetWork();
    activeChannels = [];
    clearTimer(authorizationTimer);
    authorizationTimer = null;
    controller.disconnect();
    control("disconnect");
    return snapshot();
  }

  function setAuthorized(value) {
    authorized = value === true;
    if (!authorized) disconnect();
    controller.setAuthorized(authorized);
    notify();
  }

  const visibility = () => {
    if (document.hidden) {
      resetWork();
      if (mode === "live") activeChannels = [];
    }
    controller.setVisible(!document.hidden);
    notify();
  };
  const pagehide = () => disconnect();
  document?.addEventListener("visibilitychange", visibility);
  window?.addEventListener("pagehide", pagehide);

  return {snapshot, connect, select, refresh: () => {controller.refresh(); return snapshot();}, test, confirmTest, choose,
    set, start, stop, stopAndWait, disconnect, setAuthorized,
    hold: () => playbackAction("hold", () => controller.hold()),
    easeOff: () => playbackAction("easeoff", () => controller.easeOff()),
    resume: () => playbackAction("resume", () => {controller.followStory(); return snapshot().running;}),
    destroy() {
      if (destroyed) return;
      disconnect();
      destroyed = true;
      document?.removeEventListener("visibilitychange", visibility);
      window?.removeEventListener("pagehide", pagehide);
      controller.destroy();
    }};
}
