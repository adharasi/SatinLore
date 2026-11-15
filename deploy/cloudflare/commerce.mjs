// Internal SQLite commerce ledger. The Worker supplies a verified reader or a verified provider postback.
const CHECKOUT_MS = 30 * 60_000;
const ATTRIBUTION_MS = 30 * 24 * 60 * 60_000;
const PENDING_LIMIT = 3;
const MAX_VALUE = 100_000_000;
const SUBJECT = /^account:v1:[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/u;
const PLAN = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const PROVIDER_ID = /^[1-9][0-9]{0,29}$/u;
const EVENT = /^[A-Za-z0-9:_-]{1,128}$/u;
const code = value => typeof value === "string" ? value.trim().toUpperCase() : value;
const matches = (value, pattern) => typeof value === "string" && pattern.test(value);
const number = (value, minimum = 1, maximum = MAX_VALUE) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const timestamp = value => number(value, 0, 8_640_000_000_000_000);
const json = (value, status = 200) => Response.json(value, {status, headers: {"Cache-Control": "no-store"}});
const appliedStatuses = new Set(["paid", "partially-refunded", "refunded", "charged-back"]);

class CommerceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
}

function check(condition, error = "invalid_commerce_request", status = 400) {
  if (!condition) throw new CommerceError(error, status);
}

