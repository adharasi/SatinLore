import { accountIdentity, accountJson, AccountError } from "./accounts.mjs";
import { listCommerceRecords, quoteCheckout, readCheckout, readSubscription, reconcilePayments, reserveCheckout, reverseCheckout, saveAffiliate,
  savePromotion, settleCheckout, settleSubscription, updateSubscriptionLifecycle } from "./commerce.mjs";
import { APP_ORIGIN } from "./public-auth.mjs";
import { launchUsageConfigured } from "./launch-usage.mjs";
import { analysisConfigured } from "./scene-analysis.mjs";
import { LAUNCH_PLANS, MONTHLY_PERIOD } from "./launch-plans.mjs";

export const BILLING_API = "/api/billing";
export const BILLING_ADMIN_API = "/api/billing-admin";
export const BILLING_POSTBACK = `${BILLING_API}/verotel/postback`;
const ORDER_PAGE = "https://secure.verotel.com/startorder";
const CANCEL_PAGE = "https://secure.verotel.com/cancel-subscription";
const currencies = new Set(["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "DKK", "NOK", "SEK"]);
const numericId = /^[1-9][0-9]{0,29}$/u;
const orderId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const code = /^[A-Z0-9][A-Z0-9_-]{1,31}$/u;
const planId = /^[a-z0-9][a-z0-9-]{1,31}$/u;
const hex = /^[a-f0-9]{64}$/u;
const reconciliationPath = `${BILLING_ADMIN_API}/reconciliation`;
const reconciliationCsvPath = `${reconciliationPath}.csv`;
const filterNames = new Set(["reference", "attention", "from", "through"]);
const dayMilliseconds = 86_400_000;
const eventParams = new Set(["shopID", "type", "event", "referenceID", "saleID", "transactionID", "parentID",
  "priceAmount", "priceCurrency", "paymentMethod", "custom1", "custom2", "custom3", "truncatedPAN", "CCBrand", "version",
  "subscriptionType", "period", "nextChargeOn", "expiresOn", "subscriptionPhase", "amount", "currency", "cancelledBy",
  "uncancelledBy"]);
const encode = new TextEncoder();
const json = (value, status = 200) => Response.json(value, {status});
const commerceMessages = new Map([
  ["promotion_unavailable", "This promo code is unavailable for your selected pack."],
  ["affiliate_unavailable", "This affiliate link is no longer active. Return to plans without it."],
  ["promotion_exhausted", "This promo code has reached its redemption limit."],
  ["price_changed", "The price changed. Check the price again before continuing."],
  ["quote_changed", "The price changed. Check the price again before continuing."],
  ["checkout_closed", "This order is closed. Check the price to create a new order."],
  ["pending_checkout_limit", "You have several pending checkouts. Complete an existing order or try later."],
  ["subscription_exists", "A subscription already exists for this account. Check its status before starting another."],
  ["active_subscription_exists", "A subscription already exists for this account. Check its status before starting another."],
]);

async function publicResult(response) {
  if (response.ok) return response;
  const {code} = await response.json();
  return json({error: commerceMessages.get(code) ?? (response.status >= 500 ? "Billing is temporarily unavailable." :
    "This billing request could not be completed. Check your selection and try again.")}, response.status);
}

function catalog(env) {
  const value = env.LAUNCH_PLAN_CATALOG;
  if (value !== undefined && (typeof value !== "string" || value.length > 8_192)) return null;
  try {
    const entries = value === undefined ? LAUNCH_PLANS : JSON.parse(value);
    if (!Array.isArray(entries) || !entries.length || entries.length > 12) return null;
    const checked = new Map();
    for (const {id, name, currency, amountMinor, credits, kind = "one-time"} of entries) {
      if (!planId.test(id) || checked.has(id) || typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9 .-]{1,58}$/u.test(name) ||
          currency !== "USD" || !Number.isSafeInteger(amountMinor) || amountMinor < 100 || amountMinor > 100_000 ||
          !Number.isSafeInteger(credits) || credits < 1 || credits > 100_000_000_000 ||
          !["one-time", "monthly"].includes(kind) || kind === "monthly" && credits !== 2_000_000_000) return null;
      checked.set(id, {id, name, currency, amountMinor, credits, kind, ...(kind === "monthly" ? {rebillAmountMinor: amountMinor} : {})});
    }
    return checked;
  } catch { return null; }
}

export function launchBillingAvailable(env) {
  return env.LAUNCH_BILLING_ENABLED === "true" && env.LAUNCH_BILLING_POSTBACK_ENABLED === "true" && env.PUBLIC_READER_ENABLED === "true" &&
    launchUsageConfigured(env) && analysisConfigured(env.OPENAI_API_KEY, env.SCENE_ANALYSIS_BUDGET) &&
    numericId.test(env.VEROTEL_SHOP_ID ?? "") &&
    typeof env.VEROTEL_SIGNATURE_KEY === "string" && /^[A-Za-z0-9_-]{16,128}$/u.test(env.VEROTEL_SIGNATURE_KEY) &&
    Boolean(catalog(env));
}

function mutable(request) {
  return request.headers.get("Origin") === APP_ORIGIN &&
    !["same-site", "cross-site"].includes(request.headers.get("Sec-Fetch-Site"));
}

export async function flexPaySignature(key, params) {
  const canonical = Object.entries(params).filter(([,value]) => value !== "").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const hash = await crypto.subtle.digest("SHA-256", encode.encode([key, ...canonical.map(([name, value]) => `${name}=${value}`)].join(":")));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function equalSignature(actual, expected) {
  if (!hex.test(actual ?? "")) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function minorUnits(value) {
  if (!/^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,2})?$/u.test(value ?? "")) return 0;
  const [major, minor = ""] = value.split(".");
  return Number(major) * 100 + Number(minor.padEnd(2, "0"));
}

async function verotelCheckout(checkout, plan, env) {
  const amount = checkout.amountMinor;
  const monthly = plan.kind === "monthly";
  const mode = monthly ? {name: plan.name, type: "subscription", subscriptionType: "recurring", period: MONTHLY_PERIOD} :
    {description: plan.name, type: "purchase"};
  const params = {...mode, priceAmount: `${Math.trunc(amount / 100)}.${String(amount % 100).padStart(2, "0")}`,
    priceCurrency: checkout.currency, referenceID: checkout.id, shopID: env.VEROTEL_SHOP_ID, version: "4",
    successURL: `${APP_ORIGIN}/billing?order=${checkout.id}`, declineURL: `${APP_ORIGIN}/billing?cancelled=1`};
  params.signature = await flexPaySignature(env.VEROTEL_SIGNATURE_KEY, params);
  return `${ORDER_PAGE}?${new URLSearchParams(params)}`;
}

function verotelDate(value) {
  if (typeof value !== "string" || !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/u.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() : null;
}

function providerEvent(params, signature) {
  const {type, event = "", referenceID: id, saleID: providerSaleId, transactionID: providerTransactionId, parentID: parentTransactionId} = params;
  const subscription = type === "subscription";
  const merchantIds = {id, providerSaleId};
  if (!orderId.test(id ?? "") || !numericId.test(providerSaleId ?? "") || !["purchase", "subscription"].includes(type) ||
      (subscription ? params.subscriptionType !== "recurring" : params.subscriptionType !== undefined)) return null;
  if (subscription && ["cancel", "expiry", "uncancel", "extend"].includes(event)) {
    if (providerTransactionId !== undefined || parentTransactionId !== undefined ||
        params.priceAmount !== undefined || params.amount !== undefined) return null;
    const periodEnd = event === "expiry" ? null : verotelDate(event === "cancel" ? params.expiresOn :
      event === "extend" ? params.nextChargeOn ?? params.expiresOn : params.nextChargeOn);
    if (["cancel", "uncancel"].includes(event) && periodEnd === null) return null;
    return {apply: updateSubscriptionLifecycle, fields: {...merchantIds, eventId: `verotel:${signature}`, periodEnd,
      event: event === "expiry" ? "expire" : event}};
  }
  const reversal = event === "credit" || event === "chargeback";
  const renewal = event === "rebill";
  const amountMinor = minorUnits(renewal ? params.amount : params.priceAmount);
  const currency = renewal ? params.currency : params.priceCurrency;
  if (!numericId.test(providerTransactionId ?? "") || !amountMinor || !currencies.has(currency) ||
      (reversal ? !numericId.test(parentTransactionId ?? "") : parentTransactionId !== undefined)) return null;
  const fields = {...merchantIds, eventId: `verotel:${providerTransactionId}`, providerTransactionId, currency, amountMinor};
  if (reversal) return {apply: reverseCheckout, fields: {...fields, kind: subscription ? "monthly" : "one-time", parentTransactionId,
    reason: event === "credit" ? "refund" : "chargeback", ...(subscription ? {terminated: params.subscriptionPhase === "terminated" || event === "chargeback"} : {})}};
  if (!subscription) return event === "" ? {apply: settleCheckout, fields} : null;
  if (!["initial", "rebill"].includes(event) || !renewal && params.period !== MONTHLY_PERIOD ||
      (renewal ? params.priceAmount !== undefined || params.priceCurrency !== undefined : params.amount !== undefined || params.currency !== undefined)) return null;
  const periodEnd = verotelDate(params.nextChargeOn);
  return periodEnd === null ? null : {apply: settleSubscription, fields: {...fields, periodEnd, renewal}};
}

// Only this signed server-to-server event can grant or reverse an order. A hosted return lacks a v2 transaction ID.
export async function handleBillingPostback(request, env) {
  const close = (body, status) => new Response(body, {status, headers: {"Content-Type": "text/plain; charset=utf-8"}});
  // Pausing new purchases must not prevent already-issued payments and reversals from reconciling.
  if (!env.COMMERCE || !numericId.test(env.VEROTEL_SHOP_ID ?? "") ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(env.VEROTEL_SIGNATURE_KEY ?? "")) return close("Unavailable", 503);
  if (request.method !== "GET") return close("Method not allowed", 405);
  const url = new URL(request.url);
  if (url.search.length > 4_096) return close("Invalid postback", 400);
  const params = Object.create(null);
  let signature;
  for (const [name, value] of url.searchParams) {
    if (name === "signature" && !signature && hex.test(value)) { signature = value; continue; }
    if (!eventParams.has(name) || Object.hasOwn(params, name) || value.length > 255 ||
        /[\u0000-\u001f\u007f]|:[A-Za-z][A-Za-z0-9]*=/u.test(value)) return close("Invalid postback", 400);
    params[name] = value;
  }
  if (params.shopID !== env.VEROTEL_SHOP_ID ||
      !equalSignature(signature, await flexPaySignature(env.VEROTEL_SIGNATURE_KEY, params))) return close("Invalid postback", 400);
  const event = providerEvent(params, signature);
  if (!event) return close("Invalid postback", 400);
  try {
    const result = await event.apply(env.COMMERCE, event.fields);
    return result.ok ? close("OK", 200) : close("Could not reconcile", result.status);
  } catch { return close("Unavailable", 503); }
}

function purchaseSelection(body, plans) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["planId", "promo", "ref", "idempotencyKey", "expectedAmountMinor", "expectedCurrency",
        "expectedCredits", "expectedKind", "expectedRebillAmountMinor"].includes(key))) return null;
  const plan = plans.get(body.planId);
  const promotionCode = typeof body.promo === "string" ? body.promo.trim().toUpperCase() : "";
  const affiliateCode = typeof body.ref === "string" ? body.ref.trim().toUpperCase() : "";
  if (!plan || body.promo !== undefined && !code.test(promotionCode) ||
      body.ref !== undefined && !code.test(affiliateCode)) return null;
  return {plan, ...(promotionCode ? {promotionCode} : {}), ...(affiliateCode ? {affiliateCode} : {})};
}

