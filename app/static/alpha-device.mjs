import {BridgeTransport} from "./devices/bridge-transport.mjs";
import {ReaderDeviceController} from "./devices/reader-device.mjs";

export const FLEXER_CHANNELS = Object.freeze(["vibrate", "fingering"]);
const RHYTHMS = ["steady", "gentle", "dynamic"];
const DEFAULT = Object.freeze({level: 1, maximum: 5, minimum: 0, recovery: 0, rhythm: "steady"});
const wholeLevel = value => Number.isInteger(value) && value >= 0 && value <= 20;
const availableChannels = channels => FLEXER_CHANNELS.filter(channel => channels.includes(channel));
const supportedToy = toy => toy.model === "flexer" && availableChannels(toy.capabilities).length > 0;
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
    const channels = Object.fromEntries((available.length ? available : FLEXER_CHANNELS).map(id => [id, 0]));
    return this.observed(channels, undefined, () => super.stop(frame));
  }
}

/** Story-free controls layered on the same bounded simulator and physical controller. */
export function createAlphaDevice({onChange = () => {}, onEvent = () => {},
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
  let controller;
  const emit = event => { try { onEvent(event); } catch { /* Research capture cannot affect device output. */ } };
  const control = (name, channel, value) => emit({type: "control", control: name,
    ...(channel ? {channel} : {}), ...(value !== undefined ? {value} : {})});
  const trackedBridge = bridge || new AlphaBridge({document, window, navigator, setTimer, clearTimer, onOperation: emit,
    request: (path, options) => fetchImpl(`/alpha${path}`, {
      credentials: "same-origin", cache: "no-store", redirect: "error", ...options,
    })});

  function freshSettings() {
    return Object.fromEntries(FLEXER_CHANNELS.map(channel => [channel, {...DEFAULT}]));
  }

  function snapshot() {
    const state = controller.setupSnapshot();
    const toys = state.toys.filter(supportedToy).map(({id, label}) => ({id, label}));
    const selected = toys.some(toy => toy.id === state.selectedId) && state.connected;
    const channels = selected ? availableChannels(state.channels.map(({id}) => id)) : [];
    const verifiedChannels = availableChannels(state.verifiedChannels).filter(id => channels.includes(id));
    const chosen = activeChannels.filter(id => verifiedChannels.includes(id));
    const personalRangeChannels = selected ? availableChannels(state.personalRangeChannels) : [];
    const test = selected && state.lastTest ? {channel: state.lastTest.channel, simulated: state.lastTest.simulated} : null;
    const running = selected && state.running;
    const connectedMessage = mode === "live" && !selected && state.toys.length && !toys.length ?
      "Connect a Flexer in Lovense Remote, then refresh the device list." : state.connectionMessage;
    const output = Object.fromEntries(FLEXER_CHANNELS.map(channel => [channel,
      mode === "live" && (!selected || !state.outputKnown) ? null :
        wholeLevel(state.channelOutputs?.[channel]) ? state.channelOutputs[channel] : 0]));
    return {mode, connectionState: state.connectionState, connectionMessage: connectedMessage,
      reason: running ? mode === "live" ? "Live controls active. Levels shown are requested." : "Simulator controls active." : state.reason,
      liveConfigured: state.liveConfigured, toys, selectedId: selected ? state.selectedId : null,
      qrUrl: mode === "live" && !selected ? state.qrUrl : null, channels, verifiedChannels, personalRangeChannels,
      activeChannels: chosen, supportsCombined: selected && state.supportsCombined && channels.length === 2,
      testing: state.testing, lastTest: test, running, busy, output, outputKnown: state.outputKnown,
      playbackMode: state.feel.playbackMode, settings: Object.fromEntries(FLEXER_CHANNELS.map(id => [id, {...settings[id]}])),
      maximums: Object.fromEntries(FLEXER_CHANNELS.map(id => [id, limit(id)])),
      canStart: !busy && !interfaceFailed && authorized && selected && chosen.length > 0 && chosen.length === activeChannels.length &&
        sameChannels(chosen, state.activeChannels) && (chosen.length === 1 || state.supportsCombined) &&
        chosen.some(id => settings[id].level > 0 && settings[id].maximum > 0) && state.canStart};
  }

  function sameChannels(first, second) {
    return first.length === second.length && first.every(id => second.includes(id));
  }

  function notify() {
    if (!initialized || destroyed || interfaceFailed) return;
    const state = snapshot();
    const signature = `${mode}:${state.channels.join(",")}`;
    if (signature !== lastDevice) {
      lastDevice = signature;
      emit({type: "device", mode, channels: state.channels});
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
    if (unknown && !lastUnknown) emit({type: "output", mode, stage: "unknown", channels: {vibrate: null, fingering: null}});
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
    authorize: () => checkAuthorization(epoch), bridge: trackedBridge, simulator,
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

  function connect(nextMode) {
    if (!["simulator", "live"].includes(nextMode)) throw new Error("Choose a simulator or a physical Flexer.");
    return action(async token => {
      control("connect");
      activeChannels = [];
      settings = freshSettings();
      controller.disconnect();
      mode = nextMode;
      notify();
      const result = await controller.beginConnection({mode: mode === "live" ? "lovense" : "simulator", model: "flexer"});
      return still(token) && Boolean(result);
    });
  }

  function select(id) {
    if (!snapshot().toys.some(toy => toy.id === id)) throw new Error("Choose a discovered Flexer.");
    return action(async token => {
      control("select");
      activeChannels = [];
      settings = freshSettings();
      const result = await controller.selectDevice(id);
      return still(token) && Boolean(result);
    });
  }

  function test(channel) {
    if (!snapshot().channels.includes(channel)) throw new Error("Choose an available Flexer movement.");
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

  function limit(channel, channels = activeChannels) {
    if (mode === "simulator") return 20;
    const granted = controller.snapshot().personalRangeChannels;
    const included = channels.includes(channel) ? channels : [channel];
    return included.every(id => granted.includes(id)) ? 20 : 5;
  }

  function calibration(channel, channels = activeChannels) {
    const draft = settings[channel];
    const maximum = Math.min(draft.maximum, limit(channel, channels));
    const minimum = Math.min(draft.minimum, maximum);
    return {maximum, minimum, background: minimum, preferred: Math.max(minimum, Math.min(draft.level, maximum)),
      recovery: Math.min(draft.recovery, maximum), rhythm: draft.rhythm, gain: Math.min(draft.level, maximum) / 10};
  }

  async function applyChoice(channels, token) {
    const state = snapshot();
    if (!channels.every(id => state.verifiedChannels.includes(id)) || channels.length === 2 && !state.supportsCombined) return false;
    activeChannels = [];
    for (const channel of channels) {
      const effective = calibration(channel, channels);
      const {maximum, minimum, recovery} = effective;
      settings[channel] = {...settings[channel], maximum, minimum, recovery, level: Math.min(settings[channel].level, maximum)};
      controller.setCalibration(channel, effective);
    }
    const result = channels.length === 2 ? await controller.applyChannels(channels) : await controller.applyCalibration(channels[0]);
    if (!result || !still(token)) return false;
    activeChannels = [...channels];
    return true;
  }

  function choose(channels) {
    if (!Array.isArray(channels) || !channels.length || channels.length > 2 || new Set(channels).size !== channels.length ||
        channels.some(channel => !FLEXER_CHANNELS.includes(channel))) throw new Error("Choose a checked Flexer movement.");
    return action(async token => {
      control("choose", channels.length === 1 ? channels[0] : undefined);
      return applyChoice(channels, token);
    });
  }

  function enableRange(channel) {
    const state = snapshot();
    if (mode !== "live" || state.running || !state.verifiedChannels.includes(channel)) return Promise.resolve(false);
    return action(async token => {
      if (!await checkAuthorization(token)) return false;
      control("range", channel);
      const previous = [...activeChannels];
      activeChannels = [];
      if (!await controller.setChannel(channel) || !still(token)) return false;
      const granted = await controller.enablePersonalRange({channel});
      if (!still(token)) return false;
      if (previous.length) await applyChoice(previous, token);
      return Boolean(granted) && still(token);
    });
  }

  function set(channel, field, value) {
    if (busy || controller.snapshot().testing) throw new Error(waitMessage);
    if (!snapshot().verifiedChannels.includes(channel) || !Object.hasOwn(DEFAULT, field) ||
        (field === "rhythm" ? !RHYTHMS.includes(value) : !wholeLevel(value))) throw new Error("Choose a checked movement and an available setting.");
    const draft = settings[channel];
    if (field === "maximum" && value > limit(channel)) throw new Error(`This movement can use a limit up to ${limit(channel)}.`);
    if (field !== "maximum" && field !== "rhythm" && value > draft.maximum) throw new Error("Keep the level within the chosen limit.");
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
      controller.setChannelFeel(channel, effective);
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
    enableRange, set, start, stop, stopAndWait, disconnect, setAuthorized,
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
