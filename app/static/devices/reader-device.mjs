import {PlaybackController} from "../playback/controller.mjs";
import {AsyncPlaybackController} from "../playback/async-controller.mjs";
import {ProfileSimulator} from "./profile-simulator.mjs";
import {getToyProfile} from "./toy-profiles.mjs";
import {BridgeTransport} from "./bridge-transport.mjs";

/** Reader-facing facade; physical requests retain the separate asynchronous contract. */
export class ReaderDeviceController {
  constructor({now = () => performance.now(), setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer),
    onChange = () => {}, onSetupChange = () => {}, onInterfaceError = () => {}, authorize = async () => true,
    document = globalThis.document, window = globalThis.window, navigator = globalThis.navigator,
    bridge = null, simulator = null, ...controllerOptions} = {}) {
    Object.assign(this,{now,setTimer,clearTimer,onChange,onSetupChange,onInterfaceError,authorize,document,window,navigator});
    this.mode = "simulator"; this.model = "lush"; this.channel = "vibrate";
    this.operation = 0; this.testSerial = 0; this.testing = false; this.visible = true; this.authorized = true;
    this.toys = []; this.selectedId = null; this.connectionState = "disconnected"; this.connectionMessage = "Choose a toy to rehearse or connect.";
    this.liveConfigured = null; this.lastTest = null; this.verifiedTest = null; this.levels = []; this.ready = false; this.bridge = bridge; this.real = null;
    this.simulator = simulator || new ProfileSimulator({now});
    this.sim = new PlaybackController({...controllerOptions,device:this.simulator,now,setTimer,clearTimer,
      onChange: () => this.notify(),onInterfaceError: () => this.onInterfaceError(this.snapshot())});
    this.ready = true;
  }
  get active() { return this.mode === "lovense" && this.real ? this.real : this.sim; }
  get profile() { return getToyProfile(this.model); }
  snapshot() {
    const state = this.active.snapshot(), simulated = this.mode === "simulator", device = simulated ? this.simulator.snapshot() : null;
    const output = simulated ? device.strength : this.testing ? null : state.output;
    const checked = simulated || this.verifiedTest?.id === this.selectedId && this.verifiedTest?.channel === this.channel && this.verifiedTest?.operation === this.operation;
    return {...state,reason:!simulated && state.connected && !checked ? "Complete the short toy check and confirm its response before Start." : state.reason,output,outputKnown: simulated || !this.testing && state.outputKnown !== false,mode:this.mode,model:this.model,
      channel:this.channel,channels:this.channels(),channelOutputs:simulated ? device.channels : {[this.channel]:output},
      deviceLabel:this.selectedToy()?.label || this.profile?.label || "Toy",testing:this.testing,
      canStart:!this.testing && state.connected && !state.running && state.state === "READY_PAUSED" && this.visible && this.authorized && this.levels.length > 0 && (simulated || state.canStart && checked),
      outputMeaning:simulated ? "simulated" : "requested",maxCeiling:simulated ? 20 : 5,
      baseLevel:this.levels[state.position] ?? 0};
  }
  selectedToy() { return this.toys.find(toy => toy.id === this.selectedId) || null; }
  channels() {
    const ids = this.mode === "simulator" ? this.profile?.simChannels || ["vibrate"] : this.selectedToy()?.capabilities || [];
    return ids.map(id => ({id,label:this.profile?.channels.find(channel=>channel.id===id)?.label || id}));
  }
  setupSnapshot() {
    const state = this.snapshot();
    return {...state,connectionState:this.connectionState,connectionMessage:this.connectionMessage,
      toys:this.toys.map(toy=>({...toy,capabilities:[...toy.capabilities]})),selectedId:this.selectedId,
      qrUrl:this.mode === "lovense" ? this.bridge?.qrUrl || null : null,liveConfigured:this.liveConfigured,lastTest:this.lastTest,
      channels:this.channels()};
  }
  notify() {
    if (!this.ready || this.notifierFailed) return this.snapshot();
    const state = this.snapshot();
    try { this.onChange(state); this.onSetupChange(this.setupSnapshot()); }
    catch {
      this.notifierFailed = true; this.cancelTest();
      if (this.mode === "lovense") {void this.real?.pause("The interface failed. Reconnect before continuing.");this.bridge?.dispose();}
      else this.sim._halt("The interface failed. Reconnect before continuing.","ERROR_PAUSED");
      try{this.onInterfaceError(this.snapshot());}catch{}
    }
    return state;
  }
  ensureReal() {
    if (this.real) return;
    this.bridge ||= new BridgeTransport({document:this.document,window:this.window,navigator:this.navigator,setTimer:this.setTimer,clearTimer:this.clearTimer});
    this.bridge.onChange = state => {
      this.liveConfigured = state.liveConfigured;
      if (this.mode !== "lovense") return;
      this.toys = state.toys; this.selectedId = state.selectedId;
      this.connectionState = state.connectionState; this.connectionMessage = state.connectionMessage;
      const selected = this.selectedToy();
      if (selected?.model && getToyProfile(selected.model)) this.model = selected.model;
      if (!selected && this.real?.connected) {this.cancelTest();void this.real.pause("Connection lost. Reconnect and confirm Start.");}
      this.notify();
    };
    this.real = new AsyncPlaybackController({transport:this.bridge,now:this.now,setTimer:this.setTimer,clearTimer:this.clearTimer,
      onChange:()=>this.notify(),heartbeatMs:1100});
    this.real.setVisible(this.visible); this.real.setAuthorized(this.authorized);
  }
  async beginConnection({mode = "simulator",model = "lush"} = {}) {
    if (!["simulator","lovense"].includes(mode) || !getToyProfile(model)) throw new Error("Choose a supported toy and connection.");
    const previous = this.snapshot();
    this.disconnect();
    this.notifierFailed = false;
    const operation = ++this.operation;
    this.mode = mode; this.model = model; this.channel = "vibrate"; this.lastTest = null; this.verifiedTest = null;
    this.toys = []; this.selectedId = null; this.connectionState = "connecting";
    if (mode === "simulator") {
      this.simulator.setModel(model); this.simulator.injectFailure("none"); this.simulator.setChannel("vibrate");
      this.sim.setStory(this.levels); if(this.levels.length)this.sim.setPosition(Math.min(previous.position,this.levels.length-1));
      this.sim.ceiling = Math.min(previous.ceiling,20);
      this.toys = [{id:`sim-${model}`,label:`${this.profile.label} simulator`,model,capabilities:[...this.profile.simChannels]}];
      this.connectionState = "discovered"; this.connectionMessage = "Simulator ready. Choose its device to continue.";
      return this.notify(),this.setupSnapshot();
    }
    this.ensureReal();
    try {
      if (!this.visible || !this.authorized || !await this.authorize() || operation !== this.operation) { if(operation===this.operation){this.connectionState="disconnected";this.connectionMessage="Check your sign-in, then reconnect explicitly.";this.notify();} return false;}
      this.real.setStory(this.levels); if(this.levels.length)this.real.setPosition(Math.min(previous.position,this.levels.length-1));
      this.real.ceiling=Math.min(previous.ceiling,5);this.bridge.setCeiling(this.real.ceiling);this.real.setStrength(1);
      if (!await this.bridge.begin() || operation !== this.operation || !this.visible || !this.authorized) {
        if(operation===this.operation)this.bridge.dispose(); return false;
      }
      this.notify(); return this.setupSnapshot();
    } catch { if(operation===this.operation)this.bridge.dispose("The connection could not start. Try again."); return false; }
  }
  async selectDevice(id) {
    if (typeof id !== "string" || !this.toys.some(toy=>toy.id===id)) throw new Error("Choose one discovered device.");
    this.pause("Device selection changed. Playback stays paused.");
    const operation = ++this.operation;
    this.lastTest = null; this.verifiedTest = null;
    if(this.mode === "simulator") {
      this.selectedId = id; this.simulator.setChannel(this.channel);
      this.sim.connect(); this.connectionState = "paused"; this.connectionMessage = "Simulator selected. Try a short test.";
      this.notify(); return this.setupSnapshot();
    }
    this.ensureReal();
    if(!this.visible || !this.authorized) return false;
    if(this.real.connected || this.real.selected) await this.real.disconnect("Choosing another device.");
    if(operation!==this.operation) return false;
    this.real.selectDevice(id);
    if(!await this.real.connect() || operation!==this.operation) return false;
    this.selectedId=id;this.channel="vibrate";this.bridge.setChannel(this.channel);
    this.connectionState="paused";this.connectionMessage="Toy selected. Test its response at a low level.";
    this.notify();return this.setupSnapshot();
  }
  connect() {
    if(this.mode === "lovense") {void this.beginConnection({mode:this.mode,model:this.model});return false;}
    this.cancelTest();this.notifierFailed = false;this.simulator.injectFailure("none");
    this.selectedId ||= `sim-${this.model}`;
    this.toys=[{id:this.selectedId,label:`${this.profile.label} simulator`,model:this.model,capabilities:[...this.profile.simChannels]}];
    const connected=this.sim.connect();this.connectionState=connected?"paused":"disconnected";this.notify();return connected;
  }
  cancelTest() {
    ++this.testSerial;
    if(this.testTimer!==undefined)this.clearTimer(this.testTimer);
    this.testResolve?.();this.testResolve=null;this.testTimer=undefined;
  }
  async test({channel="vibrate",level=1}={}) {
    if(this.testing || !this.visible || !this.authorized || !this.selectedId || !this.snapshot().connected || !Number.isInteger(level) || level<1 || level>5 || !this.channels().some(value=>value.id===channel)) throw new Error("Select a connected toy, movement and a test level from 1 to 5.");
    if(level>this.snapshot().ceiling)throw new Error("Lower the test level to the chosen maximum; a zero maximum prevents output.");
    this.pause("Preparing a short test. Playback stays paused.");
    const serial=++this.testSerial,operation=this.operation,id=this.selectedId,mode=this.mode;
    let passed=false;this.testing=true;
    this.channel=channel;this.lastTest=null;this.verifiedTest=null;
    const frame={kind:"command",deviceId:id,operationId:`setup-${serial}`,generation:operation,level,durationMs:2000};
    try {
      if(mode==="lovense") {
        if(!await this.real.pause("Preparing a short test.") || serial!==this.testSerial || operation!==this.operation) return false;
        this.bridge.setChannel(channel);
      } else this.simulator.setChannel(channel);
      this.testing=true;this.notify();
      if(mode==="lovense") await this.bridge.command(frame);
      else this.simulator.command(level,2);
      if(serial!==this.testSerial || operation!==this.operation) return false;
      this.notify();
      await new Promise(resolve=>{this.testResolve=resolve;this.testTimer=this.setTimer(resolve,2000);});
      if(serial!==this.testSerial || operation!==this.operation) return false;
      passed=true;
    } catch {
      if(serial===this.testSerial)this.connectionMessage="The test was not confirmed. Check the connection and try again.";
      passed=false;
    } finally {
      // A stale SDK completion can follow an earlier Stop; request another targeted Stop.
      if(mode==="lovense") {try{await this.bridge.stop({...frame,kind:"stop"});}catch{if(operation===this.operation){this.connectionMessage="Stop could not be confirmed. Use Lovense Remote or the toy's own controls.";passed=false;this.real.errorLatch=true;void this.real.pause(this.connectionMessage);}}}
      else this.simulator.stop();
      this.testing=false;
      if(serial===this.testSerial){this.testResolve=null;this.testTimer=undefined;if(passed && operation===this.operation && mode===this.mode)this.lastTest={channel,level,toyId:id,operation,simulated:mode==="simulator",status:"submitted"};this.notify();}
    }
    return passed && serial===this.testSerial && operation===this.operation && mode===this.mode;
  }
  confirmTest(){
    if(this.mode==="simulator")return true;
    if(this.testing||!this.lastTest||this.lastTest.toyId!==this.selectedId||this.lastTest.channel!==this.channel||this.lastTest.operation!==this.operation||!this.real?.connected||this.real.errorLatch||this.real.uncertain.size)return false;
    this.verifiedTest={id:this.selectedId,channel:this.channel,operation:this.operation};this.notify();return true;
  }
  refresh(){this.bridge?.refresh();return this.setupSnapshot();}
  simulateFailure(kind="disconnect") {
    if(this.mode!=="simulator")throw new Error("Failure rehearsal is available in simulation only.");
    this.cancelTest();this.simulator.injectFailure(kind==="error"?"command":kind);
    if(kind==="error"){this.sim._halt("Simulated command failure. Reconnect before continuing.","ERROR_PAUSED");this.connectionState="error";this.connectionMessage="Simulated command failure. Reconnect and select the toy again.";}
    if(kind==="disconnect"){this.sim.disconnect();this.selectedId=null;this.toys=[];this.connectionState="disconnected";this.connectionMessage="Simulated connection lost. Reconnect and select the toy again; playback remains paused.";}
    return this.notify(),this.setupSnapshot();
  }
  pause(reason) {this.cancelTest();if(this.mode==="lovense" && this.connectionState==="connecting" && !this.real?.connected){++this.operation;this.bridge?.dispose("Connection setup cancelled. Reconnect explicitly.");}if(this.mode==="lovense")void this.real?.pause(reason);else this.sim.pause(reason);this.notify();return this.snapshot();}
  stop(){return this.pause("Stopped. Confirm Start to continue.");}
  disconnect(){
    ++this.operation;this.cancelTest();
    if(this.mode==="lovense"){void this.real?.disconnect();this.bridge?.dispose();}
    else this.sim.disconnect();
    this.selectedId=null;this.toys=[];this.connectionState="disconnected";
    this.notify();return this.snapshot();
  }
  setStory(levels){this.levels=Array.from(levels);this.cancelTest();this.active.setStory(levels);return this.snapshot();}
  updateLevels(levels){
    if(!Array.isArray(levels)||levels.length!==this.levels.length||Array.from(levels).some(value=>!Number.isInteger(value)||value<0||value>20)){this.pause("Invalid paragraph mapping.");throw new Error("Use the current paragraph mapping.");}
    this.levels=[...levels];
    if(this.mode==="lovense"){this.real.levels=[...levels];this.real.changed();}else this.sim.updateLevels(levels);
    return this.snapshot();
  }
  setPosition(index){return this.active.setPosition(index),this.snapshot();}
  setLevel(index,value){this.active.setLevel(index,value);this.levels[index]=value;return this.notify();}
  setStrength(value){return this.active.setStrength(value),this.snapshot();}
  setCeilingFromControl(value){
    if(this.mode==="simulator")this.sim.setCeilingFromControl(value);
    else{
      if(!Number.isInteger(value)||value<0||value>5){this.pause("Physical beta maximum is 5/20.");throw new Error("Choose a physical beta maximum from 0 to 5.");}
      if(value>this.real.ceiling){const intent=this.real.prepareCeiling(value);this.real.confirmCeiling(intent);}
      else this.real.setCeiling(value);
      this.bridge.setCeiling(value);
    }
    return this.snapshot();
  }
  confirmCeiling(value,expected){
    if(this.mode==="simulator")return this.sim.confirmCeiling(value,expected);
    if(expected!==this.real.ceiling||!Number.isInteger(value)||value<0||value>5)return false;
    const intent=this.real.prepareCeiling(value);const confirmed=this.real.confirmCeiling(intent);if(confirmed)this.bridge.setCeiling(value);return confirmed;
  }
  start(){
    if(this.testing||!this.visible||!this.authorized || this.mode==="lovense" && (!this.verifiedTest || this.verifiedTest.id!==this.selectedId || this.verifiedTest.channel!==this.channel || this.verifiedTest.operation!==this.operation))return false;
    if(this.mode==="simulator")return this.sim.start();
    const intent=this.real?.prepareStart();return intent?this.real.start(intent):false;
  }
  activity(){this.active.activity();}
  setVisible(value){
    this.visible=value===true;this.active.setVisible(this.visible);
    if(!this.visible){this.cancelTest();if(this.mode==="lovense"){this.bridge?.dispose("Tab hidden. Reconnect and confirm Start.");this.selectedId=null;this.toys=[];}}
    return this.snapshot();
  }
  setAuthorized(value){
    const wasAuthorized=this.authorized;
    this.authorized=value===true;if(this.real)this.real.setAuthorized(this.authorized);
    if(!this.authorized){this.pause("Sign-in expired. Check sign-in before reconnecting.");this.bridge?.dispose();}
    else if(!wasAuthorized && this.mode==="simulator" && this.sim.state!=="ERROR_PAUSED"){
      this.sim.pause(this.sim.connected ? "Sign-in checked. Confirm Start when ready." : "Choose Toy setup to connect a toy or rehearse with a simulator.");
    }
    return this.snapshot();
  }
  destroy(){this.disconnect();this.bridge?.destroy();this.real?.destroy();}
}
