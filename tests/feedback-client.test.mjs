import test from "node:test";
import assert from "node:assert/strict";
import { FeedbackClient, feedbackDraft } from "../app/static/feedback.mjs";

const KEY = "efb17774-04ac-4c23-b8d1-ef2c0ff3fd42";
const ID = "d0f4e404-4adb-42f3-a27f-a3b985b5d196";
const draft = { category: "reading", message: "A neutral feedback fixture.", rating: null };
const saved = () => ({ ok: true, id: ID, duplicate: false, createdAt: 1000, expiresAt: 2000 });

test("a feedback retry retains its independent idempotency key and sends only deliberate form fields", async () => {
  const calls = []; let attempts = 0;
  const client = new FeedbackClient({ makeKey: () => KEY, authorize: async () => true, fetcher: async (path, options) => {
    calls.push({ path, options });
    if (++attempts === 1) throw Error("A synthetic network failure with private details");
    return Response.json({ ...saved(), duplicate: true });
  } });
  await assert.rejects(client.submit(draft), /could not confirm/);
  assert.equal(client.pending.key, KEY);
  const result = await client.submit(draft);
  assert.equal(result.duplicate, true); assert.equal(client.pending, null);
  assert.deepEqual(JSON.parse(calls[0].options.body), { ...draft, idempotencyKey: KEY });
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.equal(calls[0].path, "/api/feedback");
  assert.equal(calls[0].options.credentials, "same-origin"); assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.doesNotMatch(calls[0].options.body, /storyTitle|storyText|email|subject|token|appearance|device/);
});
test("a changed draft gets a new key, and a storage error or malformed acknowledgement is never shown as success", async () => {
  let keys = 0;
  const client = new FeedbackClient({ makeKey: () => ++keys === 1 ? KEY : ID, authorize: async () => true, fetcher: async () => Response.json({ error: "private database details" }, { status: 503 }) });
  await assert.rejects(client.submit(draft), /could not confirm/);
  await assert.rejects(client.submit({ ...draft, message: "A changed neutral note." }), /could not confirm/);
  assert.equal(client.pending.key, ID);
  client.fetcher = async () => Response.json({ ok: true });
  await assert.rejects(client.submit(draft), /could not confirm/);
  assert.notEqual(client.pending, null);
});
test("fresh authorization and explicit deletion consent are required before any stored-data action", async () => {
  let calls = 0;
  const client = new FeedbackClient({ makeKey: () => KEY, authorize: async () => false, fetcher: async () => { calls++; return Response.json(saved()); } });
  await assert.rejects(client.submit(draft), /sign-in/);
  await assert.rejects(client.list(), /sign-in/);
  await assert.rejects(client.export(), /sign-in/);
  await assert.rejects(client.erase({ confirm: true }), /sign-in/);
  await assert.rejects(client.erase(), /Confirm/);
  assert.equal(calls, 0);
});
test("cancelled or stale requests cannot produce a successful saved status", async () => {
  let release;
  const client = new FeedbackClient({ makeKey: () => KEY, authorize: async () => true, fetcher: () => new Promise(resolve => { release = resolve; }) });
  const pending = client.submit(draft);
  await Promise.resolve(); await Promise.resolve();
  client.cancel(); release(Response.json(saved()));
  await assert.rejects(pending, /could not confirm/);
  assert.equal(client.pending.key, KEY); assert.equal(client.busy, false);
});
test("cancelling while fresh authorization is pending prevents a delayed mutation", async () => {
  for (const action of [client => client.submit(draft), client => client.erase({ confirm: true })]) {
    let release, calls = 0;
    const client = new FeedbackClient({ makeKey: () => KEY, authorize: () => new Promise(resolve => { release = resolve; }), fetcher: async () => { ++calls; return Response.json(saved()); } });
    const pending = action(client);
    client.cancel(); release(true);
    await assert.rejects(pending, /sign-in/);
    assert.equal(calls, 0); assert.equal(client.busy, false);
  }
});
test("feedback export and live deletion have distinct, validated outcomes", async () => {
  const row = { id: ID, category: "other", message: "A saved neutral feedback note.", rating: 2, createdAt: 1000, expiresAt: 2000 };
  const calls = [];
  const client = new FeedbackClient({ authorize: async () => true, fetcher: async (path, options) => {
    calls.push({ path, options });
    return Response.json(path === "/api/my-data" ? { scope: "SatinLore app feedback", exportedAt: 3000, feedback: [row] } : path === "/api/my-data/delete" ? { ok: true, deleted: true } : { feedback: [row] });
  } });
  assert.deepEqual(await client.list(), [row]);
  assert.equal((await client.export()).scope, "SatinLore app feedback");
  assert.deepEqual(await client.erase({ confirm: true }), { ok: true, deleted: true });
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { confirm: true });
  assert.equal(calls.at(-1).options.method, "POST");
  client.fetcher = async () => Response.json({ ok: true });
  await assert.rejects(client.erase({ confirm: true }), /could not confirm/);
});
test("feedback draft bounds are checked before transmission", async () => {
  let calls = 0;
  const client = new FeedbackClient({ authorize: async () => true, fetcher: async () => { calls++; return Response.json(saved()); } });
  assert.throws(() => feedbackDraft({ ...draft, message: "😀".repeat(600) }), /2 KB/);
  await assert.rejects(client.submit({ ...draft, rating: 9 }), /rating/);
  await assert.rejects(client.submit({ ...draft, message: "" }), /5–2,000/);
  assert.equal(calls, 0);
});
