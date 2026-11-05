import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {ANALYSIS_VERSION, ReaderModel} from "../app/static/reader/model.mjs";
import {nocturneCandidates} from "../app/static/reader/nocturne.mjs";
import {trace} from "./reader-evaluation-trace.mjs";

const toy = "lush", maximum = 10, timestamps = [0, 2000, 4000, 6000, 8000];
const splits = ["calibration", "holdout"];
const phases = ["quiet", "build", "sustain", "peak", "recover"];
const defaultManifest = fileURLToPath(new URL("../tests/fixtures/reader-corpus/manifest.json", import.meta.url));
const manifestPath = process.argv[2] ? resolve(process.argv[2]) : defaultManifest;
if (process.argv.length > 3) throw new Error("Use node scripts/evaluate-reader-corpus.mjs [local-manifest.json].");

let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
catch { throw new Error("The local corpus manifest must contain valid JSON."); }
const validText = value => typeof value === "string" && Boolean(value.trim());
const validId = value => typeof value === "string" && value.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const validList = value => Array.isArray(value) && value.length > 0 && value.every(validText);
const validAnnotation = item => item && phases.includes(item.phase) && validText(item.note) &&
  (item.continuation === undefined || item.continuation === true && item.phase !== "quiet") &&
  (item.boundary === undefined || item.boundary === true && item.phase === "quiet");

if (manifest?.version !== 1 || !validId(manifest.corpusId) || !validId(manifest.annotationProtocol) ||
    !Array.isArray(manifest.passages) || !splits.every(split => manifest.passages.some(item => item?.split === split))) {
  throw new Error("Use a version 1 corpus with calibration and holdout passages.");
}

const authors = new Map(), works = new Map(), ids = new Set(), excerptDigests = new Set();
const passages = [];
for (const [ordinal, passage] of manifest.passages.entries()) {
  const {id, split, authorId, workId, source, sourceParagraphs, sha256, file, rights, annotations, language, theme} = passage ?? {};
  if (![id, authorId, workId, language, theme].every(validId) || ids.has(id) ||
      !splits.includes(split) || ![passage.author, passage.title, source, rights?.basis].every(validText) ||
      !Array.isArray(sourceParagraphs) || sourceParagraphs.length !== 2 ||
      !sourceParagraphs.every(position => Number.isInteger(position) && position > 0) ||
      file !== `${id}.txt` || !/^[0-9a-f]{64}$/.test(sha256) ||
      ![rights.territories, rights.evidence, rights.allowedUses].every(validList) ||
      !rights.allowedUses.includes("offline-evaluation") ||
      (manifestPath === defaultManifest && !rights.allowedUses?.includes("repository-redistribution")) ||
      !Array.isArray(annotations) || !annotations.length || !annotations.every(validAnnotation) ||
      sourceParagraphs[1] - sourceParagraphs[0] + 1 !== annotations.length || excerptDigests.has(sha256)) {
    throw new Error(`Check the provenance, local file and gold annotations for passage ${ordinal + 1}.`);
  }
  if ((authors.has(authorId) && authors.get(authorId) !== split) ||
      (works.has(workId) && works.get(workId) !== split)) {
    throw new Error(`Author and work groups cannot cross splits (passage ${ordinal + 1}).`);
  }
  ids.add(id);
  excerptDigests.add(sha256);
  authors.set(authorId, split);
  works.set(workId, split);

  let text;
  try {
    const bytes = await readFile(resolve(dirname(manifestPath), file));
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes).replace(/\r\n?/g, "\n");
  } catch { throw new Error(`Use a local UTF-8 text file for passage ${ordinal + 1}.`); }
  if (createHash("sha256").update(text).digest("hex") !== sha256) {
    throw new Error(`The exact text changed for passage ${ordinal + 1}.`);
  }

  const model = new ReaderModel();
  const paragraphs = model.load(text);
  if (paragraphs.length !== annotations.length) throw new Error(`Paragraph count changed for passage ${ordinal + 1}.`);
  const levels = model.effectiveLevels(), loomProfiles = model.effectiveProfiles();
  const nocturneProfiles = model.effectiveProfiles({nocturne: true, peakPattern: "auto"});
  const sections = [];
  for (const [index, {phase, continuation = false, boundary = false}] of annotations.entries()) {
    const observed = paragraphs[index];
    const loom = await trace(toy, levels, loomProfiles, index, [], {maximum, timestamps});
    const nocturne = await trace(toy, levels, nocturneProfiles, index, [], {maximum, timestamps});
    const vibration = result => result.samples.map(sample => sample.vibrate);
    const active = result => result.movements.includes("vibrate");
    sections.push({
      paragraph: sourceParagraphs[0] + index,
      expectedPhase: phase,
      observedPhase: observed.phase,
      expectedActive: phase !== "quiet",
      continuation, boundary,
      localLevel: observed.suggestedLevel,
      loom: {active: active(loom), vibration: vibration(loom)},
      nocturne: {active: active(nocturne), vibration: vibration(nocturne)},
    });
  }
  passages.push({id, split, theme, eligibleForHostedRhythm: nocturneCandidates(paragraphs).cues.length, sections});
}

function tally(items, test) {
  return {matched: items.filter(test).length, total: items.length};
}

function metrics(selected) {
  const sections = selected.flatMap(passage => passage.sections);
  const active = sections.filter(section => section.expectedActive);
  const quiet = sections.filter(section => !section.expectedActive);
  return {
    passages: selected.length,
    sections: sections.length,
    phase: tally(sections, section => section.expectedPhase === section.observedPhase),
    perPhase: Object.fromEntries(phases.map(phase =>
      [phase, tally(sections.filter(section => section.expectedPhase === phase), section => section.observedPhase === phase)])),
    models: Object.fromEntries(["loom", "nocturne"].map(model => [model, {
      activeRecall: tally(active, section => section[model].active),
      activePrecision: tally(sections.filter(section => section[model].active), section => section.expectedActive),
      falseActivations: {count: quiet.filter(section => section[model].active).length, quietSections: quiet.length},
      continuity: tally(sections.filter(section => section.continuation), section => section[model].active),
      quietBoundaries: tally(sections.filter(section => section.boundary), section => !section[model].active),
      variableActiveSections: tally(sections.filter(section => section[model].active), section => new Set(section[model].vibration).size > 1),
      silentPassages: selected.filter(passage => passage.sections.some(section => section.expectedActive) &&
        !passage.sections.some(section => section[model].active)).length,
    }])),
    hostedRhythmCandidates: selected.reduce((count, passage) => count + passage.eligibleForHostedRhythm, 0),
  };
}

// Only reviewed IDs, ordinal labels and numeric traces leave the evaluator.
console.log(JSON.stringify({
  corpus: manifest.corpusId,
  annotationProtocol: manifest.annotationProtocol,
  analysisVersion: ANALYSIS_VERSION,
  simulator: {toy, maximum, sampleMs: timestamps},
  nocturne: "local patterns only; no provider request",
  authors: authors.size,
  works: works.size,
  results: Object.fromEntries(splits.map(split => [split, metrics(passages.filter(passage => passage.split === split))])),
  passages,
}, null, 2));
