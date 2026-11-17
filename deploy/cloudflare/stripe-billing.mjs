import { launchCommerceNamespace, readStripePayment, reverseCheckout, settleCheckout, settleSubscription, updateSubscriptionLifecycle } from "./commerce.mjs";
import { APP_ORIGIN } from "./public-auth.mjs";

export const STRIPE_WEBHOOK_PATH = "/api/billing/stripe/webhook";
export const STRIPE_API_VERSION = "2024-06-20";
const STRIPE_ORIGIN = "https://api.stripe.com";
const ORDER_METADATA = "satinlore_checkout";
const SOURCE_METADATA = "satinlore_reader";
const maxPayload = 256 * 1024;
const orderId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const currency = /^[a-z]{3}$/u;
const signaturePattern = /^[a-f0-9]{64}$/u;
const encoder = new TextEncoder();
const webhookTypes = new Set(["payment_intent.succeeded", "invoice.payment_succeeded", "customer.subscription.updated",
  "customer.subscription.deleted", "refund.created", "refund.updated", "charge.dispute.closed"]);

export function stripeIdentifier(value, prefix) {
  return typeof value === "string" && value.startsWith(`${prefix}_`) && /^[A-Za-z0-9_]{1,96}$/u.test(value) && value.length > prefix.length + 1;
}

const paymentId = value => stripeIdentifier(value, "pi");
const subscriptionId = value => stripeIdentifier(value, "sub");
const invoiceId = value => stripeIdentifier(value, "in");
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000;
const time = value => Number.isSafeInteger(value) && value >= 1_000_000_000 && value < 10_000_000_000 ? value * 1000 : null;

function stripeKeyConfigured(env) {
  return ["test", "live"].includes(env.STRIPE_MODE) && typeof env.STRIPE_SECRET_KEY === "string" &&
    /^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{12,240}$/u.test(env.STRIPE_SECRET_KEY) && env.STRIPE_SECRET_KEY.split("_")[1] === env.STRIPE_MODE;
}

export function stripeConfigured(env) {
  return stripeKeyConfigured(env) && /^whsec_[A-Za-z0-9_-]{16,240}$/u.test(env.STRIPE_WEBHOOK_SECRET ?? "") &&
    (env.STRIPE_PORTAL_CONFIGURATION_ID === undefined || stripeIdentifier(env.STRIPE_PORTAL_CONFIGURATION_ID, "bpc"));
}

async function boundedText(message, limit = maxPayload) {
  const declared = message.headers.get("Content-Length");
  if ((declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) || !message.body) throw new Error("Invalid Stripe payload");
  const reader = message.body.getReader();
  const decoder = new TextDecoder("utf-8", {fatal: true});
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  let result = "", bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (timedOut) throw new Error("Stripe payload timed out");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("Stripe payload too large");
      result += decoder.decode(value, {stream: true});
    }
    return result + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}

async function stripeRequest(env, path, body, fetcher, idempotencyKey) {
  if (!stripeKeyConfigured(env)) throw new Error("Stripe API not configured");
  const headers = {Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_API_VERSION};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const response = await fetcher(`${STRIPE_ORIGIN}/v1/${path}`, {method: body ? "POST" : "GET", headers, redirect: "error",
    signal: AbortSignal.timeout(8000), ...(body ? {body: new URLSearchParams(body)} : {})});
  if (!response.ok) throw new Error("Stripe request failed");
  const value = JSON.parse(await boundedText(response));
  if (!value || typeof value !== "object" || (typeof value.livemode === "boolean" && value.livemode !== (env.STRIPE_MODE === "live"))) {
    throw new Error("Unexpected Stripe response");
  }
  return value;
}

function hostedUrl(value, portal = false) {
  const url = typeof value === "string" && value.length <= 4096 ? URL.parse(value) : null;
  const host = portal ? "https://billing.stripe.com" : "https://checkout.stripe.com";
  const safePath = portal ? /^(?:\/p\/session\/[a-zA-Z0-9_-]+|\/p\/session)$/u : /^\/c\/pay\/cs_[a-zA-Z0-9_]+$/u;
  if (!url || url.origin !== host || !safePath.test(url.pathname) || url.username || url.password ||
      (portal && url.pathname === "/p/session" && !url.searchParams.get("secret"))) throw new Error("Unexpected Stripe destination");
  return url.href;
}

