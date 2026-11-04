import test from "node:test";
import assert from "node:assert/strict";
import {selectLibraryStories, storyMetadata} from "../app/static/reader/library-view.mjs";
import {serializeBackup, parseBackup, BackupImporter, downloadBackup, BACKUP_FORMAT} from "../app/static/reader/backup.mjs";
import {ReaderPreferences, READER_PREFERENCES_KEY, DEFAULT_READER_PREFERENCES} from "../app/static/reader/preferences.mjs";

const record = (changes = {}) => ({id: "original-local-id", title: "Neutral <title>", text: "The train arrived.\n\nA quiet station.",
  corrections: [0, null], position: 1, analysisVersion: "rules-v1", ...changes});
const makeIds = () => { let i = 0; return () => `restored-copy-${++i}`; };
function file(raw, name = "backup.json") {
  const bytes = new TextEncoder().encode(raw);
  return {name, size: bytes.length, arrayBuffer: async () => bytes.buffer};
}
function memory() {
  const values = new Map(); let writes = 0;
  return {values, get writes() { return writes; }, getItem: key => values.get(key) ?? null,
    setItem(key, value) { ++writes; values.set(key, value); }};
}

test("library search inspects titles only, with stable recent/title/progress sorting and no mutations", () => {
  const paragraphs = count => Array.from({length: count}, () => Object.defineProperty({}, "text", {get() { throw Error("Spoiler text accessed"); }}));
  const stories = [
    {id: "a", title: "Chapter 10", position: 0, lastOpenedAt: 100, model: {paragraphs: paragraphs(10)}},
    {id: "b", title: "Chapter 2", position: 4, lastOpenedAt: 0, updatedAt: 300, model: {paragraphs: paragraphs(5)}},
    {id: "c", title: "Other title", position: 0, lastOpenedAt: 200, model: {paragraphs: paragraphs(4)}},
  ];
  assert.deepEqual(selectLibraryStories(stories).map(story => story.id), ["b", "c", "a"]);
  assert.deepEqual(selectLibraryStories(stories, {sort: "title"}).map(story => story.id), ["b", "a", "c"]);
  assert.deepEqual(selectLibraryStories(stories, {sort: "progress"}).map(story => story.id), ["b", "c", "a"]);
  assert.deepEqual(selectLibraryStories(stories, {query: " CHAPTER ", sort: "title"}).map(story => story.id), ["b", "a"]);
  assert.deepEqual(selectLibraryStories(stories, {query: "Spoiler text"}), []);
  assert.deepEqual(stories.map(story => story.id), ["a", "b", "c"]);
  assert.deepEqual(selectLibraryStories([], {query: "anything"}), []);
});

test("active-story statistics describe place and word totals without retaining story text", () => {
  const stats = storyMetadata({position: 1, model: {paragraphs: [{text: "One ordinary day."}, {text: "A train arrived."}]}});
  assert.deepEqual(stats, {paragraphs: 2, words: 6, progressPercent: 100, positionLabel: "Section 2 of 2"});
  assert.deepEqual(storyMetadata(null), {paragraphs: 0, words: 0, progressPercent: 0, positionLabel: "No sections"});
  assert.doesNotMatch(JSON.stringify(stats), /ordinary|train/);
});

test("backups round-trip text, manual zero, corrections and position into fresh session-only records", () => {
  const source = record({playing: true, strength: 2, ceiling: 20, csrf: "private-token", saved: true, revision: 7, updatedAt: 123});
  const raw = serializeBackup([source]);
  assert.equal(JSON.parse(raw).format, BACKUP_FORMAT);
  assert.doesNotMatch(raw, /original-local-id|private-token|csrf|playing|strength|ceiling|saved|revision|updatedAt/);
  const createId = makeIds();
  const restored = parseBackup(raw, {createId})[0];
  assert.deepEqual(restored, {...record(), id: "restored-copy-1"});
  assert.equal(restored.saved, undefined);
  assert.equal(restored.revision, undefined);
  assert.deepEqual(parseBackup(raw, {createId})[0], {...record(), id: "restored-copy-2"});
  assert.throws(() => parseBackup(raw, {createId: () => "existing", existingIds: ["existing"]}), /existing stories are unchanged/);
  assert.throws(() => parseBackup(serializeBackup([record(), record()]), {createId: () => "same-id"}), /could not be opened/);
});

