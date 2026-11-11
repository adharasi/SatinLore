import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {traceNocturneContextVisit} from "../scripts/lib/current-reader-diagnostics.mjs";
import {NOCTURNE_PARAGRAPH_CLEARANCE_PURPOSE, traceClearedNocturneContextVisit}
  from "../scripts/lib/nocturne-context-clearance.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const now = 100;

function clearanceFor(paragraphs, ids) {
  return {purpose: NOCTURNE_PARAGRAPH_CLEARANCE_PURPOSE, expiresAt: now + 1,
    readerEditionSha256: hash(paragraphs.map(row => row.text).join("\n\n")),
    paragraphs: ids.map(id => ({id, sha256: hash(paragraphs[id].text)}))};
}

test("paragraph clearance checks purpose, expiry, exact edition, positions and complete paragraph digest", () => {
  const paragraphs = new ReaderModel().load("The map opened. The light flickered.\n\nThe bell rang.");
  const clearance = clearanceFor(paragraphs, [0]);
  assert.deepEqual(traceClearedNocturneContextVisit(paragraphs, {now}).windows, []);
  assert.deepEqual([...traceClearedNocturneContextVisit(paragraphs, {now, clearance}).attempted], [0]);
  const changed = [{...paragraphs[0], text: "The map opened. The light dimmed."}, paragraphs[1]];
  assert.throws(() => traceClearedNocturneContextVisit(changed, {clearance, now}), /exact reader edition/u);
  for (const invalid of [{...clearance, expiresAt: now}, {...clearance, purpose: "nocturne-luna-editorial-shadow"},
    {...clearance, paragraphs: [{id: 0, sha256: hash("The map opened.")}]},
    {...clearance, paragraphs: [clearance.paragraphs[0], clearance.paragraphs[0]]},
    {...clearance, paragraphs: [{...clearance.paragraphs[0], id: 4}]}]) {
    assert.throws(() => traceClearedNocturneContextVisit(paragraphs, {clearance: invalid, now}), /exact reader edition/u);
  }
});

test("paced and legacy traces keep all target and overlap inputs inside the exact reviewed scope", () => {
  const paragraphs = Array.from({length: 180}, (_, id) => ({id, text: `Log ${id}. ${"A note. ".repeat(35 + id % 20)}`,
    analysed: true, quiet: false, cloudExcluded: id === 2, override: id === 3 ? 1 : null}));
  const ids = paragraphs.map(({id}) => id).filter(id => id !== 1);
  const clearance = clearanceFor(paragraphs, ids);
  for (const progressive of [false, true]) {
    const trace = traceClearedNocturneContextVisit(paragraphs, {clearance, now, progressive});
    assert.ok(trace.windows.length > 1);
    assert.ok(trace.windows.flatMap(window => window.paragraphIds).every(id => ![1, 2, 3].includes(id)));
    assert.ok(trace.sourceBytes <= 60_000);
    assert.ok(trace.windows.length <= 12);
    if (progressive) {
      assert.ok(trace.boundaries.length > 0);
      assert.ok(trace.windows.some(window => window.paragraphIds.length > window.newIds.length));
    }
  }
  const all = clearanceFor(paragraphs, paragraphs.map(({id}) => id));
  assert.deepEqual(traceClearedNocturneContextVisit(paragraphs, {now, clearance: all}), traceNocturneContextVisit(paragraphs));
});
