// Re-run a reviewed v46 or newer Luna corpus receipt with no provider calls.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {sha256} from "./lib/approved-beat-corpus.mjs";
import {caps, replay as simulate} from "./replay-luna-protocol-simulator.mjs";
import {assessReplayPlayback, pinFrozenTarget} from "./lib/luna-replay-reference.mjs";

const {values: paths} = parseArgs({options: {
  packet: {type: "string"}, receipt: {type: "string"}, baseline: {type: "string"}, candidate: {type: "string", default: "."},
  reference: {type: "string"}, roster: {type: "string"}, simulator: {type: "boolean"},
  "packet-sha256": {type: "string"}, "receipt-sha256": {type: "string"},
}});
if (!paths.packet || !paths.receipt || !paths.baseline || Boolean(paths.reference) !== Boolean(paths.roster) ||
    paths.simulator && !paths.reference) {
  throw Error("Use --packet, --receipt and --baseline. Pass --reference and --roster together for frozen scoring and --simulator for playback.");
}

const json = (path, pin) => {
  const bytes = readFileSync(path);
  if (pin && sha256(bytes) !== pin) throw Error("Benchmark file differs from its approved SHA-256.");
  return JSON.parse(bytes);
};
const packet = json(paths.packet, paths["packet-sha256"]);
const receipt = json(paths.receipt, paths["receipt-sha256"]);
const protocolVersion = /^nocturne-luna-protocol-v(4[6-9]|[5-9]\d|[1-9]\d{2,})$/u;
if (packet.schema !== 1 || receipt.schema !== 1 || packet.runId !== receipt.runId || receipt.sourceProseIncluded !== false ||
    receipt.measurement !== "live-corpus-luna" || !protocolVersion.test(receipt.rubricVersion)) {
  throw Error("Provide a matching reviewed packet and source-free v46-or-newer receipt.");
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function byId(rows) {
  const indexed = new Map(rows.map(row => [row.id, row]));
  if (indexed.size !== rows.length || indexed.has(undefined)) throw Error("Missing or duplicate benchmark coordinate.");
  return indexed;
}
const sent = byId(packet.clips);
const completed = byId(receipt.clips);
const replayClips = byId(receipt.replayClips);
const works = byId(receipt.works);
if ([...sent.keys()].some(id => !completed.has(id)) ||
    [...completed].some(([id, clip]) => !sent.has(id) && clip.status !== "withheld") ||
    [...replayClips.keys()].some(id => !sent.has(id) || completed.get(id).status === "withheld")) {
  throw Error("Receipt and packet clip rosters differ.");
}
const references = paths.reference && byId(json(paths.reference, "2218a5e851dd5621bc59cc6fbb1a4604acc09f25c9eb5919e590f6b77ce479f4").works);
const roster = paths.roster && byId(json(paths.roster, "cfb35bda6de5259549152f931a46b420a5a99cac53f45fb04555840bebdbbd55").works);

const factFields = {discovery: "discovery", verify: "primaryPrefix", transition: "transitionVerification", "cue-check": "cueRecovery",
  "scene-boundary": "boundaryVerification", "local-action": "localActionVerification", "scene-entry": "sceneEntryVerification",
  "scene-situation": "sceneSituationVerification", "scene-old-place": "sceneOldPlaceVerification", "scene-arrival": "sceneArrivalVerification"};
const specialFacts = {"material-time-witness": "sceneTimeWitness", "interruption-release": "interruptionReleaseVerification",
  "uncertain-continuation": "uncertainContinuationVerification", "continuation-repair": "interruptionContinuationVerification",
  "sustain-connector": "sustainConnectorVerification"};
const reasonFocus = {"opening-buildup": "buildup", "romantic-context": "buildup", "adjacent-start": "enactment", "restart-state": "restart-gate",
  "typed-start": "enactment", "continuity-boundary": "continuity-boundary", "primary-anchor-repair": "anchor-repair",
  "same-episode-boundary": "episode-boundary", "interruption-release": "interruption-release", "continuation-repair": "continuation-repair",
  "uncertain-continuation": "continuation-repair", "sustain-connector": "episode-boundary", "discovery-gap-support": "buildup",
  "auxiliary-continuation": "continuation-repair", "auxiliary-continuation-disagreement": "continuation-repair"};

const focusOf = record => record.focus ?? reasonFocus[record.cueCheckReason];
function requestKey(mode, targets, focus) {
  const specific = mode === "cue-check" && ["interruption-release", "continuation-repair", "episode-boundary"].includes(focus) ||
    mode === "scene-entry" && focus === "material-time-witness";
  return JSON.stringify([mode, targets, specific ? focus : null]);
}

function moveIds(value, move, fields) {
  return value && {...value, ...Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, move(value[key])]))};
}

