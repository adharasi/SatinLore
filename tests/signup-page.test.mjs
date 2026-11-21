import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {mountSignupPage} from "../app/static/signup.mjs";
import {signupPath} from "../app/static/reader/public-account.mjs";

const page = readFileSync(new URL("../app/static/signup.html", import.meta.url), "utf8");
const address = "reader@example.invalid", passphrase = "river lantern paper clock";
const order = "12345678-1234-1234-1234-123456789012";

function fixture({base = "/beta", billing = true, search = "", signedIn = false} = {}) {
  const nodes = new Map(), calls = [], destinations = [], writes = [], timers = new Map();
  let active, timerId = 0, session = signedIn;
  for (const [, id] of page.matchAll(/\bid="([^"]+)"/gu)) {
    const listeners = new Map();
    nodes.set(id, {value: "", checked: false, textContent: id, hidden: false, disabled: false,
      focus: () => { active = id; }, toggleAttribute() {},
      addEventListener: (type, listener) => listeners.set(type, listener),
      dispatch: type => listeners.get(type)({preventDefault() {}})});
  }
  const node = id => nodes.get(`public-${id}`);
  const document = {getElementById: id => nodes.get(id), querySelector: selector => {
    if (base && selector.includes("satinlore-base-path")) return {content: base};
    if (billing && selector.includes("satinlore-launch-usage")) return {content: "enabled"};
    return null;
  }};
  const window = {location: {search, replace: path => destinations.push(path)}, crypto: {randomUUID: () => "session-event"},
    localStorage: {setItem: (...args) => writes.push(args)}};
  mountSignupPage({document, window, fetchSession: async () => Response.json({authenticated: session, expiresAt: Date.now() + 60_000}),
    setTimer: callback => { timers.set(++timerId, callback); return timerId; }, clearTimer: id => timers.delete(id),
    request: async (action, body) => {
      calls.push({action, body});
      if (action === "register") return {challenge: "initial", resendAfter: 60};
      if (action === "resend") return {challenge: "replacement", resendAfter: 60};
      if (action === "verify") {
        if (body.code === "000000") throw Object.assign(Error("The code didn’t match."), {retryAfter: 0});
        return {verified: true};
      }
      assert.equal(action, "login");
      session = true;
      return {authenticated: true, expiresAt: Date.now() + 60_000};
    }});
  return {node, calls, destinations, writes, nodes, timers, active: () => active};
}

test("beta registration keeps the reader out of view and verifies the address before sign-in", async () => {
  const {node, calls, destinations, writes, nodes, timers, active} = fixture({search: `?ref=fixture&order=${order}&next=billing`});
  assert.doesNotMatch(page, /<dialog|app\.mjs|id="reader"/u);
  assert.equal(node("register-form").hidden, false);
  assert.equal(node("code-form").hidden, true);
  assert.equal(nodes.get("signup-sign-in").href, `/beta/login?ref=FIXTURE&order=${order}&next=billing`);
  node("register-email").value = address;
  node("register-password").value = passphrase;
  await node("register-form").dispatch("submit");
  assert.deepEqual(calls, []);
  node("adult").checked = true;
  node("register-password").value = "short";
  await node("register-form").dispatch("submit");
  assert.match(node("account-status").textContent, /15 to 128/);
  assert.deepEqual(calls, []);
  node("register-password").value = passphrase;
  await node("register-form").dispatch("submit");
  assert.deepEqual(calls.at(-1), {action: "register", body: {email: address, password: passphrase, adult: true}});
  assert.equal(node("register-password").value, "");
  assert.equal(node("register-form").hidden, true);
  assert.equal(node("code-form").hidden, false);
  assert.equal(active(), "public-code");
  assert.equal(node("resend-code").disabled, true);
  await node("resend-code").dispatch("click");
  assert.equal(calls.length, 1);
  timers.values().next().value();
  await node("resend-code").dispatch("click");
  assert.deepEqual(calls.at(-1), {action: "resend", body: {challenge: "initial", email: address}});
  node("code").value = "000000";
  await node("code-form").dispatch("submit");
  assert.match(node("account-status").textContent, /didn’t match/);
  node("code").value = "123456";
  await node("code-form").dispatch("submit");
  assert.deepEqual(calls.at(-1), {action: "verify", body: {challenge: "replacement", code: "123456"}});
  assert.equal(node("code").value, "");
  assert.equal(node("login-form").hidden, false);
  assert.equal(node("email").value, address);
  assert.deepEqual(destinations, []);
  assert.deepEqual(writes, []);
  node("password").value = passphrase;
  await node("login-form").dispatch("submit");
  assert.deepEqual(calls.at(-1), {action: "login", body: {email: address, password: passphrase, remember: false}});
  assert.equal(node("password").value, "");
  assert.deepEqual(destinations, [`/beta/billing?ref=FIXTURE&order=${order}`]);
  assert.deepEqual(writes, [["preview.satinlore.public-session-change", "session-event"]]);
});

test("already signed-in visitors only continue to known locations in the current environment", async () => {
  assert.equal(signupPath(`?ref=tester&order=${order}&next=//example.invalid`), `/signup?ref=TESTER&order=${order}&next=billing`);
  assert.equal(signupPath("?ref=ßß&order=bad&next=//example.invalid"), "/signup");
  assert.equal(signupPath("?next=billing"), "/signup?next=billing");
  assert.equal(signupPath("?sign-in=feedback"), "/signup?next=feedback");
  const beta = fixture({signedIn: true, billing: false, search: "?next=billing&ref=tester"});
  const live = fixture({signedIn: true, base: "", search: "?next=//example.invalid"});
  const feedback = fixture({signedIn: true, search: "?next=feedback"});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(beta.destinations, ["/beta/"]);
  assert.deepEqual(live.destinations, ["/"]);
  assert.equal(feedback.nodes.get("signup-sign-in").href, "/beta/?sign-in=feedback");
  assert.deepEqual(feedback.destinations, ["/beta/support"]);
});
