import test from "node:test";
import assert from "node:assert/strict";
import {createBetaRecorder, mountBetaRecording, normalizeBetaEvent, BETA_CONSENT_VERSION} from "../app/static/reader/beta-recording.mjs";
import {setupDOM} from "./helpers/setup-dom.mjs";
import {normalizeBetaEvent as serverEvent, BETA_RECORDING_LIMITS} from "../deploy/cloudflare/beta-recordings.mjs";

const SID = "14b811a0-d012-4f80-bf1c-fda150c72ba9";
const REQUEST = "297ba762-df42-4e6c-9966-01f2a6f0087f";
const admission = {ok: true, sid: SID, seq: 0, maxDurationMs: 3600000, maxEvents: 20000,
  maxBatchEvents: 100, expiresAt: 3600001, retainedUntil: 2592000001};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status});
function harness({hostname = "beta.satinlore.com", send, start = admission, uuid = () => REQUEST} = {}) {
  let at = 100000, id = 0;
  const timers = new Map(), requests = [], dom = setupDOM(), states = [];
  const recorder = createBetaRecorder({hostname, ...dom, now: () => at, uuid,
    setTimer(fn, ms) { timers.set(++id, {fn, ms}); return id; }, clearTimer(key) { timers.delete(key); },
    onState: value => states.push(value), fetchImpl: async (url, options) => {
      const body = options.body === undefined ? undefined : JSON.parse(options.body); requests.push({url, options, body});
      return send ? send(body, requests.length, url) : json(body?.action === "start" ? start : {ok: true});
    }});
  return {recorder, requests, dom, states, timers, advance(ms) { at += ms; }};
}

test("normal reader host and an unchosen beta session make no requests", async () => {
  const normal = harness({hostname: "app.satinlore.com"});
  assert.equal(normal.recorder.snapshot().enabled, false);
  assert.equal(await normal.recorder.start(), false);
  assert.equal(normal.recorder.record({type: "step", step: "account"}), false);
  assert.equal(normal.requests.length, 0);
  const beta = harness();
  assert.equal(beta.recorder.snapshot().status, "choice");
  assert.equal(beta.recorder.record({type: "step", step: "choose"}), false);
  assert.equal(beta.recorder.decline(), true);
  assert.equal(beta.requests.length, 0);
  assert.equal(beta.recorder.snapshot().status, "declined");
  normal.recorder.destroy(); beta.recorder.destroy();
});

test("explicit consent admission uses only fixed metadata and the session credentials", async () => {
  const h = harness();
  assert.equal(await h.recorder.start({mode: "simulator", toy: "flexer"}), true);
  assert.deepEqual(h.requests[0].body, {action: "start", consentVersion: BETA_CONSENT_VERSION,
    idempotencyKey: REQUEST, mode: "simulator", toy: "flexer", viewport: {w: 1360, h: 940}});
  assert.equal(h.requests[0].url, "/api/beta/recordings");
  assert.equal(h.requests[0].options.credentials, "same-origin");
  assert.equal(h.recorder.snapshot().recording, true);
  assert.equal(h.recorder.snapshot().canWithdraw, true);
  assert.equal("sid" in h.recorder.snapshot(), false);
  h.recorder.destroy();
});

