const node = id => document.getElementById(id);
const status = node("billing-status");
const form = node("plan-form");
const promo = node("promotion");
const checkPrice = node("check-price");
const checkout = node("checkout");
const quoteStatus = node("quote-status");
const refresh = node("refresh-usage");
const cancel = node("show-cancel-subscription");
const confirmCancel = node("cancel-subscription");
const backCancel = node("back-cancel-subscription");
const cancelPanel = node("subscription-cancel");
const subscriptionMessage = node("subscription-message");

const url = new URL(window.location.href);
const referral = url.searchParams.get("ref")?.toUpperCase() ?? "";
const ref = /^[A-Z0-9][A-Z0-9_-]{1,31}$/u.test(referral) ? referral : "";
const orderParam = url.searchParams.get("order") ?? "";
const order = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(orderParam) ? orderParam : "";
const format = new Intl.NumberFormat(undefined, {maximumFractionDigits: 2});
const NANO_USD_PER_CREDIT = 10_000_000;
const plansById = new Map();
let approved = null, sequence = 0, checking = false, subscription = null, signedIn = false;

async function api(path, body) {
  const response = await fetch(path, {
    credentials: "same-origin", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    ...(body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(typeof value?.error === "string" && value.error.length <= 200 ? value.error : "Please try again.");
    error.status = response.status;
    throw error;
  }
  return value;
}

function cost(currency, minor) {
  return new Intl.NumberFormat(undefined, {style: "currency", currency}).format(minor / 100);
}

function credits(nanos) {
  const value = nanos / NANO_USD_PER_CREDIT;
  return value > 0 && value < .01 ? `<${format.format(.01)}` : format.format(value);
}

function displayDate(timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, {timeZone: "UTC", dateStyle: "long"});
}

async function usage() {
  const state = await api("/api/account/usage");
  if (!state.enabled) { node("usage-section").hidden = true; return; }
  if (state.unit !== "nano_usd") throw new Error("Usage could not be loaded.");
  const subscriptionCredits = state.subscription?.remaining ?? 0;
  const packCredits = state.credits.remaining;
  node("credit-remaining").textContent = credits(packCredits + subscriptionCredits);
  node("month-used").textContent = credits(state.month.used);
  node("month-limit").textContent = credits(state.month.limit);
  const paidThrough = displayDate(state.subscription?.endsAt);
  const breakdown = node("credit-breakdown");
  breakdown.hidden = !paidThrough;
  breakdown.textContent = paidThrough ?
    `${credits(subscriptionCredits)} subscription credits through ${paidThrough} (UTC). ${credits(packCredits)} pack and trial credits.` : "";
  const next = displayDate(state.month.endsAt);
  node("usage-note").textContent = next ?
    `The usage limit resets on ${next} (UTC). Analysis in progress can temporarily reserve credits.` :
    "Analysis in progress can temporarily reserve credits.";
  node("usage-section").hidden = false;
}

function selectedPlan() {
  return plansById.get(form.querySelector('input[name="billing-plan"]:checked')?.value)?.plan;
}

function invalidate() {
  ++sequence;
  approved = null;
  checkout.disabled = true;
  quoteStatus.textContent = "";
}

function updatePlans() {
  const before = selectedPlan();
  const monthlyUnavailable = subscription?.renews === true || subscription?.status === "pending" ||
    subscription?.paidThrough > Date.now();
  for (const {plan, input} of plansById.values()) {
    input.disabled = monthlyUnavailable && plan.kind === "monthly";
    if (input.disabled) input.checked = false;
  }
  if (!selectedPlan()) {
    const first = Array.from(plansById.values()).find(({input}) => !input.disabled);
    if (first) first.input.checked = true;
  }
  const selected = selectedPlan();
  if (before?.id !== selected?.id) invalidate();
  node("monthly-plan-note").textContent = monthlyUnavailable ? "Check your current subscription status above." :
    "Renews monthly until canceled.";
  node("billing-promo").hidden = selected?.kind !== "one-time";
  checkPrice.disabled = checking || !selected;
  node("plans-section").hidden = !plansById.size;
}

function planOption(plan, group) {
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "billing-plan";
  input.value = plan.id;

  const details = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = plan.name;
  const price = document.createElement("span");
  price.className = "billing-option-price";
  price.textContent = cost(plan.currency, plan.amountMinor) + (plan.kind === "monthly" ? " / month" : "");
  const allowance = document.createElement("span");
  allowance.className = "billing-option-credits";
  allowance.textContent = `${credits(plan.credits)} credits${plan.kind === "monthly" ? " per month" : ""}`;
  details.append(name, price, allowance);

  const label = document.createElement("label");
  label.className = "billing-option";
  label.append(input, details);
  node(group).append(label);
  plansById.set(plan.id, {plan, input});
}

async function plans() {
  const state = await api("/api/billing/plans");
  node("checkout-note").textContent = state.provider === "stripe" ? "Stripe handles checkout. Credits appear after your payment is confirmed." :
    "Credits appear after your payment is confirmed.";
  const groups = {monthly: ["monthly-plans", "monthly-options"], "one-time": ["top-up-plans", "top-up-options"]};
  const preference = selectedPlan()?.id;
  const received = state.plans.map(item => ({...item, kind: item.kind ?? "one-time"})).filter(item => Object.hasOwn(groups, item.kind));
  const current = Array.from(plansById.values(), ({plan}) => plan);
  if (JSON.stringify(received) === JSON.stringify(current)) return;
  plansById.clear();
  for (const [section, options] of Object.values(groups)) {
    node(section).hidden = true;
    node(options).replaceChildren();
  }
  for (const item of received) {
    const [section, options] = groups[item.kind];
    planOption(item, options);
    node(section).hidden = false;
  }
  const preferred = plansById.get(preference);
  if (preferred) preferred.input.checked = true;
  invalidate();
  updatePlans();
}

async function readOrder() {
  if (!orderParam && url.searchParams.get("cancelled") !== "1") return;
  node("order-section").hidden = false;
  const result = node("order-status");
  if (!orderParam) {
    result.textContent = "Checkout was closed. You can choose a plan or credit pack when you’re ready.";
    return;
  }
  try {
    if (!order) throw new Error();
    const {checkout: saved} = await api(`/api/billing/order?id=${order}`);
    const descriptions = {
      paid: "Payment confirmed.",
      refunded: "This payment was refunded.",
      "charged-back": "This payment was reversed.",
      "partially-refunded": "This payment was partly refunded.",
      pending: "Waiting for payment confirmation. Refresh usage to check again.",
    };
    result.textContent = descriptions[saved.status] ?? "This order is closed. Contact support if you were charged.";
  } catch {
    result.textContent = "The order could not be confirmed. Sign in to the account that made the purchase, then refresh usage.";
  }
}

function renderSubscription(value) {
  const priorId = subscription?.id;
  subscription = value;
  const state = node("subscription-status"), details = node("subscription-details");
  const paidThrough = displayDate(value?.paidThrough);
  const renews = value?.renews === true;
  const labels = {
    active: "Active",
    pending: "Waiting for payment confirmation",
    "past-due": "Payment past due",
    canceled: "Renewal canceled",
    cancelled: "Renewal canceled",
    expired: "Ended",
    refunded: "Payment refunded",
    "charged-back": "Payment reversed",
    "requires-review": "Payment needs review",
  };
  state.textContent = value ? labels[value.status] ?? "Subscription status unavailable" : "You have no subscription.";
  if (renews) {
    const price = cost(value.currency, value.rebillAmountMinor);
    details.textContent = paidThrough ? `${price} per month. Paid period ends on ${paidThrough} (UTC).` : `${price} per month.`;
  } else {
    details.textContent = paidThrough ? `Paid period ends on ${paidThrough} (UTC).` : "";
  }
  if (!renews || priorId !== value.id) cancelPanel.hidden = true;
  cancel.hidden = !renews || !cancelPanel.hidden;
  node("subscription-section").hidden = false;
  updatePlans();
}

async function readSubscription() {
  const state = await api("/api/billing/subscription");
  renderSubscription(state.subscription);
}

function providerUrl(value, purpose) {
  const target = typeof value === "string" && value.length <= 4096 ? URL.parse(value) : null;
  if (target && !target.username && !target.password) {
    // Stripe Checkout includes an opaque session fragment in the hosted URL.
    if (purpose === "checkout" && target.origin === "https://checkout.stripe.com" &&
        /^\/c\/pay\/cs_(?:test|live)_[A-Za-z0-9_]+$/.test(target.pathname) && !target.search) return target.href;
    if (purpose === "cancellation" && target.origin === "https://billing.stripe.com" && !target.hash) {
      const secret = target.searchParams.get("secret");
      if (target.pathname === "/p/session" && target.searchParams.size === 1 && /^[A-Za-z0-9_-]+$/.test(secret ?? "")) return target.href;
      if (/^\/p\/session\/[A-Za-z0-9_-]+$/.test(target.pathname) && !target.search) return target.href;
    }
    // Existing staged Verotel records can still open their own hosted pages.
    const legacyPath = purpose === "checkout" ? "/startorder" : "/cancel-subscription";
    if (target.origin === "https://secure.verotel.com" && target.pathname === legacyPath && !target.hash) return target.href;
  }
  throw new Error("The payment page could not be opened. Please try again.");
}

form.addEventListener("input", () => {
  invalidate();
  updatePlans();
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const plan = selectedPlan();
  if (!plan || checking) return;
  invalidate();
  const version = sequence;
  const promotion = plan.kind === "one-time" ? promo.value.trim() : "";
  const body = {planId: plan.id, ...(promotion ? {promo: promotion} : {}), ...(ref ? {ref} : {})};
  checking = true;
  checkPrice.disabled = true;
  try {
    const {quote} = await api("/api/billing/quote", body);
    if (version !== sequence) return;
    const kind = quote?.kind ?? "one-time";
    const monthly = kind === "monthly";
    if (kind !== plan.kind || !Number.isSafeInteger(quote?.amountMinor) || quote.amountMinor < 1 ||
        !Number.isSafeInteger(quote.credits) || quote.credits < 1 || quote.currency !== plan.currency ||
        monthly && (!Number.isSafeInteger(quote.rebillAmountMinor) || quote.rebillAmountMinor < 1)) {
      throw new Error("The plan price could not be confirmed. Please try again.");
    }
    approved = {...body, idempotencyKey: crypto.randomUUID(), expectedAmountMinor: quote.amountMinor,
      expectedCurrency: quote.currency, expectedCredits: quote.credits, expectedKind: kind,
      ...(monthly ? {expectedRebillAmountMinor: quote.rebillAmountMinor} : {})};
    const quantity = credits(quote.credits), price = cost(quote.currency, quote.amountMinor);
    quoteStatus.textContent = monthly ?
      `${quantity} credits per month. ${price} today, then ${cost(quote.currency, quote.rebillAmountMinor)} per month until canceled.` :
      `${quantity} credits for ${price}. One-time payment.`;
    checkout.disabled = false;
  } catch (error) {
    if (version === sequence) quoteStatus.textContent = error.message;
  } finally {
    checking = false;
    checkPrice.disabled = !selectedPlan();
  }
});

checkout.addEventListener("click", async () => {
  if (!approved) return;
  const request = approved;
  checkout.disabled = true;
  try {
    const outcome = await api("/api/billing/checkout", request);
    if (approved === request) window.location.assign(providerUrl(outcome.checkoutUrl, "checkout"));
  } catch (error) {
    if (approved !== request) return;
    checkout.disabled = false;
    quoteStatus.textContent = error.message;
  }
});

cancel.addEventListener("click", () => {
  cancelPanel.hidden = false;
  cancel.hidden = true;
  subscriptionMessage.textContent = "";
  confirmCancel.focus();
});
backCancel.addEventListener("click", () => {
  cancelPanel.hidden = true;
  cancel.hidden = false;
  cancel.focus();
});
confirmCancel.addEventListener("click", async () => {
  if (subscription?.renews !== true) return;
  confirmCancel.disabled = backCancel.disabled = true;
  subscriptionMessage.textContent = "";
  try {
    const {cancelUrl} = await api("/api/billing/cancel-subscription", {id: subscription.id, confirm: true});
    window.location.assign(providerUrl(cancelUrl, "cancellation"));
  } catch (error) {
    subscriptionMessage.textContent = error.message;
    confirmCancel.disabled = backCancel.disabled = false;
  }
});

function accountStatus([usageResult, subscriptionResult, , plansResult]) {
  const messages = [];
  if (usageResult.status === "rejected") messages.push("Usage could not be loaded. Try again shortly.");
  if (subscriptionResult.status === "rejected") messages.push("Subscription status could not be loaded.");
  if (plansResult.status === "rejected") messages.push("Purchases are currently unavailable.");
  status.textContent = messages.join(" ");
}

async function refreshAccount() {
  refresh.disabled = true;
  try { accountStatus(await Promise.allSettled([usage(), readSubscription(), readOrder(), plans()])); }
  finally { refresh.disabled = false; }
}

refresh.addEventListener("click", refreshAccount);
window.addEventListener("pageshow", event => {
  if (event.persisted && signedIn) {
    confirmCancel.disabled = backCancel.disabled = false;
    void refreshAccount();
  }
});

try {
  const access = await api("/api/access");
  signedIn = access.authenticated === true;
  if (!signedIn) {
    const parameters = new URLSearchParams({next: "billing", ...(ref ? {ref} : {}), ...(order ? {order} : {})});
    const signIn = node("billing-sign-in-link");
    signIn.href = `/login?${parameters}`;
    if (order) signIn.textContent = "Sign in to check your order";
    parameters.delete("order");
    node("billing-sign-up-link").href = `/signup?${parameters}`;
    node("billing-sign-up-link").hidden = Boolean(order);
    node("billing-sign-in").hidden = false;
    status.textContent = order ? "Sign in with the account that placed this order." : "Create an account or sign in to view plans and manage AI credits.";
  } else {
    refresh.hidden = false;
    await refreshAccount();
  }
} catch { status.textContent = "Plans and usage are temporarily unavailable."; }
