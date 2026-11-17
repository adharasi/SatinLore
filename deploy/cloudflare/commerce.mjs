// Internal SQLite commerce ledger. The Worker supplies a verified reader or a verified provider postback.
const CHECKOUT_MS = 30 * 60_000;
const ATTRIBUTION_MS = 30 * 24 * 60 * 60_000;
const PENDING_LIMIT = 3;
const MAX_VALUE = 100_000_000;
const MAX_NANO_USD = 100_000_000_000;
const MONTHLY_NANO_USD = 2_000_000_000;
const NANO_USD = "nano_usd";
const DAY_MS = 86_400_000;
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
  shape(plan, ["id", "currency", "amountMinor", "credits", "unit"], ["kind", "rebillAmountMinor"]);
  const kind = plan.kind ?? "one-time", rebillAmountMinor = plan.rebillAmountMinor ?? plan.amountMinor;
  const promotion = code(value.promotionCode ?? null), affiliate = code(value.affiliateCode ?? null);
  check(matches(subject, SUBJECT) && (!reserve || matches(idempotencyKey, UUID)) && matches(plan.id, PLAN) && matches(plan.currency, CURRENCY) &&
    plan.unit === NANO_USD && ["one-time", "monthly"].includes(kind) && number(plan.amountMinor) &&
    number(plan.credits, 1, MAX_NANO_USD) && (kind === "monthly" ? plan.currency === "USD" && plan.credits === MONTHLY_NANO_USD &&
      number(rebillAmountMinor) : plan.rebillAmountMinor === undefined) && (promotion === null || matches(promotion, CODE)) &&
    (affiliate === null || matches(affiliate, CODE)) && (expectedAmountMinor === undefined || number(expectedAmountMinor)));
  return {subject, plan: {...plan, kind, rebillAmountMinor: kind === "monthly" ? rebillAmountMinor : null}, idempotencyKey,
    expectedAmountMinor, promotion, affiliate};
}

function ownerInput(input) {
  shape(input, ["subject", "id"]);
  check(matches(input.subject, SUBJECT) && matches(input.id, UUID));
  return input;
}

function providerInput(value, reversal, monthly = false) {
  const keys = ["id", "eventId", "providerSaleId", "providerTransactionId", "amountMinor", "currency"];
  shape(value, reversal ? [...keys, "parentTransactionId", "reason", "kind"] : monthly ? [...keys, "periodEnd", "renewal"] : keys,
    reversal && value?.kind === "monthly" ? ["terminated"] : []);
  check(matches(value.id, UUID) && matches(value.eventId, EVENT) && matches(value.providerSaleId, PROVIDER_ID) &&
    matches(value.providerTransactionId, PROVIDER_ID) && number(value.amountMinor) && matches(value.currency, CURRENCY) &&
    (!reversal || matches(value.parentTransactionId, PROVIDER_ID) && value.parentTransactionId !== value.providerTransactionId &&
      ["refund", "chargeback"].includes(value.reason) && ["one-time", "monthly"].includes(value.kind) &&
      (value.terminated === undefined || typeof value.terminated === "boolean")) &&
    (!monthly || typeof value.renewal === "boolean" && billingDate(value.periodEnd)));
  const kind = reversal ? value.reason : monthly ? (value.renewal ? "subscription-rebill" : "subscription-initial") : "purchase";
  return {...value, orderKind: reversal ? value.kind : monthly ? "monthly" : "one-time", kind,
    purchaseId: reversal ? value.parentTransactionId : value.providerTransactionId};
}

const billingDate = value => timestamp(value) && value > 0 && value % DAY_MS === 0;

function previousBillingMonth(end) {
  const date = new Date(end), year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate();
  const lastPreviousDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Date.UTC(year, month - 1, Math.min(day, lastPreviousDay));
}

