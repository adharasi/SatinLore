import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("billing opens only matching hosted payment pages and preserves Stripe Checkout's session fragment", async () => {
  const billing = await readFile(new URL("../app/static/billing.mjs", import.meta.url), "utf8");
  const nodes = new Map();
  const context = {
    URL,
    URLSearchParams,
    AbortSignal,
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { addEventListener() {} });
        return nodes.get(id);
      },
    },
    window: { location: { href: "https://app.satinlore.com/billing" }, addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => ({ authenticated: false }) }),
  };
  const providerUrl = await runInNewContext(`(async () => {${billing}\nreturn providerUrl;})()`, context);
  const checkout = "https://checkout.stripe.com/c/pay/cs_test_FixtureAb1#fixture%2Fpayload";
  const portal = "https://billing.stripe.com/p/session?secret=test_FixtureAb1";
  assert.equal(providerUrl(checkout, "checkout"), checkout);
  assert.equal(providerUrl(portal, "cancellation"), portal);
  assert.equal(providerUrl("https://billing.stripe.com/p/session/FixtureAb1", "cancellation"),
    "https://billing.stripe.com/p/session/FixtureAb1");
  assert.equal(providerUrl("https://secure.verotel.com/startorder?referenceID=123", "checkout"),
    "https://secure.verotel.com/startorder?referenceID=123");
  assert.equal(providerUrl("https://secure.verotel.com/cancel-subscription?saleID=123", "cancellation"),
    "https://secure.verotel.com/cancel-subscription?saleID=123");
  assert.throws(() => providerUrl(portal, "checkout"), /payment page could not be opened/);
  assert.throws(() => providerUrl(checkout, "cancellation"), /payment page could not be opened/);
  assert.throws(() => providerUrl("http://checkout.stripe.com/c/pay/cs_test_FixtureAb1", "checkout"), /payment page could not be opened/);
  assert.throws(() => providerUrl("https://checkout.stripe.com/example", "checkout"), /payment page could not be opened/);
});
