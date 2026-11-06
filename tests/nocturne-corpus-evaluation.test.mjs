import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import test from "node:test";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {buildSceneUnits} from "../app/static/reader/scene-map.mjs";
import {evaluateNocturneCorpus} from "../scripts/evaluate-nocturne-corpus.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const cue = (paragraph, extra) => ({paragraph, cueEligible: true, category: "romance", eventKind: "current",
  phase: "build", band: 1, boundary: false, ...extra});
const quiet = (paragraph, extra) => ({paragraph, cueEligible: false, category: "neutral", eventKind: "neutral",
  phase: "quiet", band: 0, boundary: false, ...extra});
const beat = (first, last = first) => ({first, last, phase: "build", category: "romance", emphasis: 1, evidence: [first]});
const boundary = id => ({first: id, last: id, phase: "boundary", category: "neutral", emphasis: 0, evidence: [id]});
const scene = (first, last, beats = [], frame = "current") => ({first, last, frame, beats});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "satinlore-nocturne-corpus-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  return {
    root,
    async work({id, text, labels, map, sidecar, split = "holdout", approved}) {
      const file = `${id}.txt`;
      await writeFile(join(root, file), text);
      const units = buildSceneUnits(new ReaderModel().load(text));
      const excerpt = {id, file, sha256: digest(text), labels};
      if (map) {
        excerpt.sceneReference = map;
        excerpt.sceneUnitSha256 = digest(JSON.stringify(units.map(({id, paragraph, start, end, text, structuralBoundary}) =>
          [id, paragraph, start, end, text, structuralBoundary])));
        if (sidecar) {
          const serialized = JSON.stringify(map);
          excerpt.sceneReference = `${id}.json`;
          excerpt.sceneReferenceSha256 = digest(serialized);
          await writeFile(join(root, excerpt.sceneReference), serialized);
        }
      }
      const work = {id, authorId: `${id}-author`, split, excerpts: [excerpt]};
      if (approved) {
        work.rights = {allowedUses: ["offline-evaluation", "hosted-evaluation"], evidence: ["Authorized test fixture"]};
        excerpt.hostedApprovedUnitIds = approved;
      }
      return work;
    },
    async manifest(works) {
      const path = join(root, "manifest.json");
      await writeFile(path, JSON.stringify({version: 1, works}));
      return path;
    },
  };
}

test("exact and projected offline references remain separate and replay discloses only aggregate mechanics", async t => {
  const f = await fixture(t);
  const exact = await f.work({id: "exact", text: "Mina asked Jo to stay for tea. Jo had to catch the bus.",
    labels: [cue(1, {boundary: true})], sidecar: true, map: {scenes: [scene(0, 1, [beat(0), boundary(1)])]}});
  const projected = await f.work({id: "projected", text: "The bench stayed empty. Rain drummed on the roof.",
    labels: [cue(1, {boundary: true})]});
  const manifest = await f.manifest([exact, projected]);
  const validated = await evaluateNocturneCorpus(manifest, {mode: "validate-only"});
  assert.equal(validated.groups["holdout/exact"].plannedWindows, 1);
  assert.equal(validated.groups["holdout/exact"].accepted, undefined);
  const result = await evaluateNocturneCorpus(manifest);
  const exactScore = result.groups["holdout/exact"];
  const projectedScore = result.groups["holdout/projected"];
  assert.deepEqual(exactScore.accepted.cueUnits, {matched: 1, missed: 0, extra: 0});
  assert.deepEqual(exactScore.accepted.annotatedBoundaries, {matched: 1, missed: 0, extra: 0});
  assert.equal(exactScore.referenceCueParagraphDisagreements, 0);
  assert.equal(projectedScore.referenceCueParagraphDisagreements, 1);
  assert.deepEqual(projectedScore.accepted.cueParagraphs, {matched: 0, missed: 1, extra: 0});
  assert.equal(exactScore.providerTimingMs.verify.calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /Mina|empty|tea|drummed|exact\.txt/);
});

