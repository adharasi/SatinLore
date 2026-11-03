import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

// Node's fetch accepts receivers that the browser Window API rejects. Execute
// the real module code with a receiver check rather than replacing its client.
async function browserModule(file, exports, responseFor) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8"))
    .replace(/^import .+;\s*$/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({Response, AbortSignal, AbortController, responseFor});
  vm.runInContext(`
    "use strict";
    globalThis.fetchCalls = [];
    globalThis.fetch = function(path, options) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      fetchCalls.push({path, method: options.method});
      return Promise.resolve(responseFor(path, options));
    };
    ${source}
    globalThis.api = {${exports}};
  `, context, {filename: file});
  return context;
}

test("the default account request keeps the browser fetch receiver for load and registration", async () => {
  const context = await browserModule("../app/static/reader/account-workspace.mjs", "ReaderAccountClient", (_path, options) => {
    const registered = options.method === "POST";
    return Response.json({registered, revision: registered ? 1 : 0, presets: [], version: 1, playback: "paused"}, {status: registered ? 201 : 200});
  });
  const client = new context.api.ReaderAccountClient();
  assert.equal(await client.load(), true, client.snapshot().message);
  assert.equal(await client.create(), true, client.snapshot().message);
  assert.equal(client.snapshot().registered, true);
  assert.equal(client.snapshot().playback, "paused");
  assert.deepEqual(Array.from(context.fetchCalls, call => [call.path, call.method]), [["/api/account", "GET"], ["/api/account", "POST"]]);
});

test("the default beta recorder request keeps the browser fetch receiver", async () => {
  const context = await browserModule("../app/static/reader/beta-recording.mjs", "createBetaRecorder", () => Response.json({
    ok: true, sid: "14b811a0-d012-4f80-bf1c-fda150c72ba9", seq: 0,
    maxDurationMs: 3600000, maxEvents: 20000, maxBatchEvents: 100,
  }));
  const recorder = context.api.createBetaRecorder({hostname: "beta.satinlore.com", now: () => 10000,
    uuid: () => "297ba762-df42-4e6c-9966-01f2a6f0087f", setTimer: () => 0, clearTimer: () => {}});
  assert.equal(await recorder.start({mode: "simulator", toy: "flexer"}), true, recorder.snapshot().message);
  assert.deepEqual(Array.from(context.fetchCalls, call => [call.path, call.method]), [["/api/beta/recordings", "POST"]]);
  recorder.destroy();
});
