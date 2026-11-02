import test from "node:test";
import assert from "node:assert/strict";
import {FolderStore, MAX_FOLDERS, selectFolderStories, validateFolderCatalog} from "../app/static/reader/folders.mjs";
import {StoryStore, LIBRARY_KEY, withBrowserLibraryLock} from "../app/static/reader/storage.mjs";
import {serializeBackup, parseBackup} from "../app/static/reader/backup.mjs";

const record = (changes = {}) => ({id: "story-1", title: "An ordinary journey", text: "The train arrived.",
  corrections: [0], position: 0, analysisVersion: "rules-v1", ...changes});
function setup(options = {}) {
  const values = new Map();
  const memory = {values, fail: false, getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (this.fail) { const error = Error("blocked"); error.name = "QuotaExceededError"; throw error; } values.set(key, value); },
    removeItem(key) { if (this.fail) throw Error("blocked"); values.delete(key); }};
  let number = 0, chain = Promise.resolve();
  const withLock = task => { const next = chain.then(task); chain = next.catch(() => {}); return next; };
  const store = new StoryStore({storage: memory, withLock, now: () => 1234, ...options});
  const folders = new FolderStore({store, createId: () => `local-${++number}`});
  return {memory, store, folders};
}

test("explicit folder creation persists only a bounded folder catalog, not a session-only story", async () => {
  const {memory, store, folders} = setup();
  assert.deepEqual(await folders.loadAll(), {folders: [], errors: [], unavailable: false});
  assert.equal(memory.values.size, 0);
  const folder = await folders.create("  Train journeys  ");
  assert.deepEqual(folder, {id: "folder-local-1", name: "Train journeys", revision: 1});
  const sessionStory = record({folderId: folder.id});
  assert.deepEqual(selectFolderStories([sessionStory], folder.id), [sessionStory]);
  assert.deepEqual((await store.loadAll()).stories, []);
  const raw = memory.getItem(LIBRARY_KEY);
  assert.doesNotMatch(raw, /ordinary|arrived|story-1|strength|ceiling|playing/);
  const saved = await store.saveStory(sessionStory);
  assert.equal(saved.folderId, folder.id);
  assert.equal((await store.loadAll()).stories[0].folderId, folder.id);
});

test("renaming preserves membership and unrelated records; stale and duplicate names fail", async () => {
  const {store, folders} = setup();
  const first = await folders.create("Travel"), second = await folders.create("Other");
  const saved = await store.saveStory(record({folderId: first.id}));
  const renamed = await folders.rename(first.id, "Journeys", {expectedRevision: first.revision});
  assert.equal(renamed.revision, 2);
  assert.equal((await store.loadAll()).stories[0].revision, saved.revision);
  assert.equal((await store.loadAll()).stories[0].folderId, first.id);
  await assert.rejects(folders.rename(first.id, "Changed again", {expectedRevision: 1}), {code: "conflict"});
  await assert.rejects(folders.rename(first.id, "OTHER"), {code: "duplicate"});
  assert.equal((await folders.loadAll()).folders.find(item => item.id === second.id).name, "Other");
});

test("deleting a folder atomically moves its saved stories to Unfiled and advances revisions", async () => {
  const {store, folders} = setup();
  const folder = await folders.create("Travel");
  const a = await store.saveStory(record({folderId: folder.id}));
  const b = await store.saveStory(record({id: "story-2"}));
  const result = await folders.delete(folder.id, {expectedRevision: folder.revision});
  assert.deepEqual(result, {deleted: true, stories: [{id: a.id, revision: 2, updatedAt: 1234, folderId: null}]});
  const restored = (await store.loadAll()).stories;
  assert.equal(restored[0].folderId, undefined);
  assert.equal(restored[0].revision, 2);
  assert.deepEqual(restored[1], b);
  await assert.rejects(store.saveStory({...a, title: "An obsolete save"}, {expectedRevision: a.revision}), {code: "conflict"});
  assert.deepEqual((await folders.loadAll()).folders, []);
  assert.deepEqual(selectFolderStories(restored, "unfiled").map(story => story.id), ["story-1", "story-2"]);
});

test("failed folder writes do not report success, discard membership or remove readable data", async () => {
  const {memory, store, folders} = setup();
  const folder = await folders.create("Travel");
  await store.saveStory(record({folderId: folder.id}));
  const raw = memory.getItem(LIBRARY_KEY);
  memory.fail = true;
  await assert.rejects(folders.rename(folder.id, "New name"), {code: "quota"});
  await assert.rejects(folders.delete(folder.id), {code: "quota"});
  await assert.rejects(folders.create("Another"), {code: "quota"});
  assert.equal(memory.getItem(LIBRARY_KEY), raw);
  assert.equal((await store.loadAll()).stories[0].folderId, folder.id);
});

