const API_URL = "https://api.openai.com/v1/responses";
const BUDGET_URL = "https://scene-analysis.internal/reserve";
const MODEL = "gpt-6-luna";
const MAX_CUES = 16;
const MAX_BODY_BYTES = 4096;
const DAY = 86_400_000;
const PHASE_LABELS = {
  build: ["build", "abstain"],
  sustain: ["steady", "wave", "abstain"],
  peak: ["crest", "accents", "abstain"],
  recover: ["taper", "abstain"],
};
const PHASES = ["quiet", ...Object.keys(PHASE_LABELS)];
const LABELS = [...new Set(Object.values(PHASE_LABELS).flat())];
const RHYTHMS = ["steady", "gentle", "dynamic"];
const SHAPES = ["unspecified", "accented", "sustained", "alternating"];
const CUE_FIELDS = ["id", "phase", "rhythm", "previous", "next", "movementCount", "shape"];
const INSTRUCTIONS = [
  "Choose timing labels for abstract rhythm cues using only the supplied categorical data. Return one label per ID.",
  "For build use build; for recover use taper. For sustain use steady when even or sustained, or wave when alternation is indicated.",
  "For peak use crest for one sustained arc or a clear rise and release, and accents for a distinctly alternating or accented peak.",
  "Neighboring phases and movement count provide context; they do not override direct shape evidence. Choose abstain when the evidence does not distinguish the eligible labels.",
  "Keep the IDs and phases as given. Return only the structured labels.",
].join(" ");
const FORMAT = {
  type: "json_schema", name: "scene_timing_labels", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["labels"], properties: {
    labels: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label"], properties: {
      id: { type: "integer" }, label: { type: "string", enum: LABELS },
    } } },
  } },
};

function exactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

async function readBoundedJson(message, maxBytes, signal) {
  const type = message.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  const length = message.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await message.body?.cancel();
    throw new RangeError("Size limit exceeded.");
  }
  if (type !== "application/json" || !message.body) {
    await message.body?.cancel();
    throw new TypeError("Expected JSON.");
  }
  const reader = message.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (size + value.byteLength > maxBytes) throw new RangeError("Size limit exceeded.");
      bytes.set(value, size);
      size += value.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

function normalizeCues(value) {
  if (!exactObject(value, ["cues"]) || !Array.isArray(value.cues) || value.cues.length < 1 || value.cues.length > MAX_CUES) return null;
  const seen = new Set();
  for (const cue of value.cues) {
    if (!exactObject(cue, CUE_FIELDS) || !Number.isInteger(cue.id) || cue.id < 0 || cue.id > 1999 || seen.has(cue.id) ||
        typeof cue.phase !== "string" || !Object.hasOwn(PHASE_LABELS, cue.phase) || !RHYTHMS.includes(cue.rhythm) ||
        !PHASES.includes(cue.previous) || !PHASES.includes(cue.next) || !SHAPES.includes(cue.shape) ||
        !Number.isInteger(cue.movementCount) || cue.movementCount < 0 || cue.movementCount > 5) return null;
    seen.add(cue.id);
  }
  // Rebuild from typed primitives at the final outbound boundary. IDs are
  // short-lived request-local handles, independent of each paragraph's text.
  return value.cues.map(({ id, phase, rhythm, previous, next, movementCount, shape }) =>
    ({ id, phase, rhythm, previous, next, movementCount, shape }));
}

function failure(code, status, error, headers) {
  return Response.json({ error, code }, { status, headers });
}
const providerUnavailable = (session, diagnostic) => failure(session?.isFounder && diagnostic ? diagnostic : "provider_unavailable", 503,
  "Nocturne is temporarily unavailable. The local analysis is still available.");
const invalidResult = session => failure(session.isFounder ? "provider_response_invalid" : "invalid_result", 502,
  "Nocturne did not return usable labels. The local analysis is still available.");
const declined = () => failure("refused", 422, "Nocturne declined this analysis. The local analysis is still available.");

