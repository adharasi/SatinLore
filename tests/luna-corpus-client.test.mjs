import assert from "node:assert/strict";
import {createHash, webcrypto} from "node:crypto";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {LUNA_CORPUS_CLIENT, LUNA_CORPUS_PAGE} from "../deploy/cloudflare/luna-corpus-client.mjs";

const base = "/api/scene-analysis/luna-corpus";
const runId = "a813a7c4-2139-4f11-8f04-57888c5ec914";
const sha256 = value => createHash("sha256").update(value).digest("hex");

function fixtureClip(id, storyId, firstId, excerpts) {
  let byteStart = 40;
  const units = excerpts.map((text, i) => {
    const byteEnd = byteStart + Buffer.byteLength(text);
    const unit = {id: firstId + i, paragraph: i, byteStart, byteEnd, digest: sha256(text), text};
    byteStart = byteEnd + 2;
    return unit;
  });
  return {id, storyId, sourceSha256: sha256(storyId + " source"), editionDigest: sha256(storyId + " edition"),
    units, targetIds: [units.at(-1).id]};
}

const first = fixtureClip("fbb866aa-c4fa-42a4-9dda-87df33b2d613", "library-one", 9,
  ["The café opened early.", "Sam switched on the lamps."]);
const second = fixtureClip("d391b578-b64a-4018-a5c0-20f34a786fcc", "library-two", 17,
  ["The garden gate opened.", "Rin carried a folded map."]);
const reviewPacket = {schema: 1, runId, clips: [first, second]};

function shardResult(clip) {
  const unit = clip.units.at(-1);
  return {
    schema: 1, runId, clipId: clip.id, clipDigest: sha256(JSON.stringify(clip)), storyId: clip.storyId,
    sourceSha256: clip.sourceSha256, editionDigest: clip.editionDigest, status: "completed",
    rubricVersion: "v21", model: "test-luna", units: [{id: unit.id, unitSha256: unit.digest, status: "neutral",
      boundaryVerificationStatus: "cut", boundaryVerification: {unitId: unit.id, sceneBoundary: {status: "cut", reason: "time-jump",
        previousId: clip.units[0].id, entryId: unit.id, changeId: unit.id, contrast: "material-change"}},
      localActionVerificationStatus: "verified", localActionVerification: {unitId: unit.id,
        localAction: {status: "verified", frame: "current", action: "anticipation", phase: "build", contrast: "charged-reaction",
          targetId: unit.id, contextId: clip.units[0].id}},
      sceneEntryVerificationStatus: "cut", sceneEntryVerification: {unitId: unit.id,
        sceneEntry: {status: "cut", reason: "material-time", previousId: clip.units[0].id, changeId: unit.id, entryId: unit.id}},
      independentBoundaryStatus: "corroborated", interruptionContinuationVerificationStatus: "verified",
      sceneSituationVerificationStatus: "changed", sceneSituationVerification: {unitId: unit.id,
        sceneSituation: {status: "changed", earlierId: clip.units[0].id, currentId: unit.id,
          earlierBasis: "established-place", currentBasis: "distinct-place"}},
      sceneOldPlaceVerificationStatus: "established", sceneOldPlaceVerification: {unitId: unit.id,
        scenePlace: {status: "established", earlierId: clip.units[0].id, currentId: null}},
      sceneArrivalVerificationStatus: "distinct", sceneArrivalVerification: {unitId: unit.id,
        scenePlace: {status: "distinct", earlierId: clip.units[0].id, currentId: unit.id}},
      scenePlaceRecoveryStatus: "changed",
      sustainConnectorVerificationStatus: "verified", sustainConnectorVerification: {unitId: unit.id,
        status: "neutral", frame: "current", narrativePhase: "quiet", action: "none", transition: "none",
        fact: "none", scopeId: null, priorAnchor: null, evidenceIds: [clip.units[0].id, unit.id]},
      interruptionContinuationVerification: {unitId: unit.id, status: "verified", frame: "current", action: "continuation",
        transition: "none", fact: "continue", scopeId: clip.units[0].id, priorAnchor: clip.units[0].id,
        evidenceIds: [clip.units[0].id, unit.id]},
      interruptionReleaseVerificationStatus: "verified", interruptionReleaseVerification: {unitId: unit.id,
        status: "verified", frame: "current", transition: "interruption", fact: "ease", scopeId: clip.units[0].id,
        priorAnchor: clip.units[0].id, evidenceIds: [clip.units[0].id, unit.id]},
      transitionVerification: {unitId: unit.id, transition: "none", status: "neutral", sceneBoundary: {
        status: "cut", reason: "time-jump", previousId: clip.units[0].id, entryId: unit.id,
      }}}],
    summary: {attempts: [{mode: "verify", targetIds: clip.targetIds, status: "returned", attempted: true}]},
    budget: {chargedMicros: 200}, externalCalls: 1,
    hostedSpend: {capMicros: 3_000_000, settled: true, remainingMicros: 2_999_800},
  };
}

