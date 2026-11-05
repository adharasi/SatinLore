import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

test("accounts and cloud libraries use real SQLite transactions, cross-user isolation and deletion revisions", { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "account-test-worker.mjs", contents: `
      export { ReaderAccount } from "./deploy/cloudflare/accounts.mjs";
      // Synthetic runtime fixture only. Production derives the namespace from verified Access claims.
      export default { fetch(request, env) {
        const url = new URL(request.url), headers = new Headers(request.headers);
        headers.set("Origin", "https://app.satinlore.com");
        const stub = env.READER_ACCOUNTS.get(env.READER_ACCOUNTS.idFromName(request.headers.get("X-Fixture-User") || "one"));
        return stub.fetch(new Request("https://accounts.internal" + url.pathname, {
          method: request.method, headers, ...(request.method === "POST" ? {body: request.body} : {})
        }));
      }};` },
    { type: "ESModule", path: root + "deploy/cloudflare/accounts.mjs", contents: await readFile(new URL("../deploy/cloudflare/accounts.mjs", import.meta.url), "utf8") },
    { type: "ESModule", path: root + "app/static/devices/toy-profiles.mjs", contents: await readFile(new URL("../app/static/devices/toy-profiles.mjs", import.meta.url), "utf8") },
    ...await Promise.all(["storage", "import", "model", "scoring", "folders", "identity", "calibration", "experience-preferences"].map(async name => {
      const path = root + `app/static/reader/${name}.mjs`;
      return { type: "ESModule", path, contents: await readFile(path, "utf8") };
    })),
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0, durableObjects: {
    READER_ACCOUNTS: { className: "ReaderAccount", useSQLite: true },
  } });
  t.after(() => mf.dispose());
  const call = (path, body, user = "one", headers = {}) => mf.dispatchFetch("https://app.satinlore.com" + path, {
    method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Fixture-User": user, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const initial = await (await call("/api/account")).json();
  assert.equal(initial.registered, false);
  const created = await call("/api/account", { action: "create", adult: true, expectedRevision: 0 });
  assert.equal(created.status, 201, created.status === 201 ? "" : await created.text());
  const settings = { minimum: 1, background: 1, preferred: 3, maximum: 5, recovery: 0, gain: 1, rhythm: "steady" };
  const preset = { id: crypto.randomUUID(), name: "Synthetic setting", toy: "flexer", scope: "account", storyId: null,
    mode: "continuous", channels: { vibrate: settings, fingering: { ...settings, preferred: 2 } } };
  const saved = await call("/api/presets", { expectedRevision: 1, preset });
  assert.equal(saved.status, 200, saved.status === 200 ? "" : await saved.text());
  assert.equal((await (await call("/api/account")).json()).presets.length, 1);
  assert.equal((await (await call("/api/account", undefined, "two")).json()).registered, false);
  const exported = await (await call("/api/account/data")).json();
  assert.equal(exported.revision, 2); assert.equal(exported.presets[0].channels.fingering.preferred, 2);
  assert.equal(exported.playback, "paused");
  const otherSave = await call("/api/presets", { expectedRevision: 2, preset }, "two");
  assert.equal(otherSave.status, 409);
  const removed = await call("/api/account/delete", { confirm: true, expectedRevision: 2 });
  assert.equal(removed.status, 200);
  assert.equal((await call("/api/presets", { expectedRevision: 2, preset })).status, 409, "A delayed write cannot resurrect deleted settings in real storage.");
  const final = await (await call("/api/account/data")).json();
  assert.equal(final.registered, false); assert.equal(final.account, null); assert.equal(final.revision, 3); assert.deepEqual(final.presets, []);
  assert.equal(final.library, undefined, "Legacy beta accounts keep the prior export format.");

  const cloud = (path, body, headers = {}) => call(path, body, "public-reader", { "X-SatinLore-Account-Mode": "email",
    "X-SatinLore-Account-Expires-At": String(Date.now() + 60_000), ...headers });
  const library = "/api/account/library";
  assert.equal((await cloud("/api/account", { action: "create", adult: true, expectedRevision: 0 })).status, 201);
  assert.equal((await call(library, undefined, "public-reader")).status, 403, "Library storage requires the trusted router mode.");
  assert.equal((await cloud(library, undefined, { "X-SatinLore-Account-Expires-At": String(Date.now() - 1) })).status, 403);
  const { owner } = await (await cloud(library)).json();
  const save = (body, expectedRevision) => cloud(library, { ...body, expectedRevision, expectedOwner: owner });
  const story = { id: crypto.randomUUID(), title: "Synthetic story", description: "Neutral fixture", text: "A library opened.\n\nVisitors read quietly.",
    position: 0, corrections: [0, null], analysisVersion: "fixture-v1" };
  const createdStory = await save({ action: "saveStory", story }, 0);
  assert.equal(createdStory.status, 200, createdStory.ok ? "" : await createdStory.text());
  assert.equal((await createdStory.json()).revision, 1);
  const prefs = { appearance: "light", width: "full", fontSize: "large", spacing: "relaxed", follow: false };
  assert.equal((await save({ action: "savePreferences", preferences: { ...prefs, playback: "running" } }, null)).status, 400);
  const savedPrefs = await save({ action: "savePreferences", preferences: prefs }, null);
  assert.deepEqual(await savedPrefs.json(), { preferences: { ...prefs, revision: 1 } });
  assert.equal((await save({ action: "savePreferences", preferences: prefs }, null)).status, 409);
  const experience = { quiet: "edging", edging: true, maximum: 17, rhythm: "gentle", peakPattern: "crest" };
  const saveExperience = (value, version) => save({ action: "savePreferences", preferences: { ...prefs, experience: value } }, version);
  assert.equal((await saveExperience({ ...experience, maximum: 21 }, 1)).status, 400);
  assert.equal((await saveExperience({ ...experience, armed: true }, 1)).status, 400);
  assert.equal((await saveExperience({ ...experience, edgePattern: "unknown" }, 1)).status, 400);
  assert.deepEqual(await (await saveExperience(experience, 1)).json(), { preferences: { ...prefs, experience, revision: 2 } });
  experience.edgePattern = "off";
  assert.deepEqual(await (await saveExperience(experience, 2)).json(), { preferences: { ...prefs, experience, revision: 3 } });
  const updatedAppearance = { ...prefs, appearance: "system" };
  const savedAppearance = await save({ action: "savePreferences", preferences: updatedAppearance }, 3);
  assert.deepEqual(await savedAppearance.json(), { preferences: { ...updatedAppearance, experience, revision: 4 } });
  const edited = await save({ action: "updateStory", id: story.id, changes: { position: 1, corrections: [null, 0], description: "", favorite: true } }, 1);
  assert.equal(edited.status, 200);
  const metadata = await edited.json();
  assert.deepEqual(Object.keys(metadata).sort(), ["revision", "storyRevision", "updatedAt"], "Progress returns no story text.");
  assert.equal(metadata.revision, 2);
  const read = await (await cloud(library)).json();
  assert.equal(read.stories[0].text, story.text); assert.equal(read.stories[0].position, 1);
  assert.deepEqual(read.stories[0].corrections, [null, 0]); assert.equal(read.stories[0].description, undefined);
  assert.equal(read.stories[0].favorite, true);
  assert.deepEqual(read.preferences, { ...updatedAppearance, experience, revision: 4 });
  assert.equal((await (await cloud("/api/account")).json()).library, undefined, "Preset reads don't carry saved story text.");
  const download = await (await cloud("/api/account/data")).json();
  assert.deepEqual(download.library, { revision: read.revision, stories: read.stories, preferences: read.preferences });

  const removedStory = await save({ action: "deleteStory", id: story.id }, 2);
  assert.deepEqual(await removedStory.json(), { deleted: true, revision: 3 });
  assert.equal((await save({ action: "saveStory", story }, 2)).status, 409);
  for (let i = 0; i < 4; i++) {
    const large = { ...story, id: `long-story-${i}`, text: "ü".repeat(250_000), corrections: [null] };
    const response = await save({ action: "saveStory", story: large }, i + 3);
    assert.equal(response.status, i < 3 ? 200 : 413, "Bound the aggregate even when individual stories are valid.");
  }
  assert.equal((await (await cloud(library)).json()).stories.length, 3);
  assert.equal((await cloud("/api/account/delete", { confirm: true, expectedRevision: 1 })).status, 200);
  assert.deepEqual((await (await cloud("/api/account/data")).json()).library, { revision: 0, stories: [], preferences: null });
  assert.equal((await cloud("/api/account", { action: "create", adult: true, expectedRevision: 2 })).status, 201);
  assert.notEqual((await (await cloud(library)).json()).owner, owner);
  assert.equal((await save({ action: "saveStory", story }, 0)).status, 409, "A recreated account won't accept the prior owner's pending requests.");
});
