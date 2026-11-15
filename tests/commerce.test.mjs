import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {cancelCheckout, listCommerceRecords, quoteCheckout, readCheckout, readEntitlement, reserveCheckout,
  reverseCheckout, SatinLoreCommerce, saveAffiliate, savePromotion, settleCheckout} from "../deploy/cloudflare/commerce.mjs";

const reader = `account:v1:${"a".repeat(64)}`;
const other = `account:v1:${"b".repeat(64)}`;
const plan = {id: "test-plan", currency: "USD", amountMinor: 1001, credits: 1003};
const request = (changes = {}) => ({subject: reader, plan, idempotencyKey: crypto.randomUUID(), ...changes});
const purchase = (id, changes = {}) => ({id, currency: "USD", amountMinor: 1001, providerSaleId: "111",
  providerTransactionId: "121", eventId: "v2:purchase:121", ...changes});
const refund = (id, changes = {}) => ({id, currency: "USD", amountMinor: 371, providerSaleId: "111",
  providerTransactionId: "122", parentTransactionId: "121", reason: "refund", eventId: "v2:credit:122", ...changes});

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const storage = {sql: {exec(query, ...bindings) {
    const statement = db.prepare(query);
    if (statement.columns().length) return {toArray: () => statement.all(...bindings)};
    statement.run(...bindings);
    return {toArray: () => []};
  }}, transactionSync(task) {
    db.exec("BEGIN");
    try { const result = task(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }};
  let ledger = new SatinLoreCommerce({storage});
  const namespace = {idFromName: id => { assert.equal(id, "launch"); return id; }, get: () => ({fetch: task => ledger.fetch(task)})};
  const reset = () => { ledger = new SatinLoreCommerce({storage}); };
  return {namespace, db, reset};
}

async function body(response, status = 200) {
  const resolved = await response, payload = await resolved.json();
  assert.equal(resolved.status, status, JSON.stringify(payload));
  return payload;
}

function promotion(changes = {}) {
  const now = Date.now();
  return {code: "test-code", discountBps: 1250, maxRedemptions: 1, validFrom: now - 1000, validUntil: now + 10_000_000,
    enabled: true, planId: plan.id, ...changes};
}

test("quote is read-only; checkout reserves promotional capacity transactionally and pins an account-owned idempotency key", async t => {
  const {namespace, db, reset} = fixture(t);
  await body(savePromotion(namespace, promotion()));
  const {quote} = await body(quoteCheckout(namespace, {subject: reader, plan, promotionCode: " test-code "}));
  assert.equal(quote.amountMinor, 876);
  assert.equal(quote.regularAmountMinor, 1001);
  assert.equal((await body(listCommerceRecords(namespace))).promotions[0].claimed, 0);
  const first = request({promotionCode: "test-code"}), second = request({subject: other, promotionCode: "TEST-CODE"});
  const results = await Promise.all([reserveCheckout(namespace, first), reserveCheckout(namespace, second)]);
  assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
  const winner = results[0].status === 201 ? first : second, loser = winner === first ? second : first;
  const {checkout} = await results.find(row => row.status === 201).json();
  assert.equal(checkout.status, "pending");
  assert.equal(checkout.amountMinor, quote.amountMinor);
  reset();
  const replay = await body(reserveCheckout(namespace, winner));
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.checkout, checkout);
  assert.equal((await body(reserveCheckout(namespace, {...winner, plan: {...plan, credits: 40}}), 409)).code, "idempotency_conflict");
  assert.equal((await body(readCheckout(namespace, {id: checkout.id, subject: loser.subject}), 404)).code, "checkout_not_found");
  assert.equal((await body(readEntitlement(namespace, {subject: winner.subject}))).credits, 0);
  await body(cancelCheckout(namespace, {subject: winner.subject, id: checkout.id}));
  await body(reserveCheckout(namespace, loser), 201);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commerce_orders").get().n, 2);
});

test("quote drift cannot reserve a promotion or start a differently priced checkout under an existing key", async t => {
  const {namespace} = fixture(t);
  await body(savePromotion(namespace, promotion()));
  const {quote} = await body(quoteCheckout(namespace, {subject: reader, plan, promotionCode: "test-code"}));
  await body(savePromotion(namespace, promotion({discountBps: 1000})));
  const initial = request({promotionCode: "test-code", expectedAmountMinor: quote.amountMinor});
  assert.equal((await body(reserveCheckout(namespace, initial), 409)).code, "price_changed");
  assert.equal((await body(listCommerceRecords(namespace))).promotions[0].claimed, 0);
  const current = {...initial, expectedAmountMinor: 901};
  const {checkout} = await body(reserveCheckout(namespace, current), 201);
  await body(savePromotion(namespace, promotion({discountBps: 2500})));
  assert.deepEqual((await body(reserveCheckout(namespace, current))).checkout, checkout);
  assert.equal((await body(reserveCheckout(namespace, initial), 409)).code, "idempotency_conflict");
});

