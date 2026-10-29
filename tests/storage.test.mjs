import test from "node:test";
import assert from "node:assert/strict";
import {StoryStore, LIBRARY_KEY, MAX_LIBRARY_BYTES, validateStoryRecord, withBrowserLibraryLock} from "../app/static/reader/storage.mjs";

function memoryStorage() {
  const values = new Map();
  return {values, fail: false,
    getItem(key) { if (this.fail === "read") throw Error("blocked"); return values.get(key) ?? null; },
    setItem(key, value) { if (this.fail) { const error = Error("blocked"); error.name = "QuotaExceededError"; throw error; } values.set(key, value); },
    removeItem(key) { if (this.fail) throw Error("blocked"); values.delete(key); }};
}
function record(id = "story-1") {
  return {id, title: "A neutral story", text: "An ordinary day.\n\nThe train arrived.",
    corrections: [0, null], position: 1, analysisVersion: "rules-v1"};
}
const lock = task => task();
const store = (storage, options = {}) => new StoryStore({storage, withLock: lock, now: () => 123, ...options});

test("only explicit saves persist an allowlist; manual zero and position round-trip", async () => {
  const memory = memoryStorage();
  const local = store(memory);
  assert.deepEqual(await local.loadAll(), {stories: [], errors: [], unavailable: false});
  assert.equal(memory.values.size, 0);
  const saved = await local.saveStory({...record(), playing: true, ceiling: 20, multiplier: 2, token: "never-store"});
  assert.equal(saved.revision, 1);
  assert.equal(memory.values.size, 1);
  assert.equal(memory.values.has(LIBRARY_KEY), true);
  assert.deepEqual(Object.keys(saved).sort(), ["id", "title", "text", "corrections", "position", "analysisVersion", "updatedAt", "revision"].sort());
  const restored = (await store(memory).loadAll()).stories[0];
  assert.deepEqual(restored.corrections, [0, null]);
  assert.equal(restored.position, 1);
  assert.equal(restored.updatedAt, 123);
  assert.equal(JSON.stringify(restored).includes("never-store"), false);
});

test("quota and denied storage cannot report saved or delete unchanged data", async () => {
  const memory = memoryStorage(), local = store(memory);
  const initial = await local.saveStory(record());
  const raw = memory.getItem(LIBRARY_KEY);
  memory.fail = true;
  await assert.rejects(local.saveStory({...record(), title: "Changed"}, {expectedRevision: initial.revision}), {code: "quota"});
  await assert.rejects(local.deleteAll(), {code: "unavailable"});
  assert.equal(memory.values.get(LIBRARY_KEY), raw);
  const unavailable = await store(() => { throw Error("blocked"); }).loadAll();
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.errors.length, 1);
  assert.deepEqual(unavailable.stories, []);
});

test("corrupt records are reported and retained until explicit Delete All", async () => {
  const memory = memoryStorage(), local = store(memory);
  await local.saveStory(record());
  const envelope = JSON.parse(memory.getItem(LIBRARY_KEY));
  envelope.stories.push({...envelope.stories[0], id: "story-bad", corrections: [0, 99]});
  const corrupt = JSON.stringify(envelope);
  memory.setItem(LIBRARY_KEY, corrupt);
  const loaded = await local.loadAll();
  assert.equal(loaded.stories.length, 1);
  assert.equal(loaded.errors.length, 1);
  assert.equal(memory.getItem(LIBRARY_KEY), corrupt);
  await assert.rejects(local.saveStory(record("story-new")), {code: "corrupt"});
  await assert.rejects(local.deleteStory("story-1"), {code: "corrupt"});
  assert.equal(memory.getItem(LIBRARY_KEY), corrupt);
  await local.deleteAll();
  assert.equal(memory.getItem(LIBRARY_KEY), null);
  assert.deepEqual((await local.loadAll()).stories, []);
});