async function rejectedProviderResponse(response, session, signal) {
  const { status } = response;
  // Only known codes/fields can become a fixed diagnostic. Never relay the body.
  const body = session.isFounder && [400, 429].includes(status)
    ? await readBoundedJson(response, 4096, signal).catch(() => null) : null;
  await response.body?.cancel().catch(() => {});
  const { code, param } = body?.error ?? {};
  if (status === 401) return providerUnavailable(session, "provider_key_rejected");
  if (status === 403 || status === 404 || code === "model_not_found") return providerUnavailable(session, "provider_model_access");
  if (status === 429) return providerUnavailable(session, ["insufficient_quota", "billing_hard_limit_reached"].includes(code)
    ? "provider_billing_limit" : "provider_rate_limit");
  if (status === 400 || status === 422) return providerUnavailable(session,
    param === "prompt_cache_options" || param === "prompt_cache_options.mode" ? "provider_cache_option" : "provider_request_rejected");
  if (status === 408 || status === 504) return providerUnavailable(session, "provider_timeout");
  return providerUnavailable(session, "provider_service_error");
}

function checkedLabels(response, cues, session) {
  const invalid = () => ({ error: invalidResult(session) });
  if (response?.incomplete_details?.reason === "content_filter") return { error: declined() };
  if (!Array.isArray(response?.output)) return invalid();
  const parts = response.output.filter(item => item?.type === "message" && item.role === "assistant")
    .flatMap(item => Array.isArray(item.content) ? item.content : []);
  if (parts.some(part => part?.type === "refusal")) return { error: declined() };
  if (response.status !== "completed" || parts.length !== 1 || parts[0]?.type !== "output_text" || typeof parts[0].text !== "string") {
    return invalid();
  }
  let result;
  try { result = JSON.parse(parts[0].text); } catch { return invalid(); }
  if (!exactObject(result, ["labels"]) || !Array.isArray(result.labels) || result.labels.length !== cues.length) return invalid();
  const candidates = new Map(cues.map(cue => [cue.id, PHASE_LABELS[cue.phase]]));
  const labels = new Map();
  for (const item of result.labels) {
    if (!exactObject(item, ["id", "label"]) || !candidates.get(item.id)?.includes(item.label) || labels.has(item.id)) return invalid();
    labels.set(item.id, item.label);
  }
  return { labels: cues.map(({ id }) => ({ id, label: labels.get(id) })) };
}

async function reserveBudget(namespace, config, session) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`satinlore:scene-budget:v1:${config.issuer}:${session.subject}`));
  const reader = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const stub = namespace.get(namespace.idFromName("scene-analysis:v1"));
  return stub.fetch(new Request(BUDGET_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reader }),
  }));
}