function corpusPage({storage = new Map(), onShard = async body => Response.json(shardResult(body.clip))} = {}) {
  const calls = [], downloads = [], blobs = new Map();
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.events = new Map();
      this.style = {};
      this.disabled = false;
      this.checked = false;
      this.textContent = "";
    }
    addEventListener(event, handler) { this.events.set(event, handler); }
    async dispatch(event) { await this.events.get(event)?.({target: this}); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    async click() {
      if (this.tag === "a") downloads.push({name: this.download, blob: blobs.get(this.href)});
      else if (!this.disabled) await this.dispatch("click");
    }
  }
  const ids = new Map([...LUNA_CORPUS_PAGE.matchAll(/<([a-z]+)\b[^>]*\bid="([a-z]+)"/gu)]
    .map(([, tag, id]) => [id, new Element(tag)]));
  const document = {
    getElementById: id => ids.get(id),
    createElement: tag => new Element(tag),
    createDocumentFragment: () => new Element("fragment"),
  };
  const localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
  const url = {
    createObjectURL(blob) {
      const key = "blob:test-" + blobs.size;
      blobs.set(key, blob);
      return key;
    },
    revokeObjectURL: key => blobs.delete(key),
  };
  const fetch = async (path, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    calls.push({path, body});
    if (path === base + "/approve") {
      return Response.json({runId, clipCount: body.clips.length, expiresAt: Date.now() + 60_000});
    }
    assert.equal(path, base + "/shard");
    return onShard(body);
  };
  runInNewContext(LUNA_CORPUS_CLIENT, {document, localStorage, fetch, TextEncoder, crypto: webcrypto,
    URL: url, Blob, setTimeout: () => 0}, {filename: "luna-corpus-client.mjs"});
  return {
    calls, downloads, storage,
    get: id => ids.get(id),
    row: i => ids.get("review").children[0].children[i],
    async open(packet = reviewPacket) {
      const json = JSON.stringify(packet);
      ids.get("packet").files = [{size: Buffer.byteLength(json), text: async () => json}];
      await ids.get("packet").dispatch("change");
    },
    async select(i) {
      const checkbox = this.row(i).children[2].children[0];
      assert.equal(checkbox.disabled, false);
      checkbox.checked = true;
      await checkbox.dispatch("change");
    },
  };
}

test("selecting all reviewed excerpts is local and each excerpt can still be removed before sealing", async () => {
  const page = corpusPage();
  await page.open();
  await page.get("selectall").click();
  assert.equal(page.row(0).children[2].children[0].checked, true);
  const secondSelection = page.row(1).children[2].children[0];
  assert.equal(secondSelection.checked, true);
  assert.deepEqual(page.calls, []);
  secondSelection.checked = false;
  await secondSelection.dispatch("change");
  await page.get("seal").click();
  assert.deepEqual(page.calls, [{path: base + "/approve", body: {runId,
    clips: [{id: first.id, digest: sha256(JSON.stringify(first))}], reviewConfirmed: true}}]);
});

