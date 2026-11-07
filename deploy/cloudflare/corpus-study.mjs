import { CORPUS_COMPACT_PROMPTS, CORPUS_COMPACT_RESPONSE_FORMAT, REFERENCE_RUBRIC_VERSION,
  inspectCorpusCompactResponse } from "./corpus-study-contract.mjs";
import { CORPUS_ATTEMPT_STATES, CORPUS_BUDGET_LIMITS, CORPUS_BUDGET_ORIGIN,
  CORPUS_RECONCILE_MAX_BATCHES } from "./corpus-study-budget.mjs";
import { CORPUS_STUDY_CLIENT_ASSET } from "./assets.mjs";

export const CORPUS_STUDY_PATH = "/api/scene-analysis/corpus-study";
export const CORPUS_PARSER_REVISION = "v7-field-validation-2";
export const CORPUS_BATCH_STREAM_TYPE = "application/x-ndjson";
const API = "https://api.openai.com/v1/responses";
const encoder = new TextEncoder();
const HEARTBEAT_MS = 10_000;
const MAX_HEARTBEATS = 16;
const MAX_RESULT_FRAME_BYTES = 2 * 1024 * 1024;
const heartbeat = encoder.encode('{"type":"heartbeat"}\n');
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const roles = ["referenceA","referenceB","detector","transition","adjudicator"];
const json = (body, status=200) => Response.json(body,{status});
export const corpusDigest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  encoder.encode(typeof value === "string" ? value : JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,"0")).join("");

async function boundedJson(message, maxBytes, signal) {
  if (message.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase()!=="application/json" || !message.body) throw new TypeError();
  const length = message.headers.get("Content-Length");
  if (length!==null && (!/^\d+$/.test(length) || Number(length)>maxBytes)) throw new RangeError();
  const reader=message.body.getReader(), bytes=new Uint8Array(maxBytes); let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});}; signal.addEventListener("abort",cancel,{once:true});
  try { while(true){signal.throwIfAborted(); const {done,value}=await reader.read(); signal.throwIfAborted();
    if(done)break;if(size+value.byteLength>maxBytes)throw new RangeError();bytes.set(value,size);size+=value.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,size)));
  } finally {signal.removeEventListener("abort",cancel);cancel();reader.releaseLock();}
}

function streamCorpusBatch(run) {
  const disconnected = new AbortController();
  let timer;
  const body = new ReadableStream({
    start(controller) {
      let heartbeats = 1;
      controller.enqueue(heartbeat);
      timer = setInterval(() => {
        if (controller.desiredSize > 0 && heartbeats < MAX_HEARTBEATS) {
          controller.enqueue(heartbeat);
          if (++heartbeats === MAX_HEARTBEATS) clearInterval(timer);
        }
      }, HEARTBEAT_MS);
      void Promise.resolve().then(() => run(disconnected.signal)).then(value => {
        if (disconnected.signal.aborted) return;
        const frame = value === null ? {type:"error", code:"session_ended_after_reservation"} : {type:"result", value};
        const bytes = encoder.encode(JSON.stringify(frame) + "\n");
        if (bytes.byteLength > MAX_RESULT_FRAME_BYTES) throw new RangeError();
        controller.enqueue(bytes);
        controller.close();
      }).catch(() => {
        if (!disconnected.signal.aborted) controller.error(new Error("Corpus batch stream interrupted."));
      }).finally(() => clearInterval(timer));
    },
    cancel() {
      clearInterval(timer);
      disconnected.abort();
    },
  });
  return new Response(body, {headers:{"Content-Type":`${CORPUS_BATCH_STREAM_TYPE}; charset=utf-8`, "Cache-Control":"no-store, no-transform"}});
}

function canonicalBatch(value) {
  return {schema:1,workId:value.workId,sourceSha256:value.sourceSha256,indexSha256:value.indexSha256,
    referenceVersion:REFERENCE_RUBRIC_VERSION,role:value.role,units:value.units.map(unit=>({id:unit.id,paragraph:unit.paragraph,
      unitSha256:unit.unitSha256,text:unit.text,target:unit.target,structuralBoundary:unit.structuralBoundary}))};
}

