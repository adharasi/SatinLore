import test from "node:test";
import assert from "node:assert/strict";
import {nocturneContextCandidates, nocturneContextNeedsReview, NOCTURNE_CONTEXT_SESSION_REQUESTS, NOCTURNE_CONTEXT_SESSION_BYTES,
  requestNocturneContext, validateNocturneContext} from "../app/static/reader/nocturne.mjs";
import {ReaderModel} from "../app/static/reader/model.mjs";
import {normalizeSceneProfiles} from "../app/static/reader/calibration.mjs";
import {workspace} from "./helpers/workspace.mjs";
import {waitForWorkspace, waitForContext} from "./helpers/workspace-wait.mjs";

const paragraph = (text, extra = {}) => ({text, analysed: true, quiet: false, cloudExcluded: false, override: null, suggestedLevel: 0, ...extra});
const annotation = (id, extra = {}) => ({id, category: "romance", phase: "build", shape: "unspecified", confidence: 90, eventKind: "current", ...extra});
const response = (targets, version = "context-v3") => ({version, labels: targets.map(id => annotation(id)), usage: {inputTokens: 10, outputTokens: 5, totalTokens: 15}});

test("context windows include unmatched sections but omit protected, manual, missing and oversized paragraphs", () => {
  const paragraphs = Array.from({length: 20}, (_, i) => paragraph(`Neutral section ${i}.`));
  paragraphs[8].quiet = true;
  paragraphs[9].cloudExcluded = true;
  paragraphs[10].override = 0;
  paragraphs[11].analysed = false;
  paragraphs[12].text = "😀".repeat(751);
  const result = nocturneContextCandidates(paragraphs, 8);
  assert.deepEqual(result.paragraphs.map(({id}) => id), [13, 14, 15, 16, 17, 18, 19]);
  assert.equal(result.excluded, 4);
  assert.equal(result.limited, 1);
  assert.deepEqual(Object.keys(result.paragraphs[0]), ["id", "text"]);
  const escaped = nocturneContextCandidates(Array.from({length: 3}, () => paragraph("\\".repeat(2710))));
  assert.equal(escaped.paragraphs.length, 2, "The encoded bound includes the target IDs as well as escaped text.");
  assert.ok(Buffer.byteLength(JSON.stringify({version: "context-v3", consent: true, paragraphs: escaped.paragraphs, targets: escaped.newIds})) <= 16384);
  assert.equal(escaped.sourceBytes, 5420);
});

test("context requests require consent and pin the response to the current contract", async () => {
  const paragraphs = [{id: 0, text: "A letter arrived."}];
  let calls = 0;
  await assert.rejects(requestNocturneContext(paragraphs, {request: () => { calls++; }}), /Choose whether/);
  assert.equal(calls, 0);
  const result = await requestNocturneContext(paragraphs, {consent: true, request: async (path, init) => {
    assert.equal(path, "/api/scene-analysis");
    assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), {version: "context-v3", consent: true, paragraphs, targets: [0]});
    return Response.json(response([0]));
  }});
  assert.equal(result.labels.get(0).category, "romance");
  assert.equal(result.usage.totalTokens, 15);
  await assert.rejects(requestNocturneContext(paragraphs, {consent: true, request: async () => Response.json(response([0], "context-v2"))}), /Unexpected Nocturne/);
  await assert.rejects(requestNocturneContext(paragraphs, {consent: true, request: async () => Response.json({version: "context-v1",
    labels: [{id: 0, category: "romance", phase: "build", shape: "unspecified", confidence: 90}], usage: null})}), /Unexpected Nocturne/);
});

test("context-only rows cannot be annotated by a v3 response", async () => {
  const paragraphs = [{id: 8, text: "A letter arrived."}, {id: 9, text: "She held it to the light."}];
  const targets = [9];
  const result = await requestNocturneContext(paragraphs, {consent: true, targets, request: async (_path, init) => {
    assert.deepEqual(JSON.parse(init.body), {version: "context-v3", consent: true, paragraphs, targets});
    return Response.json(response(targets));
  }});
  assert.deepEqual([...result.labels.keys()], [9]);
  for (const unexpectedIds of [[8], [8, 9], [10], []]) {
    await assert.rejects(requestNocturneContext(paragraphs, {consent: true, targets,
      request: async () => Response.json(response(unexpectedIds))}), /Unexpected Nocturne/);
  }
  for (const invalidTargets of [[], [9, 9], [9, 8], [10]]) {
    await assert.rejects(requestNocturneContext(paragraphs, {consent: true, targets: invalidTargets,
      request: async () => assert.fail("Invalid targets must fail before transport.")}), /Unexpected Nocturne targets/);
  }
});

