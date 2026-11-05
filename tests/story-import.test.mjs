import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { ao3StoryUrl, boundedImportText, importPublicStory, normalizeImportedStory, storyImportJson } from "../deploy/cloudflare/story-import.mjs";
import { createPrivateAppWorker } from "../deploy/cloudflare/worker.mjs";
import { identifyStoryUrl, WebStoryImporter, readStoryFile } from "../app/static/reader/web-import.mjs";
import { preparePlainStoryText, splitText } from "../app/static/reader/import.mjs";

const AO3 = "https://archiveofourown.org/works/12345";
const ORIGIN = "https://app.satinlore.com";
const parsed = { title: "The quiet station", text: "A train waited.\n\nThe clock struck eight." };
const html = () => new Response("<div>A neutral fixture.</div>", { headers: { "Content-Type": "text/html; charset=utf-8" } });

test("AO3 import canonicalizes one work/chapter and discards sensitive query/fragment values", () => {
  assert.deepEqual(ao3StoryUrl(AO3 + "?token=private&view_adult=true#chapter"), { url: AO3 + "?view_full_work=true", source: "AO3", scope: "entire work" });
  assert.equal(ao3StoryUrl("https://ao3.org/works/12345/chapters/23456?view_adult=true").scope, "current chapter");
  assert.equal(ao3StoryUrl("https://www.archiveofourown.org/chapters/23456/").url, "https://archiveofourown.org/chapters/23456");
  for (const value of ["http://archiveofourown.org/works/1", "https://archiveofourown.org.attacker.test/works/1", "https://archiveofourown.org@attacker.test/works/1",
    "https://reader:secret@archiveofourown.org/works/1", "https://archiveofourown.org:8443/works/1", "https://127.0.0.1/works/1", "https://169.254.169.254/works/1",
    "https://[::1]/works/1", "https://www.literotica.com/s/neutral-fixture", "https://archiveofourown.org/users/login", "https://archiveofourown.org/works/1%2f..%2fusers",
    "https://archiveofourown.org/collections/1", "https://archiveofourown.org/works/0", "https://archiveofourown.org/works/1/../../users/login", "x".repeat(2049)]) {
    assert.throws(() => ao3StoryUrl(value), undefined, value);
  }
});

test("public link fetching forwards only a canonical public URL and minimum non-identifying headers", async () => {
  const calls = [];
  const result = await importPublicStory(AO3 + "?token=private", { fetcher: async (url, options) => { calls.push({ url, options }); return html(); }, parse: async () => parsed });
  assert.deepEqual(result, { ...parsed, source: "AO3", scope: "entire work" });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, AO3 + "?view_full_work=true");
  const options = calls[0].options;
  assert.equal(options.redirect, "manual"); assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
  assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "User-Agent"]);
  assert.equal(options.body, undefined);
});

test("redirects remain bounded public AO3 story requests; login, offsite and metadata redirects never fetch", async () => {
  for (const location of ["https://127.0.0.1/private", "https://169.254.169.254/latest/meta-data", "https://attacker.test/works/1", "/users/login", "//archiveofourown.org.attacker.test/works/1", "http://archiveofourown.org/works/1"]) {
    let calls = 0;
    await assert.rejects(importPublicStory(AO3, { fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: location } }); } }));
    assert.equal(calls, 1, location);
  }
  let calls = 0;
  await assert.rejects(importPublicStory(AO3, { fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: "/works/1" } }); } }));
  assert.equal(calls, 3);
  calls = 0;
  const result = await importPublicStory(AO3, { fetcher: async () => ++calls === 1 ? new Response(null, { status: 302, headers: { Location: "/works/12345/chapters/23456" } }) : html(), parse: async () => parsed });
  assert.equal(result.scope, "current chapter");
});

