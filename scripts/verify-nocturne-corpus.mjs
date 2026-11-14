import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {digestDecisionsCorpusWindow} from "../deploy/cloudflare/decisions-corpus-pins.mjs";
import {buildWholeStoryIndex} from "./lib/whole-story-context-planning.mjs";

const defaultEditions = new URL("../data/nocturne/exact-41-editions-private.json", import.meta.url);
const packSha256 = "dc9d5335d0d05819cb83400e37c9f1d37e125e2022189be0010559f62acb36db";
// Hash of the ordered [workId, sourceUnitSha256] pairs in the historical source index.
const segmentationSha256 = "12e70403e91bb59790a2ff2cba538b352043949d12694f4a654719a02417c015";
const families = ["o11", "d2", "a20"];
const sha256 = value => createHash("sha256").update(value).digest("hex");

function frozenPins(family) {
  const file = new URL(`../docs/nocturne-frozen-labels/${family}.md`, import.meta.url);
  const block = readFileSync(file, "utf8").match(/^```json\r?\n([\s\S]*?)^```\r?$/mu);
  return JSON.parse(block[1]);
}

async function verifyEditions(pack) {
  const parts = families.map(frozenPins);
  const gold = parts.flatMap(part => part.goldWorks);
  const roster = parts.flatMap(part => part.rosterWorks);
  const {works} = JSON.parse(pack.toString("utf8"));
  if (works.length !== 41 || gold.length !== works.length || roster.length !== works.length) {
    throw new Error("The edition pack and frozen pins must cover 41 works.");
  }

  let totalUnits = 0;
  let structuralUnits = 0;
  let frozenTargets = 0;
  const segmentationPins = [];
  for (const [position, {id, sourceSha256, text}] of works.entries()) {
    const reference = gold[position];
    const selection = roster[position];
    const {editionDigest, units} = buildWholeStoryIndex(text);
    if (reference.id !== id || selection.id !== id || reference.sourceSha256 !== sourceSha256 ||
        selection.sourceSha256 !== sourceSha256 || reference.editionDigest !== editionDigest ||
        selection.editionDigest !== editionDigest) {
      throw new Error(`Frozen work or edition pin mismatch at work ${position + 1}.`);
    }

    for (const target of reference.units) {
      const unit = units[target.id];
      if (!unit || unit.paragraph !== target.paragraph || unit.structuralBoundary !== target.structural ||
          unit.digest !== target.unitSha256) {
        throw new Error(`Frozen unit pin mismatch at work ${position + 1}, unit ${target.id}.`);
      }
    }
    totalUnits += units.length;
    structuralUnits += units.filter(unit => unit.structuralBoundary).length;
    frozenTargets += reference.units.length;
    segmentationPins.push([id, await digestDecisionsCorpusWindow(units)]);
  }

  if (totalUnits !== 17895 || structuralUnits !== 68 || frozenTargets !== 181 ||
      sha256(JSON.stringify(segmentationPins)) !== segmentationSha256) {
    throw new Error("The corpus unit counts or exact reader segmentation differ from the frozen index.");
  }
  return {works: works.length, units: totalUnits, structuralUnits, frozenTargets};
}

const usage = "Usage: node scripts/verify-nocturne-corpus.mjs [--editions <path> | <path>]";

async function main() {
  let values, positionals;
  try {
    ({values, positionals} = parseArgs({
      options: {editions: {type: "string"}, help: {type: "boolean"}}, allowPositionals: true,
    }));
  } catch {
    throw new Error(usage);
  }
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length > 1 || (values.editions !== undefined && positionals.length)) {
    throw new Error(usage);
  }

  let pack;
  try {
    pack = readFileSync(values.editions ?? positionals[0] ?? defaultEditions);
  } catch {
    throw new Error("Could not read the private edition pack. See docs/nocturne-vscode-handoff.md for setup.");
  }
  if (sha256(pack) !== packSha256) {
    throw new Error("Edition pack SHA-256 mismatch. Restore the exact frozen JSON file.");
  }
  const result = await verifyEditions(pack);
  console.log(JSON.stringify({verified: true, ...result}));
}

try {
  await main();
} catch (error) {
  const message = [SyntaxError, TypeError, ReferenceError].some(kind => error instanceof kind)
    ? "Could not parse or index the frozen edition pack and repository pins."
    : error.message;
  console.error(message);
  process.exitCode = 1;
}