test("pending checkout limits bound promotion holds while allowing exact retries and settled purchases", async t => {
  const {namespace} = fixture(t);
  const original = request();
  const {checkout} = await body(reserveCheckout(namespace, original), 201);
  await body(reserveCheckout(namespace, request()), 201);
  await body(reserveCheckout(namespace, request()), 201);
  assert.equal((await body(reserveCheckout(namespace, request()), 429)).code, "pending_checkout_limit");
  assert.equal((await body(reserveCheckout(namespace, original))).duplicate, true);
  await body(settleCheckout(namespace, purchase(checkout.id)));
  await body(reserveCheckout(namespace, request()), 201);
  await body(reserveCheckout(namespace, request({subject: other})), 201);
});

test("promotion edits cannot lower the cap below already reserved capacity", async t => {
  const {namespace} = fixture(t);
  await body(savePromotion(namespace, promotion({maxRedemptions: 2})));
  const {checkout} = await body(reserveCheckout(namespace, request({promotionCode: "test-code"})), 201);
  await body(reserveCheckout(namespace, request({subject: other, promotionCode: "test-code"})), 201);
  assert.equal((await body(savePromotion(namespace, promotion()), 409)).code, "promotion_limit_below_claimed");
  await body(cancelCheckout(namespace, {id: checkout.id, subject: reader}));
  assert.equal((await body(savePromotion(namespace, promotion()))).promotion.maxRedemptions, 1);
});

test("purchase and cumulative partial refunds bind immutable provider identifiers and adjust credits and affiliate commission exactly once", async t => {
  const {namespace, db, reset} = fixture(t);
  await body(saveAffiliate(namespace, {code: "partner-a", enabled: true, commissionBps: 2000}));
  await body(saveAffiliate(namespace, {code: "partner-b", enabled: true, commissionBps: 3000}));
  const first = await body(reserveCheckout(namespace, request({affiliateCode: "partner-a"})), 201);
  const second = await body(reserveCheckout(namespace, request({affiliateCode: "partner-b"})), 201);
  assert.equal(first.checkout.affiliateCode, "PARTNER-A");
  assert.equal(second.checkout.affiliateCode, "PARTNER-A");
  await body(saveAffiliate(namespace, {code: "partner-a", enabled: false, commissionBps: 10}));
  const event = purchase(first.checkout.id);
  assert.equal((await body(settleCheckout(namespace, {...event, amountMinor: 1000}), 409)).code, "payment_amount_mismatch");
  assert.equal((await body(settleCheckout(namespace, {...event, currency: "EUR"}), 409)).code, "payment_amount_mismatch");
  const responses = await Promise.all([settleCheckout(namespace, event), settleCheckout(namespace, event)]);
  assert.deepEqual((await Promise.all(responses.map(res => body(res)))).map(row => row.duplicate).sort(), [false, true]);
  assert.equal((await body(settleCheckout(namespace, purchase(second.checkout.id, {providerTransactionId: "777", eventId: "v2:purchase:777"})), 409)).code,
    "provider_identity_conflict");
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), {credits: 1003, revision: 1});
  assert.equal((await body(cancelCheckout(namespace, {id: first.checkout.id, subject: reader}))).checkout.status, "paid");
  const partial = refund(first.checkout.id);
  assert.equal((await body(reverseCheckout(namespace, {...partial, parentTransactionId: "191"}), 409)).code, "provider_identity_conflict");
  assert.equal((await body(reverseCheckout(namespace, partial))).checkout.refundedMinor, 371);
  assert.equal((await body(reverseCheckout(namespace, {...partial, amountMinor: 372}), 409)).code, "provider_event_conflict");
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), {credits: 631, revision: 2});
  reset();
  assert.equal((await body(reverseCheckout(namespace, partial))).duplicate, true);
  const report = await body(listCommerceRecords(namespace));
  const order = report.checkouts.find(value => value.id === first.checkout.id);
  assert.equal(order.providerSaleId, "111");
  assert.equal(order.providerTransactionId, "121");
  assert.equal(order.commissionMinor, 126);
  assert.equal(order.commissionBps, 2000);
  assert.equal(order.status, "partially-refunded");
  assert.equal(Object.hasOwn(order, "subject"), false);
  const complete = refund(first.checkout.id, {providerTransactionId: "123", eventId: "v2:credit:123", amountMinor: 630});
  assert.equal((await body(reverseCheckout(namespace, {...complete, amountMinor: 631}), 409)).code, "excess_reversal");
  assert.equal((await body(reverseCheckout(namespace, complete))).checkout.status, "refunded");
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), {credits: 0, revision: 3});
  assert.equal((await body(settleCheckout(namespace, event))).checkout.status, "refunded");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commerce_events").get().n, 3);
});

