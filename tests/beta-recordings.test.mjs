import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { BetaRecordings, normalizeBetaEvent, normalizeBetaStart, handleBetaRecordings, BETA_RECORDING_CONSENT, BETA_RECORDING_LIMITS, BETA_RECORDING_RETENTION_MS } from "../deploy/cloudflare/beta-recordings.mjs";
import { betaReplayState, betaEventDescription, betaGraphPaths } from "../app/static/beta-admin.mjs";
const ORIGIN = "https://beta.satinlore.com", OWNER = "a".repeat(64), OTHER = "b".repeat(64);
const start = (changes = {}) => ({ action: "start", consentVersion: BETA_RECORDING_CONSENT, idempotencyKey: crypto.randomUUID(), mode: "simulator", toy: "flexer", viewport: { w: 1360, h: 940 }, ...changes });
function request(path = "/api/beta/recordings", body, owner = OWNER, founder = false) { return new Request("https://beta-recordings.internal" + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-SatinLore-Participant": owner, "X-SatinLore-Role": founder ? "founder" : "reader" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
function fixture(t) {
  const db = new DatabaseSync(":memory:"); let alarm = null; t.after(() => db.close());
  const storage = { sql: { exec(query, ...bindings) { const statement = db.prepare(query); if (statement.columns().length) return { toArray: () => statement.all(...bindings) }; statement.run(...bindings); return { toArray: () => [] }; } },
    transactionSync(task) { db.exec("BEGIN"); try { const result = task(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } },
    async setAlarm(at) { alarm = at; }, async deleteAlarm() { alarm = null; } };
  return { service: new BetaRecordings({ storage }, {}), db, alarm: () => alarm };
}
const append = (sid, seq = 1, events = [{ t: 0, type: "output", channels: { vibrate: 2, fingering: 1 }, state: "testing" }]) => ({ action: "append", sid, seq, events });

test("beta event schema admits only fixed steps and numeric controls, rejecting raw text and identities", () => {
  assert.deepEqual(normalizeBetaEvent({ t: 5, type: "control", control: "maximum", channel: "vibrate", value: 5 }), { t: 5, type: "control", control: "maximum", channel: "vibrate", value: 5 });
  assert.equal(normalizeBetaEvent({ t: 3, type: "device", toy: "flexer", mode: "live", channels: ["vibrate", "fingering"] }).toy, "flexer");
  assert.deepEqual(normalizeBetaEvent({ t: 4, type: "rating", question: "intensity", value: 3, channel: "fingering", field: "background" }), { t: 4, type: "rating", question: "intensity", value: 3, channel: "fingering", field: "background" });
  assert.deepEqual(normalizeBetaEvent({ t: 5, type: "preset", event: "apply", scope: "story" }), { t: 5, type: "preset", event: "apply", scope: "story" });
  assert.equal(normalizeBetaEvent({ t: 6, type: "step", step: "presets" }).step, "presets");
  const mark = {t: 7, type: "reading-feedback", issue: "too-strong", position: 3};
  assert.deepEqual(normalizeBetaEvent(mark), mark);
  assert.equal(betaEventDescription(mark), "Reading feedback · Section 4 · Too strong");
  for (const value of [
    { t: 0, type: "control", control: "maximum", value: 5, storyText: "private canary" },
    { t: 0, type: "output", channels: { email: "synthetic@example.invalid" }, state: "playing" },
    { t: 0, type: "rating", question: "free response", value: 5 },
    { ...mark, issue: "free response" }, { ...mark, position: 2000 }, { ...mark, fixture: "personal" },
    { t: 0, type: "rating", question: "intensity", value: 3, channel: "private toy" },
    { t: 0, type: "rating", question: "intensity", value: 3, field: "private field" },
    { t: 0, type: "preset", event: "apply", scope: "story", id: crypto.randomUUID() },
    { t: 0, type: "preset", event: "save", scope: "account", name: "Private canary" },
    { t: 0, type: "control", control: "action", value: "pairing-token-canary" },
    { t: 0, type: "device", toy: "flexer", mode: "live", deviceId: "vendor-device-canary" },
    { t: 0, type: "output", channels: { vibrate: NaN }, state: "playing" },
    { t: -1, type: "step", step: "choose" }, { t: 3600001, type: "step", step: "choose" },
  ]) assert.throws(() => normalizeBetaEvent(value));
  assert.throws(() => normalizeBetaStart(start({ consentVersion: "old-consent" })));
  assert.throws(() => normalizeBetaStart(start({ accountId: "another-reader" })));
});

test("beta records persist ordered timelines, exact retries and metadata without private context", async t => {
  const f = fixture(t), body = start();
  const initial = await f.service.fetch(request(undefined, body)); assert.equal(initial.status, 201); const saved = await initial.json();
  assert.equal(saved.seq, 0); assert.equal(saved.retainedUntil - saved.expiresAt, BETA_RECORDING_RETENTION_MS - BETA_RECORDING_LIMITS.durationMs);
  assert.equal((await (await f.service.fetch(request(undefined, body))).json()).duplicate, true);
  assert.equal((await f.service.fetch(request(undefined, { ...body, toy: "nora" }))).status, 409);
  const events = [{ t: 0, type: "step", step: "features" }, { t: 10, type: "device", toy: "flexer", mode: "live", channels: ["vibrate", "fingering"] }, { t: 20, type: "control", control: "background", channel: "fingering", value: 1 }, { t: 30, type: "output", state: "testing", channels: { fingering: 1 } }, { t: 40, type: "rating", question: "comfort", value: 4 }];
  const batch = append(saved.sid, 1, events);
  assert.equal((await f.service.fetch(request(undefined, batch))).status, 200);
  assert.equal((await (await f.service.fetch(request(undefined, batch))).json()).duplicate, true);
  assert.equal((await f.service.fetch(request(undefined, append(saved.sid, 1, [{ t: 0, type: "step", step: "complete" }])))).status, 409);
  assert.equal((await f.service.fetch(request(undefined, append(saved.sid, 3)))).status, 409);
  const detail = await (await f.service.fetch(request(`/api/admin/beta-recordings/${saved.sid}`, undefined, OTHER, true))).json();
  assert.equal(detail.session.mode, "live"); assert.equal(detail.session.toy, "flexer"); assert.deepEqual(detail.events, events);
  assert.equal(detail.privateText, "excluded"); assert.equal(detail.physicalOutput, "not measured");
  const stored = JSON.stringify(f.db.prepare("SELECT * FROM beta_batches").all()); assert.ok(!stored.includes("example.invalid") && !stored.includes("authToken"));
  const list = await (await f.service.fetch(request("/api/admin/beta-recordings?toy=flexer&mode=live", undefined, OTHER, true))).json(); assert.equal(list.sessions.length, 1); assert.equal(list.sessions[0].participant.length, 12);
  assert.ok(f.alarm() > Date.now());
});

test("reader ownership and founder scope are enforced even when a session ID is known", async t => {
  const f = fixture(t), saved = await (await f.service.fetch(request(undefined, start()))).json();
  assert.equal((await f.service.fetch(request(undefined, append(saved.sid), OTHER))).status, 404);
  assert.equal((await f.service.fetch(request(`/api/beta/recordings/${saved.sid}`, undefined, OTHER))).status, 404);
  assert.equal((await f.service.fetch(request(undefined, { action: "withdraw", sid: saved.sid }, OTHER))).status, 404);
  assert.equal((await f.service.fetch(request("/api/admin/beta-recordings", undefined, OWNER))).status, 403);
  assert.deepEqual((await (await f.service.fetch(request(undefined, undefined, OTHER))).json()).sessions, []);
  assert.equal((await f.service.fetch(request(undefined, { ...append(saved.sid), owner: OTHER }))).status, 400);
  assert.equal((await f.service.fetch(request("/api/admin/beta-recordings?email=canary", undefined, OWNER, true))).status, 400);
  const ownPage = await (await f.service.fetch(request("/api/beta/recordings?limit=1"))).json();
  assert.equal(ownPage.sessions.length, 1); assert.equal(ownPage.sessions[0].sid, saved.sid);
  assert.deepEqual((await (await f.service.fetch(request("/api/beta/recordings?limit=1", undefined, OTHER))).json()).sessions, []);
});

test("stop freezes new batches, withdrawal erases events and late retries cannot resurrect them", async t => {
  const f = fixture(t), body = start(), saved = await (await f.service.fetch(request(undefined, body))).json();
  const batch = append(saved.sid); await f.service.fetch(request(undefined, batch));
  assert.equal((await f.service.fetch(request(undefined, { action: "stop", sid: saved.sid }))).status, 200);
  assert.equal((await f.service.fetch(request(undefined, append(saved.sid, 2, [{ t: 1, type: "step", step: "complete" }])))).status, 409);
  assert.equal((await f.service.fetch(request(undefined, batch))).status, 200, "An already saved exact retry remains idempotent after Stop.");
  assert.equal((await f.service.fetch(request(undefined, { action: "withdraw", sid: saved.sid }))).status, 200);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM beta_batches").get().n, 0);
  assert.equal((await f.service.fetch(request(undefined, batch))).status, 404);
  assert.equal((await f.service.fetch(request(undefined, body))).status, 409);
  assert.deepEqual((await (await f.service.fetch(request("/api/admin/beta-recordings", undefined, OWNER, true))).json()).sessions, []);
  const tombstone = f.db.prepare("SELECT * FROM beta_sessions").get(); assert.equal(tombstone.bytes, 0); assert.equal(tombstone.viewport, "{}"); assert.equal(tombstone.toy, "none");
  assert.equal(f.db.prepare("SELECT count FROM beta_rates WHERE period='hour'").get().count, 1, "Withdrawal does not reset admission quotas.");
});

test("global and per-session quotas commit atomically and do not admit partial batches", async t => {
  const f = fixture(t), one = await (await f.service.fetch(request(undefined, start()))).json(), two = await (await f.service.fetch(request(undefined, start(), OTHER))).json();
  f.db.prepare("UPDATE beta_sessions SET bytes=? WHERE id=?").run(BETA_RECORDING_LIMITS.totalBytes - 1, one.sid);
  const responses = await Promise.all([f.service.fetch(request(undefined, append(two.sid), OTHER)), f.service.fetch(request(undefined, append(two.sid), OTHER))]);
  assert.ok(responses.every(response => response.status === 429)); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM beta_batches").get().n, 0);
  f.db.prepare("UPDATE beta_sessions SET bytes=0").run();
  f.db.prepare("UPDATE beta_sessions SET bytes=? WHERE id=?").run(BETA_RECORDING_LIMITS.sessionBytes - 1, two.sid);
  assert.equal((await f.service.fetch(request(undefined, append(two.sid), OTHER))).status, 429); assert.equal(f.db.prepare("SELECT seq FROM beta_sessions WHERE id=?").get(two.sid).seq, 0);
});

test("session and retention expiry are server checked and cleanup removes child batches", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now); const f = fixture(t), saved = await (await f.service.fetch(request(undefined, start()))).json();
  await f.service.fetch(request(undefined, append(saved.sid)));
  now += BETA_RECORDING_LIMITS.durationMs + 1;
  assert.equal((await f.service.fetch(request(undefined, append(saved.sid, 2)))).status, 409);
  now += BETA_RECORDING_RETENTION_MS;
  await f.service.alarm(); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM beta_sessions").get().n, 0); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM beta_batches").get().n, 0); assert.equal(f.alarm(), null);
});

