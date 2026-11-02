import test from "node:test";
import assert from "node:assert/strict";
import {workspace} from "./helpers/workspace.mjs";
import {serializeBackup} from "../app/static/reader/backup.mjs";
import {READER_PREFERENCES_KEY} from "../app/static/reader/preferences.mjs";

const backupRecord = (changes = {}) => ({id: "old-backup-id", title: "Restored neutral story", text: "The train arrived.\n\nA quiet station.",
  corrections: [0, 3], position: 1, analysisVersion: "rules-v1", ...changes});
function backupFile(records = [backupRecord()]) {
  const bytes = new TextEncoder().encode(serializeBackup(records));
  return {name: "private-backup.json", size: bytes.length, arrayBuffer: async () => bytes.buffer};
}
function descendants(node) { return (node?.children ?? []).flatMap(child => [child, ...descendants(child)]); }
function listedIds(app) { return descendants(app.nodes.get("story-list")).filter(node => node.dataset?.storyId).map(node => node.dataset.storyId); }
async function ready(t) { const app = workspace(); t.after(() => app.destroy()); await app.settle(); return app; }
async function change(app, id, value) {
  const node = app.nodes.get(id); node.value = value;
  await node.dispatch(id === "library-search" ? "input" : "change"); await app.settle();
}
async function restore(app, file) {
  await app.nodes.get("import-backup").dispatch("change", {target: {files: [file]}});
  await app.settle();
}

test("actual library search/sort and story tabs discover titles without searching future text", async t => {
  const app = await ready(t);
  await app.add("An ordinary paragraph.\n\nHidden spoiler phrase.");
  app.read("currentStory().title = 'Zeta title'; renderLibrary();");
  const first = app.read("activeId");
  await app.add("A different ordinary paragraph.");
  app.read("currentStory().title = 'Alpha title'; renderLibrary();");
  const second = app.read("activeId");
  await change(app, "library-search", "spoiler phrase");
  assert.deepEqual(listedIds(app), []);
  assert.match(app.nodes.get("library-results").textContent, /No story titles match/);
  await change(app, "library-search", "Zeta");
  assert.deepEqual(listedIds(app), [first]);
  await change(app, "library-search", "");
  await change(app, "library-sort", "title");
  assert.deepEqual(listedIds(app), [second, first]);
  const tabs = app.nodes.get("story-tabs").querySelectorAll('[role="tab"]');
  const firstTab = tabs.find(tab => tab.dataset.storyId === first);
  await firstTab.click(); await app.settle();
  assert.equal(app.read("activeId"), first);
  assert.equal(app.read("latest.running"), false);
  assert.deepEqual(app.errors, []);
});

test("actual export controls initiate current/all backups and restore fresh paused session copies with corrections", async t => {
  const app = await ready(t);
  await app.add();
  const initial = app.read("activeId");
  await app.click("export-story");
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].records.length, 1);
  assert.equal(app.downloads[0].options.filename, "satinlore-story-backup.json");
  assert.match(app.nodes.get("library-transfer-status").textContent, /download started/);
  await restore(app, backupFile());
  assert.equal(app.read("stories.length"), 2);
  assert.notEqual(app.read("activeId"), initial);
  assert.notEqual(app.read("activeId"), "old-backup-id");
  assert.equal(app.read("currentStory().saved"), false);
  assert.equal(app.read("currentStory().revision"), null);
  assert.equal(app.read("currentStory().position"), 1);
  assert.deepEqual(Array.from(app.read("currentStory().model.paragraphs.map(paragraph => paragraph.override)")), [0, 3]);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("latest.strength"), 1);
  assert.match(app.nodes.get("library-transfer-status").textContent, /session/);
  await app.click("export-library");
  assert.equal(app.downloads.length, 2);
  assert.equal(app.downloads[1].records.length, 2);
  assert.equal(app.read("stories.every(story => !story.saved)"), true);
  assert.deepEqual(app.errors, []);
});

test("five visible story tabs keep insertion order when selected and arrow focus does not switch stories", async t => {
  const app = await ready(t);
  for (let index = 0; index < 5; index++) await app.add(`An ordinary section ${index + 1}.`);
  const created = Array.from(app.read("stories.map(story => story.id)"));
  let tabs = app.nodes.get("story-tabs").querySelectorAll('[role="tab"]');
  assert.deepEqual(tabs.map(tab => tab.dataset.storyId), created);
  await tabs[2].click(); await app.settle();
  tabs = app.nodes.get("story-tabs").querySelectorAll('[role="tab"]');
  assert.deepEqual(tabs.map(tab => tab.dataset.storyId), created);
  assert.equal(app.read("activeId"), created[2]);
  await tabs[2].dispatch("keydown", {key: "ArrowRight"});
  assert.equal(app.document.activeElement.dataset.storyId, created[3]);
  assert.equal(app.read("activeId"), created[2]);
  assert.equal(tabs[2].getAttribute("aria-selected"), "true");
  assert.equal(tabs[3].getAttribute("aria-selected"), "false");
});

