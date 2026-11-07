// This ledger retains opaque research identifiers, source digests and usage only.
// It never receives source text, provider labels, authentication tokens or errors.
export const CORPUS_BUDGET_ORIGIN = "https://scene-analysis.internal";
export const CORPUS_BUDGET_LIMITS = Object.freeze({ attempts: 1500, micros: 15_000_000, lifetimeMs: 7 * 86_400_000, concurrency: 12 });
export const CORPUS_RECONCILE_MAX_BATCHES = 64;
export const CORPUS_ATTEMPT_STATES = Object.freeze(["complete", "refused", "inflight", "unknown", "absent"]);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(value);
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const distinctHashes = (value, max) => Array.isArray(value) && value.length > 0 && value.length <= max &&
  value.every(hash) && new Set(value).size === value.length;
const LEASE_MS = 150_000;

export function initializeCorpusBudget(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS corpus_run (id TEXT PRIMARY KEY, owner TEXT NOT NULL, manifest TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, micros INTEGER NOT NULL DEFAULT 0)");
  sql.exec("CREATE TABLE IF NOT EXISTS corpus_attempt (run_id TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, reserve INTEGER NOT NULL, charged INTEGER NOT NULL, reserved_day INTEGER NOT NULL, lease_until INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(run_id,digest))");
  sql.exec("CREATE TABLE IF NOT EXISTS corpus_block (owner TEXT NOT NULL, unit TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(owner,unit))");
  sql.exec("CREATE TABLE IF NOT EXISTS corpus_day (owner TEXT NOT NULL, day INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, micros INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner,day))");
}

export function corpusBudgetExpiry(sql) {
  return sql.exec("SELECT MIN(expires_at) AS next FROM (SELECT expires_at FROM corpus_run UNION ALL SELECT expires_at FROM corpus_attempt UNION ALL SELECT lease_until AS expires_at FROM corpus_attempt WHERE state='inflight' UNION ALL SELECT expires_at FROM corpus_block UNION ALL SELECT expires_at FROM corpus_day)").one().next;
}

export function pruneCorpusBudget(sql, now) {
  // A lost Worker response keeps its reservation and attempt identity. Only
  // the concurrency slot expires, so unrelated batches can still proceed.
  sql.exec("UPDATE corpus_attempt SET state='unknown' WHERE state='inflight' AND lease_until<=?",now);
  for (const table of ["corpus_run", "corpus_attempt", "corpus_block", "corpus_day"]) sql.exec(`DELETE FROM ${table} WHERE expires_at<=?`, now);
}