test("withdrawal races and malformed stored events cannot restore or expose recording contents", async t => {
  const f = fixture(t), saved = await (await f.service.fetch(request(undefined, start()))).json();
  const responses = await Promise.all([f.service.fetch(request(undefined, append(saved.sid))), f.service.fetch(request(undefined, { action: "withdraw", sid: saved.sid }))]);
  assert.ok(responses.every(response => response.status === 200)); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM beta_batches").get().n, 0);
  assert.equal((await f.service.fetch(request(undefined, append(saved.sid)))).status, 404);
  const other = await (await f.service.fetch(request(undefined, start()))).json(); await f.service.fetch(request(undefined, append(other.sid)));
  f.db.prepare("UPDATE beta_batches SET payload=? WHERE sid=?").run(JSON.stringify([{ t: 0, type: "control", control: "maximum", value: 2, privateText: "PRIVATE_STORED_CANARY" }]), other.sid);
  const response = await f.service.fetch(request(`/api/admin/beta-recordings/${other.sid}`, undefined, OWNER, true)); assert.equal(response.status, 409); assert.ok(!(await response.text()).includes("PRIVATE_STORED_CANARY"));
});

test("outer router accepts only beta host, current verified identity and exact-origin writes", async () => {
  const session = { subject: "synthetic-access-subject", expiresAt: Date.now() + 60000, isFounder: false }, config = { origin: ORIGIN, issuer: "https://synthetic.cloudflareaccess.com" };
  const forwarded = []; const env = { BETA_RECORDINGS: { idFromName: value => value, get: () => ({ fetch(request) { forwarded.push(request); return Response.json({ ok: true }); } }) } };
  const body = start();
  const outer = (host = ORIGIN, headers = {}) => new Request(host + "/api/beta/recordings", { method: "POST", headers: { Origin: host, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await handleBetaRecordings(outer("https://app.satinlore.com"), env, { config: { ...config, origin: "https://app.satinlore.com" }, session })).status, 404);
  assert.equal((await handleBetaRecordings(outer(), env, { config, session: { ...session, expiresAt: 0 } })).status, 403);
  assert.equal((await handleBetaRecordings(outer(ORIGIN, { Origin: "https://app.satinlore.com" }), env, { config, session })).status, 403);
  assert.equal((await handleBetaRecordings(new Request(ORIGIN + "/api/admin/beta-recordings"), env, { config, session })).status, 403);
  assert.equal((await handleBetaRecordings(outer(), env, { config, session })).status, 200); assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].headers.get("X-SatinLore-Role"), "reader"); assert.match(forwarded[0].headers.get("X-SatinLore-Participant"), /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify([...forwarded[0].headers]).includes(session.subject));
  assert.equal(await handleBetaRecordings(new Request(ORIGIN + "/api/another"), env, { config, session }), null);
});

