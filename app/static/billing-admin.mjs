const node = id => document.getElementById(id);
const status = node("admin-status"), promotion = node("promotion-form"), affiliate = node("affiliate-form");
const reconciliation = node("reconciliation-form"), reconciliationStatus = node("reconciliation-status");
const download = node("download-activity");
let busy = false;
let filterRevision = 0;

async function call(path = "", body) {
  const response = await fetch(`/api/billing-admin${path}`, {
    credentials: "same-origin", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    ...(body ? {method: "POST", body: JSON.stringify(body), headers: {"Content-Type": "application/json"}} : {}),
  });
  if (!response.ok) {
    const detail = response.status === 400 ? (await response.json().catch(() => ({}))).error : null;
    throw new Error(response.status === 403 ? "Sign in through founder access." : detail ?? "The billing request could not be confirmed.");
  }
  return response.json();
}

const dateValue = value => new Date(value).toISOString().slice(0, 16);
const money = (currency, minor) => new Intl.NumberFormat(undefined, {style: "currency", currency}).format(minor / 100);
const number = new Intl.NumberFormat(undefined, {maximumFractionDigits: 7});
const day = new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeZone: "UTC"});
const grant = (amount, unit) => unit === "nano_usd" ?
  `${number.format(amount / 10_000_000)} credits` : `${number.format(amount)} legacy tokens`;
const transactionLabels = new Map([["purchase", "Top-up"], ["subscription-initial", "First subscription payment"],
  ["subscription-rebill", "Subscription renewal"], ["refund", "Refund"], ["chargeback", "Chargeback"]]);

function fill(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const input = form.elements.namedItem(name);
    if (typeof value === "boolean") input.checked = value;
    else input.value = value;
  }
  form.elements.namedItem("code").focus();
}

function render(id, entries, content, empty = "No records yet.") {
  const list = node(id);
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    item.append(...content(entry));
    list.append(item);
  }
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = empty;
    list.append(item);
  }
}

function edit(action) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = "Edit"; button.addEventListener("click", action);
  return button;
}

async function reload() {
  const {promotions, affiliates, checkouts, subscriptionCharges = []} = await call();
  render("promotions-list", promotions, row => [
    `${row.code} · ${row.discountBps / 100}% off · ${row.claimed}/${row.maxRedemptions} claimed · ${row.enabled ? "Active" : "Disabled"} `,
    edit(() => fill(promotion, {code: row.code, percent: row.discountBps / 100, limit: row.maxRedemptions,
      planId: row.planId ?? "", from: dateValue(row.validFrom), until: dateValue(row.validUntil), enabled: row.enabled})),
  ]);
  render("affiliates-list", affiliates, row => {
    const link = document.createElement("a");
    const path = `/billing?ref=${encodeURIComponent(row.code)}`;
    link.href = path; link.textContent = new URL(path, window.location.origin).href;
    return [`${row.code} · ${row.commissionBps / 100}% · ${row.enabled ? "Active" : "Disabled"} · `, link, " ",
      edit(() => fill(affiliate, {code: row.code, percent: row.commissionBps / 100, enabled: row.enabled}))];
  });
  render("orders-list", checkouts, row => [
    `${row.id} · ${row.planId} · ${row.status} · ${money(row.currency, row.amountMinor)} · ${grant(row.grantedCredits, row.unit)}` +
    (row.affiliateCode ? ` · ${row.affiliateCode}: ${money(row.currency, row.commissionMinor)} commission` : "") +
    (row.reviewReason ? ` · Review: ${row.reviewReason}` : ""),
  ]);
  render("subscription-charges-list", subscriptionCharges, row => {
    const end = day.format(row.endsAt);
    const period = row.startsAt === null ?
      (row.reviewReason ? `Period ending ${end} (UTC)` : `Awaiting a linked billing period ending ${end} (UTC)`) :
      `${day.format(row.startsAt)} to ${end} (UTC)`;
    return [
      `${row.checkoutId} · Transaction ${row.providerTransactionId} · ${period} · ${money(row.currency, row.amountMinor)} · ${grant(row.grantedCredits, "nano_usd")}` +
      (row.refundedMinor ? ` · ${money(row.currency, row.refundedMinor)} refunded` : "") +
      (row.affiliateCode ? ` · ${row.affiliateCode}: ${money(row.currency, row.commissionMinor)} commission` : "") +
      (row.reviewReason ? ` · Review: ${row.reviewReason}` : ""),
    ];
  });
}