async function manageSubscription(request, env, {subject, session, reverify}, cancel) {
  if (request.method !== (cancel ? "POST" : "GET")) return json({error: "Use the subscription controls."}, 405);
  if (cancel && !mutable(request)) return json({error: "Use the subscription controls on SatinLore."}, 403);
  let id;
  if (cancel) {
    const body = await accountJson(request, APP_ORIGIN, 512);
    if (!body || Object.keys(body).length !== 2 || body.confirm !== true || !orderId.test(body.id ?? "")) {
      return json({error: "Confirm which subscription to cancel."}, 400);
    }
    id = body.id;
  }
  const response = await readSubscription(env.COMMERCE, {subject});
  if (!response.ok) return publicResult(response);
  const {subscription} = await response.json();
  if (!cancel) {
    if (!subscription) return json({subscription: null});
    const {providerSaleId, ...publicFields} = subscription;
    return json({subscription: publicFields});
  }
  if (subscription?.id !== id || subscription.renews !== true || !numericId.test(subscription.providerSaleId ?? "")) {
    return json({error: "This subscription cannot be cancelled from this account."}, 404);
  }
  if (!numericId.test(env.VEROTEL_SHOP_ID ?? "") ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(env.VEROTEL_SIGNATURE_KEY ?? "")) return json({error: "Contact support for cancellation."}, 503);
  const renewed = await reverify();
  if (!renewed || renewed.subject !== session.subject || renewed.expiresAt <= Date.now()) return json({error: "Sign in again to continue."}, 401);
  const params = {saleID: subscription.providerSaleId, shopID: env.VEROTEL_SHOP_ID, version: "4"};
  params.signature = await flexPaySignature(env.VEROTEL_SIGNATURE_KEY, params);
  return json({cancelUrl: `${CANCEL_PAGE}?${new URLSearchParams(params)}`});
}

