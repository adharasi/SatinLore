import test from "node:test";
import assert from "node:assert/strict";
import { ReaderAccount, handleAccount, accountIdentity, ensureEmailAccount, normalizePreset, normalizeChannelSettings, ACCOUNT_BODY_BYTES } from "../deploy/cloudflare/accounts.mjs";

const ORIGIN = "https://app.satinlore.com";
const BETA = "https://beta.satinlore.com";
const ID = "87eedfe9-1763-405c-9e64-0d4d16843f10";
const STORY = "f38fc748-ad64-4c1f-9d46-6bcb93a5c559";
const channel = (changes = {}) => ({ minimum: 1, background: 1, preferred: 3, maximum: 5, recovery: 0, gain: 1, rhythm: "gentle", ...changes });
const preset = (changes = {}) => ({ id: ID, name: "Gentle rehearsal", toy: "flexer", scope: "account", storyId: null, mode: "continuous", channels: { vibrate: channel(), fingering: channel({ preferred: 2 }) }, ...changes });
function internal(path = "/api/account", body, options = {}) {
  return new Request("https://accounts.internal" + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...options.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...options });
}
function storageFixture() {
  let values = new Map();
  function handle(target) {
    return {
      async get(key) {
        if (Array.isArray(key)) return structuredClone(new Map(key.filter(item => target.has(item)).map(item => [item, target.get(item)])));
        return structuredClone(target.get(key));
      },
      async put(key, next) { target.set(key, structuredClone(next)); },
      async delete(key) {
        if (Array.isArray(key)) return key.filter(item => target.delete(item)).length;
        return target.delete(key);
      },
    };
  }
  const storage = {
    async get(key) { return handle(values).get(key); },
    async transaction(callback) {
      const pending = structuredClone(values);
      const result = await callback(handle(pending));
      values = pending;
      return result;
    },
  };
  return { storage, state: () => structuredClone(values.get("state")), set: next => { values.set("state", structuredClone(next)); } };
}
function fixture() { const f = storageFixture(); return { ...f, service: new ReaderAccount({ storage: f.storage }, {}) }; }
const create = service => service.fetch(internal("/api/account", { action: "create", adult: true, expectedRevision: 0 }));

test("preset validation permits independent movements and zero recovery, but no hidden identity or story fields", () => {
  assert.deepEqual(normalizeChannelSettings(channel()), channel());
  assert.equal(normalizePreset(preset()).channels.fingering.preferred, 2);
  assert.equal(normalizePreset(preset({ scope: "story", storyId: STORY })).storyId, STORY);
  assert.equal(normalizePreset(preset({ toy: "osci3", channels: { oscillate: channel() } })).toy, "osci3");
  assert.equal(normalizePreset(preset({ toy: "solacepro", channels: { thrusting: channel() } })).toy, "solacepro");
  assert.throws(() => normalizePreset(preset({ toy: "solacepro", channels: { vibrate: channel() } })), /movements exposed/);
  for (const change of [
    { email: "someone@example.test" }, { storyText: "Private fixture" }, { storyTitle: "Private title" }, { deviceId: "private-device" },
    { enabled: true }, { playback: "running" }, { toy: "unknown" }, { scope: "story", storyId: "a story title" },
    { storyId: STORY }, { name: "x".repeat(65) }, { name: "bad\nname" }, { name: "   " },
    { mode: "hold" }, { channels: {} }, { channels: { vibrate1: channel() } },
    { toy: "lush", channels: { fingering: channel() } }, { version: 2 },
    { activeChannels: [] }, { activeChannels: ["vibrate", "vibrate"] }, { activeChannels: ["rotate"] },
    { activeChannels: "vibrate" }, { activeChannels: ["vibrate", "fingering", "rotate", "thrusting", "oscillate", "suction"] },
    { ceiling: -1 }, { ceiling: 21 }, { ceiling: 4.5 }, { ceiling: "5" },
  ]) assert.throws(() => normalizePreset(preset(change)), JSON.stringify(change));
  for (const change of [
    { minimum: 6 }, { background: 0 }, { preferred: 6 }, { maximum: 21 }, { recovery: 6 },
    { maximum: 4.5 }, { gain: 0.05 }, { gain: 2.1 }, { gain: Infinity }, { rhythm: "arbitrary" },
    { enabled: true }, { toyId: "secret" },
  ]) assert.throws(() => normalizeChannelSettings(channel(change)), JSON.stringify(change));
});

