import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {handleCorpusBudget, initializeCorpusBudget} from '../deploy/cloudflare/corpus-study-budget.mjs';

const DAY = 86_400_000;
const OWNER = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const BATCH = '1'.repeat(64), NEXT = '2'.repeat(64), UNIT = '3'.repeat(64);
function fixture() {
  const db = new DatabaseSync(':memory:');
  const state = {sql: {exec(query, ...params) {
    const statement = db.prepare(query);
    const rows = statement.columns().length ? statement.all(...params) : (statement.run(...params), []);
    return {toArray: () => rows, one() {assert.equal(rows.length, 1); return rows[0];}};
  }}, storage: {transactionSync(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const result = fn(); db.exec('COMMIT'); return result;}
    catch (error) {db.exec('ROLLBACK'); throw error;}
  }}, async scheduleExpiry() {}};
  initializeCorpusBudget(state.sql);
  return {state, db};
}
async function invoke(f, operation, input, now = 100 * DAY + 1000) {
  const original = Date.now;
  Date.now = () => now;
  try {return await send(f, operation, input);} finally {Date.now = original;}
}
async function send(f, operation, input) {
  const response = await handleCorpusBudget(new Request('https://scene-analysis.internal/corpus/' + operation,
    {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)}), f.state);
  return {status:response.status, body:await response.json()};
}
const registration = (runId = 'run-a', reader = OWNER) => ({reader, runId, manifest:[BATCH, NEXT]});
const reservation = (runId = 'run-a', batchHash = BATCH, reader = OWNER) =>
  ({reader, runId, batchHash, reserveMicros:1000, unitHashes:[UNIT]});
const settlement = (usage, runId = 'run-a', batchHash = BATCH, refusedHashes = []) =>
  ({reader:OWNER, runId, batchHash, usage, refusedHashes});

test('review: immutable manifest, owner and duplicate attempt isolation', async () => {
  const f = fixture();
  assert.equal((await invoke(f, 'register', registration())).status, 200);
  assert.equal((await invoke(f, 'register', {...registration(), manifest:[NEXT]})).status, 409);
  assert.equal((await invoke(f, 'reserve', reservation('run-a', BATCH, OTHER))).status, 403);
  assert.equal((await invoke(f, 'reserve', {...reservation(), batchHash:'4'.repeat(64)})).status, 403);
  const originalClock = Date.now;
  let results;
  Date.now = () => 100 * DAY + 1000;
  try {results = await Promise.all([send(f, 'reserve', reservation()), send(f, 'reserve', reservation())]);}
  finally {Date.now = originalClock;}
  assert.deepEqual(results.map(r=>r.status).sort(), [200,409]);
  assert.equal(f.db.prepare('SELECT attempts FROM corpus_run WHERE id=?').get('run-a').attempts, 1);
  f.db.close();
});

test('review: unknown usage stays charged, repeated settlement cannot refund it', async () => {
  const f = fixture();
  await invoke(f, 'register', registration()); await invoke(f, 'reserve', reservation());
  assert.equal((await invoke(f, 'settle', settlement(null))).body.chargedMicros, 1000);
  assert.equal((await invoke(f, 'settle', settlement({inputTokens:0,outputTokens:0}))).body.chargedMicros, 1000);
  assert.equal(f.db.prepare('SELECT micros FROM corpus_run WHERE id=?').get('run-a').micros, 1000);
  f.db.close();
});

test('review: refused source coordinates block later roles and runs for the same owner', async () => {
  const f = fixture();
  await invoke(f, 'register', registration()); await invoke(f, 'reserve', reservation());
  await invoke(f, 'settle', settlement(null,'run-a',BATCH,[UNIT]));
  const unaffected = '6'.repeat(64), cleanBatch = '5'.repeat(64);
  const dependent = await invoke(f, 'reserve', {...reservation('run-a',NEXT),unitHashes:[UNIT,unaffected]});
  assert.equal(dependent.status, 422);
  assert.deepEqual(dependent.body.blockedUnitKeys, [UNIT]);
  await invoke(f, 'register', {...registration('run-b'),manifest:[NEXT,cleanBatch]});
  assert.equal((await invoke(f, 'reserve', reservation('run-b',NEXT))).status, 422);
  assert.equal((await invoke(f, 'reserve', {...reservation('run-b',cleanBatch),unitHashes:[unaffected]})).status, 200);
  f.db.close();
});

test('review: restarting a run does not reset the owner daily spending limit', async () => {
  const f = fixture();
  await invoke(f, 'register', registration());
  f.db.prepare('INSERT INTO corpus_day(owner,day,expires_at,attempts,micros) VALUES(?,?,?,?,?)')
    .run(OWNER,100,101*DAY,10,15_000_000);
  await invoke(f, 'register', registration('run-b'));
  assert.equal((await invoke(f, 'reserve', reservation('run-b'))).status, 429);
  assert.equal(f.db.prepare('SELECT attempts FROM corpus_run WHERE id=?').get('run-b').attempts, 0);
  f.db.close();
});

test('review: settlement charges the attempt day when a run resumes on a later UTC day', async () => {
  const f = fixture();
  await invoke(f, 'register', registration(), 100*DAY+1000);
  await invoke(f, 'reserve', reservation(), 101*DAY+1000);
  await invoke(f, 'settle', settlement({inputTokens:100,outputTokens:20}), 101*DAY+2000);
  assert.equal(f.db.prepare('SELECT micros FROM corpus_day WHERE owner=? AND day=?').get(OWNER,101).micros, 20);
  f.db.close();
});
