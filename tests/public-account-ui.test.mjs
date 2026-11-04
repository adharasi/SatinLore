import assert from "node:assert/strict";
import test from "node:test";
import {requestAccount} from "../app/static/reader/public-account.mjs";
import {workspace} from "./helpers/workspace.mjs";

test("email requests carry only the form fields and handle a rate-limited response", async () => {
  const data = {challenge: "synthetic-challenge", code: "123456", adult: true};
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

test("a guest can simulate, select Nocturne, verify their email and sign out without losing the story", async t => {
  let signedIn = false;
  const calls = [];
  const app = workspace({publicAuth: true, authRequest: async (action, body) => {
    calls.push({action, body});
    if (action === "request") return {challenge: "synthetic-challenge", expiresIn: 600, resendAfter: 60};
    if (action === "verify" && body.code === "000000") throw Object.assign(Error("The code didn’t match."), {retryAfter: 0});
    signedIn = action === "verify";
    return {authenticated: signedIn, expiresAt: signedIn ? app.now() + 600000 : null};
  }});
  t.after(() => app.destroy());
  app.access(async () => Response.json({authenticated: signedIn, expiresAt: signedIn ? app.now() + 600000 : null}));
  await app.settle();
  const node = id => app.nodes.get(id);
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
  node("public-email").value = "test@example.invalid";
  await node("public-email-form").dispatch("submit");
  assert.equal(calls.length, 0, "Age confirmation is required before requesting a code.");
  node("public-adult").checked = true;
  await node("public-email-form").dispatch("submit");
  assert.equal(node("public-code-form").hidden, false);
  assert.equal(node("public-resend-code").disabled, true);
  await app.visibility(true);
  assert.equal(node("public-account-dialog").open, true, "The dialog remains open while checking an inbox in another tab.");
  await app.visibility(false);

  node("public-code").value = "000000";
  await node("public-code-form").dispatch("submit");
  assert.match(node("public-account-status").textContent, /didn’t match/);
  node("public-code").value = "123456";
  await node("public-code-form").dispatch("submit");
  await app.settle();
  assert.deepEqual(calls.at(-1), {action: "verify", body: {challenge: "synthetic-challenge", code: "123456", adult: true}});
  assert.equal(node("public-account-dialog").open, false);
  assert.equal(node("public-account-label").textContent, "Account");
  assert.equal(node("public-code").value, "");
  assert.equal(node("public-email").value, "");
  assert.equal(node("nocturne-run").hidden, false);
  assert.equal(app.read("hasVerifiedAccess()"), true);

  await app.click("public-account");
  await app.click("public-sign-out");
  assert.deepEqual(calls.at(-1), {action: "logout", body: {}});
  assert.equal(node("public-account-label").textContent, "Sign in");
  assert.equal(app.read("hasVerifiedAccess()"), false);
  assert.equal(app.read("currentStory().title"), "Synthetic story");
  assert.equal(app.read("canStartHere()"), true);
  assert.deepEqual(app.errors, []);
});