export async function stripeCheckout(checkout, plan, env, fetcher = fetch) {
  const monthly = plan.kind === "monthly";
  const data = monthly ? "subscription_data" : "payment_intent_data";
  const body = {
    mode: monthly ? "subscription" : "payment",
    "payment_method_types[0]": "card",
    client_reference_id: checkout.id,
    success_url: `${APP_ORIGIN}/billing?order=${checkout.id}`,
    cancel_url: `${APP_ORIGIN}/billing?order=${checkout.id}&cancelled=1`,
    expires_at: String(Math.floor(checkout.expiresAt / 1000)),
    [`${data}[metadata][${ORDER_METADATA}]`]: checkout.id,
    [`${data}[metadata][${SOURCE_METADATA}]`]: "v1",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": checkout.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(checkout.amountMinor),
    "line_items[0][price_data][product_data][name]": plan.name,
  };
  if (monthly) body["line_items[0][price_data][recurring][interval]"] = "month";
  const session = await stripeRequest(env, "checkout/sessions", body, fetcher, `satinlore-checkout-${checkout.id}`);
  if (session.object !== "checkout.session" || session.mode !== body.mode || session.client_reference_id !== checkout.id ||
      session.adaptive_pricing?.enabled === true ||
      session.amount_total !== checkout.amountMinor || session.currency !== body["line_items[0][price_data][currency]"]) {
    throw new Error("Stripe checkout does not match confirmed pricing");
  }
  return hostedUrl(session.url);
}

const debtOrder = metadata => metadata?.[SOURCE_METADATA] === "v1" && orderId.test(metadata[ORDER_METADATA]) ? metadata[ORDER_METADATA] : null;

export async function stripeCancelUrl(subscription, env, fetcher = fetch) {
  if (!subscriptionId(subscription.providerSaleId)) throw new Error("Invalid Stripe subscription");
  const live = await stripeRequest(env, `subscriptions/${subscription.providerSaleId}`, null, fetcher);
  if (live.object !== "subscription" || live.id !== subscription.providerSaleId || debtOrder(live.metadata) !== subscription.id ||
      !stripeIdentifier(live.customer, "cus") || live.status === "canceled" || live.cancel_at_period_end === true) {
    throw new Error("Stripe subscription is unavailable");
  }
  const returnUrl = `${APP_ORIGIN}/billing`;
  const body = {customer: live.customer, return_url: returnUrl, "flow_data[type]": "subscription_cancel",
    "flow_data[subscription_cancel][subscription]": live.id, "flow_data[after_completion][type]": "redirect",
    "flow_data[after_completion][redirect][return_url]": returnUrl,
    ...(env.STRIPE_PORTAL_CONFIGURATION_ID ? {configuration: env.STRIPE_PORTAL_CONFIGURATION_ID} : {})};
  const portal = await stripeRequest(env, "billing_portal/sessions", body, fetcher);
  if (portal.object !== "billing_portal.session" || portal.customer !== live.customer) throw new Error("Invalid Stripe portal");
  return hostedUrl(portal.url, true);
}

