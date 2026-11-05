import assert from "node:assert/strict";

// Analysis and mocked requests may take more than a fixed number of turns
// when tests share the event loop with other work.
export async function waitForWorkspace(app, predicate, message = "Workspace condition did not settle.") {
  const deadline = Date.now() + 10_000;
  // Let any queued application operation start before observing completion.
  await app.settle();
  while (!predicate() && Date.now() < deadline) await app.settle();
  assert.ok(predicate(), message);
}

export const waitForContext = app => waitForWorkspace(app,
  () => app.read("nocturneOperation === null"), "Context analysis did not settle.");
