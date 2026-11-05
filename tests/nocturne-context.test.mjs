import test from "node:test";
import assert from "node:assert/strict";
import {nocturneContextCandidates, nocturneContextKey, requestNocturneContext, validateNocturneContext} from "../app/static/reader/nocturne.mjs";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {normalizeSceneProfiles} from "../app/static/reader/calibration.mjs";
import {workspace} from "./helpers/workspace.mjs";
import {waitForWorkspace, waitForContext} from "./helpers/workspace-wait.mjs";

const paragraph = (text, extra = {}) => ({text, analysed: true, quiet: false, cloudExcluded: false, override: null, suggestedLevel: 0, ...extra});
const annotation = (id, extra = {}) => ({id, category: "romance", phase: "build", shape: "unspecified", confidence: 90, ...extra});
const response = paragraphs => ({version: "context-v1", labels: paragraphs.map(({id}) => annotation(id)), usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15}});

test("context windows include unmatched sections but omit protected, manual, missing and oversized paragraphs", () => {
  const paragraphs = Array.from({length: 20}, (_, i) => paragraph(`Neutral section ${i}.`));
  paragraphs[8].quiet = true;
  paragraphs[9].cloudExcluded = true;
  paragraphs[10].override = 0;
  paragraphs[11].analysed = false;
  paragraphs[12].text = "😀".repeat(751);
  const result = nocturneContextCandidates(paragraphs, 10);
  assert.deepEqual(result.paragraphs.map(({id}) => id), [13, 14, 15]);
  assert.equal(result.excluded, 4);
  assert.equal(result.limited, 1);
  assert.deepEqual(Object.keys(result.paragraphs[0]), ["id", "text"]);
  const escaped = nocturneContextCandidates(Array.from({length: 8}, () => paragraph("\n".repeat(3000))));
  assert.ok(new TextEncoder().encode(JSON.stringify({version: "context-v1", consent: true, paragraphs: escaped.paragraphs})).length <= 16384);
  assert.ok(escaped.paragraphs.reduce((sum, p) => sum + new TextEncoder().encode(p.text).length, 0) <= 12000);
});

test("context cache keys cover exact source text, IDs, model and contract and requests require consent", async () => {
  const paragraphs = [{id: 0, text: "A letter arrived."}];
  assert.equal(await nocturneContextKey(paragraphs), await nocturneContextKey(structuredClone(paragraphs)));
  assert.notEqual(await nocturneContextKey(paragraphs), await nocturneContextKey([{id: 0, text: "A letter departed."}]));
  assert.notEqual(await nocturneContextKey(paragraphs), await nocturneContextKey([{id: 1, text: paragraphs[0].text}]));
  let calls = 0;
  await assert.rejects(requestNocturneContext(paragraphs, {request: () => { calls++; }}), /Choose whether/);
  assert.equal(calls, 0);
  const result = await requestNocturneContext(paragraphs, {consent: true, request: async (path, init) => {
    assert.equal(path, "/api/scene-analysis");
    assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), {version: "context-v1", consent: true, paragraphs});
    return Response.json(response(paragraphs));
  }});
  assert.equal(result.labels.get(0).category, "romance");
  assert.equal(result.usage.totalTokens, 15);
});

test("context validation requires exact source IDs, coherent categories and bounded neutral metadata", () => {
  const paragraphs = [{id: 0, text: "A letter arrived."}];
  assert.equal(validateNocturneContext(paragraphs, response(paragraphs)).labels.size, 1);
  for (const invalid of [
    {...response(paragraphs), labels: [annotation(1)]},
    {...response(paragraphs), labels: [annotation(0, {category: "neutral", phase: "peak"})]},
    {...response(paragraphs), labels: [annotation(0, {confidence: 101})]},
    {...response(paragraphs), labels: [annotation(0, {text: "Unexpected prose"})]},
    {...response(paragraphs), usage: {inputTokens: 10, outputTokens: 5, totalTokens: 16}},
    {...response(paragraphs), device: "Unexpected command"},
  ]) assert.throws(() => validateNocturneContext(paragraphs, invalid), /Unexpected Nocturne/);
});

test("context recovers unmatched romance only in Nocturne and preserves hard boundaries, corrections and reanalysis", async () => {
  const model = new ReaderModel();
  model.load("A handwritten note waited on the table.\n\n***\n\nA folded map lay in the bag.\n\nThey kissed gently.");
  assert.equal(model.effectiveLevels()[0], 0);
  model.nocturneContext.set(0, annotation(0));
  model.nocturneContext.set(1, annotation(1));
  model.nocturneContext.set(2, annotation(2, {confidence: 79}));
  assert.equal(model.effectiveLevels({nocturne: true})[0], 1);
  assert.equal(model.effectiveLevels()[0], 0);
  assert.equal(model.effectiveLevels({nocturne: true})[1], 0);
  assert.equal(model.effectiveLevels({nocturne: true})[2], 0);
  assert.doesNotThrow(() => normalizeSceneProfiles(model.effectiveProfiles({nocturne: true, peakPattern: "steady"}), 4));
  model.setOverride(0, 0);
  assert.equal(model.effectiveLevels({nocturne: true})[0], 0);
  model.resetOverride(0);
  model.paragraphs[0].cloudExcluded = true;
  assert.equal(model.effectiveLevels({nocturne: true})[0], 0);
  model.paragraphs[0].cloudExcluded = false;
  model.nocturneLabels.set(3, "wave");
  model.nocturneContext.set(3, annotation(3, {category: "intimacy", phase: "peak"}));
  assert.doesNotThrow(() => normalizeSceneProfiles(model.effectiveProfiles({nocturne: true, peakPattern: "steady"}), 4));
  await model.analyse();
  assert.equal(model.nocturneContext.size, 0);
});

