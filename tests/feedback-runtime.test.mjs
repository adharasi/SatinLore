import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";

test("the feedback class runs with real SQLite Durable Object storage and isolated namespaces", { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "feedback-test-worker.mjs", contents: `export { PrivateFeedback } from "./deploy/cloudflare/feedback.mjs";
      // Test-only selector; the production Worker derives this solely from verified JWT claims.
      export default { fetch(request, env) {
        const url = new URL(request.url), headers = new Headers(request.headers);
        headers.set("Origin", "https://app.satinlore.com");
        const forwarded = new Request("https://feedback.internal" + url.pathname, { method: request.method, headers, ...(["POST", "PATCH"].includes(request.method) ? { body: request.body } : {}) });
        const stub = env.PRIVATE_FEEDBACK.get(env.PRIVATE_FEEDBACK.idFromName(request.headers.get("X-Fixture-User") || "one"));
        return stub.fetch(forwarded);
      } };` },
    { type: "ESModule", path: root + "deploy/cloudflare/feedback.mjs", contents: await readFile(new URL("../deploy/cloudflare/feedback.mjs", import.meta.url), "utf8") },
  // The repository-pinned local workerd supports May 2026. All exercised SQLite APIs predate this date.
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0, durableObjects: { PRIVATE_FEEDBACK: { className: "PrivateFeedback", useSQLite: true } } });
  t.after(() => mf.dispose());
  const first = { fetch: (url, options = {}) => mf.dispatchFetch(url, options) };
  const other = { fetch: (url, options = {}) => mf.dispatchFetch(url, { ...options, headers: { ...options.headers, "X-Fixture-User": "two" } }) };
  const body = { idempotencyKey: crypto.randomUUID(), category: "bug", message: "A neutral runtime feedback fixture.", rating: null };
  const write = () => first.fetch("https://app.satinlore.com/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const saved = await write(); assert.equal(saved.status, 201, saved.status === 201 ? "" : await saved.text());
  const retry = await write(); assert.equal(retry.status, 200); assert.equal((await retry.json()).duplicate, true);
  assert.equal((await (await first.fetch("https://feedback.internal/api/feedback")).json()).feedback.length, 1);
  assert.equal((await (await other.fetch("https://feedback.internal/api/feedback")).json()).feedback.length, 0);

  const access = (path, owner, payload, method = payload === undefined ? "GET" : "POST") => mf.dispatchFetch("https://app.satinlore.com/internal/inbox/" + path, {
    method, headers: { "X-Fixture-User": "inbox", ...(owner ? { "X-Feedback-Owner": owner } : {}), ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const alice = "a".repeat(64), bob = "b".repeat(64);
  const sent = await access("feedback", alice, body);
  assert.equal(sent.status, 201, sent.status === 201 ? "" : await sent.text());
  const { id } = await sent.json();
  assert.equal((await access("feedback", alice, body)).status, 200, "An identical request is a retry.");
  assert.equal((await access("feedback", alice, { ...body, rating: 4 })).status, 409);
  assert.equal((await access("feedback", bob, body)).status, 201, "Idempotency is scoped to the reader.");
  assert.equal((await access("feedback")).status, 404);
  assert.equal((await access("feedback", "untrusted")).status, 404);
  assert.equal((await (await access("feedback", alice)).json()).feedback.length, 1);
  assert.equal((await (await access("feedback", bob)).json()).feedback.length, 1);
  const founderList = await (await access("review")).json();
  assert.equal(founderList.feedback.length, 2);
  assert.ok(founderList.feedback.every(note => note.status === "new" && !note.owner && !note.request_id && !note.fingerprint));
  assert.equal((await access("review", null, { id, status: "reviewing" }, "PATCH")).status, 200);
  assert.equal((await (await access("feedback", alice)).json()).feedback[0].status, "reviewing");
  assert.equal((await (await access("feedback", bob)).json()).feedback[0].status, "new");
  assert.equal((await access("delete", alice, { confirm: true })).status, 200);
  assert.equal((await (await access("review")).json()).feedback.length, 1);
  assert.equal((await access("review", null, { id, status: "resolved" }, "PATCH")).status, 404);
  const second = await first.fetch("https://app.satinlore.com/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }) });
  assert.equal(second.status, 201);
  assert.equal((await (await first.fetch("https://feedback.internal/api/my-data")).json()).feedback.length, 2);
  const cleared = await first.fetch("https://app.satinlore.com/api/my-data/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
  assert.equal(cleared.status, 200); assert.equal((await cleared.json()).deleted, true);
  assert.equal((await (await first.fetch("https://feedback.internal/api/feedback")).json()).feedback.length, 0);
  assert.equal((await write()).status, 429, "Feedback deletion preserves rate limits in actual SQLite Durable Object storage.");
  const quota = client => client.fetch("https://app.satinlore.com/internal/lovense-rate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  for (let count=0; count<3; count++) assert.equal((await quota(first)).status,200);
  assert.equal((await quota(first)).status,429, "Connection quota commits in actual SQLite storage.");
  assert.equal((await quota(other)).status,200, "Another object has its own connection quota.");
  assert.equal((await (await first.fetch("https://feedback.internal/api/feedback")).json()).feedback.length,0);
});
