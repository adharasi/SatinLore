// Local only. Keep the generated payload private and outside the repository.
import {compileSceneMap} from "../app/static/reader/scene-map.mjs";
import {DECISIONS_CORPUS_PINS, DECISIONS_CORPUS_VERSION, digestDecisionsCorpusWindow} from
  "../deploy/cloudflare/decisions-corpus-pins.mjs";
import {loadCorpus} from "./evaluate-nocturne-corpus.mjs";

async function prepare(manifestPath) {
  const {passages, works} = await loadCorpus(manifestPath, "live-provider");
  if (works !== DECISIONS_CORPUS_PINS.length || passages.length !== DECISIONS_CORPUS_PINS.length) {
    throw new Error("The approved corpus has changed.");
  }

  const windows = [];
  for (const [index, {units, windows: approved, reference}] of passages.entries()) {
    const pin = DECISIONS_CORPUS_PINS[index];
    const gold = compileSceneMap(reference, units);
    const positives = gold.filter(unit => unit.emphasis > 0).map(unit => unit.id);
    const boundaries = gold.filter(unit => unit.boundary === "model").map(unit => unit.id);
    if (units.length !== pin.unitCount || approved.length !== 1 || approved[0].length !== pin.approvedUnitCount ||
        await digestDecisionsCorpusWindow(approved[0]) !== pin.sha256 ||
        JSON.stringify(positives) !== JSON.stringify(pin.positives) || JSON.stringify(boundaries) !== JSON.stringify(pin.boundaries)) {
      throw new Error("The approved corpus has changed.");
    }
    windows.push({id: pin.id, units: approved[0]});
  }
  return {version: DECISIONS_CORPUS_VERSION, windows};
}

const [manifestPath, ...extra] = process.argv.slice(2);
if (!manifestPath || extra.length) {
  console.error("Use node scripts/prepare-decisions-hosted-corpus.mjs MANIFEST and redirect output to a private file.");
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await prepare(manifestPath)));
  } catch {
    console.error("The hosted benchmark corpus did not match its approval, source or reference pins.");
    process.exitCode = 1;
  }
}