test("the corpus page previews exact context locally and seals only fingerprints before dispatching selected prose", async () => {
  const page = corpusPage();
  await page.open();
  assert.equal(page.get("seal").disabled, true);
  assert.equal(page.get("selectall").disabled, false);
  assert.equal(page.get("run").disabled, true);
  assert.equal(page.get("save").disabled, true);
  assert.equal(page.row(0).children[1].textContent, "Context 9\nThe café opened early.\n\nTarget 10\nSam switched on the lamps.");
  assert.equal(page.row(1).children[2].children[0].checked, false);
  assert.deepEqual(page.calls, []);
  assert.equal(page.storage.size, 0);

  await page.select(0);
  assert.deepEqual(page.calls, []);
  await page.get("seal").click();
  assert.deepEqual(page.calls, [{path: base + "/approve", body: {runId,
    clips: [{id: first.id, digest: sha256(JSON.stringify(first))}], reviewConfirmed: true}}]);
  assert.equal(page.get("seal").disabled, true);
  assert.equal(page.get("run").disabled, false);
  assert.equal(page.row(1).children[2].children[0].disabled, true);
  assert.equal(page.get("selectall").disabled, true);

  await page.get("run").click();
  assert.deepEqual(page.calls[1], {path: base + "/shard", body: {runId, clip: first}});
  assert.equal(page.calls.length, 2);
  assert.equal(page.get("run").disabled, true);
  assert.equal(page.get("save").disabled, false);
  await page.get("save").click();
  assert.equal(page.downloads[0].name, "satinlore-luna-corpus-results.json");
  const download = await page.downloads[0].blob.text();
  const exported = JSON.parse(download);
  assert.equal(exported.sourceProseIncluded, false);
  assert.equal(exported.runId, runId);
  assert.deepEqual(exported.works.map(work => [work.id, work.units.map(unit => unit.id)]),
    [[first.storyId, first.targetIds], [second.storyId, []]]);
  assert.deepEqual(exported.clips.map(clip => [clip.id, clip.status]), [[first.id, "completed"], [second.id, "withheld"]]);
  assert.deepEqual(exported.replayClips[0].units[0].transitionVerification.sceneBoundary,
    {status: "cut", reason: "time-jump", previousId: 9, entryId: 10});
  assert.deepEqual(exported.replayClips[0].units[0].boundaryVerification,
    {unitId: 10, sceneBoundary: {status: "cut", reason: "time-jump", previousId: 9, entryId: 10, changeId: 10, contrast: "material-change"}});
  assert.equal(exported.replayClips[0].units[0].localActionVerificationStatus, "verified");
  assert.deepEqual(exported.replayClips[0].units[0].localActionVerification,
    {unitId: 10, localAction: {status: "verified", frame: "current", action: "anticipation", phase: "build", contrast: "charged-reaction",
      targetId: 10, contextId: 9}});
  assert.equal(exported.replayClips[0].units[0].sceneEntryVerificationStatus, "cut");
  assert.deepEqual(exported.replayClips[0].units[0].sceneEntryVerification,
    {unitId: 10, sceneEntry: {status: "cut", reason: "material-time", previousId: 9, changeId: 10, entryId: 10}});
  assert.equal(exported.replayClips[0].units[0].independentBoundaryStatus, "corroborated");
  assert.equal(exported.replayClips[0].units[0].sceneSituationVerificationStatus, "changed");
  assert.deepEqual(exported.replayClips[0].units[0].sceneSituationVerification,
    {unitId: 10, sceneSituation: {status: "changed", earlierId: 9, currentId: 10,
      earlierBasis: "established-place", currentBasis: "distinct-place"}});
  const placeReplay = exported.replayClips[0].units[0];
  assert.equal(placeReplay.scenePlaceRecoveryStatus, "changed");
  assert.equal(placeReplay.sceneOldPlaceVerificationStatus, "established");
  assert.equal(placeReplay.sceneArrivalVerificationStatus, "distinct");
  assert.deepEqual(placeReplay.sceneOldPlaceVerification,
    {unitId: 10, scenePlace: {status: "established", earlierId: 9, currentId: null}});
  assert.deepEqual(placeReplay.sceneArrivalVerification,
    {unitId: 10, scenePlace: {status: "distinct", earlierId: 9, currentId: 10}});
  assert.equal(exported.replayClips[0].units[0].sustainConnectorVerificationStatus, "verified");
  assert.deepEqual(exported.replayClips[0].units[0].sustainConnectorVerification,
    {unitId: 10, status: "neutral", frame: "current", narrativePhase: "quiet", action: "none", transition: "none",
      fact: "none", scopeId: null, priorAnchor: null, evidenceIds: [9, 10]});
  assert.equal(exported.replayClips[0].units[0].interruptionContinuationVerificationStatus, "verified");
  assert.deepEqual(exported.replayClips[0].units[0].interruptionContinuationVerification,
    {unitId: 10, status: "verified", frame: "current", action: "continuation", transition: "none", fact: "continue",
      scopeId: 9, priorAnchor: 9, evidenceIds: [9, 10]});
  assert.equal(exported.replayClips[0].units[0].interruptionReleaseVerificationStatus, "verified");
  assert.deepEqual(exported.replayClips[0].units[0].interruptionReleaseVerification,
    {unitId: 10, status: "verified", frame: "current", transition: "interruption", fact: "ease", scopeId: 9,
      priorAnchor: 9, evidenceIds: [9, 10]});
  for (const clip of reviewPacket.clips) for (const unit of clip.units) {
    assert.ok(!download.includes(unit.text));
    for (const retained of page.storage.values()) assert.ok(!retained.includes(unit.text));
  }
});

test("a transport error checkpoints the uncertain clip and reopening the exact packet resumes only the next clip", async () => {
  const initial = corpusPage({onShard: async () => { throw new TypeError("connection lost"); }});
  await initial.open();
  await initial.select(0);
  await initial.select(1);
  await initial.get("seal").click();
  await initial.get("run").click();
  assert.equal(initial.calls.length, 2);
  assert.deepEqual(initial.calls[1], {path: base + "/shard", body: {runId, clip: first}});
  assert.match(initial.row(0).children[0].textContent, /unconfirmed/u);
  assert.equal(initial.get("run").disabled, false);

  const resumed = corpusPage({storage: initial.storage});
  await resumed.open();
  assert.deepEqual(resumed.calls, []);
  assert.match(resumed.get("status").textContent, /Matching checkpoint loaded/u);
  assert.equal(resumed.get("seal").disabled, true);
  await resumed.get("run").click();
  assert.deepEqual(resumed.calls, [{path: base + "/shard", body: {runId, clip: second}}]);
  await resumed.get("save").click();
  const exported = JSON.parse(await resumed.downloads[0].blob.text());
  assert.deepEqual(exported.clips.map(clip => [clip.id, clip.status]), [[first.id, "unconfirmed"], [second.id, "completed"]]);
});

