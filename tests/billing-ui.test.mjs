import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { appPath } from "../app/static/access.mjs";

async function guestBilling({preview = false, search = ""} = {}) {
  const billing = (await readFile(new URL("../app/static/billing.mjs", import.meta.url), "utf8"))
    .replace(/^import .+;$/gm, "");
  const nodes = new Map();
  const calls = [];
  const document = {
    querySelector: selector => preview && selector === 'meta[name="satinlore-base-path"]' ? {content: "/beta"} : null,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { addEventListener() {} });
      return nodes.get(id);
    },
  };
  const context = {
    URL,
    URLSearchParams,
    AbortSignal,
    document,
    window: { location: { href: `https://app.satinlore.com${preview ? "/beta" : ""}/billing${search}` }, addEventListener() {} },
    appPath: path => appPath(path, document),
    appFetch: async (path, options) => {
      calls.push({path: appPath(path, document), options});
      return {ok: true, json: async () => ({authenticated: false})};
    },
  };
  const providerUrl = await runInNewContext(`(async () => {${billing}\nreturn providerUrl;})()`, context);
  return {nodes, calls, providerUrl};
}

test("billing opens only matching hosted payment pages and preserves Stripe Checkout's session fragment", async () => {
  const {providerUrl} = await guestBilling();
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

test("beta billing keeps access, signup and order sign-in paths under beta", async () => {
  const order = "00000000-0000-4000-8000-000000000001";
  const {nodes, calls, providerUrl} = await guestBilling({preview: true, search: `?ref=BETA1&order=${order}`});
  assert.deepEqual(calls.map(value => value.path), ["/beta/api/access"]);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(nodes.get("billing-sign-in-link").href, `/beta/login?next=billing&ref=BETA1&order=${order}`);
  assert.equal(nodes.get("billing-sign-up-link").href, "/beta/signup?next=billing&ref=BETA1");
  const checkout = "https://checkout.stripe.com/c/pay/cs_test_FixtureAb1#fixture%2Fpayload";
  assert.equal(providerUrl(checkout, "checkout"), checkout);
});