export async function validateCorpusBatch(value) {
  const fields=["schema","workId","sourceSha256","indexSha256","referenceVersion","role","units"];
  if(!exact(value,fields)||value.schema!==1||!id(value.workId)||!hash(value.sourceSha256)||!hash(value.indexSha256)||
    value.referenceVersion!==REFERENCE_RUBRIC_VERSION||!roles.includes(value.role)||!Array.isArray(value.units)||
    !value.units.length||value.units.length>(value.role==="detector"?80:512))throw new TypeError();
  let previous=-1,previousParagraph=-1,total=0,targets=0;
  for(const unit of value.units){
    if(!exact(unit,["id","paragraph","unitSha256","text","target","structuralBoundary"])||!integer(unit.id)||unit.id<=previous||unit.id>50000||
      !integer(unit.paragraph)||unit.paragraph<previousParagraph||!hash(unit.unitSha256)||typeof unit.text!=="string"||!unit.text.trim()||!unit.text.isWellFormed()||unit.text.includes("\u0000")||
      typeof unit.target!=="boolean"||typeof unit.structuralBoundary!=="boolean"||unit.target&&unit.structuralBoundary)throw new TypeError();
    previous=unit.id;previousParagraph=unit.paragraph;total+=encoder.encode(unit.text).byteLength;targets+=Number(unit.target);
    if(total>110000||await corpusDigest(unit.text)!==unit.unitSha256)throw new TypeError();
  }
  if(!targets||targets>64)throw new TypeError();
  if(value.role==="detector"){
    const first=value.units.find(unit=>unit.target).id,context=value.units.filter(unit=>!unit.target);
    if(context.length>8||context.some(unit=>unit.id>=first))throw new TypeError();
  }
  return canonicalBatch(value);
}

const unknownLabel=()=>({depiction:"unknown",frame:"uncertain",interaction:"uncertain",activation:"review",phase:"unknown",transition:"unknown",evidenceIds:[],knowledgeAtId:null});
export function failedCorpusRows(batch,status,code){return batch.units.filter(unit=>unit.target).map(unit=>({id:unit.id,unitSha256:unit.unitSha256,status,
  causal:unknownLabel(),retrospective:unknownLabel(),eligibility:{status:"uncertain",adult:"uncertain",consent:"uncertain",capacity:"uncertain",evidenceIds:[]},
  confidence:0,reasonCodes:[],failureCode:code}));}

const labelFields = ["depiction", "frame", "interaction", "activation", "phase", "transition"];

