import { buildWholeStoryIndex, planIndexedWholeStoryContext, WHOLE_STORY_GRANT_PURPOSE } from "../../scripts/lib/whole-story-context-planning.mjs";
import { createLunaProtocolProvider, LUNA_PROTOCOL_MODEL, LUNA_PROTOCOL_RUBRIC_VERSION } from "../../scripts/lib/luna-protocol-provider.mjs";
import { createLunaShadowBudget, runLunaProtocolShadow } from "../../scripts/lib/luna-protocol-shadow.mjs";
import { analysisConfigured, budgetReader, neutralSpend, NEUTRAL_RUN_CAP_MICROS, readBoundedJson, studyId } from "./scene-analysis.mjs";
import { LUNA_CORPUS_CLIENT, LUNA_CORPUS_PAGE } from "./luna-corpus-client.mjs";

export const LUNA_CORPUS_PATH = "/api/scene-analysis/luna-corpus";
const API = "https://api.openai.com/v1/responses";
const MAX_UNITS = 24;
const MAX_TARGETS = 6;
const MAX_CLIP_BYTES = 6000;
const CLIP_LIMITS = {maxRequests: 1, maxTargetsPerWindow: MAX_UNITS, maxWindowSourceBytes: MAX_CLIP_BYTES};
const encoder = new TextEncoder();
const integer = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const fail = (code, status) => Response.json({code}, {status});

