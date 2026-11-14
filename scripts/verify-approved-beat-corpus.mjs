// Reproduce approved qualitative profiles and causal traces with repository inputs only.
import {readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {gunzipSync} from "node:zlib";
import {planStory} from "../app/static/reader/beat-continuity.mjs";
import {comparisonBlockSize, decodeInputs, digestOutputs, fixturesDirectory, fixtureSchema, sha256} from "./lib/approved-beat-corpus.mjs";

const {values: {story: selected = []}} = parseArgs({options: {story: {type: "string", multiple: true}}});
const selectedIds = new Set(selected.map(id => id.toUpperCase()));
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixturesDirectory)));
if (manifest.schema !== fixtureSchema || manifest.stories !== 41 || manifest.units !== 17_895) {
  throw Error("Unexpected approved compiler corpus manifest.");
}

const report = {stories: 0, units: 0, confirmedProfileUnits: 0, confirmedTraceUnits: 0, mismatches: [], exactMatch: false};
const seen = new Set();
for (const {member, sha256: approvedHash, checks} of manifest.parts) {
  if (!/^(o11|d2|a20)\.json\.gz$/u.test(member)) throw Error("Unexpected approved compiler corpus member.");
  const bytes = gunzipSync(readFileSync(new URL(member, fixturesDirectory)), {maxOutputLength: 4_000_000});
  if (sha256(bytes) !== approvedHash) throw Error(`Approved compiler corpus hash mismatch in ${member}.`);
  const stories = decodeInputs(JSON.parse(bytes));
  if (stories.length !== checks.length) throw Error("Approved input and output work counts differ.");
  for (const [index, {story, units}] of stories.entries()) {
    const approved = checks[index];
    if (seen.has(story) || approved.id !== story || units.length !== approved.units || !units.length) {
      throw Error("Approved input and output work coordinates differ.");
    }
    seen.add(story);
    if (selectedIds.size && !selectedIds.has(story)) continue;
    const rows = planStory(story, units);
    report.stories++;
    report.units += rows.length;
    if (approved.blocks.length !== Math.ceil(rows.length / comparisonBlockSize)) {
      throw Error("Approved check does not cover the complete work.");
    }
    for (const [position, {start, count, profilesSha256, tracesSha256}] of approved.blocks.entries()) {
      if (start !== position * comparisonBlockSize || count !== Math.min(comparisonBlockSize, rows.length - start)) {
        throw Error("Approved check has invalid block coordinates.");
      }
      const block = rows.slice(start, start + count);
      const profileMatch = digestOutputs(block, 0) === profilesSha256;
      const traceMatch = digestOutputs(block, 1) === tracesSha256;
      if (profileMatch) report.confirmedProfileUnits += count;
      if (traceMatch) report.confirmedTraceUnits += count;
      if (!profileMatch || !traceMatch) {
        report.mismatches.push({story, firstUnit: units[start].id, lastUnit: units[start + count - 1].id, profileMatch, traceMatch});
      }
    }
  }
}

if (seen.size !== manifest.stories || selectedIds.size && report.stories !== selectedIds.size ||
    !selectedIds.size && report.units !== manifest.units) throw Error("Approved corpus does not cover the requested work roster.");
report.exactMatch = report.confirmedProfileUnits === report.units && report.confirmedTraceUnits === report.units;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.exactMatch) process.exitCode = 1;