function validateCorpusRow(row, fallback, availableIds, originalIssues, rowIndex) {
  const decodeIssues = [...originalIssues];
  const addIssue = (field, code, severity = "error") =>
    decodeIssues.push({rowIndex, id: row.id, field, code, severity});
  const hasError = field => originalIssues.some(issue => issue.severity === "error" &&
    (issue.field === field || issue.field.startsWith(field + ".")));
  const proposed = {causal: row.causal, retrospective: row.retrospective, eligibility: row.eligibility};
  const fieldStatus = {};
  const validationErrors = {causal: null, retrospective: null, eligibility: null};
  const scopeStatus = {causal: row.status, retrospective: row.status, eligibility: "valid"};
  const eligibilityEvidenceOutsideWindow = row.eligibility.evidenceIds.some(id => !availableIds.has(id));
  if (eligibilityEvidenceOutsideWindow) addIssue("eligibility.evidenceIds", "evidence_outside_window");
  if (hasError("eligibility") || eligibilityEvidenceOutsideWindow) {
    validationErrors.eligibility = eligibilityEvidenceOutsideWindow ? "evidence_outside_window" : "invalid_schema";
    scopeStatus.eligibility = "invalid";
  }
  const eligibility = validationErrors.eligibility || row.status === "refused" ? fallback.eligibility : row.eligibility;
  const applied = {};
  for (const scope of ["causal", "retrospective"]) {
    const label = proposed[scope];
    const checked = {...label};
    const fields = Object.fromEntries(labelFields.map(field => [field,
      hasError(scope + "." + field) ? "unresolved" : "applied"]));
    fieldStatus[scope] = fields;
    const issue = (field, code, severity) => addIssue(scope + "." + field, code, severity);
    const malformedScope = originalIssues.some(item => item.field === scope && item.severity === "error");
    if (malformedScope) for (const field of labelFields) fields[field] = "unresolved";

    if (row.status === "refused") {
      const invalidRefusal = label.activation !== "review" || label.phase !== "unknown" ||
        label.transition !== "unknown" || label.evidenceIds.length || label.knowledgeAtId !== null;
      if (invalidRefusal) {
        issue("activation", "refusal_invariant");
        validationErrors[scope] = "refusal_invariant";
      }
      applied[scope] = unknownLabel();
      for (const field of labelFields) fields[field] = "unresolved";
      continue;
    }

    let evidenceError = null;
    if (hasError(scope + ".evidenceIds") || label.evidenceIds.some(id => !availableIds.has(id) ||
      scope === "causal" && id > row.id)) {
      evidenceError = "invalid_evidence";
      issue("evidenceIds", evidenceError);
    } else if (hasError(scope + ".knowledgeAtId") || label.knowledgeAtId !== (label.evidenceIds.at(-1) ?? null)) {
      evidenceError = "invalid_evidence_timing";
      issue("knowledgeAtId", evidenceError);
    }
    if (evidenceError) {
      checked.evidenceIds = [];
      checked.knowledgeAtId = null;
    }

    const transitionNeedsEvidence = !["none", "unknown"].includes(label.transition);
    if (transitionNeedsEvidence && (evidenceError || !label.evidenceIds.includes(row.id))) {
      issue("transition", "transition_evidence_missing");
      checked.transition = "unknown";
    }
    if (checked.transition === "unknown") fields.transition = "unresolved";

    if (malformedScope || hasError(scope + ".activation")) {
      validationErrors[scope] = "invalid_schema";
    } else if (label.activation === "cue") {
      const cueError = validationErrors.eligibility ?? evidenceError;
      if (cueError) validationErrors[scope] = cueError;
      else if (!label.evidenceIds.includes(row.id) || label.interaction !== "depicted" ||
        label.frame === "uncertain" || ["quiet", "unknown"].includes(label.phase) ||
        eligibility.status !== "eligible" || eligibility.adult !== "adult" ||
        eligibility.consent !== "present" || eligibility.capacity !== "present" || !eligibility.evidenceIds.length) {
        validationErrors[scope] = "cue_invariant";
      } else if (scope === "causal" && eligibility.evidenceIds.some(id => id > row.id)) {
        validationErrors[scope] = "future_eligibility_evidence";
      }
    } else {
      const phase = label.activation === "review" ? "unknown" : "quiet";
      if (label.phase !== phase || hasError(scope + ".phase")) issue("phase", "noncue_phase_normalized", "normalized");
      checked.phase = phase;
      fields.phase = phase === "unknown" ? "unresolved" : "applied";
    }

    if (validationErrors[scope]) {
      issue("activation", validationErrors[scope]);
      checked.activation = "review";
      checked.phase = "unknown";
      fields.activation = "unresolved";
      fields.phase = "unresolved";
      scopeStatus[scope] = "invalid";
    }
    applied[scope] = checked;
  }
  const failureCode = Object.values(validationErrors).find(Boolean) ??
    decodeIssues.find(issue => issue.severity === "error")?.code ?? null;
  return {...row, ...applied, eligibility, unitSha256: fallback.unitSha256, failureCode, scopeStatus,
    status: failureCode && row.status !== "refused" ? "partial" : row.status,
    ...(decodeIssues.length ? {proposed, validationErrors, fieldStatus, decodeIssues} : {})};
}