async function digest(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateLunaCorpusClip(value) {
  if (!exact(value, ["id", "storyId", "sourceSha256", "editionDigest", "units", "targetIds"]) || !studyId(value.id) ||
      typeof value.storyId !== "string" || !/^[a-z0-9-]{1,48}$/.test(value.storyId) || !hash(value.sourceSha256) || !hash(value.editionDigest) ||
      !Array.isArray(value.units) || !value.units.length || value.units.length > MAX_UNITS ||
      !Array.isArray(value.targetIds) || !value.targetIds.length || value.targetIds.length > MAX_TARGETS) throw new TypeError("Invalid clip.");
  let text = "", bytes = 0, previous = null;
  const units = [];
  for (const unit of value.units) {
    if (!exact(unit, ["id", "paragraph", "byteStart", "byteEnd", "digest", "text"]) || !integer(unit.id) || unit.id > 50_000 ||
        !integer(unit.paragraph) || !integer(unit.byteStart) || !integer(unit.byteEnd) || !hash(unit.digest) ||
        typeof unit.text !== "string" || !unit.text.trim() || !unit.text.isWellFormed() || unit.text.includes("\u0000") ||
        previous && (unit.id !== previous.id + 1 || unit.paragraph < previous.paragraph || unit.byteStart < previous.byteEnd)) {
      throw new TypeError("Invalid clip unit.");
    }
    const size = encoder.encode(unit.text).byteLength;
    bytes += size;
    if (bytes > MAX_CLIP_BYTES || unit.byteEnd - unit.byteStart !== size || await digest(unit.text) !== unit.digest) {
      throw new TypeError("Invalid clip unit digest.");
    }
    const { id, paragraph, byteStart, byteEnd, digest: unitDigest, text: exactText } = unit;
    units.push({id, paragraph, byteStart, byteEnd, digest: unitDigest, text: exactText});
    text += (previous ? previous.paragraph === unit.paragraph ? " " : "\n\n" : "") + exactText;
    previous = unit;
  }
  const first = units[0].id, last = units.at(-1).id;
  if (value.targetIds.some((id, position) => !integer(id) || id < first || id > last || position > 0 && id <= value.targetIds[position - 1])) {
    throw new TypeError("Invalid clip target.");
  }
  const index = buildWholeStoryIndex(text);
  if (index.units.length !== units.length || index.units.some((unit, position) => unit.structuralBoundary || unit.digest !== units[position].digest ||
      position > 0 && (unit.paragraph === index.units[position - 1].paragraph) !== (units[position].paragraph === units[position - 1].paragraph))) {
    throw new TypeError("Clip segmentation changed.");
  }
  const {id, storyId, sourceSha256, editionDigest, targetIds} = value;
  return {clip: {id, storyId, sourceSha256, editionDigest, units, targetIds}, text, index, first};
}

function mapResult(result, first) {
  const coordinate = value => integer(value) ? value + first : value;
  const coordinates = value => value?.map(coordinate);
  const named = value => value?.replace(/:(beat|scene):(\d+)$/u, (_, kind, id) => `:${kind}:${coordinate(Number(id))}`) ?? value;
  const boundary = row => ({...row, previousId: coordinate(row.previousId), entryId: coordinate(row.entryId),
    ...(Object.hasOwn(row, "changeId") ? {changeId: coordinate(row.changeId)} : {})});
  const evidence = row => row && {...row, unitId: coordinate(row.unitId), id: coordinate(row.id),
    scopeId: coordinate(row.scopeId), priorAnchor: coordinate(row.priorAnchor), evidenceIds: coordinates(row.evidenceIds),
    ...(row.sceneBoundary ? {sceneBoundary: boundary(row.sceneBoundary)} : {}),
    ...(row.sceneEntry ? {sceneEntry: boundary(row.sceneEntry)} : {}),
    ...(row.localAction ? {localAction: {...row.localAction, targetId: coordinate(row.localAction.targetId),
      contextId: coordinate(row.localAction.contextId)}} : {})};
  return {
    units: result.units.map(row => ({...evidence(row), knownAt: coordinate(row.knownAt), labelKnownAt: coordinate(row.labelKnownAt),
      labelEvidenceIds: coordinates(row.labelEvidenceIds), transitionEvidenceIds: coordinates(row.transitionEvidenceIds),
      beatId: named(row.beatId), sceneId: named(row.sceneId), discovery: evidence(row.discovery),
      primaryPrefix: evidence(row.primaryPrefix), transitionVerification: evidence(row.transitionVerification),
      boundaryVerification: evidence(row.boundaryVerification), localActionVerification: evidence(row.localActionVerification),
      sceneEntryVerification: evidence(row.sceneEntryVerification), cueRecovery: evidence(row.cueRecovery),
      trace: {...row.trace, beat: named(row.trace.beat), scene: named(row.trace.scene), knownAt: coordinate(row.trace.knownAt),
        evidence: coordinates(row.trace.evidence)}})),
    summary: {...result.summary, nativeVerification: result.summary.nativeVerification.map(row => ({...row, id: coordinate(row.id)})),
      supportingVerification: result.summary.supportingVerification?.map(row => ({...row, id: coordinate(row.id)})),
      attempts: result.summary.attempts.map(row => ({...row, targetIds: coordinates(row.targetIds), contextIds: coordinates(row.contextIds),
        attestedIds: coordinates(row.attestedIds), rejectedFacts: row.rejectedFacts?.map(item => ({...item, id: coordinate(item.id)})),
        normalizedFacts: row.normalizedFacts?.map(item => ({...item, id: coordinate(item.id)}))}))},
  };
}

export async function handleLunaCorpus(request, env, {config, session, reverify, analysisFetcher = fetch}) {
  if (!session.isFounder || request.signal.aborted || Date.now() >= session.expiresAt) return fail("invalid_session", 403);
  const url = new URL(request.url), read = ["GET", "HEAD"].includes(request.method), origin = request.headers.get("Origin");
  if (url.origin !== config.origin || url.search || (!read || origin !== null) && origin !== config.origin ||
      ["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) return fail("invalid_origin", 403);
  if (read) {
    if (url.pathname === LUNA_CORPUS_PATH) return new Response(LUNA_CORPUS_PAGE, {headers: {"Content-Type": "text/html; charset=utf-8"}});
    if (url.pathname === `${LUNA_CORPUS_PATH}/client.mjs`) return new Response(LUNA_CORPUS_CLIENT, {headers: {"Content-Type": "text/javascript; charset=utf-8"}});
    return fail("not_found", 404);
  }
  const approve = url.pathname === `${LUNA_CORPUS_PATH}/approve`;
  if (request.method !== "POST" || !approve && url.pathname !== `${LUNA_CORPUS_PATH}/shard`) return fail("invalid_method", 405);
  const apiKey = env.OPENAI_API_KEY, namespace = env.SCENE_ANALYSIS_BUDGET;
  if (!analysisConfigured(apiKey, namespace)) return fail("study_unavailable", 503);
  const deadline = AbortSignal.timeout(Math.max(0, Math.min(120_000, session.expiresAt - Date.now())));
  const signal = AbortSignal.any([request.signal, deadline]);
  const authorized = async () => {
    if (signal.aborted) return false;
    const renewed = await reverify();
    return !signal.aborted && renewed?.isFounder === true && renewed.subject === session.subject && Date.now() < renewed.expiresAt;
  };
  let input;
  try { input = await readBoundedJson(request, approve ? 24_000 : 65_536, AbortSignal.any([signal, AbortSignal.timeout(5000)])); }
  catch (error) { return fail(error instanceof RangeError ? "input_limit" : "invalid_request", error instanceof RangeError ? 413 : 400); }
  if (!studyId(input?.runId)) return fail("invalid_request", 400);
  const {runId} = input;
  const common = {reader: await budgetReader(config, session), runId, rubricVersion: LUNA_PROTOCOL_RUBRIC_VERSION};
  const spend = (payload, limit = signal) => neutralSpend(namespace, {...common, ...payload}, limit).catch(() => ({status: 503}));
  const ledgerError = result => fail(result.code ?? (result.status === 429 ? "spend_cap" : "budget_unavailable"), result.status);
  if (approve) {
    if (!exact(input, ["runId", "clips", "reviewConfirmed"]) || input.reviewConfirmed !== true || !Array.isArray(input.clips) ||
        !input.clips.length || input.clips.length > 123 || !input.clips.every(row => exact(row, ["id", "digest"]) && studyId(row.id) && hash(row.digest)) ||
        new Set(input.clips.map(row => row.id)).size !== input.clips.length) return fail("invalid_manifest", 400);
    if (!await authorized()) return fail("invalid_session", 403);
    const approval = await spend({operation: "approve-reviewed", clips: input.clips});
    if (approval.status !== 200) return ledgerError(approval);
    return Response.json({schema: 1, runId, clipCount: input.clips.length, expiresAt: approval.expiresAt});
  }
  if (!exact(input, ["runId", "clip"])) return fail("invalid_request", 400);
  let clip, text, index, first, clipDigest, grant;
  try {
    ({clip, text, index, first} = await validateLunaCorpusClip(input.clip));
    clipDigest = await digest(JSON.stringify(clip));
    grant = {editionDigest: index.editionDigest, segmentationVersion: index.segmentationVersion, purpose: WHOLE_STORY_GRANT_PURPOSE,
      expiresAt: Date.now() + 125_000, spans: index.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
    if (planIndexedWholeStoryContext(index, {grant, limits: CLIP_LIMITS}).summary.plannedTargets !== clip.units.length) {
      throw new TypeError("Clip exceeds discovery window.");
    }
  } catch { return fail("invalid_clip", 400); }
  if (!await authorized()) return fail("invalid_session", 403);
  const shard = {shardId: clip.id, clipDigest};
  const reservation = await spend({...shard, operation: "reserve-reviewed"});
  if (reservation.status !== 200) return ledgerError(reservation);
  grant.expiresAt = Math.min(grant.expiresAt, reservation.expiresAt);
  const execution = AbortSignal.any([signal, AbortSignal.timeout(Math.max(0, reservation.expiresAt - Date.now()))]);
  const targets = clip.targetIds.map(id => id - first);
  const maxCueChecks = Math.min(2, targets.length);
  const maxSupportingVerification = Math.min(2, index.units.length - targets.length);
  const maxAttempts = 1 + 4 * targets.length + maxCueChecks + maxSupportingVerification;
  const budget = createLunaShadowBudget({maxAttempts, maxSourceBytes: 160_000, maxMicros: reservation.shardCapMicros});
  let externalCalls = 0, terminal, result;
  try {
    const provider = createLunaProtocolProvider({apiKey, fetchImpl: async (target, options) => {
      const callSignal = options?.signal ? AbortSignal.any([execution, options.signal]) : execution;
      callSignal.throwIfAborted();
      if (target !== API || options?.method !== "POST" || typeof options.body !== "string" || encoder.encode(options.body).byteLength > 131_072 ||
          terminal || externalCalls >= maxAttempts || !await authorized()) throw new Error("Study dispatch blocked.");
      callSignal.throwIfAborted();
      externalCalls++;
      const response = await analysisFetcher(API, {method: "POST", signal: callSignal, redirect: "manual",
        headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Cache-Control": "no-store"}, body: options.body});
      if ([401, 403, 404, 429].includes(response.status)) terminal = "provider-unavailable";
      return response;
    }});
    result = await runLunaProtocolShadow({id: clip.storyId, text, sourceSha256: clip.sourceSha256, grant, provider, budget,
      signal: execution, limits: CLIP_LIMITS, prefixUnits: MAX_UNITS, maxVerification: targets.length,
      verificationTargets: targets, verifyTransitions: true, maxTransitionVerification: targets.length,
      transitionTargets: targets, localActionVerificationTargets: targets, sceneEntryVerificationTargets: targets,
      maxCueChecks, maxSupportingVerification,
      verifyContinuityBoundary: true});
  } catch { /* Preserve the full reservation when execution cannot report its outcome. */ }
  const outcome = budget.snapshot();
  const refused = result?.summary.attempts.some(row => row.status === "provider-refused") === true;
  const status = refused ? "provider-refused" : terminal ?? (execution.aborted ? "timed-out" : outcome.spendLimited ? "spend-cap" : "completed");
  const settlement = await spend({...shard, operation: "settle-reviewed", providerRefused: refused || Boolean(terminal),
    usedMicros: result ? outcome.chargedMicros + outcome.reservedMicros : reservation.shardCapMicros}, AbortSignal.timeout(3000));
  if (!await authorized()) return fail(request.signal.aborted || Date.now() >= session.expiresAt ? "invalid_session" : "study_timeout", deadline.aborted ? 504 : 403);
  if (!result) return fail("shard_outcome_unknown", 503);
  return Response.json({schema: 1, runId, clipId: clip.id, clipDigest, storyId: clip.storyId, sourceSha256: clip.sourceSha256,
    editionDigest: clip.editionDigest, model: LUNA_PROTOCOL_MODEL, rubricVersion: LUNA_PROTOCOL_RUBRIC_VERSION, status,
    externalCalls, ...mapResult(result, first), hostedSpend: {capMicros: NEUTRAL_RUN_CAP_MICROS, shardCapMicros: reservation.shardCapMicros,
      settled: settlement.status === 200, remainingMicros: settlement.remainingMicros, expiresAt: reservation.expiresAt}});
}