test("pins, split consistency, and escaped symlinks are checked before validation succeeds", async t => {
  const f = await fixture(t);
  const work = await f.work({id: "check", text: "The last train left the platform.", labels: [quiet(1)]});
  const another = await f.work({id: "cross", split: "calibration", text: "The nearby station closed.", labels: [quiet(1)]});
  another.authorId = work.authorId;
  await assert.rejects(evaluateNocturneCorpus(await f.manifest([work, another]), {mode: "validate-only"}), /corpus split/);
  await writeFile(join(f.root, "check.txt"), "The last train arrived at the platform.");
  await assert.rejects(evaluateNocturneCorpus(await f.manifest([work]), {mode: "validate-only"}), /changed/);
  const outside = await mkdtemp(join(tmpdir(), "satinlore-corpus-external-"));
  t.after(() => rm(outside, {recursive: true, force: true}));
  const outsideText = join(outside, "remote.txt");
  await writeFile(outsideText, "The last train left the platform.");
  if (process.platform === "win32") work.excerpts[0].file = join("..", basename(outside), "remote.txt");
  else {
    await symlink(outsideText, join(f.root, "escape.txt"));
    work.excerpts[0].file = "escape.txt";
  }
  await assert.rejects(evaluateNocturneCorpus(await f.manifest([work]), {mode: "validate-only"}), /outside the manifest/);
});

test("all live permissions, protection and source alignment are preflighted before any provider call", async t => {
  const f = await fixture(t);
  const eligible = {hostedEligible: true};
  const approved = await f.work({id: "approved", text: "Mina left two cups on the table.", labels: [cue(1, eligible)],
    map: {scenes: [scene(0, 0, [beat(0)])]}, approved: [0]});
  const later = await f.work({id: "later", text: "An entry was left in the folder.", labels: [quiet(1, eligible)],
    map: {scenes: [scene(0, 0, [], "neutral")]}, approved: [0]});
  const provider = () => assert.fail("No source should be sent when a later work fails preflight.");
  const options = {mode: "live-provider", provider};
  const laterExcerpt = later.excerpts[0];
  const pin = laterExcerpt.sceneUnitSha256;
  laterExcerpt.sceneUnitSha256 = "f".repeat(64);
  await assert.rejects(evaluateNocturneCorpus(await f.manifest([approved, later]), options), /pinned scene digest/);
  laterExcerpt.sceneUnitSha256 = pin;
  laterExcerpt.labels[0].protected = true;
  await assert.rejects(evaluateNocturneCorpus(await f.manifest([approved, later]), options), /unprotected source units/);
  laterExcerpt.labels[0].protected = false;
  later.rights.allowedUses = ["offline-evaluation"];
  await assert.rejects(evaluateNocturneCorpus(await f.manifest([approved, later]), options), /explicitly approved/);
});

test("approved source only enters live transport and excluded positive references remain in the denominator", async t => {
  const f = await fixture(t);
  const work = await f.work({id: "some-approved", text: "The first cup was warm.\n\nThe second cup waited by the door.",
    labels: [quiet(1, {hostedEligible: true}), cue(2, {protected: true})],
    map: {scenes: [scene(0, 0, [], "neutral"), scene(1, 1, [beat(1)])]}, approved: [0]});
  let calls = 0;
  const result = await evaluateNocturneCorpus(await f.manifest([work]), {mode: "live-provider", provider(request) {
    calls++;
    assert.equal(request.store, false);
    assert.deepEqual(JSON.parse(request.input).units.map(({id}) => id), [0]);
    assert.doesNotMatch(request.input, /second cup/);
    return Response.json({status: "completed", output: [{type: "message", role: "assistant",
      content: [{type: "output_text", text: '{"scenes":[]}'}]}]});
  }});
  assert.equal(calls, 1);
  const group = result.groups["holdout/exact"];
  assert.equal(group.excludedUnits, 1);
  assert.equal(group.accepted.mappedUnits, 0);
  assert.deepEqual(group.accepted.cueUnits, {matched: 0, missed: 1, extra: 0});
  assert.deepEqual(group.accepted.cueParagraphs, {matched: 0, missed: 1, extra: 0});
});

test("bounded replay windows do not manufacture missing evidence at a window cut", async t => {
  const f = await fixture(t);
  const text = Array.from({length: 305}, () => "The lamp was dim.").join(" ");
  const work = await f.work({id: "long", text, labels: [cue(1)], map: {scenes: [scene(0, 304, [beat(0, 304)])]}});
  const result = await evaluateNocturneCorpus(await f.manifest([work]));
  const group = result.groups["holdout/exact"];
  assert.equal(group.plannedWindows, 2);
  assert.deepEqual(group.accepted.cueUnits, {matched: 300, missed: 5, extra: 0});
});
