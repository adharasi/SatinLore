import test from "node:test";
import assert from "node:assert/strict";
import {createStoryId} from "../app/static/reader/identity.mjs";
import {ReaderModel} from "../app/static/reader/model.mjs";

test("story identities use the native secure-context UUID when available", () => {
  const value = "e9338f1a-a07c-4c3b-8b07-746b81dcbcd9";
  assert.equal(createStoryId({randomUUID: () => value}), value);
});
test("an HTTP preview can create valid local stories without randomUUID", () => {
  let calls = 0;
  const id = createStoryId({getRandomValues(bytes) {
    calls++;
    for (let index = 0; index < bytes.length; index++) bytes[index] = index;
    return bytes;
  }});
  assert.equal(calls, 1);
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const model = new ReaderModel();
  model.load("A quiet first paragraph.\n\nA quiet second paragraph.", {documentId: id, deferAnalysis: true});
  assert.equal(model.documentId, id);
  assert.equal(model.paragraphs.length, 2);
});
test("missing cryptographic randomness fails clearly without a weaker identifier", () => {
  assert.throws(() => createStoryId({}), /browser cannot create a private story/);
});
