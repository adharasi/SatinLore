import test from "node:test";
import assert from "node:assert/strict";
import {workspace} from "./helpers/workspace.mjs";
import {waitForWorkspace, waitForContext} from "./helpers/workspace-wait.mjs";

const labelsFor = targets => ({version: "context-v3", labels: targets.map(id =>
  ({id, category: "romance", phase: "build", shape: "unspecified", confidence: 93, eventKind: "current"})), usage: null});

async function contextualReader(t, provider, publicAuth = false) {
  const app = workspace({hosted: true, publicAuth, sceneRequest: async (_path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const {targets} = JSON.parse(init.body);
    return provider ? provider(targets) : Response.json(labelsFor(targets));
  }});
  t.after(() => app.destroy());
  await app.settle();
  if (publicAuth) {
    app.access(async () => Response.json({authenticated: true, expiresAt: app.now() + 60_000}));
    await app.read("hostedAccess.check({fresh:true})");
    await app.settle();
  }
  await app.add("A sealed letter waited beside the empty chair.\n\nA folded map rested in the drawer.");
  app.nodes.get("scene-model").value = "nocturne";
  await app.nodes.get("scene-model").dispatch("change");
  await waitForWorkspace(app, () => app.read("nocturneReady === true && !checkingNocturne"), "Nocturne availability did not settle.");
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  return app;
}

async function start(app) {
  await app.click("connect");
  await app.click("start");
  await app.click("confirm-start");
  await app.settle();
  assert.equal(app.read("latest.running"), true);
}

for (const invalidate of ["clearAccountLibrary()", "hostedAccess.lose('Session expired.')"]) {
  test(`completed context on a local story is removed from the active controller by ${invalidate}`, async t => {
    const app = await contextualReader(t, null, invalidate.startsWith("clearAccountLibrary"));
    await app.click("nocturne-context-enable");
    await waitForContext(app);
    assert.equal(app.read("controller.levels[0]"), 1);
    assert.equal(app.read("accountExperience"), null);
    assert.equal(app.read("currentStory().accountOwner ?? null"), null);
    await start(app);
    app.read(invalidate);
    await app.settle();
    assert.equal(app.read("latest.running"), false);
    assert.equal(app.read("latest.output"), 0);
    assert.equal(app.read("controller.levels[0]"), 0);
    assert.equal(app.read("currentStory().model.nocturneContext.size"), 0);
    assert.equal(app.read("currentStory().nocturneContextSession.attempted.size"), 0);
    assert.equal(app.read("currentStory().nocturneContextSession.enabled"), false);
    assert.equal(app.nodes.get("nocturne-context-consent").checked, false);
    assert.deepEqual(app.errors, []);
  });
}

test("context annotations, consent and allowance are absent from the actual story persistence record", async t => {
  const app = await contextualReader(t);
  await app.click("nocturne-context-enable");
  await waitForContext(app);
  assert.ok(app.read("currentStory().nocturneContextSession.attempted.size") > 0);
  const record = JSON.parse(app.read("JSON.stringify(storyRecord(currentStory()))"));
  assert.deepEqual(Object.keys(record).sort(), ["analysisVersion", "corrections", "description", "favorite", "id", "position", "text", "title"]);
  assert.ok(record.corrections.every(value => value === null));
  assert.doesNotMatch(JSON.stringify(record), /context-v[123]|confidence|nocturneContext|attempted|enabled|requests|targets/i);
  assert.deepEqual(app.errors, []);
});

test("Disable revokes a pending contextual request even if its provider ignores abort", async t => {
  let release;
  const app = await contextualReader(t, async targets => {
    await new Promise(resolve => { release = resolve; });
    return Response.json(labelsFor(targets));
  });
  const pending = app.click("nocturne-context-enable");
  await waitForWorkspace(app, () => typeof release === "function", "Delayed provider request did not start.");
  assert.equal(app.read("currentStory().nocturneContextSession.enabled"), true);
  await app.click("nocturne-context-disable");
  release();
  await pending;
  await app.settle();
  assert.equal(app.read("nocturneOperation"), null);
  assert.equal(app.read("controller.levels[0]"), 0);
  assert.equal(app.read("currentStory().model.nocturneContext.size"), 0);
  assert.equal(app.read("currentStory().nocturneContextSession.enabled"), false);
  assert.equal(app.read("currentStory().nocturneContextSession.requests"), 1);
  assert.equal(app.read("latest.running"), false);
  assert.deepEqual(app.errors, []);
});