test("backup parsing rejects malformed/future schemas, extra state and invalid records without partial hydration", () => {
  const base = JSON.parse(serializeBackup([record()]));
  const bad = ["{", "[]", JSON.stringify({...base, schemaVersion: 2}), JSON.stringify({...base, token: "do-not-return"}),
    JSON.stringify({...base, stories: []}), JSON.stringify({...base, stories: [base.stories[0], {...base.stories[0], playing: true}]}),
    JSON.stringify({...base, stories: [{...base.stories[0], corrections: [null, 21]}]}),
    JSON.stringify({...base, stories: [{...base.stories[0], corrections: [null]}]}),
    JSON.stringify({...base, stories: [{...base.stories[0], position: 99}]}),
    JSON.stringify({...base, stories: [{...base.stories[0], title: "x".repeat(121)}]}),
    JSON.stringify({...base, stories: [{...base.stories[0], description: []}]}),
    JSON.stringify({...base, stories: [{...base.stories[0], favorite: 1}]}),
    JSON.stringify({...base, stories: [{...base.stories[0], text: ""}]}),
    JSON.stringify({...base, stories: Array.from({length: 21}, () => base.stories[0])}),
  ];
  let generated = 0;
  for (const raw of bad) assert.throws(() => parseBackup(raw, {createId: () => { ++generated; return "fresh"; }}), error => {
    assert.doesNotMatch(error.message, /do-not-return|Neutral|train|private/);
    return /existing stories are unchanged/.test(error.message);
  });
  assert.equal(generated, 0);
});

test("portable backups keep optional story details but omit local shelf and playback data", () => {
  const source = record({description: "A private <note>", favorite: true, folderId: "folder-local", playing: true});
  const raw = serializeBackup([source]);
  assert.doesNotMatch(raw, /folder-local|original-local-id|playing/);
  const restored = parseBackup(raw, {createId: makeIds()})[0];
  assert.deepEqual(restored, record({id: "restored-copy-1", description: source.description, favorite: true}));
});

test("portable backup bounds apply to UTF-8 bytes, paragraph count, story count and combined library size", () => {
  for (const value of [record({text: "é".repeat(250001), corrections: [null], position: 0}),
    record({text: Array.from({length: 2001}, () => "A").join("\n\n"), corrections: Array(2001).fill(null), position: 0})]) {
    assert.throws(() => serializeBackup([value]), /could not be opened/);
  }
  const large = record({text: "a".repeat(499000), corrections: [null], position: 0});
  assert.ok(serializeBackup(Array(4).fill(large)).length < 2_000_000);
  assert.throws(() => serializeBackup(Array(5).fill(large)), /2 MB/);
  assert.throws(() => serializeBackup(Array(21).fill(record())), /20 stories/);
  assert.throws(() => parseBackup(" ".repeat(2_000_001)), /2 MB/);
});

test("explicit backup file reading ignores cancelled/stale imports and validates actual bytes and UTF-8", async () => {
  const importer = new BackupImporter();
  const raw = serializeBackup([record()]);
  let finishOld;
  const pending = importer.read({name: "old.json", size: 10, arrayBuffer: () => new Promise(resolve => { finishOld = resolve; })});
  importer.invalidate();
  finishOld(new TextEncoder().encode(raw).buffer);
  assert.equal(await pending, null);
  const current = await importer.read(file(raw));
  assert.equal(current.length, 1);
  assert.notEqual(current[0].id, "original-local-id");
  assert.deepEqual(current[0].corrections, [0, null]);
  await assert.rejects(importer.read(file(raw, "story.txt")), /could not be opened/);
  await assert.rejects(importer.read({name: "bad.json", size: 2, arrayBuffer: async () => new Uint8Array([0xff, 0xff]).buffer}), /could not be opened/);
  await assert.rejects(importer.read({name: "huge.json", size: 2, arrayBuffer: async () => new Uint8Array(2_000_001).buffer}), /2 MB/);
  let rejectOld;
  const oldFailure = importer.read({name: "old.json", size: 1, arrayBuffer: () => new Promise((_, reject) => { rejectOld = reject; })});
  await importer.read(file(raw));
  rejectOld(Error("Private filename/content must not surface"));
  assert.equal(await oldFailure, null);
});

