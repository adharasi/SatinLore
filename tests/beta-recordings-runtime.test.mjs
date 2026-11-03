import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";

test("beta recordings run in actual SQLite Durable Object storage with ownership and durable withdrawal", { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "beta-recording-test-worker.mjs", contents: `export { BetaRecordings } from "./deploy/cloudflare/beta-recordings.mjs";
      export default { fetch(request,env) {
        const url=new URL(request.url),headers=new Headers({Origin:"https://beta.satinlore.com","Content-Type":"application/json","X-SatinLore-Participant":(request.headers.get("X-Fixture-Other")?"b":"a").repeat(64),"X-SatinLore-Role":request.headers.get("X-Fixture-Founder")?"founder":"reader"});
        return env.BETA_RECORDINGS.get(env.BETA_RECORDINGS.idFromName("beta-recordings-v1")).fetch(new Request("https://beta-recordings.internal"+url.pathname+url.search,{method:request.method,headers,...(request.method==="POST"?{body:request.body}:{})}));
      }};` },
    { type: "ESModule", path: root + "deploy/cloudflare/beta-recordings.mjs", contents: await readFile(new URL("../deploy/cloudflare/beta-recordings.mjs", import.meta.url), "utf8") },
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0, durableObjects: { BETA_RECORDINGS: { className: "BetaRecordings", useSQLite: true } } });
  t.after(() => mf.dispose());
  const post = (body, extra = {}) => mf.dispatchFetch("https://beta.satinlore.com/api/beta/recordings", { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
  const start = { action: "start", consentVersion: "beta-controls-2026-11-02-v1", idempotencyKey: crypto.randomUUID(), mode: "simulator", toy: "osci3", viewport: { w: 390, h: 844 } };
  const initial = await post(start); assert.equal(initial.status, 201, initial.status === 201 ? "" : await initial.text()); const saved = await initial.json();
  const batch = { action: "append", sid: saved.sid, seq: 1, events: [{ t: 0, type: "output", channels: { oscillate: 2 }, state: "testing" }] };
  assert.equal((await post(batch)).status, 200); assert.equal((await (await post(batch)).json()).duplicate, true);
  assert.equal((await post(batch, { "X-Fixture-Other": "true" })).status, 404);
  const admin = await mf.dispatchFetch("https://beta.satinlore.com/api/admin/beta-recordings/" + saved.sid, { headers: { "X-Fixture-Founder": "true" } }); assert.equal(admin.status, 200); assert.equal((await admin.json()).events[0].channels.oscillate, 2);
  assert.equal((await post({ action: "withdraw", sid: saved.sid })).status, 200);
  assert.equal((await post(batch)).status, 404); assert.equal((await post(start)).status, 409);
});