export async function handleCorpusBudget(request, state) {
  const url = new URL(request.url);
  if (url.origin !== CORPUS_BUDGET_ORIGIN || !url.pathname.startsWith("/corpus/") || request.method !== "POST") return null;
  const reply = (value, status = 200) => Response.json(value, { status });
  const readStatus = url.pathname === "/corpus/status";
  const bodyLimit = readStatus ? 8192 : 131072;
  let input;
  try {
    const length = request.headers.get("Content-Length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > bodyLimit)) return reply({code:"input_limit"}, 413);
    const reader = request.body?.getReader();
    if (!reader) return reply({code:"invalid_request"}, 400);
    const chunks = []; let bytes = 0;
    try { while (true) { const {done,value} = await reader.read(); if (done) break; bytes += value.byteLength;
      if (bytes > bodyLimit) { await reader.cancel(); return reply({code:"input_limit"},413); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const combined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) {combined.set(chunk, offset); offset += chunk.byteLength;}
    input = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(combined));
  } catch { return reply({code:"invalid_request"},400); }
  if (!hash(input?.reader) || !id(input?.runId)) return reply({code:"invalid_request"},400);
  const now = Date.now();
  if (readStatus) {
    if (url.search || !exact(input, ["reader", "runId", "batchIds"]) ||
      !distinctHashes(input.batchIds, CORPUS_RECONCILE_MAX_BATCHES)) return reply({code:"invalid_request"}, 400);
    return state.storage.transactionSync(() => {
      const run = state.sql.exec("SELECT manifest FROM corpus_run WHERE id=? AND owner=? AND expires_at>?",
        input.runId, input.reader, now).toArray()[0];
      if (!run) return reply({code:"unknown_run"}, 403);
      const manifest = new Set(JSON.parse(run.manifest));
      if (input.batchIds.some(batchId => !manifest.has(batchId))) return reply({code:"batch_not_pinned"}, 403);
      const batches = input.batchIds.map(batchId => {
        const attempt = state.sql.exec("SELECT state,lease_until FROM corpus_attempt WHERE run_id=? AND digest=?",
          input.runId, batchId).toArray()[0];
        if (!attempt) return {batchId, state:"absent"};
        const validState = CORPUS_ATTEMPT_STATES.includes(attempt.state) && attempt.state !== "absent";
        const leaseExpired = attempt.state === "inflight" && attempt.lease_until <= now;
        return {batchId, state:validState && !leaseExpired ? attempt.state : "unknown"};
      });
      return reply({runId:input.runId, batches});
    });
  }
  const day = Math.floor(now / 86_400_000), expires = now + CORPUS_BUDGET_LIMITS.lifetimeMs;
  const result = state.storage.transactionSync(() => {
    pruneCorpusBudget(state.sql, now);
    const run = state.sql.exec("SELECT * FROM corpus_run WHERE id=?", input.runId).toArray()[0];
    if (url.pathname === "/corpus/register") {
      if (!exact(input,["reader","runId","manifest"]) || !distinctHashes(input.manifest,1500)) return reply({code:"invalid_manifest"},400);
      const manifest = JSON.stringify(input.manifest);
      if (run) return run.owner === input.reader && run.manifest === manifest ? reply({registered:true,attempts:run.attempts,chargedMicros:run.micros}) : reply({code:"run_conflict"},409);
      const active = state.sql.exec("SELECT COUNT(*) AS total FROM corpus_run WHERE owner=?",input.reader).one().total;
      if (active >= 8) return reply({code:"run_limit"},429);
      state.sql.exec("INSERT INTO corpus_run(id,owner,manifest,expires_at) VALUES(?,?,?,?)",input.runId,input.reader,manifest,expires);
      return reply({registered:true,attempts:0,chargedMicros:0});
    }
    if (!run || run.owner !== input.reader) return reply({code:"unknown_run"},403);
    if (url.pathname === "/corpus/reserve") {
      if (!exact(input,["reader","runId","batchHash","reserveMicros","unitHashes"]) || !hash(input.batchHash) ||
        !distinctHashes(input.unitHashes,512) || !Number.isSafeInteger(input.reserveMicros) || input.reserveMicros < 1 || input.reserveMicros > 100000) return reply({code:"invalid_reservation"},400);
      if (!JSON.parse(run.manifest).includes(input.batchHash)) return reply({code:"batch_not_pinned"},403);
      const old = state.sql.exec("SELECT state FROM corpus_attempt WHERE run_id=? AND digest=?",input.runId,input.batchHash).toArray()[0];
      if (old) return reply({code:"already_attempted",state:old.state},409);
      const blockedUnitKeys = input.unitHashes.filter(unit => state.sql.exec("SELECT unit FROM corpus_block WHERE owner=? AND unit=?",input.reader,unit).toArray().length);
      if (blockedUnitKeys.length) return reply({code:"refusal_blocked",blockedUnitKeys},422);
      const daily = state.sql.exec("SELECT * FROM corpus_day WHERE owner=? AND day=?",input.reader,day).toArray()[0] ?? {attempts:0,micros:0};
      const inflight = state.sql.exec("SELECT COUNT(*) AS total FROM corpus_attempt a JOIN corpus_run r ON a.run_id=r.id WHERE r.owner=? AND a.state='inflight'",input.reader).one().total;
      if (inflight >= CORPUS_BUDGET_LIMITS.concurrency) return reply({code:"concurrency_limited"},429);
      if (run.attempts >= CORPUS_BUDGET_LIMITS.attempts || daily.attempts >= CORPUS_BUDGET_LIMITS.attempts ||
        run.micros + input.reserveMicros > CORPUS_BUDGET_LIMITS.micros || daily.micros + input.reserveMicros > CORPUS_BUDGET_LIMITS.micros) return reply({code:"budget_exhausted"},429);
      state.sql.exec("INSERT INTO corpus_attempt(run_id,digest,state,reserve,charged,reserved_day,lease_until,expires_at) VALUES(?,?,?,?,?,?,?,?)",input.runId,input.batchHash,"inflight",input.reserveMicros,input.reserveMicros,day,now+LEASE_MS,run.expires_at);
      state.sql.exec("UPDATE corpus_run SET attempts=attempts+1,micros=micros+? WHERE id=?",input.reserveMicros,input.runId);
      state.sql.exec("INSERT INTO corpus_day(owner,day,expires_at,attempts,micros) VALUES(?,?,?,?,?) ON CONFLICT(owner,day) DO UPDATE SET attempts=attempts+1,micros=micros+excluded.micros",input.reader,day,(day+1)*86_400_000,1,input.reserveMicros);
      return reply({reserved:true,reserveMicros:input.reserveMicros,attempts:run.attempts+1,chargedMicros:run.micros+input.reserveMicros});
    }
    if (url.pathname === "/corpus/settle") {
      if (!exact(input,["reader","runId","batchHash","usage","refusedHashes"]) || !hash(input.batchHash) ||
        !Array.isArray(input.refusedHashes) || input.refusedHashes.length > 512 || !input.refusedHashes.every(hash)) return reply({code:"invalid_settlement"},400);
      const old = state.sql.exec("SELECT * FROM corpus_attempt WHERE run_id=? AND digest=?",input.runId,input.batchHash).toArray()[0];
      if (!old) return reply({code:"unknown_attempt"},409);
      const blockRefused = () => {
        for (const unit of input.refusedHashes) state.sql.exec("INSERT INTO corpus_block(owner,unit,expires_at) VALUES(?,?,?) ON CONFLICT(owner,unit) DO UPDATE SET expires_at=MAX(expires_at,excluded.expires_at)",input.reader,unit,run.expires_at);
      };
      if (old.state !== "inflight") {
        if (old.state === "unknown" && input.refusedHashes.length) {
          blockRefused();
          state.sql.exec("UPDATE corpus_attempt SET state='refused' WHERE run_id=? AND digest=?",input.runId,input.batchHash);
        }
        return reply({settled:true,chargedMicros:old.charged});
      }
      const usage = input.usage;
      const measured = exact(usage,["inputTokens","outputTokens"]) && [usage.inputTokens,usage.outputTokens].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1_000_000);
      const charge = measured ? Math.ceil(usage.inputTokens*(usage.inputTokens>272000?0.20:0.10)+usage.outputTokens*(usage.inputTokens>272000?0.75:0.50)) : old.reserve;
      const delta = charge-old.charged;
      state.sql.exec("UPDATE corpus_attempt SET state=?,charged=? WHERE run_id=? AND digest=?",input.refusedHashes.length?"refused":measured?"complete":"unknown",charge,input.runId,input.batchHash);
      state.sql.exec("UPDATE corpus_run SET micros=micros+? WHERE id=?",delta,input.runId);
      // Settle against the reservation's UTC window even if the request crossed midnight.
      const reservedDay = old.reserved_day;
      state.sql.exec("UPDATE corpus_day SET micros=micros+? WHERE owner=? AND day=?",delta,input.reader,reservedDay);
      blockRefused();
      return reply({settled:true,measured,chargedMicros:charge});
    }
    return reply({code:"invalid_operation"},404);
  });
  await state.scheduleExpiry();
  return result;
}