test("backup download reports initiation only, uses a generic filename and cleans object URLs on success/failure", () => {
  let appended = 0, clicked = 0, removed = 0, scheduled, link;
  const revoked = [];
  const urls = {createObjectURL(blob) { assert.equal(blob.type, "application/json;charset=utf-8"); return "blob:private-local"; }, revokeObjectURL: value => revoked.push(value)};
  const document = {body: {append() { ++appended; }}, createElement() { link = {click() { ++clicked; }, remove() { ++removed; }}; return link; }};
  const result = downloadBackup([record()], {filename: "private-story-title.json", document, urls, schedule: callback => { scheduled = callback; }});
  assert.match(result.message, /^Backup download started\./);
  assert.doesNotMatch(result.message, /successfully saved|file saved/i);
  assert.equal(link.download, "satinlore-library-backup.json");
  assert.equal(appended, 1); assert.equal(clicked, 1); assert.equal(removed, 1);
  assert.deepEqual(revoked, []);
  scheduled(); assert.deepEqual(revoked, ["blob:private-local"]);
  document.createElement = () => ({click() { throw Error("Browser blocked download"); }, remove() { ++removed; }});
  assert.throws(() => downloadBackup([record()], {document, urls}), /could not be started/);
  assert.equal(revoked.length, 2);
});

test("reading preferences load without writes and persist only presentation choices independently of stories", () => {
  const storage = memory();
  storage.values.set("satinlore.library.v1", "private-story-data");
  storage.values.set("satinlore.appearance", "dark");
  const preferences = new ReaderPreferences({storage});
  assert.deepEqual(preferences.load().preferences, DEFAULT_READER_PREFERENCES);
  assert.equal(storage.writes, 0);
  assert.equal(preferences.update({width: "full", follow: false}).saved, true);
  assert.equal(preferences.update({fontSize: "large"}).saved, true);
  const restored = new ReaderPreferences({storage}).load();
  assert.deepEqual(restored.preferences, {width: "full", fontSize: "large", spacing: "normal", follow: false});
  assert.equal(storage.values.get("satinlore.library.v1"), "private-story-data");
  assert.equal(storage.values.get("satinlore.appearance"), "dark");
  assert.doesNotMatch(storage.values.get(READER_PREFERENCES_KEY), /private-story|dark|ceiling|strength|text|token/);
  const copy = preferences.values; copy.width = "comfortable";
  assert.equal(preferences.values.width, "full");
  assert.throws(() => preferences.update({ceiling: 20}), /Invalid reading preferences/);
  assert.throws(() => preferences.update({follow: "yes"}), /Invalid reading preferences/);
  assert.throws(() => preferences.update({fontSize: "huge"}), /Invalid reading preferences/);
});

test("corrupt, future and blocked preference storage uses defaults without touching stories or claiming a saved change", () => {
  const storage = memory();
  for (const raw of ["{", JSON.stringify({schemaVersion: 2, preferences: {}}),
    JSON.stringify({schemaVersion: 1, preferences: {width: "wide", token: "private"}}), "x".repeat(501)]) {
    storage.values.set(READER_PREFERENCES_KEY, raw);
    assert.deepEqual(new ReaderPreferences({storage}).load().preferences, DEFAULT_READER_PREFERENCES);
    assert.equal(storage.values.get(READER_PREFERENCES_KEY), raw);
  }
  const blocked = new ReaderPreferences({storage: () => { throw Error("denied"); }});
  assert.equal(blocked.load().available, false);
  const changed = blocked.update({spacing: "relaxed"});
  assert.equal(changed.saved, false);
  assert.match(changed.message, /could not be saved/);
  assert.equal(changed.preferences.spacing, "relaxed");
  assert.equal(storage.writes, 0);
});