export function parseCorpusProvider(payload,batch){
  const parts=Array.isArray(payload?.output)?payload.output.filter(item=>item?.type==="message"&&item.role==="assistant")
    .flatMap(item=>Array.isArray(item.content)?item.content:[]):[];
  if(["content_filter","content_policy_violation","safety_violation"].includes(payload?.error?.code)||payload?.incomplete_details?.reason==="content_filter"||parts.some(part=>part?.type==="refusal"))return{status:"refused",rows:failedCorpusRows(batch,"refused","provider_refusal"),blockAll:true};
  if(payload?.status!=="completed")return{status:payload?.status==="incomplete"?"truncated":"invalid_response",rows:failedCorpusRows(batch,"failed",payload?.status==="incomplete"?"provider_truncated":"invalid_response")};
  let wire;
  try{if(parts.length!==1||parts[0].type!=="output_text"||typeof parts[0].text!=="string")throw new TypeError();wire=JSON.parse(parts[0].text);}catch{return{status:"invalid_response",rows:failedCorpusRows(batch,"failed","invalid_json")};}
  if(!exact(wire,["rows"])||!Array.isArray(wire.rows)||wire.rows.length>512)return{status:"invalid_response",rows:failedCorpusRows(batch,"failed","invalid_schema")};
  const mapped=new Map(),duplicates=new Set(),seen=new Set(),badSchema=new Map(),refusedIds=new Set(),decodeIssues=[];
  const availableIds=new Set(batch.units.map(unit=>unit.id));
  const targets=new Set(batch.units.filter(unit=>unit.target).map(unit=>unit.id));let rejected=0;
  for(const [rowIndex,raw] of wire.rows.entries()){
    if(!targets.has(raw?.i)){
      rejected++;
      decodeIssues.push({rowIndex,id:integer(raw?.i)?raw.i:null,field:"id",code:"unexpected_target_id",severity:"error"});
      continue;
    }
    if(raw.s==="r")refusedIds.add(raw.i);
    if(seen.has(raw.i)){duplicates.add(raw.i);rejected++;continue;}seen.add(raw.i);
    const inspected=inspectCorpusCompactResponse({rows:[raw]});
    const issues=inspected.issues.map(issue=>({...issue,rowIndex}));
    const decoded=inspected.rows[0];
    if(!decoded){badSchema.set(raw.i,issues);rejected++;continue;}
    mapped.set(raw.i,{decoded,issues,rowIndex});
  }
  const rows=failedCorpusRows(batch,"failed","missing_output").map(fallback=>{
    if(duplicates.has(fallback.id))return{...fallback,failureCode:"duplicate_output"};
    if(badSchema.has(fallback.id))return{...fallback,failureCode:"invalid_schema",decodeIssues:badSchema.get(fallback.id)};
    const mappedRow=mapped.get(fallback.id);
    if(!mappedRow)return fallback;
    return validateCorpusRow(mappedRow.decoded,fallback,availableIds,mappedRow.issues,mappedRow.rowIndex);
  });
  return{status:rows.every(row=>row.failureCode===null)&&!rejected?"parsed":"partial",rows,rejected,decodeIssues,refusedIds:[...refusedIds]};
}

function providerUsage(payload,inputLimit,outputLimit){const value=payload?.usage;
  return value&&[value.input_tokens,value.output_tokens,value.total_tokens].every(integer)&&value.input_tokens+value.output_tokens===value.total_tokens&&value.input_tokens<=inputLimit&&value.output_tokens<=outputLimit
    ?{inputTokens:value.input_tokens,outputTokens:value.output_tokens}:null;}

function providerErrorCode(status,payload){
  const code=payload?.error?.code;
  if(status===401)return "provider_key_rejected";
  if(status===403||status===404||code==="model_not_found")return "provider_model_access";
  if(status===429)return ["insufficient_quota","billing_hard_limit_reached"].includes(code)?"provider_billing_limit":"provider_rate_limit";
  if(status===400||status===422)return "provider_request_rejected";
  return "provider_http_error";
}

