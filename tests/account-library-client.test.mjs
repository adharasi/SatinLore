import test from "node:test";
import assert from "node:assert/strict";
import {AccountLibrary} from "../app/static/reader/account-library.mjs";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const fixture = {id: "story-a", title: "Neutral passage", text: "The rain had stopped.", position: 0, corrections: [null], analysisVersion: "1"};

test("cloud writes are owner-scoped and serialize updates against durable revisions", async () => {
  const writes = [];
  const client = new AccountLibrary({request: async (_path, options) => {
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    if (options.method === "GET") return Response.json({owner: first, revision: 2, preferences: null, stories: []});
    const write = JSON.parse(options.body); writes.push(write);
    if (write.action === "saveStory") return Response.json({revision: 3, story: {...fixture, revision: 3, updatedAt: 5}});
    return Response.json({revision: 4, storyRevision: 4, updatedAt: 6});
  }});
  await client.open();
  const firstWrite = client.saveStory(first, fixture);
  const nextWrite = client.updateStory(first, {...fixture, title: "New title"});
  await Promise.all([firstWrite, nextWrite]);
  assert.equal(writes[0].expectedOwner, first);
  assert.equal(writes[0].expectedRevision, 2);
  assert.equal(writes[1].expectedRevision, 3);
  assert.equal("text" in writes[1].changes, false);
  await assert.rejects(client.deleteStory(second, fixture.id), /sign-in changed/);
  assert.equal(writes.length, 2);
});

test("logout and a new login discard a prior account response and all queued writes", async () => {
  let release, sendCount = 0, owner = first;
  const delayed = new Promise(resolve => { release = resolve; });
  const client = new AccountLibrary({request: async (_path, options) => {
    if (options.method === "GET") return Response.json({owner, revision: 0, preferences: null, stories: []});
    sendCount++;
    return delayed;
  }});
  await client.open();
  const pending = client.saveStory(first, fixture);
  const queued = client.deleteStory(first, fixture.id);
  await new Promise(resolve => setImmediate(resolve));
  client.clear(); owner = second;
  await client.open();
  release(Response.json({revision: 1, story: {...fixture, revision: 1, updatedAt: 1}}));
  await assert.rejects(pending, /sign-in changed/);
  await assert.rejects(queued, /sign-in changed/);
  assert.equal(sendCount, 1);
  assert.equal(client.owner, second);
});