test("saved active movements round-trip as paused preferences, independently from all available calibration channels", async () => {
  const f = fixture(); await create(f.service);
  const combined = await f.service.fetch(internal("/api/presets", { expectedRevision: 1, preset: preset({ activeChannels: ["vibrate", "fingering"], ceiling: 0 }) }));
  assert.equal(combined.status, 200);
  const snapshot = await combined.json();
  assert.equal(snapshot.playback, "paused"); assert.deepEqual(snapshot.presets[0].activeChannels, ["vibrate", "fingering"]);
  assert.equal(snapshot.presets[0].ceiling, 0, "A saved master zero remains separate from per-movement preferences.");
  assert.equal(snapshot.presets[0].channels.vibrate.maximum, 5);
  const single = await f.service.fetch(internal("/api/presets", { expectedRevision: 2, preset: preset({ activeChannels: ["fingering"] }) }));
  assert.equal(single.status, 200);
  const restored = await (await f.service.fetch(internal("/api/presets"))).json();
  assert.deepEqual(restored.presets[0].activeChannels, ["fingering"]);
  assert.deepEqual(Object.keys(restored.presets[0].channels).sort(), ["fingering", "vibrate"]);
  assert.equal(restored.playback, "paused");
});

test("account registration is deliberate and writes are durable before success; no playback is restored", async () => {
  const f = fixture();
  const initial = await (await f.service.fetch(internal())).json();
  assert.equal(initial.registered, false); assert.equal(initial.revision, 0); assert.equal(initial.playback, "paused");
  assert.equal((await f.service.fetch(internal("/api/account", { action: "create", adult: false, expectedRevision: 0 }))).status, 400);
  assert.equal((await f.service.fetch(internal("/api/account", { action: "create", adult: true, expectedRevision: 0, email: "bad@example.test" }))).status, 400);
  const created = await create(f.service); assert.equal(created.status, 201);
  const account = await created.json();
  assert.equal(account.registered, true); assert.equal(account.revision, 1); assert.equal(account.playback, "paused");
  assert.ok(account.account.id); assert.ok(account.account.adultConfirmedAt);
  assert.deepEqual(Object.keys(account.account).sort(), ["adultConfirmedAt", "createdAt", "id"]);
  const saved = await f.service.fetch(internal("/api/presets", { expectedRevision: 1, preset: preset() }));
  assert.equal(saved.status, 200);
  assert.equal(f.state().presets.length, 1);
  const restarted = new ReaderAccount({ storage: f.storage }, {});
  const restored = await (await restarted.fetch(internal())).json();
  assert.equal(restored.presets.length, 1); assert.equal(restored.presets[0].name, preset().name);
  assert.equal(restored.playback, "paused"); assert.equal(restored.revision, 2);
  assert.equal(JSON.stringify(restored).includes("email"), false);
  const broken = new ReaderAccount({ storage: { get: f.storage.get, transaction: async () => { throw new Error("synthetic storage failure"); } } }, {});
  assert.equal((await broken.fetch(internal("/api/presets", { expectedRevision: 2, preset: preset() }))).status, 503);
});

test("concurrent changes conflict and stale saves cannot resurrect deleted presets or an account", async () => {
  const f = fixture(); await create(f.service);
  const first = await Promise.all([
    f.service.fetch(internal("/api/presets", { expectedRevision: 1, preset: preset() })),
    f.service.fetch(internal("/api/presets", { expectedRevision: 1, preset: preset({ name: "Another change" }) })),
  ]);
  assert.deepEqual(first.map(x => x.status), [200, 409]);
  assert.equal(f.state().presets.length, 1);
  assert.equal((await f.service.fetch(internal("/api/presets/delete", { id: ID, expectedRevision: 2 }))).status, 200);
  assert.equal((await f.service.fetch(internal("/api/presets", { expectedRevision: 2, preset: preset() }))).status, 409);
  assert.equal(f.state().presets.length, 0);
  assert.equal((await f.service.fetch(internal("/api/account/delete", { confirm: false, expectedRevision: 3 }))).status, 400);
  assert.equal((await f.service.fetch(internal("/api/account/delete", { confirm: true, expectedRevision: 3 }))).status, 200);
  assert.equal(f.state().account, null); assert.equal(f.state().revision, 4);
  assert.equal((await create(f.service)).status, 409, "A stale signup tab cannot recreate a deleted account.");
  assert.equal((await f.service.fetch(internal("/api/presets", { expectedRevision: 4, preset: preset() }))).status, 409);
  const fresh = await f.service.fetch(internal("/api/account", { action: "create", adult: true, expectedRevision: 4 }));
  assert.equal(fresh.status, 201); assert.equal((await fresh.json()).presets.length, 0);
});

