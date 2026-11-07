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
  const result = parseCorpusProvider(payload([unsupported,row(2)]),batch).rows[0];
  assert.equal(result.status,'partial');
  assert.deepEqual(result.scopeStatus,{causal:'invalid',retrospective:'invalid',eligibility:'valid'});
  assert.equal(result.causal.activation,'review');
  assert.equal(result.retrospective.depiction,'romantic');
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

test('noncue phase projection keeps the classification and records the provider proposal', () => {
  const context = row(0);
  context.c.a = 'c'; context.c.t = 's';
  context.r.a = 'r';
  const protectedRow = row(2);
  protectedRow.e = {s:'p',a:'m',c:'u',k:'u',v:[2]};
  protectedRow.c.a = 'p'; protectedRow.r.a = 'p';
  const parsed = parseCorpusProvider(payload([context,protectedRow]),batch);
  assert.equal(parsed.status,'parsed');
  const [a,b] = parsed.rows;
  assert.equal(a.causal.phase,'quiet');
  assert.equal(a.causal.transition,'stop');
  assert.equal(a.retrospective.phase,'unknown');
  assert.equal(b.causal.activation,'protected');
  assert.equal(b.causal.phase,'quiet');
  assert.equal(a.proposed.causal.phase,'build');
  assert.equal(a.failureCode,null);
  assert.ok(a.decodeIssues.some(issue => issue.code === 'noncue_phase_normalized' && issue.severity === 'normalized'));
});

test('transition and activation evidence failures are isolated by field', () => {
  const validCue = row(0); validCue.c.t = 'unsupported-transition-code';
  const invalidCue = row(2); invalidCue.c.p = 'q'; invalidCue.c.t = 's';
  const [a,b] = parseCorpusProvider(payload([validCue,invalidCue]),batch).rows;
  assert.equal(a.scopeStatus.causal,'classified');
  assert.equal(a.causal.activation,'cue');
  assert.equal(a.causal.transition,'unknown');
  assert.equal(a.fieldStatus.causal.transition,'unresolved');
  assert.equal(b.scopeStatus.causal,'invalid');
  assert.equal(b.causal.activation,'review');
  assert.equal(b.causal.transition,'stop');
  assert.equal(b.fieldStatus.causal.transition,'applied');
  assert.equal(b.proposed.causal.activation,'cue');
});

test('bounded surplus provider rows never erase requested rows or qualify context', () => {
  const unrelated = Array.from({length:70},(_,i)=>row(i+10));
  const parsed = parseCorpusProvider(payload([row(0),...unrelated,row(2)]),batch);
  assert.equal(parsed.status,'partial');
  assert.equal(parsed.rejected,70);
  assert.deepEqual(parsed.rows.map(row=>[row.id,row.status]),[[0,'classified'],[2,'classified']]);
  assert.ok(parsed.decodeIssues.every(issue=>issue.code==='unexpected_target_id'));
});

test('a refused target stays refused when other returned fields conflict with the refusal', () => {
  const refused = row(0); refused.s = 'r';
  const parsed = parseCorpusProvider(payload([refused,row(2)]),batch);
  assert.deepEqual(parsed.refusedIds,[0]);
  assert.equal(parsed.rows[0].status,'refused');
  assert.equal(parsed.rows[0].causal.activation,'review');
  assert.equal(parsed.rows[0].retrospective.transition,'unknown');
  assert.equal(parsed.rows[0].eligibility.status,'uncertain');
  assert.equal(parsed.rows[1].status,'classified');
});