test("a refund arriving before purchase pins its actual parent and never grants temporary credits", async t => {
  const {namespace} = fixture(t);
  const {checkout} = await body(reserveCheckout(namespace, request()), 201);
  const id = checkout.id;
  const before = refund(id, {amountMinor: 1001});
  assert.equal((await body(reverseCheckout(namespace, before))).checkout.grantedCredits, 0);
  assert.equal((await body(settleCheckout(namespace, purchase(id, {providerSaleId: "191"})), 409)).code, "provider_identity_conflict");
  assert.equal((await body(settleCheckout(namespace, purchase(id)))).checkout.status, "refunded");
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), {credits: 0, revision: 0});
  const duplicate = await body(reverseCheckout(namespace, before));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.checkout.status, "refunded");
});

test("a late signed sale settles only if its expired promotion capacity remains available", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const {namespace} = fixture(t);
  await body(savePromotion(namespace, promotion()));
  const original = request({promotionCode: "test-code"});
  const first = (await body(reserveCheckout(namespace, original), 201)).checkout;
  now = first.expiresAt;
  assert.equal((await body(reserveCheckout(namespace, original))).checkout.status, "expired");
  const pipelined = (await body(reserveCheckout(namespace, request({subject: other, promotionCode: "test-code"})), 201)).checkout;
  const held = purchase(first.id, {amountMinor: 876});
  assert.equal((await body(settleCheckout(namespace, held), 409)).code, "promotion_exhausted");
  assert.equal((await body(settleCheckout(namespace, held), 409)).code, "promotion_exhausted");
  const history = (await body(listCommerceRecords(namespace))).checkouts.find(row => row.id === first.id);
  assert.equal(history.status, "requires-review");
  assert.equal(history.providerSaleId, "111");
  const otherPurchase = purchase(pipelined.id, {amountMinor: 876, providerTransactionId: "153", providerSaleId: "124", eventId: "v2:purchase:153"});
  assert.equal((await body(settleCheckout(namespace, otherPurchase))).checkout.status, "paid");
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), {credits: 0, revision: 0});
  assert.deepEqual(await body(readEntitlement(namespace, {subject: other})), {credits: 1003, revision: 1});
  const pending = (await body(reserveCheckout(namespace, request()), 201)).checkout;
  now = pending.expiresAt;
  const late = await body(settleCheckout(namespace, purchase(pending.id, {providerSaleId: "125", providerTransactionId: "154", eventId: "v2:purchase:154"})));
  assert.equal(late.checkout.status, "paid");
});

test("explicit close, chargeback and provider identity conflicts fail safely", async t => {
  const {namespace} = fixture(t);
  const {checkout: closed} = await body(reserveCheckout(namespace, request()), 201);
  const {checkout} = await body(reserveCheckout(namespace, request()), 201);
  await body(cancelCheckout(namespace, {id: closed.id, subject: reader}));
  assert.equal((await body(settleCheckout(namespace, purchase(closed.id)), 409)).code, "checkout_closed");
  const paid = purchase(checkout.id, {providerSaleId: "222", providerTransactionId: "231", eventId: "v2:purchase:231"});
  await body(settleCheckout(namespace, paid));
  const chargeback = refund(checkout.id, {providerSaleId: "222", providerTransactionId: "232", parentTransactionId: "231",
    eventId: "v2:chargeback:232", amountMinor: 1001, reason: "chargeback"});
  assert.equal((await body(reverseCheckout(namespace, {...chargeback, amountMinor: 500}), 409)).code, "payment_amount_mismatch");
  assert.equal((await body(reverseCheckout(namespace, chargeback))).checkout.status, "charged-back");
  assert.equal((await body(reverseCheckout(namespace, {...chargeback, providerTransactionId: "233", eventId: "v2:chargeback:233"}), 409)).code,
    "excess_reversal");
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), {credits: 0, revision: 2});
});

test("missing binding and malformed server commands fail closed without retaining purchase metadata", async t => {
  const {namespace, db} = fixture(t);
  assert.equal((await body(readEntitlement({}, {subject: reader}), 503)).code, "commerce_unavailable");
  assert.equal((await body(reserveCheckout(namespace, request({plan: {...plan, currency: "usd"}})), 400)).code, "invalid_commerce_request");
  assert.equal((await body(reserveCheckout(namespace, request({plan: {...plan, credits: 1.5}})), 400)).code, "invalid_commerce_request");
  assert.equal((await body(reserveCheckout(namespace, request({subscriberEmail: "synthetic@example.invalid"})), 400)).code, "invalid_commerce_request");
  assert.equal((await body(readEntitlement(namespace, {subject: "synthetic@example.invalid"}), 400)).code, "invalid_commerce_request");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commerce_orders").get().n, 0);
});