const PAGE=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Private corpus study</title><script type="module" src="${CORPUS_STUDY_PATH}/client.mjs"></script></head><body><main>
<h1>Private corpus study</h1><p>Upload the prepared corpus for neutral classification. Source stays in this page until Start sends bounded batches to OpenAI. Labels do not control a reader or device. Reference labels are model-assisted research material.</p>
<p id="transport-version">NDJSON heartbeat transport v1</p>
<p>Each run permits at most ${CORPUS_BUDGET_LIMITS.attempts} calls and $15 estimated usage, shared with a $15 founder daily research ceiling. Up to ${CORPUS_BUDGET_LIMITS.concurrency} independent requests can run together.</p>
<label>Prepared source JSON <input id="source" type="file" accept=".json,application/json"></label><br>
<label>Source-free checkpoint JSON <input id="checkpoint" type="file" accept=".json,application/json"></label>
<label>Optional conflict-target selection <input id="adjudication" type="file" accept=".json,application/json"></label>
<label>Optional paired evidence plan (Detector only) <input id="evidence-pairs" type="file" accept=".json,application/json"></label>
<fieldset><legend>Passes</legend><label><input id="referenceA" type="checkbox" checked>Reference A</label><label><input id="referenceB" type="checkbox" checked>Reference B</label><label><input id="detector" type="checkbox">Source-first detector v7</label><label><input id="transition" type="checkbox">Transition detector v7</label><label><input id="adjudicator" type="checkbox">Review A/B conflicts</label></fieldset>
<label><input id="consent" type="checkbox">I authorize these exact source batches to be sent for neutral classification. This does not establish content or playback eligibility.</label>
<label>Concurrent requests <input id="concurrency" type="number" min="1" max="${CORPUS_BUDGET_LIMITS.concurrency}" value="6"></label>
<p><button id="prepare">Prepare selected passes</button> <button id="start" disabled>Start</button> <button id="pause" disabled>Pause after in-flight calls</button> <button id="reconcile" disabled>Reconcile unknown requests</button> <button id="download" disabled>Download source-free results</button></p>
<p id="progress" role="status">Choose a source file.</p><pre id="summary"></pre><p>Keep this page open. Source and outputs are held in memory. Download results before closing; the server retains only expiring digests and quota metadata, so lost outputs cannot be fetched or automatically re-billed.</p></main></body></html>`;

export async function handleCorpusStudy(request,env,{config,session,reverify,analysisFetcher=fetch}){
  if(!session.isFounder)return json({code:"invalid_session"},403);
  const url=new URL(request.url),read=["GET","HEAD"].includes(request.method),origin=request.headers.get("Origin");
  if(url.origin!==config.origin||url.search||(!read||origin!==null)&&origin!==config.origin||["same-site","cross-site"].includes(request.headers.get("Sec-Fetch-Site")))return json({code:"invalid_origin"},403);
  if(read){if(url.pathname===CORPUS_STUDY_PATH)return new Response(PAGE,{headers:{"Content-Type":"text/html; charset=utf-8"}});
    if(url.pathname===CORPUS_STUDY_PATH+"/client.mjs"){
      try{const asset=await env.ASSETS.fetch(new Request(config.origin+CORPUS_STUDY_CLIENT_ASSET,{method:request.method,signal:request.signal}));
        if(asset.ok)return new Response(asset.body,{headers:{"Content-Type":"text/javascript; charset=utf-8"}});
      }catch{}
      return json({code:"study_unavailable"},503);
    }
    return json({code:"not_found"},404);}
  const reconcile = url.pathname === CORPUS_STUDY_PATH + "/reconcile";
  if(request.method!=="POST"||!reconcile&&![CORPUS_STUDY_PATH+"/register",CORPUS_STUDY_PATH+"/batch"].includes(url.pathname))return json({code:"invalid_method"},405);
  const expired=()=>request.signal.aborted||Date.now()>=session.expiresAt;
  const authorized=async()=>{const renewed=await reverify();return renewed?.isFounder===true&&renewed.subject===session.subject&&Date.now()<renewed.expiresAt&&!expired();};
  if(!await authorized())return json({code:"invalid_session"},403);
  const stop=AbortSignal.timeout(Math.max(0,Math.min(120000,session.expiresAt-Date.now()))),signal=AbortSignal.any([request.signal,stop]);
  let input;try{input=await boundedJson(request,reconcile?8192:131072,AbortSignal.any([signal,AbortSignal.timeout(5000)]));}catch(error){return json({code:error instanceof RangeError?"input_limit":"invalid_request"},error instanceof RangeError?413:400);}
  const namespace=env.SCENE_ANALYSIS_BUDGET;
  if(typeof namespace?.idFromName!=="function"||typeof namespace.get!=="function")return json({code:"study_unavailable"},503);
  const reader=await corpusDigest(`satinlore:corpus:v1:${config.issuer}:${session.subject}`),stub=namespace.get(namespace.idFromName("scene-analysis:v1"));
  const budget=async(operation,body)=>stub.fetch(new Request(CORPUS_BUDGET_ORIGIN+"/corpus/"+operation,{method:"POST",signal:AbortSignal.timeout(5000),headers:{"Content-Type":"application/json"},body:JSON.stringify({reader,...body})}));
  if (reconcile) {
    if (!exact(input, ["runId", "batchIds"]) || !id(input.runId) || !Array.isArray(input.batchIds) ||
      input.batchIds.length === 0 || input.batchIds.length > CORPUS_RECONCILE_MAX_BATCHES ||
      !input.batchIds.every(hash) || new Set(input.batchIds).size !== input.batchIds.length) return json({code:"invalid_request"}, 400);
    if (!await authorized()) return json({code:"invalid_session"}, 403);
    let response, status;
    try {
      response = await budget("status", {runId: input.runId, batchIds: input.batchIds});
      status = await boundedJson(response, 8192, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    } catch {
      return json({code:"budget_unavailable"}, 503);
    }
    if (!await authorized()) return json({code:"invalid_session"}, 403);
    if (response.status === 403 && ["unknown_run", "batch_not_pinned"].includes(status?.code)) {
      return json({code:status.code}, 403);
    }
    if (!response.ok || !exact(status, ["runId", "batches"]) || status.runId !== input.runId ||
      !Array.isArray(status.batches) || status.batches.length !== input.batchIds.length ||
      status.batches.some((batch, index) => !exact(batch, ["batchId", "state"]) ||
        batch.batchId !== input.batchIds[index] || !CORPUS_ATTEMPT_STATES.includes(batch.state))) {
      return json({code:"budget_unavailable"}, 503);
    }
    return json(status);
  }
  const key=env.OPENAI_API_KEY;
  if(typeof key!=="string"||!/^sk-[A-Za-z0-9_-]{12,512}$/.test(key)||key.startsWith("sk-admin-"))return json({code:"study_unavailable"},503);
  if(url.pathname.endsWith("/register")){
    if(!exact(input,["runId","manifest","sourceConsent"])||input.sourceConsent!==true||!id(input.runId)||!Array.isArray(input.manifest)||!input.manifest.length||input.manifest.length>1500||!input.manifest.every(hash))return json({code:"invalid_manifest"},400);
    if(!await authorized())return json({code:"invalid_session"},403);
    return budget("register",{runId:input.runId,manifest:input.manifest});
  }
  if(!exact(input,["runId","batchHash","batch","sourceConsent"])||!id(input.runId)||!hash(input.batchHash)||input.sourceConsent!==true)return json({code:"invalid_request"},400);
  let batch;try{batch=await validateCorpusBatch(input.batch);if(await corpusDigest(batch)!==input.batchHash)throw new TypeError();}catch{return json({code:"invalid_batch"},400);}
  const unitKeys=await Promise.all(batch.units.map(unit=>corpusDigest(JSON.stringify([batch.sourceSha256,batch.indexSha256,unit.id,unit.unitSha256]))));
  const targetIds=batch.units.filter(unit=>unit.target).map(unit=>unit.id),contextIds=batch.units.filter(unit=>!unit.target).map(unit=>unit.id);
  const maxOutputTokens=Math.min(24576,Math.max(2048,2048+targetIds.length*240));
  const providerBody=JSON.stringify({model:"gpt-6-luna",instructions:CORPUS_COMPACT_PROMPTS[batch.role],store:false,prompt_cache_options:{mode:"explicit"},truncation:"disabled",reasoning:{effort:"low"},max_output_tokens:maxOutputTokens,
    input:JSON.stringify({workId:batch.workId,targetIds,units:batch.units.map(({id,paragraph,text,structuralBoundary})=>({id,paragraph,text,structuralBoundary}))}),text:{format:CORPUS_COMPACT_RESPONSE_FORMAT}});
  if(encoder.encode(providerBody).byteLength>131072)return json({code:"provider_input_limit"},413);
  const reserveMicros=Math.ceil((encoder.encode(providerBody).byteLength+2048)*0.20+maxOutputTokens*0.75);
  if(!await authorized())return json({code:"invalid_session"},403);
  let reservation;try{reservation=await budget("reserve",{runId:input.runId,batchHash:input.batchHash,reserveMicros,unitHashes:[...new Set(unitKeys)]});}catch{return json({code:"budget_unavailable"},503);}
  if(!reservation.ok)return reservation;
  async function runBatch(disconnected) {
    const providerSignal = disconnected ? AbortSignal.any([signal,disconnected]) : signal;
    const started=performance.now();let usage=null,httpStatus=null,returnedModel=null,dispatched=false,result={status:"network_error",rows:failedCorpusRows(batch,"failed","provider_connection")};
    try{
      providerSignal.throwIfAborted();if(!await authorized())throw new Error();
      providerSignal.throwIfAborted();
      dispatched=true;
      const response=await analysisFetcher(API,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","Cache-Control":"no-store"},body:providerBody,redirect:"manual",signal:providerSignal});
      httpStatus=response.status;
      if(!response.ok){let payload;try{payload=await boundedJson(response,8192,providerSignal);}catch{await response.body?.cancel().catch(()=>{});}
        if(["content_filter","content_policy_violation","safety_violation"].includes(payload?.error?.code))result={status:"refused",rows:failedCorpusRows(batch,"refused","provider_refusal"),blockAll:true};
        else{const code=providerErrorCode(response.status,payload);result={status:"http_error",haltRecommended:[400,401,403,404,422,429].includes(response.status),rows:failedCorpusRows(batch,"failed",code)};}}
      else{const payload=await boundedJson(response,2_097_152,providerSignal);usage=providerUsage(payload,encoder.encode(providerBody).byteLength+2048,maxOutputTokens);
        returnedModel=typeof payload?.model==="string"&&/^gpt-6-luna(?:-[a-z0-9-]{1,48})?$/.test(payload.model)?payload.model:null;
        result=parseCorpusProvider(payload,batch);
        if(!returnedModel&&["parsed","partial"].includes(result.status))result={status:"model_mismatch",haltRecommended:true,refusedIds:result.refusedIds,
          rows:failedCorpusRows(batch,"failed","provider_model_mismatch")};}
    }catch{result={status:stop.aborted?"timed_out":"network_error",haltRecommended:true,rows:failedCorpusRows(batch,"failed",stop.aborted?"provider_timeout":"provider_connection")};}
    const refusedIds=new Set(result.refusedIds??result.rows.filter(row=>row.status==="refused").map(row=>row.id));
    const refusedHashes=result.blockAll?unitKeys:batch.units.flatMap((unit,index)=>refusedIds.has(unit.id)?[unitKeys[index]]:[]);
    let settlementConfirmed = false;
    try {
      const settlement = await budget("settle", {runId:input.runId,batchHash:input.batchHash,usage,refusedHashes});
      if (settlement.ok) {
        const receipt = await boundedJson(settlement, 1024, AbortSignal.timeout(5000));
        // The ledger can acknowledge a write while preserving an unknown outcome.
        settlementConfirmed = receipt?.settled === true && integer(receipt.chargedMicros) &&
          (receipt.measured === true || refusedHashes.length > 0);
      }
    } catch {}
    const promptSha256 = await corpusDigest(CORPUS_COMPACT_PROMPTS[batch.role]);
    if(!await authorized()||disconnected?.aborted)return null;
    return {schema:1,measurement:"live-provider",runId:input.runId,batchId:input.batchHash,workId:batch.workId,sourceSha256:batch.sourceSha256,indexSha256:batch.indexSha256,
      referenceVersion:REFERENCE_RUBRIC_VERSION,predictionVersion:batch.role==="detector"?"source-first-detector-v7":`${batch.role}-v7`,role:batch.role,model:"gpt-6-luna",promptSha256,causalStatus:"evidence-timing-projection",
      parserRevision:CORPUS_PARSER_REVISION,decodeIssues:result.decodeIssues??[],
      status:result.status,haltRecommended:result.haltRecommended===true||!settlementConfirmed,httpStatus,returnedModel,dispatched,rejectedRows:result.rejected??0,elapsedMs:Math.round(performance.now()-started),usage,maxOutputTokens,targetIds,contextIds,
      inputUnitKeys:unitKeys,blockedUnitKeys:refusedHashes,budget:{reservedMicros:reserveMicros,settlementConfirmed,usageMeasured:usage!==null},rows:result.rows};
  }
  if (request.headers.get("Accept") === CORPUS_BATCH_STREAM_TYPE) return streamCorpusBatch(runBatch);
  const result = await runBatch();
  return result === null ? json({code:"session_ended_after_reservation"},403) : json(result);
}
