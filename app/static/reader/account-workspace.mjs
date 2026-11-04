import {createStoryId} from './identity.mjs';

const presetKeys=['id','name','toy','scope','storyId','mode','channels','activeChannels','ceiling','version'];
export class ReaderAccountClient {
  constructor({hosted=true,request=(...args)=>globalThis.fetch(...args),onChange=()=>{}}={}) {
    Object.assign(this,{hosted,request,onChange});
    this.value={state:hosted?'loading':'local',registered:false,revision:0,presets:[],message:''};
    this.busy=false; this.generation=0;
  }
  snapshot(){return {...this.value,presets:[...this.value.presets],busy:this.busy};}
  emit(){this.onChange(this.snapshot());}
  clear(){++this.generation;this.busy=false;this.value={state:'local',registered:false,revision:0,presets:[],message:''};this.emit();}
  async call(path,body){
    if(!this.hosted)throw Error('Account presets are available in the signed-in app. Local stories still work here.');
    const response=await this.request(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'X-Requested-With':'XMLHttpRequest',...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});
    let value;try{value=await response.json();}catch{throw Error('Your account could not be reached. Check sign-in and try again.');}
    if(!response.ok||response.redirected){if(response.status===409)this.value={...this.value,state:'stale'};throw Error(typeof value?.error==='string'&&value.error.length<=250?value.error:'The account change was not confirmed. Try again.');}
    if(typeof value?.registered!=='boolean'||!Number.isSafeInteger(value.revision)||!Array.isArray(value.presets)||value.presets.length>50)
      throw Error('The account response could not be read. Nothing was applied.');
    return value;
  }
  async perform(path,body,{message=''}={}){
    if(this.busy)return false;
    const generation=++this.generation;this.busy=true;this.emit();
    try{
      const value=await this.call(path,body);
      if(generation!==this.generation)return false;
      this.value={...value,state:'ready',message};return true;
    }catch(error){if(generation===this.generation)this.value={...this.value,state:this.value.state==='stale'?'stale':'unavailable',message:error.message};return false;}
    finally{if(generation===this.generation){this.busy=false;this.emit();}}
  }
  load(){if(!this.hosted){this.emit();return Promise.resolve(false);}return this.perform('/api/account');}
  create(){return this.perform('/api/account',{action:'create',adult:true,expectedRevision:this.value.revision},{message:'Your private account is ready. Choose a toy to begin.'});}
  save(preset){const clean=Object.fromEntries(presetKeys.filter(key=>Object.hasOwn(preset,key)).map(key=>[key,preset[key]]));return this.perform('/api/presets',{preset:clean,expectedRevision:this.value.revision},{message:'Preset saved to your account. Playback remains paused.'});}
  remove(id){return this.perform('/api/presets/delete',{id,expectedRevision:this.value.revision},{message:'Preset removed from your account.'});}
  delete(){return this.perform('/api/account/delete',{confirm:true,expectedRevision:this.value.revision},{message:'Your app profile and presets were removed. Your email sign-in and browser stories are separate.'});}
}

