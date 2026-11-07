import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createLocalJWKSet, exportJWK, generateKeyPair, SignJWT} from "jose";
import {createPrivateAppWorker} from "../deploy/cloudflare/worker.mjs";
import {CORPUS_BATCH_STREAM_TYPE, CORPUS_STUDY_PATH, corpusDigest, handleCorpusStudy} from "../deploy/cloudflare/corpus-study.mjs";
import {corpusStudyClient} from "../deploy/cloudflare/corpus-study-client.mjs";
import {REFERENCE_RUBRIC_VERSION} from "../deploy/cloudflare/corpus-study-contract.mjs";

const origin="https://app.satinlore.com", issuer="https://fixture.cloudflareaccess.com";
const key="sk-proj-synthetic_credential_for_tests";
const config={origin,issuer};
const session={isFounder:true,subject:"neutral-founder-fixture",expiresAt:Date.now()+3600000};
const unit=async(id,text,target)=>({id,paragraph:0,unitSha256:await corpusDigest(text),text,target,structuralBoundary:false});
const source=async(role="referenceA")=>({schema:1,workId:"neutral-test",sourceSha256:"a".repeat(64),indexSha256:"b".repeat(64),
  referenceVersion:REFERENCE_RUBRIC_VERSION,role,units:[await unit(0,"The lamps were lit.",false),await unit(1,"A caretaker closed the reading room.",true)]});
const request=(suffix="",input,headers={})=>new Request(origin+CORPUS_STUDY_PATH+suffix,{method:input?"POST":"GET",headers:{Origin:origin,"Content-Type":"application/json",...headers},...(input?{body:JSON.stringify(input)}:{})});
const compactRow=id=>{const label={d:"n",f:"n",b:"n",a:"c",p:"q",t:"n",v:[],k:null};return{i:id,s:"c",c:label,r:label,e:{s:"u",a:"n",c:"n",k:"n",v:[]},q:94,z:[2]};};
const providerReply=(rows=[compactRow(1)],usage={input_tokens:120,output_tokens:100,total_tokens:220})=>Response.json({status:"completed",model:"gpt-6-luna",usage,
  output:[{type:"message",role:"assistant",content:[{type:"output_text",text:JSON.stringify({rows})}]}]});

function harness(provider=()=>providerReply(),{reserveStatus=200,settleStatus=200,settleReceipt,onSettle=()=>{}}={}){
  const actions=[];const env={OPENAI_API_KEY:key,SCENE_ANALYSIS_BUDGET:{idFromName:name=>name,get:()=>({async fetch(req){
    const op=new URL(req.url).pathname.split("/").at(-1),payload=await req.json();actions.push({op,payload});
    if(op==="settle"&&settleStatus===200){onSettle(payload);return Response.json(settleReceipt??{settled:true,measured:payload.usage!==null,chargedMicros:1000});}
    return Response.json({code:op}, {status:op==="reserve"?reserveStatus:op==="settle"?settleStatus:200});}})}};
  const call=(req,options={})=>handleCorpusStudy(req,env,{config,session,reverify:async()=>session,
    analysisFetcher:async(url,init)=>{actions.push({op:"provider",url,body:JSON.parse(init.body),redirect:init.redirect});return provider(init);},...options});
  return{actions,call};
}
const submission=async batch=>({runId:"neutral-run",batchHash:await corpusDigest(batch),batch,sourceConsent:true});