test("account data export, 50-preset cap and durable write limits are bounded", async () => {
  const f = fixture(); await create(f.service);
  const seeded = f.state();
  seeded.presets = Array.from({ length: 50 }, (_, index) => ({ ...normalizePreset(preset({ id: crypto.randomUUID(), scope: "story", storyId: STORY })), createdAt: Date.now(), updatedAt: Date.now() }));
  f.set(seeded);
  assert.equal((await f.service.fetch(internal("/api/presets", { expectedRevision: 1, preset: preset() }))).status, 429);
  const exportData = await (await f.service.fetch(internal("/api/account/data"))).json();
  assert.equal(exportData.format, "satinlore-account-v1"); assert.equal(exportData.presets.length, 50);
  assert.equal(exportData.rates, undefined); assert.equal(exportData.playback, "paused");
  const fullRate = f.state(), now = Date.now(); fullRate.rates = { minute: Math.floor(now / 60000), minuteCount: 30, day: Math.floor(now / 86400000), dayCount: 30 }; f.set(fullRate);
  assert.equal((await f.service.fetch(internal("/api/presets/delete", { id: seeded.presets[0].id, expectedRevision: 1 }))).status, 429);
  assert.equal(f.state().presets.length, 50, "Failed mutation does not partially delete data.");
  assert.equal((await f.service.fetch(internal("/api/account/delete", { confirm: true, expectedRevision: 1 }))).status, 200, "Account privacy deletion is not blocked by the save quota.");
  assert.equal(f.state().account, null); assert.equal(f.state().presets.length, 0);
  assert.equal(f.state().rates.minuteCount, 30, "Deleting private settings does not erase message-free quota counters.");
});

test("bounded parsing rejects oversized and malformed requests; internal service has no public bypass", async () => {
  const f = fixture();
  assert.equal((await f.service.fetch(new Request(ORIGIN + "/api/account", { headers: { Origin: ORIGIN } }))).status, 404);
  assert.equal((await f.service.fetch(internal("/api/account?email=private"))).status, 404);
  assert.equal((await f.service.fetch(internal("/api/account", undefined, { headers: { Origin: "https://example.invalid" } }))).status, 404);
  assert.equal((await f.service.fetch(internal("/api/account", {}, { method: "PUT" }))).status, 405);
  const oversized = new Request("https://accounts.internal/api/account", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: " ".repeat(ACCOUNT_BODY_BYTES + 1) });
  assert.equal((await f.service.fetch(oversized)).status, 413);
  const malformed = new Request("https://accounts.internal/api/account", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: "{" });
  assert.equal((await f.service.fetch(malformed)).status, 400);
});

