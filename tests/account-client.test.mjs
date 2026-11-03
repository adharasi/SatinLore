import test from 'node:test';
import assert from 'node:assert/strict';
import {ReaderAccountClient} from '../app/static/reader/account-workspace.mjs';
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
