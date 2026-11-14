// Rebuild the source-free fixture from the private normalized inputs and approved v6 oracle.
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {parseArgs} from "node:util";
import {gzipSync} from "node:zlib";
import {comparisonBlockSize, digestOutputs, encodeInputs, fixtureSchema, sha256} from "./lib/approved-beat-corpus.mjs";

const {values: options} = parseArgs({options: {
  normalized: {type: "string"}, expected: {type: "string"}, output: {type: "string"},
}});
if (!options.normalized || !options.expected || !options.output) {
  throw Error("Use --normalized, --expected and --output to create a new source-free fixture directory.");
}

const normalizedBytes = readFileSync(options.normalized);
const expectedBytes = readFileSync(options.expected);
const expectedSha256 = "74c9388c0433cce598601bdb6a905f3b88f6348641b69b020ecedbe6fc603e1f";
const normalizedSha256 = "b17fc2c03b4e04050c7a7a6b62db529a66211c460ae0a9b357c4b8f920337496";
if (sha256(expectedBytes) !== expectedSha256 || sha256(normalizedBytes) !== normalizedSha256) {
  throw Error("The approved v6 labels or normalized inputs do not match the known byte hashes.");
}

const {stories} = JSON.parse(normalizedBytes);
const expectedByStory = new Map(JSON.parse(expectedBytes).works.map(work => [work.id.toUpperCase(), work.units]));
const output = resolve(options.output);
mkdirSync(output);
const manifest = {schema: fixtureSchema, expectedSha256, normalizedSha256, stories: 0, units: 0, parts: []};
for (const cohort of ["O11", "D2", "A20"]) {
  const set = stories.filter(({story}) => story.startsWith(`${cohort}-`));
  const bytes = Buffer.from(`${JSON.stringify(encodeInputs(set))}\n`);
  const member = `${cohort.toLowerCase()}.json.gz`;
  const checks = set.map(({story, units}) => {
    const expected = expectedByStory.get(story);
    if (expected?.length !== units.length || expected.some(({id}, index) => units[index].id !== id)) {
      throw Error("Normalized and approved reference coordinates disagree.");
    }
    const rows = expected.map(({v9Pattern, continuity}) => [v9Pattern, continuity]);
    const blocks = [];
    for (let start = 0; start < rows.length; start += comparisonBlockSize) {
      const chunk = rows.slice(start, start + comparisonBlockSize);
      blocks.push({start, count: chunk.length, profilesSha256: digestOutputs(chunk, 0), tracesSha256: digestOutputs(chunk, 1)});
    }
    return {id: story, units: units.length, blocks};
  });
  manifest.stories += checks.length;
  manifest.units += checks.reduce((sum, story) => sum + story.units, 0);
  manifest.parts.push({member, sha256: sha256(bytes), checks});
  writeFileSync(join(output, member), gzipSync(bytes, {level: 9}));
}
if (manifest.stories !== 41 || manifest.units !== 17_895) throw Error("The approved fixture must cover all 41 works and 17,895 units.");
writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