test("Stop, story deletion and tab hiding invalidate an actual pending backup restore", async t => {
  for (const interruption of ["stop", "delete-story", "hide"]) {
    const app = await ready(t); await app.add();
    const valid = backupFile();
    let finish;
    const pending = {name: valid.name, size: valid.size, arrayBuffer: () => new Promise(resolve => { finish = resolve; })};
    await restore(app, pending);
    assert.equal(app.read("backupBusy"), true);
    if (interruption === "hide") await app.visibility(true); else await app.click(interruption);
    await app.settle();
    const remaining = app.read("stories.length");
    finish(await valid.arrayBuffer()); await app.settle();
    assert.equal(app.read("stories.length"), remaining, interruption);
    assert.equal(app.read("backupBusy"), false);
    assert.equal(app.read("latest.running"), false);
    assert.equal(app.read("stories.some(story => story.title === 'Restored neutral story')"), false);
    assert.deepEqual(app.errors, []);
  }
});

test("combined restore limits preserve the whole current workspace without a partial import", async t => {
  const app = await ready(t); await app.add();
  const before = app.read("activeId");
  const records = Array.from({length: 20}, (_, index) => backupRecord({id: `copy-${index}`}));
  await restore(app, backupFile(records));
  assert.equal(app.read("stories.length"), 1);
  assert.equal(app.read("activeId"), before);
  assert.match(app.nodes.get("library-transfer-status").textContent, /20 stories/);
  assert.equal(app.read("backupBusy"), false);
  assert.equal(app.read("latest.running"), false);
});

test("actual reading preference controls retain position, pause and store only presentation choices", async t => {
  const app = await ready(t); await app.add();
  assert.equal(app.preferenceValues.size, 0);
  await app.click("next");
  const position = app.read("latest.position");
  await app.click("connect"); await app.click("start"); await app.click("confirm-start"); await app.settle();
  assert.equal(app.read("latest.running"), true);
  await change(app, "reading-width", "full");
  await change(app, "font-size", "large");
  await change(app, "reading-spacing", "relaxed");
  app.nodes.get("follow-scroll").checked = false;
  await app.nodes.get("follow-scroll").dispatch("change");
  assert.equal(app.read("latest.position"), position);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.document.body.dataset.readingWidth, "full");
  assert.equal(app.nodes.get("reader").className, "reader-size-large");
  assert.deepEqual(JSON.parse(app.preferenceValues.get(READER_PREFERENCES_KEY)).preferences,
    {width: "full", fontSize: "large", spacing: "relaxed", follow: false});
  assert.equal(app.preferenceValues.size, 1);
  assert.equal(app.read("currentStory().saved"), false);
  assert.deepEqual(app.errors, []);
});

test("folder membership is retained only after saving and folder deletion permits the next autosave", async t => {
  const app = workspace(); t.after(() => app.destroy()); await app.settle(); await app.add();
  await app.read('changeFolder("create", "Evening reads")');
  const folder = app.read('folders[0].id');
  app.nodes.get("story-folder").value = folder;
  await app.nodes.get("story-folder").dispatch("change");
  assert.equal(app.read("currentStory().folderId"), folder);
  assert.doesNotMatch([...app.libraryValues.values()].join(""), /Synthetic story|tender kiss/);
  await app.click("save-story"); await app.click("confirm-save"); await app.settle();
  assert.equal(app.read("currentStory().saved"), true);
  assert.equal(app.read("store._read().stories[0].folderId"), folder);
  await app.read('changeFolder("delete")');
  assert.equal(app.read("currentStory().folderId"), null);
  assert.equal(app.read("store._read().stories[0].folderId"), undefined);
  app.nodes.get("level").value = "2"; await app.nodes.get("level").dispatch("input");
  await app.advance(400);
  assert.equal(app.read("currentStory().saveError"), "");
  assert.equal(app.read("store._read().stories[0].corrections[0]"), 2);
});

test("Stop invalidates a delayed link import and preserves the current story", async t => {
  const app = workspace(); t.after(() => app.destroy()); await app.settle(); await app.add();
  const id = app.read("activeId");
  app.read('webImporter.read = () => new Promise(resolve => { globalThis.finishSyntheticLink = resolve; })');
  app.nodes.get("story-url").value = "https://archiveofourown.org/works/12345";
  await app.click("import-url");
  assert.equal(app.read("importing"), true);
  await app.click("stop");
  app.read('finishSyntheticLink({title:"Late story",text:"The train was late.",scope:"entire work"})');
  await app.settle();
  assert.equal(app.read("activeId"), id);
  assert.equal(app.read("stories.length"), 1);
  assert.equal(app.read("importing"), false);
});