export async function handleBilling(request, env, {config, session, reverify}) {
  const {pathname, searchParams, search} = new URL(request.url);
  if (config?.origin !== APP_ORIGIN || session?.authMode !== "email" || session.expiresAt <= Date.now()) {
    return json({error: "Sign in with your verified reader account."}, 401);
  }
  try {
    const subject = await accountIdentity(config, session);
    if (pathname === `${BILLING_API}/subscription` || pathname === `${BILLING_API}/cancel-subscription`) {
      if (search) return json({error: "Use the subscription controls."}, 400);
      return await manageSubscription(request, env, {subject, session, reverify}, pathname.endsWith("/cancel-subscription"));
    }
    if (pathname === `${BILLING_API}/order` && request.method === "GET") {
      const id = searchParams.get("id");
      if ([...searchParams].length !== 1 || !orderId.test(id ?? "")) return json({error: "Choose a valid order."}, 400);
      return await publicResult(await readCheckout(env.COMMERCE, {subject, id}));
    }
    if (!launchBillingAvailable(env)) return json({error: "Purchases are currently unavailable."}, 503);
    const plans = catalog(env);
    if (pathname === `${BILLING_API}/plans` && request.method === "GET" && !search) return json({plans: [...plans.values()]});
    const quote = pathname === `${BILLING_API}/quote`;
    if (!quote && pathname !== `${BILLING_API}/checkout`) return json({error: "Not found."}, 404);
    if (request.method !== "POST" || search) return json({error: "Use the plans form to continue."}, 405);
    if (!mutable(request)) return json({error: "Use the plans form on SatinLore."}, 403);
    const body = await accountJson(request, APP_ORIGIN, 2048);
    const selection = purchaseSelection(body, plans);
    if (!selection || (quote ? ["idempotencyKey", "expectedAmountMinor", "expectedCurrency", "expectedCredits", "expectedKind",
      "expectedRebillAmountMinor"].some(key => Object.hasOwn(body, key)) :
      !orderId.test(body.idempotencyKey ?? "") || !Number.isSafeInteger(body.expectedAmountMinor) || body.expectedAmountMinor < 1 ||
      !currencies.has(body.expectedCurrency) || !Number.isSafeInteger(body.expectedCredits))) {
      return json({error: "Choose a valid plan and code."}, 400);
    }
    const {name, kind, rebillAmountMinor, ...terms} = selection.plan;
    if (kind === "monthly" && selection.promotionCode) return json({error: "This promo code can only be used on top-ups."}, 409);
    if (!quote && (body.expectedCurrency !== terms.currency || body.expectedCredits !== terms.credits ||
        (kind === "monthly" || body.expectedKind !== undefined) && body.expectedKind !== kind ||
        body.expectedRebillAmountMinor !== rebillAmountMinor)) {
      return json({error: "This pack changed. Refresh plans before continuing."}, 409);
    }
    const plan = {...terms, unit: "nano_usd", kind, ...(kind === "monthly" ? {rebillAmountMinor} : {})};
    const renewed = await reverify();
    if (!renewed || renewed.subject !== session.subject || renewed.expiresAt <= Date.now()) {
      return json({error: "Sign in again to continue."}, 401);
    }
    const apply = quote ? quoteCheckout : reserveCheckout;
    const response = await publicResult(await apply(env.COMMERCE, {subject, ...selection, plan,
      ...(!quote ? {idempotencyKey: body.idempotencyKey, expectedAmountMinor: body.expectedAmountMinor} : {})}));
    if (!response.ok) return response;
    if (quote) {
      const {quote: quoted} = await response.json();
      return json({quote: {...quoted, kind, ...(kind === "monthly" ? {rebillAmountMinor} : {})}});
    }
    const {checkout} = await response.json();
    if (!checkout || checkout.status !== "pending" || checkout.expiresAt <= Date.now()) {
      return json({error: "This checkout is closed. Refresh your plans to start another purchase."}, 409);
    }
    return json({checkout, checkoutUrl: await verotelCheckout(checkout, {name, kind}, env)});
  } catch (error) {
    if (error instanceof AccountError) return json({error: error.message}, error.status);
    return json({error: "Checkout could not be confirmed. Retry the same order."}, 503);
  }
}

