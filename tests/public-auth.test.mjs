import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createPrivateAppWorker } from "../deploy/cloudflare/worker.mjs";

const origin = "https://app.satinlore.com";
const beta = "https://beta.satinlore.com";
const sesUrl = "https://email.eu-north-1.amazonaws.com/v2/email/outbound-emails";
const analysisUrl = "https://api.openai.com/v1/responses";
const cues = [{ id: 2, phase: "peak", rhythm: "dynamic", previous: "sustain", next: "recover", movementCount: 2, shape: "accented" }];
const labels = [{ id: 2, label: "accents" }];
const password = "long synthetic original password";
const changedPassword = "long synthetic replacement password";
const root = fileURLToPath(new URL("../", import.meta.url));
const settings = {
  PRIVATE_APP_ENABLED: "true",
  PUBLIC_APP_ORIGIN: origin,
  PUBLIC_READER_ENABLED: "true",
  PUBLIC_READER_OTP_KEY: "1a".repeat(32),
  AUTH_SES_ACCESS_KEY_ID: "A".repeat(20),
  AUTH_SES_SECRET_ACCESS_KEY: "B".repeat(40),
  AUTH_SES_REGION: "eu-north-1",
  AUTH_SES_FROM_EMAIL: "team@example.test",
  AUTH_SES_SESSION_TOKEN: "syntheticsessiontoken01234",
  ACCESS_TEAM_DOMAIN: "synthetic.cloudflareaccess.com",
  ACCESS_AUD: "a".repeat(64),
  FOUNDER_EMAIL: "founder@example.test",
  OPENAI_API_KEY: "sk-proj-synthetic_credential_for_tests",
};
const hash = value => createHash("sha256").update(value).digest("hex");
const sign = (key, value) => createHmac("sha256", key).update(value).digest();

function verifySesSignature(headers, text) {
  const sent = headers.get("authorization");
  const date = headers.get("x-amz-date");
  assert.match(date, /^\d{8}T\d{6}Z$/);
  assert.equal(headers.get("x-amz-security-token"), settings.AUTH_SES_SESSION_TOKEN);
  const names = ["content-type", "host", "x-amz-content-sha256", "x-amz-date", "x-amz-security-token"];
  const headerText = names.map(name => name + ":" + (name === "host" ? new URL(sesUrl).host : headers.get(name)) + "\n").join("");
  const payloadHash = hash(text);
  assert.equal(headers.get("x-amz-content-sha256"), payloadHash);
  const canonical = ["POST", new URL(sesUrl).pathname, "", headerText, names.join(";"), payloadHash].join("\n");
  const shortDate = date.slice(0, 8);
  const scope = shortDate + "/eu-north-1/ses/aws4_request";
  const key = [shortDate, "eu-north-1", "ses", "aws4_request"].reduce(sign, "AWS4" + settings.AUTH_SES_SECRET_ACCESS_KEY);
  const signature = sign(key, ["AWS4-HMAC-SHA256", date, scope, hash(canonical)].join("\n")).toString("hex");
  assert.equal(sent, "AWS4-HMAC-SHA256 Credential=" + settings.AUTH_SES_ACCESS_KEY_ID + "/" + scope +
    ", SignedHeaders=" + names.join(";") + ", Signature=" + signature);
}

test("public email is opt-in and missing auth configuration fails closed", async () => {
  const worker = createPrivateAppWorker();
  const request = () => new Request(origin + "/");
  assert.equal((await worker.fetch(request(), { ...settings, PUBLIC_READER_ENABLED: "false" })).status, 403);
  assert.equal((await worker.fetch(request(), settings)).status, 503);
  assert.equal((await worker.fetch(new Request("https://other.example.test/"), settings)).status, 403);
});