function sameHex(a, b) {
  let difference = 0;
  for (let index = 0; index < b.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

async function signatureValid(header, body, secret) {
  if (!header || header.length > 2048) return false;
  const timestamps = [], signatures = [];
  for (const item of header.split(",")) {
    const [key, value] = item.trim().split("=", 2);
    if (key === "t") timestamps.push(value);
    if (key === "v1" && signaturePattern.test(value ?? "")) signatures.push(value);
  }
  const [timestamp] = timestamps;
  if (timestamps.length !== 1 || !/^\d{10}$/u.test(timestamp ?? "") || !signatures.length ||
      Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60_000) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  const expected = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("");
  return signatures.reduce((match, signature) => sameHex(signature, expected) || match, false);
}

const ledgerFields = (id, providerSaleId, providerTransactionId, amountMinor, iso) => ({id, providerSaleId, providerTransactionId,
  eventId: `stripe:${providerTransactionId}`, amountMinor, currency: iso.toUpperCase()});

function invoicePayment(invoice) {
  const id = debtOrder(invoice.subscription_details?.metadata);
  if (!id || !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason)) return null;
  const [line] = invoice.lines?.data ?? [];
  const periodStart = time(line?.period?.start), periodEnd = time(line?.period?.end);
  if (invoice.object !== "invoice" || invoice.status !== "paid" || invoice.paid !== true || invoice.paid_out_of_band === true ||
      invoice.collection_method !== "charge_automatically" || !invoiceId(invoice.id) || !subscriptionId(invoice.subscription) ||
      !paymentId(invoice.payment_intent) || !positive(invoice.amount_paid) || !currency.test(invoice.currency) ||
      invoice.lines.has_more !== false || invoice.lines.data.length !== 1 || line?.type !== "subscription" || line.proration !== false ||
      line.amount !== invoice.amount_paid || line.currency !== invoice.currency || !periodStart || !periodEnd || periodStart >= periodEnd) {
    throw new Error("Invalid Stripe invoice");
  }
  return {...ledgerFields(id, invoice.subscription, invoice.id, invoice.amount_paid, invoice.currency),
    periodStart, periodEnd, renewal: invoice.billing_reason === "subscription_cycle", paymentId: invoice.payment_intent};
}

async function reversalTarget(namespace, id, env, fetcher) {
  const result = await readStripePayment(namespace, {paymentId: id});
  if (!result.ok) throw new Error("Payment lookup unavailable");
  const {payment} = await result.json();
  if (payment) return payment;
  // Stripe can deliver reversals before the payment webhook. Trusted metadata on
  // the underlying Stripe objects distinguishes the app’s payments from others.
  const intent = await stripeRequest(env, `payment_intents/${id}`, null, fetcher);
  if (intent.object !== "payment_intent" || intent.id !== id) throw new Error("Invalid payment lookup");
  const ownOrder = debtOrder(intent.metadata);
  if (ownOrder) return {id: ownOrder, kind: "one-time", providerSaleId: id, providerTransactionId: id};
  if (!invoiceId(intent.invoice)) return null;
  const invoice = await stripeRequest(env, `invoices/${intent.invoice}`, null, fetcher);
  if (invoice.id !== intent.invoice || invoice.payment_intent !== id) throw new Error("Invalid invoice lookup");
  const paid = invoicePayment(invoice);
  return paid && {...paid, kind: "monthly"};
}

export async function handleStripeWebhook(request, env, fetcher = fetch) {
  const failure = status => new Response(status >= 500 ? "Reconciliation unavailable" : "Invalid Stripe event", {status});
  if (env.LAUNCH_PAYMENT_PROVIDER !== "stripe" || !stripeConfigured(env) || !env.COMMERCE) return failure(503);
  if (request.method !== "POST") return new Response("Method not allowed", {status: 405, headers: {Allow: "POST"}});
  if (new URL(request.url).search || request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return failure(400);
  }
  let event;
  try {
    const raw = await boundedText(request);
    if (!await signatureValid(request.headers.get("Stripe-Signature"), raw, env.STRIPE_WEBHOOK_SECRET)) return failure(400);
    event = JSON.parse(raw);
  } catch { return failure(400); }
  if (event?.object !== "event" || !stripeIdentifier(event.id, "evt") || event.livemode !== (env.STRIPE_MODE === "live") ||
      event.api_version !== STRIPE_API_VERSION || !time(event.created) || event.account) return failure(400);
  if (!webhookTypes.has(event.type)) return new Response(null, {status: 204});
  const value = event.data?.object;
  if (!value || typeof value !== "object") return failure(400);
  const namespace = launchCommerceNamespace(env);
  let result;
  try {
    if (event.type === "payment_intent.succeeded") {
      const id = debtOrder(value.metadata);
      if (id) {
        if (value.object !== "payment_intent" || value.status !== "succeeded" || !paymentId(value.id) || !positive(value.amount_received) ||
            value.amount_received !== value.amount || !currency.test(value.currency)) return failure(400);
        result = await settleCheckout(namespace, {...ledgerFields(id, value.id, value.id, value.amount_received, value.currency), paymentId: value.id});
      }
    } else if (event.type === "invoice.payment_succeeded") {
      const paid = invoicePayment(value);
      if (paid) result = await settleSubscription(namespace, paid);
    } else if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const id = debtOrder(value.metadata);
      if (id) {
        if (value.object !== "subscription" || !subscriptionId(value.id)) return failure(400);
        const periodEnd = time(value.current_period_end);
        const deletion = event.type === "customer.subscription.deleted";
        const previous = event.data?.previous_attributes;
        if (deletion || (typeof previous?.cancel_at_period_end === "boolean" && previous.cancel_at_period_end !== value.cancel_at_period_end)) {
          if (!deletion && (!periodEnd || typeof value.cancel_at_period_end !== "boolean")) return failure(400);
          result = await updateSubscriptionLifecycle(namespace, {id, providerSaleId: value.id,
            eventId: `stripe:${event.id}`, occurredAt: time(event.created),
            event: deletion ? "expire" : value.cancel_at_period_end ? "cancel" : "uncancel", periodEnd: deletion ? null : periodEnd});
        }
      }
    } else {
      const dispute = event.type === "charge.dispute.closed";
      const accepted = dispute ? value.status === "lost" : value.status === "succeeded";
      if (accepted) {
        const validId = dispute ? stripeIdentifier(value.id, "du") || stripeIdentifier(value.id, "dp") : stripeIdentifier(value.id, "re");
        if (value.payment_intent === null) return new Response(null, {status: 204});
        if (value.object !== (dispute ? "dispute" : "refund") || !validId ||
            !paymentId(value.payment_intent) || !positive(value.amount) || !currency.test(value.currency)) return failure(400);
        const target = await reversalTarget(namespace, value.payment_intent, env, fetcher);
        if (target) result = await reverseCheckout(namespace, {...ledgerFields(target.id, target.providerSaleId, value.id, value.amount, value.currency),
          kind: target.kind, parentTransactionId: target.providerTransactionId, reason: dispute ? "chargeback" : "refund"});
      }
    }
    if (!result || result.ok) return new Response(null, {status: 204});
    return failure(result.status);
  } catch { return failure(503); }
}
