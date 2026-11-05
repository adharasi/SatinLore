import assert from "node:assert/strict";

// The real SHA-256 implementation completes on Node's crypto worker pool.
// Parallel test files can delay it beyond a fixed number of event-loop turns.
export async function waitForWorkspace(app, predicate, message = "Workspace condition did not settle.") {
  const deadline = Date.now() + 10_000;
  // Let any queued application operation start before observing completion.
  await app.settle();
  while (!predicate() && Date.now() < deadline) await app.settle();
  assert.ok(predicate(), message);
}

export const waitForContext = app => waitForWorkspace(app,
  () => app.read("nocturneOperation === null"), "Context analysis did not settle.");
