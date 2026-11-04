import test from "node:test";
import assert from "node:assert/strict";
import {nocturneAvailable, nocturneCandidates, requestNocturne, validateNocturneLabels} from "../app/static/reader/nocturne.mjs";

const privateText = "PRIVATE_STORY_FIXTURE";
const paragraph = (properties = {}) => ({
  analysed: true, cloudExcluded: false, quiet: false, override: null, sceneId: 1,
  phase: "sustain", rhythm: "gentle", shape: "unspecified", suggestedLevel: 2,
  movements: ["vibrate"], text: privateText, reason: privateText, ...properties,
});

test("Nocturne candidates exclude protected, manual, zero and non-playable sections and send only scene enums", () => {
  const {cues, excluded, limited} = nocturneCandidates([
    paragraph({phase: "build"}),
    paragraph(),
    paragraph({cloudExcluded: true, phase: "peak"}),
    paragraph({phase: "peak", rhythm: "dynamic", shape: "alternating", movements: ["vibrate", "fingering"]}),
    paragraph({phase: "recover"}),
    paragraph({override: 0}),
    paragraph({override: 7}),
    paragraph({quiet: true}),
    paragraph({suggestedLevel: 0}),
    paragraph({analysed: false}),
  ]);
  assert.deepEqual({cues, excluded, limited}, {cues: [
    {id: 3, phase: "peak", rhythm: "dynamic", previous: "quiet", next: "recover", movementCount: 2, shape: "alternating"},
    {id: 1, phase: "sustain", rhythm: "gentle", previous: "build", next: "quiet", movementCount: 1, shape: "unspecified"},
  ], excluded: 1, limited: 0});
  assert.ok(!JSON.stringify(cues).includes(privateText));
});

test("Nocturne bounds a run and selects the actionable cues first", () => {
  const paragraphs = Array.from({length: 20}, () => paragraph());
  paragraphs[17].shape = "accented";
  paragraphs[19].phase = "peak";
  const {cues, excluded, limited} = nocturneCandidates(paragraphs);
  assert.deepEqual(cues.map(cue => cue.id), [19, 17, ...Array.from({length: 14}, (_, index) => index)]);
  assert.equal(excluded, 0);
  assert.equal(limited, 4);
});

test("Nocturne accepts only a complete one-to-one response with labels for the original phase", () => {
  const {cues} = nocturneCandidates([paragraph({phase: "peak"}), paragraph()]);
  const correct = {labels: [{id: 1, label: "abstain"}, {id: 0, label: "crest"}]};
  assert.deepEqual(validateNocturneLabels(cues, correct), new Map([[0, "crest"]]));
  for (const response of [
    {labels: [{id: 0, label: "crest"}]},
    {labels: [{id: 0, label: "crest"}, {id: 0, label: "accents"}]},
    {labels: [{id: 0, label: "crest"}, {id: 1, label: "taper"}]},
    {labels: [{id: 0, label: "crest"}, {id: 2, label: "steady"}]},
    {labels: [{id: 0, label: "crest", level: 20}, {id: 1, label: "wave"}]},
    {...correct, deviceId: "synthetic-device"},
  ]) assert.throws(() => validateNocturneLabels(cues, response), /Unexpected Nocturne labels/);
});

test("Nocturne status fails closed when unavailable or the request fails", async () => {
  const request = async (path, init) => {
    assert.equal(path, "/api/scene-analysis");
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    return Response.json({available: true});
  };
  assert.equal(await nocturneAvailable(request), true);
  assert.equal(await nocturneAvailable(async () => Response.json({available: false})), false);
  assert.equal(await nocturneAvailable(async () => Response.json({available: true}, {status: 401})), false);
  assert.equal(await nocturneAvailable(async () => { throw new Error("unavailable"); }), false);
});

test("Nocturne requests use the caller signal and represent provider refusal without labels", async () => {
  const {cues} = nocturneCandidates([paragraph()]);
  const refused = await requestNocturne(cues, {request: async (path, init) => {
    assert.equal(path, "/api/scene-analysis");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {cues});
    return Response.json({code: "refused", error: privateText}, {status: 422});
  }});
  assert.deepEqual(refused, {labels: null, code: "refused"});
  const controller = new AbortController();
  await assert.rejects(requestNocturne(cues, {signal: controller.signal, request: async (path, init) => {
    controller.abort();
    init.signal.throwIfAborted();
  }}), {name: "AbortError"});
});