async function contextWorkspace(t, request) {
  const app = workspace({hosted: true, sceneRequest: request}); t.after(() => app.destroy());
  await app.settle();
  await app.add(Array.from({length: 60}, (_, i) => `The sealed envelope rested beside map number ${i}.`).join("\n\n"));
  app.nodes.get("scene-model").value = "nocturne";
  await app.nodes.get("scene-model").dispatch("change");
  await waitForWorkspace(app, () => app.read("nocturneReady === true && !checkingNocturne"), "Nocturne availability did not settle.");
  return app;
}

test("actual context UI needs explicit consent, remains paused, reuses coverage and clears on hide", async t => {
  const posts = [];
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const body = JSON.parse(init.body); posts.push(body); return Response.json(response(body.paragraphs));
  });
  assert.equal(posts.length, 0);
  await app.click("nocturne-context-enable");
  assert.equal(posts.length, 0);
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  assert.equal(posts.length, 1);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("currentStory().model.effectiveLevels({nocturne:true})[0]"), 1);
  assert.equal(app.read("currentStory().model.effectiveLevels()[0]"), 0);
  app.read("latest = {...latest, running:true}; display()"); await waitForContext(app);
  assert.equal(posts.length, 1, "Already reviewed nearby source is reused.");
  await app.visibility(true);
  assert.equal(app.read("currentStory().model.nocturneContext.size"), 0);
  assert.equal(app.read("currentStory().nocturneContextSession.enabled"), false);
  assert.equal(app.nodes.get("nocturne-context-consent").checked, false);
  assert.equal(app.read("latest.running"), false);
  assert.deepEqual(app.errors, []);
});

test("context visit budget counts failed attempts and never schedules while paused", async t => {
  let count = 0;
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    count++; return Response.json({code: "refused"}, {status: 422});
  });
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  assert.equal(count, 1);
  app.read("latest = {...latest,position:10}; display()"); await waitForContext(app);
  assert.equal(count, 1);
  for (const position of [10, 20, 30, 40, 50, 59]) {
    app.read(`latest = {...latest,running:true,position:${position}}; display()`); await waitForContext(app);
  }
  assert.equal(count, 6);
  assert.equal(app.read("currentStory().nocturneContextSession.requests"), 6);
  assert.equal(app.read("currentStory().model.nocturneContext.size"), 0);
  assert.deepEqual(app.errors, []);
});

test("advancing twenty paragraphs requests useful overlapping context batches instead of one new paragraph each time", async t => {
  const batches = [];
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const body = JSON.parse(init.body); batches.push(body.paragraphs.map(p => p.id));
    return Response.json(response(body.paragraphs));
  });
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  for (let position = 1; position < 20; position++) {
    app.read(`latest = {...latest,running:true,position:${position}}; display()`); await waitForContext(app);
  }
  assert.equal(batches.length, 5);
  assert.deepEqual(batches[0], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(batches[1], [4, 5, 6, 7, 8, 9, 10, 11]);
  const seen = new Set();
  for (const batch of batches) {
    assert.equal(batch.length, 8);
    assert.ok(batch.filter(id => !seen.has(id)).length >= 4);
    batch.forEach(id => seen.add(id));
  }
  assert.equal(seen.size, 24);
  assert.deepEqual(app.errors, []);
});

test("a late contextual response after Stop and model switch cannot repopulate the mapping", async t => {
  let release;
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const body = JSON.parse(init.body);
    await new Promise(resolve => { release = resolve; });
    return Response.json(response(body.paragraphs));
  });
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  const pending = app.click("nocturne-context-enable");
  await waitForWorkspace(app, () => typeof release === "function", "Delayed provider request did not start.");
  assert.equal(app.read("nocturneOperation !== null"), true);
  await app.click("stop");
  app.nodes.get("scene-model").value = "loom";
  await app.nodes.get("scene-model").dispatch("change");
  release(); await pending; await app.settle();
  assert.equal(app.read("currentStory().model.nocturneContext.size"), 0);
  assert.equal(app.read("currentStory().nocturneContextSession.enabled"), false);
  assert.equal(app.read("latest.running"), false);
  assert.deepEqual(app.errors, []);
});