function reconciliationFilters(searchParams, search) {
  if (search.length > 512 || [...searchParams].some(([key]) => !filterNames.has(key) || searchParams.getAll(key).length !== 1)) return null;
  const values = Object.fromEntries(searchParams);
  const reference = values.reference?.trim().toLowerCase();
  if (reference !== undefined && !orderId.test(reference) && !numericId.test(reference) ||
      values.attention !== undefined && values.attention !== "1") return null;
  const from = verotelDate(values.from), through = verotelDate(values.through);
  if (values.from !== undefined || values.through !== undefined) {
    if (from === null || through === null || from > through || through - from >= 366 * dayMilliseconds) return null;
  }
  return {...(reference ? {reference} : {}), ...(values.attention ? {attention: true} : {}),
    ...(from === null ? {} : {from, until: through + dayMilliseconds})};
}

function csvCell(value) {
  if (typeof value === "number") return value.toString();
  const text = value ?? "";
  const safe = /^[=+@\-\t\r\n]/u.test(text) ? "'" + text : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function reconciliation(request, env, url) {
  if (request.method !== "GET") return json({error: "Use the payment reconciliation controls."}, 405);
  if (["cross-site", "same-site"].includes(request.headers.get("Sec-Fetch-Site"))) {
    return json({error: "Open the billing administration page first."}, 403);
  }
  const filters = reconciliationFilters(url.searchParams, url.search);
  if (!filters) return json({error: "Enter a valid payment reference and a date range of up to 366 days."}, 400);
  const result = await reconcilePayments(env.COMMERCE, filters);
  if (!result.ok || url.pathname !== reconciliationCsvPath) return result;
  const {transactions, truncated} = await result.json();
  if (truncated) return json({error: "More than 500 transactions match. Narrow the date range before downloading."}, 400);
  const rows = [["received_at_utc", "checkout_reference", "sale_id", "transaction_id", "parent_transaction_id", "event",
    "plan_id", "currency", "amount_minor", "affiliate_code", "needs_review", "review_reason"]];
  for (const row of transactions) {
    rows.push([new Date(row.receivedAt).toISOString(), row.checkoutId, row.providerSaleId, row.providerTransactionId,
      row.parentTransactionId, row.kind, row.planId, row.currency, row.amountMinor, row.affiliateCode,
      row.needsReview ? "yes" : "no", row.reviewReason]);
  }
  return new Response(rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n", {headers: {
    "Cache-Control": "no-store", "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="satinlore-payment-activity.csv"',
  }});
}

