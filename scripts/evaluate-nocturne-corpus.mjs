// Private corpus runner. Default replay exercises the pipeline with reference
// answers supplied by a local fixture. Only explicit live mode can use fetch.
import {createHash} from "node:crypto";
import {readFile, realpath, stat} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {BEAT_CATEGORIES, BEAT_PHASES, SCENE_FRAMES, buildSceneUnits, compileSceneMap,
  validateSceneMap} from "../app/static/reader/scene-map.mjs";
import {analyzeNocturneSceneMap} from "./lib/nocturne-scene-analysis.mjs";

const modes = ["reference-replay", "validate-only", "live-provider"];
const splits = ["calibration", "holdout"];
const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(value);
const validDigest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const digest = value => createHash("sha256").update(value).digest("hex");
const decoder = new TextDecoder("utf-8", {fatal: true});
const isBooleanOrAbsent = value => value === undefined || typeof value === "boolean";
const MAX_LIVE_WINDOWS = 12;

class CorpusError extends Error {}
function check(condition, message) {
  if (!condition) throw new CorpusError(message);
}

async function boundedText(file, maximum) {
  const info = await stat(file);
  check(info.isFile() && info.size <= maximum, "A corpus file exceeds its local size limit.");
  const bytes = await readFile(file);
  check(bytes.length <= maximum, "A corpus file exceeds its local size limit.");
  return decoder.decode(bytes).replace(/\r\n?/g, "\n");
}

