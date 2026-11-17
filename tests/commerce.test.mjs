import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {cancelCheckout, launchCommerceNamespace, listCommerceRecords, quoteCheckout, readCheckout, readEntitlement, reconcilePayments, reserveCheckout,
  readStripePayment, readSubscription, reverseCheckout, SatinLoreCommerce, saveAffiliate, savePromotion, settleCheckout, settleSubscription,
  updateSubscriptionLifecycle} from "../deploy/cloudflare/commerce.mjs";

const reader = `account:v1:${"a".repeat(64)}`;
const other = `account:v1:${"b".repeat(64)}`;
const unit = "nano_usd";
const plan = {id: "test-plan", currency: "USD", amountMinor: 1001, credits: 1003, unit};
const monthly = {id: "monthly", currency: "USD", amountMinor: 999, credits: 2_000_000_000, kind: "monthly", unit};
const balance = (credits, revision) => ({credits, revision, unit, subscription: null, subscriptionGrants: []});
const request = (changes = {}) => ({subject: reader, plan, idempotencyKey: crypto.randomUUID(), ...changes});
const purchase = (id, changes = {}) => ({id, currency: "USD", amountMinor: 1001, providerSaleId: "111",
  providerTransactionId: "121", eventId: "v2:purchase:121", ...changes});
const refund = (id, changes = {}) => ({id, currency: "USD", amountMinor: 371, providerSaleId: "111",
  providerTransactionId: "122", parentTransactionId: "121", reason: "refund", kind: "one-time", eventId: "v2:credit:122", ...changes});
const utc = date => Date.parse(`${date}T00:00:00Z`);
const monthlySale = (id, periodEnd, transaction, renewal = false, changes = {}) => ({id, currency: "USD", amountMinor: 999,
  providerSaleId: "201", providerTransactionId: transaction, eventId: `verotel:${transaction}`, periodEnd, renewal, ...changes});
const lifecycle = (id, event, periodEnd, key = event) => ({id, providerSaleId: "201", event, periodEnd, eventId: `test:lifecycle:${key}`});

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
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), balance(1003, 1));
  assert.equal((await body(cancelCheckout(namespace, {id: first.checkout.id, subject: reader}))).checkout.status, "paid");
  const partial = refund(first.checkout.id);
  assert.equal((await body(reverseCheckout(namespace, {...partial, parentTransactionId: "191"}), 409)).code, "provider_identity_conflict");
  assert.equal((await body(reverseCheckout(namespace, partial))).checkout.refundedMinor, 371);
  assert.equal((await body(reverseCheckout(namespace, {...partial, amountMinor: 372}), 409)).code, "provider_event_conflict");
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), balance(631, 2));
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
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), balance(0, 3));
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
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), balance(0, 0));
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
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), balance(0, 0));
  assert.deepEqual(await body(readEntitlement(namespace, {subject: other})), balance(1003, 1));
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
  assert.deepEqual(await body(readEntitlement(namespace, {subject: reader})), balance(0, 2));
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