test("blocks, wrong content, invalid UTF-8, oversize and stalled fetches fail with a practical fallback", async () => {
  for (const response of [new Response("Forbidden", { status: 403 }), new Response("{not html}", { headers: { "Content-Type": "application/json" } }), new Response(new Uint8Array([255]), { headers: { "Content-Type": "text/html" } })]) {
    await assert.rejects(importPublicStory(AO3, { fetcher: async () => response }), /HTML|readable|UTF-8/);
  }
  await assert.rejects(boundedImportText(new Response("tiny", { headers: { "Content-Length": "2000001" } })), /too large/);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(15)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedImportText(new Response(stream), 10), /too large/); assert.equal(cancelled, true);
  await assert.rejects(importPublicStory(AO3, { timeoutMs: 5, fetcher: () => new Promise(() => {}) }), /too long/);
  assert.throws(() => normalizeImportedStory("Neutral", "a".repeat(500001)), /too large/);
  assert.throws(() => normalizeImportedStory("Neutral", Array.from({ length: 2001 }, () => "A paragraph.").join("\n\n")), /too large/);
});

test("story import JSON is strict, bounded and cannot select identity, credentials, body text or arbitrary fetch options", async () => {
  const req = (value, type = "application/json") => new Request(ORIGIN + "/api/story-import", { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(value) });
  assert.equal((await storyImportJson(req({ url: AO3 }))).source, "AO3");
  for (const value of [{ url: AO3, user: "another" }, { url: AO3, cookies: "secret" }, { url: AO3, text: "private" }, [AO3], null]) await assert.rejects(storyImportJson(req(value)));
  await assert.rejects(storyImportJson(req({ url: AO3 }, "text/plain")));
  await assert.rejects(storyImportJson(req({ url: "a".repeat(5000) })));
});

test("real Worker HTMLRewriter extracts only chapter prose, preserving paragraphs and literal text", { timeout: 30000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const mf = new Miniflare({ modulesRoot: root, modules: [
    { type: "ESModule", path: root + "story-import-runtime-fixture.mjs", contents: `import {extractAo3Html} from './deploy/cloudflare/story-import.mjs'; export default {async fetch(request) { try { return Response.json(await extractAo3Html(await request.text())); } catch(error) { return Response.json({error:error.message},{status:error.status||500}); } }};` },
    { type: "ESModule", path: root + "deploy/cloudflare/story-import.mjs", contents: await readFile(new URL("../deploy/cloudflare/story-import.mjs", import.meta.url), "utf8") },
  ], compatibilityDate: "2026-05-22", cf: false, port: 0, inspectorPort: 0 });
  t.after(() => mf.dispose());
  const fixture = `<!doctype html><title>Site chrome</title><h2 class="title heading">The quiet &amp; safe station</h2><nav>Not a story</nav><div id="chapters"><div class="chapter"><div class="preface"><div class="notes"><blockquote class="userstuff">Private author note is excluded.</blockquote></div></div><div class="userstuff module"><p>A &amp; B waited at the station.</p><p>The &lt;clock&gt; struck <em>eight</em>.<br>The train was on time.</p><script>shouldNotAppear()</script><style>.secret{}</style><div class="notes">Hidden note.</div></div></div><div class="chapter"><div class="userstuff"><p>The next chapter began.</p></div></div></div><footer>Comments excluded.</footer>`;
  const response = await mf.dispatchFetch("https://fixture.test/", { method: "POST", body: fixture });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { title: "The quiet & safe station", text: "A & B waited at the station.\n\nThe <clock> struck eight.\nThe train was on time.\n\nThe next chapter began." });
  const missing = await mf.dispatchFetch("https://fixture.test/", { method: "POST", body: '<h1>Sign in</h1><p>A work is not available.</p>' });
  assert.equal(missing.status, 422);
  const download = await mf.dispatchFetch("https://fixture.test/", { method: "POST", body: '<div id="preface"><h1>The download</h1></div><div id="chapters"><div class="meta"><blockquote class="userstuff">Not story text.</blockquote></div><div class="userstuff"><p>A downloaded chapter.</p></div></div>' });
  assert.deepEqual(await download.json(), { title: "The download", text: "A downloaded chapter." });
});

