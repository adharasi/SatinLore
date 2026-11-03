import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { ALPHA_CLIP_CONSENT, ALPHA_CONSENT, ALPHA_ORIGIN } from "../deploy/cloudflare/alpha-contract.mjs";

const passwords = {
  Dilan: Buffer.alloc(32, 1).toString("base64url"),
  Sadie: Buffer.alloc(32, 2).toString("base64url"),
};
const sha256 = value => createHash("sha256").update(value).digest("hex");

test("alpha auth and study data stay isolated in the real SQLite Durable Object", { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const entry = `export { AlphaStudy } from './deploy/cloudflare/alpha-study.mjs';
    import { handleAlphaApi, verifyAlphaSession } from './deploy/cloudflare/alpha-study.mjs';
    export default { async fetch(request, env) {
      if (new URL(request.url).pathname === '/fixture-check-session') return Response.json(await verifyAlphaSession(request, env));
      return await handleAlphaApi(request, env) ?? new Response(null,{status:404});
    }};`;
  const sources = await Promise.all(["alpha-study", "alpha-contract"].map(async name => ({
    type: "ESModule", path: `${root}deploy/cloudflare/${name}.mjs`, contents: await readFile(`${root}deploy/cloudflare/${name}.mjs`, "utf8"),
  })));
  const config = {
    modulesRoot: root, modules: [{ type: "ESModule", path: `${root}alpha-study-test-worker.mjs`, contents: entry }, ...sources],
    compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0,
    durableObjects: { ALPHA_STUDY: { className: "AlphaStudy", useSQLite: true } },
    bindings: { ALPHA_DILAN_VERIFIER: sha256(passwords.Dilan), ALPHA_SADIE_VERIFIER: sha256(passwords.Sadie) },
  };
  const mf = new Miniflare(config);
  t.after(() => mf.dispose());
  const get = (path, cookie, headers = {}) => mf.dispatchFetch(`${ALPHA_ORIGIN}${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const post = (path, body, cookie, headers = {}) => mf.dispatchFetch(`${ALPHA_ORIGIN}${path}`, { method: "POST",
    headers: { Origin: ALPHA_ORIGIN, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(body) });
  const login = async username => {
    const response = await post("/api/alpha/login", { username, password: passwords[username] });
    assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
    const set = response.headers.get("Set-Cookie");
    assert.match(set, /^__Host-satinlore_alpha=[a-f0-9]{64}; Max-Age=28800; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
    const info = await response.json();
    assert.equal(info.username, username);
    assert.equal(info.isFounder, username === "Dilan");
    return set.split(";", 1)[0];
  };

  assert.equal((await (await get("/api/alpha/auth")).json()).authenticated, false);
  assert.equal((await post("/api/alpha/login", { username: "Dilan" })).status, 400);
  assert.equal((await post("/api/alpha/login", { username: "Dilan", password: passwords.Sadie })).status, 401);
  assert.equal((await post("/api/alpha/login", { username: "Dilan", password: passwords.Dilan }, null, { Origin: "https://beta.satinlore.com" })).status, 403);
  const sadie = await login("Sadie"), dilan = await login("Dilan");
  assert.equal((await (await get("/fixture-check-session", sadie)).json()).subject, "alpha:sadie");
  assert.equal((await get("/api/alpha/admin/sessions", sadie)).status, 403);
  assert.equal((await get("/api/alpha/admin/sessions", undefined, { "X-Alpha-Session": dilan.split("=")[1] })).status, 401);

  const start = { consentVersion: ALPHA_CONSENT, mode: "simulator", idempotencyKey: crypto.randomUUID() };
  assert.equal((await post("/api/alpha/sessions", { ...start, consentVersion: "unaccepted" }, sadie)).status, 400);
  const started = await post("/api/alpha/sessions", start, sadie);
  assert.equal(started.status, 201, started.status === 201 ? "" : await started.text());
  const { id, seq } = await started.json();
  assert.equal(seq, 0);
  const own = `/api/alpha/sessions/${id}`, admin = `/api/alpha/admin/sessions/${id}`;
  assert.equal((await (await post("/api/alpha/sessions", start, sadie)).json()).id, id);
  assert.equal((await post("/api/alpha/sessions", { ...start, mode: "live" }, sadie)).status, 409);
  assert.equal((await get(own, dilan)).status, 404);
  assert.equal((await get(admin, sadie)).status, 403);
  assert.equal((await get(admin, dilan, { "Sec-Fetch-Site": "same-site" })).status, 403);

  const batch = { seq: 1, events: [
    { t: 0, type: "step", step: "connect" },
    { t: 1, type: "device", mode: "simulator", channels: ["vibrate", "fingering"] },
    { t: 2, type: "output", mode: "simulator", stage: "simulated", channels: { vibrate: 1, fingering: null }, durationMs: 2000, commandId: 1 },
    { t: 3, type: "mark", mark: "good" },
  ] };
  assert.equal((await post(`${own}/events`, { ...batch, seq: 2 }, sadie)).status, 409);
  assert.equal((await post(`${own}/events`, { ...batch, events: [{ ...batch.events[0], credential: "rejected fixture" }] }, sadie)).status, 400);
  assert.equal((await post(`${own}/events`, batch, sadie)).status, 200);
  assert.equal((await (await post(`${own}/events`, batch, sadie)).json()).duplicate, true);
  assert.equal((await post(`${own}/events`, { ...batch, events: [{ t: 0, type: "step", step: "welcome" }] }, sadie)).status, 409);
  assert.equal((await post(`${own}/feedback`, { minimum: "depends" }, sadie)).status, 409);
  assert.equal((await post(`${own}/finish`, {}, sadie)).status, 200);
  assert.equal((await post(`${own}/events`, { ...batch, seq: 2 }, sadie)).status, 409);
  assert.equal((await post(`${own}/feedback`, { minimum: "depends", flexingMaximum: 2, vibrationMaximum: 3, easeOfUse: 0, improvements: "Synthetic note" }, sadie)).status, 200);
  const note = { t: 2, text: "Synthetic timeline marker" };
  assert.equal((await post(`${own}/annotations`, note, sadie)).status, 201);
  assert.equal((await post(`${own}/annotations`, note, sadie)).status, 200);

  const clip = Buffer.alloc(540000, 0x11);
  clip.set([0x1a, 0x45, 0xdf, 0xa3]);
  const share = (cookie, headers = {}, body = clip) => mf.dispatchFetch(`${ALPHA_ORIGIN}${own}/clip`, { method: "POST", headers: {
    Origin: ALPHA_ORIGIN, "Content-Type": "video/webm", Cookie: cookie, "X-Alpha-Clip-Duration-Ms": "1000", "X-Alpha-Clip-Offset-Ms": "100", ...headers,
  }, body });
  // An early denial can close a test HTTP connection before a large upload ends.
  // Prove denials with a short body and exercise chunked storage only after authorisation.
  const shortClip = clip.subarray(0, 16);
  assert.equal((await share(sadie, {}, shortClip)).status, 400);
  assert.equal((await share(dilan, { "X-Alpha-Clip-Consent": ALPHA_CLIP_CONSENT }, shortClip)).status, 404);
  const shared = await share(sadie, { "X-Alpha-Clip-Consent": ALPHA_CLIP_CONSENT });
  assert.equal(shared.status, 200, shared.status === 200 ? "" : await shared.text());
  const clipInfo = (await shared.json()).clip;
  assert.equal(clipInfo.bytes, clip.length);
  assert.deepEqual((await (await share(sadie, { "X-Alpha-Clip-Consent": ALPHA_CLIP_CONSENT })).json()).clip, clipInfo);
  assert.equal((await get(`${admin}/clip`, sadie)).status, 403);
  const part = await get(`${admin}/clip`, dilan, { Range: "bytes=524287-524290" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("Content-Range"), `bytes 524287-524290/${clip.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), clip.subarray(524287, 524291));
  assert.equal((await get(`${admin}/clip`, dilan, { Range: "bytes=900000-" })).status, 416);

  const detail = await (await get(admin, dilan)).json();
  assert.equal(detail.session.username, "Sadie");
  assert.equal(detail.session.state, "finished");
  assert.equal(detail.session.hasClip, true);
  assert.equal(detail.feedback.easeOfUse, 0);
  assert.deepEqual(detail.events, batch.events);
  assert.equal(detail.annotations.length, 1);
  assert.equal((await (await get("/api/alpha/admin/sessions?username=Dilan", dilan)).json()).sessions.length, 0);
  assert.equal((await (await get("/api/alpha/admin/sessions?username=Sadie", dilan)).json()).sessions.length, 1);
  assert.equal((await post(`${admin}/withdraw`, { confirm: true }, sadie)).status, 403);
  assert.equal((await post(`${admin}/withdraw`, { confirm: true }, dilan)).status, 200);
  assert.equal((await get(`${admin}/clip`, dilan)).status, 404);
  assert.equal((await post(`${own}/withdraw`, { confirm: true }, sadie)).status, 200);
  assert.equal((await post("/api/alpha/sessions", start, sadie)).status, 410);

  assert.equal((await post("/api/alpha/logout", {}, sadie)).status, 200);
  assert.equal((await (await get("/api/alpha/auth", sadie)).json()).authenticated, false);
  const renewedSadie = await login("Sadie");
  await mf.setOptions({ ...config, bindings: { ...config.bindings, ALPHA_DILAN_VERIFIER: sha256(Buffer.alloc(32, 3).toString("base64url")) } });
  assert.equal((await (await get("/api/alpha/auth", dilan)).json()).authenticated, false);
  assert.equal((await (await get("/api/alpha/auth", renewedSadie)).json()).authenticated, true);
});