test("the authenticated router binds only verified subject and issuer, strips metadata and isolates users", async () => {
  const buckets = new Map(), forwarded = [];
  const env = { READER_ACCOUNTS: { idFromName: name => name, get(name) {
    if (!buckets.has(name)) buckets.set(name, fixture().service);
    return { fetch(request) { forwarded.push(request); return buckets.get(name).fetch(request); } };
  } } };
  const config = { issuer: "https://synthetic.cloudflareaccess.com", origin: ORIGIN, audience: "a".repeat(64) };
  const session = { subject: "synthetic-subject", expiresAt: Date.now() + 60000 };
  const publicRequest = (path, body, origin = ORIGIN, headers = {}) => new Request(origin + path, { method: body ? "POST" : "GET", headers: { Origin: origin, "Content-Type": "application/json", Cookie: "private=fixture", "Cf-Access-Jwt-Assertion": "synthetic-not-real", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(await handleAccount(publicRequest("/other"), env, { config, session }), null);
  const first = await handleAccount(publicRequest("/api/account", { action: "create", adult: true, expectedRevision: 0 }), env, { config, session });
  assert.equal(first.status, 201);
  assert.match([...buckets.keys()][0], /^account:v1:[a-f\d]{64}$/);
  assert.equal(forwarded[0].headers.get("Cookie"), null); assert.equal(forwarded[0].headers.get("Cf-Access-Jwt-Assertion"), null);
  assert.equal(forwarded[0].url, "https://accounts.internal/api/account");
  const betaConfig = { ...config, origin: BETA, audience: "b".repeat(64) };
  assert.equal(await accountIdentity(config, session), await accountIdentity(betaConfig, session));
  const beta = await handleAccount(publicRequest("/api/account", null, BETA), env, { config: betaConfig, session });
  assert.equal((await beta.json()).registered, true, "App and beta share the verified reader account.");
  const other = await handleAccount(publicRequest("/api/account"), env, { config, session: { ...session, subject: "another-subject" } });
  assert.equal((await other.json()).registered, false);
  const count = forwarded.length;
  for (const context of [{ config, session: null }, { config, session: { ...session, expiresAt: Date.now() - 1 } }, { config: { ...config, origin: "https://example.invalid" }, session }]) {
    assert.equal((await handleAccount(publicRequest("/api/account"), env, context)).status, 403);
  }
  assert.equal((await handleAccount(publicRequest("/api/account", {}, ORIGIN, { "Sec-Fetch-Site": "same-site" }), env, { config, session })).status, 403);
  assert.equal(forwarded.length, count);
  assert.equal((await handleAccount(publicRequest("/api/account"), {}, { config, session })).status, 503);
  const expiresDuringRead = { ...session };
  const delayed = { READER_ACCOUNTS: { idFromName: name => name, get: () => ({ async fetch() {
    expiresDuringRead.expiresAt = Date.now() - 1;
    return Response.json({ privateAccount: "synthetic" });
  } }) } };
  const denied = await handleAccount(publicRequest("/api/account"), delayed, { config, session: expiresDuringRead });
  assert.equal(denied.status, 403); assert.equal((await denied.text()).includes("privateAccount"), false);
});

test("cloud story routes require a verified app email account and reject stale cross-account writes", async () => {
  const buckets = new Map();
  let publicRequest, forwarded;
  const config = { origin: ORIGIN, issuer: ORIGIN };
  const emailSession = character => ({ authMode: "email", subject: `email-v1:${character.repeat(64)}`, expiresAt: Date.now() + 60000 });
  const firstSession = emailSession("a"), secondSession = emailSession("b");
  const env = { READER_ACCOUNTS: { idFromName: name => name, get(name) {
    if (!buckets.has(name)) buckets.set(name, fixture().service);
    return { fetch(request) {
      forwarded = { bodyUsed: publicRequest?.bodyUsed, headers: request.headers };
      return buckets.get(name).fetch(request);
    } };
  } } };
  const library = "/api/account/library";
  const call = (session, body, headers = {}) => {
    publicRequest = new Request(ORIGIN + library, {
      method: body === undefined ? "GET" : "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return handleAccount(publicRequest, env, { config, session });
  };
  assert.equal((await call(null)).status, 403);
  const accessSession = { expiresAt: firstSession.expiresAt, subject: "synthetic-founder" };
  const forged = await handleAccount(new Request(ORIGIN + library, { headers: { "X-SatinLore-Account-Mode": "email" } }), env,
    { config: { origin: ORIGIN, issuer: "https://synthetic.cloudflareaccess.com" }, session: accessSession });
  assert.equal(forged.status, 403);
  assert.equal(await ensureEmailAccount(env, config, firstSession, Date.now()), true);
  assert.equal(await ensureEmailAccount(env, config, secondSession, Date.now()), true);
  const first = await (await call(firstSession)).json(), second = await (await call(secondSession)).json();
  assert.notEqual(first.owner, second.owner);
  assert.deepEqual(first.stories, []); assert.equal(first.revision, 0);
  assert.equal((await call(firstSession, undefined, { "Sec-Fetch-Site": "same-site" })).status, 403);
  const mutation = { action: "saveStory", expectedOwner: first.owner, expectedRevision: 0,
    story: { id: STORY, title: "Synthetic workspace", text: "Two readers stopped at the library.", corrections: [0], position: 0, analysisVersion: "fixture" } };
  assert.equal((await call(secondSession, mutation)).status, 409, "A cookie changed in another tab cannot retarget a pending save.");
  assert.equal((await call(firstSession, { ...mutation, story: { ...mutation.story, ceiling: 10 } })).status, 400);
  const saved = await call(firstSession, mutation, { Cookie: "private=fixture", "X-SatinLore-Account-Expires-At": "1" });
  assert.equal(saved.status, 200);
  assert.equal(forwarded.bodyUsed, false, "The Worker must stream the body to the bounded DO parser without reading it.");
  assert.equal(forwarded.headers.get("Cookie"), null);
  assert.equal(forwarded.headers.get("X-SatinLore-Account-Expires-At"), String(firstSession.expiresAt));
  assert.equal(saved.headers.get("Cache-Control"), "no-store");
  assert.equal(saved.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.equal((await call(firstSession, { ...mutation, story: { ...mutation.story, text: "X".repeat(1_950_000) } })).status, 413,
    "The durable parser must enforce the body limit even without a length header.");
  assert.equal((await (await call(firstSession)).json()).stories[0].text, mutation.story.text);
  assert.deepEqual((await (await call(secondSession)).json()).stories, []);
  const beta = await handleAccount(new Request(BETA + library), env, { config: { ...config, origin: BETA }, session: firstSession });
  assert.equal(beta.status, 403);
});