test("verified initial and month-end rebill grant separate paid periods and keep one-time balance independent", async t => {
  let now = utc("2027-01-31") + 14_400_000;
  t.mock.method(Date, "now", () => now);
  const {namespace, reset} = fixture(t);
  await body(saveAffiliate(namespace, {code: "creator", commissionBps: 2000, enabled: true}));
  const input = request({plan: monthly, affiliateCode: "CREATOR"});
  const {checkout} = await body(reserveCheckout(namespace, input), 201);
  assert.equal((await body(reserveCheckout(namespace, input))).duplicate, true);
  assert.equal((await body(reserveCheckout(namespace, request({plan: monthly})), 409)).code, "subscription_exists");
  const {checkout: topUp} = await body(reserveCheckout(namespace, request()), 201);
  await body(settleCheckout(namespace, purchase(topUp.id)));
  assert.equal((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants.length, 0);
  const first = monthlySale(checkout.id, utc("2027-02-28"), "211");
  assert.equal((await body(settleCheckout(namespace, purchase(checkout.id)), 409)).code, "checkout_payment_kind_mismatch");
  await body(settleSubscription(namespace, first));
  assert.equal((await body(settleSubscription(namespace, first))).duplicate, true);
  assert.equal((await body(settleSubscription(namespace, {...first, periodEnd: utc("2027-02-27")}), 409)).code, "provider_event_conflict");
  let entitlement = await body(readEntitlement(namespace, {subject: reader}));
  assert.equal(entitlement.unit, unit);
  assert.equal(entitlement.credits, plan.credits);
  assert.equal(entitlement.revision, 2);
  assert.deepEqual(entitlement.subscriptionGrants, [{id: `${checkout.id}:${first.periodEnd}`, startsAt: now, endsAt: first.periodEnd, credits: monthly.credits}]);
  assert.equal(Object.hasOwn(entitlement.subscription, "providerSaleId"), false);
  assert.equal((await body(readSubscription(namespace, {subject: reader}))).subscription.providerSaleId, "201");
  assert.equal((await body(readSubscription(namespace, {subject: other}))).subscription, null);
  now = utc("2027-02-28") - 60_000;
  const renewed = monthlySale(checkout.id, utc("2027-03-31"), "212", true);
  await body(settleSubscription(namespace, renewed));
  reset();
  assert.equal((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants[0].endsAt, first.periodEnd);
  now = first.periodEnd;
  entitlement = await body(readEntitlement(namespace, {subject: reader}));
  assert.deepEqual(entitlement.subscriptionGrants, [{id: `${checkout.id}:${renewed.periodEnd}`, startsAt: first.periodEnd,
    endsAt: renewed.periodEnd, credits: monthly.credits}]);
  assert.equal(entitlement.credits, plan.credits);
  const charges = (await body(listCommerceRecords(namespace))).subscriptionCharges;
  assert.deepEqual(charges.map(row => [row.affiliateCode, row.commissionMinor]), [["CREATOR", 0], ["CREATOR", 199]]);
});

test("cancel and expiry keep the paid period while extend never grants additional included funds", async t => {
  let now = utc("2027-03-30");
  t.mock.method(Date, "now", () => now);
  const {namespace} = fixture(t);
  const {checkout} = await body(reserveCheckout(namespace, request({plan: monthly})), 201);
  const first = monthlySale(checkout.id, utc("2027-04-30"), "211");
  await body(settleSubscription(namespace, first));
  const stop = lifecycle(checkout.id, "cancel", first.periodEnd);
  const {subscription} = await body(updateSubscriptionLifecycle(namespace, stop));
  assert.equal(subscription.status, "cancelled");
  assert.equal(subscription.paidThrough, first.periodEnd);
  assert.equal(subscription.renews, false);
  assert.equal((await body(updateSubscriptionLifecycle(namespace, stop))).duplicate, true);
  assert.equal((await body(updateSubscriptionLifecycle(namespace, {...stop, periodEnd: utc("2027-04-29")}), 409)).code, "provider_event_conflict");
  const extend = lifecycle(checkout.id, "extend", utc("2027-05-04"));
  assert.equal((await body(updateSubscriptionLifecycle(namespace, extend))).subscription.paidThrough, first.periodEnd);
  // Identical dates do not establish whether an uncancel followed or preceded a cancellation.
  assert.equal((await body(updateSubscriptionLifecycle(namespace, lifecycle(checkout.id, "uncancel", first.periodEnd)))).subscription.status,
    "cancelled");
  assert.equal((await body(reserveCheckout(namespace, request({plan: monthly})), 409)).code, "subscription_exists");
  now = first.periodEnd - 1;
  assert.equal((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants.length, 1);
  now = first.periodEnd;
  const rebill = monthlySale(checkout.id, utc("2027-05-30"), "212", true);
  assert.equal((await body(settleSubscription(namespace, rebill), 409)).code, "subscription_renewal_closed");
  assert.equal((await body(updateSubscriptionLifecycle(namespace, lifecycle(checkout.id, "expire", null)))).subscription.status, "expired");
  assert.equal((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants.length, 0);
  await body(reserveCheckout(namespace, request({plan: monthly})), 201);
});

test("out-of-order rebills wait for a connected paid date, without granting two balances or overlapping a short month", async t => {
  let now = utc("2027-01-31");
  t.mock.method(Date, "now", () => now);
  const {namespace} = fixture(t);
  const {checkout} = await body(reserveCheckout(namespace, request({plan: monthly})), 201);
  const initial = monthlySale(checkout.id, utc("2027-02-28"), "211");
  await body(settleSubscription(namespace, initial));
  now = utc("2027-03-31");
  const later = monthlySale(checkout.id, utc("2027-04-30"), "213", true);
  await body(settleSubscription(namespace, later));
  let snapshot = await body(readEntitlement(namespace, {subject: reader}));
  assert.equal(snapshot.subscription.status, "past-due");
  assert.equal(snapshot.subscription.paidThrough, initial.periodEnd);
  assert.deepEqual(snapshot.subscriptionGrants, []);
  const intervening = monthlySale(checkout.id, utc("2027-03-31"), "212", true);
  await body(settleSubscription(namespace, intervening));
  snapshot = await body(readEntitlement(namespace, {subject: reader}));
  assert.deepEqual(snapshot.subscriptionGrants, [{id: `${checkout.id}:${later.periodEnd}`, startsAt: intervening.periodEnd,
    endsAt: later.periodEnd, credits: monthly.credits}]);
  assert.equal((await body(settleSubscription(namespace, later))).duplicate, true);
  const overlap = monthlySale(checkout.id, utc("2027-04-29"), "214", true);
  assert.equal((await body(settleSubscription(namespace, overlap), 409)).code, "subscription_period_conflict");
});

test("signed extend anchors a shifted renewal only after a separate verified payment", async t => {
  let now = utc("2027-01-01");
  t.mock.method(Date, "now", () => now);
  const {namespace} = fixture(t);
  const {checkout} = await body(reserveCheckout(namespace, request({plan: monthly})), 201);
  const first = monthlySale(checkout.id, utc("2027-02-01"), "211");
  await body(settleSubscription(namespace, first));
  const extension = lifecycle(checkout.id, "extend", utc("2027-02-06"));
  const rebill = monthlySale(checkout.id, utc("2027-03-06"), "212", true);
  now = first.periodEnd;
  assert.deepEqual((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants, []);
  now = extension.periodEnd;
  await body(settleSubscription(namespace, rebill));
  assert.deepEqual((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants, []);
  assert.equal((await body(listCommerceRecords(namespace))).subscriptionCharges[0].status, "pending-period-link");
  const attention = await body(reconcilePayments(namespace, {attention: true, reference: rebill.providerTransactionId}));
  assert.equal(attention.orders[0].id, checkout.id);
  assert.deepEqual(attention.transactions.map(row => [row.providerTransactionId, row.kind, row.needsReview]), [
    [rebill.providerTransactionId, "subscription-rebill", true],
  ]);
  const before = (await body(readEntitlement(namespace, {subject: reader}))).revision;
  await body(updateSubscriptionLifecycle(namespace, extension));
  const result = await body(readEntitlement(namespace, {subject: reader}));
  assert.deepEqual(result.subscriptionGrants, [{id: `${checkout.id}:${rebill.periodEnd}`, credits: monthly.credits,
    startsAt: extension.periodEnd, endsAt: rebill.periodEnd}]);
  assert.equal(result.revision, before + 1);
  assert.equal((await body(listCommerceRecords(namespace))).subscriptionCharges[0].status, "linked");
  assert.deepEqual((await body(reconcilePayments(namespace, {attention: true}))).transactions, []);
  assert.equal((await body(updateSubscriptionLifecycle(namespace, extension))).duplicate, true);
  assert.equal((await body(readEntitlement(namespace, {subject: reader}))).revision, result.revision);
});

test("monthly reversal is scoped to its signed parent and handles a terminated refund before payment", async t => {
  let now = utc("2027-04-30");
  t.mock.method(Date, "now", () => now);
  const {namespace} = fixture(t);
  const {checkout} = await body(reserveCheckout(namespace, request({plan: monthly})), 201);
  const first = monthlySale(checkout.id, utc("2027-05-30"), "211");
  await body(settleSubscription(namespace, first));
  now = first.periodEnd;
  const second = monthlySale(checkout.id, utc("2027-06-30"), "212", true);
  await body(settleSubscription(namespace, second));
  const credit = refund(checkout.id, {kind: "monthly", providerSaleId: "201", providerTransactionId: "217",
    parentTransactionId: "211", eventId: "verotel:217", amountMinor: 499});
  assert.equal((await body(reverseCheckout(namespace, {...credit, kind: "one-time"}), 409)).code, "checkout_payment_kind_mismatch");
  await body(reverseCheckout(namespace, credit));
  assert.equal((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants[0].credits, monthly.credits);
  const upcoming = monthlySale(checkout.id, utc("2027-07-30"), "213", true);
  now = utc("2027-06-30");
  const terminated = {...credit, parentTransactionId: "213", providerTransactionId: "218", eventId: "verotel:218", terminated: true,
    amountMinor: 999};
  await body(reverseCheckout(namespace, terminated));
  assert.equal((await body(reverseCheckout(namespace, {...terminated, terminated: false}), 409)).code, "provider_event_conflict");
  await body(settleSubscription(namespace, upcoming));
  const recovered = await body(readEntitlement(namespace, {subject: reader}));
  assert.equal(recovered.subscription.status, "expired");
  assert.equal(recovered.subscription.renews, false);
  assert.deepEqual(recovered.subscriptionGrants, []);
  assert.equal((await body(listCommerceRecords(namespace))).subscriptionCharges[0].refundedMinor, 999);
});

test("superseded recurring checkout is preserved for review and legacy token rows never become money", async t => {
  let now = utc("2027-05-01");
  t.mock.method(Date, "now", () => now);
  const {namespace, db} = fixture(t);
  const {checkout: old} = await body(reserveCheckout(namespace, request({plan: monthly})), 201);
  now = old.expiresAt;
  const {checkout: current} = await body(reserveCheckout(namespace, request({plan: monthly})), 201);
  const cancelled = monthlySale(old.id, utc("2027-06-01"), "211");
  assert.equal((await body(settleSubscription(namespace, cancelled), 409)).code, "subscription_exists");
  assert.equal((await body(settleSubscription(namespace, cancelled), 409)).code, "subscription_exists");
  assert.equal((await body(readSubscription(namespace, {subject: reader}))).subscription.id, current.id);
  db.prepare("INSERT INTO commerce_entitlements VALUES (?,?,?)").run(reader, 100_000, 6);
  const {checkout: legacy} = await body(reserveCheckout(namespace, request()), 201);
  db.prepare("UPDATE commerce_orders SET grant_unit='legacy_tokens' WHERE id=?").run(legacy.id);
  assert.equal((await body(settleCheckout(namespace, purchase(legacy.id)), 409)).code, "checkout_legacy_units");
  assert.equal((await body(readEntitlement(namespace, {subject: reader}))).credits, 0);
});

test("Stripe checkout pins the provider; object retries, payment lookup and a partial reversal preserve cents and isolate orders", async t => {
  const {namespace} = fixture(t);
  const initial = request({provider: "stripe"});
  const {checkout} = await body(reserveCheckout(namespace, initial), 201);
  const {checkout: otherOrder} = await body(reserveCheckout(namespace, request({provider: "stripe", subject: other})), 201);
  assert.equal(checkout.expiresAt - checkout.createdAt, 35 * 60_000);
  assert.equal((await body(reserveCheckout(namespace, {...initial, provider: "verotel"}), 409)).code, "idempotency_conflict");
  assert.equal((await body(settleCheckout(namespace, purchase(checkout.id)), 409)).code, "checkout_provider_mismatch");
  const captured = purchase(checkout.id, {providerSaleId: "pi_Checkout", providerTransactionId: "ch_Purchase",
    paymentId: "pi_Checkout", eventId: "stripe:evt_paid"});
  await body(settleCheckout(namespace, captured));
  assert.equal((await body(settleCheckout(namespace, {...captured, eventId: "stripe:evt_copy"}))).duplicate, true);
  assert.equal((await body(settleCheckout(namespace, {...captured, eventId: "stripe:evt_other", id: otherOrder.id,
    providerSaleId: "pi_Other", providerTransactionId: "ch_Other"}), 409)).code, "provider_identity_conflict");
  assert.deepEqual((await body(readStripePayment(namespace, {paymentId: "pi_Checkout"}))).payment, {
    id: checkout.id, providerSaleId: "pi_Checkout", providerTransactionId: "ch_Purchase", kind: "one-time",
    currency: "USD", amountMinor: 1001,
  });
  assert.equal((await body(readStripePayment(namespace, {paymentId: "pi_checkout"}))).payment, null);
  const credited = refund(checkout.id, {providerSaleId: captured.providerSaleId, parentTransactionId: captured.providerTransactionId,
    providerTransactionId: "re_Credit", eventId: "stripe:evt_refund", amountMinor: 200});
  await body(reverseCheckout(namespace, credited));
  assert.equal((await body(reverseCheckout(namespace, {...credited, providerTransactionId: "du_Lost", eventId: "stripe:evt_dispute",
    reason: "chargeback", amountMinor: 100}))).checkout.grantedCredits, 702);
  assert.deepEqual((await body(readEntitlement(namespace, {subject: other}))).credits, 0);
  const history = await body(reconcilePayments(namespace, {reference: "re_Credit"}));
  assert.equal(history.orders[0].provider, "stripe");
  assert.deepEqual(history.transactions.map(row => row.amountMinor).sort((a, b) => a - b), [-200, -100, 1001]);
});

test("Stripe uses authoritative paid invoice timestamps, renews on one exact boundary and ignores stale cancellation updates", async t => {
  let now = utc("2027-01-31") + 13 * 3_600_000;
  t.mock.method(Date, "now", () => now);
  const {namespace} = fixture(t);
  const {checkout} = await body(reserveCheckout(namespace, request({provider: "stripe", plan: monthly})), 201);
  const end = utc("2027-02-28") + 13 * 3_600_000;
  const first = monthlySale(checkout.id, end, "in_First", false, {providerSaleId: "sub_Monthly",
    paymentId: "pi_First", eventId: "stripe:evt_first", periodStart: now});
  const renewal = monthlySale(checkout.id, utc("2027-03-31") + 13 * 3_600_000, "in_Renew", true, {providerSaleId: "sub_Monthly",
    paymentId: "pi_Renew", eventId: "stripe:evt_renew", periodStart: end});
  now = end;
  await body(settleSubscription(namespace, renewal));
  assert.deepEqual((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants, []);
  await body(settleSubscription(namespace, first));
  assert.deepEqual((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants.map(row => [row.startsAt, row.endsAt, row.credits]),
    [[end, renewal.periodEnd, monthly.credits]]);
  assert.equal((await body(readStripePayment(namespace, {paymentId: "pi_Renew"}))).payment.providerTransactionId, "in_Renew");
  assert.equal((await body(settleSubscription(namespace, {...renewal, paymentId: "pi_Overlap", providerTransactionId: "in_Overlap",
    eventId: "stripe:evt_overlap", periodStart: end + 1_000}), 409)).code, "subscription_period_conflict");
  const stopped = {id: checkout.id, providerSaleId: "sub_Monthly", eventId: "stripe:evt_cancel", event: "cancel",
    periodEnd: renewal.periodEnd, occurredAt: now};
  await body(updateSubscriptionLifecycle(namespace, stopped));
  await body(updateSubscriptionLifecycle(namespace, {...stopped, event: "uncancel", eventId: "stripe:evt_old", occurredAt: now - 1_000}));
  const {subscription} = await body(readSubscription(namespace, {subject: reader}));
  assert.equal(subscription.status, "cancelled");
  assert.equal(subscription.renews, false);
  assert.equal(subscription.paidThrough, renewal.periodEnd);
  assert.equal(subscription.provider, "stripe");
  const reversed = refund(checkout.id, {providerSaleId: "sub_Monthly", providerTransactionId: "re_Renewal", parentTransactionId: "in_Renew",
    eventId: "stripe:evt_renewrefund", amountMinor: 999, kind: "monthly"});
  await body(reverseCheckout(namespace, reversed));
  assert.deepEqual((await body(readEntitlement(namespace, {subject: reader}))).subscriptionGrants, []);
});

test("Stripe rejects an order below the USD card minimum before reserving a promo", async t => {
  const {namespace, db} = fixture(t);
  await body(savePromotion(namespace, promotion({discountBps: 9_999})));
  const input = request({provider: "stripe", promotionCode: "TEST-CODE"});
  const {idempotencyKey, ...quote} = input;
  assert.equal((await body(quoteCheckout(namespace, quote), 409)).code, "payment_below_minimum");
  assert.equal((await body(reserveCheckout(namespace, input), 409)).code, "payment_below_minimum");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commerce_orders").get().n, 0);
});

test("Stripe test checkout and entitlement addressing is separate from the launch ledger", async t => {
  const live = fixture(t).namespace;
  const isolated = fixture(t).namespace;
  const names = [];
  const binding = {idFromName: name => { names.push(name); return name; }, get: name => name === "launch" ? live.get(name) : isolated.get(name)};
  const env = {COMMERCE: binding, LAUNCH_PAYMENT_PROVIDER: "stripe", STRIPE_MODE: "test"};
  const testRealm = launchCommerceNamespace(env);
  const {checkout} = await body(reserveCheckout(testRealm, request({provider: "stripe"})), 201);
  await body(settleCheckout(testRealm, purchase(checkout.id, {providerSaleId: "pi_Test", providerTransactionId: "ch_Test",
    paymentId: "pi_Test", eventId: "stripe:evt_test"})));
  assert.equal((await body(readEntitlement(launchCommerceNamespace({...env, STRIPE_MODE: "live"}), {subject: reader}))).credits, 0);
  assert.equal((await body(readEntitlement(testRealm, {subject: reader}))).credits, plan.credits);
  assert.deepEqual(names, ["stripe-test:launch", "stripe-test:launch", "launch", "stripe-test:launch"]);
});