function el(document,tag,text,className){const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;}
export function mountAccountWorkspace({client,welcomeMount,settingsMount,presetMount,getContext,onRegistered=()=>{},onApply=()=>{},onStop=()=>{},onResearchEvent=()=>{},publicMode=false,onSignIn=()=>{},onDeleted=()=>{},document=globalThis.document}={}){
  let lastRegistered=false,signature='',applying=false,selected='',note='';
  const button=(label,fn,className='')=>{const n=el(document,'button',label,className);n.type='button';n.addEventListener('click',()=>void fn());return n;};
  const status=el(document,'p','','note');status.setAttribute('role','status');
  const adult=el(document,'input');adult.type='checkbox';adult.id='account-adult';
  const adultLabel=el(document,'label','','check-label');adultLabel.append(adult,document.createTextNode('I am 18 or over.'));
  const create=button('Create my private account',async()=>{if(!adult.checked){note='Confirm that you are 18 or over to create an account.';render();return;}onStop();if(await client.create())onRegistered();},'primary');
  const retry=button('Refresh account',()=>client.load());
  const intro=el(document,'div','','account-intro');intro.append(el(document,'p','PRIVATE BETA','eyebrow'),el(document,'h2','Your private beta account'),el(document,'p','Create a private account with your verified email sign-in. Save toy presets across visits; your story text stays on this browser.'),adultLabel,create,retry,status);welcomeMount?.append(intro);
  const settingsStatus=el(document,'p','','note');settingsStatus.setAttribute('role','status');
  const deleteChoice=el(document,'input');deleteChoice.type='checkbox';deleteChoice.id='confirm-account-delete';
  const deleteLabel=el(document,'label','','check-label');deleteLabel.append(deleteChoice,document.createTextNode('Remove my saved toy presets and app profile.'));
  const deleteButton=button('Delete account data',async()=>{if(!deleteChoice.checked){note='Confirm the account data you want to remove.';render();return;}onStop();if(await client.delete())onDeleted();deleteChoice.checked=false;});
  const exportButton=button('Download my presets',()=>{onStop();const blob=new Blob([JSON.stringify({version:1,presets:client.snapshot().presets},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el(document,'a');a.href=url;a.download='SatinLore-private-presets.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const signout=el(document,'a','Sign out');signout.href='/cdn-cgi/access/logout';signout.addEventListener('click',()=>onStop());
  const deletion=el(document,'details');deletion.append(el(document,'summary','Account data'),el(document,'p',publicMode?'This removes your saved presets and profile and signs you out on all devices. Stories saved in this browser stay here.':'This removes app presets and profile data. It does not remove your email sign-in, local stories or separately consented beta recordings.','note'),deleteLabel,deleteButton);
  const refresh=retry.cloneNode?button('Refresh account',()=>client.load()):retry;
  settingsMount?.append(settingsStatus,refresh,exportButton,deletion,...(publicMode?[]:[signout]));
  const picker=el(document,'select');picker.id='account-preset-picker';picker.setAttribute('aria-label','Saved toy preset');
  picker.addEventListener('change',()=>{selected=picker.value;render();});
  const name=el(document,'input');name.id='account-preset-name';name.maxLength=64;name.placeholder='Name this preset';name.autocomplete='off';name.setAttribute('aria-label','Preset name');
  const scope=el(document,'select');scope.id='account-preset-scope';scope.setAttribute('aria-label','Preset applies to');for(const[v,t]of[['account','Any story'],['story','This story']]){const option=el(document,'option',t);option.value=v;scope.append(option);}
  const save=button('Save current settings',async()=>{
    const context=getContext();if(!name.value.trim()){note='Give the preset a name.';render();return;}
    if(scope.value==='story'&&!context.storyId){note='Open a story before saving a story preset.';render();return;}
    const preset={id:createStoryId(),name:name.value.trim(),toy:context.model,scope:scope.value,storyId:scope.value==='story'?context.storyId:null,
      mode:context.mode||'story',channels:context.channels,activeChannels:context.activeChannels,ceiling:context.ceiling};
    onStop();if(await client.save(preset)){name.value='';selected=preset.id;onResearchEvent({type:'preset',event:'save',scope:preset.scope});}
  },'primary');
  const apply=button('Apply preset',async()=>{
    const preset=client.snapshot().presets.find(p=>p.id===selected);if(!preset)return;
    applying=true;onStop();render();
    try{await onApply(preset);note='Preset applied. Check the movement, then choose Start when ready.';onResearchEvent({type:'preset',event:'apply',scope:preset.scope});}
    catch(error){note=error.message||'The preset could not be applied.';}
    finally{applying=false;render();}
  });
  const remove=button('Remove selected preset',async()=>{if(selected){const preset=client.snapshot().presets.find(p=>p.id===selected);onStop();if(await client.remove(selected))onResearchEvent({type:'preset',event:'delete',scope:preset?.scope||'account'});selected='';render();}});
  const presetStatus=el(document,'p','','note');presetStatus.setAttribute('role','status');
  const saveDetails=el(document,'details');saveDetails.append(el(document,'summary','Save these settings'),name,scope,save,el(document,'p','Presets contain toy settings. A story preset uses a private story identifier; its text is not uploaded. Applying always leaves playback paused.','note'));
  const signIn=button('Sign in to save presets',onSignIn);
  presetMount?.append(el(document,'h3','Your presets'),picker,apply,remove,saveDetails,presetStatus,...(publicMode?[signIn]:[]));
  function render(){
    const state=client.snapshot(),context=getContext();
    if(welcomeMount)welcomeMount.hidden=publicMode||!client.hosted||state.registered;
    create.disabled=state.busy;retry.disabled=state.busy;
    status.textContent=note||state.message||(state.state==='loading'?'Checking your account…':'Your email has already been verified by private sign-in.');
    settingsStatus.textContent=publicMode?(state.registered?'Toy presets are saved to your account. Stories stay on this browser.':'Sign in with your email to save toy presets.'):
      state.registered?'Private account ready. Toy presets sync across the app and beta. Stories are saved separately on this browser.':client.hosted?'Create your account from the welcome panel to save presets.':'Account presets are available in the signed-in hosted app.';
    if(publicMode){
      const guest=state.state==='local';
      if(guest&&lastRegistered){selected='';name.value='';scope.value='account';deleteChoice.checked=false;}
      refresh.hidden=exportButton.hidden=deletion.hidden=guest;
      picker.hidden=apply.hidden=remove.hidden=saveDetails.hidden=guest;
      signIn.hidden=!guest;
    }
    exportButton.disabled=!state.registered||state.busy;deleteButton.disabled=!state.registered||state.busy;
    const available=state.presets.filter(p=>p.toy===context.model&&(p.scope==='account'||p.storyId===context.storyId));
    const next=JSON.stringify(available.map(p=>[p.id,p.name,p.scope]));
    if(next!==signature){signature=next;picker.replaceChildren();const empty=el(document,'option','Choose a saved preset');empty.value='';picker.append(empty);for(const p of available){const option=el(document,'option',`${p.name}${p.scope==='story'?' · this story':''}`);option.value=p.id;picker.append(option);}if(!available.some(p=>p.id===selected))selected='';picker.value=selected;}
    const blocked=!state.registered||state.busy||applying||state.state!=='ready';
    save.disabled=blocked||!context.channels||!Object.keys(context.channels).length;apply.disabled=blocked||!selected;remove.disabled=blocked||!selected;picker.disabled=blocked;
    scope.querySelector('option[value="story"]').disabled=!context.storyId;
    presetStatus.textContent=note||state.message||(state.registered?`${available.length} presets for this toy${context.storyId?' and story':''}.`:publicMode?'':'Sign in and create your account to save presets.');
    if(state.registered&&!lastRegistered)adult.checked=false;
    lastRegistered=state.registered;
  }
  const prior=client.onChange;client.onChange=value=>{prior(value);note='';render();};
  render();return {update:render,focus:()=>{welcomeMount?.scrollIntoView?.({block:'center'});adult.focus();}};
}