test("context validation requires exact source IDs, coherent categories and bounded neutral metadata", () => {
  const paragraphs = [{id: 0, text: "A letter arrived."}];
  const valid = response([0]);
  assert.equal(validateNocturneContext(paragraphs, valid).labels.size, 1);
  assert.equal(validateNocturneContext(paragraphs, response([0], "context-v2")).labels.size, 1);
  for (const invalid of [
    {...valid, labels: [annotation(1)]},
    {...valid, labels: [annotation(0, {category: "neutral", phase: "peak"})]},
    {...valid, labels: [annotation(0, {confidence: 101})]},
    {...valid, labels: [annotation(0, {text: "Unexpected prose"})]},
    {...valid, usage: {inputTokens: 10, outputTokens: 5, totalTokens: 16}},
    {...valid, device: "Unexpected command"},
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

async function contextWorkspace(t, request, source = Array.from({length: 144}, (_, i) => `The sealed envelope rested beside map number ${i}.`).join("\n\n")) {
  const app = workspace({hosted: true, sceneRequest: request}); t.after(() => app.destroy());
  await app.settle();
  await app.add(source);
  await waitForWorkspace(app, () => app.read("currentStory()?.model.analysisReady === true"), "Local analysis did not settle.");
  app.nodes.get("scene-model").value = "nocturne";
  await app.nodes.get("scene-model").dispatch("change");
  await waitForWorkspace(app, () => app.read("nocturneReady === true && !checkingNocturne"), "Nocturne availability did not settle.");
  return app;
}

test("actual context UI needs explicit consent, remains paused, reuses coverage and clears on hide", async t => {
  const posts = [];
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const body = JSON.parse(init.body); posts.push(body);
    const review = response(body.targets);
    review.labels[1].eventKind = "reported";
    return Response.json(review);
  });
  assert.equal(posts.length, 0);
  await app.click("nocturne-context-enable");
  assert.equal(posts.length, 0);
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].targets, posts[0].paragraphs.map(({id}) => id));
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.read("currentStory().model.effectiveLevels({nocturne:true})[0]"), 1);
  assert.equal(app.read("currentStory().model.effectiveLevels()[0]"), 0);
  app.read("controller.setPosition(1)");
  assert.match(app.nodes.get("level-source").textContent, /reported · Background setting/);
  assert.equal(app.read("currentStory().model.effectiveLevels({nocturne:true})[1]"), 0);
  await app.click("nocturne-run");
  assert.match(app.nodes.get("nocturne-status").textContent, /Nearby context review is still active/);
  assert.equal(app.read("currentStory().model.effectiveLevels({nocturne:true})[0]"), 1);
  assert.equal(posts.length, 1, "The cue-only button has no new request or reset when Loom found no cues.");
  app.read("latest = {...latest, running:true}; display()"); await waitForContext(app);
  assert.equal(posts.length, 1, "Already reviewed nearby source is reused.");
  await app.visibility(true);
  assert.equal(app.read("currentStory().model.nocturneContext.size"), 0);
  assert.equal(app.read("currentStory().nocturneContextSession.enabled"), false);
  assert.equal(app.nodes.get("nocturne-context-consent").checked, false);
  assert.equal(app.read("latest.running"), false);
  assert.deepEqual(app.errors, []);
});

