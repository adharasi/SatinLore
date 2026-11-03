import test from "node:test";
import assert from "node:assert/strict";
import {AlphaTimeline} from "../app/static/alpha-timeline.mjs";

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