test("admin replay shows requested controls separately and emits bounded numeric SVG paths", () => {
  const data = { session: { toy: "flexer", mode: "live" }, events: [
    { t: 0, type: "device", toy: "flexer", mode: "live", channels: ["vibrate", "fingering"] }, { t: 100, type: "step", step: "calibration" },
    { t: 200, type: "output", channels: { vibrate: 3, fingering: 1 }, state: "playing" }, { t: 300, type: "control", control: "stop" },
    { t: 400, type: "output", channels: { vibrate: 0, fingering: 0 }, state: "stopped" }, { t: 500, type: "rating", question: "comfort", value: 4 },
  ] };
  const before = betaReplayState(data, 350); assert.deepEqual(before.output, { vibrate: 3, fingering: 1 }); assert.equal(before.settings.Stop, "Chosen"); assert.equal(before.status, "playing", "A click is not fabricated as a physical output observation.");
  assert.deepEqual(betaReplayState(data, 500).output, { vibrate: 0, fingering: 0 }); assert.equal(betaReplayState(data, 500).rating, "Comfort · 4/5");
  const paths = betaGraphPaths(data.events, 500); assert.deepEqual(Object.keys(paths), ["vibrate", "fingering"]); assert.ok(Object.values(paths).every(path => /^[MHV0-9.,]+$/.test(path)));
  assert.equal(betaEventDescription({ t: 0, type: "story", fixture: "personal", position: 1500 }), "Personal story · text excluded");
  assert.equal(betaEventDescription({ t: 0, type: "rating", question: "intensity", value: 1, channel: "fingering", field: "background" }), "Flexing · Background · Intensity · Too light (1/5)");
  assert.equal(betaEventDescription({ t: 0, type: "preset", event: "apply", scope: "story" }), "Applied story preset · name and ID excluded");
});