export async function handleSceneAnalysis(request, env, { config, session, reverify, analysisFetcher = fetch }) {
  const url = new URL(request.url);
  const read = request.method === "GET" || request.method === "HEAD";
  if (!read && request.method !== "POST") return failure("invalid_method", 405, "Use the story model controls.", { Allow: "GET, HEAD, POST" });
  if (url.search) return failure("invalid_request", 400, "Use the story model controls.");
  const origin = request.headers.get("Origin");
  if (((!read || origin !== null) && origin !== config.origin) || ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) {
    return failure("invalid_origin", 403, "Open Nocturne on the SatinLore app.");
  }
  const key = env.OPENAI_API_KEY;
  const budget = env.SCENE_ANALYSIS_BUDGET;
  const available = typeof key === "string" && /^sk-[A-Za-z0-9_-]{12,512}$/.test(key) && !key.startsWith("sk-admin-") &&
    typeof budget?.idFromName === "function" && typeof budget.get === "function";
  if (read) return Response.json({ available });
  if (!available) return failure("unavailable", 503, "Nocturne is not configured. The local analysis is still available.");
  let cues;
  try { cues = normalizeCues(await readBoundedJson(request, MAX_BODY_BYTES, AbortSignal.timeout(4000))); }
  catch (error) {
    if (error instanceof RangeError) return failure("invalid_request", 413, "The scene cues exceed the request limit.");
  }
  if (!cues) return failure("invalid_request", 400, "Send only the supported scene cues.");
  if (request.signal.aborted || Date.now() >= session.expiresAt) return failure("invalid_session", 403, "Your app session has ended.");
  let permission;
  try { permission = await reserveBudget(budget, config, session); }
  catch { return providerUnavailable(session, "budget_unavailable"); }
  if (permission.status === 429) {
    const retry = permission.headers.get("Retry-After");
    return failure("rate_limited", 429, "Nocturne has reached the beta usage limit. The local analysis is still available.",
      { "Retry-After": retry && /^\d{1,7}$/.test(retry) ? retry : "60" });
  }
  if (permission.status !== 204) return providerUnavailable(session, "budget_unavailable");
  if (request.signal.aborted || Date.now() >= session.expiresAt) return failure("invalid_session", 403, "Your app session has ended.");
  const timeout = AbortSignal.timeout(9000);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const response = await analysisFetcher(API_URL, {
      method: "POST", signal, redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        model: MODEL, instructions: INSTRUCTIONS, input: JSON.stringify({ cues }), text: { format: FORMAT },
        store: false, prompt_cache_options: { mode: "explicit" }, reasoning: { effort: "none" }, max_output_tokens: 600,
      }),
    });
    if (!response.ok) return await rejectedProviderResponse(response, session, signal);
    let parsed;
    try { parsed = await readBoundedJson(response, 24_576, signal); }
    catch { return signal.aborted ? providerUnavailable(session, timeout.aborted ? "provider_timeout" : undefined) : invalidResult(session); }
    const renewed = await reverify();
    if (!renewed || renewed.subject !== session.subject || Date.now() >= renewed.expiresAt || request.signal.aborted) {
      return failure("invalid_session", 403, "Your app session has ended.");
    }
    const result = checkedLabels(parsed, cues, session);
    return result.error ?? Response.json({ labels: result.labels });
  } catch (error) {
    // Provider errors, internal responses and secrets never enter UI or logs.
    return providerUnavailable(session, timeout.aborted || error?.name === "TimeoutError" ? "provider_timeout" : "provider_connection");
  }
}

/** Deployment-wide spending gate. Stores only expiring counts for UTC windows. */
export class SceneAnalysisBudget {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS quota (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, count INTEGER NOT NULL)");
  }

  async scheduleExpiry() {
    const next = this.sql.exec("SELECT MIN(expires_at) AS next FROM quota").one().next;
    if (Number.isSafeInteger(next)) await this.storage.setAlarm(next);
  }

  async fetch(request) {
    if (request.url !== BUDGET_URL || request.method !== "POST") return new Response(null, { status: 404 });
    try {
      const value = await readBoundedJson(request, 256, AbortSignal.timeout(3000));
      if (!exactObject(value, ["reader"]) || typeof value.reader !== "string" || !/^[a-f0-9]{64}$/.test(value.reader)) return new Response(null, { status: 400 });
      const now = Date.now();
      const date = new Date(now);
      const dayEnds = (Math.floor(now / DAY) + 1) * DAY;
      const monthEnds = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      const windows = [
        { key: `reader:${value.reader}`, expires: dayEnds, limit: 12 },
        { key: "global-day", expires: dayEnds, limit: 100 },
        { key: "global-month", expires: monthEnds, limit: 1000 },
      ];
      const retryAt = this.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM quota WHERE expires_at<=?", now);
        const limited = windows.filter(({ key, limit }) => (this.sql.exec("SELECT count FROM quota WHERE key=?", key).toArray()[0]?.count ?? 0) >= limit);
        if (limited.length) return Math.max(...limited.map(window => window.expires));
        for (const { key, expires } of windows) this.sql.exec("INSERT INTO quota(key,expires_at,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1", key, expires);
        return 0;
      });
      await this.scheduleExpiry();
      return retryAt ? new Response(null, { status: 429, headers: { "Retry-After": String(Math.ceil((retryAt - now) / 1000)) } }) :
        new Response(null, { status: 204 });
    } catch { return new Response(null, { status: 503 }); }
  }

  async alarm() {
    this.sql.exec("DELETE FROM quota WHERE expires_at<=?", Date.now());
    await this.scheduleExpiry();
  }
}
