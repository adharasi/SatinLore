import {getToyProfile} from "../../app/static/devices/toy-profiles.mjs";

export class FakeBridge {
  constructor(){this.listeners=new Set();this.toys=[];this.selected=null;this.available=true;this.qrUrl=null;this.channel="vibrate";this.ceiling=5;this.calls=[];this.stops=[];this.model="lush";this.commands=[];}
  snapshot(){return{liveConfigured:this.available,connectionState:this.selected?"paused":"discovered",toys:this.discover(),selectedId:this.selected,qrUrl:this.qrUrl,connectionMessage:this.available?"Ready":"Not configured"};}
  notify(){this.onChange?.(this.snapshot());}
  async begin(){if(!this.available){this.notify();return false;}this.toys=[{id:"physical-toy",label:getToyProfile(this.model).label,model:this.model,capabilities:[...getToyProfile(this.model).physicalChannels]}];this.notify();return true;}
  discover(){return this.toys.map(toy=>({...toy,name:toy.label,vibration:true}));}
  subscribe(callback){this.listeners.add(callback);return()=>this.listeners.delete(callback);}
  async connect(frame){this.selected=frame.deviceId;this.notify();return{...frame,connected:true};}
  command(frame){this.commands.push({...frame,channel:this.channel,ceiling:this.ceiling,at:this.now?.()});return this.commandGate||Promise.resolve({...frame});}
  async stop(frame){this.stops.push({...frame});if(this.failStop)throw Error("Synthetic Stop failure");return{...frame,level:0};}
  async disconnect(frame){return{...frame};}
  setChannel(channel){this.channel=channel;}
  setCeiling(value){this.ceiling=value;}
  refresh(){return this.snapshot();}
  dispose(){const previous=this.selected;this.selected=null;this.toys=[];if(previous)for(const callback of this.listeners)callback({type:"disconnect",deviceId:previous});this.notify();}
  destroy(){this.dispose();}
}