test("following windows include only permitted context and annotate new targets", async t => {
  const posts = [];
  const source = Array.from({length: 96}, (_, id) => id === 65 ?
    "A folded underage warning card remained on the sill." : `Envelope ${id} rested beside the sealed parcel.`).join("\n\n");
  const app = await contextWorkspace(t, async (_path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const body = JSON.parse(init.body);
    posts.push(body);
    const review = response(body.targets);
    if (posts.length === 2) review.labels.forEach(label => { label.confidence = 91; });
    return Response.json(review);
  }, source);
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].targets, Array.from({length: 64}, (_, id) => id));
  app.read("latest = {...latest,running:true,position:64}; display()"); await waitForContext(app);
  assert.equal(posts.length, 2);
  const {paragraphs, targets} = posts[1];
  assert.deepEqual(paragraphs.filter(({id}) => !targets.includes(id)).map(({id}) => id), [62, 63]);
  assert.deepEqual(targets, [64, ...Array.from({length: 30}, (_, index) => index + 66)]);
  assert.ok(paragraphs.every(({id, text}) => id !== 65 && !text.includes("underage warning")));
  assert.equal(app.read("currentStory().model.nocturneContext.size"), 95);
  assert.equal(app.read("currentStory().model.nocturneContext.get(63).confidence"), 90);
  assert.equal(app.read("currentStory().model.nocturneContext.get(64).confidence"), 91);
  assert.equal(app.read("currentStory().model.nocturneContext.has(65)"), false);
  assert.deepEqual(app.errors, []);
});

test("context request allowance counts failed attempts and never schedules while paused or seeking", async t => {
  let count = 0;
  const source = Array.from({length: 850}, (_, i) => `The sealed envelope rested beside map number ${i}.`).join("\n\n");
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    count++; return Response.json({code: "refused"}, {status: 422});
  }, source);
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  assert.equal(count, 1);
  app.read("latest = {...latest,position:64}; display()"); await waitForContext(app);
  assert.equal(count, 1);
  app.read("latest = {...latest,running:true,readingSeeking:true,position:64}; display()"); await waitForContext(app);
  assert.equal(count, 1, "Fast seeks do not spend a request before reading settles.");
  app.read("latest = {...latest,readingSeeking:false}");
  for (let position = 64; position <= 64 * NOCTURNE_CONTEXT_SESSION_REQUESTS; position += 64) {
    app.read(`latest = {...latest,running:true,position:${position}}; display()`); await waitForContext(app);
  }
  assert.equal(count, NOCTURNE_CONTEXT_SESSION_REQUESTS);
  assert.equal(app.read("currentStory().nocturneContextSession.requests"), NOCTURNE_CONTEXT_SESSION_REQUESTS);
  assert.equal(app.read("currentStory().model.nocturneContext.size"), 0);
  assert.deepEqual(app.errors, []);
});

test("dialogue-heavy coverage reaches later sections in five bounded requests", () => {
  const paragraphs = Array.from({length: 307}, (_, i) => paragraph(i % 3 === 0 ?
    `“Here is the plan,” said the courier at stop ${i}. ` + "A parcel waited on the desk. ".repeat(10) : `“I understand.” She checked stop ${i}.`));
  const attempted = new Set(), requests = [];
  let bytes = 0;
  for (let position = 0; position < paragraphs.length; position++) {
    const options = {attempted, maxBytes: NOCTURNE_CONTEXT_SESSION_BYTES - bytes};
    if (!nocturneContextNeedsReview(paragraphs, position, options)) continue;
    const batch = nocturneContextCandidates(paragraphs, position, options);
    assert.ok(batch.newIds.length > 0);
    assert.ok(batch.paragraphs.length <= 64);
    assert.ok(batch.sourceBytes <= 12000);
    assert.ok(batch.paragraphs.length - batch.newIds.length <= 2);
    assert.ok(Buffer.byteLength(JSON.stringify({version: "context-v3", consent: true, paragraphs: batch.paragraphs, targets: batch.newIds})) <= 16384);
    requests.push(batch);
    bytes += batch.sourceBytes;
    batch.newIds.forEach(id => attempted.add(id));
  }
  assert.equal(attempted.size, paragraphs.length);
  assert.equal(requests.length, 5);
  assert.ok(bytes <= NOCTURNE_CONTEXT_SESSION_BYTES);
  assert.deepEqual(requests.at(-1).paragraphs.slice(-1).map(p => p.id), [306]);
});

