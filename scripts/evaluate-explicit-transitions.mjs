import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {compileSceneMap} from "../app/static/reader/scene-map.mjs";
import {DECISIONS_STORY_STUDY_PINS} from "../deploy/cloudflare/decisions-story-study-pins.mjs";
import {validateStoryStudyPayload} from "../deploy/cloudflare/decisions-story-study.mjs";
import {loadCorpus} from "./evaluate-nocturne-corpus.mjs";
import {explicitTransitionAnchors} from "./lib/explicit-transition-evidence.mjs";

const archiveStudies = ["story-transition-evidence-v1", "story-transition-evidence-v2"];

function matchParagraphs(expected, predicted) {
  let gold = 0, observed = 0, found = 0;
  // Pair the earliest compatible positions. Sorted order makes skipped
  // positions too distant for any subsequent match.
  while (gold < expected.length && observed < predicted.length) {
    const delta = expected[gold] - predicted[observed];
    if (delta < -1) gold++;
    else if (delta > 1) observed++;
    else {
      found++;
      gold++;
      observed++;
    }
  }
  return found;
}

function score(found, expected, predicted) {
  return {found, missed: expected - found, false: predicted - found,
    precision: predicted ? found / predicted : null, recall: expected ? found / expected : null};
}

function compare(passages, name) {
  let exact = 0, tolerant = 0, expected = 0, predicted = 0;
  for (const passage of passages) {
    const actual = new Set(passage[name]);
    exact += passage.expected.filter(id => actual.has(id)).length;
    const toParagraph = ids => ids.map(id => passage.paragraphs.get(id));
    tolerant += matchParagraphs(toParagraph(passage.expected), toParagraph(passage[name]));
    expected += passage.expected.length;
    predicted += actual.size;
  }
  return {sentenceBoundaries: score(exact, expected, predicted),
    paragraphToleranceBoundaries: score(tolerant, expected, predicted)};
}

async function archivedPredictions(manifestPath, archivePath, passages) {
  const [manifest, report] = await Promise.all([manifestPath, archivePath].map(async path =>
    JSON.parse(await readFile(path, "utf8"))));
  if (report.measurement !== "live-provider" || report.model !== "gpt-6-luna" || report.aborted !== false ||
      report.provider?.status !== "completed" || report.totals?.parsedCalls !== 1 ||
      !archiveStudies.includes(report.study) || !Array.isArray(report.stories) || report.storyCount !== passages.length ||
      report.stories.length !== passages.length || manifest.works.length !== passages.length ||
      manifest.works.some(work => work.split !== report.split || work.excerpts.length !== 1)) {
    throw new Error("The archive must contain one completed pinned transition-study split.");
  }
  const {stories} = await validateStoryStudyPayload({version: report.version, split: report.split,
    stories: manifest.works.map(({id}, index) => ({id, units: passages[index].units}))}, DECISIONS_STORY_STUDY_PINS);
  for (const [index, passage] of passages.entries()) {
    const {id, units, boundaries} = stories[index];
    const prior = report.stories[index];
    const anchors = prior?.predictedAnchors;
    if (prior?.story !== id || prior.sourceUnits !== units.length ||
        passage.expected.length !== boundaries.length || passage.expected.some((anchor, i) => anchor !== boundaries[i]) ||
        !Array.isArray(anchors) || anchors.some((anchor, i) => !Number.isInteger(anchor) ||
          (i > 0 && anchor <= anchors[i - 1]) || !units[anchor] || units[anchor].structuralBoundary)) {
      throw new Error("The archive and pinned source or reference disagree.");
    }
    passage.archived = anchors;
    passage.withCorroborated = [...new Set([...anchors, ...passage.corroborated])].sort((a, b) => a - b);
  }
  return report.study;
}

export async function evaluateExplicitTransitions(manifestPath, {archivePath} = {}) {
  const corpus = await loadCorpus(manifestPath, "validate-only");
  const passages = corpus.passages.map(({scope, split, units, reference}) => {
    if (scope !== "exact") throw new Error("This comparison requires exact references for every excerpt.");
    const rows = compileSceneMap(reference, units);
    const expected = rows.filter(row => row.boundary === "model").map(row => row.id);
    const paragraphs = new Map(units.map(unit => [unit.id, unit.paragraph]));
    return {split, units, expected, paragraphs, ...explicitTransitionAnchors(units)};
  });
  const archiveStudy = archivePath ? await archivedPredictions(manifestPath, archivePath, passages) : null;
  const splits = {};
  for (const split of ["calibration", "holdout"]) {
    const selection = passages.filter(passage => passage.split === split);
    if (!selection.length) continue;
    splits[split] = {passages: selection.length,
      sourceUnits: selection.reduce((total, passage) => total + passage.units.length, 0),
      referenceAnchors: selection.reduce((total, passage) => total + passage.expected.length, 0),
      raw: compare(selection, "raw"),
      corroborated: compare(selection, "corroborated")};
    if (archiveStudy) {
      splits[split].archivedStudy = archiveStudy;
      splits[split].archived = compare(selection, "archived");
      splits[split].archivedWithCorroborated = compare(selection, "withCorroborated");
    }
  }
  return {measurement: "offline-explicit-transition-evidence", works: corpus.works, authors: corpus.authors, splits};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [manifest, archiveFlag, archivePath, ...extra] = process.argv.slice(2);
  if (!manifest || extra.length || (archiveFlag !== undefined && (archiveFlag !== "--archived-report" || !archivePath))) {
    console.error("Usage: node scripts/evaluate-explicit-transitions.mjs MANIFEST [--archived-report REPORT]");
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await evaluateExplicitTransitions(manifest, {archivePath}), null, 2));
    } catch {
      console.error("The exact manifest or optional archived report could not be validated.");
      process.exitCode = 1;
    }
  }
}