test("corpus page, client and registration require founder access on the exact app origin",async()=>{
  const {privateKey,publicKey}=await generateKeyPair("RS256");
  const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:"test",alg:"RS256"}]});
  const env={PUBLIC_APP_ORIGIN:origin,PRIVATE_APP_ENABLED:"true",PUBLIC_READER_ENABLED:"true",WHOLE_STORY_LUNA_STUDY_ENABLED:"true",
    ACCESS_TEAM_DOMAIN:"fixture.cloudflareaccess.com",ACCESS_AUD:"a".repeat(64),FOUNDER_EMAIL:"founder@example.test",BETA_TESTER_EMAILS:"reader@example.test",
    ASSETS:{async fetch(req){assert.equal(req.url,origin+"/_research/corpus-study.mjs");assert.equal(req.headers.get("Cf-Access-Jwt-Assertion"),null);
      return new Response(await readFile(new URL("../deploy/cloudflare/corpus-study-client.mjs",import.meta.url),"utf8"));}}};
  const token=async email=>new SignJWT({iss:issuer,aud:env.ACCESS_AUD,sub:"neutral-subject",email,type:"app"})
    .setIssuedAt().setExpirationTime("1h").setProtectedHeader({alg:"RS256",kid:"test"}).sign(privateKey);
  const founder=await token(env.FOUNDER_EMAIL),tester=await token(env.BETA_TESTER_EMAILS);
  const worker=createPrivateAppWorker({keyResolver:keys,analysisFetcher:()=>assert.fail("Page reads never dispatch.")});
  const read=(host=origin,suffix="",jwt=founder,headers={})=>new Request(host+CORPUS_STUDY_PATH+suffix,{headers:{...(jwt?{"Cf-Access-Jwt-Assertion":jwt}:{}),...headers}});
  assert.equal((await worker.fetch(read(origin,"",null),env)).status,403);
  assert.equal((await worker.fetch(read(origin,"/client.mjs",tester),env)).status,403);
  assert.equal((await worker.fetch(read("https://beta.satinlore.com"),env)).status,404);
  assert.equal((await worker.fetch(read(),{...env,WHOLE_STORY_LUNA_STUDY_ENABLED:"false"})).status,404);
  assert.equal((await worker.fetch(read(origin,"",founder,{Origin:"https://other.test"}),env)).status,403);
  const page=await worker.fetch(read(),env);assert.equal(page.status,200);
  assert.match(page.headers.get("Content-Security-Policy"),/script-src 'self'/);
  assert.equal(page.headers.get("Cache-Control"),"no-store");
  const pageText=await page.text();
  assert.match(pageText,/corpus-study\/client\.mjs/);
  assert.match(pageText,/<p id="transport-version">NDJSON heartbeat transport v1<\/p>/);
  const client=await worker.fetch(read(origin,"/client.mjs"),env);assert.equal(client.status,200);
  assert.match(client.headers.get("Content-Type"),/javascript/);
  assert.match(await client.text(),/corpusStudyClient/);
  assert.notEqual((await worker.fetch(new Request(origin+"/_research/corpus-study.mjs",{headers:{"Cf-Access-Jwt-Assertion":founder}}),env)).status,200);
  const denied=await worker.fetch(request("/register",{runId:"neutral-run",manifest:["a".repeat(64)],sourceConsent:true},
    {"Cf-Access-Jwt-Assertion":founder,Origin:"https://other.test"}),env);
  assert.equal(denied.status,403);
});

test("hashed batch reserves before dispatch and returns only source-free typed outcomes",async()=>{
  const h=harness(),batch=await source(),post=await submission(batch);
  const reply=await h.call(request("/batch",post));assert.equal(reply.status,200);
  const report=await reply.json();assert.deepEqual(h.actions.map(action=>action.op),["reserve","provider","settle"]);
  assert.equal(report.status,"parsed");assert.equal(report.dispatched,true);
  assert.deepEqual(report.targetIds,[1]);assert.deepEqual(report.contextIds,[0]);
  assert.equal(report.rows[0].retrospective.activation,"context");
  assert.deepEqual(report.usage,{inputTokens:120,outputTokens:100});
  assert.match(report.promptSha256,/^[a-f0-9]{64}$/);
  assert.equal(report.causalStatus,"evidence-timing-projection");
  assert.equal(report.budget.settlementConfirmed,true);
  assert.equal(h.actions[1].url,"https://api.openai.com/v1/responses");
  assert.equal(h.actions[1].body.store,false);assert.equal(h.actions[1].redirect,"manual");
  assert.deepEqual(h.actions[1].body.prompt_cache_options,{mode:"explicit"});
  assert.deepEqual(Object.keys(JSON.parse(h.actions[1].body.input)),["workId","targetIds","units"]);
  assert.doesNotMatch(JSON.stringify([report,h.actions[0],h.actions[2]]),/caretaker|lamps|synthetic_credential/);
  const unitKeys=await Promise.all(batch.units.map(row=>corpusDigest(JSON.stringify([batch.sourceSha256,batch.indexSha256,row.id,row.unitSha256]))));
  assert.deepEqual(report.inputUnitKeys,unitKeys);
});