function showReconciliation({orders, transactions, truncated}, query) {
  node("reconciliation-orders").hidden = !query.has("reference");
  node("reconciliation-activity").hidden = false;
  render("matching-orders-list", orders, row => [
    `${row.id} · ${row.planId} · ${row.status} · ${money(row.currency, row.amountMinor)}` +
    (row.providerSaleId ? ` · Payment reference ${row.providerSaleId}` : "") +
    (row.refundedMinor ? ` · ${money(row.currency, row.refundedMinor)} refunded` : "") +
    (row.affiliateCode ? ` · ${row.affiliateCode}: ${money(row.currency, row.commissionMinor)} commission` : "") +
    (row.reviewReason ? ` · Review: ${row.reviewReason}` : ""),
  ], "No orders match this reference.");
  render("transactions-list", transactions, row => [
    `${transactionLabels.get(row.kind) ?? row.kind} · ${money(row.currency, row.amountMinor)} · ${dateValue(row.receivedAt).replace("T", " ")} UTC` +
    ` · Order ${row.checkoutId} · Payment reference ${row.providerSaleId} · Transaction ${row.providerTransactionId}` +
    (row.parentTransactionId ? ` · Original transaction ${row.parentTransactionId}` : "") +
    (row.needsReview ? ` · Review required${row.reviewReason ? " (" + row.reviewReason + ")" : ""}` : ""),
  ], "No transactions match your filters.");
  reconciliationStatus.textContent = truncated ? "Showing the latest 500 transactions. Narrow the dates to download the activity." :
    `${number.format(transactions.length)} ${transactions.length === 1 ? "transaction" : "transactions"} found.`;
  download.href = `/api/billing-admin/reconciliation.csv?${query}`;
  download.hidden = truncated || !transactions.length;
}

async function perform(action, completed = "") {
  if (busy) return;
  busy = true; status.textContent = "Working…";
  try { await action(); status.textContent = completed; }
  catch (error) { status.textContent = error.message; }
  finally { busy = false; }
}
promotion.addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(promotion), planId = data.get("planId").trim();
  return perform(async () => {
    await call("/promotion", {code: data.get("code").trim(), discountBps: Math.round(Number(data.get("percent")) * 100),
      maxRedemptions: Number(data.get("limit")), validFrom: Date.parse(`${data.get("from")}Z`),
      validUntil: Date.parse(`${data.get("until")}Z`), enabled: data.has("enabled"), ...(planId ? {planId} : {})});
    await reload();
  }, "Promotion saved.");
});
affiliate.addEventListener("submit", event => {
  event.preventDefault();
  const data = new FormData(affiliate);
  return perform(async () => {
    await call("/affiliate", {code: data.get("code").trim(), commissionBps: Math.round(Number(data.get("percent")) * 100),
      enabled: data.has("enabled")});
    await reload();
  }, "Affiliate saved.");
});
reconciliation.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  const data = new FormData(reconciliation), query = new URLSearchParams();
  for (const field of ["reference", "from", "through"]) {
    const value = data.get(field).trim();
    if (value) query.set(field, value);
  }
  if (data.has("attention")) query.set("attention", "1");
  const revision = filterRevision;
  download.hidden = true;
  node("reconciliation-orders").hidden = true;
  node("reconciliation-activity").hidden = true;
  busy = true;
  reconciliationStatus.textContent = "Finding payments…";
  try {
    const report = await call(`/reconciliation?${query}`);
    if (revision === filterRevision) showReconciliation(report, query);
  } catch (error) {
    if (revision === filterRevision) reconciliationStatus.textContent = error.message;
  }
  finally { busy = false; }
});
reconciliation.addEventListener("input", () => {
  filterRevision++;
  download.hidden = true;
  reconciliationStatus.textContent = "Select Find payments to apply filters.";
});
node("reload-billing").addEventListener("click", () => void perform(reload));
await perform(reload);