test("safe event dialect rejects private context and every extra field", () => {
  const examples = [
    {type: "step", step: "calibration"},
    {type: "device", toy: "flexer", mode: "live", channels: ["vibrate", "fingering"]},
    {type: "control", control: "minimum", channel: "vibrate", value: 2},
    {type: "output", channels: {vibrate: 3, fingering: 2}, state: "testing"},
    {type: "rating", question: "comfort", value: 4},
    {type: "rating", question: "intensity", value: 3, channel: "fingering", field: "preferred"},
    {type: "reading-feedback", issue: "wrong-moment", position: 2},
    {type: "preset", event: "save", scope: "story"},
    {type: "step", step: "presets"},
    {type: "story", fixture: "personal", position: 2},
    {type: "lifecycle", event: "hidden"},
    {type: "view", panel: "sidebar", width: 390},
    {type: "pointer", kind: "scroll", y: 5000},
  ];
  for (const value of examples) {
    assert.deepEqual(normalizeBetaEvent(value, 13), {t: 13, ...value});
    for (const key of ["title", "text", "storyText", "deviceId", "authToken", "email", "url", "selector", "target"]) {
      assert.equal(normalizeBetaEvent({...value, [key]: "PRIVATE_CANARY"}, 13), null, key);
    }
  }
  assert.equal(normalizeBetaEvent({type: "output", channels: {deviceId: 4}, state: "playing"}, 0), null);
  assert.equal(normalizeBetaEvent({type: "control", control: "mode", value: "PRIVATE_CANARY"}, 0), null);
  assert.equal(normalizeBetaEvent({type: "device", toy: "flexer", mode: "live", channels: ["vibrate", "vibrate"]}, 0), null);
  assert.equal(normalizeBetaEvent({type: "rating", question: "comfort", value: 0}, 0), null);
  assert.equal(normalizeBetaEvent({type: "rating", question: "intensity", value: 3, channel: "PRIVATE_CANARY"}, 0), null);
  assert.equal(normalizeBetaEvent({type: "rating", question: "intensity", value: 3, field: "storyTitle"}, 0), null);
  assert.equal(normalizeBetaEvent({type: "preset", event: "save", scope: "story", name: "PRIVATE_CANARY"}, 0), null);
  assert.equal(normalizeBetaEvent({type: "preset", event: "save", scope: "story", id: SID}, 0), null);
  assert.equal(normalizeBetaEvent({type: "preset", event: "publish", scope: "story"}, 0), null);
  assert.equal(normalizeBetaEvent({type: "control", control: "maximum", value: 21}, 0), null);
  assert.equal(normalizeBetaEvent({type: "reading-feedback", issue: "PRIVATE_CANARY", position: 0}, 0), null);
  assert.equal(normalizeBetaEvent({type: "step", step: "choose"}, 3600001), null);
});

test("client and server share the extended event contract and one-hour budget", () => {
  assert.equal(BETA_RECORDING_LIMITS.durationMs, 3600000);
  assert.equal(BETA_RECORDING_LIMITS.events, 20000);
  assert.equal(BETA_RECORDING_LIMITS.sessionBytes, 4 * 1024 * 1024);
  for (const input of [
    {type: "step", step: "presets"},
    {type: "rating", question: "intensity", value: 3, channel: "fingering", field: "preferred"},
    {type: "reading-feedback", issue: "wrong-movement", position: 1999},
    {type: "preset", event: "apply", scope: "story"},
    {type: "output", channels: {fingering: 2.5}, state: "testing"},
  ]) {
    const client = normalizeBetaEvent(input, 2100000);
    assert.deepEqual(serverEvent(client), client);
    assert.throws(() => serverEvent({...client, privateText: "CANARY"}));
  }
});

test("append retries the exact sequence and does not duplicate acknowledged events", async () => {
  let failures = 2;
  const h = harness({send: body => {
    if (body.action === "start") return json(admission);
    if (body.action === "append" && failures-- > 0) throw Error("offline");
    return json({ok: true});
  }});
  await h.recorder.start();
  h.recorder.record({type: "step", step: "features"});
  assert.equal(await h.recorder.flush(), true);
  const batches = h.requests.filter(x => x.body.action === "append");
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0].body, batches[1].body); assert.deepEqual(batches[1].body, batches[2].body);
  assert.equal(h.recorder.snapshot().sent, 1);
  h.advance(1000); h.recorder.record({type: "control", control: "test", channel: "fingering", value: 2});
  assert.equal(await h.recorder.flush(), true);
  assert.equal(h.requests.at(-1).body.seq, 2);
  assert.equal(h.recorder.snapshot().sent, 2);
  h.recorder.destroy();
});

test("pause records a gap and controls remain uncaptured until an explicit resume", async () => {
  const h = harness(); await h.recorder.start();
  h.recorder.record({type: "control", control: "maximum", value: 4});
  assert.equal(h.recorder.pause(), true);
  assert.equal(h.recorder.record({type: "control", control: "maximum", value: 2}), false);
  await h.recorder.flush(); h.advance(2500);
  assert.equal(h.recorder.resume(), true);
  h.recorder.record({type: "output", channels: {vibrate: 1}, state: "playing"});
  assert.equal(h.recorder.record({type: "output", channels: {vibrate: 1}, state: "playing"}), false);
  await h.recorder.flush();
  const events = h.requests.filter(x => x.body.action === "append").flatMap(x => x.body.events);
  assert.deepEqual(events.map(x => x.type === "lifecycle" ? x.event : x.type), ["control", "paused", "resumed", "output"]);
  assert.equal(events.at(-1).t, 2500);
  h.recorder.destroy();
});