const streamHeaders = {Accept: CORPUS_BATCH_STREAM_TYPE};
const heartbeatFrame = '{"type":"heartbeat"}\n';
const streamText = frame => new TextDecoder().decode(frame.value);
const {readBatchResponse} = corpusStudyClient({testOnly:true});

test("opt-in stream delivers heartbeats while the provider is pending and the same result after settlement", {timeout:2000}, async t => {
  t.mock.timers.enable({apis:["setInterval"]});
  const input=await submission(await source());
  const started=Promise.withResolvers(), pending=Promise.withResolvers();
  const h=harness(()=>{started.resolve();return pending.promise;});
  const reply=await h.call(request("/batch",input,streamHeaders));
  assert.equal(reply.headers.get("Content-Type"),`${CORPUS_BATCH_STREAM_TYPE}; charset=utf-8`);
  assert.equal(reply.headers.get("Cache-Control"),"no-store, no-transform");
  const reader=reply.body.getReader();
  assert.equal(streamText(await reader.read()),heartbeatFrame);
  await started.promise;
  assert.deepEqual(h.actions.map(action=>action.op),["reserve","provider"]);
  t.mock.timers.tick(10_000);
  assert.equal(streamText(await reader.read()),heartbeatFrame);
  pending.resolve(providerReply());
  const wire=streamText(await reader.read()), frame=JSON.parse(wire);
  assert.equal(frame.type,"result");
  assert.deepEqual(h.actions.map(action=>action.op),["reserve","provider","settle"]);
  assert.equal((await reader.read()).done,true);
  assert.doesNotMatch(wire,/caretaker|lamps|synthetic_credential/);
  const normal=await readBatchResponse(await harness().call(request("/batch",input)));
  assert.deepEqual({...frame.value,elapsedMs:0},{...normal,elapsedMs:0});
});

test("stream preflight preserves reservation errors and expiry returns a source-free terminal control",async()=>{
  const input=await submission(await source());
  const denied=harness(()=>assert.fail("Denied quota must not dispatch."),{reserveStatus:429});
  const rejected=await denied.call(request("/batch",input,streamHeaders));
  assert.equal(rejected.status,429);
  assert.match(rejected.headers.get("Content-Type"),/application\/json/);
  let checks=0;
  const expired=harness();
  const response=await expired.call(request("/batch",input,streamHeaders),{reverify:async()=>++checks>=4?null:session});
  assert.equal(await response.text(),heartbeatFrame+'{"type":"error","code":"session_ended_after_reservation"}\n');
  assert.deepEqual(expired.actions.map(action=>action.op),["reserve","provider","settle"]);
});

test("body cancellation aborts provider fetch and leaves settlement conservative", {timeout:2000}, async()=>{
  const started=Promise.withResolvers(),settled=Promise.withResolvers();
  const h=harness(({signal})=>new Promise((_,reject)=>{
    signal.addEventListener("abort",()=>reject(signal.reason),{once:true});started.resolve(signal);
  }),{onSettle:settled.resolve});
  const response=await h.call(request("/batch",await submission(await source()),streamHeaders));
  const reader=response.body.getReader();
  assert.equal(streamText(await reader.read()),heartbeatFrame);
  const signal=await started.promise;
  await reader.cancel();
  assert.equal(signal.aborted,true);
  assert.equal((await settled.promise).usage,null);
  assert.deepEqual(h.actions.map(action=>action.op),["reserve","provider","settle"]);
});

