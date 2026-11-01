import test from "node:test";
import assert from "node:assert/strict";
import {HostedAccessGuard} from "../app/static/access.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function clock() {
  let time = 1_000_000, id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) { timers.set(++id, {callback, at: time + delay}); return id; },
    clearTimer(value) { timers.delete(value); },
    async advance(delay) {
      const target = time + delay;
      while (true) {
        const next = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback();
        await Promise.resolve(); await Promise.resolve();
      }
      time = target;
      await Promise.resolve(); await Promise.resolve();
    },
    timers: () => timers.size,
  };
}
const response = expiresAt => Response.json({authenticated: true, expiresAt});
function harness(request) {
  const timer = clock(), changes = [], lost = [], calls = [];
  const guard = new HostedAccessGuard({now: timer.now, setTimer: timer.setTimer, clearTimer: timer.clearTimer,
    request: options => { calls.push(options); return request(options, timer.now()); },
    onChange: value => changes.push(value), onLost: value => lost.push(value)});
  return {guard, timer, changes, lost, calls};
}

test("hosted access starts blocked and uses only the same-origin no-cache access endpoint", async t => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({url, options}); return response(Date.now() + 10000); };
  t.after(() => { globalThis.fetch = original; });
  const guard = new HostedAccessGuard(); t.after(() => guard.destroy());
  assert.equal(guard.isAuthorized(), false); assert.equal(calls.length, 0);
  assert.equal(await guard.start(), true);
  assert.equal(guard.isAuthorized(), true);
  assert.equal(calls[0].url, "/api/access");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.body, undefined);
  assert.deepEqual(calls[0].options.headers, {"X-Requested-With": "XMLHttpRequest"});
});

test("access denial, redirects, invalid expiry and network failures block Start without leaking errors", async () => {
  const failures = [
    async () => new Response("", {status: 403}),
    async () => new Response("", {status: 503}),
    async () => ({ok: true, redirected: true, json: async () => ({authenticated: true, expiresAt: 999999999})}),
    async () => Response.json({authenticated: false, expiresAt: 999999999}),
    async () => Response.json({authenticated: true, expiresAt: "999999999"}),
    async () => Response.json({authenticated: true, expiresAt: 999999}),
    async () => { throw Error("private credential or story details must not escape"); },
  ];
  for (const request of failures) {
    const f = harness(request);
    assert.equal(await f.guard.start(), false);
    assert.equal(f.guard.isAuthorized(), false);
    assert.equal(f.lost.length, 1);
    assert.equal(f.lost[0], "Sign-in could not be checked. Playback is paused.");
    f.guard.destroy();
  }
});

test("the access check times out after eight seconds and fails closed", async () => {
  const f = harness(options => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("request aborted")), {once: true});
  }));
  const started = f.guard.start();
  await f.timer.advance(7999);
  assert.equal(f.lost.length, 0);
  await f.timer.advance(1);
  assert.equal(await started, false);
  assert.equal(f.guard.isAuthorized(), false);
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.lost.length, 1);
  f.guard.destroy();
});

test("a sixty-second refresh failure revokes access while a successful refresh never starts playback", async () => {
  let requests = 0;
  const f = harness(async (options, now) => ++requests === 1 ? response(now + 120000) : new Response("", {status: 403}));
  assert.equal(await f.guard.start(), true);
  await f.timer.advance(59999);
  assert.equal(requests, 1); assert.equal(f.guard.isAuthorized(), true);
  await f.timer.advance(1);
  await Promise.resolve();
  assert.equal(requests, 2); assert.equal(f.guard.isAuthorized(), false); assert.equal(f.lost.length, 1);
  f.guard.destroy();
});

test("expiry stops a session even while a refresh request is still pending", async () => {
  const pending = deferred(); let requests = 0;
  const f = harness(async (options, now) => ++requests === 1 ? response(now + 65000) : pending.promise);
  assert.equal(await f.guard.start(), true);
  await f.timer.advance(60000);
  assert.equal(requests, 2); assert.equal(f.guard.isAuthorized(), true);
  await f.timer.advance(5000);
  assert.equal(f.guard.isAuthorized(), false);
  assert.deepEqual(f.lost, ["Your sign-in has expired. Playback is paused."]);
  pending.resolve(response(f.timer.now() + 120000));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.guard.isAuthorized(), false, "A stale refresh cannot revive expired access.");
  f.guard.destroy();
});

test("hide cancels pending verification and returning needs a fresh successful check", async () => {
  const first = deferred(); let requests = 0;
  const f = harness(async (options, now) => ++requests === 1 ? first.promise : response(now + 120000));
  const started = f.guard.start();
  f.guard.suspend();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.guard.isAuthorized(), false);
  first.resolve(response(f.timer.now() + 120000));
  assert.equal(await started, false);
  assert.equal(f.guard.isAuthorized(), false);
  assert.equal(await f.guard.resume(), true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.guard.isAuthorized(), true);
  f.guard.destroy();
  assert.equal(f.timer.timers(), 0);
});

test("a page opened hidden does not send access requests until it becomes visible", async () => {
  const f = harness(async (options, now) => response(now + 120000));
  assert.equal(await f.guard.start({visible: false}), false);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.guard.resume(), true);
  assert.equal(f.calls.length, 1);
  f.guard.destroy();
});

test("a final Start check makes a fresh request and a new denial overrides cached access", async () => {
  let requests = 0;
  const f = harness(async (options, now) => ++requests === 1 ? response(now + 120000) : new Response("", {status: 403}));
  assert.equal(await f.guard.start(), true);
  assert.equal(f.guard.isAuthorized(), true);
  assert.equal(await f.guard.check({fresh: true}), false);
  assert.equal(requests, 2);
  assert.equal(f.guard.isAuthorized(), false);
  assert.equal(f.lost.length, 1);
  f.guard.destroy();
});

test("a fresh Start check cancels an older refresh and stale success cannot undo the denial", async () => {
  const pending = deferred(); let requests = 0;
  const f = harness(async (options, now) => {
    requests++;
    if (requests === 1) return response(now + 120000);
    if (requests === 2) return pending.promise;
    return new Response("", {status: 403});
  });
  assert.equal(await f.guard.start(), true);
  const older = f.guard.check();
  assert.equal(await f.guard.check({fresh: true}), false);
  assert.equal(f.calls[1].signal.aborted, true);
  pending.resolve(response(f.timer.now() + 120000));
  assert.equal(await older, false);
  assert.equal(f.guard.isAuthorized(), false);
  assert.equal(f.lost.length, 1);
  f.guard.destroy();
});

test("a synchronous access failure does not leave retries stuck on a completed pending promise", async () => {
  let requests = 0;
  const f = harness((options, now) => {
    if (++requests === 1) throw Error("Synthetic request failure");
    return Promise.resolve(response(now + 120000));
  });
  assert.equal(await f.guard.start(), false);
  assert.equal(f.guard.pending, null);
  assert.equal(await f.guard.check(), true);
  assert.equal(requests, 2);
  assert.equal(f.guard.isAuthorized(), true);
  f.guard.destroy();
});
