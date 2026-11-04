import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

test("accounts use real SQLite Durable Object KV transactions, cross-user isolation and deletion revisions", { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "account-test-worker.mjs", contents: `
      export { ReaderAccount } from "./deploy/cloudflare/accounts.mjs";
      // Synthetic runtime fixture only. Production derives the namespace from verified Access claims.
      export default { fetch(request, env) {
        const url = new URL(request.url), headers = new Headers(request.headers);
        headers.set("Origin", "https://app.satinlore.com");
        const stub = env.READER_ACCOUNTS.get(env.READER_ACCOUNTS.idFromName(request.headers.get("X-Fixture-User") || "one"));
        return stub.fetch(new Request("https://accounts.internal" + url.pathname, {
          method: request.method, headers, ...(request.method === "POST" ? {body: request.body} : {})
        }));
      }};` },
    { type: "ESModule", path: root + "deploy/cloudflare/accounts.mjs", contents: await readFile(new URL("../deploy/cloudflare/accounts.mjs", import.meta.url), "utf8") },
    { type: "ESModule", path: root + "app/static/devices/toy-profiles.mjs", contents: await readFile(new URL("../app/static/devices/toy-profiles.mjs", import.meta.url), "utf8") },
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0, durableObjects: {
    READER_ACCOUNTS: { className: "ReaderAccount", useSQLite: true },
  } });
  t.after(() => mf.dispose());
  const call = (path, body, user = "one") => mf.dispatchFetch("https://app.satinlore.com" + path, {
    method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "X-Fixture-User": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const initial = await (await call("/api/account")).json();
  assert.equal(initial.registered, false);
  const created = await call("/api/account", { action: "create", adult: true, expectedRevision: 0 });
  assert.equal(created.status, 201, created.status === 201 ? "" : await created.text());
  const settings = { minimum: 1, background: 1, preferred: 3, maximum: 5, recovery: 0, gain: 1, rhythm: "steady" };
  const preset = { id: crypto.randomUUID(), name: "Synthetic setting", toy: "flexer", scope: "account", storyId: null,
    mode: "continuous", channels: { vibrate: settings, fingering: { ...settings, preferred: 2 } } };
  const saved = await call("/api/presets", { expectedRevision: 1, preset });
  assert.equal(saved.status, 200, saved.status === 200 ? "" : await saved.text());
  assert.equal((await (await call("/api/account")).json()).presets.length, 1);
  assert.equal((await (await call("/api/account", undefined, "two")).json()).registered, false);
  const exported = await (await call("/api/account/data")).json();
  assert.equal(exported.revision, 2); assert.equal(exported.presets[0].channels.fingering.preferred, 2);
  assert.equal(exported.playback, "paused");
  const otherSave = await call("/api/presets", { expectedRevision: 2, preset }, "two");
  assert.equal(otherSave.status, 409);
  const removed = await call("/api/account/delete", { confirm: true, expectedRevision: 2 });
  assert.equal(removed.status, 200);
  assert.equal((await call("/api/presets", { expectedRevision: 2, preset })).status, 409, "A delayed write cannot resurrect deleted settings in real storage.");
  const final = await (await call("/api/account/data")).json();
  assert.equal(final.registered, false); assert.equal(final.account, null); assert.equal(final.revision, 3); assert.deepEqual(final.presets, []);
});