test("stream parser bounds bytes and heartbeats and rejects incomplete or repeated terminal results",async()=>{
  const encoder=new TextEncoder(), headers={"Content-Type":CORPUS_BATCH_STREAM_TYPE};
  const terminal='{"type":"result","value":{"fixture":"café"}}\n';
  const bytes=encoder.encode(heartbeatFrame+terminal);
  const chunks=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
  assert.deepEqual(await readBatchResponse(new Response(chunks,{headers})),{fixture:"café"});
  for(const body of [heartbeatFrame,heartbeatFrame+terminal.trimEnd(),terminal,heartbeatFrame+terminal+terminal,
    heartbeatFrame+terminal+heartbeatFrame,heartbeatFrame.repeat(17)+terminal,heartbeatFrame+"x".repeat(2*1024*1024+1024),
    Uint8Array.of(0xff)])await assert.rejects(readBatchResponse(new Response(body,{headers})));
  await assert.rejects(readBatchResponse(new Response("<html>Temporary error</html>",{status:503,headers:{"Content-Type":"text/html"}})));
  assert.deepEqual(await readBatchResponse(Response.json({fixture:"legacy"})),{fixture:"legacy"});
});

test("an acknowledged unknown settlement never confirms the result",async()=>{
  const h=harness(()=>new Response("Temporary upstream error",{status:503}),{settleReceipt:{settled:true,measured:false,chargedMicros:1000}});
  const response=await h.call(request("/batch",await submission(await source()),streamHeaders));
  const result=await readBatchResponse(response);
  assert.equal(result.httpStatus,503);
  assert.equal(result.usage,null);
  assert.equal(result.budget.settlementConfirmed,false);
  assert.equal(result.haltRecommended,true);
  assert.deepEqual(h.actions.map(action=>action.op),["reserve","provider","settle"]);
});

test("mutated digests, misplaced context and reference vote injection fail before quota or provider",async()=>{
  const h=harness(),batch=await source(),post=await submission(batch);
  post.batch.units[0].text="Changed source.";
  assert.equal((await h.call(request("/batch",post))).status,400);
  const injected=await source("adjudicator");injected.reviews={referenceA:{rows:[]},referenceB:{rows:[]}};
  assert.equal((await h.call(request("/batch",await submission(injected)))).status,400);
  const detector=await source("detector");detector.units[0].target=true;detector.units[1].target=false;
  assert.equal((await h.call(request("/batch",await submission(detector)))).status,400);
  assert.deepEqual(h.actions,[]);
});

test("provider safety HTTP errors block all submitted coordinates without echoing prose",async()=>{
  const h=harness(()=>Response.json({error:{code:"content_policy_violation",message:"private vendor details"}},{status:400}));
  const report=await(await h.call(request("/batch",await submission(await source())))).json();
  assert.equal(report.status,"refused");assert.equal(report.haltRecommended,false);
  assert.deepEqual(report.blockedUnitKeys,report.inputUnitKeys);
  assert.deepEqual(h.actions.at(-1).payload.refusedHashes,report.inputUnitKeys);
  assert.equal(report.rows[0].failureCode,"provider_refusal");
  assert.doesNotMatch(JSON.stringify(report),/private vendor details/);
});

test("quota denial does not dispatch and impossible usage cannot lower the reservation",async()=>{
  const input=await submission(await source());
  const denied=harness(()=>assert.fail("Denied quota must not dispatch."),{reserveStatus:429});
  assert.equal((await denied.call(request("/batch",input))).status,429);
  assert.deepEqual(denied.actions.map(action=>action.op),["reserve"]);
  const h=harness(()=>providerReply(undefined,{input_tokens:999999,output_tokens:10,total_tokens:1000009}));
  const report=await(await h.call(request("/batch",input))).json();
  assert.equal(report.usage,null);assert.equal(h.actions.at(-1).payload.usage,null);
  const unconfirmed=harness(()=>providerReply(),{settleStatus:503});
  const blocked=await(await unconfirmed.call(request("/batch",input))).json();
  assert.equal(blocked.haltRecommended,true);assert.equal(blocked.budget.settlementConfirmed,false);
});

test("billing failures halt the queue and revalidation prevents returning labels after expiry",async()=>{
  const input=await submission(await source());
  const h=harness(()=>Response.json({error:{code:"insufficient_quota",message:"untrusted quota prose"}},{status:429}));
  const report=await(await h.call(request("/batch",input))).json();
  assert.equal(report.haltRecommended,true);assert.equal(report.rows[0].failureCode,"provider_billing_limit");
  assert.doesNotMatch(JSON.stringify(report),/untrusted quota prose/);
  let calls=0;const expired=harness();
  const result=await expired.call(request("/batch",input),{reverify:async()=>++calls>=4?null:session});
  assert.equal(result.status,403);assert.equal((await result.json()).code,"session_ended_after_reservation");
  assert.deepEqual(expired.actions.map(action=>action.op),["reserve","provider","settle"]);
});

