import test from "node:test";
import assert from "node:assert/strict";
import {AlphaTimeline} from "../app/static/alpha-timeline.mjs";
import {ALPHA_SCREEN_LABELS} from "../app/static/alpha-screen-schema.mjs";

test("Alpha capture retries the exact unconfirmed batch before later events", async () => {
  let now = 10;
  const calls = [];
  const timeline = new AlphaTimeline({
    session: {id: "neutral-session", seq: 0, expiresAt: Date.now() + 60_000},
    now: () => now,
    async append(id, batch) {
      calls.push(structuredClone(batch));
      if (calls.length === 1) throw new Error("Response lost after writing");
      return {id, seq: batch.seq, eventCount: batch.seq};
    },
  });
  const event = {type: "mark", mark: "good"};
  timeline.record(event);
  event.mark = "change";
  assert.equal(await timeline.flush(), false);
  assert.equal(timeline.status().pending, 1);
  now = 20;
  timeline.record({type: "mark", mark: "finished"});
  assert.equal(await timeline.flush(), true);
  assert.deepEqual(calls, [
    {seq: 1, events: [{type: "mark", mark: "good", t: 0}]},
    {seq: 1, events: [{type: "mark", mark: "good", t: 0}]},
    {seq: 2, events: [{type: "mark", mark: "finished", t: 10}]},
  ]);
  assert.equal(timeline.status().pending, 0);
});

test("Alpha pause suppresses events and withdrawal invalidates an outstanding flush", async () => {
  let complete;
  let signal;
  const timeline = new AlphaTimeline({
    session: {id: "neutral-session", seq: 0, expiresAt: Date.now() + 60_000},
    append(id, batch, pendingSignal) {
      signal = pendingSignal;
      return new Promise(resolve => { complete = () => resolve({id, seq: batch.seq, eventCount: 2}); });
    },
  });
  timeline.pause();
  assert.equal(timeline.record({type: "mark", mark: "good"}), false);
  timeline.resume();
  const request = timeline.flush();
  timeline.destroy();
  assert.equal(signal.aborted, true);
  complete();
  assert.equal(await request, false);
  assert.equal(timeline.status().pending, 0);
  assert.equal(timeline.status().savedCount, 0);
});

test("Alpha screen views are batched within the keepalive body limit and remain in order", async () => {
  let now = 0, saved = 0;
  const batches = [];
  const timeline = new AlphaTimeline({
    session: {id: "neutral-session", seq: 0, expiresAt: Date.now() + 60_000},
    now: () => now,
    async append(id, batch) {
      assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= 60 * 1024);
      assert.equal(batch.seq, batches.length + 1);
      batches.push(batch);
      saved += batch.events.length;
      return {id, seq: batch.seq, eventCount: saved};
    },
  });
  const frame = {
    type: "screen", screen: "controls", viewport: {w: 1400, h: 900},
    items: Object.keys(ALPHA_SCREEN_LABELS).slice(0, 50).map(id => ({id, x: 100, y: 100, w: 100, h: 100, state: "disabled"})),
  };
  for (; now < 100; now++) assert.ok(timeline.record(frame));
  assert.equal(await timeline.flush(), true);
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flatMap(batch => batch.events.map(event => event.t)), Array.from({length: 100}, (_, index) => index));
  assert.equal(timeline.status().savedCount, 100);
});

test("Alpha storage limit stops retrying and preserves the last saved timestamp", async () => {
  let now = 0, calls = 0;
  const timeline = new AlphaTimeline({
    session: {id: "neutral-session", seq: 0, expiresAt: Date.now() + 60_000},
    now: () => now,
    async append(id, batch) {
      if (++calls > 1) throw Object.assign(new Error("Study storage is full"), {status: 507});
      return {id, seq: batch.seq, eventCount: 1};
    },
  });
  now = 300;
  assert.equal(timeline.record({type: "mark", mark: "good"}), true);
  assert.equal(await timeline.flush(), true);
  now = 1000;
  timeline.record({type: "mark", mark: "change"});
  timeline.record({type: "step", step: "feedback"});
  assert.equal(await timeline.flush(), false);
  assert.equal(timeline.status().state, "limited");
  assert.equal(timeline.status().limitReached, true);
  assert.equal(timeline.status().lastSavedTime, 300);
  assert.equal(timeline.status().savedCount, 1);
  assert.equal(timeline.status().pending, 0);
  timeline.resume();
  timeline.close();
  assert.equal(timeline.record({type: "mark", mark: "finished"}), false);
  assert.equal(await timeline.flush(), false);
  assert.equal(timeline.status().limitReached, true);
  assert.equal(calls, 2);
});