const ENV = { PUBLIC_APP_ORIGIN: ORIGIN, PRIVATE_APP_ENABLED: "true", ACCESS_TEAM_DOMAIN: "synthetic-team.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64), FOUNDER_EMAIL: "founder@example.test" };
const { privateKey, publicKey } = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "story-test", alg: "RS256" }] });
async function jwt() { const now = Math.floor(Date.now() / 1000); return new SignJWT({ iss: `https://${ENV.ACCESS_TEAM_DOMAIN}`, aud: ENV.ACCESS_AUD, sub: "synthetic", email: ENV.FOUNDER_EMAIL, type: "app", iat: now, exp: now + 3600 }).setProtectedHeader({ alg: "RS256", kid: "story-test" }).sign(privateKey); }

test("hosted import verifies Access and exact Origin before fetching and never forwards request credentials", async () => {
  const calls = []; const worker = createPrivateAppWorker({ keyResolver: keys, storyFetcher: async (...args) => { calls.push(args); return html(); }, storyParser: async () => parsed });
  const token = await jwt();
  const request = (changes = {}) => new Request(ORIGIN + "/api/story-import", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token, Cookie: "private=credential", ...changes }, body: JSON.stringify({ url: AO3 }) });
  assert.equal((await worker.fetch(request({ "Cf-Access-Jwt-Assertion": "" }), ENV)).status, 403);
  assert.equal((await worker.fetch(request({ Origin: "https://attacker.test" }), ENV)).status, 403);
  assert.equal((await worker.fetch(request({ "Sec-Fetch-Site": "same-site" }), ENV)).status, 403);
  assert.equal(calls.length, 0);
  const result = await worker.fetch(request(), ENV);
  assert.equal(result.status, 200); assert.equal(result.headers.get("Cache-Control"), "no-store"); assert.equal(result.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(await result.json(), { ...parsed, source: "AO3", scope: "entire work" });
  assert.deepEqual(Object.keys(calls[0][1].headers).sort(), ["Accept", "User-Agent"]);
  const get = await worker.fetch(new Request(ORIGIN + "/api/story-import", { headers: { "Cf-Access-Jwt-Assertion": token } }), ENV);
  assert.equal(get.status, 405); assert.equal(get.headers.get("Allow"), "POST");
});

test("browser link import recognises manual-only sources without fetching or accepting private credentials", async () => {
  const source = identifyStoryUrl("https://www.literotica.com/s/neutral-fixture?tracking=private#text");
  assert.equal(source.kind, "literotica"); assert.equal(source.automatic, false); assert.equal(source.url, "https://www.literotica.com/s/neutral-fixture");
  assert.match(source.guidance, /permission|content-use/);
  for (const host of ["royalroad.com", "wattpad.com", "fanfiction.net", "inkitt.com"]) assert.equal(identifyStoryUrl(`https://${host}/story`).automatic, false);
  for (const value of ["javascript:alert(1)", "http://localhost/story", "https://reader:secret@archiveofourown.org/works/1", "https://127.0.0.1/story"]) assert.throws(() => identifyStoryUrl(value));
  let calls = 0; const importer = new WebStoryImporter({ fetcher: async () => { calls++; } });
  await assert.rejects(importer.read(source.url), /Literotica/); assert.equal(calls, 0);
});

