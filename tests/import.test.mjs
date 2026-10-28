import test from "node:test";
import assert from "node:assert/strict";
import {splitText, TextImporter, MAX_TEXT_BYTES} from "../app/static/reader/import.mjs";

const file = text => new File([text], "sample.txt", {type: "text/plain"});
const deferredFile = () => {
  let resolve;
  const result = new Promise(done => { resolve = done; });
  return {value: {name: "slow.txt", size: 10, arrayBuffer: () => result}, finish: text => resolve(new TextEncoder().encode(text).buffer)};
};

test("normalise blank text, CRLF, lone CR and unicode", () => {
  assert.deepEqual(splitText(" \n\n "), []);
  assert.deepEqual(splitText("One\r\n\r\nDeux — été\r\rThree"), ["One", "Deux — été", "Three"]);
  assert.deepEqual(splitText("<script>alert(1)</script>"), ["<script>alert(1)</script>"]);
});
test("paste and file share a byte limit including non-ASCII text", async () => {
  const accepted = "é".repeat(MAX_TEXT_BYTES / 2);
  assert.equal(splitText(accepted)[0], accepted);
  const tooLarge = accepted + "é";
  assert.throws(() => splitText(tooLarge));
  await assert.rejects(() => new TextImporter().read(file(tooLarge)));
});
test("file import rejects invalid UTF-8 and non-TXT files", async () => {
  const importer = new TextImporter();
  await assert.rejects(() => importer.read(new File([new Uint8Array([0xff])], "bad.txt")));
  await assert.rejects(() => importer.read(new File(["plain"], "book.epub")));
  assert.equal(await importer.read(file("Valid text")), "Valid text");
});
test("Clear invalidates an in-flight import", async () => {
  const importer = new TextImporter(), slow = deferredFile();
  const pending = importer.read(slow.value);
  importer.invalidate();
  slow.finish("Stale text");
  assert.equal(await pending, null);
});
test("a newer import wins even when the earlier file finishes last", async () => {
  const importer = new TextImporter(), slow = deferredFile();
  const pending = importer.read(slow.value);
  assert.equal(await importer.read(file("New text")), "New text");
  slow.finish("Old text");
  assert.equal(await pending, null);
});