async function pinnedText(root, file, sha256, maximum) {
  check(typeof file === "string" && file.length && !isAbsolute(file) && validDigest(sha256), "Use a pinned corpus-relative source file.");
  const target = await realpath(resolve(root, file));
  const path = relative(root, target);
  check(path && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`), "A corpus file points outside the manifest directory.");
  const text = await boundedText(target, maximum);
  check(digest(text) === sha256, "A pinned corpus file has changed.");
  return text;
}

function validLabel(label, index) {
  return label?.paragraph === index + 1 && typeof label.cueEligible === "boolean" && typeof label.boundary === "boolean" &&
    [...BEAT_CATEGORIES, "abstain"].includes(label.category) && SCENE_FRAMES.includes(label.eventKind) &&
    [...BEAT_PHASES, "quiet", "abstain"].includes(label.phase) && Number.isInteger(label.band) && label.band >= 0 && label.band <= 4 &&
    [label.protected, label.contextEligible, label.hostedEligible].every(isBooleanOrAbsent) && (!label.cueEligible ||
    label.eventKind === "current" && BEAT_CATEGORIES.includes(label.category) && label.category !== "neutral" &&
    BEAT_PHASES.includes(label.phase) && label.phase !== "boundary" && label.band > 0);
}

const protectedLabel = label => label.protected === true || label.contextEligible === false;
const sourceUnitDigest = units => digest(JSON.stringify(units.map(({id, paragraph, start, end, text, structuralBoundary}) =>
  [id, paragraph, start, end, text, structuralBoundary])));

function paragraphReference(units, labels) {
  const lastOfParagraph = new Map(units.map(unit => [unit.paragraph, unit.id]));
  return {scenes: units.map(({id, paragraph, structuralBoundary}) => {
    const label = labels[paragraph];
    const boundary = label.boundary && id === lastOfParagraph.get(paragraph);
    const frame = structuralBoundary ? "neutral" : label.eventKind;
    const active = !structuralBoundary && label.cueEligible && !label.boundary;
    const beats = boundary ? [{first: id, last: id, phase: "boundary", category: "neutral", emphasis: 0, evidence: [id]}] :
      active ? [{first: id, last: id, phase: label.phase, category: label.category, emphasis: Math.min(3, label.band), evidence: [id]}] : [];
    return {first: id, last: id, frame, beats};
  })};
}

function windowsFor(units, allowedIds) {
  const windows = [];
  let window = [], raw = 0, serialized = 16, oversized = 0;
  for (const unit of units) {
    if (!allowedIds.has(unit.id)) continue;
    const {id, text, structuralBoundary} = unit;
    const bytes = Buffer.byteLength(text);
    const escaped = Buffer.byteLength(JSON.stringify({id, text, structuralBoundary})) + 1;
    // Reserve encoded space for verifier beat records as well as source units.
    if (bytes > 32_000 || escaped + 16 > 90_000) { oversized++; continue; }
    if (window.length === 300 || raw + bytes > 32_000 || serialized + escaped > 90_000) {
      windows.push(window);
      window = []; raw = 0; serialized = 16;
    }
    window.push(unit);
    raw += bytes;
    serialized += escaped;
  }
  if (window.length) windows.push(window);
  return {windows, oversized};
}

function approvedIds(work, excerpt, units, exact, mode) {
  if (mode !== "live-provider") return new Set(units.filter(unit => !protectedLabel(excerpt.labels[unit.paragraph])).map(unit => unit.id));
  const {rights} = work;
  const ids = excerpt.hostedApprovedUnitIds;
  check(exact && Array.isArray(rights?.allowedUses) && rights.allowedUses.includes("hosted-evaluation") &&
    Array.isArray(rights.evidence) && rights.evidence.length > 0 && rights.evidence.every(item => typeof item === "string" && item.trim()) &&
    Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => {
      const unit = units[id];
      const label = unit && excerpt.labels[unit.paragraph];
      return Number.isInteger(id) && unit?.id === id && label.hostedEligible === true && !protectedLabel(label);
    }), "Live evaluation requires exact references and explicitly approved, unprotected source units for every excerpt.");
  return new Set(ids);
}

async function loadCorpus(manifestPath, mode) {
  const path = await realpath(manifestPath);
  const root = dirname(path);
  const manifest = JSON.parse(await boundedText(path, 12_000_000));
  check(manifest?.version === 1 && Array.isArray(manifest.works) && manifest.works.length, "Use a version 1 corpus with works and excerpts.");
  const authors = new Map(), workIds = new Set(), excerptIds = new Set(), digests = new Set(), passages = [];
  for (const work of manifest.works) {
    check(validId(work?.id) && validId(work.authorId) && splits.includes(work.split) && !workIds.has(work.id) &&
      (!authors.has(work.authorId) || authors.get(work.authorId) === work.split) && Array.isArray(work.excerpts) && work.excerpts.length,
    "Work and author groups must be unique to their corpus split.");
    authors.set(work.authorId, work.split);
    workIds.add(work.id);
    for (const excerpt of work.excerpts) {
      check(validId(excerpt?.id) && !excerptIds.has(excerpt.id) && !digests.has(excerpt.sha256) && Array.isArray(excerpt.labels) &&
        excerpt.labels.length && excerpt.labels.every(validLabel), "Each excerpt needs unique source metadata and aligned paragraph labels.");
      excerptIds.add(excerpt.id);
      digests.add(excerpt.sha256);
      const text = await pinnedText(root, excerpt.file, excerpt.sha256, 500_000);
      const paragraphs = new ReaderModel().load(text);
      check(paragraphs.length === excerpt.labels.length, "The reader and the corpus disagree on the paragraph count.");
      const units = buildSceneUnits(paragraphs);
      const exact = excerpt.sceneReference !== undefined;
      if (excerpt.sceneUnitSha256 !== undefined || mode === "live-provider") {
        check(exact && excerpt.sceneUnitSha256 === sourceUnitDigest(units), "The exact source units must match their pinned scene digest.");
      }
      const authored = typeof excerpt.sceneReference === "string" ?
        JSON.parse(await pinnedText(root, excerpt.sceneReference, excerpt.sceneReferenceSha256, 4_000_000)) : excerpt.sceneReference;
      const reference = validateSceneMap(exact ? authored : paragraphReference(units, excerpt.labels), units);
      const allowedIds = approvedIds(work, excerpt, units, exact, mode);
      const {windows, oversized} = windowsFor(units, allowedIds);
      check(mode !== "live-provider" || oversized === 0, "An approved live source unit exceeds its request limits.");
      passages.push({split: work.split, scope: exact ? "exact" : "projected", units, reference, windows, oversized,
        labels: excerpt.labels, excluded: units.length - allowedIds.size});
    }
  }
  check(mode !== "live-provider" || passages.reduce((sum, p) => sum + p.windows.length, 0) <= MAX_LIVE_WINDOWS,
    "Reduce the number of live windows to fit the evaluation budget.");
  return {passages, authors: authors.size, works: workIds.size};
}

function windowReference(reference, window) {
  const runs = [];
  for (const {id} of window) {
    if (runs.at(-1)?.last === id - 1) runs.at(-1).last = id;
    else runs.push({first: id, last: id});
  }
  const scenes = [];
  for (const run of runs) {
    for (const scene of reference.scenes) {
      const first = Math.max(run.first, scene.first), last = Math.min(run.last, scene.last);
      if (first > last) continue;
      const beats = scene.beats.flatMap(beat => {
        const start = Math.max(first, beat.first), end = Math.min(last, beat.last);
        const evidence = beat.evidence.filter(id => id >= first && id <= last);
        return start <= end && evidence.some(id => id >= start && id <= end) ?
          [{...beat, first: start, last: end, evidence}] : [];
      });
      scenes.push({first, last, frame: scene.frame, beats});
    }
  }
  return {scenes};
}

function replayProvider(map) {
  return (request, {phase}) => {
    const value = phase === "extract" ? map : {decisions: JSON.parse(request.input).beats.map(({id}) => ({id, verdict: "keep"}))};
    return Response.json({status: "completed", output: [{type: "message", role: "assistant",
      content: [{type: "output_text", text: JSON.stringify(value)}]}]});
  };
}

const counts = () => ({matched: 0, missed: 0, extra: 0});
function compare(count, expected, observed) {
  if (expected && observed) count.matched++;
  else if (expected) count.missed++;
  else if (observed) count.extra++;
}

function newScores() {
  return {cueUnits: counts(), cueParagraphs: counts(), annotatedBoundaries: counts(), positivePhase: {matched: 0, total: 0},
    positiveCategory: {matched: 0, total: 0}, frame: {matched: 0, total: 0}, mappedUnits: 0, mappedPositiveUnits: 0};
}

function compareTimelines(score, reference, observed, labels) {
  const paragraphs = new Set();
  for (const [index, expected] of reference.entries()) {
    const actual = observed[index];
    const positive = expected.emphasis > 0;
    compare(score.cueUnits, positive, actual.emphasis > 0);
    compare(score.annotatedBoundaries, expected.boundary === "model", actual.boundary === "model");
    if (actual.emphasis > 0) paragraphs.add(actual.paragraph);
    if (actual.sceneId !== null) {
      score.mappedUnits++;
      score.mappedPositiveUnits += Number(positive);
    }
    if (positive) {
      score.positivePhase.total++;
      score.positivePhase.matched += Number(expected.phase === actual.phase);
      score.positiveCategory.total++;
      score.positiveCategory.matched += Number(expected.category === actual.category);
    }
    if (expected.frame !== null) {
      score.frame.total++;
      score.frame.matched += Number(expected.frame === actual.frame);
    }
  }
  for (const [index, label] of labels.entries()) compare(score.cueParagraphs, label.cueEligible, paragraphs.has(index));
}

function summarizePassage(group, passage, reference) {
  group.excerpts++;
  group.paragraphs += passage.labels.length;
  group.units += passage.units.length;
  group.structuralBoundaries += reference.filter(unit => unit.boundary === "structural").length;
  group.referenceCueUnits += reference.filter(unit => unit.emphasis > 0).length;
  group.referenceCueParagraphs += passage.labels.filter(label => label.cueEligible).length;
  group.referenceBoundaryUnits += reference.filter(unit => unit.boundary === "model").length;
  group.referenceUnmappedUnits += reference.filter(unit => unit.sceneId === null).length;
  group.mixedParagraphs += passage.labels.filter(label => label.cueEligible && label.boundary).length;
  const cueParagraphs = new Set(reference.filter(unit => unit.emphasis > 0).map(unit => unit.paragraph));
  const boundaryParagraphs = new Set(reference.filter(unit => unit.boundary).map(unit => unit.paragraph));
  for (const [index, label] of passage.labels.entries()) {
    group.referenceCueParagraphDisagreements += Number(label.cueEligible !== cueParagraphs.has(index));
    group.referenceBoundaryParagraphDisagreements += Number(label.boundary !== boundaryParagraphs.has(index));
  }
  group.excludedUnits += passage.excluded;
  group.oversizedUnits += passage.oversized;
  group.plannedWindows += passage.windows.length;
}

function newGroup(mode) {
  const group = {excerpts: 0, paragraphs: 0, units: 0, structuralBoundaries: 0, referenceCueUnits: 0, referenceCueParagraphs: 0,
    referenceBoundaryUnits: 0, referenceUnmappedUnits: 0, mixedParagraphs: 0, referenceCueParagraphDisagreements: 0,
    referenceBoundaryParagraphDisagreements: 0, excludedUnits: 0, oversizedUnits: 0, plannedWindows: 0};
  return mode === "validate-only" ? group : {...group, windowStatus: {}, callStatus: {}, checkedBeats: 0, uncheckedBeats: 0,
    usage: {callsReported: 0, inputTokens: 0, outputTokens: 0}, providerTimingMs: {extract: [], verify: []},
    proposed: newScores(), accepted: newScores()};
}

function recordTrace(group, trace) {
  group.windowStatus[trace.status] = (group.windowStatus[trace.status] ?? 0) + 1;
  group.checkedBeats += trace.keptBeats + trace.rejectedBeats + trace.uncertainBeats;
  group.uncheckedBeats += trace.unverifiedBeats;
  for (const call of trace.calls) {
    group.callStatus[call.result] = (group.callStatus[call.result] ?? 0) + 1;
    group.providerTimingMs[call.phase].push(call.elapsedMs);
    if (call.usage) {
      group.usage.callsReported++;
      group.usage.inputTokens += call.usage.inputTokens;
      group.usage.outputTokens += call.usage.outputTokens;
    }
  }
}

function summarizeTimings(groups) {
  for (const group of Object.values(groups)) {
    for (const [phase, samples] of Object.entries(group.providerTimingMs)) {
      const sorted = samples.sort((a, b) => a - b);
      const quantile = fraction => sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
      group.providerTimingMs[phase] = {calls: sorted.length, p50: quantile(0.5), p95: quantile(0.95)};
    }
  }
}

export async function evaluateNocturneCorpus(manifestPath, {mode = "reference-replay", provider} = {}) {
  check(modes.includes(mode) && (mode === "live-provider" ? typeof provider === "function" : provider === undefined), "Choose a supported private evaluation mode.");
  // Complete permission, pin and label preflight for the entire manifest before
  // constructing any analysis request, including the first live window.
  const {passages, authors, works} = await loadCorpus(manifestPath, mode);
  const groups = {};
  for (const passage of passages) {
    const {units, windows, labels, reference} = passage;
    const key = `${passage.split}/${passage.scope}`;
    const group = groups[key] ??= newGroup(mode);
    const expected = compileSceneMap(reference, units);
    summarizePassage(group, passage, expected);
    if (mode === "validate-only") continue;
    const proposed = {scenes: []}, accepted = {scenes: []};
    for (const window of windows) {
      const result = await analyzeNocturneSceneMap({units: window, approvedIds: window.map(unit => unit.id), verify: true,
        provider: mode === "live-provider" ? provider : replayProvider(windowReference(reference, window))});
      recordTrace(group, result.trace);
      if (result.proposed) proposed.scenes.push(...result.proposed.scenes);
      if (result.accepted) accepted.scenes.push(...result.accepted.scenes);
    }
    const quietParagraphs = labels.flatMap((label, index) => protectedLabel(label) ? [index] : []);
    compareTimelines(group.proposed, expected, compileSceneMap(proposed, units, {quietParagraphs}), labels);
    compareTimelines(group.accepted, expected, compileSceneMap(accepted, units, {quietParagraphs}), labels);
  }
  if (mode !== "validate-only") summarizeTimings(groups);
  return {mode, interpretation: mode === "reference-replay" ? "Reference answers test pipeline mechanics. No model accuracy is measured." :
    mode === "validate-only" ? "Local reference and source validation only." : "Model scores on explicitly approved sources with whole-reference denominators.",
  works, authors, groups};
}

async function main() {
  const [manifestPath, option, ...extra] = process.argv.slice(2);
  check(manifestPath && !manifestPath.startsWith("--") && !extra.length && [undefined, "--validate-only", "--live-provider"].includes(option),
    "Use node scripts/evaluate-nocturne-corpus.mjs MANIFEST [--validate-only | --live-provider].");
  const mode = option?.slice(2) ?? "reference-replay";
  let provider;
  if (mode === "live-provider") {
    const key = process.env.OPENAI_API_KEY;
    check(typeof key === "string" && key.trim(), "Supply an authorized OpenAI project key privately in OPENAI_API_KEY.");
    provider = (request, {signal}) => fetch("https://api.openai.com/v1/responses", {method: "POST", redirect: "error", signal,
      headers: {Authorization: `Bearer ${key}`, "Content-Type": "application/json"}, body: JSON.stringify(request)});
  }
  console.log(JSON.stringify(await evaluateNocturneCorpus(manifestPath, {mode, provider}), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof CorpusError ? error.message : "Private corpus evaluation failed. Check the manifest, pinned files and scene references.");
    process.exitCode = 1;
  }
}
