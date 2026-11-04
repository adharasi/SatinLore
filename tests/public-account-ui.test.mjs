import assert from "node:assert/strict";
import test from "node:test";
import {requestAccount} from "../app/static/reader/public-account.mjs";
import {workspace} from "./helpers/workspace.mjs";

const address = "test@example.invalid";
const originalPassword = "river lantern paper clock";
const replacementPassword = "mint rooftop window tile";
const error = message => Object.assign(Error(message), {retryAfter: 0});

test("auth requests are same-origin and carry only the form fields", async () => {
  const data = {challenge: "synthetic-challenge", code: "123456"};
  await assert.rejects(requestAccount("verify", data, async (path, options) => {
    assert.equal(path, "/api/auth/verify");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), data);
    return Response.json({error: "Wait before trying again."}, {status: 429, headers: {"Retry-After": "60"}});
  }), {message: "Wait before trying again.", retryAfter: 60});
});

test("guest simulation, email verification and password sign-in preserve the reader", async t => {
  let signedIn = false, currentPassword = "";
  const calls = [];
  const app = workspace({publicAuth: true, authRequest: async (action, body) => {
    calls.push({action, body});
    if (action === "register") return {challenge: "register", expiresIn: 600, resendAfter: 60};
    if (action === "resend") return {challenge: "replacement-code", expiresIn: 600, resendAfter: 60};
    if (action === "verify") {
      if (body.code === "000000") throw error("The code didn’t match.");
      currentPassword = originalPassword;
      return {verified: true};
    }
    if (action === "forgot") return {challenge: "recover", expiresIn: 600, resendAfter: 60};
    if (action === "reset") { currentPassword = body.password; return {reset: true}; }
    if (action === "login" && body.password !== currentPassword) throw error("The email or password is incorrect.");
    signedIn = action === "login";
    return {authenticated: signedIn, expiresAt: signedIn ? app.now() + 600000 : null};
  }});
  t.after(() => app.destroy());
  app.access(async () => Response.json({authenticated: signedIn, expiresAt: signedIn ? app.now() + 600000 : null}));
  await app.settle();
  const node = id => app.nodes.get(id);
  const submit = id => node(id).dispatch("submit");
  assert.equal(node("public-account").hidden, false);
  assert.equal(node("public-account-dialog").open, false);
  assert.equal(app.read("hasVerifiedAccess()"), false);
  assert.equal(app.read("controller.authorized"), false);
  await app.add();
  await app.click("connect");
  const guestChecks = app.accessCalls();
  await app.click("start");
  await app.click("confirm-start");
  await app.settle();
  assert.equal(app.read("latest.running"), true);
  assert.equal(app.accessCalls(), guestChecks);
  await app.click("stop");

  const model = node("scene-model");
  assert.equal(model.disabled, false);
  model.value = "nocturne";
  await model.dispatch("change");
  assert.equal(node("nocturne-run").hidden, true);
  await app.click("nocturne-sign-in");
  assert.equal(node("public-account-dialog").open, true);
  await app.click("public-show-register");
  node("public-register-email").value = address;
  node("public-register-password").value = originalPassword;
  await submit("public-register-form");
  assert.equal(calls.length, 0, "Age confirmation is required before registering.");
  node("public-adult").checked = true;
  node("public-register-password").value = "too short";
  await submit("public-register-form");
  assert.match(node("public-account-status").textContent, /15 to 128/);
  assert.equal(calls.length, 0);
  node("public-register-password").value = originalPassword;
  await submit("public-register-form");
  assert.deepEqual(calls.at(-1), {action: "register", body: {email: address, password: originalPassword, adult: true}});
  assert.equal(node("public-code-form").hidden, false);
  assert.equal(node("public-register-password").value, "");
  assert.equal(node("public-resend-code").disabled, true);
  await app.visibility(true);
  assert.equal(node("public-account-dialog").open, true, "The dialog stays open while checking email in another tab.");
  await app.visibility(false);
  await app.advance(60000);
  await app.click("public-resend-code");
  assert.deepEqual(calls.at(-1), {action: "resend", body: {challenge: "register", email: address}});

  node("public-code").value = "000000";
  await submit("public-code-form");
  assert.match(node("public-account-status").textContent, /didn’t match/);
  node("public-code").value = "123456";
  await submit("public-code-form");
  assert.deepEqual(calls.at(-1), {action: "verify", body: {challenge: "replacement-code", code: "123456"}});
  assert.equal(node("public-login-form").hidden, false);
  assert.equal(node("public-email").value, address);
  assert.equal(app.read("hasVerifiedAccess()"), false, "Email verification must not sign in.");
  node("public-password").value = originalPassword;
  node("public-remember").checked = true;
  await submit("public-login-form");
  await app.settle();
  assert.deepEqual(calls.at(-1), {action: "login", body: {email: address, password: originalPassword, remember: true}});
  assert.equal(node("public-account-dialog").open, false);
  assert.equal(node("public-account-label").textContent, "Account");
  assert.equal(node("public-code").value, "");
  assert.equal(node("public-email").value, "");
  assert.equal(node("public-password").value, "");
  assert.equal(node("nocturne-run").hidden, false);
  assert.equal(app.read("hasVerifiedAccess()"), true);

  await app.click("public-account");
  await app.click("public-sign-out");
  assert.deepEqual(calls.at(-1), {action: "logout", body: {}});
  assert.equal(node("public-account-label").textContent, "Sign in");
  assert.equal(app.read("hasVerifiedAccess()"), false);
  assert.equal(app.read("currentStory().title"), "Synthetic story");
  assert.equal(app.read("canStartHere()"), true);
  assert.equal(node("public-remember").checked, false);

  await app.click("public-show-forgot");
  node("public-forgot-email").value = address;
  await submit("public-forgot-form");
  assert.deepEqual(calls.at(-1), {action: "forgot", body: {email: address}});
  assert.equal(node("public-reset-form").hidden, false);
  node("public-reset-code").value = "123456";
  node("public-reset-password").value = replacementPassword;
  await submit("public-reset-form");
  assert.deepEqual(calls.at(-1), {action: "reset", body: {challenge: "recover", code: "123456", password: replacementPassword}});
  assert.equal(node("public-reset-password").value, "");
  assert.equal(app.read("hasVerifiedAccess()"), false, "Resetting a password must not sign in.");
  node("public-password").value = originalPassword;
  await submit("public-login-form");
  assert.match(node("public-account-status").textContent, /incorrect/);
  node("public-password").value = replacementPassword;
  await submit("public-login-form");
  await app.settle();
  assert.equal(app.read("hasVerifiedAccess()"), true);
  assert.deepEqual(app.errors, []);
});

test("closing an account form clears the password and ignores an earlier response", async t => {
  let finish;
  const app = workspace({publicAuth: true, authRequest: () => new Promise(resolve => { finish = resolve; })});
  t.after(() => app.destroy());
  await app.settle();
  const node = id => app.nodes.get(id);
  await app.click("public-account");
  await app.click("public-show-register");
  node("public-register-email").value = address;
  node("public-register-password").value = originalPassword;
  node("public-adult").checked = true;
  const registration = node("public-register-form").dispatch("submit");
  await app.click("public-account-close");
  assert.equal(node("public-register-password").value, "");
  await app.click("public-account");
  finish({challenge: "old-challenge", expiresIn: 600, resendAfter: 60});
  await registration;
  assert.equal(node("public-login-form").hidden, false);
  assert.equal(node("public-code-form").hidden, true);
});