test("server rejection stops collection without claiming a successful save", async () => {
  const h = harness({send: body => json(body.action === "start" ? admission : {error: "no"}, body.action === "append" ? 429 : 200)});
  await h.recorder.start(); h.recorder.record({type: "step", step: "practice"});
  assert.equal(await h.recorder.flush(), false);
  assert.equal(h.recorder.snapshot().status, "error");
  assert.equal(h.recorder.snapshot().recording, false);
  assert.equal(h.recorder.record({type: "step", step: "story"}), false);
  assert.match(h.recorder.snapshot().message, /saving failed/);
  assert.equal(h.requests.filter(x => x.body.action === "append").length, 1);
  h.recorder.destroy();
});

test("withdrawal wins over an in-flight append and no new batch can follow", async () => {
  let release;
  const h = harness({send: body => body.action === "start" ? json(admission) : body.action === "append" ?
    new Promise(resolve => { release = () => resolve(json({ok: true})); }) : json({ok: true})});
  await h.recorder.start(); h.recorder.record({type: "step", step: "features"});
  const pending = h.recorder.flush();
  assert.equal(await h.recorder.withdraw(), true);
  release(); assert.equal(await pending, false);
  assert.equal(h.recorder.snapshot().status, "withdrawn");
  assert.equal(h.recorder.record({type: "step", step: "story"}), false);
  assert.equal(h.recorder.snapshot().sent, 0);
  assert.equal(h.recorder.snapshot().canWithdraw, false);
  h.recorder.destroy();
});

test("a failed withdrawal stays stopped and can be retried without false deletion success", async () => {
  let offline = true;
  const h = harness({send: body => {
    if (body.action === "start") return json(admission);
    if (body.action === "withdraw" && offline) throw Error("offline");
    return json({ok: true});
  }});
  await h.recorder.start();
  assert.equal(await h.recorder.withdraw(), false);
  assert.equal(h.recorder.snapshot().status, "error");
  assert.equal(h.recorder.snapshot().canRetryDelete, true);
  assert.equal(h.recorder.snapshot().recording, false);
  assert.match(h.recorder.snapshot().message, /not confirmed/);
  offline = false; assert.equal(await h.recorder.withdraw(), true);
  assert.equal(h.recorder.snapshot().status, "withdrawn");
  h.recorder.destroy();
});

test("late Stop acknowledgement cannot overwrite successful withdrawal", async () => {
  let release;
  const h = harness({send: body => body.action === "start" ? json(admission) : body.action === "stop" ?
    new Promise(resolve => { release = () => resolve(json({ok: true})); }) : json({ok: true})});
  await h.recorder.start(); const pending = h.recorder.stop();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(await h.recorder.withdraw(), true);
  release(); assert.equal(await pending, false);
  assert.equal(h.recorder.snapshot().status, "withdrawn");
  h.recorder.destroy();
});

test("bounded collection pauses at the event limit and cannot resume it", async () => {
  const h = harness({start: {...admission, maxEvents: 3}}); await h.recorder.start();
  for (let i = 0; i < 3; i++) assert.equal(h.recorder.record({type: "step", step: "choose"}), true);
  assert.equal(h.recorder.record({type: "step", step: "features"}), false);
  assert.equal(h.recorder.snapshot().status, "paused");
  assert.equal(h.recorder.resume(), false);
  await h.recorder.flush();
  assert.equal(h.recorder.snapshot().sent, 3);
  h.recorder.destroy();
});

