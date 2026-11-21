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

for (const basePath of ["", "/beta"]) test(`a billing signup returns the verified reader to its ${basePath ? "beta" : "production"} referral`, async t => {
  let signedIn = false;
  const destinations = [], accountRequests = [];
  const location = {search: "?signin=1&mode=register&ref=FIXTURE&next=billing", assign: path => destinations.push(path)};
  const app = workspace({publicAuth: true, launchBilling: true, basePath, location, browserFetch: async (path, options) => {
    if (!path.startsWith(`${basePath}/api/auth/`)) return Response.json({error: "Fixture route unavailable."}, {status: 404});
    accountRequests.push(path);
    const action = path.split("/").at(-1), body = JSON.parse(options.body);
    if (action === "register") return Response.json({challenge: "new-account", resendAfter: 60});
    if (action === "verify") {
      assert.deepEqual(body, {challenge: "new-account", code: "123456"});
      return Response.json({verified: true});
    }
    assert.equal(action, "login");
    assert.equal(body.email, address);
    signedIn = true;
    return Response.json({authenticated: true, expiresAt: app.now() + 600000});
  }});
  t.after(() => app.destroy());
  app.access(async () => Response.json({authenticated: signedIn, expiresAt: signedIn ? app.now() + 600000 : null}));
  await app.settle();
  const node = id => app.nodes.get(id);
  assert.equal(node("public-account-dialog").open, true);
  assert.equal(node("public-login-form").hidden, true);
  assert.equal(node("public-register-form").hidden, false);
  assert.equal(app.document.activeElement, node("public-register-email"));
  node("public-register-email").value = address;
  node("public-register-password").value = originalPassword;
  node("public-adult").checked = true;
  await node("public-register-form").dispatch("submit");
  node("public-code").value = "123456";
  await node("public-code-form").dispatch("submit");
  assert.equal(node("public-login-form").hidden, false);
  assert.deepEqual(destinations, []);
  node("public-password").value = originalPassword;
  await node("public-login-form").dispatch("submit");
  assert.deepEqual(accountRequests, ["register", "verify", "login"].map(action => `${basePath}/api/auth/${action}`));
  assert.deepEqual(destinations, [`${basePath}/billing?ref=FIXTURE`]);
  assert.deepEqual(node("reader-support-links").children.map(link => link.href), basePath ? ["/beta/simulator"] : []);
});

test("guest reading, email verification and password sign-in preserve the reader", async t => {
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
  assert.match(node("message").textContent, /Sign in to connect your toy/);
  assert.doesNotMatch(node("message").textContent, /expired|simulat/i);
  await app.add();
  assert.equal(app.read("currentStory().title"), "Synthetic story");
  assert.equal(app.read("latest.mode"), "lovense");
  assert.equal(app.read("controller.sim"), undefined);
  assert.equal(node("transport").getAttribute("aria-label"), "Toy playback controls");
  assert.equal(node("connect").getAttribute("aria-label"), "Pair your toy");
  assert.equal(node("empty-practice").hidden, true);
  assert.equal(node("start").disabled, true);
  await assert.rejects(app.read('controller.beginConnection({mode: "simulator"})'), /supported toy and connection/);

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
  assert.equal(node("experience-dialog").open, true);
  await app.click("experience-later");
  assert.equal(node("experience-dialog").open, false);

  await app.click("public-account");
  await app.click("public-sign-out");
  assert.deepEqual(calls.at(-1), {action: "logout", body: {}});
  assert.equal(node("public-account-label").textContent, "Sign in");
  assert.equal(app.read("hasVerifiedAccess()"), false);
  assert.equal(app.read("currentStory().title"), "Synthetic story");
  assert.equal(app.read("canStartHere()"), false);
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
  assert.equal(node("experience-dialog").open, false, "Deferring the choices does not prompt again in the same reader visit.");
  assert.deepEqual(app.errors, []);
});

