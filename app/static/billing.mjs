const node = id => document.getElementById(id);
const format = new Intl.NumberFormat();
const url = new URL(window.location.href);
const referral = url.searchParams.get("ref")?.toUpperCase() ?? "";
const ref = /^[A-Z0-9][A-Z0-9_-]{1,31}$/u.test(referral) ? referral : "";
const order = url.searchParams.get("order") ?? "";
const selection = node("plan"), promo = node("promotion"), checkout = node("checkout"), status = node("billing-status");
const quoteStatus = node("quote-status");
let approved = null, sequence = 0;

async function api(path, body) {
  const response = await fetch(path, {
    credentials: "same-origin", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    ...(body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(typeof value.error === "string" && value.error.length <= 200 ? value.error : "Please try again.");
    error.status = response.status;
    throw error;
  }
  return value;
}

function cost(currency, minor) {
  return new Intl.NumberFormat(undefined, {style: "currency", currency}).format(minor / 100);
}

async function usage() {
  const state = await api("/api/account/usage");
  if (!state.enabled) return;
  node("credit-remaining").textContent = format.format(state.credits.remaining);
  node("month-used").textContent = format.format(state.month.used);
  node("month-limit").textContent = format.format(state.month.limit);
  const next = new Date(state.month.endsAt).toLocaleDateString(undefined, {timeZone: "UTC", dateStyle: "long"});
  node("usage-note").textContent = `Monthly usage resets ${next} (UTC). Pending analysis can temporarily reserve credits.`;
  node("usage-section").hidden = false;
}

async function plans() {
  const state = await api("/api/billing/plans");
  for (const item of state.plans) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} · ${format.format(item.credits)} credits · ${cost(item.currency, item.amountMinor)}`;
    selection.append(option);
  }
  node("plans-section").hidden = !selection.options.length;
}

async function readOrder() {
  if (!order && url.searchParams.get("cancelled") !== "1") return;
  node("order-section").hidden = false;
  const result = node("order-status");
  if (!order) { result.textContent = "Checkout was closed. You can choose a pack when you’re ready."; return; }
  try {
    const {checkout: saved} = await api(`/api/billing/order?id=${encodeURIComponent(order)}`);
    const descriptions = {
      paid: "Payment confirmed. Your credits are available.", refunded: "This payment was refunded.",
      "charged-back": "This payment was reversed.", "partially-refunded": "This payment was partly refunded.",
      pending: "Waiting for payment confirmation. Refresh usage to check again.",
    };
    result.textContent = descriptions[saved.status] ?? "This order is closed. Contact support if you were charged.";
  } catch { result.textContent = "The order could not be confirmed. Sign in to the account that made the purchase, then refresh usage."; }
}

function invalidate() {
  ++sequence;
  approved = null;
  checkout.disabled = true;
  quoteStatus.textContent = "";
}
for (const input of [selection, promo]) input.addEventListener("input", invalidate);

node("plan-form").addEventListener("submit", async event => {
  event.preventDefault();
  invalidate();
  const version = sequence, promotion = promo.value.trim();
  const body = {planId: selection.value, ...(promotion ? {promo: promotion} : {}), ...(ref ? {ref} : {})};
  node("check-price").disabled = true;
  try {
    const {quote} = await api("/api/billing/quote", body);
    if (version !== sequence) return;
    approved = {...body, idempotencyKey: crypto.randomUUID(), expectedAmountMinor: quote.amountMinor,
      expectedCurrency: quote.currency, expectedCredits: quote.credits};
    quoteStatus.textContent = `${format.format(quote.credits)} credits for ${cost(quote.currency, quote.amountMinor)}.`;
    checkout.disabled = false;
  } catch (error) { if (version === sequence) quoteStatus.textContent = error.message; }
  finally { node("check-price").disabled = false; }
});

checkout.addEventListener("click", async () => {
  if (!approved) return;
  const request = approved;
  checkout.disabled = true;
  try {
    const outcome = await api("/api/billing/checkout", request);
    const target = new URL(outcome.checkoutUrl);
    if (target.origin !== "https://secure.verotel.com" || target.pathname !== "/startorder") throw new Error("Checkout could not be opened.");
    if (approved === request) window.location.assign(target.href);
  } catch (error) {
    if (approved !== request) return;
    checkout.disabled = false;
    quoteStatus.textContent = error.message;
  }
});

node("refresh-usage").addEventListener("click", async () => {
  try { await Promise.all([usage(), readOrder()]); status.textContent = ""; }
  catch (error) { status.textContent = error.message; }
});

try {
  const access = await api("/api/access");
  if (!access.authenticated) {
    const parameters = new URLSearchParams({signin: "1", next: "billing", ...(ref ? {ref} : {}), ...(order ? {order} : {})});
    node("billing-sign-in-link").href = `/?${parameters}`;
    node("billing-sign-in").hidden = false;
    status.textContent = "Sign in to view your credits or buy a pack.";
  } else {
    const checks = await Promise.allSettled([usage(), plans(), readOrder()]);
    status.textContent = checks.slice(0, 2).every(check => check.status === "fulfilled") ? "" :
      checks[0].status === "fulfilled" ? "Purchases are currently unavailable." : "Usage could not be loaded. Try again shortly.";
  }
} catch { status.textContent = "Plans and usage are temporarily unavailable."; }