test("browser import is explicit, same-origin, validated and cancelled imports cannot replace the story", async () => {
  let captured; const response = () => Response.json({ ...parsed, source: "AO3", scope: "entire work" });
  const importer = new WebStoryImporter({ fetcher: async (url, options) => { captured = { url, options }; return response(); } });
  assert.deepEqual(await importer.read(AO3 + "?private=value"), { ...parsed, source: "AO3", scope: "entire work" });
  assert.equal(captured.url, "/api/story-import"); assert.equal(captured.options.credentials, "same-origin"); assert.equal(captured.options.redirect, "error");
  assert.deepEqual(JSON.parse(captured.options.body), { url: AO3 });
  let finish; const delayed = new WebStoryImporter({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const pending = delayed.read(AO3); delayed.invalidate(); finish(response()); assert.equal(await pending, null);
  const invalid = new WebStoryImporter({ fetcher: async () => Response.json({ ...parsed, text: "a".repeat(500001), source: "AO3", scope: "entire work" }) });
  await assert.rejects(invalid.read(AO3), /500 KB/);
  const denied = new WebStoryImporter({ fetcher: async () => new Response(null, { status: 403 }) });
  await assert.rejects(denied.read(AO3), /sign-in/);
  const stalled = new WebStoryImporter({ timeoutMs: 5, fetcher: () => new Promise(() => {}) });
  await assert.rejects(stalled.read(AO3), /too long/);
});

test("browser link response streaming stays bounded and the timeout covers a stalled body", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3_100_001)); }, cancel() { cancelled = true; } });
  const large = new WebStoryImporter({ fetcher: async () => new Response(stream, { headers: { "Content-Type": "application/json" } }) });
  await assert.rejects(large.read(AO3), /too large/); assert.equal(cancelled, true);
  const stalled = new WebStoryImporter({ timeoutMs: 5, fetcher: async () => new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } }) });
  await assert.rejects(stalled.read(AO3), /too long/);
});

test("access expiring during external import returns no story after the public fetch completes", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const token = await jwt();
  const worker = createPrivateAppWorker({ keyResolver: keys, storyFetcher: async () => { now += 3_601_000; return html(); }, storyParser: async () => parsed });
  const result = await worker.fetch(new Request(ORIGIN + "/api/story-import", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token }, body: JSON.stringify({ url: AO3 }) }), ENV);
  assert.equal(result.status, 403); assert.deepEqual(await result.json(), { error: "Founder access required." });
});

test("local story files remain local and respect file type, UTF-8 and reader bounds", async () => {
  const file = new File(["A train waited.\n\nThe clock struck eight."], "The quiet station.txt", { type: "text/plain" });
  assert.deepEqual(await readStoryFile(file), parsed);
  assert.deepEqual(await readStoryFile(new File(["A train waited.\r\nThe clock struck eight."], file.name)), parsed);
  await assert.rejects(readStoryFile(new File(["no"], "story.pdf")), /text file|HTML/);
  await assert.rejects(readStoryFile(new File([new Uint8Array([255])], "story.txt")), /UTF-8/);
  await assert.rejects(readStoryFile(new File(["a".repeat(500001)], "story.txt")), /500 KB/);
});

test("new plain text accepts single-newline prose while saved and wrapped text keeps its boundaries", () => {
  const single = "The train waited.\n“It's eight,” she said.\nTime to leave";
  const separated = "The train waited.\n\n“It's eight,” she said.\n\nTime to leave";
  assert.equal(preparePlainStoryText(single), separated);
  assert.equal(preparePlainStoryText(separated), separated);
  assert.deepEqual(splitText(single), [single], "The saved paragraph index contract is unchanged.");
  const wrapped = "The train waited at the edge of\nthe platform. A clock struck eight.";
  assert.equal(preparePlainStoryText(wrapped), wrapped);
  const atLimit = "A".repeat(499_997) + ".\nB";
  assert.equal(preparePlainStoryText(atLimit), atLimit);
});

test("a new wall of text becomes readable sections without changing the prose", () => {
  const oneBlock = Array.from({ length: 100 }, (_, index) => `The station clock reached ${index} seconds.`).join(" ");
  const sections = splitText(preparePlainStoryText(oneBlock));
  assert.ok(sections.length > 3);
  assert.equal(sections.join(" "), oneBlock);
  assert.ok(sections.every(section => section.length <= 900 && section.endsWith(".")));
  assert.deepEqual(splitText(oneBlock), [oneBlock]);
  const unclear = "The same unpunctuated line ".repeat(80);
  assert.equal(preparePlainStoryText(unclear), unclear);
  const preserved = `${oneBlock}\n\nA new chapter begins.`;
  assert.equal(preparePlainStoryText(preserved), preserved);
});