test("the hosted launch fallback is physical-only and the scoped beta can only play privately", async t => {
  const live = workspace({hosted: true, readerMode: "live"});
  const beta = workspace({hosted: true, readerMode: "beta"});
  t.after(() => { live.destroy(); beta.destroy(); });
  await Promise.all([live.settle(), beta.settle()]);
  assert.equal(live.read("latest.mode"), "lovense");
  assert.equal(live.read("controller.sim"), undefined);
  assert.equal(live.nodes.get("empty-practice").hidden, true);
  assert.equal(beta.read("latest.mode"), "simulator");
  assert.equal(beta.nodes.get("empty-practice").hidden, false);
  assert.match(beta.nodes.get("message").textContent, /Choose Simulator/);
  assert.doesNotMatch(beta.nodes.get("message").textContent, /connect a toy/);
  await beta.click("empty-practice");
  assert.equal(beta.nodes.get("practice-story-dialog").open, true);
  await beta.click("practice-story-close");
  assert.equal(beta.read("hostedAnalysis"), false);
  await assert.rejects(beta.read('controller.beginConnection({mode: "lovense"})'), /supported toy and connection/);
  beta.read('localStorageAdapter.setItem("example", "only in beta")');
  assert.equal(beta.preferenceValues.get("beta.example"), "only in beta");
  assert.equal(beta.preferenceValues.has("example"), false);
  await beta.add();
  await beta.click("connect");
  await beta.click("start");
  await beta.click("confirm-start");
  await beta.settle();
  assert.equal(beta.read("latest.running"), true);
  await beta.click("stop");
  assert.equal(beta.read("latest.running"), false);
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

test("signed-in password changes and all-device sign-out return the reader to a guest session", async t => {
  let signedIn = true, credential = originalPassword;
  const calls = [];
  const app = workspace({publicAuth: true, authRequest: async (action, body) => {
    calls.push({action, body});
    if (action === "change-password") {
      if (body.currentPassword !== credential) throw error("The current password did not match.");
      credential = body.password;
      signedIn = false;
      return {changed: true};
    }
    if (action === "login" && body.password !== credential) throw error("The email or password is incorrect.");
    signedIn = action === "login";
    return {authenticated: signedIn, expiresAt: signedIn ? app.now() + 600000 : null};
  }});
  t.after(() => app.destroy());
  app.access(async () => Response.json({authenticated: signedIn, expiresAt: signedIn ? app.now() + 600000 : null}));
  await app.settle();
  await app.read("hostedAccess.check({fresh: true})");
  const node = id => app.nodes.get(id);
  const current = node("public-current-password"), next = node("public-new-password");
  const form = node("public-change-password-form"), status = node("public-account-status");
  const session = node("public-account-session");

  await app.click("public-account");
  assert.equal(session.hidden, false);
  assert.equal(form.hidden, true);
  assert.equal(node("public-billing-link").hidden, true);
  await app.click("public-show-change-password");
  assert.equal(session.hidden, true);
  assert.equal(form.hidden, false);
  current.value = next.value = originalPassword;
  await form.dispatch("submit");
  assert.match(status.textContent, /different from your current password/);
  assert.equal(calls.length, 0);
  await app.click("public-change-password-back");
  assert.equal(session.hidden, false);
  assert.equal(form.hidden, true);
  assert.equal(current.value, "");
  assert.equal(next.value, "");

  await app.click("public-show-change-password");
  current.value = "an incorrect synthetic password";
  next.value = replacementPassword;
  await form.dispatch("submit");
  assert.match(status.textContent, /current password did not match/);
  assert.equal(form.hidden, false);
  assert.equal(app.read("hasVerifiedAccess()"), true);
  current.value = originalPassword;
  await form.dispatch("submit");
  assert.deepEqual(calls.at(-1), {action: "change-password", body: {currentPassword: originalPassword, password: replacementPassword}});
  assert.equal(current.value, "");
  assert.equal(next.value, "");
  assert.equal(session.hidden, true);
  assert.equal(form.hidden, true);
  assert.equal(node("public-login-form").hidden, false);
  assert.match(status.textContent, /Sign in with your new password/);
  assert.equal(app.read("hasVerifiedAccess()"), false);

  node("public-email").value = address;
  node("public-password").value = replacementPassword;
  await node("public-login-form").dispatch("submit");
  await app.settle();
  assert.equal(app.read("hasVerifiedAccess()"), true);
  if (node("experience-dialog").open) await app.click("experience-later");
  await app.click("public-account");
  await app.click("public-sign-out-all");
  assert.deepEqual(calls.at(-1), {action: "logout-all", body: {}});
  assert.equal(app.read("hasVerifiedAccess()"), false);
  assert.match(status.textContent, /signed out on all devices/);
  assert.deepEqual(app.errors, []);
});