test("a saved checkpoint exports source-free supporting labels and rejection diagnostics with their own clip", async () => {
  const context = first.units[0];
  const unexpectedText = "Raw material is outside the replay schema.";
  const fact = {id: context.id, status: "verified", action: "anticipation", evidenceIds: [context.id]};
  const trace = {beat: "library-one:beat:9", scene: "library-one:scene:9", decision: "Start onset", knownAt: context.id,
    evidence: [context.id], holdWords: 32, fadeWords: 48, floorWords: 0, wordOffset: 0};
  const support = {mode: "verify", supportingPrefix: true, attempted: true, targetIds: [context.id], status: "returned"};
  const targetId = first.targetIds[0];
  const continuation = {id: targetId, status: "verified", action: "continuation", evidenceIds: [context.id, targetId],
    priorAnchor: context.id};
  const rejectedAction = {mode: "local-action", attempted: true, targetIds: [targetId], status: "invalid-response",
    rejectedFacts: [{id: targetId, reason: "local-action-evidence", detail: {status: "verified", action: "continuation",
      targetEvidence: "exact-target", contextEvidence: "missing"}}]};
  const initial = corpusPage({onShard: async ({clip}) => {
    const response = shardResult(clip);
    Object.assign(response.units[0], {uncertainContinuationVerification: continuation,
      uncertainContinuationVerificationStatus: "verified", localActionApplication: "sustain-uncertainty-profile"});
    response.units.unshift({id: context.id, unitSha256: context.digest, text: unexpectedText,
      playbackDisposition: "supporting-rooted-onset", cueRecoveryReason: "discovery-gap-support",
      cueRecoveryCorrection: "discovery-gap-support", trace: {...trace, reason: unexpectedText},
      primaryPrefix: {...fact, note: unexpectedText}});
    response.summary.attempts.unshift(support, rejectedAction);
    return Response.json(response);
  }});
  await initial.open();
  await initial.select(0);
  await initial.get("seal").click();
  await initial.get("run").click();

  const resumed = corpusPage({storage: initial.storage});
  await resumed.open();
  await resumed.get("save").click();
  const download = await resumed.downloads[0].blob.text();
  const {works, replayClips} = JSON.parse(download);
  assert.deepEqual(resumed.calls, []);
  assert.deepEqual(works[0].units.map(row => row.id), first.targetIds);
  assert.equal(replayClips.length, 1);
  assert.equal(replayClips[0].id, first.id);
  assert.deepEqual(replayClips[0].attempts[0], support);
  assert.deepEqual(replayClips[0].attempts[1], rejectedAction);
  assert.deepEqual(works[0].summary.attempts[1], rejectedAction);
  assert.deepEqual(replayClips[0].units[0], {id: context.id, unitSha256: context.digest, primaryPrefix: fact,
    playbackDisposition: "supporting-rooted-onset", cueRecoveryReason: "discovery-gap-support",
    cueRecoveryCorrection: "discovery-gap-support", trace});
  assert.deepEqual(replayClips[0].units[1].uncertainContinuationVerification, continuation);
  assert.equal(replayClips[0].units[1].uncertainContinuationVerificationStatus, "verified");
  assert.equal(replayClips[0].units[1].localActionApplication, "sustain-uncertainty-profile");
  assert.ok(!download.includes(unexpectedText));
});

test("a changed approved excerpt cannot resume a sealed corpus checkpoint", async () => {
  const initial = corpusPage();
  await initial.open();
  await initial.select(0);
  await initial.get("seal").click();
  const altered = structuredClone(reviewPacket);
  altered.clips[0].units[1].text = "Sam switched off the lamps.";
  altered.clips[0].units[1].digest = sha256(altered.clips[0].units[1].text);
  altered.clips[0].units[1].byteEnd = altered.clips[0].units[1].byteStart + Buffer.byteLength(altered.clips[0].units[1].text);

  const resumed = corpusPage({storage: initial.storage});
  await resumed.open(altered);
  assert.deepEqual(resumed.calls, []);
  assert.match(resumed.get("status").textContent, /checkpoint does not match these exact excerpts/u);
  assert.equal(resumed.get("run").disabled, true);
  assert.equal(resumed.get("save").disabled, true);
});
