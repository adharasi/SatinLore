import assert from "node:assert/strict";
import test from "node:test";
import {workspace} from "./helpers/workspace.mjs";
import {DEFAULT_EXPERIENCE, validateExperience} from "../app/static/reader/experience-preferences.mjs";

test("a fresh reader gets continuous scene rhythms and steady peaks without saving, connecting or starting", async t => {
  const app = workspace();
  t.after(() => app.destroy());
  await app.settle();
  assert.deepEqual(validateExperience(DEFAULT_EXPERIENCE), {
    quiet: "continuous", edging: false, maximum: 10, rhythm: "scene", peakPattern: "steady",
  });
  assert.equal(app.read("currentExperience().quiet"), "continuous");
  assert.equal(app.read("patternChoices.peakPattern"), "steady");
  assert.equal(app.read("latest.feel.mode"), "continuous");
  assert.equal(app.read("latest.feel.rhythm"), "scene");
  assert.equal(app.read("latest.ceiling"), 10);
  assert.equal(app.read("latest.connected"), false);
  assert.equal(app.read("latest.running"), false);
  assert.equal(app.preferenceValues.size, 0);
  assert.deepEqual(app.errors, []);
});

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
  assert.deepEqual(stored.experience, {...DEFAULT_EXPERIENCE, quiet: "edging", edging: true, maximum: 16, rhythm: "gentle"});
  assert.equal(app.read("currentExperience().maximum"), 16);
  assert.equal(app.read("latest.ceiling"), 16);
  assert.equal(app.read("latest.running"), false);

  await app.click("open-app-settings");
  await app.click("preview-experience");
  assert.equal(node("experience-dialog").open, true);
  assert.equal(node("experience-preview-note").hidden, false);
  assert.equal(node("experience-maximum").value, "10", "The preview starts with first-time defaults.");
  node("experience-maximum").value = "20";
  await node("experience-form").dispatch("submit");
  assert.match(node("experience-heading").textContent, /preview complete/i);
  assert.equal(stored.revision, 1);
  assert.equal(app.read("currentExperience().maximum"), 16);
  assert.equal(app.read("latest.ceiling"), 16);
  await app.click("experience-later");
  assert.equal(node("experience-dialog").open, false);
  assert.equal(node("app-settings-dialog").open, true);
  await app.click("open-experience");
  assert.equal(node("experience-preview-note").hidden, true);
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

for (const saved of [
  {name: "steady pattern", experience: {...DEFAULT_EXPERIENCE, peakPattern: "steady"}},
  {name: "legacy off and automatic choices", experience: {quiet: "off", edging: false, maximum: 10, rhythm: "scene", peakPattern: "auto"}},
]) test(`editing restored device preferences preserves ${saved.name} and stays paused`, async t => {
  let signedIn = false;
  const owner = "00000000-0000-4000-8000-000000000001";
  let stored = {appearance: "dark", width: "wide", fontSize: "normal", spacing: "normal", follow: true,
    experience: {...saved.experience}, revision: 4};
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
      assert.equal(body.expectedRevision, stored.revision);
      stored = {...body.preferences, revision: stored.revision + 1};
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
  await app.settle();
  assert.equal(node("experience-dialog").open, false, "Valid saved choices need no first-time prompt.");
  assert.equal(app.read("currentExperience().peakPattern"), saved.experience.peakPattern);
  assert.equal(app.read("currentExperience().quiet"), saved.experience.quiet);
  assert.equal(app.read("latest.feel.mode"), saved.experience.quiet === "off" ? "story" : "continuous");
  assert.equal(app.read("latest.feel.rhythm"), saved.experience.rhythm);
  await app.click("open-app-settings");
  await app.click("open-experience");
  node("experience-maximum").value = "12";
  await node("experience-form").dispatch("submit");
  assert.equal(stored.revision, 5);
  assert.equal(stored.experience.maximum, 12);
  assert.equal(stored.experience.peakPattern, saved.experience.peakPattern, "Changing another preference retains the independent pattern choice.");
  assert.equal(stored.experience.quiet, saved.experience.quiet);
  assert.equal(stored.experience.rhythm, saved.experience.rhythm);
  assert.equal(app.read("currentExperience().peakPattern"), saved.experience.peakPattern);
  assert.equal(app.read("latest.ceiling"), 12);
  assert.equal(app.read("latest.running"), false);
  assert.deepEqual(app.errors, []);
});
