import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
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

test("public email flow uses real SQLite sessions and Workers SES fetch with isolated reader and beta access", { timeout: 30_000 }, async t => {
  const compiled = await build({ stdin: { resolveDir: root, sourcefile: "public-auth-fixture.mjs", contents: `
    import worker from "./deploy/cloudflare/worker.mjs";
    export { PublicReaderAuth, ReaderAccount, PrivateFeedback, SceneAnalysisBudget } from "./deploy/cloudflare/worker.mjs";
    export default { fetch(request, env) {
      const ASSETS = { fetch: async asset => new Response(asset.url.endsWith("/device-bridge.html") ?
        '<script id="lovense-isolated-bundle">void 0;</script>' : '<html><head></head><body>Reader</body></html>',
        { headers: { "content-type": "text/html", "ETag": "fixture" } }) };
      return worker.fetch(request, { ...env, ASSETS });
    } };
  ` }, bundle: true, write: false, format: "esm" });
  const outbound = [];
  const mf = new Miniflare({
    modules: [{ type: "ESModule", path: "public-auth-fixture.mjs", contents: compiled.outputFiles[0].text }],
    compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0,
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
      outbound.push({ recipient, code });
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
  const send = email => request("/api/auth/request", { body: { email } });
  const verify = (challenge, code, adult = true) => request("/api/auth/verify", { body: { challenge, code, adult } });

  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /satinlore-public-auth/);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.equal(page.headers.get("ETag"), null);
  const guest = { authenticated: false, expiresAt: null };
  assert.deepEqual(await (await request("/api/access")).json(), guest);
  for (const path of ["/api/account", "/api/lovense/status", "/api/scene-analysis", "/api/feedback", "/device-bridge"]) {
    assert.equal((await request(path)).status, 401, path);
  }
  assert.equal((await request("/beta-admin.html")).status, 404);
  assert.equal((await request("/", { host: beta })).status, 403);
  assert.equal((await request("/api/auth/request", { host: beta, source: beta, body: { email: "alpha@example.test" } })).status, 403);
  assert.equal((await request("/api/auth/request", { source: beta, body: { email: "alpha@example.test" } })).status, 403);
  assert.equal((await request("/api/auth/request", { headers: { "Sec-Fetch-Site": "same-site" }, body: { email: "alpha@example.test" } })).status, 403);
  assert.equal((await send("invalid..address@example.test")).status, 400);
  assert.equal(outbound.length, 0);

  const issued = await send(" FOUNDER@EXAMPLE.TEST ");
  assert.equal(issued.status, 202, issued.status === 202 ? "" : await issued.text());
  const { challenge, expiresIn, resendAfter } = await issued.json();
  assert.match(challenge, /^[a-f0-9]{64}$/);
  assert.equal(expiresIn, 600);
  assert.equal(resendAfter, 60);
  assert.equal(issued.headers.get("Set-Cookie"), null);
  assert.equal(outbound[0].recipient, "founder@example.test");
  const code = outbound[0].code;
  assert.equal((await verify(challenge, code, false)).status, 400);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await verify(challenge, wrong)).status, 401);
  const limited = await send("founder@example.test");
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("Retry-After"), /^\d+$/);
  assert.equal(outbound.length, 1);
  const verified = await Promise.all([verify(challenge, code), verify(challenge, code)]);
  assert.deepEqual(verified.map(result => result.status).sort(), [200, 401]);
  const accepted = verified.find(result => result.ok);
  const session = await accepted.json();
  assert.ok(session.authenticated);
  assert.ok(session.expiresAt > Date.now());
  const sessionHeader = accepted.headers.get("Set-Cookie");
  assert.match(sessionHeader, /^__Host-satinlore-reader=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800$/);
  assert.doesNotMatch(sessionHeader, /Domain=/i);
  const cookie = sessionHeader.split(";")[0];
  const account = await (await request("/api/account", { cookie })).json();
  assert.equal(account.registered, true);
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
  const response = await request("/api/account/delete", { body: { confirm: true, expectedRevision: savedAccount.revision }, cookie });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).registered, false);
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.deepEqual(await (await request("/api/access", { cookie })).json(), guest);
  assert.equal((await request("/api/account", { cookie })).status, 401);

  const second = await (await send("second@example.test")).json();
  const secondCode = outbound.at(-1).code;
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await verify(second.challenge, secondCode === "000000" ? "111111" : "000000")).status, 401);
  }
  assert.equal((await verify(second.challenge, secondCode)).status, 401, "Five guesses exhaust the challenge.");

  const third = await (await send("third@example.test")).json();
  const thirdSession = await verify(third.challenge, outbound.at(-1).code);
  assert.equal(thirdSession.status, 200);
  const thirdCookie = thirdSession.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await request("/api/auth/logout", { body: {}, cookie: thirdCookie, source: beta })).status, 403);
  const loggedOut = await request("/api/auth/logout", { body: {}, cookie: thirdCookie });
  assert.deepEqual(await loggedOut.json(), guest);
  assert.match(loggedOut.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.deepEqual(await (await request("/api/access", { cookie: thirdCookie })).json(), guest);

  const failed = await send("redirect@example.test");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Email sign-in is temporarily unavailable. Try again shortly." });
  assert.equal(outbound.length, 4);
});