function localFact(row, id, first, mode) {
  if (row.unitId !== undefined && row.unitId !== id || row.id !== undefined && row.id !== id) {
    throw Error("Saved model fact has the wrong target ID.");
  }
  const move = value => Number.isSafeInteger(value) ? value - first : value;
  const unitId = move(id);
  const boundary = moveIds(row.sceneBoundary, move, ["previousId", "changeId", "entryId"]);
  if (mode === "scene-boundary") return {unitId, sceneBoundary: boundary};
  if (mode === "local-action") return {unitId, localAction: moveIds(row.localAction, move, ["targetId", "contextId"])};
  if (mode === "scene-entry") return {unitId, sceneEntry: moveIds(row.sceneEntry, move, ["previousId", "changeId", "entryId"])};
  if (mode === "scene-situation") return {unitId, sceneSituation: moveIds(row.sceneSituation, move, ["earlierId", "currentId"])};
  if (["scene-old-place", "scene-arrival"].includes(mode)) return {unitId, scenePlace: moveIds(row.scenePlace, move, ["earlierId", "currentId"])};
  const fields = ["depiction", "frame", "narrativePhase", "action", "transition", "fact", "status"];
  return {unitId, ...Object.fromEntries(fields.map(field => [field, row[field]])), scopeId: move(row.scopeId),
    evidenceIds: row.evidenceIds.map(move), priorAnchor: move(row.priorAnchor), ...(boundary ? {sceneBoundary: boundary} : {})};
}

function recordedProvider(rows, attempts, first) {
  const available = new Map();
  for (const row of attempts.filter(row => row.attempted)) {
    const key = requestKey(row.mode, row.targetIds, focusOf(row));
    if (available.has(key)) throw Error("Duplicate attempted request in receipt.");
    available.set(key, row);
  }
  const differences = [], requests = [], served = new Set();
  const provider = async ({mode, units, targetIds, attested = [], focus}) => {
    const ids = targetIds.map(id => id + first);
    const contextIds = units.map(unit => unit.id + first).filter(id => !ids.includes(id));
    const attestedIds = attested.map(row => row.unitId + first);
    const key = requestKey(mode, ids, focus);
    const record = available.get(key);
    if (!record || served.has(key) || !same(contextIds, record.contextIds) || mode === "cue-check" && focusOf(record) !== focus) {
      differences.push({mode, targetIds: ids, contextIds, focus, reason: "request-has-no-matching-receipt"});
      return {status: "not-dispatched"};
    }
    if (mode !== "discovery" && !same(attestedIds, record.attestedIds ?? [])) {
      differences.push({mode, targetIds: ids, focus, reason: "attested-prefix-differs", recorded: record.attestedIds ?? [], replayed: attestedIds});
      return {status: "not-dispatched"};
    }
    served.add(key);
    requests.push({mode, targetIds: ids, contextIds, attested, focus, reason: record.cueCheckReason});
    const response = {status: record.status, usage: record.usage, failureReason: record.failureReason, returnedModel: record.returnedModel};
    const localFailures = (entries = []) => entries.map(({id, ...details}) => ({unitId: id - first, ...details}));
    if (record.rejectedFacts) response.targetFailures = localFailures(record.rejectedFacts);
    if (record.normalizedFacts) response.targetNormalizations = localFailures(record.normalizedFacts);
    if (record.status === "provider-refused") response.status = "refused";
    if (["returned", "partial"].includes(record.status)) {
      response.status = record.status === "returned" ? "ok" : "partial";
      const rejected = new Set((record.rejectedFacts ?? []).map(({id}) => id));
      const field = specialFacts[record.cueCheckReason] ?? specialFacts[focus] ?? factFields[mode];
      response.facts = ids.filter(id => !rejected.has(id)).flatMap(id => {
        const fact = rows.get(id)?.[field];
        if (fact) return [localFact(fact, id, first, mode)];
        differences.push({mode, targetIds: [id], focus, reason: "accepted-fact-missing-from-receipt"});
        return [];
      });
    }
    return response;
  };
  provider.sceneBoundaryProtocol = true;
  const unserved = () => [...available].filter(([key]) => !served.has(key)).map(([, row]) =>
    ({mode: row.mode, targetIds: row.targetIds, focus: focusOf(row), reason: row.cueCheckReason}));
  return {provider, differences, requests, unserved};
}