test("unidentified returned model cannot qualify a parsed batch",async()=>{
  const h=harness(async()=>{const payload=await providerReply().json();payload.model="unrelated-model";return Response.json(payload);});
  const report=await(await h.call(request("/batch",await submission(await source())))).json();
  assert.equal(report.status,"model_mismatch");assert.equal(report.haltRecommended,true);
  assert.equal(report.returnedModel,null);assert.equal(report.rows[0].failureCode,"provider_model_mismatch");
  assert.doesNotMatch(JSON.stringify(report),/unrelated-model/);
});

test("founder reconciliation only reads its scoped ledger and never accesses the model key", async () => {
  const runId = "neutral-run";
  const batchIds = ["1".repeat(64), "2".repeat(64)];
  const batches = [{batchId:batchIds[0],state:"complete"}, {batchId:batchIds[1],state:"absent"}];
  const calls = [];
  const env = {
    get OPENAI_API_KEY() { assert.fail("Reconciliation needs no provider key."); },
    SCENE_ANALYSIS_BUDGET: {
      idFromName: name => name,
      get: name => ({async fetch(req) {
        assert.equal(name, "scene-analysis:v1");
        assert.equal(req.url, "https://scene-analysis.internal/corpus/status");
        assert.equal(req.method, "POST");
        calls.push(await req.json());
        return Response.json({runId,batches});
      }})
    }
  };
  const context = {config, session, reverify: async () => session,
    analysisFetcher: () => assert.fail("Reconciliation cannot dispatch to the model.")};
  const body = {runId,batchIds};
  const deniedOrigin = await handleCorpusStudy(request("/reconcile",body,{Origin:"https://other.test"}),env,context);
  assert.equal(deniedOrigin.status,403);
  const deniedFounder = await handleCorpusStudy(request("/reconcile",body),env,{...context,session:{...session,isFounder:false}});
  assert.equal(deniedFounder.status,403);
  const duplicates = await handleCorpusStudy(request("/reconcile",{runId,batchIds:[batchIds[0],batchIds[0]]}),env,context);
  assert.equal(duplicates.status,400);
  const extra = await handleCorpusStudy(request("/reconcile",{...body,source:"Unneeded source."}),env,context);
  assert.equal(extra.status,400);
  assert.deepEqual(calls,[]);
  const result = await handleCorpusStudy(request("/reconcile",body),env,context);
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{runId,batches});
  assert.deepEqual(calls,[{reader:await corpusDigest(`satinlore:corpus:v1:${issuer}:${session.subject}`),runId,batchIds}]);
});

test("reconciliation sanitizes internal errors and rechecks the founder before returning status", async () => {
  const runId = "neutral-run", batchIds = ["1".repeat(64)];
  let reply = () => Response.json({code:"batch_not_pinned",detail:"internal diagnostic text"},{status:403});
  const env = {SCENE_ANALYSIS_BUDGET:{idFromName:name=>name,get:()=>({fetch:async()=>reply()})}};
  const context = {config,session,reverify:async()=>session};
  const call = options => handleCorpusStudy(request("/reconcile",{runId,batchIds}),env,{...context,...options});
  const unpinned = await call();
  assert.equal(unpinned.status,403);
  assert.deepEqual(await unpinned.json(),{code:"batch_not_pinned"});
  reply = () => Response.json({runId,batches:[{batchId:batchIds[0],state:"absent",label:"internal diagnostic text"}]});
  const malformed = await call();
  assert.equal(malformed.status,503);
  assert.deepEqual(await malformed.json(),{code:"budget_unavailable"});
  reply = () => Response.json({runId,batches:[{batchId:batchIds[0],state:"complete"}]});
  let checks = 0;
  const expired = await call({reverify:async()=>++checks === 3 ? null : session});
  assert.equal(expired.status,403);
  assert.deepEqual(await expired.json(),{code:"invalid_session"});
});