function shape(value, required, optional = []) {
  check(value && typeof value === "object" && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}

function checkoutInput(value, reserve) {
  const optional = reserve ? ["promotionCode", "affiliateCode", "expectedAmountMinor"] : ["promotionCode", "affiliateCode"];
  shape(value, reserve ? ["subject", "plan", "idempotencyKey"] : ["subject", "plan"], optional);
  const {subject, plan, idempotencyKey, expectedAmountMinor} = value;
  shape(plan, ["id", "currency", "amountMinor", "credits"]);
  const promotion = code(value.promotionCode ?? null), affiliate = code(value.affiliateCode ?? null);
  check(matches(subject, SUBJECT) && (!reserve || matches(idempotencyKey, UUID)) && matches(plan.id, PLAN) && matches(plan.currency, CURRENCY) &&
    number(plan.amountMinor) && number(plan.credits) && (promotion === null || matches(promotion, CODE)) &&
    (affiliate === null || matches(affiliate, CODE)) && (expectedAmountMinor === undefined || number(expectedAmountMinor)));
  return {subject, plan, idempotencyKey, expectedAmountMinor, promotion, affiliate};
}

function ownerInput(input) {
  shape(input, ["subject", "id"]);
  check(matches(input.subject, SUBJECT) && matches(input.id, UUID));
  return input;
}

function providerInput(value, reversal) {
  const keys = ["id", "eventId", "providerSaleId", "providerTransactionId", "amountMinor", "currency"];
  shape(value, reversal ? [...keys, "parentTransactionId", "reason"] : keys);
  check(matches(value.id, UUID) && matches(value.eventId, EVENT) && matches(value.providerSaleId, PROVIDER_ID) &&
    matches(value.providerTransactionId, PROVIDER_ID) && number(value.amountMinor) && matches(value.currency, CURRENCY) &&
    (!reversal || matches(value.parentTransactionId, PROVIDER_ID) && value.parentTransactionId !== value.providerTransactionId &&
      ["refund", "chargeback"].includes(value.reason)));
  return {...value, kind: reversal ? value.reason : "purchase", purchaseId: reversal ? value.parentTransactionId : value.providerTransactionId};
}

function orderSummary(row, now, admin = false) {
  const status = row.status === "pending" && row.expires_at <= now ? "expired" : row.status;
  return {id: row.id, planId: row.plan, status, currency: row.currency, regularAmountMinor: row.regular_amount,
    amountMinor: row.amount, credits: row.credits, grantedCredits: row.granted_credits, refundedMinor: row.refunded_amount,
    promotionCode: row.promo, affiliateCode: row.affiliate, createdAt: row.created_at, expiresAt: row.expires_at,
    ...(admin ? {providerSaleId: row.sale_id, providerTransactionId: row.purchase_id, commissionBps: row.commission_bps,
      commissionMinor: row.commission_amount, reviewReason: row.review_reason, settledAt: row.settled_at} : {})};
}

export class SatinLoreCommerce {
  constructor({storage}) {
    this.storage = storage;
    this.sql = storage.sql;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;
    this.storage.transactionSync(() => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS commerce_promotions (
        code TEXT PRIMARY KEY, discount_bps INTEGER NOT NULL, max_redemptions INTEGER NOT NULL,
        valid_from INTEGER NOT NULL, valid_until INTEGER NOT NULL, enabled INTEGER NOT NULL, plan TEXT)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS commerce_affiliates (
        code TEXT PRIMARY KEY, commission_bps INTEGER NOT NULL, enabled INTEGER NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS commerce_attribution (
        subject TEXT PRIMARY KEY, affiliate TEXT NOT NULL REFERENCES commerce_affiliates(code), expires_at INTEGER NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS commerce_orders (
        id TEXT PRIMARY KEY, subject TEXT NOT NULL, request_id TEXT NOT NULL, request_promo TEXT, request_affiliate TEXT,
        plan TEXT NOT NULL, currency TEXT NOT NULL, regular_amount INTEGER NOT NULL, amount INTEGER NOT NULL, credits INTEGER NOT NULL,
        promo TEXT REFERENCES commerce_promotions(code), affiliate TEXT REFERENCES commerce_affiliates(code), commission_bps INTEGER NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL, sale_id TEXT UNIQUE, purchase_id TEXT UNIQUE,
        settled_at INTEGER, refunded_amount INTEGER NOT NULL DEFAULT 0, granted_credits INTEGER NOT NULL DEFAULT 0,
        commission_amount INTEGER NOT NULL DEFAULT 0, review_reason TEXT, UNIQUE(subject,request_id))`);
      this.sql.exec("CREATE INDEX IF NOT EXISTS commerce_orders_promo ON commerce_orders(promo,status,expires_at)");
      this.sql.exec("CREATE INDEX IF NOT EXISTS commerce_orders_recent ON commerce_orders(created_at DESC,id DESC)");
      this.sql.exec(`CREATE TABLE IF NOT EXISTS commerce_events (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES commerce_orders(id), kind TEXT NOT NULL,
        sale_id TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, purchase_id TEXT NOT NULL,
        amount INTEGER NOT NULL, currency TEXT NOT NULL, recorded_at INTEGER NOT NULL)`);
      this.sql.exec("CREATE INDEX IF NOT EXISTS commerce_events_order ON commerce_events(order_id,kind)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS commerce_entitlements (subject TEXT PRIMARY KEY, credits INTEGER NOT NULL, revision INTEGER NOT NULL)");
    });
    this.initialized = true;
  }

  rows(query, ...values) { return this.sql.exec(query, ...values).toArray(); }
  row(query, ...values) { return this.rows(query, ...values)[0]; }
  order(id) { return this.row("SELECT * FROM commerce_orders WHERE id=?", id); }

  promotionUses(promotion, now, excluded = "") {
    return this.row(`SELECT COUNT(*) count FROM commerce_orders WHERE promo=? AND id<>? AND (
      status IN ('paid','partially-refunded','refunded','charged-back') OR (status='pending' AND expires_at>?))`, promotion, excluded, now).count;
  }

  affiliate(subject, requested, now) {
    const sticky = this.row(`SELECT a.code,a.commission_bps FROM commerce_attribution t JOIN commerce_affiliates a ON a.code=t.affiliate
      WHERE t.subject=? AND t.expires_at>? AND a.enabled=1`, subject, now);
    if (sticky) return sticky;
    return requested && this.row("SELECT code,commission_bps FROM commerce_affiliates WHERE code=? AND enabled=1", requested);
  }

  terms(input, now) {
    const {subject, plan, promotion, affiliate} = input;
    const promo = promotion && this.row(`SELECT * FROM commerce_promotions WHERE code=? AND enabled=1 AND valid_from<=? AND valid_until>?
      AND (plan IS NULL OR plan=?)`, promotion, now, now, plan.id);
    if (promotion) {
      check(promo, "promotion_unavailable", 409);
      check(this.promotionUses(promotion, now) < promo.max_redemptions, "promotion_exhausted", 409);
    }
    const referral = this.affiliate(subject, affiliate, now);
    const discount = promo ? Math.floor(plan.amountMinor * promo.discount_bps / 10_000) : 0;
    return {planId: plan.id, currency: plan.currency, regularAmountMinor: plan.amountMinor, amountMinor: plan.amountMinor - discount,
      credits: plan.credits, promotionCode: promo?.code ?? null, affiliateCode: referral?.code ?? null, commissionBps: referral?.commission_bps ?? 0};
  }

  quoteCheckout(value, now) {
    const {commissionBps, ...quote} = this.terms(checkoutInput(value, false), now);
    return json({quote});
  }

  reserveCheckout(value, now) {
    const input = checkoutInput(value, true);
    const {subject, idempotencyKey, expectedAmountMinor, plan, promotion, affiliate} = input;
    const old = this.row("SELECT * FROM commerce_orders WHERE subject=? AND request_id=?", subject, idempotencyKey);
    if (old) {
      check(old.plan === plan.id && old.currency === plan.currency && old.regular_amount === plan.amountMinor && old.credits === plan.credits &&
        old.request_promo === promotion && old.request_affiliate === affiliate &&
        (expectedAmountMinor === undefined || expectedAmountMinor === old.amount), "idempotency_conflict", 409);
      return json({checkout: orderSummary(old, now), duplicate: true});
    }
    const {count: currentHolds} = this.row("SELECT COUNT(*) AS count FROM commerce_orders WHERE subject=? AND status='pending' AND expires_at>?", subject, now);
    check(currentHolds < PENDING_LIMIT, "pending_checkout_limit", 429);
    const quote = this.terms(input, now), id = crypto.randomUUID();
    check(expectedAmountMinor === undefined || expectedAmountMinor === quote.amountMinor, "price_changed", 409);
    if (quote.affiliateCode) {
      this.sql.exec(`INSERT INTO commerce_attribution(subject,affiliate,expires_at) VALUES(?,?,?) ON CONFLICT(subject) DO UPDATE SET
        affiliate=excluded.affiliate,expires_at=excluded.expires_at WHERE commerce_attribution.expires_at<=? OR
        NOT EXISTS (SELECT 1 FROM commerce_affiliates WHERE code=commerce_attribution.affiliate AND enabled=1)`,
      subject, quote.affiliateCode, now + ATTRIBUTION_MS, now);
    }
    this.sql.exec(`INSERT INTO commerce_orders(id,subject,request_id,request_promo,request_affiliate,plan,currency,regular_amount,amount,
      credits,promo,affiliate,commission_bps,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`,
    id, subject, idempotencyKey, promotion, affiliate, plan.id, quote.currency, quote.regularAmountMinor, quote.amountMinor,
    quote.credits, quote.promotionCode, quote.affiliateCode, quote.commissionBps, now, now + CHECKOUT_MS);
    return json({checkout: orderSummary(this.order(id), now), duplicate: false}, 201);
  }

  readCheckout(value, now, cancel = false) {
    const {id, subject} = ownerInput(value);
    const row = this.order(id);
    check(row?.subject === subject, "checkout_not_found", 404);
    if (cancel && row.status === "pending") this.sql.exec("UPDATE commerce_orders SET status='cancelled' WHERE id=?", id);
    return json({checkout: orderSummary(cancel ? this.order(id) : row, now)});
  }

  ensureProviderIdentity(event, order) {
    const claimed = this.row("SELECT id FROM commerce_orders WHERE (sale_id=? OR purchase_id=?) AND id<>?",
      event.providerSaleId, event.purchaseId, order.id);
    check(!claimed && (order.sale_id === null || order.sale_id === event.providerSaleId) &&
      (order.purchase_id === null || order.purchase_id === event.purchaseId), "provider_identity_conflict", 409);
    if (event.kind !== "purchase") {
      check(!this.row("SELECT id FROM commerce_orders WHERE purchase_id=?", event.providerTransactionId), "provider_identity_conflict", 409);
      const parent = this.row("SELECT order_id,kind FROM commerce_events WHERE transaction_id=?", event.purchaseId);
      check(!parent || parent.kind === "purchase" && parent.order_id === order.id, "provider_identity_conflict", 409);
    }
    this.sql.exec("UPDATE commerce_orders SET sale_id=?,purchase_id=? WHERE id=?", event.providerSaleId, event.purchaseId, order.id);
  }

  duplicateEvent(event) {
    const old = this.rows("SELECT * FROM commerce_events WHERE id=? OR transaction_id=?", event.eventId, event.providerTransactionId);
    if (!old.length) return false;
    check(old.length === 1 && old[0].id === event.eventId && old[0].order_id === event.id && old[0].kind === event.kind &&
      old[0].sale_id === event.providerSaleId && old[0].transaction_id === event.providerTransactionId && old[0].purchase_id === event.purchaseId &&
      old[0].amount === event.amountMinor && old[0].currency === event.currency, "provider_event_conflict", 409);
    return true;
  }

  receiveProviderEvent(value, now, reversal = false) {
    const event = providerInput(value, reversal), old = this.order(event.id);
    check(old, "checkout_not_found", 404);
    check(event.currency === old.currency && (event.kind === "refund" ? event.amountMinor <= old.amount : event.amountMinor === old.amount),
      "payment_amount_mismatch", 409);
    const duplicate = this.duplicateEvent(event);
    if (duplicate) {
      return old.review_reason && !reversal ? json({code: old.review_reason}, 409) : json({checkout: orderSummary(old, now), duplicate: true});
    }
    this.ensureProviderIdentity(event, old);
    const active = old.status === "pending" && old.expires_at > now;
    const previous = this.row(`SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN amount ELSE 0 END),0) refunded,
      COALESCE(MAX(kind='chargeback'),0) charged_back FROM commerce_events WHERE order_id=?`, old.id);
    const rawRefund = previous.refunded + (event.kind === "refund" ? event.amountMinor : 0);
    const chargedBack = previous.charged_back > 0 || event.kind === "chargeback";
    check(rawRefund <= old.amount && !(event.kind === "chargeback" && previous.charged_back), "excess_reversal", 409);
    this.sql.exec("INSERT INTO commerce_events VALUES(?,?,?,?,?,?,?,?,?)", event.eventId, event.id, event.kind, event.providerSaleId,
      event.providerTransactionId, event.purchaseId, event.amountMinor, event.currency, now);
    if (!reversal && !active && !appliedStatuses.has(old.status)) {
      const promotion = old.promo && this.row("SELECT max_redemptions FROM commerce_promotions WHERE code=?", old.promo);
      const beyondCapacity = promotion && this.promotionUses(old.promo, now, old.id) >= promotion.max_redemptions;
      const review = old.status === "cancelled" ? "checkout_closed" : beyondCapacity ? "promotion_exhausted" : null;
      if (review) {
        this.sql.exec("UPDATE commerce_orders SET status='requires-review',review_reason=? WHERE id=?", review, old.id);
        return json({code: review}, 409);
      }
    }
    const settled = !reversal || appliedStatuses.has(old.status);
    const refunded = chargedBack ? old.amount : rawRefund;
    if (!settled) {
      this.sql.exec("UPDATE commerce_orders SET refunded_amount=? WHERE id=?", refunded, old.id);
      return json({checkout: orderSummary(this.order(old.id), now), duplicate: false});
    }
    const net = old.amount - refunded;
    const credits = Number(BigInt(old.credits) * BigInt(net) / BigInt(old.amount));
    const commission = Math.floor(net * old.commission_bps / 10_000);
    const status = chargedBack ? "charged-back" : refunded === old.amount ? "refunded" : refunded ? "partially-refunded" : "paid";
    this.sql.exec(`UPDATE commerce_orders SET status=?,settled_at=COALESCE(settled_at,?),refunded_amount=?,granted_credits=?,
      commission_amount=? WHERE id=?`, status, now, refunded, credits, commission, old.id);
    this.updateEntitlement(old.subject, credits - old.granted_credits);
    return json({checkout: orderSummary(this.order(old.id), now), duplicate: false});
  }

  updateEntitlement(subject, delta) {
    if (!delta) return;
    const current = this.row("SELECT * FROM commerce_entitlements WHERE subject=?", subject);
    const credits = (current?.credits ?? 0) + delta, revision = (current?.revision ?? 0) + 1;
    check(number(credits, 0, Number.MAX_SAFE_INTEGER) && number(revision, 1, Number.MAX_SAFE_INTEGER), "entitlement_limit", 409);
    this.sql.exec(`INSERT INTO commerce_entitlements(subject,credits,revision) VALUES(?,?,?) ON CONFLICT(subject) DO UPDATE SET
      credits=excluded.credits,revision=excluded.revision`, subject, credits, revision);
  }

  readEntitlement(value) {
    shape(value, ["subject"]);
    check(matches(value.subject, SUBJECT));
    return json(this.row("SELECT credits,revision FROM commerce_entitlements WHERE subject=?", value.subject) ?? {credits: 0, revision: 0});
  }

  savePromotion(value, now) {
    shape(value, ["code", "discountBps", "maxRedemptions", "validFrom", "validUntil", "enabled"], ["planId"]);
    const {discountBps, maxRedemptions, validFrom, validUntil, enabled, planId = null} = value, token = code(value.code);
    check(matches(token, CODE) && number(discountBps, 1, 9_999) && number(maxRedemptions, 1, 100_000) &&
      timestamp(validFrom) && timestamp(validUntil) && validFrom < validUntil && typeof enabled === "boolean" &&
      (planId === null || matches(planId, PLAN)));
    check(this.promotionUses(token, now) <= maxRedemptions, "promotion_limit_below_claimed", 409);
    this.sql.exec(`INSERT INTO commerce_promotions VALUES(?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET
      discount_bps=excluded.discount_bps,max_redemptions=excluded.max_redemptions,valid_from=excluded.valid_from,
      valid_until=excluded.valid_until,enabled=excluded.enabled,plan=excluded.plan`, token, discountBps, maxRedemptions, validFrom, validUntil,
    Number(enabled), planId);
    return json({promotion: {code: token, discountBps, maxRedemptions, validFrom, validUntil, enabled, planId}});
  }

  saveAffiliate(value) {
    shape(value, ["code", "commissionBps", "enabled"]);
    const {commissionBps, enabled} = value, token = code(value.code);
    check(matches(token, CODE) && number(commissionBps, 0, 10_000) && typeof enabled === "boolean");
    this.sql.exec(`INSERT INTO commerce_affiliates VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET
      commission_bps=excluded.commission_bps,enabled=excluded.enabled`, token, commissionBps, Number(enabled));
    return json({affiliate: {code: token, commissionBps, enabled}});
  }

  listCommerceRecords(value, now) {
    shape(value, []);
    const promotions = this.rows("SELECT * FROM commerce_promotions ORDER BY code LIMIT 200").map(row => ({code: row.code,
      discountBps: row.discount_bps, maxRedemptions: row.max_redemptions, validFrom: row.valid_from, validUntil: row.valid_until,
      enabled: row.enabled === 1, planId: row.plan, claimed: this.promotionUses(row.code, now)}));
    const affiliates = this.rows("SELECT * FROM commerce_affiliates ORDER BY code LIMIT 200").map(row => ({code: row.code,
      commissionBps: row.commission_bps, enabled: row.enabled === 1}));
    const checkouts = this.rows("SELECT * FROM commerce_orders ORDER BY created_at DESC,id DESC LIMIT 200").map(row => orderSummary(row, now, true));
    return json({promotions, affiliates, checkouts});
  }

  dispatch(action, fields, now) {
    switch (action) {
      case "quoteCheckout": return this.quoteCheckout(fields, now);
      case "reserveCheckout": return this.reserveCheckout(fields, now);
      case "readCheckout": return this.readCheckout(fields, now);
      case "cancelCheckout": return this.readCheckout(fields, now, true);
      case "settleCheckout": return this.receiveProviderEvent(fields, now);
      case "reverseCheckout": return this.receiveProviderEvent(fields, now, true);
      case "readEntitlement": return this.readEntitlement(fields);
      case "savePromotion": return this.savePromotion(fields, now);
      case "saveAffiliate": return this.saveAffiliate(fields);
      case "listCommerceRecords": return this.listCommerceRecords(fields, now);
      default: throw new CommerceError("invalid_commerce_request");
    }
  }

  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/command") return json({code: "not_found"}, 404);
    try {
      const raw = await request.text();
      check(raw.length <= 4096);
      const command = JSON.parse(raw);
      shape(command, ["action", "fields"]);
      this.initialize();
      return this.storage.transactionSync(() => this.dispatch(command.action, command.fields, Date.now()));
    } catch (error) {
      if (error instanceof CommerceError) return json({code: error.message}, error.status);
      if (error instanceof SyntaxError) return json({code: "invalid_commerce_request"}, 400);
      return json({code: "commerce_unavailable"}, 503);
    }
  }
}

export async function commerceRequest(namespace, command) {
  if (!namespace) return json({code: "commerce_unavailable"}, 503);
  try {
    return await namespace.get(namespace.idFromName("launch")).fetch(new Request("https://commerce.internal/command", {
      method: "POST", headers: {"Content-Type": "application/json"}, signal: AbortSignal.timeout(5000), body: JSON.stringify(command),
    }));
  } catch {
    return json({code: "commerce_unavailable"}, 503);
  }
}

export const quoteCheckout = (namespace, fields) => commerceRequest(namespace, {action: "quoteCheckout", fields});
export const reserveCheckout = (namespace, fields) => commerceRequest(namespace, {action: "reserveCheckout", fields});
export const readCheckout = (namespace, fields) => commerceRequest(namespace, {action: "readCheckout", fields});
export const cancelCheckout = (namespace, fields) => commerceRequest(namespace, {action: "cancelCheckout", fields});
export const settleCheckout = (namespace, fields) => commerceRequest(namespace, {action: "settleCheckout", fields});
export const reverseCheckout = (namespace, fields) => commerceRequest(namespace, {action: "reverseCheckout", fields});
export const readEntitlement = (namespace, fields) => commerceRequest(namespace, {action: "readEntitlement", fields});
export const savePromotion = (namespace, fields) => commerceRequest(namespace, {action: "savePromotion", fields});
export const saveAffiliate = (namespace, fields) => commerceRequest(namespace, {action: "saveAffiliate", fields});
export const listCommerceRecords = (namespace, fields = {}) => commerceRequest(namespace, {action: "listCommerceRecords", fields});