async function load(tree) {
  const modules = ["deploy/cloudflare/luna-corpus.mjs", "scripts/lib/luna-protocol-shadow.mjs", "scripts/lib/luna-protocol-provider.mjs",
    "scripts/lib/whole-story-context-planning.mjs"];
  const [worker, runner, provider, planner] = await Promise.all(modules.map(file => import(pathToFileURL(resolve(tree, file)))));
  if (!protocolVersion.test(provider.LUNA_PROTOCOL_RUBRIC_VERSION)) throw Error("Code tree must use a v46-or-newer Luna rubric.");
  return {worker, runner, rubric: provider.LUNA_PROTOCOL_RUBRIC_VERSION, purpose: planner.WHOLE_STORY_GRANT_PURPOSE};
}

const scoredFields = ["pattern", "phase", "appliedTransition", "cue", "readerCue", "playbackStatus", "independentBoundaryStatus",
  "sceneEntryArbitration", "boundaryWitnessStatus", "sceneTimeWitnessStatus", "sceneSituationVerificationStatus",
  "scenePlaceRecoveryStatus", "uncertainContinuationVerificationStatus", "localActionApplication", "interruptionReleaseApplication",
  "interruptionContinuationApplication"];
const priorities = new Set(["hard-stop", "chapter-end", "memory-entry", "imagined-entry", "reported-entry", "present-return", "declined-restart"]);
function observation(row, first = 0) {
  const move = id => Number.isSafeInteger(id) ? id + first : id;
  const lineage = label => label?.replace(/:(beat|scene):(\d+)$/u, (_, kind, id) => `:${kind}:${move(Number(id))}`) ?? label;
  const raw = row.transitionVerification;
  const event = raw?.transition;
  const localTypedTransition = raw?.status === "neutral" && event === "none" ? "none" :
    raw?.status === "verified" && event && event !== "unknown" && raw.evidenceIds.includes(row.id) ? event : null;
  const axis = raw?.sceneBoundary;
  const cut = axis?.status === "cut" && axis.entryId === row.id && Number.isSafeInteger(axis.previousId) &&
    axis.previousId >= 0 && axis.previousId < row.id && !priorities.has(event);
  const {trace} = row;
  return {...Object.fromEntries(scoredFields.map(field => [field, row[field]])), verifiedRelease: row.verifiedRelease === true,
    beatId: lineage(row.beatId), sceneId: lineage(row.sceneId), typedTransition: cut ? "scene-cut" : localTypedTransition, localTypedTransition,
    sceneBoundary: moveIds(axis, move, ["previousId", "changeId", "entryId"]),
    isolatedBoundary: moveIds(row.boundaryVerification?.sceneBoundary, move, ["previousId", "changeId", "entryId"]), knownAt: move(row.knownAt),
    trace: trace && {...trace, beat: lineage(trace.beat), scene: lineage(trace.scene), knownAt: move(trace.knownAt), evidence: trace.evidence.map(move)}};
}

const ordered = value => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === "object" ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
function changes(before, after) {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...fields].filter(key => !same(ordered(before[key]), ordered(after[key])))
    .map(key => [key, {before: before[key] ?? null, after: after[key] ?? null}]));
}