test("a nearby review can fill gaps around an earlier seek in one request", () => {
  const paragraphs = Array.from({length: 80}, (_, i) => paragraph(`Envelope ${i} rested on the desk.`));
  for (let id = 4; id < 8; id++) paragraphs[id].text = "x".repeat(3000);
  const seek = nocturneContextCandidates(paragraphs, 4);
  assert.deepEqual(seek.newIds, [4, 5, 6, 7]);
  assert.deepEqual(seek.paragraphs.map(({id}) => id), seek.newIds, "A first review after a seek leaves skipped text on the device.");
  paragraphs[3].cloudExcluded = true;
  paragraphs[8].override = 0;
  const attempted = new Set(seek.newIds);
  const backfill = nocturneContextCandidates(paragraphs, 0, {attempted});
  assert.deepEqual(backfill.newIds, [0, 1, 2, ...Array.from({length: 55}, (_, i) => i + 9)]);
  assert.deepEqual(backfill.paragraphs.map(({id}) => id), backfill.newIds);
  assert.ok(backfill.sourceBytes <= 12000);
});

test("automatic review leads the edge of a reviewed window during continuous reading", () => {
  const paragraphs = Array.from({length: 80}, (_, i) => paragraph(`Envelope ${i} rested beside the sealed parcel.`));
  const initial = nocturneContextCandidates(paragraphs);
  assert.equal(initial.newIds.at(-1), 63);
  const attempted = new Set(initial.newIds);
  assert.equal(nocturneContextNeedsReview(paragraphs, 20, {attempted}), false);
  assert.equal(nocturneContextNeedsReview(paragraphs, 40, {attempted}), true);
  const next = nocturneContextCandidates(paragraphs, 40, {attempted});
  assert.equal(next.newIds[0], 64);
  assert.deepEqual(next.paragraphs.slice(0, 3).map(({id}) => id), [62, 63, 64]);
});

test("context byte allowance counts failed requests and survives a consent toggle", async t => {
  let count = 0;
  const source = Array.from({length: 30}, () => "x".repeat(3000)).join("\n\n");
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    count++; return Response.json({code: "refused"}, {status: 422});
  }, source);
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  for (const position of [4, 8, 12, 16, 20, 24]) {
    app.read(`latest = {...latest,running:true,position:${position}}; display()`); await waitForContext(app);
  }
  assert.equal(count, 5);
  assert.equal(app.read("currentStory().nocturneContextSession.bytesAttempted"), NOCTURNE_CONTEXT_SESSION_BYTES);
  assert.match(app.nodes.get("nocturne-context-status").textContent, /allowance for this visit has been used/);
  await app.click("nocturne-context-disable");
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  assert.equal(app.nodes.get("nocturne-context-enable").disabled, true);
  await app.click("nocturne-context-enable"); await waitForContext(app);
  assert.equal(count, 5);
});

test("a late contextual response after Stop and model switch cannot repopulate the mapping", async t => {
  let release;
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const body = JSON.parse(init.body);
    await new Promise(resolve => { release = resolve; });
    return Response.json(response(body.targets));
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

test("starting a seek cancels an already-dispatched automatic review", async t => {
  let release, secondSignal, posts = 0;
  const app = await contextWorkspace(t, async (path, init = {}) => {
    if (init.method !== "POST") return Response.json({available: true});
    const {targets} = JSON.parse(init.body);
    if (++posts === 2) {
      secondSignal = init.signal;
      await new Promise(resolve => { release = resolve; });
    }
    return Response.json(response(targets));
  });
  app.nodes.get("nocturne-context-consent").checked = true;
  await app.nodes.get("nocturne-context-consent").dispatch("change");
  await app.click("nocturne-context-enable"); await waitForContext(app);
  await app.click("connect");
  await app.click("start");
  await app.click("confirm-start");
  await app.settle();
  assert.equal(app.read("latest.running"), true);
  app.read("controller.setPosition(64)");
  await waitForWorkspace(app, () => typeof release === "function", "Automatic context request did not start.");
  app.read("controller.setReadingSeeking(true)");
  assert.equal(secondSignal.aborted, true);
  app.read("controller.setReadingSeeking(false)");
  release();
  await waitForContext(app);
  assert.equal(posts, 2);
  assert.equal(app.read("currentStory().model.nocturneContext.has(64)"), false);
  assert.equal(app.read("currentStory().nocturneContextSession.requests"), 2);
  assert.deepEqual(app.errors, []);
});