test("research controls require a checked choice and stay independent from toy actions", async () => {
  const h = harness(), mount = h.dom.make("div");
  const view = mountBetaRecording({mount, recorder: h.recorder, document: h.dom.document,
    context: () => ({mode: "simulator", toy: "flexer"})});
  const {nodes} = h.dom;
  assert.equal(nodes.get("beta-recording-start").disabled, true);
  await nodes.get("beta-recording-start").click(); assert.equal(h.requests.length, 0);
  nodes.get("beta-recording-agree").checked = true; await nodes.get("beta-recording-agree").dispatch("change");
  await nodes.get("beta-recording-start").click();
  assert.equal(h.recorder.snapshot().recording, true);
  assert.equal(nodes.get("beta-recording-pause").hidden, false);
  await nodes.get("beta-recording-pause").click(); assert.equal(h.recorder.snapshot().status, "paused");
  assert.equal(nodes.get("beta-recording-pause").textContent, "Resume recording");
  await nodes.get("beta-recording-stop").click();
  await h.recorder.stop();
  assert.equal(h.recorder.snapshot().status, "stopped");
  view.destroy(); h.recorder.destroy();
  const normal = harness({hostname: "app.satinlore.com"}), other = normal.dom.make("div");
  mountBetaRecording({mount: other, recorder: normal.recorder, document: normal.dom.document});
  assert.equal(other.children.length, 0); normal.recorder.destroy();
});

test("declined and withdrawn consent collapse until Change recording choice is selected", async () => {
  const h = harness(), mount = h.dom.make("div");
  const view = mountBetaRecording({mount, recorder: h.recorder, document: h.dom.document});
  const {nodes} = h.dom;
  await nodes.get("beta-recording-decline").click();
  const panel = mount.children[0].children.find(node => node.className === "beta-recording-choice");
  assert.equal(panel.hidden, true);
  assert.equal(nodes.get("beta-recording-start").hidden, true);
  assert.equal(nodes.get("beta-recording-change").hidden, false);
  await nodes.get("beta-recording-change").click();
  assert.equal(panel.hidden, false); assert.equal(nodes.get("beta-recording-start").hidden, false);
  nodes.get("beta-recording-agree").checked = true; await nodes.get("beta-recording-agree").dispatch("change");
  await nodes.get("beta-recording-start").click();
  assert.equal(panel.hidden, true);
  await h.recorder.withdraw();
  assert.equal(panel.hidden, true);
  await nodes.get("beta-recording-change").click(); assert.equal(panel.hidden, false);
  view.destroy(); h.recorder.destroy();
});

test("new recording preserves the earlier session and its explicit deletion control", async () => {
  const SID2 = "c118a51d-6bcc-46d6-9007-339bd33fb255";
  let next = 0;
  const h = harness({uuid: () => next++ ? SID2 : REQUEST, send: body =>
    json(body?.action === "start" ? {...admission, sid: next > 1 ? SID2 : SID} : {ok: true})});
  await h.recorder.start(); h.recorder.record({type: "step", step: "choose"}); await h.recorder.stop();
  assert.equal(h.recorder.snapshot().status, "stopped");
  assert.equal(h.recorder.prepareNew(), true);
  assert.equal(h.recorder.snapshot().consented, false);
  assert.equal(h.recorder.snapshot().history.length, 1);
  assert.equal("sid" in h.recorder.snapshot().history[0], false);
  assert.equal(h.requests.filter(x => x.body?.action === "withdraw").length, 0);
  await h.recorder.start({mode: "live", toy: "flexer"});
  assert.equal(h.recorder.snapshot().recording, true);
  assert.equal(await h.recorder.deletePrevious(0), true);
  assert.deepEqual(h.requests.at(-1).body, {action: "withdraw", sid: SID});
  assert.equal(h.recorder.snapshot().recording, true);
  assert.equal(h.recorder.snapshot().history.length, 0);
  h.recorder.destroy();
});

test("own recording history restores deletion access after reload without DOM identifiers", async () => {
  const h = harness({send: body => body === undefined ? json({ok: true, sessions: [{sid: SID, startedAt: 100000,
    retainedUntil: 2592000001, state: "stopped", eventCount: 23, participant: "PRIVATE_EXTRA_IGNORED"}]}) : json({ok: true})});
  assert.equal(await h.recorder.loadHistory(), true);
  assert.equal(h.requests[0].options.method, "GET"); assert.equal(h.requests[0].url, "/api/beta/recordings?limit=100");
  assert.equal(h.recorder.snapshot().history.length, 1);
  assert.ok(!JSON.stringify(h.recorder.snapshot()).includes(SID));
  assert.ok(!JSON.stringify(h.recorder.snapshot()).includes("PRIVATE_EXTRA_IGNORED"));
  assert.equal(await h.recorder.deletePrevious(0), true);
  assert.equal(h.recorder.snapshot().history.length, 0);
  h.recorder.destroy();
});