test("story autosaves and individual deletion retain the folder catalog; Delete all clears it", async () => {
  const {store, folders, memory} = setup();
  const folder = await folders.create("Travel");
  const saved = await store.saveStory(record({folderId: folder.id}));
  const changed = await store.saveStory({...saved, title: "A new title"}, {expectedRevision: saved.revision});
  assert.equal(changed.folderId, folder.id);
  await store.deleteStory(changed.id, {expectedRevision: changed.revision});
  assert.deepEqual((await folders.loadAll()).folders, [folder]);
  await store.deleteAll();
  assert.deepEqual((await folders.loadAll()).folders, []);
  assert.equal(memory.getItem(LIBRARY_KEY), null);
});

test("folder names, duplicate identities and count limits are validated before storage changes", async () => {
  const {folders, memory, store} = setup();
  await folders.create("Travel");
  await assert.rejects(folders.create(" TRAVEL "), {code: "duplicate"});
  await assert.rejects(folders.create("Ｔｒａｖｅｌ"), {code: "duplicate"});
  for (const value of ["", " ", "x".repeat(61), "Hidden\u200bname", 10, null]) await assert.rejects(folders.create(value), {code: "invalid"});
  for (let index = 1; index < MAX_FOLDERS; index++) await folders.create(`Folder ${index}`);
  const raw = memory.getItem(LIBRARY_KEY);
  await assert.rejects(folders.create("Too many"), {code: "limit"});
  assert.equal(memory.getItem(LIBRARY_KEY), raw);
  const collision = new FolderStore({store, createId: () => "local-1"});
  await folders.delete((await folders.loadAll()).folders.at(-1).id);
  await assert.rejects(collision.create("Unique name"), {code: "conflict"});
});

test("corrupt folder catalogs or orphan saved memberships stay untouched and block mutations", async () => {
  const {memory, store, folders} = setup();
  const folder = {id: "folder-one", name: "Travel", revision: 1};
  for (const catalog of [null, {}, Array(31).fill(folder), [folder, {...folder}], [{...folder, revision: 0}],
    [{...folder, name: " travel "}], [{...folder, token: "extra"}], [{...folder, id: "../invalid"}]]) {
    const raw = JSON.stringify({schemaVersion: 1, stories: [], folders: catalog});
    memory.setItem(LIBRARY_KEY, raw);
    assert.equal((await folders.loadAll()).errors.length, 1);
    await assert.rejects(folders.create("New"), {code: "corrupt"});
    assert.equal(memory.getItem(LIBRARY_KEY), raw);
  }
  memory.setItem(LIBRARY_KEY, JSON.stringify({schemaVersion: 1, stories: [{...record({folderId: "folder-missing"}), revision: 1, updatedAt: 0}]}));
  assert.equal((await store.loadAll()).errors.length, 1);
  await assert.rejects(folders.create("New"), {code: "corrupt"});
});

test("serialized operations preserve concurrent folder creation, saved records and expected revisions", async () => {
  const {memory, store, folders} = setup();
  let chain = Promise.resolve(), calls = 0;
  const lock = task => { ++calls; const next = chain.then(task); chain = next.catch(() => {}); return next; };
  store.withLock = lock;
  const otherStore = new StoryStore({storage: memory, withLock: lock, now: () => 3456});
  const otherFolders = new FolderStore({store: otherStore, createId: () => "other"});
  const [one, two] = await Promise.all([folders.create("First"), otherFolders.create("Second")]);
  const saved = await store.saveStory(record({folderId: one.id}));
  await Promise.all([otherFolders.rename(two.id, "Renamed"), store.saveStory({...saved, position: 0}, {expectedRevision: saved.revision})]);
  assert.equal((await folders.loadAll()).folders.length, 2);
  assert.equal((await store.loadAll()).stories[0].revision, 2);
  assert.equal(calls, 5);
});

test("browser locking is required and legacy backups intentionally restore stories Unfiled", async () => {
  const blocked = setup({withLock: task => withBrowserLibraryLock(task, null)});
  await assert.rejects(blocked.folders.create("Travel"), {code: "unsupported"});
  assert.equal(blocked.memory.values.size, 0);
  const raw = serializeBackup([record({folderId: "folder-private"})]);
  assert.doesNotMatch(raw, /folder-private|folderId/);
  assert.equal(parseBackup(raw, {createId: () => "new-copy"})[0].folderId, undefined);
  assert.deepEqual(validateFolderCatalog(), []);
});