test("password registration, verification, login and recovery run on SQLite with signed SES and isolated access", { timeout: 30_000 }, async t => {
  const compiled = await build({ stdin: { resolveDir: root, sourcefile: "public-auth-fixture.mjs", contents: `
    import worker, { PublicReaderAuth as Auth } from "./deploy/cloudflare/worker.mjs";
    import { ensureEmailAccount } from "./deploy/cloudflare/accounts.mjs";
    export { ReaderAccount, PrivateFeedback, SceneAnalysisBudget } from "./deploy/cloudflare/worker.mjs";
    export class PublicReaderAuth extends Auth {
      async fetch(request) {
        if (new URL(request.url).pathname === '/test/clock') {
          const { challenge } = await request.json();
          if (challenge) this.sql.exec('UPDATE password_challenges SET expires = ? WHERE id = ?', Date.now() - 1, challenge);
          this.sql.exec("DELETE FROM quota WHERE key LIKE 'resend:%'");
          return Response.json({ ok: true });
        }
        return super.fetch(request);
      }
    }
    export default { async fetch(request, env, ctx) {
      if (new URL(request.url).pathname === '/test/legacy') {
        const subject = (await request.json()).subject;
        const config = { issuer: 'https://app.satinlore.com', origin: 'https://app.satinlore.com', audience: 'satinlore-public-email-v1' };
        const ok = await ensureEmailAccount(env, config, { subject, authMode: 'email', expiresAt: Date.now() + 60000 }, Date.now());
        return Response.json({ ok });
      }
      const ASSETS = { fetch: async asset => new Response(asset.url.endsWith("/device-bridge.html") ?
        '<script id="lovense-isolated-bundle">void 0;</script>' : '<html><head></head><body>Reader</body></html>',
        { headers: { "content-type": "text/html", "ETag": "fixture" } }) };
      return worker.fetch(request, { ...env, ASSETS }, ctx);
    } };
  ` }, bundle: true, write: false, format: "esm", external: ["node:crypto"] });
  const outbound = [];
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "public-auth-fixture.mjs", contents: compiled.outputFiles[0].text }],
    compatibilityDate: "2026-05-22", compatibilityFlags: ["nodejs_compat"], cf: false, port: 0, inspectorPort: 0,
    bindings: settings,
    durableObjects: {
      PUBLIC_READER_AUTH: { className: "PublicReaderAuth", useSQLite: true },
      READER_ACCOUNTS: { className: "ReaderAccount", useSQLite: true },
      PRIVATE_FEEDBACK: { className: "PrivateFeedback", useSQLite: true },
      SCENE_ANALYSIS_BUDGET: { className: "SceneAnalysisBudget", useSQLite: true },
    },
    async outboundService(request) {
      if (request.url === analysisUrl) {
        assert.equal(request.headers.get("Cookie"), null);
        assert.equal(request.headers.get("Authorization"), "Bearer " + settings.OPENAI_API_KEY);
        const body = await request.json();
        assert.equal(body.model, "gpt-6-luna");
        assert.equal(body.store, false);
        assert.deepEqual(JSON.parse(body.input), { cues });
        return Response.json({ status: "completed", output: [{ type: "message", role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify({ labels }) }] }] });
      }
      assert.equal(request.url, sesUrl, "Email must only reach the configured SES endpoint.");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("Cookie"), null);
      const body = await request.text();
      verifySesSignature(request.headers, body);
      const message = JSON.parse(body);
      assert.equal(message.FromEmailAddress, settings.AUTH_SES_FROM_EMAIL);
      assert.equal(message.Destination.ToAddresses.length, 1);
      const recipient = message.Destination.ToAddresses[0];
      const code = message.Content.Simple.Body.Text.Data.match(/code is (\d{6})\./)?.[1];
      assert.ok(code, "Email includes a six-digit code.");
      assert.doesNotMatch(body, /synthetic (?:original|replacement) password/);
      outbound.push({ recipient, code, subject: message.Content.Simple.Subject.Data });
      if (recipient === "redirect@example.test") return Response.redirect("https://other.example.test/", 302);
      return Response.json({ MessageId: "synthetic-email" });
    },
  });
  t.after(() => mf.dispose());
  const request = (path, { body, cookie, host = origin, source = origin, headers = {} } = {}) => mf.dispatchFetch(host + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { Origin: source, "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      "CF-Connecting-IP": "192.0.2.14", ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const auth = (action, body, extra) => request(`/api/auth/${action}`, { body, ...extra });
  const send = (email, value = password, adult = true) => auth("register", { email, password: value, adult });
  const verify = (challenge, code) => auth("verify", { challenge, code });
  const login = (email, value = password, remember = false) => auth("login", { email, password: value, remember });
  const reset = (challenge, code, value = changedPassword) => auth("reset", { challenge, code, password: value });
  const resetCooldown = async challenge => {
    const namespace = await mf.getDurableObjectNamespace("PUBLIC_READER_AUTH");
    const stub = namespace.get(namespace.idFromName("public-reader-auth:v1"));
    assert.equal((await stub.fetch("https://reader-auth.internal/test/clock", { method: "POST", body: JSON.stringify({ challenge }) })).ok, true);
  };
  const awaitMail = async (email, subject) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const message = outbound.findLast(item => item.recipient === email && item.subject.includes(subject));
      if (message) return message;
      await delay(10);
    }
    assert.fail("Expected synthetic email to reach the SES fixture.");
  };

  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /satinlore-public-auth/);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.equal(page.headers.get("ETag"), null);
  const guest = { authenticated: false, expiresAt: null };
  assert.deepEqual(await (await request("/api/access")).json(), guest);
  for (const path of ["/api/account", "/api/account/library", "/api/lovense/status", "/api/scene-analysis", "/api/feedback", "/device-bridge"]) {
    assert.equal((await request(path)).status, 401, path);
  }
  assert.equal((await request("/beta-admin.html")).status, 404);
  assert.equal((await request("/", { host: beta })).status, 403);
  assert.equal((await auth("register", { email: "alpha@example.test", password, adult: true }, { host: beta, source: beta })).status, 403);
  assert.equal((await auth("login", { email: "alpha@example.test", password, remember: true }, { source: beta })).status, 403);
  assert.equal((await auth("forgot", { email: "alpha@example.test" }, { headers: { "Sec-Fetch-Site": "same-site" } })).status, 403);
  assert.equal((await auth("request", { email: "alpha@example.test" })).status, 410);
  assert.equal((await send("invalid..address@example.test")).status, 400);
  assert.equal((await send("founder@example.test", "short")).status, 400);
  assert.equal((await send("founder@example.test", password, false)).status, 400);
  assert.equal(outbound.length, 0);

  const legacySubject = "email-v1:" + sign(Buffer.from(settings.PUBLIC_READER_OTP_KEY, "hex"),
    "satinlore:email-identity:v1:founder@example.test").toString("hex");
  assert.deepEqual(await (await request("/test/legacy", { body: { subject: legacySubject } })).json(), { ok: true });
  const issued = await send(" FOUNDER@EXAMPLE.TEST ");
  assert.equal(issued.status, 202, issued.status === 202 ? "" : await issued.text());
  const { challenge, expiresIn, resendAfter } = await issued.json();
  assert.match(challenge, /^[a-f0-9]{64}$/);
  assert.equal(expiresIn, 600);
  assert.equal(resendAfter, 60);
  assert.equal(issued.headers.get("Set-Cookie"), null);
  assert.equal(outbound[0].recipient, "founder@example.test");
  const code = outbound[0].code;
  assert.match(outbound[0].subject, /email verification/);
  const absent = await login("absent@example.test");
  const unverified = await login("founder@example.test");
  assert.equal(absent.status, 401);
  assert.equal(unverified.status, 401);
  assert.deepEqual(await absent.json(), await unverified.json());
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await verify(challenge, wrong)).status, 401);
  const limited = await send("founder@example.test");
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("Retry-After"), /^\d+$/);
  assert.equal(outbound.length, 1);
  assert.equal((await auth("resend", { challenge, email: "not-this-account@example.test" })).status, 401);
  const verified = await Promise.all([verify(challenge, code), verify(challenge, code)]);
  assert.deepEqual(verified.map(result => result.status).sort(), [200, 401]);
  const confirmation = verified.find(result => result.ok);
  assert.deepEqual(await confirmation.json(), { verified: true });
  assert.equal(confirmation.headers.get("Set-Cookie"), null);
  assert.deepEqual(await (await request("/api/access")).json(), guest);
  const accepted = await login("founder@example.test", password, true);
  assert.equal(accepted.status, 200, accepted.status === 200 ? "" : await accepted.text());
  const session = await accepted.json();
  assert.ok(session.authenticated);
  assert.ok(session.expiresAt > Date.now());
  const sessionHeader = accepted.headers.get("Set-Cookie");
  assert.match(sessionHeader, /^__Host-satinlore-reader=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  assert.doesNotMatch(sessionHeader, /Domain=/i);
  const cookie = sessionHeader.split(";")[0];
  const account = await (await request("/api/account", { cookie })).json();
  assert.equal(account.registered, true);
  assert.equal(account.revision, 1, "Password enrollment preserves the previously created reader account.");
  assert.equal(account.presets.length, 0);
  const saved = await request("/api/presets", { cookie, body: {
    expectedRevision: account.revision, preset: {
      id: crypto.randomUUID(), name: "Synthetic setting", toy: "flexer", scope: "account", storyId: null, mode: "story",
      channels: { vibrate: { minimum: 0, background: 1, preferred: 3, maximum: 5, recovery: 0, gain: 1, rhythm: "steady" } },
    },
  } });
  assert.equal(saved.status, 200);
  const savedAccount = await saved.json();
  assert.equal(savedAccount.presets.length, 1);
  const library = await (await request("/api/account/library", { cookie })).json();
  assert.deepEqual(library.stories, []);
  const story = { id: crypto.randomUUID(), title: "Synthetic story", text: "The two characters walked into the library.",
    corrections: [0], position: 0, analysisVersion: "fixture" };
  const savedStory = await request("/api/account/library", { cookie, body: {
    action: "saveStory", expectedOwner: library.owner, expectedRevision: library.revision, story,
  } });
  assert.equal(savedStory.status, 200, savedStory.status === 200 ? "" : await savedStory.text());
  assert.deepEqual(await (await request("/api/scene-analysis", { cookie })).json(), { available: true });
  const analysis = await request("/api/scene-analysis", { cookie, body: { cues } });
  assert.equal(analysis.status, 200);
  assert.deepEqual(await analysis.json(), { labels });
  assert.deepEqual(await (await request("/api/access", { cookie })).json(), session);
  assert.deepEqual(await (await request("/api/access", { cookie: cookie + "; " + cookie })).json(), guest);
  assert.equal((await request("/device-bridge", { cookie })).status, 200);
  assert.equal((await request("/feedback-admin", { cookie })).status, 403);
  assert.equal((await request("/feedback-admin", { cookie, host: beta })).status, 403);
  assert.equal((await request("/alpha/api/access", { cookie })).status, 401);

  await resetCooldown();
  const duplicate = await (await send("founder@example.test", changedPassword)).json();
  assert.equal((await verify(duplicate.challenge, outbound.at(-1).code)).status, 200);
  assert.equal((await login("founder@example.test", changedPassword)).status, 401, "Signup cannot replace an existing password.");
  const otherLogin = await login("founder@example.test");
  const otherHeader = otherLogin.headers.get("Set-Cookie");
  assert.match(otherHeader, /^__Host-satinlore-reader=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
  assert.ok((await otherLogin.json()).expiresAt <= Date.now() + 12 * 60 * 60 * 1000);
  const otherCookie = otherHeader.split(";")[0];

  await resetCooldown();
  const recovery = await auth("forgot", { email: "founder@example.test" });
  const unknownRecovery = await auth("forgot", { email: "absent@example.test" });
  assert.equal(recovery.status, 202);
  assert.equal(unknownRecovery.status, 202);
  const recover = await recovery.json();
  const unknown = await unknownRecovery.json();
  assert.deepEqual({ ...recover, challenge: "" }, { ...unknown, challenge: "" });
  const recoveryCode = (await awaitMail("founder@example.test", "password reset")).code;
  assert.equal(outbound.some(item => item.recipient === "absent@example.test"), false);
  assert.equal((await verify(recover.challenge, recoveryCode)).status, 401, "Verification cannot consume a reset code.");
  assert.equal((await reset(unknown.challenge, recoveryCode)).status, 401);
  const replaced = await reset(recover.challenge, recoveryCode);
  assert.deepEqual(await replaced.json(), { reset: true });
  assert.match(replaced.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal((await reset(recover.challenge, recoveryCode)).status, 401);
  for (const oldCookie of [cookie, otherCookie]) assert.deepEqual(await (await request("/api/access", { cookie: oldCookie })).json(), guest);
  assert.equal((await login("founder@example.test")).status, 401);
  const afterReset = await login("founder@example.test", changedPassword);
  assert.equal(afterReset.status, 200);
  const resetCookie = afterReset.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await (await request("/api/account", { cookie: resetCookie })).json()).presets.length, 1);
  const restored = await (await request("/api/account/library", { cookie: resetCookie })).json();
  assert.equal(restored.owner, library.owner);
  assert.equal(restored.stories[0]?.text, story.text);
  const response = await request("/api/account/delete", { body: { confirm: true, expectedRevision: savedAccount.revision }, cookie: resetCookie });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).registered, false);
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.deepEqual(await (await request("/api/access", { cookie: resetCookie })).json(), guest);
  assert.equal((await request("/api/account", { cookie: resetCookie })).status, 401);
  assert.equal((await login("founder@example.test", changedPassword)).status, 401, "Deletion removes the password credential.");

  const second = await (await send("second@example.test")).json();
  const secondCode = outbound.at(-1).code;
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await verify(second.challenge, secondCode === "000000" ? "111111" : "000000")).status, 401);
  }
  assert.equal((await verify(second.challenge, secondCode)).status, 401, "Five guesses exhaust the challenge.");

  const third = await (await send("third@example.test")).json();
  const thirdFirstCode = outbound.at(-1).code;
  await resetCooldown();
  const reissued = await auth("resend", { challenge: third.challenge, email: "third@example.test" });
  assert.equal(reissued.status, 202);
  const replacement = await reissued.json();
  assert.notEqual(third.challenge, replacement.challenge);
  assert.equal((await verify(third.challenge, thirdFirstCode)).status, 401);
  assert.equal((await verify(replacement.challenge, outbound.at(-1).code)).status, 200);
  const thirdSession = await login("third@example.test");
  assert.equal(thirdSession.status, 200);
  const thirdCookie = thirdSession.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await request("/api/auth/logout", { body: {}, cookie: thirdCookie, source: beta })).status, 403);
  const loggedOut = await request("/api/auth/logout", { body: {}, cookie: thirdCookie });
  assert.deepEqual(await loggedOut.json(), guest);
  assert.match(loggedOut.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.deepEqual(await (await request("/api/access", { cookie: thirdCookie })).json(), guest);

  const expired = await (await send("expired@example.test")).json();
  await resetCooldown(expired.challenge);
  assert.equal((await verify(expired.challenge, outbound.at(-1).code)).status, 401);
  for (let attempt = 0; attempt < 8; attempt++) assert.equal((await login("limited@example.test")).status, 401);
  assert.equal((await login("limited@example.test")).status, 429);

  const failed = await send("redirect@example.test");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Email sign-in is temporarily unavailable. Try again shortly." });
  assert.equal(outbound.length, 8);
});
