import test from 'node:test';
import assert from 'node:assert/strict';
import {ReaderAccountClient, mountAccountWorkspace} from '../app/static/reader/account-workspace.mjs';
import {setupDOM} from './helpers/setup-dom.mjs';
import {setTimeout as nextTurn} from 'node:timers/promises';
const state=(revision=0,registered=false,presets=[])=>({registered,revision,presets,account:registered?{id:'private-account'}:null,version:1,playback:'paused'});
test('account presets require a real acknowledgement and never send private context',async()=>{
  const sent=[];
  const client=new ReaderAccountClient({request:async(path,options)=>{sent.push([path,options]);return Response.json(state(sent.length,true));}});
  assert.equal(await client.load(),true);
  assert.equal(await client.save({id:'preset-id',name:'Example',toy:'flexer',scope:'account',storyId:null,mode:'continuous',channels:{},activeChannels:['vibrate'],ceiling:0,storyText:'PRIVATE_CANARY',token:'SECRET_CANARY',running:true}),true);
  const body=JSON.parse(sent[1][1].body);
  assert.equal(body.expectedRevision,1);
  assert.equal(body.preset.ceiling,0);
  assert.deepEqual(body.preset.activeChannels,['vibrate']);
  assert.ok(!sent[1][1].body.includes('CANARY'));assert.ok(!Object.hasOwn(body.preset,'running'));
  assert.equal(client.snapshot().playback,'paused');
});
test('conflicting writes preserve the previous account snapshot until refreshed',async()=>{
  let call=0;
  const client=new ReaderAccountClient({request:async()=>++call===1?Response.json(state(4,true,[{id:'existing'}])):Response.json({error:'Refresh before saving.'},{status:409})});
  await client.load();assert.equal(await client.remove('existing'),false);
  assert.equal(client.snapshot().state,'stale');assert.equal(client.snapshot().revision,4);assert.equal(client.snapshot().presets.length,1);
});
test('account creation does not claim success when sign-in or storage fails',async()=>{
  const client=new ReaderAccountClient({request:async()=>Response.json({error:'Sign in again.'},{status:403})});
  assert.equal(await client.create(),false);assert.equal(client.snapshot().registered,false);assert.equal(client.snapshot().busy,false);
});
test('local-only reader never fabricates an account or contacts hosted persistence',async()=>{
  let requests=0;const client=new ReaderAccountClient({hosted:false,request:async()=>{requests++;throw Error();}});
  assert.equal(await client.load(),false);assert.equal(await client.create(),false);assert.equal(requests,0);assert.equal(client.snapshot().registered,false);
});

test('account welcome hides only after adult confirmation and a successful registration acknowledgement',async()=>{
  const dom=setupDOM(),createElement=dom.document.createElement;
  dom.document.createTextNode=text=>({textContent:text});
  dom.document.createElement=tag=>{
    const node=createElement(tag);
    node.querySelector=selector=>selector==='option[value="story"]'?node.children.find(child=>child.tagName==='OPTION'&&child.value==='story')??null:null;
    return node;
  };
  let acknowledge,registered=0,stops=0,posts=0;
  const client=new ReaderAccountClient({request:async(_path,options)=>{
    if(options.method==='GET')return Response.json(state());
    posts++;return new Promise(resolve=>{acknowledge=resolve;});
  }});
  const welcomeMount=dom.make('section');
  mountAccountWorkspace({client,document:dom.document,welcomeMount,settingsMount:dom.make('div'),presetMount:dom.make('div'),
    getContext:()=>({model:'lush',channels:{},storyId:null}),onStop:()=>stops++,onRegistered:()=>registered++});
  await client.load();
  const create=welcomeMount.children[0].children.find(node=>node.textContent==='Create my private account');
  await create.click();
  assert.equal(posts,0,'The unchecked adult choice cannot submit registration.');
  dom.nodes.get('account-adult').checked=true;await create.click();
  assert.equal(posts,1);assert.equal(client.snapshot().busy,true);
  assert.equal(welcomeMount.hidden,false,'An in-flight request must not claim the account is ready.');
  acknowledge(Response.json(state(1,true),{status:201}));await nextTurn(0);
  assert.equal(welcomeMount.hidden,true);assert.equal(registered,1);assert.equal(stops,1);
  assert.equal(client.snapshot().registered,true);assert.equal(client.snapshot().playback,'paused');
});
