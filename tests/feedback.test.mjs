import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PrivateFeedback, normalizeFeedback, FEEDBACK_RETENTION_MS } from "../deploy/cloudflare/feedback.mjs";

const ORIGIN = "https://app.satinlore.com";
const KEY = "d93c5bf8-0659-4845-9fe9-df184af5f5a4";
const sample = (changes = {}) => ({ idempotencyKey: KEY, category: "idea", message: "A neutral synthetic feedback note.", rating: 3, ...changes });
function request(path = "/api/feedback", body, headers = {}) {
  return new Request("https://feedback.internal" + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function fixture(t) {
  const db = new DatabaseSync(":memory:"); let alarm = null;
  t.after(() => db.close());
  const storage = {
    sql: { exec(query, ...bindings) { const statement = db.prepare(query); if (statement.columns().length) { const rows = statement.all(...bindings); return { toArray: () => rows }; } statement.run(...bindings); return { toArray: () => [] }; } },
    transactionSync(callback) { db.exec("BEGIN"); try { const value = callback(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } },
    async setAlarm(time) { alarm = time; },
    async deleteAll() { db.exec("DROP TABLE IF EXISTS feedback; DROP TABLE IF EXISTS rate_windows"); alarm = null; },
  };
  return { service: new PrivateFeedback({ storage }, {}), db, alarm: () => alarm };
}

test("feedback accepts only deliberate fields and bounded text, never client identity or automatic story data", () => {
  assert.equal(normalizeFeedback(sample()).message, "A neutral synthetic feedback note.");
  assert.equal(normalizeFeedback(sample({ message: "  A note with\nnew lines.  ", rating: undefined })).rating, null);
  assert.throws(() => normalizeFeedback(sample({ sub: "another-reader" })));
  assert.throws(() => normalizeFeedback(sample({ email: "reader@example.test" })));
  assert.throws(() => normalizeFeedback(sample({ context: { storyTitle: "private" } })));
  assert.throws(() => normalizeFeedback(sample({ message: "x".repeat(2001) })));
  assert.throws(() => normalizeFeedback(sample({ message: "😀".repeat(600) })));
  assert.throws(() => normalizeFeedback(sample({ message: "bad\u0000text" })));
  assert.throws(() => normalizeFeedback(sample({ category: "story" })));
  assert.throws(() => normalizeFeedback(sample({ rating: 6 })));
  assert.throws(() => normalizeFeedback(sample({ idempotencyKey: "private-token" })));
});
test("feedback writes durably, retries safely after a lost acknowledgement, and rejects changed-payload replay", async t => {
  const f = fixture(t);
  const first = await f.service.fetch(request("/api/feedback", sample()));
  assert.equal(first.status, 201);
  const saved = await first.json();
  assert.equal(saved.ok, true); assert.equal(saved.duplicate, false);
  assert.equal(saved.expiresAt - saved.createdAt, FEEDBACK_RETENTION_MS);
  assert.ok(f.alarm() > saved.createdAt);
  const retry = await f.service.fetch(request("/api/feedback", sample()));
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ...saved, duplicate: true });
  assert.equal(f.db.prepare("SELECT COUNT(*) count FROM feedback").get().count, 1);
  assert.equal(f.db.prepare("SELECT count FROM rate_windows WHERE period='day'").get().count, 1);
  assert.equal((await f.service.fetch(request("/api/feedback", sample({ message: "A different synthetic note." })))).status, 409);
  const list = await (await f.service.fetch(request())).json();
  assert.equal(list.feedback.length, 1); assert.equal(list.feedback[0].id, saved.id);
  assert.equal(list.feedback[0].message, sample().message);
  assert.equal(list.feedback[0].fingerprint, undefined); assert.equal(list.feedback[0].request_id, undefined);
});
test("per-user write limits survive object recreation; retries still work and other users have separate storage", async t => {
  const f = fixture(t);
  const first = await f.service.fetch(request("/api/feedback", sample()));
  assert.equal(first.status, 201);
  assert.equal((await f.service.fetch(request("/api/feedback", sample({ idempotencyKey: crypto.randomUUID() })))).status, 201);
  const blocked = await f.service.fetch(request("/api/feedback", sample({ idempotencyKey: crypto.randomUUID() })));
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  const restarted = new PrivateFeedback({ storage: f.service.storage }, {});
  assert.equal((await restarted.fetch(request("/api/feedback", sample({ idempotencyKey: crypto.randomUUID() })))).status, 429);
  assert.equal((await restarted.fetch(request("/api/feedback", sample()))).status, 200);
  const other = fixture(t);
  assert.equal((await other.service.fetch(request("/api/feedback", sample()))).status, 201);
  assert.equal((await (await other.service.fetch(request())).json()).feedback.length, 1);
});
test("retained-record cap, expiry alarms and deletion keep the stored feedback bounded", async t => {
  const f = fixture(t);
  await f.service.fetch(request("/api/feedback", sample()));
  const now = Date.now();
  const insert = f.db.prepare("INSERT INTO feedback(id,request_id,fingerprint,category,rating,message,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 99; i++) insert.run(crypto.randomUUID(), crypto.randomUUID(), "synthetic", "other", null, "Neutral synthetic fixture.", now - 2000, now + 100000);
  assert.equal((await f.service.fetch(request("/api/feedback", sample({ idempotencyKey: crypto.randomUUID() })))).status, 429);
  f.db.prepare("UPDATE feedback SET expires_at=?").run(now - 1);
  await f.service.alarm();
  assert.deepEqual((await (await f.service.fetch(request())).json()).feedback, []);
  assert.equal((await f.service.fetch(request("/api/feedback", sample()))).status, 201, "Expired idempotency keys do not retain feedback forever.");
  assert.equal((await f.service.fetch(request("/api/my-data/delete", { confirm: false }))).status, 400);
  assert.equal((await f.service.fetch(request("/api/my-data/delete", { confirm: true, id: "another-account" }))).status, 400);
  const cleared = await f.service.fetch(request("/api/my-data/delete", { confirm: true }));
  assert.equal(cleared.status, 200); assert.deepEqual(await cleared.json(), { ok: true, deleted: true });
  assert.ok(f.alarm() > now, "Message-free quota counters retain their expiry alarm after feedback deletion.");
  assert.deepEqual((await (await f.service.fetch(request())).json()).feedback, []);
});
test("clearing feedback cannot reset the durable write limits, and message-free counters expire within one day", async t => {
  let now = Math.floor(Date.now() / 86400000) * 86400000 + 1000;
  t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  for (let index = 0; index < 2; index++) assert.equal((await f.service.fetch(request("/api/feedback", sample({ idempotencyKey: crypto.randomUUID() })))).status, 201);
  assert.equal((await f.service.fetch(request("/api/my-data/delete", { confirm: true }))).status, 200);
  assert.equal(f.db.prepare("SELECT COUNT(*) count FROM feedback").get().count, 0);
  assert.equal(f.db.prepare("SELECT count FROM rate_windows WHERE period='day'").get().count, 2);
  assert.deepEqual(f.db.prepare("PRAGMA table_info(rate_windows)").all().map(column => column.name), ["period", "starts_at", "count", "expires_at"]);
  assert.ok(f.db.prepare("SELECT MAX(expires_at) expires FROM rate_windows").get().expires <= now + 86400000);
  const restarted = new PrivateFeedback({ storage: f.service.storage }, {});
  assert.equal((await restarted.fetch(request("/api/feedback", sample({ idempotencyKey: crypto.randomUUID() })))).status, 429);
  now += 60000;
  assert.equal((await restarted.fetch(request("/api/feedback", sample({ idempotencyKey: crypto.randomUUID() })))).status, 201);
  await restarted.fetch(request("/api/my-data/delete", { confirm: true }));
  now += 86400000;
  await restarted.alarm();
  assert.equal(f.alarm(), null, "After all short-lived counters expire, empty storage is removed too.");
});
test("export contains only this app's retained feedback and does not claim Cloudflare account or browser-story deletion", async t => {
  const f = fixture(t);
  await f.service.fetch(request("/api/feedback", sample()));
  const exported = await f.service.fetch(request("/api/my-data"));
  assert.equal(exported.status, 200); assert.match(exported.headers.get("Content-Disposition"), /attachment/);
  const data = await exported.json();
  assert.equal(data.scope, "SatinLore app feedback"); assert.equal(data.feedback.length, 1);
  assert.deepEqual(Object.keys(data.feedback[0]).sort(), ["category", "createdAt", "expiresAt", "id", "message", "rating"]);
  assert.equal(exported.headers.get("Cache-Control"), "no-store");
});
test("cross-origin, oversized, malformed and unsupported service requests fail without saving", async t => {
  const f = fixture(t);
  assert.equal((await f.service.fetch(request("/api/feedback", sample(), { Origin: "https://attacker.example.test" }))).status, 400);
  assert.equal((await f.service.fetch(request("/api/feedback", sample({ message: "x".repeat(5000) })))).status, 413);
  assert.equal((await f.service.fetch(new Request("https://feedback.internal/api/feedback", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: "{}" }))).status, 400);
  assert.equal((await f.service.fetch(new Request("https://feedback.internal/api/feedback", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: "{" }))).status, 400);
  assert.equal((await f.service.fetch(request("/api/feedback?email=private@example.test"))).status, 400);
  assert.equal((await f.service.fetch(request("/api/my-data/delete"))).status, 405);
  assert.equal((await f.service.fetch(request("/api/not-real"))).status, 404);
  assert.deepEqual((await (await f.service.fetch(request())).json()).feedback, []);
});
test("storage failures never echo feedback text and never acknowledge a successful operation", async t => {
  const f = fixture(t);
  f.service.storage.transactionSync = () => { throw new Error("synthetic-private-feedback-text"); };
  const response = await f.service.fetch(request("/api/feedback", sample()));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /synthetic-private-feedback-text|neutral synthetic/);
});