test("malformed, oversized and future-version library data never hydrates", async () => {
  const memory = memoryStorage(), local = store(memory);
  for (const raw of ["{", JSON.stringify({schemaVersion: 2, stories: []}), "x".repeat(MAX_LIBRARY_BYTES + 1)]) {
    memory.setItem(LIBRARY_KEY, raw);
    const loaded = await local.loadAll();
    assert.deepEqual(loaded.stories, []);
    assert.equal(loaded.errors.length, 1);
    assert.equal(loaded.unavailable, false);
    assert.equal(memory.getItem(LIBRARY_KEY), raw);
  }
});

test("stored text, title, position and corrections are strictly bounded", () => {
  const saved = {...record(), revision: 1, updatedAt: 123};
  for (const change of [
    {id: "../bad"}, {title: "x".repeat(121)}, {position: -1}, {position: 2},
    {corrections: [0]}, {corrections: [null, 1.5]}, {corrections: [null, "2"]},
    {text: "é".repeat(250001)}, {text: ""}, {revision: 0}, {analysisVersion: ""},
  ]) assert.throws(() => validateStoryRecord({...saved, ...change}), {code: "corrupt"});
  assert.deepEqual(validateStoryRecord({...saved, intensity: 20}).corrections, [0, null]);
});

test("revision checks prevent stale saves and deleted-story resurrection", async () => {
  const memory = memoryStorage(), first = store(memory), second = store(memory);
  const one = await first.saveStory(record());
  const two = await second.saveStory({...record(), title: "Renamed"}, {expectedRevision: one.revision});
  assert.equal(two.revision, 2);
  await assert.rejects(first.saveStory(record(), {expectedRevision: 1}), {code: "conflict"});
  await assert.rejects(first.saveStory(record()), {code: "conflict"});
  assert.equal((await first.loadAll()).stories[0].title, "Renamed");
  await second.deleteStory(one.id, {expectedRevision: 2});
  await assert.rejects(first.saveStory(record(), {expectedRevision: 2}), {code: "conflict"});
  assert.deepEqual((await first.loadAll()).stories, []);
});

test("mutations run inside the supplied cross-tab lock and retain other stories", async () => {
  const memory = memoryStorage();
  let chain = Promise.resolve(), operations = 0;
  const withLock = task => {
    operations++;
    const next = chain.then(task);
    chain = next.catch(() => {});
    return next;
  };
  const a = store(memory, {withLock}), b = store(memory, {withLock});
  await Promise.all([a.saveStory(record("first")), b.saveStory(record("second"))]);
  assert.equal((await a.loadAll()).stories.length, 2);
  await a.deleteStory("first");
  assert.equal((await b.loadAll()).stories[0].id, "second");
  await b.deleteAll();
  assert.equal(operations, 4);
  assert.deepEqual((await a.loadAll()).stories, []);
});

test("unsupported locking and the saved-story count limit remain truthful failures", async () => {
  const memory = memoryStorage();
  const noLock = new StoryStore({storage: memory, withLock: task => withBrowserLibraryLock(task, null)});
  await assert.rejects(noLock.saveStory(record()), {code: "unsupported"});
  assert.equal(memory.values.size, 0);
  const local = store(memory);
  for (let index = 0; index < 20; index++) await local.saveStory(record(`story-${index}`));
  await assert.rejects(local.saveStory(record("extra")), {code: "limit"});
  assert.equal((await local.loadAll()).stories.length, 20);
});


test("aggregate library size is bounded before replacing existing data", async () => {
  const memory = memoryStorage(), local = store(memory);
  const large = id => ({...record(id), text: "a".repeat(499000), corrections: [null], position: 0});
  for (let index = 0; index < 4; index++) await local.saveStory(large(`large-${index}`));
  const previous = memory.getItem(LIBRARY_KEY);
  await assert.rejects(local.saveStory(large("one-too-many")), {code: "limit"});
  assert.equal(memory.getItem(LIBRARY_KEY), previous);
  assert.equal((await local.loadAll()).stories.length, 4);
});
