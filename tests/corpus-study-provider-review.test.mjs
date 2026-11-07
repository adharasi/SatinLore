import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCorpusProvider} from '../deploy/cloudflare/corpus-study.mjs';

const batch = {units:[
  {id:0,unitSha256:'0'.repeat(64),target:true},
  {id:1,unitSha256:'1'.repeat(64),target:false},
  {id:2,unitSha256:'2'.repeat(64),target:true}
]};
const label = id => ({d:'r',f:'c',b:'d',a:'q',p:'b',t:'n',v:[id],k:id});
const row = id => ({i:id,s:'c',c:label(id),r:label(id),
  e:{s:'e',a:'a',c:'p',k:'p',v:[id]},q:90,z:[0]});
const payload = rows => ({status:'completed',output:[{type:'message',role:'assistant',
  content:[{type:'output_text',text:JSON.stringify({rows})}]}]});

test('review: omitted and duplicate targets remain explicit failures without losing other valid rows', () => {
  const missing = parseCorpusProvider(payload([row(0)]),batch);
  assert.equal(missing.status,'partial');
  assert.equal(missing.rows.length,2);
  assert.equal(missing.rows[0].status,'classified');
  assert.equal(missing.rows[1].failureCode,'missing_output');
  const duplicate = parseCorpusProvider(payload([row(0),row(0),row(2)]),batch);
  assert.equal(duplicate.rows[0].failureCode,'duplicate_output');
  assert.equal(duplicate.rows[1].status,'classified');
});

test('review: model free text and unknown target IDs never enter result rows', () => {
  const raw = row(0); raw.notes = 'untrusted-private-source-string';
  const result = parseCorpusProvider(payload([raw,row(99),row(2)]),batch);
  assert.equal(result.status,'partial');
  assert.equal(result.rows[0].failureCode,'invalid_schema');
  assert.equal(result.rows[1].status,'classified');
  assert.doesNotMatch(JSON.stringify(result),/untrusted-private-source-string/);
  assert.deepEqual(result.rows.map(item=>item.id),[0,2]);
});

test('review: classified protected research labels are distinct from provider refusal', () => {
  const protectedRow = row(0);
  protectedRow.e = {s:'p',a:'m',c:'u',k:'u',v:[0]};
  for (const scope of ['c','r']) {
    protectedRow[scope].a = 'p'; protectedRow[scope].p = 'q';
  }
  const result = parseCorpusProvider(payload([protectedRow,row(2)]),batch);
  assert.equal(result.status,'parsed');
  assert.equal(result.rows[0].retrospective.activation,'protected');
  assert.equal(result.rows[0].status,'classified');
  assert.equal(result.blockAll,undefined);
});

test('review: a protected eligibility decision cannot validate a cue', () => {
  const invalid = row(0); invalid.e.s = 'p'; invalid.e.a = 'm';
  const result = parseCorpusProvider(payload([invalid,row(2)]),batch);
  assert.equal(result.rows[0].failureCode,'cue_invariant');
  assert.equal(result.rows[0].retrospective.activation,'review');
  assert.equal(result.rows[1].status,'classified');
});

test('review: causal cue cannot borrow eligibility facts supplied after the target', () => {
  const invalid = row(0); invalid.e.v = [1];
  const result = parseCorpusProvider(payload([invalid,row(2)]),batch);
  assert.equal(result.rows[0].status,'partial');
  assert.equal(result.rows[0].failureCode,'future_eligibility_evidence');
  assert.equal(result.rows[0].causal.activation,'review');
  assert.equal(result.rows[0].retrospective.activation,'cue');
  assert.deepEqual(result.rows[0].scopeStatus,{causal:'invalid',retrospective:'classified',eligibility:'valid'});
});

test('review: invalid evidence timing and absent eligibility evidence cannot validate cues', () => {
  const timing = row(0); timing.c.k = 1;
  assert.equal(parseCorpusProvider(payload([timing,row(2)]),batch).rows[0].failureCode,'invalid_evidence_timing');
  const unsupported = row(0); unsupported.e.v = [];
  assert.equal(parseCorpusProvider(payload([unsupported,row(2)]),batch).rows[0].status,'failed');
});

test('review: refusal blocks submitted material and truncation never becomes a negative classification', () => {
  const refusal = parseCorpusProvider({status:'completed',output:[{type:'message',role:'assistant',
    content:[{type:'refusal',refusal:'untrusted provider prose'}]}]},batch);
  assert.equal(refusal.blockAll,true);
  assert.ok(refusal.rows.every(item=>item.status==='refused'&&item.failureCode==='provider_refusal'));
  assert.doesNotMatch(JSON.stringify(refusal),/untrusted provider prose/);
  const filtered = parseCorpusProvider({status:'incomplete',incomplete_details:{reason:'content_filter'}},batch);
  assert.equal(filtered.blockAll,true);
  const truncated = parseCorpusProvider({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},batch);
  assert.equal(truncated.status,'truncated');
  assert.ok(truncated.rows.every(item=>item.status==='failed'&&item.retrospective.activation==='review'));
});
