import { accountIdentity, accountJson, AccountError } from "./accounts.mjs";
import { listCommerceRecords, quoteCheckout, readCheckout, reserveCheckout, reverseCheckout, saveAffiliate,
  savePromotion, settleCheckout } from "./commerce.mjs";
import { APP_ORIGIN } from "./public-auth.mjs";
import { launchUsageConfigured } from "./launch-usage.mjs";
import { analysisConfigured } from "./scene-analysis.mjs";

export const BILLING_API = "/api/billing";
export const BILLING_ADMIN_API = "/api/billing-admin";
export const BILLING_POSTBACK = `${BILLING_API}/verotel/postback`;
const ORDER_PAGE = "https://secure.verotel.com/startorder";
const currencies = new Set(["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "DKK", "NOK", "SEK"]);
const numericId = /^[1-9][0-9]{0,29}$/u;
const orderId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const code = /^[A-Z0-9][A-Z0-9_-]{1,31}$/u;
const planId = /^[a-z0-9][a-z0-9-]{1,31}$/u;
const hex = /^[a-f0-9]{64}$/u;
const eventParams = new Set(["shopID", "type", "event", "referenceID", "saleID", "transactionID", "parentID",
  "priceAmount", "priceCurrency", "paymentMethod", "custom1", "custom2", "custom3", "truncatedPAN", "CCBrand", "version"]);
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
]);

async function publicResult(response) {
  if (response.ok) return response;
  const {code} = await response.json();
  return json({error: commerceMessages.get(code) ?? (response.status >= 500 ? "Billing is temporarily unavailable." :
    "This billing request could not be completed. Check your selection and try again.")}, response.status);
}

function catalog(value) {
  if (typeof value !== "string" || value.length > 8_192) return null;
  try {
    const entries = JSON.parse(value);
    if (!Array.isArray(entries) || !entries.length || entries.length > 12) return null;
    const checked = new Map();
    for (const {id, name, currency, amountMinor, credits} of entries) {
      if (!planId.test(id) || checked.has(id) || typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9 .-]{1,58}$/u.test(name) ||
          !currencies.has(currency) || !Number.isSafeInteger(amountMinor) || amountMinor < 100 || amountMinor > 100_000 ||
          !Number.isSafeInteger(credits) || credits < 1 || credits > 100_000_000) return null;
      checked.set(id, {id, name, currency, amountMinor, credits});
    }
    return checked;
  } catch { return null; }
}

export function launchBillingAvailable(env) {
  return env.LAUNCH_BILLING_ENABLED === "true" && env.LAUNCH_BILLING_POSTBACK_ENABLED === "true" && env.PUBLIC_READER_ENABLED === "true" &&
    launchUsageConfigured(env) && analysisConfigured(env.OPENAI_API_KEY, env.SCENE_ANALYSIS_BUDGET) &&
    numericId.test(env.VEROTEL_SHOP_ID ?? "") &&
    typeof env.VEROTEL_SIGNATURE_KEY === "string" && /^[A-Za-z0-9_-]{16,128}$/u.test(env.VEROTEL_SIGNATURE_KEY) &&
    Boolean(catalog(env.LAUNCH_PLAN_CATALOG));
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
  const params = {description: plan.name, priceAmount: `${Math.trunc(amount / 100)}.${String(amount % 100).padStart(2, "0")}`,
    priceCurrency: checkout.currency, referenceID: checkout.id, shopID: env.VEROTEL_SHOP_ID, type: "purchase", version: "4",
    successURL: `${APP_ORIGIN}/billing?order=${checkout.id}`, declineURL: `${APP_ORIGIN}/billing?cancelled=1`};
  params.signature = await flexPaySignature(env.VEROTEL_SIGNATURE_KEY, params);
  return `${ORDER_PAGE}?${new URLSearchParams(params)}`;
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
  const {shopID, type, event = "", referenceID, saleID, transactionID, parentID, priceCurrency, priceAmount} = params;
  const amountMinor = minorUnits(priceAmount);
  const reversal = event === "credit" || event === "chargeback";
  if (shopID !== env.VEROTEL_SHOP_ID || type !== "purchase" || (event && !reversal) || !orderId.test(referenceID ?? "") ||
      !numericId.test(saleID ?? "") || !numericId.test(transactionID ?? "") || !currencies.has(priceCurrency) ||
      !amountMinor || (reversal ? !numericId.test(parentID ?? "") : parentID !== undefined) ||
      !equalSignature(signature, await flexPaySignature(env.VEROTEL_SIGNATURE_KEY, params))) return close("Invalid postback", 400);
  try {
    const apply = reversal ? reverseCheckout : settleCheckout;
    const result = await apply(env.COMMERCE, {
      id: referenceID, eventId: `verotel:${transactionID}`, providerSaleId: saleID, providerTransactionId: transactionID,
      currency: priceCurrency, amountMinor, ...(reversal ? {parentTransactionId: parentID, reason: event === "credit" ? "refund" : "chargeback"} : {})});
    return result.ok ? close("OK", 200) : close("Could not reconcile", result.status);
  } catch { return close("Unavailable", 503); }
}