async function project(version, clip, saved, rows, attempts) {
  const {text, index, first} = await version.worker.validateLunaCorpusClip(clip);
  const {editionDigest, segmentationVersion} = index;
  const grant = {editionDigest, segmentationVersion, purpose: version.purpose, expiresAt: 2,
    spans: index.units.map(({id, byteStart, byteEnd, digest}) => ({id, byteStart, byteEnd, digest}))};
  const targets = clip.targetIds.map(id => id - first);
  const maxCueChecks = Math.min(2, targets.length);
  const maxSupportingVerification = Math.min(2, index.units.length - targets.length);
  const maxAttempts = 1 + 4 * targets.length + maxCueChecks + maxSupportingVerification + 8;
  const budget = version.runner.createLunaShadowBudget({maxAttempts, maxSourceBytes: 160_000, maxMicros: saved.hostedSpend.shardCapMicros});
  const adapter = recordedProvider(rows, attempts, first);
  const result = await version.runner.runLunaProtocolShadow({id: clip.storyId, text, sourceSha256: clip.sourceSha256, grant,
    now: () => 1, provider: adapter.provider, budget, limits: {maxRequests: 1, maxTargetsPerWindow: 24, maxWindowSourceBytes: 6000},
    prefixUnits: 24, maxVerification: targets.length, verificationTargets: targets, verifyTransitions: true,
    maxTransitionVerification: targets.length, transitionTargets: targets, localActionVerificationTargets: targets,
    sceneEntryVerificationTargets: targets, maxCueChecks, maxSupportingVerification, maxPrimaryAnchorRepairs: 1,
    verifyContinuityBoundary: true, releaseUnusedRestartReservation: true, sceneEntryArbitration: true, sameEpisodeArbitration: true,
    boundaryEntryConfirmation: true, interruptionReleaseArbitration: true, uncertainContinuationArbitration: true,
    verifyAuxiliaryDisagreement: true, verifyBoundaryWitnesses: true, verifyBoundaryArbitration: true, recoverReleaseClock: true,
    verifySettingSituation: true, sustainConnectorVerification: true});
  const observations = result.units.map(row => observation(row, first));
  return {first, observations, attempts: adapter.requests, differences: adapter.differences, unserved: adapter.unserved(),
    words: index.units.map(unit => unit.text.match(/[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu)?.length ?? 0)};
}

function comparableOrder(before, after) {
  const sceneMode = "scene-entry";
  const other = list => list.filter(row => row.mode !== sceneMode);
  const entry = list => list.filter(row => row.mode === sceneMode).sort((left, right) => left.targetIds[0] - right.targetIds[0]);
  return same(before, after) || same(other(before), other(after)) && same(entry(before), entry(after));
}

const frozenLanes = {pattern: "pattern", phase: "phase", typedTransition: "transition", appliedTransition: "transition", cue: "cue"};
const hard = new Set(["Stop", "Reset", "Divider"]);
const quiet = new Set(["Baseline", "Hold"]);
function frozenPin(clip, id) {
  return pinFrozenTarget(clip, id, references.get(clip.storyId), roster.get(clip.storyId));
}

async function playback(clip, frozen, before, after) {
  const pin = {id: clip.storyId, units: clip.units.map(({id}) => {
    const label = frozen.get(id);
    const playbackGate = !label ? "unscored" : label.pattern === "Stop" ? "hard-stop" : hard.has(label.pattern) ? "reset" :
      quiet.has(label.pattern) ? (label.pattern === "Baseline" ? "quiet" : "unscored") : "active";
    return {behavior: {playbackGate}, narrativePhase: label?.phase, hardBoundary: label?.hardBoundary === true};
  })};
  const comparisons = [];
  for (const wpm of [120, 240, 420]) for (const [calibration, maximum] of Object.entries(caps)) {
    const condition = {wpm, calibration, maximum};
    for (const [name, side] of [["before", before], ["after", after]]) {
      const work = {id: clip.storyId, units: side.observations.map((row, id) => ({id, applied: {readerCue: row.readerCue},
        compiler: {pattern: row.pattern, beatAnchor: row.beatId ? Number(row.beatId.split(":").at(-1)) - side.first : null,
          verifiedRelease: row.verifiedRelease}}))};
      const outputByUnit = work.units.map(() => ({outputs: [], targets: []}));
      const metrics = await simulate(work, pin, side.words, wpm, maximum, false, ({index, output, target}) => {
        outputByUnit[index].outputs.push(output);
        outputByUnit[index].targets.push(target);
      });
      const hardViolations = outputByUnit.flatMap(({outputs, targets}, index) => hard.has(work.units[index].compiler.pattern) &&
        (outputs.some(value => value > 0) || targets.some(value => value > 0)) ? [clip.units[index].id] : []);
      const frozenHardViolations = outputByUnit.flatMap(({outputs, targets}, index) => pin.units[index].hardBoundary &&
        (outputs.some(value => value > 0) || targets.some(value => value > 0)) ? [clip.units[index].id] : []);
      condition[name] = {commandViolations: metrics.commandViolations, pauseViolation: metrics.pauseViolation,
        capViolationMs: metrics.capViolationMs, compiledHardViolations: hardViolations, frozenHardViolations,
        frozenHardTargets: metrics.authoritativeQuietTargets,
        frozenHardTargetViolations: metrics.authoritativeQuietTargetViolations,
        frozenHardOutputViolations: metrics.authoritativeQuietOutputViolations, targets: clip.targetIds.map(id => {
          const {outputs, targets} = outputByUnit[id - side.first];
          return {id, maximumTarget: Math.max(...targets), maximumOutput: Math.max(...outputs), outputTraceSha256: sha256(JSON.stringify(outputs)),
            targetTraceSha256: sha256(JSON.stringify(targets))};
        })};
    }
    comparisons.push(condition);
  }
  return comparisons;
}

const [baseline, candidate] = await Promise.all([load(paths.baseline), load(paths.candidate)]);
if (baseline.rubric !== receipt.rubricVersion) throw Error("Baseline rubric does not match the original receipt.");
const report = {measurement: "offline-model-receipt-replay", sourceProseIncluded: false, externalCalls: 0,
  baselineRubric: baseline.rubric, candidateRubric: candidate.rubric, exactBaselineTargets: 0, strictCandidateTargets: 0, clips: []};
for (const saved of completed.values()) {
  const entry = {clipId: saved.id, storyId: saved.storyId, targetIds: saved.targetIds, status: saved.status};
  report.clips.push(entry);
  if (saved.status !== "completed") continue;
  const clip = sent.get(saved.id), work = works.get(clip.storyId), evidence = replayClips.get(saved.id);
  if (!evidence || !work || clip.storyId !== saved.storyId || clip.sourceSha256 !== work.sourceSha256 ||
      clip.editionDigest !== work.editionDigest || !same(clip.targetIds, saved.targetIds)) throw Error("Replay work/source/edition pin differs.");
  const rows = byId(evidence.units), savedRows = byId(work.units);
  if (rows.size !== clip.units.length || clip.units.some(unit => rows.get(unit.id)?.unitSha256 !== unit.digest) ||
      clip.targetIds.some(id => savedRows.get(id)?.unitSha256 !== rows.get(id).unitSha256)) throw Error("Replay unit pins differ.");
  const before = await project(baseline, clip, saved, rows, evidence.attempts);
  entry.baseline = {differences: before.differences, unserved: before.unserved, changed: clip.targetIds.flatMap(id => {
    const fields = changes(observation(savedRows.get(id)), before.observations[id - before.first]);
    return Object.keys(fields).length ? [{id, fields}] : [];
  })};
  if (Object.values(entry.baseline).some(list => list.length)) {
    process.exitCode = 1;
    continue;
  }
  report.exactBaselineTargets += clip.targetIds.length;
  const after = await project(candidate, clip, saved, rows, evidence.attempts);
  const sameRequests = comparableOrder(before.attempts, after.attempts);
  const comparable = !after.differences.length && !after.unserved.length && sameRequests;
  entry.candidate = {comparable, sameRequests, differences: after.differences, unserved: after.unserved};
  if (!comparable) continue;
  report.strictCandidateTargets += clip.targetIds.length;
  const frozen = new Map(references ? clip.targetIds.map(id => [id, frozenPin(clip, id)]) : []);
  entry.targets = clip.targetIds.map(id => {
    const left = before.observations[id - before.first], right = after.observations[id - after.first];
    const ref = frozen.get(id);
    const grades = ref && Object.fromEntries(Object.entries(frozenLanes).flatMap(([lane, key]) =>
      ref[key] == null || ["unknown", "uncertain"].includes(ref[key]) || lane === "cue" && !ref.cueScored ? [] :
        [[lane, {frozen: ref[key], before: left[lane] === ref[key], after: right[lane] === ref[key]}]]));
    return {id, changes: changes(left, right), ...(grades ? {grades} : {})};
  });
  if (paths.simulator) {
    entry.simulator = await playback(clip, frozen, before, after);
    entry.simulatorGate = assessReplayPlayback(entry.simulator);
  }
}
if (paths.simulator) {
  const completedClips = report.clips.filter(clip => clip.status === "completed");
  report.simulatorGate = completedClips.some(clip => clip.simulatorGate === "fail") ? "fail" :
    !completedClips.length || report.clips.some(clip => clip.status !== "completed" || clip.simulatorGate !== "pass") ? "incomplete" : "pass";
  // A comparison can explain a known failure without qualifying the candidate.
  // Missing answers and compiler-missed frozen boundaries cannot yield a pass.
  if (report.simulatorGate !== "pass") process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
