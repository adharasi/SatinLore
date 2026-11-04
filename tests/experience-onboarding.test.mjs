import assert from "node:assert/strict";
import test from "node:test";
import {workspace} from "./helpers/workspace.mjs";
import {DEFAULT_EXPERIENCE} from "../app/static/reader/experience-preferences.mjs";

test("first account sign-in asks for preferences and applies only an acknowledged save", async t => {
  let signedIn = false, rejectSave = true, stored = null;
  const owner = "00000000-0000-4000-8000-000000000001";
  const app = workspace({publicAuth: true,
    authRequest: async action => {
      signedIn = action === "login";
      return {authenticated: signedIn, expiresAt: signedIn ? app.now() + 60_000 : null};
    },
    libraryRequest: async (_path, options) => {
      if (options.method === "GET") return Response.json({owner, revision: 0, stories: [], preferences: stored});
      const body = JSON.parse(options.body);
      assert.equal(body.action, "savePreferences");
      assert.equal(body.expectedOwner, owner);
      assert.equal(body.expectedRevision, stored?.revision ?? null);
      if (rejectSave) return Response.json({error: "Could not save."}, {status: 503});
      stored = {...body.preferences, revision: (stored?.revision ?? 0) + 1};
      return Response.json({preferences: stored});
    },
  });
  t.after(() => app.destroy());
  const node = id => app.nodes.get(id);
  app.access(async () => Response.json({authenticated: signedIn, expiresAt: signedIn ? app.now() + 60_000 : null}));
  await app.settle();
  await app.click("public-account");
  node("public-email").value = "onboarding@example.invalid";
  node("public-password").value = "sample onboarding passphrase";
  await node("public-login-form").dispatch("submit");
  assert.equal(node("experience-dialog").open, true);
  assert.match(node("experience-intro").textContent, /saved to your account/);
  node("experience-quiet").value = "edging";
  node("experience-edging").value = "yes";
  node("experience-maximum").value = "16";
  node("experience-rhythm").value = "gentle";
  await node("experience-form").dispatch("submit");
  assert.equal(node("experience-dialog").open, true);
  assert.match(node("experience-status").textContent, /not saved/i);
  assert.equal(app.read("currentExperience().maximum"), 10);
  assert.equal(stored, null);

  rejectSave = false;
  await node("experience-form").dispatch("submit");
  assert.equal(node("experience-dialog").open, false);
  assert.deepEqual(stored.experience, {quiet: "edging", edging: true, maximum: 16, rhythm: "gentle", peakPattern: "auto"});
  assert.equal(app.read("currentExperience().maximum"), 16);
  assert.equal(app.read("latest.ceiling"), 16);
  assert.equal(app.read("latest.running"), false);

  await app.click("open-app-settings");
  await app.click("open-experience");
  assert.equal(node("experience-maximum").value, "16");
  assert.equal(node("experience-reset").hidden, false);
  await app.click("experience-reset");
  assert.equal(stored.experience.maximum, 16, "Reset previews defaults until the reader saves.");
  await node("experience-form").dispatch("submit");
  assert.deepEqual(stored.experience, DEFAULT_EXPERIENCE);
  assert.equal(app.read("latest.ceiling"), 10);
  assert.deepEqual(app.errors, []);
});

test("private or local readers can edit session-only preferences without cloud storage", async t => {
  const app = workspace();
  t.after(() => app.destroy());
  await app.settle();
  await app.click("open-app-settings");
  await app.click("open-experience");
  assert.match(app.nodes.get("experience-intro").textContent, /this visit/);
  app.nodes.get("experience-maximum").value = "4";
  await app.nodes.get("experience-form").dispatch("submit");
  assert.equal(app.read("currentExperience().maximum"), 4);
  assert.equal(app.read("latest.ceiling"), 4);
  assert.equal(app.preferenceValues.size, 0);
  await app.click("app-settings-close");
  await app.add();
  await app.click("connect");
  await app.click("open-app-settings");
  await app.click("open-experience");
  assert.equal(app.nodes.get("experience-stop").hidden, false);
  await app.click("experience-stop");
  assert.equal(app.nodes.get("experience-dialog").open, false);
  assert.equal(app.read("latest.output"), 0);
});