function orderSummary(row, now, admin = false) {
  const status = row.status === "pending" && row.expires_at <= now ? "expired" : row.status;
  return {id: row.id, planId: row.plan, status, kind: row.plan_kind, unit: row.grant_unit, currency: row.currency, regularAmountMinor: row.regular_amount,
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
      // Old staging balances were provider-token counts. A distinct ledger and explicit new-order units prevent treating them as money.
      const orderColumns = this.rows("PRAGMA table_info(commerce_orders)").map(row => row.name);
      for (const [name, column] of Object.entries({grant_unit: "TEXT NOT NULL DEFAULT 'legacy_tokens'",
        plan_kind: "TEXT NOT NULL DEFAULT 'one-time'", rebill_amount: "INTEGER", renewal_state: "TEXT NOT NULL DEFAULT 'active'",
        renewal_state_end: "INTEGER"})) {
        if (!orderColumns.includes(name)) this.sql.exec(`ALTER TABLE commerce_orders ADD COLUMN ${name} ${column}`);
      }
      const eventColumns = this.rows("PRAGMA table_info(commerce_events)").map(row => row.name);
      for (const [name, column] of Object.entries({period_end: "INTEGER", terminated: "INTEGER NOT NULL DEFAULT 0"})) {
        if (!eventColumns.includes(name)) this.sql.exec(`ALTER TABLE commerce_events ADD COLUMN ${name} ${column}`);
      }
      this.sql.exec("CREATE TABLE IF NOT EXISTS commerce_money_entitlements (subject TEXT PRIMARY KEY, credits INTEGER NOT NULL, revision INTEGER NOT NULL)");
      this.sql.exec(`CREATE TABLE IF NOT EXISTS commerce_subscription_periods (
        transaction_id TEXT PRIMARY KEY REFERENCES commerce_events(transaction_id), order_id TEXT NOT NULL REFERENCES commerce_orders(id),
        starts_at INTEGER, ends_at INTEGER NOT NULL, amount INTEGER NOT NULL, refunded_amount INTEGER NOT NULL,
        credits INTEGER NOT NULL, commission_amount INTEGER NOT NULL, UNIQUE(order_id,ends_at))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS commerce_subscription_lifecycle (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES commerce_orders(id), sale_id TEXT NOT NULL, event TEXT NOT NULL, period_end INTEGER)`);
      this.sql.exec("CREATE INDEX IF NOT EXISTS commerce_orders_subject_kind ON commerce_orders(subject,plan_kind,created_at DESC)");
      this.sql.exec("CREATE INDEX IF NOT EXISTS commerce_events_parent ON commerce_events(purchase_id)");
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
    return {planId: plan.id, kind: plan.kind, rebillAmountMinor: plan.rebillAmountMinor, unit: plan.unit,
      currency: plan.currency, regularAmountMinor: plan.amountMinor, amountMinor: plan.amountMinor - discount,
      credits: plan.credits, promotionCode: promo?.code ?? null, affiliateCode: referral?.code ?? null, commissionBps: referral?.commission_bps ?? 0};
  }

  quoteCheckout(value, now) {
    const input = checkoutInput(value, false);
    if (input.plan.kind === "monthly") check(!this.monthlyCollision(input.subject, now), "subscription_exists", 409);
    const {commissionBps, ...quote} = this.terms(input, now);
    return json({quote});
  }

  reserveCheckout(value, now) {
    const input = checkoutInput(value, true);
    const {subject, idempotencyKey, expectedAmountMinor, plan, promotion, affiliate} = input;
    const old = this.row("SELECT * FROM commerce_orders WHERE subject=? AND request_id=?", subject, idempotencyKey);
    if (old) {
      check(old.plan === plan.id && old.currency === plan.currency && old.regular_amount === plan.amountMinor && old.credits === plan.credits &&
        old.grant_unit === plan.unit && old.plan_kind === plan.kind && old.rebill_amount === plan.rebillAmountMinor &&
        old.request_promo === promotion && old.request_affiliate === affiliate &&
        (expectedAmountMinor === undefined || expectedAmountMinor === old.amount), "idempotency_conflict", 409);
      return json({checkout: orderSummary(old, now), duplicate: true});
    }
    if (plan.kind === "monthly") check(!this.monthlyCollision(subject, now), "subscription_exists", 409);
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
      credits,promo,affiliate,commission_bps,created_at,expires_at,status,grant_unit,plan_kind,rebill_amount)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
    id, subject, idempotencyKey, promotion, affiliate, plan.id, quote.currency, quote.regularAmountMinor, quote.amountMinor,
    quote.credits, quote.promotionCode, quote.affiliateCode, quote.commissionBps, now, now + CHECKOUT_MS, plan.unit, plan.kind,
    plan.rebillAmountMinor);
    return json({checkout: orderSummary(this.order(id), now), duplicate: false}, 201);
  }

  readCheckout(value, now, cancel = false) {
    const {id, subject} = ownerInput(value);
    const row = this.order(id);
    check(row?.subject === subject, "checkout_not_found", 404);
    if (cancel && row.status === "pending") this.sql.exec("UPDATE commerce_orders SET status='cancelled' WHERE id=?", id);
    return json({checkout: orderSummary(cancel ? this.order(id) : row, now)});
  }

  ensureProviderIdentity(event, order, monthly = false) {
    const claimed = this.row("SELECT id FROM commerce_orders WHERE (sale_id=? OR purchase_id=?) AND id<>?",
      event.providerSaleId, event.purchaseId, order.id);
    const parentClaim = this.row("SELECT order_id FROM commerce_events WHERE purchase_id=? AND order_id<>? LIMIT 1", event.purchaseId, order.id);
    const pinsInitial = !monthly || event.kind === "subscription-initial";
    check(!claimed && (order.sale_id === null || order.sale_id === event.providerSaleId) &&
      !parentClaim && (!pinsInitial || order.purchase_id === null || order.purchase_id === event.purchaseId), "provider_identity_conflict", 409);
    if (["refund", "chargeback"].includes(event.kind)) {
      check(!this.row("SELECT id FROM commerce_orders WHERE purchase_id=?", event.providerTransactionId), "provider_identity_conflict", 409);
      const parent = this.row("SELECT order_id,kind FROM commerce_events WHERE transaction_id=?", event.purchaseId);
      check(!parent || ["purchase", "subscription-initial", "subscription-rebill"].includes(parent.kind) &&
        parent.order_id === order.id, "provider_identity_conflict", 409);
    }
    this.sql.exec("UPDATE commerce_orders SET sale_id=?,purchase_id=? WHERE id=?", event.providerSaleId,
      pinsInitial ? event.purchaseId : order.purchase_id, order.id);
  }

  duplicateEvent(event) {
    const old = this.rows("SELECT * FROM commerce_events WHERE id=? OR transaction_id=?", event.eventId, event.providerTransactionId);
    if (!old.length) return false;
    check(old.length === 1 && old[0].id === event.eventId && old[0].order_id === event.id && old[0].kind === event.kind &&
      old[0].sale_id === event.providerSaleId && old[0].transaction_id === event.providerTransactionId && old[0].purchase_id === event.purchaseId &&
      old[0].amount === event.amountMinor && old[0].currency === event.currency && old[0].period_end === (event.periodEnd ?? null) &&
      old[0].terminated === Number(event.terminated === true),
      "provider_event_conflict", 409);
    return true;
  }

  recordProviderEvent(event, now) {
    this.sql.exec(`INSERT INTO commerce_events(id,order_id,kind,sale_id,transaction_id,purchase_id,amount,currency,recorded_at,period_end,terminated)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, event.eventId, event.id, event.kind, event.providerSaleId, event.providerTransactionId,
    event.purchaseId, event.amountMinor, event.currency, now, event.periodEnd ?? null, Number(event.terminated === true));
  }

  receiveProviderEvent(value, now, reversal = false) {
    const event = providerInput(value, reversal), old = this.order(event.id);
    check(old, "checkout_not_found", 404);
    check(old.grant_unit === NANO_USD, "checkout_legacy_units", 409);
    check(event.orderKind === old.plan_kind, "checkout_payment_kind_mismatch", 409);
    if (old.plan_kind === "monthly") {
      check(reversal, "checkout_payment_kind_mismatch", 409);
      return this.reverseSubscription(event, old, now);
    }
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
    this.recordProviderEvent(event, now);
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

  monthlyCollision(subject, now, excluding = "") {
    return this.row(`SELECT id FROM commerce_orders o WHERE subject=? AND id<>? AND plan_kind='monthly' AND (
      (status='pending' AND expires_at>? AND renewal_state='active') OR (settled_at IS NOT NULL AND (
        renewal_state='active' OR EXISTS (SELECT 1 FROM commerce_subscription_periods p WHERE p.order_id=o.id
          AND p.starts_at IS NOT NULL AND p.ends_at>? AND p.credits>0)))) ORDER BY created_at DESC LIMIT 1`, subject, excluding, now, now);
  }

  paidThrough(id) {
    return this.row(`SELECT MAX(ends_at) end FROM commerce_subscription_periods WHERE order_id=?
      AND starts_at IS NOT NULL AND credits>0`, id).end;
  }

  subscriptionSummary(row, now, internal = false) {
    const paidThrough = this.paidThrough(row.id);
    let {status} = orderSummary(row, now);
    if (row.renewal_state !== "active" && status !== "requires-review") status = row.renewal_state;
    else if (row.settled_at !== null) status = paidThrough > now ? "active" : "past-due";
    return {id: row.id, status, planId: row.plan, rebillAmountMinor: row.rebill_amount, currency: row.currency,
      paidThrough, renews: row.settled_at !== null && row.renewal_state === "active",
      ...(internal ? {providerSaleId: row.sale_id} : {})};
  }

  findSubscription(subject, now, internal = false) {
    const open = this.monthlyCollision(subject, now);
    const row = open ? this.order(open.id) : this.row("SELECT * FROM commerce_orders WHERE subject=? AND plan_kind='monthly' ORDER BY created_at DESC,id DESC LIMIT 1", subject);
    return row ? this.subscriptionSummary(row, now, internal) : null;
  }

  readSubscription(value, now) {
    shape(value, ["subject"]);
    check(matches(value.subject, SUBJECT));
    return json({subscription: this.findSubscription(value.subject, now, true)});
  }

  recurringOrder(id) {
    const row = this.order(id);
    check(row, "checkout_not_found", 404);
    check(row.plan_kind === "monthly" && row.grant_unit === NANO_USD, "checkout_payment_kind_mismatch", 409);
    return row;
  }

  recurringResult(id, now, duplicate = false) {
    const row = this.order(id);
    return json({checkout: orderSummary(row, now), subscription: this.subscriptionSummary(row, now), duplicate});
  }

  reversalAmounts(id, purchaseId, amount, incoming = null) {
    const recorded = this.row(`SELECT COALESCE(SUM(CASE WHEN kind='refund' THEN amount ELSE 0 END),0) refunded,
      COUNT(CASE WHEN kind='chargeback' THEN 1 END) chargebacks, MAX(CASE WHEN kind='chargeback' THEN amount END) chargeback_amount
      FROM commerce_events WHERE order_id=? AND purchase_id=?`, id, purchaseId);
    const refunded = recorded.refunded + (incoming?.kind === "refund" ? incoming.amountMinor : 0);
    const chargebacks = recorded.chargebacks + Number(incoming?.kind === "chargeback");
    const chargebackAmount = incoming?.kind === "chargeback" ? incoming.amountMinor : recorded.chargeback_amount;
    check(refunded <= amount && chargebacks <= 1 && (!chargebacks || chargebackAmount === amount), "excess_reversal", 409);
    return chargebacks ? amount : refunded;
  }

  periodAmounts(order, amount, refunded, commissionEligible) {
    const net = amount - refunded;
    return {credits: Number(BigInt(order.credits) * BigInt(net) / BigInt(amount)),
      commission: commissionEligible ? Math.floor(net * order.commission_bps / 10_000) : 0};
  }

  connectSubscriptionPeriods(id) {
    const existing = this.row("SELECT MAX(ends_at) end FROM commerce_subscription_periods WHERE order_id=? AND starts_at IS NOT NULL", id).end;
    if (existing === null) return 0;
    const later = this.rows(`SELECT transaction_id,ends_at FROM commerce_subscription_periods WHERE order_id=? AND starts_at IS NULL AND ends_at>?
      ORDER BY ends_at`, id, existing);
    let previous = existing;
    let connected = 0;
    for (const period of later) {
      const gap = period.ends_at - previous;
      if (gap < 28 * DAY_MS) break;
      // A signed retry extension can move the provider's billing anchor. It
      // supports that schedule only. There is no grant until a paid period.
      const extension = gap > 31 * DAY_MS && this.row(`SELECT MAX(period_end) end FROM commerce_subscription_lifecycle
        WHERE order_id=? AND event='extend' AND period_end>? AND period_end>=? AND period_end<=?`,
      id, previous, period.ends_at - 31 * DAY_MS, period.ends_at - 28 * DAY_MS).end;
      if (gap > 31 * DAY_MS && !extension) break;
      const start = Math.max(previous, previousBillingMonth(period.ends_at), extension || 0);
      this.sql.exec("UPDATE commerce_subscription_periods SET starts_at=? WHERE transaction_id=?", start, period.transaction_id);
      previous = period.ends_at;
      connected++;
    }
    return connected;
  }

  settleSubscription(value, now) {
    const event = providerInput(value, false, true), old = this.recurringOrder(event.id);
    const expectedAmount = event.renewal ? old.rebill_amount : old.amount;
    check(event.currency === old.currency && event.amountMinor === expectedAmount, "payment_amount_mismatch", 409);
    if (this.duplicateEvent(event)) return old.review_reason ? json({code: old.review_reason}, 409) : this.recurringResult(old.id, now, true);
    check(event.periodEnd <= now + 33 * DAY_MS && event.periodEnd > old.created_at, "subscription_period_mismatch", 409);
    check(!this.row(`SELECT 1 FROM commerce_subscription_periods WHERE order_id=? AND ABS(ends_at-?)<?`, old.id, event.periodEnd, 28 * DAY_MS),
      "subscription_period_conflict", 409);
    if (!event.renewal) {
      check(!this.row("SELECT 1 FROM commerce_subscription_periods WHERE order_id=? AND ends_at<?", old.id, event.periodEnd),
        "subscription_initial_order_conflict", 409);
    }
    const reversedBeforePayment = this.row("SELECT 1 FROM commerce_events WHERE order_id=? AND purchase_id=? AND terminated=1 LIMIT 1",
      old.id, event.purchaseId);
    check(old.renewal_state === "active" || event.periodEnd <= old.renewal_state_end || reversedBeforePayment, "subscription_renewal_closed", 409);
    check(!old.review_reason, "subscription_requires_review", 409);
    this.ensureProviderIdentity(event, old, true);
    const refunded = this.reversalAmounts(old.id, event.purchaseId, expectedAmount);
    this.recordProviderEvent(event, now);
    const {credits, commission} = this.periodAmounts(old, expectedAmount, refunded, !event.renewal);
    const purchased = !event.renewal && (old.status === "pending" || old.status === "cancelled");
    let requiresReview = null;
    if (purchased) {
      if (old.status === "cancelled") requiresReview = "checkout_closed";
      else if (this.monthlyCollision(old.subject, now, old.id)) requiresReview = "subscription_exists";
      else if (old.promo && old.expires_at <= now) {
        const promotion = this.row("SELECT max_redemptions FROM commerce_promotions WHERE code=?", old.promo);
        if (promotion && this.promotionUses(old.promo, now, old.id) >= promotion.max_redemptions) requiresReview = "promotion_exhausted";
      }
    }
    const start = purchased && !requiresReview ? Math.max(old.created_at, previousBillingMonth(event.periodEnd)) : null;
    this.sql.exec(`INSERT INTO commerce_subscription_periods VALUES(?,?,?,?,?,?,?,?)`, event.purchaseId, old.id, start,
      event.periodEnd, expectedAmount, refunded, credits, requiresReview ? 0 : commission);
    if (requiresReview) {
      this.sql.exec("UPDATE commerce_orders SET status='requires-review',review_reason=? WHERE id=?", requiresReview, old.id);
      return json({code: requiresReview}, 409);
    }
    if (purchased) {
      this.sql.exec("UPDATE commerce_orders SET status='paid',settled_at=?,refunded_amount=?,granted_credits=?,commission_amount=? WHERE id=?",
        now, refunded, credits, commission, old.id);
    }
    this.connectSubscriptionPeriods(old.id);
    this.updateEntitlement(old.subject, 0, true);
    return this.recurringResult(old.id, now);
  }

  reverseSubscription(event, old, now) {
    check(event.currency === old.currency && event.amountMinor <= Math.max(old.amount, old.rebill_amount), "payment_amount_mismatch", 409);
    if (this.duplicateEvent(event)) return this.recurringResult(old.id, now, true);
    this.ensureProviderIdentity(event, old, true);
    const period = this.row("SELECT * FROM commerce_subscription_periods WHERE order_id=? AND transaction_id=?", old.id, event.purchaseId);
    const amount = period?.amount ?? Math.max(old.amount, old.rebill_amount);
    check(event.amountMinor <= amount && (event.kind !== "chargeback" || !period || event.amountMinor === amount), "payment_amount_mismatch", 409);
    const possibleCharge = !period && event.kind === "chargeback" ? event.amountMinor : amount;
    check(period || event.kind !== "chargeback" || [old.amount, old.rebill_amount].includes(event.amountMinor), "payment_amount_mismatch", 409);
    const refunded = this.reversalAmounts(old.id, event.purchaseId, possibleCharge, event);
    this.recordProviderEvent(event, now);
    if (event.terminated) {
      const deadline = Math.max(now, this.row("SELECT MAX(ends_at) end FROM commerce_subscription_periods WHERE order_id=?", old.id).end ?? 0);
      this.sql.exec("UPDATE commerce_orders SET renewal_state='expired',renewal_state_end=? WHERE id=?", deadline, old.id);
    }
    if (period) {
      const {credits, commission} = this.periodAmounts(old, amount, refunded, event.purchaseId === old.purchase_id);
      this.sql.exec("UPDATE commerce_subscription_periods SET refunded_amount=?,credits=?,commission_amount=? WHERE transaction_id=?",
        refunded, credits, old.review_reason ? 0 : commission, event.purchaseId);
      if (event.purchaseId === old.purchase_id) {
        this.sql.exec("UPDATE commerce_orders SET refunded_amount=?,granted_credits=?,commission_amount=? WHERE id=?",
          refunded, credits, old.review_reason ? 0 : commission, old.id);
      }
    }
    this.updateEntitlement(old.subject, 0, true);
    return this.recurringResult(old.id, now);
  }

  updateSubscriptionLifecycle(value, now) {
    shape(value, ["id", "eventId", "providerSaleId", "event", "periodEnd"]);
    const {id, eventId, providerSaleId, event, periodEnd} = value;
    const informational = event === "extend";
    check(matches(id, UUID) && matches(eventId, EVENT) && matches(providerSaleId, PROVIDER_ID) &&
      (["expire", "extend"].includes(event) && periodEnd === null || ["cancel", "uncancel", "extend"].includes(event) && billingDate(periodEnd)));
    const old = this.recurringOrder(id);
    const previous = this.row("SELECT * FROM commerce_subscription_lifecycle WHERE id=?", eventId);
    if (previous) {
      check(previous.order_id === id && previous.sale_id === providerSaleId && previous.event === event && previous.period_end === periodEnd,
        "provider_event_conflict", 409);
      return this.recurringResult(id, now, true);
    }
    const claimed = this.row("SELECT 1 FROM commerce_orders WHERE sale_id=? AND id<>?", providerSaleId, id);
    check(!claimed && (old.sale_id === null || old.sale_id === providerSaleId), "provider_identity_conflict", 409);
    this.sql.exec("UPDATE commerce_orders SET sale_id=? WHERE id=?", providerSaleId, id);
    this.sql.exec("INSERT INTO commerce_subscription_lifecycle VALUES(?,?,?,?,?)", eventId, id, providerSaleId, event, periodEnd);
    if (informational) {
      if (periodEnd !== null && this.connectSubscriptionPeriods(id)) this.updateEntitlement(old.subject, 0, true);
      return this.recurringResult(id, now);
    }
    const paidThrough = this.paidThrough(id) ?? 0;
    const deadline = periodEnd ?? Math.max(now, paidThrough);
    const canChange = deadline >= paidThrough && (event === "uncancel" ? deadline > (old.renewal_state_end ?? 0) &&
      !this.monthlyCollision(old.subject, now, id) : deadline >= (old.renewal_state_end ?? 0));
    if (canChange) {
      const state = event === "cancel" ? "cancelled" : event === "expire" ? "expired" : "active";
      this.sql.exec("UPDATE commerce_orders SET renewal_state=?,renewal_state_end=? WHERE id=?", state, deadline, id);
      this.updateEntitlement(old.subject, 0, true);
    }
    return this.recurringResult(id, now);
  }

  updateEntitlement(subject, delta, periodChange = false) {
    if (!delta && !periodChange) return;
    const current = this.row("SELECT * FROM commerce_money_entitlements WHERE subject=?", subject);
    const credits = (current?.credits ?? 0) + delta, revision = (current?.revision ?? 0) + 1;
    check(number(credits, 0, Number.MAX_SAFE_INTEGER) && number(revision, 1, Number.MAX_SAFE_INTEGER), "entitlement_limit", 409);
    this.sql.exec(`INSERT INTO commerce_money_entitlements(subject,credits,revision) VALUES(?,?,?) ON CONFLICT(subject) DO UPDATE SET
      credits=excluded.credits,revision=excluded.revision`, subject, credits, revision);
  }

  readEntitlement(value, now) {
    shape(value, ["subject"]);
    check(matches(value.subject, SUBJECT));
    const balance = this.row("SELECT credits,revision FROM commerce_money_entitlements WHERE subject=?", value.subject) ?? {credits: 0, revision: 0};
    const subscriptionGrants = this.rows(`SELECT p.* FROM commerce_subscription_periods p JOIN commerce_orders o ON o.id=p.order_id
      WHERE o.subject=? AND o.settled_at IS NOT NULL AND p.starts_at<=? AND p.ends_at>? AND p.credits>0
      ORDER BY p.ends_at,p.order_id`, value.subject, now, now).map(row => ({id: `${row.order_id}:${row.ends_at}`, credits: row.credits,
      startsAt: row.starts_at, endsAt: row.ends_at}));
    return json({...balance, unit: NANO_USD, subscriptionGrants, subscription: this.findSubscription(value.subject, now)});
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
    const subscriptionCharges = this.rows(`SELECT p.*,o.currency,o.affiliate,o.review_reason FROM commerce_subscription_periods p
      JOIN commerce_orders o ON o.id=p.order_id ORDER BY p.ends_at DESC,p.transaction_id DESC LIMIT 200`).map(row => ({
      checkoutId: row.order_id, providerTransactionId: row.transaction_id, startsAt: row.starts_at, endsAt: row.ends_at,
      currency: row.currency, amountMinor: row.amount, refundedMinor: row.refunded_amount, grantedCredits: row.starts_at === null ? 0 : row.credits,
      affiliateCode: row.affiliate, commissionMinor: row.commission_amount, reviewReason: row.review_reason,
      status: row.review_reason ? "requires-review" : row.starts_at === null ? "pending-period-link" : "linked"}));
    return json({promotions, affiliates, checkouts, subscriptionCharges});
  }

  dispatch(action, fields, now) {
    switch (action) {
      case "quoteCheckout": return this.quoteCheckout(fields, now);
      case "reserveCheckout": return this.reserveCheckout(fields, now);
      case "readCheckout": return this.readCheckout(fields, now);
      case "cancelCheckout": return this.readCheckout(fields, now, true);
      case "settleCheckout": return this.receiveProviderEvent(fields, now);
      case "reverseCheckout": return this.receiveProviderEvent(fields, now, true);
      case "settleSubscription": return this.settleSubscription(fields, now);
      case "updateSubscriptionLifecycle": return this.updateSubscriptionLifecycle(fields, now);
      case "readEntitlement": return this.readEntitlement(fields, now);
      case "readSubscription": return this.readSubscription(fields, now);
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
export const settleSubscription = (namespace, fields) => commerceRequest(namespace, {action: "settleSubscription", fields});
export const updateSubscriptionLifecycle = (namespace, fields) => commerceRequest(namespace, {action: "updateSubscriptionLifecycle", fields});
export const readEntitlement = (namespace, fields) => commerceRequest(namespace, {action: "readEntitlement", fields});
export const readSubscription = (namespace, fields) => commerceRequest(namespace, {action: "readSubscription", fields});
export const savePromotion = (namespace, fields) => commerceRequest(namespace, {action: "savePromotion", fields});
export const saveAffiliate = (namespace, fields) => commerceRequest(namespace, {action: "saveAffiliate", fields});
export const listCommerceRecords = (namespace, fields = {}) => commerceRequest(namespace, {action: "listCommerceRecords", fields});