export async function handleBillingAdmin(request, env, session, reverify) {
  if (!session?.isFounder || session.expiresAt <= Date.now()) return json({error: "Founder access required."}, 403);
  if (!env.COMMERCE) return json({error: "Commerce storage is unavailable."}, 503);
  const url = new URL(request.url);
  const {pathname, search} = url;
  if (pathname === reconciliationPath || pathname === reconciliationCsvPath) return reconciliation(request, env, url);
  if (search) return json({error: "Use the billing administration controls."}, 400);
  if (request.method === "GET" && pathname === BILLING_ADMIN_API) {
    return listCommerceRecords(env.COMMERCE);
  }
  const apply = new Map([[`${BILLING_ADMIN_API}/promotion`, savePromotion], [`${BILLING_ADMIN_API}/affiliate`, saveAffiliate]]).get(pathname);
  if (request.method !== "POST" || !apply) return json({error: "Not found."}, 404);
  if (!mutable(request)) return json({error: "Use the billing administration controls on SatinLore."}, 403);
  try {
    const body = await accountJson(request, APP_ORIGIN, 4096);
    const renewed = await reverify();
    if (!renewed?.isFounder || renewed.subject !== session.subject || renewed.expiresAt <= Date.now()) {
      return json({error: "Founder access required."}, 403);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "type")) {
      return json({error: "Use a valid campaign configuration."}, 400);
    }
    return apply(env.COMMERCE, body);
  } catch (error) {
    if (error instanceof AccountError) return json({error: error.message}, error.status);
    return json({error: "Campaign settings are temporarily unavailable."}, 503);
  }
}