function purchaseSelection(body, plans) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["planId", "promo", "ref", "idempotencyKey", "expectedAmountMinor", "expectedCurrency",
        "expectedCredits"].includes(key))) return null;
  const plan = plans.get(body.planId);
  const promotionCode = typeof body.promo === "string" ? body.promo.trim().toUpperCase() : "";
  const affiliateCode = typeof body.ref === "string" ? body.ref.trim().toUpperCase() : "";
  if (!plan || body.promo !== undefined && !code.test(promotionCode) ||
      body.ref !== undefined && !code.test(affiliateCode)) return null;
  return {plan, ...(promotionCode ? {promotionCode} : {}), ...(affiliateCode ? {affiliateCode} : {})};
}

export async function handleBilling(request, env, {config, session, reverify}) {
  const {pathname, searchParams, search} = new URL(request.url);
  if (config?.origin !== APP_ORIGIN || session?.authMode !== "email" || session.expiresAt <= Date.now()) {
    return json({error: "Sign in with your verified reader account."}, 401);
  }
  try {
    const subject = await accountIdentity(config, session);
    if (pathname === `${BILLING_API}/order` && request.method === "GET") {
      const id = searchParams.get("id");
      if ([...searchParams].length !== 1 || !orderId.test(id ?? "")) return json({error: "Choose a valid order."}, 400);
      return await publicResult(await readCheckout(env.COMMERCE, {subject, id}));
    }
    if (!launchBillingAvailable(env)) return json({error: "Purchases are currently unavailable."}, 503);
    const plans = catalog(env.LAUNCH_PLAN_CATALOG);
    if (pathname === `${BILLING_API}/plans` && request.method === "GET" && !search) return json({plans: [...plans.values()]});
    const quote = pathname === `${BILLING_API}/quote`;
    if (!quote && pathname !== `${BILLING_API}/checkout`) return json({error: "Not found."}, 404);
    if (request.method !== "POST" || search) return json({error: "Use the plans form to continue."}, 405);
    if (!mutable(request)) return json({error: "Use the plans form on SatinLore."}, 403);
    const body = await accountJson(request, APP_ORIGIN, 2048);
    const selection = purchaseSelection(body, plans);
    if (!selection || (quote ? ["idempotencyKey", "expectedAmountMinor", "expectedCurrency", "expectedCredits"].some(key => Object.hasOwn(body, key)) :
      !orderId.test(body.idempotencyKey ?? "") || !Number.isSafeInteger(body.expectedAmountMinor) || body.expectedAmountMinor < 1 ||
      !currencies.has(body.expectedCurrency) || !Number.isSafeInteger(body.expectedCredits))) {
      return json({error: "Choose a valid plan and code."}, 400);
    }
    const {name, ...plan} = selection.plan;
    if (!quote && (body.expectedCurrency !== plan.currency || body.expectedCredits !== plan.credits)) {
      return json({error: "This pack changed. Refresh plans before continuing."}, 409);
    }
    const renewed = await reverify();
    if (!renewed || renewed.subject !== session.subject || renewed.expiresAt <= Date.now()) {
      return json({error: "Sign in again to continue."}, 401);
    }
    const apply = quote ? quoteCheckout : reserveCheckout;
    const response = await publicResult(await apply(env.COMMERCE, {subject, ...selection, plan,
      ...(!quote ? {idempotencyKey: body.idempotencyKey, expectedAmountMinor: body.expectedAmountMinor} : {})}));
    if (quote || !response.ok) return response;
    const {checkout} = await response.json();
    if (!checkout || checkout.status !== "pending" || checkout.expiresAt <= Date.now()) {
      return json({error: "This checkout is closed. Refresh your plans to start another purchase."}, 409);
    }
    return json({checkout, checkoutUrl: await verotelCheckout(checkout, {name}, env)});
  } catch (error) {
    if (error instanceof AccountError) return json({error: error.message}, error.status);
    return json({error: "Checkout could not be confirmed. Retry the same order."}, 503);
  }
}

export async function handleBillingAdmin(request, env, session, reverify) {
  if (!session?.isFounder || session.expiresAt <= Date.now()) return json({error: "Founder access required."}, 403);
  if (!env.COMMERCE) return json({error: "Commerce storage is unavailable."}, 503);
  const {pathname, search} = new URL(request.url);
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
